import { createUaisLearningChatroomTranscriptRepository } from "@/lib/server/learning-chatroom-transcript-external-store";
import {
  appendLearningChatroomTranscriptMessages,
  assertLearningChatroomTranscriptLocalJsonRuntimeAllowed,
  readLearningChatroomTranscript,
  resolveLearningChatroomTranscriptDataDir,
  type LearningChatroomTranscriptMessage,
  type LearningChatroomTranscriptRepository,
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
  messages: LearningChatroomTranscriptMessage[];
  storagePolicy?: LearningChatroomTranscriptStoragePolicy;
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
      storagePolicy: transcript.storagePolicy,
    };
  } catch (error) {
    reportLearningChatroomTranscriptError(input, "transcript-read", error);
    // An unreadable transcript degrades to the pre-persistence behaviour - an
    // empty room - instead of blocking the learner out of the chatroom.
    return { status: "unavailable", messages: [] };
  }
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
    createUaisLearningChatroomTranscriptRepository({
      env: input.env,
      fetch: input.fetch,
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
