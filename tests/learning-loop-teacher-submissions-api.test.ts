import { describe, expect, it, vi } from "vitest";
import {
  createActivitySubmissionsGetHandler,
  createAiFeedbackDraftPostHandler,
  createLearningInsightsGetHandler,
  createTeacherFeedbackPutHandler,
  createTeacherSubmissionDecisionPostHandler,
  createTeacherSubmissionGetHandler,
} from "./helpers/learning-loop-route-factories";

const teacherAccess = {
  status: "authorized" as const,
  reasonCode: "teacher-dual-session-course-owner" as const,
  teacherAccount: "teacher-1",
  course: { externalId: "course-1", title: "Course one" },
  classes: [{ externalId: "class-1", name: "Class one" }],
  lesson: {
    key: "lesson-1",
    position: 1,
    title: { "zh-CN": "第一讲", "en-US": "Lesson one" },
    manifestRef: "manifest-1",
  },
};

const activityScope = {
  courseId: "course-1",
  classId: "class-1",
  lessonKey: "lesson-1",
};

const submissionScope = {
  ...activityScope,
  activityId: "activity-1",
  currentVersionId: "version-1",
};

function teacherSubmission(state = "submitted") {
  return {
    id: "submission-1",
    state,
    currentVersionId: "version-1",
    courseId: "course-1",
    classId: "class-1",
    activityId: "activity-1",
    versions: [{ id: "version-1", versionNo: 1, contentText: "evidence" }],
    feedback: [],
  };
}

describe("P1 teacher submission API", () => {
  it("returns real class insights with freshness and projection metadata", async () => {
    const readLearningInsights = vi.fn(async () => ({
      courseId: "course-1",
      classId: "class-1",
      counts: {
        draft: 1,
        submitted: 2,
        revisionRequested: 1,
        resubmitted: 0,
        accepted: 3,
        overdue: 1,
      },
      projectionVersion: 8,
      dataFreshAt: "2026-08-20T18:40:00.000Z",
    }));
    const handler = createLearningInsightsGetHandler({
      env: {},
      authorize: async () => teacherAccess,
      readLearningInsights,
    });
    const response = await handler(
      new Request(
        "http://localhost/api/teaching/courses/course-1/learning-insights?class=class-1",
      ),
      { params: { courseId: "course-1" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      counts: { submitted: 2, accepted: 3, overdue: 1 },
      projectionVersion: 8,
      dataFreshAt: "2026-08-20T18:40:00.000Z",
    });
    expect(readLearningInsights).toHaveBeenCalledWith({
      teacherAccount: "teacher-1",
      courseExternalId: "course-1",
      classExternalId: "class-1",
    });
  });

  it("returns a filtered real submission queue only after dual-session ownership", async () => {
    const listActivitySubmissions = vi.fn(async () => ({
      activityId: "activity-1",
      submissions: [],
      nextCursor: null,
      dataFreshAt: "2026-08-20T18:40:00.000Z",
    }));
    const handler = createActivitySubmissionsGetHandler({
      env: {},
      readActivityScope: async () => activityScope,
      authorize: async () => teacherAccess,
      listActivitySubmissions,
    });
    const response = await handler(
      new Request(
        "http://localhost/api/teaching/activities/activity-1/submissions?state=submitted&limit=20",
      ),
      { params: Promise.resolve({ activityId: "activity-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ submissions: [], nextCursor: null });
    expect(listActivitySubmissions).toHaveBeenCalledWith({
      teacherAccount: "teacher-1",
      activityId: "activity-1",
      classExternalId: "class-1",
      state: "submitted",
      limit: 20,
    });
  });

  it("returns version history only after submission scope authorization", async () => {
    const readTeacherSubmission = vi.fn(async () => teacherSubmission());
    const handler = createTeacherSubmissionGetHandler({
      env: {},
      readSubmissionScope: async () => submissionScope,
      authorize: async () => teacherAccess,
      readTeacherSubmission,
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/submissions/submission-1"),
      { params: { submissionId: "submission-1" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      submission: { id: "submission-1", versions: [{ id: "version-1" }] },
    });
  });

  it("saves teacher-only feedback with optimistic revision and database readback", async () => {
    const saveFeedbackDraft = vi.fn(async () => ({
      status: "persisted" as const,
      resourceId: "feedback-1",
      state: "draft",
      revision: 1,
      traceId: "trace-feedback-1",
      persistedAt: "2026-08-20T18:40:00.000Z",
    }));
    const readTeacherSubmission = vi.fn(async () => ({
      ...teacherSubmission(),
      feedback: [{ id: "feedback-1", status: "draft", sourceDraftRevision: 1 }],
    }));
    const handler = createTeacherFeedbackPutHandler({
      env: {},
      readSubmissionScope: async () => submissionScope,
      authorize: async () => teacherAccess,
      saveFeedbackDraft,
      readTeacherSubmission,
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/submissions/submission-1/feedback", {
        method: "PUT",
        headers: { "idempotency-key": "save-feedback-1" },
        body: JSON.stringify({
          expectedSubmissionVersionId: "version-1",
          expectedFeedbackRevision: 0,
          feedbackText: "Please revise.",
          rubricJudgments: { a: "met", b: "partly-met", c: "needs-revision" },
          origin: "teacher",
        }),
      }),
      { params: { submissionId: "submission-1" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "persisted",
      receipt: { resourceId: "feedback-1", state: "draft" },
      submission: { feedback: [{ status: "draft" }] },
    });
    expect(saveFeedbackDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        teacherAccount: "teacher-1",
        submissionId: "submission-1",
        expectedSubmissionVersionId: "version-1",
        expectedFeedbackRevision: 0,
        idempotencyKey: "save-feedback-1",
        origin: "teacher",
      }),
    );
  });

  it("requires an idempotency key for every manual teacher feedback write", async () => {
    const saveFeedbackDraft = vi.fn();
    const handler = createTeacherFeedbackPutHandler({
      env: {},
      readSubmissionScope: async () => submissionScope,
      authorize: async () => teacherAccess,
      saveFeedbackDraft,
      readTeacherSubmission: async () => teacherSubmission(),
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/submissions/submission-1/feedback", {
        method: "PUT",
        body: JSON.stringify({
          expectedSubmissionVersionId: "version-1",
          expectedFeedbackRevision: 0,
          feedbackText: "Teacher draft",
          rubricJudgments: { a: "met", b: "partly-met", c: "needs-revision" },
          origin: "teacher",
        }),
      }),
      { params: { submissionId: "submission-1" } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      reasonCode: "idempotency-key-required",
    });
    expect(saveFeedbackDraft).not.toHaveBeenCalled();
  });

  it("generates a version-bound AI draft, persists it hidden, and returns readback", async () => {
    const generate = vi.fn(async () => ({
      origin: "ai-assisted" as const,
      rubricJudgments: { a: "met", b: "partly-met", c: "needs-revision" },
      feedbackText: "Clarify the final relationship.",
      provider: "deepseek" as const,
      model: "test-model",
      usage: { totalTokens: 100 },
      aiTraceRef: "a".repeat(64),
    }));
    const saveFeedbackDraft = vi.fn(async () => ({
      status: "persisted" as const,
      resourceId: "feedback-ai-1",
      state: "draft",
      revision: 1,
      traceId: "trace-ai-1",
      persistedAt: "2026-08-20T18:40:00.000Z",
    }));
    const readTeacherSubmission = vi.fn(async () => ({
      ...teacherSubmission(),
      activity: {
        title: { "zh-CN": "任务", "en-US": "Activity" },
        instructions: { "zh-CN": "说明", "en-US": "Instructions" },
        aiPolicy: "teacher-requested-draft",
        rubric: [
          { id: "a", label: { "zh-CN": "甲", "en-US": "A" } },
          { id: "b", label: { "zh-CN": "乙", "en-US": "B" } },
          { id: "c", label: { "zh-CN": "丙", "en-US": "C" } },
        ],
      },
      feedback: [],
    }));
    const handler = createAiFeedbackDraftPostHandler({
      env: {},
      readSubmissionScope: async () => submissionScope,
      authorize: async () => teacherAccess,
      readTeacherSubmission,
      reserveAiFeedbackRequest: async () => ({
        status: "reserved",
        requestHash: "b".repeat(64),
      }),
      failAiFeedbackRequest: vi.fn(),
      generate,
      saveFeedbackDraft,
    });
    const response = await handler(
      new Request(
        "http://localhost/api/teaching/submissions/submission-1/ai-feedback-draft",
        {
          method: "POST",
          headers: { "idempotency-key": "ai-feedback-1" },
          body: JSON.stringify({
            expectedSubmissionVersionId: "version-1",
            expectedFeedbackRevision: 0,
          }),
        },
      ),
      { params: { submissionId: "submission-1" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "persisted",
      receipt: { resourceId: "feedback-ai-1", state: "draft" },
      draft: { origin: "ai-assisted", provider: "deepseek" },
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        submission: { versionId: "version-1", contentText: "evidence" },
      }),
    );
    expect(saveFeedbackDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSubmissionVersionId: "version-1",
        origin: "ai-assisted",
        aiTraceRef: "a".repeat(64),
        aiRequest: {
          idempotencyKey: "ai-feedback-1",
          requestHash: "b".repeat(64),
        },
      }),
    );
  });

  it("blocks provider work when the task-level AI policy is disabled", async () => {
    const reserveAiFeedbackRequest = vi.fn();
    const generate = vi.fn();
    const handler = createAiFeedbackDraftPostHandler({
      env: {},
      readSubmissionScope: async () => submissionScope,
      authorize: async () => teacherAccess,
      readTeacherSubmission: async () => ({
        ...teacherSubmission(),
        activity: {
          title: { "zh-CN": "任务", "en-US": "Activity" },
          instructions: { "zh-CN": "说明", "en-US": "Instructions" },
          aiPolicy: "disabled",
          rubric: [
            { id: "a", label: { "zh-CN": "甲", "en-US": "A" } },
            { id: "b", label: { "zh-CN": "乙", "en-US": "B" } },
            { id: "c", label: { "zh-CN": "丙", "en-US": "C" } },
          ],
        },
      }),
      reserveAiFeedbackRequest,
      failAiFeedbackRequest: vi.fn(),
      generate,
      saveFeedbackDraft: vi.fn(),
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/submissions/submission-1/ai-feedback-draft", {
        method: "POST",
        headers: { "idempotency-key": "ai-disabled-1" },
        body: JSON.stringify({
          expectedSubmissionVersionId: "version-1",
          expectedFeedbackRevision: 0,
        }),
      }),
      { params: { submissionId: "submission-1" } },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      reasonCode: "activity-ai-feedback-disabled",
    });
    expect(reserveAiFeedbackRequest).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("atomically releases feedback and accepts the exact visible version", async () => {
    const decideSubmission = vi.fn(async () => ({
      status: "persisted" as const,
      resourceId: "submission-1",
      state: "accepted",
      revision: 2,
      eventId: "event-accept-1",
      traceId: "trace-decision-1",
      persistedAt: "2026-08-20T18:41:00.000Z",
    }));
    const readTeacherSubmission = vi.fn(async () => teacherSubmission("accepted"));
    const handler = createTeacherSubmissionDecisionPostHandler({
      env: {},
      readSubmissionScope: async () => submissionScope,
      authorize: async () => teacherAccess,
      decideSubmission,
      readTeacherSubmission,
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/submissions/submission-1/decision", {
        method: "POST",
        headers: { "idempotency-key": "accept-submission-1" },
        body: JSON.stringify({
          expectedSubmissionVersionId: "version-1",
          decision: "accept",
          feedbackText: "Accepted after teacher review.",
          rubricJudgments: { a: "met", b: "met", c: "met" },
          origin: "teacher",
        }),
      }),
      { params: { submissionId: "submission-1" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "persisted",
      receipt: { state: "accepted" },
      submission: { state: "accepted" },
    });
    expect(decideSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        teacherAccount: "teacher-1",
        submissionId: "submission-1",
        expectedSubmissionVersionId: "version-1",
        decision: "accept",
        idempotencyKey: "accept-submission-1",
      }),
    );
  });
});
