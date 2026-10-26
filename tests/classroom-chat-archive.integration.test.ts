import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUaisLearningChatroomTranscriptPostgresRepository } from "@/lib/server/learning-chatroom-transcript-postgres-store";
import {
  appendLearningChatroomTranscriptMessages,
  createLearningChatroomTranscriptId,
  setLearningChatroomTranscriptMessageModeration,
} from "@/lib/server/learning-chatroom-transcript-store";
import { resetUaisCoreDatabasePoolForTesting } from "@/lib/db/core-database";

const target = process.env.UAIS_CLASSROOM_CHAT_TEST_DATABASE_URL;
const runId = randomUUID();
const courseId = `classroom-archive-${runId}`;
const room = {
  courseId,
  classId: `class-${runId}`,
  groupId: `group-${runId}`,
  studentId: "archive-test-student",
};

describe.skipIf(!target)("isolated classroom chat archive", () => {
  const configuredTarget = target ?? "postgres://unused@127.0.0.1:1/skipped";
  const url = new URL(configuredTarget);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error(
      "classroom tests require an explicitly configured loopback database",
    );
  const sql = postgres(configuredTarget, { max: 2, prepare: false });
  const repository = createUaisLearningChatroomTranscriptPostgresRepository({
    env: { UAIS_CORE_DATABASE_URL: configuredTarget },
  });
  const transcriptId = createLearningChatroomTranscriptId(room);
  beforeAll(async () => {
    const guard =
      await sql`SELECT environment FROM uais_environment_guard WHERE environment = 'isolated-uais-db-test' AND enabled = true`;
    expect(guard).toHaveLength(1);
  });
  afterAll(async () => {
    if (
      (
        await sql`SELECT to_regclass('uais_learning_chatroom_messages') AS relation`
      )[0]?.relation
    ) {
      await sql`DELETE FROM uais_learning_chatroom_messages WHERE course_external_id = ${courseId}`;
    }
    await sql`DELETE FROM uais_learning_chatroom_transcript_snapshots WHERE snapshot_key = ${transcriptId}`;
    await resetUaisCoreDatabasePoolForTesting();
    await sql.end();
  });

  it("keeps all 600 messages durably while retaining a 500-message live window", async () => {
    await appendLearningChatroomTranscriptMessages({
      ...room,
      repository,
      messages: Array.from({ length: 600 }, (_, index) => ({
        messageId: `message-${index}`,
        role: "student" as const,
        content: `Evidence ${index}`,
        authorId: room.studentId,
        authorName: "Test Student",
        authorRole: "student" as const,
      })),
    });
    const latest = await repository.read({ transcriptId });
    expect(latest.database.transcripts[0].messages).toHaveLength(500);
    expect(
      repository.readArchive,
      "durable archive can be read separately from the rolling window",
    ).toBeTypeOf("function");
    const page = await repository.readArchive!({ transcriptId, limit: 500 });
    expect(page.messages).toHaveLength(500);
    expect(page.nextCursor).toBeTruthy();
    const older = await repository.readArchive!({
      transcriptId,
      before: page.nextCursor,
      limit: 500,
    });
    expect(older.messages).toHaveLength(100);
    expect(older.messages[0].messageId).toBe("message-0");
    expect(older.nextCursor).toBeUndefined();
  });

  it("does not revive a message older than the live window on a delayed resend", async () => {
    await appendLearningChatroomTranscriptMessages({
      ...room,
      repository,
      messages: [
        {
          messageId: "message-0",
          role: "student",
          content: "Replayed altered content",
        },
      ],
    });
    const [count] =
      await sql`SELECT count(*)::integer AS count FROM uais_learning_chatroom_messages WHERE transcript_id = ${transcriptId}`;
    expect(count.count).toBe(600);
    const latest = await repository.read({ transcriptId });
    expect(latest.database.transcripts[0].messages[0].messageId).toBe(
      "message-100",
    );
    const original =
      await sql`SELECT message->>'content' AS content FROM uais_learning_chatroom_messages WHERE transcript_id = ${transcriptId} AND message_id = 'message-0'`;
    expect(original[0].content).toBe("Evidence 0");
  });

  it("moderates an archived message and retains that decision on replay", async () => {
    const result = await setLearningChatroomTranscriptMessageModeration({
      ...room,
      repository,
      messageId: "message-0",
      status: "hidden",
      actorId: "archive-test-teacher",
    });
    expect(result.status).toBe("applied");
    const page = await repository.readArchive!({
      transcriptId,
      before: "message-100",
      limit: 500,
    });
    expect(
      page.messages.find((message) => message.messageId === "message-0")
        ?.moderation?.status,
    ).toBe("hidden");
    await appendLearningChatroomTranscriptMessages({
      ...room,
      repository,
      messages: [
        { messageId: "message-0", role: "student", content: "Evidence 0" },
      ],
    });
    const repeated = await repository.readArchive!({
      transcriptId,
      before: "message-100",
      limit: 500,
    });
    expect(
      repeated.messages.find((message) => message.messageId === "message-0")
        ?.moderation?.status,
    ).toBe("hidden");
  });

  it("rolls back the live snapshot if the archive write fails in the same transaction", async () => {
    const before = await repository.read({ transcriptId });
    type Query = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown[]>;
    const execute = ((strings: TemplateStringsArray, ...values: unknown[]) =>
      (sql as unknown as Query)(strings, ...values)) as Query & {
      begin: (run: (tx: never) => Promise<void>) => Promise<void>;
      end: () => Promise<void>;
    };
    execute.begin = async (run) => {
      await sql.begin(async (tx) => {
        const intercepted: Query = async (strings, ...values) => {
          if (
            strings
              .join("")
              .includes("INSERT INTO uais_learning_chatroom_messages")
          )
            throw new Error("simulated-archive-write-failure");
          return (tx as unknown as Query)(strings, ...values);
        };
        await run(intercepted as never);
      });
    };
    execute.end = async () => {};
    const failing = createUaisLearningChatroomTranscriptPostgresRepository({
      env: { UAIS_CORE_DATABASE_URL: configuredTarget },
      createDatabase: () => ({ sql: execute }),
    });
    await expect(
      appendLearningChatroomTranscriptMessages({
        ...room,
        repository: failing,
        messages: [
          {
            messageId: "rollback-message",
            role: "student",
            content: "Must not claim delivery",
          },
        ],
      }),
    ).rejects.toThrow("simulated-archive-write-failure");
    const after = await repository.read({ transcriptId });
    expect(after.revision).toBe(before.revision);
    expect(after.database).toEqual(before.database);
    expect(
      await sql`SELECT id FROM uais_learning_chatroom_messages WHERE transcript_id=${transcriptId} AND message_id='rollback-message'`,
    ).toHaveLength(0);
  });
});
