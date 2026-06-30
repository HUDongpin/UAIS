import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import type { UaisAiAccessDecision } from "@/lib/server/ai-access-control";
import {
  createUaisTeacherAiResourceGrants,
  type UaisTeacherAiResourceOwnership,
} from "@/lib/server/ai-resource-grants";
import type { UaisAiActorRole } from "@/lib/server/ai-access-control";

export type UaisTeacherAiOwnershipRecord = UaisTeacherAiResourceOwnership & {
  storagePolicy: "local-server-teacher-ai-ownership-registry";
  storageWritePolicy: "atomic-json-file-replace";
  responsibleSession: "S12";
  updatedAt: string;
  redaction: UaisAiAccessDecision["redaction"];
};

export type UaisTeacherAiOwnershipMergeReceipt = {
  teacherId: string;
  courseIds: string[];
  status: "merged";
  storagePolicy: "external-redacted-teacher-ai-ownership-merge";
  storageWritePolicy: "external-atomic-merge";
  responsibleSession: "S12";
  updatedAt: string;
  redaction: UaisAiAccessDecision["redaction"];
};

export type UaisTeacherAiOwnershipMergeInput = {
  ownership: UaisTeacherAiResourceOwnership;
  updatedAt?: string;
};

export type UaisTeacherAiOwnershipMergeResult =
  | UaisTeacherAiOwnershipRecord
  | UaisTeacherAiOwnershipMergeReceipt;

export type UaisTeacherAiOwnershipConsistencyMissingReference = {
  ownerId: string;
  missingField: "courseId" | "sampleAssetId" | "pptAssetId" | "voiceRefId";
  missingId: string;
};

export type UaisTeacherAiOwnershipConsistencyCheck = {
  id:
    | "sample-assets-course-links"
    | "ppt-assets-course-links"
    | "voice-refs-sample-links"
    | "audio-manifests-course-links"
    | "audio-manifests-ppt-links"
    | "audio-manifests-voice-links";
  status: "ready" | "blocked";
  missingReferences: UaisTeacherAiOwnershipConsistencyMissingReference[];
};

export type UaisTeacherAiOwnershipConsistencyReport = {
  responsibleSession: "S12/S24";
  status: "ready" | "blocked";
  recordCounts: {
    courseIds: number;
    sampleAssets: number;
    pptAssets: number;
    clonedVoiceRefs: number;
    audioManifests: number;
  };
  checks: UaisTeacherAiOwnershipConsistencyCheck[];
  redaction: UaisAiAccessDecision["redaction"];
};

type UaisTeacherAiOwnershipAuthenticatedPrincipal = {
  sessionId: string;
  actorId: string;
  role: Extract<UaisAiActorRole, "teacher">;
  authenticatedAt: string;
  expiresAt: string;
};

const DEFAULT_TEACHER_AI_OWNERSHIP_DIR = join(
  cwd(),
  ".tmp",
  "uais-ai-assets",
  "teacher-ai-ownership",
);

export async function storeUaisTeacherAiOwnershipRecord(input: {
  baseDir?: string;
  ownership: UaisTeacherAiResourceOwnership;
  updatedAt?: string;
}): Promise<UaisTeacherAiOwnershipRecord> {
  const baseDir = resolveTeacherAiOwnershipBaseDir(input.baseDir);
  const record = createUaisTeacherAiOwnershipRecord(input.ownership, input.updatedAt);
  await mkdir(baseDir, { recursive: true });
  const filePath = resolve(baseDir, `${record.teacherId}.json`);
  ensureWithinBase(baseDir, filePath);
  await writeAtomicJsonFile({
    baseDir,
    filePath,
    fileNamePrefix: record.teacherId,
    value: record,
  });
  return record;
}

export async function mergeUaisTeacherAiOwnershipRecord(input: {
  baseDir?: string;
  ownership: UaisTeacherAiResourceOwnership;
  updatedAt?: string;
}): Promise<UaisTeacherAiOwnershipRecord> {
  const incoming = normalizeOwnership(input.ownership);
  const existing = await readUaisTeacherAiOwnershipRecord({
    baseDir: input.baseDir,
    teacherId: incoming.teacherId,
  });
  return storeUaisTeacherAiOwnershipRecord({
    baseDir: input.baseDir,
    updatedAt: input.updatedAt,
    ownership: mergeOwnership(existing, incoming),
  });
}

export async function readUaisTeacherAiOwnershipRecord(input: {
  baseDir?: string;
  teacherId: string;
}): Promise<UaisTeacherAiResourceOwnership | undefined> {
  const baseDir = resolveTeacherAiOwnershipBaseDir(input.baseDir);
  const teacherId = requireSafeId(input.teacherId, "teacher id");
  const filePath = resolve(baseDir, `${teacherId}.json`);
  ensureWithinBase(baseDir, filePath);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return undefined;
  }

  const record = parseUaisTeacherAiOwnershipRecord(JSON.parse(raw));
  if (record.teacherId !== teacherId) {
    throw new Error("Teacher AI ownership record id mismatch.");
  }
  return toOwnership(record);
}

export function createLocalUaisTeacherAiOwnershipAdapter(input: {
  env: Record<string, string | undefined>;
}) {
  if (isTeacherAiOwnershipProductionRuntime(input.env)) {
    return undefined;
  }

  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    value: input.env.UAIS_TEACHER_AI_OWNERSHIP_BACKEND,
    responsibleSession: "S12",
  });
  if (!isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }

  return async ({
    authenticatedSession,
  }: {
    authenticatedSession: UaisTeacherAiOwnershipAuthenticatedPrincipal;
  }) =>
    readUaisTeacherAiOwnershipRecord({
      baseDir: input.env.UAIS_TEACHER_AI_OWNERSHIP_DIR,
      teacherId: authenticatedSession.actorId,
    });
}

export function createUaisTeacherAiOwnershipAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}) {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    value: input.env.UAIS_TEACHER_AI_OWNERSHIP_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return createLocalUaisTeacherAiOwnershipAdapter({ env: input.env });
  }

  if (isExternalStorageBackendReadyContract(backendContract)) {
    return createExternalUaisTeacherAiOwnershipAdapter({
      env: input.env,
      fetch: input.fetch,
    });
  }

  return undefined;
}

export function createUaisTeacherAiOwnershipMergeAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}) {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    value: input.env.UAIS_TEACHER_AI_OWNERSHIP_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return async ({
      ownership,
      updatedAt,
    }: UaisTeacherAiOwnershipMergeInput): Promise<UaisTeacherAiOwnershipMergeResult> =>
      mergeUaisTeacherAiOwnershipRecord({
        ownership,
        updatedAt,
        baseDir: input.env.UAIS_TEACHER_AI_OWNERSHIP_DIR,
      });
  }

  if (isExternalStorageBackendReadyContract(backendContract)) {
    return createExternalUaisTeacherAiOwnershipMergeAdapter({
      env: input.env,
      fetch: input.fetch,
    });
  }

  return undefined;
}

export function createUaisTeacherAiOwnershipConsistencyReport(
  ownership: UaisTeacherAiResourceOwnership,
): UaisTeacherAiOwnershipConsistencyReport {
  const normalized = normalizeOwnership(ownership);
  const courseIdList = normalized.courseIds ?? [];
  const sampleAssets = normalized.sampleAssets ?? [];
  const pptAssets = normalized.pptAssets ?? [];
  const clonedVoiceRefs = normalized.clonedVoiceRefs ?? [];
  const audioManifests = normalized.audioManifests ?? [];
  const courseIds = new Set(courseIdList);
  const sampleAssetIds = new Set(sampleAssets.map((asset) => asset.sampleAssetId));
  const pptAssetIds = new Set(pptAssets.map((asset) => asset.pptAssetId));
  const voiceRefIds = new Set(
    clonedVoiceRefs.map((reference) => reference.voiceRefId),
  );
  const checks: UaisTeacherAiOwnershipConsistencyCheck[] = [
    createConsistencyCheck(
      "sample-assets-course-links",
      sampleAssets
        .filter((asset) => asset.courseId && !courseIds.has(asset.courseId))
        .map((asset) => ({
          ownerId: asset.sampleAssetId,
          missingField: "courseId",
          missingId: asset.courseId,
        })),
    ),
    createConsistencyCheck(
      "ppt-assets-course-links",
      pptAssets
        .filter((asset) => asset.courseId && !courseIds.has(asset.courseId))
        .map((asset) => ({
          ownerId: asset.pptAssetId,
          missingField: "courseId",
          missingId: asset.courseId,
        })),
    ),
    createConsistencyCheck(
      "voice-refs-sample-links",
      clonedVoiceRefs
        .filter(
          (reference) =>
            reference.sampleAssetId && !sampleAssetIds.has(reference.sampleAssetId),
        )
        .map((reference) => ({
          ownerId: reference.voiceRefId,
          missingField: "sampleAssetId",
          missingId: reference.sampleAssetId,
        })),
    ),
    createConsistencyCheck(
      "audio-manifests-course-links",
      audioManifests
        .filter((manifest) => manifest.courseId && !courseIds.has(manifest.courseId))
        .map((manifest) => ({
          ownerId: manifest.audioManifestId,
          missingField: "courseId",
          missingId: manifest.courseId,
        })),
    ),
    createConsistencyCheck(
      "audio-manifests-ppt-links",
      audioManifests
        .filter((manifest) => manifest.pptAssetId && !pptAssetIds.has(manifest.pptAssetId))
        .map((manifest) => ({
          ownerId: manifest.audioManifestId,
          missingField: "pptAssetId",
          missingId: manifest.pptAssetId,
        })),
    ),
    createConsistencyCheck(
      "audio-manifests-voice-links",
      audioManifests
        .filter((manifest) => manifest.voiceRefId && !voiceRefIds.has(manifest.voiceRefId))
        .map((manifest) => ({
          ownerId: manifest.audioManifestId,
          missingField: "voiceRefId",
          missingId: manifest.voiceRefId,
        })),
    ),
  ];

  const report: UaisTeacherAiOwnershipConsistencyReport = {
    responsibleSession: "S12/S24",
    status: checks.some((check) => check.status === "blocked") ? "blocked" : "ready",
    recordCounts: {
      courseIds: courseIdList.length,
      sampleAssets: sampleAssets.length,
      pptAssets: pptAssets.length,
      clonedVoiceRefs: clonedVoiceRefs.length,
      audioManifests: audioManifests.length,
    },
    checks,
    redaction: createRedaction(),
  };
  assertTeacherAiOwnershipRecordIsDisplaySafe(report);
  return report;
}

function createUaisTeacherAiOwnershipRecord(
  ownership: UaisTeacherAiResourceOwnership,
  updatedAt = new Date().toISOString(),
): UaisTeacherAiOwnershipRecord {
  const record: UaisTeacherAiOwnershipRecord = {
    ...normalizeOwnership(ownership),
    storagePolicy: "local-server-teacher-ai-ownership-registry",
    storageWritePolicy: "atomic-json-file-replace",
    responsibleSession: "S12",
    updatedAt,
    redaction: createRedaction(),
  };
  createUaisTeacherAiResourceGrants(record);
  assertTeacherAiOwnershipRecordIsDisplaySafe(record);
  return record;
}

function parseUaisTeacherAiOwnershipRecord(value: unknown): UaisTeacherAiOwnershipRecord {
  if (!isRecord(value)) {
    throw new Error("Teacher AI ownership record must be an object.");
  }

  const record: UaisTeacherAiOwnershipRecord = {
    ...normalizeOwnership(value as UaisTeacherAiResourceOwnership),
    storagePolicy: requireLiteral(
      value.storagePolicy,
      "local-server-teacher-ai-ownership-registry",
      "storage policy",
    ),
    storageWritePolicy:
      value.storageWritePolicy === undefined
        ? "atomic-json-file-replace"
        : requireLiteral(
            value.storageWritePolicy,
            "atomic-json-file-replace",
            "storage write policy",
          ),
    responsibleSession: requireLiteral(value.responsibleSession, "S12", "responsible session"),
    updatedAt: requireNonEmptyString(value.updatedAt, "updatedAt"),
    redaction: createRedaction(),
  };
  createUaisTeacherAiResourceGrants(record);
  assertTeacherAiOwnershipRecordIsDisplaySafe(record);
  return record;
}

function normalizeOwnership(value: UaisTeacherAiResourceOwnership): UaisTeacherAiResourceOwnership {
  return {
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    courseIds: uniqueSafeIds(value.courseIds, "course id"),
    sampleAssets: (value.sampleAssets ?? []).map((asset) => ({
      sampleAssetId: requireSafeId(asset.sampleAssetId, "sample asset id"),
      ...(asset.courseId ? { courseId: requireSafeId(asset.courseId, "course id") } : {}),
    })),
    pptAssets: (value.pptAssets ?? []).map((asset) => ({
      pptAssetId: requireSafeId(asset.pptAssetId, "PPT asset id"),
      ...(asset.courseId ? { courseId: requireSafeId(asset.courseId, "course id") } : {}),
    })),
    clonedVoiceRefs: (value.clonedVoiceRefs ?? []).map((reference) => ({
      voiceRefId: requireSafeId(reference.voiceRefId, "voice reference id"),
      ...(reference.sampleAssetId
        ? { sampleAssetId: requireSafeId(reference.sampleAssetId, "sample asset id") }
        : {}),
    })),
    audioManifests: (value.audioManifests ?? []).map((manifest) => ({
      audioManifestId: requireSafeId(manifest.audioManifestId, "audio manifest id"),
      ...(manifest.courseId ? { courseId: requireSafeId(manifest.courseId, "course id") } : {}),
      ...(manifest.pptAssetId
        ? { pptAssetId: requireSafeId(manifest.pptAssetId, "PPT asset id") }
        : {}),
      ...(manifest.voiceRefId
        ? { voiceRefId: requireSafeId(manifest.voiceRefId, "voice reference id") }
        : {}),
    })),
  };
}

function toOwnership(record: UaisTeacherAiOwnershipRecord): UaisTeacherAiResourceOwnership {
  return {
    teacherId: record.teacherId,
    courseIds: record.courseIds,
    sampleAssets: record.sampleAssets,
    pptAssets: record.pptAssets,
    clonedVoiceRefs: record.clonedVoiceRefs,
    audioManifests: record.audioManifests,
  };
}

function mergeOwnership(
  existing: UaisTeacherAiResourceOwnership | undefined,
  incoming: UaisTeacherAiResourceOwnership,
): UaisTeacherAiResourceOwnership {
  if (!existing) {
    return incoming;
  }
  if (existing.teacherId !== incoming.teacherId) {
    throw new Error("Teacher AI ownership records cannot be merged across teachers.");
  }

  return {
    teacherId: incoming.teacherId,
    courseIds: mergeIdList(existing.courseIds, incoming.courseIds),
    sampleAssets: mergeById(existing.sampleAssets, incoming.sampleAssets, "sampleAssetId"),
    pptAssets: mergeById(existing.pptAssets, incoming.pptAssets, "pptAssetId"),
    clonedVoiceRefs: mergeById(existing.clonedVoiceRefs, incoming.clonedVoiceRefs, "voiceRefId"),
    audioManifests: mergeById(existing.audioManifests, incoming.audioManifests, "audioManifestId"),
  };
}

function isTeacherAiOwnershipProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function createExternalUaisTeacherAiOwnershipAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}) {
  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    return undefined;
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({
    authenticatedSession,
  }: {
    request: Request;
    authenticatedSession: UaisTeacherAiOwnershipAuthenticatedPrincipal;
  }) => {
    const teacherId = requireSafeId(authenticatedSession.actorId, "teacher id");
    const response = await fetchImpl(
      `${config.baseUrl}/teacher-ai-ownership/${encodeURIComponent(teacherId)}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error("External teacher AI ownership backend request failed.");
    }

    const ownership = normalizeOwnership(
      (await response.json()) as UaisTeacherAiResourceOwnership,
    );
    if (ownership.teacherId !== teacherId) {
      throw new Error("External teacher AI ownership record id mismatch.");
    }
    assertTeacherAiOwnershipRecordIsDisplaySafe(ownership);
    return ownership;
  };
}

function createExternalUaisTeacherAiOwnershipMergeAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}) {
  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    return undefined;
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({
    ownership,
    updatedAt = new Date().toISOString(),
  }: UaisTeacherAiOwnershipMergeInput): Promise<UaisTeacherAiOwnershipMergeReceipt> => {
    const normalized = normalizeOwnership(ownership);
    assertTeacherAiOwnershipRecordIsDisplaySafe(normalized);
    const response = await fetchImpl(
      `${config.baseUrl}/teacher-ai-ownership/${encodeURIComponent(
        normalized.teacherId,
      )}/merge`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "merge-teacher-ai-ownership",
          updatedAt,
          ownership: normalized,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error("External teacher AI ownership merge request failed.");
    }

    const receipt: UaisTeacherAiOwnershipMergeReceipt = {
      teacherId: normalized.teacherId,
      courseIds: normalized.courseIds ?? [],
      status: "merged",
      storagePolicy: "external-redacted-teacher-ai-ownership-merge",
      storageWritePolicy: "external-atomic-merge",
      responsibleSession: "S12",
      updatedAt,
      redaction: createRedaction(),
    };
    assertTeacherAiOwnershipRecordIsDisplaySafe(receipt);
    return receipt;
  };
}

function mergeIdList(left: string[] | undefined, right: string[] | undefined) {
  return Array.from(new Set([...(left ?? []), ...(right ?? [])]));
}

function mergeById<T extends Record<K, string>, K extends keyof T>(
  left: T[] | undefined,
  right: T[] | undefined,
  key: K,
) {
  const merged = new Map<string, T>();
  for (const item of [...(left ?? []), ...(right ?? [])]) {
    const id = item[key];
    const previous = merged.get(id);
    merged.set(id, {
      ...(previous ?? {}),
      ...item,
    });
  }
  return Array.from(merged.values());
}

async function writeAtomicJsonFile(input: {
  baseDir: string;
  filePath: string;
  fileNamePrefix: string;
  value: unknown;
}) {
  const tempPath = resolve(
    input.baseDir,
    `.${input.fileNamePrefix}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(input.baseDir, tempPath);
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

function createConsistencyCheck(
  id: UaisTeacherAiOwnershipConsistencyCheck["id"],
  missingReferences: Array<{
    ownerId: string;
    missingField: UaisTeacherAiOwnershipConsistencyMissingReference["missingField"];
    missingId: string | undefined;
  }>,
): UaisTeacherAiOwnershipConsistencyCheck {
  const safeMissingReferences = missingReferences.map((reference) => ({
    ownerId: requireSafeId(reference.ownerId, "ownership consistency owner id"),
    missingField: reference.missingField,
    missingId: requireSafeId(reference.missingId ?? "", "ownership consistency missing id"),
  }));
  return {
    id,
    status: safeMissingReferences.length > 0 ? "blocked" : "ready",
    missingReferences: safeMissingReferences,
  };
}

function uniqueSafeIds(values: string[] | undefined, label: string) {
  return Array.from(new Set((values ?? []).map((value) => requireSafeId(value, label))));
}

function requireSafeId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function requireLiteral<T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) {
    throw new Error(`Invalid teacher AI ownership ${label}.`);
  }
  return expected;
}

function requireNonEmptyString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Teacher AI ownership ${label} is required.`);
  }
  return value;
}

function resolveTeacherAiOwnershipBaseDir(baseDir?: string) {
  return baseDir ? resolve(baseDir) : DEFAULT_TEACHER_AI_OWNERSHIP_DIR;
}

function ensureWithinBase(baseDir: string, targetPath: string) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new Error("Resolved teacher AI ownership path escapes the configured storage directory.");
  }
}

function assertTeacherAiOwnershipRecordIsDisplaySafe(record: unknown) {
  const serialized = JSON.stringify(record);
  if (UNSAFE_OWNERSHIP_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("Teacher AI ownership record contains non-auditable private data.");
  }
}

function createRedaction(): UaisAiAccessDecision["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UNSAFE_OWNERSHIP_PATTERNS = [
  /sk-[A-Za-z0-9]/,
  /(?:DASHSCOPE_API_KEY|DEEPSEEK_API_KEY|UAIS_LIVE_AI_APPROVAL_TOKEN|UAIS_AI_ACCESS_SIGNING_SECRET|UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET|UAIS_TEACHER_AUTH_ISSUER_SECRET|UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN)\s*=\s*[^"',}\]\s]+/,
  new RegExp("voice-qwen-" + "private"),
  /\/Users\/dongpinhu\/Library\/Containers/,
  /data:audio\/[^"',}\]\s]+base64/i,
  new RegExp("audio" + "Base64", "i"),
];
