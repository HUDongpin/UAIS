import {
  TeachingCourseManagementStoreError,
  type TeachingCourseManagementReceipt,
} from "@/lib/server/teaching-course-management-store";
import type {
  TeachingOperationReceipt,
  TeachingOperationRollbackReceipt,
} from "@/lib/server/teaching-operations-store";
import { createRedaction, jsonResponse, normalizeTeachingOperationRouteError } from "./route-utils";

// Partial-failure detection, response builders, compensation, and their types for
// the teaching-operations route (Phase 3 decomposition): when an operation persists
// but a domain-object/provider side effect fails, decide + build the partial-failure
// response and attempt rollback compensation. Runtime deps are route-utils only.

export function shouldReturnCourseManagementDomainObjectPartialFailure(input: {
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

export function shouldReturnCollaborationInviteEmailDeliveryPartialFailure(input: {
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

export function shouldReturnStudentRosterProviderSyncPartialFailure(input: {
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

export function shouldReturnKnowledgeIndexProviderSyncPartialFailure(input: {
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

export function shouldReturnCourseContentProviderPublishPartialFailure(input: {
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

export function shouldReturnCourseExportProviderPartialFailure(input: {
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

export function shouldReturnGradingFeedbackProviderPartialFailure(input: {
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

export function shouldReturnClassInvitePublicationPartialFailure(input: {
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

export function createCollaborationInviteEmailDeliveryPartialFailureResponse(input: {
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

export function createStudentRosterProviderSyncPartialFailureResponse(input: {
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

export function createKnowledgeIndexProviderSyncPartialFailureResponse(input: {
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

export function createCourseContentProviderPublishPartialFailureResponse(input: {
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

export function createCourseExportProviderPartialFailureResponse(input: {
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

export function createGradingFeedbackProviderPartialFailureResponse(input: {
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

export function createClassInvitePublicationPartialFailureResponse(input: {
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

export function createCourseManagementDomainObjectPartialFailureResponse(input: {
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

export type TeachingOperationPartialFailureRollbackReason =
  | "class-invite-publication-failed"
  | "course-management-domain-object-failed";

export type TeachingOperationPartialFailureCompensation =
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
