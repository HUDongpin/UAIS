import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  authenticateFixture,
  prepareP2BrowserFixture,
} from "./fixtures";

const studentPaths = ["/courses", "/learning", "/learning/chatroom"] as const;

test.describe("@manual-assist accessibility geometry and motion probes", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    await prepareP2BrowserFixture(context, testInfo);
  });

  test("200 percent browser-layout reflow has no page-level horizontal overflow", async (
    { page },
    testInfo,
  ) => {
    test.skip(testInfo.project.name !== "desktop-zh-CN", "single desktop geometry lane");
    await page.setViewportSize({ width: 720, height: 900 });
    await authenticateFixture(page, testInfo, "student-a");

    const findings = [];
    for (const path of studentPaths) {
      await gotoReady(page, path);
      findings.push(await inspectPageOverflow(page, `${path}:layout-200-percent`));
    }

    await authenticateFixture(page, testInfo, "teacher-a");
    await gotoReady(page, "/teaching");
    findings.push(await inspectPageOverflow(page, "/teaching:layout-200-percent"));
    await attachJson(testInfo, "reflow-200-percent", findings);
    expect(findings.filter((finding) => finding.pageOverflow)).toEqual([]);
  });

  test("200 percent text-only scaling has no page-level horizontal overflow", async (
    { page },
    testInfo,
  ) => {
    test.skip(testInfo.project.name !== "desktop-zh-CN", "single desktop text-scale lane");
    await page.setViewportSize({ width: 1440, height: 900 });
    await authenticateFixture(page, testInfo, "student-a");

    const findings = [];
    for (const path of studentPaths) {
      await gotoReady(page, path);
      await applyTextScale(page);
      findings.push(await inspectPageOverflow(page, `${path}:text-200-percent`));
    }

    await authenticateFixture(page, testInfo, "teacher-a");
    await gotoReady(page, "/teaching");
    await applyTextScale(page);
    findings.push(await inspectPageOverflow(page, "/teaching:text-200-percent"));
    await attachJson(testInfo, "text-scale-200-percent", findings);
    console.log(
      `UAIS_TEXT_SCALE_SUMMARY ${JSON.stringify(
        findings.map(({ state, viewportWidth, scrollWidth, pageOverflow }) => ({
          state,
          viewportWidth,
          scrollWidth,
          pageOverflow,
        })),
      )}`,
    );
    expect(findings.filter((finding) => finding.pageOverflow)).toEqual([]);
  });

  test("reduced-motion preference suppresses material animation and transitions", async (
    { page },
    testInfo,
  ) => {
    test.skip(testInfo.project.name !== "desktop-zh-CN", "single desktop motion lane");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await authenticateFixture(page, testInfo, "student-a");

    const findings = [];
    for (const path of studentPaths) {
      await gotoReady(page, path);
      findings.push(await inspectReducedMotion(page, path));
    }

    await authenticateFixture(page, testInfo, "teacher-a");
    await gotoReady(page, "/teaching");
    findings.push(await inspectReducedMotion(page, "/teaching"));
    await attachJson(testInfo, "reduced-motion", findings);
    expect(findings.every((finding) => finding.preferenceMatched)).toBe(true);
    expect(findings.flatMap((finding) => finding.materialMotion)).toEqual([]);
  });

  test("primary mobile controls meet 44 by 44 CSS pixel target geometry", async (
    { page },
    testInfo,
  ) => {
    test.skip(testInfo.project.name !== "mobile-zh-CN", "single mobile geometry lane");
    await authenticateFixture(page, testInfo, "student-a");

    const findings = [];
    for (const path of studentPaths) {
      await gotoReady(page, path);
      findings.push(await inspectTouchTargets(page, path));
    }

    await authenticateFixture(page, testInfo, "teacher-a");
    await gotoReady(page, "/teaching");
    findings.push(await inspectTouchTargets(page, "/teaching"));
    await attachJson(testInfo, "touch-targets", findings);
    console.log(
      `UAIS_TOUCH_TARGET_SUMMARY ${JSON.stringify(
        findings.map(({ state, inspectedCount, undersized }) => ({
          state,
          inspectedCount,
          undersizedCount: undersized.length,
        })),
      )}`,
    );
    expect(findings.flatMap((finding) => finding.undersized)).toEqual([]);
  });

  test("expanded learning and teaching states meet 44 by 44 CSS pixel target geometry", async (
    { page },
    testInfo,
  ) => {
    test.skip(testInfo.project.name !== "mobile-zh-CN", "single mobile expanded-state lane");
    await authenticateFixture(page, testInfo, "student-a");
    await gotoReady(page, "/learning");

    const studyToolsButton = page.getByRole("button", { name: "学习工具" });
    await expect(studyToolsButton).toBeVisible();
    await studyToolsButton.click();
    await expect(page.getByRole("button", { name: "关闭学习工具", exact: true }))
      .toBeVisible();

    const findings = [await inspectTouchTargets(page, "/learning:study-tools-open")];

    await authenticateFixture(page, testInfo, "teacher-a");
    await gotoReady(page, "/teaching");
    const learningChatroomGroupsEnabled = await page.evaluate(async () => {
      const response = await fetch("/api/teaching/courses", {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as {
        features?: { learningChatroomGroups?: boolean };
      };
      return body.features?.learningChatroomGroups === true;
    });
    console.log(
      `UAIS_TOUCH_EXPANDED_FEATURES ${JSON.stringify({ learningChatroomGroupsEnabled })}`,
    );
    expect(learningChatroomGroupsEnabled).toBe(true);
    const groupPanels = page.locator("[data-uais-learning-group-panel]");
    await expect(groupPanels.first()).toBeVisible();
    const groupPanelCount = await groupPanels.count();
    expect(groupPanelCount).toBeGreaterThan(0);
    for (let index = 0; index < groupPanelCount; index += 1) {
      const toggle = groupPanels.nth(index).locator("button[aria-expanded]").first();
      if ((await toggle.getAttribute("aria-expanded")) !== "true") {
        await toggle.click();
      }
    }
    findings.push(await inspectTouchTargets(page, "/teaching:groups-expanded"));

    const newGroupButton = page
      .locator('[data-uais-learning-group-panel] button[aria-label*="新建小组"]:not([disabled])')
      .first();
    await expect(newGroupButton).toBeVisible();
    await newGroupButton.click();
    await expect(page.locator("[data-uais-learning-group-dialog]"))
      .toBeVisible();
    findings.push(await inspectTouchTargets(page, "/teaching:new-group-dialog"));

    await attachJson(testInfo, "touch-targets-expanded", findings);
    console.log(
      `UAIS_TOUCH_EXPANDED_SUMMARY ${JSON.stringify(
        findings.map(({ state, inspectedCount, undersized }) => ({
          state,
          inspectedCount,
          undersizedCount: undersized.length,
        })),
      )}`,
    );
    expect(findings.flatMap((finding) => finding.undersized)).toEqual([]);
  });
});

async function applyTextScale(page: Page) {
  await page.addStyleTag({
    content: "html { font-size: 200% !important; }",
  });
  await page.evaluate(() => document.fonts.ready);
}

async function gotoReady(page: Page, path: string) {
  await page.goto(path);
  if (path === "/courses") {
    await expect(page.getByRole("searchbox", { name: "搜索课程" })).toBeVisible();
  } else if (path === "/learning") {
    await expect(page.getByText(/课件 1 \/ 19/)).toBeVisible();
  } else if (path === "/learning/chatroom") {
    await expect(page.getByRole("button", { name: /P2 演示课件播放课程/ })).toBeVisible();
  } else if (path === "/teaching") {
    await expect(page.getByRole("button", { name: /新增课程/ })).toBeVisible();
  }
  await page.evaluate(() => document.fonts.ready);
}

async function inspectPageOverflow(page: Page, state: string) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate((label) => {
    const viewportWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    );
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.position === "fixed" || style.position === "sticky") return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return rect.left < -1 || rect.right > viewportWidth + 1;
      })
      .slice(0, 30)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || undefined,
        className: typeof element.className === "string" ? element.className.slice(0, 240) : undefined,
        text: (element.innerText ?? element.textContent ?? "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 120),
        marker:
          Array.from(element.attributes)
            .find((attribute) => attribute.name.startsWith("data-uais-"))?.name ??
          undefined,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
      }));
    return {
      state: label,
      viewportWidth,
      scrollWidth,
      pageOverflow: scrollWidth > viewportWidth + 1,
      offenders,
    };
  }, state);
}

async function inspectReducedMotion(page: Page, state: string) {
  return page.evaluate((label) => {
    const toMilliseconds = (value: string) => {
      const trimmed = value.trim();
      if (trimmed.endsWith("ms")) return Number.parseFloat(trimmed);
      if (trimmed.endsWith("s")) return Number.parseFloat(trimmed) * 1000;
      return 0;
    };
    const longest = (value: string) =>
      Math.max(0, ...value.split(",").map(toMilliseconds));
    const materialMotion = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          element,
          animationMs: longest(style.animationDuration),
          transitionMs: longest(style.transitionDuration),
        };
      })
      .filter(({ animationMs, transitionMs }) => animationMs > 0.1 || transitionMs > 0.1)
      .slice(0, 30)
      .map(({ element, animationMs, transitionMs }) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || undefined,
        animationMs,
        transitionMs,
      }));
    return {
      state: label,
      preferenceMatched: matchMedia("(prefers-reduced-motion: reduce)").matches,
      materialMotion,
    };
  }, state);
}

async function inspectTouchTargets(page: Page, state: string) {
  return page.evaluate((label) => {
    const selector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([type='hidden']):not([type='checkbox']):not([type='radio'])",
      "textarea:not([disabled])",
      "select:not([disabled])",
      "summary",
      "[role='button']:not([aria-disabled='true'])",
      "[role='link']:not([aria-disabled='true'])",
    ].join(",");
    const targets = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          element.getAttribute("aria-hidden") !== "true"
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || undefined,
          ariaLabel: element.getAttribute("aria-label") || undefined,
          text: (element.innerText || element.getAttribute("placeholder") || "")
            .trim()
            .slice(0, 80),
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        };
      });
    return {
      state: label,
      inspectedCount: targets.length,
      undersized: targets
        .filter((target) => target.width < 44 || target.height < 44)
        .slice(0, 50),
    };
  }, state);
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(value, null, 2)),
    contentType: "application/json",
  });
}
