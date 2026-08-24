import { describe, expect, it } from "vitest";
import { createLearningRecordAnalyticsGetHandler } from "@/app/api/learning-records/analytics/handler";
import {
  createAdaptiveEvidenceFromXapiStatements,
  recommendNextLesson,
  type AdaptiveLesson,
} from "@/lib/adaptive-learning/recommendations";
import { createLearnerProfileFromXapiStatements } from "@/lib/learning-records/learner-profile";
import { createLearningEventStatement } from "@/lib/learning-records/xapi-events";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const env = {
  NODE_ENV: "development",
  UAIS_APP_SESSION_SIGNING_SECRET: "learner-profile-test-session-secret",
  UAIS_LRS_ENDPOINT: "https://lrs.example.test/xapi/",
  UAIS_LRS_USERNAME: "lrs-user",
  UAIS_LRS_PASSWORD: "lrs-password",
  UAIS_LRS_XAPI_VERSION: "1.0.3",
};

const statements = [
  createLearningEventStatement({
    actor: { id: "student-001", role: "learner", displayName: "Private Student" },
    event: {
      type: "lesson.viewed",
      object: {
        id: "research-methods/unit-1",
        name: "Research questions",
        type: "lesson",
      },
      result: {
        completion: true,
        response: "raw private viewing note",
      },
      context: {
        courseId: "research-methods",
        classId: "class-rm-2026-a",
        lessonId: "unit-1",
        locale: "en-US",
      },
    },
    statementId: "statement-unit-1-viewed",
    timestamp: "2026-07-08T08:00:00.000Z",
  }),
  createLearningEventStatement({
    actor: { id: "student-001", role: "learner", displayName: "Private Student" },
    event: {
      type: "question.answered",
      object: {
        id: "research-methods/unit-2/question-1",
        name: "Variable relationship check",
        type: "assessment-question",
      },
      result: {
        success: false,
        completion: false,
        response: "raw wrong answer",
        score: { scaled: 0.4 },
      },
      context: {
        courseId: "research-methods",
        classId: "class-rm-2026-a",
        lessonId: "unit-2",
        competencyIds: ["variable-reasoning"],
        locale: "en-US",
      },
    },
    statementId: "statement-unit-2-low-score",
    timestamp: "2026-07-08T08:10:00.000Z",
  }),
  createLearningEventStatement({
    actor: { id: "student-001", role: "learner", displayName: "Private Student" },
    event: {
      type: "competency.mastered",
      object: {
        id: "competency-evidence-coding",
        name: "Evidence coding",
        type: "competency",
      },
      result: {
        success: true,
        completion: true,
        score: { scaled: 1 },
      },
      context: {
        courseId: "research-methods",
        classId: "class-rm-2026-a",
        lessonId: "unit-3",
        competencyIds: ["evidence-coding"],
        locale: "en-US",
      },
    },
    statementId: "statement-unit-3-mastered",
    timestamp: "2026-07-08T08:20:00.000Z",
  }),
];

describe("B-17 learner profile projection", () => {
  it("creates a queryable learner profile from persisted xAPI statements without raw responses", () => {
    const profile = createLearnerProfileFromXapiStatements({
      statements,
      courseId: "research-methods",
      generatedAt: "2026-07-08T09:00:00.000Z",
    });
    const serialized = JSON.stringify(profile);

    expect(profile).toMatchObject({
      target: "learner-profile",
      status: "ready",
      courseId: "research-methods",
      classActivityRef: "https://uais.top/xapi/activities/classes/class-rm-2026-a",
      eventCount: 3,
      latestTimestamp: "2026-07-08T08:20:00.000Z",
      rulesVersion: "xapi-profile-v1",
      progress: {
        activeLessonCount: 3,
        completedLessonCount: 2,
        completionRate: 0.67,
        averageScore: 0.7,
      },
      completedLessonIds: ["unit-1", "unit-3"],
      masteredCompetencyIds: ["evidence-coding"],
      weakCompetencyIds: ["variable-reasoning"],
      redaction: {
        rawResponsesOmitted: true,
        learnerDisplayNameOmitted: true,
      },
    });
    expect(profile.learner).toEqual({
      fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
      valueRedacted: true,
      displayNameOmitted: true,
    });
    expect(profile.lessons.find((lesson) => lesson.lessonId === "unit-2")).toMatchObject({
      answeredCount: 1,
      completed: false,
      bestScore: 0.4,
      weakEvidenceCount: 1,
      competencyIds: ["variable-reasoning"],
    });
    expect(serialized).not.toContain("raw wrong answer");
    expect(serialized).not.toContain("raw private viewing note");
    expect(serialized).not.toContain("Private Student");
    expect(serialized).not.toContain("student-001");
  });

  it("ignores non-finite scaled scores instead of poisoning aggregates with NaN", () => {
    const profile = createLearnerProfileFromXapiStatements({
      statements: [
        createLearningEventStatement({
          actor: { id: "student-002", role: "learner" },
          event: {
            type: "question.answered",
            object: {
              id: "research-methods/unit-9/question-1",
              name: "Corrupt score check",
              type: "assessment-question",
            },
            result: { score: { scaled: Number.POSITIVE_INFINITY } },
            context: {
              courseId: "research-methods",
              lessonId: "unit-9",
              locale: "en-US",
            },
          },
          statementId: "statement-unit-9-corrupt-score",
          timestamp: "2026-07-08T08:30:00.000Z",
        }),
      ],
      courseId: "research-methods",
      generatedAt: "2026-07-08T09:00:00.000Z",
    });

    const lesson = profile.lessons.find((item) => item.lessonId === "unit-9");
    expect(lesson).toBeTruthy();
    expect(lesson?.bestScore).toBeNull();
    expect(lesson?.averageScore).toBeNull();
    expect(profile.progress.averageScore).toBeNull();
  });

  it("feeds the deterministic recommendation service from the same profile evidence path", () => {
    const lessons: AdaptiveLesson[] = [
      { id: "unit-1", courseId: "research-methods", position: 1, title: "Research questions" },
      {
        id: "unit-2",
        courseId: "research-methods",
        position: 2,
        title: "Variable relationships",
        competencyIds: ["variable-reasoning"],
      },
      { id: "unit-3", courseId: "research-methods", position: 3, title: "Evidence coding" },
    ];
    const recommendation = recommendNextLesson({
      courseId: "research-methods",
      lessons,
      evidence: createAdaptiveEvidenceFromXapiStatements(statements),
      generatedAt: "2026-07-08T09:05:00.000Z",
    });

    expect(recommendation).toMatchObject({
      target: "adaptive-recommendation",
      status: "ready",
      nextLessonId: "unit-2",
      reasonCode: "reinforce-low-score",
      evidence: {
        completedLessonIds: ["unit-1", "unit-3"],
        weakCompetencyIds: ["variable-reasoning"],
        rawResponsesOmitted: true,
        learnerIdentityOmitted: true,
      },
    });
  });

  it("exposes a privacy-minimized learner-profile analytics scope", async () => {
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "student-001",
        role: "student",
        displayName: "Private Student",
        department: "UAIS",
      },
      {
        env,
        now: new Date("2026-07-08T08:00:00.000Z"),
        ttlSeconds: 365 * 24 * 60 * 60,
      },
    );
    const handler = createLearningRecordAnalyticsGetHandler({
      env,
      getStatements: async () => ({
        statements,
        more: "",
        redaction: {
          endpoint: "fingerprinted",
          credentials: "omitted",
          rawStatements: "summarized",
        },
      }),
    });

    const response = await handler(
      new Request(
        "http://localhost/api/learning-records/analytics?scope=learner-profile&actorId=student-001&courseId=research-methods",
        { headers: { cookie: studentCookie } },
      ),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      target: "learning-record-analytics",
      status: "summarized",
      scope: "learner-profile",
      access: {
        status: "authorized",
        reasonCode: "learner-self-scope-authorized",
      },
      query: {
        targeted: true,
        filters: ["agent"],
      },
      summary: {
        target: "learner-profile",
        progress: {
          completedLessonCount: 2,
        },
        weakCompetencyIds: ["variable-reasoning"],
        redaction: {
          rawResponsesOmitted: true,
        },
      },
    });
    expect(serialized).not.toContain("raw wrong answer");
    expect(serialized).not.toContain("Private Student");
    expect(serialized).not.toContain("student-001");
    expect(serialized).not.toContain("lrs-password");
  });
});
