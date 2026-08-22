import { describe, expect, it, vi } from "vitest";
import {
  createFormativeAttemptPostHandler,
  createLearningDashboardGetHandler,
  createLearningUnitGetHandler,
  createSubmissionDraftPutHandler,
  createSubmissionSubmitPostHandler,
} from "./helpers/learning-loop-route-factories";
import { LearningLoopStoreError } from "@/lib/learning-loop/postgres-store";

const studentAccess = {
  status: "authorized" as const,
  reasonCode: "student-course-membership-approved" as const,
  studentAccount: "student-1",
  courseId: "course-1",
  classId: "class-1",
};

const scope = {
  courseId: "course-1",
  classId: "class-1",
  lessonKey: "lesson-1",
};

function receipt(state: string, revision: number) {
  return {
    status: "persisted" as const,
    resourceId: "submission-1",
    state,
    revision,
    traceId: "trace-student-1",
    persistedAt: "2026-08-20T18:30:00.000Z",
  };
}

describe("P1 student learning-loop API", () => {
  it("returns an honest real-data dashboard for the signed student's approved scopes", async () => {
    const readStudentDashboard = vi.fn(async () => ({
      courses: [],
      nextAction: {
        type: "collect-more-evidence",
        reasonCode: "no-published-learning-units",
      },
      dataFreshAt: "2026-08-20T18:30:00.000Z",
    }));
    const handler = createLearningDashboardGetHandler({
      env: {},
      authorize: async () => ({
        status: "authorized" as const,
        reasonCode: "student-approved-memberships" as const,
        studentAccount: "student-1",
        scopes: [
          { courseId: "course-1", courseTitle: "Course one", classId: "class-1" },
        ],
      }),
      readStudentDashboard,
    });
    const response = await handler(
      new Request("http://localhost/api/learning/dashboard"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      courses: [],
      nextAction: { type: "collect-more-evidence" },
    });
    expect(readStudentDashboard).toHaveBeenCalledWith({
      studentAccount: "student-1",
      scopes: [
        { courseId: "course-1", courseTitle: "Course one", classId: "class-1" },
      ],
    });
  });

  it("returns only the authorized student's published unit, submission and feedback", async () => {
    const readStudentUnit = vi.fn(async () => ({
      unit: { courseId: "course-1", classId: "class-1", lessonKey: "lesson-1" },
      activity: { id: "activity-1", status: "published" },
      formative: { attempted: true, attemptCount: 1 },
      submission: { id: "submission-1", state: "revision_requested" },
      feedback: [{ id: "feedback-1", status: "released" }],
      completion: { completed: false, basis: "teacher-accepted-current-version" },
      playbackProgress: { status: "not-authoritative", percent: null },
      projectionVersion: 4,
      dataFreshAt: "2026-08-20T18:30:00.000Z",
    }));
    const handler = createLearningUnitGetHandler({
      env: {},
      authorize: async () => studentAccess,
      readStudentUnit,
    });
    const response = await handler(
      new Request(
        "http://localhost/api/learning/courses/course-1/units/lesson-1",
      ),
      { params: Promise.resolve({ courseId: "course-1", lessonKey: "lesson-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      unit: { lessonKey: "lesson-1" },
      submission: { state: "revision_requested" },
      feedback: [{ status: "released" }],
      completion: { completed: false },
    });
    expect(readStudentUnit).toHaveBeenCalledWith({
      studentAccount: "student-1",
      courseExternalId: "course-1",
      classExternalId: "class-1",
      lessonKey: "lesson-1",
    });
  });

  it("persists a real formative attempt with the authorized class and idempotency key", async () => {
    const recordFormativeAttempt = vi.fn(async () => ({
      ...receipt("attempted", 1),
      resourceId: "attempt-1",
      eventId: "event-1",
    }));
    const handler = createFormativeAttemptPostHandler({
      env: {},
      readActivityScope: async () => scope,
      authorize: async () => studentAccess,
      recordFormativeAttempt,
    });
    const response = await handler(
      new Request(
        "http://localhost/api/learning/activities/activity-1/formative-attempt",
        {
          method: "POST",
          headers: { "idempotency-key": "checkpoint-attempt-1" },
          body: JSON.stringify({ response: { kind: "short-answer", text: "证据" } }),
        },
      ),
      { params: { activityId: "activity-1" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "persisted",
      resourceId: "attempt-1",
      state: "attempted",
    });
    expect(recordFormativeAttempt).toHaveBeenCalledWith({
      studentAccount: "student-1",
      activityId: "activity-1",
      classExternalId: "class-1",
      response: { kind: "short-answer", text: "证据" },
      idempotencyKey: "checkpoint-attempt-1",
      traceId: expect.any(String),
    });
  });

  it("autosaves with expected revision and exposes a recoverable 409 without losing text", async () => {
    const saveSubmissionDraft = vi.fn(async () => {
      throw new LearningLoopStoreError(409, "stale-draft-revision", {
        latestRevision: 5,
        latestContent: "newer server text",
        recoveryAction: "reload-and-merge",
      });
    });
    const handler = createSubmissionDraftPutHandler({
      env: {},
      readActivityScope: async () => scope,
      authorize: async () => studentAccess,
      saveSubmissionDraft,
    });
    const response = await handler(
      new Request("http://localhost/api/learning/activities/activity-1/submission", {
        method: "PUT",
        body: JSON.stringify({ contentText: "local text", expectedDraftRevision: 4 }),
      }),
      { params: { activityId: "activity-1" } },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: "conflict",
      reasonCode: "stale-draft-revision",
      latestRevision: 5,
      latestContent: "newer server text",
      recoveryAction: "reload-and-merge",
    });
    expect(saveSubmissionDraft).toHaveBeenCalledWith({
      studentAccount: "student-1",
      activityId: "activity-1",
      classExternalId: "class-1",
      contentText: "local text",
      expectedDraftRevision: 4,
      traceId: expect.any(String),
    });
  });

  it("seals the expected draft revision idempotently", async () => {
    const submitSubmission = vi.fn(async () => receipt("submitted", 2));
    const handler = createSubmissionSubmitPostHandler({
      env: {},
      readActivityScope: async () => scope,
      authorize: async () => studentAccess,
      submitSubmission,
    });
    const response = await handler(
      new Request(
        "http://localhost/api/learning/activities/activity-1/submission/submit",
        {
          method: "POST",
          headers: { "idempotency-key": "submit-v1-1" },
          body: JSON.stringify({ expectedDraftRevision: 2 }),
        },
      ),
      { params: { activityId: "activity-1" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "persisted",
      resourceId: "submission-1",
      state: "submitted",
      revision: 2,
    });
    expect(submitSubmission).toHaveBeenCalledWith({
      studentAccount: "student-1",
      activityId: "activity-1",
      classExternalId: "class-1",
      expectedDraftRevision: 2,
      idempotencyKey: "submit-v1-1",
      traceId: expect.any(String),
    });
  });

  it("rejects a forged class scope before any student write", async () => {
    const saveSubmissionDraft = vi.fn();
    const handler = createSubmissionDraftPutHandler({
      env: {},
      readActivityScope: async () => ({ ...scope, classId: "class-other" }),
      authorize: async () => studentAccess,
      saveSubmissionDraft,
    });
    const response = await handler(
      new Request("http://localhost/api/learning/activities/activity-1/submission", {
        method: "PUT",
        body: JSON.stringify({ contentText: "text", expectedDraftRevision: 0 }),
      }),
      { params: { activityId: "activity-1" } },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      status: "denied",
      reasonCode: "student-activity-membership-required",
    });
    expect(saveSubmissionDraft).not.toHaveBeenCalled();
  });
});
