import { isTeachingOperationId } from "@/components/teaching/teaching-operation-data";
import { actionDefinitions } from "./teaching-operations-action-catalog";
import { normalizeDomainProjection } from "./teaching-operations-domain-projection-normalizer";
import { TeachingOperationStoreError } from "./teaching-operations-error";
import {
  createRedaction,
  isPositiveInteger,
  isRecord,
  requireActionSlot,
  requireIsoDate,
  requireSafeId,
} from "./teaching-operations-guards";
import {
  normalizeAuditAuthSession,
  normalizeAuditRequestSource,
} from "./teaching-operations-input-normalizers";
import { normalizeArtifact } from "./teaching-operations-record-normalizers";
import type {
  TeachingOperationAuditEvent,
  TeachingOperationDomainProjection,
  TeachingOperationRecord,
} from "./teaching-operations-store";

// Audit-event and operation-record normalizers plus their external-readback
// wrappers for the teaching-operations store (Phase 3 decomposition). Runtime deps
// are the already-extracted guard/error/input-normalizer/domain-projection/
// record-normalizer modules and teaching-operation-data; store types are a
// type-only import (no runtime cycle). Behavior is identical to the inline defs.

export function normalizeAuditEvent(value: unknown): TeachingOperationAuditEvent {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(500, "Teaching operation audit event is invalid.");
  }
  if (value.eventType === "teaching-operations-backup.restored") {
    return {
      auditId: requireSafeId(value.auditId, "audit id"),
      traceId: requireSafeId(value.traceId, "trace id"),
      eventType: "teaching-operations-backup.restored",
      actorId: requireSafeId(value.actorId, "actor id"),
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      ...(value.authSession
        ? { authSession: normalizeAuditAuthSession(value.authSession) }
        : {}),
      backupId: requireSafeId(value.backupId, "backup id"),
      impactedCourseIds: Array.isArray(value.impactedCourseIds)
        ? value.impactedCourseIds.map((courseId) => requireSafeId(courseId, "course id"))
        : [],
      requestSource: normalizeAuditRequestSource(value.requestSource),
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      redaction: createRedaction(),
    };
  }
  if (
    value.eventType === "teaching-gradebook-update.released" ||
    value.eventType === "teaching-gradebook-update.release-rolled-back"
  ) {
    return {
      auditId: requireSafeId(value.auditId, "audit id"),
      traceId: requireSafeId(value.traceId, "trace id"),
      eventType: value.eventType,
      actorId: requireSafeId(value.actorId, "actor id"),
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      ...(value.authSession
        ? { authSession: normalizeAuditAuthSession(value.authSession) }
        : {}),
      courseId: requireSafeId(value.courseId, "course id"),
      gradebookUpdateId: requireSafeId(value.gradebookUpdateId, "gradebook update id"),
      requestSource: normalizeAuditRequestSource(value.requestSource),
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      redaction: createRedaction(),
    };
  }
  if (value.eventType === "teaching-operation.rolled-back") {
    const operationId = value.operationId;
    if (typeof operationId !== "string" || !isTeachingOperationId(operationId)) {
      throw new TeachingOperationStoreError(500, "Teaching operation audit event is invalid.");
    }
    const actionSlot = requireActionSlot(value.actionSlot);
    const definition = actionDefinitions[operationId][actionSlot];
    return {
      auditId: requireSafeId(value.auditId, "audit id"),
      traceId: requireSafeId(value.traceId, "trace id"),
      eventType: "teaching-operation.rolled-back",
      actorId: requireSafeId(value.actorId, "actor id"),
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      ...(value.authSession
        ? { authSession: normalizeAuditAuthSession(value.authSession) }
        : {}),
      courseId: requireSafeId(value.courseId, "course id"),
      targetRecordId: requireSafeId(value.targetRecordId, "target record id"),
      operationId,
      actionSlot,
      actionId: definition.actionId,
      rollbackReason: requireSafeId(value.rollbackReason, "rollback reason"),
      requestSource: normalizeAuditRequestSource(value.requestSource),
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      redaction: createRedaction(),
    };
  }
  if (typeof value.operationId !== "string") {
    throw new TeachingOperationStoreError(500, "Teaching operation audit event is invalid.");
  }
  const operationId = value.operationId;
  if (!isTeachingOperationId(operationId)) {
    throw new TeachingOperationStoreError(500, "Teaching operation audit event is invalid.");
  }
  const actionSlot = requireActionSlot(value.actionSlot);
  const definition = actionDefinitions[operationId][actionSlot];

  return {
    auditId: requireSafeId(value.auditId, "audit id"),
    traceId: requireSafeId(value.traceId, "trace id"),
    eventType: "teaching-operation.persisted",
    actorId: requireSafeId(value.actorId, "actor id"),
    actorRole: "teacher",
    authMode: "signed-teacher-session",
    ...(value.authSession ? { authSession: normalizeAuditAuthSession(value.authSession) } : {}),
    operationId,
    actionSlot,
    actionId: definition.actionId,
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    requestSource: normalizeAuditRequestSource(value.requestSource),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    redaction: createRedaction(),
  };
}

export function normalizeRecord(value: unknown): TeachingOperationRecord {
  if (!isRecord(value) || typeof value.operationId !== "string") {
    throw new TeachingOperationStoreError(500, "Teaching operation record is invalid.");
  }
  const operationId = value.operationId;
  if (!isTeachingOperationId(operationId)) {
    throw new TeachingOperationStoreError(500, "Teaching operation record is invalid.");
  }
  const actionSlot = requireActionSlot(value.actionSlot);
  const definition = actionDefinitions[operationId][actionSlot];

  return {
    recordId: requireSafeId(value.recordId, "record id"),
    operationId,
    actionSlot,
    actionId: definition.actionId,
    actorId: requireSafeId(value.actorId, "actor id"),
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    ...(value.idempotencyKey
      ? { idempotencyKey: requireSafeId(value.idempotencyKey, "idempotency key") }
      : {}),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    status: "persisted",
    ...(isPositiveInteger(value.appendSequence)
      ? { appendSequence: value.appendSequence }
      : {}),
    storagePolicy: "local-json-teaching-operation-database",
    redaction: createRedaction(),
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.map(normalizeArtifact)
      : [],
    ...(Array.isArray(value.domainProjections)
      ? { domainProjections: value.domainProjections.map(normalizeDomainProjection) }
      : {}),
  };
}

export function normalizeExternalTeachingOperationAuditReadbackRecord(
  value: unknown,
): TeachingOperationRecord {
  const record = normalizeRecord(value);
  return {
    ...record,
    storagePolicy: "external-redacted-teaching-operation-append",
  };
}

export function normalizeTeachingOperationAuditReadbackEvent(
  value: unknown,
): TeachingOperationAuditEvent {
  return normalizeAuditEvent(value);
}

export function normalizeTeachingOperationAuditReadbackDomainProjection(
  value: unknown,
): TeachingOperationDomainProjection {
  return normalizeDomainProjection(value);
}
