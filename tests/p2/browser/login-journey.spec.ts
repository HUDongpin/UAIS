import { expect, test } from "@playwright/test";
import {
  collectConsoleErrors,
  localeForProject,
  prepareP2BrowserFixture,
} from "./fixtures";

// This journey intentionally enters the committed local-demo credential. It is
// not a real secret, but traces should not teach the habit of retaining login
// request bodies, so this file disables tracing while all other P2 files retain
// failure traces.
test.use({ trace: "off" });

test.describe("@e2e P2 login and redirect recovery", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    await prepareP2BrowserFixture(context, testInfo);
  });

  test("visitor is returned to a safe protected route after login", async (
    { page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    const errors = collectConsoleErrors(page);

    await page.goto("/learning/chatroom");
    await expect(page).toHaveURL(/\/login\?from=%2Flearning%2Fchatroom$/);

    const account = page.getByLabel(locale === "zh-CN" ? "账号或邮箱" : "Account or email");
    const password = page.getByLabel(locale === "zh-CN" ? "密码" : "Password", {
      exact: true,
    });
    await account.fill("Peter");
    await password.fill("not-the-demo-password");
    await page.getByRole("button", {
      name: locale === "zh-CN" ? "立即登录" : "Log In",
    }).click();
    await expect(page.locator("[data-uais-login-failure]")).toContainText(
      locale === "zh-CN" ? "账号或密码不匹配" : "account or password",
    );
    expect(errors).toEqual([
      "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
    ]);
    errors.length = 0;

    await password.fill("12345");
    await page.getByRole("button", {
      name: locale === "zh-CN" ? "立即登录" : "Log In",
    }).click();
    await expect(page).toHaveURL(/\/learning\/chatroom$/);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    expect(errors).toEqual([]);
  });

  test("home redirects to login and an external return target is rejected", async (
    { page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login\?from=%2F$/);

    await page.goto("/login?from=https%3A%2F%2Fevil.example%2Fsteal");
    const appOrigin = new URL(page.url()).origin;
    await page.getByLabel(locale === "zh-CN" ? "账号或邮箱" : "Account or email").fill("Peter");
    await page.getByLabel(locale === "zh-CN" ? "密码" : "Password", {
      exact: true,
    }).fill("12345");
    await page.getByRole("button", {
      name: locale === "zh-CN" ? "立即登录" : "Log In",
    }).click();

    await expect(page).toHaveURL(/\/student-dashboard$/);
    expect(new URL(page.url()).origin).toBe(appOrigin);
  });

  test("language switching preserves the unsubmitted login draft and focus", async (
    { page },
    testInfo,
  ) => {
    const locale = localeForProject(testInfo);
    await page.goto("/login");
    const account = page.getByLabel(
      locale === "zh-CN" ? "账号或邮箱" : "Account or email",
    );
    const password = page.getByLabel(locale === "zh-CN" ? "密码" : "Password", {
      exact: true,
    });
    await account.fill("draft@example.test");
    await password.fill("not-submitted");

    const language = page.getByRole("button", {
      name: locale === "zh-CN" ? "切换到英文" : "Switch to Chinese",
    });
    await language.focus();
    await language.click();

    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByLabel(nextLocale === "zh-CN" ? "账号或邮箱" : "Account or email"),
    ).toHaveValue("draft@example.test");
    await expect(
      page.getByLabel(nextLocale === "zh-CN" ? "密码" : "Password", {
        exact: true,
      }),
    ).toHaveValue("not-submitted");
    await expect(
      page.getByRole("button", {
        name: nextLocale === "zh-CN" ? "切换到英文" : "Switch to Chinese",
      }),
    ).toBeFocused();
  });
});
