import { expect, it } from "vitest";
import { PATCH } from "@/app/api/teaching/activities/[activityId]/route";
import { createUaisLearningLoopPostgresStore, type LearningLoopPostgresClientFactory } from "@/lib/learning-loop/postgres-store";

it("returns a recoverable conflict when a second tab creates the same next version", async () => {
  const draft = {
    lessonKey: "lesson-1", targetClassId: "class-1",
    title: { "zh-CN": "任务", "en-US": "Task" }, instructions: { "zh-CN": "说明", "en-US": "Instructions" },
    checkpoint: { kind: "short-answer", prompt: { "zh-CN": "问题", "en-US": "Question" }, explanation: { "zh-CN": "答案", "en-US": "Answer" } },
    rubric: ["claim", "evidence", "reason"].map((id) => ({ id, label: { "zh-CN": id, "en-US": id } })),
    aiPolicy: "disabled", revisionPolicy: "teacher-requested",
  };
  const versions = new Set<string>();
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("FROM uais_idempotency_records")) return [];
    if (text.includes("FROM uais_users")) return [{ id: "teacher-id" }];
    if (text.includes("FROM uais_assessments a")) return [{ id: "activity-1", activity_key: "family-1", status: "published", version: 1, edit_revision: 3, lesson_id: "lesson-id", lesson_key: "lesson-1", target_class_external_id: "class-1" }];
    if (text.includes("INSERT INTO uais_assessments")) {
      // Enforce the real migration's (lesson_id, activity_key, version) unique index.
      const key = `${values[1]}:${values[3]}:${values[6]}`;
      if (versions.has(key)) {
        if (text.includes("ON CONFLICT (lesson_id, activity_key, version) WHERE activity_key IS NOT NULL") && text.includes("DO NOTHING")) return [];
        throw Object.assign(new Error("duplicate activity version"), { code: "23505" });
      }
      versions.add(key);
      return [{ id: values[0] }];
    }
    return [];
  };
  sql.begin = async (run: (tx: typeof sql) => Promise<void>) => run(sql);
  sql.end = () => {};
  const store = createUaisLearningLoopPostgresStore({
    env: { UAIS_CORE_DATABASE_URL: "postgres://synthetic:synthetic@example.test/never-connected" },
    createDatabase: (() => ({ sql })) as LearningLoopPostgresClientFactory,
  });
  const route = PATCH.createForTesting({
    env: {}, readActivityScope: async () => ({ courseId: "course-1", classId: "class-1", lessonKey: "lesson-1" }),
    authorize: async () => ({ status: "authorized", reasonCode: "teacher-dual-session-course-owner", teacherAccount: "teacher", course: { externalId: "course-1", title: "Course" }, classes: [{ externalId: "class-1", name: "Class" }] }),
    updateActivity: store.updateActivity,
    readActivity: async ({ activityId }) => ({ courseId: "course-1", activity: { id: activityId } }),
  });
  const request = (key: string) => route(new Request("https://uais.test/api/teaching/activities/activity-1", {
    method: "PATCH", headers: { "idempotency-key": key },
    body: JSON.stringify({ operation: "create-version", expectedEditRevision: 3, draft }),
  }), { params: Promise.resolve({ activityId: "activity-1" }) });
  expect((await request("first-tab")).status).toBe(200);
  const second = await request("second-tab");
  expect({ status: second.status, body: await second.json() }).toMatchObject({ status: 409, body: { reasonCode: "activity-version-already-exists", recoveryAction: "reload-activities" } });
  expect(versions.size).toBe(1);
});
