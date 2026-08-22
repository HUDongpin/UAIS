import { describe, expect, it } from "vitest";
import {
  assertLearningActivityTransition,
  assertSubmissionDecision,
  assertSubmissionTransition,
  normalizeLearningActivityDraft,
  normalizeRubricJudgments,
  normalizeSubmissionContent,
} from "@/lib/learning-loop/domain";
import {
  createDeterministicXapiStatementId,
  getLearningOutboxRetryDelayMs,
} from "@/lib/learning-loop/outbox";
import { recommendNextLearningAction } from "@/lib/learning-loop/recommendation";

function createValidActivityDraft() {
  return {
    lessonKey: "natural-number-ordinal-theory-01",
    targetClassId: "elementary-math-research-class-1",
    title: {
      "zh-CN": "解释自然数公理",
      "en-US": "Explain the axioms of natural numbers",
    },
    instructions: {
      "zh-CN": "用自己的语言解释公理之间的关系。",
      "en-US": "Explain how the axioms relate in your own words.",
    },
    checkpoint: {
      kind: "single-choice" as const,
      prompt: {
        "zh-CN": "哪一项描述了后继关系？",
        "en-US": "Which statement describes the successor relation?",
      },
      options: [
        {
          id: "a",
          label: { "zh-CN": "每个数都有后继", "en-US": "Every number has a successor" },
        },
        {
          id: "b",
          label: { "zh-CN": "每个数都相等", "en-US": "All numbers are equal" },
        },
      ],
      correctOptionId: "a",
      explanation: {
        "zh-CN": "后继规则说明自然数如何延伸。",
        "en-US": "The successor rule explains how natural numbers extend.",
      },
    },
    rubric: [
      {
        id: "accuracy",
        label: { "zh-CN": "概念准确", "en-US": "Conceptual accuracy" },
      },
      {
        id: "relationships",
        label: { "zh-CN": "关系清楚", "en-US": "Clear relationships" },
      },
      {
        id: "examples",
        label: { "zh-CN": "例子恰当", "en-US": "Appropriate examples" },
      },
    ],
    dueAt: "2026-09-10T12:00:00.000Z",
    aiPolicy: "teacher-requested-draft" as const,
    revisionPolicy: "teacher-requested" as const,
  };
}

describe("P1 learning-loop domain", () => {
  it("accepts a bilingual activity with a 3–5 item non-numeric rubric", () => {
    const activity = normalizeLearningActivityDraft(createValidActivityDraft());

    expect(activity).toMatchObject({
      lessonKey: "natural-number-ordinal-theory-01",
      status: "draft",
      version: 1,
      aiPolicy: "teacher-requested-draft",
      revisionPolicy: "teacher-requested",
    });
    expect(activity.rubric).toHaveLength(3);
  });

  it("blocks publication-shaped drafts with incomplete bilingual copy or invalid rubric size", () => {
    const missingEnglish = createValidActivityDraft();
    missingEnglish.title["en-US"] = "";
    expect(() => normalizeLearningActivityDraft(missingEnglish)).toThrowError(
      /activity-title-bilingual-required/,
    );

    const tooShort = createValidActivityDraft();
    tooShort.rubric = tooShort.rubric.slice(0, 2);
    expect(() => normalizeLearningActivityDraft(tooShort)).toThrowError(
      /activity-rubric-count-invalid/,
    );
  });

  it("allows restricted Markdown but rejects HTML and more than 20,000 Unicode characters", () => {
    expect(normalizeSubmissionContent("## 我的解释\r\n\r\n- 第一条\r\n")).toBe(
      "## 我的解释\n\n- 第一条",
    );
    expect(() => normalizeSubmissionContent("<script>alert(1)</script>")).toThrowError(
      /submission-content-html-forbidden/,
    );
    expect(() => normalizeSubmissionContent("😀".repeat(20_001))).toThrowError(
      /submission-content-too-long/,
    );
  });

  it("enforces the activity and immutable submission-version state machines", () => {
    expect(() => assertLearningActivityTransition("draft", "published")).not.toThrow();
    expect(() => assertLearningActivityTransition("published", "archived")).not.toThrow();
    expect(() => assertLearningActivityTransition("published", "draft")).toThrowError(
      /activity-transition-invalid/,
    );

    expect(() =>
      assertSubmissionTransition({ from: "draft", to: "submitted", versionNo: 1 }),
    ).not.toThrow();
    expect(() =>
      assertSubmissionTransition({ from: "submitted", to: "revision_requested", versionNo: 1 }),
    ).not.toThrow();
    expect(() =>
      assertSubmissionTransition({
        from: "revision_requested",
        to: "draft",
        versionNo: 2,
        previousVersionNo: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertSubmissionTransition({ from: "draft", to: "resubmitted", versionNo: 2 }),
    ).not.toThrow();
    expect(() =>
      assertSubmissionTransition({ from: "resubmitted", to: "accepted", versionNo: 2 }),
    ).not.toThrow();
    expect(() =>
      assertSubmissionTransition({ from: "accepted", to: "draft", versionNo: 3 }),
    ).toThrowError(/submission-transition-invalid/);
  });

  it("requires teacher-confirmed feedback for both revision and acceptance decisions", () => {
    expect(() =>
      assertSubmissionDecision({ decision: "request-revision", feedbackText: "" }),
    ).toThrowError(/decision-feedback-required/);
    expect(() =>
      assertSubmissionDecision({ decision: "accept", feedbackText: "  " }),
    ).toThrowError(/decision-feedback-required/);
    expect(
      assertSubmissionDecision({ decision: "accept", feedbackText: "论证清楚，可以进入下一单元。" }),
    ).toEqual({ decision: "accept", feedbackText: "论证清楚，可以进入下一单元。" });
  });

  it("accepts only complete non-numeric judgments for the activity rubric", () => {
    expect(
      normalizeRubricJudgments(
        {
          accuracy: "met",
          relationships: "partly-met",
          examples: "needs-revision",
        },
        ["accuracy", "relationships", "examples"],
      ),
    ).toEqual({
      accuracy: "met",
      relationships: "partly-met",
      examples: "needs-revision",
    });
    expect(() =>
      normalizeRubricJudgments({ accuracy: 4 }, ["accuracy"]),
    ).toThrowError(/feedback-rubric-judgment-invalid/);
    expect(() =>
      normalizeRubricJudgments({ accuracy: "met", hidden: "met" }, ["accuracy"]),
    ).toThrowError(/feedback-rubric-dimensions-mismatch/);
  });

  it("returns deterministic next actions in the approved priority order", () => {
    const base = [
      {
        lessonKey: "lesson-1",
        position: 1,
        checkpointAttempted: true,
        submissionState: "accepted" as const,
      },
      {
        lessonKey: "lesson-2",
        position: 2,
        checkpointAttempted: false,
        submissionState: "draft" as const,
      },
    ];

    expect(
      recommendNextLearningAction({
        units: [{ ...base[0], submissionState: "revision_requested" }, base[1]],
      }),
    ).toMatchObject({ type: "revise-submission", lessonKey: "lesson-1" });
    expect(
      recommendNextLearningAction({
        units: [{ ...base[0], submissionState: "submitted" }, base[1]],
      }),
    ).toMatchObject({ type: "await-teacher-review", lessonKey: "lesson-1" });
    expect(recommendNextLearningAction({ units: base })).toMatchObject({
      type: "complete-checkpoint",
      lessonKey: "lesson-2",
    });
    expect(recommendNextLearningAction({ units: [] })).toEqual({
      type: "collect-more-evidence",
      reasonCode: "no-published-learning-units",
    });
  });

  it("uses deterministic xAPI statement ids and the fixed durable retry schedule", () => {
    const eventId = "0e2537c8-54c3-4be1-a8df-a03838cf13ad";
    const first = createDeterministicXapiStatementId(eventId);
    expect(first).toBe(createDeterministicXapiStatementId(eventId));
    expect(first).not.toBe(
      createDeterministicXapiStatementId("b46bf45b-b337-4f56-82df-17cd5bd22bcb"),
    );
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    expect(Array.from({ length: 10 }, (_, index) => getLearningOutboxRetryDelayMs(index + 1))).toEqual([
      60_000,
      300_000,
      900_000,
      3_600_000,
      21_600_000,
      21_600_000,
      21_600_000,
      21_600_000,
      21_600_000,
      21_600_000,
    ]);
  });
});
