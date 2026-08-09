import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";

// Server-side persistence for the human-AI learner chatroom, scoped per
// (courseId, classId, student) so a refresh or a navigation keeps the
// transcript instead of restarting from an empty room. Structured like the
// teaching-course-management / teaching-course-assets stores: one normalized
// JSON database written atomically to a local data dir by default, behind a
// repository seam so an external storage backend replaces the file layer
// without any route change.

type LearningChatroomTranscriptRedaction = {
  secrets: "omitted";
  localFiles: "omitted";
  assets: "ids-only";
};

export type LearningChatroomTranscriptStoragePolicy =
  | "local-json-learning-chatroom-transcripts"
  | "external-redacted-learning-chatroom-transcripts";

export type LearningChatroomTranscriptStorageWritePolicy =
  | "atomic-json-file-replace"
  | "external-optimistic-snapshot-replace";

export type LearningChatroomTranscriptStorageDescriptor = {
  transcriptStoragePolicy: LearningChatroomTranscriptStoragePolicy;
  storageWritePolicy: LearningChatroomTranscriptStorageWritePolicy;
};

export type LearningChatroomTranscriptMessage = {
  messageId: string;
  role: "student" | "agent";
  content: string;
  agentId?: string;
  // Schema v2 author attribution, written only for group rooms. `authorId` is
  // the session account of the human who sent the row and never leaves the
  // server; `authorName` is the display-name snapshot the room renders;
  // `authorRole` separates a member's turn from the course teacher's, so the
  // room can mark instructor guidance. All three are absent on agent rows and
  // on every v1 row, which is why they are optional rather than defaulted: a
  // per-student room already knew who spoke.
  authorId?: string;
  authorName?: string;
  authorRole?: "student" | "teacher";
  createdAt: string;
};

export type LearningChatroomTranscriptRecord = {
  transcriptId: string;
  courseId: string;
  classId?: string;
  // Present only on group rooms. `studentId` stays on both room kinds and
  // records which member's request first created the record; on a group room it
  // is creation provenance, never an authorization key.
  groupId?: string;
  studentId: string;
  messages: LearningChatroomTranscriptMessage[];
  createdAt: string;
  updatedAt: string;
  storagePolicy: LearningChatroomTranscriptStoragePolicy;
  storageWritePolicy: LearningChatroomTranscriptStorageWritePolicy;
  responsibleSession: "S12";
  redaction: LearningChatroomTranscriptRedaction;
};

export type LearningChatroomTranscriptDatabase = {
  schemaVersion: typeof learningChatroomTranscriptSchemaVersion;
  updatedAt: string;
  transcripts: LearningChatroomTranscriptRecord[];
};

export type LearningChatroomTranscriptRepositorySnapshot = {
  database: LearningChatroomTranscriptDatabase;
  revision?: string;
};

export type LearningChatroomTranscriptRepository = {
  storage: LearningChatroomTranscriptStorageDescriptor;
  read: () => Promise<LearningChatroomTranscriptRepositorySnapshot>;
  write: (input: {
    database: LearningChatroomTranscriptDatabase;
    expectedRevision?: string;
  }) => Promise<void>;
};

export type LearningChatroomTranscriptAppendReceipt = {
  status: "persisted";
  transcriptId: string;
  appendedMessageCount: number;
  messageCount: number;
  storagePolicy: LearningChatroomTranscriptStoragePolicy;
  storageWritePolicy: LearningChatroomTranscriptStorageWritePolicy;
  concurrencyControl: "atomic-json-file-replace" | "optimistic-revision-retry";
  responsibleSession: "S12";
  redaction: LearningChatroomTranscriptRedaction;
};

export type LearningChatroomTranscriptReadResult = {
  transcriptId: string;
  courseId: string;
  classId?: string;
  groupId?: string;
  studentId: string;
  messages: LearningChatroomTranscriptMessage[];
  storagePolicy: LearningChatroomTranscriptStoragePolicy;
  responsibleSession: "S12";
  redaction: LearningChatroomTranscriptRedaction;
};

// Schema v2 adds per-message author attribution and the group room key. Reads
// accept v1 as well - a v1 record simply carries no author fields - but every
// write emits v2, so a database upgrades itself the first time it is written.
export const learningChatroomTranscriptSchemaVersion =
  "uais-learning-chatroom-transcripts-v2";
export const learningChatroomTranscriptLegacySchemaVersion =
  "uais-learning-chatroom-transcripts-v1";

// One room is a rolling window, not an archive: the composer caps a message at
// 4000 characters and the provider round only ever reads the most recent 50, so
// a transcript keeps the newest turns and drops older ones on append.
//
// A per-student room keeps 200. A group room keeps 500 (owner-approved, plan
// D7): several members share one window, so 200 is a handful of sessions rather
// than a term's worth. The provider round still only sends the newest 50, so the
// larger window costs storage, never tokens.
export const learningChatroomTranscriptMaxMessages = 200;
export const learningChatroomGroupTranscriptMaxMessages = 500;
const learningChatroomTranscriptMaxContentLength = 4000;
const learningChatroomTranscriptMaxIdLength = 200;
const learningChatroomTranscriptMaxAuthorNameLength = 120;
// A per-student room has exactly one writer, so a single retry of the
// read-modify-write is enough. A group room has as many concurrent writers as it
// has members, so one retry loses appends under ordinary classroom contention.
const learningChatroomTranscriptMaxAppendAttempts = 2;
const learningChatroomGroupTranscriptMaxAppendAttempts = 4;

const localLearningChatroomTranscriptStorage: LearningChatroomTranscriptStorageDescriptor =
  {
    transcriptStoragePolicy: "local-json-learning-chatroom-transcripts",
    storageWritePolicy: "atomic-json-file-replace",
  };

export class LearningChatroomTranscriptStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LearningChatroomTranscriptStoreError";
  }
}

export function assertLearningChatroomTranscriptLocalJsonRuntimeAllowed(
  env: Record<string, string | undefined>,
) {
  if (!isLearningChatroomTranscriptProductionRuntime(env)) {
    return;
  }

  throw new LearningChatroomTranscriptStoreError(
    503,
    "Production learning chatroom transcript persistence requires external storage.",
  );
}

function isLearningChatroomTranscriptProductionRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

// Chatroom transcripts are course-scoped data, so they default to the same data
// directory as the course records they hang off; the dedicated variable exists
// for deployments that want them split.
export function resolveLearningChatroomTranscriptDataDir(
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
        "uais-learning-chatroom-transcripts-db",
      );
}

// The room key is hashed rather than concatenated: course ids, class ids and
// account names are free-form (and often non-ASCII), while a record id has to
// stay a safe, bounded slug.
//
// Two room kinds, two derivations, deliberately kept apart. The per-student
// digest hashes a POSITIONAL array whose shape is frozen: appending a field to
// it would silently rename every existing room and orphan its history, so a
// group room gets its own prefix and its own array (led by the "group" tag) and
// the legacy branch is never touched.
export function createLearningChatroomTranscriptId(input: {
  courseId: string;
  classId?: string;
  studentId: string;
  groupId?: string;
}) {
  if (input.groupId) {
    const groupDigest = createHash("sha256")
      .update(JSON.stringify(["group", input.courseId, input.classId ?? "", input.groupId]))
      .digest("hex")
      .slice(0, 32);
    return `chatroom-group-transcript-${groupDigest}`;
  }

  const digest = createHash("sha256")
    .update(JSON.stringify([input.courseId, input.classId ?? "", input.studentId]))
    .digest("hex")
    .slice(0, 32);
  return `chatroom-transcript-${digest}`;
}

export async function readLearningChatroomTranscript(input: {
  dataDir?: string;
  repository?: LearningChatroomTranscriptRepository;
  courseId: string;
  classId?: string;
  studentId: string;
  groupId?: string;
}): Promise<LearningChatroomTranscriptReadResult> {
  const storage = input.repository?.storage ?? localLearningChatroomTranscriptStorage;
  const transcriptId = createLearningChatroomTranscriptId(input);
  const { database } = await readLearningChatroomTranscriptSnapshot({
    dataDir: input.dataDir,
    repository: input.repository,
  });
  const transcript = database.transcripts.find(
    (item) => item.transcriptId === transcriptId,
  );

  return {
    transcriptId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    studentId: input.studentId,
    messages: transcript?.messages ?? [],
    storagePolicy: storage.transcriptStoragePolicy,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

export async function appendLearningChatroomTranscriptMessages(input: {
  dataDir?: string;
  repository?: LearningChatroomTranscriptRepository;
  courseId: string;
  classId?: string;
  studentId: string;
  groupId?: string;
  messages: Array<{
    messageId: string;
    role: "student" | "agent";
    content: string;
    agentId?: string;
    authorId?: string;
    authorName?: string;
    authorRole?: "student" | "teacher";
    createdAt?: string;
  }>;
  now?: string;
  // Optional wall-clock allowance for the retry loop only, expressed as a
  // duration rather than an absolute deadline so it is immune to whichever clock
  // the caller injects. It never cancels an in-flight repository call - the
  // route's own race remains the single deadline authority - it only stops the
  // loop from starting another attempt the caller is no longer waiting for.
  retryBudgetMs?: number;
}): Promise<LearningChatroomTranscriptAppendReceipt> {
  const storage = input.repository?.storage ?? localLearningChatroomTranscriptStorage;
  const now = input.now ?? new Date().toISOString();
  const transcriptId = createLearningChatroomTranscriptId(input);
  const courseId = requireBoundedText(input.courseId, "course id", learningChatroomTranscriptMaxIdLength);
  const classId = input.classId
    ? requireBoundedText(input.classId, "class id", learningChatroomTranscriptMaxIdLength)
    : undefined;
  const groupId = input.groupId
    ? requireBoundedText(input.groupId, "group id", learningChatroomTranscriptMaxIdLength)
    : undefined;
  const studentId = requireBoundedText(
    input.studentId,
    "student id",
    learningChatroomTranscriptMaxIdLength,
  );
  const incoming = normalizeIncomingMessages(input.messages, now);
  const maxMessages = resolveLearningChatroomTranscriptMaxMessages(groupId);

  // A repository-backed write races other writers of the same snapshot, so the
  // read-modify-write is retried against a fresh revision. A per-student room has
  // one writer and retries once; a group room has one writer per member and
  // retries up to three times. The local file replace is already atomic and needs
  // no retry.
  const maxAttempts = input.repository
    ? groupId
      ? learningChatroomGroupTranscriptMaxAppendAttempts
      : learningChatroomTranscriptMaxAppendAttempts
    : 1;
  const retryBudgetStartedAtMs = Date.now();
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await readLearningChatroomTranscriptSnapshot({
      dataDir: input.dataDir,
      repository: input.repository,
    });
    const existing = snapshot.database.transcripts.find(
      (item) => item.transcriptId === transcriptId,
    );
    // The learner UI posts its whole visible transcript every round, so an
    // append is idempotent per message id: only ids the room has never stored
    // are added, in the order they arrived.
    const storedIds = new Set(existing?.messages.map((message) => message.messageId));
    const appended = incoming.filter((message) => {
      if (storedIds.has(message.messageId)) {
        return false;
      }
      storedIds.add(message.messageId);
      return true;
    });
    const messages = [...(existing?.messages ?? []), ...appended].slice(-maxMessages);
    const transcript = normalizeLearningChatroomTranscript({
      transcriptId,
      courseId,
      ...(classId ? { classId } : {}),
      ...(groupId ? { groupId } : {}),
      // Creation provenance, not identity: the record documents which member's
      // request first created it. A later append by a different group member
      // must preserve the original creator rather than rewrite it - mirroring
      // `createdAt` just below.
      studentId: existing?.studentId ?? studentId,
      messages,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      storagePolicy: storage.transcriptStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    });
    const nextDatabase: LearningChatroomTranscriptDatabase = {
      schemaVersion: learningChatroomTranscriptSchemaVersion,
      updatedAt: now,
      transcripts: [
        ...snapshot.database.transcripts.filter(
          (item) => item.transcriptId !== transcriptId,
        ),
        transcript,
      ],
    };

    try {
      await writeLearningChatroomTranscriptSnapshot({
        dataDir: input.dataDir,
        repository: input.repository,
        database: nextDatabase,
        expectedRevision: snapshot.revision,
      });
      return {
        status: "persisted",
        transcriptId,
        appendedMessageCount: appended.length,
        messageCount: transcript.messages.length,
        storagePolicy: storage.transcriptStoragePolicy,
        storageWritePolicy: storage.storageWritePolicy,
        concurrencyControl:
          storage.storageWritePolicy === "external-optimistic-snapshot-replace"
            ? "optimistic-revision-retry"
            : "atomic-json-file-replace",
        responsibleSession: "S12",
        redaction: createRedaction(),
      };
    } catch (error) {
      if (
        input.repository &&
        attempt < maxAttempts - 1 &&
        isLearningChatroomTranscriptSnapshotConflict(error) &&
        hasLearningChatroomTranscriptRetryBudget(
          retryBudgetStartedAtMs,
          input.retryBudgetMs,
        )
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new LearningChatroomTranscriptStoreError(
    409,
    "Learning chatroom transcript snapshot changed; retry required.",
  );
}

export async function readLearningChatroomTranscriptSnapshot(input: {
  dataDir?: string;
  repository?: LearningChatroomTranscriptRepository;
}): Promise<LearningChatroomTranscriptRepositorySnapshot> {
  if (input.repository) {
    const snapshot = await input.repository.read();
    return {
      database: normalizeLearningChatroomTranscriptDatabase(snapshot.database),
      ...(snapshot.revision
        ? { revision: requireSafeId(snapshot.revision, "revision") }
        : {}),
    };
  }

  return {
    database: await readLearningChatroomTranscriptDatabase({ dataDir: input.dataDir }),
  };
}

export async function readLearningChatroomTranscriptDatabase(input: {
  dataDir?: string;
}): Promise<LearningChatroomTranscriptDatabase> {
  if (!input.dataDir) {
    throw new LearningChatroomTranscriptStoreError(
      500,
      "Learning chatroom transcript data directory is required.",
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
    return createEmptyLearningChatroomTranscriptDatabase();
  }

  return normalizeLearningChatroomTranscriptDatabase(JSON.parse(raw));
}

async function writeLearningChatroomTranscriptSnapshot(input: {
  dataDir?: string;
  repository?: LearningChatroomTranscriptRepository;
  database: LearningChatroomTranscriptDatabase;
  expectedRevision?: string;
}) {
  if (input.repository) {
    await input.repository.write({
      database: normalizeLearningChatroomTranscriptDatabase(input.database),
      ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
    });
    return;
  }

  if (!input.dataDir) {
    throw new LearningChatroomTranscriptStoreError(
      500,
      "Learning chatroom transcript data directory is required.",
    );
  }

  await mkdir(input.dataDir, { recursive: true });
  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath: resolveDatabasePath(input.dataDir),
    fileNamePrefix: "learning-chatroom-transcripts",
    value: input.database,
  });
}

export function createEmptyLearningChatroomTranscriptDatabase(): LearningChatroomTranscriptDatabase {
  return {
    schemaVersion: learningChatroomTranscriptSchemaVersion,
    updatedAt: "1970-01-01T00:00:00.000Z",
    transcripts: [],
  };
}

// Reads accept v1 and v2; writes always emit v2. An unknown schema version is
// still a hard rejection - the point of the check is that a database written by
// some other product must never be silently adopted - but a v1 database is this
// product's own older shape, so it normalizes forward instead of failing the
// room. This is also what lets the external-storage PUT handler (which funnels
// its body through this same normalizer) accept both versions.
export function normalizeLearningChatroomTranscriptDatabase(
  value: unknown,
): LearningChatroomTranscriptDatabase {
  const schemaVersion =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (
    schemaVersion !== learningChatroomTranscriptSchemaVersion &&
    schemaVersion !== learningChatroomTranscriptLegacySchemaVersion
  ) {
    throw new Error("Learning chatroom transcript database is invalid.");
  }
  const record = value as { updatedAt?: unknown; transcripts?: unknown };
  return {
    schemaVersion: learningChatroomTranscriptSchemaVersion,
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    transcripts: Array.isArray(record.transcripts)
      ? record.transcripts.map(normalizeLearningChatroomTranscript)
      : [],
  };
}

function normalizeLearningChatroomTranscript(
  value: unknown,
): LearningChatroomTranscriptRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Learning chatroom transcript is invalid.");
  }
  const record = value as Record<string, unknown>;
  const createdAt = requireIsoDate(record.createdAt, "createdAt");
  const groupId = record.groupId
    ? requireBoundedText(record.groupId, "group id", learningChatroomTranscriptMaxIdLength)
    : undefined;
  return {
    transcriptId: requireSafeId(record.transcriptId, "transcript id"),
    courseId: requireBoundedText(
      record.courseId,
      "course id",
      learningChatroomTranscriptMaxIdLength,
    ),
    ...(record.classId
      ? {
          classId: requireBoundedText(
            record.classId,
            "class id",
            learningChatroomTranscriptMaxIdLength,
          ),
        }
      : {}),
    ...(groupId ? { groupId } : {}),
    studentId: requireBoundedText(
      record.studentId,
      "student id",
      learningChatroomTranscriptMaxIdLength,
    ),
    messages: Array.isArray(record.messages)
      ? record.messages
          .map(normalizeLearningChatroomTranscriptMessage)
          .slice(-resolveLearningChatroomTranscriptMaxMessages(groupId))
      : [],
    createdAt,
    updatedAt: requireIsoDate(record.updatedAt, "updatedAt"),
    storagePolicy: normalizeTranscriptStoragePolicy(record.storagePolicy),
    storageWritePolicy: normalizeTranscriptStorageWritePolicy(record.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeLearningChatroomTranscriptMessage(
  value: unknown,
): LearningChatroomTranscriptMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Learning chatroom transcript message is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (record.role !== "student" && record.role !== "agent") {
    throw new Error("Learning chatroom transcript message role is invalid.");
  }
  return {
    messageId: requireBoundedText(
      record.messageId,
      "message id",
      learningChatroomTranscriptMaxIdLength,
    ),
    role: record.role,
    content: requireBoundedText(
      record.content,
      "message content",
      learningChatroomTranscriptMaxContentLength,
    ),
    ...(record.agentId
      ? {
          agentId: requireBoundedText(
            record.agentId,
            "agent id",
            learningChatroomTranscriptMaxIdLength,
          ),
        }
      : {}),
    // v1 rows carry neither field, so both stay conditional rather than
    // defaulted: an absent author is "unknown", not "someone".
    ...(record.authorId
      ? {
          authorId: requireBoundedText(
            record.authorId,
            "author id",
            learningChatroomTranscriptMaxIdLength,
          ),
        }
      : {}),
    ...(record.authorName
      ? {
          authorName: requireBoundedText(
            record.authorName,
            "author name",
            learningChatroomTranscriptMaxAuthorNameLength,
          ),
        }
      : {}),
    // Only the two known roles survive a readback. Anything else - including a
    // value a forged or corrupted snapshot might carry - drops to absent rather
    // than being trusted, so a stored row can never claim instructor authority
    // that the session did not grant when it was written.
    ...(record.authorRole === "student" || record.authorRole === "teacher"
      ? { authorRole: record.authorRole }
      : {}),
    createdAt: requireIsoDate(record.createdAt, "createdAt"),
  };
}

function normalizeIncomingMessages(
  messages: Array<{
    messageId: string;
    role: "student" | "agent";
    content: string;
    agentId?: string;
    authorId?: string;
    authorName?: string;
    authorRole?: "student" | "teacher";
    createdAt?: string;
  }>,
  now: string,
): LearningChatroomTranscriptMessage[] {
  return messages
    .filter((message) => typeof message.content === "string" && message.content.trim())
    .map((message) =>
      normalizeLearningChatroomTranscriptMessage({
        ...message,
        createdAt: message.createdAt ?? now,
      }),
    );
}

function normalizeTranscriptStoragePolicy(
  value: unknown,
): LearningChatroomTranscriptStoragePolicy {
  return value === "external-redacted-learning-chatroom-transcripts"
    ? "external-redacted-learning-chatroom-transcripts"
    : "local-json-learning-chatroom-transcripts";
}

function normalizeTranscriptStorageWritePolicy(
  value: unknown,
): LearningChatroomTranscriptStorageWritePolicy {
  return value === "external-optimistic-snapshot-replace"
    ? "external-optimistic-snapshot-replace"
    : "atomic-json-file-replace";
}

function isLearningChatroomTranscriptSnapshotConflict(error: unknown) {
  return error instanceof LearningChatroomTranscriptStoreError && error.status === 409;
}

function resolveLearningChatroomTranscriptMaxMessages(groupId: string | undefined) {
  return groupId
    ? learningChatroomGroupTranscriptMaxMessages
    : learningChatroomTranscriptMaxMessages;
}

// No caller budget means the loop keeps its historic behaviour: retry until the
// attempt count runs out.
function hasLearningChatroomTranscriptRetryBudget(
  startedAtMs: number,
  retryBudgetMs: number | undefined,
) {
  if (retryBudgetMs === undefined) {
    return true;
  }
  return Date.now() - startedAtMs < retryBudgetMs;
}

function resolveDatabasePath(dataDir: string) {
  const filePath = resolve(dataDir, "learning-chatroom-transcripts.json");
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
    throw new Error(
      "Learning chatroom transcript path escapes the configured data directory.",
    );
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

// Course ids, class ids, accounts and message bodies are learner-authored and
// often non-ASCII, so they are bounded and trimmed rather than slug-checked. A
// long body is truncated instead of poisoning the whole database read.
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

function createRedaction(): LearningChatroomTranscriptRedaction {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
