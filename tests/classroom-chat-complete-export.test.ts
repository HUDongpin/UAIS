import { describe, expect, it, vi } from "vitest";
import {
  readLearningChatroomHistory,
  readLearningChatroomTranscriptWriteSnapshot,
} from "@/lib/server/learning-chatroom-transcript-runtime";
import {
  createEmptyLearningChatroomTranscriptDatabase,
  type LearningChatroomTranscriptRepository,
} from "@/lib/server/learning-chatroom-transcript-store";
import { createChatroomTranscriptPdfMetaLines } from "@/lib/server/learning-chatroom-transcript-pdf";

describe("complete authenticated chat export source", () => {
  it("refuses a closed course before constructing a new provider round", async () => {
    const read = vi.fn(async () => ({
      database: createEmptyLearningChatroomTranscriptDatabase(),
    }));
    const repository: LearningChatroomTranscriptRepository = {
      storage: {
        transcriptStoragePolicy: "postgres-learning-chatroom-transcripts",
        storageWritePolicy: "postgres-transactional-snapshot-replace",
      },
      read,
      write: async () => {},
      readCourseRecordState: async () => "closed",
    };
    await expect(
      readLearningChatroomTranscriptWriteSnapshot({
        env: {},
        repository,
        courseId: "closed-course",
        studentId: "student",
      }),
    ).rejects.toMatchObject({
      status: 423,
      reasonCode: "course-records-closed",
    });
    expect(read).not.toHaveBeenCalled();
  });
  it("discloses the archive start boundary in the saved PDF", () => {
    const lines = createChatroomTranscriptPdfMetaLines(
      {
        locale: "en-US",
        memberNames: [],
        messages: [],
        messageCount: 0,
        transcriptStatus: "loaded",
        windowAtCapacity: false,
        archiveAvailable: true,
      },
      {
        title: "Discussion",
        courseLabel: "Course",
        groupLabel: "Group",
        membersLabel: "Members",
        dateRangeLabel: "Dates",
        messageCountLabel: "Messages",
        agentTag: "AI",
        unavailableNotice: "Unavailable",
        windowTrimmedNotice: "Recent window only",
        archiveBoundaryNotice:
          "Archive starts at activation; older removed messages cannot be recovered.",
      },
    );
    expect(lines).toContain(
      "Archive starts at activation; older removed messages cannot be recovered.",
    );
  });
  it("reads all archive pages and filters hidden evidence instead of exporting only the live window", async () => {
    const messages = Array.from({ length: 601 }, (_, index) => ({
      messageId: `m-${index}`,
      role: "student" as const,
      content: `Evidence ${index}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...(index === 5
        ? {
            moderation: {
              status: "hidden" as const,
              actorId: "teacher",
              actedAt: "2026-01-02T00:00:00.000Z",
            },
          }
        : {}),
    }));
    const readArchive = vi.fn(async ({ before }: { before?: string }) =>
      before
        ? { messages: messages.slice(0, 101) }
        : { messages: messages.slice(101), nextCursor: "m-101" },
    );
    const repository: LearningChatroomTranscriptRepository = {
      storage: {
        transcriptStoragePolicy: "postgres-learning-chatroom-transcripts",
        storageWritePolicy: "postgres-transactional-snapshot-replace",
      },
      read: async () => ({
        database: createEmptyLearningChatroomTranscriptDatabase(),
      }),
      write: async () => {},
      readArchive,
    };
    const result = await readLearningChatroomHistory({
      env: {},
      repository,
      courseId: "course",
      studentId: "student",
      fullArchive: true,
    });
    expect(result.status).toBe("loaded");
    expect(result.messages).toHaveLength(600);
    expect(result.messages[0].messageId).toBe("m-0");
    expect(result.messages.at(-1)?.messageId).toBe("m-600");
    expect(result.messages.some((message) => message.messageId === "m-5")).toBe(
      false,
    );
    expect(result.window.atCapacity).toBe(false);
    expect(readArchive).toHaveBeenCalledTimes(2);
  });
});
