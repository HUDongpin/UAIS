import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";

// Server-side persistence for learning-chatroom share links (plan D8, Phase 5).
//
// A share record is a capability, not a copy: it names a room and who minted it,
// and the public `/share/[shareId]` page renders that room's transcript LIVE at
// request time. Nothing about the conversation is frozen here, so revoking a
// share genuinely stops the page, and a room that keeps talking keeps the link
// current.
//
// Structured exactly like `learning-chatroom-transcript-store.ts`: one normalized
// JSON database written atomically to a local data dir by default, behind a
// repository seam so an external storage backend can replace the file layer
// without any route change.
//
// Storage seam status (deliberate, Phase 5 scope): the transcript store rides an
// external snapshot service through `learning-chatroom-transcript-external-store`
// plus a dedicated `/learning-chatroom-transcripts/database` path on the
// external-storage route surface. Shares would need that same path family added
// to `external-storage-route-*.ts`, which is S12's file set and outside this
// package. So this store ships local-JSON-only with the SEAM ALREADY IN PLACE:
// every entry point accepts a `repository`, and production local-JSON writes are
// refused (`assertLearningChatroomShareLocalJsonRuntimeAllowed`) exactly like
// transcripts, rather than silently persisting share links to an ephemeral
// serverless filesystem. Wiring a repository factory is then additive.

type LearningChatroomShareRedaction = {
  secrets: "omitted";
  localFiles: "omitted";
  assets: "ids-only";
};

export type LearningChatroomShareStoragePolicy =
  | "local-json-learning-chatroom-shares"
  | "external-redacted-learning-chatroom-shares"
  | "postgres-learning-chatroom-shares";

export type LearningChatroomShareStorageWritePolicy =
  | "atomic-json-file-replace"
  | "external-optimistic-snapshot-replace"
  | "postgres-transactional-snapshot-replace";

export type LearningChatroomShareStorageDescriptor = {
  shareStoragePolicy: LearningChatroomShareStoragePolicy;
  storageWritePolicy: LearningChatroomShareStorageWritePolicy;
};

export type LearningChatroomShareRecord = {
  shareId: string;
  courseId: string;
  classId?: string;
  // Optional on purpose: a legacy per-student room is shareable by the student
  // who owns it, and a group room by any member. The room the public page
  // replays is derived from this record, so `groupId` absent means "the
  // per-student room of `createdBy`".
  groupId?: string;
  // Session account of the member who minted the link. It is an authorization
  // key (revocation, legacy room derivation) and never leaves the server.
  createdBy: string;
  createdAt: string;
  // Every link dies on its own (owner decision: 14 days by default, minting may
  // name its own moment). Revocation stays the immediate stop; expiry is what
  // stops a link nobody remembers from outliving the term it was minted in.
  // Required after normalization: a legacy record stored before this field
  // existed is read as expiring 14 days after it was minted, so there is no such
  // thing as a share without an end.
  expiresAt: string;
  revokedAt?: string;
  storagePolicy: LearningChatroomShareStoragePolicy;
  storageWritePolicy: LearningChatroomShareStorageWritePolicy;
  responsibleSession: "S12";
  redaction: LearningChatroomShareRedaction;
};

export type LearningChatroomShareDatabase = {
  schemaVersion: typeof learningChatroomShareSchemaVersion;
  updatedAt: string;
  shares: LearningChatroomShareRecord[];
};

export type LearningChatroomShareRepositorySnapshot = {
  database: LearningChatroomShareDatabase;
  revision?: string;
};

export type LearningChatroomShareRepository = {
  storage: LearningChatroomShareStorageDescriptor;
  read: () => Promise<LearningChatroomShareRepositorySnapshot>;
  write: (input: {
    database: LearningChatroomShareDatabase;
    expectedRevision?: string;
  }) => Promise<void>;
};

export type LearningChatroomShareReceipt = {
  status: "created" | "revoked";
  shareId: string;
  storagePolicy: LearningChatroomShareStoragePolicy;
  storageWritePolicy: LearningChatroomShareStorageWritePolicy;
  concurrencyControl: "atomic-json-file-replace" | "optimistic-revision-retry";
  responsibleSession: "S12";
  redaction: LearningChatroomShareRedaction;
};

export const learningChatroomShareSchemaVersion = "uais-learning-chatroom-shares-v1";

const learningChatroomShareMaxIdLength = 200;
// A dead link is a 404 whether the record still exists or not, so a share that
// has been revoked - or has been expired - for a month is pruned on the next
// write instead of growing the database forever.
const learningChatroomShareRevokedRetentionMs = 30 * 24 * 60 * 60 * 1000;
// The default life of a link, and the life a legacy record is read as having.
// Two weeks covers the assignment a group actually shares a room for, and it
// means an unrevoked link left in a chat thread stops publishing the room by
// itself rather than staying live for the rest of the degree.
export const learningChatroomShareDefaultTtlMs = 14 * 24 * 60 * 60 * 1000;
// The longest life minting may ask for. A ceiling exists so "optional expiresAt"
// cannot be used to opt out of expiry altogether by naming the year 3000.
export const learningChatroomShareMaxTtlMs = 90 * 24 * 60 * 60 * 1000;
// Bounded like every other UAIS database. Reaching this means something is
// minting links in a loop, which is a refusal rather than an eviction: evicting
// a live share would break a link somebody is holding.
const learningChatroomShareMaxRecords = 5000;
// Mint is a rare, human-triggered write, so one retry of the read-modify-write
// against a fresh revision is enough.
const learningChatroomShareMaxWriteAttempts = 2;
// 16 random bytes: 128 bits of entropy, unguessable, and a 38-character id once
// prefixed - well inside the shared safe-id bound.
const learningChatroomShareIdEntropyBytes = 16;

const localLearningChatroomShareStorage: LearningChatroomShareStorageDescriptor = {
  shareStoragePolicy: "local-json-learning-chatroom-shares",
  storageWritePolicy: "atomic-json-file-replace",
};

export class LearningChatroomShareStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LearningChatroomShareStoreError";
  }
}

export function assertLearningChatroomShareLocalJsonRuntimeAllowed(
  env: Record<string, string | undefined>,
) {
  if (!isLearningChatroomShareProductionRuntime(env)) {
    return;
  }

  throw new LearningChatroomShareStoreError(
    503,
    "Production learning chatroom share persistence requires external storage.",
  );
}

function isLearningChatroomShareProductionRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

// Shares hang off the transcripts they point at, so they follow the same data
// directory and the same two existing variables - no new env name is introduced
// by this phase.
export function resolveLearningChatroomShareDataDir(
  env: Record<string, string | undefined>,
) {
  const configured =
    env.UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR?.trim() ||
    env.UAIS_TEACHING_COURSES_DATA_DIR?.trim();
  return configured
    ? resolve(/*turbopackIgnore: true*/ configured)
    : join(
        /*turbopackIgnore: true*/ cwd(),
        ".tmp",
        "uais-learning-chatroom-shares-db",
      );
}

// The id is the whole capability: it is the only thing a viewer of the public
// page presents, so it is random rather than derived from the room. A derived id
// would let anyone who knows a courseId and a groupId reconstruct the link.
export function createLearningChatroomShareId(
  randomBytesImpl: (size: number) => Buffer = randomBytes,
) {
  return `share-${randomBytesImpl(learningChatroomShareIdEntropyBytes).toString("hex")}`;
}

export async function createLearningChatroomShare(input: {
  dataDir?: string;
  repository?: LearningChatroomShareRepository;
  env?: Record<string, string | undefined>;
  shareId?: string;
  courseId: string;
  classId?: string;
  groupId?: string;
  createdBy: string;
  now?: string;
  // Absent means the 14-day default. A caller that names its own moment is
  // bounded by `learningChatroomShareMaxTtlMs`; the route validates and reports
  // the refusal, this store is the second, non-bypassable check.
  expiresAt?: string;
}): Promise<{ record: LearningChatroomShareRecord; receipt: LearningChatroomShareReceipt }> {
  // Local-JSON share writes are refused in production exactly like transcripts:
  // the serverless filesystem is ephemeral, so a link written there would be
  // unviewable and unrevocable. Only the local-JSON path is guarded - an
  // external repository is allowed through.
  if (!input.repository) {
    assertLearningChatroomShareLocalJsonRuntimeAllowed(input.env ?? {});
  }
  const storage = input.repository?.storage ?? localLearningChatroomShareStorage;
  const now = input.now ?? new Date().toISOString();
  const shareId = requireSafeId(
    input.shareId ?? createLearningChatroomShareId(),
    "share id",
  );

  const record = normalizeLearningChatroomShare({
    shareId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    createdBy: input.createdBy,
    createdAt: now,
    expiresAt: resolveLearningChatroomShareExpiry({
      createdAt: now,
      expiresAt: input.expiresAt,
    }),
    storagePolicy: storage.shareStoragePolicy,
    storageWritePolicy: storage.storageWritePolicy,
    responsibleSession: "S12",
    redaction: createRedaction(),
  });

  await mutateLearningChatroomShareDatabase({
    dataDir: input.dataDir,
    repository: input.repository,
    now,
    mutate: (shares) => {
      if (shares.some((item) => item.shareId === shareId)) {
        throw new LearningChatroomShareStoreError(
          409,
          "Learning chatroom share already exists.",
        );
      }
      const retained = pruneExpiredRevokedShares(shares, now);
      if (retained.length >= learningChatroomShareMaxRecords) {
        throw new LearningChatroomShareStoreError(
          503,
          "Learning chatroom share capacity is exhausted.",
        );
      }
      return [...retained, record];
    },
  });

  return {
    record,
    receipt: createReceipt("created", shareId, storage),
  };
}

export async function readLearningChatroomShare(input: {
  dataDir?: string;
  repository?: LearningChatroomShareRepository;
  env?: Record<string, string | undefined>;
  shareId: string;
}): Promise<LearningChatroomShareRecord | undefined> {
  if (!isSafeId(input.shareId)) {
    // An unsafe id can never have been stored, so it answers "unknown" instead
    // of throwing: the public page turns both into the same 404.
    return undefined;
  }

  // Reads refuse local JSON in production too, mirroring the transcript store:
  // an ephemeral serverless filesystem can hold no genuine share, so the store
  // surfaces the designed 503 rather than silently answering "unknown".
  if (!input.repository) {
    assertLearningChatroomShareLocalJsonRuntimeAllowed(input.env ?? {});
  }

  const { database } = await readLearningChatroomShareSnapshot({
    dataDir: input.dataDir,
    repository: input.repository,
  });
  return database.shares.find((item) => item.shareId === input.shareId);
}

export async function revokeLearningChatroomShare(input: {
  dataDir?: string;
  repository?: LearningChatroomShareRepository;
  env?: Record<string, string | undefined>;
  shareId: string;
  now?: string;
}): Promise<
  | { status: "not-found" }
  | { status: "revoked"; record: LearningChatroomShareRecord; receipt: LearningChatroomShareReceipt }
> {
  // Revocation is a write, so it refuses local JSON in production for the same
  // reason minting does: a link written to an ephemeral filesystem cannot be
  // reliably revoked there.
  if (!input.repository) {
    assertLearningChatroomShareLocalJsonRuntimeAllowed(input.env ?? {});
  }
  const storage = input.repository?.storage ?? localLearningChatroomShareStorage;
  const now = input.now ?? new Date().toISOString();
  if (!isSafeId(input.shareId)) {
    return { status: "not-found" };
  }

  let revoked: LearningChatroomShareRecord | undefined;
  await mutateLearningChatroomShareDatabase({
    dataDir: input.dataDir,
    repository: input.repository,
    now,
    mutate: (shares) => {
      const existing = shares.find((item) => item.shareId === input.shareId);
      // An already-revoked share is left exactly as it was: the first
      // revocation is the one that counts, and re-revoking must not rewrite the
      // moment the link stopped working.
      if (!existing || existing.revokedAt) {
        revoked = undefined;
        return undefined;
      }
      const next: LearningChatroomShareRecord = { ...existing, revokedAt: now };
      revoked = next;
      return shares.map((item) => (item.shareId === input.shareId ? next : item));
    },
  });

  if (!revoked) {
    return { status: "not-found" };
  }
  return {
    status: "revoked",
    record: revoked,
    receipt: createReceipt("revoked", revoked.shareId, storage),
  };
}

// A share is usable only while it exists, has not been revoked, and has not
// expired. Callers must funnel every lookup through this so "revoked",
// "expired" and "unknown" stay a single, indistinguishable outcome for whoever
// holds the link - a viewer who could tell them apart would learn that a live
// room exists behind the id they guessed.
//
// `nowMs` is injectable because expiry is the first thing about a share that
// depends on the clock, and a route or a suite that already pins its own clock
// must not have a second, unpinned one decide whether the link still works.
export function isLearningChatroomShareActive(
  record: LearningChatroomShareRecord | undefined,
  options: { nowMs?: number } = {},
): record is LearningChatroomShareRecord {
  if (!record || record.revokedAt) {
    return false;
  }
  const expiresAtMs = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    // A record whose expiry cannot be read is treated as ended rather than as
    // eternal: failing closed on a public, sessionless page is the only safe
    // direction.
    return false;
  }
  return (options.nowMs ?? Date.now()) < expiresAtMs;
}

// Mint-time expiry, and the same arithmetic a legacy record is normalized with.
// An unparseable or out-of-range request falls back to the default rather than
// being honoured: the store is the last line before persistence, and a link that
// never ends is exactly what this field exists to prevent.
function resolveLearningChatroomShareExpiry(input: {
  createdAt: string;
  expiresAt?: string;
}) {
  const createdAtMs = Date.parse(input.createdAt);
  const defaultExpiresAt = new Date(
    (Number.isFinite(createdAtMs) ? createdAtMs : Date.now()) +
      learningChatroomShareDefaultTtlMs,
  ).toISOString();
  if (!input.expiresAt) {
    return defaultExpiresAt;
  }

  const requestedMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(requestedMs) || !Number.isFinite(createdAtMs)) {
    return defaultExpiresAt;
  }
  if (requestedMs <= createdAtMs || requestedMs > createdAtMs + learningChatroomShareMaxTtlMs) {
    return defaultExpiresAt;
  }
  return new Date(requestedMs).toISOString();
}

export async function readLearningChatroomShareSnapshot(input: {
  dataDir?: string;
  repository?: LearningChatroomShareRepository;
}): Promise<LearningChatroomShareRepositorySnapshot> {
  if (input.repository) {
    const snapshot = await input.repository.read();
    return {
      database: normalizeLearningChatroomShareDatabase(snapshot.database),
      ...(snapshot.revision
        ? { revision: requireSafeId(snapshot.revision, "revision") }
        : {}),
    };
  }

  return {
    database: await readLearningChatroomShareDatabase({ dataDir: input.dataDir }),
  };
}

export async function readLearningChatroomShareDatabase(input: {
  dataDir?: string;
}): Promise<LearningChatroomShareDatabase> {
  if (!input.dataDir) {
    throw new LearningChatroomShareStoreError(
      500,
      "Learning chatroom share data directory is required.",
    );
  }

  const filePath = resolveDatabasePath(input.dataDir);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return createEmptyLearningChatroomShareDatabase();
  }

  return normalizeLearningChatroomShareDatabase(JSON.parse(raw));
}

export function createEmptyLearningChatroomShareDatabase(): LearningChatroomShareDatabase {
  return {
    schemaVersion: learningChatroomShareSchemaVersion,
    updatedAt: "1970-01-01T00:00:00.000Z",
    shares: [],
  };
}

// An unknown schema version is a hard rejection: a database written by some
// other product must never be silently adopted as this one's share table.
export function normalizeLearningChatroomShareDatabase(
  value: unknown,
): LearningChatroomShareDatabase {
  const schemaVersion =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (schemaVersion !== learningChatroomShareSchemaVersion) {
    throw new Error("Learning chatroom share database is invalid.");
  }
  const record = value as { updatedAt?: unknown; shares?: unknown };
  return {
    schemaVersion: learningChatroomShareSchemaVersion,
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    shares: Array.isArray(record.shares)
      ? record.shares.map(normalizeLearningChatroomShare)
      : [],
  };
}

function normalizeLearningChatroomShare(value: unknown): LearningChatroomShareRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Learning chatroom share is invalid.");
  }
  const record = value as Record<string, unknown>;
  return {
    shareId: requireSafeId(record.shareId, "share id"),
    courseId: requireBoundedText(
      record.courseId,
      "course id",
      learningChatroomShareMaxIdLength,
    ),
    ...(record.classId
      ? {
          classId: requireBoundedText(
            record.classId,
            "class id",
            learningChatroomShareMaxIdLength,
          ),
        }
      : {}),
    ...(record.groupId
      ? {
          groupId: requireBoundedText(
            record.groupId,
            "group id",
            learningChatroomShareMaxIdLength,
          ),
        }
      : {}),
    createdBy: requireBoundedText(
      record.createdBy,
      "share creator",
      learningChatroomShareMaxIdLength,
    ),
    createdAt: requireIsoDate(record.createdAt, "createdAt"),
    // Legacy records - every share minted before links had an end - are read as
    // expiring 14 days after they were minted. Normalizing on READ rather than
    // through a migration means the rule applies to a database this build has
    // never written, including one an external backend still holds.
    expiresAt: resolveLearningChatroomShareExpiry({
      createdAt: requireIsoDate(record.createdAt, "createdAt"),
      ...(typeof record.expiresAt === "string" ? { expiresAt: record.expiresAt } : {}),
    }),
    ...(record.revokedAt ? { revokedAt: requireIsoDate(record.revokedAt, "revokedAt") } : {}),
    storagePolicy: normalizeShareStoragePolicy(record.storagePolicy),
    storageWritePolicy: normalizeShareStorageWritePolicy(record.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

// One read-modify-write for both mutations. A `undefined` mutation result means
// "nothing to write", so a no-op revoke costs no snapshot replace.
async function mutateLearningChatroomShareDatabase(input: {
  dataDir?: string;
  repository?: LearningChatroomShareRepository;
  now: string;
  mutate: (
    shares: LearningChatroomShareRecord[],
  ) => LearningChatroomShareRecord[] | undefined;
}) {
  const maxAttempts = input.repository ? learningChatroomShareMaxWriteAttempts : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await readLearningChatroomShareSnapshot({
      dataDir: input.dataDir,
      repository: input.repository,
    });
    const shares = input.mutate(snapshot.database.shares);
    if (!shares) {
      return;
    }

    try {
      await writeLearningChatroomShareSnapshot({
        dataDir: input.dataDir,
        repository: input.repository,
        database: {
          schemaVersion: learningChatroomShareSchemaVersion,
          updatedAt: input.now,
          shares,
        },
        expectedRevision: snapshot.revision,
      });
      return;
    } catch (error) {
      if (
        input.repository &&
        attempt < maxAttempts - 1 &&
        error instanceof LearningChatroomShareStoreError &&
        error.status === 409
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new LearningChatroomShareStoreError(
    409,
    "Learning chatroom share snapshot changed; retry required.",
  );
}

async function writeLearningChatroomShareSnapshot(input: {
  dataDir?: string;
  repository?: LearningChatroomShareRepository;
  database: LearningChatroomShareDatabase;
  expectedRevision?: string;
}) {
  if (input.repository) {
    await input.repository.write({
      database: normalizeLearningChatroomShareDatabase(input.database),
      ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
    });
    return;
  }

  if (!input.dataDir) {
    throw new LearningChatroomShareStoreError(
      500,
      "Learning chatroom share data directory is required.",
    );
  }

  await mkdir(input.dataDir, { recursive: true });
  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath: resolveDatabasePath(input.dataDir),
    fileNamePrefix: "learning-chatroom-shares",
    value: input.database,
  });
}

// Both ways a link dies age out of the database on the same retention: a record
// that has been unusable for a month answers 404 whether it is still stored or
// not, so keeping it only grows the snapshot every mint has to rewrite.
function pruneExpiredRevokedShares(shares: LearningChatroomShareRecord[], now: string) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    return shares;
  }
  return shares.filter((share) => {
    const endedAtMs = readLearningChatroomShareEndedAtMs(share);
    if (endedAtMs === undefined) {
      return true;
    }
    return nowMs - endedAtMs < learningChatroomShareRevokedRetentionMs;
  });
}

function readLearningChatroomShareEndedAtMs(share: LearningChatroomShareRecord) {
  const revokedAtMs = share.revokedAt ? Date.parse(share.revokedAt) : undefined;
  if (revokedAtMs !== undefined && Number.isFinite(revokedAtMs)) {
    return revokedAtMs;
  }
  const expiresAtMs = Date.parse(share.expiresAt);
  return Number.isFinite(expiresAtMs) ? expiresAtMs : undefined;
}

function normalizeShareStoragePolicy(value: unknown): LearningChatroomShareStoragePolicy {
  return value === "external-redacted-learning-chatroom-shares"
    ? "external-redacted-learning-chatroom-shares"
    : "local-json-learning-chatroom-shares";
}

function normalizeShareStorageWritePolicy(
  value: unknown,
): LearningChatroomShareStorageWritePolicy {
  return value === "external-optimistic-snapshot-replace"
    ? "external-optimistic-snapshot-replace"
    : "atomic-json-file-replace";
}

function createReceipt(
  status: "created" | "revoked",
  shareId: string,
  storage: LearningChatroomShareStorageDescriptor,
): LearningChatroomShareReceipt {
  return {
    status,
    shareId,
    storagePolicy: storage.shareStoragePolicy,
    storageWritePolicy: storage.storageWritePolicy,
    concurrencyControl:
      storage.storageWritePolicy === "external-optimistic-snapshot-replace"
        ? "optimistic-revision-retry"
        : "atomic-json-file-replace",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function resolveDatabasePath(dataDir: string) {
  const filePath = resolve(dataDir, "learning-chatroom-shares.json");
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
  if (
    normalizedPath !== normalizedBase &&
    !normalizedPath.startsWith(`${normalizedBase}/`)
  ) {
    throw new Error("Learning chatroom share path escapes the configured data directory.");
  }
}

function isSafeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 120 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  );
}

function requireSafeId(value: unknown, label: string) {
  if (!isSafeId(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

// Course ids, class ids and accounts are free-form and often non-ASCII, so they
// are bounded and trimmed rather than slug-checked.
function requireBoundedText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid ${label}.`);
  }
  return value.trim().slice(0, maxLength);
}

function requireIsoDate(value: unknown, label: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function createRedaction(): LearningChatroomShareRedaction {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
