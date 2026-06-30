import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import type { QwenClonedVoiceDeletionReason } from "@/lib/ai/voice/cloned-voice-registry";
import type { UaisAiActorRole } from "@/lib/server/ai-access-control";

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
  deletionReason: QwenClonedVoiceDeletionReason;
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
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "ids-only";
  };
};

export type QwenVoiceLifecycleAuditReceipt = {
  eventId: string;
  provider: "qwen";
  providerRole: "voice-clone";
  action: "voice-clone-revoke";
  status: "recorded";
  storagePolicy: "append-only-redacted-lifecycle-audit";
  responsibleSession: "S12/S24";
  redaction: QwenVoiceLifecycleAuditEvent["redaction"];
};

export type QwenVoiceLifecycleAuditIndex = {
  provider: "qwen";
  providerRole: "voice-clone";
  eventType: "qwen-voice-lifecycle";
  storagePolicy: "append-only-redacted-lifecycle-audit";
  recordCount: number;
  events: QwenVoiceLifecycleAuditEvent[];
  responsibleSession: "S12/S24";
  redaction: QwenVoiceLifecycleAuditEvent["redaction"];
};

export type QwenVoiceLifecycleAuditAdapter = {
  appendEvent(event: QwenVoiceLifecycleAuditEvent): Promise<QwenVoiceLifecycleAuditReceipt>;
  listEvents(): Promise<QwenVoiceLifecycleAuditIndex>;
};

const DEFAULT_LIFECYCLE_AUDIT_DIR = join(
  cwd(),
  ".tmp",
  "uais-ai-assets",
  "lifecycle-audit",
);
const QWEN_VOICE_LIFECYCLE_AUDIT_FILENAME = "qwen-voice-lifecycle-audit.jsonl";

export function createQwenVoiceLifecycleAuditEvent(input: {
  eventId: string;
  occurredAt?: string;
  actor: QwenVoiceLifecycleAuditEvent["actor"];
  resource: QwenVoiceLifecycleAuditEvent["resource"];
  deletionReason: QwenClonedVoiceDeletionReason;
  providerRevocation: QwenVoiceLifecycleAuditEvent["providerRevocation"];
  localReference: QwenVoiceLifecycleAuditEvent["localReference"];
  localAuditRecord: QwenVoiceLifecycleAuditEvent["localAuditRecord"];
}): QwenVoiceLifecycleAuditEvent {
  const event: QwenVoiceLifecycleAuditEvent = {
    eventId: requireSafeEventId(input.eventId),
    eventType: "qwen-voice-lifecycle",
    provider: "qwen",
    providerRole: "voice-clone",
    action: "voice-clone-revoke",
    status: "recorded",
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    actor: {
      actorId: requireSafePublicId(input.actor.actorId, "actor id"),
      role: input.actor.role,
    },
    resource: {
      teacherId: requireSafePublicId(input.resource.teacherId, "teacher id"),
      sampleAssetId: requireSafePublicId(input.resource.sampleAssetId, "sample asset id"),
      voiceRefId: requireSafePublicId(input.resource.voiceRefId, "voice reference id"),
    },
    deletionReason: input.deletionReason,
    providerRevocation: {
      status: "revoked",
      ...(input.providerRevocation.requestId
        ? { requestId: requireSafePublicId(input.providerRevocation.requestId, "provider request id") }
        : {}),
    },
    localReference: {
      status: "deleted",
    },
    localAuditRecord: {
      auditId: requireSafeEventId(input.localAuditRecord.auditId),
      storagePolicy: "local-redacted-lifecycle-audit",
    },
    storagePolicy: "append-only-redacted-lifecycle-audit",
    responsibleSession: "S12/S24",
    redaction: createRedaction(),
  };
  assertLifecycleAuditEventIsDisplaySafe(event);
  return event;
}

export async function appendQwenVoiceLifecycleAuditEvent(input: {
  baseDir?: string;
  event: QwenVoiceLifecycleAuditEvent;
}): Promise<QwenVoiceLifecycleAuditReceipt> {
  assertLifecycleAuditEventIsDisplaySafe(input.event);
  const baseDir = resolveLifecycleAuditBaseDir(input.baseDir);
  await mkdir(baseDir, { recursive: true });
  const auditPath = resolve(baseDir, QWEN_VOICE_LIFECYCLE_AUDIT_FILENAME);
  ensureWithinBase(baseDir, auditPath);
  await appendFile(auditPath, `${JSON.stringify(input.event)}\n`, "utf8");

  return {
    eventId: input.event.eventId,
    provider: "qwen",
    providerRole: "voice-clone",
    action: "voice-clone-revoke",
    status: "recorded",
    storagePolicy: "append-only-redacted-lifecycle-audit",
    responsibleSession: "S12/S24",
    redaction: createRedaction(),
  };
}

export async function listQwenVoiceLifecycleAuditEvents(input: {
  baseDir?: string;
} = {}): Promise<QwenVoiceLifecycleAuditIndex> {
  const baseDir = resolveLifecycleAuditBaseDir(input.baseDir);
  const auditPath = resolve(baseDir, QWEN_VOICE_LIFECYCLE_AUDIT_FILENAME);
  ensureWithinBase(baseDir, auditPath);
  const auditJsonl = await readFile(auditPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });

  const events = auditJsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => toQwenVoiceLifecycleAuditEvent(JSON.parse(line)));

  events.sort((left, right) => {
    const byOccurredAt = left.occurredAt.localeCompare(right.occurredAt);
    return byOccurredAt === 0 ? left.eventId.localeCompare(right.eventId) : byOccurredAt;
  });

  const index: QwenVoiceLifecycleAuditIndex = {
    provider: "qwen",
    providerRole: "voice-clone",
    eventType: "qwen-voice-lifecycle",
    storagePolicy: "append-only-redacted-lifecycle-audit",
    recordCount: events.length,
    events,
    responsibleSession: "S12/S24",
    redaction: createRedaction(),
  };
  assertLifecycleAuditEventIsDisplaySafe(index);
  return index;
}

export function createQwenVoiceLifecycleAuditAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): QwenVoiceLifecycleAuditAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
    value: input.env.UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND,
    responsibleSession: "S24",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return {
      appendEvent: (event) => appendQwenVoiceLifecycleAuditEvent({ event }),
      listEvents: () => listQwenVoiceLifecycleAuditEvents(),
    };
  }

  if (isExternalStorageBackendReadyContract(backendContract)) {
    return createExternalQwenVoiceLifecycleAuditAdapter(input);
  }

  return undefined;
}

export function buildQwenVoiceLifecycleEventId(input: {
  voiceRefId: string;
  occurredAt?: string;
}) {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const compactTimestamp = occurredAt.replace(/[^0-9A-Za-z]/g, "");
  return requireSafeEventId(`qwen-voice-lifecycle-${input.voiceRefId}-${compactTimestamp}`);
}

function createExternalQwenVoiceLifecycleAuditAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): QwenVoiceLifecycleAuditAdapter | undefined {
  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    return undefined;
  }
  const fetchImpl = input.fetch ?? fetch;
  const endpoint = `${config.baseUrl}/qwen-voice-lifecycle-audit`;

  return {
    async appendEvent(event) {
      assertLifecycleAuditEventIsDisplaySafe(event);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error("External Qwen voice lifecycle audit append failed.");
      }
      return createQwenVoiceLifecycleAuditReceipt(event);
    },
    async listEvents() {
      const response = await fetchImpl(endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error("External Qwen voice lifecycle audit index request failed.");
      }
      return toQwenVoiceLifecycleAuditIndex(await response.json());
    },
  };
}

function resolveLifecycleAuditBaseDir(baseDir?: string) {
  return baseDir ? resolve(baseDir) : DEFAULT_LIFECYCLE_AUDIT_DIR;
}

function ensureWithinBase(baseDir: string, targetPath: string) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new Error("Resolved lifecycle audit path escapes the configured storage directory.");
  }
}

function requireSafePublicId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function requireSafeEventId(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid lifecycle audit event id.");
  }
  return value;
}

function toQwenVoiceLifecycleAuditEvent(value: unknown): QwenVoiceLifecycleAuditEvent {
  const event = value as QwenVoiceLifecycleAuditEvent;
  if (
    event.eventType !== "qwen-voice-lifecycle" ||
    event.provider !== "qwen" ||
    event.providerRole !== "voice-clone" ||
    event.action !== "voice-clone-revoke" ||
    event.status !== "recorded" ||
    event.providerRevocation?.status !== "revoked" ||
    event.localReference?.status !== "deleted" ||
    event.localAuditRecord?.storagePolicy !== "local-redacted-lifecycle-audit" ||
    event.storagePolicy !== "append-only-redacted-lifecycle-audit" ||
    event.responsibleSession !== "S12/S24" ||
    !event.occurredAt?.trim()
  ) {
    throw new Error("Invalid Qwen voice lifecycle audit event.");
  }

  return createQwenVoiceLifecycleAuditEvent({
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    actor: event.actor,
    resource: event.resource,
    deletionReason: event.deletionReason,
    providerRevocation: event.providerRevocation,
    localReference: event.localReference,
    localAuditRecord: event.localAuditRecord,
  });
}

function toQwenVoiceLifecycleAuditIndex(value: unknown): QwenVoiceLifecycleAuditIndex {
  const index = value as QwenVoiceLifecycleAuditIndex;
  if (
    index.provider !== "qwen" ||
    index.providerRole !== "voice-clone" ||
    index.eventType !== "qwen-voice-lifecycle" ||
    index.storagePolicy !== "append-only-redacted-lifecycle-audit" ||
    index.responsibleSession !== "S12/S24" ||
    !Array.isArray(index.events)
  ) {
    throw new Error("Invalid Qwen voice lifecycle audit index.");
  }
  const events = index.events.map(toQwenVoiceLifecycleAuditEvent);
  const safeIndex: QwenVoiceLifecycleAuditIndex = {
    provider: "qwen",
    providerRole: "voice-clone",
    eventType: "qwen-voice-lifecycle",
    storagePolicy: "append-only-redacted-lifecycle-audit",
    recordCount: events.length,
    events,
    responsibleSession: "S12/S24",
    redaction: createRedaction(),
  };
  assertLifecycleAuditEventIsDisplaySafe(safeIndex);
  return safeIndex;
}

function createQwenVoiceLifecycleAuditReceipt(
  event: QwenVoiceLifecycleAuditEvent,
): QwenVoiceLifecycleAuditReceipt {
  return {
    eventId: event.eventId,
    provider: "qwen",
    providerRole: "voice-clone",
    action: "voice-clone-revoke",
    status: "recorded",
    storagePolicy: "append-only-redacted-lifecycle-audit",
    responsibleSession: "S12/S24",
    redaction: createRedaction(),
  };
}

function assertLifecycleAuditEventIsDisplaySafe(event: unknown) {
  const serialized = JSON.stringify(event);
  if (UNSAFE_AUDIT_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("Lifecycle audit event contains non-auditable private data.");
  }
}

function createRedaction(): QwenVoiceLifecycleAuditEvent["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

const UNSAFE_AUDIT_PATTERNS = [
  /sk-[A-Za-z0-9]/,
  /(?:DASHSCOPE_API_KEY|DEEPSEEK_API_KEY|UAIS_LIVE_AI_APPROVAL_TOKEN|UAIS_AI_ACCESS_SIGNING_SECRET|UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET|UAIS_TEACHER_AUTH_ISSUER_SECRET|UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN)\s*=\s*[^"',}\]\s]+/,
  new RegExp("voice-qwen-" + "private"),
  /\/Users\/dongpinhu\/Library\/Containers/,
  /data:audio\/[^"',}\]\s]+base64/i,
  new RegExp("audio" + "Base64", "i"),
];
