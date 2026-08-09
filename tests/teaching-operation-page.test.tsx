import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TeachingOperationPage } from "@/components/teaching/teaching-operation-page";

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
        event.preventDefault();
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
    locale: "zh-CN",
    theme: "light",
    toggleLocale: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

function createPersistedDomainSummary(input: {
  operationId?: string;
  actionSlot?: "primary" | "secondary" | string;
  receiptId?: string;
  courseId?: string;
  objectType?: string;
} = {}) {
  const operationId = input.operationId ?? "course-settings";
  const actionSlot = input.actionSlot ?? "primary";
  const objectType = input.objectType ?? operationId;

  return {
    status: "persisted",
    required: true,
    operationId,
    actionSlot,
    operationReceiptId: input.receiptId,
    courseId: input.courseId ?? "teacher-research-methods",
    expectedObjectTypes: [objectType],
    persistedObjectTypes: [objectType],
    missingObjectTypes: [],
    receiptCount: 1,
    storageWritePolicies: ["external-optimistic-snapshot-replace"],
    responsibleSession: "S12",
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "ids-only",
    },
  };
}

function createOperationAuditAuthSession() {
  return {
    sessionId: "teacher-operation-page-session",
    authenticatedAt: "2026-06-24T10:00:00.000Z",
    expiresAt: "2026-06-24T11:00:00.000Z",
  };
}

describe("TeachingOperationPage", () => {
  const operations = [
    ["course-settings", "课程设置"],
    ["agents", "智能体配置"],
    ["knowledge-base", "课程知识库"],
    ["content", "课程内容"],
    ["admins", "管理员设置"],
    ["students", "学生管理"],
    ["data-export", "数据导出"],
    ["dashboard", "数据看板"],
    ["quiz-board", "测验看板"],
    ["grading", "作业批改"],
    ["invite-code", "邀请码"],
  ] as const;

  it("renders an enterprise workflow page for every teaching operation entry", () => {
    operations.forEach(([operationId, title]) => {
      const { container, unmount } = render(
        <TeachingOperationPage
          action="manage"
          operationId={operationId}
          selectedCourseId="teacher-research-methods"
        />,
      );

      expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
      expect(screen.getByRole("link", { name: "返回我的教学" }).getAttribute("href")).toBe(
        "/teaching",
      );
      expect(screen.getByText(`企业级流程：${title}`)).toBeTruthy();
      expect(screen.getByText("已选择课程：大学研究方法")).toBeTruthy();
      expect(container.querySelector(`[data-uais-teaching-operation="${operationId}"]`)).toBeTruthy();
      expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(2);

      unmount();
    });
  });

  it("keeps the eleven teaching operation entries in a vertical enterprise side menu", () => {
    const { container } = render(<TeachingOperationPage operationId="knowledge-base" />);

    const nav = screen.getByRole("navigation", { name: "教学操作页面" });
    expect(nav.getAttribute("data-uais-operation-menu-orientation")).toBe("vertical");
    expect(nav.className).not.toContain("overflow-x-auto");

    const links = Array.from(nav.querySelectorAll("a"));
    expect(links).toHaveLength(operations.length);
    expect(links.map((link) => link.textContent?.trim())).toEqual(
      operations.map(([, title]) => title),
    );
    expect(container.querySelector('[data-uais-operation-layout="vertical-menu"]')).toBeTruthy();
    expect(screen.getByRole("link", { name: "课程知识库" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("carries the selected course through side-menu navigation", () => {
    render(
      <TeachingOperationPage
        action="manage"
        operationId="knowledge-base"
        selectedCourseId="teacher-research-methods"
      />,
    );

    const nav = screen.getByRole("navigation", { name: "教学操作页面" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links).toHaveLength(operations.length);
    links.forEach((link) => {
      expect(link.getAttribute("href")).toContain("?course=teacher-research-methods");
    });
    // The source action names the card that opened the first page, so it must not
    // travel to a sibling operation the teacher navigates to next.
    expect(nav.querySelector('a[href*="action="]')).toBeNull();
  });

  it("keeps side-menu links unscoped when no course context was supplied", () => {
    render(<TeachingOperationPage operationId="knowledge-base" />);

    const nav = screen.getByRole("navigation", { name: "教学操作页面" });
    expect(screen.getByRole("link", { name: "学生管理" }).getAttribute("href")).toBe(
      "/teaching/students",
    );
    expect(nav.querySelector('a[href*="?course="]')).toBeNull();
    expect(screen.getByText("未选择课程：教学操作需要课程上下文。")).toBeTruthy();
  });

  it("names the missing course context instead of blaming sign-in or permissions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "UAIS teaching operation course access is required.",
          traceId: "trace-course-id-required",
          access: {
            status: "denied",
            reasonCode: "course-id-required",
            responsibleSession: "S12",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    try {
      render(<TeachingOperationPage operationId="course-settings" />);

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

      await waitFor(() => {
        expect(
          screen.getByText("未保存到服务器：缺少课程上下文，请从课程卡片进入。"),
        ).toBeTruthy();
      });
      expect(
        screen.queryByText("未保存到服务器，请重新登录或检查课程权限。"),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("runs key operation buttons with visible server-confirmed feedback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as {
        operationId?: string;
        actionSlot?: string;
      };
      const artifacts =
        payload.operationId === "data-export"
          ? [
              {
                kind: "export-file",
                manifestId: "export-manifest-teacher-kang-2026",
                downloadUrl: "/api/teaching/operations/export/export-manifest-teacher-kang-2026",
                contentType: "application/json",
              },
            ]
          : payload.operationId === "invite-code"
            ? [
                {
                  kind: "invite-code",
                  code: "55395058",
                  status: "generated",
                  joinUrl: "/join/55395058",
                },
              ]
            : [];

      return new Response(
        JSON.stringify({
          receipt: {
            operationId: payload.operationId,
            actionSlot: payload.actionSlot,
            status: "persisted",
            displayMessage:
              payload.operationId === "course-settings"
                ? {
                    "zh-CN": "课程设置已由服务端持久化。",
                    "en-US": "Course settings persisted by the server.",
                  }
                : undefined,
            artifacts,
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: payload.operationId,
            actionSlot: payload.actionSlot,
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    try {
    const { rerender } = render(
      <TeachingOperationPage operationId="course-settings" selectedCourseId="teacher-math-pedagogy" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));
    await waitFor(() => {
      expect(screen.getByText("课程设置已由服务端持久化。")).toBeTruthy();
    });

    rerender(<TeachingOperationPage operationId="data-export" />);

    fireEvent.click(screen.getByRole("button", { name: "生成导出清单" }));
    await waitFor(() => {
      expect(screen.getByText("导出清单已生成，可交给服务端导出任务。")).toBeTruthy();
    });
    expect(screen.getByText("导出清单已生成")).toBeTruthy();

    rerender(<TeachingOperationPage operationId="invite-code" />);

    fireEvent.click(screen.getByRole("button", { name: "生成新邀请码" }));
    await waitFor(() => {
      expect(screen.getByText("邀请码已更新并等待教师确认发布。")).toBeTruthy();
    });
    expect(screen.getByText("55395058")).toBeTruthy();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("implements the OpenMAIC-style data export package page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          receipt: {
            operationId: "data-export",
            actionSlot: "primary",
            status: "persisted",
            displayMessage: {
              "zh-CN": "导出清单已生成，可交给服务端导出任务。",
              "en-US": "Export manifest generated for server export jobs.",
            },
            artifacts: [
              {
                kind: "export-file",
                manifestId: "export-manifest-teacher-kang-2026",
                downloadUrl: "/api/teaching/operations/export/export-manifest-teacher-kang-2026",
                contentType: "application/json",
              },
            ],
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "data-export",
            actionSlot: "primary",
            objectType: "export-manifest",
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    try {
    const { container } = render(<TeachingOperationPage operationId="data-export" />);

    expect(container.querySelector('[data-uais-openmaic-page="data-export"]')).toBeTruthy();
    expect(screen.getByText("开放课堂智能系统导出包")).toBeTruthy();
    expect(screen.getByText("课堂演示文稿")).toBeTruthy();
    expect(screen.getByText("资源包")).toBeTruthy();
    expect(screen.getAllByText("课堂包").length).toBeGreaterThan(0);
    expect(screen.getByText("清单与打包范围")).toBeTruthy();
    expect(screen.getByText("等待生成导出清单")).toBeTruthy();
    expect(screen.getByText("场景文件")).toBeTruthy();
    expect(screen.getByText("智能体文件")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "生成导出清单" }));

    await waitFor(() => {
      expect(screen.getByText("导出清单已生成")).toBeTruthy();
    });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("implements preset and auto agent setup with persona, permissions, voice, and course binding", () => {
    const { container } = render(<TeachingOperationPage operationId="agents" />);

    expect(container.querySelector('[data-uais-openmaic-page="agents"]')).toBeTruthy();
    expect(screen.getByText("预设 / 自动智能体配置")).toBeTruthy();
    expect(screen.getByRole("button", { name: "预设智能体" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "自动生成" })).toBeTruthy();
    expect(screen.getByText("研究助教")).toBeTruthy();
    expect(screen.getByText("方法顾问")).toBeTruthy();
    expect(screen.getByText("康霞课堂语音")).toBeTruthy();
    expect(screen.getByText("禁止替学生提交答案")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "自动生成" }));

    expect(screen.getByText("课堂追问智能体")).toBeTruthy();
    expect(screen.getByText("按课程内容自动绑定")).toBeTruthy();
    expect(screen.getByText("需教师确认后发布")).toBeTruthy();
  });

  it("implements scene-based course content with playback, Pro edit, and continuation", () => {
    const { container } = render(<TeachingOperationPage operationId="content" />);

    expect(container.querySelector('[data-uais-openmaic-page="content"]')).toBeTruthy();
    expect(screen.getByText("开放课堂智能系统场景内容结构")).toBeTruthy();
    expect(screen.getByText("研究问题导入")).toBeTruthy();
    expect(screen.getByText("变量关系快测")).toBeTruthy();
    expect(screen.getByText("小组白板活动")).toBeTruthy();
    expect(screen.getByText("研究设计挑战")).toBeTruthy();
    expect(screen.getByText("演示页")).toBeTruthy();
    expect(screen.getByText("测验")).toBeTruthy();
    expect(screen.getByText("互动任务")).toBeTruthy();
    expect(screen.getByText("问题式学习")).toBeTruthy();
    expect(screen.getAllByText("课堂播放").length).toBeGreaterThan(0);
    expect(screen.getAllByText("专业编辑").length).toBeGreaterThan(0);
    expect(screen.getByText("场景续生成")).toBeTruthy();
  });

  it("calls the teaching operation backend when a teacher runs a button action", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          receipt: {
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
            artifacts: [],
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "course-settings",
            actionSlot: "primary",
            objectType: "course-settings",
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      const [, requestInit] = fetchSpy.mock.calls[0];
      const body = JSON.parse(String(requestInit?.body));
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/teaching/operations",
        expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json" },
        }),
      );
      expect(body).toEqual(
        expect.objectContaining({
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          sourceAction: "manage",
          idempotencyKey: expect.stringMatching(
            /^teaching-operation-course-settings-primary-teacher-research-methods-manage-[a-zA-Z0-9._-]+$/,
          ),
        }),
      );
      expect(body.idempotencyKey.length).toBeLessThanOrEqual(120);
      expect(screen.getByText("课程设置已由服务端持久化。")).toBeTruthy();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reads back audit evidence after operation page persistence before closing the trace loop", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-page-course-settings-primary",
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "course-settings",
            actionSlot: "primary",
            receiptId: "operation-page-course-settings-primary",
            objectType: "course-settings",
          }),
          traceId: "trace-operation-page-course-settings",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({ accept: "application/json" });
      return Response.json({
        traceId: "trace-audit-operation-page-readback",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-course-settings-primary",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-course-settings",
            traceId: "trace-operation-page-course-settings",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: {
              sessionId: "teacher-operation-page-session",
              authenticatedAt: "2026-06-24T10:00:00.000Z",
              expiresAt: "2026-06-24T11:00:00.000Z",
            },
          },
        ],
        domainProjections: [
          {
            objectId: "course-settings-teacher-research-methods",
            objectType: "course-settings",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-course-settings-primary",
            updatedBy: "teacher-kang",
            status: "saved",
            updatedAt: "2026-06-24T10:00:00.000Z",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/teaching/operations/audit",
        expect.objectContaining({
          method: "GET",
          headers: { accept: "application/json" },
        }),
      );
      expect(screen.getByText("课程设置已由服务端持久化。")).toBeTruthy();
      expect(screen.getByText("审计读回已验证：trace-operation-page-course-settings")).toBeTruthy();
      expect(screen.getByText("操作者：teacher-kang · 审计事件：1")).toBeTruthy();
      expect(screen.getByText("签名会话已验证：teacher-operation-page-session")).toBeTruthy();
      expect(
        screen.getByText("领域对象已验证：course-settings / course-settings-teacher-research-methods"),
      ).toBeTruthy();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps operation page success hidden until audit readback verifies the saved trace", async () => {
    let resolveAuditReadback: (response: Response) => void = () => undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-page-course-settings-pending-audit",
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "course-settings",
            actionSlot: "primary",
            receiptId: "operation-page-course-settings-pending-audit",
            objectType: "course-settings",
          }),
          traceId: "trace-operation-page-course-settings-pending-audit",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      expect(init?.method).toBe("GET");
      return new Promise<Response>((resolve) => {
        resolveAuditReadback = resolve;
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      expect(screen.getAllByText("正在读取审计证据。").length).toBeGreaterThan(0);
      expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();

      resolveAuditReadback(
        Response.json({
          traceId: "trace-audit-operation-page-pending-readback",
          actorId: "teacher-kang",
          auditEventCount: 1,
          records: [
            {
              recordId: "operation-page-course-settings-pending-audit",
              courseId: "teacher-research-methods",
              operationId: "course-settings",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-operation-page-course-settings-pending",
              traceId: "trace-operation-page-course-settings-pending-audit",
              eventType: "teaching-operation.persisted",
              actorId: "teacher-kang",
              courseId: "teacher-research-methods",
              authSession: createOperationAuditAuthSession(),
            },
          ],
          domainProjections: [
            {
              objectId: "course-settings-teacher-research-methods",
              objectType: "course-settings",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-page-course-settings-pending-audit",
              updatedBy: "teacher-kang",
              status: "saved",
              updatedAt: "2026-06-24T10:05:00.000Z",
            },
          ],
        }),
      );

      await waitFor(() => {
        expect(screen.getByText("课程设置已由服务端持久化。")).toBeTruthy();
      });
      expect(
        screen.getByText("审计读回已验证：trace-operation-page-course-settings-pending-audit"),
      ).toBeTruthy();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires a complete signed teacher session before verifying operation page audit readback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/teaching/operations") {
        return Response.json({
          receipt: {
            receiptId: "operation-page-course-settings-weak-session",
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "course-settings",
            actionSlot: "primary",
            receiptId: "operation-page-course-settings-weak-session",
            objectType: "course-settings",
          }),
          traceId: "trace-operation-page-course-settings-weak-session",
        });
      }

      return Response.json({
        traceId: "trace-audit-operation-page-weak-session",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-course-settings-weak-session",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-course-settings-weak-session",
            traceId: "trace-operation-page-course-settings-weak-session",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: {
              sessionId: "weak-operation-page-session",
            },
          },
        ],
        domainProjections: [
          {
            objectId: "course-settings-teacher-research-methods",
            objectType: "course-settings",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-course-settings-weak-session",
            updatedBy: "teacher-kang",
            status: "saved",
            updatedAt: "2026-06-24T10:00:00.000Z",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
      expect(
        screen.queryByText("审计读回已验证：trace-operation-page-course-settings-weak-session"),
      ).toBeNull();
      expect(screen.queryByText("签名会话已验证：weak-operation-page-session")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires a matching domain projection before verifying operation page audit readback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/teaching/operations") {
        return Response.json({
          receipt: {
            receiptId: "operation-page-course-settings-domain-missing",
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "course-settings",
            actionSlot: "primary",
            receiptId: "operation-page-course-settings-domain-missing",
            objectType: "course-settings",
          }),
          traceId: "trace-operation-page-domain-missing",
        });
      }

      return Response.json({
        traceId: "trace-audit-domain-missing-readback",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-course-settings-domain-missing",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-domain-missing",
            traceId: "trace-operation-page-domain-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("审计读回已验证：trace-operation-page-domain-missing")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires course settings business readback before operation page claims settings save success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        return Response.json({
          receipt: {
            receiptId: "operation-page-course-settings-semantic-missing",
            operationId: "course-settings",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "course-settings",
            actionSlot: "primary",
            receiptId: "operation-page-course-settings-semantic-missing",
            objectType: "course-settings",
          }),
          traceId: "trace-operation-page-course-settings-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-course-settings-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-course-settings-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-course-settings-semantic-missing",
            traceId: "trace-operation-page-course-settings-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "course-settings-teacher-research-methods",
            objectType: "course-settings",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-course-settings-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：course-settings / course-settings-teacher-research-methods",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires student preview session business readback before operation page claims preview success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "course-settings",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-student-preview-session-semantic-missing",
            operationId: "course-settings",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "学生端预览已生成。",
              "en-US": "Student preview generated.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "course-settings",
            actionSlot: "secondary",
            receiptId: "operation-page-student-preview-session-semantic-missing",
            objectType: "student-preview-session",
          }),
          traceId: "trace-operation-page-student-preview-session-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-student-preview-session-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-student-preview-session-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "course-settings",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-student-preview-session-semantic-missing",
            traceId: "trace-operation-page-student-preview-session-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "student-preview-session-teacher-research-methods",
            objectType: "student-preview-session",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-student-preview-session-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "预览学生端" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("学生端预览已生成。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：student-preview-session / student-preview-session-teacher-research-methods",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires agent plan business readback before operation page claims agent plan save success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "agents",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-agent-plan-semantic-missing",
            operationId: "agents",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "智能体方案已保存，服务端密钥仍保持隔离。",
              "en-US": "Agent plan saved while server-side keys remain isolated.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "agents",
            actionSlot: "primary",
            receiptId: "operation-page-agent-plan-semantic-missing",
            objectType: "agent-plan",
          }),
          traceId: "trace-operation-page-agent-plan-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-agent-plan-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-agent-plan-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "agents",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-agent-plan-semantic-missing",
            traceId: "trace-operation-page-agent-plan-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "agent-plan-teacher-research-methods",
            objectType: "agent-plan",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-agent-plan-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="agents"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存智能体方案" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("智能体方案已保存，服务端密钥仍保持隔离。")).toBeNull();
      expect(
        screen.queryByText("领域对象已验证：agent-plan / agent-plan-teacher-research-methods"),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires permission preflight business readback before operation page claims preflight success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "agents",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-permission-preflight-semantic-missing",
            operationId: "agents",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "权限预检通过，仅课程授权角色可执行动作。",
              "en-US": "Permission preflight passed for course-authorized roles only.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "agents",
            actionSlot: "secondary",
            receiptId: "operation-page-permission-preflight-semantic-missing",
            objectType: "permission-preflight",
          }),
          traceId: "trace-operation-page-permission-preflight-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-permission-preflight-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-permission-preflight-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "agents",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-permission-preflight-semantic-missing",
            traceId: "trace-operation-page-permission-preflight-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "permission-preflight-teacher-research-methods",
            objectType: "permission-preflight",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-permission-preflight-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="agents"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "运行权限预检" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("权限预检通过，仅课程授权角色可执行动作。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：permission-preflight / permission-preflight-teacher-research-methods",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires knowledge index business readback before operation page claims knowledge sync success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "knowledge-base",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-knowledge-index-semantic-missing",
            operationId: "knowledge-base",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "知识库索引已同步到本地预览。",
              "en-US": "Knowledge index synced to local preview.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "knowledge-base",
            actionSlot: "primary",
            receiptId: "operation-page-knowledge-index-semantic-missing",
            objectType: "knowledge-index",
          }),
          traceId: "trace-operation-page-knowledge-index-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-knowledge-index-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-knowledge-index-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "knowledge-base",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-knowledge-index-semantic-missing",
            traceId: "trace-operation-page-knowledge-index-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "knowledge-index-teacher-research-methods",
            objectType: "knowledge-index",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-knowledge-index-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="knowledge-base"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "同步知识库索引" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("知识库索引已同步到本地预览。")).toBeNull();
      expect(
        screen.queryByText("领域对象已验证：knowledge-index / knowledge-index-teacher-research-methods"),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires resource review item business readback before operation page claims placeholder success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "knowledge-base",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-resource-review-item-semantic-missing",
            operationId: "knowledge-base",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "资料占位已加入待审核队列。",
              "en-US": "Resource placeholder added to review queue.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "knowledge-base",
            actionSlot: "secondary",
            receiptId: "operation-page-resource-review-item-semantic-missing",
            objectType: "resource-review-item",
          }),
          traceId: "trace-operation-page-resource-review-item-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-resource-review-item-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-resource-review-item-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "knowledge-base",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-resource-review-item-semantic-missing",
            traceId: "trace-operation-page-resource-review-item-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "resource-review-item-teacher-research-methods",
            objectType: "resource-review-item",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-resource-review-item-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="knowledge-base"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "添加资料占位" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("资料占位已加入待审核队列。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：resource-review-item / resource-review-item-teacher-research-methods",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires course content business readback before operation page claims content publish success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "content",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-course-content-semantic-missing",
            operationId: "content",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "课程内容已进入发布前确认。",
              "en-US": "Course content moved to pre-publish confirmation.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "content",
            actionSlot: "primary",
            receiptId: "operation-page-course-content-semantic-missing",
            objectType: "course-content",
          }),
          traceId: "trace-operation-page-course-content-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-course-content-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-course-content-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "content",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-course-content-semantic-missing",
            traceId: "trace-operation-page-course-content-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "course-content-teacher-research-methods",
            objectType: "course-content",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-course-content-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="content"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "发布课程内容" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("课程内容已进入发布前确认。")).toBeNull();
      expect(
        screen.queryByText("领域对象已验证：course-content / course-content-teacher-research-methods"),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires unit draft business readback before operation page claims draft generation success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "content",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-unit-draft-semantic-missing",
            operationId: "content",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "单元草稿已生成，等待教师校订。",
              "en-US": "Unit draft generated and waiting for teacher edits.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "content",
            actionSlot: "secondary",
            receiptId: "operation-page-unit-draft-semantic-missing",
            objectType: "unit-draft",
          }),
          traceId: "trace-operation-page-unit-draft-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-unit-draft-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-unit-draft-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "content",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-unit-draft-semantic-missing",
            traceId: "trace-operation-page-unit-draft-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "unit-draft-teacher-research-methods",
            objectType: "unit-draft",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-unit-draft-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="content"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "生成单元草稿" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("单元草稿已生成，等待教师校订。")).toBeNull();
      expect(
        screen.queryByText("领域对象已验证：unit-draft / unit-draft-teacher-research-methods"),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires admin settings business readback before operation page claims admin settings save success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "admins",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-admin-settings-semantic-missing",
            operationId: "admins",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "管理员设置已保存，权限变更进入审计记录。",
              "en-US": "Admin settings saved and permission changes logged.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "admins",
            actionSlot: "primary",
            receiptId: "operation-page-admin-settings-semantic-missing",
            objectType: "admin-settings",
          }),
          traceId: "trace-operation-page-admin-settings-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-admin-settings-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-admin-settings-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "admins",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-admin-settings-semantic-missing",
            traceId: "trace-operation-page-admin-settings-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "admin-settings-teacher-research-methods",
            objectType: "admin-settings",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-admin-settings-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="admins"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存管理员设置" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("管理员设置已保存，权限变更进入审计记录。")).toBeNull();
      expect(
        screen.queryByText("领域对象已验证：admin-settings / admin-settings-teacher-research-methods"),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires email notification business readback before operation page claims collaboration invite success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "admins",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-email-notification-semantic-missing",
            operationId: "admins",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "协作邀请通知已进入服务端邮件队列。",
              "en-US": "Collaboration invite notification queued in the server mail outbox.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "admins",
            actionSlot: "secondary",
            receiptId: "operation-page-email-notification-semantic-missing",
            objectType: "email-notification",
          }),
          traceId: "trace-operation-page-email-notification-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-email-notification-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-email-notification-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "admins",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-email-notification-semantic-missing",
            traceId: "trace-operation-page-email-notification-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "email-notification-teacher-research-methods-collaboration-invite",
            objectType: "email-notification",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-email-notification-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="admins"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "发送协作邀请" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("协作邀请通知已进入服务端邮件队列。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：email-notification / email-notification-teacher-research-methods-collaboration-invite",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires student roster business readback before operation page claims roster sync success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "students",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-student-roster-semantic-missing",
            operationId: "students",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "学生名单已同步到本地视图。",
              "en-US": "Roster synced to local view.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "students",
            actionSlot: "primary",
            receiptId: "operation-page-student-roster-semantic-missing",
            objectType: "student-roster",
          }),
          traceId: "trace-operation-page-student-roster-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-student-roster-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-student-roster-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "students",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-student-roster-semantic-missing",
            traceId: "trace-operation-page-student-roster-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "student-roster-teacher-research-methods",
            objectType: "student-roster",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-student-roster-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="students"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "同步学生名单" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("学生名单已同步到本地视图。")).toBeNull();
      expect(
        screen.queryByText("领域对象已验证：student-roster / student-roster-teacher-research-methods"),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires group suggestions business readback before operation page claims suggestions generation success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "students",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-group-suggestions-semantic-missing",
            operationId: "students",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "分组建议已生成，等待教师确认。",
              "en-US": "Group suggestions generated for teacher confirmation.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "students",
            actionSlot: "secondary",
            receiptId: "operation-page-group-suggestions-semantic-missing",
            objectType: "group-suggestions",
          }),
          traceId: "trace-operation-page-group-suggestions-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-group-suggestions-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-group-suggestions-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "students",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-group-suggestions-semantic-missing",
            traceId: "trace-operation-page-group-suggestions-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "group-suggestions-teacher-research-methods",
            objectType: "group-suggestions",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-group-suggestions-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="students"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "生成分组建议" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("分组建议已生成，等待教师确认。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：group-suggestions / group-suggestions-teacher-research-methods",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires export manifest business readback before operation page claims export manifest success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "data-export",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-export-manifest-semantic-missing",
            operationId: "data-export",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "导出清单已生成，可交给服务端导出任务。",
              "en-US": "Export manifest created for a server-side export job.",
            },
            artifacts: [
              {
                kind: "export-file",
                manifestId: "export-manifest-teacher-kang-2026",
                downloadUrl: "/api/teaching/operations/export/export-manifest-teacher-kang-2026",
                contentType: "application/json",
              },
            ],
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "data-export",
            actionSlot: "primary",
            receiptId: "operation-page-export-manifest-semantic-missing",
            objectType: "export-manifest",
          }),
          traceId: "trace-operation-page-export-manifest-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-export-manifest-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-export-manifest-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "data-export",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-export-manifest-semantic-missing",
            traceId: "trace-operation-page-export-manifest-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "export-manifest-teacher-research-methods",
            objectType: "export-manifest",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-export-manifest-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="data-export"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "生成导出清单" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("导出清单已生成，可交给服务端导出任务。")).toBeNull();
      expect(screen.queryByText("导出清单已生成")).toBeNull();
      expect(
        screen.queryByText("领域对象已验证：export-manifest / export-manifest-teacher-research-methods"),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires redaction validation business readback before operation page claims redaction success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "data-export",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-redaction-validation-semantic-missing",
            operationId: "data-export",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "脱敏范围校验通过：不包含真实密钥。",
              "en-US": "Redaction scope passed with no real secrets included.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "data-export",
            actionSlot: "secondary",
            receiptId: "operation-page-redaction-validation-semantic-missing",
            objectType: "redaction-validation",
          }),
          traceId: "trace-operation-page-redaction-validation-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-redaction-validation-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-redaction-validation-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "data-export",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-redaction-validation-semantic-missing",
            traceId: "trace-operation-page-redaction-validation-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "redaction-validation-teacher-research-methods",
            objectType: "redaction-validation",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-redaction-validation-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="data-export"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "校验脱敏范围" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("脱敏范围校验通过：不包含真实密钥。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：redaction-validation / redaction-validation-teacher-research-methods",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires dashboard state business readback before operation page claims dashboard refresh success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "dashboard",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-dashboard-state-semantic-missing",
            operationId: "dashboard",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "数据看板已刷新。",
              "en-US": "Dashboard refreshed.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "dashboard",
            actionSlot: "primary",
            receiptId: "operation-page-dashboard-state-semantic-missing",
            objectType: "dashboard-state",
          }),
          traceId: "trace-operation-page-dashboard-state-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-dashboard-state-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-dashboard-state-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "dashboard",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-dashboard-state-semantic-missing",
            traceId: "trace-operation-page-dashboard-state-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "dashboard-state-teacher-research-methods",
            objectType: "dashboard-state",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-dashboard-state-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="dashboard"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "刷新数据看板" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("数据看板已刷新。")).toBeNull();
      expect(
        screen.queryByText("领域对象已验证：dashboard-state / dashboard-state-teacher-research-methods"),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires dashboard snapshot business readback before operation page claims snapshot lock success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "dashboard",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-dashboard-snapshot-semantic-missing",
            operationId: "dashboard",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "日报快照已锁定到当前视图。",
              "en-US": "Daily snapshot locked to current view.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "dashboard",
            actionSlot: "secondary",
            receiptId: "operation-page-dashboard-snapshot-semantic-missing",
            objectType: "dashboard-snapshot",
          }),
          traceId: "trace-operation-page-dashboard-snapshot-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-dashboard-snapshot-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-dashboard-snapshot-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "dashboard",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-dashboard-snapshot-semantic-missing",
            traceId: "trace-operation-page-dashboard-snapshot-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "dashboard-snapshot-teacher-research-methods",
            objectType: "dashboard-snapshot",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-dashboard-snapshot-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="dashboard"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "锁定日报快照" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("日报快照已锁定到当前视图。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：dashboard-snapshot / dashboard-snapshot-teacher-research-methods",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires quiz board state business readback before operation page claims quiz board refresh success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "quiz-board",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-quiz-board-state-semantic-missing",
            operationId: "quiz-board",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "测验看板已刷新，错因分布可复核。",
              "en-US": "Quiz board refreshed with error patterns ready for review.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "quiz-board",
            actionSlot: "primary",
            receiptId: "operation-page-quiz-board-state-semantic-missing",
            objectType: "quiz-board-state",
          }),
          traceId: "trace-operation-page-quiz-board-state-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-quiz-board-state-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-quiz-board-state-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "quiz-board",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-quiz-board-state-semantic-missing",
            traceId: "trace-operation-page-quiz-board-state-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "quiz-board-state-teacher-research-methods",
            objectType: "quiz-board-state",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-quiz-board-state-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="quiz-board"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "刷新测验看板" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("测验看板已刷新，错因分布可复核。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：quiz-board-state / quiz-board-state-teacher-research-methods",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires quiz item review business readback before operation page claims low-quality item flag success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "quiz-board",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-quiz-item-review-semantic-missing",
            operationId: "quiz-board",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "低质题已标记为教师复核。",
              "en-US": "Low-quality items flagged for teacher review.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "quiz-board",
            actionSlot: "secondary",
            receiptId: "operation-page-quiz-item-review-semantic-missing",
            objectType: "quiz-item-review",
          }),
          traceId: "trace-operation-page-quiz-item-review-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-quiz-item-review-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-quiz-item-review-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "quiz-board",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-quiz-item-review-semantic-missing",
            traceId: "trace-operation-page-quiz-item-review-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "quiz-item-review-teacher-research-methods",
            objectType: "quiz-item-review",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-quiz-item-review-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="quiz-board"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "标记低质题复核" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("低质题已标记为教师复核。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：quiz-item-review / quiz-item-review-teacher-research-methods",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires grading queue business readback before operation page claims review queue save success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "grading",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-grading-queue-semantic-missing",
            operationId: "grading",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "批改队列已保存，学生端暂不发布。",
              "en-US": "Review queue saved without publishing to students.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "grading",
            actionSlot: "primary",
            receiptId: "operation-page-grading-queue-semantic-missing",
            objectType: "grading-queue",
          }),
          traceId: "trace-operation-page-grading-queue-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-grading-queue-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-grading-queue-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "grading",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-grading-queue-semantic-missing",
            traceId: "trace-operation-page-grading-queue-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "grading-queue-teacher-research-methods",
            objectType: "grading-queue",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-grading-queue-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="grading"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存批改队列" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("批改队列已保存，学生端暂不发布。")).toBeNull();
      expect(
        screen.queryByText("领域对象已验证：grading-queue / grading-queue-teacher-research-methods"),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires ai feedback draft business readback before operation page claims feedback generation success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "grading",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-ai-feedback-draft-semantic-missing",
            operationId: "grading",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "AI 反馈建议已生成，等待教师逐条确认。",
              "en-US": "AI feedback suggestions generated for teacher confirmation.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "grading",
            actionSlot: "secondary",
            receiptId: "operation-page-ai-feedback-draft-semantic-missing",
            objectType: "ai-feedback-draft",
          }),
          traceId: "trace-operation-page-ai-feedback-draft-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-ai-feedback-draft-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-ai-feedback-draft-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "grading",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-ai-feedback-draft-semantic-missing",
            traceId: "trace-operation-page-ai-feedback-draft-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "ai-feedback-draft-teacher-research-methods",
            objectType: "ai-feedback-draft",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-ai-feedback-draft-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="grading"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "生成智能反馈建议" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("AI 反馈建议已生成，等待教师逐条确认。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：ai-feedback-draft / ai-feedback-draft-teacher-research-methods",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires invite code draft business readback before operation page claims invite generation success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          targetClassId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "invite-code",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            targetClassId: "teacher-research-methods-class-1",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-invite-code-draft-semantic-missing",
            operationId: "invite-code",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "邀请码已更新并等待教师确认发布。",
              "en-US": "Invite code updated and waiting for teacher publish confirmation.",
            },
            artifacts: [
              {
                kind: "invite-code",
                code: "55395058",
                status: "generated",
                joinUrl: "/courses?invite=55395058",
              },
            ],
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "invite-code",
            actionSlot: "primary",
            receiptId: "operation-page-invite-code-draft-semantic-missing",
            objectType: "invite-code-draft",
          }),
          traceId: "trace-operation-page-invite-code-draft-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-invite-code-draft-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-invite-code-draft-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "invite-code",
            actionSlot: "primary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-invite-code-draft-semantic-missing",
            traceId: "trace-operation-page-invite-code-draft-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "invite-code-draft-teacher-research-methods-55395058",
            objectType: "invite-code-draft",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-invite-code-draft-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="invite-code"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "生成新邀请码" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("邀请码已更新并等待教师确认发布。")).toBeNull();
      expect(screen.queryByText("55395058")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：invite-code-draft / invite-code-draft-teacher-research-methods-55395058",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires enrollment access business readback before operation page claims invite publication success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          operationId?: string;
          actionSlot?: "primary" | "secondary";
          courseId?: string;
          targetClassId?: string;
          sourceAction?: string;
        };
        expect(body).toEqual(
          expect.objectContaining({
            operationId: "invite-code",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            targetClassId: "teacher-research-methods-class-1",
            sourceAction: "manage",
          }),
        );
        return Response.json({
          receipt: {
            receiptId: "operation-page-enrollment-access-semantic-missing",
            operationId: "invite-code",
            actionSlot: "secondary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "邀请码已发布到班级加入入口。",
              "en-US": "Invite code published to the class join entry.",
            },
            artifacts: [
              {
                kind: "invite-code",
                code: "55395057",
                status: "published",
                joinUrl: "/courses?invite=55395057",
              },
            ],
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "invite-code",
            actionSlot: "secondary",
            receiptId: "operation-page-enrollment-access-semantic-missing",
            objectType: "enrollment-access",
          }),
          traceId: "trace-operation-page-enrollment-access-semantic-missing",
        });
      }

      expect(String(input)).toBe("/api/teaching/operations/audit");
      return Response.json({
        traceId: "trace-audit-operation-page-enrollment-access-semantic-missing",
        actorId: "teacher-kang",
        auditEventCount: 1,
        records: [
          {
            recordId: "operation-page-enrollment-access-semantic-missing",
            courseId: "teacher-research-methods",
            operationId: "invite-code",
            actionSlot: "secondary",
            status: "persisted",
          },
        ],
        auditEvents: [
          {
            auditId: "audit-operation-page-enrollment-access-semantic-missing",
            traceId: "trace-operation-page-enrollment-access-semantic-missing",
            eventType: "teaching-operation.persisted",
            actorId: "teacher-kang",
            courseId: "teacher-research-methods",
            authSession: createOperationAuditAuthSession(),
          },
        ],
        domainProjections: [
          {
            objectId: "enrollment-access-teacher-research-methods-55395057",
            objectType: "enrollment-access",
            courseId: "teacher-research-methods",
            operationRecordId: "operation-page-enrollment-access-semantic-missing",
          },
        ],
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="invite-code"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));

      await waitFor(() => {
        expect(screen.getAllByText("审计读回未完成，请稍后刷新。").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText("邀请码已发布到班级加入入口。")).toBeNull();
      expect(
        screen.queryByText(
          "领域对象已验证：enrollment-access / enrollment-access-teacher-research-methods-55395057",
        ),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not claim operation page success when domain persistence evidence is omitted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        receipt: {
          receiptId: "operation-page-course-settings-domain-summary-omitted",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
        traceId: "trace-operation-page-domain-summary-omitted",
      }),
    );

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

      await waitFor(() => {
        expect(screen.getByText("领域对象持久化证据缺失，请稍后重试。")).toBeTruthy();
      });
      expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
      expect(screen.queryByText("审计读回已验证：trace-operation-page-domain-summary-omitted")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not claim operation page success when the backend receipt identifies a different operation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        receipt: {
          receiptId: "operation-page-course-settings-wrong-operation",
          operationId: "course-settings",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
        },
        domainPersistenceSummary: createPersistedDomainSummary({
          operationId: "course-settings",
          actionSlot: "primary",
          receiptId: "operation-page-course-settings-wrong-operation",
          objectType: "course-settings",
        }),
      }),
    );

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="knowledge-base"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "同步知识库索引" }));

      await waitFor(() => {
        expect(screen.getByText("服务端回执未匹配当前操作，请稍后重试。")).toBeTruthy();
      });
      expect(screen.queryByText("课程设置已由服务端持久化。")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("prevents duplicate operation page submissions while a save is pending", async () => {
    let resolveSave: (response: Response) => void = () => undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveSave = resolve;
        }),
    );

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      const primaryButton = screen.getByRole("button", {
        name: "保存课程设置",
      }) as HTMLButtonElement;
      const secondaryButton = screen.getByRole("button", {
        name: "预览学生端",
      }) as HTMLButtonElement;

      fireEvent.click(primaryButton);

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      expect(primaryButton.disabled).toBe(true);
      expect(secondaryButton.disabled).toBe(true);

      fireEvent.click(primaryButton);
      fireEvent.click(secondaryButton);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      resolveSave(
        Response.json({
          receipt: {
            operationId: "course-settings",
            actionSlot: "primary",
            status: "persisted",
            displayMessage: {
              "zh-CN": "课程设置已由服务端持久化。",
              "en-US": "Course settings persisted by the server.",
            },
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "course-settings",
            actionSlot: "primary",
            objectType: "course-settings",
          }),
        }),
      );

      await waitFor(() => {
        expect(screen.getByText("课程设置已由服务端持久化。")).toBeTruthy();
      });
      expect(primaryButton.disabled).toBe(false);
      expect(secondaryButton.disabled).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("uses a fresh idempotency key for separate completed operation button submissions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        receipt: {
          operationId: "course-settings",
          actionSlot: "primary",
          status: "persisted",
          displayMessage: {
            "zh-CN": "课程设置已由服务端持久化。",
            "en-US": "Course settings persisted by the server.",
          },
          artifacts: [],
        },
        domainPersistenceSummary: createPersistedDomainSummary({
          operationId: "course-settings",
          actionSlot: "primary",
          objectType: "course-settings",
        }),
      }),
    );

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByText("课程设置已由服务端持久化。")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

      const firstBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
      const secondBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
      expect(firstBody.idempotencyKey).toEqual(expect.any(String));
      expect(secondBody.idempotencyKey).toEqual(expect.any(String));
      expect(secondBody.idempotencyKey).not.toBe(firstBody.idempotencyKey);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("surfaces backend authorization failures instead of keeping local success feedback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "UAIS teaching operation course ownership is required.",
          access: {
            status: "denied",
            reasonCode: "course-scope-denied",
            responsibleSession: "S12",
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="course-settings"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "保存课程设置" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => {
        expect(screen.getByText("未保存到服务器，请重新登录或检查课程权限。")).toBeTruthy();
      });
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("未保存到服务器，请重新登录或检查课程权限。");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not leave a generated export manifest visible when backend persistence fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "UAIS teacher authentication is required.",
          access: {
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="data-export"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "生成导出清单" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => {
        expect(screen.getByText("未保存到服务器，请重新登录或检查课程权限。")).toBeTruthy();
      });
      expect(screen.getByText("等待生成导出清单")).toBeTruthy();
      expect(screen.queryByText("导出清单已生成")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("clears a stale operation page export manifest before a retried export save fails", async () => {
    let requestCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      requestCount += 1;

      if (requestCount === 1) {
        return Response.json({
          receipt: {
            receiptId: "operation-page-export-manifest-first-success",
            operationId: "data-export",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "导出清单已生成，可交给服务端导出任务。",
              "en-US": "Export manifest created for a server-side export job.",
            },
            artifacts: [
              {
                kind: "export-file",
                manifestId: "export-manifest-teacher-kang-2026",
                downloadUrl: "/api/teaching/operations/export/export-manifest-teacher-kang-2026",
                contentType: "application/json",
              },
            ],
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "data-export",
            actionSlot: "primary",
            receiptId: "operation-page-export-manifest-first-success",
            objectType: "export-manifest",
          }),
        });
      }

      return new Response(
        JSON.stringify({
          error: "UAIS teacher authentication is required.",
          access: {
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="data-export"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "生成导出清单" }));
      await waitFor(() => {
        expect(screen.getByText("导出清单已生成")).toBeTruthy();
      });

      fireEvent.click(screen.getByRole("button", { name: "生成导出清单" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(screen.getByText("未保存到服务器，请重新登录或检查课程权限。")).toBeTruthy();
      });
      expect(screen.getByText("等待生成导出清单")).toBeTruthy();
      expect(screen.queryByText("导出清单已生成")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not leave a locally incremented invite code visible when backend persistence fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "UAIS teaching operation course ownership is required.",
          access: {
            status: "denied",
            reasonCode: "course-scope-denied",
            responsibleSession: "S12",
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="invite-code"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "生成新邀请码" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => {
        expect(screen.getByText("未保存到服务器，请重新登录或检查课程权限。")).toBeTruthy();
      });
      expect(screen.getByText("55395057")).toBeTruthy();
      expect(screen.queryByText("55395058")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("clears a stale operation page invite code before a retried invite generation fails", async () => {
    let requestCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      requestCount += 1;

      if (requestCount === 1) {
        return Response.json({
          receipt: {
            receiptId: "operation-page-invite-code-first-success",
            operationId: "invite-code",
            actionSlot: "primary",
            courseId: "teacher-research-methods",
            status: "persisted",
            displayMessage: {
              "zh-CN": "邀请码已更新并等待教师确认发布。",
              "en-US": "Invite code updated and waiting for teacher publish confirmation.",
            },
            artifacts: [
              {
                kind: "invite-code",
                code: "66334455",
                status: "generated",
                joinUrl: "/join/66334455",
              },
            ],
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: "invite-code",
            actionSlot: "primary",
            receiptId: "operation-page-invite-code-first-success",
            objectType: "invite-code-draft",
          }),
        });
      }

      return new Response(
        JSON.stringify({
          error: "UAIS teaching operation course ownership is required.",
          access: {
            status: "denied",
            reasonCode: "course-scope-denied",
            responsibleSession: "S12",
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="invite-code"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "生成新邀请码" }));
      await waitFor(() => {
        expect(screen.getByText("66334455")).toBeTruthy();
      });

      fireEvent.click(screen.getByRole("button", { name: "生成新邀请码" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(screen.getByText("未保存到服务器，请重新登录或检查课程权限。")).toBeTruthy();
      });
      expect(screen.getByText("55395057")).toBeTruthy();
      expect(screen.queryByText("66334455")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps operation page invite artifacts hidden until audit readback verifies persistence", async () => {
    let resolveAudit: (response: Response) => void = () => undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/teaching/operations/audit") {
        return new Promise<Response>((resolve) => {
          resolveAudit = resolve;
        });
      }

      const payload = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as {
        operationId?: string;
        actionSlot?: "primary" | "secondary";
      };
      expect(payload.operationId).toBe("invite-code");
      expect(payload.actionSlot).toBe("primary");
      return Response.json({
        receipt: {
          receiptId: "operation-page-invite-code-primary-pending-audit",
          operationId: "invite-code",
          actionSlot: "primary",
          courseId: "teacher-research-methods",
          status: "persisted",
          displayMessage: {
            "zh-CN": "邀请码已更新并等待教师确认发布。",
            "en-US": "Invite code updated and waiting for teacher publish confirmation.",
          },
          artifacts: [
            {
              kind: "invite-code",
              code: "66334455",
              status: "generated",
              joinUrl: "/join/66334455",
            },
          ],
        },
        domainPersistenceSummary: createPersistedDomainSummary({
          operationId: "invite-code",
          actionSlot: "primary",
          receiptId: "operation-page-invite-code-primary-pending-audit",
          objectType: "invite-code-draft",
        }),
        traceId: "trace-operation-page-invite-pending-audit",
      });
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="invite-code"
          selectedCourseId="teacher-research-methods"
        />,
      );

      expect(screen.getByText("55395057")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "生成新邀请码" }));

      await waitFor(() => {
        expect(screen.getAllByText("正在读取审计证据。").length).toBeGreaterThan(0);
      });
      expect(screen.getByText("55395057")).toBeTruthy();
      expect(screen.queryByText("66334455")).toBeNull();

      resolveAudit(
        Response.json({
          traceId: "trace-audit-operation-page-invite-pending",
          actorId: "teacher-kang",
          auditEventCount: 1,
          records: [
            {
              recordId: "operation-page-invite-code-primary-pending-audit",
              courseId: "teacher-research-methods",
              operationId: "invite-code",
              actionSlot: "primary",
              status: "persisted",
            },
          ],
          auditEvents: [
            {
              auditId: "audit-operation-page-invite-code-pending",
              traceId: "trace-operation-page-invite-pending-audit",
              courseId: "teacher-research-methods",
              actorId: "teacher-kang",
              eventType: "teaching-operation.persisted",
              authSession: createOperationAuditAuthSession(),
            },
          ],
          domainProjections: [
            {
              objectId: "invite-code-draft-teacher-research-methods-66334455",
              objectType: "invite-code-draft",
              courseId: "teacher-research-methods",
              operationRecordId: "operation-page-invite-code-primary-pending-audit",
              inviteCode: "66334455",
              joinUrl: "/join/66334455",
              generatedBy: "teacher-kang",
              draftStatus: "generated",
              invitePolicy: "teacher-review-before-publication",
              generatedAt: "2026-06-29T10:32:00.000Z",
            },
          ],
        }),
      );

      await waitFor(() => {
        expect(screen.getByText("66334455")).toBeTruthy();
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("surfaces automatic rollback compensation on the invite-code operation page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as {
        operationId?: string;
        actionSlot?: "primary" | "secondary";
      };
      expect(payload.operationId).toBe("invite-code");
      expect(payload.actionSlot).toBe("secondary");

      return new Response(
        JSON.stringify({
          error: "External teaching course management persistence failed.",
          receipt: {
            receiptId: "teaching-operation-idempotent-operation-page-invite-publish",
            operationId: "invite-code",
            actionSlot: "secondary",
            status: "persisted",
          },
          partialFailure: {
            status: "operation-persisted-class-invite-publication-failed",
            failedStep: "class-invite-publication",
            operationReceiptId: "teaching-operation-idempotent-operation-page-invite-publish",
            compensation: {
              status: "rolled-back",
              action: "rollback-teaching-operation-record",
              rollbackReason: "class-invite-publication-failed",
              receipt: {
                receiptId:
                  "teaching-operation-rollback-teaching-operation-idempotent-operation-page-invite-publish",
                targetRecordId: "teaching-operation-idempotent-operation-page-invite-publish",
                status: "persisted",
              },
            },
          },
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    });

    try {
      render(
        <TeachingOperationPage
          action="manage"
          operationId="invite-code"
          selectedCourseId="teacher-research-methods"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "确认发布邀请码" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => {
        expect(
          screen.getByText(
            "发布未完成，已自动撤回：teaching-operation-idempotent-operation-page-invite-publish。",
          ),
        ).toBeTruthy();
      });
      expect(screen.queryByText("未保存到服务器，请重新登录或检查课程权限。")).toBeNull();
      expect(screen.getByText("55395057")).toBeTruthy();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("runs primary and secondary actions for every teaching operation page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as {
        operationId?: string;
        actionSlot?: "primary" | "secondary";
      };
      const artifacts =
        payload.operationId === "data-export" && payload.actionSlot === "primary"
          ? [
              {
                kind: "export-file",
                manifestId: "export-manifest-teacher-kang-2026",
                downloadUrl: "/api/teaching/operations/export/export-manifest-teacher-kang-2026",
                contentType: "application/json",
              },
            ]
          : payload.operationId === "invite-code" && payload.actionSlot === "primary"
            ? [
                {
                  kind: "invite-code",
                  code: "55395058",
                  status: "generated",
                  joinUrl: "/join/55395058",
                },
              ]
            : [];
      return new Response(
        JSON.stringify({
          receipt: {
            operationId: payload.operationId,
            actionSlot: payload.actionSlot,
            status: "persisted",
            displayMessage: {
              "zh-CN": `${payload.operationId}:${payload.actionSlot}:server-persisted`,
              "en-US": `${payload.operationId}:${payload.actionSlot}:server-persisted`,
            },
            artifacts,
          },
          domainPersistenceSummary: createPersistedDomainSummary({
            operationId: payload.operationId,
            actionSlot: payload.actionSlot,
          }),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    try {
    for (const [operationId] of operations) {
      const { container, unmount } = render(<TeachingOperationPage operationId={operationId} />);
      const liveStatus = container.querySelector('[aria-live="polite"]');
      const initialStatus = liveStatus?.textContent;
      const actionButtons = screen.getAllByRole("button");

      expect(actionButtons.length).toBeGreaterThanOrEqual(2);

      fireEvent.click(actionButtons[0]);
      expect(liveStatus?.textContent).not.toBe(initialStatus);
      await waitFor(() => {
        expect(liveStatus?.textContent).toBe(`${operationId}:primary:server-persisted`);
      });
      const primaryStatus = liveStatus?.textContent;

      fireEvent.click(actionButtons[1]);
      await waitFor(() => {
        expect(liveStatus?.textContent).toBe(`${operationId}:secondary:server-persisted`);
      });
      expect(liveStatus?.textContent).not.toBe(primaryStatus);

      if (operationId === "data-export") {
        expect(screen.getByText("导出清单已生成")).toBeTruthy();
      }

      if (operationId === "invite-code") {
        expect(screen.getByText("55395058")).toBeTruthy();
      }

      unmount();
    }
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
