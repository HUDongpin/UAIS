import { randomUUID } from "node:crypto";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  deleteTeachingLearningGroup,
  readTeachingCourseManagementSnapshot,
  readTeachingLearningGroupValidation,
  renameTeachingLearningGroup,
  resolveTeachingCourseManagementDataDir,
  type TeachingCourseManagementAuthSessionSummary,
  type TeachingCourseManagementReceipt,
  type TeachingCourseManagementRepository,
  type TeachingCourseManagementRepositorySnapshot,
  TeachingCourseManagementStoreError,
  type TeachingLearningGroupMemberInput,
  type TeachingLearningGroupRecord,
  updateTeachingLearningGroupMembers,
} from "@/lib/server/teaching-course-management-store";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

// PATCH (rename / replace members) and DELETE for a single learning group. Same
// auth chain as the sibling create route. A PATCH carrying BOTH a rename and a
// member replacement applies members first, then the rename, and reports one
// receipt per applied mutation so the audit trail keeps one event per action.
export const dynamic = "force-dynamic";

type TeachingLearningGroupRecordRouteContext = {
  params:
    | { courseId: string; groupId: string }
    | Promise<{ courseId: string; groupId: string }>;
};

type TeachingLearningGroupRecordHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
};

type AuthenticatedTeacher = {
  actorId: string;
  role: "teacher";
  authSession: TeachingCourseManagementAuthSessionSummary;
};

type LearningGroupRouteParams = {
  courseId: string;
  groupId: string;
};

type DeniedAccessReasonCode =
  | "authenticated-session-required"
  | "teacher-role-required"
  | "teacher-auth-provider-not-production-ready"
  | "teacher-course-ownership-required"
  | "teacher-learning-group-ownership-required";

type LearningGroupPatchInput = {
  groupName?: string;
  members?: TeachingLearningGroupMemberInput[];
};

const maxBodyBytes = 20_000;

export const PATCH = createTeachingLearningGroupPatchHandler();
export const DELETE = createTeachingLearningGroupDeleteHandler();

export function createTeachingLearningGroupPatchHandler(
  deps: TeachingLearningGroupRecordHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function PATCH(
    request: Request,
    context: TeachingLearningGroupRecordRouteContext,
  ) {
    const traceId = readSafeTraceId(request);
    let authenticatedTeacher: AuthenticatedTeacher | undefined;
    let routeParams: LearningGroupRouteParams | undefined;
    try {
      const gate = await openTeachingLearningGroupRequest({
        request,
        context,
        env,
        now: deps.now,
        fetch: deps.fetch,
        traceId,
      });
      if (gate.status === "response") {
        return gate.response;
      }
      authenticatedTeacher = gate.authenticatedTeacher;
      routeParams = gate.routeParams;

      const patch = parseLearningGroupPatch(await readJsonBody(request));
      const receipts: TeachingCourseManagementReceipt[] = [];
      let group: TeachingLearningGroupRecord | undefined;

      if (patch.members) {
        const result = await updateTeachingLearningGroupMembers({
          dataDir: gate.dataDir,
          repository: gate.repository,
          actorId: gate.authenticatedTeacher.actorId,
          courseId: gate.routeParams.courseId,
          groupId: gate.routeParams.groupId,
          members: patch.members,
          traceId,
          now: deps.now,
          audit: gate.audit,
        });
        group = result.group;
        receipts.push(result.receipt);
      }
      if (patch.groupName !== undefined) {
        const result = await renameTeachingLearningGroup({
          dataDir: gate.dataDir,
          repository: gate.repository,
          actorId: gate.authenticatedTeacher.actorId,
          courseId: gate.routeParams.courseId,
          groupId: gate.routeParams.groupId,
          groupName: patch.groupName,
          traceId,
          now: deps.now,
          audit: gate.audit,
        });
        group = result.group;
        receipts.push(result.receipt);
      }

      return jsonResponse(200, {
        group,
        receipt: receipts[receipts.length - 1],
        receipts,
        traceId,
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId, authenticatedTeacher, routeParams);
    }
  };
}

export function createTeachingLearningGroupDeleteHandler(
  deps: TeachingLearningGroupRecordHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function DELETE(
    request: Request,
    context: TeachingLearningGroupRecordRouteContext,
  ) {
    const traceId = readSafeTraceId(request);
    let authenticatedTeacher: AuthenticatedTeacher | undefined;
    let routeParams: LearningGroupRouteParams | undefined;
    try {
      const gate = await openTeachingLearningGroupRequest({
        request,
        context,
        env,
        now: deps.now,
        fetch: deps.fetch,
        traceId,
      });
      if (gate.status === "response") {
        return gate.response;
      }
      authenticatedTeacher = gate.authenticatedTeacher;
      routeParams = gate.routeParams;

      // The group's chatroom transcript is intentionally retained and orphaned;
      // deleting the group is what makes the room inaccessible.
      const { group, receipt } = await deleteTeachingLearningGroup({
        dataDir: gate.dataDir,
        repository: gate.repository,
        actorId: gate.authenticatedTeacher.actorId,
        courseId: gate.routeParams.courseId,
        groupId: gate.routeParams.groupId,
        traceId,
        now: deps.now,
        audit: gate.audit,
      });

      return jsonResponse(200, {
        group,
        receipt,
        traceId,
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId, authenticatedTeacher, routeParams);
    }
  };
}

async function openTeachingLearningGroupRequest(input: {
  request: Request;
  context: TeachingLearningGroupRecordRouteContext;
  env: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  traceId: string;
}): Promise<
  | { status: "response"; response: Response }
  | {
      status: "authorized";
      authenticatedTeacher: AuthenticatedTeacher;
      routeParams: LearningGroupRouteParams;
      dataDir: string;
      repository?: TeachingCourseManagementRepository;
      audit: {
        requestSource: ReturnType<typeof readAuditRequestSource>;
        authSession: TeachingCourseManagementAuthSessionSummary;
      };
    }
> {
  const { request, env, traceId } = input;
  // Students AND admins are refused here; an admin never holds a signed teacher
  // session, so falling through would answer a misleading 401.
  if (readNonTeacherAppSessionRole({ request, env, now: input.now })) {
    return {
      status: "response",
      response: jsonResponse(403, {
        error: "UAIS teacher role is required.",
        traceId,
        access: createDeniedAccess("teacher-role-required"),
        redaction: createRedaction(),
      }, traceId),
    };
  }

  const authenticatedTeacher = readAuthenticatedTeacher({
    request,
    env,
    now: input.now,
  });
  if (!authenticatedTeacher) {
    return {
      status: "response",
      response: jsonResponse(401, {
        error: "UAIS teacher authentication is required.",
        traceId,
        access: createDeniedAccess("authenticated-session-required"),
        redaction: createRedaction(),
      }, traceId),
    };
  }

  const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
  if (
    isTeachingLearningGroupApiProductionRuntime(env) &&
    authProviderContract.productionStatus !== "ready"
  ) {
    return {
      status: "response",
      response: jsonResponse(503, {
        error: "UAIS teacher auth provider is not production-ready.",
        traceId,
        access: createDeniedAccess(
          "teacher-auth-provider-not-production-ready",
          authenticatedTeacher,
        ),
        authProviderContract,
        redaction: createRedaction(),
      }, traceId),
    };
  }

  const courseManagementRepository = createUaisTeachingCourseManagementRepository({
    env,
    fetch: input.fetch,
  });
  if (!courseManagementRepository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(env);
  }

  const params = await input.context.params;
  const routeParams: LearningGroupRouteParams = {
    courseId: requireSafeTeachingLearningGroupId(params.courseId, "course id"),
    groupId: requireSafeTeachingLearningGroupId(params.groupId, "learning group id"),
  };
  const dataDir = resolveTeachingCourseManagementDataDir(env.UAIS_TEACHING_COURSES_DATA_DIR);
  const access = await authorizeTeachingLearningGroupCourseAccessBeforeBody({
    dataDir,
    repository: courseManagementRepository,
    authenticatedTeacher,
    courseId: routeParams.courseId,
  });
  if (access.status === "denied") {
    return {
      status: "response",
      response: jsonResponse(403, {
        error: "UAIS teaching learning group course ownership is required.",
        traceId,
        access,
        redaction: createRedaction(),
      }, traceId),
    };
  }

  return {
    status: "authorized",
    authenticatedTeacher,
    routeParams,
    dataDir,
    ...(courseManagementRepository
      ? {
          repository: createTeachingCourseManagementRepositoryWithInitialRead(
            courseManagementRepository,
            access.snapshot,
          ),
        }
      : {}),
    audit: {
      requestSource: readAuditRequestSource(request),
      authSession: authenticatedTeacher.authSession,
    },
  };
}

async function authorizeTeachingLearningGroupCourseAccessBeforeBody(input: {
  dataDir: string;
  repository?: TeachingCourseManagementRepository;
  authenticatedTeacher: AuthenticatedTeacher;
  courseId: string;
}) {
  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: input.dataDir,
    repository: input.repository,
    courseId: input.courseId,
  });
  const course = snapshot.database.courses.find((item) => item.courseId === input.courseId);
  if (!course) {
    throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
  }
  if (course.ownerTeacherId !== input.authenticatedTeacher.actorId) {
    return createDeniedAccess(
      "teacher-course-ownership-required",
      input.authenticatedTeacher,
      { courseId: input.courseId },
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
    resource: { courseId: input.courseId },
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

function parseLearningGroupPatch(value: unknown): LearningGroupPatchInput {
  if (!isRecord(value)) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Learning group request body must be an object.",
    );
  }
  const patch: LearningGroupPatchInput = {
    ...(Object.hasOwn(value, "members")
      ? { members: Array.isArray(value.members) ? value.members : [] }
      : {}),
    ...(Object.hasOwn(value, "groupName")
      ? {
          groupName: requireString(value.groupName, "Learning group name is required."),
        }
      : {}),
  };
  if (patch.members === undefined && patch.groupName === undefined) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Learning group update requires a name or a member list.",
    );
  }
  return patch;
}

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new TeachingCourseManagementStoreError(
      413,
      "Learning group request body is too large.",
    );
  }
  if (!text.trim()) {
    throw new TeachingCourseManagementStoreError(400, "Learning group request body is required.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TeachingCourseManagementStoreError(400, "Learning group request body must be JSON.");
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
    !isSafeTeachingLearningGroupActorId(session.actorId) ||
    !isSafeTeachingLearningGroupActorId(session.sessionId)
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

function readNonTeacherAppSessionRole(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}) {
  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  if (
    !claims ||
    (claims.role !== "student" && claims.role !== "admin") ||
    !isSafeTeachingLearningGroupActorId(claims.account) ||
    !isSafeTeachingLearningGroupActorId(claims.sessionId)
  ) {
    return undefined;
  }
  return claims.role;
}

function isSafeTeachingLearningGroupActorId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function isTeachingLearningGroupApiProductionRuntime(env: Record<string, string | undefined>) {
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

function requireSafeTeachingLearningGroupId(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new TeachingCourseManagementStoreError(400, `Invalid ${label}.`);
  }
  return value;
}

function createErrorResponse(
  error: unknown,
  traceId: string,
  authenticatedTeacher?: AuthenticatedTeacher,
  routeParams?: LearningGroupRouteParams,
) {
  if (error instanceof TeachingCourseManagementStoreError) {
    const access = createDeniedAccessForStoreError(error, authenticatedTeacher, routeParams);
    const validation = readTeachingLearningGroupValidation(error);
    return jsonResponse(error.status, {
      error: error.message,
      traceId,
      // Stable classification beside the prose, set today for snapshot
      // contention so a client can retry instead of parsing the message.
      ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}),
      ...(access ? { access } : {}),
      ...(validation ? { validation } : {}),
      redaction: createRedaction(),
    }, traceId);
  }

  return jsonResponse(500, {
    error: "Teaching learning group request failed.",
    traceId,
    redaction: createRedaction(),
  }, traceId);
}

function createDeniedAccessForStoreError(
  error: TeachingCourseManagementStoreError,
  authenticatedTeacher?: AuthenticatedTeacher,
  routeParams?: LearningGroupRouteParams,
) {
  if (error.status !== 403) {
    return undefined;
  }
  if (error.message === "Teaching course ownership is required.") {
    return createDeniedAccess(
      "teacher-course-ownership-required",
      authenticatedTeacher,
      routeParams,
    );
  }
  if (error.message === "Teaching learning group ownership is required.") {
    return createDeniedAccess(
      "teacher-learning-group-ownership-required",
      authenticatedTeacher,
      routeParams,
    );
  }
  return undefined;
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
  reasonCode: DeniedAccessReasonCode,
  actor?: { actorId: string; role: "teacher" },
  resource?: { courseId: string; groupId?: string },
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
