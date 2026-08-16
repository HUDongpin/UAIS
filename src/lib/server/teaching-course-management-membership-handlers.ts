import { resolveTeachingClassCourseId } from "./teaching-course-management-class-handlers";
import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import { requireSafeId } from "./teaching-course-management-guards";
import {
  countApprovedMembershipsForClass,
  countApprovedStudentsForCourse,
  createAuditEvent,
  createReceipt,
} from "./teaching-course-management-helpers";
import {
  localTeachingCourseManagementStorage,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  writeTeachingCourseManagementSnapshot,
} from "./teaching-course-management-io";
import {
  createTeachingCourseManagementContentionError,
  createTeachingCourseManagementWriteRetry,
  teachingCourseManagementMaxWriteAttempts,
} from "./teaching-course-management-write-retry";
import type {
  TeachingClassMembershipRecord,
  TeachingClassRecord,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementAuthSessionSummary,
  TeachingCourseManagementDatabase,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementRepository,
  TeachingCourseRecord,
} from "@/lib/server/teaching-course-management-types";

// Membership-lifecycle handler family: bulk approval, rejection, removal.
//
// The single-membership approval lives beside the class handlers because it is
// as old as the class record; everything that treats a roster as a roster rather
// than as one student at a time lives here. Both handlers below make ONE
// course-scoped write and append ONE audit event, because the case they exist
// for is a 200-student class where 200 separate writes would spend the whole
// enrolment hour losing the optimistic race against each other.
//
// Cycle-free: runtime deps are the extracted io/helpers/guards/error modules and
// the class handlers' course resolver (which does not import back); store types
// are a type-only import.

type MembershipMutationAudit = {
  requestSource?: TeachingCourseManagementAuditRequestSource;
  authSession?: TeachingCourseManagementAuthSessionSummary;
};

export type TeachingClassMembershipTerminalStatus = "rejected" | "removed";

export type TeachingClassMembershipBulkApprovalResult = {
  memberships: TeachingClassMembershipRecord[];
  approvedMembershipIds: string[];
  alreadyApprovedMembershipIds: string[];
  // Named ids that exist in the class but cannot be approved because the teacher
  // already closed them. Approving a removed student is not a no-op the caller
  // should be able to mistake for success - they have to re-join.
  ineligibleMembershipIds: string[];
  approvedCount: number;
  classItem: TeachingClassRecord;
  course: TeachingCourseRecord;
  receipt: TeachingCourseManagementReceipt;
};

export async function approveTeachingClassMemberships(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  classId: string;
  // Omitted means "every membership of this class that is waiting for review",
  // which is the whole point of the route: a teacher who has read the list
  // should not have to name 200 ids back to the server.
  membershipIds?: string[];
  traceId?: string;
  now?: Date;
  audit?: MembershipMutationAudit;
}): Promise<TeachingClassMembershipBulkApprovalResult> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const classId = requireSafeId(input.classId, "class id");
  const membershipIds = input.membershipIds?.map((membershipId) =>
    requireSafeId(membershipId, "membership id"),
  );
  const now = input.now ?? new Date();
  const approvedAt = now.toISOString();
  // Same discovery the single approval uses: the route addresses a class, and the
  // per-course rows can only be read once the owning course is known. A class
  // never changes course, so this cannot go stale inside the loop.
  const courseId = await resolveTeachingClassCourseId({
    dataDir,
    repository: input.repository,
    find: (database) => database.classes.find((item) => item.classId === classId),
    notFoundMessage: "Teaching class was not found.",
  });

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
    });
    const database = snapshot.database;
    const { classIndex, classItem, courseIndex } = requireOwnedClassContext(
      database,
      classId,
      actorId,
    );

    const targeted = selectTargetedMemberships(database, { classId, membershipIds });
    const approvedMembershipIds: string[] = [];
    const alreadyApprovedMembershipIds: string[] = [];
    const ineligibleMembershipIds: string[] = [];
    const memberships: TeachingClassMembershipRecord[] = [];

    for (const membershipIndex of targeted) {
      const membership = database.memberships[membershipIndex];
      if (membership.membershipStatus === "approved") {
        alreadyApprovedMembershipIds.push(membership.membershipId);
        memberships.push(membership);
        continue;
      }
      if (membership.membershipStatus !== "pending-teacher-review") {
        ineligibleMembershipIds.push(membership.membershipId);
        memberships.push(membership);
        continue;
      }

      const approvedMembership: TeachingClassMembershipRecord = {
        ...membership,
        membershipStatus: "approved",
        approvedAt,
        approvedByTeacherId: actorId,
      };
      database.memberships[membershipIndex] = approvedMembership;
      approvedMembershipIds.push(approvedMembership.membershipId);
      memberships.push(approvedMembership);
    }

    const receipt = createReceipt({
      action: "approve-class-memberships",
      actorId,
      courseId: classItem.courseId,
      classId,
      traceId: input.traceId,
      createdAt: approvedAt,
      authSession: input.audit?.authSession,
      storage,
    });
    // Nothing moved: answer the same receipt shape without touching the row.
    // Re-running an already-applied bulk approval must not burn a revision that
    // a concurrent join is waiting on.
    if (approvedMembershipIds.length === 0) {
      return {
        memberships,
        approvedMembershipIds,
        alreadyApprovedMembershipIds,
        ineligibleMembershipIds,
        approvedCount: 0,
        classItem,
        course: database.courses[courseIndex],
        receipt,
      };
    }

    const updatedClass: TeachingClassRecord = {
      ...classItem,
      students: countApprovedMembershipsForClass(database, classId),
      updatedAt: approvedAt,
    };
    database.classes[classIndex] = updatedClass;
    const updatedCourse: TeachingCourseRecord = {
      ...database.courses[courseIndex],
      students: countApprovedStudentsForCourse(database, classItem.courseId),
      updatedAt: approvedAt,
    };
    database.courses[courseIndex] = updatedCourse;

    database.auditEvents.push(
      createAuditEvent({
        action: "approve-class-memberships",
        actorId,
        courseId: classItem.courseId,
        classId,
        traceId: receipt.traceId,
        createdAt: approvedAt,
        affectedRecordCount: approvedMembershipIds.length,
        requestSource: input.audit?.requestSource,
        authSession: input.audit?.authSession,
        storage,
      }),
    );
    database.updatedAt = approvedAt;

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return {
        memberships,
        approvedMembershipIds,
        alreadyApprovedMembershipIds,
        ineligibleMembershipIds,
        approvedCount: approvedMembershipIds.length,
        classItem: updatedClass,
        course: updatedCourse,
        receipt,
      };
    } catch (error) {
      if (input.repository && (await writeRetry.shouldRetry({ attempt, error }))) {
        continue;
      }
      // A conflict that survives the ladder is exhausted contention, not a
      // caller mistake: answer with the structured 409 rather than passing the
      // backend's own revision-mismatch prose through. The local file path has no
      // revisions and never lands here.
      throw input.repository && writeRetry.isConflict(error)
        ? createTeachingCourseManagementContentionError()
        : error;
    }
  }

  throw createTeachingCourseManagementContentionError();
}

// Reject a pending request, or remove an approved student.
//
// Removal frees the seat in the SAME write that closes the membership: a student
// who is no longer on the roster but still sits in a learning group keeps a
// chatroom they can no longer legitimately read, and the group's authorization
// gate reads the group record. Doing it in a second write would leave that
// window open for as long as the second write took - or forever, if it failed.
export async function setTeachingClassMembershipStatus(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  classId: string;
  membershipId: string;
  membershipStatus: TeachingClassMembershipTerminalStatus;
  traceId?: string;
  now?: Date;
  audit?: MembershipMutationAudit;
}): Promise<{
  membership: TeachingClassMembershipRecord;
  classItem: TeachingClassRecord;
  course: TeachingCourseRecord;
  releasedGroupIds: string[];
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const classId = requireSafeId(input.classId, "class id");
  const membershipId = requireSafeId(input.membershipId, "membership id");
  const membershipStatus = input.membershipStatus;
  const action =
    membershipStatus === "rejected" ? "reject-class-membership" : "remove-class-membership";
  const now = input.now ?? new Date();
  const changedAt = now.toISOString();
  const courseId = await resolveTeachingClassCourseId({
    dataDir,
    repository: input.repository,
    find: (database) => database.classes.find((item) => item.classId === classId),
    notFoundMessage: "Teaching class was not found.",
  });

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
    });
    const database = snapshot.database;
    const { classIndex, classItem, courseIndex } = requireOwnedClassContext(
      database,
      classId,
      actorId,
    );

    const membershipIndex = database.memberships.findIndex(
      (membership) => membership.membershipId === membershipId && membership.classId === classId,
    );
    if (membershipIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching class membership was not found.",
      );
    }

    const existingMembership = database.memberships[membershipIndex];
    if (existingMembership.membershipStatus === membershipStatus) {
      return {
        membership: existingMembership,
        classItem,
        course: database.courses[courseIndex],
        releasedGroupIds: [],
        receipt: createReceipt({
          action,
          actorId,
          courseId: classItem.courseId,
          classId,
          traceId: input.traceId,
          createdAt: existingMembership.statusChangedAt ?? changedAt,
          authSession: input.audit?.authSession,
          storage,
        }),
      };
    }
    assertMembershipTransition(existingMembership, membershipStatus);

    const membership: TeachingClassMembershipRecord = {
      ...existingMembership,
      membershipStatus,
      statusChangedAt: changedAt,
      statusChangedByTeacherId: actorId,
    };
    database.memberships[membershipIndex] = membership;

    // A group may drop below the 2-member floor here. That is deliberate: the
    // floor governs what a teacher may ASSIGN, and silently deleting a group
    // because one student left would destroy the other members' room.
    const releasedGroupIds = releaseStudentFromLearningGroups(database, {
      courseId: classItem.courseId,
      studentId: membership.studentId,
      updatedAt: changedAt,
    });

    const updatedClass: TeachingClassRecord = {
      ...classItem,
      students: countApprovedMembershipsForClass(database, classId),
      updatedAt: changedAt,
    };
    database.classes[classIndex] = updatedClass;
    const updatedCourse: TeachingCourseRecord = {
      ...database.courses[courseIndex],
      students: countApprovedStudentsForCourse(database, classItem.courseId),
      updatedAt: changedAt,
    };
    database.courses[courseIndex] = updatedCourse;

    const receipt = createReceipt({
      action,
      actorId,
      courseId: classItem.courseId,
      classId,
      traceId: input.traceId,
      createdAt: changedAt,
      authSession: input.audit?.authSession,
      storage,
    });
    database.auditEvents.push(
      createAuditEvent({
        action,
        actorId,
        courseId: classItem.courseId,
        classId,
        traceId: receipt.traceId,
        createdAt: changedAt,
        requestSource: input.audit?.requestSource,
        authSession: input.audit?.authSession,
        storage,
      }),
    );
    database.updatedAt = changedAt;

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return {
        membership,
        classItem: updatedClass,
        course: updatedCourse,
        releasedGroupIds,
        receipt,
      };
    } catch (error) {
      if (input.repository && (await writeRetry.shouldRetry({ attempt, error }))) {
        continue;
      }
      // A conflict that survives the ladder is exhausted contention, not a
      // caller mistake: answer with the structured 409 rather than passing the
      // backend's own revision-mismatch prose through. The local file path has no
      // revisions and never lands here.
      throw input.repository && writeRetry.isConflict(error)
        ? createTeachingCourseManagementContentionError()
        : error;
    }
  }

  throw createTeachingCourseManagementContentionError();
}

// `rejected` answers a request that is still waiting; `removed` takes an
// approved student off the roster. Anything else - removing a pending request,
// rejecting an approved student, reopening a closed row - is refused rather than
// guessed at: the student re-joins to reopen, which is a decision the teacher can
// see rather than one this handler makes for them.
function assertMembershipTransition(
  membership: TeachingClassMembershipRecord,
  membershipStatus: TeachingClassMembershipTerminalStatus,
) {
  const allowedFrom =
    membershipStatus === "rejected" ? "pending-teacher-review" : "approved";
  if (membership.membershipStatus !== allowedFrom) {
    throw new TeachingCourseManagementStoreError(
      409,
      membershipStatus === "rejected"
        ? "Teaching class membership can only be rejected while it waits for review."
        : "Teaching class membership can only be removed once it is approved.",
      { membershipStatus: membership.membershipStatus },
      "membership-transition-not-allowed",
    );
  }
}

function releaseStudentFromLearningGroups(
  database: TeachingCourseManagementDatabase,
  input: { courseId: string; studentId: string; updatedAt: string },
) {
  const learningGroups = database.learningGroups;
  if (!learningGroups) {
    return [];
  }

  const releasedGroupIds: string[] = [];
  database.learningGroups = learningGroups.map((group) => {
    if (
      group.courseId !== input.courseId ||
      !group.members.some((member) => member.studentId === input.studentId)
    ) {
      return group;
    }
    releasedGroupIds.push(group.groupId);
    return {
      ...group,
      members: group.members.filter((member) => member.studentId !== input.studentId),
      updatedAt: input.updatedAt,
    };
  });
  return releasedGroupIds;
}

function selectTargetedMemberships(
  database: TeachingCourseManagementDatabase,
  input: { classId: string; membershipIds?: string[] },
) {
  if (!input.membershipIds) {
    return database.memberships.flatMap((membership, membershipIndex) =>
      membership.classId === input.classId &&
      membership.membershipStatus === "pending-teacher-review"
        ? [membershipIndex]
        : [],
    );
  }

  // A named id that is not in this class is a caller mistake, not a row to skip:
  // approving "everything I listed" must never quietly approve less than that.
  // Duplicates in the list are collapsed first, or the second copy would report
  // itself as "already approved" by the first.
  return [...new Set(input.membershipIds)].map((membershipId) => {
    const membershipIndex = database.memberships.findIndex(
      (membership) =>
        membership.membershipId === membershipId && membership.classId === input.classId,
    );
    if (membershipIndex < 0) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching class membership was not found.",
      );
    }
    return membershipIndex;
  });
}

function requireOwnedClassContext(
  database: TeachingCourseManagementDatabase,
  classId: string,
  actorId: string,
) {
  const classIndex = database.classes.findIndex((item) => item.classId === classId);
  if (classIndex < 0) {
    throw new TeachingCourseManagementStoreError(404, "Teaching class was not found.");
  }
  const classItem = database.classes[classIndex];
  if (classItem.ownerTeacherId !== actorId) {
    throw new TeachingCourseManagementStoreError(403, "Teaching class ownership is required.");
  }
  const courseIndex = database.courses.findIndex((item) => item.courseId === classItem.courseId);
  if (courseIndex < 0) {
    throw new TeachingCourseManagementStoreError(500, "Teaching class course is missing.");
  }
  return { classIndex, classItem, courseIndex };
}
