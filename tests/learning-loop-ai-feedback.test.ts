import { describe, expect, it, vi } from "vitest";
import {
  createLearningFeedbackDraftGenerator,
  hashLearningFeedbackTrace,
} from "@/lib/learning-loop/ai-feedback";

const input = {
  activity: {
    title: { "zh-CN": "解释概念", "en-US": "Explain the concept" },
    instructions: { "zh-CN": "给出论据", "en-US": "Provide evidence" },
    rubric: [
      { id: "a", label: { "zh-CN": "准确", "en-US": "Accuracy" } },
      { id: "b", label: { "zh-CN": "证据", "en-US": "Evidence" } },
      { id: "c", label: { "zh-CN": "表达", "en-US": "Clarity" } },
    ],
  },
  submission: { versionId: "version-1", contentText: "student evidence" },
  previousReleasedFeedback: ["Clarify the relationship."],
  traceId: "trace-ai-feedback-1",
};

describe("P1 AI-assisted feedback contract", () => {
  it("accepts only a complete non-numeric structured draft for the exact rubric", async () => {
    const complete = vi.fn(async () => ({
      provider: "deepseek" as const,
      model: "test-model",
      content: JSON.stringify({
        rubricJudgments: { a: "met", b: "partly-met", c: "needs-revision" },
        feedbackText: "The evidence is relevant; clarify the final relationship.",
      }),
      usage: { totalTokens: 120 },
    }));
    const generator = createLearningFeedbackDraftGenerator({ env: {}, complete });

    await expect(generator.generate(input)).resolves.toMatchObject({
      origin: "ai-assisted",
      rubricJudgments: { a: "met", b: "partly-met", c: "needs-revision" },
      feedbackText: "The evidence is relevant; clarify the final relationship.",
      provider: "deepseek",
      model: "test-model",
      usage: { totalTokens: 120 },
      aiTraceRef: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const messages = complete.mock.calls[0]?.[0].messages;
    expect(JSON.stringify(messages)).toContain("student evidence");
    expect(JSON.stringify(messages)).not.toContain("student-1");
    expect(JSON.stringify(messages)).toContain("Do not produce numeric scores");
  });

  it("rejects malformed or numeric AI output before it can become feedback", async () => {
    const generator = createLearningFeedbackDraftGenerator({
      env: {},
      complete: async () => ({
        provider: "deepseek",
        model: "test-model",
        content: JSON.stringify({
          rubricJudgments: { a: 4, b: "met", c: "met" },
          feedbackText: "Looks good.",
        }),
      }),
    });

    await expect(generator.generate(input)).rejects.toMatchObject({
      reasonCode: "ai-feedback-output-invalid",
    });
  });

  it("makes exactly one provider attempt on timeout or rate-limit failure", async () => {
    const complete = vi.fn(async () => {
      throw new Error("provider 429 or timeout");
    });
    const generator = createLearningFeedbackDraftGenerator({ env: {}, complete });

    await expect(generator.generate(input)).rejects.toMatchObject({
      reasonCode: "ai-feedback-provider-unavailable",
      details: {
        retryPolicy: "teacher-may-use-manual-feedback-or-new-request",
      },
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("rejects partial or extra-key JSON as a hidden schema failure", async () => {
    for (const content of [
      JSON.stringify({ feedbackText: "Partial response" }),
      JSON.stringify({
        rubricJudgments: { a: "met", b: "met", c: "met" },
        feedbackText: "Valid-looking text",
        automaticDecision: "accept",
      }),
    ]) {
      const generator = createLearningFeedbackDraftGenerator({
        env: {},
        complete: async () => ({ provider: "deepseek", model: "test-model", content }),
      });
      await expect(generator.generate(input)).rejects.toMatchObject({
        reasonCode: "ai-feedback-output-invalid",
        details: { studentVisible: false },
      });
    }
  });

  it("fails closed before network access when AI feedback is not explicitly enabled", async () => {
    const fetchMock = vi.fn();
    const generator = createLearningFeedbackDraftGenerator({ env: {}, fetch: fetchMock });
    await expect(generator.generate(input)).rejects.toMatchObject({
      reasonCode: "ai-feedback-provider-not-enabled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates an irreversible trace reference without embedding the submission", () => {
    const ref = hashLearningFeedbackTrace({
      provider: "deepseek",
      model: "test-model",
      traceId: "trace-ai-feedback-1",
      submissionVersionId: "version-1",
    });
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
    expect(ref).not.toContain("student evidence");
  });
});
