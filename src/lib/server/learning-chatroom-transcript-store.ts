import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import {
  nextOptimisticWriteRetryDelayMs,
  snapshotContentionReasonCode,
} from "./optimistic-write-retry";

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
  | "external-redacted-learning-chatroom-transcripts"
  | "postgres-learning-chatroom-transcripts";

export type LearningChatroomTranscriptStorageWritePolicy =
  | "atomic-json-file-replace"
  | "external-optimistic-snapshot-replace"
  | "postgres-transactional-snapshot-replace";

export type LearningChatroomTranscriptStorageDescriptor = {
  transcriptStoragePolicy: LearningChatroomTranscriptStoragePolicy;
  storageWritePolicy: LearningChatroomTranscriptStorageWritePolicy;
};

// Teacher moderation, recorded ON the row it acted on rather than in a parallel
// table. A hidden message has to stay hidden through every replay path the room
// has - the chatroom GET, the export/print document, the PDF and the signed-out
// `/share` page - and a second store would eventually disagree with this one
// about which of them a moderator actually stopped. `actorId` is the acting
// teacher's account: identity, so it stays server-side exactly like `authorId`
// and never reaches a projection.
//
// `status: "visible"` is a restore, not an absence: the moderator who put a
// message back is as much a part of the audit trail as the one who took it down,
// which is why a restore rewrites the block instead of deleting it.
export type LearningChatroomTranscriptMessageModeration = {
  status: "hidden" | "visible";
  actorId: string;
  actedAt: string;
};

// Room-level moderation, on the transcript record. A frozen room refuses student
// writes while the course teacher keeps speaking, so a class can be quieted
// without losing what it already said.
export type LearningChatroomTranscriptRoomModeration = {
  status: "frozen" | "open";
  actorId: string;
  actedAt: string;
};

export type LearningChatroomTranscriptMessage = {
  messageId: string;
  role: "student" | "agent";
  content: string;
  agentId?: string;
  // Absent on every unmoderated row, which is almost all of them, so the absence
  // means "never moderated" rather than "moderated and allowed".
  moderation?: LearningChatroomTranscriptMessageModeration;
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
  // Absent means the room was never frozen. A thawed room keeps the block with
  // `status: "open"` so the audit trail survives the unfreeze.
  moderation?: LearningChatroomTranscriptRoomModeration;
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

// Which room a repository call is about. A backend that keeps the whole corpus
// in one document - the local JSON file, the external storage service - ignores
// it and answers with everything, exactly as before. The Postgres backend keys a
// row by it, so an append to one room neither locks nor rewrites another room's
// row. It stays optional because "the whole corpus" is still a legal request for
// the backends that can express it.
export type LearningChatroomTranscriptRepositoryScope = {
  transcriptId?: string;
};

export type LearningChatroomTranscriptRepository = {
  storage: LearningChatroomTranscriptStorageDescriptor;
  read: (
    scope?: LearningChatroomTranscriptRepositoryScope,
  ) => Promise<LearningChatroomTranscriptRepositorySnapshot>;
  write: (
    input: LearningChatroomTranscriptRepositoryScope & {
      database: LearningChatroomTranscriptDatabase;
      expectedRevision?: string;
    },
  ) => Promise<void>;
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
  // Hidden rows are already gone from this list: filtering here rather than in
  // each of the four readers is what stops a moderated message from surviving in
  // whichever one is next added.
  messages: LearningChatroomTranscriptMessage[];
  hiddenMessageCount: number;
  // The ids behind that count, and the only thing about a hidden row this result
  // still discloses. Nothing renders them: they exist so a caller can recognise
  // a hidden row it is being handed from somewhere else - a client re-posting
  // its own stale transcript - as already stored and already moderated. Without
  // them a hidden message is simply absent from `messages`, which reads exactly
  // like "never stored", and the provider round used to append it to the prompt
  // as an unstored pending row.
  hiddenMessageIds: string[];
  moderation?: LearningChatroomTranscriptRoomModeration;
  storagePolicy: LearningChatroomTranscriptStoragePolicy;
  responsibleSession: "S12";
  redaction: LearningChatroomTranscriptRedaction;
};

export type LearningChatroomTranscriptModerationReceipt = {
  status: "applied";
  transcriptId: string;
  target: "message" | "room";
  moderation:
    | LearningChatroomTranscriptMessageModeration
    | LearningChatroomTranscriptRoomModeration;
  messageId?: string;
  storagePolicy: LearningChatroomTranscriptStoragePolicy;
  storageWritePolicy: LearningChatroomTranscriptStorageWritePolicy;
  responsibleSession: "S12";
  redaction: LearningChatroomTranscriptRedaction;
};

export type LearningChatroomTranscriptModerationResult =
  | { status: "not-found" }
  | { status: "applied"; receipt: LearningChatroomTranscriptModerationReceipt };

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

// Decorrelated jitter between attempts, the AWS backoff: the next wait is drawn
// from [base, previous * 3] and clamped to a small cap. Retrying instantly -
// which is what a bare `continue` did - guarantees that the writers who lost a
// group room's race re-read the same snapshot in the same millisecond and
// collide again, so four attempts are spent inside a few milliseconds and the
// append is dropped. Randomised waits spread the losers apart instead. The cap
// stays small because the caller is a learner waiting on a live round, not a
// batch job: the whole ladder is worth a fraction of one provider call.
export const learningChatroomTranscriptRetryBaseDelayMs = 25;
export const learningChatroomTranscriptRetryMaxDelayMs = 250;

const localLearningChatroomTranscriptStorage: LearningChatroomTranscriptStorageDescriptor =
  {
    transcriptStoragePolicy: "local-json-learning-chatroom-transcripts",
    storageWritePolicy: "atomic-json-file-replace",
  };

export class LearningChatroomTranscriptStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // Stable, machine-readable classification, same field and same values as
    // the teaching stores carry (see optimistic-write-retry.ts). Only set where
    // a caller is expected to branch on the reason rather than show the message
    // - exhausted snapshot contention today - so an absent code means "the
    // message is the whole answer".
    readonly reasonCode?: string,
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
    transcriptId,
  });
  const transcript = database.transcripts.find(
    (item) => item.transcriptId === transcriptId,
  );

  const messages = transcript?.messages ?? [];
  const visibleMessages = messages.filter(
    (message) => message.moderation?.status !== "hidden",
  );

  return {
    transcriptId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    studentId: input.studentId,
    messages: visibleMessages,
    hiddenMessageCount: messages.length - visibleMessages.length,
    hiddenMessageIds: messages
      .filter((message) => message.moderation?.status === "hidden")
      .map((message) => message.messageId),
    ...(transcript?.moderation ? { moderation: transcript.moderation } : {}),
    storagePolicy: storage.transcriptStoragePolicy,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

// Hides or restores one stored row. The message is kept - a moderated
// conversation still has to be auditable, and deleting the row would also make
// the append idempotent-by-id guarantee lie, since the client re-posts its whole
// visible transcript and a deleted row would simply come back.
export async function setLearningChatroomTranscriptMessageModeration(input: {
  dataDir?: string;
  repository?: LearningChatroomTranscriptRepository;
  courseId: string;
  classId?: string;
  studentId: string;
  groupId?: string;
  messageId: string;
  status: LearningChatroomTranscriptMessageModeration["status"];
  actorId: string;
  now?: string;
  retryBudgetMs?: number;
}): Promise<LearningChatroomTranscriptModerationResult> {
  const storage = input.repository?.storage ?? localLearningChatroomTranscriptStorage;
  const now = input.now ?? new Date().toISOString();
  const moderation: LearningChatroomTranscriptMessageModeration = {
    status: input.status,
    actorId: requireBoundedText(
      input.actorId,
      "moderator id",
      learningChatroomTranscriptMaxIdLength,
    ),
    actedAt: requireIsoDate(now, "moderation actedAt"),
  };
  const messageId = requireBoundedText(
    input.messageId,
    "message id",
    learningChatroomTranscriptMaxIdLength,
  );

  const result = await mutateLearningChatroomTranscriptRecord({
    ...input,
    now,
    mutate: (existing) => {
      if (!existing?.messages.some((message) => message.messageId === messageId)) {
        // Nothing to moderate. Reported rather than invented: creating a room
        // record for a message that was never stored would publish an empty room
        // as a side effect of a mistyped id.
        return "not-found";
      }
      return {
        ...existing,
        messages: existing.messages.map((message) =>
          message.messageId === messageId ? { ...message, moderation } : message,
        ),
        updatedAt: now,
      };
    },
  });
  if (result === "not-found") {
    return { status: "not-found" };
  }

  return {
    status: "applied",
    receipt: createModerationReceipt({
      transcriptId: createLearningChatroomTranscriptId(input),
      target: "message",
      moderation,
      messageId,
      storage,
    }),
  };
}

// Freezes or thaws the room. Unlike message moderation this may run against a
// room that has never been written - a teacher can quiet a room before anyone
// speaks in it - so an absent record is created rather than reported missing.
export async function setLearningChatroomTranscriptRoomModeration(input: {
  dataDir?: string;
  repository?: LearningChatroomTranscriptRepository;
  courseId: string;
  classId?: string;
  studentId: string;
  groupId?: string;
  status: LearningChatroomTranscriptRoomModeration["status"];
  actorId: string;
  now?: string;
  retryBudgetMs?: number;
}): Promise<LearningChatroomTranscriptModerationResult> {
  const storage = input.repository?.storage ?? localLearningChatroomTranscriptStorage;
  const now = input.now ?? new Date().toISOString();
  const transcriptId = createLearningChatroomTranscriptId(input);
  const moderation: LearningChatroomTranscriptRoomModeration = {
    status: input.status,
    actorId: requireBoundedText(
      input.actorId,
      "moderator id",
      learningChatroomTranscriptMaxIdLength,
    ),
    actedAt: requireIsoDate(now, "moderation actedAt"),
  };
  const courseId = requireBoundedText(
    input.courseId,
    "course id",
    learningChatroomTranscriptMaxIdLength,
  );
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

  await mutateLearningChatroomTranscriptRecord({
    ...input,
    now,
    mutate: (existing) => ({
      transcriptId,
      courseId,
      ...(classId ? { classId } : {}),
      ...(groupId ? { groupId } : {}),
      // Creation provenance is preserved exactly as an append preserves it: a
      // teacher freezing someone else's room must not become its creator.
      studentId: existing?.studentId ?? studentId,
      messages: existing?.messages ?? [],
      moderation,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      storagePolicy: storage.transcriptStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    }),
  });

  return {
    status: "applied",
    receipt: createModerationReceipt({
      transcriptId,
      target: "room",
      moderation,
      storage,
    }),
  };
}

// The moderation counterpart of the append loop: one read-modify-write of a
// single room's record, retried against a fresh revision on a snapshot conflict
// with the same decorrelated-jitter ladder. Moderation is a rare, human-triggered
// write, so it borrows the per-student attempt count even on a group room.
async function mutateLearningChatroomTranscriptRecord(input: {
  dataDir?: string;
  repository?: LearningChatroomTranscriptRepository;
  courseId: string;
  classId?: string;
  studentId: string;
  groupId?: string;
  now: string;
  retryBudgetMs?: number;
  mutate: (
    existing: LearningChatroomTranscriptRecord | undefined,
  ) => LearningChatroomTranscriptRecord | "not-found";
}): Promise<"applied" | "not-found"> {
  const transcriptId = createLearningChatroomTranscriptId(input);
  const maxAttempts = input.repository ? learningChatroomTranscriptMaxAppendAttempts : 1;
  const retryBudgetStartedAtMs = Date.now();
  let retryDelayMs = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await readLearningChatroomTranscriptSnapshot({
      dataDir: input.dataDir,
      repository: input.repository,
      transcriptId,
    });
    const existing = snapshot.database.transcripts.find(
      (item) => item.transcriptId === transcriptId,
    );
    const mutated = input.mutate(existing);
    if (mutated === "not-found") {
      return "not-found";
    }
    const transcript = normalizeLearningChatroomTranscript(mutated);
    const nextDatabase: LearningChatroomTranscriptDatabase = {
      schemaVersion: learningChatroomTranscriptSchemaVersion,
      updatedAt: input.now,
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
        transcriptId,
        database: nextDatabase,
        expectedRevision: snapshot.revision,
      });
      return "applied";
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
        retryDelayMs = nextLearningChatroomTranscriptRetryDelayMs({
          previousDelayMs: retryDelayMs,
        });
        await sleepLearningChatroomTranscriptRetry(
          clampLearningChatroomTranscriptRetryDelay({
            delayMs: retryDelayMs,
            startedAtMs: retryBudgetStartedAtMs,
            retryBudgetMs: input.retryBudgetMs,
          }),
        );
        continue;
      }
      throw error;
    }
  }

  // Exhausted contention on the moderated room, not a caller mistake. Same
  // stable `reasonCode` as every other snapshot surface in the tree, so a client
  // can tell "the room was busy, try again" from "your request was wrong"
  // without parsing English. The prose is unchanged.
  throw new LearningChatroomTranscriptStoreError(
    409,
    "Learning chatroom transcript snapshot changed; retry required.",
    snapshotContentionReasonCode,
  );
}

function createModerationReceipt(input: {
  transcriptId: string;
  target: "message" | "room";
  moderation:
    | LearningChatroomTranscriptMessageModeration
    | LearningChatroomTranscriptRoomModeration;
  messageId?: string;
  storage: LearningChatroomTranscriptStorageDescriptor;
}): LearningChatroomTranscriptModerationReceipt {
  return {
    status: "applied",
    transcriptId: input.transcriptId,
    target: input.target,
    moderation: input.moderation,
    ...(input.messageId ? { messageId: input.messageId } : {}),
    storagePolicy: input.storage.transcriptStoragePolicy,
    storageWritePolicy: input.storage.storageWritePolicy,
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
  let retryDelayMs = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await readLearningChatroomTranscriptSnapshot({
      dataDir: input.dataDir,
      repository: input.repository,
      transcriptId,
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
        transcriptId,
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
        retryDelayMs = nextLearningChatroomTranscriptRetryDelayMs({
          previousDelayMs: retryDelayMs,
        });
        await sleepLearningChatroomTranscriptRetry(
          clampLearningChatroomTranscriptRetryDelay({
            delayMs: retryDelayMs,
            startedAtMs: retryBudgetStartedAtMs,
            retryBudgetMs: input.retryBudgetMs,
          }),
        );
        // The wait itself can spend what remained of the caller's budget, so the
        // budget is re-checked on the far side of it rather than only before:
        // sleeping through a deadline and then starting an attempt anyway would
        // be worse than not retrying at all.
        if (
          hasLearningChatroomTranscriptRetryBudget(
            retryBudgetStartedAtMs,
            input.retryBudgetMs,
          )
        ) {
          continue;
        }
        break;
      }
      throw error;
    }
  }

  // The append ladder ran out of attempts or out of budget: the room was busy
  // for the whole window. Carries the same stable `reasonCode` as the
  // moderation loop above and as the teaching stores, so one client rule covers
  // every optimistic-snapshot surface. The prose is unchanged.
  throw new LearningChatroomTranscriptStoreError(
    409,
    "Learning chatroom transcript snapshot changed; retry required.",
    snapshotContentionReasonCode,
  );
}

export async function readLearningChatroomTranscriptSnapshot(input: {
  dataDir?: string;
  repository?: LearningChatroomTranscriptRepository;
  // Absent means "the whole corpus", which is what the local file and the
  // external service answer either way. A per-room backend needs the key to
  // read one room instead of all of them.
  transcriptId?: string;
}): Promise<LearningChatroomTranscriptRepositorySnapshot> {
  if (input.repository) {
    const snapshot = await input.repository.read(
      input.transcriptId ? { transcriptId: input.transcriptId } : undefined,
    );
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
  transcriptId?: string;
  database: LearningChatroomTranscriptDatabase;
  expectedRevision?: string;
}) {
  if (input.repository) {
    await input.repository.write({
      database: normalizeLearningChatroomTranscriptDatabase(input.database),
      ...(input.transcriptId ? { transcriptId: input.transcriptId } : {}),
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
    ...normalizeOptionalModeration(record.moderation, ["frozen", "open"]),
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
    ...normalizeOptionalModeration(record.moderation, ["hidden", "visible"]),
    createdAt: requireIsoDate(record.createdAt, "createdAt"),
  };
}

// One normalizer for both moderation blocks, because they are the same three
// fields with different status vocabularies. An absent block stays absent - the
// common case is an unmoderated row - and a block whose status is not one this
// build knows is dropped rather than trusted, exactly as `authorRole` is: a
// forged or corrupted snapshot must not be able to invent a moderation state.
// A present-but-malformed actor or timestamp is a hard rejection, like every
// other required field in this file.
function normalizeOptionalModeration<Status extends string>(
  value: unknown,
  statuses: readonly Status[],
): { moderation?: { status: Status; actorId: string; actedAt: string } } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const status = statuses.find((candidate) => candidate === record.status);
  if (!status) {
    return {};
  }
  return {
    moderation: {
      status,
      actorId: requireBoundedText(
        record.actorId,
        "moderator id",
        learningChatroomTranscriptMaxIdLength,
      ),
      actedAt: requireIsoDate(record.actedAt, "moderation actedAt"),
    },
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

// Exported because the window is no longer only an internal trimming rule: the
// room, the export document, the PDF and the share page all have to be able to
// say that older turns have rolled out, and they can only say it honestly
// against the same cap the append actually trims to.
export function resolveLearningChatroomTranscriptMaxMessages(groupId: string | undefined) {
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

// Exported for its own coverage: the property that matters is a spread, and a
// spread is only observable across many draws, which is unpleasant to assert
// through a whole append. `random` is injectable for the same reason.
//
// The draw itself is the shared server-wide policy (optimistic-write-retry.ts);
// only the base and the cap are this room's. Keeping one implementation means
// the chatroom and the teaching write loops cannot drift apart on the one thing
// that has to hold everywhere: losers of a race must wait different amounts.
export function nextLearningChatroomTranscriptRetryDelayMs(input: {
  previousDelayMs: number;
  random?: number;
}) {
  return nextOptimisticWriteRetryDelayMs({
    previousDelayMs: input.previousDelayMs,
    baseDelayMs: learningChatroomTranscriptRetryBaseDelayMs,
    maxDelayMs: learningChatroomTranscriptRetryMaxDelayMs,
    ...(input.random === undefined ? {} : { random: input.random }),
  });
}

// The budget bounds the wait as well as the attempt count. The unclamped draw is
// what feeds the next one, so a truncated final wait does not flatten the ladder.
function clampLearningChatroomTranscriptRetryDelay(input: {
  delayMs: number;
  startedAtMs: number;
  retryBudgetMs: number | undefined;
}) {
  if (input.retryBudgetMs === undefined) {
    return input.delayMs;
  }
  const remainingMs = input.retryBudgetMs - (Date.now() - input.startedAtMs);
  return Math.max(0, Math.min(input.delayMs, remainingMs));
}

async function sleepLearningChatroomTranscriptRetry(delayMs: number) {
  if (delayMs <= 0) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
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
