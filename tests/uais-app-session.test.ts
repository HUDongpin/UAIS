import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUaisHomeHrefForRole,
  isUaisRouteAllowedForRole,
  UAIS_APP_SESSION_SIGNATURE_COOKIE,
} from "@/lib/auth/uais-app-session";
import {
  classifyUaisAppSessionSigningSecret,
  createUaisAppSessionCookie,
  createUaisAppSessionSetCookieHeaders,
  getUaisAppSessionUserFromCookieString,
  resolveUaisAppSessionSigningSecret,
} from "@/lib/server/uais-app-session";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
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
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
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
        secret: "test-app-session-signing-secret-32ch",
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
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
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

  it("returns a redacted validation error for malformed login JSON", async () => {
    const post = createUaisAppSessionPostHandler({
      env: {
        NODE_ENV: "development",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
      },
    });

    const response = await post(
      new Request("http://localhost/api/auth/app-session", {
        method: "POST",
        body: "{not-json",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Enter an account and password.");
    expect(body.redaction).toEqual({
      secrets: "omitted",
      passwords: "omitted",
      cookies: "headers-only",
      sessionIds: "omitted",
    });
    expect(JSON.stringify(body)).not.toContain("not-json");
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
    expect(
      resolveUaisAppSessionSigningSecret({
        VERCEL_ENV: "preview",
      }),
    ).toBeUndefined();
    expect(
      resolveUaisAppSessionSigningSecret({
        UAIS_DEPLOYMENT_ENV: "staging",
      }),
    ).toBeUndefined();
    expect(
      resolveUaisAppSessionSigningSecret({
        VERCEL_ENV: "preview",
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
      }),
    ).toBe("test-app-session-signing-secret-32ch");

    const post = createUaisAppSessionPostHandler({
      env: {
        NODE_ENV: "development",
        UAIS_DEPLOYMENT_ENV: "production",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
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

  it("refuses a signing secret below the strength floor in a deployed runtime", async () => {
    // The release chain has always GRADED a secret shorter than 32 characters as
    // weak (scripts/app-auth-provider-readiness.mjs) while the runtime accepted
    // any non-empty string, so a deployment that skipped the gate signed every
    // session in the cohort with whatever was pasted into the Vercel field.
    const weakSecret = { UAIS_APP_SESSION_SIGNING_SECRET: "uais-secret" };
    for (const runtime of [
      { UAIS_DEPLOYMENT_ENV: "production" },
      { VERCEL_ENV: "preview" },
      { UAIS_DEPLOYMENT_ENV: "staging" },
    ]) {
      expect(
        resolveUaisAppSessionSigningSecret({ ...runtime, ...weakSecret }),
        JSON.stringify(runtime),
      ).toBeUndefined();
      expect(classifyUaisAppSessionSigningSecret({ ...runtime, ...weakSecret })).toEqual({
        status: "weak",
        minimumLength: 32,
        valueRedacted: true,
      });
    }

    // A laptop keeps working. The floor protects a secret other people can
    // reach; refusing a short one locally would break every `.env.local` in the
    // project for no security gain.
    expect(resolveUaisAppSessionSigningSecret(weakSecret)).toBe("uais-secret");
    expect(classifyUaisAppSessionSigningSecret({})).toMatchObject({
      status: "development-fallback",
    });

    const post = createUaisAppSessionPostHandler({
      env: {
        UAIS_DEPLOYMENT_ENV: "production",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH: "true",
        ...weakSecret,
      },
    });
    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        body: JSON.stringify({ account: "Peter", password: "12345" }),
      }),
    );
    const body = await response.json();

    // 503 with no cookie, and a reason that names the ACTUAL fault: reporting a
    // plainly-configured secret as "not configured" sends the owner looking in
    // the wrong place.
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(body.appSessionSigningSecret).toEqual({
      status: "weak",
      minimumLength: 32,
      valueRedacted: true,
    });
    expect(JSON.stringify(body)).not.toContain("uais-secret");
  });

  it("allows the owner-approved local demo account in production only behind an explicit demo-auth flag", async () => {
    const env = {
      NODE_ENV: "production",
      UAIS_APP_AUTH_PROVIDER: "local-demo",
      UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH: "true",
      UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
    };
    const post = createUaisAppSessionPostHandler({
      env,
      now: new Date("2099-01-01T00:00:00.000Z"),
      createSessionId: () => "production-demo-app-session-id",
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        body: JSON.stringify({
          account: "Phoebe",
          password: "12345",
        }),
      }),
    );
    const body = await response.json();
    const setCookies = readSetCookieHeaders(response);

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.redirectTarget).toBe("/teaching");
    expect(body.authProviderContract).toEqual(
      expect.objectContaining({
        providerKind: "local-demo",
        productionStatus: "ready",
        demoProductionAccess: {
          enabled: true,
          env: "UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH",
          valueRedacted: true,
        },
      }),
    );
    expect(body.appSession).toEqual(
      expect.objectContaining({
        actor: {
          account: "Phoebe",
          role: "teacher",
        },
        cookieSecurity: expect.objectContaining({
          httpOnly: true,
          secure: true,
        }),
      }),
    );
    expect(setCookies).toHaveLength(2);
    expect(setCookies.join("\n")).toContain("Secure");
    expect(JSON.stringify(body)).not.toContain("12345");
  });

  it("marks app session cookies secure in UAIS production deployments", async () => {
    const env = {
      NODE_ENV: "development",
      UAIS_DEPLOYMENT_ENV: "production",
      UAIS_APP_AUTH_PROVIDER: "trusted-account-provider",
      UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
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
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
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
      secret: "test-app-session-signing-secret-32ch",
      now: new Date("2099-01-01T00:00:00.000Z"),
      sessionId: "app-session-cookie-test-id",
    });

    expect(cookieHeader).toContain("uais_app_session=");
    expect(cookieHeader).toContain(`${UAIS_APP_SESSION_SIGNATURE_COOKIE}=`);
    expect(cookieHeader).not.toContain("student:Peter");
    expect(
      getUaisAppSessionUserFromCookieString(`foo=bar; ${cookieHeader}`, {
        secret: "test-app-session-signing-secret-32ch",
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
        { secret: "test-app-session-signing-secret-32ch" },
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
      secret: "test-app-session-signing-secret-32ch",
      secure: true,
    });
    expect(setCookies.join("\n")).toContain("HttpOnly");
    expect(setCookies.join("\n")).toContain("Secure");
  });

  it("keeps role home and route permissions explicit", () => {
    expect(getUaisHomeHrefForRole("teacher")).toBe("/teaching");
    expect(getUaisHomeHrefForRole("student")).toBe("/student-dashboard");
    expect(getUaisHomeHrefForRole("admin")).toBe("/teaching");
    expect(isUaisRouteAllowedForRole("/teaching", "teacher")).toBe(true);
    expect(isUaisRouteAllowedForRole("/teaching", "student")).toBe(false);
    expect(isUaisRouteAllowedForRole("/teaching", "admin")).toBe(true);
    expect(isUaisRouteAllowedForRole("/student-dashboard", "student")).toBe(true);
    expect(isUaisRouteAllowedForRole("/student-dashboard", "admin")).toBe(false);
  });

  // Plan E9: the post-login redirect target carries the whole return path, so an
  // invite link had its query matched as part of the pathname and was refused -
  // sending a student who signed in to join a class to the plain plaza instead.
  it("matches the pathname of a return path that carries a query or fragment", () => {
    expect(isUaisRouteAllowedForRole("/courses?invite=66334455", "student")).toBe(true);
    expect(isUaisRouteAllowedForRole("/courses?invite=66334455", "teacher")).toBe(true);
    expect(isUaisRouteAllowedForRole("/learning?courseId=research#unit-3", "student")).toBe(
      true,
    );
    expect(isUaisRouteAllowedForRole("/teaching?course=abc", "student")).toBe(false);
    expect(isUaisRouteAllowedForRole("/student-dashboard?tab=groups", "admin")).toBe(false);
    // The query cannot smuggle an allowed prefix into a refused pathname.
    expect(isUaisRouteAllowedForRole("/teaching?next=/courses", "student")).toBe(false);
  });

  it("accepts admin from the trusted account provider as a signed app role", async () => {
    const post = createUaisAppSessionPostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_APP_AUTH_PROVIDER: "trusted-account-provider",
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
      },
      now: new Date("2099-01-01T00:00:00.000Z"),
      createSessionId: () => "app-session-admin-test-id",
      authenticateAccount: () => ({
        account: "Admin",
        role: "admin",
        displayName: "Admin",
        department: "Admin Office",
      }),
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        body: JSON.stringify({
          account: "Admin",
          password: "trusted-provider-password",
        }),
      }),
    );
    const body = await response.json();
    const cookieHeader = createCookieHeaderFromSetCookies(readSetCookieHeaders(response));

    expect(response.status).toBe(200);
    expect(body.redirectTarget).toBe("/teaching");
    expect(body.appSession.actor).toEqual({
      account: "Admin",
      role: "admin",
    });
    expect(
      getUaisAppSessionUserFromCookieString(cookieHeader, {
        secret: "test-app-session-signing-secret-32ch",
        now: new Date("2099-01-01T00:01:00.000Z"),
      }),
    ).toEqual(
      expect.objectContaining({
        displayName: "Admin",
        role: "admin",
      }),
    );
  });

  it("bridges a local teacher login to a signed teacher session tied to the same app session", async () => {
    const env = {
      NODE_ENV: "development",
      UAIS_APP_AUTH_PROVIDER: "local-demo",
      UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET:
        "test-teacher-auth-session-signing-secret-32",
    };
    const response = await loginAs({ env, account: "Phoebe" });
    const body = await response.json();
    const setCookies = readSetCookieHeaders(response);

    expect(response.status).toBe(200);
    expect(setCookies).toHaveLength(4);
    expect(body.localTeacherAuthBridge.status).toBe("issued");

    const teacherSession = readUaisAuthenticatedTeacherSessionFromSignedCookies({
      request: new Request("http://localhost/api/teaching/operations", {
        headers: { cookie: createCookieHeaderFromSetCookies(setCookies) },
      }),
      secret: "test-teacher-auth-session-signing-secret-32",
      now: new Date("2099-01-01T00:01:00.000Z"),
    });

    // The write actor must equal the account the course list reads back under,
    // or a teacher would create courses their own dashboard never shows.
    expect(teacherSession?.actorId).toBe("Phoebe");
    expect(teacherSession?.role).toBe("teacher");
    // Lifetime coupling: the teacher cookie may not outlive the session that
    // authorized it.
    expect(teacherSession?.expiresAt).toBe(body.appSession.expiresAt);
    expect(setCookies.join("\n")).not.toContain(
      "test-teacher-auth-session-signing-secret-32",
    );
  });

  it("mints no teacher session in any deployed runtime", async () => {
    const deployedRuntimes = [
      { label: "vercel-production", markers: { VERCEL_ENV: "production" } },
      { label: "node-production", markers: { NODE_ENV: "production" } },
      { label: "uais-production", markers: { UAIS_DEPLOYMENT_ENV: "production" } },
      { label: "vercel-preview", markers: { VERCEL_ENV: "preview" } },
      { label: "uais-preview", markers: { UAIS_DEPLOYMENT_ENV: "preview" } },
      { label: "uais-staging", markers: { UAIS_DEPLOYMENT_ENV: "staging" } },
      {
        label: "preview-built-as-production",
        markers: { VERCEL_ENV: "preview", NODE_ENV: "production" },
      },
      {
        label: "local-production-lane",
        markers: { NODE_ENV: "production", UAIS_DEPLOYMENT_ENV: "local-production" },
      },
    ];

    for (const runtime of deployedRuntimes) {
      const env = {
        ...runtime.markers,
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH: "true",
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET:
          "test-teacher-auth-session-signing-secret-32",
      };
      const response = await loginAs({ env, account: "Phoebe" });
      const body = await response.json();
      const setCookies = readSetCookieHeaders(response);

      expect(response.status, `${runtime.label}: ${JSON.stringify(body)}`).toBe(200);
      expect(setCookies, runtime.label).toHaveLength(2);
      expect(setCookies.join("\n"), runtime.label).not.toContain(
        "uais_teacher_auth_claims",
      );
      expect(body.localTeacherAuthBridge.status, runtime.label).toBe(
        "skipped-deployed-runtime",
      );
      expect(body.appSession.cookieNames, runtime.label).toEqual([
        "uais_app_session",
        "uais_app_session_signature",
      ]);

      // The decisive proof: a deployed login yields no teacher session even
      // when the verifier is handed the very secret the bridge would have used.
      expect(
        readUaisAuthenticatedTeacherSessionFromSignedCookies({
          request: new Request("http://localhost/api/teaching/operations", {
            headers: { cookie: createCookieHeaderFromSetCookies(setCookies) },
          }),
          secret: "test-teacher-auth-session-signing-secret-32",
          now: new Date("2099-01-01T00:01:00.000Z"),
        }),
        runtime.label,
      ).toBeUndefined();
    }
  });

  it("mints nothing rather than falling back to a built-in teacher signing secret", async () => {
    const response = await loginAs({
      env: {
        NODE_ENV: "development",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
      },
      account: "Phoebe",
    });
    const body = await response.json();

    expect(readSetCookieHeaders(response)).toHaveLength(2);
    expect(body.localTeacherAuthBridge.status).toBe(
      "skipped-signing-secret-not-configured",
    );
    expect(body.localTeacherAuthBridge.requiredEnvName).toBe(
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    );
  });

  it("issues no teacher session for a local student login and clears a stale one", async () => {
    const env = {
      NODE_ENV: "development",
      UAIS_APP_AUTH_PROVIDER: "local-demo",
      UAIS_APP_SESSION_SIGNING_SECRET: "test-app-session-signing-secret-32ch",
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET:
        "test-teacher-auth-session-signing-secret-32",
    };

    const cleanStudentLogin = await loginAs({ env, account: "Peter" });
    expect(readSetCookieHeaders(cleanStudentLogin)).toHaveLength(2);
    expect((await cleanStudentLogin.json()).localTeacherAuthBridge.status).toBe(
      "skipped-non-teacher-role",
    );

    const teacherCookies = readSetCookieHeaders(await loginAs({ env, account: "Phoebe" }));
    const switchedStudentLogin = await loginAs({
      env,
      account: "Peter",
      cookie: createCookieHeaderFromSetCookies(teacherCookies),
    });
    const switchedSetCookies = readSetCookieHeaders(switchedStudentLogin);

    expect(switchedSetCookies).toHaveLength(4);
    const clearedTeacherCookies = switchedSetCookies.filter((setCookie) =>
      setCookie.startsWith("uais_teacher_auth_"),
    );
    expect(clearedTeacherCookies).toHaveLength(2);
    clearedTeacherCookies.forEach((setCookie) => {
      expect(setCookie).toContain("Max-Age=0");
    });
    expect(
      readUaisAuthenticatedTeacherSessionFromSignedCookies({
        request: new Request("http://localhost/api/teaching/operations", {
          headers: { cookie: createCookieHeaderFromSetCookies(switchedSetCookies) },
        }),
        secret: "test-teacher-auth-session-signing-secret-32",
        now: new Date("2099-01-01T00:01:00.000Z"),
      }),
    ).toBeUndefined();
  });

  it("clears the teacher session on sign-out so it cannot outlive the app session", async () => {
    const signOutResponse = createUaisAppSessionDeleteHandler({
      env: { NODE_ENV: "development" },
    })();
    const setCookies = readSetCookieHeaders(signOutResponse);

    expect(setCookies).toHaveLength(4);
    setCookies.forEach((setCookie) => {
      expect(setCookie).toContain("Max-Age=0");
    });
    expect(setCookies.join("\n")).toContain("uais_teacher_auth_claims=");
    expect(setCookies.join("\n")).toContain("uais_teacher_auth_signature=");
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
    ? combined.split(
        /,\s*(?=uais_(?:app_session(?:_signature)?|teacher_auth_(?:claims|signature))=)/,
      )
    : [];
}

async function loginAs(input: {
  env: Record<string, string | undefined>;
  account: string;
  cookie?: string;
}) {
  const post = createUaisAppSessionPostHandler({
    env: input.env,
    now: new Date("2099-01-01T00:00:00.000Z"),
    createSessionId: () => "app-session-teacher-bridge-test-id",
  });

  return post(
    new Request("http://localhost/api/auth/app-session", {
      method: "POST",
      headers: input.cookie ? { cookie: input.cookie } : undefined,
      body: JSON.stringify({ account: input.account, password: "12345" }),
    }),
  );
}

function createCookieHeaderFromSetCookies(setCookies: string[]) {
  return setCookies
    .map((setCookie) => setCookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}
