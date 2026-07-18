import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import { TeachingOperationStoreError } from "./teaching-operations-error";
import {
  createRedaction,
  isPositiveInteger,
  isRecord,
  isTeachingOperationIdempotencyStatus,
  isTeachingOperationProductionDatabaseAdapterEvidence,
  isTeachingOperationProductionRuntime,
  requireSafeId,
} from "./teaching-operations-guards";
import {
  normalizeExternalAuditReadback,
  normalizeExternalRollbackReceipt,
} from "./teaching-operations-receipt-normalizers";
import type {
  TeachingOperationExternalAppendAdapter,
  TeachingOperationExternalAuditReadAdapter,
  TeachingOperationExternalRollbackAdapter,
} from "./teaching-operations-store";

// External-storage adapter factories for the teaching-operations store (Phase 3
// decomposition): fetch-based append / audit-read / rollback adapters gated by the
// storage-backend contract. Runtime deps are the already-extracted
// guards/error/receipt-normalizer modules and the storage-backend contract; store
// types are a type-only import (no runtime cycle). Behavior is identical.

export function createUaisTeachingOperationExternalAppendAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalAppendAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_OPERATIONS_BACKEND",
    value: input.env.UAIS_TEACHING_OPERATIONS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation storage backend is not ready.",
    );
  }

  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({ record, auditEvent }) => {
    const teacherId = requireSafeId(record.actorId, "teacher id");
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/append`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "append-teaching-operation",
          record,
          ...(auditEvent ? { auditEvent } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok && response.status === 409) {
      throw new TeachingOperationStoreError(
        409,
        "Teaching operation idempotency key already exists.",
      );
    }
    if (!response.ok) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation persistence failed.",
      );
    }
    const acknowledgement = await response.json().catch(() => undefined);
    if (
      isRecord(acknowledgement) &&
      (
        acknowledgement.status !== "persisted" ||
        acknowledgement.storagePolicy !== "external-redacted-teaching-operation-append" ||
        acknowledgement.storageWritePolicy !== "external-append-only-operation-log" ||
        acknowledgement.responsibleSession !== "S12"
      )
    ) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation persistence acknowledgement is invalid.",
      );
    }
    const receiptId =
      isRecord(acknowledgement) && typeof acknowledgement.receiptId === "string"
        ? acknowledgement.receiptId
        : record.recordId;
    const appendSequence =
      isRecord(acknowledgement) && isPositiveInteger(acknowledgement.appendSequence)
        ? acknowledgement.appendSequence
        : undefined;
    if (!appendSequence) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation persistence acknowledgement is missing append ledger sequence.",
      );
    }
    const idempotencyStatus =
      isRecord(acknowledgement) &&
      isTeachingOperationIdempotencyStatus(acknowledgement.idempotencyStatus)
        ? acknowledgement.idempotencyStatus
        : undefined;
    const productionDatabaseAdapter =
      isRecord(acknowledgement) &&
      isTeachingOperationProductionDatabaseAdapterEvidence(
        acknowledgement.productionDatabaseAdapter,
      )
        ? acknowledgement.productionDatabaseAdapter
        : undefined;
    if (isTeachingOperationProductionRuntime(input.env) && !productionDatabaseAdapter) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation persistence acknowledgement is missing production database adapter evidence.",
      );
    }

    return {
      teacherId,
      receiptId,
      status: "persisted",
      ...(idempotencyStatus ? { idempotencyStatus } : {}),
      appendSequence,
      ...(productionDatabaseAdapter ? { productionDatabaseAdapter } : {}),
      storagePolicy: "external-redacted-teaching-operation-append",
      storageWritePolicy: "external-append-only-operation-log",
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  };
}

export function createUaisTeachingOperationExternalAuditReadAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalAuditReadAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_OPERATIONS_BACKEND",
    value: input.env.UAIS_TEACHING_OPERATIONS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation storage backend is not ready.",
    );
  }

  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({ teacherId }) => {
    const normalizedTeacherId = requireSafeId(teacherId, "teacher id");
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(normalizedTeacherId)}/audit`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation audit readback failed.",
      );
    }

    return normalizeExternalAuditReadback(await response.json(), {
      expectedTeacherId: normalizedTeacherId,
    });
  };
}

export function createUaisTeachingOperationExternalRollbackAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalRollbackAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_OPERATIONS_BACKEND",
    value: input.env.UAIS_TEACHING_OPERATIONS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation storage backend is not ready.",
    );
  }

  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({
    teacherId,
    targetRecordId,
    courseId,
    rollbackReason,
    traceId,
    requestedAt,
    requestSource,
  }) => {
    const normalizedTeacherId = requireSafeId(teacherId, "teacher id");
    const normalizedTargetRecordId = requireSafeId(
      targetRecordId,
      "teaching operation record id",
    );
    const normalizedCourseId = requireSafeId(courseId, "course id");
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(
        normalizedTeacherId,
      )}/records/${encodeURIComponent(normalizedTargetRecordId)}/rollback`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "rollback-teaching-operation-record",
          courseId: normalizedCourseId,
          rollbackReason,
          traceId,
          requestedAt,
          requestSource,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation rollback failed.",
      );
    }

    return normalizeExternalRollbackReceipt(await response.json(), {
      expectedTeacherId: normalizedTeacherId,
      expectedTargetRecordId: normalizedTargetRecordId,
      expectedCourseId: normalizedCourseId,
      productionRuntime: isTeachingOperationProductionRuntime(input.env),
    });
  };
}
