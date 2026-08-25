import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseCollaboratorManager } from "@/components/teaching/course-collaborator-manager";
import type { TeacherCourse } from "@/data/uais";

const courseId = "course-research-methods";
const grantId = "55555555-5555-4555-8555-555555555555";
const recipientUserId = "22222222-2222-4222-8222-222222222222";
const recipientEmail = "Teacher.Lin@Example.Test";
const course: TeacherCourse = {
  id: courseId,
  title: {
    "zh-CN": "大学研究方法",
    "en-US": "University Research Methods",
  },
  status: { "zh-CN": "进行中", "en-US": "In progress" },
  students: 12,
  currentFocus: { "zh-CN": "课程协作", "en-US": "Course collaboration" },
};

const activeGrant = {
  grantId,
  courseId,
  recipientUserId,
  grantedByUserId: "11111111-1111-4111-8111-111111111111",
  role: "reviewer",
  scopes: ["course.grading.manage", "course.read"],
  status: "active",
  revision: 1,
  grantedAt: "2026-08-26T00:00:00.000Z",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function openPanel(locale: "zh-CN" | "en-US" = "zh-CN") {
  render(<CourseCollaboratorManager course={course} locale={locale} />);
  const name =
    locale === "zh-CN"
      ? "管理大学研究方法的协作者"
      : "Manage collaborators for University Research Methods";
  const toggle = screen.getByRole("button", { name });
  fireEvent.click(toggle);
  return toggle;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("teaching-course collaborator panel", () => {
  it("is wired into every course-settings card", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/components/pages/teaching-page-course-settings-workspace.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      'import { CourseCollaboratorManager } from "@/components/teaching/course-collaborator-manager";',
    );
    expect(source).toContain(
      "<CourseCollaboratorManager course={course} locale={locale} />",
    );
  });

  it("loads only after expansion and renders an address-free grant", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        status: "read",
        courseId,
        grants: [activeGrant],
        traceId: "trace-list",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CourseCollaboratorManager course={course} locale="zh-CN" />);
    const toggle = screen.getByRole("button", {
      name: "管理大学研究方法的协作者",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = await screen.findByRole("region", {
      name: "大学研究方法课程协作者",
    });
    expect(
      await within(panel).findByText("22222222…2222"),
    ).toBeTruthy();
    const grantRecord = within(panel)
      .getByText("22222222…2222")
      .closest("li");
    expect(grantRecord).not.toBeNull();
    expect(within(grantRecord as HTMLLIElement).getByText("评阅者")).toBeTruthy();
    expect(within(panel).getByText("管理评阅")).toBeTruthy();
    expect(within(panel).getByText("生效中")).toBeTruthy();
    expect(document.body.textContent).not.toContain("@");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/teaching/courses/${courseId}/collaborators`,
      {
        cache: "no-store",
        headers: { accept: "application/json" },
      },
    );
  });

  it("grants a collaborator and requires the persisted database readback", async () => {
    let listCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return json(
          {
            status: "persisted",
            receipt: {
              status: "persisted",
              event: "grant-issued",
              grantId,
              courseId,
              recipientUserId,
            },
          },
          201,
        );
      }
      if (url.endsWith("/collaborators")) {
        listCount += 1;
        return json({
          status: "read",
          courseId,
          grants: listCount === 1 ? [] : [activeGrant],
        });
      }
      return json({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    openPanel();

    expect(await screen.findByText("还没有课程协作者。")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("协作者邮箱"), {
      target: { value: recipientEmail },
    });
    fireEvent.change(screen.getByLabelText("协作者角色"), {
      target: { value: "reviewer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "授权协作者" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(postCall?.[0]).toBe(
      `/api/teaching/courses/${courseId}/collaborators`,
    );
    const postHeaders = new Headers(postCall?.[1]?.headers);
    expect(postHeaders.get("content-type")).toBe("application/json");
    expect(postHeaders.get("idempotency-key")).toMatch(
      /^ui-collaborator-grant-[0-9a-f-]{36}$/,
    );
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      recipientEmail,
      role: "reviewer",
      scopes: ["course.read", "course.grading.manage"],
    });
    expect(
      await screen.findByText("协作者授权已保存并从数据库读回。"),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("协作者邮箱") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByText("22222222…2222")).toBeTruthy();
  });

  it("revokes only after inline confirmation and verifies revoked readback", async () => {
    let listCount = 0;
    const revokedGrant = {
      ...activeGrant,
      status: "revoked",
      revision: 2,
      revokedAt: "2026-08-26T00:05:00.000Z",
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return json({
          status: "persisted",
          receipt: {
            status: "persisted",
            event: "grant-revoked",
            grantId,
            courseId,
            recipientUserId,
          },
        });
      }
      listCount += 1;
      return json({
        status: "read",
        courseId,
        grants: listCount === 1 ? [activeGrant] : [revokedGrant],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    openPanel();

    expect(await screen.findByText("22222222…2222")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "撤销该协作者" }));
    expect(
      screen.getByText("撤销后，该教师将立即失去这门课程的委派权限。"),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    const deleteCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "DELETE",
    );
    expect(deleteCall?.[0]).toBe(
      `/api/teaching/courses/${courseId}/collaborators/${grantId}`,
    );
    expect(
      new Headers(deleteCall?.[1]?.headers).get("idempotency-key"),
    ).toMatch(/^ui-collaborator-revoke-[0-9a-f-]{36}$/);
    expect(
      await screen.findByText("撤销已保存并从数据库读回。"),
    ).toBeTruthy();
    expect(screen.getByText("已撤销")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "撤销该协作者" }),
    ).toBeNull();
  });

  it("reuses one grant idempotency key after an uncertain network failure", async () => {
    let postCount = 0;
    let listCount = 0;
    const idempotencyKeys: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postCount += 1;
        idempotencyKeys.push(
          new Headers(init.headers).get("idempotency-key") ?? "",
        );
        if (postCount === 1) throw new TypeError("network disconnected");
        return json({
          status: "persisted",
          receipt: {
            status: "persisted",
            event: "grant-issued",
            grantId,
            courseId,
            recipientUserId,
          },
        });
      }
      listCount += 1;
      return json({
        status: "read",
        courseId,
        grants: listCount === 1 ? [] : [activeGrant],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    openPanel();

    expect(await screen.findByText("还没有课程协作者。")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("协作者邮箱"), {
      target: { value: recipientEmail },
    });
    fireEvent.click(screen.getByRole("button", { name: "授权协作者" }));
    expect(
      await screen.findByText(
        "无法确认授权是否已保存。请保持表单不变后重试，系统会复用同一请求键。",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "授权协作者" }));
    expect(
      await screen.findByText("协作者授权已保存并从数据库读回。"),
    ).toBeTruthy();
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
  });

  it("maps auth failures without rendering raw server details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          {
            status: "denied",
            reasonCode: "authenticated-session-required",
            unsafe: recipientEmail,
          },
          401,
        ),
      ),
    );
    openPanel();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "登录状态已失效，请重新登录后再管理协作者。",
    );
    expect(alert.textContent).not.toContain("authenticated-session-required");
    expect(alert.textContent).not.toContain(recipientEmail);
  });

  it("provides an English course-specific accessible toggle name", () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ grants: [] })));
    render(<CourseCollaboratorManager course={course} locale="en-US" />);

    expect(
      screen
        .getByRole("button", {
          name: "Manage collaborators for University Research Methods",
        })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
