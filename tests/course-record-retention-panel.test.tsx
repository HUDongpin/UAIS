import { existsSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
const active = {
  courseId: "math",
  retentionDays: 180,
  closedAt: null,
  purgeAfter: null,
  purgedAt: null,
  eligibleForPurge: false,
  counts: { submissions: 30, images: 4, feedback: 2 },
  confirmationDigest: "a".repeat(64),
};
async function mount() {
  expect(
    existsSync("src/components/pages/course-record-retention-panel.tsx"),
    "teacher retention controls exist",
  ).toBe(true);
  const path = "../src/components/pages/course-record-retention-panel.tsx";
  const { CourseRecordRetentionPanel } = await import(path);
  render(<CourseRecordRetentionPanel courseId="math" locale="zh-CN" />);
}
describe("teacher classroom record retention controls", () => {
  it("explains the required durable backend when the environment is not Postgres", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { reasonCode: "course-retention-postgres-required" },
          { status: 503 },
        ),
      ),
    );
    await mount();
    expect(
      await screen.findByText(
        "课堂记录保留与清理需要使用 Postgres 课程及聊天存储，请联系管理员配置后重试。",
      ),
    ).toBeTruthy();
  });
  it("requires a second explicit action to close a course and never offers early deletion", async () => {
    const fetchMock = vi.fn(async (_url, init) =>
      Response.json({
        retention:
          init?.method === "POST"
            ? {
                ...active,
                closedAt: "2026-01-01T00:00:00Z",
                purgeAfter: "2026-06-30T00:00:00Z",
              }
            : active,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "结束课程并开始保留期" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认结束课程" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      action: "close",
      confirm: true,
    });
    expect(
      screen.queryByRole("button", { name: "确认清理本课程到期记录" }),
    ).toBeNull();
  });
  it("previews expired counts before enabling an acknowledged purge", async () => {
    const expired = {
      ...active,
      closedAt: "2026-01-01T00:00:00Z",
      purgeAfter: "2026-06-30T00:00:00Z",
      eligibleForPurge: true,
    };
    const fetchMock = vi.fn(async () => Response.json({ retention: expired }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "预览到期清理" }),
    );
    const confirm = await screen.findByRole("button", {
      name: "确认清理本课程到期记录",
    });
    expect(confirm).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      action: "purge",
      confirm: true,
      confirmationDigest: expired.confirmationDigest,
    });
  });
});
