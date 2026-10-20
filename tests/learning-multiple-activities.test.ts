import { describe, expect, it, vi } from "vitest";
import { createLearningUnitGetHandler } from "./helpers/learning-loop-route-factories";
import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import { LearningLoopStoreError, type LearningLoopPostgresClientFactory } from "@/lib/learning-loop/postgres-store";
import { recommendNextLearningAction } from "@/lib/learning-loop/recommendation";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const studentId = "33333333-3333-4333-8333-333333333333";
const unknownId = "99999999-9999-4999-8999-999999999999";
const studentAccess = {
  status: "authorized" as const,
  reasonCode: "student-course-membership-approved" as const,
  studentAccount: "student-1",
  courseId: "course-1",
  classId: "class-1",
};

function evidence(activityId: string) {
  return { activityId, lessonKey: "lesson-1", position: 1, checkpointAttempted: true };
}

function createStore() {
  const activityRows = [firstId, secondId].map((id) => ({
    activity_id: id,
    activity_version: 1,
    activity_status: "published",
    title_i18n: { "zh-CN": id, "en-US": id },
    instructions_i18n: {},
    rubric: [],
    formative_check: { kind: "short-answer", prompt: {} },
    due_at: null,
    ai_policy: "teacher-requested-draft",
    lesson_id: "44444444-4444-4444-8444-444444444444",
    lesson_key: "lesson-1",
    lesson_position: 1,
    lesson_title: "Lesson one",
    course_id: "55555555-5555-4555-8555-555555555555",
    course_external_id: "course-1",
    class_id: "66666666-6666-4666-8666-666666666666",
    class_external_id: "class-1",
  }));
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    queries.push({ text, values });
    if (text.includes("FROM uais_users")) return [{ id: studentId }];
    if (text.includes("WITH authorized_scope")) {
      return activityRows.map((row, index) => ({
        ...row,
        checkpoint_attempted: true,
        submission_state: index === 0 ? "accepted" : "revision_requested",
        updated_at: "2026-09-30T10:00:00.000Z",
        projection_version: 1,
      }));
    }
    if (text.includes("FROM uais_assessments a")) {
      expect(text).toContain("c.slug =");
      expect(text).toContain("cl.external_key =");
      expect(text).toContain("l.external_key =");
      expect(text).toContain("a.status = 'published'");
      expect(text).toContain("a.status = 'archived'");
      expect(text).toContain("existing_submission.user_id =");
      const selected = values.find((value) =>
        typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) && value !== studentId,
      );
      return activityRows.filter((row) =>
        (!selected || row.activity_id === selected) &&
        values.includes(row.course_external_id) &&
        values.includes(row.class_external_id) &&
        values.includes(row.lesson_key),
      ).slice(0, 1);
    }
    if (text.includes("FROM uais_formative_attempts")) return [{ count: 0 }];
    return [];
  };
  sql.begin = async (run: (tx: typeof sql) => Promise<void>) => run(sql);
  sql.end = async () => undefined;
  return {
    queries,
    store: createUaisLearningLoopPostgresReadStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://fixture@127.0.0.1:1/unused_synthetic_review" },
      createDatabase: (() => ({ sql })) as unknown as LearningLoopPostgresClientFactory,
    }),
  };
}

describe("multiple learning activities in one lesson", () => {
  it("recommends the exact revision activity after a different activity is accepted", () => {
    expect(recommendNextLearningAction({ units: [
      { ...evidence(firstId), submissionState: "accepted" },
      { ...evidence(secondId), submissionState: "revision_requested" },
    ] })).toMatchObject({ type: "revise-submission", lessonKey: "lesson-1", activityId: secondId });
  });

  it("breaks equal-priority ties by activity id instead of input order", () => {
    const units = [evidence(secondId), evidence(firstId)];
    expect(recommendNextLearningAction({ units })).toEqual(recommendNextLearningAction({ units: [...units].reverse() }));
    expect(recommendNextLearningAction({ units })).toMatchObject({ type: "start-submission", activityId: firstId });
  });

  it.each([
    [evidence(firstId), evidence(firstId)],
    [evidence(firstId), { ...evidence(secondId), lessonKey: "other-lesson" }],
    [evidence(firstId), { lessonKey: "lesson-1", position: 1, checkpointAttempted: true }],
    [evidence(firstId), { ...evidence(firstId), lessonKey: "lesson-2", position: 2 }],
  ])("rejects ambiguous or duplicate activity evidence %#", (...units) => {
    expect(recommendNextLearningAction({ units })).toMatchObject({ type: "collect-more-evidence", reasonCode: "evidence-inconsistent" });
  });

  it("retains legacy single-activity evidence without an activity id", () => {
    expect(recommendNextLearningAction({ units: [{ lessonKey: "lesson-1", position: 1, checkpointAttempted: false }] })).toEqual({
      type: "complete-checkpoint", lessonKey: "lesson-1", reasonCode: "checkpoint-not-attempted",
    });
  });

  it("passes each dashboard row's activity identity to recommendations", async () => {
    const { store } = createStore();
    const result = await store.readStudentDashboard({
      studentAccount: "student-1",
      scopes: [{ courseId: "course-1", courseTitle: "Course", classId: "class-1" }],
    });
    expect(result.courses[0].units).toHaveLength(2);
    expect(result.courses[0].nextAction).toMatchObject({ type: "revise-submission", activityId: secondId });
    expect(result.nextAction).toMatchObject({ type: "revise-submission", activityId: secondId });
  });

  it("reads the selected activity instead of the default activity in the lesson", async () => {
    const { store } = createStore();
    const input = { studentAccount: "student-1", courseExternalId: "course-1", classExternalId: "class-1", lessonKey: "lesson-1", activityId: secondId };
    const result = await store.readStudentUnit(input);
    expect(result.activity.id).toBe(secondId);
  });

  it.each([
    { activityId: unknownId, courseExternalId: "course-1", classExternalId: "class-1", lessonKey: "lesson-1" },
    { activityId: secondId, courseExternalId: "other-course", classExternalId: "class-1", lessonKey: "lesson-1" },
    { activityId: secondId, courseExternalId: "course-1", classExternalId: "other-class", lessonKey: "lesson-1" },
    { activityId: secondId, courseExternalId: "course-1", classExternalId: "class-1", lessonKey: "other-lesson" },
  ])("does not fall back when explicit selection is outside the requested scope %#", async (scope) => {
    const { store } = createStore();
    await expect(store.readStudentUnit({ studentAccount: "student-1", ...scope })).rejects.toMatchObject({ status: 404 });
  });

  it("forwards an explicit activity selection through the existing authorized unit route", async () => {
    const readStudentUnit = vi.fn(async () => ({ activity: { id: secondId } }));
    const handler = createLearningUnitGetHandler({ env: {}, authorize: async () => studentAccess, readStudentUnit });
    const response = await handler(new Request(`https://uais.test/api/learning/courses/course-1/units/lesson-1?activityId=${secondId}`), {
      params: Promise.resolve({ courseId: "course-1", lessonKey: "lesson-1" }),
    });
    expect(response.status).toBe(200);
    expect(readStudentUnit).toHaveBeenCalledWith({ studentAccount: "student-1", courseExternalId: "course-1", classExternalId: "class-1", lessonKey: "lesson-1", activityId: secondId });
  });

  it.each(["not-a-uuid", ""])("rejects malformed explicit activity selection %j before readback", async (activityId) => {
    const readStudentUnit = vi.fn(async () => ({ activity: { id: firstId } }));
    const handler = createLearningUnitGetHandler({ env: {}, authorize: async () => studentAccess, readStudentUnit });
    const response = await handler(new Request(`https://uais.test/api/learning/courses/course-1/units/lesson-1?activityId=${activityId}`), {
      params: Promise.resolve({ courseId: "course-1", lessonKey: "lesson-1" }),
    });
    expect(response.status).toBe(400);
    expect(readStudentUnit).not.toHaveBeenCalled();
  });

  it("preserves selected-activity 404 rather than silently choosing a default", async () => {
    const handler = createLearningUnitGetHandler({ env: {}, authorize: async () => studentAccess, readStudentUnit: async () => { throw new LearningLoopStoreError(404, "published-learning-unit-required"); } });
    const response = await handler(new Request(`https://uais.test/api/learning/courses/course-1/units/lesson-1?activityId=${unknownId}`), {
      params: Promise.resolve({ courseId: "course-1", lessonKey: "lesson-1" }),
    });
    expect(response.status).toBe(404);
  });
});
