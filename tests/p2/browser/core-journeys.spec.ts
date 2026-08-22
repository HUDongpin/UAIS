import { expect, test } from "@playwright/test";
import {
  authenticateFixture,
  collectConsoleErrors,
  collectHttpErrors,
  localeForProject,
  prepareP2BrowserFixture,
} from "./fixtures";

test.describe("@e2e P2 core browser journeys", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    await prepareP2BrowserFixture(context, testInfo);
  });

  test("student can render every protected learning surface", async (
    { page },
    testInfo,
  ) => {
    const consoleErrors = collectConsoleErrors(page);
    const httpErrors = collectHttpErrors(page);
    await authenticateFixture(page, testInfo, "student-a");

    for (const path of ["/courses", "/learning", "/learning/chatroom"] as const) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
      await expect(page.locator("main")).toBeVisible();
      if (path === "/learning") {
        await expect(page.getByText(/(?:课件|PPT) 1 \/ 19/)).toBeVisible();
      }
    }
    expect({ consoleErrors, httpErrors }).toEqual({
      consoleErrors: [],
      httpErrors: [],
    });
  });

  test("course search, no-results recovery, and invalid invite keep user input", async (
    { page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    await authenticateFixture(page, testInfo, "student-a");
    await page.goto("/courses");

    const search = page.getByRole("searchbox", {
      name: locale === "zh-CN" ? "搜索课程" : "Search courses",
    });
    await search.fill("p2-definitely-no-matching-course");
    await expect(page.getByRole("status")).toContainText(
      locale === "zh-CN" ? "没有找到匹配的课程" : "No matching courses",
    );
    await page.getByRole("button", {
      name: locale === "zh-CN" ? "清除搜索" : "Clear search",
    }).click();
    await expect(search).toHaveValue("");

    const invite = page.getByLabel(locale === "zh-CN" ? "邀请码" : "Invite code");
    await invite.fill("invalid invite!");
    await page.getByRole("button", {
      name: locale === "zh-CN" ? "使用邀请码加入" : "Join with This Code",
    }).click();
    await expect(
      page.getByText(
        locale === "zh-CN"
          ? "邀请码格式无效，请检查后重试。"
          : "That invite code is not a valid code. Check it and try again.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(invite).toHaveValue("invalid invite!");
  });

  test("student can traverse the complete 19-slide deck with narration available", async (
    { page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    await authenticateFixture(page, testInfo, "student-a");
    await page.goto(
      "/learning?courseId=elementary-math-research&classId=elementary-math-research-class-1",
    );
    await expect(page.getByText(/(?:课件|PPT) 1 \/ 19/)).toBeVisible();
    const audio = page.locator('[data-uais-learning-ppt-audio="active-slide"]');
    await expect(audio).toHaveCount(1);
    await expect(audio).toHaveAttribute("src", /\/api\/learning\/ppt-playback\/audio\//);

    const next = page.getByRole("button", {
      name: locale === "zh-CN" ? "下一段" : "Next",
      exact: true,
    });
    const stageSlideCount = page.locator(
      '[data-uais-learning-slide-count="stage-overlay"]',
    );
    for (let slide = 2; slide <= 19; slide += 1) {
      await next.click();
      await expect(stageSlideCount).toHaveText(`${slide} / 19`);
    }
    await expect(next).toBeDisabled();
  });

  test("student can retry a failed learning-media manifest without losing the route", async (
    { page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    let playbackRequestCount = 0;
    await page.route("**/api/learning/ppt-playback/**", async (route) => {
      if (route.request().method() === "GET" && playbackRequestCount === 0) {
        playbackRequestCount += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ reasonCode: "playback-temporarily-unavailable" }),
        });
        return;
      }
      playbackRequestCount += 1;
      await route.continue();
    });

    await authenticateFixture(page, testInfo, "student-a");
    await page.goto(
      "/learning?courseId=elementary-math-research&classId=elementary-math-research-class-1",
    );
    await expect(page.locator('[data-uais-learning-ppt-error="unavailable"]')).toBeVisible();

    const retry = page.getByRole("button", {
      name: locale === "zh-CN" ? "重新加载课件" : "Retry loading slides",
    });
    await expect(retry).toBeVisible();
    await retry.click();

    await expect(page).toHaveURL(/\/learning\?courseId=elementary-math-research/);
    await expect(page.getByText(/(?:课件|PPT) 1 \/ 19/)).toBeVisible();
    await expect(page.locator('[data-uais-learning-ppt-error="unavailable"]')).toHaveCount(0);
    expect(playbackRequestCount).toBeGreaterThanOrEqual(2);
  });

  test("chatroom supports multiline keyboard sending and authorized export", async (
    { context, page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    await authenticateFixture(page, testInfo, "student-a");
    await page.goto("/learning/chatroom");
    await page.getByRole("button", { name: /P2 演示课件播放课程/ }).click();

    const composer = page.getByLabel(
      locale === "zh-CN" ? "发送小组消息" : "Send group message",
    );
    await expect(composer).toBeEnabled();
    await composer.fill("P2 first line");
    await composer.press("Shift+Enter");
    await composer.pressSequentially("P2 second line");
    await expect(composer).toHaveValue("P2 first line\nP2 second line");
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    await expect(page.getByRole("log")).toContainText("P2 first line");
    await expect(page.getByRole("log")).toContainText("P2 second line");

    const exportPagePromise = context.waitForEvent("page");
    await page.getByRole("button", {
      name: locale === "zh-CN" ? "导出文档" : "Export PDF",
    }).click();
    const exportPage = await exportPagePromise;
    await exportPage.waitForLoadState("domcontentloaded");
    await expect(exportPage).toHaveURL(
      /\/learning\/chatroom\/export\?.*courseId=elementary-math-research.*groupId=p2-group-a/,
    );
    await expect(exportPage.locator("main")).toBeVisible();
    await exportPage.close();
  });

  test("teacher can render teaching and course surfaces without a dead cover button", async (
    { page },
    testInfo,
  ) => {
    await authenticateFixture(page, testInfo, "teacher-a");
    await page.goto("/teaching");
    await expect(page.locator("main")).toBeVisible();
    const newCourse = page.getByRole("button", { name: /新增课程|New Course/i });
    await newCourse.focus();
    await newCourse.click();
    await expect(
      page.getByRole("textbox", {
        name: localeForProject(testInfo) === "zh-CN" ? "名称" : "Name",
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: /修改封面|Modify the cover/i }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(newCourse).toBeFocused();

    await page.goto("/courses");
    await expect(page.locator("main")).toBeVisible();
  });

  test("language and theme changes preserve the route and keyboard focus", async (
    { page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    await authenticateFixture(page, testInfo, "student-a");
    await page.goto("/courses");

    const theme = page.getByRole("button", {
      name: locale === "zh-CN" ? "主题" : "Theme",
    });
    await theme.focus();
    await theme.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page).toHaveURL(/\/courses$/);
    await expect(theme).toBeFocused();

    const language = page.getByRole("button", {
      name: locale === "zh-CN" ? "语言" : "Language",
    });
    await language.focus();
    await language.click();
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      locale === "zh-CN" ? "en-US" : "zh-CN",
    );
    await expect(page).toHaveURL(/\/courses$/);
    await expect(
      page.getByRole("button", {
        name: locale === "zh-CN" ? "Language" : "语言",
      }),
    ).toBeFocused();
  });

  test("an expired session returns safely to login without protected content", async (
    { page },
    testInfo,
  ) => {
    await authenticateFixture(page, testInfo, "student-a");
    await page.goto("/learning");
    await expect(page.getByText(/(?:课件|PPT) 1 \/ 19/)).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/learning");
    await expect(page).toHaveURL(/\/login\?from=%2Flearning$/);
    await expect(page.locator('[data-uais-learning-playback-workspace]')).toHaveCount(0);
  });

  test("skip link moves keyboard focus to the main region", async ({ page }, testInfo) => {
    const locale = localeForProject(testInfo);
    await authenticateFixture(page, testInfo, "student-a");
    await page.goto("/courses");

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", {
      name: locale === "zh-CN" ? "跳到主要内容" : "Skip to main content",
    });
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#uais-main-content")).toBeFocused();
  });

  test("mobile navigation opens, closes, and restores focus", async (
    { page },
    testInfo,
  ) => {
    test.skip(!testInfo.project.name.startsWith("mobile-"), "mobile project only");
    await authenticateFixture(page, testInfo, "student-a");
    await page.goto("/courses");

    const trigger = page.locator('[data-uais-mobile-nav-trigger="true"]');
    await trigger.focus();
    await trigger.press("Enter");
    await expect(page.locator('[data-uais-mobile-nav="drawer"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-uais-mobile-nav="drawer"]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
