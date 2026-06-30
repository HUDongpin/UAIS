import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const appSessionSecret = "test-app-session-signing-secret";

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
});

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
