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
} from "@/lib/server/teaching-operations-store";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingClassInviteCodePublishTarget,
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  publishTeachingClassInviteCode,
  resolveTeachingCourseManagementDataDir,
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
  maybePersistAdminSettingsDomainObject,
  maybePersistAgentPermissionPreflightDomainObject,
  maybePersistAgentSettingsDomainObject,
  maybePersistCourseContentPublishDomainObject,
  maybePersistCourseSettingsDomainObject,
  maybePersistCourseUnitDraftDomainObject,
  maybePersistDashboardRefreshDomainObject,
  maybePersistDashboardSnapshotDomainObject,
  maybePersistKnowledgeIndexSyncDomainObject,
  maybePersistQuizAssessmentDomainObject,
  maybePersistQuizItemReviewDomainObject,
  maybePersistResourceReviewItemDomainObject,
  maybePersistStudentGroupSuggestionDomainObject,
  maybePersistStudentPreviewSessionDomainObject,
  maybePersistStudentRosterSyncDomainObject,
  maybePublishCourseContentWithProvider,
  maybeSyncKnowledgeIndexWithProvider,
  maybeSyncStudentRosterWithProvider,
} from "./domain-persistence-a";
import {
  createTeachingOperationAuditInput,
  readAuditRequestSource,
  readIdempotencyKey,
  readSafeTraceId,
} from "./audit";
import {
  maybeDeliverCollaborationInviteEmail,
  maybeExportCourseDataWithProvider,
  maybeGenerateGradingFeedbackWithProvider,
  maybePersistCollaborationInviteNotificationDomainObject,
  maybePersistCourseExportManifestDomainObject,
  maybePersistCourseExportRedactionValidationDomainObject,
  maybePersistGradingFeedbackDraftDomainObject,
  maybePersistGradingQueueDomainObject,
  maybePersistInviteCodeDraftDomainObject,
} from "./domain-persistence-b";
import {
  createClassInvitePublicationPartialFailureResponse,
  createCollaborationInviteEmailDeliveryPartialFailureResponse,
  createCourseContentProviderPublishPartialFailureResponse,
  createCourseExportProviderPartialFailureResponse,
  createCourseManagementDomainObjectPartialFailureResponse,
  createGradingFeedbackProviderPartialFailureResponse,
  createKnowledgeIndexProviderSyncPartialFailureResponse,
  createStudentRosterProviderSyncPartialFailureResponse,
  shouldReturnClassInvitePublicationPartialFailure,
  shouldReturnCollaborationInviteEmailDeliveryPartialFailure,
  shouldReturnCourseContentProviderPublishPartialFailure,
  shouldReturnCourseExportProviderPartialFailure,
  shouldReturnCourseManagementDomainObjectPartialFailure,
  shouldReturnGradingFeedbackProviderPartialFailure,
  shouldReturnKnowledgeIndexProviderSyncPartialFailure,
  shouldReturnStudentRosterProviderSyncPartialFailure,
  type TeachingOperationPartialFailureCompensation,
  type TeachingOperationPartialFailureRollbackReason,
} from "./partial-failure";
import {
  readCollaborationInviteEmailProviderConfig,
  readCourseContentPublishProviderConfig,
  readCourseExportProviderConfig,
  readGradingFeedbackProviderConfig,
  readKnowledgeIndexSyncProviderConfig,
  readStudentRosterSyncProviderConfig,
} from "./provider-config";
import {
  createRedaction,
  isRecord,
  isTeachingOperationProductionRuntime,
  jsonResponse,
  normalizeActionSlot,
  normalizeTeachingOperationRouteError,
  readPublishedInviteCode,
  readTargetClassId,
  type TeachingOperationAuthenticatedTeacher,
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

