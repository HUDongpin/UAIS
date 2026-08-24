import { randomUUID } from "node:crypto";
import {
  createQwenImageClient,
  type QwenCourseCoverGenerateInput,
  type QwenCourseCoverGenerateResult,
} from "@/lib/ai/providers/qwen-client";
import {
  isExternalStorageBackendReadyContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import {
  assertTeachingCourseAssetsLocalJsonRuntimeAllowed,
  resolveTeachingCourseAssetsDataDir,
  storeTeachingCourseCoverAsset,
  TeachingCourseAssetsStoreError,
  type TeachingCourseCoverAuditEvent,
  type TeachingCourseCoverAuditRequestSource,
} from "@/lib/server/teaching-course-assets-store";
import { createUaisTeachingCourseAssetsRepository } from "@/lib/server/teaching-course-assets-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  bindTeachingCourseCoverAssetRecord,
  resolveTeachingCourseManagementDataDir,
  TeachingCourseManagementStoreError,
} from "@/lib/server/teaching-course-management-store";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import { createUaisTeacherAiOwnershipAdapter } from "@/lib/server/teacher-ai-ownership-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import { isProvisionalTeachingCourseIdForActor } from "@/lib/teaching-course-id";

type QwenCourseCoverClient = {
  generateCourseCover(input: QwenCourseCoverGenerateInput): Promise<QwenCourseCoverGenerateResult>;
};

type CourseCoverPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  createQwenImageClient?: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => QwenCourseCoverClient;
};

type AuthenticatedTeacher = {
  sessionId: string;
  actorId: string;
  role: "teacher";
  authenticatedAt: string;
  expiresAt: string;
};

type AuthenticatedStudent = {
  sessionId: string;
  account: string;
  role: "student";
  authenticatedAt: string;
  expiresAt: string;
};

type CourseCoverRequestBody = {
  courseId?: string;
  name: string;
  instructor?: string;
  unit?: string;
  department?: string;
  semester?: string;
  description?: string;
};

const maxBodyBytes = 20_000;

export function createCourseCoverPostHandler(deps: CourseCoverPostHandlerDeps = {}) {
  const env = deps.env ?? process.env;
  const qwenImageClientFactory = deps.createQwenImageClient ?? createQwenImageClient;
  const readOwnership = createUaisTeacherAiOwnershipAdapter({
    env,
    fetch: deps.fetch,
  });

  return async function POST(request: Request) {
    const traceId = readSafeTraceId(request);
    try {
      const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
      if (
        isCourseCoverProductionRuntime(env) &&
        authProviderContract.productionStatus !== "ready"
      ) {
        return jsonResponse(503, {
          error: "UAIS teacher auth provider is not production-ready.",
          access: createDeniedAccess("teacher-auth-provider-not-production-ready"),
          authProviderContract,
          redaction: createRedaction(),
        }, traceId);
      }

      const authenticatedStudent = readAuthenticatedStudent({
        request,
        env,
        now: deps.now,
      });
      if (authenticatedStudent) {
        return jsonResponse(403, {
          error: "UAIS teacher role is required for course cover generation.",
          access: createDeniedAccess(
            "teacher-role-required",
            { actorId: authenticatedStudent.account, role: authenticatedStudent.role },
          ),
          redaction: createRedaction(),
        }, traceId);
      }

      const authenticatedTeacher = readAuthenticatedTeacher({
        request,
        env,
        now: deps.now,
      });
      if (!authenticatedTeacher) {
        return jsonResponse(401, {
          error: "UAIS teacher authentication is required.",
          access: createDeniedAccess("authenticated-session-required"),
          redaction: createRedaction(),
        }, traceId);
      }
      const body = parseCourseCoverBody(await readJsonBody(request));
      assertProductionTeacherAiOwnershipAccessConfigured({
        env,
        authenticatedTeacher,
        courseId: body.courseId,
      });
      const access = await authorizeCourseCoverAccess({
        request,
        authenticatedTeacher,
        courseId: body.courseId,
        readOwnership,
      });
      if (access.status === "denied") {
        return jsonResponse(access.reasonCode === "course-id-required" ? 400 : 403, {
          error: "UAIS teaching course ownership is required.",
          access,
          redaction: createRedaction(),
        }, traceId);
      }
      const courseAssetsRepository = createUaisTeachingCourseAssetsRepository({
        env,
        fetch: deps.fetch,
      });
      if (!courseAssetsRepository) {
        assertTeachingCourseAssetsLocalJsonRuntimeAllowed(env);
      }
      assertProductionCourseCoverBindingPersistenceConfigured({
        env,
        authenticatedTeacher,
        courseId: body.courseId,
      });
      const apiKey = env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        throw new CourseCoverRouteError(
          400,
          "DASHSCOPE_API_KEY is required for Qwen course cover generation.",
        );
      }
      await preflightProductionCourseCoverAssetPersistence({
        repository: courseAssetsRepository,
      });

      const client = qwenImageClientFactory({
        apiKey,
        baseUrl: env.DASHSCOPE_BASE_URL,
      });
      const cover = await client.generateCourseCover({
        courseName: body.name,
        instructor: body.instructor,
        unit: body.unit,
        department: body.department,
        semester: body.semester,
        description: body.description,
        model: env.QWEN_IMAGE_MODEL,
      });
      const assetReceipt = await storeTeachingCourseCoverAsset({
        dataDir: resolveTeachingCourseAssetsDataDir(env.UAIS_TEACHING_COURSE_ASSETS_DATA_DIR),
        repository: courseAssetsRepository,
        courseId: body.courseId,
        courseName: body.name,
        cover,
        audit: {
          traceId,
          actorId: authenticatedTeacher.actorId,
          actorRole: authenticatedTeacher.role,
          authMode: "signed-teacher-session",
          authSession: {
            sessionId: authenticatedTeacher.sessionId,
            authenticatedAt: authenticatedTeacher.authenticatedAt,
            expiresAt: authenticatedTeacher.expiresAt,
          },
          requestSource: readAuditRequestSource(request),
        },
        createdAt: (deps.now ?? new Date()).toISOString(),
      });
      let courseBindingReceipt: Awaited<ReturnType<typeof maybeBindCourseCoverToExistingCourse>>;
      try {
        courseBindingReceipt = await maybeBindCourseCoverToExistingCourse({
          env,
          fetch: deps.fetch,
          authenticatedTeacher,
          courseId: body.courseId,
          coverAssetId: assetReceipt.asset.assetId,
          traceId,
          requestSource: readAuditRequestSource(request),
          now: deps.now,
        });
      } catch (error) {
        return createCourseCoverBindingPartialFailureResponse({
          error,
          traceId,
          cover,
          assetReceipt,
          courseId: body.courseId,
        });
      }

      return jsonResponse(200, {
        cover,
        asset: assetReceipt.asset,
        assetPersistence: assetReceipt.persistence,
        ...(courseBindingReceipt ? { courseBindingReceipt } : {}),
        ...(assetReceipt.audit
          ? { audit: createCourseCoverAuditReceipt(assetReceipt.audit) }
          : {}),
        redaction: cover.redaction,
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

async function preflightProductionCourseCoverAssetPersistence(input: {
  repository?: ReturnType<typeof createUaisTeachingCourseAssetsRepository>;
}) {
  if (!input.repository) {
    return;
  }
  await input.repository.read();
}

function assertProductionTeacherAiOwnershipAccessConfigured(input: {
  env: Record<string, string | undefined>;
  authenticatedTeacher: AuthenticatedTeacher;
  courseId?: string;
}) {
  if (!isCourseCoverProductionRuntime(input.env) || !input.courseId) {
    return;
  }
  if (isProvisionalTeachingCourseIdForActor(input.courseId, input.authenticatedTeacher.actorId)) {
    return;
  }

  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    value: input.env.UAIS_TEACHER_AI_OWNERSHIP_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });
  if (isExternalStorageBackendReadyContract(backendContract)) {
    return;
  }

  throw new TeachingCourseManagementStoreError(
    503,
    "Production teacher AI ownership access requires external storage.",
  );
}

function assertProductionCourseCoverBindingPersistenceConfigured(input: {
  env: Record<string, string | undefined>;
  authenticatedTeacher: AuthenticatedTeacher;
  courseId?: string;
}) {
  if (!isCourseCoverProductionRuntime(input.env) || !input.courseId) {
    return;
  }
  if (isProvisionalTeachingCourseIdForActor(input.courseId, input.authenticatedTeacher.actorId)) {
    return;
  }

  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
    value: input.env.UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });
  if (isExternalStorageBackendReadyContract(backendContract)) {
    return;
  }

  throw new TeachingCourseManagementStoreError(
    503,
    "Production teaching course cover binding requires external course management storage.",
  );
}

function createCourseCoverBindingPartialFailureResponse(input: {
  error: unknown;
  traceId: string;
  cover: QwenCourseCoverGenerateResult;
  assetReceipt: Awaited<ReturnType<typeof storeTeachingCourseCoverAsset>>;
  courseId?: string;
}) {
  const failure = normalizeCourseCoverError(
    input.error,
    "Course cover asset was persisted, but course binding failed.",
  );

  return jsonResponse(failure.status, {
    error: failure.message,
    cover: input.cover,
    asset: input.assetReceipt.asset,
    assetPersistence: input.assetReceipt.persistence,
    ...(input.assetReceipt.audit
      ? { audit: createCourseCoverAuditReceipt(input.assetReceipt.audit) }
      : {}),
    partialFailure: {
      status: "cover-asset-persisted-course-binding-failed",
      failedStep: "course-cover-binding",
      ...(input.courseId ? { courseId: input.courseId } : {}),
      assetId: input.assetReceipt.asset.assetId,
      recoveryAction: "reuse-cover-asset-id-on-course-create-or-retry-binding",
      responsibleSession: "S12",
      redaction: createRedaction(),
    },
    redaction: createRedaction(),
  }, input.traceId);
}

async function maybeBindCourseCoverToExistingCourse(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  authenticatedTeacher: AuthenticatedTeacher;
  courseId?: string;
  coverAssetId: string;
  traceId: string;
  requestSource: TeachingCourseCoverAuditRequestSource;
  now?: Date;
}) {
  if (!input.courseId) {
    return undefined;
  }
  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  try {
    const { receipt } = await bindTeachingCourseCoverAssetRecord({
      dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
      repository: courseManagementRepository,
      actorId: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      coverAssetId: input.coverAssetId,
      traceId: input.traceId,
      audit: {
        requestSource: input.requestSource,
      },
      now: input.now,
    });
    return receipt;
  } catch (error) {
    if (error instanceof TeachingCourseManagementStoreError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

function createCourseCoverAuditReceipt(event: TeachingCourseCoverAuditEvent) {
  return {
    auditId: event.auditId,
    traceId: event.traceId,
    eventType: event.eventType,
    actor: {
      actorId: event.actorId,
      role: event.actorRole,
    },
    authMode: event.authMode,
    ...(event.authSession ? { authSession: event.authSession } : {}),
    courseId: event.courseId,
    assetId: event.assetId,
    ...(event.providerRequestId ? { providerRequestId: event.providerRequestId } : {}),
    requestSource: event.requestSource,
    storagePolicy: event.storagePolicy,
    redaction: event.redaction,
  };
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function readAuditRequestSource(request: Request): TeachingCourseCoverAuditRequestSource {
  return {
    userAgent: sanitizeRequestSourceHeader(request.headers.get("user-agent")) ?? "unknown",
    ipAddress: "redacted",
  };
}

function sanitizeRequestSourceHeader(value: string | null) {
  const normalized = value?.trim().slice(0, 160);
  if (!normalized) {
    return undefined;
  }
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return "redacted";
  }
  return normalized;
}

function isCourseCoverProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

async function authorizeCourseCoverAccess(input: {
  request: Request;
  authenticatedTeacher: AuthenticatedTeacher;
  courseId?: string;
  readOwnership?: ReturnType<typeof createUaisTeacherAiOwnershipAdapter>;
}) {
  const actor = {
    actorId: input.authenticatedTeacher.actorId,
    role: input.authenticatedTeacher.role,
  };
  const resource = input.courseId ? { courseId: input.courseId } : undefined;
  if (!input.courseId) {
    return createDeniedAccess("course-id-required", actor, resource);
  }
  if (isProvisionalTeachingCourseIdForActor(input.courseId, input.authenticatedTeacher.actorId)) {
    return {
      status: "authorized" as const,
      reasonCode: "provisional-new-course-draft" as const,
      responsibleSession: "S12" as const,
      actor,
      resource,
      redaction: createRedaction(),
    };
  }
  if (!input.readOwnership) {
    return createDeniedAccess("teacher-course-ownership-required", actor, resource);
  }

  const ownership = await input.readOwnership({
    request: input.request,
    authenticatedSession: input.authenticatedTeacher,
  });
  if (!ownership || ownership.teacherId !== input.authenticatedTeacher.actorId) {
    return createDeniedAccess("teacher-course-ownership-required", actor, resource);
  }
  if (!new Set(ownership.courseIds ?? []).has(input.courseId)) {
    return createDeniedAccess("course-scope-denied", actor, resource);
  }

  return {
    status: "authorized" as const,
    reasonCode: "authorized" as const,
    responsibleSession: "S12" as const,
    actor,
    resource,
    redaction: createRedaction(),
  };
}

function readAuthenticatedTeacher(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}): AuthenticatedTeacher | undefined {
  const secret = input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  if (!secret) {
    return undefined;
  }

  const session = readUaisAuthenticatedTeacherSessionFromSignedCookies({
    request: input.request,
    secret,
    now: input.now,
  });
  if (
    !session ||
    session.role !== "teacher" ||
    !isSafeTeachingCourseCoverActorId(session.actorId) ||
    !isSafeTeachingCourseCoverActorId(session.sessionId)
  ) {
    return undefined;
  }
  return session;
}

function readAuthenticatedStudent(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}): AuthenticatedStudent | undefined {
  const claims = getUaisAppSessionClaimsFromCookieString(input.request.headers.get("cookie"), {
    env: input.env,
    now: input.now,
  });
  if (
    claims?.role === "student" &&
    isSafeTeachingCourseCoverActorId(claims.account) &&
    isSafeTeachingCourseCoverActorId(claims.sessionId)
  ) {
    return {
      sessionId: claims.sessionId,
      account: claims.account,
      role: "student",
      authenticatedAt: claims.authenticatedAt,
      expiresAt: claims.expiresAt,
    };
  }
  return undefined;
}

function isSafeTeachingCourseCoverActorId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new CourseCoverRouteError(413, "Course cover request body is too large.");
  }
  if (!text.trim()) {
    throw new CourseCoverRouteError(400, "Course cover request body is required.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CourseCoverRouteError(400, "Course cover request body must be JSON.");
  }
}

function parseCourseCoverBody(value: unknown): CourseCoverRequestBody {
  if (!isRecord(value)) {
    throw new CourseCoverRouteError(400, "Course cover request body must be an object.");
  }

  const name = requireTrimmedString(value.name, "Course name is required for cover generation.");

  return {
    courseId: optionalSafeId(value.courseId, "Course id is invalid."),
    name,
    instructor: optionalTrimmedString(value.instructor),
    unit: optionalTrimmedString(value.unit),
    department: optionalTrimmedString(value.department),
    semester: optionalTrimmedString(value.semester),
    description: optionalTrimmedString(value.description),
  };
}

function requireTrimmedString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CourseCoverRouteError(400, message);
  }
  return value.trim().slice(0, 200);
}

function optionalTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 600) : undefined;
}

function optionalSafeId(value: unknown, message: string) {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 120 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new CourseCoverRouteError(400, message);
  }
  return value.trim();
}

function createErrorResponse(error: unknown, traceId: string) {
  const failure = normalizeCourseCoverError(error, "Qwen course cover generation failed.");

  return jsonResponse(failure.status, {
    error: failure.message,
    ...(failure.reasonCode ? { reasonCode: failure.reasonCode } : {}),
    redaction: createRedaction(),
  }, traceId);
}

function normalizeCourseCoverError(
  error: unknown,
  fallbackMessage: string,
): { status: number; message: string; reasonCode?: string } {
  if (
    error instanceof CourseCoverRouteError ||
    error instanceof TeachingCourseAssetsStoreError ||
    error instanceof TeachingCourseManagementStoreError
  ) {
    return {
      status: error.status,
      message: error.message,
      // Stable classification beside the prose, set today for snapshot
      // contention - on the course row this cover binds to, and on the asset
      // snapshot the cover itself is written into.
      ...(!(error instanceof CourseCoverRouteError) && error.reasonCode
        ? { reasonCode: error.reasonCode }
        : {}),
    };
  }

  return {
    status: 502,
    message: error instanceof Error ? error.message : fallbackMessage,
  };
}

function jsonResponse(status: number, body: unknown, traceId: string) {
  return Response.json({
    ...(isRecord(body) ? body : { value: body }),
    traceId,
  }, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
    },
  });
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function createDeniedAccess(
  reasonCode:
    | "authenticated-session-required"
    | "teacher-auth-provider-not-production-ready"
    | "teacher-role-required"
    | "course-id-required"
    | "teacher-course-ownership-required"
    | "course-scope-denied",
  actor?: { actorId: string; role: "teacher" | "student" },
  resource?: { courseId: string },
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(actor ? { actor } : {}),
    ...(resource ? { resource } : {}),
    redaction: createRedaction(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class CourseCoverRouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
