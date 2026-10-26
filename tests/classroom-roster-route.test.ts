import { describe, expect, it, vi } from "vitest";
import { createClassroomRosterHandler } from "@/app/api/teaching/courses/[courseId]/classes/[classId]/roster/handler";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
const now = new Date("2026-10-26T01:00:00Z");
const env = { UAIS_APP_AUTH_PROVIDER: "database-accounts", UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "teacher-test-secret-".repeat(3), UAIS_APP_SESSION_SIGNING_SECRET: "app-test-secret-".repeat(3) };
const teacherCookie = createUaisTeacherAuthSessionCookieHeader({ secret: env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET, claims: { actorId: "teacher-1", role: "teacher", sessionId: "teacher-test-session", authenticatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60000).toISOString() } });
const context = { params: Promise.resolve({ courseId: "course-1", classId: "class-1" }) };
function store() { return { preview: vi.fn(async () => []), import: vi.fn(async () => ({ rows: [], credentials: [], createdCount: 0, existingCount: 0 })), list: vi.fn(async () => []), reissue: vi.fn(), setFirstPassword: vi.fn() }; }
function request(cookie: string, body: unknown = { action: "preview", csv: "account,displayName\ns1,A" }, origin = "http://localhost") { return new Request("http://localhost/api/teaching/courses/course-1/classes/class-1/roster", { method: "POST", headers: { cookie, origin }, body: JSON.stringify(body) }); }
describe("teacher roster route", () => {
  it("requires a teacher session and rejects students even with a stale teacher cookie", async () => {
    const repository = store(), handler = createClassroomRosterHandler({ env, now, store: repository });
    expect((await handler(request(""), context)).status).toBe(401);
    const studentCookie = createUaisAppSessionCookie({ account: "student-1", role: "student", displayName: "S", department: "UAIS" }, { env, now });
    expect((await handler(request(`${studentCookie}; ${teacherCookie}`), context)).status).toBe(403);
    expect(repository.preview).not.toHaveBeenCalled();
  });
  it("binds actor/course/class from verified session and path, never imported values", async () => {
    const repository = store(), handler = createClassroomRosterHandler({ env, now, store: repository });
    const response = await handler(request(teacherCookie, { action: "preview", csv: "account,displayName\ns1,A", actorId: "other", classId: "other" }), context);
    expect(response.status).toBe(200);
    expect(repository.preview).toHaveBeenCalledWith({ actorId: "teacher-1", courseId: "course-1", classId: "class-1", csv: "account,displayName\ns1,A" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("blocks cross-origin writes and demo-provider imports", async () => {
    const repository = store();
    expect((await createClassroomRosterHandler({ env, now, store: repository })(request(teacherCookie, {}, "https://other.example"), context)).status).toBe(403);
    expect((await createClassroomRosterHandler({ env: { ...env, UAIS_APP_AUTH_PROVIDER: "local-demo" }, now, store: repository })(request(teacherCookie), context)).status).toBe(503);
    expect(repository.preview).not.toHaveBeenCalled();
  });
});
