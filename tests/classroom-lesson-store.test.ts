import { describe, expect, it } from "vitest";
import { createClassroomLessonStore } from "@/lib/classroom-lessons/store";
import type { LearningLoopPostgresClientFactory } from "@/lib/learning-loop/postgres-store";

const lessonPackage = {
  schemaVersion: 1,
  primaryLocale: "zh-CN",
  studentContent: {
    title: "课时",
    objectives: [],
    body: "正文",
    questions: [],
  },
  teacherGuide: { notes: "PRIVATE", answers: [] },
  tasks: [],
};
function fake(resolve: (text: string, values: unknown[]) => unknown[]) {
  const calls: string[] = [];
  let transaction = false;
  const sql = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      calls.push(text);
      return resolve(text, values);
    },
    {
      begin: async (run: (sql: unknown) => Promise<void>) => {
        transaction = true;
        await run(sql);
      },
      end: async () => {},
    },
  );
  return {
    calls,
    get transaction() {
      return transaction;
    },
    createDatabase: (() => ({
      sql,
    })) as unknown as LearningLoopPostgresClientFactory,
  };
}
describe("classroom lesson persistence", () => {
  it("distinguishes an unpublished draft revision from the latest class-targeted release", async () => {
    const db = fake(() => [
      {
        external_key: "lesson-1",
        title: "待发布的新标题",
        position: 1,
        status: "published",
        draft_revision: 4,
        draft_task_count: 3,
        latest_version: 2,
        published_draft_revision: 3,
        published_target_class_ids: ["class-b"],
        published_task_count: 2,
        updated_at: "2026-10-26T00:00:00Z",
      },
    ]);
    const store = createClassroomLessonStore({
      env: { DATABASE_URL: "postgres://test.invalid/test" },
      createDatabase: db.createDatabase,
    });
    expect(
      await store.listTeacher({
        teacherAccount: "teacher",
        courseId: "course",
      }),
    ).toEqual([
      expect.objectContaining({
        draftRevision: 4,
        draftTaskCount: 3,
        hasUnpublishedDraft: true,
        latestRelease: {
          version: 2,
          draftRevision: 3,
          targetClassIds: ["class-b"],
          publishedTaskCount: 2,
        },
      }),
    ]);
  });
  it("shows a never-published lesson as a draft without inventing release targets", async () => {
    const db = fake(() => [
      {
        external_key: "lesson-1",
        title: "草稿",
        position: 1,
        status: "draft",
        draft_revision: 1,
        draft_task_count: 0,
        latest_version: null,
        published_draft_revision: null,
        published_target_class_ids: null,
        published_task_count: 0,
        updated_at: "2026-10-26T00:00:00Z",
      },
    ]);
    const store = createClassroomLessonStore({
      env: { DATABASE_URL: "postgres://test.invalid/test" },
      createDatabase: db.createDatabase,
    });
    expect(
      (
        await store.listTeacher({
          teacherAccount: "teacher",
          courseId: "course",
        })
      )[0],
    ).toMatchObject({
      draftTaskCount: 0,
      hasUnpublishedDraft: true,
      latestRelease: null,
    });
  });
  it("rejects stale publication before writing a version or any activity", async () => {
    const db = fake((sql) =>
      sql.includes("FROM uais_lessons l")
        ? [
            {
              id: "l1",
              draft_revision: 3,
              draft_package: lessonPackage,
              status: "draft",
              teacher_id: "t1",
              course_id: "c1",
              position: 1,
              external_key: "lesson-1",
            },
          ]
        : [],
    );
    const store = createClassroomLessonStore({
      env: { DATABASE_URL: "postgres://test.invalid/test" },
      createDatabase: db.createDatabase,
    });
    await expect(
      store.publish({
        teacherAccount: "teacher",
        courseId: "course",
        lessonKey: "lesson-1",
        expectedRevision: 2,
        targetClasses: [{ externalId: "class-1", name: "班级" }],
        taskIds: [],
        idempotencyKey: "publish-1",
      }),
    ).rejects.toThrow("lesson-draft-revision-conflict");
    expect(
      db.calls.some((call) =>
        call.includes("INSERT INTO uais_lesson_versions"),
      ),
    ).toBe(false);
    expect(db.transaction).toBe(true);
  });
  it("returns a prior publish receipt before checking a now changed draft", async () => {
    const db = fake((sql) =>
      sql.includes("FROM uais_idempotency_records")
        ? [
            {
              actor_account: "teacher",
              scope: "classroom-lesson-publish",
              request_hash: "wrong",
              response_receipt: {},
            },
          ]
        : [],
    );
    const store = createClassroomLessonStore({
      env: { DATABASE_URL: "postgres://test.invalid/test" },
      createDatabase: db.createDatabase,
    });
    await expect(
      store.publish({
        teacherAccount: "teacher",
        courseId: "course",
        lessonKey: "lesson-1",
        expectedRevision: 2,
        targetClasses: [{ externalId: "class-1", name: "班级" }],
        taskIds: [],
        idempotencyKey: "publish-1",
      }),
    ).rejects.toThrow("idempotency-key-payload-mismatch");
    expect(
      db.calls.some((call) =>
        call.includes("INSERT INTO uais_lesson_versions"),
      ),
    ).toBe(false);
  });
  it("reads only the activity-pinned version and strips teacher fields from learner output", async () => {
    const db = fake((sql) =>
      sql.includes("SELECT v.id")
        ? [
            {
              id: "version-1",
              version_no: 1,
              external_key: "lesson-1",
              position: 1,
              student_content: {
                ...lessonPackage.studentContent,
                referenceAnswer: "SECRET",
              },
              teacher_guide: { notes: "SECRET" },
              primary_locale: "zh-CN",
            },
          ]
        : [],
    );
    const store = createClassroomLessonStore({
      env: { DATABASE_URL: "postgres://test.invalid/test" },
      createDatabase: db.createDatabase,
    });
    const result = await store.readStudent({
      courseId: "course",
      classId: "class-1",
      lessonKey: "lesson-1",
      studentAccount: "student",
      activityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(result?.versionId).toBe("version-1");
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(db.calls[0]).toContain("a.lesson_version_id = v.id");
  });
});
