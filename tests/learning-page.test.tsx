import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LearningRoutePage from "@/app/learning/page";
import { LearningPage } from "@/components/pages/learning-page";
import { SessionUserProvider } from "@/components/providers/session-user";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";

const mockPreferences = vi.hoisted(() => ({
  locale: "zh-CN" as "zh-CN" | "en-US",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: (imageProps: {
    src: string;
    alt: string;
    priority?: boolean;
    unoptimized?: boolean;
  }) => {
    const { src, alt, priority, unoptimized, ...props } = imageProps;
    void priority;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} data-unoptimized={unoptimized ? "true" : undefined} {...props} />;
  },
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({
    locale: mockPreferences.locale,
    theme: "light",
    toggleLocale: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

// A published deck that is deliberately NOT the demo mathematics course, so the
// outline has something to be wrong about if it falls back to demo identity.
const outlineManifest = {
  status: "ready",
  courseId: "autumn-2026-research-methods",
  courseTitle: "大学研究方法",
  sourceDeckTitle: "第一周：研究问题",
  audioManifestId: "audio-manifest-autumn-2026-week-01",
  teacherName: "吴亚军博士",
  voiceLabel: "吴亚军博士克隆声音",
  slideCount: 2,
  slides: [
    {
      slideId: "slide-01",
      slideNumber: 1,
      slideTitle: "研究问题从哪里来",
      narrationText: "同学们好，这一周我们讨论研究问题的来源。",
      imageUrl: "/learning/ppt-playback/slides/autumn-2026-week-01/page-01.jpg",
      audioId: "tts_autumn-2026-week-01_slide-01",
      audioUrl:
        "/api/learning/ppt-playback/audio/audio-manifest-autumn-2026-week-01/tts_autumn-2026-week-01_slide-01",
      durationSeconds: 18.4,
    },
    {
      slideId: "slide-02",
      slideNumber: 2,
      slideTitle: "证据与论证",
      narrationText: "第二页我们讨论证据如何支撑论证。",
      imageUrl: "/learning/ppt-playback/slides/autumn-2026-week-01/page-02.jpg",
      audioId: "tts_autumn-2026-week-01_slide-02",
      audioUrl:
        "/api/learning/ppt-playback/audio/audio-manifest-autumn-2026-week-01/tts_autumn-2026-week-01_slide-02",
      durationSeconds: 22.1,
    },
  ],
  redaction: {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "published-learning-ids-only",
  },
};

const outlineStudentUser: UaisAppSessionUser = {
  account: "student-001",
  role: "student",
  displayName: "Student One",
  department: "UAIS",
};

afterEach(() => {
  mockPreferences.locale = "zh-CN";
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
  delete (document as Partial<Document>).fullscreenElement;
  delete (document as Partial<Document>).exitFullscreen;
});

describe("LearningPage", () => {
  it("receives the selected course id from the learning route query", async () => {
    const page = await LearningRoutePage({
      searchParams: Promise.resolve({
        courseId: "math-pedagogy-learning",
        classId: "math-pedagogy-learning-class-1",
      }),
    });

    expect(page.props.initialCourseId).toBe("math-pedagogy-learning");
    expect(page.props.initialClassId).toBe("math-pedagogy-learning-class-1");
  });

  it("shows the selected course workspace when opened from the course plaza", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    render(<LearningPage initialCourseId="math-pedagogy-learning" />);

    expect(screen.getByText("当前课程：数学教学法")).toBeTruthy();
    expect(screen.getByText("把例题变成课堂提问链")).toBeTruthy();
    expect(screen.queryByText("当前课程：大学研究方法")).toBeNull();
  });

  it("explains a published PPT access denial instead of reporting that narration is preparing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "UAIS learning PPT playback requires teaching course ownership.",
            access: {
              status: "denied",
              reasonCode: "teacher-course-ownership-required",
            },
          },
          { status: 403 },
        ),
      ),
    );

    render(<LearningPage />);

    // E14/PKG-8b: course-neutral. The refusal is about this course's slides,
    // whichever course the learner opened, and it used to name the mathematics
    // deck to every one of them.
    expect(await screen.findByText("当前账号无权访问此课程课件")).toBeTruthy();
    expect(screen.queryByText(/数学课件/)).toBeNull();
    expect(screen.queryByText("配音资源准备中")).toBeNull();
  });

  // E12/PKG-7: "sign in again to access the PPT" used to be a label with nowhere
  // to go, on the one surface where the learner cannot do anything else.
  it("sends a signed-out playback refusal to /login and back to this course", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "sign in required" }, { status: 401 }),
      ),
    );

    const { container } = render(
      <LearningPage
        initialCourseId="math-pedagogy-learning"
        initialClassId="math-pedagogy-learning-class-1"
      />,
    );

    expect(await screen.findByText("请重新登录后访问课程课件")).toBeTruthy();
    const signInLink = container.querySelector<HTMLAnchorElement>(
      '[data-uais-learning-ppt-sign-in="true"]',
    );
    expect(signInLink?.textContent).toContain("重新登录");
    expect(signInLink?.getAttribute("href")).toBe(
      "/login?from=%2Flearning%3FcourseId%3Dmath-pedagogy-learning%26classId%3Dmath-pedagogy-learning-class-1",
    );
  });

  it("does not offer a sign-in handoff on a playback failure that is not an auth refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "boom" }, { status: 500 })),
    );

    const { container } = render(<LearningPage />);

    expect(await screen.findByText("课程课件资源暂时不可用")).toBeTruthy();
    expect(
      container.querySelector('[data-uais-learning-ppt-sign-in="true"]'),
    ).toBeNull();
  });

  // E12/PKG-7: the playback surfaces carried 52 hardcoded light hex classes and
  // zero dark handling, so the dark theme rendered a white workspace.
  it("paints the playback shell and companion panel from the shared theme tokens", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    const { container } = render(<LearningPage />);

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain("bg-[var(--background)]");
    expect(shell.className).toContain("text-[var(--foreground)]");
    expect(
      container.querySelector("#uais-learning-companion")?.className,
    ).toContain("bg-[var(--surface)]");
    // The rendered English slide keeps its document white deliberately, and the
    // amber "resources unavailable" pill keeps a literal warning hue with an
    // explicit dark pairing. Nothing else may carry a bare hex.
    const hexClasses = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .flatMap((element) =>
        typeof element.className === "string" ? element.className.split(" ") : [],
      )
      .filter((token) => /#[0-9a-fA-F]{6}/.test(token) && !token.startsWith("dark:"));
    expect(hexClasses).toEqual([]);
  });

  it("keeps the companion panel reachable below the xl three-column layout", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    const { container } = render(<LearningPage />);

    const jump = container.querySelector<HTMLElement>(
      '[data-uais-learning-mobile-jump="true"]',
    );
    expect(jump).toBeTruthy();
    // Hidden exactly where the three columns exist and the companion is already
    // on screen.
    expect(jump?.className).toContain("xl:hidden");
    expect(
      Array.from(jump?.querySelectorAll("a") ?? []).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["#uais-learning-stage", "#uais-learning-companion"]);
    expect(container.querySelector("#uais-learning-stage")).toBeTruthy();
    expect(container.querySelector("#uais-learning-companion")).toBeTruthy();
  });

  it("hydrates an approved invite-code course context when opened from the student dashboard", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/teaching/courses") {
        expect(init?.method).toBe("GET");
        expect(init?.headers).toEqual({ accept: "application/json" });
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
              courseName: "AI Supported Mathematics Research",
              semester: "2026 Spring",
            },
          ],
          classes: [
            {
              classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
              className: "Research Methods Class 1",
              semester: "2026 Spring",
            },
          ],
          memberships: [
            {
              membershipId:
                "membership-teacher-course-ai-supported-mathematics-research-20260622-112000-class-1-Peter",
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
              classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
              studentId: "Peter",
              studentDisplayName: "Peter",
              membershipStatus: "approved",
            },
          ],
        });
      }

      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LearningPage
        initialCourseId="teacher-course-ai-supported-mathematics-research-20260622-112000"
        initialClassId="teacher-course-ai-supported-mathematics-research-20260622-112000-class-1"
      />,
    );

    expect(await screen.findByText("AI Supported Mathematics Research")).toBeTruthy();
    expect(screen.getByText("Research Methods Class 1")).toBeTruthy();
    expect(screen.getByText("已通过邀请码加入")).toBeTruthy();
  });

  it("does not hydrate a pending invite-code membership as an active learning context", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/courses") {
        return Response.json({
          courses: [
            {
              courseId: "teacher-course-statistics-writing-20260622-112000",
              courseName: "Statistics Writing Studio",
              semester: "2026 Spring",
            },
          ],
          classes: [
            {
              classId: "teacher-course-statistics-writing-20260622-112000-class-1",
              courseId: "teacher-course-statistics-writing-20260622-112000",
              className: "Statistics Writing Cohort",
              semester: "2026 Spring",
            },
          ],
          memberships: [
            {
              membershipId:
                "membership-teacher-course-statistics-writing-20260622-112000-class-1-Peter",
              courseId: "teacher-course-statistics-writing-20260622-112000",
              classId: "teacher-course-statistics-writing-20260622-112000-class-1",
              studentId: "Peter",
              studentDisplayName: "Peter",
              membershipStatus: "pending-teacher-review",
            },
          ],
        });
      }

      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LearningPage
        initialCourseId="teacher-course-statistics-writing-20260622-112000"
        initialClassId="teacher-course-statistics-writing-20260622-112000-class-1"
      />,
    );

    expect(await screen.findByText("当前课程：大学研究方法")).toBeTruthy();
    expect(screen.queryByText("Statistics Writing Studio")).toBeNull();
    expect(screen.queryByText("Statistics Writing Cohort")).toBeNull();
  });

  it("keeps the full chatroom off the learning home page", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const { container } = render(<LearningPage />);

    expect(screen.getByRole("link", { name: "进入聊天室" }).getAttribute("href")).toBe(
      "/learning/chatroom",
    );
    expect(
      screen.queryByRole("heading", { name: "人机协作聊天室" }),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-uais-learning-layout="page-right-companion"]')
        ?.className,
    ).toContain("w-full");
    expect(
      container
        .querySelector('[data-uais-learning-layout="page-right-companion"]')
        ?.className,
    ).not.toContain("max-w-[1340px]");
    expect(screen.queryByText("播放设置")).toBeNull();
  });

  it("keeps study tools behind the narration dock learning-tools entry", () => {
    const { container } = render(<LearningPage />);

    const switcher = screen.getByRole("group", { name: "我的学习右侧栏目切换" });
    expect(switcher.querySelectorAll("button").length).toBe(3);
    expect(switcher.parentElement?.querySelector('button[aria-label="学习工具"]')).toBeNull();
    const narrationControls = container.querySelector(
      '[data-uais-learning-segment-controls="compact"]',
    );
    const dockStudyToolsTrigger = narrationControls?.querySelector(
      'button[aria-label="学习工具"]',
    );
    expect(dockStudyToolsTrigger).toBeTruthy();
    expect(dockStudyToolsTrigger?.className).toContain("w-full");
    expect(dockStudyToolsTrigger?.className).not.toContain("size-9");
    expect(dockStudyToolsTrigger?.textContent).toContain("学习工具");
    expect(screen.getByRole("button", { name: "智能导学" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByRole("button", { name: "本页笔记" })).toBeNull();
    expect(screen.queryByRole("button", { name: "检查点" })).toBeNull();
    expect(screen.queryByRole("button", { name: "概念卡" })).toBeNull();
    expect(screen.queryByText(/本课程暂无字幕/)).toBeNull();
    expect(screen.queryByText(/第三章/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "全部字幕" }));
    // With no published deck the subtitles tab shows an honest empty state. It
    // used to show five fabricated timestamped rows ("12:18" .. "13:30") about
    // gradient descent and the learning rate, invented for a student enrolled
    // in a mathematics-education course.
    expect(screen.getByText(/本课程暂无字幕/)).toBeTruthy();
    expect(screen.queryByText(/梯度下降的核心思想/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "课程目录" }));
    expect(screen.getByText(/第三章/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "学习工具" }));
    const toolsPanel = screen.getByRole("dialog", { name: "学习工具" });
    const toolsSwitcher = screen.getByRole("group", { name: "学习工具栏目切换" });
    expect(toolsPanel.className).toContain("fixed");
    expect(toolsPanel.className).toContain("bottom-0");
    expect(toolsPanel.className).toContain("xl:static");
    expect(toolsSwitcher.querySelectorAll("button").length).toBe(3);
    expect(screen.getByRole("button", { name: "本页笔记" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("heading", { name: "本页笔记" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "检查点" }));
    expect(screen.getByRole("heading", { name: "学习检查点" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "概念卡" }));
    expect(screen.getByRole("heading", { name: "关键概念" })).toBeTruthy();
  });

  it("shows the DOCX course directory with placeholder durations", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const { container } = render(<LearningPage />);

    fireEvent.click(screen.getByRole("button", { name: "课程目录" }));

    // E14/PKG-8b: with no published deck this really is the template's sample
    // syllabus, so it now says so. What it must not do is dress the sample up as
    // a record: the hard-coded `w-[42%]` bar and the done ticks on every lesson
    // but one are gone.
    expect(container.querySelector('[data-uais-learning-outline="sample"]')).toBeTruthy();
    expect(screen.getByText("示例课程目录")).toBeTruthy();
    expect(container.textContent).not.toContain("42%");
    expect(container.querySelector(".w-\\[42\\%\\]")).toBeNull();
    expect(container.querySelector("[data-uais-learning-outline-progress]")).toBeNull();
    expect(screen.getByText("初等数学研究（2024 春）")).toBeTruthy();
    expect(screen.getByText("康霞博士")).toBeTruthy();
    expect(screen.queryByText("机器学习导论（2024 春）")).toBeNull();
    expect(container.textContent).not.toContain("线性模型与优化方法");

    [
      "第一章 数系",
      "第二章 解析式",
      "第三章 初等函数",
      "第四章 方程",
      "第五章 不等式",
      "第六章 几何",
      "1.1 数的概念的扩展",
      "1.6 复数域",
      "2.3 分式",
      "3.2 用初等方法讨论函数",
      "5.3 几个著名的不等式",
      "6.2 直线与平面",
      "45:20",
      "52:10",
      "48:30",
      "41:25",
      "68:40",
      "36:15",
      "08:15",
      "15:30",
      "09:40",
      "11:55",
      "05:00",
    ].forEach((text) => {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    });
  });

  // E14/PKG-8b: whatever deck was on the stage, the outline tab announced
  // "初等数学研究（2024 春）", "康霞博士", a literal 42% bar and the static demo
  // syllabus with every lesson but one ticked done.
  it("derives the course outline from the published deck instead of the demo syllabus", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ playback: outlineManifest })));

    const { container } = render(<LearningPage />);

    await screen.findByText("当前课程：大学研究方法");
    fireEvent.click(screen.getByRole("button", { name: "课程目录" }));

    const outline = container.querySelector<HTMLElement>(
      '[data-uais-learning-outline="published"]',
    );
    expect(outline).toBeTruthy();
    expect(outline?.textContent).toContain("大学研究方法");
    expect(outline?.textContent).toContain("吴亚军博士");
    expect(outline?.textContent).toContain("课件 · 共 2 页");
    expect(outline?.textContent).toContain("第 1 页 研究问题从哪里来");
    expect(outline?.textContent).toContain("第 2 页 证据与论证");
    // Real slide lengths from the manifest, not the sample syllabus's timings.
    expect(outline?.textContent).toContain("00:18");
    expect(outline?.textContent).toContain("00:22");

    expect(outline?.textContent).not.toContain("初等数学研究（2024 春）");
    expect(outline?.textContent).not.toContain("康霞博士");
    expect(outline?.textContent).not.toContain("第一章 数系");
    expect(container.textContent).not.toContain("42%");
    expect(container.querySelector(".w-\\[42\\%\\]")).toBeNull();
    // No signed-in learner, so there is no completion record to report and the
    // panel says nothing about progress rather than drawing a bar.
    expect(container.querySelector("[data-uais-learning-outline-progress]")).toBeNull();
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-uais-learning-outline-lesson]"),
      ).map((lesson) => lesson.dataset.uaisLearningOutlineLesson),
    ).toEqual(["active", "pending"]);
  });

  it("reports the narration the learner actually finished instead of a fixed progress bar", async () => {
    window.localStorage.setItem(
      "uais-completed-narration:student-001:autumn-2026-research-methods:audio-manifest-autumn-2026-week-01",
      JSON.stringify(["slide-02"]),
    );
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ playback: outlineManifest })));

    const { container } = render(
      <SessionUserProvider initialSessionUser={outlineStudentUser}>
        <LearningPage />
      </SessionUserProvider>,
    );

    await screen.findByText("当前课程：大学研究方法");
    fireEvent.click(screen.getByRole("button", { name: "课程目录" }));

    const progress = await waitFor(() => {
      const panel = container.querySelector<HTMLElement>(
        '[data-uais-learning-outline-progress="narration-completion"]',
      );
      expect(panel?.textContent).toContain("1 / 2 页 · 50%");
      return panel as HTMLElement;
    });
    expect(progress.querySelector<HTMLElement>("div[style]")?.style.width).toBe("50%");

    // Exactly one lesson is marked done, and it is the one whose narration this
    // learner finished. The demo syllabus used to mark every lesson but the
    // active one done, for everybody.
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-uais-learning-outline-lesson]"),
      ).map((lesson) => lesson.dataset.uaisLearningOutlineLesson),
    ).toEqual(["active", "completed"]);
  });

  it("keeps the learner question visible without a premature AI bubble", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<LearningPage />);

    const input = screen.getByRole("textbox", { name: "向智能助教提问" }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "什么是导数？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByText("什么是导数？")).toBeTruthy();
    expect(screen.queryByText(/智能导学已收到/)).toBeNull();
    expect(screen.getAllByText(/大学研究方法/).length).toBeGreaterThan(0);
    expect(input.value).toBe("");
  });

  it("keeps a failed AI request out of the assistant transcript without shifting the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input) === "/api/learning/ai-guide"
          ? Promise.resolve(
              Response.json(
                { error: "DEEPSEEK_API_KEY is required for learning multi-agent AI guide." },
                { status: 503 },
              ),
            )
          : new Promise<Response>(() => {}),
      ),
    );
    render(<LearningPage />);

    const question = "为什么梯度下降会失败？";
    const input = screen.getByRole("textbox", { name: "向智能助教提问" });
    const sendButton = screen.getByRole("button", { name: "发送" });
    const form = input.closest("form");
    if (!form) {
      throw new Error("AI guide form not found.");
    }
    const initialLayoutBlockCount = form.childElementCount;

    fireEvent.change(input, { target: { value: question } });
    fireEvent.click(sendButton);

    await waitFor(() => expect(sendButton.hasAttribute("disabled")).toBe(false));

    const transcript = screen.getByRole("log", { name: "智能导学对话" });
    const agentRail = screen.getByRole("button", { name: /学习顾问/ }).parentElement;
    expect(transcript).toBeTruthy();
    expect(transcript.getAttribute("tabindex")).toBe("0");
    expect(transcript.textContent).toBe(question);
    expect(transcript.contains(form)).toBe(false);
    expect(transcript.className).toContain("flex-1");
    expect(transcript.className).toContain("overflow-y-auto");
    expect(agentRail?.className).toContain("shrink-0");
    expect(form.className).toContain("shrink-0");
    expect(form.childElementCount).toBe(initialLayoutBlockCount);
    expect(screen.getByText("智能服务暂时不可用，已保留你的问题。")).toBeTruthy();
  });

  it("scrolls the transcript to the real answer after it arrives", async () => {
    let resolveGuideRequest: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input) === "/api/learning/ai-guide"
          ? new Promise<Response>((resolve) => {
              resolveGuideRequest = resolve;
            })
          : new Promise<Response>(() => {}),
      ),
    );
    render(<LearningPage />);

    const transcript = screen.getByRole("log", { name: "智能导学对话" });
    Object.defineProperty(transcript, "scrollHeight", { configurable: true, value: 640 });
    const input = screen.getByRole("textbox", { name: "向智能助教提问" });
    fireEvent.change(input, { target: { value: "请解释学习率" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(transcript.scrollTop).toBe(640));
    resolveGuideRequest?.(
      Response.json({
        message: { text: "学习率控制每一步的更新幅度。" },
      }),
    );

    await screen.findByText("学习率控制每一步的更新幅度。");
    expect(transcript.scrollTop).toBe(640);
  });

  it("calls the learning AI guide API when an assistant card is selected", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/learning/ai-guide") {
        const requestBody = JSON.parse(String(init?.body));
        expect(requestBody.agentId).toBe("concept-explainer");
        expect(requestBody.question).toContain("解释");
        return Response.json({
          status: "ok",
          message: {
            id: "guide-assistant-test",
            kind: "assistant",
            text: "概念解读已经接入 Qwen 多模态能力。",
          },
          provider: {
            provider: "qwen",
            role: "multimodal",
            model: "qwen3.5-omni-plus",
          },
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LearningPage />);

    fireEvent.click(screen.getByRole("button", { name: /概念解读/ }));

    expect(await screen.findByText("概念解读已经接入 Qwen 多模态能力。")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/learning/ai-guide",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("sends the bottom AI guide input through LangGraph multi-agent mode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/learning/ai-guide") {
        const requestBody = JSON.parse(String(init?.body));
        expect(requestBody.agentId).toBe("concept-explainer");
        expect(requestBody.mode).toBe("multi-agent");
        expect(requestBody.question).toBe("把这页整理成 3 个学习要点");
        return Response.json({
          status: "ok",
          message: {
            id: "learning-ai-langgraph-multi-agent",
            kind: "assistant",
            agentId: "multi-agent",
            text: "LangGraph 多智能体导学已完成：学习顾问、概念解读和代码助手已经协同响应。",
          },
          orchestration: {
            graph: {
              runtime: "langgraph",
              graphId: "learning-ai-guide",
            },
          },
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LearningPage />);

    const input = screen.getByRole("textbox", { name: "向智能助教提问" }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "把这页整理成 3 个学习要点" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText(/LangGraph 多智能体导学已完成/)).toBeTruthy();
    expect(input.value).toBe("");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/learning/ai-guide",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("shows the LangGraph agent trace, supervisor handoff, runtime status, and memory checkpoint after a multi-agent guide response", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/learning/ai-guide") {
        const requestBody = JSON.parse(String(init?.body));
        expect(requestBody.mode).toBe("multi-agent");
        return Response.json({
          status: "ok",
          message: {
            id: "learning-ai-langgraph-multi-agent",
            kind: "assistant",
            agentId: "multi-agent",
            text: "LangGraph 多智能体导学已完成：学习顾问、概念解读和代码助手已经协同响应。",
          },
          orchestration: {
            graph: {
              runtime: "langgraph",
              graphId: "learning-ai-guide",
              supervisorNodeId: "learning-guide-supervisor",
              topologicalOrder: ["learning-advisor", "concept-explainer", "code-assistant"],
            },
            turns: [
              {
                agentId: "learning-advisor",
                label: "学习顾问",
                providerRole: "text-reasoning",
                content: "先拆解学习路径。",
              },
              {
                agentId: "concept-explainer",
                label: "概念解读",
                providerRole: "multimodal",
                content: "再解释当前课件图文。",
              },
              {
                agentId: "code-assistant",
                label: "代码助手",
                providerRole: "text-reasoning",
                content: "最后形成练习步骤。",
              },
            ],
            trace: {
              handoffs: [
                {
                  fromNodeId: "learning-guide-supervisor",
                  toNodeId: "learning-advisor",
                  reason: "start-sequence",
                },
                {
                  fromNodeId: "concept-explainer",
                  toNodeId: "code-assistant",
                  reason: "concept-grounded",
                },
              ],
              memory: {
                mode: "thread-checkpoint",
                threadId: "learning-guide-thread-001",
                store: "InMemoryStore",
              },
              humanInTheLoop: {
                status: "ready",
                resumeMode: "teacher-or-learner-review",
              },
            },
            runtime: {
              engine: "uais-langgraph-production-runtime",
              status: "completed",
              threadId: "learning-guide-thread-001",
              eventCount: 3,
            },
            runtimeEvents: [
              { type: "node-update", nodeId: "learning-advisor" },
              { type: "node-update", nodeId: "concept-explainer" },
              { type: "node-update", nodeId: "code-assistant" },
            ],
          },
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<LearningPage />);

    const input = screen.getByRole("textbox", { name: "向智能助教提问" }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "把这页整理成 3 个学习要点" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("LangGraph 执行追踪")).toBeTruthy();
    expect(screen.getByText("learning-ai-guide")).toBeTruthy();
    expect(screen.getByText("learning-guide-supervisor")).toBeTruthy();
    expect(screen.getByText(/learning-guide-thread-001/)).toBeTruthy();
    expect(screen.getByText(/Human-in-the-loop/)).toBeTruthy();
    expect(screen.getByText(/学习顾问 · text-reasoning/)).toBeTruthy();
    expect(screen.getByText(/概念解读 · multimodal/)).toBeTruthy();
    expect(screen.getByText(/代码助手 · text-reasoning/)).toBeTruthy();
    expect(container.querySelector('[data-uais-langgraph-trace="learning-ai-guide"]')).toBeTruthy();
  });

  it("starts and resumes a LangGraph human review from the AI guide trace panel", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/learning/ai-guide") {
        return Response.json({
          status: "ok",
          message: {
            id: "learning-ai-langgraph-multi-agent",
            kind: "assistant",
            agentId: "multi-agent",
            text: "LangGraph 多智能体导学已完成：学习顾问、概念解读和代码助手已经协同响应。",
          },
          orchestration: {
            graph: {
              runtime: "langgraph",
              graphId: "learning-ai-guide",
              supervisorNodeId: "learning-guide-supervisor",
              topologicalOrder: ["learning-advisor", "concept-explainer", "code-assistant"],
            },
            turns: [
              {
                agentId: "learning-advisor",
                label: "学习顾问",
                providerRole: "text-reasoning",
                content: "先拆解学习路径。",
              },
            ],
            trace: {
              handoffs: [
                {
                  fromNodeId: "learning-guide-supervisor",
                  toNodeId: "learning-advisor",
                  reason: "start-sequence",
                },
              ],
              memory: {
                mode: "thread-checkpoint",
                threadId: "learning-guide-thread-002",
                store: "InMemoryStore",
              },
              humanInTheLoop: {
                status: "ready",
                resumeMode: "teacher-or-learner-review",
              },
            },
            runtime: {
              engine: "uais-langgraph-production-runtime",
              status: "completed",
              threadId: "learning-guide-thread-002",
              eventCount: 3,
            },
            runtimeEvents: [{ type: "node-update", nodeId: "learning-advisor" }],
          },
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (String(input) === "/api/learning/ai-guide/hitl") {
        const requestBody = JSON.parse(String(init?.body));
        if (requestBody.action === "start-review") {
          expect(requestBody.threadId).toBe("learning-guide-thread-002");
          return Response.json({
            status: "interrupted",
            humanInTheLoop: {
              status: "waiting-human",
              threadId: "learning-guide-thread-002",
              interrupt: {
                value: {
                  kind: "learning-guide-human-review",
                  prompt: "请教师或学习者复核 LangGraph 导学结果。",
                },
              },
            },
            runtime: {
              engine: "uais-langgraph-production-runtime",
              graphId: "learning-ai-guide-hitl",
              status: "interrupted",
              threadId: "learning-guide-thread-002",
              eventCount: 1,
            },
            runtimeEvents: [{ type: "interrupt" }],
          });
        }

        expect(requestBody.action).toBe("resume-review");
        expect(requestBody.threadId).toBe("learning-guide-thread-002");
        return Response.json({
          status: "completed",
          message: {
            text: "人工复核已完成，LangGraph 导学线程已恢复。",
          },
          humanInTheLoop: {
            status: "resumed",
            threadId: "learning-guide-thread-002",
            decision: "approved",
          },
          runtime: {
            engine: "uais-langgraph-production-runtime",
            graphId: "learning-ai-guide-hitl",
            status: "completed",
            threadId: "learning-guide-thread-002",
            eventCount: 2,
          },
          runtimeEvents: [
            { type: "node-update", nodeId: "human-review" },
            { type: "node-update", nodeId: "resume-learning-guide" },
          ],
        });
      }

      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LearningPage />);

    const input = screen.getByRole("textbox", { name: "向智能助教提问" }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "把这页整理成 3 个学习要点" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("LangGraph 执行追踪")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "发起人工复核" }));

    expect(await screen.findByText(/等待人工复核/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认复核并恢复" }));

    expect(await screen.findByText(/人工复核已完成/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/learning/ai-guide/hitl",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("aligns the AI guide copy with the active published PPT course", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(
          "/api/learning/ppt-playback/elementary-math-research?locale=zh-CN",
        );
        return Response.json({
          playback: {
            status: "ready",
            courseId: "elementary-math-research",
            courseTitle: "初等数学研究",
            sourceDeckTitle: "初等数学研究+PPT1+自然数的序数理论.pptx",
            audioManifestId:
              "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
            teacherName: "康霞博士",
            voiceLabel: "康霞博士克隆声音",
            slideCount: 2,
            slides: [
              {
                slideId: "slide-01",
                slideNumber: 1,
                slideTitle: "自然数的序数理论",
                narrationText:
                  "同学们好，今天我们进入初等数学研究的一个基础主题：自然数的序数理论。",
                imageUrl:
                  "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
                audioUrl:
                  "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
                durationSeconds: 15.52,
              },
              {
                slideId: "slide-02",
                slideNumber: 2,
                slideTitle: "学习线索",
                narrationText: "这节课有三个核心线索：是什么、为什么学、以及如何教。",
                imageUrl:
                  "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-02.jpg",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-02",
                audioUrl:
                  "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-02",
                durationSeconds: 14.56,
              },
            ],
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "published-learning-ids-only",
            },
          },
        });
      }),
    );

    render(<LearningPage />);

    expect(await screen.findByText(/《初等数学研究》智能导学/)).toBeTruthy();
    expect(screen.getByText("当前课程：初等数学研究")).toBeTruthy();
    expect(screen.queryByText("当前课程：大学研究方法")).toBeNull();
    expect(screen.getByText(/当前第 1 页「自然数的序数理论」/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "解释「自然数的序数理论」的核心概念" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "把这页整理成 3 个学习要点" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "根据「自然数的序数理论」生成一个课堂提问" }),
    ).toBeTruthy();
    expect(screen.queryByText(/梯度下降|学习率|小智|教学助教/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "下一段" }));

    expect(screen.getByText(/当前第 2 页「学习线索」/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "解释「学习线索」的核心概念" })).toBeTruthy();
  });

  it("renders the published PPT workspace in English without Chinese visible text", async () => {
    mockPreferences.locale = "en-US";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "/api/learning/ppt-playback/elementary-math-research?locale=en-US",
      );
      return Response.json({
        playback: {
          status: "ready",
          courseId: "elementary-math-research",
          courseTitle: "Elementary Mathematics Research",
          sourceDeckTitle:
            "Elementary Mathematics Research PPT 1 Ordinal Theory of Natural Numbers.pptx",
          audioManifestId:
            "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
          teacherName: "Dr. Kang Xia",
          voiceLabel: "Dr. Kang Xia cloned voice",
          slideCount: 2,
          slides: [
            {
              slideId: "slide-01",
              slideNumber: 1,
              slideTitle: "Ordinal theory of natural numbers",
              narrationText:
                "Hello everyone. Today we begin a foundational topic in elementary mathematics research: the ordinal theory of natural numbers.",
              imageUrl:
                "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg",
              audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
              audioUrl:
                "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
              durationSeconds: 15.52,
            },
            {
              slideId: "slide-02",
              slideNumber: 2,
              slideTitle: "Learning path",
              narrationText:
                "This lesson has three core threads: what it is, why we study it, and how to teach it.",
              imageUrl:
                "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-02.jpg",
              audioId: "tts_natural-number-ordinal-theory-ppt1_slide-02",
              audioUrl:
                "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-02",
              durationSeconds: 14.56,
            },
          ],
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "published-learning-ids-only",
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<LearningPage />);

    // E16/R2: the trail is read off the published deck - its course, its own
    // title, and where in it the learner is - instead of announcing every deck
    // as "Lecture 1 / Section 1", a position nothing in the manifest supports.
    expect(
      await screen.findByText(
        "Elementary Mathematics Research / Elementary Mathematics Research PPT 1 Ordinal Theory of Natural Numbers / Slide 1 of 2",
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Dr. Kang Xia").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ordinal theory of natural numbers").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", {
        name: 'Explain the core idea of "Ordinal theory of natural numbers"',
      }),
    ).toBeTruthy();
    // E14/PKG-8b: the English branch used to be taken *before* the image branch,
    // so an en-US learner never saw `slide.imageUrl` - they got a generated card
    // in place of the deck their teacher published.
    const activeSlideImage = screen.getByRole("img", {
      name: "PPT slide 1: Ordinal theory of natural numbers",
    });
    expect(activeSlideImage.tagName).toBe("IMG");
    expect(activeSlideImage.getAttribute("src")).toBe(
      "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg",
    );
    expect(container.querySelector('[data-uais-english-slide="active"]')).toBeNull();
    const workspace = container.querySelector(
      '[data-uais-learning-playback-workspace="single-viewport"]',
    );
    expect(workspace?.textContent).not.toMatch(/\p{Script=Han}/u);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/learning/ppt-playback/elementary-math-research?locale=en-US",
    );
  });

  // The en-US card used to be "Teaching TA / Examples and questions", promising a
  // classroom question and a teaching example. The zh-CN card and the server
  // persona (`learningGuideAgents`) both call this agent the Code Assistant, so an
  // English-locale student picked a teaching-assistant card and got steps and
  // pseudocode back from an agent that had never been a TA.
  it("names the third guide agent Code Assistant in English, matching the server persona", () => {
    mockPreferences.locale = "en-US";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 404 })));

    render(<LearningPage />);

    expect(screen.getByText("Code Assistant")).toBeTruthy();
    expect(screen.getByText("Algorithms and code")).toBeTruthy();
    expect(screen.queryByText("Teaching TA")).toBeNull();
    expect(screen.queryByText("Examples and questions")).toBeNull();
    // The card's prompt must ask for what the code assistant actually does.
    const promptButton = screen.getByRole("button", { name: /Code Assistant/ });
    expect(promptButton).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "Create a classroom question and teaching example",
    );
  });

  // E14/PKG-8b: the English stand-in frame hardcoded the eyebrow "Elementary
  // Mathematics Research" and the footer "Dr. Kang Xia", so an en-US learner in
  // any other course read the demo course's branding across their own lesson.
  it("builds the English slide fallback from the played deck's own manifest", async () => {
    mockPreferences.locale = "en-US";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          playback: {
            status: "ready",
            courseId: "autumn-2026-research-methods",
            courseTitle: "University Research Methods",
            sourceDeckTitle: "Week 1 Research Questions",
            audioManifestId: "audio-manifest-autumn-2026-week-01",
            teacherName: "Prof. Wu",
            voiceLabel: "Prof. Wu cloned voice",
            slideCount: 1,
            slides: [
              {
                slideId: "slide-01",
                slideNumber: 1,
                slideTitle: "Where research questions come from",
                narrationText: "Hello everyone. This week we discuss where research questions come from.",
                imageUrl: "/learning/ppt-playback/slides/autumn-2026-week-01/page-01.jpg",
                audioId: "tts_autumn-2026-week-01_slide-01",
                audioUrl:
                  "/api/learning/ppt-playback/audio/audio-manifest-autumn-2026-week-01/tts_autumn-2026-week-01_slide-01",
                durationSeconds: 18.4,
              },
            ],
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "published-learning-ids-only",
            },
          },
        }),
      ),
    );

    const { container } = render(<LearningPage />);

    const slideImage = await screen.findByAltText(
      "PPT slide 1: Where research questions come from",
    );

    fireEvent.error(slideImage);

    const englishFrame = await waitFor(() => {
      const frame = container.querySelector('[data-uais-english-slide="active"]');
      expect(frame).toBeTruthy();
      return frame as HTMLElement;
    });
    expect(englishFrame.textContent).toContain("University Research Methods");
    expect(englishFrame.textContent).toContain("Prof. Wu");
    expect(englishFrame.textContent).toContain("Where research questions come from");
    expect(container.textContent).not.toContain("Elementary Mathematics Research");
    expect(container.textContent).not.toContain("Dr. Kang Xia");
  });

  it("falls back to the slide placeholder when a published page image is missing", async () => {
    // `imageUrl` is built from the pptAssetId for every slide unconditionally,
    // so it is never empty and the "课件图片准备中" branch below it was
    // unreachable: a deck published without its page images showed a broken
    // image icon to the student instead of the frame written for that case.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          playback: {
            status: "ready",
            courseId: "autumn-2026-research-methods",
            courseTitle: "大学研究方法",
            sourceDeckTitle: "第一周：研究问题",
            audioManifestId: "audio-manifest-autumn-2026-week-01",
            teacherName: "康霞博士",
            voiceLabel: "康霞博士克隆声音",
            slideCount: 1,
            slides: [
              {
                slideId: "slide-01",
                slideNumber: 1,
                slideTitle: "研究问题从哪里来",
                narrationText: "同学们好，这一周我们讨论研究问题的来源。",
                imageUrl: "/learning/ppt-playback/slides/autumn-2026-week-01/page-01.jpg",
                audioId: "tts_autumn-2026-week-01_slide-01",
                audioUrl:
                  "/api/learning/ppt-playback/audio/audio-manifest-autumn-2026-week-01/tts_autumn-2026-week-01_slide-01",
                durationSeconds: 18.4,
              },
            ],
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "published-learning-ids-only",
            },
          },
        }),
      ),
    );

    const { container } = render(<LearningPage />);

    const slideImage = await screen.findByAltText("课件第 1 页：研究问题从哪里来");
    expect(container.textContent).not.toContain("课件图片准备中");

    fireEvent.error(slideImage);

    await waitFor(() => {
      expect(screen.getByText("课件图片准备中")).toBeTruthy();
    });
    expect(screen.queryByAltText("课件第 1 页：研究问题从哪里来")).toBeNull();
  });

  it("keeps the published PPT and narration controls in one desktop playback workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(
          "/api/learning/ppt-playback/elementary-math-research?locale=zh-CN",
        );
        return Response.json({
          playback: {
            status: "ready",
            courseId: "elementary-math-research",
            courseTitle: "初等数学研究",
            sourceDeckTitle: "初等数学研究+PPT1+自然数的序数理论.pptx",
            audioManifestId:
              "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
            teacherName: "康霞博士",
            voiceLabel: "康霞博士克隆声音",
            slideCount: 2,
            slides: [
              {
                slideId: "slide-01",
                slideNumber: 1,
                slideTitle: "自然数的序数理论",
                narrationText:
                  "同学们好，今天我们进入初等数学研究的一个基础主题：自然数的序数理论。",
                imageUrl:
                  "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
                audioUrl:
                  "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
                durationSeconds: 15.52,
              },
              {
                slideId: "slide-02",
                slideNumber: 2,
                slideTitle: "学习线索",
                narrationText: "这节课有三个核心线索：是什么、为什么学、以及如何教。",
                imageUrl:
                  "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-02.jpg",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-02",
                audioUrl:
                  "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-02",
                durationSeconds: 14.56,
              },
            ],
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "published-learning-ids-only",
            },
          },
        });
      }),
    );

    const { container } = render(<LearningPage />);

    expect(
      await screen.findByText(
        "初等数学研究 / 初等数学研究+PPT1+自然数的序数理论 / 第 1 页，共 2 页",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("初等数学研究+PPT1+自然数的序数理论.pptx")).toBeNull();
    expect(screen.queryByText("康霞博士克隆声音")).toBeNull();
    const staticVoiceSwitch = Array.from(container.querySelectorAll("span")).find(
      (element) =>
        element.className.includes("h-6 w-11") &&
        element.className.includes("rounded-full") &&
        element.className.includes("bg-[#1f6feb]") &&
        element.textContent === "",
    );
    expect(staticVoiceSwitch).toBeUndefined();

    const workspace = container.querySelector(
      '[data-uais-learning-playback-workspace="single-viewport"]',
    );
    const pptStage = container.querySelector('[data-uais-learning-ppt-stage="compact"]');
    const pptStageBody = container.querySelector(
      '[data-uais-learning-ppt-stage-body="expanded-slide"]',
    );
    const pptFrame = container.querySelector('[data-uais-learning-ppt-frame="active-slide"]');
    const slideCount = container.querySelector(
      '[data-uais-learning-slide-count="stage-overlay"]',
    );
    const actionBar = container.querySelector('[data-uais-learning-study-actions="compact"]');
    const narrationDock = container.querySelector(
      '[data-uais-learning-narration-dock="compact"]',
    );

    expect(workspace).toBeTruthy();
    expect(workspace?.contains(pptStage)).toBe(true);
    expect(workspace?.contains(narrationDock)).toBe(true);
    expect(workspace?.className).toContain("xl:max-h-[calc(100dvh-6.5rem)]");
    expect(pptStage?.className).toContain("min-w-0");
    expect(pptStage?.className).toContain("w-full");
    expect(pptStage?.className).toContain("xl:min-h-[calc(100dvh-13.5rem)]");
    expect(pptStageBody?.className).toContain(
      "xl:grid-rows-[auto_minmax(0,1fr)]",
    );
    expect(narrationDock?.className).toContain("mt-10");
    expect(narrationDock?.className).toContain("min-w-0");
    expect(narrationDock?.className).toContain("w-full");
    expect(narrationDock?.className).toContain("xl:mt-20");
    expect(pptFrame?.className).toContain("aspect-[1467/825]");
    expect(pptFrame?.className).toContain("xl:max-w-[min(100%,103dvh)]");
    expect(pptFrame?.className).not.toContain("xl:h-full");
    expect(pptFrame?.className).not.toContain("xl:w-auto");
    expect(pptFrame?.className).not.toContain("max-w-[min(100%,78dvh,765px)]");
    expect(pptFrame?.className).not.toContain("xl:h-[min(44dvh,430px)]");
    expect(pptFrame?.className).not.toContain("xl:aspect-auto");
    expect(slideCount?.className).toContain("xl:absolute");
    expect(
      screen
        .getByRole("img", { name: "课件第 1 页：自然数的序数理论" })
        .getAttribute("data-unoptimized"),
    ).toBe("true");
    expect(actionBar?.className).toContain("xl:grid-cols-5");
    expect(narrationDock?.className).toContain("xl:min-h-0");
  });

  it("binds My Learning to the published Kang Xia cloned-voice PPT narration audio", async () => {
    const playMock = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockImplementation(function play(this: HTMLMediaElement) {
        fireEvent.play(this);
        return Promise.resolve();
      });
    const pauseMock = vi
      .spyOn(window.HTMLMediaElement.prototype, "pause")
      .mockImplementation(function pause(this: HTMLMediaElement) {
        fireEvent.pause(this);
      });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "/api/learning/ppt-playback/elementary-math-research?locale=zh-CN",
      );
      return Response.json({
        playback: {
          status: "ready",
          courseId: "elementary-math-research",
          courseTitle: "初等数学研究",
          sourceDeckTitle: "初等数学研究+PPT1+自然数的序数理论.pptx",
          audioManifestId:
            "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
          teacherName: "康霞博士",
          voiceLabel: "康霞博士克隆声音",
          slideCount: 2,
          slides: [
            {
              slideId: "slide-01",
              slideNumber: 1,
              slideTitle: "自然数的序数理论",
              narrationText:
                "同学们好，今天我们进入初等数学研究的一个基础主题：自然数的序数理论。",
              imageUrl:
                "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg",
              audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
              audioUrl:
                "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
              durationSeconds: 15.52,
            },
            {
              slideId: "slide-02",
              slideNumber: 2,
              slideTitle: "学习线索",
              narrationText: "这节课有三个核心线索：是什么、为什么学、以及如何教。",
              imageUrl:
                "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-02.jpg",
              audioId: "tts_natural-number-ordinal-theory-ppt1_slide-02",
              audioUrl:
                "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-02",
              durationSeconds: 14.56,
            },
          ],
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "published-learning-ids-only",
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<LearningPage />);

    expect(
      await screen.findByText(
        "初等数学研究 / 初等数学研究+PPT1+自然数的序数理论 / 第 1 页，共 2 页",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("初等数学研究+PPT1+自然数的序数理论.pptx")).toBeNull();
    expect(screen.queryByText("康霞博士克隆声音")).toBeNull();
    expect(screen.getAllByText("自然数的序数理论").length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("img", { name: "课件第 1 页：自然数的序数理论" })
        .getAttribute("src"),
    ).toBe("/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg");
    expect(screen.queryByText("当前课件讲解")).toBeNull();

    const audio = container.querySelector(
      '[data-uais-learning-ppt-audio="active-slide"]',
    ) as HTMLAudioElement | null;
    const teacherAvatarFrame = container.querySelector(
      '[data-uais-teacher-avatar="published-narration"]',
    ) as HTMLElement | null;
    const teacherAvatarProgressRing = container.querySelector(
      '[data-uais-teacher-avatar-progress="slide-playback"]',
    ) as HTMLElement | null;
    const teacherProfile = container.querySelector(
      '[data-uais-learning-narration-profile="published-teacher"]',
    ) as HTMLElement | null;
    const teacherAvatar = screen.getByRole("img", { name: "康霞博士教师头像" });

    expect(teacherAvatar.getAttribute("src")).toBe(
      "/learning/teacher-avatar-kang-xia-comic.png",
    );
    expect(teacherAvatar.getAttribute("data-unoptimized")).toBe("true");
    expect(teacherProfile?.className).toContain("min-w-0");
    expect(teacherAvatarFrame?.className).toContain("size-18");
    expect(teacherAvatarFrame?.dataset.speaking).toBe("false");
    expect(teacherAvatarFrame?.className).not.toContain(
      "motion-safe:animate-[spin_8s_linear_infinite]",
    );
    expect(teacherAvatarProgressRing?.getAttribute("role")).toBe("progressbar");
    expect(teacherAvatarProgressRing?.getAttribute("aria-label")).toBe("当前课件播放进度");
    expect(teacherAvatarProgressRing?.getAttribute("aria-valuenow")).toBe("0");
    expect(teacherAvatarProgressRing?.dataset.progressPercent).toBe("0");
    expect(teacherAvatarProgressRing?.getAttribute("style")).toContain(
      "conic-gradient(from 0deg",
    );
    expect(audio?.getAttribute("src")).toBe(
      "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
    );
    expect(audio?.getAttribute("controls")).toBeNull();
    expect(audio?.playbackRate).toBe(1.25);
    fireEvent.click(screen.getByRole("button", { name: /1\.25 倍/ }));
    expect(audio?.playbackRate).toBe(1);
    expect(screen.getByRole("button", { name: /1 倍/ }).textContent).toBe("1 倍");
    fireEvent.click(screen.getByRole("button", { name: /1 倍/ }));
    expect(audio?.playbackRate).toBeCloseTo(0.85, 2);
    expect(screen.getByRole("button", { name: /0\.85 倍/ }).textContent).toBe(
      "0.85 倍",
    );
    fireEvent.click(screen.getByRole("button", { name: /0\.85 倍/ }));
    expect(audio?.playbackRate).toBe(1.25);
    expect(screen.getByRole("button", { name: /1\.25 倍/ }).textContent).toBe(
      "1.25 倍",
    );
    expect(screen.queryByText(/约 15\.52 秒/)).toBeNull();
    expect(screen.getByText("0:00 / 0:16")).toBeTruthy();
    const customControls = container.querySelector(
      '[data-uais-learning-audio-controls="custom"]',
    ) as HTMLElement | null;
    expect(customControls?.parentElement?.textContent).not.toContain("第 1 页");
    const progressRail = container.querySelector(
      '[data-uais-learning-audio-progress="rail"]',
    ) as HTMLElement | null;
    const timeReadout = container.querySelector(
      '[data-uais-learning-audio-time="elapsed"]',
    ) as HTMLElement | null;
    const dockLayout = container.querySelector(
      '[data-uais-learning-narration-dock-layout="desktop"]',
    ) as HTMLElement | null;
    const segmentControls = container.querySelector(
      '[data-uais-learning-segment-controls="compact"]',
    ) as HTMLElement | null;
    expect(dockLayout?.className).toContain(
      "xl:grid-cols-[220px_minmax(340px,440px)_minmax(300px,1fr)]",
    );
    expect(dockLayout?.className).toContain("xl:gap-4");
    expect(customControls?.className).toContain(
      "sm:grid-cols-[44px_104px_minmax(160px,520px)_40px]",
    );
    expect(customControls?.className).not.toContain("rounded-full");
    expect(progressRail?.className).toContain("max-w-[520px]");
    expect(timeReadout?.className).toContain("min-w-[92px]");
    expect(segmentControls?.className).toContain(
      "grid-cols-[36px_36px_1px_72px_minmax(140px,1fr)]",
    );
    expect(segmentControls?.className).not.toContain("grid-rows-[38px_30px]");
    expect(segmentControls?.className).toContain("sm:pl-4");
    expect(screen.queryByText("…")).toBeNull();
    const progressSlider = screen.getByRole("slider", { name: "讲解进度" }) as HTMLInputElement;
    expect(progressSlider.getAttribute("max")).toBe("15.52");
    expect(progressSlider.value).toBe("0");
    fireEvent.change(progressSlider, { target: { value: "7.5" } });
    expect(audio?.currentTime).toBe(7.5);
    expect(screen.getByText("0:08 / 0:16")).toBeTruthy();
    expect(teacherAvatarProgressRing?.getAttribute("aria-valuenow")).toBe("48");
    expect(teacherAvatarProgressRing?.dataset.progressPercent).toBe("48");
    expect(teacherAvatarProgressRing?.getAttribute("style")).toContain(
      "conic-gradient(from 0deg",
    );
    expect(screen.getByRole("button", { name: "静音讲解" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "静音讲解" }));
    expect(audio?.muted).toBe(true);
    expect(screen.getByRole("button", { name: "恢复音量" })).toBeTruthy();

    const primaryNarrationButton = screen.getByRole("button", { name: "播放讲解" });
    expect(customControls?.contains(primaryNarrationButton)).toBe(true);
    fireEvent.click(primaryNarrationButton);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(teacherAvatarFrame?.dataset.speaking).toBe("true");
    expect(teacherAvatarFrame?.className).not.toContain(
      "motion-safe:animate-[spin_8s_linear_infinite]",
    );

    fireEvent.click(screen.getByRole("button", { name: "暂停讲解" }));
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(teacherAvatarFrame?.dataset.speaking).toBe("false");

    fireEvent.play(audio as HTMLAudioElement);
    expect(teacherAvatarFrame?.dataset.speaking).toBe("true");
    expect(teacherAvatarFrame?.className).not.toContain(
      "motion-safe:animate-[spin_8s_linear_infinite]",
    );

    fireEvent.pause(audio as HTMLAudioElement);
    expect(teacherAvatarFrame?.dataset.speaking).toBe("false");

    fireEvent.play(audio as HTMLAudioElement);
    fireEvent.ended(audio as HTMLAudioElement);
    expect(teacherAvatarFrame?.dataset.speaking).toBe("false");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requests fullscreen on only the active published PPT image frame", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "/api/learning/ppt-playback/elementary-math-research?locale=zh-CN",
      );
      return Response.json({
        playback: {
          status: "ready",
          courseId: "elementary-math-research",
          courseTitle: "初等数学研究",
          sourceDeckTitle: "初等数学研究+PPT1+自然数的序数理论.pptx",
          audioManifestId:
            "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
          teacherName: "康霞博士",
          voiceLabel: "康霞博士克隆声音",
          slideCount: 1,
          slides: [
            {
              slideId: "slide-01",
              slideNumber: 1,
              slideTitle: "自然数的序数理论",
              narrationText:
                "同学们好，今天我们进入初等数学研究的一个基础主题：自然数的序数理论。",
              imageUrl:
                "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg",
              audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
              audioUrl:
                "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
              durationSeconds: 15.52,
            },
          ],
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "published-learning-ids-only",
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    const exitFullscreen = vi.fn(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });

    render(<LearningPage />);

    const fullscreenButton = await screen.findByRole("button", {
      name: "全屏显示课件",
    });
    expect(fullscreenButton.getAttribute("title")).toBe("全屏显示课件");

    fireEvent.click(fullscreenButton);

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    const requestedElement = requestFullscreen.mock.contexts[0] as HTMLElement | undefined;
    fullscreenElement = requestedElement ?? null;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(requestedElement?.getAttribute("data-uais-learning-ppt-frame")).toBe(
      "active-slide",
    );
    expect(
      requestedElement?.contains(
        screen.getByRole("img", { name: "课件第 1 页：自然数的序数理论" }),
      ),
    ).toBe(true);
    expect(requestedElement?.querySelector("audio")).toBeNull();
    expect(await screen.findByRole("button", { name: "退出课件全屏" })).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "全屏显示课件" })).toBeTruthy();
  });

  it("uses the bottom narration arrows to move between published PPT slides", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "/api/learning/ppt-playback/elementary-math-research?locale=zh-CN",
      );
      return Response.json({
        playback: {
          status: "ready",
          courseId: "elementary-math-research",
          courseTitle: "初等数学研究",
          sourceDeckTitle: "初等数学研究+PPT1+自然数的序数理论.pptx",
          audioManifestId:
            "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
          teacherName: "康霞博士",
          voiceLabel: "康霞博士克隆声音",
          slideCount: 2,
          slides: [
            {
              slideId: "slide-01",
              slideNumber: 1,
              slideTitle: "自然数的序数理论",
              narrationText:
                "同学们好，今天我们进入初等数学研究的一个基础主题：自然数的序数理论。",
              imageUrl:
                "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg",
              audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
              audioUrl:
                "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
              durationSeconds: 15.52,
            },
            {
              slideId: "slide-02",
              slideNumber: 2,
              slideTitle: "学习线索",
              narrationText: "这节课有三个核心线索：是什么、为什么学、以及如何教。",
              imageUrl:
                "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-02.jpg",
              audioId: "tts_natural-number-ordinal-theory-ppt1_slide-02",
              audioUrl:
                "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-02",
              durationSeconds: 14.56,
            },
          ],
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "published-learning-ids-only",
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<LearningPage />);

    expect(
      await screen.findByText(
        "初等数学研究 / 初等数学研究+PPT1+自然数的序数理论 / 第 1 页，共 2 页",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("初等数学研究+PPT1+自然数的序数理论.pptx")).toBeNull();
    expect(screen.queryByText("康霞博士克隆声音")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "下一段" }));

    const audio = container.querySelector(
      '[data-uais-learning-ppt-audio="active-slide"]',
    ) as HTMLAudioElement | null;
    expect(audio?.getAttribute("src")).toBe(
      "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-02",
    );
    expect(screen.getByText("2 / 2")).toBeTruthy();
    // E16/R2: the trail follows the learner. The fabricated "第一讲 / 第一节" it
    // replaced said section one on slide nineteen just as readily as on slide
    // one, so the position has to be pinned as MOVING, not merely as present.
    expect(
      container.querySelector('[data-uais-learning-course-path="published-ppt"]')
        ?.textContent,
    ).toContain("第 2 页，共 2 页");
    expect(
      container.querySelector('[data-uais-learning-audio-controls="custom"]')?.parentElement
        ?.textContent,
    ).not.toContain("第 2 页");
    expect(screen.queryByText(/约 14\.56 秒/)).toBeNull();
    expect(screen.getAllByText("学习线索").length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("img", { name: "课件第 2 页：学习线索" })
        .getAttribute("src"),
    ).toBe("/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-02.jpg");

    fireEvent.click(screen.getByRole("button", { name: "上一段" }));

    expect(audio?.getAttribute("src")).toBe(
      "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
    );
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(
      container.querySelector('[data-uais-learning-course-path="published-ppt"]')
        ?.textContent,
    ).toContain("第 1 页，共 2 页");
    expect(
      container.querySelector('[data-uais-learning-audio-controls="custom"]')?.parentElement
        ?.textContent,
    ).not.toContain("第 1 页");
    expect(screen.queryByText(/约 15\.52 秒/)).toBeNull();
  });

  it("jumps the published PPT to the clicked subtitle page", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "/api/learning/ppt-playback/elementary-math-research?locale=zh-CN",
      );
      return Response.json({
        playback: {
          status: "ready",
          courseId: "elementary-math-research",
          courseTitle: "初等数学研究",
          sourceDeckTitle: "初等数学研究+PPT1+自然数的序数理论.pptx",
          audioManifestId:
            "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
          teacherName: "康霞博士",
          voiceLabel: "康霞博士克隆声音",
          slideCount: 19,
          slides: Array.from({ length: 19 }, (_, index) => {
            const slideNumber = index + 1;
            const slideId = `slide-${String(slideNumber).padStart(2, "0")}`;
            const slideTitle = slideNumber === 15 ? "教学情境" : `第 ${slideNumber} 页标题`;

            return {
              slideId,
              slideNumber,
              slideTitle,
              narrationText:
                slideNumber === 15
                  ? "现在把视角转向教学情境。手机支付和网银转账为什么能安全传输？"
                  : `这是第 ${slideNumber} 页的讲解字幕。`,
              imageUrl: `/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-${String(slideNumber).padStart(2, "0")}.jpg`,
              audioId: `tts_natural-number-ordinal-theory-ppt1_${slideId}`,
              audioUrl: `/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_${slideId}`,
              durationSeconds: 10 + slideNumber,
            };
          }),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "published-learning-ids-only",
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<LearningPage />);

    expect(await screen.findByRole("img", { name: "课件第 1 页：第 1 页标题" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "全部字幕" }));
    const page15Subtitle = screen.getByRole("button", {
      name: "跳转到第 15 页：教学情境",
    });
    fireEvent.click(page15Subtitle);

    expect(page15Subtitle.getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByText("第 15 页").length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("img", { name: "课件第 15 页：教学情境" })
        .getAttribute("src"),
    ).toBe("/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-15.jpg");
    expect(
      (
        container.querySelector(
          '[data-uais-learning-ppt-audio="active-slide"]',
        ) as HTMLAudioElement | null
      )?.getAttribute("src"),
    ).toBe(
      "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-15",
    );
  });

  it("runs the five slide study actions from the PPT toolbar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const createObjectUrl = vi.fn(() => "blob:uais-study-notes");
    const revokeObjectUrl = vi.fn();
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    render(<LearningPage />);

    fireEvent.click(screen.getByRole("button", { name: "问这页" }));
    const aiInput = screen.getByRole("textbox", { name: "向智能助教提问" }) as HTMLInputElement;
    expect(aiInput.value).toContain("请解释当前页");
    expect(document.activeElement).toBe(aiInput);

    fireEvent.click(screen.getByRole("button", { name: "生成笔记" }));
    expect(screen.getByRole("button", { name: "本页笔记" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("heading", { name: "本页笔记" })).toBeTruthy();
    expect(screen.getAllByText(/把研究问题转化为可观察证据/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "学习检查点" }));
    expect(screen.getByRole("heading", { name: "学习检查点" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /检查点 1/ }));
    expect(screen.getByText(/参考答案/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关键概念" }));
    expect(screen.getByRole("heading", { name: "关键概念" })).toBeTruthy();
    expect(screen.getByText("变量关系")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "导出笔记" }));
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:uais-study-notes");
  });
});

// /learning was hardwired to fetch the demo course's deck no matter which course
// the student had actually enrolled in, and the effect did not even depend on
// the course. A student in the real September course got a 403
// (`student-course-membership-required`, because their membership is for a
// different courseId) over content that was not theirs anyway.
describe("LearningPage playback routing", () => {
  function stubPlaybackFetch() {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/learning/ppt-playback/")) {
          requested.push(url);
          return new Response(JSON.stringify({ playback: undefined }), { status: 404 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    return requested;
  }

  it("fetches the playback for the course the learner arrived with", async () => {
    const requested = stubPlaybackFetch();

    render(<LearningPage initialCourseId="autumn-2026-research-methods" />);

    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(requested[0]).toBe(
      "/api/learning/ppt-playback/autumn-2026-research-methods?locale=zh-CN",
    );
  });

  it("falls back to the demo course when no course is supplied", async () => {
    const requested = stubPlaybackFetch();

    render(<LearningPage />);

    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(requested[0]).toBe(
      "/api/learning/ppt-playback/elementary-math-research?locale=zh-CN",
    );
  });

  it("shows an honest empty state rather than a fabricated lecture when no deck loads", async () => {
    stubPlaybackFetch();

    const { container } = render(<LearningPage initialCourseId="autumn-2026-research-methods" />);

    await waitFor(() =>
      expect(container.querySelector("[data-uais-learning-ppt-empty]")).toBeTruthy(),
    );
    expect(screen.getByText(/本课程暂无已发布课件/)).toBeTruthy();
    // The invented machine-learning lesson that used to render here.
    expect(screen.queryByText(/梯度下降算法/)).toBeNull();
    expect(screen.queryByText(/最小二乘法原理/)).toBeNull();
    expect(screen.queryByText("30 / 68")).toBeNull();
    expect(screen.queryByText(/章节 3 \/ 8/)).toBeNull();
  });
});
