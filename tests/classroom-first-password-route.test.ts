import { describe, expect, it, vi } from "vitest";
import { createFirstPasswordHandler } from "@/app/api/auth/first-password/handler";
import { createPasswordSetupToken } from "@/lib/server/classroom-password-setup-token";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
const secret = "disposable-test-secret-".repeat(3);
const env = { UAIS_APP_SESSION_SIGNING_SECRET: secret };
const now = new Date("2026-10-26T01:00:00Z");
const token = createPasswordSetupToken({ account: "student-1", credentialVersion: 2, secret, now, from: "/courses?invite=12345678" });
function request(cookie = token, origin = "http://localhost") { return new Request("http://localhost/api/auth/first-password", { method: "POST", headers: { cookie: `uais_password_setup=${cookie}`, origin }, body: JSON.stringify({ password: "a-safe-new-password" }) }); }
describe("first password route", () => {
  it("does not call the store for an invalid token or cross-origin request", async () => {
    const setFirstPassword = vi.fn(); const handler = createFirstPasswordHandler({ env, now, setFirstPassword });
    expect((await handler(request("invalid"))).status).toBe(401);
    expect((await handler(request(token, "https://attacker.example"))).status).toBe(403);
    expect(setFirstPassword).not.toHaveBeenCalled();
  });
  it("mints full session only after database activation succeeds and preserves invite return path", async () => {
    const setFirstPassword = vi.fn(async () => ({ account: "student-1", role: "student" as const, displayName: "A", department: "UAIS" }));
    const response = await createFirstPasswordHandler({ env, now, setFirstPassword })(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ redirectTarget: "/courses?invite=12345678" });
    const cookies = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    expect(getUaisAppSessionClaimsFromCookieString(cookies, { env, now })).toMatchObject({ account: "student-1", role: "student" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns no app cookie when storage fails", async () => {
    const response = await createFirstPasswordHandler({ env, now, setFirstPassword: async () => { throw new Error("db-down"); } })(request());
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });
});
