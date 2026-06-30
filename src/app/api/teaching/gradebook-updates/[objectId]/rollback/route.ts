import { randomUUID } from "node:crypto";
import {
  createUaisTeachingOperationExternalAppendAdapter,
  createUaisTeachingOperationExternalAuditReadAdapter,
  readTeachingGradebookUpdate,
  resolveTeachingOperationDataDir,
  rollbackExternalTeachingGradebookRelease,
  rollbackTeachingGradebookRelease,
  TeachingOperationStoreError,
  type TeachingOperationDomainProjection,
  type TeachingOperationGradebookUpdateProjection,
  type TeachingOperationAuditRequestSource,
  type TeachingGradebookReleaseRollbackProviderReceipt,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeacherAiOwnershipAdapter } from "@/lib/server/teacher-ai-ownership-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

export const dynamic = "force-dynamic";

type TeachingGradebookReleaseRollbackRouteContext = {
  params: { objectId: string } | Promise<{ objectId: string }>;
};

type TeachingGradebookReleaseRollbackPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
};

type AuthenticatedTeacher = {
  sessionId: string;
  actorId: string;
  role: "teacher";
  authenticatedAt: string;
  expiresAt: string;
};

export const POST = createTeachingGradebookReleaseRollbackPostHandler();

export function createTeachingGradebookReleaseRollbackPostHandler(
  deps: TeachingGradebookReleaseRollbackPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const readOwnership = createUaisTeacherAiOwnershipAdapter({
    env,
    fetch: deps.fetch,
  });

  return async function POST(
    request: Request,
    context: TeachingGradebookReleaseRollbackRouteContext,
  ) {
    const traceId = readSafeTraceId(request);
    try {
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

      const params = await context.params;
      assertSafeGradebookUpdateObjectId(params.objectId);

      const readExternalTeachingOperationAudit =
        createUaisTeachingOperationExternalAuditReadAdapter({
          env,
          fetch: deps.fetch,
        });
      const appendExternalTeachingOperation =
        createUaisTeachingOperationExternalAppendAdapter({
          env,
          fetch: deps.fetch,
        });
      if (
        isTeachingOperationProductionRuntime(env) &&
        (!readExternalTeachingOperationAudit || !appendExternalTeachingOperation)
      ) {
        throw new TeachingOperationStoreError(
          503,
          "Production teaching gradebook release rollback requires external teaching operations storage.",
        );
      }

      const dataDir = resolveTeachingOperationDataDir(env.UAIS_TEACHING_OPERATIONS_DATA_DIR);
      const externalAudit = readExternalTeachingOperationAudit
        ? await readExternalTeachingOperationAudit({ teacherId: authenticatedTeacher.actorId })
        : undefined;
      const releasedUpdate = externalAudit
        ? findLatestGradebookUpdateProjection(externalAudit.domainProjections, params.objectId)
        : await readTeachingGradebookUpdate({
            dataDir,
            objectId: params.objectId,
          });
      if (!releasedUpdate) {
        throw new TeachingOperationStoreError(404, "Gradebook update was not found.");
      }

      if (!readOwnership) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          traceId,
          access: createDeniedAccess("teacher-course-ownership-required", releasedUpdate.courseId),
          redaction: createRedaction(),
        }, traceId);
      }

      const ownership = await readOwnership({
        request,
        authenticatedSession: authenticatedTeacher,
      });
      if (
        !ownership ||
        ownership.teacherId !== authenticatedTeacher.actorId ||
        !new Set(ownership.courseIds ?? []).has(releasedUpdate.courseId)
      ) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          traceId,
          access: createDeniedAccess("course-scope-denied", releasedUpdate.courseId),
          redaction: createRedaction(),
        }, traceId);
      }

      const rollbackInput = {
        objectId: releasedUpdate.objectId,
        actorId: authenticatedTeacher.actorId,
        audit: {
          traceId,
          actorRole: "teacher" as const,
          authMode: "signed-teacher-session" as const,
          requestSource: readAuditRequestSource(request),
        },
        now: deps.now ?? new Date(),
      };
      const providerRollback = await syncGradebookReleaseRollbackProvider({
        env,
        fetch: deps.fetch ?? fetch,
        gradebookUpdate: releasedUpdate,
        actorId: rollbackInput.actorId,
        traceId,
        rolledBackAt: rollbackInput.now.toISOString(),
      });
      const { gradebookUpdate, notification, receipt } =
        appendExternalTeachingOperation && externalAudit
          ? await rollbackExternalTeachingGradebookRelease({
              gradebookUpdate: releasedUpdate,
              actorId: rollbackInput.actorId,
              audit: rollbackInput.audit,
              appendExternalTeachingOperation,
              providerRollback,
              now: rollbackInput.now,
            })
          : await rollbackTeachingGradebookRelease({
              dataDir,
              objectId: rollbackInput.objectId,
              actorId: rollbackInput.actorId,
              audit: rollbackInput.audit,
              providerRollback,
              now: rollbackInput.now,
            });

      return jsonResponse(200, {
        gradebookUpdate,
        notification,
        receipt,
        traceId,
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

function isTeachingOperationProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function assertSafeGradebookUpdateObjectId(objectId: string) {
  if (!isSafeTeachingOperationId(objectId)) {
    throw new TeachingOperationStoreError(
      400,
      "UAIS teaching gradebook update id is invalid.",
    );
  }
}

async function syncGradebookReleaseRollbackProvider(input: {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  actorId: string;
  traceId: string;
  rolledBackAt: string;
}): Promise<TeachingGradebookReleaseRollbackProviderReceipt | undefined> {
  const provider = input.env.UAIS_GRADEBOOK_RELEASE_PROVIDER?.trim();
  if (!provider) {
    if (isTeachingOperationProductionRuntime(input.env)) {
      throw new TeachingOperationStoreError(
        503,
        "Gradebook release rollback provider is not configured.",
      );
    }
    return undefined;
  }
  if (provider !== "external") {
    throw new TeachingOperationStoreError(
      503,
      "Gradebook release rollback provider is not production-ready.",
    );
  }

  const providerUrl = input.env.UAIS_GRADEBOOK_RELEASE_PROVIDER_URL?.trim();
  const providerToken = input.env.UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN?.trim();
  if (!providerUrl || !providerToken || providerToken.length < 32) {
    throw new TeachingOperationStoreError(
      503,
      "Gradebook release rollback provider is not configured.",
    );
  }
  const normalizedProviderUrl = readExternalGradebookProviderUrl(
    providerUrl,
    "Gradebook release rollback provider URL is invalid.",
    input.env,
  );

  const response = await input.fetch(normalizedProviderUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${providerToken}`,
      "content-type": "application/json",
      "x-uais-trace-id": input.traceId,
    },
    body: JSON.stringify({
      action: "rollback-gradebook-release",
      actorId: input.actorId,
      courseId: input.gradebookUpdate.courseId,
      gradebookUpdateId: input.gradebookUpdate.objectId,
      providerReleaseId: input.gradebookUpdate.providerReleaseId,
      traceId: input.traceId,
      rollbackPolicy: "teacher-confirmed-grade-release-rollback",
      rolledBackAt: input.rolledBackAt,
      gradebookUpdate: input.gradebookUpdate,
      redaction: createRedaction(),
    }),
  });
  if (!response.ok) {
    throw new TeachingOperationStoreError(
      502,
      "Gradebook release rollback provider sync failed.",
    );
  }

  const providerReceipt = await response.json().catch(() => undefined);
  if (!isRecord(providerReceipt) || providerReceipt.status !== "release-rolled-back") {
    throw new TeachingOperationStoreError(
      502,
      "Gradebook release rollback provider sync failed.",
    );
  }

  return {
    providerRollbackStatus: "gradebook-provider-release-rolled-back",
    providerRollbackId: requireSafeProviderId(providerReceipt.rollbackId, "provider rollback id"),
    providerRolledBackAt: input.rolledBackAt,
  };
}

function readExternalGradebookProviderUrl(
  rawUrl: string,
  invalidMessage: string,
  env: Record<string, string | undefined>,
) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TeachingOperationStoreError(503, invalidMessage);
  }
  const allowLocalProductionFixtureUrl =
    env.UAIS_DEPLOYMENT_ENV === "local-production" &&
    env.UAIS_LOCAL_PRODUCTION_E2E_ALLOW_INSECURE_TEACHING_PROVIDER_FIXTURE === "1" &&
    url.protocol === "http:" &&
    !Boolean(url.username || url.password) &&
    isDisallowedExternalGradebookProviderHost(url.hostname);
  if (
    !allowLocalProductionFixtureUrl &&
    (url.protocol !== "https:" ||
      Boolean(url.username || url.password) ||
      isDisallowedExternalGradebookProviderHost(url.hostname))
  ) {
    throw new TeachingOperationStoreError(503, invalidMessage);
  }
  return url.toString();
}

function isDisallowedExternalGradebookProviderHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  const octets = host.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    !octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return false;
  }

  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function findLatestGradebookUpdateProjection(
  projections: TeachingOperationDomainProjection[],
  objectId: string,
): TeachingOperationGradebookUpdateProjection | undefined {
  for (let index = projections.length - 1; index >= 0; index -= 1) {
    const projection = projections[index];
    if (projection.objectType === "gradebook-update" && projection.objectId === objectId) {
      return projection;
    }
  }
  return undefined;
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
}) {
  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    {
      env: input.env,
      now: input.now,
    },
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
    role: "student" as const,
  };
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function readAuditRequestSource(request: Request): TeachingOperationAuditRequestSource {
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

function requireSafeProviderId(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 120 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new TeachingOperationStoreError(502, `Invalid ${label}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createErrorResponse(error: unknown, traceId: string) {
  if (error instanceof TeachingOperationStoreError) {
    return jsonResponse(error.status, {
      error: error.message,
      traceId,
      redaction: createRedaction(),
    }, traceId);
  }

  return jsonResponse(500, {
    error: "Teaching gradebook release rollback request failed.",
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
  reasonCode:
    | "authenticated-session-required"
    | "teacher-role-required"
    | "teacher-auth-provider-not-production-ready"
    | "teacher-course-ownership-required"
    | "course-scope-denied",
  courseId?: string,
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(courseId ? { resource: { courseId } } : {}),
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
