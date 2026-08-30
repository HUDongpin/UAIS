import { createUaisLearningChatroomTranscriptRepository } from "@/lib/server/learning-chatroom-transcript-external-store";
import { createUaisLearningChatroomTranscriptPostgresRepository } from "@/lib/server/learning-chatroom-transcript-postgres-store";
import { resolveLearningChatroomDurableBackend } from "@/lib/server/learning-chatroom-durable-backend";
import {
  appendLearningChatroomTranscriptMessages,
  assertLearningChatroomTranscriptLocalJsonRuntimeAllowed,
  createLearningChatroomTranscriptId,
  normalizeLearningChatroomTranscriptDatabase,
  readLearningChatroomTranscriptSnapshot,
  readLearningChatroomTranscript,
  resolveLearningChatroomTranscriptDataDir,
  resolveLearningChatroomTranscriptMaxMessages,
  setLearningChatroomTranscriptMessageModeration,
  setLearningChatroomTranscriptRoomModeration,
  LearningChatroomTranscriptStoreError,
  type LearningChatroomTranscriptMessage,
  type LearningChatroomTranscriptModerationResult,
  type LearningChatroomTranscriptRepository,
  type LearningChatroomTranscriptRoomModeration,
  type LearningChatroomTranscriptStoragePolicy,
  type LearningChatroomTranscriptRepositorySnapshot,
} from "@/lib/server/learning-chatroom-transcript-store";

// Route-facing wrapper around the chatroom transcript store. Persistence is a
// convenience for the learner, never a precondition for talking to the agents:
// every call here reports a status instead of throwing, so a storage outage
// costs the room its history rather than its conversation.

// `groupId` turns the key into a group room: the room is then shared by every
// member of that group and `studentId` degrades from identity to provenance
// (which member's request touched the record), which is why the field stays
// required on both kinds.
export type LearningChatroomTranscriptRoomKey = {
  courseId: string;
  classId?: string;
  groupId?: string;
  studentId: string;
};

export type LearningChatroomHistoryResult = {
  status: "loaded" | "unavailable";
  // Teacher-hidden rows are already filtered out by the store, so every reader
  // of this result - room replay, export document, PDF, public share page -
  // inherits the moderation decision without repeating it.
  messages: LearningChatroomTranscriptMessage[];
  hiddenMessageCount: number;
  // Ids only, never content. A caller that is handed a message from OUTSIDE the
  // store - the request body of a POST, which carries whatever the client still
  // has on screen - needs to tell "this row was never stored" apart from "this
  // row was stored and then hidden by the teacher". Absent this list the two are
  // indistinguishable, and the second used to be treated as the first.
  hiddenMessageIds: string[];
  // Absent when the room was never moderated. An unreadable transcript reports
  // no room state at all rather than guessing "open".
  moderation?: LearningChatroomTranscriptRoomModeration;
  // The room's rolling window, reported rather than left implicit. A transcript
  // is not an archive: the store trims to `maxMessages` on every append, and
  // once `atCapacity` is true the oldest turns are leaving - not only the room,
  // but the export document, the PDF and the public share page, all of which
  // replay this same list. Nothing disclosed that, so a class could lose the
  // start of a discussion and find no surface anywhere that said so.
  window: LearningChatroomTranscriptWindow;
  storagePolicy?: LearningChatroomTranscriptStoragePolicy;
};

export type LearningChatroomTranscriptWindow = {
  maxMessages: number;
  atCapacity: boolean;
};

export type LearningChatroomTranscriptWriteResult = {
  status: "persisted" | "unavailable";
  appendedMessageCount?: number;
  messageCount?: number;
  storagePolicy?: LearningChatroomTranscriptStoragePolicy;
};

// A POST must carry the exact room snapshot it authorized through the eventual
// append.  Unlike `LearningChatroomHistoryResult`, this value keeps the
// optimistic revision and the room identity used by the repository write.  It
// is request-local by construction: callers create one after authorization and
// never cache or share it between requests.
export type LearningChatroomTranscriptWriteSnapshot = {
  room: LearningChatroomTranscriptRoomKey;
  transcriptId: string;
  snapshot: LearningChatroomTranscriptRepositorySnapshot;
  history: LearningChatroomHistoryResult;
};

// A repository-backed POST must never turn an unknown optimistic-write state
// into an unguarded append.  Keep this classification in the route-facing
// runtime so malformed provider data is mapped before a model client or write
// path is constructed, without exposing the provider's raw response/error.
export const learningChatroomTranscriptSnapshotRevisionRequiredReasonCode =
  "transcript-snapshot-revision-required";

const postgresLearningChatroomTranscriptStoragePolicy =
  "postgres-learning-chatroom-transcripts";
const externalLearningChatroomTranscriptStoragePolicy =
  "external-redacted-learning-chatroom-transcripts";

type LearningChatroomTranscriptRuntimeDeps = {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  repository?: LearningChatroomTranscriptRepository;
  onError?: (input: { phase: "transcript-read" | "transcript-write"; error: unknown }) => void;
};

export async function readLearningChatroomHistory(
  input: LearningChatroomTranscriptRuntimeDeps & LearningChatroomTranscriptRoomKey,
): Promise<LearningChatroomHistoryResult> {
  try {
    const { dataDir, repository } = resolveLearningChatroomTranscriptBackend(input);
    const transcript = await readLearningChatroomTranscript({
      dataDir,
      repository,
      courseId: input.courseId,
      ...(input.classId ? { classId: input.classId } : {}),
      ...(input.groupId ? { groupId: input.groupId } : {}),
      studentId: input.studentId,
    });
    return {
      status: "loaded",
      messages: transcript.messages,
      hiddenMessageCount: transcript.hiddenMessageCount,
      hiddenMessageIds: transcript.hiddenMessageIds,
      ...(transcript.moderation ? { moderation: transcript.moderation } : {}),
      // Hidden rows still occupy the window - the store trims the whole stored
      // list, moderated rows included - so capacity is measured against the
      // stored count, not against what this reader can see.
      window: createLearningChatroomTranscriptWindow({
        groupId: input.groupId,
        storedMessageCount: transcript.messages.length + transcript.hiddenMessageCount,
      }),
      storagePolicy: transcript.storagePolicy,
    };
  } catch (error) {
    reportLearningChatroomTranscriptError(input, "transcript-read", error);
    // An unreadable transcript degrades to the pre-persistence behaviour - an
    // empty room - instead of blocking the learner out of the chatroom. It
    // claims no eviction either: a read that answered nothing knows nothing
    // about how full the window is.
    return {
      status: "unavailable",
      messages: [],
      hiddenMessageCount: 0,
      hiddenMessageIds: [],
      window: createLearningChatroomTranscriptWindow({
        groupId: input.groupId,
        storedMessageCount: 0,
      }),
    };
  }
}

// Strict counterpart used by POST.  The ordinary history reader deliberately
// degrades storage failures to an empty transcript for polling; doing that for
// a write would turn an unknown moderation state into an apparently open room.
// This function therefore lets the store error propagate.  A caller may safely
// expose only its mapped public status, never the underlying error details.
export async function readLearningChatroomTranscriptWriteSnapshot(
  input: LearningChatroomTranscriptRuntimeDeps & LearningChatroomTranscriptRoomKey,
): Promise<LearningChatroomTranscriptWriteSnapshot> {
  try {
    const { dataDir, repository } = resolveLearningChatroomTranscriptBackend(input);
    const transcriptId = createLearningChatroomTranscriptId(input);
    // The shared helper intentionally binds the requested id onto its return
    // value for ordinary callers.  POST must inspect the repository's original
    // label before that binding, otherwise a backend that ignores the scoped
    // read could return another room and be mistaken for an empty snapshot.
    const snapshot = repository
      ? await repository.read({ transcriptId })
      : await readLearningChatroomTranscriptSnapshot({ dataDir, transcriptId });
    if (
      repository &&
      snapshot.transcriptId !== undefined &&
      snapshot.transcriptId !== transcriptId
    ) {
      throw new LearningChatroomTranscriptStoreError(
        409,
        "Learning chatroom transcript write snapshot room key does not match the request.",
        "transcript-room-key-mismatch",
      );
    }
    const database = normalizeLearningChatroomTranscriptDatabase(snapshot.database);
    const record = database.transcripts.find((item) => item.transcriptId === transcriptId);
    assertLearningChatroomTranscriptWriteSnapshotRevision({
      snapshot,
      database,
      hasRoomRecord: Boolean(record),
      storagePolicy: repository?.storage.transcriptStoragePolicy,
    });
    const storedMessages = record?.messages ?? [];
    const visibleMessages = storedMessages.filter(
      (message) => message.moderation?.status !== "hidden",
    );
    const history: LearningChatroomHistoryResult = {
      status: "loaded",
      messages: visibleMessages,
      hiddenMessageCount: storedMessages.length - visibleMessages.length,
      hiddenMessageIds: storedMessages
        .filter((message) => message.moderation?.status === "hidden")
        .map((message) => message.messageId),
      ...(record?.moderation ? { moderation: record.moderation } : {}),
      window: createLearningChatroomTranscriptWindow({
        groupId: input.groupId,
        storedMessageCount: storedMessages.length,
      }),
      ...(record?.storagePolicy ? { storagePolicy: record.storagePolicy } : {}),
    };
    return { room: { ...input }, transcriptId, snapshot, history };
  } catch (error) {
    reportLearningChatroomTranscriptError(input, "transcript-read", error);
    if (error instanceof LearningChatroomTranscriptStoreError) {
      throw error;
    }
    // Do not expose backend/provider details and do not let an arbitrary
    // repository error become a generic 500.  POST needs a stable 503 so the
    // caller can distinguish an unreadable authorization snapshot from an
    // application bug, while the original error remains only in the redacted
    // server-side logger.
    throw new LearningChatroomTranscriptStoreError(
      503,
      "Learning chatroom transcript storage is unavailable.",
      "transcript-read-unavailable",
    );
  }
}

function assertLearningChatroomTranscriptWriteSnapshotRevision(input: {
  snapshot: LearningChatroomTranscriptRepositorySnapshot;
  database: ReturnType<typeof normalizeLearningChatroomTranscriptDatabase>;
  hasRoomRecord: boolean;
  storagePolicy?: LearningChatroomTranscriptStoragePolicy;
}) {
  const revision = input.snapshot.revision;
  const hasValidRevision = isLearningChatroomTranscriptSnapshotRevision(revision);

  // The local JSON implementation has atomic file replacement rather than an
  // optimistic revision contract, and therefore legitimately has no revision.
  // If a repository advertises one of the CAS-backed policies, however, a
  // malformed revision must fail closed even in staging/test environments.
  if (
    revision !== undefined &&
    !hasValidRevision
  ) {
    throwLearningChatroomTranscriptSnapshotRevisionRequired();
  }

  if (input.storagePolicy === postgresLearningChatroomTranscriptStoragePolicy) {
    // A missing Postgres row is the one legal no-revision initial state.  Once
    // the room exists, the handed revision is the CAS guard and is mandatory.
    const isInitialEmptyPostgresSnapshot =
      !input.hasRoomRecord && input.database.transcripts.length === 0;
    if (
      (!isInitialEmptyPostgresSnapshot && !hasValidRevision) ||
      revision === "rev-empty"
    ) {
      throwLearningChatroomTranscriptSnapshotRevisionRequired();
    }
    return;
  }

  if (input.storagePolicy === externalLearningChatroomTranscriptStoragePolicy) {
    // External storage has a resource revision even for a 404/empty resource;
    // `rev-empty` is its explicit first-write sentinel.  It is not valid for a
    // non-empty snapshot, where accepting it would erase the distinction
    // between an absent resource and a previously written resource.
    const isEmptySnapshot = input.database.transcripts.length === 0;
    if (
      !hasValidRevision ||
      (isEmptySnapshot && revision !== "rev-empty") ||
      (!isEmptySnapshot && revision === "rev-empty")
    ) {
      throwLearningChatroomTranscriptSnapshotRevisionRequired();
    }
  }
}

function isLearningChatroomTranscriptSnapshotRevision(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 120 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  );
}

function throwLearningChatroomTranscriptSnapshotRevisionRequired(): never {
  throw new LearningChatroomTranscriptStoreError(
    503,
    "Learning chatroom transcript snapshot revision is unavailable.",
    learningChatroomTranscriptSnapshotRevisionRequiredReasonCode,
  );
}

// `atCapacity` is deliberately "the window is full", not "something was
// definitely dropped": the store trims on append, so a room holding exactly its
// cap may not have lost a turn yet, but every further message it takes will
// evict one. That is the moment the disclosure has to appear - telling a class
// afterwards is telling them too late.
function createLearningChatroomTranscriptWindow(input: {
  groupId?: string;
  storedMessageCount: number;
}): LearningChatroomTranscriptWindow {
  const maxMessages = resolveLearningChatroomTranscriptMaxMessages(input.groupId);
  return {
    maxMessages,
    atCapacity: input.storedMessageCount >= maxMessages,
  };
}

// Moderation is the one chatroom write that is NOT best-effort. Every other call
// in this module reports a status so a storage outage costs the room its history
// rather than its conversation; a moderator who is told "hidden" when nothing was
// stored would be told the opposite of the truth about a message their class can
// still read. So these two throw, and the route answers 503.
export async function applyLearningChatroomMessageModeration(
  input: LearningChatroomTranscriptRuntimeDeps &
    LearningChatroomTranscriptRoomKey & {
      messageId: string;
      status: "hidden" | "visible";
      actorId: string;
      now: string;
    },
): Promise<LearningChatroomTranscriptModerationResult> {
  const { dataDir, repository } = resolveLearningChatroomTranscriptBackend(input);
  return setLearningChatroomTranscriptMessageModeration({
    dataDir,
    repository,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    studentId: input.studentId,
    messageId: input.messageId,
    status: input.status,
    actorId: input.actorId,
    now: input.now,
  });
}

export async function applyLearningChatroomRoomModeration(
  input: LearningChatroomTranscriptRuntimeDeps &
    LearningChatroomTranscriptRoomKey & {
      status: "frozen" | "open";
      actorId: string;
      now: string;
    },
): Promise<LearningChatroomTranscriptModerationResult> {
  const { dataDir, repository } = resolveLearningChatroomTranscriptBackend(input);
  return setLearningChatroomTranscriptRoomModeration({
    dataDir,
    repository,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    studentId: input.studentId,
    status: input.status,
    actorId: input.actorId,
    now: input.now,
  });
}

export async function appendLearningChatroomHistory(
  input: LearningChatroomTranscriptRuntimeDeps &
    LearningChatroomTranscriptRoomKey & {
      messages: Array<{
        messageId: string;
        role: "student" | "agent";
        content: string;
        agentId?: string;
        authorId?: string;
        authorName?: string;
        authorRole?: "student" | "teacher";
      }>;
      now: string;
      retryBudgetMs?: number;
      initialSnapshot?: LearningChatroomTranscriptWriteSnapshot;
      writerRole?: "student" | "teacher";
    },
): Promise<LearningChatroomTranscriptWriteResult> {
  if (input.messages.length === 0) {
    return { status: "persisted", appendedMessageCount: 0 };
  }

  try {
    const { dataDir, repository } = resolveLearningChatroomTranscriptBackend(input);
    if (
      input.initialSnapshot &&
      !isLearningChatroomTranscriptWriteSnapshotForRoom(input.initialSnapshot, input)
    ) {
      throw new LearningChatroomTranscriptStoreError(
        409,
        "Learning chatroom transcript room changed; fresh snapshot required.",
        "chatroom-room-mismatch",
      );
    }
    const receipt = await appendLearningChatroomTranscriptMessages({
      dataDir,
      repository,
      courseId: input.courseId,
      ...(input.classId ? { classId: input.classId } : {}),
      ...(input.groupId ? { groupId: input.groupId } : {}),
      studentId: input.studentId,
      messages: input.messages,
      now: input.now,
      ...(input.retryBudgetMs === undefined
        ? {}
        : { retryBudgetMs: input.retryBudgetMs }),
      ...(input.initialSnapshot ? { initialSnapshot: input.initialSnapshot.snapshot } : {}),
      ...(input.writerRole ? { writerRole: input.writerRole } : {}),
    });
    return {
      status: "persisted",
      appendedMessageCount: receipt.appendedMessageCount,
      messageCount: receipt.messageCount,
      storagePolicy: receipt.storagePolicy,
    };
  } catch (error) {
    reportLearningChatroomTranscriptError(input, "transcript-write", error);
    // These are control-flow outcomes, not an unavailable best-effort write.
    // Let the route preserve the freeze/conflict status so a provider failure
    // cannot fall through to a second append that silently reports success.
    if (
      error instanceof LearningChatroomTranscriptStoreError &&
      (error.status === 409 || error.status === 423)
    ) {
      throw error;
    }
    return { status: "unavailable" };
  }
}

function isLearningChatroomTranscriptWriteSnapshotForRoom(
  snapshot: LearningChatroomTranscriptWriteSnapshot,
  room: LearningChatroomTranscriptRoomKey,
) {
  return (
    snapshot.transcriptId === createLearningChatroomTranscriptId(room) &&
    snapshot.room.courseId === room.courseId &&
    (snapshot.room.classId ?? "") === (room.classId ?? "") &&
    (snapshot.room.groupId ?? "") === (room.groupId ?? "") &&
    snapshot.room.studentId === room.studentId
  );
}

// Message ids are minted server-side and echoed back to the client so the next
// round posts the same id and the append stays idempotent.
export function createLearningChatroomAgentMessageId(input: {
  nowMs: number;
  index: number;
  uniqueSuffix: string;
}) {
  return `agent-${input.nowMs}-${input.uniqueSuffix}-${input.index}`;
}

function resolveLearningChatroomTranscriptBackend(
  input: LearningChatroomTranscriptRuntimeDeps,
) {
  const repository =
    input.repository ??
    resolveLearningChatroomDurableBackend({
      env: input.env,
      createPostgresRepository: () =>
        createUaisLearningChatroomTranscriptPostgresRepository({ env: input.env }),
      createExternalRepository: () =>
        createUaisLearningChatroomTranscriptRepository({
          env: input.env,
          fetch: input.fetch,
        }),
    });
  if (!repository) {
    assertLearningChatroomTranscriptLocalJsonRuntimeAllowed(input.env);
  }

  return {
    dataDir: resolveLearningChatroomTranscriptDataDir(input.env),
    repository,
  };
}

// Reporting is delegated to the caller's logger so a transcript failure lands on
// the same redacted `[learning-chatroom]` line (and the same Sentry capture) as
// the round it belongs to, instead of being reported twice.
function reportLearningChatroomTranscriptError(
  input: LearningChatroomTranscriptRuntimeDeps,
  phase: "transcript-read" | "transcript-write",
  error: unknown,
) {
  input.onError?.({ phase, error });
}
