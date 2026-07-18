import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import { TeachingOperationStoreError } from "./teaching-operations-error";
import { createRedaction, requireSafeId } from "./teaching-operations-guards";
import {
  normalizeAuditAuthSession,
  normalizeAuditRequestSource,
} from "./teaching-operations-input-normalizers";
import { formatTimestampId } from "./teaching-operations-record-ids";
import type {
  ExecuteTeachingOperationActionInput,
  TeachingGradebookReleaseAuditEvent,
  TeachingGradebookReleaseAuditInput,
  TeachingOperationActionId,
  TeachingOperationActionSlot,
  TeachingOperationAuditStoragePolicy,
  TeachingOperationBackupRestoreAuditEvent,
  TeachingOperationPersistedAuditEvent,
  TeachingOperationReceiptAudit,
  TeachingOperationRecord,
  TeachingOperationRollbackAuditEvent,
} from "./teaching-operations-store";

// Audit-event and receipt-audit builders for the teaching-operations store
// (Phase 3 decomposition). Cycle-free: runtime deps are the extracted
// guards/error/input-normalizer/record-id modules; store types are type-only.

export function createAuditEvent(input: {
  audit: NonNullable<ExecuteTeachingOperationActionInput["audit"]>;
  operationId: TeachingOperationId;
  actionSlot: TeachingOperationActionSlot;
  actionId: TeachingOperationActionId;
  actorId: string;
  courseId?: string;
  sourceAction?: string;
  createdAt: string;
  now: Date;
}): TeachingOperationPersistedAuditEvent {
  return {
    auditId: `audit-${input.operationId}-${input.actionId}-${formatTimestampId(input.now)}`,
    traceId: requireSafeId(input.audit.traceId, "trace id"),
    eventType: "teaching-operation.persisted",
    actorId: input.actorId,
    actorRole: input.audit.actorRole,
    authMode: input.audit.authMode,
    ...(input.audit.authSession
      ? { authSession: normalizeAuditAuthSession(input.audit.authSession) }
      : {}),
    operationId: input.operationId,
    actionSlot: input.actionSlot,
    actionId: input.actionId,
    ...(input.courseId ? { courseId: input.courseId } : {}),
    ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
    requestSource: normalizeAuditRequestSource(input.audit.requestSource),
    createdAt: input.createdAt,
    redaction: createRedaction(),
  };
}

export function createGradebookReleaseAuditEvent(input: {
  audit: TeachingGradebookReleaseAuditInput;
  eventType?: TeachingGradebookReleaseAuditEvent["eventType"];
  actorId: string;
  courseId: string;
  gradebookUpdateId: string;
  createdAt: string;
  now: Date;
}): TeachingGradebookReleaseAuditEvent {
  return {
    auditId: `audit-gradebook-release-${input.gradebookUpdateId}-${formatTimestampId(input.now)}`,
    traceId: requireSafeId(input.audit.traceId, "trace id"),
    eventType: input.eventType ?? "teaching-gradebook-update.released",
    actorId: input.actorId,
    actorRole: input.audit.actorRole,
    authMode: input.audit.authMode,
    ...(input.audit.authSession
      ? { authSession: normalizeAuditAuthSession(input.audit.authSession) }
      : {}),
    courseId: input.courseId,
    gradebookUpdateId: input.gradebookUpdateId,
    requestSource: normalizeAuditRequestSource(input.audit.requestSource),
    createdAt: input.createdAt,
    redaction: createRedaction(),
  };
}

export function createBackupRestoreAuditEvent(input: {
  audit: TeachingGradebookReleaseAuditInput;
  actorId: string;
  backupId: string;
  impactedCourseIds: string[];
  now: Date;
  createdAt: string;
}): TeachingOperationBackupRestoreAuditEvent {
  return {
    auditId: `audit-teaching-operations-backup-restore-${input.backupId}-${formatTimestampId(
      input.now,
    )}`,
    traceId: input.audit.traceId,
    eventType: "teaching-operations-backup.restored",
    actorId: input.actorId,
    actorRole: input.audit.actorRole,
    authMode: input.audit.authMode,
    ...(input.audit.authSession
      ? { authSession: normalizeAuditAuthSession(input.audit.authSession) }
      : {}),
    backupId: input.backupId,
    impactedCourseIds: input.impactedCourseIds,
    requestSource: input.audit.requestSource,
    createdAt: input.createdAt,
    redaction: createRedaction(),
  };
}

export function createTeachingOperationRollbackAuditEvent(input: {
  audit: TeachingGradebookReleaseAuditInput;
  actorId: string;
  record: TeachingOperationRecord;
  rollbackReason: string;
  now: Date;
  createdAt: string;
}): TeachingOperationRollbackAuditEvent {
  if (!input.record.courseId) {
    throw new TeachingOperationStoreError(
      409,
      "Teaching operation record has no course scope.",
    );
  }
  return {
    auditId: `audit-teaching-operation-rollback-${input.record.recordId}-${formatTimestampId(
      input.now,
    )}`,
    traceId: input.audit.traceId,
    eventType: "teaching-operation.rolled-back",
    actorId: input.actorId,
    actorRole: input.audit.actorRole,
    authMode: input.audit.authMode,
    ...(input.audit.authSession
      ? { authSession: normalizeAuditAuthSession(input.audit.authSession) }
      : {}),
    courseId: input.record.courseId,
    targetRecordId: input.record.recordId,
    operationId: input.record.operationId,
    actionSlot: input.record.actionSlot,
    actionId: input.record.actionId,
    rollbackReason: input.rollbackReason,
    requestSource: input.audit.requestSource,
    createdAt: input.createdAt,
    redaction: createRedaction(),
  };
}

export function createReceiptAudit(
  event: TeachingOperationPersistedAuditEvent,
  storagePolicy: TeachingOperationAuditStoragePolicy,
): TeachingOperationReceiptAudit {
  return {
    auditId: event.auditId,
    traceId: event.traceId,
    eventType: event.eventType,
    actor: {
      actorId: event.actorId,
      role: event.actorRole,
    },
    authMode: event.authMode,
    ...(event.authSession ? { authSession: event.authSession } : {}),
    requestSource: event.requestSource,
    storagePolicy,
    redaction: createRedaction(),
  };
}
