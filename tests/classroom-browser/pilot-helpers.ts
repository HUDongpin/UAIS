import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import type { APIRequestContext, APIResponse, Browser, BrowserContext, Page, Response } from "@playwright/test";
import postgres from "postgres";

export type PilotFixture = { baseUrl: string; databaseUrl: string; teacher: { account: string; password: string }; studentPassword: string; soakMinutes: number };
export type Timing = { operation: string; durationMs: number; status: number };
export type InitialCredential = { account: string; initialPassword: string; displayName: string };
export type Lesson = { lessonKey: string; position: number; latestVersion: number; draftRevision: number; title: string };
export type LessonView = { lesson: { version: number; versionId: string; lessonKey: string; content: { body: string }; tasks: { id: string }[] } };
export type Unit = { activity: { id: string; checkpoint: Record<string, unknown>; aiPolicy: string }; submission?: { id: string; state: string; currentVersion: { id: string; draftRevision: number; status: string; attachments: { id: string; url: string; sha256: string }[]; contentText: string } }; feedback: { feedbackText: string }[]; formative: { attempted: boolean } };
export type Receipt = { resourceId: string; submissionVersionId: string; revision: number; status: string; state: string };
export const evidenceDir = resolve("output/classroom-pilot");
const requestOrigins = new WeakMap<APIRequestContext, string>();
export function bindLocalRequest(request: APIRequestContext, baseUrl: string) {
  const url = new URL(baseUrl); if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("classroom-loopback-only");
  requestOrigins.set(request, url.origin); return request;
}
export async function authenticatedFetch(request: APIRequestContext, path: string, options: Parameters<APIRequestContext["fetch"]>[1] = {}) {
  const origin = requestOrigins.get(request);
  if (!origin || !path.startsWith("/api/") || new URL(path, origin).origin !== origin) throw new Error("bound-local-api-request-required");
  // Chromium accepts Secure cookies on trustworthy loopback HTTP. Playwright
  // APIRequest does not: transport the same signed cookies explicitly, in memory,
  // only to this guarded local origin. Never forge, persist or log a cookie.
  const state = await request.storageState();
  const cookie = state.cookies.filter(item => item.domain === "127.0.0.1" && path.startsWith(item.path) && (item.expires < 0 || item.expires > Date.now()/1000)).map(item => `${item.name}=${item.value}`).join("; ");
  return request.fetch(path, { ...options, headers: { ...options?.headers, ...(cookie ? { cookie } : {}) } });
}

export async function fixture() {
  const path = process.env.UAIS_CLASSROOM_FIXTURE_PATH;
  if (!path) throw new Error("classroom-fixture-required");
  const value = JSON.parse(await readFile(path, "utf8")) as PilotFixture;
  if (!value.baseUrl || !value.databaseUrl || !value.teacher?.account || !value.teacher.password || !value.studentPassword || ![0,90].includes(value.soakMinutes)) throw new Error("classroom-fixture-invalid");
  const web = new URL(value.baseUrl), db = new URL(value.databaseUrl);
  if (web.protocol !== "http:" || web.hostname !== "127.0.0.1" || web.pathname !== "/" || db.hostname !== "127.0.0.1" || db.pathname !== "/uais_classroom_pilot") throw new Error("classroom-loopback-only");
  const sql = postgres(value.databaseUrl, { max: 2, onnotice: () => {} });
  const rows = await sql`SELECT environment FROM uais_environment_guard WHERE environment='isolated-classroom-pilot' AND enabled`;
  if (rows.length !== 1) { await sql.end(); throw new Error("isolated-classroom-pilot-guard-required"); }
  await mkdir(evidenceDir, { recursive: true });
  return { value, sql };
}
export async function privateContext(browser: Browser, baseUrl: string, onRuntimeIssue?: (kind: "pageerror" | "hydration") => void): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: baseUrl, locale: "zh-CN", viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  bindLocalRequest(context.request, baseUrl);
  context.setDefaultTimeout(20_000); context.setDefaultNavigationTimeout(40_000);
  context.on("page", page => {
    page.on("pageerror", () => onRuntimeIssue?.("pageerror"));
    page.on("console", message => { if (message.type() === "error" && /hydrat|did not match|server rendered HTML|Minified React error/i.test(message.text())) onRuntimeIssue?.("hydration"); });
  });
  await context.addCookies([{ name: "uais-locale", value: "zh-CN", url: baseUrl }]);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(baseUrl).origin ? route.continue() : route.abort("blockedbyclient");
  });
  return context;
}
export async function checked<T>(response: APIResponse | Response, operation: string): Promise<T> {
  const status = response.status();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = await Promise.race([response.json().catch(() => { throw new Error(`${operation}:invalid-json`); }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${operation}:json-timeout`)), 20_000); })]).finally(() => clearTimeout(timer));
  if (status < 200 || status >= 300) {
    const reason = typeof body.reasonCode === "string" && /^[a-z0-9_-]{1,100}$/.test(body.reasonCode) ? body.reasonCode : "request-failed";
    throw new Error(`${operation}:${status}:${reason}`);
  }
  return body as T;
}
export async function api<T>(request: APIRequestContext, method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", path: string, data?: unknown, timings?: Timing[], operation = "request", idempotencyKey?: string): Promise<T> {
  if (!path.startsWith("/api/") || path.startsWith("//")) throw new Error("relative-api-path-required");
  const started = performance.now();
  const response = await authenticatedFetch(request, path, { method, data, headers: { ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}), accept: "application/json" }, timeout: 60_000 });
  timings?.push({ operation, durationMs: performance.now() - started, status: response.status() });
  return checked<T>(response, operation);
}
export async function webLogin(page: Page, account: string, password: string, from?: string, firstLogin = false) {
  await page.goto(`/login${from ? `?from=${encodeURIComponent(from)}` : ""}`);
  await page.getByLabel("账号或邮箱", { exact: true }).fill(account);
  await page.getByLabel("密码", { exact: true }).fill(password);
  const done = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/app-session" && response.request().method() === "POST");
  await page.getByRole("button", { name: "立即登录", exact: true }).click();
  if ((await done).status() !== 200) throw new Error("browser-login-failed");
  // document.replace may release the old CDP resource before response.json().
  // Verify the actual destination and protected UI instead of rereading auth data.
  const targetPath = firstLogin ? "/first-login" : new URL(from ?? "/courses", "http://localhost").pathname;
  try { await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(targetPath); }
  catch { throw new Error(`login-navigation-${targetPath.replace(/[^a-z0-9]/g,"-")}-actual-${new URL(page.url()).pathname.replace(/[^a-z0-9]/g,"-")}`); }
}
export async function activateHttp(request: APIRequestContext, credential: InitialCredential, password: string) {
  const login = await api<{ status: string }>(request, "POST", "/api/auth/app-session", { account: credential.account, password: credential.initialPassword });
  if (login.status !== "password-setup-required") throw new Error("initial-credential-did-not-require-password-setup");
  const blocked = await authenticatedFetch(request,"/api/teaching/courses");
  if (blocked.status() !== 401) throw new Error("initial-credential-issued-full-session");
  await api(request, "POST", "/api/auth/first-password", { password });
}
export const key = () => `pilot-${randomUUID()}`;
export function learningPath(courseId: string, classId: string, lessonKey: string, activityId?: string) {
  return `/learning?${new URLSearchParams({ courseId, classId, lessonKey, ...(activityId ? { activityId } : {}) })}`;
}
export function unitPath(courseId: string, lessonKey: string, activityId: string) { return `/api/learning/courses/${courseId}/units/${lessonKey}?activityId=${activityId}`; }
export function percentile(values: number[], quantile: number) { const sorted = [...values].sort((a,b) => a-b); return sorted.length ? Math.round(sorted[Math.ceil(sorted.length * quantile) - 1]) : null; }
export async function writeSummary(value: Record<string, unknown>) { await writeFile(resolve(evidenceDir, "summary.json"), JSON.stringify(value, null, 2) + "\n"); }

export async function allCompleted<T>(operations: Array<Promise<T>>): Promise<T[]> {
  const results = await Promise.allSettled(operations);
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length) throw failures[0].reason;
  return results.map(result => (result as PromiseFulfilledResult<T>).value);
}
