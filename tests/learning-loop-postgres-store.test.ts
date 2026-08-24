import { describe, expect, it } from "vitest";
import {
  LearningLoopStoreError,
  createUaisLearningLoopPostgresStore,
  type LearningLoopPostgresClientFactory,
} from "@/lib/learning-loop/postgres-store";

const ids = {
  teacher: "11111111-1111-4111-8111-111111111111",
  student: "22222222-2222-4222-8222-222222222222",
  course: "33333333-3333-4333-8333-333333333333",
  class: "44444444-4444-4444-8444-444444444444",
  lesson: "55555555-5555-4555-8555-555555555555",
  activity: "66666666-6666-4666-8666-666666666666",
  submission: "77777777-7777-4777-8777-777777777777",
  version: "88888888-8888-4888-8888-888888888888",
  event: "99999999-9999-4999-8999-999999999999",
  outbox: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  feedback: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  decisionEvent: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
type FakeQuery = { text: string; values: unknown[] };

function createFakeDatabase(resolve: (query: FakeQuery) => unknown[]) {
  const queries: FakeQuery[] = [];
  let beginCount = 0;
  let ended = 0;
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = { text: strings.join("?"), values };
    queries.push(query);
    return resolve(query);
  };
  sql.begin = async (run: (tx: typeof sql) => Promise<void>) => {
    beginCount += 1;
    await run(sql);
  };
  sql.end = async () => {
    ended += 1;
  };
  const createDatabase = (() => ({ sql })) as unknown as LearningLoopPostgresClientFactory;
  return {
    createDatabase,
    queries,
    get beginCount() {
      return beginCount;
    },
    get ended() {
      return ended;
    },
  };
}

function validDraft() {
  return {
    lessonKey: "lesson-1",
    targetClassId: "class-1",
    title: { "zh-CN": "任务", "en-US": "Activity" },
    instructions: { "zh-CN": "说明", "en-US": "Instructions" },
    checkpoint: {
      kind: "short-answer" as const,
      prompt: { "zh-CN": "解释", "en-US": "Explain" },
      explanation: { "zh-CN": "参考", "en-US": "Reference" },
    },
    rubric: [
      { id: "one", label: { "zh-CN": "一", "en-US": "One" } },
      { id: "two", label: { "zh-CN": "二", "en-US": "Two" } },
      { id: "three", label: { "zh-CN": "三", "en-US": "Three" } },
    ],
    aiPolicy: "teacher-requested-draft" as const,
    revisionPolicy: "teacher-requested" as const,
  };
}

describe("P1 learning-loop Postgres store", () => {
  it("rejects a globally reused idempotency key from another actor or endpoint scope", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) {
        return [
          {
            actor_account: "another-teacher",
            scope: "teacher-save-feedback-draft",
            request_hash: "0".repeat(64),
            response_receipt: {
              status: "persisted",
              resourceId: ids.feedback,
              state: "draft",
              revision: 1,
              traceId: "trace-existing",
              persistedAt: "2026-08-20T17:29:00.000Z",
            },
          },
        ];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T17:30:00.000Z"),
    });

    await expect(
      store.createActivity({
        teacherAccount: "teacher-1",
        course: { externalId: "course-1", title: "课程一" },
        class: { externalId: "class-1", name: "一班" },
        lesson: {
          key: "lesson-1",
          position: 1,
          title: { "zh-CN": "第一讲", "en-US": "Lesson one" },
          manifestRef: "manifest-1",
        },
        draft: validDraft(),
        idempotencyKey: "globally-reused-key",
        traceId: "trace-create-scope-conflict",
      }),
    ).rejects.toMatchObject({
      status: 409,
      reasonCode: "idempotency-key-scope-conflict",
    });
  });

  it("creates course/class/lesson identity and the activity in one transaction", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_users") && text.includes("role = 'teacher'")) {
        return [{ id: ids.teacher }];
      }
      if (text.includes("INSERT INTO uais_courses")) return [{ id: ids.course }];
      if (text.includes("INSERT INTO uais_classes")) return [{ id: ids.class }];
      if (text.includes("INSERT INTO uais_lessons")) return [{ id: ids.lesson }];
      if (text.includes("INSERT INTO uais_assessments")) {
        return [{ id: ids.activity, created_at: "2026-08-20T17:30:00.000Z" }];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T17:30:00.000Z"),
      createId: () => ids.activity,
    });

    const result = await store.createActivity({
      teacherAccount: "teacher-1",
      course: { externalId: "course-1", title: "课程一" },
      class: { externalId: "class-1", name: "一班" },
      lesson: {
        key: "lesson-1",
        position: 1,
        title: { "zh-CN": "第一讲", "en-US": "Lesson one" },
        manifestRef: "manifest-1",
      },
      draft: validDraft(),
      idempotencyKey: "activity-create-1",
      traceId: "trace-create-1",
    });

    expect(result).toMatchObject({
      status: "persisted",
      resourceId: ids.activity,
      state: "draft",
      revision: 1,
      traceId: "trace-create-1",
    });
    expect(fake.beginCount).toBe(1);
    expect(fake.ended).toBe(1);
    expect(fake.queries.some((query) => query.text.includes("INSERT INTO uais_assessments"))).toBe(true);
    expect(fake.queries.some((query) => query.text.includes("INSERT INTO uais_idempotency_records"))).toBe(true);
  });

  it("publishes a complete draft with optimistic edit revision and readback receipt", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_users") && text.includes("role = 'teacher'")) {
        return [{ id: ids.teacher }];
      }
      if (text.includes("FROM uais_assessments a") && text.includes("FOR UPDATE OF a")) {
        return [
          {
            id: ids.activity,
            status: "draft",
            version: 1,
            edit_revision: 2,
            lesson_key: "lesson-1",
            target_class_external_id: "class-1",
            title_i18n: validDraft().title,
            instructions_i18n: validDraft().instructions,
            formative_check: validDraft().checkpoint,
            rubric: validDraft().rubric,
            due_at: null,
            ai_policy: "teacher-requested-draft",
            revision_policy: "teacher-requested",
          },
        ];
      }
      if (text.includes("UPDATE uais_assessments") && text.includes("RETURNING id")) {
        return [{ id: ids.activity, edit_revision: 3 }];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T17:32:00.000Z"),
    });

    await expect(
      store.updateActivity({
        teacherAccount: "teacher-1",
        activityId: ids.activity,
        expectedEditRevision: 2,
        operation: "publish",
        idempotencyKey: "publish-1",
        traceId: "trace-publish-1",
      }),
    ).resolves.toMatchObject({
      status: "persisted",
      resourceId: ids.activity,
      state: "published",
      revision: 3,
    });
    expect(
      fake.queries.some(
        (query) =>
          query.text.includes("UPDATE uais_assessments") &&
          query.text.includes("status = 'published'"),
      ),
    ).toBe(true);
    expect(
      fake.queries.some(
        (query) =>
          query.text.includes("activity_key") &&
          query.text.includes("id <>") &&
          query.text.includes("status = 'archived'"),
      ),
    ).toBe(true);
  });

  it("saves a teacher-only feedback draft against the exact sealed version", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_users") && text.includes("role = 'teacher'")) {
        return [{ id: ids.teacher }];
      }
      if (text.includes("FROM uais_submissions s") && text.includes("FOR UPDATE OF s, v")) {
        return [
          {
            submission_id: ids.submission,
            state: "submitted",
            current_version_no: 1,
            version_id: ids.version,
            version_status: "sealed",
            activity_id: ids.activity,
            rubric: validDraft().rubric,
          },
        ];
      }
      if (text.includes("FROM uais_feedback") && text.includes("status = 'draft'")) {
        return [];
      }
      if (text.includes("INSERT INTO uais_feedback")) {
        return [{ id: ids.feedback, source_draft_revision: 1 }];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T17:34:00.000Z"),
      createId: () => ids.feedback,
    });

    await expect(
      store.saveFeedbackDraft({
        teacherAccount: "teacher-1",
        submissionId: ids.submission,
        expectedSubmissionVersionId: ids.version,
        expectedFeedbackRevision: 0,
        feedbackText: "请进一步解释概念关系。",
        rubricJudgments: { one: "met", two: "partly-met", three: "needs-revision" },
        origin: "teacher",
        idempotencyKey: "save-feedback-draft-1",
        traceId: "trace-feedback-draft-1",
      }),
    ).resolves.toMatchObject({
      status: "persisted",
      resourceId: ids.feedback,
      state: "draft",
      revision: 1,
    });
    expect(
      fake.queries.some(
        (query) =>
          query.text.includes("INSERT INTO uais_feedback") &&
          query.text.includes("status = 'draft'"),
      ),
    ).toBe(true);
    expect(
      fake.queries.some(
        (query) =>
          query.text.includes("INSERT INTO uais_idempotency_records") &&
          query.values.includes("teacher-save-feedback-draft"),
      ),
    ).toBe(true);
  });

  it("reserves an AI feedback idempotency key before any provider call", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("FROM uais_users") && text.includes("role = 'teacher'")) {
        return [{ id: ids.teacher }];
      }
      if (text.includes("FROM uais_idempotency_records") && text.includes("idempotency_key")) {
        return [];
      }
      if (text.includes("FROM uais_submissions s") && text.includes("c.teacher_id")) {
        return [
          {
            submission_id: ids.submission,
            version_id: ids.version,
            version_status: "sealed",
            state: "submitted",
          },
        ];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T17:35:00.000Z"),
      createId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });

    const result = await store.reserveAiFeedbackRequest({
      teacherAccount: "teacher-1",
      submissionId: ids.submission,
      expectedSubmissionVersionId: ids.version,
      expectedFeedbackRevision: 0,
      idempotencyKey: "ai-feedback-request-1",
      traceId: "trace-ai-feedback-request-1",
    });

    expect(result).toMatchObject({
      status: "reserved",
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(
      fake.queries.some(
        (query) =>
          query.text.includes("INSERT INTO uais_idempotency_records") &&
          query.text.includes("teacher-ai-feedback-request"),
      ),
    ).toBe(true);
  });

  it("returns a recoverable stale-draft conflict without writing the old text", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("FROM uais_users") && text.includes("role = 'student'")) {
        return [{ id: ids.student }];
      }
      if (text.includes("FROM uais_assessments") && text.includes("target_class_external_id")) {
        return [{ id: ids.activity }];
      }
      if (text.includes("FROM uais_formative_attempts")) return [{ count: 1 }];
      if (text.includes("FROM uais_submissions") && text.includes("FOR UPDATE")) {
        return [
          {
            id: ids.submission,
            state: "draft",
            current_version_no: 1,
            version_id: ids.version,
            draft_revision: 4,
            content_text: "server-newer-text",
          },
        ];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
    });

    await expect(
      store.saveSubmissionDraft({
        studentAccount: "student-1",
        activityId: ids.activity,
        classExternalId: "class-1",
        contentText: "local-unsaved-text",
        expectedDraftRevision: 3,
        traceId: "trace-save-1",
      }),
    ).rejects.toMatchObject({
      status: 409,
      reasonCode: "stale-draft-revision",
      details: {
        latestRevision: 4,
        latestContent: "server-newer-text",
        recoveryAction: "reload-and-merge",
      },
    });
    expect(fake.queries.some((query) => query.text.includes("UPDATE uais_submission_versions"))).toBe(false);
  });

  it("seals the version and writes event, profile, recommendation and outbox before commit", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_users") && text.includes("role = 'student'")) {
        return [{ id: ids.student }];
      }
      if (text.includes("FROM uais_submissions") && text.includes("FOR UPDATE")) {
        return [
          {
            submission_id: ids.submission,
            student_id: ids.student,
            state: "draft",
            current_version_no: 1,
            version_id: ids.version,
            version_status: "draft",
            draft_revision: 2,
            course_id: ids.course,
            class_id: ids.class,
            lesson_id: ids.lesson,
            lesson_key: "lesson-1",
            activity_id: ids.activity,
            checkpoint_attempts: 1,
          },
        ];
      }
      if (text.includes("SELECT progress") && text.includes("uais_learner_profiles")) {
        return [{ progress: {}, projection_version: 0 }];
      }
      return [];
    });
    const sequence = [ids.event, ids.outbox];
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T17:35:00.000Z"),
      createId: () => sequence.shift() ?? ids.event,
    });

    const result = await store.submitSubmission({
      studentAccount: "student-1",
      activityId: ids.activity,
      classExternalId: "class-1",
      expectedDraftRevision: 2,
      idempotencyKey: "submit-1",
      traceId: "trace-submit-1",
    });

    expect(result).toMatchObject({
      status: "persisted",
      resourceId: ids.submission,
      state: "submitted",
      revision: 2,
      eventId: ids.event,
    });
    for (const fragment of [
      "UPDATE uais_submission_versions",
      "UPDATE uais_submissions",
      "INSERT INTO uais_learning_events",
      "INSERT INTO uais_learner_profiles",
      "INSERT INTO uais_recommendations",
      "INSERT INTO uais_xapi_outbox",
      "INSERT INTO uais_idempotency_records",
    ]) {
      expect(fake.queries.some((query) => query.text.includes(fragment)), fragment).toBe(true);
    }
    expect(fake.beginCount).toBe(1);
  });

  it("persists a formative response privately while mirroring only redacted event metadata", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_users") && text.includes("role = 'student'")) {
        return [{ id: ids.student }];
      }
      if (text.includes("FROM uais_assessments a") && text.includes("formative_check")) {
        return [
          {
            activity_id: ids.activity,
            course_id: ids.course,
            course_external_id: "course-1",
            class_id: ids.class,
            lesson_id: ids.lesson,
            lesson_key: "lesson-1",
            formative_check: { kind: "short-answer" },
            rubric: [],
          },
        ];
      }
      if (text.includes("max(attempt_no)")) return [{ attempt_no: 0 }];
      if (text.includes("SELECT progress") && text.includes("uais_learner_profiles")) return [];
      return [];
    });
    const sequence = [
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ids.event,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ids.outbox,
    ];
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T17:40:00.000Z"),
      createId: () => sequence.shift() ?? ids.outbox,
    });

    const result = await store.recordFormativeAttempt({
      studentAccount: "student-1",
      activityId: ids.activity,
      classExternalId: "class-1",
      response: { kind: "short-answer", text: "student private answer" },
      idempotencyKey: "checkpoint-1",
      traceId: "trace-checkpoint-1",
    });

    expect(result).toMatchObject({ status: "persisted", state: "attempted", revision: 1 });
    const privateWrite = fake.queries.find((query) =>
      query.text.includes("INSERT INTO uais_formative_attempts"),
    );
    expect(JSON.stringify(privateWrite?.values)).toContain("student private answer");
    for (const query of fake.queries.filter(
      (candidate) =>
        candidate.text.includes("INSERT INTO uais_learning_events") ||
        candidate.text.includes("INSERT INTO uais_xapi_outbox") ||
        candidate.text.includes("INSERT INTO uais_audit_log"),
    )) {
      expect(JSON.stringify(query.values)).not.toContain("student private answer");
    }
  });

  it("persists a redacted learning event, profile projection and outbox atomically", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_users") && text.includes("role = 'student'")) {
        return [{ id: ids.student }];
      }
      if (text.includes("FROM uais_courses c") && text.includes("JOIN uais_classes cl")) {
        return [{ course_id: ids.course, class_id: ids.class }];
      }
      if (text.includes("SELECT progress") && text.includes("uais_learner_profiles")) {
        return [{ progress: {}, projection_version: 2 }];
      }
      return [];
    });
    const sequence = [ids.event, ids.outbox];
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T17:45:00.000Z"),
      createId: () => sequence.shift() ?? ids.outbox,
    });

    const result = await store.recordLearningEvent({
      studentAccount: "student-1",
      classExternalId: "class-1",
      event: {
        type: "lesson.viewed",
        object: { id: "lesson-1", name: "Lesson one", type: "lesson" },
        result: { completion: false, duration: "PT10S" },
        context: { courseId: "course-1", classId: "class-1", lessonId: "lesson-1" },
      },
      idempotencyKey: "event-1",
      traceId: "trace-event-1",
    });

    expect(result).toMatchObject({
      status: "persisted",
      resourceId: ids.event,
      eventId: ids.event,
      state: "persisted",
      revision: 3,
    });
    for (const fragment of [
      "INSERT INTO uais_learning_events",
      "INSERT INTO uais_learner_profiles",
      "INSERT INTO uais_xapi_outbox",
      "INSERT INTO uais_audit_log",
      "INSERT INTO uais_idempotency_records",
    ]) {
      expect(fake.queries.some((query) => query.text.includes(fragment)), fragment).toBe(true);
    }
    expect(fake.queries.some((query) => query.text.includes("INSERT INTO uais_courses"))).toBe(false);
    expect(fake.queries.some((query) => query.text.includes("INSERT INTO uais_classes"))).toBe(false);
    const scopeQuery = fake.queries.find(
      (query) =>
        query.text.includes("FROM uais_courses c") &&
        query.text.includes("JOIN uais_classes cl"),
    );
    expect(scopeQuery?.text).toContain("cl.teacher_id = c.teacher_id");
    expect(fake.beginCount).toBe(1);
  });

  it("keeps relational scope fail closed until an explicit backfill has completed", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_users") && text.includes("role = 'student'")) {
        return [{ id: ids.student }];
      }
      if (text.includes("FROM uais_courses c") && text.includes("JOIN uais_classes cl")) {
        return [];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T17:46:00.000Z"),
    });

    await expect(
      store.recordLearningEvent({
        studentAccount: "student-1",
        classExternalId: "class-1",
        event: {
          type: "course.viewed",
          object: { id: "course-1", name: "Client-provided object name", type: "course" },
          context: { courseId: "course-1", classId: "client-forged-class" },
        },
        idempotencyKey: "event-snapshot-projection-1",
        traceId: "trace-event-snapshot-projection-1",
      }),
    ).rejects.toMatchObject({
      status: 409,
      reasonCode: "learning-scope-projection-required",
    });

    expect(fake.queries.some((query) => query.text.includes("role = 'teacher'"))).toBe(false);
    expect(fake.queries.some((query) => query.text.includes("INSERT INTO uais_courses"))).toBe(false);
    expect(fake.queries.some((query) => query.text.includes("INSERT INTO uais_classes"))).toBe(false);
  });

  it("keeps missing trusted projection fail closed when the relational scope is absent", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_users") && text.includes("role = 'student'")) {
        return [{ id: ids.student }];
      }
      if (text.includes("FROM uais_courses c") && text.includes("JOIN uais_classes cl")) {
        return [];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T17:48:00.000Z"),
    });

    await expect(
      store.recordLearningEvent({
        studentAccount: "student-1",
        classExternalId: "class-1",
        event: {
          type: "lesson.viewed",
          object: { id: "lesson-1", name: "Lesson one" },
          context: { courseId: "course-1" },
        },
        idempotencyKey: "event-missing-snapshot-1",
        traceId: "trace-event-missing-snapshot-1",
      }),
    ).rejects.toMatchObject({
      status: 409,
      reasonCode: "learning-scope-projection-required",
    });
    expect(fake.queries.some((query) => query.text.includes("role = 'teacher'"))).toBe(false);
  });

  it("releases feedback and accepts the exact sealed version in one transaction", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_users") && text.includes("role = 'teacher'")) {
        return [{ id: ids.teacher }];
      }
      if (text.includes("FROM uais_submissions s") && text.includes("FOR UPDATE OF s, v")) {
        return [
          {
            submission_id: ids.submission,
            state: "submitted",
            current_version_no: 1,
            version_id: ids.version,
            version_status: "sealed",
            activity_id: ids.activity,
            rubric: [
              { id: "accuracy" },
              { id: "relationships" },
              { id: "examples" },
            ],
            course_id: ids.course,
            class_id: ids.class,
            lesson_id: ids.lesson,
            lesson_key: "lesson-1",
          },
        ];
      }
      if (text.includes("SELECT progress") && text.includes("uais_learner_profiles")) {
        return [{ progress: {}, projection_version: 4 }];
      }
      if (text.includes("SELECT ai_trace_ref") && text.includes("origin = 'ai-assisted'")) {
        return [{ ai_trace_ref: "f".repeat(64) }];
      }
      return [];
    });
    const sequence = [
      ids.feedback,
      ids.event,
      ids.decisionEvent,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ids.outbox,
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    ];
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-20T18:15:00.000Z"),
      createId: () => sequence.shift() ?? ids.outbox,
    });

    const result = await store.decideSubmission({
      teacherAccount: "teacher-1",
      submissionId: ids.submission,
      expectedSubmissionVersionId: ids.version,
      decision: "accept",
      feedbackText: "The explanation is clear and can be accepted.",
      rubricJudgments: {
        accuracy: "met",
        relationships: "met",
        examples: "partly-met",
      },
      origin: "ai-assisted",
      idempotencyKey: "decision-1",
      traceId: "trace-decision-1",
    });

    expect(result).toMatchObject({
      status: "persisted",
      resourceId: ids.submission,
      state: "accepted",
      revision: 1,
      eventId: ids.decisionEvent,
    });
    for (const fragment of [
      "INSERT INTO uais_feedback",
      "UPDATE uais_submissions",
      "INSERT INTO uais_learning_events",
      "INSERT INTO uais_learner_profiles",
      "INSERT INTO uais_recommendations",
      "INSERT INTO uais_xapi_outbox",
      "INSERT INTO uais_idempotency_records",
    ]) {
      expect(fake.queries.some((query) => query.text.includes(fragment)), fragment).toBe(true);
    }
    const feedbackWrite = fake.queries.find((query) => query.text.includes("INSERT INTO uais_feedback"));
    expect(JSON.stringify(feedbackWrite?.values)).toContain("The explanation is clear");
    expect(JSON.stringify(feedbackWrite?.values)).toContain("f".repeat(64));
    for (const query of fake.queries.filter(
      (candidate) =>
        candidate.text.includes("INSERT INTO uais_learning_events") ||
        candidate.text.includes("INSERT INTO uais_xapi_outbox") ||
        candidate.text.includes("INSERT INTO uais_audit_log"),
    )) {
      expect(JSON.stringify(query.values)).not.toContain("The explanation is clear");
    }
  });

  it("claims outbox rows with SKIP LOCKED and maps only the dispatch contract", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("FOR UPDATE SKIP LOCKED")) {
        return [
          {
            outbox_id: ids.outbox,
            learning_event_id: ids.event,
            statement_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            attempt_count: 1,
            actor_id: ids.student,
            actor_role: "student",
            event_type: "submission.submitted",
            object_id: "submission:777:v1",
            course_external_id: "course-1",
            class_external_id: "class-1",
            lesson_key: "lesson-1",
            context: { versionNo: 1 },
            occurred_at: "2026-08-20T17:35:00.000Z",
          },
        ];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
    });

    await expect(
      store.claimBatch({
        workerId: "worker-1",
        limit: 25,
        claimedAt: "2026-08-20T17:50:00.000Z",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        outboxId: ids.outbox,
        learningEventId: ids.event,
        eventType: "submission.submitted",
        objectName: "Structured learning submission",
        context: { versionNo: 1 },
      }),
    ]);
    expect(fake.queries.some((query) => query.text.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
    expect(
      fake.queries.some(
        (query) =>
          query.text.includes("status = 'processing'") &&
          query.text.includes("interval '10 minutes'") &&
          query.text.includes("u.id::text AS actor_id"),
      ),
    ).toBe(true);
    expect(fake.queries.some((query) => query.text.includes("status = 'processing'"))).toBe(true);
  });

  it("rejects missing managed Postgres configuration with a redacted store error", () => {
    expect(() => createUaisLearningLoopPostgresStore({ env: {} })).toThrowError(
      LearningLoopStoreError,
    );
    try {
      createUaisLearningLoopPostgresStore({ env: {} });
    } catch (error) {
      expect(error).toMatchObject({ status: 503, reasonCode: "core-database-required" });
      expect(JSON.stringify(error)).not.toContain("postgres://");
    }
  });
});
