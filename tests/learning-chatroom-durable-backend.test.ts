import { describe, expect, it } from "vitest";
import { selectLearningChatroomDurableBackend } from "@/lib/server/learning-chatroom-durable-backend";

// Closes blocker B2 at the code level. Chatroom stores refuse local JSON in a
// production runtime, and the only durable option used to be a separately
// operated external-storage service behind a base URL and a bearer token. A
// deployment that had done everything else right still answered 503 on the
// learner's first message.
//
// The managed Postgres is already a required part of the production surface, so
// it becomes the default. The case these assertions really guard is the one that
// used to fail: production + core database + no storage-specific configuration.

const coreDatabase = { UAIS_CORE_DATABASE_URL: "postgres://user:pass@db/uais" };
const production = { UAIS_DEPLOYMENT_ENV: "production" };

describe("learning chatroom durable backend selection", () => {
  it("uses Postgres in production when only the core database is configured", () => {
    // The blocker, gone: no UAIS_EXTERNAL_STORAGE_* at all.
    expect(selectLearningChatroomDurableBackend({ ...production, ...coreDatabase })).toBe(
      "postgres",
    );
  });

  it("honours an explicit selector over the default", () => {
    expect(
      selectLearningChatroomDurableBackend({
        ...production,
        ...coreDatabase,
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
      }),
    ).toBe("external");
    expect(
      selectLearningChatroomDurableBackend({
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres",
      }),
    ).toBe("postgres");
    expect(
      selectLearningChatroomDurableBackend({
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "managed",
      }),
    ).toBe("postgres");
  });

  it("leaves local development on the file store", () => {
    // No production markers: the local JSON store is correct and allowed here,
    // and a developer must not need a database to run the room.
    expect(selectLearningChatroomDurableBackend({})).toBe("local-json");
    expect(selectLearningChatroomDurableBackend({ ...coreDatabase })).toBe("local-json");
  });

  it("still refuses local JSON in production when nothing durable is configured", () => {
    // The default cannot invent durability: with no database and no external
    // storage, the caller's own guard must still refuse rather than write to a
    // filesystem that disappears between requests.
    expect(selectLearningChatroomDurableBackend({ ...production })).toBe("local-json");
  });

  it("treats every production marker the stores treat as production", () => {
    for (const marker of ["VERCEL_ENV", "NODE_ENV", "UAIS_DEPLOYMENT_ENV"]) {
      expect(
        selectLearningChatroomDurableBackend({ [marker]: "production", ...coreDatabase }),
      ).toBe("postgres");
    }
  });
});
