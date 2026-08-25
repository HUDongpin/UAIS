import { randomUUID } from "node:crypto";
import {
  createTeachingCourseCollaboratorPostgresStore,
  TeachingCourseCollaboratorStoreError,
} from "@/lib/server/teaching-course-collaborator-postgres-store";
import {
  TeachingCourseCollaboratorValidationError,
  isTeachingCourseCollaboratorPublicId,
  isTeachingCourseCollaboratorRequestId,
  isTeachingCourseCollaboratorUuid,
  type TeachingCourseCollaboratorGrant,
  type TeachingCourseCollaboratorPersistedReceipt,
  type TeachingCourseCollaboratorReceipt,
} from "@/lib/server/teaching-course-collaborator-types";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

type TeachingCourseCollaboratorCollectionRouteContext = {
  params: Promise<{ courseId: string }>;
};

type TeachingCourseCollaboratorGrantRouteContext = {
  params: Promise<{ courseId: string; grantId: string }>;
};

type CommonDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
};

type ListCollaborators = (input: {
  actorAccount: string;
  courseId: string;
}) => Promise<TeachingCourseCollaboratorGrant[]>;

type GrantCollaborator = (input: {
  actorAccount: string;
  courseId: string;
  recipientEmail: string;
  role: unknown;
  scopes: unknown;
  expiresAt?: unknown;
  idempotencyKey: string;
  traceId: string;
}) => Promise<TeachingCourseCollaboratorReceipt>;

type RevokeCollaborator = (input: {
  actorAccount: string;
  courseId: string;
  grantId: string;
  idempotencyKey: string;
  traceId: string;
}) => Promise<TeachingCourseCollaboratorPersistedReceipt>;

type GetDeps = CommonDeps & {
  listCollaborators?: ListCollaborators;
};

type PostDeps = CommonDeps & {
  grantCollaborator?: GrantCollaborator;
};

type DeleteDeps = CommonDeps & {
  revokeCollaborator?: RevokeCollaborator;
};

type TeacherAccess =
  | {
      status: "authorized";
      actorAccount: string;
    }
  | {
      status: "denied";
      httpStatus: 401 | 403;
      reasonCode:
        | "authenticated-session-required"
        | "teacher-role-required"
        | "teacher-write-session-required"
        | "teacher-session-identity-mismatch";
    };

const maxBodyBytes = 20_000;
const safeActorPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const safeTracePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

export function createTeachingCourseCollaboratorGetHandler(
  deps: GetDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(
    request: Request,
    context: TeachingCourseCollaboratorCollectionRouteContext,
  ) {
    const traceId = readSafeTraceId(request);
    try {
      const access = authorizeTeacherAppSession({
        request,
        env,
        now: deps.now,
        requireWriteSession: false,
      });
      if (access.status === "denied") {
        return createAccessDeniedResponse(access, traceId);
      }
      const { courseId: routeCourseId } = await context.params;
      const courseId = requireCourseId(routeCourseId);
      const listCollaborators =
        deps.listCollaborators ??
        createTeachingCourseCollaboratorPostgresStore({ env }).list;
      const grants = await listCollaborators({
        actorAccount: access.actorAccount,
        courseId,
      });

      return jsonResponse(200, traceId, {
        status: "read",
        courseId,
        grants,
        traceId,
        redaction: createRedaction(),
      });
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

export function createTeachingCourseCollaboratorPostHandler(
  deps: PostDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: TeachingCourseCollaboratorCollectionRouteContext,
  ) {
    const traceId = readSafeTraceId(request);
    try {
      const access = authorizeTeacherAppSession({
        request,
        env,
        now: deps.now,
        requireWriteSession: true,
      });
      if (access.status === "denied") {
        return createAccessDeniedResponse(access, traceId);
      }
      const { courseId: routeCourseId } = await context.params;
      const courseId = requireCourseId(routeCourseId);
      const idempotencyKey = readIdempotencyKey(request);
      const draft = readGrantDraft(await readJsonBody(request));
      const grantCollaborator =
        deps.grantCollaborator ??
        createTeachingCourseCollaboratorPostgresStore({ env }).grant;
      const receipt = await grantCollaborator({
        actorAccount: access.actorAccount,
        courseId,
        recipientEmail: draft.recipientEmail,
        role: draft.role,
        scopes: draft.scopes,
        ...(draft.expiresAt === undefined
          ? {}
          : { expiresAt: draft.expiresAt }),
        idempotencyKey,
        traceId,
      });

      return jsonResponse(
        receipt.status === "already-active" ? 200 : 201,
        traceId,
        {
          status: receipt.status,
          receipt,
          traceId,
          redaction: createRedaction(),
        },
      );
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

export function createTeachingCourseCollaboratorDeleteHandler(
  deps: DeleteDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function DELETE(
    request: Request,
    context: TeachingCourseCollaboratorGrantRouteContext,
  ) {
    const traceId = readSafeTraceId(request);
    try {
      const access = authorizeTeacherAppSession({
        request,
        env,
        now: deps.now,
        requireWriteSession: true,
      });
      if (access.status === "denied") {
        return createAccessDeniedResponse(access, traceId);
      }
      const {
        courseId: routeCourseId,
        grantId: routeGrantId,
      } = await context.params;
      const courseId = requireCourseId(routeCourseId);
      const grantId = requireGrantId(routeGrantId);
      const idempotencyKey = readIdempotencyKey(request);
      const revokeCollaborator =
        deps.revokeCollaborator ??
        createTeachingCourseCollaboratorPostgresStore({ env }).revoke;
      const receipt = await revokeCollaborator({
        actorAccount: access.actorAccount,
        courseId,
        grantId,
        idempotencyKey,
        traceId,
      });

      return jsonResponse(200, traceId, {
        status: receipt.status,
        receipt,
        traceId,
        redaction: createRedaction(),
      });
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

function authorizeTeacherAppSession(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
  requireWriteSession: boolean;
}): TeacherAccess {
  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  if (!claims) {
    return {
      status: "denied",
      httpStatus: 401,
      reasonCode: "authenticated-session-required",
    };
  }
  if (claims.role !== "teacher") {
    return {
      status: "denied",
      httpStatus: 403,
      reasonCode: "teacher-role-required",
    };
  }
  if (
    !safeActorPattern.test(claims.account) ||
    !safeActorPattern.test(claims.sessionId)
  ) {
    return {
      status: "denied",
      httpStatus: 401,
      reasonCode: "authenticated-session-required",
    };
  }
  if (input.requireWriteSession) {
    const teacherSigningSecret =
      input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
    const teacherSession = teacherSigningSecret
      ? readUaisAuthenticatedTeacherSessionFromSignedCookies({
          request: input.request,
          secret: teacherSigningSecret,
          now: input.now,
        })
      : undefined;
    if (!teacherSession) {
      return {
        status: "denied",
        httpStatus: 401,
        reasonCode: "teacher-write-session-required",
      };
    }
    if (teacherSession.actorId !== claims.account) {
      return {
        status: "denied",
        httpStatus: 403,
        reasonCode: "teacher-session-identity-mismatch",
      };
    }
  }
  return {
    status: "authorized",
    actorAccount: claims.account,
  };
}

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) {
    throw new TeachingCourseCollaboratorStoreError(
      400,
      "request-body-required",
    );
  }
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new TeachingCourseCollaboratorStoreError(
      413,
      "request-body-too-large",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TeachingCourseCollaboratorStoreError(
      400,
      "request-body-invalid-json",
    );
  }
}

function readGrantDraft(value: unknown) {
  if (!isRecord(value)) {
    throw new TeachingCourseCollaboratorStoreError(
      400,
      "request-body-object-required",
    );
  }
  if (typeof value.recipientEmail !== "string") {
    throw new TeachingCourseCollaboratorStoreError(
      400,
      "recipient-email-invalid",
    );
  }
  return {
    recipientEmail: value.recipientEmail,
    role: value.role,
    scopes: value.scopes,
    ...(value.expiresAt === undefined
      ? {}
      : { expiresAt: value.expiresAt }),
  };
}

function readIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || !isTeachingCourseCollaboratorRequestId(value)) {
    throw new TeachingCourseCollaboratorStoreError(
      400,
      "idempotency-key-required",
    );
  }
  return value;
}

function requireCourseId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : value;
  if (!isTeachingCourseCollaboratorPublicId(normalized)) {
    throw new TeachingCourseCollaboratorStoreError(400, "course-id-invalid");
  }
  return normalized;
}

function requireGrantId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : value;
  if (!isTeachingCourseCollaboratorUuid(normalized)) {
    throw new TeachingCourseCollaboratorStoreError(400, "grant-id-invalid");
  }
  return normalized.toLowerCase();
}

function createAccessDeniedResponse(
  access: Extract<TeacherAccess, { status: "denied" }>,
  traceId: string,
) {
  return jsonResponse(access.httpStatus, traceId, {
    status: "denied",
    reasonCode: access.reasonCode,
    traceId,
    redaction: createRedaction(),
  });
}

function createErrorResponse(error: unknown, traceId: string) {
  if (error instanceof TeachingCourseCollaboratorValidationError) {
    return jsonResponse(400, traceId, {
      status: "invalid",
      reasonCode: error.reasonCode,
      traceId,
      redaction: createRedaction(),
    });
  }
  if (error instanceof TeachingCourseCollaboratorStoreError) {
    return jsonResponse(error.status, traceId, {
      status: readErrorStatus(error.status),
      reasonCode: error.reasonCode,
      traceId,
      redaction: createRedaction(),
    });
  }
  return jsonResponse(500, traceId, {
    status: "failed",
    reasonCode: "collaborator-request-failed",
    traceId,
    redaction: createRedaction(),
  });
}

function readErrorStatus(status: number) {
  if (status === 400 || status === 413) return "invalid";
  if (status === 401 || status === 403) return "denied";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 503) return "unavailable";
  return "failed";
}

function readSafeTraceId(request: Request) {
  const candidate = request.headers.get("x-uais-trace-id")?.trim();
  return candidate && safeTracePattern.test(candidate)
    ? candidate
    : `trace-collaborator-${randomUUID()}`;
}

function jsonResponse(status: number, traceId: string, body: unknown) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
    },
  });
}

function createRedaction() {
  return {
    secrets: "omitted" as const,
    recipientEmail: "omitted" as const,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
