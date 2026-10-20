import { afterEach, describe, expect, it, vi } from "vitest";
import { createLearningChatroomHistoryGetHandler as createLegacyHistory } from "@/app/api/learning/chatroom/handler";
import { createLearningChatroomHistoryGetHandler as createHistory } from "@/app/api/learning/chatroom/history/handler";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const env = {
  NODE_ENV: "test",
  UAIS_APP_SESSION_SIGNING_SECRET: "synthetic-chatroom-actor-isolation-secret",
  UAIS_LEARNING_CHATROOM_GROUPS_MODE: "off",
  UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_MINUTE: "1",
};

function request(account: string) {
  return new Request("https://example.test/api/learning/chatroom/history?courseId=course-a&groupId=group-a", {
    headers: {
      cookie: createUaisAppSessionCookie({
        account, role: "student", displayName: "Synthetic learner", department: "Synthetic",
      }, { env }),
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe.each([
  ["dedicated history", createHistory],
  ["legacy history", createLegacyHistory],
] as const)("%s account rate-limit isolation", (_name, createHandler) => {
  it("keeps distinct valid long accounts in separate request budgets", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handler = createHandler({ env, now: () => 1_000_000 });
    const first = `${"a".repeat(72)}x`;
    const second = `${"a".repeat(72)}y`;
    // Disabled groups stop before any storage/provider access, after the
    // authenticated per-account limiter. Each account gets its own first read.
    expect((await handler(request(first))).status).toBe(403);
    expect((await handler(request(second))).status).toBe(403);
    expect((await handler(request(first))).status).toBe(429);
    expect((await handler(request(second))).status).toBe(429);
  });

  it("shares the budget across case spellings of the same account", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handler = createHandler({ env, now: () => 1_000_000 });
    expect((await handler(request("student-case"))).status).toBe(403);
    expect((await handler(request("STUDENT-CASE"))).status).toBe(429);
  });
});
