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
      }
    }
  });

  test("chatroom message and recoverable provider error states are accessible", async (
    { page },
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
    await assertNoBlockingViolations(page, testInfo, "chatroom-provider-error");
  });

  test("teacher surface has no serious or critical violations", async (
    { page },
    testInfo,
  ) => {
    await authenticateFixture(page, testInfo, "teacher-a");
    await page.goto("/teaching");
    await assertNoBlockingViolations(page, testInfo, "teaching");
    await page.getByRole("button", { name: /新增课程|New Course/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await assertNoBlockingViolations(page, testInfo, "teaching-new-course-dialog");
  });
});

async function assertNoBlockingViolations(
  page: Page,
  testInfo: TestInfo,
  state: string,
) {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
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
