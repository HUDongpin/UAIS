import { createHmac } from "node:crypto";
import { type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import {
  P2_FIXTURE_IDENTITIES,
  resetP2FixtureData,
} from "./fixture-data";

export type P2Locale = "zh-CN" | "en-US";
export type P2Identity = "student-a" | "student-b" | "teacher-a";

const appSessionSecret = "p2-fixture-only-app-session-signing-secret";
const teacherSessionSecret = "p2-fixture-only-teacher-signing-secret";

export function localeForProject(testInfo: TestInfo): P2Locale {
  return testInfo.project.name.endsWith("en-US") ? "en-US" : "zh-CN";
}

export async function setLocaleCookie(
  context: BrowserContext,
  testInfo: TestInfo,
) {
  const locale = localeForProject(testInfo);
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) {
    throw new Error("P2 Playwright project requires a baseURL.");
  }
  await context.addCookies([
    {
      name: "uais-locale",
      value: locale,
      url: baseURL,
      sameSite: "Lax",
    },
  ]);
  return locale;
}

export async function prepareP2BrowserFixture(
  context: BrowserContext,
  testInfo: TestInfo,
) {
  await resetP2FixtureData();
  return setLocaleCookie(context, testInfo);
}

export async function authenticateFixture(
  page: Page,
  testInfo: TestInfo,
  identityName: P2Identity,
) {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) {
    throw new Error("P2 Playwright project requires a baseURL.");
  }

  const identity =
    identityName === "student-a"
      ? P2_FIXTURE_IDENTITIES.studentA
      : identityName === "student-b"
        ? P2_FIXTURE_IDENTITIES.studentB
        : P2_FIXTURE_IDENTITIES.teacherA;
  const authenticatedAt = new Date();
  const expiresAt = new Date(authenticatedAt.getTime() + 8 * 60 * 60 * 1000);
  const sessionId = `p2-${identity.account}-${testInfo.project.name}`;
  const appClaims = encodeClaims({
    account: identity.account,
    role: identity.role,
    displayName: identity.displayName,
    department: identity.role === "student" ? "P2 Students" : "P2 Teachers",
    sessionId,
    authenticatedAt: authenticatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const cookies = [
    createCookie("uais_app_session", appClaims, baseURL),
    createCookie(
      "uais_app_session_signature",
      signClaims(appClaims, appSessionSecret),
      baseURL,
    ),
  ];

  if (identity.role === "teacher") {
    const teacherClaims = encodeClaims({
      sessionId,
      actorId: identity.account,
      role: "teacher",
      authenticatedAt: authenticatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    cookies.push(
      createCookie("uais_teacher_auth_claims", teacherClaims, baseURL),
      createCookie(
        "uais_teacher_auth_signature",
        signClaims(teacherClaims, teacherSessionSecret),
        baseURL,
      ),
    );
  }

  await page.context().addCookies(cookies);
}

export function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

export function collectHttpErrors(page: Page) {
  const errors: string[] = [];
  page.on("response", (response) => {
    if (response.status() < 400) {
      return;
    }

    const request = response.request();
    const url = new URL(response.url());
    errors.push(`${response.status()} ${request.method()} ${url.pathname}`);
  });
  return errors;
}

function encodeClaims(claims: object) {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

function signClaims(claims: string, secret: string) {
  return createHmac("sha256", secret).update(claims).digest("base64url");
}

function createCookie(name: string, value: string, url: string) {
  return {
    name,
    value,
    url,
    httpOnly: true,
    sameSite: "Lax" as const,
  };
}
