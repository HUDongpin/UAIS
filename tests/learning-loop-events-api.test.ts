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
function eventRequest(
  body: unknown,
  options: {
    url?: string;
    origin?: string | null;
    host?: string | null;
    forwardedProto?: string;
  } = {},
) {
  const headers = new Headers({
    cookie: studentCookie,
    "content-type": "application/json",
  });
  const origin = options.origin === undefined ? "http://localhost" : options.origin;
  const host = options.host === undefined ? "localhost" : options.host;
  if (origin !== null) headers.set("origin", origin);
  if (host !== null) headers.set("host", host);
  if (options.forwardedProto !== undefined) {
    headers.set("x-forwarded-proto", options.forwardedProto);
  }
  return new Request(options.url ?? "http://localhost/api/learning-records/events", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function validEventBody() {
  return {
    actorId: "student-1",
    event: {
      type: "lesson.viewed",
      object: { id: "lesson-1", name: "Lesson one" },
      context: { courseId: "course-1" },
    },
  };
}

describe("transactional learning-record event API", () => {
  it.each([
    ["missing", { origin: null }],
    ["cross-origin", { origin: "https://attacker.example" }],
    ["non-serialized", { origin: "http://localhost/" }],
    ["missing host", { host: null }],
    ["ambiguous forwarded protocol", { forwardedProto: "https,http" }],
  ])("rejects a %s Origin boundary before authorization or persistence", async (_label, options) => {
    const authorizeLearnerEvent = vi.fn(async () => ({
      status: "authorized" as const,
      reasonCode: "learner-course-membership-approved" as const,
      responsibleSession: "S12" as const,
      classId: "class-1",
    }));
    const persist = vi.fn();
    const handler = createLearningRecordEventPostHandler({
      env,
      authorizeLearnerEvent,
      persist,
    });

    const response = await handler(eventRequest(validEventBody(), options));
    const responseBody = await response.json();

    expect(response.status).toBe(403);
    expect(responseBody).toMatchObject({
      status: "denied",
      access: { reasonCode: "learning-event-origin-invalid" },
    });
    expect(JSON.stringify(responseBody)).not.toContain("attacker.example");
    expect(authorizeLearnerEvent).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("accepts a serialized same-origin request when a safe forwarded protocol supplies HTTPS", async () => {
    const persist = vi.fn(async () => ({
      status: "persisted" as const,
      resourceId: "event-id",
      state: "persisted" as const,
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

    const response = await handler(
      eventRequest(validEventBody(), {
        url: "http://internal.invalid/api/learning-records/events",
        host: "www.uais.top",
        origin: "https://www.uais.top",
        forwardedProto: "https",
      }),
    );

    expect(response.status).toBe(200);
    expect(persist).toHaveBeenCalledOnce();
  });

  it.each([
    ["object id", { object: { id: `sensitive-object/${"x".repeat(501)}` } }],
    ["object name", { object: { name: `sensitive-name/${"x".repeat(201)}` } }],
    ["interaction type", { object: { interactionType: `sensitive-interaction/${"x".repeat(81)}` } }],
    ["duration", { result: { duration: `sensitive-duration/${"x".repeat(81)}` } }],
    ["locale", { context: { locale: `sensitive-locale/${"x".repeat(21)}` } }],
    ["competency count", { context: { competencyIds: Array.from({ length: 21 }, (_, index) => `competency-${index}`) } }],
    ["competency item", { context: { competencyIds: [`sensitive-competency/${"x".repeat(121)}`] } }],
  ])("rejects an overlength %s instead of silently truncating it", async (_label, override) => {
    const authorizeLearnerEvent = vi.fn(async () => ({
      status: "authorized" as const,
      reasonCode: "learner-course-membership-approved" as const,
      responsibleSession: "S12" as const,
      classId: "class-1",
    }));
    const persist = vi.fn();
    const handler = createLearningRecordEventPostHandler({
      env,
      authorizeLearnerEvent,
      persist,
    });
    const event = {
      type: "lesson.viewed",
      object: {
        id: "lesson-1",
        name: "Lesson one",
        ...(override.object ?? {}),
      },
      ...(override.result ? { result: override.result } : {}),
      context: {
        courseId: "course-1",
        ...(override.context ?? {}),
      },
    };

    const response = await handler(eventRequest({ actorId: "student-1", event }));
    const responseBody = await response.json();

    expect(response.status).toBe(400);
    expect(responseBody).toMatchObject({
      status: "denied",
      access: { reasonCode: "learning-event-invalid" },
    });
    expect(JSON.stringify(responseBody)).not.toContain("sensitive-");
    expect(authorizeLearnerEvent).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it.each([
    "formative-check.attempted",
    "submission.submitted",
    "submission.resubmitted",
    "submission.revision-requested",
    "submission.accepted",
    "feedback.released",
    "competency.mastered",
  ])("rejects transaction-owned event type %s before authorization or persistence", async (type) => {
    const authorizeLearnerEvent = vi.fn(async () => ({
      status: "authorized" as const,
      reasonCode: "learner-course-membership-approved" as const,
      responsibleSession: "S12" as const,
      classId: "class-1",
    }));
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
      authorizeLearnerEvent,
      persist,
    });

    const response = await handler(
      eventRequest({
        actorId: "student-1",
        event: {
          type,
          object: { id: "activity-1", name: "Protected learning-loop action" },
          context: { courseId: "course-1" },
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: "denied",
      access: { reasonCode: "learning-event-invalid" },
    });
    expect(authorizeLearnerEvent).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("derives one stable safe store key from the actor and an explicit browser key", async () => {
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
    const body = {
      actorId: "student-1",
      idempotencyKey: "browser/retry/key-with-a-slash",
      event: {
        type: "lesson.viewed",
        object: { id: "lesson-1", name: "Lesson one" },
        context: { courseId: "course-1" },
      },
    };

    await handler(eventRequest(body));
    await handler(eventRequest(body));

    const firstKey = persist.mock.calls[0]?.[0].idempotencyKey;
    const secondKey = persist.mock.calls[1]?.[0].idempotencyKey;
    expect(firstKey).toMatch(/^learning-event:[0-9a-f]{64}$/);
    expect(secondKey).toBe(firstKey);
    expect(firstKey).not.toContain("browser/retry/key-with-a-slash");
  });

  it("hashes the complete normalized event identity instead of a shared 160-character prefix", async () => {
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
    const commonObjectPrefix = `lesson-${"a".repeat(220)}`;

    for (const suffix of ["-first", "-second"]) {
      await handler(
        eventRequest({
          actorId: "student-1",
          event: {
            type: "lesson.viewed",
            object: { id: `${commonObjectPrefix}${suffix}`, name: "Lesson one" },
            context: { courseId: "course-1" },
          },
        }),
      );
    }

    const keys = persist.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^learning-event:[0-9a-f]{64}$/);
    expect(keys[1]).toMatch(/^learning-event:[0-9a-f]{64}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it.each([
    ["empty", "   "],
    ["overlarge", `sensitive-browser-key/${"x".repeat(1025)}`],
  ])("rejects an %s explicit idempotency key without leaking it", async (_label, idempotencyKey) => {
    const authorizeLearnerEvent = vi.fn(async () => ({
      status: "authorized" as const,
      reasonCode: "learner-course-membership-approved" as const,
      responsibleSession: "S12" as const,
      classId: "class-1",
    }));
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
      authorizeLearnerEvent,
      persist,
    });

    const response = await handler(
      eventRequest({
        actorId: "student-1",
        idempotencyKey,
        event: {
          type: "lesson.viewed",
          object: { id: "lesson-1", name: "Lesson one" },
          context: { courseId: "course-1" },
        },
      }),
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(400);
    expect(serialized).not.toContain("sensitive-browser-key");
    expect(authorizeLearnerEvent).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it.each([
    ["interaction type", { object: { interactionType: {} } }],
    ["lesson id", { context: { lessonId: {} } }],
    ["locale", { context: { locale: {} } }],
    ["competency ids", { context: { competencyIds: {} } }],
  ])("rejects a malformed optional %s before authorization", async (_label, malformed) => {
    const authorizeLearnerEvent = vi.fn(async () => ({
      status: "authorized" as const,
      reasonCode: "learner-course-membership-approved" as const,
      responsibleSession: "S12" as const,
      classId: "class-1",
    }));
    const persist = vi.fn();
    const handler = createLearningRecordEventPostHandler({
      env,
      authorizeLearnerEvent,
      persist,
    });
    const event = {
      type: "lesson.viewed",
      object: {
        id: "lesson-1",
        name: "Lesson one",
        ...(malformed.object ?? {}),
      },
      context: {
        courseId: "course-1",
        ...(malformed.context ?? {}),
      },
    };

    const response = await handler(eventRequest({ actorId: "student-1", event }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: "denied",
      access: { reasonCode: "learning-event-invalid" },
    });
    expect(authorizeLearnerEvent).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

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
          context: {
            courseId: "course-1",
            classId: "client-forged-class",
            courseTitle: "Client-forged course title",
            className: "Client-forged class name",
            teacherAccount: "client-forged-teacher",
          },
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        studentAccount: "student-1",
        classExternalId: "class-1",
        idempotencyKey: expect.stringMatching(/^learning-event:[0-9a-f]{64}$/),
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
    const responseBody = await response.json();
    expect(response.status).toBe(200);
    expect(responseBody).toMatchObject({
      status: "persisted",
      resourceId: "event-id",
      eventId: "event-id",
    });
    expect(responseBody.access).not.toHaveProperty("scopeProjection");
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
