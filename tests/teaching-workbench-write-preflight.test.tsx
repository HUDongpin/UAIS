import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeachingPage } from "@/components/pages/teaching-page";

const mockPreferences = vi.hoisted(() => ({
  locale: "zh-CN" as "zh-CN" | "en-US",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: ReactNode;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({
    locale: mockPreferences.locale,
    theme: "light",
    toggleLocale: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

afterEach(() => {
  mockPreferences.locale = "zh-CN";
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

async function chooseWorkspaceCourse(courseId: string) {
  const courseSelect = screen.getByLabelText("工作台操作课程");
  await waitFor(() => {
    expect(courseSelect.querySelector(`option[value="${courseId}"]`)).toBeTruthy();
  });
  fireEvent.change(courseSelect, { target: { value: courseId } });
}

describe("teaching workbench write preflight", () => {
  it("disables remaining catalog-demo mutations up front with the ownership explanation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/courses") {
        return Response.json({
          courses: [],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "phoebe",
            status: "read",
          },
        });
      }
      return Response.json({ error: "unexpected-write" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/teaching");

    render(<TeachingPage />);

    expect(
      await screen.findByText(/当前显示的是演示课程卡片/),
    ).toBeTruthy();

    const newClassButton = screen.getByRole("button", {
      name: "为大学研究方法新建班级",
    });
    expect(newClassButton).toHaveProperty("disabled", true);
    expect(
      screen.getAllByText("当前账号不是这门课程的授课教师，写入操作已关闭。").length,
    ).toBeGreaterThan(0);

    await chooseWorkspaceCourse("teacher-research-methods");
    expect(screen.getByRole("button", { name: "保存课程设置" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("课程名称")).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    expect(
      (await screen.findAllByText("当前账号不是这门课程的授课教师，写入操作已关闭。")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "生成新邀请码" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "确认发布邀请码" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(newClassButton);
    expect(screen.queryByRole("dialog", { name: "新建班级" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/teaching/courses/teacher-research-methods/classes"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps catalog new-class disabled until the owned-course list resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    window.history.replaceState(null, "", "/teaching");

    render(<TeachingPage />);

    const newClassButton = screen.getByRole("button", {
      name: "为大学研究方法新建班级",
    });
    expect(newClassButton).toHaveProperty("disabled", true);
    expect(
      screen.queryByText("当前账号不是这门课程的授课教师，写入操作已关闭。"),
    ).toBeNull();

    fireEvent.click(newClassButton);
    expect(screen.queryByRole("dialog", { name: "新建班级" })).toBeNull();
  });

  it("disables selected-course inline and invite writes while ownership is unresolved", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/teaching");

    render(<TeachingPage />);

    expect(screen.getByRole("button", { name: "保存课程设置" })).toHaveProperty("disabled", true);

    await chooseWorkspaceCourse("teacher-research-methods");

    const saveButton = screen.getByRole("button", { name: "保存课程设置" });
    expect(saveButton).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("课程名称")).toHaveProperty("disabled", true);
    expect(
      screen.getByText("正在确认课程所有权，写入操作暂不可用。"),
    ).toBeTruthy();
    expect(
      screen.queryByText("当前账号不是这门课程的授课教师，写入操作已关闭。"),
    ).toBeNull();
    expect(
      document.querySelector('[data-uais-inline-workspace-course-writable="false"]'),
    ).toBeTruthy();

    fireEvent.click(saveButton);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/teaching/operations",
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    expect(screen.getByRole("button", { name: "生成新邀请码" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "确认发布邀请码" })).toHaveProperty("disabled", true);
    expect(document.querySelector('[data-uais-invite-writes-enabled="false"]')).toBeTruthy();
    expect(document.getElementById("invite-policy-expires-at")).toHaveProperty("disabled", true);
    expect(document.getElementById("invite-policy-max-joins")).toHaveProperty("disabled", true);
    expect(document.getElementById("invite-policy-disabled")).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("link", { name: "智能体配置" }));
    expect(screen.getByRole("button", { name: "保存智能体方案" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "运行权限预检" })).toHaveProperty("disabled", true);
  });

  it("keeps new-class writes enabled for a course returned by the server list", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/courses") {
        return Response.json({
          courses: [
            {
              courseId: "owned-research-methods",
              courseName: "已拥有的研究方法",
              instructor: "Phoebe",
              unit: "广州大学",
              department: "教育学院",
              semester: "2026 春季",
              students: 12,
            },
          ],
          classes: [],
          receipt: {
            action: "list-courses",
            actorId: "phoebe",
            status: "read",
          },
        });
      }
      return Response.json({ error: "unexpected-write" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/teaching");

    render(<TeachingPage />);

    const newClassButton = await screen.findByRole("button", {
      name: "为已拥有的研究方法新建班级",
    });
    expect(newClassButton).toHaveProperty("disabled", false);

    fireEvent.click(newClassButton);
    expect(screen.getByRole("dialog", { name: "新建班级" })).toBeTruthy();

    await chooseWorkspaceCourse("owned-research-methods");
    expect(screen.getByRole("button", { name: "保存课程设置" })).toHaveProperty("disabled", false);
    expect(screen.getByLabelText("课程名称")).toHaveProperty("disabled", false);
    expect(screen.queryByText("正在确认课程所有权，写入操作暂不可用。")).toBeNull();
    expect(
      screen.queryByText("当前账号不是这门课程的授课教师，写入操作已关闭。"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "邀请码" }));
    expect(document.querySelector('[data-uais-invite-writes-enabled="true"]')).toBeTruthy();
  });
});
