import { TeachingOperationStoreError } from "./teaching-operations-error";
import { isRecord, requireIsoDate, requireSafeId } from "./teaching-operations-guards";

export type TeachingGradebookProviderOperation = {
  operationId: string;
  action: "release" | "rollback";
  dispatchMode: "provider" | "local";
  objectId: string;
  courseId: string;
  actorId: string;
  traceId: string;
  actorRole: "teacher";
  authMode: "signed-teacher-session";
  requestSource: { userAgent: string; ipAddress: "redacted" };
  generation: string;
  releaseGenerationId: string;
  payloadHash: string;
  providerReleaseId?: string;
  sourceOperationRecordId: string;
  phase: "dispatching" | "reconciliation-required" | "provider-confirmed" | "completion-pending" | "succeeded";
  createdAt: string;
  updatedAt: string;
  providerReceiptId?: string;
};

// This is safety evidence, not optional legacy display data. Malformed persisted
// evidence must stop dispatch; dropping it would silently rearm an operation.
export function normalizeGradebookProviderOperations(value: unknown): TeachingGradebookProviderOperation[] {
  if (!Array.isArray(value)) throw new TeachingOperationStoreError(503, "Gradebook provider operation evidence is invalid.");
  return value.map((item) => {
    if (!isRecord(item) || !["provider", "local"].includes(String(item.dispatchMode)) || !["release", "rollback"].includes(String(item.action)) ||
      !["dispatching", "reconciliation-required", "provider-confirmed", "completion-pending", "succeeded"].includes(String(item.phase))) {
      throw new TeachingOperationStoreError(503, "Gradebook provider operation evidence is invalid.");
    }
    if (typeof item.generation !== "string" || !/^[a-f0-9]{64}$/.test(item.generation) ||
      typeof item.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(item.payloadHash)) {
      throw new TeachingOperationStoreError(503, "Gradebook provider generation evidence is invalid.");
    }
    if (item.actorRole !== "teacher" || item.authMode !== "signed-teacher-session" || !isRecord(item.requestSource) ||
      typeof item.requestSource.userAgent !== "string" || item.requestSource.userAgent.length > 400 || item.requestSource.ipAddress !== "redacted") {
      throw new TeachingOperationStoreError(503, "Gradebook provider audit evidence is invalid.");
    }
    if ((item.phase === "provider-confirmed" && item.dispatchMode !== "provider") ||
      (item.phase === "completion-pending" && item.dispatchMode !== "local") ||
      (item.dispatchMode === "local" && item.providerReceiptId !== undefined) ||
      (item.dispatchMode === "provider" && ["provider-confirmed", "succeeded"].includes(String(item.phase)) && !item.providerReceiptId)) {
      throw new TeachingOperationStoreError(503, "Gradebook provider receipt evidence is inconsistent.");
    }
    return {
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      requestSource: { userAgent: item.requestSource.userAgent, ipAddress: "redacted" },
      operationId: requireSafeId(item.operationId, "provider operation id"),
      dispatchMode: item.dispatchMode as TeachingGradebookProviderOperation["dispatchMode"],
      action: item.action as TeachingGradebookProviderOperation["action"],
      objectId: requireSafeId(item.objectId, "gradebook update id"),
      courseId: requireSafeId(item.courseId, "course id"),
      actorId: requireSafeId(item.actorId, "actor id"),
      traceId: requireSafeId(item.traceId, "trace id"),
      generation: requireSafeId(item.generation, "generation"),
      releaseGenerationId: requireSafeId(item.releaseGenerationId, "release generation id"),
      payloadHash: requireSafeId(item.payloadHash, "payload hash"),
      sourceOperationRecordId: requireSafeId(item.sourceOperationRecordId, "source operation record id"),
      ...(item.providerReleaseId ? { providerReleaseId: requireSafeId(item.providerReleaseId, "provider release id") } : {}),
      phase: item.phase as TeachingGradebookProviderOperation["phase"],
      createdAt: requireIsoDate(item.createdAt, "createdAt"),
      updatedAt: requireIsoDate(item.updatedAt, "updatedAt"),
      ...(item.providerReceiptId ? { providerReceiptId: requireSafeId(item.providerReceiptId, "provider receipt id") } : {}),
    };
  });
}

export class GradebookProviderOperationBlockedError extends TeachingOperationStoreError {
  constructor(readonly providerOperation: TeachingGradebookProviderOperation) {
    super(409, "Gradebook provider operation is recorded. Automatic retry is blocked; its outcome requires review.", "gradebook-provider-operation-blocked");
  }
}

export const gradebookProviderRecoveryMessage = {
  "en-US": "A gradebook provider operation is recorded. Its outcome may be uncertain. Automatic retry is blocked; retain this operation ID for outcome review.",
  "zh-CN": "成绩服务操作已记录，结果可能尚未确定。已阻止自动重试；请保留此操作编号以核查结果。",
};
