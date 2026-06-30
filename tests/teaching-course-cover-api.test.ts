import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCourseCoverPostHandler } from "@/app/api/teaching/course-cover/route";
import type {
  QwenCourseCoverGenerateInput,
  QwenCourseCoverGenerateResult,
} from "@/lib/ai/providers/qwen-client";
import {
  createTeachingCourseRecord,
  readTeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-store";
import { readTeachingCourseAssetsDatabase } from "@/lib/server/teaching-course-assets-store";
import { storeUaisTeacherAiOwnershipRecord } from "@/lib/server/teacher-ai-ownership-store";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const externalStorageAccessToken =
  "test-external-storage-access-token-with-32-chars";
const appSessionSecret = "test-course-cover-app-session-signing-secret";
const productionTeacherAuthIssuerSecret =
  "test-teacher-auth-issuer-secret-strong-fixture";

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

function productionTeacherAuthProviderEnv(sessionSigningSecret: string) {
  return {
    UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
    UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: sessionSigningSecret,
    UAIS_TEACHER_AUTH_ISSUER_SECRET: productionTeacherAuthIssuerSecret,
  };
}

describe("teaching course cover API", () => {
  it("fails closed in production when course cover asset persistence would use local JSON", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-production-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-production-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const externalRequests: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      externalRequests.push(String(url));
      if (new URL(String(url)).pathname === "/uais/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["teacher-draft-ai-math"],
        });
      }
      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DASHSCOPE_API_KEY: "secret-qwen",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:00:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          throw new Error("Qwen should not be called without durable cover asset storage.");
        },
      }),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-draft-ai-math"],
        },
        updatedAt: "2026-06-22T10:30:00.000Z",
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-production-001",
            "user-agent": "UAIS course cover production test",
          },
          body: JSON.stringify({
            courseId: "teacher-draft-ai-math",
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe(
        "Production teaching course cover asset persistence requires external storage.",
      );
      expect(qwenCalled).toBe(false);
      expect(externalRequests).toEqual([
        "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang",
      ]);
      expect(database.assets).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(database)).not.toContain("secret-qwen");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("treats deployment production markers as production before local course cover asset writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-deploy-prod-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const courseId = "teacher-draft-course-teacher-kang-ai-math-20260629-180600";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-deployment-production-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-29T18:00:00.000Z",
        expiresAt: "2026-06-29T19:00:00.000Z",
      },
    });
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        NODE_ENV: "development",
        UAIS_DEPLOYMENT_ENV: "production",
        DASHSCOPE_API_KEY: "secret-qwen",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
      },
      now: new Date("2026-06-29T18:06:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          throw new Error("Qwen should not be called without durable cover asset storage.");
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-deployment-prod-local-json",
            "user-agent": "UAIS course cover deployment production marker test",
          },
          body: JSON.stringify({
            courseId,
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-course-cover-deployment-prod-local-json",
      );
      expect(body.error).toBe(
        "Production teaching course cover asset persistence requires external storage.",
      );
      expect(body.traceId).toBe("trace-course-cover-deployment-prod-local-json");
      expect(qwenCalled).toBe(false);
      expect(database.assets).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(courseId);
      expect(JSON.stringify(database)).not.toContain("secret-qwen");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed in production before Qwen or asset writes when existing-course cover binding would use local JSON", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-cover-binding-prod-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const courseId = "teacher-course-existing-cover-binding-20260626";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-binding-production-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
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
      if (init?.method === "GET" && pathname === "/uais/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: [courseId],
        });
      }
      if (init?.method === "GET" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-assets-v1",
            updatedAt: "1970-01-01T00:00:00.000Z",
            assets: [],
            auditEvents: [],
          },
          revision: "rev-0",
        });
      }
      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DASHSCOPE_API_KEY: "secret-qwen",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:00:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          throw new Error("Qwen should not be called before durable course-cover binding preflight.");
        },
      }),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [courseId],
        },
        updatedAt: "2026-06-22T10:30:00.000Z",
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-binding-production-local-json",
            "user-agent": "UAIS course cover binding production preflight test",
          },
          body: JSON.stringify({
            courseId,
            name: "Existing course cover",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-course-cover-binding-production-local-json",
      );
      expect(body.error).toBe(
        "Production teaching course cover binding requires external course management storage.",
      );
      expect(body.traceId).toBe("trace-course-cover-binding-production-local-json");
      expect(qwenCalled).toBe(false);
      expect(externalRequests).toEqual([
        {
          method: "GET",
          url: "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
      ]);
      expect(database.assets).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
      expect(JSON.stringify(body)).not.toContain(courseId);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks production course cover generation before ownership, Qwen, or asset writes when teacher auth provider is not production-ready", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-cover-auth-provider-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const courseId = "teacher-draft-ai-math";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-auth-provider-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const externalRequests: string[] = [];
    let qwenCalled = false;
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push(`${init?.method ?? "GET"} ${String(url)}`);
      const pathname = new URL(String(url)).pathname;

      if (init?.method === "GET" && pathname === "/uais/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: [courseId],
        });
      }

      if (init?.method === "GET" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-assets-v1",
            updatedAt: "1970-01-01T00:00:00.000Z",
            assets: [],
            auditEvents: [],
          },
          revision: "rev-0",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

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
          revision: "rev-course-management-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

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
          revision: "rev-course-management-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

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
          revision: "rev-course-management-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

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
          revision: "rev-course-management-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

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
          revision: "rev-course-management-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

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
          revision: "rev-course-management-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          status: "persisted",
          revision: "rev-1",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
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
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:00:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          return {
            provider: "qwen",
            providerRole: "image-generation",
            model: "qwen-image-2.0-pro",
            imageUrl: "https://dashscope-result/course-cover.png",
            requestId: "request-course-cover-auth-provider-blocked",
            usage: { width: 800, height: 480, imageCount: 1 },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "generated-url-only",
            },
          };
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-auth-provider-not-ready",
            "user-agent": "UAIS course cover auth provider not ready",
          },
          body: JSON.stringify({
            courseId,
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-course-cover-auth-provider-not-ready",
      );
      expect(body.error).toBe("UAIS teacher auth provider is not production-ready.");
      expect(body.traceId).toBe("trace-course-cover-auth-provider-not-ready");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-auth-provider-not-production-ready",
          responsibleSession: "S12",
        }),
      );
      expect(body.authProviderContract).toEqual(
        expect.objectContaining({
          providerKind: "missing",
          productionStatus: "blocked",
          blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
          redaction: {
            values: "omitted",
            cookies: "omitted",
          },
        }),
      );
      expect(qwenCalled).toBe(false);
      expect(externalRequests).toEqual([]);
      expect(database.assets).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
      expect(JSON.stringify(body)).not.toContain(courseId);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires a signed teacher session before generating a course cover", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-auth-"));
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "test-teacher-auth-session-signing-secret",
      },
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          throw new Error("Qwen should not be called without signed teacher auth.");
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          body: JSON.stringify({
            courseId: "teacher-draft-ai-math",
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "authenticated-session-required",
          responsibleSession: "S12",
        }),
      );
      expect(qwenCalled).toBe(false);
      expect(database.assets).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(database)).not.toContain("secret-qwen");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed teacher actor ids before ownership, provider, or asset writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-cover-unsafe-actor-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeActorId = "/Users/example/secret-token-cover-teacher";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-course-cover-unsafe-actor-session",
        actorId: unsafeActorId,
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const externalRequests: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      externalRequests.push(String(url));
      return Response.json({
        teacherId: "teacher-kang",
        courseIds: ["teacher-draft-ai-math"],
      });
    };
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DASHSCOPE_API_KEY: "secret-qwen",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:00:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          throw new Error("Qwen should not be called for an unsafe signed actor id.");
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-unsafe-actor-id",
            "user-agent": "UAIS course cover unsafe actor test",
          },
          body: JSON.stringify({
            courseId: "teacher-draft-ai-math",
            name: "Unsafe Actor Cover",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-course-cover-unsafe-actor-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-course-cover-unsafe-actor-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(externalRequests).toEqual([]);
      expect(qwenCalled).toBe(false);
      expect(database.assets).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(unsafeActorId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(database)).not.toContain("secret-token");
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed teacher session ids before provider or asset writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-cover-unsafe-session-id-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const unsafeSessionId = "/Users/example/secret-token-cover-session";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: unsafeSessionId,
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:00:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          return {
            provider: "qwen",
            providerRole: "image-generation",
            model: "qwen-image-2.0",
            imageUrl: "https://dashscope-result/unsafe-session-cover.png",
            requestId: "request-unsafe-session-cover-1",
            usage: { width: 800, height: 480, imageCount: 1 },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "generated-url-only",
            },
          } satisfies QwenCourseCoverGenerateResult;
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-unsafe-session-id",
            "user-agent": "UAIS course cover unsafe session test",
          },
          body: JSON.stringify({
            courseId: "teacher-draft-course-teacher-kang-unsafe-session-cover-20260622-110000",
            name: "Unsafe Session Cover",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-course-cover-unsafe-session-id",
      );
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS teacher authentication is required.",
          traceId: "trace-course-cover-unsafe-session-id",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "authenticated-session-required",
            responsibleSession: "S12",
          }),
        }),
      );
      expect(qwenCalled).toBe(false);
      expect(database.assets).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(unsafeSessionId);
      expect(JSON.stringify(body)).not.toContain("secret-token");
      expect(JSON.stringify(database)).not.toContain("secret-token");
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires teacher authentication before parsing a course cover request body", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-auth-body-"));
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "test-teacher-auth-session-signing-secret",
      },
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          throw new Error("Qwen should not be called without signed teacher auth.");
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-uais-trace-id": "trace-course-cover-auth-before-body",
          },
          body: "{",
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-course-cover-auth-before-body",
      );
      expect(body.traceId).toBe("trace-course-cover-auth-before-body");
      expect(body.error).toBe("UAIS teacher authentication is required.");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "authenticated-session-required",
          responsibleSession: "S12",
        }),
      );
      expect(JSON.stringify(body)).not.toContain("Course cover request body must be JSON.");
      expect(qwenCalled).toBe(false);
      expect(database.assets).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(database)).not.toContain("secret-qwen");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects signed-student course cover generation as a teacher role denial before provider or asset writes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-student-role-"));
    const studentCookie = createUaisAppSessionCookie(
      {
        account: "Peter",
        department: "学生账号",
        displayName: "Peter",
        role: "student",
      },
      {
        secret: appSessionSecret,
        sessionId: "student-course-cover-session",
        now: new Date("2026-06-22T10:45:00.000Z"),
      },
    );
    const teacherCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: "test-teacher-auth-session-signing-secret",
      claims: {
        sessionId: "teacher-mixed-course-cover-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:45:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "test-teacher-auth-session-signing-secret",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          throw new Error("Qwen should not be called for a signed student role denial.");
        },
      }),
    });

    try {
      for (const [cookie, traceId] of [
        [studentCookie, "trace-student-course-cover-denied-001"],
        [
          `${studentCookie}; ${teacherCookie}`,
          "trace-mixed-student-course-cover-denied-001",
        ],
      ] as const) {
        const response = await postCourseCover(
          new Request("http://localhost/api/teaching/course-cover", {
            method: "POST",
            headers: {
              cookie,
              "x-uais-trace-id": traceId,
            },
            body: JSON.stringify({
              courseId: "teacher-draft-ai-math",
              name: "AI支持的初等数学研究",
            }),
          }),
        );
        const body = await response.json();
        const database = await readTeachingCourseAssetsDatabase({ dataDir });

        expect(response.status).toBe(403);
        expect(response.headers.get("x-uais-trace-id")).toBe(traceId);
        expect(body.traceId).toBe(traceId);
        expect(body.access).toEqual(
          expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-role-required",
            actor: { actorId: "Peter", role: "student" },
            responsibleSession: "S12",
          }),
        );
        expect(qwenCalled).toBe(false);
        expect(database.assets).toHaveLength(0);
        expect(database.auditEvents).toHaveLength(0);
        expect(JSON.stringify(body)).not.toContain("secret-qwen");
        expect(JSON.stringify(database)).not.toContain("secret-qwen");
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe signed student account ids before course cover role checks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-cover-unsafe-student-"));
    const unsafeStudentId = "/Users/example/secret-token-course-cover-student";
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "test-teacher-auth-session-signing-secret",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      },
      now: new Date("2026-06-22T10:45:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          throw new Error("Qwen should not be called for an unsafe signed student id.");
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
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
                sessionId: "unsafe-student-course-cover-session",
                now: new Date("2026-06-22T10:45:00.000Z"),
              },
            ),
            "x-uais-trace-id": "trace-course-cover-unsafe-student-id",
          },
          body: "{",
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers.get("x-uais-trace-id")).toBe(
        "trace-course-cover-unsafe-student-id",
      );
      expect(body.traceId).toBe("trace-course-cover-unsafe-student-id");
      expect(body.error).toBe("UAIS teacher authentication is required.");
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "authenticated-session-required",
          responsibleSession: "S12",
        }),
      );
      expect(JSON.stringify(body)).not.toContain(unsafeStudentId);
      expect(JSON.stringify(body)).not.toContain("Course cover request body must be JSON.");
      expect(qwenCalled).toBe(false);
      expect(database.assets).toHaveLength(0);
      expect(database.auditEvents).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(database)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("requires course ownership before generating a course cover", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-ownership-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:00:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          throw new Error("Qwen should not be called without course ownership.");
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-001",
            "user-agent": "UAIS course cover test",
          },
          body: JSON.stringify({
            courseId: "teacher-draft-ai-math",
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status).toBe(403);
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-course-ownership-required",
          actor: { actorId: "teacher-kang", role: "teacher" },
          resource: { courseId: "teacher-draft-ai-math" },
          responsibleSession: "S12",
        }),
      );
      expect(qwenCalled).toBe(false);
      expect(database.assets).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(database)).not.toContain("secret-qwen");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("allows a signed teacher to generate a cover for their provisional new-course draft", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-draft-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-draft-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    let generatedInput: QwenCourseCoverGenerateInput | undefined;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:00:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async (input) => {
          generatedInput = input;
          return {
            provider: "qwen",
            providerRole: "image-generation",
            model: input.model ?? "qwen-image-2.0",
            imageUrl: "https://dashscope-result/draft-course-cover.png",
            requestId: "request-draft-course-cover-1",
            usage: { width: 800, height: 480, imageCount: 1 },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "generated-url-only",
            },
          } satisfies QwenCourseCoverGenerateResult;
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-draft-001",
            "user-agent": "UAIS course cover draft test",
          },
          body: JSON.stringify({
            courseId: "teacher-draft-course-teacher-kang-course-20260622-110000",
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(generatedInput).toMatchObject({
        courseName: "AI支持的初等数学研究",
      });
      expect(body.asset).toMatchObject({
        assetId: "course-cover-request-draft-course-cover-1",
        courseId: "teacher-draft-course-teacher-kang-course-20260622-110000",
        storagePolicy: "local-json-teaching-course-cover-assets",
      });
      expect(body.audit).toMatchObject({
        traceId: "trace-course-cover-draft-001",
        actor: { actorId: "teacher-kang", role: "teacher" },
        authSession: {
          sessionId: "teacher-cover-draft-session",
        },
      });
      expect(database.assets).toContainEqual(expect.objectContaining(body.asset));
      expect(database.auditEvents).toContainEqual(
        expect.objectContaining({
          traceId: "trace-course-cover-draft-001",
          courseId: "teacher-draft-course-teacher-kang-course-20260622-110000",
          actorId: "teacher-kang",
        }),
      );
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps Qwen credentials server-side while returning a generated course cover URL", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-success-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    let clientOptions: { apiKey: string; baseUrl?: string } | undefined;
    let generatedInput: QwenCourseCoverGenerateInput | undefined;

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-draft-ai-math"],
        },
        updatedAt: "2026-06-22T10:30:00.000Z",
      });

      const postCourseCover = createCourseCoverPostHandler({
        env: {
          DASHSCOPE_API_KEY: "secret-qwen",
          DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com",
          QWEN_IMAGE_MODEL: "qwen-image-2.0-pro",
          UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        },
        now: new Date("2026-06-22T11:00:00.000Z"),
        createQwenImageClient: (options) => {
          clientOptions = options;
          return {
            generateCourseCover: async (input) => {
              generatedInput = input;
              return {
                provider: "qwen",
                providerRole: "image-generation",
                model: input.model ?? "qwen-image-2.0",
                imageUrl: "https://dashscope-result/course-cover.png",
                requestId: "request-course-cover-1",
                usage: { width: 800, height: 480, imageCount: 1 },
                redaction: {
                  secrets: "omitted",
                  localFiles: "omitted",
                  assets: "generated-url-only",
                },
              } satisfies QwenCourseCoverGenerateResult;
            },
          };
        },
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-001",
            "user-agent": "UAIS course cover test",
          },
          body: JSON.stringify({
            courseId: "teacher-draft-ai-math",
            name: "AI支持的初等数学研究",
            instructor: "康霞",
            unit: "广州大学 (404)",
            department: "实验教学中心",
            semester: "2025-2026第二学期",
            description: "面向师范生的研究方法课程。",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.cover).toMatchObject({
        provider: "qwen",
        providerRole: "image-generation",
        model: "qwen-image-2.0-pro",
        imageUrl: "https://dashscope-result/course-cover.png",
        requestId: "request-course-cover-1",
      });
      expect(body.asset).toMatchObject({
        assetId: "course-cover-request-course-cover-1",
        assetType: "course-cover",
        courseId: "teacher-draft-ai-math",
        courseName: "AI支持的初等数学研究",
        imageUrl: "https://dashscope-result/course-cover.png",
        model: "qwen-image-2.0-pro",
        providerRequestId: "request-course-cover-1",
        createdAt: "2026-06-22T11:00:00.000Z",
        storagePolicy: "local-json-teaching-course-cover-assets",
        storageWritePolicy: "atomic-json-file-replace",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "generated-url-only",
        },
      });
      expect(body.audit).toMatchObject({
        traceId: "trace-course-cover-001",
        eventType: "teaching-course-cover.generated",
        actor: { actorId: "teacher-kang", role: "teacher" },
        authMode: "signed-teacher-session",
        authSession: {
          sessionId: "teacher-cover-success-session",
          authenticatedAt: "2026-06-22T10:30:00.000Z",
          expiresAt: "2026-06-22T12:00:00.000Z",
        },
        storagePolicy: "local-json-teaching-course-cover-audit-log",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "generated-url-only",
        },
      });
      expect(body.redaction).toEqual({
        secrets: "omitted",
        localFiles: "omitted",
        assets: "generated-url-only",
      });
      expect(clientOptions).toEqual({
        apiKey: "secret-qwen",
        baseUrl: "https://dashscope.aliyuncs.com",
      });
      expect(generatedInput).toMatchObject({
        courseName: "AI支持的初等数学研究",
        instructor: "康霞",
        unit: "广州大学 (404)",
        department: "实验教学中心",
        semester: "2025-2026第二学期",
        description: "面向师范生的研究方法课程。",
        model: "qwen-image-2.0-pro",
      });
      const database = await readTeachingCourseAssetsDatabase({ dataDir });
      expect(database.assets).toContainEqual(expect.objectContaining(body.asset));
      expect(database).toEqual(
        expect.objectContaining({
          auditEvents: [
            expect.objectContaining({
              auditId: "audit-course-cover-course-cover-request-course-cover-1-20260622-110000",
              traceId: "trace-course-cover-001",
              eventType: "teaching-course-cover.generated",
              actorId: "teacher-kang",
              actorRole: "teacher",
              authMode: "signed-teacher-session",
              authSession: {
                sessionId: "teacher-cover-success-session",
                authenticatedAt: "2026-06-22T10:30:00.000Z",
                expiresAt: "2026-06-22T12:00:00.000Z",
              },
              courseId: "teacher-draft-ai-math",
              assetId: "course-cover-request-course-cover-1",
              providerRequestId: "request-course-cover-1",
              requestSource: {
                userAgent: "UAIS course cover test",
                ipAddress: "redacted",
              },
              createdAt: "2026-06-22T11:00:00.000Z",
              storagePolicy: "local-json-teaching-course-cover-audit-log",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "generated-url-only",
              },
            }),
          ],
        }),
      );
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(database)).not.toContain("secret-qwen");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("binds generated covers back to the persisted existing course record", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-cover-binding-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-binding-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir,
        actorId: "teacher-kang",
        draft: {
          name: "AI支持的初等数学研究",
          instructor: "康霞",
          unit: "广州大学 (404)",
          department: "实验教学中心",
          semester: "2025-2026第二学期",
        },
        traceId: "trace-create-course-before-cover-binding",
        now: new Date("2026-06-22T10:45:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T10:45:00.000Z",
      });

      const postCourseCover = createCourseCoverPostHandler({
        env: {
          DASHSCOPE_API_KEY: "secret-qwen",
          QWEN_IMAGE_MODEL: "qwen-image-2.0-pro",
          UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
          UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        },
        now: new Date("2026-06-22T11:00:00.000Z"),
        createQwenImageClient: () => ({
          generateCourseCover: async (input) => ({
            provider: "qwen",
            providerRole: "image-generation",
            model: input.model ?? "qwen-image-2.0",
            imageUrl: "https://dashscope-result/existing-course-cover.png",
            requestId: "request-existing-course-cover-1",
            usage: { width: 800, height: 480, imageCount: 1 },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "generated-url-only",
            },
          }),
        }),
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-existing-course-cover-binding",
            "user-agent": "UAIS existing course cover binding test",
          },
          body: JSON.stringify({
            courseId: course.courseId,
            name: course.courseName,
            instructor: course.instructor,
            unit: course.unit,
            department: course.department,
            semester: course.semester,
          }),
        }),
      );
      const body = await response.json();
      const courseManagementDatabase = await readTeachingCourseManagementDatabase({ dataDir });
      const courseAssetsDatabase = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.asset).toMatchObject({
        assetId: "course-cover-request-existing-course-cover-1",
        courseId: course.courseId,
        storagePolicy: "local-json-teaching-course-cover-assets",
      });
      expect(body.courseBindingReceipt).toMatchObject({
        action: "bind-course-cover-asset",
        actorId: "teacher-kang",
        courseId: course.courseId,
        traceId: "trace-existing-course-cover-binding",
        status: "persisted",
        storagePolicy: "local-json-teaching-course-management",
        storageWritePolicy: "atomic-json-file-replace",
        responsibleSession: "S12",
      });
      expect(courseManagementDatabase.courses).toContainEqual(
        expect.objectContaining({
          courseId: course.courseId,
          coverAssetId: "course-cover-request-existing-course-cover-1",
          updatedAt: "2026-06-22T11:00:00.000Z",
        }),
      );
      expect(courseManagementDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          action: "bind-course-cover-asset",
          actorId: "teacher-kang",
          courseId: course.courseId,
          traceId: "trace-existing-course-cover-binding",
          requestSource: {
            userAgent: "UAIS existing course cover binding test",
            ipAddress: "redacted",
          },
        }),
      );
      expect(courseAssetsDatabase.assets).toContainEqual(expect.objectContaining(body.asset));
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(courseManagementDatabase)).not.toContain("secret-qwen");
      expect(JSON.stringify(courseAssetsDatabase)).not.toContain("secret-qwen");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns persisted cover asset context when existing-course binding fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-cover-binding-partial-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-binding-partial-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
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

      if (init?.method === "GET" && pathname === "/uais/teaching-course-management/database") {
        return new Response(
          JSON.stringify({
            database: await readTeachingCourseManagementDatabase({ dataDir }),
            revision: "rev-course-management-before-cover-binding",
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
            error: "course management persistence unavailable",
          }),
          { status: 502, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ error: "unexpected external request" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const { course } = await createTeachingCourseRecord({
        dataDir,
        actorId: "teacher-kang",
        draft: {
          name: "AI支持的初等数学研究",
          instructor: "康霞",
          unit: "广州大学 (404)",
          department: "实验教学中心",
          semester: "2025-2026第二学期",
        },
        traceId: "trace-create-course-before-cover-partial-binding",
        now: new Date("2026-06-22T10:45:00.000Z"),
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [course.courseId],
        },
        updatedAt: "2026-06-22T10:45:00.000Z",
      });

      const postCourseCover = createCourseCoverPostHandler({
        env: {
          DASHSCOPE_API_KEY: "secret-qwen",
          QWEN_IMAGE_MODEL: "qwen-image-2.0-pro",
          UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
          UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
          UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
        },
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:00:00.000Z"),
        createQwenImageClient: () => ({
          generateCourseCover: async (input) => ({
            provider: "qwen",
            providerRole: "image-generation",
            model: input.model ?? "qwen-image-2.0",
            imageUrl: "https://dashscope-result/existing-course-cover-partial.png",
            requestId: "request-existing-course-cover-partial-1",
            usage: { width: 800, height: 480, imageCount: 1 },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "generated-url-only",
            },
          }),
        }),
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-existing-course-cover-binding-partial",
            "user-agent": "UAIS existing course cover binding partial test",
          },
          body: JSON.stringify({
            courseId: course.courseId,
            name: course.courseName,
            instructor: course.instructor,
            unit: course.unit,
            department: course.department,
            semester: course.semester,
          }),
        }),
      );
      const body = await response.json();
      const courseAssetsDatabase = await readTeachingCourseAssetsDatabase({ dataDir });
      const serializedBody = JSON.stringify(body);

      expect(response.status, serializedBody).toBe(502);
      expect(body.error).toBe("External teaching course management persistence failed.");
      expect(body.cover).toMatchObject({
        imageUrl: "https://dashscope-result/existing-course-cover-partial.png",
      });
      expect(body.asset).toMatchObject({
        assetId: "course-cover-request-existing-course-cover-partial-1",
        courseId: course.courseId,
        storagePolicy: "local-json-teaching-course-cover-assets",
      });
      expect(body.audit).toMatchObject({
        traceId: "trace-existing-course-cover-binding-partial",
        actor: {
          actorId: "teacher-kang",
          role: "teacher",
        },
        courseId: course.courseId,
        assetId: "course-cover-request-existing-course-cover-partial-1",
        storagePolicy: "local-json-teaching-course-cover-audit-log",
      });
      expect(body.partialFailure).toMatchObject({
        status: "cover-asset-persisted-course-binding-failed",
        failedStep: "course-cover-binding",
        courseId: course.courseId,
        assetId: "course-cover-request-existing-course-cover-partial-1",
        recoveryAction: "reuse-cover-asset-id-on-course-create-or-retry-binding",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(courseAssetsDatabase.assets).toContainEqual(expect.objectContaining(body.asset));
      expect(courseAssetsDatabase.auditEvents).toContainEqual(
        expect.objectContaining({
          traceId: "trace-existing-course-cover-binding-partial",
          actorId: "teacher-kang",
          courseId: course.courseId,
          assetId: "course-cover-request-existing-course-cover-partial-1",
        }),
      );
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
            expectedRevision: "rev-course-management-before-cover-binding",
          }),
        },
      ]);
      expect(serializedBody).not.toContain("secret-qwen");
      expect(serializedBody).not.toContain(externalStorageAccessToken);
      expect(serializedBody).not.toContain("storage.example.test");
      expect(serializedBody).not.toContain(dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("uses external cover asset storage for deployed-production course cover generation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-external-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-external-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
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

      if (init?.method === "GET" && pathname === "/uais/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["teacher-draft-ai-math"],
        });
      }

      if (init?.method === "GET" && pathname === "/uais/teaching-course-assets/database") {
        return new Response(
          JSON.stringify({
            database: {
              schemaVersion: "uais-teaching-course-assets-v1",
              updatedAt: "1970-01-01T00:00:00.000Z",
              assets: [],
              auditEvents: [],
            },
            revision: "rev-0",
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
            revision: "rev-course-management-0",
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

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-assets/database") {
        return new Response(
          JSON.stringify({
            status: "persisted",
            revision: "rev-1",
            storagePolicy: "external-redacted-teaching-course-cover-assets",
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
    let clientOptions: { apiKey: string; baseUrl?: string } | undefined;

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-draft-ai-math"],
        },
        updatedAt: "2026-06-22T10:30:00.000Z",
      });

      const postCourseCover = createCourseCoverPostHandler({
        env: {
          NODE_ENV: "production",
          VERCEL_ENV: "production",
          DASHSCOPE_API_KEY: "secret-qwen",
          DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com",
          QWEN_IMAGE_MODEL: "qwen-image-2.0-pro",
          ...productionTeacherAuthProviderEnv(teacherAuthSecret),
          UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
          UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
          UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
          UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        },
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:00:00.000Z"),
        createQwenImageClient: (options) => {
          clientOptions = options;
          return {
            generateCourseCover: async (input) => ({
              provider: "qwen",
              providerRole: "image-generation",
              model: input.model ?? "qwen-image-2.0",
              imageUrl: "https://dashscope-result/course-cover.png",
              requestId: "request-course-cover-1",
              usage: { width: 800, height: 480, imageCount: 1 },
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "generated-url-only",
              },
            }),
          };
        },
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-external-001",
            "user-agent": "UAIS course cover external test",
          },
          body: JSON.stringify({
            courseId: "teacher-draft-ai-math",
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.asset).toMatchObject({
        assetId: "course-cover-request-course-cover-1",
        storagePolicy: "external-redacted-teaching-course-cover-assets",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      });
      expect(clientOptions).toEqual({
        apiKey: "secret-qwen",
        baseUrl: "https://dashscope.aliyuncs.com",
      });
      expect(externalRequests).toEqual([
        {
          method: "GET",
          url: "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-assets/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-assets/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
        {
          method: "PUT",
          url: "https://storage.example.test/uais/teaching-course-assets/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
          body: expect.objectContaining({
            action: "replace-teaching-course-assets-database",
            expectedRevision: "rev-0",
            database: expect.objectContaining({
              assets: [
                expect.objectContaining({
                  assetId: "course-cover-request-course-cover-1",
                  courseId: "teacher-draft-ai-math",
                  storagePolicy: "external-redacted-teaching-course-cover-assets",
                  storageWritePolicy: "external-optimistic-snapshot-replace",
                }),
              ],
              auditEvents: [
                expect.objectContaining({
                  traceId: "trace-course-cover-external-001",
                  actorId: "teacher-kang",
                  authSession: {
                    sessionId: "teacher-cover-external-session",
                    authenticatedAt: "2026-06-22T10:30:00.000Z",
                    expiresAt: "2026-06-22T12:00:00.000Z",
                  },
                  storagePolicy:
                    "external-redacted-teaching-course-cover-audit-log",
                }),
              ],
            }),
          }),
        },
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-management/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
      ]);
      expect(database.assets).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects deployed-production cover generation before external writes when ownership access would use local JSON", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-cover-ownership-prod-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const courseId = "teacher-course-existing-cover-course-20260622-110000";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-ownership-production-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
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
      if (init?.method === "GET" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-assets-v1",
            updatedAt: "1970-01-01T00:00:00.000Z",
            assets: [],
            auditEvents: [],
          },
          revision: "rev-0",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }
      if (init?.method === "PUT" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          status: "persisted",
          revision: "rev-1",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          responsibleSession: "S12",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }
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
          revision: "rev-course-management-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }
      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DASHSCOPE_API_KEY: "secret-qwen",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-22T11:00:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          return {
            provider: "qwen",
            providerRole: "image-generation",
            model: "qwen-image-2.0-pro",
            imageUrl: "https://dashscope-result/course-cover.png",
            requestId: "request-course-cover-ownership-production-1",
            usage: { width: 800, height: 480, imageCount: 1 },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "generated-url-only",
            },
          };
        },
      }),
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [courseId],
        },
        updatedAt: "2026-06-22T10:30:00.000Z",
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-ownership-production-denied",
            "user-agent": "UAIS course cover ownership production test",
          },
          body: JSON.stringify({
            courseId,
            name: "Existing course cover",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status).toBe(503);
      expect(body.error).toBe(
        "Production teacher AI ownership access requires external storage.",
      );
      expect(qwenCalled).toBe(false);
      expect(externalRequests).toEqual([]);
      expect(database.assets).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed in deployed production when cover asset persistence acknowledgement lacks managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-external-db-proof-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-external-db-proof-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
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

      if (init?.method === "GET" && pathname === "/uais/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["teacher-draft-ai-math"],
        });
      }

      if (init?.method === "GET" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-assets-v1",
            updatedAt: "1970-01-01T00:00:00.000Z",
            assets: [],
            auditEvents: [],
          },
          revision: "rev-0",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          status: "persisted",
          revision: "rev-1",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
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
    let qwenCallCount = 0;

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-draft-ai-math"],
        },
        updatedAt: "2026-06-22T10:30:00.000Z",
      });

      const postCourseCover = createCourseCoverPostHandler({
        env: {
          NODE_ENV: "production",
          VERCEL_ENV: "production",
          DASHSCOPE_API_KEY: "secret-qwen",
          QWEN_IMAGE_MODEL: "qwen-image-2.0-pro",
          ...productionTeacherAuthProviderEnv(teacherAuthSecret),
          UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
          UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
          UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
          UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        },
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:00:00.000Z"),
        createQwenImageClient: () => ({
          generateCourseCover: async (input) => {
            qwenCallCount += 1;
            return {
              provider: "qwen",
              providerRole: "image-generation",
              model: input.model ?? "qwen-image-2.0",
              imageUrl: "https://dashscope-result/course-cover-db-proof.png",
              requestId: "request-course-cover-db-proof",
              usage: { width: 800, height: 480, imageCount: 1 },
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "generated-url-only",
              },
            };
          },
        }),
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-external-db-proof",
            "user-agent": "UAIS course cover external database proof test",
          },
          body: JSON.stringify({
            courseId: "teacher-draft-ai-math",
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(body.error).toBe(
        "External teaching course cover asset persistence acknowledgement is missing production database adapter evidence.",
      );
      expect(qwenCallCount).toBe(1);
      expect(externalRequests.map((request) => `${request.method} ${request.url}`)).toEqual([
        "GET https://storage.example.test/uais/teacher-ai-ownership/teacher-kang",
        "GET https://storage.example.test/uais/teaching-course-assets/database",
        "GET https://storage.example.test/uais/teaching-course-assets/database",
        "PUT https://storage.example.test/uais/teaching-course-assets/database",
      ]);
      expect(database.assets).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
      expect(JSON.stringify(body)).not.toContain(dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed in deployed production when cover asset persistence acknowledgement lacks snapshot revision", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-external-revision-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const courseId = "teacher-draft-course-teacher-kang-ai-math-20260627-122500";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-external-revision-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-27T12:20:00.000Z",
        expiresAt: "2026-06-27T13:20:00.000Z",
      },
    });
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

      if (init?.method === "GET" && pathname === "/uais/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: [courseId],
        });
      }

      if (init?.method === "GET" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-assets-v1",
            updatedAt: "1970-01-01T00:00:00.000Z",
            assets: [],
            auditEvents: [],
          },
          revision: "rev-0",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

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
          revision: "rev-course-management-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          status: "persisted",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
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
    let qwenCallCount = 0;

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: [courseId],
        },
        updatedAt: "2026-06-27T12:20:00.000Z",
      });

      const postCourseCover = createCourseCoverPostHandler({
        env: {
          NODE_ENV: "production",
          VERCEL_ENV: "production",
          DASHSCOPE_API_KEY: "secret-qwen",
          QWEN_IMAGE_MODEL: "qwen-image-2.0-pro",
          ...productionTeacherAuthProviderEnv(teacherAuthSecret),
          UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
          UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
          UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
          UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        },
        fetch: fetchImpl,
        now: new Date("2026-06-27T12:25:00.000Z"),
        createQwenImageClient: () => ({
          generateCourseCover: async (input) => {
            qwenCallCount += 1;
            return {
              provider: "qwen",
              providerRole: "image-generation",
              model: input.model ?? "qwen-image-2.0",
              imageUrl: "https://dashscope-result/course-cover-revision.png",
              requestId: "request-course-cover-revision",
              usage: { width: 800, height: 480, imageCount: 1 },
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "generated-url-only",
              },
            };
          },
        }),
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-external-revision",
            "user-agent": "UAIS course cover external revision test",
          },
          body: JSON.stringify({
            courseId,
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(body.error).toBe(
        "External teaching course cover asset persistence acknowledgement is missing snapshot revision.",
      );
      expect(qwenCallCount).toBe(1);
      expect(externalRequests.map((request) => `${request.method} ${request.url}`)).toEqual([
        "GET https://storage.example.test/uais/teaching-course-assets/database",
        "GET https://storage.example.test/uais/teaching-course-assets/database",
        "PUT https://storage.example.test/uais/teaching-course-assets/database",
      ]);
      expect(externalRequests[2]?.body).toEqual(
        expect.objectContaining({
          action: "replace-teaching-course-assets-database",
          expectedRevision: "rev-0",
        }),
      );
      expect(database.assets).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
      expect(JSON.stringify(body)).not.toContain(dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before Qwen when production cover asset readback lacks managed database adapter proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-read-proof-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const courseId = "teacher-draft-course-teacher-kang-ai-math-20260627-123000";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-read-proof-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-27T12:30:00.000Z",
        expiresAt: "2026-06-27T13:30:00.000Z",
      },
    });
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

      if (init?.method === "GET" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          database: {
            schemaVersion: "uais-teaching-course-assets-v1",
            updatedAt: "1970-01-01T00:00:00.000Z",
            assets: [],
            auditEvents: [],
          },
          revision: "rev-0",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

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
          revision: "rev-course-management-0",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          productionDatabaseAdapter: createReadyProductionDatabaseAdapter(),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-assets/database") {
        return Response.json({
          status: "persisted",
          revision: "rev-after-qwen-should-not-happen",
          storagePolicy: "external-redacted-teaching-course-cover-assets",
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
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DASHSCOPE_API_KEY: "secret-qwen",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-27T12:35:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          return {
            provider: "qwen",
            providerRole: "image-generation",
            model: "qwen-image-2.0-pro",
            imageUrl: "https://dashscope-result/course-cover-read-proof.png",
            requestId: "request-course-cover-read-proof",
            usage: { width: 800, height: 480, imageCount: 1 },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "generated-url-only",
            },
          };
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-read-proof",
            "user-agent": "UAIS course cover read proof test",
          },
          body: JSON.stringify({
            courseId,
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(body.error).toBe(
        "External teaching course cover asset read acknowledgement is missing production database adapter evidence.",
      );
      expect(qwenCalled).toBe(false);
      expect(externalRequests.map((request) => `${request.method} ${request.url}`)).toEqual([
        "GET https://storage.example.test/uais/teaching-course-assets/database",
      ]);
      expect(database.assets).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
      expect(JSON.stringify(body)).not.toContain(dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed before Qwen when production cover asset readback returns 404 without managed database proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-read-404-proof-"));
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const courseId = "teacher-draft-course-teacher-kang-ai-math-20260630-103000";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-read-404-proof-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-30T10:30:00.000Z",
        expiresAt: "2026-06-30T11:30:00.000Z",
      },
    });
    const externalRequests: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      externalRequests.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (
        init?.method === "GET" &&
        new URL(String(url)).pathname === "/uais/teaching-course-assets/database"
      ) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      return Response.json({ error: "unexpected external request" }, { status: 404 });
    };
    let qwenCalled = false;
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        DASHSCOPE_API_KEY: "secret-qwen",
        ...productionTeacherAuthProviderEnv(teacherAuthSecret),
        UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
      },
      fetch: fetchImpl,
      now: new Date("2026-06-30T10:35:00.000Z"),
      createQwenImageClient: () => ({
        generateCourseCover: async () => {
          qwenCalled = true;
          throw new Error("Qwen should not be called when production asset readback is missing.");
        },
      }),
    });

    try {
      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-read-404-proof",
            "user-agent": "UAIS course cover 404 read proof test",
          },
          body: JSON.stringify({
            courseId,
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();
      const database = await readTeachingCourseAssetsDatabase({ dataDir });

      expect(response.status, JSON.stringify(body)).toBe(502);
      expect(body.error).toBe(
        "External teaching course cover asset read acknowledgement is missing production database adapter evidence.",
      );
      expect(qwenCalled).toBe(false);
      expect(externalRequests).toEqual([
        "GET https://storage.example.test/uais/teaching-course-assets/database",
      ]);
      expect(database.assets).toEqual([]);
      expect(database.auditEvents).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
      expect(JSON.stringify(body)).not.toContain(dataDir);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("retries deployed-production cover asset persistence after an external snapshot revision conflict", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-external-retry-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-external-retry-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const concurrentAsset = {
      assetId: "course-cover-concurrent-request",
      assetType: "course-cover",
      courseId: "teacher-draft-ai-math",
      courseName: "并发封面",
      provider: "qwen",
      providerRole: "image-generation",
      imageUrl: "https://dashscope-result/concurrent-course-cover.png",
      model: "qwen-image-2.0-pro",
      providerRequestId: "concurrent-request",
      createdAt: "2026-06-22T10:59:30.000Z",
      storagePolicy: "external-redacted-teaching-course-cover-assets",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "generated-url-only",
      },
    };
    const concurrentAudit = {
      auditId: "audit-course-cover-course-cover-concurrent-request-20260622-105930",
      traceId: "trace-concurrent-course-cover",
      eventType: "teaching-course-cover.generated",
      actorId: "teacher-kang",
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      authSession: {
        sessionId: "teacher-cover-concurrent-session",
        authenticatedAt: "2026-06-22T10:00:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
      courseId: "teacher-draft-ai-math",
      assetId: "course-cover-concurrent-request",
      providerRequestId: "concurrent-request",
      requestSource: {
        userAgent: "UAIS concurrent course cover test",
        ipAddress: "redacted",
      },
      createdAt: "2026-06-22T10:59:30.000Z",
      storagePolicy: "external-redacted-teaching-course-cover-audit-log",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "generated-url-only",
      },
    };
    const externalRequests: Array<{
      method: string;
      url: string;
      authorization: string | null;
      body?: unknown;
    }> = [];
    let assetReadCount = 0;
    let assetWriteCount = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      externalRequests.push({
        method: init?.method ?? "GET",
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        ...(rawBody ? { body: rawBody } : {}),
      });
      const pathname = new URL(String(url)).pathname;

      if (init?.method === "GET" && pathname === "/uais/teacher-ai-ownership/teacher-kang") {
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["teacher-draft-ai-math"],
        });
      }

      if (init?.method === "GET" && pathname === "/uais/teaching-course-assets/database") {
        assetReadCount += 1;
        return new Response(
          JSON.stringify({
            database: {
              schemaVersion: "uais-teaching-course-assets-v1",
              updatedAt:
                assetReadCount <= 2
                  ? "1970-01-01T00:00:00.000Z"
                  : "2026-06-22T10:59:30.000Z",
              assets: assetReadCount <= 2 ? [] : [concurrentAsset],
              auditEvents: assetReadCount <= 2 ? [] : [concurrentAudit],
            },
            revision: assetReadCount <= 2 ? "rev-0" : "rev-1",
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
            revision: "rev-course-management-0",
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

      if (init?.method === "PUT" && pathname === "/uais/teaching-course-assets/database") {
        assetWriteCount += 1;
        if (assetWriteCount === 1) {
          return new Response(
            JSON.stringify({
              error: "Teaching course cover asset snapshot revision mismatch.",
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            status: "persisted",
            revision: "rev-2",
            storagePolicy: "external-redacted-teaching-course-cover-assets",
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
    let qwenCallCount = 0;

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-draft-ai-math"],
        },
        updatedAt: "2026-06-22T10:30:00.000Z",
      });

      const postCourseCover = createCourseCoverPostHandler({
        env: {
          NODE_ENV: "production",
          VERCEL_ENV: "production",
          DASHSCOPE_API_KEY: "secret-qwen",
          DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com",
          QWEN_IMAGE_MODEL: "qwen-image-2.0-pro",
          ...productionTeacherAuthProviderEnv(teacherAuthSecret),
          UAIS_TEACHING_COURSE_ASSETS_BACKEND: "external",
          UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
          UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
          UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        },
        fetch: fetchImpl,
        now: new Date("2026-06-22T11:00:00.000Z"),
        createQwenImageClient: () => ({
          generateCourseCover: async (input) => {
            qwenCallCount += 1;
            return {
              provider: "qwen",
              providerRole: "image-generation",
              model: input.model ?? "qwen-image-2.0",
              imageUrl: "https://dashscope-result/course-cover-retry.png",
              requestId: "request-course-cover-retry-1",
              usage: { width: 800, height: 480, imageCount: 1 },
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "generated-url-only",
              },
            };
          },
        }),
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: {
            cookie,
            "x-uais-trace-id": "trace-course-cover-external-retry",
            "user-agent": "UAIS course cover external retry test",
          },
          body: JSON.stringify({
            courseId: "teacher-draft-ai-math",
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(qwenCallCount).toBe(1);
      expect(assetReadCount).toBe(3);
      expect(assetWriteCount).toBe(2);
      expect(body.asset).toMatchObject({
        assetId: "course-cover-request-course-cover-retry-1",
        storagePolicy: "external-redacted-teaching-course-cover-assets",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      });
      expect(body.assetPersistence).toEqual({
        status: "persisted",
        storagePolicy: "external-redacted-teaching-course-cover-assets",
        storageWritePolicy: "external-optimistic-snapshot-replace",
        concurrencyControl: "optimistic-revision-retry",
        revisionRetry: {
          status: "retried",
          attempts: 2,
          conflicts: 1,
          maxAttempts: 2,
        },
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "generated-url-only",
        },
      });
      expect(externalRequests).toEqual([
        {
          method: "GET",
          url: "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-assets/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-assets/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
        {
          method: "PUT",
          url: "https://storage.example.test/uais/teaching-course-assets/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
          body: expect.objectContaining({
            action: "replace-teaching-course-assets-database",
            expectedRevision: "rev-0",
          }),
        },
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-assets/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
        {
          method: "PUT",
          url: "https://storage.example.test/uais/teaching-course-assets/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
          body: expect.objectContaining({
            action: "replace-teaching-course-assets-database",
            expectedRevision: "rev-1",
            database: expect.objectContaining({
              assets: [
                expect.objectContaining({
                  assetId: "course-cover-concurrent-request",
                }),
                expect.objectContaining({
                  assetId: "course-cover-request-course-cover-retry-1",
                  courseId: "teacher-draft-ai-math",
                }),
              ],
              auditEvents: [
                expect.objectContaining({
                  auditId:
                    "audit-course-cover-course-cover-concurrent-request-20260622-105930",
                }),
                expect.objectContaining({
                  traceId: "trace-course-cover-external-retry",
                  actorId: "teacher-kang",
                  storagePolicy:
                    "external-redacted-teaching-course-cover-audit-log",
                }),
              ],
            }),
          }),
        },
        {
          method: "GET",
          url: "https://storage.example.test/uais/teaching-course-management/database",
          authorization: `Bearer ${externalStorageAccessToken}`,
        },
      ]);
      expect(JSON.stringify(body)).not.toContain("secret-qwen");
      expect(JSON.stringify(body)).not.toContain(externalStorageAccessToken);
      expect(JSON.stringify(body)).not.toContain("storage.example.test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the DashScope API key is not configured", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-teaching-course-assets-no-key-"));
    const ownershipDir = join(dataDir, "teacher-ai-ownership");
    const teacherAuthSecret = "test-teacher-auth-session-signing-secret";
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSecret,
      claims: {
        sessionId: "teacher-cover-no-key-session",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2026-06-22T10:30:00.000Z",
        expiresAt: "2026-06-22T12:00:00.000Z",
      },
    });
    const postCourseCover = createCourseCoverPostHandler({
      env: {
        UAIS_TEACHING_COURSE_ASSETS_DATA_DIR: dataDir,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipDir,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSecret,
      },
      now: new Date("2026-06-22T11:00:00.000Z"),
      createQwenImageClient: () => {
        throw new Error("Qwen should not be called without a server API key.");
      },
    });

    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["teacher-draft-ai-math"],
        },
        updatedAt: "2026-06-22T10:30:00.000Z",
      });

      const response = await postCourseCover(
        new Request("http://localhost/api/teaching/course-cover", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({
            courseId: "teacher-draft-ai-math",
            name: "AI支持的初等数学研究",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("DASHSCOPE_API_KEY is required for Qwen course cover generation.");
      expect(body.redaction).toEqual({
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
