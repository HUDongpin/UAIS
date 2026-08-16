import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyUaisAppSessionSigningSecret,
  createUaisAppSessionCookie,
  getUaisAppSessionUserFromCookieString,
  resolveUaisAppSessionSigningSecret,
} from "@/lib/server/uais-app-session";

// The root layout is what tells the header who the visitor is. It read the
// session cookie WITHOUT passing its runtime env, so the helper defaulted to
// `{}`; an empty env reads as a non-deployed runtime, the signature was checked
// against the committed development constant, and every production cookie -
// signed with the configured secret - failed to verify. Every signed-in user,
// whatever their role, rendered as the header's null-session fallback.
const layoutSource = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

const productionSecret = "production-app-session-signing-secret-64ch";
const deployedEnv = {
  VERCEL_ENV: "production",
  UAIS_APP_SESSION_SIGNING_SECRET: productionSecret,
};

function productionSignedCookie(
  user: Parameters<typeof createUaisAppSessionCookie>[0],
) {
  return createUaisAppSessionCookie(user, {
    env: deployedEnv,
    now: new Date("2099-01-01T00:00:00.000Z"),
    sessionId: "root-layout-session-test-id",
  });
}

const now = new Date("2099-01-01T00:01:00.000Z");

describe("root layout session resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the session cookie with the runtime env, not the default empty one", () => {
    expect(layoutSource).toMatch(
      /getUaisAppSessionUserFromCookieString\(\s*cookieStore\.toString\(\),\s*\{\s*env:\s*process\.env,?\s*\},?\s*\)/,
    );
  });

  it("resolves a production-signed cookie for every role when the env is passed", () => {
    for (const user of [
      { account: "t2026007", role: "teacher", displayName: "康霞", department: "教育学院" },
      { account: "s2026101", role: "student", displayName: "林一", department: "学生账号" },
      { account: "Admin", role: "admin", displayName: "Admin", department: "管理员账号" },
    ] as const) {
      const cookieHeader = productionSignedCookie(user);

      expect(
        getUaisAppSessionUserFromCookieString(cookieHeader, {
          env: deployedEnv,
          now,
        }),
        user.role,
      ).toEqual({
        account: user.account,
        department: user.department,
        displayName: user.displayName,
        role: user.role,
      });
    }
  });

  it("never falls back to the development secret when the env argument is omitted", () => {
    const cookieHeader = productionSignedCookie({
      account: "t2026007",
      role: "teacher",
      displayName: "康霞",
      department: "教育学院",
    });

    // This is the defect itself: the same production cookie, read the way the
    // root layout used to read it. It must not resolve - a cookie the reader
    // cannot verify is nobody, never a silently downgraded verification.
    expect(getUaisAppSessionUserFromCookieString(cookieHeader, { now })).toBeNull();
    expect(
      getUaisAppSessionUserFromCookieString(cookieHeader, { env: {}, now }),
    ).toBeNull();
  });

  it("refuses the development fallback on a deployed process, whatever env it is handed", () => {
    // A laptop keeps the fallback: local dev and every suite fixture sign with it.
    expect(resolveUaisAppSessionSigningSecret({})).toEqual(expect.any(String));
    expect(classifyUaisAppSessionSigningSecret({})).toMatchObject({
      status: "development-fallback",
    });

    const developmentCookie = createUaisAppSessionCookie(
      { account: "t2026007", role: "teacher", displayName: "康霞", department: "教育学院" },
      { now: new Date("2099-01-01T00:00:00.000Z"), sessionId: "dev-fallback-test-id" },
    );
    expect(getUaisAppSessionUserFromCookieString(developmentCookie, { now })).toEqual(
      expect.objectContaining({ role: "teacher" }),
    );

    // On a deployed process the committed constant is a published forgery key,
    // so forgetting the env argument must fail closed rather than reach it.
    vi.stubEnv("VERCEL_ENV", "production");

    expect(resolveUaisAppSessionSigningSecret({})).toBeUndefined();
    expect(classifyUaisAppSessionSigningSecret({})).toMatchObject({ status: "missing" });
    expect(
      getUaisAppSessionUserFromCookieString(developmentCookie, { now }),
    ).toBeNull();
    // An explicitly configured secret still resolves - the guard only closes the
    // fallback, it does not refuse a real deployment.
    expect(
      getUaisAppSessionUserFromCookieString(productionSignedCookie(
        { account: "t2026007", role: "teacher", displayName: "康霞", department: "教育学院" },
      ), { env: deployedEnv, now }),
    ).toEqual(expect.objectContaining({ role: "teacher" }));
  });
});
