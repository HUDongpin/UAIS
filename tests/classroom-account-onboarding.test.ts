import { describe, expect, it } from "vitest";
import { parseClassroomRosterCsv, rosterCredentialsCsv } from "@/lib/teaching/classroom-roster";
import { createPasswordSetupToken, readPasswordSetupToken } from "@/lib/server/classroom-password-setup-token";
import { createUaisAppSessionPostHandler } from "@/app/api/auth/app-session/handler";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

const env = { UAIS_APP_AUTH_PROVIDER: "database-accounts", UAIS_APP_SESSION_SIGNING_SECRET: "local-test-secret-".repeat(3) };
const now = new Date("2026-10-26T01:00:00Z");
describe("classroom roster", () => {
  it("parses quoted names and normalizes identifiers while flagging invalid and duplicate rows", () => {
    const rows = parseClassroomRosterCsv('account,displayName,email\r\nS01,"Lee, Ann",Ann@Example.edu\r\ns01,Another,\r\nbad account,Wrong,\r\ns03,Valid,bad-email');
    expect(rows.map(row => row.status)).toEqual(["valid", "duplicate", "invalid", "invalid"]);
    expect(rows[0]).toMatchObject({ account: "s01", displayName: "Lee, Ann", email: "ann@example.edu" });
  });
  it("rejects privileged headers and neutralizes spreadsheet formula cells", () => {
    expect(() => parseClassroomRosterCsv("account,displayName,role\ns1,A,teacher")).toThrow();
    expect(rosterCredentialsCsv([{ account: "s1", displayName: "=HYPERLINK(1)", initialPassword: "random-test" }])).toContain("'=HYPERLINK(1)");
  });
});
describe("first password setup scope", () => {
  it("clears a previous account's setup token when a different full account signs in", async () => {
    const handler = createUaisAppSessionPostHandler({ env, now, authenticateDatabaseAccount: async () => ({ account: "activated-student", role: "student", displayName: "Student", department: "UAIS" }), loginFailureGuard: { isLockedOut: async () => false, recordFailure: async () => {}, clearFailures: async () => {} } });
    const response = await handler(new Request("http://localhost/api/auth/app-session", { method: "POST", headers: { cookie: "uais_password_setup=previous-account-token" }, body: JSON.stringify({ account: "activated-student", password: "synthetic-test-password" }) }));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some(cookie => cookie.startsWith("uais_password_setup=") && cookie.includes("Max-Age=0"))).toBe(true);
  });
  it("is signed, purpose-bound, expires after 15 minutes, and cannot serve as app-session claims", () => {
    const token = createPasswordSetupToken({ account: "student-1", credentialVersion: 2, secret: env.UAIS_APP_SESSION_SIGNING_SECRET, now, from: "/courses?invite=12345678" });
    expect(readPasswordSetupToken(token, { secret: env.UAIS_APP_SESSION_SIGNING_SECRET, now })).toMatchObject({ account: "student-1", credentialVersion: 2 });
    expect(readPasswordSetupToken(token + "x", { secret: env.UAIS_APP_SESSION_SIGNING_SECRET, now })).toBeNull();
    expect(readPasswordSetupToken(token, { secret: env.UAIS_APP_SESSION_SIGNING_SECRET, now: new Date(now.getTime() + 901000) })).toBeNull();
    expect(getUaisAppSessionClaimsFromCookieString(`uais_password_setup=${token}`, { env, now })).toBeNull();
  });
  it("issues only a restricted onboarding cookie and clears preexisting full/teacher sessions", async () => {
    const handler = createUaisAppSessionPostHandler({ env, now, authenticateDatabaseAccount: async () => ({ account: "student-1", role: "student", displayName: "Student", department: "UAIS", passwordSetup: { credentialVersion: 1 } }), loginFailureGuard: { isLockedOut: async () => false, recordFailure: async () => {}, clearFailures: async () => {} } });
    const response = await handler(new Request("http://localhost/api/auth/app-session", { method: "POST", body: JSON.stringify({ account: "student-1", password: "initial-test", from: "/courses?invite=12345678" }) }));
    expect(await response.json()).toMatchObject({ status: "password-setup-required", redirectTarget: "/first-login" });
    const cookies = response.headers.getSetCookie();
    expect(cookies.some(cookie => cookie.startsWith("uais_password_setup=") && cookie.includes("HttpOnly"))).toBe(true);
    expect(cookies.filter(cookie => cookie.startsWith("uais_app_session=") || cookie.startsWith("uais_app_session_signature=")).every(cookie => cookie.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some(cookie => cookie.startsWith("uais_teacher_auth_claims=") && cookie.includes("Max-Age=0"))).toBe(true);
  });
});
