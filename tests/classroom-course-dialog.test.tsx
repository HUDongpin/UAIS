import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewCourseDialog } from "@/components/pages/teaching-page-dialogs";
import { SessionUserProvider } from "@/components/providers/session-user";

it("creates a classroom course using the signed-in teacher, not a demonstration lecturer", () => {
  render(<SessionUserProvider initialSessionUser={{ account: "pilot-teacher", role: "teacher", displayName: "课堂教师", department: "数学系" }}>
    <NewCourseDialog locale="zh-CN" teacherActorId="pilot-teacher" onCancel={vi.fn()} onCreate={vi.fn()} />
  </SessionUserProvider>);
  expect((screen.getByLabelText("讲师") as HTMLInputElement).value).toBe("课堂教师");
  expect((screen.getByLabelText("院系") as HTMLSelectElement).value).toBe("数学系");
  expect(screen.queryByText("正在使用演示教学包")).toBeNull();
});
