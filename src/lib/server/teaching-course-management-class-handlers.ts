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
  createAuditEvent,
  createReceipt,
  isTeachingCourseManagementOptimisticSnapshotConflict,
} from "./teaching-course-management-helpers";
import {
  localTeachingCourseManagementStorage,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  writeTeachingCourseManagementSnapshot,
} from "./teaching-course-management-io";
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

export async function rollbackTeachingCourseCreation(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  traceId: string;
  rolledBackAt?: string;
}) {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir,
    repository: input.repository,
  });
  const database = snapshot.database;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
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
      });
      return {
        inviteCodeDraft,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function publishTeachingClassInviteCode(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  classId: string;
  invitationCode: string;
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
  const now = input.now ?? new Date();
  const publishedAt = now.toISOString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
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

    const duplicateClass = database.classes.find(
      (item) => item.invitationCode === invitationCode && item.classId !== classId,
    );
    if (duplicateClass) {
      throw new TeachingCourseManagementStoreError(
        409,
        "Teaching class invite code already exists.",
      );
    }

    const joinUrl = `/courses?invite=${invitationCode}`;
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
      classItem.joinUrl === joinUrl
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
      });
      return {
        classItem: updatedClass,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function assertTeachingClassInviteCodePublishTarget(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  classId: string;
}) {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir,
    repository: input.repository,
  });
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const classId = requireSafeId(input.classId, "class id");
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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
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
    const existingMembership = database.memberships.find(
      (membership) => membership.membershipId === membershipId,
    );
    if (existingMembership) {
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

    database.memberships.push(membership);
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
      });
      return { membership, receipt };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
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
      });
      return {
        membership,
        classItem: updatedClass,
        course: updatedCourse,
        receipt,
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

