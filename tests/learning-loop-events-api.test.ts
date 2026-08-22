import { describe, expect, it, vi } from "vitest";
import { POST as learningRecordEventPost } from "@/app/api/learning-records/events/route";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const createLearningRecordEventPostHandler =
  learningRecordEventPost.createForTesting;
const env = { UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais" };
const studentCookie = createUaisAppSessionCookie(
  {
    account: "student-1",
    role: "student",
    displayName: "Student One",
    department: "Education",
  },
  { env },
);

function eventRequest(body: unknown) {
  return new Request("http://localhost/api/learning-records/events", {
    method: "POST",
    headers: { cookie: studentCookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("transactional learning-record event API", () => {
  it("returns persisted only after the Postgres writer resolves", async () => {
    let resolvePersist: ((value: unknown) => void) | undefined;
    const persist = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePersist = resolve;
        }),
    );
    const handler = createLearningRecordEventPostHandler({
      env,
      authorizeLearnerEvent: async () => ({
        status: "authorized",
        reasonCode: "learner-course-membership-approved",
        responsibleSession: "S12",
        classId: "class-1",
      }),
      persist,
    });
    const responsePromise = handler(
      eventRequest({
        actorId: "student-1",
        idempotencyKey: "event-1",
        event: {
          type: "lesson.viewed",
          object: { id: "course-1/lesson-1", name: "Lesson one" },
          context: { courseId: "course-1", classId: "client-forged-class" },
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        studentAccount: "student-1",
        classExternalId: "class-1",
        idempotencyKey: "event-1",
      }),
    );
    resolvePersist?.({
      status: "persisted",
      resourceId: "event-id",
      state: "persisted",
      revision: 1,
      eventId: "event-id",
      traceId: "trace-id",
      persistedAt: "2026-08-20T18:10:00.000Z",
    });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "persisted",
      resourceId: "event-id",
      eventId: "event-id",
    });
  });

  it("drops raw response/score fields before the authoritative event and outbox path", async () => {
    const persist = vi.fn(async () => ({
      status: "persisted" as const,
      resourceId: "event-id",
      state: "persisted",
      revision: 1,
      eventId: "event-id",
      traceId: "trace-id",
      persistedAt: "2026-08-20T18:10:00.000Z",
    }));
    const handler = createLearningRecordEventPostHandler({
      env,
      authorizeLearnerEvent: async () => ({
        status: "authorized",
        reasonCode: "learner-course-membership-approved",
        responsibleSession: "S12",
        classId: "class-1",
      }),
      persist,
    });
    await handler(
      eventRequest({
        actorId: "student-1",
        idempotencyKey: "event-2",
        event: {
          type: "question.answered",
          object: { id: "question-1", name: "Checkpoint" },
          result: {
            success: true,
            completion: true,
            response: "private student response",
            score: { raw: 100 },
          },
          context: { courseId: "course-1" },
        },
      }),
    );

    const persistedInput = persist.mock.calls[0]?.[0];
    expect(JSON.stringify(persistedInput)).not.toContain("private student response");
    expect(JSON.stringify(persistedInput)).not.toContain('"score"');
    expect(persistedInput.event.result).toEqual({ success: true, completion: true });
  });

  it("never calls the writer for another actor or an unapproved course", async () => {
    const persist = vi.fn();
    const handler = createLearningRecordEventPostHandler({
      env,
      authorizeLearnerEvent: async () => ({
        status: "denied",
        reasonCode: "learner-course-membership-required",
        responsibleSession: "S12",
      }),
      persist,
    });

    const wrongActor = await handler(
      eventRequest({
        actorId: "student-2",
        event: {
          type: "lesson.viewed",
          object: { id: "lesson-1", name: "Lesson" },
          context: { courseId: "course-1" },
        },
      }),
    );
    expect(wrongActor.status).toBe(403);

    const denied = await handler(
      eventRequest({
        actorId: "student-1",
        event: {
          type: "lesson.viewed",
          object: { id: "lesson-1", name: "Lesson" },
          context: { courseId: "course-1" },
        },
      }),
    );
    expect(denied.status).toBe(403);
    expect(persist).not.toHaveBeenCalled();
  });
});
