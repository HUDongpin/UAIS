import { randomUUID } from "node:crypto";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  createTeachingClassRecord,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  type TeachingCourseManagementAuthSessionSummary,
  type TeachingCourseManagementRepository,
  type TeachingCourseManagementRepositorySnapshot,
  TeachingCourseManagementStoreError,
  type TeachingClassDraftInput,
} from "@/lib/server/teaching-course-management-store";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

type TeachingCourseClassRouteContext = {
  params: Promise<{ courseId: string }>;
};

type TeachingCourseClassPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
};

type AuthenticatedTeacher = {
  actorId: string;
  role: "teacher";
  authSession: TeachingCourseManagementAuthSessionSummary;
};

type AuthenticatedStudent = {
  actorId: string;
  role: "student";
};

const maxBodyBytes = 20_000;

export function createTeachingCourseClassPostHandler(
  deps: TeachingCourseClassPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(request: Request, context: TeachingCourseClassRouteContext) {
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
        isTeachingClassApiProductionRuntime(env) &&
        authProviderContract.productionStatus !== "ready"
      ) {
        return jsonResponse(503, {
          error: "UAIS teacher auth provider is not production-ready.",
          traceId,
          access: createDeniedAccess(
            "teacher-auth-provider-not-production-ready",
            authenticatedTeacher,
          ),
          authProviderContract,
          redaction: createRedaction(),
        }, traceId);
      }
      const courseManagementRepository = createUaisTeachingCourseManagementRepository({
        env,
        fetch: deps.fetch,
      });
      if (!courseManagementRepository) {
        assertTeachingCourseManagementLocalJsonRuntimeAllowed(env);
      }

      const params = await context.params;
      const dataDir = resolveTeachingCourseManagementDataDir(env.UAIS_TEACHING_COURSES_DATA_DIR);
      const access = await authorizeTeachingClassCourseAccessBeforeBody({
        dataDir,
        repository: courseManagementRepository,
        authenticatedTeacher,
        courseId: params.courseId,
      });
      if (access.status === "denied") {
        return jsonResponse(403, {
          error: "UAIS teaching class course ownership is required.",
          traceId,
          access,
          redaction: createRedaction(),
        }, traceId);
      }
      const classRecordRepository = courseManagementRepository
        ? createTeachingCourseManagementRepositoryWithInitialRead(
            courseManagementRepository,
            access.snapshot,
          )
        : undefined;
      const body = await readJsonBody(request);
      let classRecordResult: Awaited<ReturnType<typeof createTeachingClassRecord>>;
      try {
        classRecordResult = await createTeachingClassRecord({
          dataDir,
          repository: classRecordRepository,
          actorId: authenticatedTeacher.actorId,
          courseId: params.courseId,
          draft: parseClassDraft(body),
          traceId,
          now: deps.now,
          audit: {
            requestSource: readAuditRequestSource(request),
            authSession: authenticatedTeacher.authSession,
          },
        });
      } catch (error) {
        if (isTeachingCourseOwnershipError(error)) {
          return jsonResponse(403, {
            error: "UAIS teaching class course ownership is required.",
            traceId,
            access: createDeniedAccess(
              "teacher-course-ownership-required",
              authenticatedTeacher,
              { courseId: params.courseId },
            ),
            redaction: createRedaction(),
          }, traceId);
        }
        throw error;
      }
      const { classItem, receipt } = classRecordResult;

      return jsonResponse(201, {
        classItem,
        receipt,
        traceId,
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

async function authorizeTeachingClassCourseAccessBeforeBody(input: {
  dataDir: string;
  repository?: TeachingCourseManagementRepository;
  authenticatedTeacher: AuthenticatedTeacher;
  courseId: string;
}) {
  const courseId = requireSafeTeachingClassCourseId(input.courseId);
  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: input.dataDir,
    repository: input.repository,
    courseId,
  });
  const course = snapshot.database.courses.find((item) => item.courseId === courseId);
  if (!course) {
    throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
  }
  if (course.ownerTeacherId !== input.authenticatedTeacher.actorId) {
    return createDeniedAccess(
      "teacher-course-ownership-required",
      input.authenticatedTeacher,
      { courseId },
    );
  }

  return {
    status: "authorized" as const,
    reasonCode: "authorized" as const,
    responsibleSession: "S12" as const,
    actor: {
      actorId: input.authenticatedTeacher.actorId,
      role: input.authenticatedTeacher.role,
    },
    resource: { courseId },
    redaction: createRedaction(),
    snapshot,
  };
}

function createTeachingCourseManagementRepositoryWithInitialRead(
  repository: TeachingCourseManagementRepository,
  initialSnapshot: TeachingCourseManagementRepositorySnapshot,
): TeachingCourseManagementRepository {
  let nextSnapshot: TeachingCourseManagementRepositorySnapshot | undefined = initialSnapshot;

  return {
    ...repository,
    read: async () => {
      if (nextSnapshot) {
        const snapshot = nextSnapshot;
        nextSnapshot = undefined;
        return snapshot;
      }
      return repository.read();
    },
  };
}

function parseClassDraft(value: unknown): TeachingClassDraftInput {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(400, "Class request body must be an object.");
  }
  return {
    className: requireString(value.className, "Class name is required."),
    ...(typeof value.semester === "string" ? { semester: value.semester } : {}),
  };
}

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new TeachingCourseManagementStoreError(413, "Class request body is too large.");
  }
  if (!text.trim()) {
    throw new TeachingCourseManagementStoreError(400, "Class request body is required.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TeachingCourseManagementStoreError(400, "Class request body must be JSON.");
  }
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
    !isSafeTeachingClassActorId(session.actorId) ||
    !isSafeTeachingClassActorId(session.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: session.actorId,
    role: "teacher",
    authSession: {
      sessionId: session.sessionId,
      authenticatedAt: session.authenticatedAt,
      expiresAt: session.expiresAt,
    },
  };
}

function isSafeTeachingClassActorId(value: string) {
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
    !isSafeTeachingClassActorId(claims.account) ||
    !isSafeTeachingClassActorId(claims.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: claims.account,
    role: "student",
  };
}

function isTeachingClassApiProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function readAuditRequestSource(request: Request) {
  return {
    userAgent: sanitizeRequestSourceHeader(request.headers.get("user-agent")) ?? "unknown",
    ipAddress: "redacted" as const,
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

function requireString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TeachingCourseManagementStoreError(400, message);
  }
  return value;
}

function requireSafeTeachingClassCourseId(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new TeachingCourseManagementStoreError(400, "Invalid course id.");
  }
  return value;
}

function createErrorResponse(error: unknown, traceId: string) {
  if (error instanceof TeachingCourseManagementStoreError) {
    return jsonResponse(error.status, {
      error: error.message,
      traceId,
      // Stable classification beside the prose, set today for snapshot
      // contention so a client can retry instead of parsing the message.
      ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}),
      redaction: createRedaction(),
    }, traceId);
  }

  return jsonResponse(500, {
    error: "Teaching class management request failed.",
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
    | "teacher-course-ownership-required",
  actor?: { actorId: string; role: "teacher" },
  resource?: { courseId: string },
) {
  return {
    status: "denied" as const,
    reasonCode,
    responsibleSession: "S12" as const,
    ...(actor ? { actor: { actorId: actor.actorId, role: actor.role } } : {}),
    ...(resource ? { resource } : {}),
    redaction: createRedaction(),
  };
}

function isTeachingCourseOwnershipError(error: unknown) {
  return (
    error instanceof TeachingCourseManagementStoreError &&
    error.status === 403 &&
    error.message === "Teaching course ownership is required."
  );
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
