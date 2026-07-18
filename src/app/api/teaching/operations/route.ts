import { randomUUID } from "node:crypto";
import {
  createUaisTeachingOperationExternalRollbackAdapter,
  createUaisTeachingOperationExternalAppendAdapter,
  executeTeachingOperationAction,
  resolveTeachingOperationDataDir,
  rollbackTeachingOperationRecord,
  TeachingOperationStoreError,
  type TeachingOperationReceipt,
  type TeachingOperationActionSlot,
  type TeachingOperationAuditRequestSource,
  type TeachingOperationExternalAppendAdapter,
  type TeachingOperationExternalRollbackAdapter,
  type TeachingOperationRollbackReceipt,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingClassInviteCodePublishTarget,
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  publishTeachingClassInviteCode,
  resolveTeachingCourseManagementDataDir,
  markTeachingCollaborationInviteNotificationDelivered,
  markTeachingKnowledgeIndexProviderSynced,
  markTeachingStudentRosterProviderSynced,
  readTeachingCourseManagementSnapshot,
  saveTeachingClassInviteCodeDraftRecord,
  saveTeachingAdminSettingsRecord,
  saveTeachingAgentPermissionPreflightRecord,
  saveTeachingAgentSettingsRecord,
  saveTeachingCollaborationInviteNotificationRecord,
  saveTeachingCourseContentPublishRecord,
  saveTeachingCourseUnitDraftRecord,
  saveTeachingCourseDashboardRefreshRecord,
  saveTeachingCourseDashboardSnapshotRecord,
  saveTeachingCourseExportManifestRecord,
  saveTeachingCourseExportRedactionValidationRecord,
  markTeachingCourseExportProviderExported,
  saveTeachingCourseQuizAssessmentRecord,
  saveTeachingCourseQuizItemReviewRecord,
  saveTeachingGradingFeedbackDraftRecord,
  saveTeachingGradingQueueRecord,
  markTeachingGradingFeedbackProviderGenerated,
  markTeachingCourseContentProviderPublished,
  saveTeachingKnowledgeIndexSyncRecord,
  saveTeachingResourceReviewItemRecord,
  saveTeachingCourseSettingsRecord,
  saveTeachingStudentPreviewSessionRecord,
  saveTeachingStudentGroupSuggestionRecord,
  saveTeachingStudentRosterSyncRecord,
  TeachingCourseManagementStoreError,
  type TeachingCourseManagementReceipt,
} from "@/lib/server/teaching-course-management-store";
import {
  isExternalStorageBackendReadyContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import { createUaisTeacherAiOwnershipAdapter } from "@/lib/server/teacher-ai-ownership-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import {
  readCollaborationInviteEmailProviderConfig,
  readCourseContentPublishProviderConfig,
  readCourseExportProviderConfig,
  readGradingFeedbackProviderConfig,
  readKnowledgeIndexSyncProviderConfig,
  readKnowledgeProviderSyncId,
  readProviderDeliveryId,
  readProviderExportId,
  readProviderFeedbackId,
  readProviderPublishId,
  readProviderSyncId,
  readStudentRosterSyncProviderConfig,
} from "./provider-config";
import {
  createRedaction,
  isRecord,
  jsonResponse,
  normalizeActionSlot,
} from "./route-utils";

export const dynamic = "force-dynamic";

type TeachingOperationActionPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
  appendExternalTeachingOperation?: TeachingOperationExternalAppendAdapter;
  rollbackExternalTeachingOperation?: TeachingOperationExternalRollbackAdapter;
};

type TeachingOperationAccessDeniedReason =
  | "auth-adapter-not-configured"
  | "authenticated-session-required"
  | "teacher-auth-provider-not-production-ready"
  | "teacher-role-required"
  | "course-id-required"
  | "course-id-invalid"
  | "teacher-course-ownership-required"
  | "teacher-course-ownership-check-failed"
  | "course-scope-denied";

type TeachingOperationAuthenticatedTeacher = {
  sessionId: string;
  actorId: string;
  role: "teacher";
  authenticatedAt: string;
  expiresAt: string;
};

type TeachingOperationCourseOwnership = {
  teacherId: string;
  courseIds?: string[];
};

type GetTeachingOperationCourseOwnership = (input: {
  request: Request;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
}) => Promise<TeachingOperationCourseOwnership | undefined>;

const maxBodyBytes = 100_000;
const maxSafeIdLength = 120;

export const POST = createTeachingOperationActionPostHandler();

export function createTeachingOperationActionPostHandler(
  deps: TeachingOperationActionPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const usesDefaultTeachingOperationCourseOwnership =
    deps.getTeachingOperationCourseOwnership === undefined;
  const getTeachingOperationCourseOwnership =
    deps.getTeachingOperationCourseOwnership ??
    createTeachingOperationCourseOwnershipAdapter({
      env,
      fetch: deps.fetch,
  });
  return async function POST(request: Request) {
    const traceId = readSafeTraceId(request);
    try {
      const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
      if (
        isTeachingOperationProductionRuntime(env) &&
        authProviderContract.productionStatus !== "ready"
      ) {
        return jsonResponse(503, {
          error: "UAIS teacher auth provider is not production-ready.",
          traceId,
          access: createDeniedAccess("teacher-auth-provider-not-production-ready"),
          authProviderContract,
          redaction: createRedaction(),
        }, traceId);
      }

      const authenticatedStudent = readAuthenticatedStudentSession({
        request,
        env,
        now: deps.now,
      });
      if (authenticatedStudent) {
        return jsonResponse(403, {
          error: "UAIS teacher role is required.",
          traceId,
          access: createDeniedAccess("teacher-role-required"),
          redaction: createRedaction(),
        }, traceId);
      }

      const authenticatedTeacher = readAuthenticatedTeacherSession({
        request,
        env,
        now: deps.now,
      });
      if (!authenticatedTeacher) {
        return jsonResponse(401, {
          error: "UAIS teacher authentication is required.",
          traceId,
          access: createDeniedAccess("authenticated-session-required"),
          redaction: createRedaction(),
        }, traceId);
      }

      const body = await readJsonBody(request);
      if (!isRecord(body)) {
        throw new TeachingOperationStoreError(400, "Request body must be an object.");
      }

      const courseId = typeof body.courseId === "string" ? body.courseId : undefined;
      if (usesDefaultTeachingOperationCourseOwnership) {
        assertProductionTeachingOperationCourseOwnershipAccessConfigured({
          env,
          courseId,
        });
      }
      const access = await authorizeTeachingOperationCourseAccess({
        request,
        authenticatedTeacher,
        courseId,
        getTeachingOperationCourseOwnership,
      });
      if (access.status === "denied") {
        return jsonResponse(getTeachingOperationAccessDeniedStatus(access.reasonCode), {
          error: getTeachingOperationAccessDeniedError(access.reasonCode),
          traceId,
          access,
          redaction: createRedaction(),
        }, traceId);
      }
      const appendExternalTeachingOperation =
        deps.appendExternalTeachingOperation ??
        createUaisTeachingOperationExternalAppendAdapter({
          env,
          fetch: deps.fetch,
        });
      if (isTeachingOperationProductionRuntime(env) && !appendExternalTeachingOperation) {
        throw new TeachingOperationStoreError(
          503,
          "Production teaching operation persistence requires external storage.",
        );
      }

      const operationId = typeof body.operationId === "string" ? body.operationId : "";
      const actionSlot = normalizeActionSlot(body.actionSlot);
      assertSafeInviteTargetClassId({
        body,
        operationId,
        actionSlot,
      });
      preflightProductionCourseManagementPersistence({
        env,
        fetch: deps.fetch,
        operationId,
        actionSlot,
      });
      preflightProductionProviderSideEffects({
        env,
        operationId,
        actionSlot,
      });
      await preflightClassInvitePublishTarget({
        env,
        fetch: deps.fetch,
        body,
        operationId,
        actionSlot,
        authenticatedTeacher,
        courseId,
      });

      const receipt = await executeTeachingOperationAction({
        dataDir: resolveTeachingOperationDataDir(env.UAIS_TEACHING_OPERATIONS_DATA_DIR),
        env,
        operationId,
        actionSlot,
        actorId: authenticatedTeacher.actorId,
        courseId,
        sourceAction: typeof body.sourceAction === "string" ? body.sourceAction : undefined,
        idempotencyKey: readIdempotencyKey({ request, body }),
        ...(isRecord(body.courseSettingsPatch)
          ? { courseSettingsPatch: body.courseSettingsPatch }
          : {}),
        audit: createTeachingOperationAuditInput({
          traceId,
          request,
          authenticatedTeacher,
        }),
        appendExternalTeachingOperation,
        now: deps.now,
      });
      const domainPersistence = await persistTeachingOperationDomainObjects({
        env,
        fetch: deps.fetch,
        body,
        receipt,
        authenticatedTeacher,
        courseId,
        traceId,
        requestSource: readAuditRequestSource(request),
        now: deps.now,
      }).catch(async (error) => {
        if (
          shouldReturnCourseManagementDomainObjectPartialFailure({
            error,
            receipt,
            courseId,
          })
        ) {
          const compensation = await attemptTeachingOperationPartialFailureCompensation({
            env,
            fetch: deps.fetch,
            request,
            receipt,
            authenticatedTeacher,
            courseId: courseId!,
            traceId,
            rollbackReason: "course-management-domain-object-failed",
            rollbackExternalTeachingOperation: deps.rollbackExternalTeachingOperation,
            now: deps.now,
          });
          return createCourseManagementDomainObjectPartialFailureResponse({
            error,
            traceId,
            receipt,
            courseId,
            compensation,
          });
        }
        throw error;
      });
      if (domainPersistence instanceof Response) {
        return domainPersistence;
      }
      const {
        courseSettingsReceipt,
        studentPreviewSessionReceipt,
        studentRosterSyncReceipt,
        studentRosterProviderSyncReceipt,
        studentRosterProviderSyncPartialFailure,
        studentGroupSuggestionReceipt,
        knowledgeIndexSyncReceipt,
        knowledgeIndexProviderSyncReceipt,
        knowledgeIndexProviderSyncPartialFailure,
        resourceReviewItemReceipt,
        courseContentPublishReceipt,
        courseContentProviderPublishReceipt,
        courseContentProviderPublishPartialFailure,
        courseUnitDraftReceipt,
        dashboardRefreshReceipt,
        dashboardSnapshotReceipt,
        quizAssessmentReceipt,
        quizItemReviewReceipt,
        agentSettingsReceipt,
        agentPermissionPreflightReceipt,
        adminSettingsReceipt,
        collaborationInviteNotificationReceipt,
        collaborationInviteEmailDeliveryReceipt,
        collaborationInviteEmailDeliveryPartialFailure,
        courseExportManifestReceipt,
        courseExportProviderReceipt,
        courseExportProviderPartialFailure,
        courseExportRedactionValidationReceipt,
        gradingQueueReceipt,
        gradingFeedbackDraftReceipt,
        gradingFeedbackProviderReceipt,
        gradingFeedbackProviderPartialFailure,
        inviteCodeDraftReceipt,
      } = domainPersistence;
      if (collaborationInviteEmailDeliveryPartialFailure) {
        return createCollaborationInviteEmailDeliveryPartialFailureResponse({
          error: collaborationInviteEmailDeliveryPartialFailure.error,
          traceId,
          receipt,
          courseId,
          collaborationInviteNotificationReceipt,
        });
      }
      if (studentRosterProviderSyncPartialFailure) {
        return createStudentRosterProviderSyncPartialFailureResponse({
          error: studentRosterProviderSyncPartialFailure.error,
          traceId,
          receipt,
          courseId,
          studentRosterSyncReceipt,
        });
      }
      if (knowledgeIndexProviderSyncPartialFailure) {
        return createKnowledgeIndexProviderSyncPartialFailureResponse({
          error: knowledgeIndexProviderSyncPartialFailure.error,
          traceId,
          receipt,
          courseId,
          knowledgeIndexSyncReceipt,
        });
      }
      if (courseContentProviderPublishPartialFailure) {
        return createCourseContentProviderPublishPartialFailureResponse({
          error: courseContentProviderPublishPartialFailure.error,
          traceId,
          receipt,
          courseId,
          courseContentPublishReceipt,
        });
      }
      if (courseExportProviderPartialFailure) {
        return createCourseExportProviderPartialFailureResponse({
          error: courseExportProviderPartialFailure.error,
          traceId,
          receipt,
          courseId,
          courseExportManifestReceipt,
        });
      }
      if (gradingFeedbackProviderPartialFailure) {
        return createGradingFeedbackProviderPartialFailureResponse({
          error: gradingFeedbackProviderPartialFailure.error,
          traceId,
          receipt,
          courseId,
          gradingFeedbackDraftReceipt,
        });
      }
      const targetClassId = readTargetClassId(body);
      let classInvitePublicationReceipt:
        | Awaited<ReturnType<typeof maybePublishClassInviteCode>>
        | undefined;
      try {
        classInvitePublicationReceipt = await maybePublishClassInviteCode({
          env,
          fetch: deps.fetch,
          body,
          receipt,
          authenticatedTeacher,
          courseId,
          traceId,
          requestSource: readAuditRequestSource(request),
          now: deps.now,
        });
      } catch (error) {
        if (shouldReturnClassInvitePublicationPartialFailure({
          receipt,
          courseId,
          targetClassId,
        })) {
          const compensation = await attemptTeachingOperationPartialFailureCompensation({
            env,
            fetch: deps.fetch,
            request,
            receipt,
            authenticatedTeacher,
            courseId: courseId!,
            traceId,
            rollbackReason: "class-invite-publication-failed",
            rollbackExternalTeachingOperation: deps.rollbackExternalTeachingOperation,
            now: deps.now,
          });
          return createClassInvitePublicationPartialFailureResponse({
            error,
            traceId,
            receipt,
            courseId,
            targetClassId,
            compensation,
          });
        }
        throw error;
      }
      const domainPersistenceSummary = createTeachingOperationDomainPersistenceSummary({
        receipt,
        courseId,
        entries: [
          {
            responseKey: "courseSettingsReceipt",
            objectType: "course-settings",
            receipt: courseSettingsReceipt,
          },
          {
            responseKey: "studentPreviewSessionReceipt",
            objectType: "student-preview-session",
            receipt: studentPreviewSessionReceipt,
          },
          {
            responseKey: "studentRosterSyncReceipt",
            objectType: "student-roster",
            receipt: studentRosterSyncReceipt,
          },
          {
            responseKey: "studentGroupSuggestionReceipt",
            objectType: "group-suggestions",
            receipt: studentGroupSuggestionReceipt,
          },
          {
            responseKey: "knowledgeIndexSyncReceipt",
            objectType: "knowledge-index",
            receipt: knowledgeIndexSyncReceipt,
          },
          {
            responseKey: "resourceReviewItemReceipt",
            objectType: "resource-review-item",
            receipt: resourceReviewItemReceipt,
          },
          {
            responseKey: "courseContentPublishReceipt",
            objectType: "course-content",
            receipt: courseContentPublishReceipt,
          },
          {
            responseKey: "courseUnitDraftReceipt",
            objectType: "unit-draft",
            receipt: courseUnitDraftReceipt,
          },
          {
            responseKey: "dashboardRefreshReceipt",
            objectType: "dashboard-state",
            receipt: dashboardRefreshReceipt,
          },
          {
            responseKey: "dashboardSnapshotReceipt",
            objectType: "dashboard-snapshot",
            receipt: dashboardSnapshotReceipt,
          },
          {
            responseKey: "quizAssessmentReceipt",
            objectType: "quiz-board-state",
            receipt: quizAssessmentReceipt,
          },
          {
            responseKey: "quizItemReviewReceipt",
            objectType: "quiz-item-review",
            receipt: quizItemReviewReceipt,
          },
          {
            responseKey: "agentSettingsReceipt",
            objectType: "agent-plan",
            receipt: agentSettingsReceipt,
          },
          {
            responseKey: "agentPermissionPreflightReceipt",
            objectType: "permission-preflight",
            receipt: agentPermissionPreflightReceipt,
          },
          {
            responseKey: "adminSettingsReceipt",
            objectType: "admin-settings",
            receipt: adminSettingsReceipt,
          },
          {
            responseKey: "collaborationInviteNotificationReceipt",
            objectType: "email-notification",
            receipt: collaborationInviteNotificationReceipt,
          },
          {
            responseKey: "courseExportManifestReceipt",
            objectType: "export-manifest",
            receipt: courseExportManifestReceipt,
          },
          {
            responseKey: "courseExportRedactionValidationReceipt",
            objectType: "redaction-validation",
            receipt: courseExportRedactionValidationReceipt,
          },
          {
            responseKey: "gradingQueueReceipt",
            objectType: "grading-queue",
            receipt: gradingQueueReceipt,
          },
          {
            responseKey: "gradingQueueReceipt.gradebookUpdate",
            objectType: "gradebook-update",
            receipt: gradingQueueReceipt,
          },
          {
            responseKey: "gradingFeedbackDraftReceipt",
            objectType: "ai-feedback-draft",
            receipt: gradingFeedbackDraftReceipt,
          },
          {
            responseKey: "inviteCodeDraftReceipt",
            objectType: "invite-code-draft",
            receipt: inviteCodeDraftReceipt,
          },
          {
            responseKey: "classInvitePublicationReceipt",
            objectType: "enrollment-access",
            receipt: classInvitePublicationReceipt,
          },
        ],
      });

      return jsonResponse(200, {
        receipt,
        domainPersistenceSummary,
        ...(courseSettingsReceipt ? { courseSettingsReceipt } : {}),
        ...(studentPreviewSessionReceipt ? { studentPreviewSessionReceipt } : {}),
        ...(studentRosterSyncReceipt ? { studentRosterSyncReceipt } : {}),
        ...(studentRosterProviderSyncReceipt ? { studentRosterProviderSyncReceipt } : {}),
        ...(studentGroupSuggestionReceipt ? { studentGroupSuggestionReceipt } : {}),
        ...(knowledgeIndexSyncReceipt ? { knowledgeIndexSyncReceipt } : {}),
        ...(knowledgeIndexProviderSyncReceipt ? { knowledgeIndexProviderSyncReceipt } : {}),
        ...(resourceReviewItemReceipt ? { resourceReviewItemReceipt } : {}),
        ...(courseContentPublishReceipt ? { courseContentPublishReceipt } : {}),
        ...(courseContentProviderPublishReceipt
          ? { courseContentProviderPublishReceipt }
          : {}),
        ...(courseUnitDraftReceipt ? { courseUnitDraftReceipt } : {}),
        ...(dashboardRefreshReceipt ? { dashboardRefreshReceipt } : {}),
        ...(dashboardSnapshotReceipt ? { dashboardSnapshotReceipt } : {}),
        ...(quizAssessmentReceipt ? { quizAssessmentReceipt } : {}),
        ...(quizItemReviewReceipt ? { quizItemReviewReceipt } : {}),
        ...(agentSettingsReceipt ? { agentSettingsReceipt } : {}),
        ...(agentPermissionPreflightReceipt ? { agentPermissionPreflightReceipt } : {}),
        ...(adminSettingsReceipt ? { adminSettingsReceipt } : {}),
        ...(collaborationInviteNotificationReceipt
          ? { collaborationInviteNotificationReceipt }
          : {}),
        ...(collaborationInviteEmailDeliveryReceipt
          ? { collaborationInviteEmailDeliveryReceipt }
          : {}),
        ...(courseExportManifestReceipt ? { courseExportManifestReceipt } : {}),
        ...(courseExportProviderReceipt ? { courseExportProviderReceipt } : {}),
        ...(courseExportRedactionValidationReceipt
          ? { courseExportRedactionValidationReceipt }
          : {}),
        ...(gradingQueueReceipt ? { gradingQueueReceipt } : {}),
        ...(gradingFeedbackDraftReceipt ? { gradingFeedbackDraftReceipt } : {}),
        ...(gradingFeedbackProviderReceipt ? { gradingFeedbackProviderReceipt } : {}),
        ...(inviteCodeDraftReceipt ? { inviteCodeDraftReceipt } : {}),
        ...(classInvitePublicationReceipt ? { classInvitePublicationReceipt } : {}),
        traceId,
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

type TeachingOperationDomainPersistenceEntry = {
  responseKey: string;
  objectType: string;
  receipt?: TeachingCourseManagementReceipt;
};

function createTeachingOperationDomainPersistenceSummary(input: {
  receipt: TeachingOperationReceipt;
  courseId?: string;
  entries: TeachingOperationDomainPersistenceEntry[];
}) {
  const expectedObjectTypes = readExpectedCourseManagementDomainObjectTypes({
    operationId: input.receipt.operationId,
    actionSlot: input.receipt.actionSlot,
  });
  const persistedEntries = input.entries.filter(
    (entry): entry is TeachingOperationDomainPersistenceEntry & {
      receipt: TeachingCourseManagementReceipt;
    } => entry.receipt?.status === "persisted",
  );
  const persistedObjectTypes = uniqueStrings(
    persistedEntries.map((entry) => entry.objectType),
  );
  const persistedResponseKeys = persistedEntries.map((entry) => entry.responseKey);
  const missingObjectTypes = expectedObjectTypes.filter(
    (objectType) => !persistedObjectTypes.includes(objectType),
  );
  const storageWritePolicies = uniqueStrings(
    persistedEntries.map((entry) => entry.receipt.storageWritePolicy),
  );
  const status =
    expectedObjectTypes.length === 0
      ? "not-required"
      : missingObjectTypes.length === 0
        ? "persisted"
        : "missing-domain-objects";

  return {
    status,
    required: expectedObjectTypes.length > 0,
    operationId: input.receipt.operationId,
    actionSlot: input.receipt.actionSlot,
    operationReceiptId: input.receipt.receiptId,
    ...(input.courseId ? { courseId: input.courseId } : {}),
    expectedObjectTypes,
    persistedObjectTypes,
    missingObjectTypes,
    persistedResponseKeys,
    receiptCount: persistedEntries.length,
    storageWritePolicies,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function readExpectedCourseManagementDomainObjectTypes(input: {
  operationId: string;
  actionSlot: TeachingOperationActionSlot;
}) {
  const key = `${input.operationId}:${input.actionSlot}`;
  const mapping: Record<string, string[]> = {
    "course-settings:primary": ["course-settings"],
    "course-settings:secondary": ["student-preview-session"],
    "agents:primary": ["agent-plan"],
    "agents:secondary": ["permission-preflight"],
    "knowledge-base:primary": ["knowledge-index"],
    "knowledge-base:secondary": ["resource-review-item"],
    "content:primary": ["course-content"],
    "content:secondary": ["unit-draft"],
    "admins:primary": ["admin-settings"],
    "admins:secondary": ["email-notification"],
    "students:primary": ["student-roster"],
    "students:secondary": ["group-suggestions"],
    "data-export:primary": ["export-manifest"],
    "data-export:secondary": ["redaction-validation"],
    "dashboard:primary": ["dashboard-state"],
    "dashboard:secondary": ["dashboard-snapshot"],
    "quiz-board:primary": ["quiz-board-state"],
    "quiz-board:secondary": ["quiz-item-review"],
    "grading:primary": ["grading-queue", "gradebook-update"],
    "grading:secondary": ["ai-feedback-draft"],
    "invite-code:primary": ["invite-code-draft"],
    "invite-code:secondary": ["enrollment-access"],
  };
  return mapping[key] ?? [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

async function persistTeachingOperationDomainObjects(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  body: Record<string, unknown>;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  const courseSettingsReceipt = await maybePersistCourseSettingsDomainObject(input);
  const studentPreviewSessionReceipt = await maybePersistStudentPreviewSessionDomainObject(input);
  const studentRosterSyncReceipt = await maybePersistStudentRosterSyncDomainObject(input);
  let studentRosterProviderSyncReceipt:
    | Awaited<ReturnType<typeof maybeSyncStudentRosterWithProvider>>
    | undefined;
  let studentRosterProviderSyncPartialFailure:
    | { error: unknown; failedStep: "student-roster-provider-sync" }
    | undefined;
  try {
    studentRosterProviderSyncReceipt = await maybeSyncStudentRosterWithProvider({
      ...input,
      rosterPersisted: Boolean(studentRosterSyncReceipt),
    });
  } catch (error) {
    if (
      shouldReturnStudentRosterProviderSyncPartialFailure({
        error,
        receipt: input.receipt,
        courseId: input.courseId,
        studentRosterReceipt: studentRosterSyncReceipt,
      })
    ) {
      studentRosterProviderSyncPartialFailure = {
        error,
        failedStep: "student-roster-provider-sync",
      };
    } else {
      throw error;
    }
  }
  const studentGroupSuggestionReceipt = await maybePersistStudentGroupSuggestionDomainObject(input);
  const knowledgeIndexSyncReceipt = await maybePersistKnowledgeIndexSyncDomainObject(input);
  let knowledgeIndexProviderSyncReceipt:
    | Awaited<ReturnType<typeof maybeSyncKnowledgeIndexWithProvider>>
    | undefined;
  let knowledgeIndexProviderSyncPartialFailure:
    | { error: unknown; failedStep: "knowledge-index-provider-sync" }
    | undefined;
  try {
    knowledgeIndexProviderSyncReceipt = await maybeSyncKnowledgeIndexWithProvider({
      ...input,
      indexPersisted: Boolean(knowledgeIndexSyncReceipt),
    });
  } catch (error) {
    if (
      shouldReturnKnowledgeIndexProviderSyncPartialFailure({
        error,
        receipt: input.receipt,
        courseId: input.courseId,
        knowledgeIndexReceipt: knowledgeIndexSyncReceipt,
      })
    ) {
      knowledgeIndexProviderSyncPartialFailure = {
        error,
        failedStep: "knowledge-index-provider-sync",
      };
    } else {
      throw error;
    }
  }
  const resourceReviewItemReceipt = await maybePersistResourceReviewItemDomainObject(input);
  const courseContentPublishReceipt = await maybePersistCourseContentPublishDomainObject(input);
  let courseContentProviderPublishReceipt:
    | Awaited<ReturnType<typeof maybePublishCourseContentWithProvider>>
    | undefined;
  let courseContentProviderPublishPartialFailure:
    | { error: unknown; failedStep: "course-content-provider-publish" }
    | undefined;
  try {
    courseContentProviderPublishReceipt = await maybePublishCourseContentWithProvider({
      ...input,
      contentPersisted: Boolean(courseContentPublishReceipt),
    });
  } catch (error) {
    if (
      shouldReturnCourseContentProviderPublishPartialFailure({
        error,
        receipt: input.receipt,
        courseId: input.courseId,
        courseContentReceipt: courseContentPublishReceipt,
      })
    ) {
      courseContentProviderPublishPartialFailure = {
        error,
        failedStep: "course-content-provider-publish",
      };
    } else {
      throw error;
    }
  }
  const courseUnitDraftReceipt = await maybePersistCourseUnitDraftDomainObject(input);
  const dashboardRefreshReceipt = await maybePersistDashboardRefreshDomainObject(input);
  const dashboardSnapshotReceipt = await maybePersistDashboardSnapshotDomainObject(input);
  const quizAssessmentReceipt = await maybePersistQuizAssessmentDomainObject(input);
  const quizItemReviewReceipt = await maybePersistQuizItemReviewDomainObject(input);
  const agentSettingsReceipt = await maybePersistAgentSettingsDomainObject(input);
  const agentPermissionPreflightReceipt =
    await maybePersistAgentPermissionPreflightDomainObject(input);
  const adminSettingsReceipt = await maybePersistAdminSettingsDomainObject(input);
  const collaborationInviteNotificationReceipt =
    await maybePersistCollaborationInviteNotificationDomainObject(input);
  let collaborationInviteEmailDeliveryReceipt:
    | Awaited<ReturnType<typeof maybeDeliverCollaborationInviteEmail>>
    | undefined;
  let collaborationInviteEmailDeliveryPartialFailure:
    | { error: unknown; failedStep: "collaboration-invite-email-delivery" }
    | undefined;
  try {
    collaborationInviteEmailDeliveryReceipt = await maybeDeliverCollaborationInviteEmail({
      ...input,
      notificationPersisted: Boolean(collaborationInviteNotificationReceipt),
    });
  } catch (error) {
    if (
      shouldReturnCollaborationInviteEmailDeliveryPartialFailure({
        error,
        receipt: input.receipt,
        courseId: input.courseId,
        notificationReceipt: collaborationInviteNotificationReceipt,
      })
    ) {
      collaborationInviteEmailDeliveryPartialFailure = {
        error,
        failedStep: "collaboration-invite-email-delivery",
      };
    } else {
      throw error;
    }
  }
  const courseExportManifestReceipt = await maybePersistCourseExportManifestDomainObject(input);
  let courseExportProviderReceipt:
    | Awaited<ReturnType<typeof maybeExportCourseDataWithProvider>>
    | undefined;
  let courseExportProviderPartialFailure:
    | { error: unknown; failedStep: "course-export-provider" }
    | undefined;
  try {
    courseExportProviderReceipt = await maybeExportCourseDataWithProvider({
      ...input,
      exportManifestPersisted: Boolean(courseExportManifestReceipt),
    });
  } catch (error) {
    if (
      shouldReturnCourseExportProviderPartialFailure({
        error,
        receipt: input.receipt,
        courseId: input.courseId,
        courseExportManifestReceipt,
      })
    ) {
      courseExportProviderPartialFailure = {
        error,
        failedStep: "course-export-provider",
      };
    } else {
      throw error;
    }
  }
  const courseExportRedactionValidationReceipt =
    await maybePersistCourseExportRedactionValidationDomainObject(input);
  const gradingQueueReceipt = await maybePersistGradingQueueDomainObject(input);
  const gradingFeedbackDraftReceipt = await maybePersistGradingFeedbackDraftDomainObject(input);
  let gradingFeedbackProviderReceipt:
    | Awaited<ReturnType<typeof maybeGenerateGradingFeedbackWithProvider>>
    | undefined;
  let gradingFeedbackProviderPartialFailure:
    | { error: unknown; failedStep: "grading-feedback-provider" }
    | undefined;
  try {
    gradingFeedbackProviderReceipt = await maybeGenerateGradingFeedbackWithProvider({
      ...input,
      gradingFeedbackDraftPersisted: Boolean(gradingFeedbackDraftReceipt),
    });
  } catch (error) {
    if (
      shouldReturnGradingFeedbackProviderPartialFailure({
        error,
        receipt: input.receipt,
        courseId: input.courseId,
        gradingFeedbackDraftReceipt,
      })
    ) {
      gradingFeedbackProviderPartialFailure = {
        error,
        failedStep: "grading-feedback-provider",
      };
    } else {
      throw error;
    }
  }
  const inviteCodeDraftReceipt = await maybePersistInviteCodeDraftDomainObject(input);

  return {
    courseSettingsReceipt,
    studentPreviewSessionReceipt,
    studentRosterSyncReceipt,
    studentRosterProviderSyncReceipt,
    studentRosterProviderSyncPartialFailure,
    studentGroupSuggestionReceipt,
    knowledgeIndexSyncReceipt,
    knowledgeIndexProviderSyncReceipt,
    knowledgeIndexProviderSyncPartialFailure,
    resourceReviewItemReceipt,
    courseContentPublishReceipt,
    courseContentProviderPublishReceipt,
    courseContentProviderPublishPartialFailure,
    courseUnitDraftReceipt,
    dashboardRefreshReceipt,
    dashboardSnapshotReceipt,
    quizAssessmentReceipt,
    quizItemReviewReceipt,
    agentSettingsReceipt,
    agentPermissionPreflightReceipt,
    adminSettingsReceipt,
    collaborationInviteNotificationReceipt,
    collaborationInviteEmailDeliveryReceipt,
    collaborationInviteEmailDeliveryPartialFailure,
    courseExportManifestReceipt,
    courseExportProviderReceipt,
    courseExportProviderPartialFailure,
    courseExportRedactionValidationReceipt,
    gradingQueueReceipt,
    gradingFeedbackDraftReceipt,
    gradingFeedbackProviderReceipt,
    gradingFeedbackProviderPartialFailure,
    inviteCodeDraftReceipt,
  };
}

async function maybePersistCourseSettingsDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  body: Record<string, unknown>;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "course-settings" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseSettingsRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    ...(isRecord(input.body.courseSettingsPatch)
      ? { settingsPatch: input.body.courseSettingsPatch }
      : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistStudentPreviewSessionDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "course-settings" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingStudentPreviewSessionRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistStudentRosterSyncDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "students" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingStudentRosterSyncRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybeSyncStudentRosterWithProvider(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  rosterPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "students" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId ||
    !input.rosterPersisted
  ) {
    return undefined;
  }
  const providerConfig = readStudentRosterSyncProviderConfig(input.env);
  if (!providerConfig) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
  });
  const rosterId = `student-roster-${input.courseId}`;
  const studentRoster = snapshot.database.studentRosters?.find(
    (roster) =>
      roster.rosterId === rosterId && roster.operationRecordId === input.receipt.receiptId,
  );
  if (!studentRoster) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching student roster sync record was not found.",
    );
  }
  if (studentRoster.providerStatus === "sis-provider-synced" && studentRoster.providerSyncId) {
    return undefined;
  }

  const fetchImpl = input.fetch ?? fetch;
  const providerResponse = await fetchImpl(providerConfig.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${providerConfig.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "sync-student-roster",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      rosterId: studentRoster.rosterId,
      approvedStudentCount: studentRoster.approvedStudentCount,
      pendingTeacherReviewCount: studentRoster.pendingTeacherReviewCount,
      classCount: studentRoster.classCount,
      sourceSystems: studentRoster.sourceSystems,
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Student roster sync provider failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerSyncId = readProviderSyncId(providerBody);

  const { receipt } = await markTeachingStudentRosterProviderSynced({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    providerSyncId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "sync-student-roster-provider" as const,
    status: "synced" as const,
    providerStatus: "sis-provider-synced" as const,
    providerSyncId,
    rosterId: studentRoster.rosterId,
  };
}

async function maybePersistStudentGroupSuggestionDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "students" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingStudentGroupSuggestionRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistKnowledgeIndexSyncDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "knowledge-base" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingKnowledgeIndexSyncRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybeSyncKnowledgeIndexWithProvider(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  indexPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "knowledge-base" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId ||
    !input.indexPersisted
  ) {
    return undefined;
  }
  const providerConfig = readKnowledgeIndexSyncProviderConfig(input.env);
  if (!providerConfig) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
  });
  const indexId = `knowledge-index-${input.courseId}`;
  const knowledgeIndex = snapshot.database.knowledgeIndexes?.find(
    (item) => item.indexId === indexId && item.operationRecordId === input.receipt.receiptId,
  );
  if (!knowledgeIndex) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching knowledge index sync record was not found.",
    );
  }
  if (
    knowledgeIndex.providerStatus === "knowledge-provider-synced" &&
    knowledgeIndex.providerSyncId
  ) {
    return undefined;
  }

  const fetchImpl = input.fetch ?? fetch;
  const providerResponse = await fetchImpl(providerConfig.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${providerConfig.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "sync-knowledge-index",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      indexId: knowledgeIndex.indexId,
      syncStatus: knowledgeIndex.syncStatus,
      sourceSystems: knowledgeIndex.sourceSystems,
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Knowledge index sync provider failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerSyncId = readKnowledgeProviderSyncId(providerBody);

  const { receipt } = await markTeachingKnowledgeIndexProviderSynced({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    providerSyncId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "sync-knowledge-index-provider" as const,
    status: "synced" as const,
    providerStatus: "knowledge-provider-synced" as const,
    providerSyncId,
    indexId: knowledgeIndex.indexId,
  };
}

async function maybePersistResourceReviewItemDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "knowledge-base" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingResourceReviewItemRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistCourseContentPublishDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "content" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseContentPublishRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePublishCourseContentWithProvider(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  contentPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "content" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId ||
    !input.contentPersisted
  ) {
    return undefined;
  }
  const providerConfig = readCourseContentPublishProviderConfig(input.env);
  if (!providerConfig) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
  });
  const contentId = `course-content-${input.courseId}`;
  const contentPackage = snapshot.database.contentPackages?.find(
    (item) =>
      item.contentId === contentId && item.operationRecordId === input.receipt.receiptId,
  );
  if (!contentPackage) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching course content publish record was not found.",
    );
  }
  if (
    contentPackage.providerStatus === "content-provider-published" &&
    contentPackage.providerPublishId
  ) {
    return undefined;
  }

  const fetchImpl = input.fetch ?? fetch;
  const providerResponse = await fetchImpl(providerConfig.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${providerConfig.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "publish-course-content",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      contentId: contentPackage.contentId,
      releaseScope: contentPackage.releaseScope,
      publicationStatus: contentPackage.publicationStatus,
      publishedAt: contentPackage.publishedAt,
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Course content publish provider failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerPublishId = readProviderPublishId(providerBody);

  const { receipt } = await markTeachingCourseContentProviderPublished({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    providerPublishId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "publish-course-content-provider" as const,
    status: "published" as const,
    providerStatus: "content-provider-published" as const,
    providerPublishId,
    contentId: contentPackage.contentId,
  };
}

async function maybePersistCourseUnitDraftDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "content" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseUnitDraftRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistDashboardRefreshDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "dashboard" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseDashboardRefreshRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistDashboardSnapshotDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "dashboard" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  const dashboardSnapshotArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is Extract<
      TeachingOperationReceipt["artifacts"][number],
      { kind: "dashboard-snapshot" }
    > => artifact.kind === "dashboard-snapshot",
  );
  if (!dashboardSnapshotArtifact) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseDashboardSnapshotRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    teachingOperationSnapshotId: dashboardSnapshotArtifact.snapshotId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });
  return receipt;
}

async function maybePersistQuizAssessmentDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "quiz-board" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseQuizAssessmentRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistQuizItemReviewDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "quiz-board" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseQuizItemReviewRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistAdminSettingsDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "admins" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingAdminSettingsRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistAgentSettingsDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "agents" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingAgentSettingsRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistAgentPermissionPreflightDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "agents" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingAgentPermissionPreflightRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistCollaborationInviteNotificationDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "admins" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  const outboxArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is Extract<TeachingOperationReceipt["artifacts"][number], { kind: "outbox" }> =>
      artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
  );
  if (!outboxArtifact) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCollaborationInviteNotificationRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    outboxId: outboxArtifact.outboxId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybeDeliverCollaborationInviteEmail(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  notificationPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "admins" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId ||
    !input.notificationPersisted
  ) {
    return undefined;
  }
  const providerConfig = readCollaborationInviteEmailProviderConfig(input.env);
  if (!providerConfig) {
    return undefined;
  }
  const outboxArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is Extract<TeachingOperationReceipt["artifacts"][number], { kind: "outbox" }> =>
      artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
  );
  if (!outboxArtifact) {
    return undefined;
  }
  if (
    input.receipt.idempotencyStatus === "already-persisted" &&
    (await hasDeliveredCollaborationInviteEmailNotification({
      env: input.env,
      fetch: input.fetch,
      courseId: input.courseId,
      operationRecordId: input.receipt.receiptId,
      outboxId: outboxArtifact.outboxId,
    }))
  ) {
    return undefined;
  }

  const fetchImpl = input.fetch ?? fetch;
  const providerResponse = await fetchImpl(providerConfig.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${providerConfig.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "deliver-collaboration-invite-email",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      outboxId: outboxArtifact.outboxId,
      deliveryChannel: "collaboration-invite-email",
      templateId: "uais-collaboration-invite-v1",
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Collaboration invite email provider delivery failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerDeliveryId = readProviderDeliveryId(providerBody);

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }
  const { receipt } = await markTeachingCollaborationInviteNotificationDelivered({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    outboxId: outboxArtifact.outboxId,
    providerDeliveryId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "deliver-collaboration-invite-email" as const,
    status: "delivered" as const,
    providerStatus: "smtp-provider-delivered" as const,
    deliveryId: providerDeliveryId,
    outboxId: outboxArtifact.outboxId,
  };
}

async function hasDeliveredCollaborationInviteEmailNotification(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  courseId: string;
  operationRecordId: string;
  outboxId: string;
}) {
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return false;
  }
  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }
  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
  });
  return Boolean(
    snapshot.database.collaborationInviteNotifications?.some(
      (notification) =>
        notification.courseId === input.courseId &&
        notification.operationRecordId === input.operationRecordId &&
        notification.outboxId === input.outboxId &&
        notification.notificationStatus === "delivered-to-provider",
    ),
  );
}

async function maybePersistCourseExportManifestDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "data-export" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  const exportFileArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is Extract<TeachingOperationReceipt["artifacts"][number], { kind: "export-file" }> =>
      artifact.kind === "export-file",
  );
  if (!exportFileArtifact) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseExportManifestRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    teachingOperationManifestId: exportFileArtifact.manifestId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybeExportCourseDataWithProvider(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  exportManifestPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "data-export" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId ||
    !input.exportManifestPersisted
  ) {
    return undefined;
  }
  const providerConfig = readCourseExportProviderConfig(input.env);
  if (!providerConfig) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
  });
  const exportManifestId = `export-manifest-${input.courseId}`;
  const exportManifest = snapshot.database.exportManifests?.find(
    (item) =>
      item.exportManifestId === exportManifestId &&
      item.operationRecordId === input.receipt.receiptId,
  );
  if (!exportManifest) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching export manifest record was not found.",
    );
  }
  if (
    exportManifest.providerStatus === "export-provider-exported" &&
    exportManifest.providerExportId
  ) {
    return undefined;
  }

  const fetchImpl = input.fetch ?? fetch;
  const providerResponse = await fetchImpl(providerConfig.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${providerConfig.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "export-course-data",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      exportManifestId: exportManifest.exportManifestId,
      teachingOperationManifestId: exportManifest.teachingOperationManifestId,
      downloadRoute: exportManifest.downloadRoute,
      datasetScopes: exportManifest.datasetScopes,
      formats: exportManifest.formats,
      exportPolicy: exportManifest.exportPolicy,
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Course export provider failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerExportId = readProviderExportId(providerBody);

  const { receipt } = await markTeachingCourseExportProviderExported({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    providerExportId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "export-course-data-provider" as const,
    status: "exported" as const,
    providerStatus: "export-provider-exported" as const,
    providerExportId,
    exportManifestId: exportManifest.exportManifestId,
    teachingOperationManifestId: exportManifest.teachingOperationManifestId,
  };
}

async function maybePersistCourseExportRedactionValidationDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "data-export" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingCourseExportRedactionValidationRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistGradingQueueDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "grading" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingGradingQueueRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybePersistGradingFeedbackDraftDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "grading" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }
  const feedbackArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is TeachingOperationReceipt["artifacts"][number] & {
      kind: "ai-feedback";
      artifactId: string;
    } =>
      artifact.kind === "ai-feedback" &&
      "artifactId" in artifact &&
      typeof artifact.artifactId === "string",
  );
  if (!feedbackArtifact) {
    return undefined;
  }
  if (
    !isTeachingCourseManagementPersistenceConfigured(input.env) &&
    !isTeachingOperationProductionRuntime(input.env)
  ) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingGradingFeedbackDraftRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    teachingOperationFeedbackArtifactId: feedbackArtifact.artifactId,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    traceId: input.traceId,
    audit: {
      requestSource: input.requestSource,
    },
    now: input.now,
  });
  return receipt;
}

async function maybeGenerateGradingFeedbackWithProvider(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  gradingFeedbackDraftPersisted: boolean;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "grading" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId ||
    !input.gradingFeedbackDraftPersisted
  ) {
    return undefined;
  }
  const providerConfig = readGradingFeedbackProviderConfig(input.env);
  if (!providerConfig) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
  });
  const gradingFeedbackDraftId = `grading-feedback-draft-${input.courseId}`;
  const gradingFeedbackDraft = snapshot.database.gradingFeedbackDrafts?.find(
    (item) =>
      item.gradingFeedbackDraftId === gradingFeedbackDraftId &&
      item.operationRecordId === input.receipt.receiptId,
  );
  if (!gradingFeedbackDraft) {
    throw new TeachingCourseManagementStoreError(
      404,
      "Teaching grading feedback draft record was not found.",
    );
  }
  if (
    gradingFeedbackDraft.providerStatus === "feedback-provider-generated" &&
    gradingFeedbackDraft.providerFeedbackId
  ) {
    return undefined;
  }

  const fetchImpl = input.fetch ?? fetch;
  const providerResponse = await fetchImpl(providerConfig.url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${providerConfig.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "generate-grading-feedback",
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      traceId: input.traceId,
      operationRecordId: input.receipt.receiptId,
      gradingFeedbackDraftId: gradingFeedbackDraft.gradingFeedbackDraftId,
      teachingOperationFeedbackArtifactId:
        gradingFeedbackDraft.teachingOperationFeedbackArtifactId,
      feedbackScope: gradingFeedbackDraft.feedbackScope,
      reviewPolicy: gradingFeedbackDraft.reviewPolicy,
      releasePolicy: gradingFeedbackDraft.releasePolicy,
      redaction: createRedaction(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!providerResponse.ok) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Grading feedback provider failed.",
    );
  }
  const providerBody = await providerResponse.json();
  const providerFeedbackId = readProviderFeedbackId(providerBody);

  const { receipt } = await markTeachingGradingFeedbackProviderGenerated({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    operationRecordId: input.receipt.receiptId,
    providerFeedbackId,
    audit: {
      requestSource: input.requestSource,
    },
    traceId: input.traceId,
    now: input.now,
  });

  return {
    ...receipt,
    action: "generate-grading-feedback-provider" as const,
    status: "generated" as const,
    providerStatus: "feedback-provider-generated" as const,
    providerFeedbackId,
    gradingFeedbackDraftId: gradingFeedbackDraft.gradingFeedbackDraftId,
  };
}

async function maybePersistInviteCodeDraftDomainObject(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  body: Record<string, unknown>;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "invite-code" ||
    input.receipt.actionSlot !== "primary" ||
    !input.courseId
  ) {
    return undefined;
  }

  const targetClassId = readTargetClassId(input.body);
  if (!targetClassId) {
    return undefined;
  }

  const invitationCode = readGeneratedInviteCode(input.receipt);
  if (!invitationCode) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await saveTeachingClassInviteCodeDraftRecord({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    classId: targetClassId,
    operationRecordId: input.receipt.receiptId,
    invitationCode,
    ...(input.receipt.sourceAction ? { sourceAction: input.receipt.sourceAction } : {}),
    audit: { requestSource: input.requestSource },
    traceId: input.traceId,
    now: input.now,
  });
  return receipt;
}

function preflightProductionCourseManagementPersistence(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  operationId: string;
  actionSlot: TeachingOperationActionSlot;
}) {
  if (!isTeachingOperationProductionRuntime(input.env)) {
    return;
  }

  const expectedObjectTypes = readExpectedCourseManagementDomainObjectTypes({
    operationId: input.operationId,
    actionSlot: input.actionSlot,
  });
  if (expectedObjectTypes.length === 0) {
    return;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }
}

function preflightProductionProviderSideEffects(input: {
  env: Record<string, string | undefined>;
  operationId: string;
  actionSlot: TeachingOperationActionSlot;
}) {
  if (!isTeachingOperationProductionRuntime(input.env)) {
    return;
  }

  if (input.operationId === "students" && input.actionSlot === "primary") {
    assertProviderSideEffectConfigured(
      readStudentRosterSyncProviderConfig(input.env),
      "Student roster sync provider is not configured.",
    );
    return;
  }
  if (input.operationId === "knowledge-base" && input.actionSlot === "primary") {
    assertProviderSideEffectConfigured(
      readKnowledgeIndexSyncProviderConfig(input.env),
      "Knowledge index sync provider is not configured.",
    );
    return;
  }
  if (input.operationId === "content" && input.actionSlot === "primary") {
    assertProviderSideEffectConfigured(
      readCourseContentPublishProviderConfig(input.env),
      "Course content publish provider is not configured.",
    );
    return;
  }
  if (input.operationId === "admins" && input.actionSlot === "secondary") {
    assertProviderSideEffectConfigured(
      readCollaborationInviteEmailProviderConfig(input.env),
      "Collaboration invite email provider is not configured.",
    );
    return;
  }
  if (input.operationId === "data-export" && input.actionSlot === "primary") {
    assertProviderSideEffectConfigured(
      readCourseExportProviderConfig(input.env),
      "Course export provider is not configured.",
    );
    return;
  }
  if (input.operationId === "grading" && input.actionSlot === "secondary") {
    assertProviderSideEffectConfigured(
      readGradingFeedbackProviderConfig(input.env),
      "Grading feedback provider is not configured.",
    );
  }
}

function assertProviderSideEffectConfigured(
  config: { url: string; token: string } | undefined,
  message: string,
) {
  if (!config) {
    throw new TeachingCourseManagementStoreError(503, message);
  }
}

async function preflightClassInvitePublishTarget(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  body: Record<string, unknown>;
  operationId: string;
  actionSlot: TeachingOperationActionSlot;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
}) {
  if (input.operationId !== "invite-code" || input.actionSlot !== "secondary" || !input.courseId) {
    return;
  }

  const targetClassId = readTargetClassId(input.body);
  if (!targetClassId) {
    return;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  await assertTeachingClassInviteCodePublishTarget({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    classId: targetClassId,
  });
}

function isTeachingCourseManagementPersistenceConfigured(
  env: Record<string, string | undefined>,
) {
  return Boolean(
    env.UAIS_TEACHING_COURSES_DATA_DIR?.trim() ||
      env.UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND?.trim(),
  );
}

async function maybePublishClassInviteCode(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  body: Record<string, unknown>;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  traceId: string;
  requestSource: TeachingOperationAuditRequestSource;
  now?: Date;
}) {
  if (
    input.receipt.operationId !== "invite-code" ||
    input.receipt.actionSlot !== "secondary" ||
    !input.courseId
  ) {
    return undefined;
  }

  const targetClassId = readTargetClassId(input.body);
  if (!targetClassId) {
    return undefined;
  }

  const invitationCode = readPublishedInviteCode(input.receipt);
  if (!invitationCode) {
    return undefined;
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { receipt } = await publishTeachingClassInviteCode({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository: courseManagementRepository,
    actorId: input.authenticatedTeacher.actorId,
    courseId: input.courseId,
    classId: targetClassId,
    invitationCode,
    audit: { requestSource: input.requestSource },
    traceId: input.traceId,
    now: input.now,
  });
  return receipt;
}

function readTargetClassId(body: Record<string, unknown>) {
  const rawValue =
    typeof body.targetClassId === "string"
      ? body.targetClassId
      : typeof body.classId === "string"
        ? body.classId
        : undefined;
  const normalized = rawValue?.trim();
  return normalized || undefined;
}

function assertSafeInviteTargetClassId(input: {
  body: Record<string, unknown>;
  operationId: string;
  actionSlot: TeachingOperationActionSlot;
}) {
  if (input.operationId !== "invite-code") {
    return;
  }

  const targetClassId = readTargetClassId(input.body);
  if (!targetClassId || isSafeTeachingOperationId(targetClassId)) {
    return;
  }

  throw new TeachingOperationStoreError(
    400,
    "UAIS teaching operation target class id is invalid.",
  );
}

function readGeneratedInviteCode(receipt: TeachingOperationReceipt) {
  const artifact = receipt.artifacts.find(
    (
      value,
    ): value is Extract<TeachingOperationReceipt["artifacts"][number], { kind: "invite-code" }> =>
      value.kind === "invite-code" && value.status === "generated",
  );
  return artifact?.code;
}

function readPublishedInviteCode(receipt: TeachingOperationReceipt) {
  const artifact = receipt.artifacts.find(
    (
      value,
    ): value is Extract<TeachingOperationReceipt["artifacts"][number], { kind: "invite-code" }> =>
      value.kind === "invite-code" && value.status === "published",
  );
  return artifact?.code;
}

function shouldReturnCourseManagementDomainObjectPartialFailure(input: {
  error: unknown;
  receipt: TeachingOperationReceipt;
  courseId?: string;
}) {
  return (
    input.error instanceof TeachingCourseManagementStoreError &&
    input.receipt.status === "persisted" &&
    Boolean(input.courseId)
  );
}

function shouldReturnCollaborationInviteEmailDeliveryPartialFailure(input: {
  error: unknown;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  notificationReceipt?: TeachingCourseManagementReceipt;
}) {
  return (
    input.error instanceof TeachingCourseManagementStoreError &&
    input.receipt.operationId === "admins" &&
    input.receipt.actionSlot === "secondary" &&
    input.receipt.status === "persisted" &&
    Boolean(input.courseId) &&
    Boolean(input.notificationReceipt)
  );
}

function shouldReturnStudentRosterProviderSyncPartialFailure(input: {
  error: unknown;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  studentRosterReceipt?: TeachingCourseManagementReceipt;
}) {
  return (
    input.error instanceof TeachingCourseManagementStoreError &&
    input.receipt.operationId === "students" &&
    input.receipt.actionSlot === "primary" &&
    input.receipt.status === "persisted" &&
    Boolean(input.courseId) &&
    Boolean(input.studentRosterReceipt)
  );
}

function shouldReturnKnowledgeIndexProviderSyncPartialFailure(input: {
  error: unknown;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  knowledgeIndexReceipt?: TeachingCourseManagementReceipt;
}) {
  return (
    input.error instanceof TeachingCourseManagementStoreError &&
    input.receipt.operationId === "knowledge-base" &&
    input.receipt.actionSlot === "primary" &&
    input.receipt.status === "persisted" &&
    Boolean(input.courseId) &&
    Boolean(input.knowledgeIndexReceipt)
  );
}

function shouldReturnCourseContentProviderPublishPartialFailure(input: {
  error: unknown;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  courseContentReceipt?: TeachingCourseManagementReceipt;
}) {
  return (
    input.error instanceof TeachingCourseManagementStoreError &&
    input.receipt.operationId === "content" &&
    input.receipt.actionSlot === "primary" &&
    input.receipt.status === "persisted" &&
    Boolean(input.courseId) &&
    Boolean(input.courseContentReceipt)
  );
}

function shouldReturnCourseExportProviderPartialFailure(input: {
  error: unknown;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  courseExportManifestReceipt?: TeachingCourseManagementReceipt;
}) {
  return (
    input.error instanceof TeachingCourseManagementStoreError &&
    input.receipt.operationId === "data-export" &&
    input.receipt.actionSlot === "primary" &&
    input.receipt.status === "persisted" &&
    Boolean(input.courseId) &&
    Boolean(input.courseExportManifestReceipt)
  );
}

function shouldReturnGradingFeedbackProviderPartialFailure(input: {
  error: unknown;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  gradingFeedbackDraftReceipt?: TeachingCourseManagementReceipt;
}) {
  return (
    input.error instanceof TeachingCourseManagementStoreError &&
    input.receipt.operationId === "grading" &&
    input.receipt.actionSlot === "secondary" &&
    input.receipt.status === "persisted" &&
    Boolean(input.courseId) &&
    Boolean(input.gradingFeedbackDraftReceipt)
  );
}

function shouldReturnClassInvitePublicationPartialFailure(input: {
  receipt: TeachingOperationReceipt;
  courseId?: string;
  targetClassId?: string;
}) {
  return (
    input.receipt.operationId === "invite-code" &&
    input.receipt.actionSlot === "secondary" &&
    Boolean(input.courseId) &&
    Boolean(input.targetClassId)
  );
}

function createCollaborationInviteEmailDeliveryPartialFailureResponse(input: {
  error: unknown;
  traceId: string;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  collaborationInviteNotificationReceipt?: TeachingCourseManagementReceipt;
}) {
  const routeError = normalizeTeachingOperationRouteError(input.error);
  const outboxArtifact = input.receipt.artifacts.find(
    (
      artifact,
    ): artifact is Extract<TeachingOperationReceipt["artifacts"][number], { kind: "outbox" }> =>
      artifact.kind === "outbox" && artifact.channel === "collaboration-invite",
  );
  return jsonResponse(routeError.status, {
    error: routeError.message,
    traceId: input.traceId,
    receipt: input.receipt,
    ...(input.collaborationInviteNotificationReceipt
      ? {
          collaborationInviteNotificationReceipt:
            input.collaborationInviteNotificationReceipt,
        }
      : {}),
    partialFailure: {
      status: "operation-persisted-collaboration-invite-email-delivery-failed",
      failedStep: "collaboration-invite-email-delivery",
      operationReceiptId: input.receipt.receiptId,
      ...(input.collaborationInviteNotificationReceipt
        ? { notificationReceiptId: input.collaborationInviteNotificationReceipt.receiptId }
        : {}),
      operationId: input.receipt.operationId,
      actionSlot: input.receipt.actionSlot,
      ...(input.courseId ? { courseId: input.courseId } : {}),
      ...(outboxArtifact ? { outboxId: outboxArtifact.outboxId } : {}),
      providerStatus: "smtp-provider-pending",
      recoveryAction: "retry-collaboration-invite-email-provider",
      responsibleSession: "S12",
      redaction: createRedaction(),
    },
    redaction: createRedaction(),
  }, input.traceId);
}

function createStudentRosterProviderSyncPartialFailureResponse(input: {
  error: unknown;
  traceId: string;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  studentRosterSyncReceipt?: TeachingCourseManagementReceipt;
}) {
  const routeError = normalizeTeachingOperationRouteError(input.error);
  return jsonResponse(routeError.status, {
    error: routeError.message,
    ...(routeError.diagnostics ? { diagnostics: routeError.diagnostics } : {}),
    traceId: input.traceId,
    receipt: input.receipt,
    ...(input.studentRosterSyncReceipt
      ? { studentRosterSyncReceipt: input.studentRosterSyncReceipt }
      : {}),
    partialFailure: {
      status: "operation-persisted-student-roster-provider-sync-failed",
      failedStep: "student-roster-provider-sync",
      operationReceiptId: input.receipt.receiptId,
      ...(input.studentRosterSyncReceipt
        ? { domainReceiptId: input.studentRosterSyncReceipt.receiptId }
        : {}),
      operationId: input.receipt.operationId,
      actionSlot: input.receipt.actionSlot,
      ...(input.courseId ? { courseId: input.courseId } : {}),
      providerStatus: "sis-provider-pending",
      recoveryAction: "retry-student-roster-sync-provider",
      responsibleSession: "S12",
      redaction: createRedaction(),
    },
    redaction: createRedaction(),
  }, input.traceId);
}

function createKnowledgeIndexProviderSyncPartialFailureResponse(input: {
  error: unknown;
  traceId: string;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  knowledgeIndexSyncReceipt?: TeachingCourseManagementReceipt;
}) {
  const routeError = normalizeTeachingOperationRouteError(input.error);
  return jsonResponse(routeError.status, {
    error: routeError.message,
    ...(routeError.diagnostics ? { diagnostics: routeError.diagnostics } : {}),
    traceId: input.traceId,
    receipt: input.receipt,
    ...(input.knowledgeIndexSyncReceipt
      ? { knowledgeIndexSyncReceipt: input.knowledgeIndexSyncReceipt }
      : {}),
    partialFailure: {
      status: "operation-persisted-knowledge-index-provider-sync-failed",
      failedStep: "knowledge-index-provider-sync",
      operationReceiptId: input.receipt.receiptId,
      ...(input.knowledgeIndexSyncReceipt
        ? { domainReceiptId: input.knowledgeIndexSyncReceipt.receiptId }
        : {}),
      operationId: input.receipt.operationId,
      actionSlot: input.receipt.actionSlot,
      ...(input.courseId ? { courseId: input.courseId } : {}),
      providerStatus: "knowledge-provider-pending",
      recoveryAction: "retry-knowledge-index-sync-provider",
      responsibleSession: "S12",
      redaction: createRedaction(),
    },
    redaction: createRedaction(),
  }, input.traceId);
}

function createCourseContentProviderPublishPartialFailureResponse(input: {
  error: unknown;
  traceId: string;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  courseContentPublishReceipt?: TeachingCourseManagementReceipt;
}) {
  const routeError = normalizeTeachingOperationRouteError(input.error);
  return jsonResponse(routeError.status, {
    error: routeError.message,
    ...(routeError.diagnostics ? { diagnostics: routeError.diagnostics } : {}),
    traceId: input.traceId,
    receipt: input.receipt,
    ...(input.courseContentPublishReceipt
      ? { courseContentPublishReceipt: input.courseContentPublishReceipt }
      : {}),
    partialFailure: {
      status: "operation-persisted-course-content-provider-publish-failed",
      failedStep: "course-content-provider-publish",
      operationReceiptId: input.receipt.receiptId,
      ...(input.courseContentPublishReceipt
        ? { domainReceiptId: input.courseContentPublishReceipt.receiptId }
        : {}),
      operationId: input.receipt.operationId,
      actionSlot: input.receipt.actionSlot,
      ...(input.courseId ? { courseId: input.courseId } : {}),
      providerStatus: "content-provider-pending",
      recoveryAction: "retry-course-content-publish-provider",
      responsibleSession: "S12",
      redaction: createRedaction(),
    },
    redaction: createRedaction(),
  }, input.traceId);
}

function createCourseExportProviderPartialFailureResponse(input: {
  error: unknown;
  traceId: string;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  courseExportManifestReceipt?: TeachingCourseManagementReceipt;
}) {
  const routeError = normalizeTeachingOperationRouteError(input.error);
  return jsonResponse(routeError.status, {
    error: routeError.message,
    ...(routeError.diagnostics ? { diagnostics: routeError.diagnostics } : {}),
    traceId: input.traceId,
    receipt: input.receipt,
    ...(input.courseExportManifestReceipt
      ? { courseExportManifestReceipt: input.courseExportManifestReceipt }
      : {}),
    partialFailure: {
      status: "operation-persisted-course-export-provider-failed",
      failedStep: "course-export-provider",
      operationReceiptId: input.receipt.receiptId,
      ...(input.courseExportManifestReceipt
        ? { domainReceiptId: input.courseExportManifestReceipt.receiptId }
        : {}),
      operationId: input.receipt.operationId,
      actionSlot: input.receipt.actionSlot,
      ...(input.courseId ? { courseId: input.courseId } : {}),
      providerStatus: "export-provider-pending",
      recoveryAction: "retry-course-export-provider",
      responsibleSession: "S12",
      redaction: createRedaction(),
    },
    redaction: createRedaction(),
  }, input.traceId);
}

function createGradingFeedbackProviderPartialFailureResponse(input: {
  error: unknown;
  traceId: string;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  gradingFeedbackDraftReceipt?: TeachingCourseManagementReceipt;
}) {
  const routeError = normalizeTeachingOperationRouteError(input.error);
  return jsonResponse(routeError.status, {
    error: routeError.message,
    ...(routeError.diagnostics ? { diagnostics: routeError.diagnostics } : {}),
    traceId: input.traceId,
    receipt: input.receipt,
    ...(input.gradingFeedbackDraftReceipt
      ? { gradingFeedbackDraftReceipt: input.gradingFeedbackDraftReceipt }
      : {}),
    partialFailure: {
      status: "operation-persisted-grading-feedback-provider-failed",
      failedStep: "grading-feedback-provider",
      operationReceiptId: input.receipt.receiptId,
      ...(input.gradingFeedbackDraftReceipt
        ? { domainReceiptId: input.gradingFeedbackDraftReceipt.receiptId }
        : {}),
      operationId: input.receipt.operationId,
      actionSlot: input.receipt.actionSlot,
      ...(input.courseId ? { courseId: input.courseId } : {}),
      providerStatus: "feedback-provider-pending",
      recoveryAction: "retry-grading-feedback-provider",
      responsibleSession: "S12",
      redaction: createRedaction(),
    },
    redaction: createRedaction(),
  }, input.traceId);
}

function createClassInvitePublicationPartialFailureResponse(input: {
  error: unknown;
  traceId: string;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  targetClassId?: string;
  compensation: TeachingOperationPartialFailureCompensation;
}) {
  const routeError = normalizeTeachingOperationRouteError(input.error);
  return jsonResponse(routeError.status, {
    error: routeError.message,
    ...(routeError.diagnostics ? { diagnostics: routeError.diagnostics } : {}),
    traceId: input.traceId,
    receipt: input.receipt,
    partialFailure: {
      status: "operation-persisted-class-invite-publication-failed",
      failedStep: "class-invite-publication",
      operationReceiptId: input.receipt.receiptId,
      operationId: input.receipt.operationId,
      actionSlot: input.receipt.actionSlot,
      ...(input.courseId ? { courseId: input.courseId } : {}),
      ...(input.targetClassId ? { targetClassId: input.targetClassId } : {}),
      rollbackRoute: `/api/teaching/operations/records/${input.receipt.receiptId}/rollback`,
      responsibleSession: "S12",
      compensation: input.compensation,
      redaction: createRedaction(),
    },
    redaction: createRedaction(),
  }, input.traceId);
}

function createCourseManagementDomainObjectPartialFailureResponse(input: {
  error: unknown;
  traceId: string;
  receipt: TeachingOperationReceipt;
  courseId?: string;
  compensation: TeachingOperationPartialFailureCompensation;
}) {
  const routeError = normalizeTeachingOperationRouteError(input.error);
  return jsonResponse(routeError.status, {
    error: routeError.message,
    ...(routeError.diagnostics ? { diagnostics: routeError.diagnostics } : {}),
    traceId: input.traceId,
    receipt: input.receipt,
    partialFailure: {
      status: "operation-persisted-course-management-domain-object-failed",
      failedStep: "course-management-domain-object",
      operationReceiptId: input.receipt.receiptId,
      operationId: input.receipt.operationId,
      actionSlot: input.receipt.actionSlot,
      ...(input.courseId ? { courseId: input.courseId } : {}),
      rollbackRoute: `/api/teaching/operations/records/${input.receipt.receiptId}/rollback`,
      responsibleSession: "S12",
      compensation: input.compensation,
      redaction: createRedaction(),
    },
    redaction: createRedaction(),
  }, input.traceId);
}

type TeachingOperationPartialFailureRollbackReason =
  | "class-invite-publication-failed"
  | "course-management-domain-object-failed";

type TeachingOperationPartialFailureCompensation =
  | {
      status: "rolled-back";
      action: "rollback-teaching-operation-record";
      rollbackReason: TeachingOperationPartialFailureRollbackReason;
      receipt: TeachingOperationRollbackReceipt;
      responsibleSession: "S12";
      redaction: ReturnType<typeof createRedaction>;
    }
  | {
      status: "rollback-unavailable" | "rollback-failed";
      action: "rollback-teaching-operation-record";
      rollbackReason: TeachingOperationPartialFailureRollbackReason;
      rollbackRoute: string;
      error: string;
      responsibleSession: "S12";
      redaction: ReturnType<typeof createRedaction>;
    };

async function attemptTeachingOperationPartialFailureCompensation(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  request: Request;
  receipt: TeachingOperationReceipt;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId: string;
  traceId: string;
  rollbackReason: TeachingOperationPartialFailureRollbackReason;
  rollbackExternalTeachingOperation?: TeachingOperationExternalRollbackAdapter;
  now?: Date;
}): Promise<TeachingOperationPartialFailureCompensation> {
  const rollbackReason = input.rollbackReason;
  const rollbackRoute = `/api/teaching/operations/records/${input.receipt.receiptId}/rollback`;
  const createdAt = (input.now ?? new Date()).toISOString();
  const requestSource = readAuditRequestSource(input.request);

  try {
    const rollbackExternalTeachingOperation =
      input.rollbackExternalTeachingOperation ??
      createUaisTeachingOperationExternalRollbackAdapter({
        env: input.env,
        fetch: input.fetch,
      });

    if (rollbackExternalTeachingOperation) {
      const externalRollback = await rollbackExternalTeachingOperation({
        teacherId: input.authenticatedTeacher.actorId,
        targetRecordId: input.receipt.receiptId,
        courseId: input.courseId,
        rollbackReason,
        traceId: input.traceId,
        requestedAt: createdAt,
        requestSource,
      });
      return {
        status: "rolled-back",
        action: "rollback-teaching-operation-record",
        rollbackReason,
        receipt: {
          receiptId: externalRollback.rollbackId,
          action: "rollback-teaching-operation-record",
          actorId: input.authenticatedTeacher.actorId,
          courseId: input.courseId,
          targetRecordId: input.receipt.receiptId,
          traceId: input.traceId,
          rollbackReason,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          externalRollback,
          responsibleSession: "S12",
          createdAt,
          redaction: createRedaction(),
        },
        responsibleSession: "S12",
        redaction: createRedaction(),
      };
    }

    if (input.receipt.storagePolicy === "local-json-teaching-operation-database") {
      const { receipt } = await rollbackTeachingOperationRecord({
        dataDir: resolveTeachingOperationDataDir(input.env.UAIS_TEACHING_OPERATIONS_DATA_DIR),
        recordId: input.receipt.receiptId,
        actorId: input.authenticatedTeacher.actorId,
        rollbackReason,
        audit: {
          traceId: input.traceId,
          actorRole: input.authenticatedTeacher.role,
          authMode: "signed-teacher-session",
          requestSource,
        },
        now: input.now,
      });
      return {
        status: "rolled-back",
        action: "rollback-teaching-operation-record",
        rollbackReason,
        receipt,
        responsibleSession: "S12",
        redaction: createRedaction(),
      };
    }

    return {
      status: "rollback-unavailable",
      action: "rollback-teaching-operation-record",
      rollbackReason,
      rollbackRoute,
      error: "Teaching operation external rollback is not configured.",
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  } catch (error) {
    const routeError = normalizeTeachingOperationRouteError(error);
    return {
      status: "rollback-failed",
      action: "rollback-teaching-operation-record",
      rollbackReason,
      rollbackRoute,
      error: routeError.message,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  }
}

function normalizeTeachingOperationRouteError(error: unknown) {
  if (error instanceof TeachingCourseManagementStoreError) {
    return {
      status: error.status,
      message: error.message,
      ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
    };
  }
  if (error instanceof TeachingOperationStoreError) {
    return {
      status: error.status,
      message: error.message,
    };
  }
  return {
    status: 500,
    message: "Teaching operation backend request failed.",
  };
}

function createTeachingOperationAuditInput(input: {
  traceId: string;
  request: Request;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
}) {
  return {
    traceId: input.traceId,
    actorRole: input.authenticatedTeacher.role,
    authMode: "signed-teacher-session" as const,
    authSession: {
      sessionId: input.authenticatedTeacher.sessionId,
      authenticatedAt: input.authenticatedTeacher.authenticatedAt,
      expiresAt: input.authenticatedTeacher.expiresAt,
    },
    requestSource: readAuditRequestSource(input.request),
  };
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function readAuditRequestSource(request: Request): TeachingOperationAuditRequestSource {
  const originClass = classifyRequestOrigin(request.headers.get("origin"));
  const refererPath = sanitizeRefererPath(request.headers.get("referer"));
  return {
    userAgent: sanitizeRequestSourceHeader(request.headers.get("user-agent")) ?? "unknown",
    ipAddress: "redacted",
    ...(originClass ? { originClass } : {}),
    ...(refererPath ? { refererPath } : {}),
  };
}

function classifyRequestOrigin(value: string | null): TeachingOperationAuditRequestSource["originClass"] | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const url = new URL(normalized);
    if (isLocalAuditHost(url.hostname)) {
      return "local-loopback";
    }
    if (url.protocol === "https:") {
      return "remote-https";
    }
    return "non-https";
  } catch {
    return "unknown";
  }
}

function sanitizeRefererPath(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const { pathname } = new URL(normalized);
    return sanitizeRequestSourceHeader(pathname) ?? "unknown";
  } catch {
    return "unknown";
  }
}

function isLocalAuditHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function readIdempotencyKey(input: {
  request: Request;
  body: Record<string, unknown>;
}) {
  const bodyValue =
    typeof input.body.idempotencyKey === "string" ? input.body.idempotencyKey : undefined;
  const headerValue = input.request.headers.get("x-uais-idempotency-key") ?? undefined;
  const normalized = (bodyValue ?? headerValue)?.trim();
  return normalized || undefined;
}

function sanitizeRequestSourceHeader(value: string | null) {
  const normalized = value?.trim().slice(0, 160);
  if (!normalized) {
    return undefined;
  }
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return "redacted";
  }
  return normalized;
}

function createTeachingOperationCourseOwnershipAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): GetTeachingOperationCourseOwnership | undefined {
  const readOwnership = createUaisTeacherAiOwnershipAdapter({
    env: input.env,
    fetch: input.fetch,
  });
  if (!readOwnership) {
    return undefined;
  }

  return async ({ request, authenticatedTeacher }) =>
    readOwnership({
      request,
      authenticatedSession: authenticatedTeacher,
    });
}

function assertProductionTeachingOperationCourseOwnershipAccessConfigured(input: {
  env: Record<string, string | undefined>;
  courseId?: string;
}) {
  if (
    !isTeachingOperationProductionRuntime(input.env) ||
    !input.courseId ||
    !isSafeTeachingOperationId(input.courseId)
  ) {
    return;
  }

  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    value: input.env.UAIS_TEACHER_AI_OWNERSHIP_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });
  if (isExternalStorageBackendReadyContract(backendContract)) {
    return;
  }

  throw new TeachingOperationStoreError(
    503,
    "Production teaching operation course ownership access requires external storage.",
  );
}

async function authorizeTeachingOperationCourseAccess(input: {
  request: Request;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
}) {
  const actor = {
    actorId: input.authenticatedTeacher.actorId,
    role: input.authenticatedTeacher.role,
  };
  if (!input.courseId) {
    return createDeniedAccess("course-id-required", actor);
  }
  if (!isSafeTeachingOperationId(input.courseId)) {
    return createDeniedAccess("course-id-invalid", actor);
  }
  const resource = { courseId: input.courseId };
  if (!input.getTeachingOperationCourseOwnership) {
    return createDeniedAccess("teacher-course-ownership-required", actor, resource);
  }

  let ownership: TeachingOperationCourseOwnership | undefined;
  try {
    ownership = await input.getTeachingOperationCourseOwnership({
      request: input.request,
      authenticatedTeacher: input.authenticatedTeacher,
    });
  } catch {
    return createDeniedAccess("teacher-course-ownership-check-failed", actor, resource);
  }
  if (!ownership || ownership.teacherId !== input.authenticatedTeacher.actorId) {
    return createDeniedAccess("teacher-course-ownership-required", actor, resource);
  }
  if (!new Set(ownership.courseIds ?? []).has(input.courseId)) {
    return createDeniedAccess("course-scope-denied", actor, resource);
  }

  return {
    status: "authorized" as const,
    reasonCode: "authorized" as const,
    responsibleSession: "S12" as const,
    actor,
    resource,
    redaction: createRedaction(),
  };
}

function getTeachingOperationAccessDeniedStatus(
  reasonCode: TeachingOperationAccessDeniedReason,
) {
  if (reasonCode === "course-id-required" || reasonCode === "course-id-invalid") {
    return 400;
  }
  if (reasonCode === "teacher-course-ownership-check-failed") {
    return 503;
  }
  return 403;
}

function getTeachingOperationAccessDeniedError(
  reasonCode: TeachingOperationAccessDeniedReason,
) {
  if (reasonCode === "course-id-invalid") {
    return "UAIS teaching operation course id is invalid.";
  }
  if (reasonCode === "teacher-course-ownership-check-failed") {
    return "UAIS teaching operation course ownership check failed.";
  }
  return "UAIS teaching operation course ownership is required.";
}

function isSafeTeachingOperationId(value: string) {
  return (
    value.length >= 1 &&
    value.length <= maxSafeIdLength &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  );
}

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new TeachingOperationStoreError(413, "Request body is too large.");
  }
  if (!text.trim()) {
    throw new TeachingOperationStoreError(400, "Request body is required.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TeachingOperationStoreError(400, "Request body must be JSON.");
	}
}

function readAuthenticatedTeacherSession(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}) {
  const secret = input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  if (!secret) {
    return undefined;
  }

  const authenticatedTeacher = readUaisAuthenticatedTeacherSessionFromSignedCookies({
    request: input.request,
    secret,
    now: input.now,
  });
  if (
    !authenticatedTeacher ||
    authenticatedTeacher.role !== "teacher" ||
    !isSafeTeachingOperationId(authenticatedTeacher.actorId) ||
    !isSafeTeachingOperationId(authenticatedTeacher.sessionId)
  ) {
    return undefined;
  }

  return authenticatedTeacher;
}

function readAuthenticatedStudentSession(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}) {
  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  if (
    !claims ||
    claims.role !== "student" ||
    !isSafeTeachingOperationId(claims.account) ||
    !isSafeTeachingOperationId(claims.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: claims.account,
    role: "student",
  };
}

function isTeachingOperationProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function createErrorResponse(error: unknown, traceId: string) {
  const routeError = normalizeTeachingOperationRouteError(error);
  return jsonResponse(routeError.status, {
    error: routeError.message,
    ...(routeError.diagnostics ? { diagnostics: routeError.diagnostics } : {}),
    traceId,
    redaction: createRedaction(),
  }, traceId);
}

function createDeniedAccess(
  reasonCode: TeachingOperationAccessDeniedReason,
  actor?: { actorId: string; role: "teacher" },
  resource?: { courseId: string },
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(actor ? { actor } : {}),
    ...(resource ? { resource } : {}),
    redaction: createRedaction(),
  };
}

