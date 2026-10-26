// This suite only writes to the explicit disposable loopback lesson database.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClassroomLessonStore } from "@/lib/classroom-lessons/store";
import { createUaisLearningLoopPostgresStore } from "@/lib/learning-loop/postgres-store";
import {
  normalizeLessonPackage,
  activityDraftFromTemplate,
} from "@/lib/classroom-lessons/domain";
import { resetUaisCoreDatabasePoolForTesting } from "@/lib/db/core-database";
const url = process.env.UAIS_CLASSROOM_LESSONS_TEST_URL;
describe.skipIf(!url)("authored lessons on isolated local Postgres", () => {
  const env = { DATABASE_URL: url };
  const suffix = randomUUID().slice(0, 8);
  const teacherAccount = `lesson-test-${suffix}`;
  const courseId = `lesson-course-${suffix}`;
  let sql: ReturnType<typeof postgres>;
  const content = () => ({
    schemaVersion: 1,
    primaryLocale: "zh-CN",
    studentContent: {
      title: "第一课",
      objectives: ["目标"],
      body: "V1学生正文",
      questions: [{ id: "q1", prompt: "问题" }],
    },
    teacherGuide: {
      notes: "PRIVATE-NOTES",
      answers: [{ questionId: "q1", answer: "PRIVATE-ANSWER" }],
    },
    tasks: [
      {
        id: "t1",
        title: "任务",
        instructions: "说明",
        checkpoint: {
          kind: "short-answer",
          prompt: "检查",
          explanation: "私有解题解释",
        },
        rubric: [
          { id: "a", label: "主张" },
          { id: "b", label: "证据" },
          { id: "c", label: "推理" },
        ],
        aiPolicy: "disabled",
      },
    ],
  });
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      parsed.hostname !== "127.0.0.1" ||
      parsed.port !== "54443" ||
      parsed.pathname !== "/uais_classroom_lessons"
    )
      throw Error("Explicit isolated loopback lesson target required");
    sql = postgres(url!, { max: 1, prepare: false });
    const guard =
      await sql`SELECT 1 FROM uais_environment_guard WHERE environment='isolated-uais-db-test' AND enabled=true`;
    if (guard.length !== 1) throw Error("Isolated guard required");
    await sql`INSERT INTO uais_users(account,role,display_name,status) VALUES(${teacherAccount},'teacher','Lesson test','active')`;
  });
  afterAll(async () => {
    await resetUaisCoreDatabasePoolForTesting();
    if (sql) await sql.end();
  });
  it("imports two distinct ordered lessons, publishes atomically, preserves frozen materials and hides teacher answers", async () => {
    const store = createClassroomLessonStore({ env });
    const one = await store.importPackage({
      teacherAccount,
      courseId,
      courseTitle: "测试",
      package: content(),
      idempotencyKey: `import1-${suffix}`,
    });
    const two = await store.importPackage({
      teacherAccount,
      courseId,
      courseTitle: "测试",
      package: {
        ...content(),
        studentContent: { ...content().studentContent, title: "第二课" },
      },
      idempotencyKey: `import2-${suffix}`,
    });
    expect(one.lessonKey).not.toBe(two.lessonKey);
    expect(
      (await store.listTeacher({ teacherAccount, courseId })).map(
        (l) => l.position,
      ),
    ).toEqual([1, 2]);
    const args = {
      teacherAccount,
      courseId,
      lessonKey: one.lessonKey,
      expectedRevision: 1,
      targetClasses: [{ externalId: "class-a", name: "A" }],
      taskIds: ["t1"],
      idempotencyKey: `publish-${suffix}`,
    };
    const first = await store.publish(args);
    expect(first.activityIds).toHaveLength(1);
    expect(await store.publish(args)).toEqual(first);
    const activityStore = createUaisLearningLoopPostgresStore({ env });
    await activityStore.updateActivity({
      teacherAccount,
      activityId: first.activityIds[0],
      operation: "create-version",
      expectedEditRevision: 1,
      draft: activityDraftFromTemplate(
        normalizeLessonPackage(content()).tasks[0],
        one.lessonKey,
        "class-a",
      ),
      idempotencyKey: `manual-version-${suffix}`,
      traceId: `manual-version-${suffix}`,
    });
    const revised = content();
    revised.studentContent.body = "V2新正文";
    await store.saveDraft({
      teacherAccount,
      courseId,
      lessonKey: one.lessonKey,
      expectedRevision: 1,
      package: revised,
    });
    const second = await store.publish({
      ...args,
      expectedRevision: 2,
      idempotencyKey: `publish2-${suffix}`,
    });
    expect(second.version).toBe(2);
    const pinned = await store.readStudent({
      courseId,
      classId: "class-a",
      lessonKey: one.lessonKey,
      studentAccount: "student-test",
      activityId: first.activityIds[0],
    });
    expect(pinned?.content.body).toBe("V1学生正文");
    expect(pinned?.versionId).toBe(first.versionId);
    expect(JSON.stringify(pinned)).not.toMatch(
      /PRIVATE|teacherGuide|referenceAnswer|私有解题/,
    );
    expect(
      (
        await store.readStudent({
          courseId,
          classId: "class-a",
          lessonKey: one.lessonKey,
          studentAccount: "student-test",
        })
      )?.content.body,
    ).toBe("V2新正文");
    expect(await store.listStudent({ courseId, classId: "other" })).toEqual([]);
    const classB = await store.publish({
      ...args,
      expectedRevision: 2,
      targetClasses: [{ externalId: "class-b", name: "B" }],
      idempotencyKey: `class-b-${suffix}`,
    });
    expect(
      (
        await store.readPublishedScope({
          teacherAccount,
          courseId,
          lessonKey: one.lessonKey,
          targetClassId: "class-a",
        })
      )?.versionId,
    ).toBe(second.versionId);
    expect(
      (
        await store.readPublishedScope({
          teacherAccount,
          courseId,
          lessonKey: one.lessonKey,
          targetClassId: "class-b",
        })
      )?.versionId,
    ).toBe(classB.versionId);
    expect(
      await store.readPublishedScope({
        teacherAccount,
        courseId,
        lessonKey: one.lessonKey,
        targetClassId: "unknown",
      }),
    ).toBeUndefined();
    await expect(
      sql`UPDATE uais_lesson_versions SET student_content='{}' WHERE id=${first.versionId}`,
    ).rejects.toThrow("immutable");
  });
  it("rolls back version and all tasks when one task insert fails", async () => {
    const store = createClassroomLessonStore({ env });
    const draft = await store.importPackage({
      teacherAccount,
      courseId,
      courseTitle: "测试",
      package: content(),
      idempotencyKey: `rollback-import-${suffix}`,
    });
    const repeatedId = randomUUID();
    const failing = createClassroomLessonStore({
      env,
      createId: () => repeatedId,
    });
    await expect(
      failing.publish({
        teacherAccount,
        courseId,
        lessonKey: draft.lessonKey,
        expectedRevision: 1,
        targetClasses: [
          { externalId: "class-a", name: "A" },
          { externalId: "class-b", name: "B" },
        ],
        taskIds: ["t1"],
        idempotencyKey: `rollback-publish-${suffix}`,
      }),
    ).rejects.toThrow();
    const versions =
      await sql`SELECT v.id FROM uais_lesson_versions v JOIN uais_lessons l ON l.id=v.lesson_id WHERE l.external_key=${draft.lessonKey}`;
    expect(versions).toHaveLength(0);
    const activities =
      await sql`SELECT a.id FROM uais_assessments a JOIN uais_lessons l ON l.id=a.lesson_id WHERE l.external_key=${draft.lessonKey}`;
    expect(activities).toHaveLength(0);
    expect(
      (
        await store.readTeacher({
          teacherAccount,
          courseId,
          lessonKey: draft.lessonKey,
        })
      ).status,
    ).toBe("draft");
  });
  it("reads real draft revisions, latest release classes and only that version's currently published tasks", async () => {
    const store = createClassroomLessonStore({ env });
    const original = content();
    original.tasks.push({
      ...original.tasks[0],
      id: "t2",
      title: "第二项任务",
    });
    const { lessonKey } = await store.importPackage({
      teacherAccount,
      courseId,
      courseTitle: "测试",
      package: original,
      idempotencyKey: `summary-import-${suffix}`,
    });
    const summary = async () =>
      (await store.listTeacher({ teacherAccount, courseId })).find(
        (lesson) => lesson.lessonKey === lessonKey,
      )!;
    expect(await summary()).toMatchObject({
      draftTaskCount: 2,
      hasUnpublishedDraft: true,
      latestVersion: 0,
      latestRelease: null,
    });
    await store.publish({
      teacherAccount,
      courseId,
      lessonKey,
      expectedRevision: 1,
      targetClasses: [
        { externalId: "class-a", name: "A" },
        { externalId: "class-b", name: "B" },
      ],
      taskIds: ["t1"],
      idempotencyKey: `summary-v1-${suffix}`,
    });
    expect(await summary()).toMatchObject({
      draftRevision: 1,
      hasUnpublishedDraft: false,
      latestRelease: {
        version: 1,
        draftRevision: 1,
        targetClassIds: ["class-a", "class-b"],
        publishedTaskCount: 2,
      },
    });
    const revised = {
      ...original,
      studentContent: { ...original.studentContent, body: "尚未发布的改动" },
    };
    await store.saveDraft({
      teacherAccount,
      courseId,
      lessonKey,
      package: revised,
      expectedRevision: 1,
    });
    expect(await summary()).toMatchObject({
      draftRevision: 2,
      hasUnpublishedDraft: true,
      latestRelease: { version: 1, draftRevision: 1, publishedTaskCount: 2 },
    });
    const latest = await store.publish({
      teacherAccount,
      courseId,
      lessonKey,
      expectedRevision: 2,
      targetClasses: [{ externalId: "class-b", name: "B" }],
      taskIds: [],
      idempotencyKey: `summary-v2-${suffix}`,
    });
    expect(await summary()).toMatchObject({
      draftTaskCount: 2,
      hasUnpublishedDraft: false,
      latestRelease: {
        version: 2,
        draftRevision: 2,
        targetClassIds: ["class-b"],
        publishedTaskCount: 0,
      },
    });
    const detail = await store.readTeacher({
      teacherAccount,
      courseId,
      lessonKey,
    });
    expect(detail.latestRelease).toEqual((await summary()).latestRelease);
    const activityStore = createUaisLearningLoopPostgresStore({ env });
    const scope = await store.readPublishedScope({
      teacherAccount,
      courseId,
      lessonKey,
      targetClassId: "class-b",
    });
    expect(scope?.versionId).toBe(latest.versionId);
    const activity = await activityStore.createActivity({
      teacherAccount,
      course: { externalId: courseId, title: "测试" },
      class: { externalId: "class-b", name: "B" },
      lesson: scope!,
      draft: activityDraftFromTemplate(
        normalizeLessonPackage(revised).tasks[1],
        lessonKey,
        "class-b",
      ),
      idempotencyKey: `summary-task-${suffix}`,
      traceId: `summary-task-${suffix}`,
    });
    expect((await summary()).latestRelease?.publishedTaskCount).toBe(0);
    await activityStore.updateActivity({
      teacherAccount,
      activityId: activity.resourceId,
      operation: "publish",
      expectedEditRevision: 1,
      idempotencyKey: `summary-task-publish-${suffix}`,
      traceId: `summary-task-publish-${suffix}`,
    });
    expect((await summary()).latestRelease?.publishedTaskCount).toBe(1);
    await activityStore.updateActivity({
      teacherAccount,
      activityId: activity.resourceId,
      operation: "archive",
      expectedEditRevision: 2,
      idempotencyKey: `summary-task-archive-${suffix}`,
      traceId: `summary-task-archive-${suffix}`,
    });
    expect((await summary()).latestRelease?.publishedTaskCount).toBe(0);
  });
});
