import { createUaisLearningChatroomTranscriptRepository } from "@/lib/server/learning-chatroom-transcript-external-store";
import { createUaisLearningChatroomTranscriptPostgresRepository } from "@/lib/server/learning-chatroom-transcript-postgres-store";
import { resolveLearningChatroomDurableBackend } from "@/lib/server/learning-chatroom-durable-backend";
import {
  appendLearningChatroomTranscriptMessages,
  assertLearningChatroomTranscriptLocalJsonRuntimeAllowed,
  readLearningChatroomTranscript,
  resolveLearningChatroomTranscriptDataDir,
  resolveLearningChatroomTranscriptMaxMessages,
  setLearningChatroomTranscriptMessageModeration,
  setLearningChatroomTranscriptRoomModeration,
  type LearningChatroomTranscriptMessage,
  type LearningChatroomTranscriptModerationResult,
  type LearningChatroomTranscriptRepository,
  type LearningChatroomTranscriptRoomModeration,
  type LearningChatroomTranscriptStoragePolicy,
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
    },
): Promise<LearningChatroomTranscriptWriteResult> {
  if (input.messages.length === 0) {
    return { status: "persisted", appendedMessageCount: 0 };
  }

  try {
    const { dataDir, repository } = resolveLearningChatroomTranscriptBackend(input);
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
    });
    return {
      status: "persisted",
      appendedMessageCount: receipt.appendedMessageCount,
      messageCount: receipt.messageCount,
      storagePolicy: receipt.storagePolicy,
    };
  } catch (error) {
    reportLearningChatroomTranscriptError(input, "transcript-write", error);
    return { status: "unavailable" };
  }
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
