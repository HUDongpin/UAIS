import { describe, expect, it, vi } from "vitest";
import {
  createLearningEventStatement,
  learningEventCatalog,
  type LearningRecordEventInput,
} from "@/lib/learning-records/xapi-events";
import {
  createLearningRecordQueue,
  getXapiStatements,
  type XapiStatementsQuery,
} from "@/lib/learning-records/lrs-recorder";
import {
  summarizeLearnerTimeline,
  summarizeTeacherClassInsights,
} from "@/lib/learning-records/lrs-analytics";
import {
  createLearningRecordAnalyticsGetHandler,
} from "@/app/api/learning-records/analytics/handler";
import { POST as learningRecordEventPost } from "@/app/api/learning-records/events/route";
import { createUaisAiAccessSessionForTrustedActor } from "@/lib/server/ai-access-control";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const createLearningRecordEventPostHandler =
  learningRecordEventPost.createForTesting;
const aiAccessSigningSecret = "test-lrs-analytics-ai-access-secret";
const readyLrsEnv = {
  NODE_ENV: "development",
  UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
  UAIS_LRS_ENDPOINT: "https://lrs.example.test/xapi/",
  UAIS_LRS_USERNAME: "lrs-user",
  UAIS_LRS_PASSWORD: "lrs-password",
  UAIS_LRS_XAPI_VERSION: "1.0.3",
};

const baseEvent: LearningRecordEventInput = {
  type: "question.answered",
  object: {
    id: "research-methods/unit-3/question-2",
    name: "Variable relationship check",
    type: "assessment-question",
    interactionType: "choice",
  },
  result: {
    success: true,
    completion: true,
    score: {
      raw: 4,
      max: 5,
      scaled: 0.8,
    },
    response: "selected-option-a",
  },
  context: {
    tenantId: "uais-demo",
    courseId: "research-methods",
    classId: "class-rm-2026-a",
    lessonId: "unit-3",
    competencyIds: ["competency-variable-reasoning"],
    cohortId: "cohort-2026-summer",
    interventionId: "ai-feedback-v1",
    locale: "zh-CN",
  },
};

describe("enterprise LRS/xAPI instrumentation", () => {
  it("builds canonical privacy-minimized xAPI statements with fixed verbs and rich context", () => {
    expect(Object.keys(learningEventCatalog)).toEqual([
      "course.viewed",
      "lesson.viewed",
      "activity.attempted",
      "formative-check.attempted",
      "submission.submitted",
      "submission.resubmitted",
      "submission.revision-requested",
      "submission.accepted",
      "feedback.released",
      "question.answered",
      "course.completed",
      "competency.mastered",
      "ai.feedback.requested",
      "collaboration.contributed",
    ]);

    const statement = createLearningEventStatement({
      actor: {
        id: "student-001",
        role: "learner",
        displayName: "Should Not Be Stored",
      },
      event: baseEvent,
      statementId: "statement-question-answered",
      timestamp: "2026-06-27T14:45:00.000Z",
    });
    const serialized = JSON.stringify(statement);

    expect(statement).toMatchObject({
      id: "statement-question-answered",
      actor: {
        objectType: "Agent",
        account: {
          homePage: "https://uais.top/xapi/actors",
          name: "learner:student-001",
        },
      },
      verb: {
        id: "http://adlnet.gov/expapi/verbs/answered",
        display: { "en-US": "answered" },
      },
      object: {
        id: "https://uais.top/xapi/activities/research-methods/unit-3/question-2",
        objectType: "Activity",
        definition: {
          type: "http://adlnet.gov/expapi/activities/cmi.interaction",
          interactionType: "choice",
        },
      },
      context: {
        platform: "UAIS",
        language: "zh-CN",
        contextActivities: {
          parent: [{ id: "https://uais.top/xapi/activities/classes/class-rm-2026-a" }],
          grouping: [
            { id: "https://uais.top/xapi/activities/courses/research-methods" },
            { id: "https://uais.top/xapi/activities/cohorts/cohort-2026-summer" },
            { id: "https://uais.top/xapi/activities/interventions/ai-feedback-v1" },
          ],
          category: [
            {
              id: "https://uais.top/xapi/activities/competencies/competency-variable-reasoning",
            },
          ],
        },
      },
    });
    expect(serialized).not.toContain("Should Not Be Stored");
    expect(serialized).not.toContain("lrs-password");
    expect(() =>
      createLearningEventStatement({
        actor: { id: "student-001", role: "learner" },
        event: { ...baseEvent, type: "made.up.verb" as LearningRecordEventInput["type"] },
      }),
    ).toThrow(/Unknown UAIS learning event type/);
  });

  it("queues high-frequency writes, retries through the server recorder, and deduplicates idempotency keys", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const queue = createLearningRecordQueue({
      env: readyLrsEnv,
      fetch: fetchMock,
      now: () => "2026-06-27T14:50:00.000Z",
      maxAttempts: 2,
    });

    const queued = queue.enqueue({
      actor: { id: "student-001", role: "learner" },
      event: baseEvent,
      idempotencyKey: "student-001:question-2:answered",
    });
    const duplicate = queue.enqueue({
      actor: { id: "student-001", role: "learner" },
      event: baseEvent,
      idempotencyKey: "student-001:question-2:answered",
    });

    expect(queued).toEqual({
      target: "learning-record-store",
      status: "queued",
      idempotencyKey: "student-001:question-2:answered",
      writeMode: "async-queued",
      redaction: {
        endpoint: "fingerprinted",
        credentials: "omitted",
        rawStatement: "omitted",
      },
    });
    expect(duplicate.status).toBe("deduplicated");
    expect(fetchMock).not.toHaveBeenCalled();

    const flushed = await queue.flush();

    expect(flushed).toEqual({
      target: "learning-record-store",
      status: "flushed",
      attempted: 1,
      written: 1,
      failed: 0,
      deduplicated: 1,
      redaction: {
        endpoint: "fingerprinted",
        credentials: "omitted",
        rawStatement: "omitted",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows only targeted LRS queries and converts statements into decision-ready summaries", async () => {
    const statements = [
      createLearningEventStatement({
        actor: { id: "student-001", role: "learner" },
        event: baseEvent,
        statementId: "s1",
        timestamp: "2026-06-27T14:45:00.000Z",
      }),
      createLearningEventStatement({
        actor: { id: "student-001", role: "learner" },
        event: {
          ...baseEvent,
          type: "competency.mastered",
          object: {
            id: "competency-variable-reasoning",
            name: "Variable reasoning",
            type: "competency",
          },
          result: {
            success: true,
            completion: true,
            score: { raw: 1, max: 1, scaled: 1 },
          },
        },
        statementId: "s2",
        timestamp: "2026-06-27T14:55:00.000Z",
      }),
    ];
    const fetchMock = vi.fn(async () =>
      Response.json({
        statements,
        more: "",
      }),
    );

    const query: XapiStatementsQuery = {
      agent: { role: "learner", id: "student-001" },
      verb: "question.answered",
      activity: "https://uais.top/xapi/activities/classes/class-rm-2026-a",
      relatedActivities: true,
      limit: 50,
    };
    const result = await getXapiStatements({
      env: readyLrsEnv,
      fetch: fetchMock,
      query,
    });
    const [url, init] = fetchMock.mock.calls[0];

    expect(String(url)).toContain("/xapi/statements?");
    expect(String(url)).toContain("related_activities=true");
    expect(String(url)).toContain("limit=50");
    expect(init).toMatchObject({
      method: "GET",
      headers: {
        "X-Experience-API-Version": "1.0.3",
      },
    });
    expect(result.statements).toHaveLength(2);
    expect(() =>
      getXapiStatements({
        env: readyLrsEnv,
        fetch: fetchMock,
        query: { limit: 100 } as XapiStatementsQuery,
      }),
    ).toThrow(/at least one targeted filter/);

    expect(summarizeLearnerTimeline(statements)).toEqual({
      target: "learner-timeline",
      actorRef: "learner:student-001",
      eventCount: 2,
      latestTimestamp: "2026-06-27T14:55:00.000Z",
      completedCount: 2,
      masteredCompetencies: ["competency-variable-reasoning"],
      rawResponsesOmitted: true,
    });
    expect(summarizeTeacherClassInsights(statements)).toEqual({
      target: "teacher-class-insights",
      classActivityRef: "https://uais.top/xapi/activities/classes/class-rm-2026-a",
      learnerCount: 1,
      eventCount: 2,
      completionRate: 1,
      competencyMastery: [
        {
          competencyRef:
            "https://uais.top/xapi/activities/competencies/competency-variable-reasoning",
          masteredCount: 1,
          evidenceCount: 2,
        },
      ],
      recommendedActions: [
        "Use the mastered competency as peer-explanation evidence before the next task.",
      ],
      rawResponsesOmitted: true,
    });
  });

  it("exposes learner event and analytics routes with self-scope and class-scope privacy guards", async () => {
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "student-001",
        role: "student",
        displayName: "Student One",
        department: "UAIS",
      },
      {
        env: readyLrsEnv,
        now: new Date("2026-06-27T14:00:00.000Z"),
        ttlSeconds: 365 * 24 * 60 * 60,
      },
    );
    const teacherCookie = createUaisAppSessionCookie(
      {
        account: "teacher-kang",
        role: "teacher",
        displayName: "Prof. Kang",
        department: "UAIS",
      },
      {
        env: readyLrsEnv,
        now: new Date("2026-06-27T14:00:00.000Z"),
        ttlSeconds: 365 * 24 * 60 * 60,
      },
    );
    const postHandler = createLearningRecordEventPostHandler({
      env: readyLrsEnv,
      authorizeLearnerEvent: async () => ({
        status: "authorized",
        reasonCode: "learner-course-membership-approved",
        classId: "class-rm-2026-a",
        responsibleSession: "S12",
      }),
      persist: async ({ traceId }) => ({
        status: "persisted",
        resourceId: "event-lesson-view",
        state: "persisted",
        revision: 1,
        eventId: "event-lesson-view",
        traceId,
        persistedAt: "2026-06-27T14:50:00.000Z",
      }),
    });

    const denied = await postHandler(
      new Request("http://localhost/api/learning-records/events", {
        method: "POST",
        headers: {
          cookie: studentCookie,
          "content-type": "application/json",
          host: "localhost",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          actorId: "student-002",
          event: baseEvent,
        }),
      }),
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      access: {
        status: "denied",
        reasonCode: "learner-self-scope-required",
      },
    });

    const persisted = await postHandler(
      new Request("http://localhost/api/learning-records/events", {
        method: "POST",
        headers: {
          cookie: studentCookie,
          "content-type": "application/json",
          host: "localhost",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          actorId: "student-001",
          event: {
            ...baseEvent,
            type: "lesson.viewed",
          },
          idempotencyKey: "student-001:lesson-view",
        }),
      }),
    );
    expect(persisted.status).toBe(200);
    expect(await persisted.json()).toMatchObject({
      target: "learning-record-event",
      status: "persisted",
      eventId: "event-lesson-view",
      access: {
        status: "authorized",
        reasonCode: "learner-course-membership-approved",
      },
      redaction: {
        credentials: "omitted",
        rawStatement: "omitted",
      },
    });

    const analyticsHandler = createLearningRecordAnalyticsGetHandler({
      env: readyLrsEnv,
      authorizeAnalyticsQuery: async ({ classId }) =>
        classId === "class-rm-2026-a"
          ? {
              status: "authorized",
              reasonCode: "teacher-class-scope-authorized",
              responsibleSession: "S12",
            }
          : {
              status: "denied",
              reasonCode: "teacher-class-scope-required",
              responsibleSession: "S12",
            },
      getStatements: async () => ({
        statements: [
          createLearningEventStatement({
            actor: { id: "student-001", role: "learner" },
            event: baseEvent,
            timestamp: "2026-06-27T14:45:00.000Z",
          }),
        ],
        more: "",
        redaction: {
          endpoint: "fingerprinted",
          credentials: "omitted",
          rawStatements: "summarized",
        },
      }),
    });

    const forbiddenClass = await analyticsHandler(
      new Request(
        "http://localhost/api/learning-records/analytics?scope=teacher-class-insights&classId=class-other&courseId=research-methods",
        { headers: { cookie: teacherCookie } },
      ),
    );
    expect(forbiddenClass.status).toBe(403);
    expect(await forbiddenClass.json()).toMatchObject({
      access: {
        status: "denied",
        reasonCode: "teacher-class-scope-required",
      },
    });

    const classInsights = await analyticsHandler(
      new Request(
        "http://localhost/api/learning-records/analytics?scope=teacher-class-insights&classId=class-rm-2026-a&courseId=research-methods",
        { headers: { cookie: teacherCookie } },
      ),
    );
    expect(classInsights.status).toBe(200);
    expect(await classInsights.json()).toMatchObject({
      target: "learning-record-analytics",
      scope: "teacher-class-insights",
      query: {
        targeted: true,
        filters: ["activity", "related_activities"],
      },
      summary: {
        target: "teacher-class-insights",
        learnerCount: 1,
        rawResponsesOmitted: true,
      },
    });
  });

  // P1 replaces the lossy post-response flush with a Postgres event + outbox
  // transaction. An LRS outage therefore cannot turn a persisted classroom
  // event into an untracked background promise.
  it("acknowledges Postgres persistence without contacting the LRS inline", async () => {
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "student-001",
        role: "student",
        displayName: "Student One",
        department: "UAIS",
      },
      {
        env: readyLrsEnv,
        now: new Date("2026-06-27T14:00:00.000Z"),
        ttlSeconds: 365 * 24 * 60 * 60,
      },
    );
    const fetchMock = vi.fn(async () => new Response("upstream busy", { status: 503 }));
    const postHandler = createLearningRecordEventPostHandler({
      env: readyLrsEnv,
      fetch: fetchMock,
      now: new Date("2026-06-27T14:50:00.000Z"),
      authorizeLearnerEvent: async () => ({
        status: "authorized",
        reasonCode: "learner-course-membership-approved",
        classId: "class-rm-2026-a",
        responsibleSession: "S12",
      }),
      persist: async ({ traceId }) => ({
        status: "persisted",
        resourceId: "event-question-2",
        state: "persisted",
        revision: 4,
        eventId: "event-question-2",
        traceId,
        persistedAt: "2026-06-27T14:50:00.000Z",
      }),
    });

    const response = await postHandler(
      new Request("http://localhost/api/learning-records/events", {
        method: "POST",
        headers: {
          cookie: studentCookie,
          "content-type": "application/json",
          host: "localhost",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          actorId: "student-001",
          event: baseEvent,
          idempotencyKey: "student-001:question-2:answered",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "persisted",
      eventId: "event-question-2",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires signed admin access and an audit reason for admin LRS analytics", async () => {
    const signedAdminHeaders = createUaisAiAccessSessionForTrustedActor({
      secret: aiAccessSigningSecret,
      now: new Date("2099-01-01T00:00:00.000Z"),
      ttlSeconds: 3600,
      actor: {
        actorId: "admin-lrs-auditor",
        role: "admin",
      },
      actions: ["lrs-analytics-read"],
    }).headers;
    const analyticsHandler = createLearningRecordAnalyticsGetHandler({
      env: readyLrsEnv,
      getStatements: async () => ({
        statements: [
          createLearningEventStatement({
            actor: { id: "student-001", role: "learner" },
            event: baseEvent,
            timestamp: "2026-06-27T14:45:00.000Z",
          }),
        ],
        more: "",
        redaction: {
          endpoint: "fingerprinted",
          credentials: "omitted",
          rawStatements: "summarized",
        },
      }),
    });

    const missingAuditReason = await analyticsHandler(
      new Request(
        "http://localhost/api/learning-records/analytics?scope=admin-tenant-insights&courseId=research-methods",
        { headers: signedAdminHeaders },
      ),
    );
    expect(missingAuditReason.status).toBe(403);
    expect(await missingAuditReason.json()).toMatchObject({
      access: {
        status: "denied",
        reasonCode: "admin-audit-reason-required",
      },
    });

    const adminInsights = await analyticsHandler(
      new Request(
        "http://localhost/api/learning-records/analytics?scope=admin-tenant-insights&courseId=research-methods&auditReason=release-quality-review",
        { headers: signedAdminHeaders },
      ),
    );

    expect(adminInsights.status).toBe(200);
    expect(await adminInsights.json()).toMatchObject({
      target: "learning-record-analytics",
      scope: "admin-tenant-insights",
      access: {
        status: "authorized",
        reasonCode: "admin-audited-scope-authorized",
        audit: {
          actorId: "admin-lrs-auditor",
          reason: "release-quality-review",
          valueRedacted: true,
        },
      },
      query: {
        targeted: true,
        filters: ["activity", "related_activities"],
      },
      summary: {
        target: "teacher-class-insights",
        rawResponsesOmitted: true,
      },
    });
  });
});
