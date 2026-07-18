import {
  normalizeExternalTeachingOperationAuditReadbackRecord,
  normalizeTeachingOperationAuditReadbackDomainProjection,
  normalizeTeachingOperationAuditReadbackEvent,
} from "./teaching-operations-audit-normalizers";
import { TeachingOperationStoreError } from "./teaching-operations-error";
import {
  createRedaction,
  isPositiveInteger,
  isRecord,
  isTeachingOperationIdempotencyStatus,
  isTeachingOperationProductionDatabaseAdapterEvidence,
  requireIsoDate,
  requireSafeId,
} from "./teaching-operations-guards";
import type {
  TeachingGradebookReleaseProviderReceipt,
  TeachingGradebookReleaseRollbackProviderReceipt,
  TeachingOperationExternalAppendReceipt,
  TeachingOperationExternalAuditReadback,
  TeachingOperationExternalRollbackReceipt,
} from "./teaching-operations-store";

// Provider-receipt normalizers for teaching gradebook release/rollback (Phase 3
// decomposition). Depend only on the guards module at runtime; store types are a
// type-only import (no runtime cycle). Behavior is identical to the previous
// inline definitions.

export function normalizeTeachingGradebookReleaseProviderReceipt(
  input: TeachingGradebookReleaseProviderReceipt,
): TeachingGradebookReleaseProviderReceipt {
  return {
    providerStatus: "gradebook-provider-released",
    providerReleaseId: requireSafeId(input.providerReleaseId, "provider release id"),
    providerReleasedAt: requireIsoDate(input.providerReleasedAt, "providerReleasedAt"),
  };
}

export function normalizeTeachingGradebookReleaseRollbackProviderReceipt(
  input: TeachingGradebookReleaseRollbackProviderReceipt,
): TeachingGradebookReleaseRollbackProviderReceipt {
  return {
    providerRollbackStatus: "gradebook-provider-release-rolled-back",
    providerRollbackId: requireSafeId(input.providerRollbackId, "provider rollback id"),
    providerRolledBackAt: requireIsoDate(input.providerRolledBackAt, "providerRolledBackAt"),
  };
}

export function normalizeExternalAppendReceipt(
  value: TeachingOperationExternalAppendReceipt,
  expected: {
    expectedTeacherId: string;
    expectedReceiptId: string;
  },
): TeachingOperationExternalAppendReceipt {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation persistence acknowledgement is invalid.",
    );
  }
  if (
    value.status !== "persisted" ||
    value.storagePolicy !== "external-redacted-teaching-operation-append" ||
    value.storageWritePolicy !== "external-append-only-operation-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation persistence acknowledgement is invalid.",
    );
  }
  const teacherId = requireSafeId(value.teacherId, "external append teacher id");
  const receiptId = requireSafeId(value.receiptId, "external append receipt id");
  if (teacherId !== expected.expectedTeacherId || receiptId !== expected.expectedReceiptId) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation persistence acknowledgement is invalid.",
    );
  }

  return {
    teacherId,
    receiptId,
    status: "persisted",
    ...(isTeachingOperationIdempotencyStatus(value.idempotencyStatus)
      ? { idempotencyStatus: value.idempotencyStatus }
      : {}),
    ...(isPositiveInteger(value.appendSequence)
      ? { appendSequence: value.appendSequence }
      : {}),
    ...(isTeachingOperationProductionDatabaseAdapterEvidence(value.productionDatabaseAdapter)
      ? { productionDatabaseAdapter: value.productionDatabaseAdapter }
      : {}),
    storagePolicy: "external-redacted-teaching-operation-append",
    storageWritePolicy: "external-append-only-operation-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

export function normalizeExternalAuditReadback(
  value: unknown,
  expected: { expectedTeacherId: string },
): TeachingOperationExternalAuditReadback {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation audit readback response is invalid.",
    );
  }
  const teacherId =
    typeof value.teacherId === "string"
      ? requireSafeId(value.teacherId, "teacher id")
      : expected.expectedTeacherId;
  if (teacherId !== expected.expectedTeacherId) {
    throw new TeachingOperationStoreError(
      403,
      "External teaching operation audit teacher mismatch.",
    );
  }

  return {
    teacherId,
    records: Array.isArray(value.records)
      ? value.records.map(normalizeExternalTeachingOperationAuditReadbackRecord)
      : [],
    auditEvents: Array.isArray(value.auditEvents)
      ? value.auditEvents.map(normalizeTeachingOperationAuditReadbackEvent)
      : [],
    domainProjections: Array.isArray(value.domainProjections)
      ? value.domainProjections.map(normalizeTeachingOperationAuditReadbackDomainProjection)
      : [],
  };
}

export function normalizeExternalRollbackReceipt(
  value: unknown,
  expected: {
    expectedTeacherId: string;
    expectedTargetRecordId: string;
    expectedCourseId: string;
    productionRuntime: boolean;
  },
): TeachingOperationExternalRollbackReceipt {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation rollback acknowledgement is invalid.",
    );
  }
  if (
    value.status !== "persisted" ||
    value.storagePolicy !== "external-redacted-teaching-operation-rollback" ||
    value.storageWritePolicy !== "external-append-only-rollback-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation rollback acknowledgement is invalid.",
    );
  }
  const teacherId = requireSafeId(value.teacherId, "external rollback teacher id");
  const targetRecordId = requireSafeId(
    value.targetRecordId,
    "external rollback target record id",
  );
  const courseId = requireSafeId(value.courseId, "external rollback course id");
  if (
    teacherId !== expected.expectedTeacherId ||
    targetRecordId !== expected.expectedTargetRecordId ||
    courseId !== expected.expectedCourseId
  ) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation rollback acknowledgement is invalid.",
    );
  }
  const productionDatabaseAdapter = isTeachingOperationProductionDatabaseAdapterEvidence(
    value.productionDatabaseAdapter,
  )
    ? value.productionDatabaseAdapter
    : undefined;
  if (expected.productionRuntime && !productionDatabaseAdapter) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation rollback acknowledgement is missing production database adapter evidence.",
    );
  }

  return {
    teacherId,
    rollbackId: requireSafeId(value.rollbackId, "external rollback id"),
    targetRecordId,
    courseId,
    status: "persisted",
    ...(productionDatabaseAdapter ? { productionDatabaseAdapter } : {}),
    storagePolicy: "external-redacted-teaching-operation-rollback",
    storageWritePolicy: "external-append-only-rollback-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}
