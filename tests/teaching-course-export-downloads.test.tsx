import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationSpecificPreview } from "@/components/teaching/teaching-operation-previews";
import { operationConfigs } from "@/components/teaching/teaching-operation-page-data";

const createObjectURL = vi.fn(() => "blob:course-export");
const revokeObjectURL = vi.fn();
const fetchMock = vi.fn();

function show(courseId?: string, locale: "zh-CN" | "en-US" = "zh-CN") {
  return render(
    <OperationSpecificPreview
      config={operationConfigs["data-export"]}
      exportManifest={{ manifestId: "uncreated" }}
      inviteCode=""
      locale={locale}
      manifestReady={false}
      selectedCourseId={courseId}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("teaching course file downloads", () => {
  it.each([
    ["下载 PPTX", "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
    ["下载资源 ZIP", "resource-zip", "application/zip", "-resources.zip"],
    ["下载课堂 ZIP", "classroom-zip", "application/zip", "-classroom.zip"],
  ])("downloads actual binary content for %s without creating a data manifest", async (label, format, contentType, suffix) => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([80, 75, 3, 4, 1]), {
      headers: { "content-type": contentType },
    }));
    const downloads: Array<{ href: string; filename: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ href: this.href, filename: this.download });
    });
    show("course-a");
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/teaching/courses/course-a/export/${format}?locale=zh-CN`,
      expect.objectContaining({ credentials: "same-origin", signal: expect.any(AbortSignal) }),
    );
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloads[0]).toEqual({ href: "blob:course-export", filename: `course-a${suffix}` });
    expect(screen.getByRole("status").textContent).toContain("已开始下载");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires course context before enabling any package download", () => {
    show();
    for (const button of screen.getAllByRole("button", { name: /下载/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([[422, "课程内容或媒体"], [413, "大小上限"]])("reports file errors (%s) without downloading JSON or claiming success", async (status, message) => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "private server path" }, { status: Number(status) }));
    show("course-a");
    fireEvent.click(screen.getByRole("button", { name: "下载资源 ZIP" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(message));
    expect(screen.queryByText(/已开始下载/)).toBeNull();
    expect(screen.queryByText(/private server path/)).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects a successful JSON manifest masquerading as an exported package", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ manifestId: "not-a-pptx" }));
    show("course-a");
    fireEvent.click(screen.getByRole("button", { name: "下载 PPTX" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("uses the chosen locale and reports revoked access", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "denied" }, { status: 403 }));
    show("course-b", "en-US");
    fireEvent.click(screen.getByRole("button", { name: "Download Classroom ZIP" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("permission"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/teaching/courses/course-b/export/classroom-zip?locale=en-US");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
