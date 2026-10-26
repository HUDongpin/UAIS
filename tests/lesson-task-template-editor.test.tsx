import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LessonTaskTemplateEditor } from "@/components/pages/lesson-task-template-editor";
import type { LessonTaskTemplate } from "@/lib/classroom-lessons/domain";
const bi = (value: string) => ({ "zh-CN": value, "en-US": value });
describe("lesson task authoring", () => {
  it("edits primary-language instructions and private checkpoint guidance before publishing without fabricating translation", () => {
    const task: LessonTaskTemplate = {
      id: "task1",
      title: bi("任务"),
      instructions: bi("原说明"),
      checkpoint: {
        kind: "short-answer",
        prompt: bi("问题"),
        explanation: bi("参考"),
      },
      rubric: [{ id: "a", label: bi("证据") }],
      aiPolicy: "disabled",
    };
    const change = vi.fn();
    render(
      <LessonTaskTemplateEditor
        task={task}
        primaryLocale="zh-CN"
        locale="zh-CN"
        onChange={change}
      />,
    );
    fireEvent.change(screen.getByLabelText("任务说明"), {
      target: { value: "修改说明" },
    });
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: bi("修改说明") }),
    );
    fireEvent.change(screen.getByLabelText("检查题解释（作答后可见）"), {
      target: { value: "新参考" },
    });
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: expect.objectContaining({ explanation: bi("新参考") }),
      }),
    );
  });
});
