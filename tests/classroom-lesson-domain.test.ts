import { describe, expect, it } from "vitest";
import {
  normalizeLessonPackage,
  lessonPackageFromUnitDraft,
  studentLessonContent,
  activityDraftFromTemplate,
} from "@/lib/classroom-lessons/domain";

export const packageFixture = () => ({
  schemaVersion: 1,
  primaryLocale: "zh-CN",
  studentContent: {
    title: "第一课",
    objectives: ["辨别证据"],
    body: "讨论可检验的主张。",
    questions: [{ id: "q1", prompt: "什么是证据？" }],
  },
  teacherGuide: {
    notes: "教师私有说明",
    answers: [{ questionId: "q1", answer: "PRIVATE-ANSWER" }],
  },
  tasks: [
    {
      id: "task1",
      title: "比较证据",
      instructions: "写出理由",
      checkpoint: {
        kind: "short-answer",
        prompt: "列出一个证据",
        explanation: "证据应可核验",
      },
      rubric: [
        { id: "claim", label: "主张" },
        { id: "evidence", label: "证据" },
        { id: "reasoning", label: "推理" },
      ],
      aiPolicy: "disabled",
    },
  ],
});

describe("classroom lesson package", () => {
  it("permits an empty editable draft but refuses to publish empty materials", () => {
    const input = packageFixture();
    input.studentContent.title = "";
    input.studentContent.body = "";
    input.tasks = [];
    expect(() => normalizeLessonPackage(input)).toThrow(
      "lesson-title-required",
    );
    expect(
      normalizeLessonPackage(input, { allowIncomplete: true }).studentContent
        .body,
    ).toBe("");
  });
  it("accepts a text-only lesson and explicitly preserves primary-language text in untranslated task fields", () => {
    const value = normalizeLessonPackage(packageFixture());
    expect(value.studentContent.body).toContain("讨论");
    expect(value.tasks[0].title).toEqual({
      "zh-CN": "比较证据",
      "en-US": "比较证据",
    });
    expect(
      activityDraftFromTemplate(value.tasks[0], "lesson-1", "class-1"),
    ).toMatchObject({
      lessonKey: "lesson-1",
      targetClassId: "class-1",
      status: "draft",
    });
  });
  it("never serializes private answers or task checkpoint explanations in student materials", () => {
    const value = normalizeLessonPackage(packageFixture());
    const visible = JSON.stringify(studentLessonContent(value));
    expect(visible).not.toContain("PRIVATE-ANSWER");
    expect(visible).not.toContain("teacherGuide");
    expect(visible).not.toContain("证据应可核验");
  });
  it("rejects injected student answer fields rather than spreading them into public content", () => {
    const input = packageFixture();
    Object.assign(input.studentContent, { referenceAnswer: "private" });
    expect(() => normalizeLessonPackage(input)).toThrow(
      "lesson-student-content-fields-invalid",
    );
  });
  it("rejects duplicate task identities and unknown answer targets", () => {
    const input = packageFixture();
    input.tasks.push(input.tasks[0]);
    expect(() => normalizeLessonPackage(input)).toThrow(
      "lesson-task-id-duplicate",
    );
    const other = packageFixture();
    other.teacherGuide.answers[0].questionId = "unknown";
    expect(() => normalizeLessonPackage(other)).toThrow(
      "lesson-answer-question-invalid",
    );
  });
  it("imports a saved teacher draft as a separate lesson without exposing answers", () => {
    const result = lessonPackageFromUnitDraft(
      {
        title: "草稿",
        objectives: ["目标"],
        lectureScript: "讲解",
        activities: [
          { title: "讨论", durationMinutes: 5, instructions: "说明" },
        ],
        questions: [{ prompt: "问题", referenceAnswer: "SECRET" }],
      },
      "zh-CN",
    );
    expect(result.studentContent.questions[0].prompt).toBe("问题");
    expect(result.teacherGuide.answers[0].answer).toBe("SECRET");
    expect(JSON.stringify(studentLessonContent(result))).not.toContain(
      "SECRET",
    );
  });
});
