import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUaisHomeHrefForRole,
  isUaisRouteAllowedForRole,
  UAIS_APP_SESSION_SIGNATURE_COOKIE,
} from "@/lib/auth/uais-app-session";
import {
  createUaisAppSessionCookie,
  createUaisAppSessionSetCookieHeaders,
  getUaisAppSessionUserFromCookieString,
  resolveUaisAppSessionSigningSecret,
} from "@/lib/server/uais-app-session";
import {
  createUaisAppSessionDeleteHandler,
  createUaisAppSessionPostHandler,
} from "@/app/api/auth/app-session/route";

describe("UAIS enterprise app sessions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues a server-signed HttpOnly student app session without a readable role cookie", async () => {
    const post = createUaisAppSessionPostHandler({
      env: {
        NODE_ENV: "development",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret",
      },
      now: new Date("2099-01-01T00:00:00.000Z"),
      createSessionId: () => "app-session-student-test-id",
    });

    const response = await post(
      new Request("http://localhost/api/auth/app-session", {
        method: "POST",
        body: JSON.stringify({
          account: "Peter",
          password: "12345",
        }),
      }),
    );
    const body = await response.json();
    const setCookies = readSetCookieHeaders(response);

    expect(response.status).toBe(200);
    expect(body.appSession).toEqual(
      expect.objectContaining({
        authSessionRef: "server-side-app-session",
        actor: {
          account: "Peter",
          role: "student",
        },
        cookieSecurity: expect.objectContaining({
          httpOnly: true,
          sameSite: "Lax",
          path: "/",
          priority: "High",
        }),
      }),
    );
    expect(body.redirectTarget).toBe("/student-dashboard");
    expect(setCookies).toHaveLength(2);
    expect(setCookies.join("\n")).toContain("HttpOnly");
    expect(setCookies.join("\n")).not.toContain("student:Peter");
    expect(setCookies.join("\n")).not.toContain("app-session-student-test-id");

    const cookieHeader = createCookieHeaderFromSetCookies(setCookies);
    expect(
      getUaisAppSessionUserFromCookieString(cookieHeader, {
        secret: "test-app-session-signing-secret",
        now: new Date("2099-01-01T00:01:00.000Z"),
      }),
    ).toEqual(
      expect.objectContaining({
        displayName: "Peter",
        role: "student",
      }),
    );
  });

  it("blocks local demo account-password auth in production", async () => {
    const post = createUaisAppSessionPostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret",
      },
    });

    const response = await post(
      new Request("http://localhost/api/auth/app-session", {
        method: "POST",
        body: JSON.stringify({
          account: "Peter",
          password: "12345",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("UAIS app auth provider is not production-ready.");
    expect(JSON.stringify(body)).not.toContain("12345");
  });

  it("blocks local demo auth and development session secrets in UAIS production deployments", async () => {
    expect(
      resolveUaisAppSessionSigningSecret({
        UAIS_DEPLOYMENT_ENV: "production",
      }),
    ).toBeUndefined();
    expect(
      resolveUaisAppSessionSigningSecret({
        VERCEL_ENV: "production",
      }),
    ).toBeUndefined();
    expect(
      resolveUaisAppSessionSigningSecret({
        NODE_ENV: "development",
      }),
    ).toEqual(expect.any(String));

    const post = createUaisAppSessionPostHandler({
      env: {
        NODE_ENV: "development",
        UAIS_DEPLOYMENT_ENV: "production",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret",
      },
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        body: JSON.stringify({
          account: "Peter",
          password: "12345",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.authProviderContract).toEqual(
      expect.objectContaining({
        providerKind: "local-demo",
        productionStatus: "blocked",
        blockedReason: "local-demo-not-production",
      }),
    );
    expect(JSON.stringify(body)).not.toContain("12345");
  });

  it("marks app session cookies secure in UAIS production deployments", async () => {
    const env = {
      NODE_ENV: "development",
      UAIS_DEPLOYMENT_ENV: "production",
      UAIS_APP_AUTH_PROVIDER: "trusted-account-provider",
      UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret",
    };
    const post = createUaisAppSessionPostHandler({
      env,
      now: new Date("2099-01-01T00:00:00.000Z"),
      createSessionId: () => "uais-deployment-production-session-id",
      authenticateAccount: () => ({
        account: "Peter",
        role: "student",
        displayName: "Peter",
        department: "学生账号",
      }),
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        body: JSON.stringify({
          account: "Peter",
          password: "trusted-provider-password",
        }),
      }),
    );
    const body = await response.json();
    const setCookies = readSetCookieHeaders(response);

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.appSession.cookieSecurity.secure).toBe(true);
    expect(setCookies.join("\n")).toContain("Secure");

    const signOut = createUaisAppSessionDeleteHandler({ env });
    const signOutResponse = signOut();
    expect(readSetCookieHeaders(signOutResponse).join("\n")).toContain("Secure");
  });

  it("authenticates production trusted account provider through configured external binding", async () => {
    const providerRequests: Array<{
      url: string;
      method: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      providerRequests.push({
        url: String(url),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        ...(body ? { body } : {}),
      });
      return Response.json({
        user: {
          account: "Peter",
          role: "student",
          displayName: "Peter",
          department: "学生账号",
        },
        redaction: {
          secrets: "omitted",
          passwords: "omitted",
        },
      });
    });

    const post = createUaisAppSessionPostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_APP_AUTH_PROVIDER: "trusted-account-provider",
        UAIS_APP_AUTH_PROVIDER_URL: "https://accounts.example.test/uais/authenticate",
        UAIS_APP_AUTH_PROVIDER_TOKEN: "test-app-auth-provider-token-with-32-chars",
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret",
      },
      now: new Date("2099-01-01T00:00:00.000Z"),
      createSessionId: () => "trusted-app-session-student-test-id",
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        body: JSON.stringify({
          account: "Peter",
          password: "trusted-provider-password",
        }),
      }),
    );
    const body = await response.json();
    const setCookies = readSetCookieHeaders(response);

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.authProviderContract).toEqual(
      expect.objectContaining({
        providerKind: "trusted-account-provider",
        productionStatus: "ready",
        responsibleSession: "S12/S19",
      }),
    );
    expect(body.appSession).toEqual(
      expect.objectContaining({
        authProvider: "trusted-account-provider",
        actor: {
          account: "Peter",
          role: "student",
        },
      }),
    );
    expect(providerRequests).toEqual([
      {
        url: "https://accounts.example.test/uais/authenticate",
        method: "POST",
        authorization: "Bearer test-app-auth-provider-token-with-32-chars",
        body: {
          account: "Peter",
          password: "trusted-provider-password",
        },
      },
    ]);
    expect(setCookies.join("\n")).toContain("HttpOnly");
    expect(setCookies.join("\n")).toContain("Secure");
    expect(JSON.stringify(body)).not.toContain("trusted-provider-password");
    expect(JSON.stringify(body)).not.toContain("test-app-auth-provider-token-with-32-chars");
  });

  it("creates signed cookie headers and resolves them back to users", () => {
    const student = {
      account: "Peter",
      department: "学生账号",
      displayName: "Peter",
      role: "student" as const,
    };

    const cookieHeader = createUaisAppSessionCookie(student, {
      secret: "test-app-session-signing-secret",
      now: new Date("2099-01-01T00:00:00.000Z"),
      sessionId: "app-session-cookie-test-id",
    });

    expect(cookieHeader).toContain("uais_app_session=");
    expect(cookieHeader).toContain(`${UAIS_APP_SESSION_SIGNATURE_COOKIE}=`);
    expect(cookieHeader).not.toContain("student:Peter");
    expect(
      getUaisAppSessionUserFromCookieString(`foo=bar; ${cookieHeader}`, {
        secret: "test-app-session-signing-secret",
        now: new Date("2099-01-01T00:01:00.000Z"),
      }),
    ).toEqual(
      expect.objectContaining({
        displayName: "Peter",
        role: "student",
      }),
    );
    expect(
      getUaisAppSessionUserFromCookieString(
        "uais_app_session=student:Peter; uais_app_session_signature=bad",
        { secret: "test-app-session-signing-secret" },
      ),
    ).toBeNull();

    const setCookies = createUaisAppSessionSetCookieHeaders({
      claims: {
        account: "Peter",
        authenticatedAt: "2099-01-01T00:00:00.000Z",
        department: "学生账号",
        displayName: "Peter",
        expiresAt: "2099-01-01T08:00:00.000Z",
        role: "student",
        sessionId: "app-session-cookie-test-id",
      },
      maxAgeSeconds: 3600,
      secret: "test-app-session-signing-secret",
      secure: true,
    });
    expect(setCookies.join("\n")).toContain("HttpOnly");
    expect(setCookies.join("\n")).toContain("Secure");
  });

  it("keeps role home and route permissions explicit", () => {
    expect(getUaisHomeHrefForRole("teacher")).toBe("/teaching");
    expect(getUaisHomeHrefForRole("student")).toBe("/student-dashboard");
    expect(isUaisRouteAllowedForRole("/teaching", "teacher")).toBe(true);
    expect(isUaisRouteAllowedForRole("/teaching", "student")).toBe(false);
    expect(isUaisRouteAllowedForRole("/student-dashboard", "student")).toBe(true);
  });
});

function readSetCookieHeaders(response: Response) {
  const headersWithSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headersWithSetCookie.getSetCookie?.();
  if (setCookies?.length) {
    return setCookies;
  }

  const combined = response.headers.get("set-cookie");
  return combined
    ? combined.split(/,\s*(?=uais_app_session(?:_signature)?=)/)
    : [];
}

function createCookieHeaderFromSetCookies(setCookies: string[]) {
  return setCookies
    .map((setCookie) => setCookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}
