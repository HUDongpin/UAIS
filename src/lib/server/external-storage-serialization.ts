// Pure serialization layer for the external-storage route service (Phase 3
// decomposition): snapshot/revision/empty-database builders, backup-snapshot counters,
// and the full normalize* validation cluster. No filesystem/IO — the service IO and
// handlers import these. Kept a leaf so the ~4.1k service can shed ~1.2k lines.



import { createHash } from "node:crypto";
import type { UaisAiActorRole } from "@/lib/server/ai-access-control";
import type { UaisTeacherAiResourceOwnership } from "@/lib/server/ai-resource-grants";
import {
  normalizeTeachingCourseManagementDatabase,
  type TeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-store";
import {
  normalizeTeachingCourseAssetsDatabase,
  type TeachingCourseAssetsDatabase,
} from "@/lib/server/teaching-course-assets-store";
import type { LearningChatroomTranscriptDatabase } from "@/lib/server/learning-chatroom-transcript-store";
import { HttpError } from "./external-storage-http-error";
import {
  arrayOrEmpty,
  createRedaction,
  isRecord,
  requireAlertSeverity,
  requireIsoDate,
  requireNonNegativeInteger,
  requireRecord,
  requireSafeId,
  requireSafeRole,
  requireTeachingOperationActionSlot,
  requireTeachingOperationAlertReason,
  uniqueSafeIds,
} from "./external-storage-route-guards";

export type QwenVoiceLifecycleAuditEvent = {
  eventId: string;
  eventType: "qwen-voice-lifecycle";
  provider: "qwen";
  providerRole: "voice-clone";
  action: "voice-clone-revoke";
  status: "recorded";
  occurredAt: string;
  actor: {
    actorId: string;
    role: UaisAiActorRole;
  };
  resource: {
    teacherId: string;
    sampleAssetId: string;
    voiceRefId: string;
  };
  deletionReason: "owner-request" | "source-sample-deletion";
  providerRevocation: {
    status: "revoked";
    requestId?: string;
  };
  localReference: {
    status: "deleted";
  };
  localAuditRecord: {
    auditId: string;
    storagePolicy: "local-redacted-lifecycle-audit";
  };
  storagePolicy: "append-only-redacted-lifecycle-audit";
  responsibleSession: "S12/S24";
  redaction: ReturnType<typeof createRedaction>;
};

export function createTeachingCourseManagementSnapshot(
  database: TeachingCourseManagementDatabase,
  revision = createTeachingCourseManagementRevision(database),
) {
  return {
    database,
    revision,
    storagePolicy: "external-redacted-teaching-course-management-snapshot",
    redaction: createRedaction(),
  };
}

export function createTeachingCourseManagementRevision(
  database: TeachingCourseManagementDatabase,
) {
  if (
    database.updatedAt === "1970-01-01T00:00:00.000Z" &&
    database.courses.length === 0 &&
    database.classes.length === 0 &&
    database.memberships.length === 0 &&
    database.auditEvents.length === 0
  ) {
    return "rev-empty";
  }

  return `rev-${createHash("sha256")
    .update(JSON.stringify(database))
    .digest("hex")
    .slice(0, 16)}`;
}

export function createEmptyTeachingCourseManagementDatabase(): TeachingCourseManagementDatabase {
  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    courses: [],
    classes: [],
    memberships: [],
    auditEvents: [],
  };
}


export function createTeachingCourseAssetsSnapshot(
  database: TeachingCourseAssetsDatabase,
  revision = createTeachingCourseAssetsRevision(database),
) {
  return {
    database,
    revision,
    storagePolicy: "external-redacted-teaching-course-cover-assets",
    redaction: createRedaction(),
  };
}

export function createTeachingCourseAssetsRevision(database: TeachingCourseAssetsDatabase) {
  if (
    database.updatedAt === "1970-01-01T00:00:00.000Z" &&
    database.assets.length === 0 &&
    database.auditEvents.length === 0
  ) {
    return "rev-empty";
  }

  return `rev-${createHash("sha256")
    .update(JSON.stringify(database))
    .digest("hex")
    .slice(0, 16)}`;
}

export function createEmptyTeachingCourseAssetsDatabase(): TeachingCourseAssetsDatabase {
  return {
    schemaVersion: "uais-teaching-course-assets-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    assets: [],
    auditEvents: [],
  };
}

export function createLearningChatroomTranscriptsSnapshot(
  database: LearningChatroomTranscriptDatabase,
  revision = createLearningChatroomTranscriptsRevision(database),
) {
  return {
    database,
    revision,
    storagePolicy: "external-redacted-learning-chatroom-transcripts",
    redaction: createRedaction(),
  };
}

export function createLearningChatroomTranscriptsRevision(
  database: LearningChatroomTranscriptDatabase,
) {
  if (
    database.updatedAt === "1970-01-01T00:00:00.000Z" &&
    database.transcripts.length === 0
  ) {
    return "rev-empty";
  }

  return `rev-${createHash("sha256")
    .update(JSON.stringify(database))
    .digest("hex")
    .slice(0, 16)}`;
}

export function countTeachingOperationBackupSnapshot(input: {
  operations: unknown[];
  auditEvents: unknown[];
  rollbacks: unknown[];
  alertNotifications: unknown[];
}) {
  return {
    operations: input.operations.length,
    auditEvents: input.auditEvents.length,
    rollbacks: input.rollbacks.length,
    alertNotifications: input.alertNotifications.length,
  };
}

export function createTeachingCourseManagementBackupReceipt(
  backup: ReturnType<typeof normalizeTeachingCourseManagementBackup>,
) {
  return {
    backupId: backup.backupId,
    status: "persisted" as const,
    eventType: "teaching-course-management-backup.created" as const,
    traceId: backup.traceId,
    requestedBy: backup.requestedBy,
    requestedAt: backup.requestedAt,
    sourceRecordCounts: backup.sourceRecordCounts,
    storagePolicy: "external-redacted-teaching-course-management-backup" as const,
    storageWritePolicy: "external-atomic-backup-snapshot" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

export function createTeachingCourseAssetsBackupReceipt(
  backup: ReturnType<typeof normalizeTeachingCourseAssetsBackup>,
) {
  return {
    backupId: backup.backupId,
    status: "persisted" as const,
    eventType: "teaching-course-assets-backup.created" as const,
    traceId: backup.traceId,
    requestedBy: backup.requestedBy,
    requestedAt: backup.requestedAt,
    sourceRecordCounts: backup.sourceRecordCounts,
    storagePolicy: "external-redacted-teaching-course-assets-backup" as const,
    storageWritePolicy: "external-atomic-backup-snapshot" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

export function countTeachingCourseManagementBackupSnapshot(input: {
  database: TeachingCourseManagementDatabase;
}) {
  return {
    courses: input.database.courses.length,
    classes: input.database.classes.length,
    memberships: input.database.memberships.length,
    auditEvents: input.database.auditEvents.length,
  };
}

export function countTeachingCourseAssetsBackupSnapshot(input: {
  database: TeachingCourseAssetsDatabase;
}) {
  return {
    assets: input.database.assets.length,
    auditEvents: input.database.auditEvents.length,
  };
}

export function normalizeOwnership(value: unknown): UaisTeacherAiResourceOwnership {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teacher AI ownership record must be an object.");
  }
  return {
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    courseIds: uniqueSafeIds(value.courseIds, "course id"),
    sampleAssets: arrayOrEmpty(value.sampleAssets).map((asset) => {
      requireRecord(asset, "sample asset");
      return {
        sampleAssetId: requireSafeId(asset.sampleAssetId, "sample asset id"),
        ...(asset.courseId
          ? { courseId: requireSafeId(asset.courseId, "course id") }
          : {}),
      };
    }),
    pptAssets: arrayOrEmpty(value.pptAssets).map((asset) => {
      requireRecord(asset, "PPT asset");
      return {
        pptAssetId: requireSafeId(asset.pptAssetId, "PPT asset id"),
        ...(asset.courseId
          ? { courseId: requireSafeId(asset.courseId, "course id") }
          : {}),
      };
    }),
    clonedVoiceRefs: arrayOrEmpty(value.clonedVoiceRefs).map((reference) => {
      requireRecord(reference, "cloned voice reference");
      return {
        voiceRefId: requireSafeId(reference.voiceRefId, "voice reference id"),
        ...(reference.sampleAssetId
          ? {
              sampleAssetId: requireSafeId(
                reference.sampleAssetId,
                "sample asset id",
              ),
            }
          : {}),
      };
    }),
    audioManifests: arrayOrEmpty(value.audioManifests).map((manifest) => {
      requireRecord(manifest, "audio manifest");
      return {
        audioManifestId: requireSafeId(manifest.audioManifestId, "audio manifest id"),
        ...(manifest.courseId
          ? { courseId: requireSafeId(manifest.courseId, "course id") }
          : {}),
        ...(manifest.pptAssetId
          ? { pptAssetId: requireSafeId(manifest.pptAssetId, "PPT asset id") }
          : {}),
        ...(manifest.voiceRefId
          ? { voiceRefId: requireSafeId(manifest.voiceRefId, "voice reference id") }
          : {}),
      };
    }),
  };
}

export function normalizeLifecycleAuditEvent(value: unknown): QwenVoiceLifecycleAuditEvent {
  if (!isRecord(value)) {
    throw new HttpError(400, "Lifecycle audit event must be an object.");
  }
  requireRecord(value.actor, "lifecycle audit actor");
  requireRecord(value.resource, "lifecycle audit resource");
  requireRecord(value.providerRevocation, "provider revocation");
  requireRecord(value.localReference, "local reference");
  requireRecord(value.localAuditRecord, "local audit record");
  if (
    value.eventType !== "qwen-voice-lifecycle" ||
    value.provider !== "qwen" ||
    value.providerRole !== "voice-clone" ||
    value.action !== "voice-clone-revoke" ||
    value.status !== "recorded" ||
    value.providerRevocation.status !== "revoked" ||
    value.localReference.status !== "deleted" ||
    value.localAuditRecord.storagePolicy !== "local-redacted-lifecycle-audit" ||
    value.storagePolicy !== "append-only-redacted-lifecycle-audit" ||
    value.responsibleSession !== "S12/S24"
  ) {
    throw new HttpError(400, "Lifecycle audit event policy is invalid.");
  }
  if (
    value.deletionReason !== "owner-request" &&
    value.deletionReason !== "source-sample-deletion"
  ) {
    throw new HttpError(400, "Lifecycle audit deletion reason is invalid.");
  }

  return {
    eventId: requireSafeId(value.eventId, "lifecycle audit event id"),
    eventType: "qwen-voice-lifecycle",
    provider: "qwen",
    providerRole: "voice-clone",
    action: "voice-clone-revoke",
    status: "recorded",
    occurredAt: requireIsoDate(value.occurredAt, "occurredAt"),
    actor: {
      actorId: requireSafeId(value.actor.actorId, "actor id"),
      role: requireSafeRole(value.actor.role),
    },
    resource: {
      teacherId: requireSafeId(value.resource.teacherId, "teacher id"),
      sampleAssetId: requireSafeId(value.resource.sampleAssetId, "sample asset id"),
      voiceRefId: requireSafeId(value.resource.voiceRefId, "voice reference id"),
    },
    deletionReason: value.deletionReason,
    providerRevocation: {
      status: "revoked",
      ...(value.providerRevocation.requestId
        ? {
            requestId: requireSafeId(
              value.providerRevocation.requestId,
              "provider request id",
            ),
          }
        : {}),
    },
    localReference: { status: "deleted" },
    localAuditRecord: {
      auditId: requireSafeId(value.localAuditRecord.auditId, "local audit id"),
      storagePolicy: "local-redacted-lifecycle-audit",
    },
    storagePolicy: "append-only-redacted-lifecycle-audit",
    responsibleSession: "S12/S24",
    redaction: createRedaction(),
  };
}

export function normalizeTeachingOperationRecord(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation record must be an object.");
  }
  if (
    value.status !== "persisted" ||
    value.storagePolicy !== "external-redacted-teaching-operation-append"
  ) {
    throw new HttpError(400, "Teaching operation record policy is invalid.");
  }
  return {
    recordId: requireSafeId(value.recordId, "teaching operation record id"),
    operationId: requireSafeId(value.operationId, "teaching operation id"),
    actionSlot: requireTeachingOperationActionSlot(value.actionSlot),
    actionId: requireSafeId(value.actionId, "teaching operation action id"),
    actorId: requireSafeId(value.actorId, "actor id"),
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    status: "persisted" as const,
    storagePolicy: "external-redacted-teaching-operation-append" as const,
    redaction: createRedaction(),
    artifacts: arrayOrEmpty(value.artifacts).map(normalizeTeachingOperationArtifact),
    domainProjections: arrayOrEmpty(value.domainProjections).map(
      normalizeTeachingOperationDomainProjection,
    ),
  };
}

export function normalizeTeachingOperationDomainProjection(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation domain projection must be an object.");
  }
  const objectId = requireSafeId(value.objectId, "domain object id");
  const objectType = requireSafeId(value.objectType, "domain object type");
  const courseId = requireSafeId(value.courseId, "course id");
  const operationRecordId = requireSafeId(
    value.operationRecordId,
    "operation record id",
  );
  const storagePolicy = requireSafeId(value.storagePolicy, "domain projection policy");
  if (!storagePolicy.startsWith("domain-projection-teaching-")) {
    throw new HttpError(400, "Teaching operation domain projection policy is invalid.");
  }

  return {
    ...Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        requireSafeId(key, "domain projection field"),
        normalizeArtifactValue(entry),
      ]),
    ),
    objectId,
    objectType,
    courseId,
    operationRecordId,
    storagePolicy,
    redaction: createRedaction(),
  };
}

export function normalizeTeachingOperationArtifact(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation artifact must be an object.");
  }
  return {
    kind: requireSafeId(value.kind, "teaching operation artifact kind"),
    ...Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "kind")
        .map(([key, entry]) => [
          requireSafeId(key, "artifact field"),
          normalizeArtifactValue(entry),
        ]),
    ),
  };
}

export function normalizeArtifactValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (/\/Users\/|secret|api[_-]?key|token/i.test(value)) {
      throw new HttpError(400, "Teaching operation artifact contains unsafe text.");
    }
    return value.slice(0, 240);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === undefined ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeArtifactValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        requireSafeId(key, "artifact field"),
        normalizeArtifactValue(entry),
      ]),
    );
  }
  throw new HttpError(400, "Teaching operation artifact contains unsupported data.");
}

export function normalizeTeachingOperationAuditEvent(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation audit event must be an object.");
  }
  requireRecord(value.requestSource, "teaching operation audit request source");
  if (
    (value.eventType === "teaching-gradebook-update.released" ||
      value.eventType === "teaching-gradebook-update.release-rolled-back") &&
    value.actorRole === "teacher" &&
    value.authMode === "signed-teacher-session" &&
    value.requestSource.ipAddress === "redacted"
  ) {
    return {
      auditId: requireSafeId(value.auditId, "teaching operation audit id"),
      traceId: requireSafeId(value.traceId, "trace id"),
      eventType: value.eventType,
      actorId: requireSafeId(value.actorId, "actor id"),
      actorRole: "teacher" as const,
      authMode: "signed-teacher-session" as const,
      courseId: requireSafeId(value.courseId, "course id"),
      gradebookUpdateId: requireSafeId(value.gradebookUpdateId, "gradebook update id"),
      requestSource: {
        userAgent:
          typeof value.requestSource.userAgent === "string" &&
          !/\/Users\/|secret|api[_-]?key|token/i.test(value.requestSource.userAgent)
            ? value.requestSource.userAgent.slice(0, 160)
            : "redacted",
        ipAddress: "redacted" as const,
      },
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      redaction: createRedaction(),
    };
  }
  if (value.eventType === "teaching-operation.rolled-back") {
    if (
      value.actorRole !== "teacher" ||
      value.authMode !== "signed-teacher-session" ||
      value.requestSource.ipAddress !== "redacted"
    ) {
      throw new HttpError(400, "Teaching operation rollback audit event policy is invalid.");
    }
    return {
      auditId: requireSafeId(value.auditId, "teaching operation audit id"),
      traceId: requireSafeId(value.traceId, "trace id"),
      eventType: "teaching-operation.rolled-back" as const,
      actorId: requireSafeId(value.actorId, "actor id"),
      actorRole: "teacher" as const,
      authMode: "signed-teacher-session" as const,
      courseId: requireSafeId(value.courseId, "course id"),
      targetRecordId: requireSafeId(value.targetRecordId, "target record id"),
      operationId: requireSafeId(value.operationId, "teaching operation id"),
      actionSlot: requireTeachingOperationActionSlot(value.actionSlot),
      actionId: requireSafeId(value.actionId, "teaching operation action id"),
      rollbackReason: requireSafeId(value.rollbackReason, "rollback reason"),
      requestSource: {
        userAgent:
          typeof value.requestSource.userAgent === "string" &&
          !/\/Users\/|secret|api[_-]?key|token/i.test(value.requestSource.userAgent)
            ? value.requestSource.userAgent.slice(0, 160)
            : "redacted",
        ipAddress: "redacted" as const,
      },
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      redaction: createRedaction(),
    };
  }
  if (
    value.eventType !== "teaching-operation.persisted" ||
    value.actorRole !== "teacher" ||
    value.authMode !== "signed-teacher-session" ||
    value.requestSource.ipAddress !== "redacted"
  ) {
    throw new HttpError(400, "Teaching operation audit event policy is invalid.");
  }
  return {
    auditId: requireSafeId(value.auditId, "teaching operation audit id"),
    traceId: requireSafeId(value.traceId, "trace id"),
    eventType: "teaching-operation.persisted" as const,
    actorId: requireSafeId(value.actorId, "actor id"),
    actorRole: "teacher" as const,
    authMode: "signed-teacher-session" as const,
    operationId: requireSafeId(value.operationId, "teaching operation id"),
    actionSlot: requireTeachingOperationActionSlot(value.actionSlot),
    actionId: requireSafeId(value.actionId, "teaching operation action id"),
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    ...(value.sourceAction
      ? { sourceAction: requireSafeId(value.sourceAction, "source action") }
      : {}),
    requestSource: {
      userAgent:
        typeof value.requestSource.userAgent === "string" &&
        !/\/Users\/|secret|api[_-]?key|token/i.test(value.requestSource.userAgent)
          ? value.requestSource.userAgent.slice(0, 160)
          : "redacted",
      ipAddress: "redacted" as const,
    },
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    redaction: createRedaction(),
  };
}

export function normalizeTeachingOperationRollbackRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation rollback request must be an object.");
  }
  if (value.action !== "rollback-teaching-operation-record") {
    throw new HttpError(400, "Unsupported teaching operation rollback action.");
  }
  requireRecord(value.requestSource, "teaching operation rollback request source");
  if (value.requestSource.ipAddress !== "redacted") {
    throw new HttpError(400, "Teaching operation rollback request source is invalid.");
  }

  return {
    courseId: requireSafeId(value.courseId, "course id"),
    rollbackReason: requireSafeId(value.rollbackReason, "rollback reason"),
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    requestSource: {
      userAgent:
        typeof value.requestSource.userAgent === "string" &&
        !/\/Users\/|secret|api[_-]?key|token/i.test(value.requestSource.userAgent)
          ? value.requestSource.userAgent.slice(0, 160)
          : "redacted",
      ipAddress: "redacted" as const,
    },
  };
}

export function normalizeTeachingOperationBackupRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation backup request must be an object.");
  }
  if (value.action !== "create-teaching-operation-backup") {
    throw new HttpError(400, "Unsupported teaching operation backup action.");
  }
  return {
    requestedBy: requireSafeId(value.requestedBy, "teaching operation backup requester"),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

export function normalizeTeachingCourseManagementBackupRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course management backup request must be an object.",
    );
  }
  if (value.action !== "create-teaching-course-management-backup") {
    throw new HttpError(400, "Unsupported teaching course management backup action.");
  }
  return {
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course management backup requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

export function normalizeTeachingCourseManagementRestoreDrillRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course management restore drill request must be an object.",
    );
  }
  if (value.action !== "verify-teaching-course-management-backup-restore") {
    throw new HttpError(
      400,
      "Unsupported teaching course management restore drill action.",
    );
  }
  return {
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course management restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

export function normalizeTeachingCourseAssetsBackupRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course assets backup request must be an object.");
  }
  if (value.action !== "create-teaching-course-assets-backup") {
    throw new HttpError(400, "Unsupported teaching course assets backup action.");
  }
  return {
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course assets backup requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

export function normalizeTeachingCourseAssetsRestoreDrillRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course assets restore drill request must be an object.",
    );
  }
  if (value.action !== "verify-teaching-course-assets-backup-restore") {
    throw new HttpError(400, "Unsupported teaching course assets restore drill action.");
  }
  return {
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course assets restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

export function normalizeTeachingOperationRestoreDrillRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching operation restore drill request must be an object.",
    );
  }
  if (value.action !== "verify-teaching-operation-backup-restore") {
    throw new HttpError(400, "Unsupported teaching operation restore drill action.");
  }
  return {
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching operation restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

export function normalizeTeachingOperationAuditLedgerEntry(
  value: unknown,
  teacherId: string,
) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation audit ledger entry must be an object.");
  }
  if (
    value.storagePolicy !== "external-redacted-teaching-operation-audit-log" ||
    value.storageWritePolicy !== "external-append-only-audit-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation audit ledger policy is invalid.");
  }
  const auditEvent = normalizeTeachingOperationAuditEvent(value.auditEvent);
  if (auditEvent.actorId !== teacherId) {
    throw new Error("Stored teaching operation audit actor id mismatch.");
  }
  return auditEvent;
}

export function normalizeTeachingOperationRollbackLedgerEntry(
  value: unknown,
  teacherId: string,
) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation rollback ledger entry must be an object.");
  }
  if (
    value.storagePolicy !== "external-redacted-teaching-operation-rollback" ||
    value.storageWritePolicy !== "external-append-only-rollback-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation rollback ledger policy is invalid.");
  }
  const rollback = normalizeTeachingOperationRollbackRecord(value.rollback);
  if (rollback.teacherId !== teacherId) {
    throw new Error("Stored teaching operation rollback teacher id mismatch.");
  }
  return rollback;
}

export function normalizeTeachingOperationRollbackRecord(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation rollback record must be an object.");
  }
  if (
    value.action !== "rollback-teaching-operation-record" ||
    value.status !== "persisted" ||
    value.storagePolicy !== "external-redacted-teaching-operation-rollback" ||
    value.storageWritePolicy !== "external-append-only-rollback-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation rollback record policy is invalid.");
  }

  return {
    rollbackId: requireSafeId(value.rollbackId, "teaching operation rollback id"),
    action: "rollback-teaching-operation-record" as const,
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    targetRecordId: requireSafeId(value.targetRecordId, "target record id"),
    courseId: requireSafeId(value.courseId, "course id"),
    targetOperationId: requireSafeId(value.targetOperationId, "target operation id"),
    targetActionSlot: requireTeachingOperationActionSlot(value.targetActionSlot),
    targetActionId: requireSafeId(value.targetActionId, "target action id"),
    rollbackReason: requireSafeId(value.rollbackReason, "rollback reason"),
    status: "persisted" as const,
    rolledBackAt: requireIsoDate(value.rolledBackAt, "rolledBackAt"),
    storagePolicy: "external-redacted-teaching-operation-rollback" as const,
    storageWritePolicy: "external-append-only-rollback-log" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

export function normalizeTeachingOperationBackup(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation backup must be an object.");
  }
  if (
    value.status !== "persisted" ||
    value.eventType !== "teaching-operation-backup.created" ||
    value.storagePolicy !== "external-redacted-teaching-operation-backup" ||
    value.storageWritePolicy !== "external-atomic-backup-snapshot" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation backup policy is invalid.");
  }
  const snapshot = normalizeTeachingOperationBackupSnapshot(value.snapshot);
  const sourceRecordCounts = normalizeTeachingOperationRecordCounts(
    value.sourceRecordCounts,
  );
  const actualRecordCounts = countTeachingOperationBackupSnapshot(snapshot);
  if (
    sourceRecordCounts.operations !== actualRecordCounts.operations ||
    sourceRecordCounts.auditEvents !== actualRecordCounts.auditEvents ||
    sourceRecordCounts.rollbacks !== actualRecordCounts.rollbacks ||
    sourceRecordCounts.alertNotifications !== actualRecordCounts.alertNotifications
  ) {
    throw new HttpError(400, "Teaching operation backup record counts are invalid.");
  }

  return {
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    backupId: requireSafeId(value.backupId, "teaching operation backup id"),
    status: "persisted" as const,
    eventType: "teaching-operation-backup.created" as const,
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(value.requestedBy, "teaching operation backup requester"),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-operation-backup" as const,
    storageWritePolicy: "external-atomic-backup-snapshot" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

export function normalizeTeachingOperationBackupSnapshot(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation backup snapshot must be an object.");
  }
  return {
    operations: arrayOrEmpty(value.operations).map(normalizeTeachingOperationRecord),
    auditEvents: arrayOrEmpty(value.auditEvents).map(normalizeTeachingOperationAuditEvent),
    rollbacks: arrayOrEmpty(value.rollbacks).map(normalizeTeachingOperationRollbackRecord),
    alertNotifications: arrayOrEmpty(value.alertNotifications).map(
      (notification) => normalizeTeachingOperationAlertNotification(notification),
    ),
  };
}

export function normalizeTeachingOperationRecordCounts(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation record counts must be an object.");
  }
  return {
    operations: requireNonNegativeInteger(value.operations, "operation count"),
    auditEvents: requireNonNegativeInteger(value.auditEvents, "audit event count"),
    rollbacks: requireNonNegativeInteger(value.rollbacks, "rollback count"),
    alertNotifications: requireNonNegativeInteger(
      value.alertNotifications,
      "alert notification count",
    ),
  };
}

export function normalizeTeachingCourseManagementBackup(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course management backup must be an object.");
  }
  if (
    value.status !== "persisted" ||
    value.eventType !== "teaching-course-management-backup.created" ||
    value.storagePolicy !== "external-redacted-teaching-course-management-backup" ||
    value.storageWritePolicy !== "external-atomic-backup-snapshot" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching course management backup policy is invalid.");
  }
  const snapshot = normalizeTeachingCourseManagementBackupSnapshot(value.snapshot);
  const sourceRecordCounts = normalizeTeachingCourseManagementRecordCounts(
    value.sourceRecordCounts,
  );
  const actualRecordCounts = countTeachingCourseManagementBackupSnapshot(snapshot);
  if (
    sourceRecordCounts.courses !== actualRecordCounts.courses ||
    sourceRecordCounts.classes !== actualRecordCounts.classes ||
    sourceRecordCounts.memberships !== actualRecordCounts.memberships ||
    sourceRecordCounts.auditEvents !== actualRecordCounts.auditEvents
  ) {
    throw new HttpError(400, "Teaching course management backup record counts are invalid.");
  }

  return {
    backupId: requireSafeId(value.backupId, "teaching course management backup id"),
    status: "persisted" as const,
    eventType: "teaching-course-management-backup.created" as const,
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course management backup requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-course-management-backup" as const,
    storageWritePolicy: "external-atomic-backup-snapshot" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

export function normalizeTeachingCourseManagementBackupSnapshot(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course management backup snapshot must be an object.",
    );
  }
  if (value.storagePolicy !== "external-redacted-teaching-course-management-snapshot") {
    throw new HttpError(
      400,
      "Teaching course management backup snapshot policy is invalid.",
    );
  }
  const database = normalizeTeachingCourseManagementDatabase(value.database);
  const revision =
    typeof value.revision === "string" && value.revision.trim()
      ? value.revision
      : createTeachingCourseManagementRevision(database);
  return createTeachingCourseManagementSnapshot(database, revision);
}

export function normalizeTeachingCourseManagementRecordCounts(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course management record counts must be an object.",
    );
  }
  return {
    courses: requireNonNegativeInteger(value.courses, "course count"),
    classes: requireNonNegativeInteger(value.classes, "class count"),
    memberships: requireNonNegativeInteger(value.memberships, "membership count"),
    auditEvents: requireNonNegativeInteger(value.auditEvents, "audit event count"),
  };
}

export function normalizeTeachingCourseManagementRestoreDrill(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course management restore drill must be an object.",
    );
  }
  if (
    value.status !== "verified" ||
    value.eventType !== "teaching-course-management-backup.restore-drill-verified" ||
    value.storagePolicy !== "external-redacted-teaching-course-management-restore-drill" ||
    value.storageWritePolicy !== "external-append-only-restore-drill-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(
      400,
      "Teaching course management restore drill policy is invalid.",
    );
  }
  return {
    backupId: requireSafeId(value.backupId, "teaching course management backup id"),
    drillId: requireSafeId(
      value.drillId,
      "teaching course management restore drill id",
    ),
    status: "verified" as const,
    eventType: "teaching-course-management-backup.restore-drill-verified" as const,
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course management restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    restoredRecordCounts: normalizeTeachingCourseManagementRecordCounts(
      value.restoredRecordCounts,
    ),
    storagePolicy: "external-redacted-teaching-course-management-restore-drill" as const,
    storageWritePolicy: "external-append-only-restore-drill-log" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

export function normalizeTeachingCourseAssetsBackup(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course assets backup must be an object.");
  }
  if (
    value.status !== "persisted" ||
    value.eventType !== "teaching-course-assets-backup.created" ||
    value.storagePolicy !== "external-redacted-teaching-course-assets-backup" ||
    value.storageWritePolicy !== "external-atomic-backup-snapshot" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching course assets backup policy is invalid.");
  }
  const snapshot = normalizeTeachingCourseAssetsBackupSnapshot(value.snapshot);
  const sourceRecordCounts = normalizeTeachingCourseAssetsRecordCounts(
    value.sourceRecordCounts,
  );
  const actualRecordCounts = countTeachingCourseAssetsBackupSnapshot(snapshot);
  if (
    sourceRecordCounts.assets !== actualRecordCounts.assets ||
    sourceRecordCounts.auditEvents !== actualRecordCounts.auditEvents
  ) {
    throw new HttpError(400, "Teaching course assets backup record counts are invalid.");
  }

  return {
    backupId: requireSafeId(value.backupId, "teaching course assets backup id"),
    status: "persisted" as const,
    eventType: "teaching-course-assets-backup.created" as const,
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course assets backup requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-course-assets-backup" as const,
    storageWritePolicy: "external-atomic-backup-snapshot" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

export function normalizeTeachingCourseAssetsBackupSnapshot(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course assets backup snapshot must be an object.");
  }
  if (value.storagePolicy !== "external-redacted-teaching-course-cover-assets") {
    throw new HttpError(
      400,
      "Teaching course assets backup snapshot policy is invalid.",
    );
  }
  const database = normalizeTeachingCourseAssetsDatabase(value.database);
  const revision =
    typeof value.revision === "string" && value.revision.trim()
      ? value.revision
      : createTeachingCourseAssetsRevision(database);
  return createTeachingCourseAssetsSnapshot(database, revision);
}

export function normalizeTeachingCourseAssetsRecordCounts(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course assets record counts must be an object.");
  }
  return {
    assets: requireNonNegativeInteger(value.assets, "course asset count"),
    auditEvents: requireNonNegativeInteger(value.auditEvents, "audit event count"),
  };
}

export function normalizeTeachingCourseAssetsRestoreDrill(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course assets restore drill must be an object.");
  }
  if (
    value.status !== "verified" ||
    value.eventType !== "teaching-course-assets-backup.restore-drill-verified" ||
    value.storagePolicy !== "external-redacted-teaching-course-assets-restore-drill" ||
    value.storageWritePolicy !== "external-append-only-restore-drill-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching course assets restore drill policy is invalid.");
  }
  return {
    backupId: requireSafeId(value.backupId, "teaching course assets backup id"),
    drillId: requireSafeId(value.drillId, "teaching course assets restore drill id"),
    status: "verified" as const,
    eventType: "teaching-course-assets-backup.restore-drill-verified" as const,
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course assets restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    restoredRecordCounts: normalizeTeachingCourseAssetsRecordCounts(
      value.restoredRecordCounts,
    ),
    storagePolicy: "external-redacted-teaching-course-assets-restore-drill" as const,
    storageWritePolicy: "external-append-only-restore-drill-log" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

export function normalizeTeachingOperationRestoreDrill(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation restore drill must be an object.");
  }
  if (
    value.status !== "verified" ||
    value.eventType !== "teaching-operation-backup.restore-drill-verified" ||
    value.storagePolicy !== "external-redacted-teaching-operation-restore-drill" ||
    value.storageWritePolicy !== "external-append-only-restore-drill-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation restore drill policy is invalid.");
  }
  return {
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    backupId: requireSafeId(value.backupId, "teaching operation backup id"),
    drillId: requireSafeId(value.drillId, "teaching operation restore drill id"),
    status: "verified" as const,
    eventType: "teaching-operation-backup.restore-drill-verified" as const,
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching operation restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    restoredRecordCounts: normalizeTeachingOperationRecordCounts(
      value.restoredRecordCounts,
    ),
    storagePolicy: "external-redacted-teaching-operation-restore-drill" as const,
    storageWritePolicy: "external-append-only-restore-drill-log" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

export function normalizeAlertNotificationRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Alert notification request must be an object.");
  }
  if (value.action !== "enqueue-teaching-operation-audit-alert-notifications") {
    throw new HttpError(400, "Unsupported alert notification action.");
  }
  return {
    requestedBy: requireSafeId(value.requestedBy, "alert notification requester"),
    requestedAt: value.requestedAt
      ? requireIsoDate(value.requestedAt, "requestedAt")
      : new Date().toISOString(),
  };
}

export function normalizeTeachingOperationAlertNotification(
  value: unknown,
  expectedTeacherId?: string,
) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation alert notification must be an object.");
  }
  if (
    value.eventType !== "teaching-operation-audit-alert-notification" ||
    value.deliveryChannel !== "admin-outbox" ||
    value.deliveryStatus !== "queued" ||
    value.storagePolicy !==
      "external-redacted-teaching-operation-audit-alert-notification-outbox" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation alert notification policy is invalid.");
  }

  const notification = {
    notificationId: requireSafeId(
      value.notificationId,
      "teaching operation alert notification id",
    ),
    eventType: "teaching-operation-audit-alert-notification" as const,
    deliveryChannel: "admin-outbox" as const,
    deliveryStatus: "queued" as const,
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    alertId: requireSafeId(value.alertId, "teaching operation alert id"),
    severity: requireAlertSeverity(value.severity),
    reason: requireTeachingOperationAlertReason(value.reason),
    auditId: requireSafeId(value.auditId, "teaching operation audit id"),
    traceId: requireSafeId(value.traceId, "trace id"),
    actorId: requireSafeId(value.actorId, "actor id"),
    operationId: requireSafeId(value.operationId, "teaching operation id"),
    actionSlot: requireTeachingOperationActionSlot(value.actionSlot),
    actionId: requireSafeId(value.actionId, "teaching operation action id"),
    requestedBy: requireSafeId(value.requestedBy, "alert notification requester"),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    queuedAt: requireIsoDate(value.queuedAt, "queuedAt"),
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-notification-outbox" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
  if (
    expectedTeacherId &&
    (notification.teacherId !== expectedTeacherId ||
      notification.actorId !== expectedTeacherId)
  ) {
    throw new Error("Stored teaching operation alert notification teacher id mismatch.");
  }
  return notification;
}

export function normalizeTeachingOperationAlertWebhookDelivery(value: unknown) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching operation alert webhook delivery must be an object.",
    );
  }
  if (
    value.eventType !== "teaching-operation-audit-alert-webhook-delivery" ||
    value.deliveryChannel !== "admin-webhook" ||
    (value.deliveryStatus !== "delivered" && value.deliveryStatus !== "failed") ||
    value.provider !== "configured-admin-alert-webhook" ||
    value.endpoint !== "redacted" ||
    value.storagePolicy !==
      "external-redacted-teaching-operation-audit-alert-webhook-delivery" ||
    value.storageWritePolicy !== "external-append-only-webhook-delivery-ledger" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(
      400,
      "Teaching operation alert webhook delivery policy is invalid.",
    );
  }

  return {
    deliveryId: requireSafeId(
      value.deliveryId,
      "teaching operation alert webhook delivery id",
    ),
    eventType: "teaching-operation-audit-alert-webhook-delivery" as const,
    deliveryChannel: "admin-webhook" as const,
    deliveryStatus: value.deliveryStatus,
    provider: "configured-admin-alert-webhook" as const,
    endpoint: "redacted" as const,
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    requestedBy: requireSafeId(value.requestedBy, "alert notification requester"),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    deliveredAt: requireIsoDate(value.deliveredAt, "deliveredAt"),
    responseStatus: requireNonNegativeInteger(
      value.responseStatus,
      "webhook delivery response status",
    ),
    notificationCount: requireNonNegativeInteger(
      value.notificationCount,
      "webhook delivery notification count",
    ),
    notificationIds: arrayOrEmpty(value.notificationIds).map((notificationId) =>
      requireSafeId(notificationId, "teaching operation alert notification id"),
    ),
    traceIds: arrayOrEmpty(value.traceIds).map((traceId) =>
      requireSafeId(traceId, "trace id"),
    ),
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-webhook-delivery" as const,
    storageWritePolicy: "external-append-only-webhook-delivery-ledger" as const,
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}

