import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import {
  createRedaction,
  isRecord,
  requireSafeId,
  requireTrimmedString,
} from "./teaching-course-management-guards";
import {
  createAuditEvent,
  createReceipt,
  formatTimestampId,
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
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementAuthSessionSummary,
  TeachingCourseManagementDatabase,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementRepository,
  TeachingCourseManagementStorageDescriptor,
  TeachingLearningGroupDraftInput,
  TeachingLearningGroupMember,
  TeachingLearningGroupMemberInput,
  TeachingLearningGroupRecord,
} from "@/lib/server/teaching-course-management-types";

// Learning-group handler family for the teaching-course-management store
// (chatroom groups, Phase 1 / plan D1): create, replace members, rename, delete.
// Each handler reads the snapshot, validates teacher course ownership AND that
// every member holds an approved membership in the course (and class when the
// group is class-scoped), mutates, appends exactly one audit event, and writes
// atomically with the same optimistic-retry loop the sibling handler families use.
// Cycle-free: runtime deps are the extracted io/helpers/guards/error modules;
// store types are a type-only import.

export const teachingLearningGroupMinMembers = 2;
export const teachingLearningGroupMaxMembers = 12;

const teachingLearningGroupNameMaxLength = 120;

export type TeachingLearningGroupValidationReasonCode =
  | "group-name-required"
  | "group-members-required"
  | "group-members-below-minimum"
  | "group-members-above-maximum"
  | "group-member-duplicate"
  | "group-member-invalid"
  | "group-member-not-approved"
  | "group-member-already-grouped"
  | "group-size-invalid"
  | "auto-split-no-eligible-students";

export type TeachingLearningGroupValidation = {
  target: "teaching-learning-group";
  status: "invalid";
  reasonCode: TeachingLearningGroupValidationReasonCode;
  field: "groupName" | "members" | "groupSize";
  minMembers?: number;
  maxMembers?: number;
  memberIndex?: number;
  // Set only by the cross-group gate, which has to name the student AND the
  // group already holding them: "someone is double-booked" is not an answer a
  // teacher can act on. Both values are already teacher-visible on the group
  // records this caller owns.
  studentId?: string;
  conflictingGroupId?: string;
  conflictingGroupName?: string;
  eligibleStudentCount?: number;
  responsibleSession: "S12";
  redaction: ReturnType<typeof createRedaction>;
};

// One student, one group, per course. A student in two groups is in two shared
// chatrooms with two different sets of co-members, which is not a state the
// group workspace or the room's authorization gate has any way to express.
export type TeachingLearningGroupSplitCandidate = {
  studentId: string;
  studentDisplayName: string;
};

type LearningGroupMutationAudit = {
  requestSource?: TeachingCourseManagementAuditRequestSource;
  authSession?: TeachingCourseManagementAuthSessionSummary;
};

export function createTeachingLearningGroupId(groupName: string, now: Date) {
  const slug = createLearningGroupSlug(groupName) || "learning";
  return `group-${slug}-${formatTimestampId(now)}`;
}

export async function createTeachingLearningGroupRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  draft: TeachingLearningGroupDraftInput;
  traceId?: string;
  now?: Date;
  audit?: LearningGroupMutationAudit;
}): Promise<{
  group: TeachingLearningGroupRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const groupName = requireLearningGroupName(input.draft.groupName);
  const classId = input.draft.classId
    ? requireSafeId(input.draft.classId, "class id")
    : undefined;
  const memberIds = requireLearningGroupMemberIds(input.draft.members);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const groupId = createTeachingLearningGroupId(groupName, now);

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
    });
    const database = snapshot.database;
    requireOwnedCourse(database, courseId, actorId);
    if (classId) {
      requireOwnedClass(database, courseId, classId, actorId);
    }

    const learningGroups = database.learningGroups ?? [];
    if (learningGroups.some((item) => item.groupId === groupId)) {
      throw new TeachingCourseManagementStoreError(
        409,
        "Teaching learning group already exists.",
      );
    }

    const group: TeachingLearningGroupRecord = {
      groupId,
      courseId,
      ...(classId ? { classId } : {}),
      ownerTeacherId: actorId,
      groupName,
      members: resolveApprovedLearningGroupMembers({
        database,
        courseId,
        classId,
        memberIds,
        addedAt: createdAt,
      }),
      createdAt,
      updatedAt: createdAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.learningGroups = [...learningGroups, group];

    const receipt = appendLearningGroupMutation({
      database,
      action: "create-learning-group",
      actorId,
      courseId,
      classId,
      traceId: input.traceId,
      createdAt,
      audit: input.audit,
      storage,
    });

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return { group, receipt };
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

// "Split everyone who is approved and not yet in a group into groups of K."
//
// This is the handler the 200-student case actually needs: at that size a
// teacher assigning members group by group is 20+ round trips, each one racing
// the others for the same course row. One read, one partition, one write, one
// audit event.
export async function autoSplitTeachingLearningGroups(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  classId?: string;
  groupSize: number;
  traceId?: string;
  now?: Date;
  audit?: LearningGroupMutationAudit;
}): Promise<{
  groups: TeachingLearningGroupRecord[];
  ungroupedStudentCount: number;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const classId = input.classId ? requireSafeId(input.classId, "class id") : undefined;
  const groupSize = requireLearningGroupSize(input.groupSize);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
    });
    const database = snapshot.database;
    requireOwnedCourse(database, courseId, actorId);
    if (classId) {
      requireOwnedClass(database, courseId, classId, actorId);
    }

    const candidates = selectUngroupedApprovedStudents(database, { courseId, classId });
    if (candidates.length < teachingLearningGroupMinMembers) {
      throw createLearningGroupValidationError(
        `Teaching learning group auto-split requires at least ${teachingLearningGroupMinMembers} ungrouped approved students.`,
        "auto-split-no-eligible-students",
        "members",
        { eligibleStudentCount: candidates.length },
      );
    }

    const learningGroups = database.learningGroups ?? [];
    const partitions = partitionTeachingLearningGroupCandidates(candidates, groupSize);
    let nextGroupIndex = readNextAutoSplitGroupIndex(learningGroups, courseId);
    const groups = partitions.map((partition, partitionIndex) => {
      const groupName = `第${nextGroupIndex}组`;
      nextGroupIndex += 1;
      return {
        // Every group in one batch shares `now`, so the timestamp alone cannot
        // separate their ids; the partition index does.
        groupId: `${createTeachingLearningGroupId(groupName, now)}-${partitionIndex + 1}`,
        courseId,
        ...(classId ? { classId } : {}),
        ownerTeacherId: actorId,
        groupName,
        members: partition.map((candidate) => ({
          studentId: candidate.studentId,
          studentDisplayName: candidate.studentDisplayName,
          addedAt: createdAt,
        })),
        createdAt,
        updatedAt: createdAt,
        storagePolicy: storage.recordStoragePolicy,
        storageWritePolicy: storage.storageWritePolicy,
        responsibleSession: "S12" as const,
        redaction: createRedaction(),
      } satisfies TeachingLearningGroupRecord;
    });
    database.learningGroups = [...learningGroups, ...groups];

    const receipt = appendLearningGroupMutation({
      database,
      action: "auto-split-learning-groups",
      actorId,
      courseId,
      classId,
      traceId: input.traceId,
      createdAt,
      affectedRecordCount: groups.length,
      audit: input.audit,
      storage,
    });

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return {
        groups,
        // Every candidate lands in a group, so this is 0 today. It is reported
        // anyway because the fold rule below is the only thing keeping it there.
        ungroupedStudentCount:
          candidates.length - groups.reduce((total, group) => total + group.members.length, 0),
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

// Approved students of the course (optionally narrowed to one class) who are not
// already a member of any group in that course, in join order. Shared with the
// suggestion receipt, which proposes exactly what a split would do.
export function selectUngroupedApprovedStudents(
  database: TeachingCourseManagementDatabase,
  scope: { courseId: string; classId?: string },
): TeachingLearningGroupSplitCandidate[] {
  const groupedStudentIds = new Set(
    (database.learningGroups ?? [])
      .filter((group) => group.courseId === scope.courseId)
      .flatMap((group) => group.members.map((member) => member.studentId)),
  );
  return database.memberships
    .filter(
      (membership) =>
        membership.courseId === scope.courseId &&
        membership.membershipStatus === "approved" &&
        (scope.classId ? membership.classId === scope.classId : true) &&
        !groupedStudentIds.has(membership.studentId),
    )
    .sort((left, right) =>
      left.joinedAt === right.joinedAt
        ? left.studentId.localeCompare(right.studentId)
        : left.joinedAt.localeCompare(right.joinedAt),
    )
    .map((membership) => ({
      studentId: membership.studentId,
      studentDisplayName: membership.studentDisplayName,
    }));
}

// Chunks of `groupSize`, except that a trailing chunk of ONE is never left
// standing: a group of one is below the 2-member floor and is a person sitting
// alone in a chatroom. It folds into the previous group instead. When the size
// is already at the 12-member ceiling and folding would overflow it, the
// previous group lends a member downwards instead, which lands on 11 + 2 - both
// inside the bounds.
export function partitionTeachingLearningGroupCandidates<T>(
  candidates: T[],
  groupSize: number,
): T[][] {
  const partitions: T[][] = [];
  for (let index = 0; index < candidates.length; index += groupSize) {
    partitions.push(candidates.slice(index, index + groupSize));
  }

  const last = partitions[partitions.length - 1];
  const previous = partitions[partitions.length - 2];
  if (last && previous && last.length === 1) {
    if (previous.length + 1 <= teachingLearningGroupMaxMembers) {
      previous.push(...last);
      partitions.pop();
    } else {
      last.unshift(previous.pop() as T);
    }
  }
  return partitions;
}

export async function updateTeachingLearningGroupMembers(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  groupId: string;
  members: TeachingLearningGroupMemberInput[];
  traceId?: string;
  now?: Date;
  audit?: LearningGroupMutationAudit;
}): Promise<{
  group: TeachingLearningGroupRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const groupId = requireSafeId(input.groupId, "learning group id");
  const memberIds = requireLearningGroupMemberIds(input.members);
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
    });
    const database = snapshot.database;
    requireOwnedCourse(database, courseId, actorId);
    const { learningGroups, groupIndex, group } = requireOwnedLearningGroup(
      database,
      courseId,
      groupId,
      actorId,
    );

    const nextGroup: TeachingLearningGroupRecord = {
      ...group,
      members: resolveApprovedLearningGroupMembers({
        database,
        courseId,
        classId: group.classId,
        memberIds,
        addedAt: updatedAt,
        // Members who survive a replace keep their original assignment stamp; only
        // newly added members are stamped with this mutation's timestamp.
        previousMembers: group.members,
        groupId,
      }),
      updatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.learningGroups = learningGroups.map((item, index) =>
      index === groupIndex ? nextGroup : item,
    );

    const receipt = appendLearningGroupMutation({
      database,
      action: "update-learning-group-members",
      actorId,
      courseId,
      classId: group.classId,
      traceId: input.traceId,
      createdAt: updatedAt,
      audit: input.audit,
      storage,
    });

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return { group: nextGroup, receipt };
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

export async function renameTeachingLearningGroup(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  groupId: string;
  groupName: string;
  traceId?: string;
  now?: Date;
  audit?: LearningGroupMutationAudit;
}): Promise<{
  group: TeachingLearningGroupRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const groupId = requireSafeId(input.groupId, "learning group id");
  const groupName = requireLearningGroupName(input.groupName);
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
    });
    const database = snapshot.database;
    requireOwnedCourse(database, courseId, actorId);
    const { learningGroups, groupIndex, group } = requireOwnedLearningGroup(
      database,
      courseId,
      groupId,
      actorId,
    );

    const nextGroup: TeachingLearningGroupRecord = {
      ...group,
      groupName,
      updatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.learningGroups = learningGroups.map((item, index) =>
      index === groupIndex ? nextGroup : item,
    );

    const receipt = appendLearningGroupMutation({
      database,
      action: "rename-learning-group",
      actorId,
      courseId,
      classId: group.classId,
      traceId: input.traceId,
      createdAt: updatedAt,
      audit: input.audit,
      storage,
    });

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return { group: nextGroup, receipt };
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

export async function deleteTeachingLearningGroup(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  groupId: string;
  traceId?: string;
  now?: Date;
  audit?: LearningGroupMutationAudit;
}): Promise<{
  group: TeachingLearningGroupRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const groupId = requireSafeId(input.groupId, "learning group id");
  const now = input.now ?? new Date();
  const deletedAt = now.toISOString();

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
    });
    const database = snapshot.database;
    requireOwnedCourse(database, courseId, actorId);
    const { learningGroups, group } = requireOwnedLearningGroup(
      database,
      courseId,
      groupId,
      actorId,
    );

    // The group's chatroom transcript is deliberately NOT deleted here: it is
    // retained server-side and simply orphaned, because the room's authorization
    // gate reads the group record and fails closed once the group is gone.
    database.learningGroups = learningGroups.filter((item) => item.groupId !== groupId);

    const receipt = appendLearningGroupMutation({
      database,
      action: "delete-learning-group",
      actorId,
      courseId,
      classId: group.classId,
      traceId: input.traceId,
      createdAt: deletedAt,
      audit: input.audit,
      storage,
    });

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return { group, receipt };
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

export function readTeachingLearningGroupValidation(
  error: unknown,
): TeachingLearningGroupValidation | undefined {
  if (!(error instanceof TeachingCourseManagementStoreError)) {
    return undefined;
  }
  const validation = error.diagnostics?.validation;
  if (
    !isRecord(validation) ||
    validation.target !== "teaching-learning-group" ||
    validation.status !== "invalid" ||
    typeof validation.reasonCode !== "string" ||
    typeof validation.field !== "string"
  ) {
    return undefined;
  }
  return validation as TeachingLearningGroupValidation;
}

function appendLearningGroupMutation(input: {
  database: TeachingCourseManagementDatabase;
  action:
    | "create-learning-group"
    | "auto-split-learning-groups"
    | "update-learning-group-members"
    | "rename-learning-group"
    | "delete-learning-group";
  actorId: string;
  courseId: string;
  classId?: string;
  traceId?: string;
  createdAt: string;
  // Set by the split, which writes several groups under one action.
  affectedRecordCount?: number;
  audit?: LearningGroupMutationAudit;
  storage: TeachingCourseManagementStorageDescriptor;
}) {
  const receipt = createReceipt({
    action: input.action,
    actorId: input.actorId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    traceId: input.traceId,
    createdAt: input.createdAt,
    authSession: input.audit?.authSession,
    storage: input.storage,
  });
  const auditEvent = createAuditEvent({
    action: input.action,
    actorId: input.actorId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    traceId: receipt.traceId,
    createdAt: input.createdAt,
    ...(input.affectedRecordCount === undefined
      ? {}
      : { affectedRecordCount: input.affectedRecordCount }),
    requestSource: input.audit?.requestSource,
    authSession: input.audit?.authSession,
    storage: input.storage,
  });
  input.database.auditEvents.push(auditEvent);
  input.database.updatedAt = input.createdAt;
  return receipt;
}

function requireOwnedCourse(
  database: TeachingCourseManagementDatabase,
  courseId: string,
  actorId: string,
) {
  const course = database.courses.find((item) => item.courseId === courseId);
  if (!course) {
    throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
  }
  if (course.ownerTeacherId !== actorId) {
    throw new TeachingCourseManagementStoreError(403, "Teaching course ownership is required.");
  }
  return course;
}

function requireOwnedClass(
  database: TeachingCourseManagementDatabase,
  courseId: string,
  classId: string,
  actorId: string,
) {
  const classItem = database.classes.find(
    (item) => item.classId === classId && item.courseId === courseId,
  );
  if (!classItem) {
    throw new TeachingCourseManagementStoreError(404, "Teaching class was not found.");
  }
  if (classItem.ownerTeacherId !== actorId) {
    throw new TeachingCourseManagementStoreError(403, "Teaching class ownership is required.");
  }
  return classItem;
}

function requireOwnedLearningGroup(
  database: TeachingCourseManagementDatabase,
  courseId: string,
  groupId: string,
  actorId: string,
) {
  const learningGroups = database.learningGroups ?? [];
  const groupIndex = learningGroups.findIndex(
    (item) => item.groupId === groupId && item.courseId === courseId,
  );
  if (groupIndex < 0) {
    throw new TeachingCourseManagementStoreError(404, "Teaching learning group was not found.");
  }
  const group = learningGroups[groupIndex];
  if (group.ownerTeacherId !== actorId) {
    throw new TeachingCourseManagementStoreError(
      403,
      "Teaching learning group ownership is required.",
    );
  }
  return { learningGroups, groupIndex, group };
}

function resolveApprovedLearningGroupMembers(input: {
  database: TeachingCourseManagementDatabase;
  courseId: string;
  classId?: string;
  memberIds: string[];
  addedAt: string;
  previousMembers?: TeachingLearningGroupMember[];
  // The group being written, so a member replacement does not report the group
  // against itself.
  groupId?: string;
}): TeachingLearningGroupMember[] {
  return input.memberIds.map((studentId, memberIndex) => {
    const conflictingGroup = (input.database.learningGroups ?? []).find(
      (group) =>
        group.courseId === input.courseId &&
        group.groupId !== input.groupId &&
        group.members.some((member) => member.studentId === studentId),
    );
    if (conflictingGroup) {
      throw createLearningGroupValidationError(
        "Teaching learning group member already belongs to another group in this course.",
        "group-member-already-grouped",
        "members",
        {
          memberIndex,
          studentId,
          conflictingGroupId: conflictingGroup.groupId,
          conflictingGroupName: conflictingGroup.groupName,
        },
      );
    }
    // The display name is snapshotted from the approved membership row, never
    // from the request body: this list is projected to co-members of the group.
    const membership = input.database.memberships.find(
      (item) =>
        item.studentId === studentId &&
        item.courseId === input.courseId &&
        item.membershipStatus === "approved" &&
        (input.classId ? item.classId === input.classId : true),
    );
    if (!membership) {
      throw createLearningGroupValidationError(
        "Teaching learning group member must hold an approved course membership.",
        "group-member-not-approved",
        "members",
        { memberIndex },
      );
    }
    const previousMember = input.previousMembers?.find(
      (item) => item.studentId === studentId,
    );
    return {
      studentId,
      studentDisplayName: requireTrimmedString(
        membership.studentDisplayName,
        "student display name",
        teachingLearningGroupNameMaxLength,
      ),
      addedAt: previousMember?.addedAt ?? input.addedAt,
    };
  });
}

function requireLearningGroupName(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw createLearningGroupValidationError(
      "Teaching learning group name is required.",
      "group-name-required",
      "groupName",
    );
  }
  return requireTrimmedString(value, "learning group name", teachingLearningGroupNameMaxLength);
}

function requireLearningGroupMemberIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw createLearningGroupValidationError(
      "Teaching learning group members are required.",
      "group-members-required",
      "members",
    );
  }
  if (value.length < teachingLearningGroupMinMembers) {
    throw createLearningGroupValidationError(
      `Teaching learning group requires at least ${teachingLearningGroupMinMembers} members.`,
      "group-members-below-minimum",
      "members",
      { minMembers: teachingLearningGroupMinMembers },
    );
  }
  if (value.length > teachingLearningGroupMaxMembers) {
    throw createLearningGroupValidationError(
      `Teaching learning group allows at most ${teachingLearningGroupMaxMembers} members.`,
      "group-members-above-maximum",
      "members",
      { maxMembers: teachingLearningGroupMaxMembers },
    );
  }

  const memberIds: string[] = [];
  const seenMemberIds = new Set<string>();
  value.forEach((member, memberIndex) => {
    const studentId = readLearningGroupMemberId(member, memberIndex);
    if (seenMemberIds.has(studentId)) {
      throw createLearningGroupValidationError(
        "Teaching learning group members must be unique.",
        "group-member-duplicate",
        "members",
        { memberIndex },
      );
    }
    seenMemberIds.add(studentId);
    memberIds.push(studentId);
  });
  return memberIds;
}

function readLearningGroupMemberId(value: unknown, memberIndex: number) {
  const rawStudentId = isRecord(value) ? value.studentId : value;
  if (typeof rawStudentId !== "string" || !rawStudentId.trim()) {
    throw createLearningGroupValidationError(
      "Teaching learning group member id is invalid.",
      "group-member-invalid",
      "members",
      { memberIndex },
    );
  }
  try {
    return requireSafeId(rawStudentId.trim(), "student id");
  } catch {
    throw createLearningGroupValidationError(
      "Teaching learning group member id is invalid.",
      "group-member-invalid",
      "members",
      { memberIndex },
    );
  }
}

function requireLearningGroupSize(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < teachingLearningGroupMinMembers ||
    value > teachingLearningGroupMaxMembers
  ) {
    throw createLearningGroupValidationError(
      `Teaching learning group size must be between ${teachingLearningGroupMinMembers} and ${teachingLearningGroupMaxMembers}.`,
      "group-size-invalid",
      "groupSize",
      {
        minMembers: teachingLearningGroupMinMembers,
        maxMembers: teachingLearningGroupMaxMembers,
      },
    );
  }
  return value;
}

// Continues the 第N组 series the course already uses rather than restarting at 1,
// so a second split does not mint a second 第1组 beside the first.
function readNextAutoSplitGroupIndex(
  learningGroups: TeachingLearningGroupRecord[],
  courseId: string,
) {
  return (
    learningGroups
      .filter((group) => group.courseId === courseId)
      .reduce((highest, group) => {
        const matched = /^第(\d{1,4})组$/.exec(group.groupName);
        return matched ? Math.max(highest, Number(matched[1])) : highest;
      }, 0) + 1
  );
}

function createLearningGroupValidationError(
  message: string,
  reasonCode: TeachingLearningGroupValidationReasonCode,
  field: TeachingLearningGroupValidation["field"],
  options: {
    minMembers?: number;
    maxMembers?: number;
    memberIndex?: number;
    studentId?: string;
    conflictingGroupId?: string;
    conflictingGroupName?: string;
    eligibleStudentCount?: number;
  } = {},
) {
  const validation: TeachingLearningGroupValidation = {
    target: "teaching-learning-group",
    status: "invalid",
    reasonCode,
    field,
    ...(options.minMembers === undefined ? {} : { minMembers: options.minMembers }),
    ...(options.maxMembers === undefined ? {} : { maxMembers: options.maxMembers }),
    ...(options.memberIndex === undefined ? {} : { memberIndex: options.memberIndex }),
    ...(options.studentId === undefined ? {} : { studentId: options.studentId }),
    ...(options.conflictingGroupId === undefined
      ? {}
      : { conflictingGroupId: options.conflictingGroupId }),
    ...(options.conflictingGroupName === undefined
      ? {}
      : { conflictingGroupName: options.conflictingGroupName }),
    ...(options.eligibleStudentCount === undefined
      ? {}
      : { eligibleStudentCount: options.eligibleStudentCount }),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
  return new TeachingCourseManagementStoreError(400, message, { validation });
}

function createLearningGroupSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
