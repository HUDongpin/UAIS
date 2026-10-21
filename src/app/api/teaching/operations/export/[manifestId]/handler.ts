import { randomUUID } from "node:crypto";
import {
  readTeachingOperationExportManifest,
  resolveTeachingOperationDataDir,
  TeachingOperationStoreError,
  type TeachingOperationExportManifest,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  TeachingCourseManagementStoreError,
  type TeachingCourseExportManifestRecord,
} from "@/lib/server/teaching-course-management-store";
import {
  createTeachingManagedCourseOwnershipAdapter,
  type ReadManagedTeachingCourseOwnership,
} from "@/lib/server/teacher-managed-course-ownership";
import {
  authorizeTeachingOperationCourseAccess,
  createTeachingCourseCapabilityAdapter,
  createTeachingOperationCourseOwnershipAdapter,
  getTeachingOperationAccessDeniedStatus,
  type GetTeachingOperationCourseOwnership,
  type ReadTeachingCourseCapability,
  type TeachingOperationAccessDeniedReason,
} from "../../course-access";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

type TeachingOperationExportRouteContext = {
  params: Promise<{ manifestId: string }>;
};

type TeachingOperationExportGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
  readManagedCourseOwnership?: ReadManagedTeachingCourseOwnership;
  readTeachingCourseCapability?: ReadTeachingCourseCapability;
};

type AuthenticatedTeacher = {
  sessionId: string;
  actorId: string;
  role: "teacher";
  authenticatedAt: string;
  expiresAt: string;
};

type AuthenticatedStudent = {
  actorId: string;
  role: "student";
};

type TeachingOperationExportAccessDeniedReason =
  | TeachingOperationAccessDeniedReason
  | "authenticated-session-required"
  | "teacher-auth-provider-not-production-ready"
  | "teacher-role-required";

export function createTeachingOperationExportGetHandler(
  deps: TeachingOperationExportGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const usesDefaultCourseOwnership = deps.getTeachingOperationCourseOwnership === undefined;
  const getTeachingOperationCourseOwnership =
    deps.getTeachingOperationCourseOwnership ??
    createTeachingOperationCourseOwnershipAdapter({
      env,
      fetch: deps.fetch,
    });
  const readManagedCourseOwnership =
    deps.readManagedCourseOwnership ??
    (usesDefaultCourseOwnership
      ? createTeachingManagedCourseOwnershipAdapter({ env, fetch: deps.fetch })
      : undefined);
  const readTeachingCourseCapability =
    deps.readTeachingCourseCapability ??
    createTeachingCourseCapabilityAdapter({ env, now: deps.now });

  return async function GET(request: Request, context: TeachingOperationExportRouteContext) {
    const traceId = readSafeTraceId(request);
    try {
      const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
      if (
        isTeachingOperationProductionRuntime(env) &&
        authProviderContract.productionStatus !== "ready"
      ) {
        return jsonResponse(503, {
          error: "UAIS teacher auth provider is not production-ready.",
          traceId,
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
          error: "UAIS teacher role is required.",
          traceId,
          access: createDeniedAccess("teacher-role-required"),
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
          traceId,
          access: createDeniedAccess("authenticated-session-required"),
          redaction: createRedaction(),
        }, traceId);
      }

      const params = await context.params;
      assertSafeTeachingOperationExportManifestId(params.manifestId);
      const manifest = await readExportManifest({
        env,
        fetch: deps.fetch,
        manifestId: params.manifestId,
      });

      if (!manifest) {
        throw new TeachingOperationStoreError(404, "Teaching export manifest not found.");
      }

      const access = await authorizeTeachingOperationCourseAccess({
        request,
        authenticatedTeacher,
        courseId: manifest.courseId,
        operationId: "data-export",
        actionSlot: "primary",
        getTeachingOperationCourseOwnership,
        readManagedCourseOwnership,
        readTeachingCourseCapability,
      });
      if (access.status === "denied") {
        return jsonResponse(getTeachingOperationAccessDeniedStatus(access.reasonCode), {
          error: getTeachingOperationExportAccessDeniedError(access.reasonCode),
          traceId,
          access:
            access.reasonCode === "teacher-course-ownership-check-failed" ||
            access.reasonCode === "teacher-course-capability-check-failed"
              ? createDeniedAccess(access.reasonCode, access.actor)
              : access,
          redaction: createRedaction(),
        }, traceId);
      }

      return Response.json(manifest, {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${manifest.manifestId}.json"`,
          "x-uais-trace-id": traceId,
        },
      });
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

async function readExportManifest(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  manifestId: string;
}) {
  const externalReadRequired =
    isTeachingOperationProductionRuntime(input.env) ||
    isExternalTeachingOperationsBackendSelected(input.env);
  if (externalReadRequired) {
    const externalManifest = await readExternalCourseManagementExportManifest(input);
    if (externalManifest) {
      return externalManifest;
    }
    if (!isExternalTeachingCourseManagementBackendSelected(input.env)) {
      throw new TeachingOperationStoreError(
        503,
        "Teaching operation export readback requires external course management storage.",
      );
    }
    return undefined;
  }

  const localManifest = await readTeachingOperationExportManifest({
    dataDir: resolveTeachingOperationDataDir(input.env.UAIS_TEACHING_OPERATIONS_DATA_DIR),
    manifestId: input.manifestId,
  });
  if (localManifest) {
    return localManifest;
  }

  return readExternalCourseManagementExportManifest(input);
}

function isTeachingOperationProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function isExternalTeachingOperationsBackendSelected(env: Record<string, string | undefined>) {
  return env.UAIS_TEACHING_OPERATIONS_BACKEND?.trim().toLowerCase() === "external";
}

function isExternalTeachingCourseManagementBackendSelected(
  env: Record<string, string | undefined>,
) {
  return env.UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND?.trim().toLowerCase() === "external";
}

function assertSafeTeachingOperationExportManifestId(manifestId: string) {
  if (!isSafeTeachingOperationId(manifestId)) {
    throw new TeachingOperationStoreError(
      400,
      "UAIS teaching operation export manifest id is invalid.",
    );
  }
}

async function readExternalCourseManagementExportManifest(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  manifestId: string;
}): Promise<TeachingOperationExportManifest | undefined> {
  const repository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!repository) {
    return undefined;
  }

  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository,
  });
  const exportRecord = database.exportManifests?.find(
    (manifest) => manifest.teachingOperationManifestId === input.manifestId,
  );
  if (!exportRecord) {
    return undefined;
  }

  return createTeachingOperationManifestFromCourseManagementRecord(exportRecord);
}

function createTeachingOperationManifestFromCourseManagementRecord(
  record: TeachingCourseExportManifestRecord,
): TeachingOperationExportManifest {
  return {
    manifestId: record.teachingOperationManifestId,
    operationId: "data-export",
    courseId: record.courseId,
    actorId: record.createdBy,
    createdAt: record.createdAt,
    datasets: record.datasetScopes,
    formats: record.formats,
    redactionScope: {
      studentPrivateNotes: "excluded",
      credentials: "excluded",
      localPaths: "excluded",
    },
    redaction: record.redaction,
  };
}

function getTeachingOperationExportAccessDeniedError(
  reasonCode: TeachingOperationExportAccessDeniedReason,
) {
  if (reasonCode === "teacher-course-ownership-check-failed") {
    return "UAIS teaching operation export course ownership check failed.";
  }
  if (reasonCode === "teacher-course-capability-check-failed") {
    return "UAIS teaching operation export course capability check failed.";
  }
  if (reasonCode.startsWith("collaborator-") || reasonCode === "active-teacher-principal-required") {
    return "UAIS teaching operation export course capability is required.";
  }
  return "UAIS teaching operation export course ownership is required.";
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

  const authenticatedTeacher = readUaisAuthenticatedTeacherSessionFromSignedCookies({
    request: input.request,
    secret,
    now: input.now,
  });
  if (
    !authenticatedTeacher ||
    !isSafeTeachingOperationId(authenticatedTeacher.actorId) ||
    !isSafeTeachingOperationId(authenticatedTeacher.sessionId)
  ) {
    return undefined;
  }

  return authenticatedTeacher;
}

function isSafeTeachingOperationId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function readAuthenticatedStudent(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}): AuthenticatedStudent | undefined {
  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  if (
    !claims ||
    claims.role !== "student" ||
    !isSafeTeachingOperationId(claims.account) ||
    !isSafeTeachingOperationId(claims.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: claims.account,
    role: "student",
  };
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function createErrorResponse(error: unknown, traceId: string) {
  if (error instanceof TeachingOperationStoreError) {
    return jsonResponse(error.status, {
      error: error.message,
      traceId,
      redaction: createRedaction(),
    }, traceId);
  }
  if (error instanceof TeachingCourseManagementStoreError) {
    return jsonResponse(error.status, {
      error: error.message,
      traceId,
      redaction: createRedaction(),
    }, traceId);
  }

  return jsonResponse(500, {
    error: "Teaching export manifest request failed.",
    traceId,
    redaction: createRedaction(),
  }, traceId);
}

function jsonResponse(status: number, body: unknown, traceId: string) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
    },
  });
}

function createDeniedAccess(
  reasonCode: TeachingOperationExportAccessDeniedReason,
  actor?: { actorId: string; role: "teacher" },
  resource?: { courseId: string },
) {
  return {
    status: "denied" as const,
    reasonCode,
    responsibleSession: "S12" as const,
    ...(actor ? { actor } : {}),
    ...(resource ? { resource } : {}),
    redaction: createRedaction(),
  };
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
