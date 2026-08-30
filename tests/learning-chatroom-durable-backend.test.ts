import { describe, expect, it } from "vitest";
import {
  resolveLearningChatroomDurableBackend,
  selectLearningChatroomDurableBackend,
} from "@/lib/server/learning-chatroom-durable-backend";
import {
  uaisStagingLocalJsonDisallowedReasonCode,
} from "@/lib/server/uais-durable-snapshot-backend";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";

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

function resolveBackend(env: Record<string, string | undefined>) {
  return resolveLearningChatroomDurableBackend({
    env,
    createPostgresRepository: () => "postgres",
    createExternalRepository: () => "external",
  });
}

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

  it("fails closed before resolving local JSON for staging without a durable selector", () => {
    expect(() => resolveBackend({ UAIS_DEPLOYMENT_ENV: "staging" })).toThrowError(
      expect.objectContaining({
        name: "UaisDurableSnapshotBackendError",
        reasonCode: uaisStagingLocalJsonDisallowedReasonCode,
        status: 503,
      }),
    );
  });

  it("fails closed for a Vercel preview staging runtime without a core database", () => {
    expect(() => resolveBackend({ VERCEL_ENV: "preview" })).toThrowError(
      expect.objectContaining({
        name: "UaisDurableSnapshotBackendError",
        reasonCode: uaisStagingLocalJsonDisallowedReasonCode,
        status: 503,
      }),
    );
  });

  it("keeps local JSON available for unmarked local development", () => {
    expect(resolveBackend({})).toBeUndefined();
  });

  it("does not alter explicit durable backend selection in staging", () => {
    expect(resolveBackend({
      UAIS_DEPLOYMENT_ENV: "staging",
      UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres",
    })).toBe("postgres");
    expect(resolveBackend({
      VERCEL_ENV: "preview",
      UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
    })).toBe("external");
  });

  it("treats every production marker the stores treat as production", () => {
    for (const marker of ["VERCEL_ENV", "NODE_ENV", "UAIS_DEPLOYMENT_ENV"]) {
      expect(
        selectLearningChatroomDurableBackend({ [marker]: "production", ...coreDatabase }),
      ).toBe("postgres");
    }
  });
});

// The course-management store used to require the selector to be set explicitly
// while the chatroom had already gained the production auto-default above. An
// unset selector therefore split the deployment in half: durable chatroom,
// local-JSON course management - which production refuses - so the student
// course list, invite join, approvals and groups all answered 503 while the
// readiness script reported the same configuration as ready.
describe("teaching course management backend selection", () => {
  it("resolves to Postgres in production when only the core database is configured", () => {
    const repository = createUaisTeachingCourseManagementRepository({
      env: { ...production, ...coreDatabase },
    });

    expect(repository?.storage).toMatchObject({
      recordStoragePolicy: "postgres-teaching-course-management-snapshot",
      storageWritePolicy: "postgres-transactional-snapshot-replace",
    });
  });

  it("still leaves local development on the file store", () => {
    expect(createUaisTeachingCourseManagementRepository({ env: {} })).toBeUndefined();
    expect(
      createUaisTeachingCourseManagementRepository({ env: { ...coreDatabase } }),
    ).toBeUndefined();
  });

  it("agrees with the chatroom stores on every environment", () => {
    // The property that keeps the two from drifting apart again: whatever the
    // chatroom resolves to, course management resolves to as well. A selector
    // that names Postgres without a database URL is counted as "postgres" on
    // both sides - both fail closed with the same 503 rather than one of them
    // quietly falling back to a different backend.
    function describeCourseManagement(env: Record<string, string | undefined>) {
      try {
        const repository = createUaisTeachingCourseManagementRepository({ env });
        if (!repository) {
          return "local-json";
        }
        return repository.storage.recordStoragePolicy ===
          "postgres-teaching-course-management-snapshot"
          ? "postgres"
          : "external";
      } catch (error) {
        return (error as Error).message.includes("UAIS_CORE_DATABASE_URL")
          ? "postgres"
          : "external";
      }
    }

    for (const env of [
      {},
      { ...coreDatabase },
      { ...production },
      { ...production, ...coreDatabase },
      { ...production, ...coreDatabase, UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres" },
      { UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "managed" },
    ]) {
      expect({ env, backend: describeCourseManagement(env) }).toEqual({
        env,
        backend: selectLearningChatroomDurableBackend(env),
      });
    }
  });
});
