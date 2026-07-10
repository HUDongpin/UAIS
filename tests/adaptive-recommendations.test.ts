import { describe, expect, it } from "vitest";
import {
  createAdaptiveEvidenceFromXapiStatements,
  recommendNextLesson,
  type AdaptiveLesson,
} from "@/lib/adaptive-learning/recommendations";
import { createLearningEventStatement } from "@/lib/learning-records/xapi-events";

const lessons: AdaptiveLesson[] = [
  {
    id: "unit-1",
    courseId: "research-methods",
    position: 1,
    title: "Research questions",
  },
  {
    id: "unit-2",
    courseId: "research-methods",
    position: 2,
    title: "Variable relationships",
    competencyIds: ["variable-reasoning"],
  },
  {
    id: "unit-3",
    courseId: "research-methods",
    position: 3,
    title: "Evidence coding",
  },
];

describe("B-18 deterministic adaptive recommendations", () => {
  it("recommends the first ordered lesson when no learner evidence exists", () => {
    const recommendation = recommendNextLesson({
      courseId: "research-methods",
      lessons,
      evidence: [],
      generatedAt: "2026-07-08T12:00:00.000Z",
    });

    expect(recommendation).toMatchObject({
      target: "adaptive-recommendation",
      status: "ready",
      nextLessonId: "unit-1",
      reasonCode: "start-course",
      sourceEventId: null,
      rulesVersion: "deterministic-v1",
      generatedAt: "2026-07-08T12:00:00.000Z",
      evidence: {
        consideredLessonCount: 3,
        eventCount: 0,
        completedLessonIds: [],
        weakCompetencyIds: [],
        rawResponsesOmitted: true,
        learnerIdentityOmitted: true,
      },
    });
  });

  it("recommends a low-score lesson before advancing and omits learner identities/raw responses", () => {
    const evidence = createAdaptiveEvidenceFromXapiStatements([
      createLearningEventStatement({
        actor: { id: "student-001", role: "learner", displayName: "Private learner" },
        event: {
          type: "lesson.viewed",
          object: { id: "research-methods/unit-1", name: "Research questions", type: "lesson" },
          result: { completion: true, response: "raw learner note" },
          context: {
            courseId: "research-methods",
            lessonId: "unit-1",
            locale: "en-US",
          },
        },
        statementId: "event-unit-1-complete",
        timestamp: "2026-07-08T10:00:00.000Z",
      }),
      createLearningEventStatement({
        actor: { id: "student-001", role: "learner", displayName: "Private learner" },
        event: {
          type: "question.answered",
          object: {
            id: "research-methods/unit-2/check-1",
            name: "Variable relationship check",
            type: "assessment-question",
          },
          result: {
            completion: false,
            success: false,
            response: "student free-text answer",
            score: { scaled: 0.42 },
          },
          context: {
            courseId: "research-methods",
            lessonId: "unit-2",
            competencyIds: ["variable-reasoning"],
            locale: "en-US",
          },
        },
        statementId: "event-unit-2-low-score",
        timestamp: "2026-07-08T10:05:00.000Z",
      }),
    ]);

    const recommendation = recommendNextLesson({
      courseId: "research-methods",
      lessons,
      evidence,
      generatedAt: "2026-07-08T12:05:00.000Z",
    });

    expect(recommendation).toMatchObject({
      status: "ready",
      nextLessonId: "unit-2",
      reasonCode: "reinforce-low-score",
      sourceEventId: "event-unit-2-low-score",
      evidence: {
        latestEventId: "event-unit-2-low-score",
        completedLessonIds: ["unit-1"],
        weakCompetencyIds: ["variable-reasoning"],
        rawResponsesOmitted: true,
        learnerIdentityOmitted: true,
      },
    });
    expect(JSON.stringify(recommendation)).not.toContain("student-001");
    expect(JSON.stringify(recommendation)).not.toContain("student free-text answer");
  });

  it("continues to the next incomplete ordered lesson and marks completion deterministically", () => {
    const baseEvidence = [
      {
        id: "event-unit-1-complete",
        courseId: "research-methods",
        lessonId: "unit-1",
        verb: "completed" as const,
        completion: true,
        timestamp: "2026-07-08T10:00:00.000Z",
      },
      {
        id: "event-unit-2-passing",
        courseId: "research-methods",
        lessonId: "unit-2",
        verb: "answered" as const,
        score: 0.82,
        success: true,
        timestamp: "2026-07-08T10:10:00.000Z",
      },
      {
        id: "event-unit-2-complete",
        courseId: "research-methods",
        lessonId: "unit-2",
        verb: "completed" as const,
        completion: true,
        timestamp: "2026-07-08T10:11:00.000Z",
      },
    ];

    expect(
      recommendNextLesson({
        courseId: "research-methods",
        lessons,
        evidence: baseEvidence,
        generatedAt: "2026-07-08T12:10:00.000Z",
      }),
    ).toMatchObject({
      status: "ready",
      nextLessonId: "unit-3",
      reasonCode: "continue-sequence",
      evidence: {
        completedLessonIds: ["unit-1", "unit-2"],
        weakCompetencyIds: [],
      },
    });

    expect(
      recommendNextLesson({
        courseId: "research-methods",
        lessons,
        evidence: [
          ...baseEvidence,
          {
            id: "event-unit-3-complete",
            courseId: "research-methods",
            lessonId: "unit-3",
            verb: "completed" as const,
            completion: true,
            timestamp: "2026-07-08T10:20:00.000Z",
          },
        ],
        generatedAt: "2026-07-08T12:20:00.000Z",
      }),
    ).toMatchObject({
      status: "complete",
      nextLessonId: null,
      reasonCode: "course-complete",
      sourceEventId: "event-unit-3-complete",
    });
  });

  it("blocks when the course has no ordered lessons", () => {
    expect(
      recommendNextLesson({
        courseId: "missing-course",
        lessons,
        evidence: [],
        generatedAt: "2026-07-08T12:30:00.000Z",
      }),
    ).toMatchObject({
      status: "blocked",
      nextLessonId: null,
      reasonCode: "no-course-lessons",
      evidence: {
        consideredLessonCount: 0,
      },
    });
  });
});
