import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import {
  createRedaction,
  requireInviteCode,
  requireSafeId,
  requireTrimmedString,
} from "./teaching-course-management-guards";
import {
  countApprovedMembershipsForClass,
  countApprovedStudentsForCourse,
  countInviteCodeJoins,
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
  TeachingClassInviteCodeDraftRecord,
  TeachingClassJoinInput,
  TeachingClassMembershipRecord,
  TeachingClassRecord,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementAuthSessionSummary,
  TeachingCourseManagementDatabase,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementRepository,
  TeachingCourseRecord,
} from "@/lib/server/teaching-course-management-types";

// Class-management + course-creation-rollback handler family for the
// teaching-course-management store (Phase 3 decomposition): rollback course
// creation, invite-code draft/publish/target, class join, membership approval.
// Cycle-free: runtime deps are the extracted io/helpers/guards/error modules; store
// types are a type-only import.

// Why a join can be refused, in a form the join UI can branch on without reading
// English. `not-found` keeps its own 404 shape; these three are 403s about a code
// that exists and is simply not usable right now, which is a different sentence
// for the student than "that code does not exist".
export type TeachingClassInviteJoinRefusalReasonCode =
  | "invite-code-disabled"
  | "invite-code-expired"
  | "invite-code-capacity-reached";

// The teacher-settable half of an invite code. Every field is optional and an
// omitted field means "leave as it is"; `null` clears one back to open.
export type TeachingClassInviteCodePolicyInput = {
  expiresAt?: string | null;
  maxJoins?: number | null;
  disabled?: boolean | null;
};

export async function rollbackTeachingCourseCreation(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  traceId: string;
  rolledBackAt?: string;
}) {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir,
    repository: input.repository,
    courseId,
  });
  const database = snapshot.database;
  const rolledBackAt = input.rolledBackAt ?? new Date().toISOString();
  const nextDatabase: TeachingCourseManagementDatabase = {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: rolledBackAt,
    courses: database.courses.filter(
      (course) => !(course.courseId === courseId && course.ownerTeacherId === actorId),
    ),
    classes: database.classes.filter((classItem) => classItem.courseId !== courseId),
    memberships: database.memberships.filter((membership) => membership.courseId !== courseId),
    ...(database.inviteCodeDrafts
      ? {
          inviteCodeDrafts: database.inviteCodeDrafts.filter(
            (draft) => draft.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.courseSettings
      ? {
          courseSettings: database.courseSettings.filter(
            (settings) => settings.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.studentPreviewSessions
      ? {
          studentPreviewSessions: database.studentPreviewSessions.filter(
            (session) => session.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.studentRosters
      ? {
          studentRosters: database.studentRosters.filter(
            (roster) => roster.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.studentGroupSuggestions
      ? {
          studentGroupSuggestions: database.studentGroupSuggestions.filter(
            (suggestion) => suggestion.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.learningGroups
      ? {
          learningGroups: database.learningGroups.filter(
            (group) => group.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.knowledgeIndexes
      ? {
          knowledgeIndexes: database.knowledgeIndexes.filter(
            (index) => index.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.resourceReviewItems
      ? {
          resourceReviewItems: database.resourceReviewItems.filter(
            (item) => item.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.contentPackages
      ? {
          contentPackages: database.contentPackages.filter(
            (content) => content.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.courseUnitDrafts
      ? {
          courseUnitDrafts: database.courseUnitDrafts.filter(
            (draft) => draft.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.dashboardStates
      ? {
          dashboardStates: database.dashboardStates.filter(
            (state) => state.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.dashboardSnapshots
      ? {
          dashboardSnapshots: database.dashboardSnapshots.filter(
            (snapshot) => snapshot.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.quizAssessments
      ? {
          quizAssessments: database.quizAssessments.filter(
            (assessment) => assessment.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.quizItemReviews
      ? {
          quizItemReviews: database.quizItemReviews.filter(
            (review) => review.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.agentSettings
      ? {
          agentSettings: database.agentSettings.filter(
            (settings) => settings.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.agentPermissionPreflights
      ? {
          agentPermissionPreflights: database.agentPermissionPreflights.filter(
            (preflight) => preflight.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.adminSettings
      ? {
          adminSettings: database.adminSettings.filter(
            (settings) => settings.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.collaborationInviteNotifications
      ? {
          collaborationInviteNotifications: database.collaborationInviteNotifications.filter(
            (notification) => notification.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.exportManifests
      ? {
          exportManifests: database.exportManifests.filter(
            (manifest) => manifest.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.exportRedactionValidations
      ? {
          exportRedactionValidations: database.exportRedactionValidations.filter(
            (validation) => validation.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.gradingQueues
      ? {
          gradingQueues: database.gradingQueues.filter(
            (queue) => queue.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.gradebookUpdates
      ? {
          gradebookUpdates: database.gradebookUpdates.filter(
            (update) => update.courseId !== courseId,
          ),
        }
      : {}),
    ...(database.gradingFeedbackDrafts
      ? {
          gradingFeedbackDrafts: database.gradingFeedbackDrafts.filter(
            (draft) => draft.courseId !== courseId,
          ),
        }
      : {}),
    auditEvents: database.auditEvents.map((event) =>
      event.action === "create-course" &&
      event.actorId === actorId &&
      event.courseId === courseId &&
      event.traceId === input.traceId
        ? {
            ...event,
            rollbackStatus: "rolled-back" as const,
            rolledBackAt,
          }
        : event,
    ),
  };
  await writeTeachingCourseManagementSnapshot({
    dataDir,
    repository: input.repository,
    database: nextDatabase,
    expectedRevision: snapshot.revision,
    courseId,
  });
}

export async function saveTeachingClassInviteCodeDraftRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  classId: string;
  operationRecordId: string;
  invitationCode: string;
  sourceAction?: string;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  inviteCodeDraft: TeachingClassInviteCodeDraftRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const classId = requireSafeId(input.classId, "class id");
  const operationRecordId = requireSafeId(input.operationRecordId, "operation record id");
  const invitationCode = requireInviteCode(input.invitationCode, 400);
  const sourceAction = input.sourceAction
    ? requireSafeId(input.sourceAction, "source action")
    : undefined;
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const inviteCodeDraftId = `invite-code-draft-${courseId}-${invitationCode}`;

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((item) => item.courseId === courseId);
    const course = courseIndex >= 0 ? database.courses[courseIndex] : undefined;
    if (course && course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching course ownership is required.");
    }

    const classIndex = database.classes.findIndex(
      (item) => item.classId === classId && item.courseId === courseId,
    );
    if (classIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching class was not found.");
    }

    const classItem = database.classes[classIndex];
    if (classItem.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching class ownership is required.");
    }

    const inviteCodeDrafts = database.inviteCodeDrafts ?? [];
    const existingDraftIndex = inviteCodeDrafts.findIndex(
      (item) => item.inviteCodeDraftId === inviteCodeDraftId,
    );
    const existingDraft =
      existingDraftIndex >= 0
        ? inviteCodeDrafts[existingDraftIndex]
        : undefined;
    if (existingDraft?.operationRecordId === operationRecordId) {
      const receipt = createReceipt({
        action: "generate-class-invite-code-draft",
        actorId,
        courseId,
        classId,
        traceId: input.traceId,
        createdAt: existingDraft.generatedAt,
        storage,
      });
      return {
        inviteCodeDraft: existingDraft,
        receipt,
      };
    }

    database.classes[classIndex] = {
      ...classItem,
      updatedAt: generatedAt,
    };
    if (course && courseIndex >= 0) {
      database.courses[courseIndex] = {
        ...course,
        updatedAt: generatedAt,
        storagePolicy: storage.recordStoragePolicy,
        storageWritePolicy: storage.storageWritePolicy,
        redaction: createRedaction(),
      };
    }

    const inviteCodeDraft: TeachingClassInviteCodeDraftRecord = {
      inviteCodeDraftId,
      courseId,
      classId,
      ownerTeacherId: classItem.ownerTeacherId,
      generatedBy: actorId,
      draftStatus: "generated",
      operationRecordId,
      ...(sourceAction ? { sourceAction } : {}),
      inviteCode: invitationCode,
      joinUrl: `/courses?invite=${invitationCode}`,
      invitePolicy: "teacher-review-before-publication",
      generatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.inviteCodeDrafts =
      existingDraftIndex >= 0
        ? inviteCodeDrafts.map((item, index) =>
            index === existingDraftIndex ? inviteCodeDraft : item,
          )
        : [...inviteCodeDrafts, inviteCodeDraft];

    const receipt = createReceipt({
      action: "generate-class-invite-code-draft",
      actorId,
      courseId,
      classId,
      traceId: input.traceId,
      createdAt: generatedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "generate-class-invite-code-draft",
      actorId,
      courseId,
      classId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: generatedAt,
      storage,
    });
    database.auditEvents.push(auditEvent);
    database.updatedAt = generatedAt;

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return {
        inviteCodeDraft,
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

export async function publishTeachingClassInviteCode(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  classId: string;
  invitationCode: string;
  invitePolicy?: TeachingClassInviteCodePolicyInput;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
  };
  traceId?: string;
  now?: Date;
}): Promise<{
  classItem: TeachingClassRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const classId = requireSafeId(input.classId, "class id");
  const invitationCode = requireInviteCode(input.invitationCode, 400);
  const invitePolicyPatch = normalizeInviteCodePolicyPatch(input.invitePolicy);
  const now = input.now ?? new Date();
  const publishedAt = now.toISOString();

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((item) => item.courseId === courseId);
    const course = courseIndex >= 0 ? database.courses[courseIndex] : undefined;
    if (course && course.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching course ownership is required.");
    }

    const classIndex = database.classes.findIndex(
      (item) => item.classId === classId && item.courseId === courseId,
    );
    if (classIndex < 0) {
      throw new TeachingCourseManagementStoreError(404, "Teaching class was not found.");
    }

    const classItem = database.classes[classIndex];
    if (classItem.ownerTeacherId !== actorId) {
      throw new TeachingCourseManagementStoreError(403, "Teaching class ownership is required.");
    }

    // Invite codes are unique across the deployment, not within a course - a
    // student joins with the bare code - so this gate needs a corpus-wide view
    // that the course-scoped read above cannot give it. The store reconciles the
    // same claim inside the row's transaction, which is what actually closes the
    // race; this read is what keeps the teacher's answer the precise 409 rather
    // than a generic retry.
    const { database: inviteCodeCorpus } = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const duplicateClass = inviteCodeCorpus.classes.find(
      (item) => item.invitationCode === invitationCode && item.classId !== classId,
    );
    if (duplicateClass) {
      throw new TeachingCourseManagementStoreError(
        409,
        "Teaching class invite code already exists.",
      );
    }

    const joinUrl = `/courses?invite=${invitationCode}`;
    // A fresh code carries a fresh policy: an expiry or a join limit set for the
    // code the teacher just revoked says nothing about the one replacing it.
    // Republishing the same code keeps its policy unless this call changes it.
    const invitePolicy = applyInviteCodePolicyPatch(
      classItem.invitationCode === invitationCode ? classItem : undefined,
      invitePolicyPatch,
    );
    const existingPublishEvent = [...database.auditEvents].reverse().find(
      (event) =>
        event.action === "publish-class-invite-code" &&
        event.actorId === actorId &&
        event.courseId === courseId &&
        event.classId === classId,
    );
    if (
      existingPublishEvent &&
      classItem.invitationCode === invitationCode &&
      classItem.joinUrl === joinUrl &&
      isSameInviteCodePolicy(classItem, invitePolicy)
    ) {
      const receipt = createReceipt({
        action: "publish-class-invite-code",
        actorId,
        courseId,
        classId,
        traceId: input.traceId,
        createdAt: existingPublishEvent.createdAt,
        storage,
      });
      return {
        classItem,
        receipt,
      };
    }

    const updatedClass: TeachingClassRecord = {
      ...classItem,
      invitationCode,
      joinUrl,
      // Spread over the record's own policy keys rather than beside them: an
      // omitted key must DISAPPEAR, not survive from the previous code.
      inviteExpiresAt: undefined,
      inviteMaxJoins: undefined,
      inviteDisabled: undefined,
      ...invitePolicy,
      updatedAt: publishedAt,
    };
    database.classes[classIndex] = updatedClass;
    if (course && courseIndex >= 0) {
      database.courses[courseIndex] = {
        ...course,
        updatedAt: publishedAt,
        storagePolicy: storage.recordStoragePolicy,
        storageWritePolicy: storage.storageWritePolicy,
        redaction: createRedaction(),
      };
    }

    const receipt = createReceipt({
      action: "publish-class-invite-code",
      actorId,
      courseId,
      classId,
      traceId: input.traceId,
      createdAt: publishedAt,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "publish-class-invite-code",
      actorId,
      courseId,
      classId,
      traceId: receipt.traceId,
      requestSource: input.audit?.requestSource,
      createdAt: publishedAt,
      storage,
    });

    database.auditEvents.push(auditEvent);
    database.updatedAt = publishedAt;
    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return {
        classItem: updatedClass,
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

export async function assertTeachingClassInviteCodePublishTarget(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  classId: string;
}) {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const classId = requireSafeId(input.classId, "class id");
  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir,
    repository: input.repository,
    courseId,
  });
  const classItem = database.classes.find(
    (item) => item.classId === classId && item.courseId === courseId,
  );
  if (!classItem) {
    throw new TeachingCourseManagementStoreError(404, "Teaching class was not found.");
  }
  if (classItem.ownerTeacherId !== actorId) {
    throw new TeachingCourseManagementStoreError(403, "Teaching class ownership is required.");
  }
}

export async function joinTeachingClassByInviteCode(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  join: TeachingClassJoinInput;
  traceId?: string;
  now?: Date;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
    authSession?: TeachingCourseManagementAuthSessionSummary;
  };
}): Promise<{
  membership: TeachingClassMembershipRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const invitationCode = requireInviteCode(input.join.invitationCode, 400);
  const studentId = requireSafeId(input.join.studentId, "student id");
  const studentDisplayName = requireTrimmedString(
    input.join.studentDisplayName,
    "student display name",
    160,
  );
  const now = input.now ?? new Date();
  const joinedAt = now.toISOString();
  // A student names a class by its code alone, so the course this join belongs
  // to has to be discovered before the store can be asked for that course's row.
  // Discovery stays a corpus enumeration - the same one the course list uses -
  // and only the read-modify-write that follows is course-scoped. Codes never
  // move between courses, so resolving once outside the retry loop is safe.
  const courseId = await resolveTeachingClassCourseId({
    dataDir,
    repository: input.repository,
    find: (database) =>
      database.classes.find((item) => item.invitationCode === invitationCode),
    notFoundMessage: "Teaching class invite code was not found.",
  });

  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
      courseId,
    });
    const database = snapshot.database;
    const classItem = database.classes.find((item) => item.invitationCode === invitationCode);
    if (!classItem) {
      throw new TeachingCourseManagementStoreError(
        404,
        "Teaching class invite code was not found.",
      );
    }
    const classIndex = database.classes.findIndex((item) => item.classId === classItem.classId);
    const courseIndex = database.courses.findIndex(
      (item) => item.courseId === classItem.courseId,
    );
    if (courseIndex < 0) {
      throw new TeachingCourseManagementStoreError(500, "Teaching class course is missing.");
    }

    const membershipId = `membership-${classItem.classId}-${studentId}`;
    const existingMembershipIndex = database.memberships.findIndex(
      (membership) => membership.membershipId === membershipId,
    );
    const existingMembership =
      existingMembershipIndex >= 0 ? database.memberships[existingMembershipIndex] : undefined;
    // A membership that is still live - waiting for review or approved - answers
    // the same idempotent receipt it always did. A rejected or removed one is a
    // closed request, not a live seat, so the student is allowed to ask again and
    // the row below is rebuilt as a fresh pending request.
    if (
      existingMembership &&
      existingMembership.membershipStatus !== "rejected" &&
      existingMembership.membershipStatus !== "removed"
    ) {
      return {
        membership: existingMembership,
        receipt: createReceipt({
          action: "join-class-by-invite",
          actorId: studentId,
          courseId: existingMembership.courseId,
          classId: existingMembership.classId,
          traceId: input.traceId,
          createdAt: joinedAt,
          authSession: input.audit?.authSession,
          storage,
        }),
      };
    }

    const existingCourseMembership = database.memberships.find(
      (membership) =>
        membership.studentId === studentId &&
        membership.courseId === classItem.courseId &&
        membership.classId !== classItem.classId &&
        (membership.membershipStatus === "pending-teacher-review" ||
          membership.membershipStatus === "approved"),
    );
    if (existingCourseMembership) {
      throw new TeachingCourseManagementStoreError(
        409,
        "Student already has a membership in this teaching course.",
      );
    }

    // The code's own policy is checked only once the join is otherwise legal, so
    // a student who already holds this seat is never told the class is full.
    assertTeachingClassInviteCodeUsable({
      database,
      classItem,
      invitationCode,
      now,
    });

    const membership: TeachingClassMembershipRecord = {
      membershipId,
      courseId: classItem.courseId,
      classId: classItem.classId,
      invitationCode,
      studentId,
      studentDisplayName,
      membershipStatus: "pending-teacher-review",
      joinedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    const receipt = createReceipt({
      action: "join-class-by-invite",
      actorId: studentId,
      courseId: classItem.courseId,
      classId: classItem.classId,
      traceId: input.traceId,
      createdAt: joinedAt,
      authSession: input.audit?.authSession,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "join-class-by-invite",
      actorId: studentId,
      courseId: classItem.courseId,
      classId: classItem.classId,
      traceId: receipt.traceId,
      actorRole: "student",
      authMode: "app-student-session",
      createdAt: joinedAt,
      requestSource: input.audit?.requestSource,
      authSession: input.audit?.authSession,
      storage,
    });

    // A re-join after a rejection or a removal REPLACES the closed row rather
    // than adding a second one under the same deterministic membership id: the
    // history lives in the audit events, and the roster stays one row per
    // student per class.
    if (existingMembershipIndex >= 0) {
      database.memberships[existingMembershipIndex] = membership;
    } else {
      database.memberships.push(membership);
    }
    database.classes[classIndex] = {
      ...classItem,
      updatedAt: joinedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.courses[courseIndex] = {
      ...database.courses[courseIndex],
      updatedAt: joinedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.auditEvents.push(auditEvent);
    database.updatedAt = joinedAt;
    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
        courseId,
      });
      return { membership, receipt };
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

export async function approveTeachingClassMembership(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  classId: string;
  membershipId: string;
  traceId?: string;
  now?: Date;
  audit?: {
    requestSource?: TeachingCourseManagementAuditRequestSource;
    authSession?: TeachingCourseManagementAuthSessionSummary;
  };
}): Promise<{
  membership: TeachingClassMembershipRecord;
  classItem: TeachingClassRecord;
  course: TeachingCourseRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const classId = requireSafeId(input.classId, "class id");
  const membershipId = requireSafeId(input.membershipId, "membership id");
  const now = input.now ?? new Date();
  const approvedAt = now.toISOString();
  // The approval route addresses a class and a membership, never a course, so
  // the owning course is discovered the same way the invite join discovers it:
  // one corpus enumeration up front, then a course-scoped read-modify-write. A
  // class never changes course, so this cannot go stale inside the loop.
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
    if (existingMembership.membershipStatus === "approved") {
      return {
        membership: existingMembership,
        classItem,
        course: database.courses[courseIndex],
        receipt: createReceipt({
          action: "approve-class-membership",
          actorId,
          courseId: classItem.courseId,
          classId,
          traceId: input.traceId,
          createdAt: existingMembership.approvedAt ?? approvedAt,
          authSession: input.audit?.authSession,
          storage,
        }),
      };
    }

    const membership: TeachingClassMembershipRecord = {
      ...existingMembership,
      membershipStatus: "approved",
      approvedAt,
      approvedByTeacherId: actorId,
    };
    database.memberships[membershipIndex] = membership;

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

    const receipt = createReceipt({
      action: "approve-class-membership",
      actorId,
      courseId: classItem.courseId,
      classId,
      traceId: input.traceId,
      createdAt: approvedAt,
      authSession: input.audit?.authSession,
      storage,
    });
    const auditEvent = createAuditEvent({
      action: "approve-class-membership",
      actorId,
      courseId: classItem.courseId,
      classId,
      traceId: receipt.traceId,
      createdAt: approvedAt,
      requestSource: input.audit?.requestSource,
      authSession: input.audit?.authSession,
      storage,
    });

    database.auditEvents.push(auditEvent);
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
        membership,
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

// Expiry, capacity and the disable switch, in that order. Each refusal is a 403
// with its own reason code: the code exists, so answering 404 would be a lie,
// and one undifferentiated 403 would leave the student guessing which of the
// three walls they hit.
function assertTeachingClassInviteCodeUsable(input: {
  database: TeachingCourseManagementDatabase;
  classItem: TeachingClassRecord;
  invitationCode: string;
  now?: Date;
}) {
  if (input.classItem.inviteDisabled) {
    throw createInviteJoinRefusalError(
      "Teaching class invite code is disabled.",
      "invite-code-disabled",
    );
  }
  if (
    input.classItem.inviteExpiresAt &&
    Date.parse(input.classItem.inviteExpiresAt) <= (input.now ?? new Date()).getTime()
  ) {
    throw createInviteJoinRefusalError(
      "Teaching class invite code has expired.",
      "invite-code-expired",
    );
  }
  if (
    input.classItem.inviteMaxJoins !== undefined &&
    countInviteCodeJoins(input.database, {
      classId: input.classItem.classId,
      invitationCode: input.invitationCode,
    }) >= input.classItem.inviteMaxJoins
  ) {
    throw createInviteJoinRefusalError(
      "Teaching class invite code join limit is reached.",
      "invite-code-capacity-reached",
    );
  }
}

function createInviteJoinRefusalError(
  message: string,
  reasonCode: TeachingClassInviteJoinRefusalReasonCode,
) {
  return new TeachingCourseManagementStoreError(403, message, undefined, reasonCode);
}

function normalizeInviteCodePolicyPatch(
  value: TeachingClassInviteCodePolicyInput | undefined,
): TeachingClassInviteCodePolicyInput {
  if (!value) {
    return {};
  }
  return {
    ...(value.expiresAt === undefined
      ? {}
      : {
          expiresAt:
            value.expiresAt === null
              ? null
              : requireInviteCodeExpiry(value.expiresAt),
        }),
    ...(value.maxJoins === undefined
      ? {}
      : { maxJoins: value.maxJoins === null ? null : requireInviteCodeMaxJoins(value.maxJoins) }),
    ...(value.disabled === undefined ? {} : { disabled: value.disabled === true }),
  };
}

// `current` absent means the class is taking a NEW code, so the patch is applied
// to an open policy rather than to the retired code's one.
function applyInviteCodePolicyPatch(
  current: TeachingClassRecord | undefined,
  patch: TeachingClassInviteCodePolicyInput,
): Pick<TeachingClassRecord, "inviteExpiresAt" | "inviteMaxJoins" | "inviteDisabled"> {
  const expiresAt = patch.expiresAt === undefined ? current?.inviteExpiresAt : patch.expiresAt;
  const maxJoins = patch.maxJoins === undefined ? current?.inviteMaxJoins : patch.maxJoins;
  const disabled = patch.disabled === undefined ? current?.inviteDisabled : patch.disabled;
  return {
    ...(expiresAt ? { inviteExpiresAt: expiresAt } : {}),
    ...(maxJoins === null || maxJoins === undefined ? {} : { inviteMaxJoins: maxJoins }),
    ...(disabled ? { inviteDisabled: true as const } : {}),
  };
}

function isSameInviteCodePolicy(
  classItem: TeachingClassRecord,
  policy: Pick<TeachingClassRecord, "inviteExpiresAt" | "inviteMaxJoins" | "inviteDisabled">,
) {
  return (
    classItem.inviteExpiresAt === policy.inviteExpiresAt &&
    classItem.inviteMaxJoins === policy.inviteMaxJoins &&
    classItem.inviteDisabled === policy.inviteDisabled
  );
}

function requireInviteCodeExpiry(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TeachingCourseManagementStoreError(400, "Invalid invite code expiry.");
  }
  return value;
}

function requireInviteCodeMaxJoins(value: unknown) {
  // Zero is rejected rather than treated as "closed": disabling a code is what
  // `disabled` is for, and a silent 0 would look like an unset field.
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TeachingCourseManagementStoreError(400, "Invalid invite code join limit.");
  }
  return value;
}

// Class-by-code and class-by-id discovery, shared by the two handlers whose
// callers cannot name a course. The read is deliberately unscoped: it is the one
// question the per-course rows cannot answer directly, and it carries no
// revision, so its result is used only to choose which course's row the caller
// then reads under an optimistic guard.
export async function resolveTeachingClassCourseId(input: {
  dataDir: string;
  repository?: TeachingCourseManagementRepository;
  find: (database: TeachingCourseManagementDatabase) => TeachingClassRecord | undefined;
  notFoundMessage: string;
}) {
  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir: input.dataDir,
    repository: input.repository,
  });
  const classItem = input.find(database);
  if (!classItem) {
    throw new TeachingCourseManagementStoreError(404, input.notFoundMessage);
  }
  return classItem.courseId;
}
