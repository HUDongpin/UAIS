import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as teachingCoursesRoute from "@/app/api/teaching/courses/route";
import {
  createTeachingCourseGetHandler,
  createTeachingCoursePostHandler,
} from "@/app/api/teaching/courses/route";
import {
  createTeachingCourseClassPostHandler,
} from "@/app/api/teaching/courses/[courseId]/classes/route";
import {
  createTeachingClassMembershipApprovePostHandler,
} from "@/app/api/teaching/classes/[classId]/memberships/[membershipId]/approve/route";
import {
  createTeachingInviteCodeJoinPostHandler,
} from "@/app/api/teaching/invite-codes/[code]/join/route";
import {
  type UaisAppSessionUser,
} from "@/lib/auth/uais-app-session";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { storeTeachingCourseCoverAsset } from "@/lib/server/teaching-course-assets-store";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { readTeachingCourseManagementDatabase } from "@/lib/server/teaching-course-management-store";

const teacherAuthSecret = "test-teaching-course-session-signing-secret";
const teacherAuthIssuerSecret =
  "test-teaching-course-auth-issuer-secret-production-fixture";
const appSessionSecret = "test-teaching-course-app-session-signing-secret";
const externalStorageAccessToken =
  "test-external-storage-access-token-with-32-chars";
const appAuthProviderToken =
  "test-app-auth-provider-token-with-32-chars";
const productionCourseManagementError =
  "Production teaching course management persistence requires external storage.";
const studentAppSessionUser: UaisAppSessionUser = {
  account: "Peter",
  department: "学生账号",
  displayName: "Peter",
  role: "student",
};

function createReadyProductionDatabaseAdapter() {
  return {
    status: "ready",
    providerClass: "managed-database",
    migrationStatus: "up-to-date",
    backupPolicy: "point-in-time-restore",
    concurrencyControl: "transactional",
    valueRedacted: true,
  };
}

function createTeacherCookie(actorId = "teacher-kang") {
  return createUaisTeacherAuthSessionCookieHeader({
    secret: teacherAuthSecret,
    claims: {
      sessionId: `${actorId}-course-management-session`,
      actorId,
      role: "teacher",
      authenticatedAt: "2026-06-22T10:00:00.000Z",
      expiresAt: "2026-06-22T13:00:00.000Z",
    },
  });
}

function createStudentCookie(user = studentAppSessionUser, secret?: string) {
  return createUaisAppSessionCookie(user, {
    ...(secret ? { secret } : {}),
    sessionId: `${user.account}-course-management-session`,
    now: new Date("2026-06-22T11:00:00.000Z"),
  });
}

function createProductionCourseManagementEnv(dataDir: string) {
  return {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
    UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
    UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
    UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
  };
}

function createDeploymentProductionCourseManagementEnv(dataDir: string) {
  return {
    ...createProductionCourseManagementEnv(dataDir),
    NODE_ENV: "development",
    VERCEL_ENV: "preview",
    UAIS_DEPLOYMENT_ENV: "production",
  };
}

function createExternalProductionCourseManagementEnv(dataDir: string) {
  return {
    ...createProductionCourseManagementEnv(dataDir),
    UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
    UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
    UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
  };
}

function createProductionCourseManagementEnvWithAppAuthProvider(dataDir: string) {
  return {
    ...createProductionCourseManagementEnv(dataDir),
    UAIS_APP_AUTH_PROVIDER: "trusted-account-provider",
    UAIS_APP_AUTH_PROVIDER_URL: "https://accounts.example.test/uais/authenticate",
    UAIS_APP_AUTH_PROVIDER_TOKEN: appAuthProviderToken,
  };
}

function createDeploymentProductionCourseManagementEnvWithAppAuthProvider(dataDir: string) {
  return {
    ...createDeploymentProductionCourseManagementEnv(dataDir),
    UAIS_APP_AUTH_PROVIDER: "trusted-account-provider",
    UAIS_APP_AUTH_PROVIDER_URL: "https://accounts.example.test/uais/authenticate",
    UAIS_APP_AUTH_PROVIDER_TOKEN: appAuthProviderToken,
  };
}

function createExternalProductionCourseManagementEnvWithAppAuthProvider(dataDir: string) {
  return {
    ...createExternalProductionCourseManagementEnv(dataDir),
    UAIS_APP_AUTH_PROVIDER: "trusted-account-provider",
    UAIS_APP_AUTH_PROVIDER_URL: "https://accounts.example.test/uais/authenticate",
    UAIS_APP_AUTH_PROVIDER_TOKEN: appAuthProviderToken,
  };
}

function createProductionCourseManagementEnvWithoutTeacherAuthProvider(dataDir: string) {
  return {
    ...createExternalProductionCourseManagementEnv(dataDir),
    UAIS_TEACHER_AUTH_PROVIDER: undefined,
    UAIS_TEACHER_AUTH_ISSUER_SECRET: undefined,
  };
}

function expectNoLocalOrSecretValues(value: unknown, dataDir: string) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(dataDir);
  expect(serialized).not.toContain("/Users/");
  expect(serialized).not.toContain(teacherAuthSecret);
  expect(serialized).not.toContain(teacherAuthIssuerSecret);
  expect(serialized).not.toContain(appAuthProviderToken);
}

describe("teaching course management API", () => {
  it("lists courses for a teacher app-session on the dashboard readback path", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-app-teacher-list-"));
    const getCourses = createTeachingCourseGetHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:10:00.000Z"),
    });

    try {
      const response = await getCourses(
        new Request("https://www.uais.top/api/teaching/courses", {
          headers: {
            cookie: createStudentCookie(
              {
                account: "Phoebe",
                department: "教师账号",
                displayName: "Phoebe",
                role: "teacher",
              },
              appSessionSecret,
            ),
          },
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.courses).toEqual([]);
      expect(body.receipt).toEqual(
        expect.objectContaining({
          action: "list-courses",
          actorId: "Phoebe",
          status: "read",
        }),
      );
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production demo teacher dashboard readback even when the legacy demo-auth flag is present", async () => {
    const getCourses = createTeachingCourseGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH: "true",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      fetch: async () => Response.json({ error: "upstream unavailable" }, { status: 502 }),
      now: new Date("2026-06-22T11:10:00.000Z"),
    });

    const response = await getCourses(
      new Request("https://www.uais.top/api/teaching/courses", {
        headers: {
          cookie: createStudentCookie(
            {
              account: "Phoebe",
              department: "教师账号",
              displayName: "Phoebe",
              role: "teacher",
            },
            appSessionSecret,
          ),
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("UAIS teacher auth provider is not production-ready.");
    expect(body.authProviderContract).toEqual(
      expect.objectContaining({
        providerKind: "local-demo",
        productionStatus: "blocked",
        blockedReason: "local-demo-not-production",
      }),
    );
    expectNoLocalOrSecretValues(body, "storage.example.test");
  });

  it("lists only the signed teacher's persisted courses and classes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-list-"));
    const courseManagementEnv = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => ({
        teacherId: input.ownership.teacherId,
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });
    const courseRoute = teachingCoursesRoute as typeof teachingCoursesRoute & {
      createTeachingCourseGetHandler?: (deps?: {
        env?: Record<string, string | undefined>;
        now?: Date;
      }) => (request: Request) => Promise<Response>;
    };

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      await postClass(
        new Request(
          "https://www.uais.top/api/teaching/courses/teacher-course-ai-supported-mathematics-research-20260622-112000/classes",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: createTeacherCookie(),
            },
            body: JSON.stringify({
              className: "Research Methods Class 1",
              semester: "2026 Spring",
            }),
          },
        ),
        {
          params: Promise.resolve({
            courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
          }),
        },
      );
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie("teacher-other"),
          },
          body: JSON.stringify({
            name: "Another Teacher Course",
            instructor: "Other Teacher",
            unit: "Guangzhou University 404",
            department: "Private Faculty",
            semester: "2026 Spring",
          }),
        }),
      );
      await postClass(
        new Request(
          "https://www.uais.top/api/teaching/courses/teacher-course-another-teacher-course-20260622-112000/classes",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: createTeacherCookie("teacher-other"),
            },
            body: JSON.stringify({
              className: "Other Teacher Class",
              semester: "2026 Spring",
            }),
          },
        ),
        {
          params: Promise.resolve({
            courseId: "teacher-course-another-teacher-course-20260622-112000",
          }),
        },
      );
      await postClass(
        new Request(
          "https://www.uais.top/api/teaching/courses/teacher-course-another-teacher-course-20260622-112000/classes",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: createTeacherCookie("teacher-other"),
            },
            body: JSON.stringify({
              className: "Other Teacher Private Class",
              semester: "2026 Spring",
            }),
          },
        ),
        {
          params: Promise.resolve({
            courseId: "teacher-course-another-teacher-course-20260622-112000",
          }),
        },
      );
      await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(),
            "x-uais-trace-id": "trace-kang-list-membership",
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );
      await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395058/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie({
              account: "Eve",
              department: "学生账号",
              displayName: "Eve",
              role: "student",
            }),
            "x-uais-trace-id": "trace-other-list-membership",
          },
        }),
        {
          params: Promise.resolve({ code: "55395058" }),
        },
      );

      const createGetCourses = courseRoute.createTeachingCourseGetHandler;
      expect(createGetCourses).toEqual(expect.any(Function));
      const getCourses = createGetCourses?.({
        env: courseManagementEnv,
        now: new Date("2026-06-22T11:30:00.000Z"),
      });
      const response = await getCourses?.(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "GET",
          headers: {
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-list-1",
          },
        }),
      );
      const body = await response?.json();

      expect(response?.status).toBe(200);
      expect(response?.headers.get("cache-control")).toBe("no-store");
      expect(body.courses).toEqual([
        expect.objectContaining({
          courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
          ownerTeacherId: "teacher-kang",
          courseName: "AI Supported Mathematics Research",
        }),
      ]);
      expect(body.classes).toEqual([
        expect.objectContaining({
          classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
          courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
          ownerTeacherId: "teacher-kang",
          className: "Research Methods Class 1",
          invitationCode: "55395057",
        }),
      ]);
      expect(body.memberships).toEqual([
        expect.objectContaining({
          membershipId:
            "membership-teacher-course-ai-supported-mathematics-research-20260622-112000-class-1-Peter",
          courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
          classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
          studentId: "Peter",
          studentDisplayName: "Peter",
          membershipStatus: "pending-teacher-review",
        }),
      ]);
      expect(body.receipt).toMatchObject({
        action: "list-courses",
        actorId: "teacher-kang",
        status: "read",
        traceId: "trace-course-list-1",
        responsibleSession: "S12",
      });
      expect(JSON.stringify(body)).not.toContain("Another Teacher Course");
      expect(JSON.stringify(body)).not.toContain("Other Teacher Class");
      expect(JSON.stringify(body)).not.toContain("Other Teacher Private Class");
      expect(JSON.stringify(body)).not.toContain("Eve");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("records redacted request source metadata on signed teacher course creation audits", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-audit-source-"));
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => ({
        teacherId: input.ownership.teacherId,
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-create-audit-source",
            "user-agent": "UAIS course create audit source test",
          },
          body: JSON.stringify({
            name: "Audit Source Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "create-course",
          actorId: "teacher-kang",
          traceId: "trace-course-create-audit-source",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS course create audit source test",
            ipAddress: "redacted",
          },
          storagePolicy: "local-json-teaching-course-management-audit-log",
        }),
      );
      expectNoLocalOrSecretValues(database, dataDir);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("records signed teacher session summaries on course creation receipts and audits", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-auth-session-"));
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => ({
        teacherId: input.ownership.teacherId,
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-create-auth-session",
          },
          body: JSON.stringify({
            name: "Signed Session Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.receipt).toMatchObject({
        action: "create-course",
        actorId: "teacher-kang",
        traceId: "trace-course-create-auth-session",
        authSession: {
          sessionId: "teacher-kang-course-management-session",
          authenticatedAt: "2026-06-22T10:00:00.000Z",
          expiresAt: "2026-06-22T13:00:00.000Z",
        },
      });
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "create-course",
          actorId: "teacher-kang",
          traceId: "trace-course-create-auth-session",
          authMode: "signed-teacher-session",
          authSession: {
            sessionId: "teacher-kang-course-management-session",
            authenticatedAt: "2026-06-22T10:00:00.000Z",
            expiresAt: "2026-06-22T13:00:00.000Z",
          },
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("records signed teacher session summaries on class creation receipts and audits", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-auth-session-"));
    const courseManagementEnv = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => ({
        teacherId: input.ownership.teacherId,
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const courseId = "teacher-course-signed-session-course-20260622-112000";

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "Signed Session Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const response = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-class-create-auth-session",
          },
          body: JSON.stringify({
            className: "Signed Session Class",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.receipt).toMatchObject({
        action: "create-class",
        actorId: "teacher-kang",
        courseId,
        classId: `${courseId}-class-1`,
        traceId: "trace-class-create-auth-session",
        authSession: {
          sessionId: "teacher-kang-course-management-session",
          authenticatedAt: "2026-06-22T10:00:00.000Z",
          expiresAt: "2026-06-22T13:00:00.000Z",
        },
      });
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "create-class",
          actorId: "teacher-kang",
          courseId,
          classId: `${courseId}-class-1`,
          traceId: "trace-class-create-auth-session",
          authMode: "signed-teacher-session",
          authSession: {
            sessionId: "teacher-kang-course-management-session",
            authenticatedAt: "2026-06-22T10:00:00.000Z",
            expiresAt: "2026-06-22T13:00:00.000Z",
          },
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed course create actor ids before course writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-unsafe-actor-id-"));
    const unsafeActorId = "/Users/example/secret-token-course-teacher";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-course-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    let ownershipMergeCount = 0;
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMergeCount += 1;
        return {
          teacherId: input.ownership.teacherId,
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:20:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-course-create-unsafe-actor-id",
          },
          body: JSON.stringify({
            name: "Unsafe Actor Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-course-create-unsafe-actor-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-course-create-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-course-teacher");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(ownershipMergeCount).toBe(0);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed course create session ids before course writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-unsafe-session-id-"));
    const unsafeSessionId = "/Users/example/secret-token-course-session";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    let ownershipMergeCount = 0;
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMergeCount += 1;
        return {
          teacherId: input.ownership.teacherId,
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:20:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            "x-uais-trace-id": "trace-course-create-unsafe-session-id",
          },
          body: JSON.stringify({
            name: "Unsafe Session Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-course-create-unsafe-session-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-course-create-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-course-session");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(ownershipMergeCount).toBe(0);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsigned course list reads before exposing local course records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-list-auth-"));
    const courseRoute = teachingCoursesRoute as typeof teachingCoursesRoute & {
      createTeachingCourseGetHandler?: (deps?: {
        env?: Record<string, string | undefined>;
        now?: Date;
      }) => (request: Request) => Promise<Response>;
    };

    try {
      const createGetCourses = courseRoute.createTeachingCourseGetHandler;
      expect(createGetCourses).toEqual(expect.any(Function));
      const getCourses = createGetCourses?.({
        env: {
          UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        },
        now: new Date("2026-06-22T11:30:00.000Z"),
      });
      const response = await getCourses?.(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "GET",
          headers: {
            "x-uais-trace-id": "trace-course-list-unsigned-1",
          },
        }),
      );
      const body = await response?.json();

      expect(response?.status).toBe(401);
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "authenticated-session-required",
          responsibleSession: "S12",
        }),
      );
      expect(body.courses).toBeUndefined();
      expect(body.classes).toBeUndefined();
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("hides invite-code memberships from students until teacher review approves them", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-student-pending-course-memberships-"));
    const courseManagementEnv = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => ({
        teacherId: input.ownership.teacherId,
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:40:00.000Z"),
    });
    const courseRoute = teachingCoursesRoute as typeof teachingCoursesRoute & {
      createTeachingCourseGetHandler?: (deps?: {
        env?: Record<string, string | undefined>;
        now?: Date;
      }) => (request: Request) => Promise<Response>;
    };
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            className: "Research Methods Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(),
            "x-uais-trace-id": "trace-student-pending-membership-join",
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );

      const createGetCourses = courseRoute.createTeachingCourseGetHandler;
      expect(createGetCourses).toEqual(expect.any(Function));
      const getCourses = createGetCourses?.({
        env: courseManagementEnv,
        now: new Date("2026-06-22T11:42:00.000Z"),
      });
      const response = await getCourses?.(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "GET",
          headers: {
            cookie: createStudentCookie(),
            "x-uais-trace-id": "trace-student-pending-course-list",
          },
        }),
      );
      const body = await response?.json();

      expect(response?.status, JSON.stringify(body)).toBe(200);
      expect(body.courses).toEqual([]);
      expect(body.classes).toEqual([]);
      expect(body.memberships).toEqual([]);
      expect(body.receipt).toMatchObject({
        action: "list-student-courses",
        actorId: "Peter",
        status: "read",
        traceId: "trace-student-pending-course-list",
        responsibleSession: "S12",
      });
      expect(JSON.stringify(body)).not.toContain("AI Supported Mathematics Research");
      expect(JSON.stringify(body)).not.toContain("pending-teacher-review");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("lists only the signed student's invite-code memberships after teacher review", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-student-course-memberships-"));
    const courseManagementEnv = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => ({
        teacherId: input.ownership.teacherId,
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:40:00.000Z"),
    });
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:45:00.000Z"),
    });
    const courseRoute = teachingCoursesRoute as typeof teachingCoursesRoute & {
      createTeachingCourseGetHandler?: (deps?: {
        env?: Record<string, string | undefined>;
        now?: Date;
      }) => (request: Request) => Promise<Response>;
    };
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const classId = `${courseId}-class-1`;

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            className: "Research Methods Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(),
            "x-uais-trace-id": "trace-student-membership-peter-join",
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );
      await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie({
              account: "Eve",
              department: "学生账号",
              displayName: "Eve",
              role: "student",
            }),
            "x-uais-trace-id": "trace-student-membership-eve-join",
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );
      await postApprove(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classId}/memberships/membership-${classId}-Peter/approve`,
          {
            method: "POST",
            headers: {
              cookie: createTeacherCookie(),
              "x-uais-trace-id": "trace-student-membership-peter-approve",
            },
          },
        ),
        {
          params: Promise.resolve({
            classId,
            membershipId: `membership-${classId}-Peter`,
          }),
        },
      );

      const createGetCourses = courseRoute.createTeachingCourseGetHandler;
      expect(createGetCourses).toEqual(expect.any(Function));
      const getCourses = createGetCourses?.({
        env: courseManagementEnv,
        now: new Date("2026-06-22T11:50:00.000Z"),
      });
      for (const [cookie, traceId] of [
        [createStudentCookie(), "trace-student-course-list-1"],
        [
          `${createStudentCookie()}; ${createTeacherCookie()}`,
          "trace-mixed-student-course-list-1",
        ],
      ] as const) {
        const response = await getCourses?.(
          new Request("https://www.uais.top/api/teaching/courses", {
            method: "GET",
            headers: {
              cookie,
              "x-uais-trace-id": traceId,
            },
          }),
        );
        const body = await response?.json();

        expect(response?.status, JSON.stringify(body)).toBe(200);
        expect(body.courses).toEqual([
          expect.objectContaining({
            courseId,
            courseName: "AI Supported Mathematics Research",
          }),
        ]);
        expect(body.classes).toEqual([
          expect.objectContaining({
            classId,
            courseId,
            className: "Research Methods Class 1",
            invitationCode: "55395057",
          }),
        ]);
        expect(body.memberships).toEqual([
          expect.objectContaining({
            membershipId: `membership-${classId}-Peter`,
            courseId,
            classId,
            studentId: "Peter",
            studentDisplayName: "Peter",
            membershipStatus: "approved",
            approvedAt: "2026-06-22T11:45:00.000Z",
          }),
        ]);
        expect(body.receipt).toMatchObject({
          action: "list-student-courses",
          actorId: "Peter",
          status: "read",
          traceId,
          responsibleSession: "S12",
        });
        expect(JSON.stringify(body)).not.toContain("Eve");
        expectNoLocalOrSecretValues(body, dataDir);
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates a persisted teacher-owned course and merges the new course into ownership scope", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-courses-"));
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: "teacher-kang",
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:20:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      await storeTeachingCourseCoverAsset({
        dataDir,
        courseId: "teacher-draft-ai-supported-mathematics-research",
        courseName: "AI Supported Mathematics Research",
        cover: {
          provider: "qwen",
          providerRole: "image-generation",
          model: "qwen-image-2.0-pro",
          imageUrl: "https://dashscope-result/course-cover.png",
          requestId: "request-course-cover-1",
          usage: { width: 800, height: 480, imageCount: 1 },
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "generated-url-only",
          },
        },
        audit: {
          traceId: "trace-course-cover-before-create-1",
          actorId: "teacher-kang",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS course cover test",
            ipAddress: "redacted",
          },
        },
        createdAt: "2026-06-22T11:18:00.000Z",
      });

      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-create-1",
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
            description: "Course draft created from the teacher workspace.",
            coverAssetId: "course-cover-request-course-cover-1",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(201);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-course-create-1");
      expect(body.traceId).toBe("trace-course-create-1");
      expect(body.course).toMatchObject({
        courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
        ownerTeacherId: "teacher-kang",
        courseName: "AI Supported Mathematics Research",
        instructor: "Kang Xia",
        unit: "Guangzhou University 404",
        department: "Experimental Teaching Center",
        semester: "2026 Spring",
        description: "Course draft created from the teacher workspace.",
        coverAssetId: "course-cover-request-course-cover-1",
        status: "draft",
        students: 0,
        createdAt: "2026-06-22T11:20:00.000Z",
        updatedAt: "2026-06-22T11:20:00.000Z",
        storagePolicy: "local-json-teaching-course-management",
        storageWritePolicy: "atomic-json-file-replace",
        responsibleSession: "S12",
      });
      expect(body.receipt).toMatchObject({
        action: "create-course",
        actorId: "teacher-kang",
        courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
        traceId: "trace-course-create-1",
        status: "persisted",
        responsibleSession: "S12",
      });
      expect(ownershipMerges).toEqual([
        expect.objectContaining({
          updatedAt: "2026-06-22T11:20:00.000Z",
          ownership: expect.objectContaining({
            teacherId: "teacher-kang",
            courseIds: ["teacher-course-ai-supported-mathematics-research-20260622-112000"],
          }),
        }),
      ]);
      expect(database.courses).toContainEqual(expect.objectContaining(body.course));
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "create-course",
          actorId: "teacher-kang",
          courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
          traceId: "trace-course-create-1",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns a structured redacted validation error for malformed course-create JSON before writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-courses-invalid-json-"));
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: "teacher-kang",
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:20:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-create-invalid-json",
          },
          body: '{"name":"/Users/example/secret-token-course"',
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(body).toEqual(
        expect.objectContaining({
          error: "Course request body must be JSON.",
          traceId: "trace-course-create-invalid-json",
          validation: {
            target: "teaching-course-create",
            status: "invalid",
            reasonCode: "body-malformed-json",
            field: "body",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          },
        }),
      );
      expect(ownershipMerges).toEqual([]);
      expect(await readdir(dataDir)).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("/Users/example");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns a structured redacted validation error for missing course-create fields", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-courses-missing-field-"));
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: "teacher-kang",
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:20:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-create-missing-field",
          },
          body: JSON.stringify({
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(body).toEqual(
        expect.objectContaining({
          error: "Course name is required.",
          traceId: "trace-course-create-missing-field",
          validation: expect.objectContaining({
            target: "teaching-course-create",
            status: "invalid",
            reasonCode: "missing-field",
            field: "name",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(ownershipMerges).toEqual([]);
      expect(await readdir(dataDir)).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates a new course with the signed teacher provisional course id used by cover generation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-courses-provisional-id-"));
    const provisionalCourseId = "teacher-draft-course-teacher-kang-course-20260622-111800";
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: "teacher-kang",
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:20:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-create-provisional-id",
          },
          body: JSON.stringify({
            courseId: provisionalCourseId,
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.course).toMatchObject({
        courseId: provisionalCourseId,
        ownerTeacherId: "teacher-kang",
        courseName: "AI Supported Mathematics Research",
      });
      expect(body.receipt).toMatchObject({
        action: "create-course",
        actorId: "teacher-kang",
        courseId: provisionalCourseId,
        traceId: "trace-course-create-provisional-id",
      });
      expect(ownershipMerges).toEqual([
        expect.objectContaining({
          ownership: expect.objectContaining({
            teacherId: "teacher-kang",
            courseIds: [provisionalCourseId],
          }),
        }),
      ]);
      expect(database.courses).toContainEqual(expect.objectContaining({ courseId: provisionalCourseId }));
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production course creation before storage or ownership writes when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-auth-provider-"));
    const externalRequests: Array<Record<string, unknown>> = [];
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const postCourse = createTeachingCoursePostHandler({
      env: createProductionCourseManagementEnvWithoutTeacherAuthProvider(dataDir),
      fetch: async (url, init) => {
        externalRequests.push({
          method: init?.method ?? "GET",
          url: String(url),
        });
        return Response.json({ error: "unexpected external storage request" }, { status: 500 });
      },
      now: new Date("2026-06-22T11:21:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: input.ownership.teacherId,
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:21:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-course-auth-provider-blocked",
          },
          body: JSON.stringify({
            name: "Production Auth Provider Blocked Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher auth provider is not production-ready.",
          traceId: "trace-production-course-auth-provider-blocked",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-auth-provider-not-production-ready",
            responsibleSession: "S12",
            actor: {
              actorId: "teacher-kang",
              role: "teacher",
            },
          }),
          authProviderContract: expect.objectContaining({
            productionStatus: "blocked",
            blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(ownershipMerges).toEqual([]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed in production when course creation would read cover assets from local JSON", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-courses-production-cover-"));
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const postCourse = createTeachingCoursePostHandler({
      env: {
        ...createExternalProductionCourseManagementEnv(dataDir),
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: join(dataDir, "course-assets"),
      },
      now: new Date("2026-06-22T11:21:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: "teacher-kang",
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:21:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-production-cover-1",
          },
          body: JSON.stringify({
            name: "Production Course With Cover",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
            coverAssetId: "course-cover-request-course-cover-1",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe(
        "Production teaching course cover asset persistence requires external storage.",
      );
      expect(database.courses).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(ownershipMerges).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when course cover asset ownership readback fails before course creation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-courses-cover-readback-"));
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      if (
        init?.method === "GET" &&
        new URL(String(url)).pathname === "/uais/teaching-course-assets/database"
      ) {
        return Response.json(
          {
            error:
              "asset backend unavailable for token test-external-storage-access-token-with-32-chars",
          },
          { status: 502 },
        );
      }

      return Response.json(
        { error: "unexpected external storage request" },
        { status: 404 },
      );
    };
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:22:30.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: "teacher-kang",
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:22:30.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-cover-readback-failed",
          },
          body: JSON.stringify({
            name: "Course With Cover Readback Failure",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
            coverAssetId: "course-cover-request-course-cover-1",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });
      const serializedBody = JSON.stringify(body);

      expect(response.status, serializedBody).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-course-cover-readback-failed",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "Teaching course cover asset ownership check failed.",
          traceId: "trace-course-cover-readback-failed",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-course-cover-asset-check-failed",
            responsibleSession: "S12",
            actor: {
              actorId: "teacher-kang",
              role: "teacher",
            },
          }),
        }),
      );
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(ownershipMerges).toEqual([]);
      expect(serializedBody).not.toContain(externalStorageAccessToken);
      expect(serializedBody).not.toContain("storage.example.test");
      expect(serializedBody).not.toContain("asset backend unavailable");
      expect(serializedBody).not.toContain("course-cover-request-course-cover-1");
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects course creation when the requested cover asset is not in the teacher asset library", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-courses-missing-cover-"));
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:22:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: "teacher-kang",
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:22:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-missing-cover-1",
          },
          body: JSON.stringify({
            name: "Course With Missing Cover",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
            coverAssetId: "course-cover-missing-provider-request",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(404);
      expect(body.error).toBe("Teaching course cover asset was not found.");
      expect(database.courses).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(ownershipMerges).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects course creation when the requested cover asset belongs to another teacher", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-courses-wrong-cover-owner-"));
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:23:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: "teacher-kang",
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:23:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      await storeTeachingCourseCoverAsset({
        dataDir,
        courseId: "teacher-draft-ai-math",
        courseName: "Course With Another Teacher Cover",
        cover: {
          provider: "qwen",
          providerRole: "image-generation",
          model: "qwen-image-2.0-pro",
          imageUrl: "https://dashscope-result/course-cover.png",
          requestId: "request-course-cover-other-teacher",
          usage: { width: 800, height: 480, imageCount: 1 },
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "generated-url-only",
          },
        },
        audit: {
          traceId: "trace-course-cover-other-teacher",
          actorId: "teacher-other",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: {
            userAgent: "UAIS course cover test",
            ipAddress: "redacted",
          },
        },
        createdAt: "2026-06-22T11:18:00.000Z",
      });

      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-wrong-cover-owner-1",
          },
          body: JSON.stringify({
            name: "Course With Another Teacher Cover",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
            coverAssetId: "course-cover-request-course-cover-other-teacher",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(403);
      expect(body.error).toBe("Teaching course cover asset ownership is required.");
      expect(body.traceId).toBe("trace-course-wrong-cover-owner-1");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-course-cover-asset-ownership-required",
          responsibleSession: "S12",
          actor: {
            actorId: "teacher-kang",
            role: "teacher",
          },
          resource: {
            coverAssetId: "course-cover-request-course-cover-other-teacher",
          },
        }),
      );
      expect(database.courses).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(ownershipMerges).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before class creation role checks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-unsafe-student-"));
    const unsafeStudentId = "/Users/example/secret-token-student-class";
    const postClass = createTeachingCourseClassPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      const response = await postClass(
        new Request(
          "https://www.uais.top/api/teaching/courses/teacher-course-unsafe-student/classes",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: createUaisAppSessionCookie(
                {
                  account: unsafeStudentId,
                  department: "学生账号",
                  displayName: "Unsafe Student",
                  role: "student",
                },
                {
                  secret: appSessionSecret,
                  sessionId: "unsafe-student-class-create-session",
                  now: new Date("2026-06-22T11:00:00.000Z"),
                },
              ),
              "x-uais-trace-id": "trace-class-create-unsafe-student-id",
            },
            body: JSON.stringify({
              className: "Unsafe Student Class",
              semester: "2026 Spring",
            }),
          },
        ),
        {
          params: Promise.resolve({
            courseId: "teacher-course-unsafe-student",
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-class-create-unsafe-student-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-class-create-unsafe-student-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates a persisted class under a teacher-owned course", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-classes-"));
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
            description: "Course draft created from the teacher workspace.",
          }),
        }),
      );

      const response = await postClass(
        new Request(
          "https://www.uais.top/api/teaching/courses/teacher-course-ai-supported-mathematics-research-20260622-112000/classes",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: createTeacherCookie(),
              "x-uais-trace-id": "trace-class-create-1",
            },
            body: JSON.stringify({
              className: "Research Methods Class 1",
              semester: "2026 Spring",
            }),
          },
        ),
        {
          params: Promise.resolve({
            courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(201);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-class-create-1");
      expect(body.traceId).toBe("trace-class-create-1");
      expect(body.classItem).toMatchObject({
        classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
        courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
        ownerTeacherId: "teacher-kang",
        className: "Research Methods Class 1",
        students: 0,
        semester: "2026 Spring",
        invitationCode: "55395057",
        joinUrl: "/courses?invite=55395057",
        createdAt: "2026-06-22T11:25:00.000Z",
        updatedAt: "2026-06-22T11:25:00.000Z",
        storagePolicy: "local-json-teaching-course-management",
        storageWritePolicy: "atomic-json-file-replace",
        responsibleSession: "S12",
      });
      expect(body.receipt).toMatchObject({
        action: "create-class",
        actorId: "teacher-kang",
        courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
        classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
        traceId: "trace-class-create-1",
      });
      expect(database.classes).toContainEqual(expect.objectContaining(body.classItem));
      expect(database.courses).toContainEqual(
        expect.objectContaining({
          courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
          updatedAt: "2026-06-22T11:25:00.000Z",
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
        }),
      );
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "create-class",
          actorId: "teacher-kang",
          courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
          classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
          traceId: "trace-class-create-1",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate signed class creation before class writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-duplicate-"));
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const classUrl = `https://www.uais.top/api/teaching/courses/${courseId}/classes`;

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
            description: "Course draft created from the teacher workspace.",
          }),
        }),
      );

      const firstResponse = await postClass(
        new Request(classUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-class-create-original",
          },
          body: JSON.stringify({
            className: "Research Methods Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      const duplicateResponse = await postClass(
        new Request(classUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-class-create-duplicate",
          },
          body: JSON.stringify({
            className: "  research   methods class 1  ",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      const duplicateBody = await duplicateResponse.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(firstResponse.status).toBe(201);
      expect(duplicateResponse.status).toBe(409);
      expect(duplicateResponse.headers.get("x-uais-trace-id")).toBe(
        "trace-class-create-duplicate",
      );
      expect(duplicateBody).toMatchObject({
        error: "Teaching class already exists.",
        traceId: "trace-class-create-duplicate",
      });
      expect(database.classes.filter((classItem) => classItem.courseId === courseId)).toHaveLength(1);
      expect(database.classes[0]).toMatchObject({
        classId: `${courseId}-class-1`,
        className: "Research Methods Class 1",
        semester: "2026 Spring",
      });
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "create-class",
          classId: `${courseId}-class-1`,
          traceId: "trace-class-create-original",
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          traceId: "trace-class-create-duplicate",
        }),
      );
      expectNoLocalOrSecretValues(duplicateBody, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed class create actor ids before class writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-unsafe-actor-id-"));
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const unsafeActorId = "/Users/example/secret-token-class-teacher";
    const unsafeCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-class-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      const courseResponse = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      expect(courseResponse.status).toBe(201);

      const response = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: unsafeCookie,
            "x-uais-trace-id": "trace-class-create-unsafe-actor-id",
          },
          body: JSON.stringify({
            className: "Unsafe Actor Class",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-class-create-unsafe-actor-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-class-create-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-class-teacher");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.courses).toHaveLength(1);
      expect(database.classes).toEqual([]);
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({ action: "create-class" }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed class create session ids before class writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-unsafe-session-id-"));
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const unsafeSessionId = "/Users/example/secret-token-class-session";
    const unsafeCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      const courseResponse = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      expect(courseResponse.status).toBe(201);

      const response = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: unsafeCookie,
            "x-uais-trace-id": "trace-class-create-unsafe-session-id",
          },
          body: JSON.stringify({
            className: "Unsafe Session Class",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-class-create-unsafe-session-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-class-create-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-class-session");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.courses).toHaveLength(1);
      expect(database.classes).toEqual([]);
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({ action: "create-class" }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production class creation before storage writes when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-auth-provider-"));
    const externalRequests: Array<Record<string, unknown>> = [];
    const postClass = createTeachingCourseClassPostHandler({
      env: createProductionCourseManagementEnvWithoutTeacherAuthProvider(dataDir),
      fetch: async (url, init) => {
        externalRequests.push({
          method: init?.method ?? "GET",
          url: String(url),
        });
        return Response.json({ error: "unexpected external storage request" }, { status: 500 });
      },
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      const response = await postClass(
        new Request(
          "https://www.uais.top/api/teaching/courses/teacher-course-production/classes",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: createTeacherCookie(),
              "x-uais-trace-id": "trace-production-class-auth-provider-blocked",
            },
            body: JSON.stringify({
              className: "Production Auth Provider Blocked Class",
              semester: "2026 Spring",
            }),
          },
        ),
        {
          params: Promise.resolve({ courseId: "teacher-course-production" }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher auth provider is not production-ready.",
          traceId: "trace-production-class-auth-provider-blocked",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-auth-provider-not-production-ready",
            responsibleSession: "S12",
            actor: {
              actorId: "teacher-kang",
              role: "teacher",
            },
          }),
          authProviderContract: expect.objectContaining({
            productionStatus: "blocked",
            blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns structured course-ownership denial when another teacher creates a class", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-owner-denied-"));
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );

      const response = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie("teacher-other"),
            "x-uais-trace-id": "trace-class-create-owner-denied",
          },
          body: JSON.stringify({
            className: "Unauthorized Class",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-class-create-owner-denied",
      );
      expect(body.traceId).toBe("trace-class-create-owner-denied");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-course-ownership-required",
          responsibleSession: "S12",
          actor: {
            actorId: "teacher-other",
            role: "teacher",
          },
          resource: { courseId },
        }),
      );
      expect(database.classes).toEqual([]);
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          action: "create-class",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects signed-student class creation as a role denial before writing class records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-student-create-"));
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );

      for (const [cookie, traceId] of [
        [
          createStudentCookie(studentAppSessionUser, appSessionSecret),
          "trace-student-class-create-denied",
        ],
        [
          `${createStudentCookie(studentAppSessionUser, appSessionSecret)}; ${createTeacherCookie()}`,
          "trace-mixed-student-class-create-denied",
        ],
      ] as const) {
        const response = await postClass(
          new Request(
            "https://www.uais.top/api/teaching/courses/teacher-course-ai-supported-mathematics-research-20260622-112000/classes",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                cookie,
                "x-uais-trace-id": traceId,
              },
              body: JSON.stringify({
                className: "Student Created Class",
                semester: "2026 Spring",
              }),
            },
          ),
          {
            params: Promise.resolve({
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
            }),
          },
        );
        const body = await response.json();
        const database = await readTeachingCourseManagementDatabase({ dataDir });

        expect(response.status).toBe(403);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body.traceId).toBe(traceId);
        expect(body.access).toEqual(
          expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-role-required",
            responsibleSession: "S12",
          }),
        );
        expect(database.courses).toHaveLength(1);
        expect(database.classes).toEqual([]);
        expect(database.auditEvents).toEqual([
          expect.objectContaining({
            action: "create-course",
            actorId: "teacher-kang",
          }),
        ]);
        expectNoLocalOrSecretValues(body, dataDir);
        expectNoLocalOrSecretValues(database, dataDir);
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsigned course creation before writing local records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-auth-"));
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:30:00.000Z"),
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Unsigned Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toMatch(/^trace-/);
      expect(body.traceId).toBe(response.headers.get("x-uais-trace-id"));
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "authenticated-session-required",
          responsibleSession: "S12",
        }),
      );
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects signed-student course creation as a role denial before writing local records", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-student-create-"));
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:30:00.000Z"),
    });

    try {
      for (const [cookie, traceId] of [
        [
          createStudentCookie(studentAppSessionUser, appSessionSecret),
          "trace-student-course-create-denied",
        ],
        [
          `${createStudentCookie(studentAppSessionUser, appSessionSecret)}; ${createTeacherCookie()}`,
          "trace-mixed-student-course-create-denied",
        ],
      ] as const) {
        const response = await postCourse(
          new Request("https://www.uais.top/api/teaching/courses", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie,
              "x-uais-trace-id": traceId,
            },
            body: JSON.stringify({
              name: "Student Created Course",
              instructor: "Kang Xia",
              unit: "Guangzhou University 404",
              department: "Experimental Teaching Center",
              semester: "2026 Spring",
            }),
          }),
        );
        const body = await response.json();
        const database = await readTeachingCourseManagementDatabase({ dataDir });

        expect(response.status).toBe(403);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body.traceId).toBe(traceId);
        expect(body.access).toEqual(
          expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-role-required",
            responsibleSession: "S12",
          }),
        );
        expect(database.courses).toEqual([]);
        expect(database.classes).toEqual([]);
        expect(database.auditEvents).toEqual([]);
        expectNoLocalOrSecretValues(body, dataDir);
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before course list reads", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-list-unsafe-student-"));
    const unsafeStudentId = "/Users/example/secret-token-student-list";
    const courseRoute = teachingCoursesRoute as typeof teachingCoursesRoute & {
      createTeachingCourseGetHandler?: (deps?: {
        env?: Record<string, string | undefined>;
        now?: Date;
      }) => (request: Request) => Promise<Response>;
    };

    try {
      const createGetCourses = courseRoute.createTeachingCourseGetHandler;
      expect(createGetCourses).toEqual(expect.any(Function));
      const getCourses = createGetCourses?.({
        env: {
          UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
          UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
        },
        now: new Date("2026-06-22T11:30:00.000Z"),
      });
      const response = await getCourses?.(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "GET",
          headers: {
            cookie: createUaisAppSessionCookie(
              {
                account: unsafeStudentId,
                department: "学生账号",
                displayName: "Unsafe Student",
                role: "student",
              },
              {
                secret: appSessionSecret,
                sessionId: "unsafe-student-course-list-session",
                now: new Date("2026-06-22T11:00:00.000Z"),
              },
            ),
            "x-uais-trace-id": "trace-course-list-unsafe-student-id",
          },
        }),
      );
      const body = await response?.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response?.status, JSON.stringify(body)).toBe(401);
      expect(response?.headers.get("x-uais-trace-id")).toBe(
        "trace-course-list-unsafe-student-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher or student authentication is required.",
          traceId: "trace-course-list-unsafe-student-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects deployed-production course list reads before trusting local JSON storage", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-production-list-"));
    const courseRoute = teachingCoursesRoute as typeof teachingCoursesRoute & {
      createTeachingCourseGetHandler?: (deps?: {
        env?: Record<string, string | undefined>;
        now?: Date;
      }) => (request: Request) => Promise<Response>;
    };

    try {
      const createGetCourses = courseRoute.createTeachingCourseGetHandler;
      expect(createGetCourses).toEqual(expect.any(Function));
      const getCourses = createGetCourses?.({
        env: createProductionCourseManagementEnv(dataDir),
        now: new Date("2026-06-22T11:30:00.000Z"),
      });
      const response = await getCourses?.(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "GET",
          headers: {
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-course-list-local-storage-denied",
          },
        }),
      );
      const body = await response?.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response?.status).toBe(503);
      expect(response?.headers.get("x-uais-trace-id")).toBe(
        "trace-production-course-list-local-storage-denied",
      );
      expect(body.traceId).toBe("trace-production-course-list-local-storage-denied");
      expect(body.error).toBe(productionCourseManagementError);
      expect(body.courses).toBeUndefined();
      expect(body.classes).toBeUndefined();
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production teacher course list reads before storage when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-list-auth-provider-"));
    const externalRequests: Array<Record<string, unknown>> = [];
    const courseRoute = teachingCoursesRoute as typeof teachingCoursesRoute & {
      createTeachingCourseGetHandler?: (deps?: {
        env?: Record<string, string | undefined>;
        fetch?: typeof fetch;
        now?: Date;
      }) => (request: Request) => Promise<Response>;
    };

    try {
      const createGetCourses = courseRoute.createTeachingCourseGetHandler;
      expect(createGetCourses).toEqual(expect.any(Function));
      const getCourses = createGetCourses?.({
        env: createProductionCourseManagementEnvWithoutTeacherAuthProvider(dataDir),
        fetch: async (url, init) => {
          externalRequests.push({
            method: init?.method ?? "GET",
            url: String(url),
          });
          return Response.json({ error: "unexpected external storage request" }, { status: 500 });
        },
        now: new Date("2026-06-22T11:30:00.000Z"),
      });
      const response = await getCourses?.(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "GET",
          headers: {
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-course-list-auth-provider-blocked",
          },
        }),
      );
      const body = await response?.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response?.status, JSON.stringify(body)).toBe(503);
      expect(response?.headers.get("x-uais-trace-id")).toBe(
        "trace-production-course-list-auth-provider-blocked",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher auth provider is not production-ready.",
          traceId: "trace-production-course-list-auth-provider-blocked",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-auth-provider-not-production-ready",
            responsibleSession: "S12",
            actor: {
              actorId: "teacher-kang",
              role: "teacher",
            },
          }),
          authProviderContract: expect.objectContaining({
            productionStatus: "blocked",
            blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production student course list reads before storage when app auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-student-course-list-auth-provider-"));
    const externalRequests: Array<Record<string, unknown>> = [];
    const courseRoute = teachingCoursesRoute as typeof teachingCoursesRoute & {
      createTeachingCourseGetHandler?: (deps?: {
        env?: Record<string, string | undefined>;
        fetch?: typeof fetch;
        hasTrustedAccountProvider?: boolean;
        now?: Date;
      }) => (request: Request) => Promise<Response>;
    };

    try {
      const createGetCourses = courseRoute.createTeachingCourseGetHandler;
      expect(createGetCourses).toEqual(expect.any(Function));
      const getCourses = createGetCourses?.({
        env: createExternalProductionCourseManagementEnv(dataDir),
        fetch: async (url, init) => {
          externalRequests.push({
            method: init?.method ?? "GET",
            url: String(url),
          });
          return Response.json({ error: "unexpected external storage request" }, { status: 500 });
        },
        now: new Date("2026-06-22T11:50:00.000Z"),
      });
      const response = await getCourses?.(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "GET",
          headers: {
            cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
            "x-uais-trace-id": "trace-production-student-course-list-auth-provider-blocked",
          },
        }),
      );
      const body = await response?.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response?.status, JSON.stringify(body)).toBe(503);
      expect(response?.headers.get("x-uais-trace-id")).toBe(
        "trace-production-student-course-list-auth-provider-blocked",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS app auth provider is not production-ready.",
          traceId: "trace-production-student-course-list-auth-provider-blocked",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "student-auth-provider-not-production-ready",
            responsibleSession: "S12",
            actor: {
              actorId: "Peter",
              role: "student",
            },
          }),
          authProviderContract: expect.objectContaining({
            productionStatus: "blocked",
            responsibleSession: "S12/S19",
          }),
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(appSessionSecret);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("allows production student course list reads with an env-bound trusted app auth provider", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-student-course-list-trusted-provider-"));
    const courseId = "teacher-course-external-student-course-list-20260622-115000";
    const classId = `${courseId}-class-1`;
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
    }> = [];
    const courseRoute = teachingCoursesRoute as typeof teachingCoursesRoute & {
      createTeachingCourseGetHandler?: (deps?: {
        env?: Record<string, string | undefined>;
        fetch?: typeof fetch;
        now?: Date;
      }) => (request: Request) => Promise<Response>;
    };

    try {
      const createGetCourses = courseRoute.createTeachingCourseGetHandler;
      expect(createGetCourses).toEqual(expect.any(Function));
      const getCourses = createGetCourses?.({
        env: createExternalProductionCourseManagementEnvWithAppAuthProvider(dataDir),
        fetch: async (url, init) => {
          externalRequests.push({
            method: init?.method ?? "GET",
            url: String(url),
            authorization: new Headers(init?.headers).get("authorization"),
          });
          return Response.json({
            database: {
              schemaVersion: "uais-teaching-course-management-v1",
              updatedAt: "2026-06-22T11:50:00.000Z",
              courses: [
                {
                  courseId,
                  ownerTeacherId: "teacher-kang",
                  courseName: "External Student Course List",
                  instructor: "Kang Xia",
                  unit: "Guangzhou University 404",
                  department: "Experimental Teaching Center",
                  semester: "2026 Spring",
                  status: "draft",
                  students: 1,
                  createdAt: "2026-06-22T11:20:00.000Z",
                  updatedAt: "2026-06-22T11:45:00.000Z",
                  storagePolicy: "external-redacted-teaching-course-management-snapshot",
                  storageWritePolicy: "external-optimistic-snapshot-replace",
                  responsibleSession: "S12",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "ids-only",
                  },
                },
              ],
              classes: [
                {
                  classId,
                  courseId,
                  ownerTeacherId: "teacher-kang",
                  className: "External Student Course List Class",
                  students: 1,
                  semester: "2026 Spring",
                  invitationCode: "55395057",
                  joinUrl: "/courses?invite=55395057",
                  createdAt: "2026-06-22T11:25:00.000Z",
                  updatedAt: "2026-06-22T11:45:00.000Z",
                  storagePolicy: "external-redacted-teaching-course-management-snapshot",
                  storageWritePolicy: "external-optimistic-snapshot-replace",
                  responsibleSession: "S12",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "ids-only",
                  },
                },
              ],
              memberships: [
                {
                  membershipId: `membership-${classId}-Peter`,
                  courseId,
                  classId,
                  invitationCode: "55395057",
                  studentId: "Peter",
                  studentDisplayName: "Peter",
                  membershipStatus: "approved",
                  joinedAt: "2026-06-22T11:40:00.000Z",
                  approvedAt: "2026-06-22T11:45:00.000Z",
                  approvedByTeacherId: "teacher-kang",
                  storagePolicy: "external-redacted-teaching-course-management-snapshot",
                  storageWritePolicy: "external-optimistic-snapshot-replace",
                  responsibleSession: "S12",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "ids-only",
                  },
                },
              ],
              auditEvents: [],
            },
            revision: "rev-0",
            storagePolicy: "external-redacted-teaching-course-management-snapshot",
            productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          });
        },
        now: new Date("2026-06-22T11:50:00.000Z"),
      });
      const response = await getCourses?.(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "GET",
          headers: {
            cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
            "x-uais-trace-id": "trace-production-student-course-list-trusted-provider",
          },
        }),
      );
      const body = await response?.json();

      expect(response?.status, JSON.stringify(body)).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          courses: [
            expect.objectContaining({
              courseId,
              courseName: "External Student Course List",
            }),
          ],
          classes: [
            expect.objectContaining({
              classId,
              courseId,
            }),
          ],
          memberships: [
            expect.objectContaining({
              membershipId: `membership-${classId}-Peter`,
              membershipStatus: "approved",
            }),
          ],
          receipt: expect.objectContaining({
            action: "list-student-courses",
            actorId: "Peter",
            traceId: "trace-production-student-course-list-trusted-provider",
            status: "read",
          }),
        }),
      );
      expect(externalRequests).toEqual([
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-management/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed in deployed production when external course list read lacks managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-list-db-proof-"));
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
    }> = [];
    const courseRoute = teachingCoursesRoute as typeof teachingCoursesRoute & {
      createTeachingCourseGetHandler?: (deps?: {
        env?: Record<string, string | undefined>;
        fetch?: typeof fetch;
        now?: Date;
      }) => (request: Request) => Promise<Response>;
    };

    try {
      const createGetCourses = courseRoute.createTeachingCourseGetHandler;
      expect(createGetCourses).toEqual(expect.any(Function));
      const getCourses = createGetCourses?.({
        env: createExternalProductionCourseManagementEnv(dataDir),
        fetch: async (url, init) => {
          externalRequests.push({
            method: init?.method ?? "GET",
            url: String(url),
            authorization: new Headers(init?.headers).get("authorization"),
          });
          return Response.json({
            database: {
              schemaVersion: "uais-teaching-course-management-v1",
              updatedAt: "1970-01-01T00:00:00.000Z",
              courses: [],
              classes: [],
              memberships: [],
              auditEvents: [],
            },
            revision: "rev-0",
            storagePolicy: "external-redacted-teaching-course-management-snapshot",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          });
        },
        now: new Date("2026-06-22T11:30:00.000Z"),
      });
      const response = await getCourses?.(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "GET",
          headers: {
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-course-list-db-proof",
          },
        }),
      );
      const body = await response?.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response?.status, JSON.stringify(body)).toBe(502);
      expect(body.error).toBe(
        "External teaching course management read acknowledgement is missing production database adapter evidence.",
      );
      expect(body.traceId).toBe("trace-production-course-list-db-proof");
      expect(body.courses).toBeUndefined();
      expect(body.classes).toBeUndefined();
      expect(externalRequests).toEqual([
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-management/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
      ]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects deployed-production course creation before writing local JSON", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-production-create-"));
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const postCourse = createTeachingCoursePostHandler({
      env: createProductionCourseManagementEnv(dataDir),
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: input.ownership.teacherId,
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:20:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-course-create-local-storage-denied",
          },
          body: JSON.stringify({
            name: "Production Local Storage Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-production-course-create-local-storage-denied",
      );
      expect(body.traceId).toBe("trace-production-course-create-local-storage-denied");
      expect(body.error).toBe(productionCourseManagementError);
      expect(ownershipMerges).toEqual([]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("treats deployment production markers as production before course-management local JSON writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-deployment-env-production-"));
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const postCourse = createTeachingCoursePostHandler({
      env: createDeploymentProductionCourseManagementEnv(dataDir),
      now: new Date("2026-06-22T11:21:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: input.ownership.teacherId,
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:21:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });
    const postClass = createTeachingCourseClassPostHandler({
      env: createDeploymentProductionCourseManagementEnv(dataDir),
      now: new Date("2026-06-22T11:26:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: createDeploymentProductionCourseManagementEnvWithAppAuthProvider(dataDir),
      hasTrustedAccountProvider: true,
      now: new Date("2026-06-22T11:41:00.000Z"),
    });
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env: createDeploymentProductionCourseManagementEnv(dataDir),
      now: new Date("2026-06-22T11:46:00.000Z"),
    });

    try {
      const responses = await Promise.all([
        postCourse(
          new Request("https://www.uais.top/api/teaching/courses", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: createTeacherCookie(),
              "x-uais-trace-id": "trace-deployment-course-create-local-storage-denied",
            },
            body: JSON.stringify({
              name: "Deployment Marker Course",
              instructor: "Kang Xia",
              unit: "Guangzhou University 404",
              department: "Experimental Teaching Center",
              semester: "2026 Spring",
            }),
          }),
        ),
        postClass(
          new Request(
            "https://www.uais.top/api/teaching/courses/teacher-course-deployment/classes",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                cookie: createTeacherCookie(),
                "x-uais-trace-id": "trace-deployment-class-create-local-storage-denied",
              },
              body: JSON.stringify({
                className: "Deployment Marker Class",
                semester: "2026 Spring",
              }),
            },
          ),
          {
            params: Promise.resolve({ courseId: "teacher-course-deployment" }),
          },
        ),
        postJoin(
          new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
            method: "POST",
            headers: {
              cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
              "x-uais-trace-id": "trace-deployment-invite-join-local-storage-denied",
            },
          }),
          {
            params: Promise.resolve({ code: "55395057" }),
          },
        ),
        postApprove(
          new Request(
            "https://www.uais.top/api/teaching/classes/teacher-course-deployment-class-1/memberships/membership-teacher-course-deployment-class-1-Peter/approve",
            {
              method: "POST",
              headers: {
                cookie: createTeacherCookie(),
                "x-uais-trace-id": "trace-deployment-membership-approve-local-storage-denied",
              },
            },
          ),
          {
            params: Promise.resolve({
              classId: "teacher-course-deployment-class-1",
              membershipId: "membership-teacher-course-deployment-class-1-Peter",
            }),
          },
        ),
      ]);
      const bodies = await Promise.all(responses.map((response) => response.json()));
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(responses.map((response) => response.status)).toEqual([503, 503, 503, 503]);
      expect(responses.map((response) => response.headers.get("x-uais-trace-id"))).toEqual([
        "trace-deployment-course-create-local-storage-denied",
        "trace-deployment-class-create-local-storage-denied",
        "trace-deployment-invite-join-local-storage-denied",
        "trace-deployment-membership-approve-local-storage-denied",
      ]);
      expect(bodies.map((body) => body.error)).toEqual([
        productionCourseManagementError,
        productionCourseManagementError,
        productionCourseManagementError,
        productionCourseManagementError,
      ]);
      expect(ownershipMerges).toEqual([]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(bodies, dataDir);
      expect(JSON.stringify(bodies)).not.toContain(appAuthProviderToken);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects deployed-production course creation before external writes when ownership merge would use local JSON", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-production-ownership-"));
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const pathname = new URL(String(url)).pathname;

      if (init?.method === "GET" && pathname === "/uais/teaching-course-management/database") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "1970-01-01T00:00:00.000Z",
            courses: [],
            classes: [],
            memberships: [],
            auditEvents: [],
          },
          revision: "rev-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-management/database") {
        return Response.json({
          status: "persisted",
          revision: "rev-1",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postCourse = createTeachingCoursePostHandler({
      env: {
        ...createExternalProductionCourseManagementEnv(dataDir),
        UAIS_TEACHER_AI_OWNERSHIP_DIR: join(dataDir, "teacher-ai-ownership"),
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:20:00.000Z"),
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-course-ownership-local-denied",
          },
          body: JSON.stringify({
            name: "Production Ownership Local Fallback Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });
      const ownershipEntries = await readdir(join(dataDir, "teacher-ai-ownership")).catch(
        () => [],
      );

      expect(response.status).toBe(503);
      expect(body.error).toBe(
        "Production teacher AI ownership persistence requires external storage.",
      );
      expect(body.course).toBeUndefined();
      expect(body.receipt).toBeUndefined();
      expect(externalRequests).toEqual([]);
      expect(ownershipEntries).toEqual([]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("uses external course management storage for deployed-production course creation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-production-external-"));
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });
      const pathname = new URL(String(url)).pathname;

      if (init?.method === "GET" && pathname === "/uais/teaching-course-management/database") {
        return new Response(
          JSON.stringify({
            database: {
              schemaVersion: "uais-teaching-course-management-v1",
              updatedAt: "1970-01-01T00:00:00.000Z",
              courses: [],
              classes: [],
              memberships: [],
              auditEvents: [],
            },
            revision: "rev-0",
            storagePolicy: "external-redacted-teaching-course-management-snapshot",
            productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-management/database") {
        return new Response(
          JSON.stringify({
            status: "persisted",
            revision: "rev-1",
            storagePolicy: "external-redacted-teaching-course-management-snapshot",
            storageWritePolicy: "external-optimistic-snapshot-replace",
            productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ error: "unexpected external request" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    };
    const postCourse = createTeachingCoursePostHandler({
      env: createExternalProductionCourseManagementEnv(dataDir),
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: input.ownership.teacherId,
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:20:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-course-create-external-storage",
          },
          body: JSON.stringify({
            name: "External Storage Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.course).toMatchObject({
        courseId: "teacher-course-external-storage-course-20260622-112000",
        ownerTeacherId: "teacher-kang",
        storagePolicy: "external-redacted-teaching-course-management-snapshot",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      });
      expect(body.receipt).toMatchObject({
        action: "create-course",
        actorId: "teacher-kang",
        courseId: "teacher-course-external-storage-course-20260622-112000",
        status: "persisted",
        storagePolicy: "external-redacted-teaching-course-management-snapshot",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      });
      expect(ownershipMerges).toEqual([
        expect.objectContaining({
          ownership: expect.objectContaining({
            teacherId: "teacher-kang",
            courseIds: ["teacher-course-external-storage-course-20260622-112000"],
          }),
        }),
      ]);
      expect(externalRequests).toEqual([
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-management/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
        {
          method: "PUT",
          url: "https://storage.example.test/uais/teaching-course-management/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
          body: expect.objectContaining({
            action: "replace-teaching-course-management-database",
            expectedRevision: "rev-0",
            database: expect.objectContaining({
              courses: [
                expect.objectContaining({
                  courseId: "teacher-course-external-storage-course-20260622-112000",
                  ownerTeacherId: "teacher-kang",
                  storagePolicy: "external-redacted-teaching-course-management-snapshot",
                }),
              ],
              auditEvents: [
                expect.objectContaining({
                  action: "create-course",
                  traceId: "trace-production-course-create-external-storage",
                  storagePolicy:
                    "external-redacted-teaching-course-management-audit-log",
                }),
              ],
            }),
          }),
        },
      ]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed in deployed production when course management persistence acknowledgement lacks managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-production-external-db-proof-"));
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });
      const pathname = new URL(String(url)).pathname;

      if (init?.method === "GET" && pathname === "/uais/teaching-course-management/database") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: "1970-01-01T00:00:00.000Z",
            courses: [],
            classes: [],
            memberships: [],
            auditEvents: [],
          },
          revision: "rev-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-management/database") {
        return Response.json({
          status: "persisted",
          revision: "rev-1",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postCourse = createTeachingCoursePostHandler({
      env: createExternalProductionCourseManagementEnv(dataDir),
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: input.ownership.teacherId,
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:20:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-course-create-db-proof",
          },
          body: JSON.stringify({
            name: "External Storage Course Without DB Proof",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(body.error).toBe(
        "External teaching course management persistence acknowledgement is missing production database adapter evidence.",
      );
      expect(ownershipMerges).toEqual([]);
      expect(externalRequests.map((request) => `${request.method} ${request.url}`)).toEqual([
        "GET https://storage.example.test/uais/teaching-course-management/database",
        "PUT https://storage.example.test/uais/teaching-course-management/database",
      ]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("retries deployed-production course creation after an external snapshot revision conflict", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-production-retry-"));
    const concurrentCourse = {
      courseId: "teacher-course-concurrent-course-20260622-111900",
      ownerTeacherId: "teacher-kang",
      courseName: "Concurrent Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
      status: "draft",
      students: 0,
      createdAt: "2026-06-22T11:19:00.000Z",
      updatedAt: "2026-06-22T11:19:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });
      const pathname = new URL(String(url)).pathname;
      const requestNumber = externalRequests.length;

      if (init?.method === "GET" && pathname === "/uais/teaching-course-management/database") {
        return Response.json({
          database:
            requestNumber === 3
              ? {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "2026-06-22T11:19:00.000Z",
                  courses: [concurrentCourse],
                  classes: [],
                  memberships: [],
                  auditEvents: [],
                }
              : {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "1970-01-01T00:00:00.000Z",
                  courses: [],
                  classes: [],
                  memberships: [],
                  auditEvents: [],
          },
          revision: requestNumber === 3 ? "rev-1" : "rev-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-management/database") {
        if (requestNumber === 2) {
          return Response.json(
            { error: "Teaching course management snapshot revision mismatch." },
            { status: 409 },
          );
        }

        return Response.json({
          status: "persisted",
          revision: "rev-2",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postCourse = createTeachingCoursePostHandler({
      env: createExternalProductionCourseManagementEnv(dataDir),
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => ({
        teacherId: input.ownership.teacherId,
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-course-create-revision-retry",
          },
          body: JSON.stringify({
            name: "Revision Retry Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.course).toMatchObject({
        courseId: "teacher-course-revision-retry-course-20260622-112000",
        storagePolicy: "external-redacted-teaching-course-management-snapshot",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      });
      expect(externalRequests.map((request) => request.method)).toEqual([
        "GET",
        "PUT",
        "GET",
        "PUT",
      ]);
      expect(externalRequests[1]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-0",
        }),
      );
      expect(externalRequests[3]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-1",
          database: expect.objectContaining({
            courses: expect.arrayContaining([
              expect.objectContaining({
                courseId: "teacher-course-concurrent-course-20260622-111900",
              }),
              expect.objectContaining({
                courseId: "teacher-course-revision-retry-course-20260622-112000",
              }),
            ]),
          }),
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("uses external cover asset storage for deployed-production course creation with a generated cover", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-production-external-cover-"));
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const ownershipMerges: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });
      const pathname = new URL(String(url)).pathname;

      if (init?.method === "GET" && pathname === "/uais/teaching-course-assets/database") {
        return new Response(
          JSON.stringify({
            database: {
              schemaVersion: "uais-teaching-course-assets-v1",
              updatedAt: "2026-06-22T11:18:00.000Z",
              assets: [
                {
                  assetId: "course-cover-request-course-cover-1",
                  assetType: "course-cover",
                  courseId: "teacher-draft-ai-supported-mathematics-research",
                  courseName: "AI Supported Mathematics Research",
                  provider: "qwen",
                  providerRole: "image-generation",
                  imageUrl: "https://dashscope-result/course-cover.png",
                  model: "qwen-image-2.0-pro",
                  providerRequestId: "request-course-cover-1",
                  createdAt: "2026-06-22T11:18:00.000Z",
                  storagePolicy: "external-redacted-teaching-course-cover-assets",
                  storageWritePolicy: "external-optimistic-snapshot-replace",
                  responsibleSession: "S12",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "generated-url-only",
                  },
                },
              ],
              auditEvents: [
                {
                  auditId: "audit-course-cover-course-cover-request-course-cover-1-20260622-111800",
                  traceId: "trace-course-cover-before-create-external-1",
                  eventType: "teaching-course-cover.generated",
                  actorId: "teacher-kang",
                  actorRole: "teacher",
                  authMode: "signed-teacher-session",
                  courseId: "teacher-draft-ai-supported-mathematics-research",
                  assetId: "course-cover-request-course-cover-1",
                  providerRequestId: "request-course-cover-1",
                  requestSource: {
                    userAgent: "UAIS course cover external test",
                    ipAddress: "redacted",
                  },
                  createdAt: "2026-06-22T11:18:00.000Z",
                  storagePolicy: "external-redacted-teaching-course-cover-audit-log",
                  redaction: {
                    secrets: "omitted",
                    localFiles: "omitted",
                    assets: "generated-url-only",
                  },
                },
              ],
            },
            revision: "rev-cover-1",
            storagePolicy: "external-redacted-teaching-course-cover-assets",
            productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (init?.method === "GET" && pathname === "/uais/teaching-course-management/database") {
        return new Response(
          JSON.stringify({
            database: {
              schemaVersion: "uais-teaching-course-management-v1",
              updatedAt: "1970-01-01T00:00:00.000Z",
              courses: [],
              classes: [],
              memberships: [],
              auditEvents: [],
            },
            revision: "rev-0",
            storagePolicy: "external-redacted-teaching-course-management-snapshot",
            productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-management/database") {
        return new Response(
          JSON.stringify({
            status: "persisted",
            revision: "rev-1",
            storagePolicy: "external-redacted-teaching-course-management-snapshot",
            storageWritePolicy: "external-optimistic-snapshot-replace",
            productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ error: "unexpected external request" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    };
    const postCourse = createTeachingCoursePostHandler({
      env: {
        ...createExternalProductionCourseManagementEnv(dataDir),
        UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async (input) => {
        ownershipMerges.push(input as unknown as Record<string, unknown>);
        return {
          teacherId: input.ownership.teacherId,
          status: "merged",
          storagePolicy: "external-redacted-teacher-ai-ownership-merge",
          storageWritePolicy: "external-atomic-merge",
          responsibleSession: "S12",
          updatedAt: "2026-06-22T11:20:00.000Z",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-course-create-external-cover",
          },
          body: JSON.stringify({
            name: "External Storage Covered Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
            coverAssetId: "course-cover-request-course-cover-1",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.course).toMatchObject({
        courseId: "teacher-course-external-storage-covered-course-20260622-112000",
        coverAssetId: "course-cover-request-course-cover-1",
        storagePolicy: "external-redacted-teaching-course-management-snapshot",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      });
      expect(ownershipMerges).toEqual([
        expect.objectContaining({
          ownership: expect.objectContaining({
            teacherId: "teacher-kang",
            courseIds: ["teacher-course-external-storage-covered-course-20260622-112000"],
          }),
        }),
      ]);
      expect(externalRequests).toEqual([
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-assets/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-management/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
        {
          method: "PUT",
          url: "https://storage.example.test/uais/teaching-course-management/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
          body: expect.objectContaining({
            action: "replace-teaching-course-management-database",
            expectedRevision: "rev-0",
            database: expect.objectContaining({
              courses: [
                expect.objectContaining({
                  courseId: "teacher-course-external-storage-covered-course-20260622-112000",
                  coverAssetId: "course-cover-request-course-cover-1",
                  storagePolicy: "external-redacted-teaching-course-management-snapshot",
                }),
              ],
            }),
          }),
        },
      ]);
      expect(database.courses).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects deployed-production class creation before local JSON course lookup", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-production-create-"));
    const postClass = createTeachingCourseClassPostHandler({
      env: createProductionCourseManagementEnv(dataDir),
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      const response = await postClass(
        new Request(
          "https://www.uais.top/api/teaching/courses/teacher-course-production/classes",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: createTeacherCookie(),
              "x-uais-trace-id": "trace-production-class-create-local-storage-denied",
            },
            body: JSON.stringify({
              className: "Production Local Storage Class",
              semester: "2026 Spring",
            }),
          },
        ),
        {
          params: Promise.resolve({ courseId: "teacher-course-production" }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe(productionCourseManagementError);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("retries deployed-production class creation after an external snapshot revision conflict", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-production-retry-"));
    const courseId = "teacher-course-external-storage-course-20260622-112000";
    const persistedCourse = {
      courseId,
      ownerTeacherId: "teacher-kang",
      courseName: "External Storage Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
      status: "draft",
      students: 0,
      createdAt: "2026-06-22T11:20:00.000Z",
      updatedAt: "2026-06-22T11:20:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const concurrentClass = {
      classId: `${courseId}-class-1`,
      courseId,
      ownerTeacherId: "teacher-kang",
      className: "Concurrent Class",
      students: 0,
      semester: "2026 Spring",
      invitationCode: "55395057",
      joinUrl: "/courses?invite=55395057",
      createdAt: "2026-06-22T11:24:00.000Z",
      updatedAt: "2026-06-22T11:24:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });
      const pathname = new URL(String(url)).pathname;
      const requestNumber = externalRequests.length;

      if (init?.method === "GET" && pathname === "/uais/teaching-course-management/database") {
        return Response.json({
          database:
            requestNumber === 3
              ? {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "2026-06-22T11:24:00.000Z",
                  courses: [persistedCourse],
                  classes: [concurrentClass],
                  memberships: [],
                  auditEvents: [],
                }
              : {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "2026-06-22T11:20:00.000Z",
                  courses: [persistedCourse],
                  classes: [],
                  memberships: [],
                  auditEvents: [],
          },
          revision: requestNumber === 3 ? "rev-1" : "rev-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-management/database") {
        if (requestNumber === 2) {
          return Response.json(
            { error: "Teaching course management snapshot revision mismatch." },
            { status: 409 },
          );
        }

        return Response.json({
          status: "persisted",
          revision: "rev-2",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postClass = createTeachingCourseClassPostHandler({
      env: createExternalProductionCourseManagementEnv(dataDir),
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });

    try {
      const response = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-production-class-create-revision-retry",
          },
          body: JSON.stringify({
            className: "Retry Class",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.classItem).toMatchObject({
        classId: `${courseId}-class-2`,
        courseId,
        className: "Retry Class",
        invitationCode: "55395058",
        storagePolicy: "external-redacted-teaching-course-management-snapshot",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      });
      expect(externalRequests.map((request) => request.method)).toEqual([
        "GET",
        "PUT",
        "GET",
        "PUT",
      ]);
      expect(externalRequests[1]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-0",
        }),
      );
      expect(externalRequests[3]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-1",
          database: expect.objectContaining({
            classes: expect.arrayContaining([
              expect.objectContaining({
                classId: `${courseId}-class-1`,
              }),
              expect.objectContaining({
                classId: `${courseId}-class-2`,
                invitationCode: "55395058",
              }),
            ]),
          }),
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("retries deployed-production invite-code joins after an external snapshot revision conflict", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-join-production-retry-"));
    const courseId = "teacher-course-external-storage-course-20260622-112000";
    const classId = `${courseId}-class-1`;
    const persistedCourse = {
      courseId,
      ownerTeacherId: "teacher-kang",
      courseName: "External Storage Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
      status: "draft",
      students: 0,
      createdAt: "2026-06-22T11:20:00.000Z",
      updatedAt: "2026-06-22T11:20:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const persistedClass = {
      classId,
      courseId,
      ownerTeacherId: "teacher-kang",
      className: "External Storage Class",
      students: 0,
      semester: "2026 Spring",
      invitationCode: "55395057",
      joinUrl: "/courses?invite=55395057",
      createdAt: "2026-06-22T11:25:00.000Z",
      updatedAt: "2026-06-22T11:25:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const concurrentMembership = {
      membershipId: `membership-${classId}-Eve`,
      courseId,
      classId,
      invitationCode: "55395057",
      studentId: "Eve",
      studentDisplayName: "Eve",
      membershipStatus: "pending-teacher-review",
      joinedAt: "2026-06-22T11:39:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });
      const pathname = new URL(String(url)).pathname;
      const requestNumber = externalRequests.length;

      if (init?.method === "GET" && pathname === "/uais/teaching-course-management/database") {
        return Response.json({
          database:
            requestNumber === 3
              ? {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "2026-06-22T11:39:00.000Z",
                  courses: [persistedCourse],
                  classes: [persistedClass],
                  memberships: [concurrentMembership],
                  auditEvents: [],
                }
              : {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "2026-06-22T11:25:00.000Z",
                  courses: [persistedCourse],
                  classes: [persistedClass],
                  memberships: [],
                  auditEvents: [],
          },
          revision: requestNumber === 3 ? "rev-1" : "rev-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-management/database") {
        if (requestNumber === 2) {
          return Response.json(
            { error: "Teaching course management snapshot revision mismatch." },
            { status: 409 },
          );
        }

        return Response.json({
          status: "persisted",
          revision: "rev-2",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: createExternalProductionCourseManagementEnvWithAppAuthProvider(dataDir),
      fetch: fetchImpl,
      hasTrustedAccountProvider: true,
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      const response = await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
            "x-uais-trace-id": "trace-production-invite-join-revision-retry",
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.membership).toMatchObject({
        membershipId: `membership-${classId}-Peter`,
        courseId,
        classId,
        invitationCode: "55395057",
        studentId: "Peter",
        membershipStatus: "pending-teacher-review",
        joinedAt: "2026-06-22T11:40:00.000Z",
        storagePolicy: "external-redacted-teaching-course-management-snapshot",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      });
      expect(externalRequests.map((request) => request.method)).toEqual([
        "GET",
        "PUT",
        "GET",
        "PUT",
      ]);
      expect(externalRequests[1]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-0",
        }),
      );
      expect(externalRequests[3]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-1",
          database: expect.objectContaining({
            memberships: expect.arrayContaining([
              expect.objectContaining({
                membershipId: `membership-${classId}-Eve`,
              }),
              expect.objectContaining({
                membershipId: `membership-${classId}-Peter`,
                studentId: "Peter",
              }),
            ]),
          }),
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks deployed-production invite-code joins before storage when app auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-join-production-auth-provider-"));
    const externalRequests: Array<{
      method: string;
      url: string;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
      });
      return Response.json(
        { error: "external storage should not be reached before auth provider readiness" },
        { status: 500 },
      );
    };
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: createExternalProductionCourseManagementEnv(dataDir),
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      const response = await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
            "x-uais-trace-id": "trace-production-invite-join-auth-provider-denied",
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-production-invite-join-auth-provider-denied",
      );
      expect(body.error).toBe("UAIS app auth provider is not production-ready.");
      expect(body.traceId).toBe("trace-production-invite-join-auth-provider-denied");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "student-auth-provider-not-production-ready",
          responsibleSession: "S12",
          actor: expect.objectContaining({
            actorId: "Peter",
            role: "student",
          }),
        }),
      );
      expect(body.authProviderContract).toEqual(
        expect.objectContaining({
          productionStatus: "blocked",
          responsibleSession: "S12/S19",
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(appSessionSecret);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("retries deployed-production membership approvals after an external snapshot revision conflict", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-approve-production-retry-"));
    const courseId = "teacher-course-external-storage-course-20260622-112000";
    const classId = `${courseId}-class-1`;
    const peterMembershipId = `membership-${classId}-Peter`;
    const eveMembershipId = `membership-${classId}-Eve`;
    const persistedCourse = {
      courseId,
      ownerTeacherId: "teacher-kang",
      courseName: "External Storage Course",
      instructor: "Kang Xia",
      unit: "Guangzhou University 404",
      department: "Experimental Teaching Center",
      semester: "2026 Spring",
      status: "draft",
      students: 0,
      createdAt: "2026-06-22T11:20:00.000Z",
      updatedAt: "2026-06-22T11:20:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const persistedClass = {
      classId,
      courseId,
      ownerTeacherId: "teacher-kang",
      className: "External Storage Class",
      students: 0,
      semester: "2026 Spring",
      invitationCode: "55395057",
      joinUrl: "/courses?invite=55395057",
      createdAt: "2026-06-22T11:25:00.000Z",
      updatedAt: "2026-06-22T11:25:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const pendingPeterMembership = {
      membershipId: peterMembershipId,
      courseId,
      classId,
      invitationCode: "55395057",
      studentId: "Peter",
      studentDisplayName: "Peter",
      membershipStatus: "pending-teacher-review",
      joinedAt: "2026-06-22T11:40:00.000Z",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const concurrentlyApprovedEveMembership = {
      membershipId: eveMembershipId,
      courseId,
      classId,
      invitationCode: "55395057",
      studentId: "Eve",
      studentDisplayName: "Eve",
      membershipStatus: "approved",
      joinedAt: "2026-06-22T11:39:00.000Z",
      approvedAt: "2026-06-22T11:44:00.000Z",
      approvedByTeacherId: "teacher-kang",
      storagePolicy: "external-redacted-teaching-course-management-snapshot",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });
      const pathname = new URL(String(url)).pathname;
      const requestNumber = externalRequests.length;

      if (init?.method === "GET" && pathname === "/uais/teaching-course-management/database") {
        return Response.json({
          database:
            requestNumber === 3
              ? {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "2026-06-22T11:44:00.000Z",
                  courses: [
                    {
                      ...persistedCourse,
                      students: 1,
                      updatedAt: "2026-06-22T11:44:00.000Z",
                    },
                  ],
                  classes: [
                    {
                      ...persistedClass,
                      students: 1,
                      updatedAt: "2026-06-22T11:44:00.000Z",
                    },
                  ],
                  memberships: [pendingPeterMembership, concurrentlyApprovedEveMembership],
                  auditEvents: [],
                }
              : {
                  schemaVersion: "uais-teaching-course-management-v1",
                  updatedAt: "2026-06-22T11:40:00.000Z",
                  courses: [persistedCourse],
                  classes: [persistedClass],
                  memberships: [pendingPeterMembership],
                  auditEvents: [],
          },
          revision: requestNumber === 3 ? "rev-1" : "rev-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-management/database") {
        if (requestNumber === 2) {
          return Response.json(
            { error: "Teaching course management snapshot revision mismatch." },
            { status: 409 },
          );
        }

        return Response.json({
          status: "persisted",
          revision: "rev-2",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env: createExternalProductionCourseManagementEnv(dataDir),
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      const response = await postApprove(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classId}/memberships/${peterMembershipId}/approve`,
          {
            method: "POST",
            headers: {
              cookie: createTeacherCookie(),
              "x-uais-trace-id": "trace-production-membership-approve-revision-retry",
            },
          },
        ),
        {
          params: Promise.resolve({
            classId,
            membershipId: peterMembershipId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.membership).toMatchObject({
        membershipId: peterMembershipId,
        courseId,
        classId,
        studentId: "Peter",
        membershipStatus: "approved",
        approvedAt: "2026-06-22T11:45:00.000Z",
        approvedByTeacherId: "teacher-kang",
      });
      expect(body.classItem).toMatchObject({
        classId,
        students: 2,
        updatedAt: "2026-06-22T11:45:00.000Z",
      });
      expect(body.course).toMatchObject({
        courseId,
        students: 2,
        updatedAt: "2026-06-22T11:45:00.000Z",
      });
      expect(externalRequests.map((request) => request.method)).toEqual([
        "GET",
        "PUT",
        "GET",
        "PUT",
      ]);
      expect(externalRequests[1]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-0",
        }),
      );
      expect(externalRequests[3]?.body).toEqual(
        expect.objectContaining({
          expectedRevision: "rev-1",
          database: expect.objectContaining({
            courses: expect.arrayContaining([
              expect.objectContaining({
                courseId,
                students: 2,
              }),
            ]),
            classes: expect.arrayContaining([
              expect.objectContaining({
                classId,
                students: 2,
              }),
            ]),
            memberships: expect.arrayContaining([
              expect.objectContaining({
                membershipId: eveMembershipId,
                membershipStatus: "approved",
              }),
              expect.objectContaining({
                membershipId: peterMembershipId,
                membershipStatus: "approved",
              }),
            ]),
          }),
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects deployed-production invite-code joins before local JSON invite lookup", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-join-production-create-"));
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: createProductionCourseManagementEnvWithAppAuthProvider(dataDir),
      hasTrustedAccountProvider: true,
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      const response = await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
            "x-uais-trace-id": "trace-production-invite-join-local-storage-denied",
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe(productionCourseManagementError);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects deployed-production membership approval before local JSON membership lookup", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-approve-production-create-"));
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env: createProductionCourseManagementEnv(dataDir),
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      const response = await postApprove(
        new Request(
          "https://www.uais.top/api/teaching/classes/teacher-course-production-class-1/memberships/membership-teacher-course-production-class-1-Peter/approve",
          {
            method: "POST",
            headers: {
              cookie: createTeacherCookie(),
              "x-uais-trace-id": "trace-production-membership-approve-local-storage-denied",
            },
          },
        ),
        {
          params: Promise.resolve({
            classId: "teacher-course-production-class-1",
            membershipId: "membership-teacher-course-production-class-1-Peter",
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe(productionCourseManagementError);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rolls back the local course write when ownership merge fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-rollback-"));
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:35:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => {
        throw new Error("ownership merge unavailable");
      },
    });

    try {
      const response = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-course-rollback-1",
          },
          body: JSON.stringify({
            name: "Rollback Course",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe("Teaching course ownership merge failed.");
      expect(body.partialFailure).toEqual(
        expect.objectContaining({
          status: "course-created-ownership-merge-failed",
          failedStep: "teacher-ai-ownership-merge",
          courseId: "teacher-course-rollback-course-20260622-113500",
          rollback: expect.objectContaining({
            status: "rolled-back",
            action: "rollback-teaching-course-creation",
            courseId: "teacher-course-rollback-course-20260622-113500",
            traceId: "trace-course-rollback-1",
            rolledBackAt: "2026-06-22T11:35:00.000Z",
            responsibleSession: "S12",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
          recoveryAction: "retry-course-create-after-ownership-merge-recovers",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.auditEvents).toEqual([
        expect.objectContaining({
          action: "create-course",
          actorId: "teacher-kang",
          courseId: "teacher-course-rollback-course-20260622-113500",
          traceId: "trace-course-rollback-1",
          rollbackStatus: "rolled-back",
        }),
      ]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("lets a signed-in student redeem a class invite code into a pending membership record", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-invite-join-"));
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      await postClass(
        new Request(
          "https://www.uais.top/api/teaching/courses/teacher-course-ai-supported-mathematics-research-20260622-112000/classes",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: createTeacherCookie(),
            },
            body: JSON.stringify({
              className: "Research Methods Class 1",
              semester: "2026 Spring",
            }),
          },
        ),
        {
          params: Promise.resolve({
            courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
          }),
        },
      );

      const response = await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(),
            "x-uais-trace-id": "trace-invite-join-1",
          },
        }),
        {
          params: Promise.resolve({
            code: "55395057",
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(201);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-invite-join-1");
      expect(body.traceId).toBe("trace-invite-join-1");
      expect(body.membership).toMatchObject({
        membershipId:
          "membership-teacher-course-ai-supported-mathematics-research-20260622-112000-class-1-Peter",
        courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
        classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
        invitationCode: "55395057",
        studentId: "Peter",
        studentDisplayName: "Peter",
        membershipStatus: "pending-teacher-review",
        joinedAt: "2026-06-22T11:40:00.000Z",
        storagePolicy: "local-json-teaching-course-management",
        storageWritePolicy: "atomic-json-file-replace",
        responsibleSession: "S12",
      });
      expect(body.receipt).toMatchObject({
        action: "join-class-by-invite",
        actorId: "Peter",
        courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
        classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
        traceId: "trace-invite-join-1",
        authSession: {
          sessionId: "Peter-course-management-session",
          authenticatedAt: "2026-06-22T11:00:00.000Z",
          expiresAt: "2026-06-22T19:00:00.000Z",
        },
      });
      expect(database.memberships).toContainEqual(expect.objectContaining(body.membership));
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "join-class-by-invite",
          actorId: "Peter",
          courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
          classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
          traceId: "trace-invite-join-1",
          authMode: "app-student-session",
          authSession: {
            sessionId: "Peter-course-management-session",
            authenticatedAt: "2026-06-22T11:00:00.000Z",
            expiresAt: "2026-06-22T19:00:00.000Z",
          },
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("creates globally unique class invite codes so joins cannot cross courses", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-invite-global-unique-"));
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env,
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      const firstCourseResponse = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const secondCourseResponse = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Writing Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const firstCourseBody = await firstCourseResponse.json();
      const secondCourseBody = await secondCourseResponse.json();
      const firstCourseId = firstCourseBody.course.courseId;
      const secondCourseId = secondCourseBody.course.courseId;

      const firstClassResponse = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${firstCourseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            className: "Research Methods Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId: firstCourseId }),
        },
      );
      const secondClassResponse = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${secondCourseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            className: "Writing Research Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId: secondCourseId }),
        },
      );
      const firstClassBody = await firstClassResponse.json();
      const secondClassBody = await secondClassResponse.json();
      const firstInvitationCode = firstClassBody.classItem.invitationCode;
      const secondInvitationCode = secondClassBody.classItem.invitationCode;

      expect(firstInvitationCode).toMatch(/^\d{8}$/);
      expect(secondInvitationCode).toMatch(/^\d{8}$/);
      expect(new Set([firstInvitationCode, secondInvitationCode]).size).toBe(2);

      const joinResponse = await postJoin(
        new Request(
          `https://www.uais.top/api/teaching/invite-codes/${secondInvitationCode}/join`,
          {
            method: "POST",
            headers: {
              cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
              "x-uais-trace-id": "trace-invite-global-unique-second-course",
            },
          },
        ),
        {
          params: Promise.resolve({ code: secondInvitationCode }),
        },
      );
      const joinBody = await joinResponse.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(joinResponse.status, JSON.stringify(joinBody)).toBe(201);
      expect(joinBody.membership).toMatchObject({
        courseId: secondCourseId,
        classId: secondClassBody.classItem.classId,
        invitationCode: secondInvitationCode,
        studentId: "Peter",
        membershipStatus: "pending-teacher-review",
      });
      expect(database.memberships).toContainEqual(expect.objectContaining(joinBody.membership));
      expect(database.memberships).not.toContainEqual(
        expect.objectContaining({
          courseId: firstCourseId,
          studentId: "Peter",
        }),
      );
      expectNoLocalOrSecretValues(joinBody, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before invite lookup or membership writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-invite-unsafe-student-id-"));
    const unsafeStudentId = "/Users/example/secret-token-student";
    const cookie = createUaisAppSessionCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "unsafe-student-invite-join-session",
        now: new Date("2026-06-22T11:00:00.000Z"),
      },
    );
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      const response = await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-invite-join-unsafe-student-id",
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-invite-join-unsafe-student-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS student authentication is required.",
          traceId: "trace-invite-join-unsafe-student-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "student-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns structured invite-code not-found denial before writing a membership", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-invite-not-found-"));
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      const response = await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/00000000/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(),
            "x-uais-trace-id": "trace-invite-code-not-found",
          },
        }),
        {
          params: Promise.resolve({ code: "00000000" }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(404);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-invite-code-not-found");
      expect(body.error).toBe("Teaching class invite code was not found.");
      expect(body.traceId).toBe("trace-invite-code-not-found");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "class-invite-code-not-found",
          responsibleSession: "S12",
          actor: expect.objectContaining({
            actorId: "Peter",
            role: "student",
          }),
          resource: { invitationCode: "00000000" },
        }),
      );
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          action: "join-class-by-invite",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects a second invite-code membership for the same student and course", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-invite-join-same-course-"));
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env,
      now: new Date("2026-06-22T11:40:00.000Z"),
    });

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );

      for (const className of ["Research Methods Class 1", "Research Methods Class 2"]) {
        const classResponse = await postClass(
          new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: createTeacherCookie(),
            },
            body: JSON.stringify({
              className,
              semester: "2026 Spring",
            }),
          }),
          {
            params: Promise.resolve({ courseId }),
          },
        );
        expect(classResponse.status).toBe(201);
      }

      const classDatabase = await readTeachingCourseManagementDatabase({ dataDir });
      const firstClass = classDatabase.classes.find(
        (classItem) => classItem.className === "Research Methods Class 1",
      );
      const secondClass = classDatabase.classes.find(
        (classItem) => classItem.className === "Research Methods Class 2",
      );
      expect(firstClass?.invitationCode).toMatch(/^\d{8}$/);
      expect(secondClass?.invitationCode).toMatch(/^\d{8}$/);

      const firstJoinResponse = await postJoin(
        new Request(
          `https://www.uais.top/api/teaching/invite-codes/${firstClass?.invitationCode}/join`,
          {
            method: "POST",
            headers: {
              cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
              "x-uais-trace-id": "trace-invite-join-first-course-class",
            },
          },
        ),
        {
          params: Promise.resolve({ code: firstClass?.invitationCode ?? "" }),
        },
      );
      expect(firstJoinResponse.status).toBe(201);

      const secondJoinResponse = await postJoin(
        new Request(
          `https://www.uais.top/api/teaching/invite-codes/${secondClass?.invitationCode}/join`,
          {
            method: "POST",
            headers: {
              cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
              "x-uais-trace-id": "trace-invite-join-second-course-class-denied",
            },
          },
        ),
        {
          params: Promise.resolve({ code: secondClass?.invitationCode ?? "" }),
        },
      );
      const secondJoinBody = await secondJoinResponse.json();
      const joinedDatabase = await readTeachingCourseManagementDatabase({ dataDir });

      expect(secondJoinResponse.status, JSON.stringify(secondJoinBody)).toBe(409);
      expect(secondJoinBody.error).toBe(
        "Student already has a membership in this teaching course.",
      );
      expect(secondJoinBody.traceId).toBe("trace-invite-join-second-course-class-denied");
      expect(secondJoinBody.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "student-course-membership-already-exists",
          responsibleSession: "S12",
          actor: expect.objectContaining({
            actorId: "Peter",
            role: "student",
          }),
          resource: { invitationCode: secondClass?.invitationCode },
        }),
      );
      expect(joinedDatabase.memberships).toHaveLength(1);
      expect(joinedDatabase.memberships).toContainEqual(
        expect.objectContaining({
          classId: firstClass?.classId,
          courseId,
          studentId: "Peter",
          membershipStatus: "pending-teacher-review",
        }),
      );
      expect(joinedDatabase.memberships).not.toContainEqual(
        expect.objectContaining({
          classId: secondClass?.classId,
          courseId,
          studentId: "Peter",
        }),
      );
      expect(
        joinedDatabase.auditEvents.filter(
          (auditEvent) => auditEvent.action === "join-class-by-invite",
        ),
      ).toHaveLength(1);
      expect(joinedDatabase.auditEvents).not.toContainEqual(
        expect.objectContaining({
          action: "join-class-by-invite",
          traceId: "trace-invite-join-second-course-class-denied",
        }),
      );
      expectNoLocalOrSecretValues(secondJoinBody, dataDir);
      expectNoLocalOrSecretValues(joinedDatabase, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects signed-student membership approvals as role denials before approving pending memberships", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-membership-student-approve-"));
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const classId = `${courseId}-class-1`;
    const membershipId = `membership-${classId}-Peter`;
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env,
      now: new Date("2026-06-22T11:40:00.000Z"),
    });
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env,
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            className: "Research Methods Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );

      const deniedBodies: unknown[] = [];
      for (const [cookie, traceId] of [
        [
          createStudentCookie(studentAppSessionUser, appSessionSecret),
          "trace-student-membership-approve-denied",
        ],
        [
          `${createStudentCookie(studentAppSessionUser, appSessionSecret)}; ${createTeacherCookie()}`,
          "trace-mixed-student-membership-approve-denied",
        ],
      ] as const) {
        const response = await postApprove(
          new Request(
            `https://www.uais.top/api/teaching/classes/${classId}/memberships/${membershipId}/approve`,
            {
              method: "POST",
              headers: {
                cookie,
                "x-uais-trace-id": traceId,
              },
            },
          ),
          {
            params: Promise.resolve({
              classId,
              membershipId,
            }),
          },
        );
        const body = await response.json();

        expect(response.status, JSON.stringify(body)).toBe(403);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body.traceId).toBe(traceId);
        expect(body.access).toEqual(
          expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-role-required",
            responsibleSession: "S12",
          }),
        );
        deniedBodies.push(body);
      }
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(database.memberships).toContainEqual(
        expect.objectContaining({
          membershipId,
          membershipStatus: "pending-teacher-review",
          studentId: "Peter",
        }),
      );
      expect(database.memberships).not.toContainEqual(
        expect.objectContaining({
          membershipId,
          membershipStatus: "approved",
        }),
      );
      expect(database.classes).toContainEqual(
        expect.objectContaining({
          classId,
          students: 0,
        }),
      );
      expect(database.courses).toContainEqual(
        expect.objectContaining({
          courseId,
          students: 0,
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          action: "approve-class-membership",
        }),
      );
      for (const deniedBody of deniedBodies) {
        expectNoLocalOrSecretValues(deniedBody, dataDir);
      }
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns structured course-ownership denial when another signed teacher approves a pending membership", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-membership-owner-approve-"));
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const classId = `${courseId}-class-1`;
    const membershipId = `membership-${classId}-Peter`;
    const courseManagementEnv = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env: courseManagementEnv,
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            className: "Research Methods Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(),
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );

      const response = await postApprove(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classId}/memberships/${membershipId}/approve`,
          {
            method: "POST",
            headers: {
              cookie: createTeacherCookie("teacher-other"),
              "x-uais-trace-id": "trace-membership-approve-owner-denied",
            },
          },
        ),
        {
          params: Promise.resolve({
            classId,
            membershipId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(403);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-membership-approve-owner-denied",
      );
      expect(body.traceId).toBe("trace-membership-approve-owner-denied");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-course-ownership-required",
          actor: { actorId: "teacher-other", role: "teacher" },
          resource: { classId, membershipId },
          responsibleSession: "S12",
        }),
      );
      expect(database.memberships).toContainEqual(
        expect.objectContaining({
          membershipId,
          membershipStatus: "pending-teacher-review",
          studentId: "Peter",
        }),
      );
      expect(database.memberships).not.toContainEqual(
        expect.objectContaining({
          membershipId,
          membershipStatus: "approved",
        }),
      );
      expect(database.classes).toContainEqual(
        expect.objectContaining({
          classId,
          students: 0,
        }),
      );
      expect(database.courses).toContainEqual(
        expect.objectContaining({
          courseId,
          students: 0,
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({
          action: "approve-class-membership",
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before membership approval role checks", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "uais-teaching-membership-approve-unsafe-student-id-"),
    );
    const unsafeStudentId = "/Users/example/secret-token-membership-approve-student";
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const classId = `${courseId}-class-1`;
    const membershipId = `membership-${classId}-Peter`;
    const studentCookie = createStudentCookie(
      {
        account: unsafeStudentId,
        department: "学生账号",
        displayName: "Unsafe Student",
        role: "student",
      },
      appSessionSecret,
    );
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      const response = await postApprove(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classId}/memberships/${membershipId}/approve`,
          {
            method: "POST",
            headers: {
              cookie: studentCookie,
              "x-uais-trace-id": "trace-membership-approve-unsafe-student-id",
            },
          },
        ),
        {
          params: Promise.resolve({
            classId,
            membershipId,
          }),
        },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-membership-approve-unsafe-student-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-membership-approve-unsafe-student-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain(membershipId);
      expect(await readdir(dataDir)).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed membership approval actor ids before approval writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-membership-unsafe-actor-id-"));
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const classId = `${courseId}-class-1`;
    const membershipId = `membership-${classId}-Peter`;
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const unsafeActorId = "/Users/example/secret-token-membership-teacher";
    const unsafeCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-membership-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env,
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            className: "Research Methods Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(),
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );

      const response = await postApprove(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classId}/memberships/${membershipId}/approve`,
          {
            method: "POST",
            headers: {
              cookie: unsafeCookie,
              "x-uais-trace-id": "trace-membership-approve-unsafe-actor-id",
            },
          },
        ),
        {
          params: Promise.resolve({
            classId,
            membershipId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-membership-approve-unsafe-actor-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-membership-approve-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-membership-teacher");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.memberships).toContainEqual(
        expect.objectContaining({
          membershipId,
          membershipStatus: "pending-teacher-review",
        }),
      );
      expect(database.memberships).not.toContainEqual(
        expect.objectContaining({
          membershipId,
          membershipStatus: "approved",
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({ action: "approve-class-membership" }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed membership approval session ids before approval writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-membership-unsafe-session-id-"));
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const classId = `${courseId}-class-1`;
    const membershipId = `membership-${classId}-Peter`;
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
    };
    const unsafeSessionId = "/Users/example/secret-token-membership-session";
    const unsafeCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T13:00:00.000Z",
      },
    });
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env,
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            className: "Research Methods Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(),
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );

      const response = await postApprove(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classId}/memberships/${membershipId}/approve`,
          {
            method: "POST",
            headers: {
              cookie: unsafeCookie,
              "x-uais-trace-id": "trace-membership-approve-unsafe-session-id",
            },
          },
        ),
        {
          params: Promise.resolve({
            classId,
            membershipId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-membership-approve-unsafe-session-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-membership-approve-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(JSON.stringify(body)).not.toContain("/Users/example/secret-token-membership-session");
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(database.memberships).toContainEqual(
        expect.objectContaining({
          membershipId,
          membershipStatus: "pending-teacher-review",
        }),
      );
      expect(database.memberships).not.toContainEqual(
        expect.objectContaining({
          membershipId,
          membershipStatus: "approved",
        }),
      );
      expect(database.auditEvents).not.toContainEqual(
        expect.objectContaining({ action: "approve-class-membership" }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("lets the owning teacher approve a pending invite-code membership", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-membership-approve-"));
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const classId = `${courseId}-class-1`;
    const membershipId = `membership-${classId}-Peter`;
    const postCourse = createTeachingCoursePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
      now: new Date("2026-06-22T11:40:00.000Z"),
    });
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env: {
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      const courseResponse = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      const courseBody = await courseResponse.json();
      expect(courseResponse.status, JSON.stringify(courseBody)).toBe(201);

      const classResponse = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            className: "Research Methods Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      const classBody = await classResponse.json();
      expect(classResponse.status, JSON.stringify(classBody)).toBe(201);

      const joinResponse = await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(),
          },
        }),
        {
          params: Promise.resolve({
            code: "55395057",
          }),
        },
      );
      const joinBody = await joinResponse.json();
      expect(joinResponse.status, JSON.stringify(joinBody)).toBe(201);

      const response = await postApprove(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classId}/memberships/${membershipId}/approve`,
          {
            method: "POST",
            headers: {
              cookie: createTeacherCookie(),
              "x-uais-trace-id": "trace-membership-approve-1",
            },
          },
        ),
        {
          params: Promise.resolve({
            classId,
            membershipId,
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(response.headers.get("x-uais-trace-id")).toBe("trace-membership-approve-1");
      expect(body.traceId).toBe("trace-membership-approve-1");
      expect(body.membership).toMatchObject({
        membershipId,
        courseId,
        classId,
        studentId: "Peter",
        membershipStatus: "approved",
        approvedAt: "2026-06-22T11:45:00.000Z",
        approvedByTeacherId: "teacher-kang",
      });
      expect(body.classItem).toMatchObject({
        classId,
        students: 1,
        updatedAt: "2026-06-22T11:45:00.000Z",
      });
      expect(body.course).toMatchObject({
        courseId,
        students: 1,
        updatedAt: "2026-06-22T11:45:00.000Z",
      });
      expect(body.receipt).toMatchObject({
        action: "approve-class-membership",
        actorId: "teacher-kang",
        courseId,
        classId,
        traceId: "trace-membership-approve-1",
        authSession: {
          sessionId: "teacher-kang-course-management-session",
          authenticatedAt: "2026-06-22T10:00:00.000Z",
          expiresAt: "2026-06-22T13:00:00.000Z",
        },
      });
      expect(database.memberships).toContainEqual(expect.objectContaining(body.membership));
      expect(database.classes).toContainEqual(expect.objectContaining(body.classItem));
      expect(database.courses).toContainEqual(expect.objectContaining(body.course));
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "approve-class-membership",
          actorId: "teacher-kang",
          courseId,
          classId,
          traceId: "trace-membership-approve-1",
          authMode: "signed-teacher-session",
          authSession: {
            sessionId: "teacher-kang-course-management-session",
            authenticatedAt: "2026-06-22T10:00:00.000Z",
            expiresAt: "2026-06-22T13:00:00.000Z",
          },
        }),
      );
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production membership approval before storage writes when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-approve-auth-provider-"));
    const externalRequests: Array<Record<string, unknown>> = [];
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env: createProductionCourseManagementEnvWithoutTeacherAuthProvider(dataDir),
      fetch: async (url, init) => {
        externalRequests.push({
          method: init?.method ?? "GET",
          url: String(url),
        });
        return Response.json({ error: "unexpected external storage request" }, { status: 500 });
      },
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      const response = await postApprove(
        new Request(
          "https://www.uais.top/api/teaching/classes/teacher-course-production-class-1/memberships/membership-production-1/approve",
          {
            method: "POST",
            headers: {
              cookie: createTeacherCookie(),
              "x-uais-trace-id": "trace-production-approve-auth-provider-blocked",
            },
          },
        ),
        {
          params: Promise.resolve({
            classId: "teacher-course-production-class-1",
            membershipId: "membership-production-1",
          }),
        },
      );
      const body = await response.json();
      const database = await readTeachingCourseManagementDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(503);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher auth provider is not production-ready.",
          traceId: "trace-production-approve-auth-provider-blocked",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-auth-provider-not-production-ready",
            responsibleSession: "S12",
            actor: {
              actorId: "teacher-kang",
              role: "teacher",
            },
          }),
          authProviderContract: expect.objectContaining({
            productionStatus: "blocked",
            blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(database.courses).toEqual([]);
      expect(database.classes).toEqual([]);
      expect(database.memberships).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expectNoLocalOrSecretValues(body, dataDir);
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("records request source metadata across class creation, invite joins, and membership approvals", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-class-lifecycle-audit-source-"));
    const courseId = "teacher-course-ai-supported-mathematics-research-20260622-112000";
    const classId = `${courseId}-class-1`;
    const membershipId = `membership-${classId}-Peter`;
    const env = {
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
    };
    const postCourse = createTeachingCoursePostHandler({
      env,
      now: new Date("2026-06-22T11:20:00.000Z"),
      mergeTeacherAiOwnershipRecord: async () => ({
        teacherId: "teacher-kang",
        status: "merged",
        storagePolicy: "external-redacted-teacher-ai-ownership-merge",
        storageWritePolicy: "external-atomic-merge",
        responsibleSession: "S12",
        updatedAt: "2026-06-22T11:20:00.000Z",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });
    const postClass = createTeachingCourseClassPostHandler({
      env,
      now: new Date("2026-06-22T11:25:00.000Z"),
    });
    const postJoin = createTeachingInviteCodeJoinPostHandler({
      env,
      now: new Date("2026-06-22T11:40:00.000Z"),
    });
    const postApprove = createTeachingClassMembershipApprovePostHandler({
      env,
      now: new Date("2026-06-22T11:45:00.000Z"),
    });

    try {
      const courseResponse = await postCourse(
        new Request("https://www.uais.top/api/teaching/courses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
          },
          body: JSON.stringify({
            name: "AI Supported Mathematics Research",
            instructor: "Kang Xia",
            unit: "Guangzhou University 404",
            department: "Experimental Teaching Center",
            semester: "2026 Spring",
          }),
        }),
      );
      expect(courseResponse.status).toBe(201);

      const classResponse = await postClass(
        new Request(`https://www.uais.top/api/teaching/courses/${courseId}/classes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: createTeacherCookie(),
            "x-uais-trace-id": "trace-class-create-audit-source",
            "user-agent": "UAIS class create audit source test",
          },
          body: JSON.stringify({
            className: "Research Methods Class 1",
            semester: "2026 Spring",
          }),
        }),
        {
          params: Promise.resolve({ courseId }),
        },
      );
      expect(classResponse.status).toBe(201);

      const joinResponse = await postJoin(
        new Request("https://www.uais.top/api/teaching/invite-codes/55395057/join", {
          method: "POST",
          headers: {
            cookie: createStudentCookie(studentAppSessionUser, appSessionSecret),
            "x-uais-trace-id": "trace-invite-join-audit-source",
            "user-agent": "UAIS invite join audit source test",
          },
        }),
        {
          params: Promise.resolve({ code: "55395057" }),
        },
      );
      expect(joinResponse.status).toBe(201);

      const approveResponse = await postApprove(
        new Request(
          `https://www.uais.top/api/teaching/classes/${classId}/memberships/${membershipId}/approve`,
          {
            method: "POST",
            headers: {
              cookie: createTeacherCookie(),
              "x-uais-trace-id": "trace-membership-approve-audit-source",
              "user-agent": "UAIS membership approve audit source test",
            },
          },
        ),
        {
          params: Promise.resolve({
            classId,
            membershipId,
          }),
        },
      );
      expect(approveResponse.status).toBe(200);

      const database = await readTeachingCourseManagementDatabase({ dataDir });
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "create-class",
          actorId: "teacher-kang",
          courseId,
          classId,
          traceId: "trace-class-create-audit-source",
          requestSource: {
            userAgent: "UAIS class create audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "join-class-by-invite",
          actorId: "Peter",
          actorRole: "student",
          authMode: "app-student-session",
          courseId,
          classId,
          traceId: "trace-invite-join-audit-source",
          requestSource: {
            userAgent: "UAIS invite join audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "approve-class-membership",
          actorId: "teacher-kang",
          courseId,
          classId,
          traceId: "trace-membership-approve-audit-source",
          requestSource: {
            userAgent: "UAIS membership approve audit source test",
            ipAddress: "redacted",
          },
        }),
      );
      expectNoLocalOrSecretValues(database, dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
