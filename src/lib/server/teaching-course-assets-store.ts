import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import type { QwenCourseCoverGenerateResult } from "@/lib/ai/providers/qwen-client";

type TeachingCourseAssetRedaction = {
  secrets: "omitted";
  localFiles: "omitted";
  assets: "generated-url-only";
};

export type TeachingCourseCoverAssetStoragePolicy =
  | "local-json-teaching-course-cover-assets"
  | "external-redacted-teaching-course-cover-assets";

export type TeachingCourseCoverAssetStorageWritePolicy =
  | "atomic-json-file-replace"
  | "external-optimistic-snapshot-replace";

export type TeachingCourseCoverAuditStoragePolicy =
  | "local-json-teaching-course-cover-audit-log"
  | "external-redacted-teaching-course-cover-audit-log";

export type TeachingCourseAssetsStorageDescriptor = {
  assetStoragePolicy: TeachingCourseCoverAssetStoragePolicy;
  auditStoragePolicy: TeachingCourseCoverAuditStoragePolicy;
  storageWritePolicy: TeachingCourseCoverAssetStorageWritePolicy;
};

export type TeachingCourseCoverAssetRecord = {
  assetId: string;
  assetType: "course-cover";
  courseId?: string;
  courseName: string;
  provider: "qwen";
  providerRole: "image-generation";
  imageUrl: string;
  model: string;
  providerRequestId?: string;
  createdAt: string;
  storagePolicy: TeachingCourseCoverAssetStoragePolicy;
  storageWritePolicy: TeachingCourseCoverAssetStorageWritePolicy;
  responsibleSession: "S12";
  redaction: TeachingCourseAssetRedaction;
};

export type TeachingCourseCoverAuditRequestSource = {
  userAgent: string;
  ipAddress: "redacted";
};

export type TeachingCourseCoverAuditAuthSession = {
  sessionId: string;
  authenticatedAt: string;
  expiresAt: string;
};

export type TeachingCourseCoverAuditEvent = {
  auditId: string;
  traceId: string;
  eventType: "teaching-course-cover.generated";
  actorId: string;
  actorRole: "teacher";
  authMode: "signed-teacher-session";
  authSession?: TeachingCourseCoverAuditAuthSession;
  courseId: string;
  assetId: string;
  providerRequestId?: string;
  requestSource: TeachingCourseCoverAuditRequestSource;
  createdAt: string;
  storagePolicy: TeachingCourseCoverAuditStoragePolicy;
  redaction: TeachingCourseAssetRedaction;
};

export type TeachingCourseAssetsDatabase = {
  schemaVersion: "uais-teaching-course-assets-v1";
  updatedAt: string;
  assets: TeachingCourseCoverAssetRecord[];
  auditEvents: TeachingCourseCoverAuditEvent[];
};

export type TeachingCourseAssetsRepositorySnapshot = {
  database: TeachingCourseAssetsDatabase;
  revision?: string;
};

export type TeachingCourseAssetsRepository = {
  storage: TeachingCourseAssetsStorageDescriptor;
  read: () => Promise<TeachingCourseAssetsRepositorySnapshot>;
  write: (input: {
    database: TeachingCourseAssetsDatabase;
    expectedRevision?: string;
  }) => Promise<void>;
};

export type TeachingCourseCoverAssetPersistenceReceipt = {
  status: "persisted";
  storagePolicy: TeachingCourseCoverAssetStoragePolicy;
  storageWritePolicy: TeachingCourseCoverAssetStorageWritePolicy;
  concurrencyControl: "atomic-json-file-replace" | "optimistic-revision-retry";
  revisionRetry: {
    status: "not-applicable" | "available" | "retried";
    attempts: number;
    conflicts: number;
    maxAttempts: number;
  };
  responsibleSession: "S12";
  redaction: TeachingCourseAssetRedaction;
};

export type TeachingCourseCoverAssetStoreReceipt = {
  asset: TeachingCourseCoverAssetRecord;
  audit?: TeachingCourseCoverAuditEvent;
  persistence: TeachingCourseCoverAssetPersistenceReceipt;
};

const localTeachingCourseAssetsStorage: TeachingCourseAssetsStorageDescriptor = {
  assetStoragePolicy: "local-json-teaching-course-cover-assets",
  auditStoragePolicy: "local-json-teaching-course-cover-audit-log",
  storageWritePolicy: "atomic-json-file-replace",
};

export class TeachingCourseAssetsStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function assertTeachingCourseAssetsLocalJsonRuntimeAllowed(
  env: Record<string, string | undefined>,
) {
  if (!isTeachingCourseAssetsProductionRuntime(env)) {
    return;
  }

  throw new TeachingCourseAssetsStoreError(
    503,
    "Production teaching course cover asset persistence requires external storage.",
  );
}

function isTeachingCourseAssetsProductionRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

export async function storeTeachingCourseCoverAsset(input: {
  dataDir?: string;
  repository?: TeachingCourseAssetsRepository;
  courseId?: string;
  courseName: string;
  cover: QwenCourseCoverGenerateResult;
  audit?: {
    traceId: string;
    actorId: string;
    actorRole: "teacher";
    authMode: "signed-teacher-session";
    authSession?: TeachingCourseCoverAuditAuthSession;
    requestSource: TeachingCourseCoverAuditRequestSource;
  };
  createdAt?: string;
}): Promise<TeachingCourseCoverAssetStoreReceipt> {
  const dataDir = resolveTeachingCourseAssetsDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseAssetsStorage;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const asset = normalizeTeachingCourseCoverAsset({
    assetId: createCourseCoverAssetId(input.cover),
    assetType: "course-cover",
    ...(input.courseId ? { courseId: input.courseId } : {}),
    courseName: input.courseName,
    provider: "qwen",
    providerRole: "image-generation",
    imageUrl: input.cover.imageUrl,
    model: input.cover.model,
    ...(input.cover.requestId ? { providerRequestId: input.cover.requestId } : {}),
    createdAt,
    storagePolicy: storage.assetStoragePolicy,
    storageWritePolicy: storage.storageWritePolicy,
    responsibleSession: "S12",
    redaction: createRedaction(),
  });
  const auditEvent = input.audit
    ? normalizeTeachingCourseCoverAuditEvent({
        auditId: `audit-course-cover-${asset.assetId}-${formatTimestampId(new Date(createdAt))}`,
        traceId: input.audit.traceId,
        eventType: "teaching-course-cover.generated",
        actorId: input.audit.actorId,
        actorRole: input.audit.actorRole,
        authMode: input.audit.authMode,
        ...(input.audit.authSession
          ? { authSession: normalizeTeachingCourseCoverAuditAuthSession(input.audit.authSession) }
          : {}),
        courseId: asset.courseId,
        assetId: asset.assetId,
        ...(asset.providerRequestId ? { providerRequestId: asset.providerRequestId } : {}),
        requestSource: input.audit.requestSource,
        createdAt,
        storagePolicy: storage.auditStoragePolicy,
        redaction: createRedaction(),
      })
    : undefined;

  const maxAttempts = input.repository ? 2 : 1;
  let conflicts = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseAssetsSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    const nextDatabase: TeachingCourseAssetsDatabase = {
      schemaVersion: "uais-teaching-course-assets-v1",
      updatedAt: createdAt,
      assets: [...database.assets.filter((item) => item.assetId !== asset.assetId), asset],
      auditEvents: auditEvent ? [...database.auditEvents, auditEvent] : database.auditEvents,
    };

    try {
      await writeTeachingCourseAssetsSnapshot({
        dataDir,
        repository: input.repository,
        database: nextDatabase,
        expectedRevision: snapshot.revision,
      });
      return {
        asset,
        ...(auditEvent ? { audit: auditEvent } : {}),
        persistence: createTeachingCourseCoverAssetPersistenceReceipt({
          asset,
          attempts: attempt + 1,
          conflicts,
          maxAttempts,
        }),
      };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseAssetsOptimisticSnapshotConflict(error)
      ) {
        conflicts += 1;
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseAssetsStoreError(
    409,
    "Teaching course cover asset snapshot changed; retry required.",
  );
}

function createTeachingCourseCoverAssetPersistenceReceipt(input: {
  asset: TeachingCourseCoverAssetRecord;
  attempts: number;
  conflicts: number;
  maxAttempts: number;
}): TeachingCourseCoverAssetPersistenceReceipt {
  const isExternal =
    input.asset.storageWritePolicy === "external-optimistic-snapshot-replace";
  return {
    status: "persisted",
    storagePolicy: input.asset.storagePolicy,
    storageWritePolicy: input.asset.storageWritePolicy,
    concurrencyControl: isExternal
      ? "optimistic-revision-retry"
      : "atomic-json-file-replace",
    revisionRetry: {
      status: input.conflicts > 0 ? "retried" : isExternal ? "available" : "not-applicable",
      attempts: input.attempts,
      conflicts: input.conflicts,
      maxAttempts: input.maxAttempts,
    },
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

export async function readTeachingCourseAssetsSnapshot(input: {
  dataDir?: string;
  repository?: TeachingCourseAssetsRepository;
}): Promise<TeachingCourseAssetsRepositorySnapshot> {
  if (input.repository) {
    const snapshot = await input.repository.read();
    return {
      database: normalizeTeachingCourseAssetsDatabase(snapshot.database),
      ...(snapshot.revision ? { revision: requireSafeId(snapshot.revision, "revision") } : {}),
    };
  }

  return {
    database: await readTeachingCourseAssetsDatabase({ dataDir: input.dataDir }),
  };
}

export async function readTeachingCourseAssetsDatabase(input: {
  dataDir?: string;
}): Promise<TeachingCourseAssetsDatabase> {
  const dataDir = resolveTeachingCourseAssetsDataDir(input.dataDir);
  const filePath = resolveDatabasePath(dataDir);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return createEmptyDatabase();
  }

  return normalizeTeachingCourseAssetsDatabase(JSON.parse(raw));
}

async function writeTeachingCourseAssetsSnapshot(input: {
  dataDir: string;
  repository?: TeachingCourseAssetsRepository;
  database: TeachingCourseAssetsDatabase;
  expectedRevision?: string;
}) {
  if (input.repository) {
    await input.repository.write({
      database: normalizeTeachingCourseAssetsDatabase(input.database),
      ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
    });
    return;
  }

  await writeTeachingCourseAssetsDatabase({
    dataDir: input.dataDir,
    database: input.database,
  });
}

export function resolveTeachingCourseAssetsDataDir(configuredDataDir?: string) {
  return configuredDataDir?.trim()
    ? resolve(/*turbopackIgnore: true*/ configuredDataDir)
    : join(
        /*turbopackIgnore: true*/ cwd(),
        ".tmp",
        "uais-teaching-course-assets-db",
      );
}

function createCourseCoverAssetId(cover: QwenCourseCoverGenerateResult) {
  return `course-cover-${toSafeIdSegment(cover.requestId) ?? randomUUID().slice(0, 8)}`;
}

function toSafeIdSegment(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return normalized || undefined;
}

async function writeTeachingCourseAssetsDatabase(input: {
  dataDir: string;
  database: TeachingCourseAssetsDatabase;
}) {
  await mkdir(input.dataDir, { recursive: true });
  const filePath = resolveDatabasePath(input.dataDir);
  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath,
    fileNamePrefix: "teaching-course-assets",
    value: input.database,
  });
}

function createEmptyDatabase(): TeachingCourseAssetsDatabase {
  return {
    schemaVersion: "uais-teaching-course-assets-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    assets: [],
    auditEvents: [],
  };
}

export function normalizeTeachingCourseAssetsDatabase(value: unknown): TeachingCourseAssetsDatabase {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== "uais-teaching-course-assets-v1"
  ) {
    throw new Error("Teaching course assets database is invalid.");
  }
  const record = value as { updatedAt?: unknown; assets?: unknown; auditEvents?: unknown };
  return {
    schemaVersion: "uais-teaching-course-assets-v1",
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    assets: Array.isArray(record.assets)
      ? record.assets.map(normalizeTeachingCourseCoverAsset)
      : [],
    auditEvents: Array.isArray(record.auditEvents)
      ? record.auditEvents.map(normalizeTeachingCourseCoverAuditEvent)
      : [],
  };
}

function normalizeTeachingCourseCoverAsset(value: unknown): TeachingCourseCoverAssetRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Teaching course cover asset is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (record.assetType !== "course-cover") {
    throw new Error("Teaching course cover asset type is invalid.");
  }
  return {
    assetId: requireSafeId(record.assetId, "asset id"),
    assetType: "course-cover",
    ...(record.courseId ? { courseId: requireSafeId(record.courseId, "course id") } : {}),
    courseName: requireTrimmedString(record.courseName, "course name"),
    provider: "qwen",
    providerRole: "image-generation",
    imageUrl: requireHttpsUrl(record.imageUrl, "image url"),
    model: requireSafeModel(record.model, "model"),
    ...(record.providerRequestId
      ? { providerRequestId: requireSafeId(record.providerRequestId, "provider request id") }
      : {}),
    createdAt: requireIsoDate(record.createdAt, "createdAt"),
    storagePolicy: normalizeCourseCoverAssetStoragePolicy(record.storagePolicy),
    storageWritePolicy: normalizeCourseCoverAssetStorageWritePolicy(record.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseCoverAuditEvent(value: unknown): TeachingCourseCoverAuditEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Teaching course cover audit event is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (record.eventType !== "teaching-course-cover.generated") {
    throw new Error("Teaching course cover audit event type is invalid.");
  }
  return {
    auditId: requireSafeId(record.auditId, "audit id"),
    traceId: requireSafeId(record.traceId, "trace id"),
    eventType: "teaching-course-cover.generated",
    actorId: requireSafeId(record.actorId, "actor id"),
    actorRole: "teacher",
    authMode: "signed-teacher-session",
    ...(record.authSession
      ? { authSession: normalizeTeachingCourseCoverAuditAuthSession(record.authSession) }
      : {}),
    courseId: requireSafeId(record.courseId, "course id"),
    assetId: requireSafeId(record.assetId, "asset id"),
    ...(record.providerRequestId
      ? { providerRequestId: requireSafeId(record.providerRequestId, "provider request id") }
      : {}),
    requestSource: normalizeAuditRequestSource(record.requestSource),
    createdAt: requireIsoDate(record.createdAt, "createdAt"),
    storagePolicy: normalizeCourseCoverAuditStoragePolicy(record.storagePolicy),
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseCoverAuditAuthSession(
  value: unknown,
): TeachingCourseCoverAuditAuthSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Teaching course cover audit auth session is invalid.");
  }
  const record = value as Record<string, unknown>;
  return {
    sessionId: requireSafeId(record.sessionId, "auth session id"),
    authenticatedAt: requireIsoDate(record.authenticatedAt, "authenticatedAt"),
    expiresAt: requireIsoDate(record.expiresAt, "expiresAt"),
  };
}

function normalizeCourseCoverAssetStoragePolicy(
  value: unknown,
): TeachingCourseCoverAssetStoragePolicy {
  return value === "external-redacted-teaching-course-cover-assets"
    ? "external-redacted-teaching-course-cover-assets"
    : "local-json-teaching-course-cover-assets";
}

function normalizeCourseCoverAssetStorageWritePolicy(
  value: unknown,
): TeachingCourseCoverAssetStorageWritePolicy {
  return value === "external-optimistic-snapshot-replace"
    ? "external-optimistic-snapshot-replace"
    : "atomic-json-file-replace";
}

function normalizeCourseCoverAuditStoragePolicy(
  value: unknown,
): TeachingCourseCoverAuditStoragePolicy {
  return value === "external-redacted-teaching-course-cover-audit-log"
    ? "external-redacted-teaching-course-cover-audit-log"
    : "local-json-teaching-course-cover-audit-log";
}

function isTeachingCourseAssetsOptimisticSnapshotConflict(error: unknown) {
  return error instanceof TeachingCourseAssetsStoreError && error.status === 409;
}

function resolveDatabasePath(dataDir: string) {
  const filePath = resolve(dataDir, "course-cover-assets.json");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

async function writeAtomicJsonFile(input: {
  dataDir: string;
  filePath: string;
  fileNamePrefix: string;
  value: unknown;
}) {
  ensureWithinBase(input.dataDir, input.filePath);
  const targetDir = resolve(input.filePath, "..");
  ensureWithinBase(input.dataDir, targetDir);
  await mkdir(targetDir, { recursive: true });
  const tempPath = resolve(
    targetDir,
    `.${input.fileNamePrefix}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(input.dataDir, tempPath);

  try {
    await writeFile(tempPath, JSON.stringify(input.value, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, input.filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function ensureWithinBase(baseDir: string, filePath: string) {
  const normalizedBase = resolve(baseDir);
  const normalizedPath = resolve(filePath);
  if (normalizedPath !== normalizedBase && !normalizedPath.startsWith(`${normalizedBase}/`)) {
    throw new Error("Teaching course assets path escapes the configured data directory.");
  }
}

function requireSafeId(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 120 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function requireTrimmedString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid ${label}.`);
  }
  return value.trim().slice(0, 300);
}

function requireSafeModel(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function requireHttpsUrl(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${label}.`);
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function requireIsoDate(value: unknown, label: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function normalizeAuditRequestSource(value: unknown): TeachingCourseCoverAuditRequestSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      userAgent: "unknown",
      ipAddress: "redacted",
    };
  }
  const record = value as Record<string, unknown>;
  const userAgent =
    typeof record.userAgent === "string" &&
    record.userAgent.trim() &&
    !/\/Users\/|secret|api[_-]?key|token/i.test(record.userAgent)
      ? record.userAgent.trim().slice(0, 160)
      : "redacted";

  return {
    userAgent,
    ipAddress: "redacted",
  };
}

function createRedaction(): TeachingCourseAssetRedaction {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "generated-url-only",
  };
}

function formatTimestampId(now: Date) {
  const [datePart, timePart = ""] = now.toISOString().split("T");
  return `${datePart.replace(/-/g, "")}-${timePart.slice(0, 8).replace(/:/g, "")}`;
}
