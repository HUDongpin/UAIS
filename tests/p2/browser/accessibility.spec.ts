import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { copy } from "@/i18n/copy";
import {
  authenticateFixture,
  localeForProject,
  prepareP2BrowserFixture,
} from "./fixtures";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("@a11y WCAG 2.2 AA automated baseline", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    await prepareP2BrowserFixture(context, testInfo);
  });

  test("login empty and error states have no serious or critical violations", async (
    { page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    await page.goto("/login");
    await assertNoBlockingViolations(page, testInfo, "login-empty");

    await page.getByRole("button", {
      name: locale === "zh-CN" ? "立即登录" : "Log In",
    }).click();
    await expect(page.locator("[data-uais-login-failure]")).toBeVisible();
    await assertNoBlockingViolations(page, testInfo, "login-error");
  });

  test("student core surfaces have no serious or critical violations", async (
    { page },
    testInfo,
  ) => {
    await authenticateFixture(page, testInfo, "student-a");
    for (const path of ["/courses", "/learning", "/learning/chatroom"] as const) {
      await page.goto(path);
      if (path === "/learning") {
        await expect(page.getByText(/(?:课件|PPT) 1 \/ 19/)).toBeVisible();
      }
      await assertNoBlockingViolations(page, testInfo, path.slice(1).replaceAll("/", "-"));
      if (path === "/courses") {
        await page.getByRole("searchbox", {
          name: localeForProject(testInfo) === "zh-CN" ? "搜索课程" : "Search courses",
        }).fill("p2-no-accessibility-result");
        await expect(page.getByRole("status")).toBeVisible();
        await assertNoBlockingViolations(page, testInfo, "courses-no-results");

        const locale = localeForProject(testInfo);
        await page.getByLabel(locale === "zh-CN" ? "邀请码" : "Invite code").fill(
          "invalid invite!",
        );
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
        await assertNoBlockingViolations(page, testInfo, "courses-invite-error");
      }
    }
  });

  test("learning media failure and recovery states are accessible", async (
    { page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    let playbackManifestUnavailable = true;
    await page.route("**/api/learning/ppt-playback/**", async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const isPlaybackManifest =
        request.method() === "GET" &&
        requestUrl.pathname ===
          "/api/learning/ppt-playback/elementary-math-research";
      if (isPlaybackManifest && playbackManifestUnavailable) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ reasonCode: "playback-temporarily-unavailable" }),
        });
        return;
      }
      await route.continue();
    });

    await authenticateFixture(page, testInfo, "student-a");
    await page.goto(
      "/learning?courseId=elementary-math-research&classId=elementary-math-research-class-1",
    );
    await expect(page.locator('[data-uais-learning-ppt-error="unavailable"]')).toBeVisible();
    await assertNoBlockingViolations(page, testInfo, "learning-media-error");

    playbackManifestUnavailable = false;
    await page.getByRole("button", {
      name: locale === "zh-CN" ? "重新加载课件" : "Retry loading slides",
    }).click();
    await expect(page.getByText(/(?:课件|PPT) 1 \/ 19/)).toBeVisible();
    await assertNoBlockingViolations(page, testInfo, "learning-media-recovered");
  });

  test("chatroom message and recoverable provider error states are accessible", async (
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
    await assertNoBlockingViolations(page, testInfo, "chatroom-empty");

    await composer.fill("P2 accessibility message");
    await composer.press("Enter");
    await expect(page.getByRole("log")).toContainText("P2 accessibility message");
    await assertNoBlockingViolations(page, testInfo, "chatroom-message");

    await page.route("**/api/learning/chatroom", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ reasonCode: "provider-unavailable" }),
        });
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: /@研究助教|@ResearchTA/ }).click();
    await composer.pressSequentially("P2 provider recovery check");
    await composer.press("Enter");
    await expect(page.locator('[data-uais-chatroom-error="true"]')).toContainText(
      copy[locale].learning.agentUnavailable,
    );
    await assertPlaceholderContrast(page, "#group-message");
    await assertNoBlockingViolations(page, testInfo, "chatroom-provider-error");

    const exportPagePromise = context.waitForEvent("page");
    await page.getByRole("button", {
      name: locale === "zh-CN" ? "导出文档" : "Export PDF",
    }).click();
    const exportPage = await exportPagePromise;
    await exportPage.waitForLoadState("domcontentloaded");
    await expect(exportPage.locator("main")).toBeVisible();
    await assertNoBlockingViolations(exportPage, testInfo, "chatroom-export-complete");
    await exportPage.close();
  });

  test("teacher surface has no serious or critical violations", async (
    { page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    await authenticateFixture(page, testInfo, "teacher-a");
    await page.goto("/teaching");
    await assertNoBlockingViolations(page, testInfo, "teaching");
    await page.getByRole("button", { name: /新增课程|New Course/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await assertNoBlockingViolations(page, testInfo, "teaching-new-course-dialog");
    await page.keyboard.press("Escape");

    const groupPanel = page.locator(
      '[data-uais-learning-group-panel="elementary-math-research"]',
    );
    await expect(groupPanel).toBeVisible();
    await groupPanel.getByRole("button", {
      name:
        locale === "zh-CN"
          ? "管理P2 演示课件播放课程的小组"
          : "Manage groups for P2 演示课件播放课程",
    }).click();
    await expect(groupPanel.locator('[data-uais-learning-group="p2-group-a"]')).toBeVisible();
    await assertNoBlockingViolations(page, testInfo, "teaching-groups");

    await groupPanel.getByRole("button", {
      name:
        locale === "zh-CN"
          ? "为P2 演示课件播放课程新建小组"
          : "New group for P2 演示课件播放课程",
    }).click();
    await expect(page.locator('[data-uais-learning-group-dialog="create"]')).toBeVisible();
    await assertNoBlockingViolations(page, testInfo, "teaching-group-dialog");
    await page.keyboard.press("Escape");

    const groupCard = groupPanel.locator('[data-uais-learning-group="p2-group-a"]');
    await groupCard.getByRole("button", {
      name: locale === "zh-CN" ? "删除P2 Group A" : "Delete P2 Group A",
    }).click();
    await expect(
      groupCard.getByRole("button", {
        name: locale === "zh-CN" ? "确认删除P2 Group A" : "Confirm deleting P2 Group A",
      }),
    ).toBeVisible();
    await assertNoBlockingViolations(
      page,
      testInfo,
      "teaching-danger-confirmation",
      '[data-uais-learning-group="p2-group-a"]',
    );
  });
});

async function assertNoBlockingViolations(
  page: Page,
  testInfo: TestInfo,
  state: string,
  rootSelector?: string,
) {
  let builder = new AxeBuilder({ page }).withTags(wcagTags);
  if (rootSelector) {
    builder = builder.include(rootSelector);
  }
  const results = await builder.analyze();
  const compact = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({ target: node.target, html: "redacted" })),
  }));
  await testInfo.attach(`axe-${state}`, {
    body: Buffer.from(JSON.stringify(compact, null, 2)),
    contentType: "application/json",
  });

  const blocking = compact.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function assertPlaceholderContrast(page: Page, selector: string) {
  const contrast = await page.locator(selector).evaluate((element) => {
    const parseRgb = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return {
        red: channels[0] ?? 0,
        green: channels[1] ?? 0,
        blue: channels[2] ?? 0,
        alpha: channels[3] ?? 1,
      };
    };
    const luminance = (red: number, green: number, blue: number) =>
      [red, green, blue]
        .map((channel) => channel / 255)
        .map((channel) =>
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4,
        )
        .reduce(
          (total, channel, index) =>
            total + channel * [0.2126, 0.7152, 0.0722][index],
          0,
        );

    const background = parseRgb(getComputedStyle(element).backgroundColor);
    const placeholder = parseRgb(getComputedStyle(element, "::placeholder").color);
    const blended = {
      red: placeholder.red * placeholder.alpha + background.red * (1 - placeholder.alpha),
      green:
        placeholder.green * placeholder.alpha + background.green * (1 - placeholder.alpha),
      blue:
        placeholder.blue * placeholder.alpha + background.blue * (1 - placeholder.alpha),
    };
    const foregroundLuminance = luminance(blended.red, blended.green, blended.blue);
    const backgroundLuminance = luminance(
      background.red,
      background.green,
      background.blue,
    );

    return (
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    );
  });

  expect(contrast).toBeGreaterThanOrEqual(4.5);
}
