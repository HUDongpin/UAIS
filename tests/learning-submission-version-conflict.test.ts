import { expect, it } from "vitest";
import {
  createUaisLearningLoopPostgresStore,
  type LearningLoopPostgresClientFactory,
} from "@/lib/learning-loop/postgres-store";

function fixture(state: "draft" | "revision_requested" | "absent" = "draft") {
  const latest = {
    id: "submission-id", submission_id: "submission-id", state,
    current_version_no: 2, version_id: "version-two", version_status: state === "draft" ? "draft" : "sealed",
    draft_revision: 1, content_text: "new v2 work incorporating teacher feedback",
    activity_id: "activity-id", lesson_id: "lesson-id", lesson_key: "lesson-1",
    course_id: "course-id", class_id: "class-id", checkpoint_attempts: 1,
  };
  const writes: Array<{ text: string; values: unknown[] }> = [];
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("AS course_slug")) return [{ course_slug: "course-1" }];
    if (text.includes("FROM uais_users")) return [{ id: "student-id" }];
    if (text.includes("FROM uais_idempotency_records")) return [];
    if (text.includes("FROM uais_assessments")) return [{ id: "activity-id" }];
    if (text.includes("FROM uais_submissions s")) return state === "absent" ? [] : [{ ...latest }];
    if (text.includes("FROM uais_formative_attempts")) return [{ count: 1 }];
    if (text.includes("UPDATE uais_submission_versions")) {
      writes.push({ text, values });
      if (text.includes("content_text =")) {
        latest.content_text = String(values[0]);
        latest.draft_revision = Number(values[2]);
      }
      if (text.includes("status = 'sealed'")) latest.version_status = "sealed";
    }
    if (text.includes("INSERT INTO uais_submission_versions")) writes.push({ text, values });
    if (text.includes("INSERT INTO uais_learner_profiles")) return [{ projection_version: 1 }];
    return [];
  };
  sql.begin = async (run: (tx: typeof sql) => Promise<void>) => run(sql);
  sql.end = () => {};
  const store = createUaisLearningLoopPostgresStore({
    env: { UAIS_CORE_DATABASE_URL: "postgres://synthetic:synthetic@example.test/never-connected" },
    createDatabase: (() => ({ sql })) as LearningLoopPostgresClientFactory,
    createId: () => "created-version",
  });
  return { store, latest, writes };
}

const command = {
  studentAccount: "student", activityId: "activity-id", classExternalId: "class-1",
  expectedDraftRevision: 1, expectedSubmissionVersionId: "version-one", traceId: "version-conflict-test",
};

it("rejects an old version's save even when its revision matches the new version", async () => {
  const { store, latest, writes } = fixture();
  await expect(store.saveSubmissionDraft({ ...command, contentText: "stale v1 text" })).rejects.toMatchObject({
    status: 409, reasonCode: "stale-submission-version",
    details: { latestSubmissionVersionId: "version-two", latestRevision: 1, latestContent: latest.content_text },
  });
  expect(latest.content_text).toBe("new v2 work incorporating teacher feedback");
  expect(writes).toHaveLength(0);
});

it("rejects an old version's submit even when its revision matches the new version", async () => {
  const { store, latest, writes } = fixture();
  await expect(store.submitSubmission({ ...command, idempotencyKey: "stale-v1-submit" })).rejects.toMatchObject({
    status: 409, reasonCode: "stale-submission-version",
    details: { latestSubmissionVersionId: "version-two", latestContent: latest.content_text },
  });
  expect(latest.version_status).toBe("draft");
  expect(writes).toHaveLength(0);
});

it("does not let an old first-save request overwrite an existing version", async () => {
  const { store, writes } = fixture();
  await expect(store.saveSubmissionDraft({ ...command, expectedSubmissionVersionId: null, expectedDraftRevision: 0, contentText: "old first save" })).rejects.toMatchObject({ status: 409 });
  expect(writes).toHaveLength(0);
});

it("returns the created version identity on a first save and a revision-requested save", async () => {
  for (const state of ["absent", "revision_requested"] as const) {
    const { store } = fixture(state);
    await expect(store.saveSubmissionDraft({
      ...command, expectedSubmissionVersionId: state === "absent" ? null : "version-two",
      expectedDraftRevision: 0, contentText: "new revision text",
    })).resolves.toMatchObject({ state: "draft", revision: 1, submissionVersionId: "created-version" });
  }
});

it("saves and submits the exact loaded current version", async () => {
  const { store, latest } = fixture();
  await expect(store.saveSubmissionDraft({ ...command, expectedSubmissionVersionId: "version-two", contentText: "current work" })).resolves.toMatchObject({ revision: 2, submissionVersionId: "version-two" });
  await expect(store.submitSubmission({ ...command, expectedSubmissionVersionId: "version-two", expectedDraftRevision: 2, idempotencyKey: "current-v2-submit" })).resolves.toMatchObject({ state: "resubmitted" });
  expect(latest.version_status).toBe("sealed");
});

it("rejects legacy callers that omit the version field", async () => {
  const { store, writes } = fixture();
  const legacy = { ...command, expectedSubmissionVersionId: undefined };
  // Simulate an older JavaScript caller, outside the typed contract.
  await expect(store.saveSubmissionDraft({ ...legacy, contentText: "old client" } as unknown as Parameters<typeof store.saveSubmissionDraft>[0])).rejects.toMatchObject({ status: 400, reasonCode: "submission-version-required" });
  await expect(store.submitSubmission({ ...legacy, idempotencyKey: "legacy-submit" } as unknown as Parameters<typeof store.submitSubmission>[0])).rejects.toMatchObject({ status: 400, reasonCode: "submission-version-required" });
  expect(writes).toHaveLength(0);
});
