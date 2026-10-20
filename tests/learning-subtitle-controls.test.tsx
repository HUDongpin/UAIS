import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningPage } from "@/components/pages/learning-page";
import type { LearningPptPlaybackManifest } from "@/lib/learning/ppt-playback-types";

const preferences = vi.hoisted(() => ({
  locale: "zh-CN" as "zh-CN" | "en-US",
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => preferences,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  default: ({ priority, unoptimized, ...props }: {
    src: string; alt: string; priority?: boolean; unoptimized?: boolean;
  }) => {
    void priority;
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt} />;
  },
}));

const playback: LearningPptPlaybackManifest = {
  status: "ready",
  courseId: "subtitle-course",
  courseTitle: "字幕测试课程",
  sourceDeckTitle: "测试课件",
  audioManifestId: "subtitle-test-audio",
  learningUnit: {
    lessonKey: "unit-1",
    position: 1,
    title: { "zh-CN": "测试单元", "en-US": "Test unit" },
    identitySource: "explicit-manifest",
  },
  teacherName: "测试教师",
  voiceLabel: "测试配音",
  slideCount: 3,
  slides: [
    { title: "Introduction", text: "Welcome to the lesson." },
    { title: "Evidence", text: "证据如何支撑论证。" },
    { title: "Regression", text: "Compare ALPHA with beta [x]." },
  ].map(({ title, text }, index) => ({
    slideId: `slide-${index + 1}`,
    slideNumber: index + 1,
    slideTitle: title,
    narrationText: text,
    imageUrl: `/subtitle-test/page-${index + 1}.jpg`,
    audioId: `audio-${index + 1}`,
    audioUrl: `/subtitle-test/audio-${index + 1}.mp3`,
    durationSeconds: 20,
  })),
  redaction: {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "published-learning-ids-only",
  },
};

afterEach(() => {
  preferences.locale = "zh-CN";
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openSubtitles() {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ playback })));
  const result = render(<LearningPage initialCourseId={playback.courseId} />);
  await screen.findByRole("img", { name: /Introduction/ });
  fireEvent.click(screen.getByRole("button", { name: /^(全部字幕|Subtitles)$/ }));
  return result;
}

function subtitleRows() {
  return screen.queryAllByRole("button", { name: /^(跳转到第|Jump to Slide)/ });
}

describe("learning subtitle controls", () => {
  it.each(["zh-CN", "en-US"] as const)(
    "searches narration, titles and page labels and clears the query in %s",
    async (locale) => {
      preferences.locale = locale;
      await openSubtitles();
      const search = screen.getByPlaceholderText(/搜索.*字幕|Search subtitles/);
      expect(subtitleRows()).toHaveLength(3);

      for (const query of ["  alpha  ", "regression", "[x]", locale === "zh-CN" ? "第 3 页" : "Slide 3"]) {
        fireEvent.change(search, { target: { value: query } });
        expect(subtitleRows()).toHaveLength(1);
        expect(subtitleRows()[0].textContent).toContain("ALPHA");
      }

      fireEvent.change(search, { target: { value: "证据" } });
      expect(subtitleRows()).toHaveLength(1);
      expect(subtitleRows()[0].textContent).toContain("证据");
      fireEvent.change(search, { target: { value: "   " } });
      expect(subtitleRows()).toHaveLength(3);
      fireEvent.change(search, { target: { value: "" } });
      expect(subtitleRows()).toHaveLength(3);
    },
  );

  it("toggles current-page filtering and follows slide navigation", async () => {
    await openSubtitles();
    const filter = screen.getByRole("button", { name: /仅当前页字幕|筛选字幕/ });
    fireEvent.click(filter);
    expect(subtitleRows()).toHaveLength(1);
    expect(filter.getAttribute("aria-pressed")).toBe("true");
    expect(subtitleRows()[0].textContent).toContain("Welcome");
    fireEvent.click(screen.getByRole("button", { name: "下一段" }));
    expect(subtitleRows()).toHaveLength(1);
    expect(subtitleRows()[0].textContent).toContain("证据");
    expect(subtitleRows()[0].getAttribute("aria-current")).toBe("page");
    fireEvent.click(filter);
    expect(filter.getAttribute("aria-pressed")).toBe("false");
    expect(subtitleRows()).toHaveLength(3);
  });

  it("combines search and current-page filtering with a recoverable empty state", async () => {
    await openSubtitles();
    const search = screen.getByPlaceholderText(/搜索.*字幕/);
    const filter = screen.getByRole("button", { name: /仅当前页字幕|筛选字幕/ });
    fireEvent.change(search, { target: { value: "alpha" } });
    fireEvent.click(filter);
    expect(subtitleRows()).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toContain("没有匹配的字幕");
    expect(screen.queryByText(/本课程暂无字幕/)).toBeNull();

    fireEvent.change(search, { target: { value: "" } });
    expect(subtitleRows()).toHaveLength(1);
    expect(filter.getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(search, { target: { value: "no matching text" } });
    fireEvent.click(screen.getByRole("button", { name: "重置字幕搜索和筛选" }));
    expect((search as HTMLInputElement).value).toBe("");
    expect(filter.getAttribute("aria-pressed")).toBe("false");
    expect(subtitleRows()).toHaveLength(3);
  });

  it("jumps a filtered result to its original slide and audio", async () => {
    const { container } = await openSubtitles();
    fireEvent.change(screen.getByPlaceholderText(/搜索.*字幕/), {
      target: { value: "alpha" },
    });
    expect(subtitleRows()).toHaveLength(1);
    // Searching itself must not move playback.
    expect(screen.getByRole("img", { name: /课件第 1 页/ })).toBeTruthy();
    fireEvent.click(subtitleRows()[0]);
    expect(screen.getByRole("img", { name: /课件第 3 页/ }).getAttribute("src"))
      .toBe("/subtitle-test/page-3.jpg");
    expect(container.querySelector('[data-uais-learning-ppt-audio="active-slide"]')?.getAttribute("src"))
      .toBe("/subtitle-test/audio-3.mp3");
    expect(subtitleRows()[0].getAttribute("aria-current")).toBe("page");
  });

  it("retains the no-published-subtitles state and disables unavailable controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 404 })));
    render(<LearningPage initialCourseId={playback.courseId} />);
    await screen.findByText("本课程暂无已发布课件");
    fireEvent.click(screen.getByRole("button", { name: "全部字幕" }));
    expect(screen.getByText(/本课程暂无字幕/)).toBeTruthy();
    expect(subtitleRows()).toHaveLength(0);
    expect((screen.getByPlaceholderText(/搜索.*字幕/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /仅当前页字幕|筛选字幕/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/没有匹配的字幕/)).toBeNull();
  });
});
