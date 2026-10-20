import { describe, expect, it, vi } from "vitest";
import { generateTeachingUnitDraftContent } from "@/lib/server/teaching-unit-draft-generator";
import { isTeachingUnitDraftContent } from "@/lib/teaching/unit-draft";
import type { TeachingCourseRecord } from "@/lib/server/teaching-course-management-types";

const course: TeachingCourseRecord = {
  courseId: "teacher-course-research",
  ownerTeacherId: "teacher-a",
  courseName: "Research methods",
  description: "Developing research questions from classroom observations.",
  instructor: "Fixture", unit: "Fixture", department: "Fixture", semester: "2026",
  status: "draft", students: 0,
  createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
  storagePolicy: "local-json-teaching-course-management",
  storageWritePolicy: "atomic-json-file-replace", responsibleSession: "S12",
  redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
};
const content = {
  title: "From observations to questions",
  objectives: ["Formulate a question that can be investigated."],
  activities: [{ title: "Compare questions", durationMinutes: 15, instructions: "Identify the population and variables in each question." }],
  lectureScript: "Start with a classroom observation. Define the population and variables, then ask a question whose answer can be assessed using evidence.",
  questions: [{ prompt: "What makes a question investigable?", referenceAnswer: "A clear population, variables, and a way to collect relevant evidence." }],
};

function responseFetch(value: unknown) {
  return vi.fn<typeof fetch>(async () => Response.json({
    choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }],
  }));
}

describe("teaching unit content generator", () => {
  it.each(["zh-CN", "en-US"] as const)("uses saved course context and requested %s locale to generate structured content", async (locale) => {
    const fetch = responseFetch(content);
    expect(await generateTeachingUnitDraftContent({
      course, locale, env: { DEEPSEEK_API_KEY: "synthetic-unit-draft-key", DEEPSEEK_MODEL: "test-model" }, fetch,
    })).toEqual(content);
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(request.model).toBe("test-model");
    expect(request.messages[1].content).toContain(course.courseName);
    expect(request.messages[1].content).toContain(course.description);
    expect(request.messages[1].content).toContain(locale);
  });

  it("fails without provider configuration before making a request", async () => {
    const fetch = responseFetch(content);
    await expect(generateTeachingUnitDraftContent({ course, locale: "zh-CN", env: {}, fetch }))
      .rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["", "not json", "{}", JSON.stringify({ ...content, lectureScript: " " }), JSON.stringify({ ...content, questions: [] })])(
    "rejects malformed or incomplete content instead of returning a placeholder: %s", async (providerContent) => {
      await expect(generateTeachingUnitDraftContent({
        course, locale: "zh-CN", env: { DEEPSEEK_API_KEY: "synthetic-unit-draft-key" },
        fetch: responseFetch(providerContent),
      })).rejects.toMatchObject({ status: 502 });
    },
  );

  it("sanitizes provider error details and never exposes the raw response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(
      { error: { message: "synthetic-unit-draft-key private-provider-body" } }, { status: 502 },
    ));
    const error = await generateTeachingUnitDraftContent({
      course, locale: "en-US", env: { DEEPSEEK_API_KEY: "synthetic-unit-draft-key" }, fetch,
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 502, message: "Teaching unit draft generation failed." });
    expect(String(error)).not.toContain("synthetic-unit-draft-key");
    expect(String(error)).not.toContain("private-provider-body");
  });

  it("retains only safe provider HTTP diagnostics when generation fails", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(
      { error: { message: "private-upstream-response synthetic-unit-draft-key" } },
      { status: 402 },
    ));
    const error = await generateTeachingUnitDraftContent({
      course, locale: "zh-CN", env: { DEEPSEEK_API_KEY: "synthetic-unit-draft-key" }, fetch,
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      status: 502,
      diagnostics: { provider: "deepseek", phase: "provider", providerStatus: 402 },
    });
    expect(JSON.stringify(error)).not.toContain("private-upstream-response");
    expect(JSON.stringify(error)).not.toContain("synthetic-unit-draft-key");
  });

  it.each([
    { value: "```json\n{}\n```", phase: "parse" },
    { value: JSON.stringify({ ...content, questions: [] }), phase: "validation" },
  ])("distinguishes $phase failures without exposing generated content", async ({ value, phase }) => {
    const error = await generateTeachingUnitDraftContent({
      course, locale: "zh-CN", env: { DEEPSEEK_API_KEY: "synthetic-unit-draft-key" },
      fetch: responseFetch(value),
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 502, diagnostics: { provider: "deepseek", phase } });
    expect(JSON.stringify(error)).not.toContain(value);
  });
});

describe("teaching unit draft content validation", () => {
  it("requires every editable teaching section", () => {
    expect(isTeachingUnitDraftContent(content)).toBe(true);
    expect(isTeachingUnitDraftContent({ ...content, title: " " })).toBe(false);
    expect(isTeachingUnitDraftContent({ ...content, objectives: [] })).toBe(false);
    expect(isTeachingUnitDraftContent({ ...content, activities: [] })).toBe(false);
    expect(isTeachingUnitDraftContent({ ...content, lectureScript: " " })).toBe(false);
    expect(isTeachingUnitDraftContent({ ...content, questions: [] })).toBe(false);
    expect(isTeachingUnitDraftContent({ ...content, questions: [{ prompt: "Question?", referenceAnswer: "" }] })).toBe(false);
  });

  it("bounds durations, text, arrays, and unexpected fields", () => {
    expect(isTeachingUnitDraftContent({ ...content, activities: [{ ...content.activities[0], durationMinutes: 0 }] })).toBe(false);
    expect(isTeachingUnitDraftContent({ ...content, activities: [{ ...content.activities[0], durationMinutes: 1.5 }] })).toBe(false);
    expect(isTeachingUnitDraftContent({ ...content, title: "x".repeat(201) })).toBe(false);
    expect(isTeachingUnitDraftContent({ ...content, objectives: Array.from({ length: 13 }, () => "Objective") })).toBe(false);
    expect(isTeachingUnitDraftContent({ ...content, providerToken: "unexpected" })).toBe(false);
  });
});
