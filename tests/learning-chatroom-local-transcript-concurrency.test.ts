import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendLearningChatroomTranscriptMessages,
  readLearningChatroomTranscript,
  readLearningChatroomTranscriptSnapshot,
  setLearningChatroomTranscriptMessageModeration,
  setLearningChatroomTranscriptRoomModeration,
} from "@/lib/server/learning-chatroom-transcript-store";

const fileHooks = vi.hoisted(() => ({
  beforeWrite: undefined as (() => Promise<void>) | undefined,
  onMkdir: undefined as (() => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mocked = {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => { fileHooks.onMkdir?.(); return actual.mkdir(...args); },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => { await fileHooks.beforeWrite?.(); return actual.writeFile(...args); },
  };
  return { ...mocked, default: mocked };
});

const fixtureDirs: string[] = [];
const room = { courseId: "course-fixture", groupId: "group-fixture", studentId: "student-fixture" };
const now = "2026-09-30T12:00:00.000Z";
const message = (messageId: string) => ({ messageId, role: "student" as const, content: messageId, createdAt: now });

afterEach(async () => {
  fileHooks.beforeWrite = undefined;
  fileHooks.onMkdir = undefined;
  await Promise.all(fixtureDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-local-transcript-race-"));
  fixtureDirs.push(dataDir);
  await appendLearningChatroomTranscriptMessages({ dataDir, ...room, messages: [message("original")], now });
  return dataDir;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("local transcript concurrency", () => {
  it.each(["group-fixture", "another-group"])("preserves concurrent messages involving %s", async (groupId) => {
    const dataDir = await fixture();
    const paused = deferred();
    const release = deferred();
    fileHooks.beforeWrite = async () => {
      fileHooks.beforeWrite = undefined;
      paused.resolve();
      await release.promise;
    };
    const first = appendLearningChatroomTranscriptMessages({ dataDir, ...room, messages: [message("first")], now });
    await paused.promise;
    const secondEntered = deferred();
    fileHooks.onMkdir = () => { fileHooks.onMkdir = undefined; secondEntered.resolve(); };
    const second = appendLearningChatroomTranscriptMessages({ dataDir, ...room, groupId, messages: [message("second")], now });
    const results = Promise.all([first, second]);
    await secondEntered.promise;
    release.resolve();
    await results;

    expect((await readLearningChatroomTranscript({ dataDir, ...room })).messages.map((row) => row.messageId)).toContain("first");
    expect((await readLearningChatroomTranscript({ dataDir, ...room, groupId })).messages.map((row) => row.messageId)).toContain("second");
  });

  it("rechecks a freeze after a request hands in an earlier local snapshot", async () => {
    const dataDir = await fixture();
    const snapshot = await readLearningChatroomTranscriptSnapshot({ dataDir });
    await setLearningChatroomTranscriptRoomModeration({ dataDir, ...room, status: "frozen", actorId: "teacher-fixture", now });
    await expect(appendLearningChatroomTranscriptMessages({
      dataDir, ...room, initialSnapshot: snapshot, messages: [message("late-student")], now,
    })).rejects.toMatchObject({ status: 423, reasonCode: "chatroom-room-frozen" });
    const transcript = await readLearningChatroomTranscript({ dataDir, ...room });
    expect(transcript.moderation?.status).toBe("frozen");
    expect(transcript.messages.map((row) => row.messageId)).toEqual(["original"]);
  });

  it("keeps a hidden message hidden when a stale local request appends", async () => {
    const dataDir = await fixture();
    const snapshot = await readLearningChatroomTranscriptSnapshot({ dataDir });
    await setLearningChatroomTranscriptMessageModeration({ dataDir, ...room, messageId: "original", status: "hidden", actorId: "teacher-fixture", now });
    await appendLearningChatroomTranscriptMessages({
      dataDir, ...room, initialSnapshot: snapshot, messages: [message("late-student")], now,
    });
    const transcript = await readLearningChatroomTranscript({ dataDir, ...room });
    expect(transcript.hiddenMessageIds).toEqual(["original"]);
    expect(transcript.messages.map((row) => row.messageId)).toEqual(["late-student"]);
  });

  it("releases the local transcript lock after a failed write", async () => {
    const dataDir = await fixture();
    fileHooks.beforeWrite = async () => { fileHooks.beforeWrite = undefined; throw new Error("synthetic write failure"); };
    await expect(appendLearningChatroomTranscriptMessages({ dataDir, ...room, messages: [message("retry")], now })).rejects.toThrow("synthetic write failure");
    await appendLearningChatroomTranscriptMessages({ dataDir, ...room, messages: [message("retry")], now });
    expect((await readLearningChatroomTranscript({ dataDir, ...room })).messages.map((row) => row.messageId)).toEqual(["original", "retry"]);
  });

  it("waits for an in-flight freeze before authorizing a student append", async () => {
    const dataDir = await fixture();
    const paused = deferred();
    const release = deferred();
    fileHooks.beforeWrite = async () => {
      fileHooks.beforeWrite = undefined;
      paused.resolve();
      await release.promise;
    };
    const freeze = setLearningChatroomTranscriptRoomModeration({ dataDir, ...room, status: "frozen", actorId: "teacher-fixture", now });
    await paused.promise;
    const appendEntered = deferred();
    fileHooks.onMkdir = () => { fileHooks.onMkdir = undefined; appendEntered.resolve(); };
    const append = appendLearningChatroomTranscriptMessages({ dataDir, ...room, messages: [message("late-student")], now });
    const rejected = expect(append).rejects.toMatchObject({ status: 423, reasonCode: "chatroom-room-frozen" });
    await appendEntered.promise;
    release.resolve();
    await Promise.all([freeze, rejected]);
    const transcript = await readLearningChatroomTranscript({ dataDir, ...room });
    expect(transcript.moderation?.status).toBe("frozen");
    expect(transcript.messages.map((row) => row.messageId)).toEqual(["original"]);
  });
});
