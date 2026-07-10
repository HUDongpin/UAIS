import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";

const appSessionSecret = "test-app-session-signing-secret";
const teacherAuthSecret = "test-teacher-auth-session-signing-secret";

describe("UAIS app route auth proxy", () => {
  it("redirects protected app routes to the login page when no app session exists", () => {
    const request = new NextRequest("https://uais.top/courses");
    const response = proxy(request);

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://uais.top/login?from=%2Fcourses",
    );
  });

  it("allows protected app routes when the UAIS app session cookie exists", () => {
    const request = new NextRequest("https://uais.top/learning", {
      headers: {
        cookie: createUaisAppSessionCookie(createTeacherUser(), {
          secret: appSessionSecret,
        }),
      },
    });
    const response = proxy(request, { UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret });

    expect(response?.headers.get("location")).toBeNull();
  });

  it("rejects an unsigned app-session cookie pair instead of trusting cookie names", () => {
    const request = new NextRequest("https://uais.top/teaching", {
      headers: {
        cookie: "uais_app_session=redacted; uais_app_session_signature=redacted",
      },
    });
    const response = proxy(request, { UAIS_APP_SESSION_SIGNING_SECRET: undefined });

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://uais.top/login?from=%2Fteaching",
    );
  });

  it("moves an authenticated teacher away from login and into My Teaching", () => {
    const request = new NextRequest("https://uais.top/login", {
      headers: {
        cookie: createUaisAppSessionCookie(createTeacherUser(), {
          secret: appSessionSecret,
        }),
      },
    });
    const response = proxy(request, { UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret });

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("https://uais.top/teaching");
  });

  it("moves an authenticated student away from login and into Student Dashboard", () => {
    const request = new NextRequest("https://uais.top/login", {
      headers: {
        cookie: createUaisAppSessionCookie(createStudentUser(), {
          secret: appSessionSecret,
        }),
      },
    });
    const response = proxy(request, { UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret });

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://uais.top/student-dashboard",
    );
  });

  it("moves an authenticated admin away from login and into the teaching workspace", () => {
    const request = new NextRequest("https://uais.top/login", {
      headers: {
        cookie: createUaisAppSessionCookie(createAdminUser(), {
          secret: appSessionSecret,
        }),
      },
    });
    const response = proxy(request, { UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret });

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("https://uais.top/teaching");
  });

  it("keeps Peter out of the teacher workspace and redirects to Student Dashboard", () => {
    const request = new NextRequest("https://uais.top/teaching", {
      headers: {
        cookie: createUaisAppSessionCookie(createStudentUser(), {
          secret: appSessionSecret,
        }),
      },
    });
    const response = proxy(request, { UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret });

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://uais.top/student-dashboard",
    );
  });

  it("rejects the old readable demo app session cookie", () => {
    const request = new NextRequest("https://uais.top/learning", {
      headers: {
        cookie: "uais_app_session=student:Peter",
      },
    });
    const response = proxy(request, { UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret });

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://uais.top/login?from=%2Flearning",
    );
  });

  it("rejects an unsigned trusted-teacher cookie pair instead of trusting cookie names", () => {
    const request = new NextRequest("https://uais.top/teaching", {
      headers: {
        cookie: "uais_teacher_auth_claims=forged; uais_teacher_auth_signature=forged",
      },
    });
    const response = proxy(request, {
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    });

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://uais.top/login?from=%2Fteaching",
    );
  });

  it("allows the teacher workspace when a validly signed trusted-teacher cookie exists", () => {
    const request = new NextRequest("https://uais.top/teaching", {
      headers: {
        cookie: createSignedTeacherCookie(teacherAuthSecret),
      },
    });
    const response = proxy(request, {
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    });

    expect(response?.headers.get("location")).toBeNull();
  });

  it("rejects a signed trusted-teacher cookie when no signing secret is configured", () => {
    const request = new NextRequest("https://uais.top/teaching", {
      headers: {
        cookie: createSignedTeacherCookie(teacherAuthSecret),
      },
    });
    const response = proxy(request, {
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: undefined,
    });

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://uais.top/login?from=%2Fteaching",
    );
  });
});

function createSignedTeacherCookie(secret: string) {
  return createUaisTeacherAuthSessionCookieHeader({
    secret,
    claims: {
      sessionId: "teacher-session-1",
      actorId: "Phoebe",
      role: "teacher",
      authenticatedAt: "2026-07-09T00:00:00.000Z",
      expiresAt: "2100-01-01T00:00:00.000Z",
    },
  });
}

function createTeacherUser() {
  return {
    account: "Phoebe",
    department: "教师账号",
    displayName: "Phoebe",
    role: "teacher" as const,
  };
}

function createStudentUser() {
  return {
    account: "Peter",
    department: "学生账号",
    displayName: "Peter",
    role: "student" as const,
  };
}

function createAdminUser() {
  return {
    account: "Admin",
    department: "Admin Office",
    displayName: "Admin",
    role: "admin" as const,
  };
}
