import { expect, test } from "@playwright/test";
import { authenticateFixture, localeForProject, prepareP2BrowserFixture } from "./fixtures";

test("@e2e independent activities in one lesson open and save their own evidence", async ({ page, context }, testInfo) => {
  await prepareP2BrowserFixture(context, testInfo);
  await authenticateFixture(page, testInfo, "student-a");
  const zh = localeForProject(testInfo) === "zh-CN";
  const courseId = "elementary-math-research";
  const classId = "elementary-math-research-class-1";
  const lessonKey = "synthetic-shared-lesson";
  const activityIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const drafts = new Map(activityIds.map((id, index) => [id, `Draft ${index === 0 ? "A" : "B"}`]));
  const nextAction = { type: "continue-draft", reasonCode: "submission-draft-exists", lessonKey, activityId: activityIds[1] };
  const dataFreshAt = "2026-08-21T01:00:00.000Z";
  await page.route("**/api/learning/dashboard", (route) => route.fulfill({ json: {
    courses: [{ courseId, classId, courseTitle: "Synthetic activities", projectionVersion: 1, dataFreshAt, nextAction,
      counts: { notStarted: 0, draft: 2, submitted: 0, revisionRequested: 0, resubmitted: 0, accepted: 0, completedUnits: 0, overdue: 0 },
      units: activityIds.map((activityId) => ({ activityId, lessonKey, position: 1, formative: { attempted: true }, submission: { state: "draft" }, feedback: { status: "none" }, completion: { completed: false } })),
    }], nextAction, dataFreshAt,
  } }));
  await page.route("**/api/learning/courses/*/units/*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("activityId") ?? "";
    expect(activityIds).toContain(id);
    const title = id === activityIds[0] ? "Activity A" : "Activity B";
    await route.fulfill({ json: {
      unit: { courseId, classId, lessonKey },
      activity: { id, status: "published", title: { "en-US": title, "zh-CN": title }, instructions: { "en-US": "Synthetic task", "zh-CN": "合成测试任务" }, rubric: [] },
      formative: { attempted: true },
      submission: { id: `submission-${id}`, state: "draft", currentVersion: { id: `version-${id}`, contentText: drafts.get(id), draftRevision: 1 } },
      feedback: [], completion: { completed: false },
    } });
  });
  await page.route("**/api/learning/activities/*/submission", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    expect(id).toBe(activityIds[1]);
    expect(route.request().postDataJSON().expectedSubmissionVersionId).toBe(`version-${id}`);
    drafts.set(id, route.request().postDataJSON().contentText);
    await route.fulfill({ json: { status: "persisted", revision: 2, submissionVersionId: `version-${id}` } });
  });

  await page.goto("/student-dashboard");
  const links = page.getByRole("link", { name: zh ? "打开学习任务" : "Open learning activity" });
  await expect(links).toHaveCount(2);
  await links.nth(1).click();
  await expect(page.getByRole("heading", { name: "Activity B", exact: true })).toBeVisible();
  const evidence = page.getByRole("textbox", { name: zh ? "学习产物正文" : "Learning evidence text" });
  await expect(evidence).toHaveValue("Draft B");
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(`/activities/${activityIds[1]}/submission`));
  await evidence.fill("Updated B evidence");
  await saved;

  await page.goto("/student-dashboard");
  await links.first().click();
  await expect(page.getByRole("heading", { name: "Activity A", exact: true })).toBeVisible();
  await expect(evidence).toHaveValue("Draft A");
  expect(drafts.get(activityIds[1])).toBe("Updated B evidence");
});

test("@e2e a delayed save in one tab preserves another tab's unsaved recovery", async ({ page, context }, testInfo) => {
  await prepareP2BrowserFixture(context, testInfo);
  await authenticateFixture(page, testInfo, "student-a");
  const zh = localeForProject(testInfo) === "zh-CN";
  const activityId = "33333333-3333-4333-8333-333333333333";
  const courseId = "elementary-math-research";
  const classId = "elementary-math-research-class-1";
  const lessonKey = "synthetic-recovery-lesson";
  let serverText = "Shared server draft";
  let serverRevision = 1;
  let startSave!: () => void;
  let releaseSave!: () => void;
  const saveStarted = new Promise<void>((resolve) => { startSave = resolve; });
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const other = await context.newPage();
  const href = `/learning?${new URLSearchParams({ courseId, classId, lessonKey, activityId })}`;
  const textboxName = zh ? "学习产物正文" : "Learning evidence text";
  const localText = "Tab B has newer unsaved reasoning";

  await context.route("**/api/learning/courses/*/units/*", (route) => route.fulfill({ json: {
    unit: { courseId, classId, lessonKey },
    activity: { id: activityId, status: "published", title: { "en-US": "Recovery task", "zh-CN": "Recovery task" }, instructions: { "en-US": "Synthetic task", "zh-CN": "合成测试任务" }, rubric: [] },
    formative: { attempted: true },
    submission: { id: "synthetic-recovery-submission", state: "draft", currentVersion: { id: "synthetic-recovery-version", contentText: serverText, draftRevision: serverRevision } },
    feedback: [], completion: { completed: false },
  } }));
  await page.route(`**/api/learning/activities/${activityId}/submission`, async (route) => {
    startSave();
    await saveGate;
    const body = route.request().postDataJSON();
    expect(body.expectedSubmissionVersionId).toBe("synthetic-recovery-version");
    serverText = body.contentText;
    serverRevision = 2;
    await route.fulfill({ json: { status: "persisted", revision: serverRevision, submissionVersionId: "synthetic-recovery-version" } });
  });
  // This tab remains unsaved, as it would during a transient network failure.
  await other.route(`**/api/learning/activities/${activityId}/submission`, (route) => route.fulfill({ status: 503, json: { reasonCode: "synthetic-offline" } }));

  try {
    await page.goto(href);
    await other.goto(href);
    await expect(page.getByRole("textbox", { name: textboxName })).toHaveValue(serverText);
    await expect(other.getByRole("textbox", { name: textboxName })).toHaveValue(serverText);
    await page.getByRole("textbox", { name: textboxName }).fill("Tab A saved reasoning");
    await saveStarted;
    await other.getByRole("textbox", { name: textboxName }).fill(localText);
    const recoveryText = () => other.evaluate((id) => {
      const key = Object.keys(localStorage).find((name) => name.startsWith("uais:p1:draft-recovery:v2:") && name.endsWith(`:${id}`));
      return key ? JSON.parse(localStorage.getItem(key) ?? "null")?.contentText : null;
    }, activityId);
    await expect.poll(recoveryText).toBe(localText);
    releaseSave();
    await expect(page.getByText(zh ? "已由服务端保存" : "Saved by server", { exact: true })).toBeVisible();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await recoveryText()).toBe(localText);
    await other.reload();
    await expect(other.getByRole("textbox", { name: textboxName })).toHaveValue(localText);
    await expect(other.getByText(zh ? "需要处理版本冲突" : "Version conflict needs attention", { exact: true })).toBeVisible();
  } finally {
    releaseSave();
    await other.close();
  }
});
