import { expect, it } from "vitest";
import {
  createUaisLearningLoopPostgresStore,
  type LearningLoopPostgresClientFactory,
} from "@/lib/learning-loop/postgres-store";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const activityId = "abcdefab-1234-4567-89ab-abcdefabcdef";

it.each([activityId, activityId.toUpperCase(), `{${activityId}}`])(
  "returns a recoverable first-draft conflict for equivalent activity UUID %s", async (secondActivityId) => {
  const firstRead = deferred();
  const releaseFirstRead = deferred();
  const secondTransaction = deferred();
  const locks = new Map<string, Promise<void>>();
  let transactions = 0;
  let reads = 0;
  let submission: Record<string, unknown> | undefined;
  let inserts = 0;

  // Model the database's unique assessment/user constraint and transaction locks.
  // The first SELECT is paused so both tabs observe absence without serialization.
  const createDatabase = (() => {
    const releases: Array<() => void> = [];
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("FROM uais_users")) return [{ id: "student-id" }];
      if (text.includes("pg_advisory_xact_lock")) {
        const key = text.includes("::uuid::text")
          ? `submission-draft:${String(values[0]).replace(/[{}]/g, "").toLowerCase()}:${values[1]}`
          : String(values[0]);
        const previous = locks.get(key) ?? Promise.resolve();
        const released = deferred();
        locks.set(key, previous.then(() => released.promise));
        releases.push(released.resolve);
        await previous;
      }
      if (text.includes("FROM uais_assessments")) return [{ id: "activity-id" }];
      if (text.includes("FROM uais_formative_attempts")) return [{ count: 1 }];
      if (text.includes("FROM uais_submissions s")) {
        const snapshot = submission ? [{ ...submission }] : [];
        if (++reads === 1) {
          firstRead.resolve();
          await releaseFirstRead.promise;
        }
        return snapshot;
      }
      if (text.includes("INSERT INTO uais_submissions")) {
        if (submission) throw Object.assign(new Error("duplicate assessment/user"), { code: "23505" });
        inserts += 1;
        submission = { id: values[0], state: "draft", current_version_no: 1 };
      }
      if (text.includes("INSERT INTO uais_submission_versions")) {
        Object.assign(submission!, { version_id: values[0], draft_revision: 1, content_text: values[2] });
      }
      if (text.includes("UPDATE uais_submission_versions")) {
        Object.assign(submission!, { draft_revision: values[2], content_text: values[0] });
      }
      return [];
    };
    sql.begin = async (run: (tx: typeof sql) => Promise<void>) => {
      if (++transactions === 2) secondTransaction.resolve();
      try { await run(sql); } finally { releases.forEach((release) => release()); }
    };
    sql.end = () => {};
    return { sql };
  }) as LearningLoopPostgresClientFactory;
  const store = createUaisLearningLoopPostgresStore({
    env: { DATABASE_URL: "postgres://test:test@localhost:5432/uais_test" },
    createDatabase,
  });
  const save = (contentText: string, expectedDraftRevision = 0, selectedActivityId = activityId) => store.saveSubmissionDraft({
    studentAccount: "student", activityId: selectedActivityId, classExternalId: "class-1",
    contentText, expectedDraftRevision, expectedSubmissionVersionId: expectedDraftRevision === 0 ? null : String(submission?.version_id), traceId: "synthetic-draft-race",
  });
  const first = save("first tab text");
  await firstRead.promise;
  const second = save("second tab text", 0, secondActivityId);
  const outcomes = Promise.allSettled([first, second]);
  await secondTransaction.promise;
  releaseFirstRead.resolve();
  const results = await outcomes;
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    status: "rejected",
    reason: {
      status: 409, reasonCode: "stale-submission-version",
      details: { latestRevision: 1, latestContent: "first tab text" },
    },
  });
  expect(inserts).toBe(1);
  expect(submission?.content_text).toBe("first tab text");
  await expect(save("merged text", 1)).resolves.toMatchObject({ revision: 2 });
  expect(submission?.content_text).toBe("merged text");
});
