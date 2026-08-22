import { describe, expect, it } from "vitest";
import {
  createUaisLearningLoopPostgresReadStore,
} from "@/lib/learning-loop/postgres-read-store";
import type { LearningLoopPostgresClientFactory } from "@/lib/learning-loop/postgres-store";

type FakeQuery = { text: string; values: unknown[] };

function createFakeDatabase(resolve: (query: FakeQuery) => unknown[]) {
  const queries: FakeQuery[] = [];
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = { text: strings.join("?"), values };
    queries.push(query);
    return resolve(query);
  };
  sql.begin = async (run: (tx: typeof sql) => Promise<void>) => run(sql);
  sql.end = async () => undefined;
  return {
    queries,
    createDatabase: (() => ({ sql })) as unknown as LearningLoopPostgresClientFactory,
  };
}

const ids = {
  student: "22222222-2222-4222-8222-222222222222",
  course: "33333333-3333-4333-8333-333333333333",
  class: "44444444-4444-4444-8444-444444444444",
  lesson: "55555555-5555-4555-8555-555555555555",
  activity: "66666666-6666-4666-8666-666666666666",
  submission: "77777777-7777-4777-8777-777777777777",
  version: "88888888-8888-4888-8888-888888888888",
};

describe("P1 learning-loop Postgres read store", () => {
  it("returns only the signed student's unit, draft and released feedback", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("FROM uais_users") && text.includes("role = 'student'")) {
        return [{ id: ids.student }];
      }
      if (text.includes("FROM uais_assessments a") && text.includes("a.status = 'published'")) {
        return [
          {
            activity_id: ids.activity,
            activity_version: 1,
            activity_status: "published",
            title_i18n: { "zh-CN": "任务", "en-US": "Activity" },
            instructions_i18n: { "zh-CN": "说明", "en-US": "Instructions" },
            rubric: [
              { id: "a", label: { "zh-CN": "甲", "en-US": "A" } },
              { id: "b", label: { "zh-CN": "乙", "en-US": "B" } },
              { id: "c", label: { "zh-CN": "丙", "en-US": "C" } },
            ],
            formative_check: {
              kind: "short-answer",
              prompt: { "zh-CN": "解释", "en-US": "Explain" },
              explanation: { "zh-CN": "参考", "en-US": "Reference" },
            },
            due_at: null,
            ai_policy: "teacher-requested-draft",
            lesson_id: ids.lesson,
            lesson_key: "lesson-1",
            lesson_position: 1,
            lesson_title: "第一讲",
            course_id: ids.course,
            course_external_id: "course-1",
            class_id: ids.class,
            class_external_id: "class-1",
          },
        ];
      }
      if (text.includes("FROM uais_formative_attempts")) {
        return [{ count: 1, last_attempted_at: "2026-08-20T18:00:00.000Z" }];
      }
      if (text.includes("FROM uais_submissions s") && text.includes("s.user_id")) {
        return [
          {
            submission_id: ids.submission,
            submission_state: "revision_requested",
            current_version_no: 1,
            version_id: ids.version,
            version_status: "sealed",
            content_text: "my private text",
            draft_revision: 2,
            submitted_at: "2026-08-20T18:01:00.000Z",
            updated_at: "2026-08-20T18:02:00.000Z",
          },
        ];
      }
      if (text.includes("FROM uais_submission_versions")) {
        return [
          {
            id: ids.version,
            version_no: 1,
            status: "sealed",
            content_text: "my private text",
            draft_revision: 2,
            submitted_at: "2026-08-20T18:01:00.000Z",
          },
        ];
      }
      if (text.includes("FROM uais_feedback")) {
        expect(text).toContain("status IN ('released', 'superseded')");
        return [
          {
            id: "feedback-1",
            submission_version_id: ids.version,
            origin: "ai-assisted",
            status: "released",
            rubric_judgments: { a: "met", b: "partly-met", c: "needs-revision" },
            feedback_text: "Please revise the relationship explanation.",
            requires_revision: true,
            released_at: "2026-08-20T18:02:00.000Z",
          },
        ];
      }
      if (text.includes("FROM uais_learner_profiles")) {
        return [{ projection_version: 5, last_event_at: "2026-08-20T18:02:00.000Z" }];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresReadStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
    });

    const result = await store.readStudentUnit({
      studentAccount: "student-1",
      courseExternalId: "course-1",
      classExternalId: "class-1",
      lessonKey: "lesson-1",
    });

    expect(result).toMatchObject({
      activity: { id: ids.activity, status: "published" },
      formative: { attempted: true, attemptCount: 1 },
      submission: {
        id: ids.submission,
        state: "revision_requested",
        currentVersion: { contentText: "my private text", versionNo: 1 },
      },
      completion: { completed: false, basis: "teacher-accepted-current-version" },
      projectionVersion: 5,
    });
    expect(result.feedback).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("aiTraceRef");
    expect(
      fake.queries.some(
        (query) =>
          query.text.includes("a.status = 'archived'") &&
          query.text.includes("existing_submission.user_id") &&
          query.text.includes("(a.status = 'published') DESC"),
      ),
    ).toBe(true);
  });

  it("computes real teacher queue counts from rows instead of demo constants", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("FROM uais_users") && text.includes("role = 'teacher'")) {
        return [{ id: "11111111-1111-4111-8111-111111111111" }];
      }
      if (text.includes("WITH active_families")) {
        return [
          "draft",
          "submitted",
          "submitted",
          "revision_requested",
          "resubmitted",
          "accepted",
          "accepted",
        ].map((submissionState, index) => ({
          lesson_id: ids.lesson,
          activity_key: "activity-family-1",
          target_class_external_id: "class-1",
          due_at: "2026-08-20T12:00:00.000Z",
          submission_id: `submission-${index + 1}`,
          student_id: `student-${index + 1}`,
          submission_state: submissionState,
          projection_version: index + 1,
          data_fresh_at: "2026-08-20T18:05:00.000Z",
        }));
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresReadStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
      now: () => new Date("2026-08-21T00:00:00.000Z"),
    });

    await expect(
      store.readLearningInsights({
        teacherAccount: "teacher-1",
        courseExternalId: "course-1",
        approvedStudentCounts: { "class-1": 10 },
      }),
    ).resolves.toMatchObject({
      counts: {
        notStarted: 3,
        draft: 1,
        submitted: 2,
        revisionRequested: 1,
        resubmitted: 1,
        accepted: 2,
        overdue: 8,
      },
      projectionVersion: 7,
      dataFreshAt: "2026-08-20T18:05:00.000Z",
    });
    expect(
      fake.queries.some(
        (query) =>
          query.text.includes("family_submissions") &&
          query.text.includes("versioned_activity.version DESC"),
      ),
    ).toBe(true);
  });

  it("builds a deterministic student dashboard from accepted membership scopes", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("FROM uais_users") && text.includes("role = 'student'")) {
        return [{ id: ids.student }];
      }
      if (text.includes("WITH authorized_scope")) {
        return [
          {
            course_external_id: "course-1",
            class_external_id: "class-1",
            lesson_key: "lesson-1",
            lesson_position: 1,
            activity_id: "activity-1",
            due_at: null,
            checkpoint_attempted: true,
            submission_state: "accepted",
            updated_at: "2026-08-20T18:04:00.000Z",
            projection_version: 4,
          },
          {
            course_external_id: "course-1",
            class_external_id: "class-1",
            lesson_key: "lesson-2",
            lesson_position: 2,
            activity_id: "activity-2",
            due_at: "2026-08-25T12:00:00.000Z",
            checkpoint_attempted: true,
            submission_state: "revision_requested",
            updated_at: "2026-08-20T18:05:00.000Z",
            projection_version: 5,
          },
        ];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresReadStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
    });

    await expect(
      store.readStudentDashboard({
        studentAccount: "student-1",
        scopes: [
          { courseId: "course-1", courseTitle: "Course one", classId: "class-1" },
        ],
      }),
    ).resolves.toMatchObject({
      courses: [
        {
          courseId: "course-1",
          classId: "class-1",
          counts: { accepted: 1, revisionRequested: 1, completedUnits: 1 },
          nextAction: { type: "revise-submission", lessonKey: "lesson-2" },
          playbackProgress: { status: "not-authoritative", percent: null },
          projectionVersion: 5,
          dataFreshAt: "2026-08-20T18:05:00.000Z",
        },
      ],
      nextAction: { type: "revise-submission", lessonKey: "lesson-2" },
    });
  });

  it("lists a real paginated teacher submission queue without demo counts", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("FROM uais_users") && text.includes("role = 'teacher'")) {
        return [{ id: "11111111-1111-4111-8111-111111111111" }];
      }
      if (text.includes("FROM uais_submissions s") && text.includes("ORDER BY s.updated_at DESC")) {
        return [
          {
            submission_id: ids.submission,
            submission_state: "submitted",
            current_version_no: 1,
            current_version_id: ids.version,
            student_account: "student-1",
            student_display_name: "Student One",
            class_external_id: "class-1",
            checkpoint_attempt_count: 1,
            last_submitted_at: "2026-08-20T18:01:00.000Z",
            updated_at: "2026-08-20T18:02:00.000Z",
          },
        ];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresReadStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
    });

    await expect(
      store.listActivitySubmissions({
        teacherAccount: "teacher-1",
        activityId: ids.activity,
        classExternalId: "class-1",
        state: "submitted",
        limit: 20,
      }),
    ).resolves.toMatchObject({
      activityId: ids.activity,
      submissions: [
        {
          id: ids.submission,
          state: "submitted",
          currentVersionId: ids.version,
          student: { account: "student-1", displayName: "Student One" },
          formative: { attemptCount: 1, attempted: true },
        },
      ],
      nextCursor: null,
    });
  });

  it("returns version history and teacher drafts only after teacher ownership filtering", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("FROM uais_users") && text.includes("role = 'teacher'")) {
        return [{ id: "11111111-1111-4111-8111-111111111111" }];
      }
      if (text.includes("FROM uais_submissions s") && text.includes("c.teacher_id")) {
        return [
          {
            submission_id: ids.submission,
            submission_state: "submitted",
            current_version_no: 1,
            current_version_id: ids.version,
            student_account: "student-1",
            student_display_name: "Student One",
            course_external_id: "course-1",
            class_external_id: "class-1",
            activity_id: ids.activity,
            lesson_key: "lesson-1",
            rubric: [
              { id: "a", label: { "zh-CN": "甲", "en-US": "A" } },
              { id: "b", label: { "zh-CN": "乙", "en-US": "B" } },
              { id: "c", label: { "zh-CN": "丙", "en-US": "C" } },
            ],
            checkpoint_attempt_count: 1,
            updated_at: "2026-08-20T18:02:00.000Z",
          },
        ];
      }
      if (text.includes("FROM uais_submission_versions")) {
        return [
          {
            id: ids.version,
            version_no: 1,
            status: "sealed",
            content_text: "student evidence",
            content_hash: "a".repeat(64),
            draft_revision: 2,
            submitted_at: "2026-08-20T18:01:00.000Z",
          },
        ];
      }
      if (text.includes("FROM uais_feedback")) {
        return [
          {
            id: "feedback-1",
            submission_version_id: ids.version,
            origin: "ai-assisted",
            status: "draft",
            rubric_judgments: { a: "met", b: "partly-met", c: "not-reviewed" },
            feedback_text: "teacher-only draft",
            source_draft_revision: 1,
            created_at: "2026-08-20T18:02:00.000Z",
            updated_at: "2026-08-20T18:02:00.000Z",
          },
        ];
      }
      return [];
    });
    const store = createUaisLearningLoopPostgresReadStore({
      env: { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" },
      createDatabase: fake.createDatabase,
    });

    await expect(
      store.readTeacherSubmission({
        teacherAccount: "teacher-1",
        submissionId: ids.submission,
      }),
    ).resolves.toMatchObject({
      id: ids.submission,
      courseId: "course-1",
      currentVersionId: ids.version,
      versions: [{ id: ids.version, contentText: "student evidence" }],
      feedback: [{ status: "draft", feedbackText: "teacher-only draft" }],
    });
  });
});
