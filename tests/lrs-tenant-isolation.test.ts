import { describe, expect, it, vi } from "vitest";
import { createLearnerProfileFromXapiStatements } from "@/lib/learning-records/learner-profile";
import {
  createLearningEventStatement,
  isUaisProducedStatement,
  uaisLrsTenantId,
} from "@/lib/learning-records/xapi-events";
import {
  createLearningRecordQueue,
  getXapiStatements,
} from "@/lib/learning-records/lrs-recorder";
import { createUaisLrsSmokeStatement } from "@/lib/learning-records/lrs-client";

const readyLrsEnv = {
  UAIS_LRS_ENDPOINT: "https://lrs.example.test/xapi",
  UAIS_LRS_USERNAME: "lrs-user",
  UAIS_LRS_PASSWORD: "lrs-password",
  UAIS_LRS_XAPI_VERSION: "1.0.3",
};

const uaisStatement = createLearningEventStatement({
  actor: { id: "student-001", role: "learner" },
  event: {
    type: "lesson.viewed",
    object: { id: "course-1/ppt-playback/manifest-1", name: "Course PPT playback", type: "lesson" },
    context: { courseId: "course-1", locale: "zh-CN" },
  },
  statementId: "uais-s1",
  timestamp: "2026-08-02T10:00:00.000Z",
});

// A realistic statement from another application sharing the LRS store.
const foreignStatement = {
  id: "foreign-s1",
  actor: {
    objectType: "Agent" as const,
    account: {
      homePage: "https://www.aais.site/xapi/actors",
      name: "learner:aais-student-42",
    },
  },
  verb: {
    id: "https://www.aais.site/xapi/verbs/reviewed",
    display: { "en-US": "reviewed" },
  },
  object: {
    id: "https://www.aais.site/xapi/activities/courses/aais-course",
    objectType: "Activity" as const,
    definition: {
      name: { "en-US": "AAIS course" },
      type: "http://adlnet.gov/expapi/activities/course",
    },
  },
  context: {
    platform: "AAIS",
    language: "zh-CN",
  },
  timestamp: "2026-08-02T10:05:00.000Z",
};

describe("B-LRS tenant isolation", () => {
  it("recognizes UAIS-produced statements by actor homePage and event-type extension", () => {
    expect(isUaisProducedStatement(uaisStatement)).toBe(true);
    expect(
      isUaisProducedStatement(
        createUaisLrsSmokeStatement({ runId: "smoke-1", timestamp: "2026-08-02T10:00:00.000Z" }),
      ),
    ).toBe(true);
    expect(
      isUaisProducedStatement({
        ...foreignStatement,
        context: {
          ...foreignStatement.context,
          extensions: {
            "https://uais.top/xapi/extensions/event-type": "lesson.viewed",
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects foreign and malformed statements", () => {
    expect(isUaisProducedStatement(foreignStatement)).toBe(false);
    expect(isUaisProducedStatement(undefined)).toBe(false);
    expect(isUaisProducedStatement("statement")).toBe(false);
    expect(isUaisProducedStatement({})).toBe(false);
  });

  it("filters foreign statements out of targeted LRS reads", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ statements: [uaisStatement, foreignStatement], more: "" }),
    );

    const result = await getXapiStatements({
      env: readyLrsEnv,
      fetch: fetchMock,
      query: { agent: { role: "learner", id: "student-001" }, limit: 50 },
    });

    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]?.id).toBe("uais-s1");
  });

  it("stamps the UAIS tenant extension on every flushed statement", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const queue = createLearningRecordQueue({
      env: readyLrsEnv,
      fetch: fetchMock,
      now: () => "2026-08-02T10:00:00.000Z",
    });

    queue.enqueue({
      actor: { id: "student-001", role: "learner" },
      event: {
        type: "lesson.viewed",
        object: { id: "course-1/lesson-1", name: "Lesson one", type: "lesson" },
        context: { courseId: "course-1", locale: "zh-CN" },
      },
      idempotencyKey: "student-001:lesson.viewed:course-1:lesson-1",
    });
    await queue.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const statement = JSON.parse(String(init.body)) as {
      context?: { extensions?: Record<string, unknown> };
    };
    expect(statement.context?.extensions?.["https://uais.top/xapi/extensions/tenant-id"]).toBe(
      uaisLrsTenantId,
    );
  });

  it("treats a same-id 409 conflict as an already-stored idempotent write", async () => {
    const fetchMock = vi.fn(async () => new Response("conflict", { status: 409 }));
    const queue = createLearningRecordQueue({
      env: readyLrsEnv,
      fetch: fetchMock,
      now: () => "2026-08-02T10:00:00.000Z",
    });

    queue.enqueue({
      actor: { id: "student-001", role: "learner" },
      event: {
        type: "lesson.viewed",
        object: { id: "course-1/lesson-1", name: "Lesson one", type: "lesson" },
        context: { courseId: "course-1", locale: "zh-CN" },
      },
      idempotencyKey: "student-001:lesson.viewed:course-1:lesson-1:conflict",
    });
    const result = await queue.flush();

    // No retries: the deterministic statement id already exists in the LRS.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ attempted: 1, written: 1, failed: 0 });
  });

  it("keeps non-lesson client events out of learner-profile lesson accounting", () => {
    const chatStatement = createLearningEventStatement({
      actor: { id: "student-001", role: "learner" },
      event: {
        type: "collaboration.contributed",
        object: {
          id: "course-1/chatrooms/research-method-group",
          name: "Human-AI group chatroom",
          type: "collaboration",
        },
        context: { courseId: "course-1", cohortId: "research-method-group", locale: "zh-CN" },
      },
      statementId: "chat-s1",
      timestamp: "2026-08-02T10:10:00.000Z",
    });
    const lessonStatement = createLearningEventStatement({
      actor: { id: "student-001", role: "learner" },
      event: {
        type: "lesson.viewed",
        object: { id: "course-1/ppt-playback/manifest-1", name: "PPT playback", type: "lesson" },
        context: { courseId: "course-1", lessonId: "manifest-1", locale: "zh-CN" },
      },
      statementId: "lesson-s1",
      timestamp: "2026-08-02T10:11:00.000Z",
    });

    const profile = createLearnerProfileFromXapiStatements({
      statements: [chatStatement, lessonStatement],
      courseId: "course-1",
      generatedAt: "2026-08-02T11:00:00.000Z",
    });

    // The chatroom activity must not mint a phantom "research-method-group"
    // lesson that would drag completionRate down forever.
    expect(profile.progress.activeLessonCount).toBe(1);
    expect(profile.lessons.map((lesson) => lesson.lessonId)).toEqual(["manifest-1"]);
    expect(profile.eventCount).toBe(2);
  });

  it("preserves an explicitly provided tenant id", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const queue = createLearningRecordQueue({
      env: readyLrsEnv,
      fetch: fetchMock,
      now: () => "2026-08-02T10:00:00.000Z",
    });

    queue.enqueue({
      actor: { id: "student-001", role: "learner" },
      event: {
        type: "lesson.viewed",
        object: { id: "course-1/lesson-1", name: "Lesson one", type: "lesson" },
        context: { courseId: "course-1", tenantId: "uais-demo", locale: "zh-CN" },
      },
      idempotencyKey: "student-001:lesson.viewed:course-1:lesson-1:demo",
    });
    await queue.flush();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const statement = JSON.parse(String(init.body)) as {
      context?: { extensions?: Record<string, unknown> };
    };
    expect(statement.context?.extensions?.["https://uais.top/xapi/extensions/tenant-id"]).toBe(
      "uais-demo",
    );
  });
});
