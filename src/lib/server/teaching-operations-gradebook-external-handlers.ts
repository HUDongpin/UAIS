import { TeachingOperationStoreError } from "./teaching-operations-error";
import { createGradebookReleaseAuditEvent } from "./teaching-operations-audit-builders";
import { createRedaction, requireSafeId } from "./teaching-operations-guards";
import { formatTimestampId } from "./teaching-operations-record-ids";
import {
  normalizeTeachingGradebookReleaseProviderReceipt,
  normalizeTeachingGradebookReleaseRollbackProviderReceipt,
} from "./teaching-operations-receipt-normalizers";
import type {
  TeachingGradebookReleaseAuditInput,
  TeachingGradebookReleaseProviderReceipt,
  TeachingGradebookReleaseReceipt,
  TeachingGradebookReleaseRollbackProviderReceipt,
  TeachingGradebookReleaseRollbackReceipt,
  TeachingOperationActionId,
  TeachingOperationArtifact,
  TeachingOperationDomainProjection,
  TeachingOperationExternalAppendAdapter,
  TeachingOperationGradeReleaseNotificationProjection,
  TeachingOperationGradeReleaseRollbackNotificationProjection,
  TeachingOperationGradebookUpdateProjection,
  TeachingOperationRecord,
} from "./teaching-operations-types";

// External-storage gradebook release and release-rollback for the
// teaching-operations store, extracted so the store stays under the source-file
// cap once its snapshot writes grew their concurrency guard. These two are the
// append-only half of the pair: they never read or replace the snapshot - the
// caller hands them the projection and an append adapter - so they need no
// revision guard and no retry, which is exactly why they separate cleanly from
// the guarded file/managed flows that stayed behind.
//
// Cycle-free: runtime deps are the extracted audit-builder, guard, record-id,
// receipt-normalizer, and error modules; store types are a type-only import.

export async function releaseExternalTeachingGradebookUpdate(input: {
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  actorId: string;
  audit: TeachingGradebookReleaseAuditInput;
  appendExternalTeachingOperation: TeachingOperationExternalAppendAdapter;
  providerRelease?: TeachingGradebookReleaseProviderReceipt;
  now?: Date;
}): Promise<{
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  notification: TeachingOperationGradeReleaseNotificationProjection;
  receipt: TeachingGradebookReleaseReceipt;
}> {
  const actorId = requireSafeId(input.actorId, "actor id");
  const providerRelease = input.providerRelease
    ? normalizeTeachingGradebookReleaseProviderReceipt(input.providerRelease)
    : undefined;
  const now = input.now ?? new Date();
  const releasedAt = now.toISOString();
  const gradebookUpdate: TeachingOperationGradebookUpdateProjection = {
    ...input.gradebookUpdate,
    updateStatus: "released",
    releasedBy: input.gradebookUpdate.releasedBy ?? actorId,
    releasedAt: input.gradebookUpdate.releasedAt ?? releasedAt,
    ...(providerRelease ?? {}),
  };
  const notification: TeachingOperationGradeReleaseNotificationProjection = {
    objectId: `grade-release-notification-${gradebookUpdate.courseId}`,
    objectType: "grade-release-notification",
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    queuedBy: actorId,
    notificationStatus: "queued",
    deliveryChannel: "student-grade-release-notification",
    operationRecordId: gradebookUpdate.operationRecordId,
    ...(gradebookUpdate.sourceAction ? { sourceAction: gradebookUpdate.sourceAction } : {}),
    deliveryPolicy: "teacher-confirmed-grade-release-before-student-notification",
    queuedAt: releasedAt,
    storagePolicy: "domain-projection-teaching-grade-release-notification",
    redaction: createRedaction(),
  };
  const receipt: TeachingGradebookReleaseReceipt = {
    receiptId: `gradebook-release-${gradebookUpdate.objectId}-${formatTimestampId(now)}`,
    action: "release-gradebook-update",
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    traceId: input.audit.traceId,
    status: "persisted",
    ...(providerRelease ?? {}),
    storagePolicy: "external-redacted-teaching-operation-append",
    storageWritePolicy: "external-append-only-operation-log",
    responsibleSession: "S12",
    createdAt: releasedAt,
    redaction: createRedaction(),
  };
  const auditEvent = createGradebookReleaseAuditEvent({
    audit: input.audit,
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    now,
    createdAt: releasedAt,
  });
  await input.appendExternalTeachingOperation({
    record: createGradebookReleaseExternalRecord({
      receiptId: receipt.receiptId,
      actionId: "save-review-queue",
      actorId,
      courseId: gradebookUpdate.courseId,
      sourceAction: gradebookUpdate.sourceAction,
      createdAt: releasedAt,
      domainProjections: [gradebookUpdate, notification],
    }),
    auditEvent,
  });

  return {
    gradebookUpdate,
    notification,
    receipt,
  };
}

export async function rollbackExternalTeachingGradebookRelease(input: {
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  actorId: string;
  audit: TeachingGradebookReleaseAuditInput;
  appendExternalTeachingOperation: TeachingOperationExternalAppendAdapter;
  providerRollback?: TeachingGradebookReleaseRollbackProviderReceipt;
  now?: Date;
}): Promise<{
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  notification: TeachingOperationGradeReleaseRollbackNotificationProjection;
  receipt: TeachingGradebookReleaseRollbackReceipt;
}> {
  if (input.gradebookUpdate.updateStatus !== "released") {
    throw new TeachingOperationStoreError(409, "Gradebook update is not released.");
  }

  const actorId = requireSafeId(input.actorId, "actor id");
  const now = input.now ?? new Date();
  const rolledBackAt = now.toISOString();
  const providerRollback = input.providerRollback
    ? normalizeTeachingGradebookReleaseRollbackProviderReceipt(input.providerRollback)
    : undefined;
  const gradebookUpdate: TeachingOperationGradebookUpdateProjection = {
    ...input.gradebookUpdate,
    updateStatus: "release-rolled-back",
    releaseRolledBackBy: actorId,
    releaseRolledBackAt: rolledBackAt,
    ...(providerRollback ?? {}),
  };
  const notification: TeachingOperationGradeReleaseRollbackNotificationProjection = {
    objectId: `grade-release-rollback-notification-${gradebookUpdate.courseId}`,
    objectType: "grade-release-rollback-notification",
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    queuedBy: actorId,
    notificationStatus: "queued",
    deliveryChannel: "student-grade-release-rollback-notification",
    operationRecordId: gradebookUpdate.operationRecordId,
    ...(gradebookUpdate.sourceAction ? { sourceAction: gradebookUpdate.sourceAction } : {}),
    deliveryPolicy: "teacher-confirmed-grade-release-rollback-before-student-notification",
    queuedAt: rolledBackAt,
    storagePolicy: "domain-projection-teaching-grade-release-rollback-notification",
    redaction: createRedaction(),
  };
  const receipt: TeachingGradebookReleaseRollbackReceipt = {
    receiptId: `gradebook-release-rollback-${gradebookUpdate.objectId}-${formatTimestampId(now)}`,
    action: "rollback-gradebook-release",
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    traceId: input.audit.traceId,
    status: "persisted",
    ...(providerRollback ?? {}),
    storagePolicy: "external-redacted-teaching-operation-append",
    storageWritePolicy: "external-append-only-operation-log",
    responsibleSession: "S12",
    createdAt: rolledBackAt,
    redaction: createRedaction(),
  };
  const auditEvent = createGradebookReleaseAuditEvent({
    audit: input.audit,
    eventType: "teaching-gradebook-update.release-rolled-back",
    actorId,
    courseId: gradebookUpdate.courseId,
    gradebookUpdateId: gradebookUpdate.objectId,
    now,
    createdAt: rolledBackAt,
  });
  await input.appendExternalTeachingOperation({
    record: createGradebookReleaseExternalRecord({
      receiptId: receipt.receiptId,
      actionId: "save-review-queue",
      actorId,
      courseId: gradebookUpdate.courseId,
      sourceAction: gradebookUpdate.sourceAction,
      createdAt: rolledBackAt,
      domainProjections: [gradebookUpdate, notification],
    }),
    auditEvent,
  });

  return {
    gradebookUpdate,
    notification,
    receipt,
  };
}

function createGradebookReleaseExternalRecord(input: {
  receiptId: string;
  actionId: TeachingOperationActionId;
  actorId: string;
  courseId: string;
  sourceAction?: string;
  createdAt: string;
  domainProjections: TeachingOperationDomainProjection[];
}): TeachingOperationRecord {
  return {
    recordId: input.receiptId,
    operationId: "grading",
    actionSlot: "primary",
    actionId: input.actionId,
    actorId: input.actorId,
    courseId: input.courseId,
    ...(input.sourceAction ? { sourceAction: input.sourceAction } : {}),
    createdAt: input.createdAt,
    status: "persisted",
    storagePolicy: "external-redacted-teaching-operation-append",
    redaction: createRedaction(),
    artifacts: input.domainProjections.map(createDomainProjectionArtifact),
    domainProjections: input.domainProjections,
  };
}

export function createDomainProjectionArtifact(
  projection: TeachingOperationDomainProjection,
): TeachingOperationArtifact {
  return {
    kind: "domain-object",
    objectType: projection.objectType,
    objectId: projection.objectId,
  };
}
