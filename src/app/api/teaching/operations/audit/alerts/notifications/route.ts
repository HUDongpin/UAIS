import { randomUUID } from "node:crypto";
import {
  isTeachingOperationProductionDatabaseAdapterEvidence,
  TeachingOperationStoreError,
  type TeachingOperationProductionDatabaseAdapterEvidence,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeacherAiOwnershipAdapter } from "@/lib/server/teacher-ai-ownership-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";

export const dynamic = "force-dynamic";

type TeachingOperationAuditAlertNotificationsPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
  enqueueExternalTeachingOperationAuditAlertNotifications?: TeachingOperationExternalAuditAlertNotificationAdapter;
  readExternalTeachingOperationAuditAlertNotifications?: TeachingOperationExternalAuditAlertNotificationReadAdapter;
};

type AuthenticatedTeacher = {
  sessionId: string;
  actorId: string;
  role: "teacher";
  authenticatedAt: string;
  expiresAt: string;
};

type TeachingOperationCourseOwnership = {
  teacherId: string;
  courseIds?: string[];
};

type GetTeachingOperationCourseOwnership = (input: {
  request: Request;
  authenticatedTeacher: AuthenticatedTeacher;
}) => Promise<TeachingOperationCourseOwnership | undefined>;

type TeachingOperationAuditAlertNotification = {
  notificationId: string;
  eventType: "teaching-operation-audit-alert-notification";
  deliveryChannel: "admin-outbox";
  deliveryStatus: "queued";
  teacherId: string;
  alertId: string;
  severity: "high";
  reason: "missing-course-context";
  auditId: string;
  traceId: string;
  actorId: string;
  operationId: string;
  actionSlot: "primary" | "secondary";
  actionId: string;
  requestedBy: string;
  requestedAt: string;
  queuedAt: string;
  storagePolicy: "external-redacted-teaching-operation-audit-alert-notification-outbox";
  responsibleSession: "S12";
  redaction: ReturnType<typeof createRedaction>;
};

type TeachingOperationAuditAlertNotificationDispatch = {
  teacherId: string;
  status: "queued" | "clear";
  eventType: "teaching-operation-audit-alert-notification-dispatch";
  deliveryChannel: "admin-outbox";
  storagePolicy: "external-redacted-teaching-operation-audit-alert-notification-outbox";
  storageWritePolicy: "external-append-only-notification-outbox";
  notificationCount: number;
  notifications: TeachingOperationAuditAlertNotification[];
  productionDatabaseAdapter?: TeachingOperationProductionDatabaseAdapterEvidence;
  responsibleSession: "S12";
  redaction: ReturnType<typeof createRedaction>;
};

type TeachingOperationAuditAlertNotificationOutbox = {
  teacherId: string;
  eventType: "teaching-operation-audit-alert-notification-outbox";
  deliveryChannel: "admin-outbox";
  storagePolicy: "external-redacted-teaching-operation-audit-alert-notification-outbox";
  recordCount: number;
  notifications: TeachingOperationAuditAlertNotification[];
  productionDatabaseAdapter?: TeachingOperationProductionDatabaseAdapterEvidence;
  responsibleSession: "S12";
  redaction: ReturnType<typeof createRedaction>;
};

type TeachingOperationExternalAuditAlertNotificationAdapter = (input: {
  teacherId: string;
  requestedBy: string;
  requestedAt: string;
}) => Promise<TeachingOperationAuditAlertNotificationDispatch>;

type TeachingOperationExternalAuditAlertNotificationReadAdapter = (input: {
  teacherId: string;
}) => Promise<TeachingOperationAuditAlertNotificationOutbox>;

type TeachingOperationAuditAlertNotificationsAccessDeniedReason =
  | "authenticated-session-required"
  | "teacher-auth-provider-not-production-ready"
  | "teacher-role-required"
  | "teacher-course-ownership-required";

export const POST = createTeachingOperationAuditAlertNotificationsPostHandler();
export const GET = createTeachingOperationAuditAlertNotificationsGetHandler();

export function createTeachingOperationAuditAlertNotificationsGetHandler(
  deps: TeachingOperationAuditAlertNotificationsPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const getTeachingOperationCourseOwnership =
    deps.getTeachingOperationCourseOwnership ??
    createTeachingOperationCourseOwnershipAdapter({
      env,
      fetch: deps.fetch,
    });

  return async function GET(request: Request) {
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

      if (!getTeachingOperationCourseOwnership) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          traceId,
          access: createDeniedAccess("teacher-course-ownership-required", {
            actorId: authenticatedTeacher.actorId,
            role: authenticatedTeacher.role,
          }),
          redaction: createRedaction(),
        }, traceId);
      }
      const ownership = await getTeachingOperationCourseOwnership({
        request,
        authenticatedTeacher,
      });
      if (!ownership || ownership.teacherId !== authenticatedTeacher.actorId) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          traceId,
          access: createDeniedAccess("teacher-course-ownership-required", {
            actorId: authenticatedTeacher.actorId,
            role: authenticatedTeacher.role,
          }),
          redaction: createRedaction(),
        }, traceId);
      }

      const readNotifications =
        deps.readExternalTeachingOperationAuditAlertNotifications ??
        createUaisTeachingOperationExternalAuditAlertNotificationReadAdapter({
          env,
          fetch: deps.fetch,
        });
      if (!readNotifications) {
        throw new TeachingOperationStoreError(
          503,
          "Teaching operation audit alert notification readback requires external storage.",
        );
      }

      const outbox = await readNotifications({
        teacherId: authenticatedTeacher.actorId,
      });
      assertProductionTeachingOperationAuditAlertNotificationDatabaseAdapterEvidence({
        env,
        value: outbox,
        error:
          "External teaching operation audit alert notification readback is missing production database adapter evidence.",
      });
      const courseIds = [...new Set(ownership.courseIds ?? [])].sort();

      return jsonResponse(200, {
        traceId,
        actorId: authenticatedTeacher.actorId,
        courseIds,
        ...outbox,
        responsibleSession: "S12",
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

export function createTeachingOperationAuditAlertNotificationsPostHandler(
  deps: TeachingOperationAuditAlertNotificationsPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const getTeachingOperationCourseOwnership =
    deps.getTeachingOperationCourseOwnership ??
    createTeachingOperationCourseOwnershipAdapter({
      env,
      fetch: deps.fetch,
    });

  return async function POST(request: Request) {
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

      if (!getTeachingOperationCourseOwnership) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          traceId,
          access: createDeniedAccess("teacher-course-ownership-required", {
            actorId: authenticatedTeacher.actorId,
            role: authenticatedTeacher.role,
          }),
          redaction: createRedaction(),
        }, traceId);
      }
      const ownership = await getTeachingOperationCourseOwnership({
        request,
        authenticatedTeacher,
      });
      if (!ownership || ownership.teacherId !== authenticatedTeacher.actorId) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          traceId,
          access: createDeniedAccess("teacher-course-ownership-required", {
            actorId: authenticatedTeacher.actorId,
            role: authenticatedTeacher.role,
          }),
          redaction: createRedaction(),
        }, traceId);
      }

      const enqueueNotifications =
        deps.enqueueExternalTeachingOperationAuditAlertNotifications ??
        createUaisTeachingOperationExternalAuditAlertNotificationAdapter({
          env,
          fetch: deps.fetch,
        });
      if (!enqueueNotifications) {
        throw new TeachingOperationStoreError(
          503,
          "Teaching operation audit alert notifications require external storage.",
        );
      }

      const requestedAt = (deps.now ?? new Date()).toISOString();
      const dispatch = await enqueueNotifications({
        teacherId: authenticatedTeacher.actorId,
        requestedBy: authenticatedTeacher.actorId,
        requestedAt,
      });
      assertProductionTeachingOperationAuditAlertNotificationDatabaseAdapterEvidence({
        env,
        value: dispatch,
        error:
          "External teaching operation audit alert notification dispatch is missing production database adapter evidence.",
      });
      const courseIds = [...new Set(ownership.courseIds ?? [])].sort();

      return jsonResponse(200, {
        traceId,
        actorId: authenticatedTeacher.actorId,
        courseIds,
        ...dispatch,
        responsibleSession: "S12",
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

function createTeachingOperationCourseOwnershipAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): GetTeachingOperationCourseOwnership | undefined {
  const readOwnership = createUaisTeacherAiOwnershipAdapter({
    env: input.env,
    fetch: input.fetch,
  });
  if (!readOwnership) {
    return undefined;
  }

  return async ({ request, authenticatedTeacher }) =>
    readOwnership({
      request,
      authenticatedSession: authenticatedTeacher,
    });
}

function createUaisTeachingOperationExternalAuditAlertNotificationAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalAuditAlertNotificationAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_OPERATIONS_BACKEND",
    value: input.env.UAIS_TEACHING_OPERATIONS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation audit alert notification external storage is not ready.",
    );
  }
  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation audit alert notification external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({ teacherId, requestedBy, requestedAt }) => {
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/audit/alerts/notifications`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${config.accessToken}`,
        },
        body: JSON.stringify({
          action: "enqueue-teaching-operation-audit-alert-notifications",
          requestedBy,
          requestedAt,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation audit alert notification request failed.",
      );
    }
    return normalizeTeachingOperationAuditAlertNotificationDispatch(
      await response.json(),
      {
        teacherId,
        productionRuntime: isTeachingOperationProductionRuntime(input.env),
      },
    );
  };
}

function createUaisTeachingOperationExternalAuditAlertNotificationReadAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalAuditAlertNotificationReadAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_OPERATIONS_BACKEND",
    value: input.env.UAIS_TEACHING_OPERATIONS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation audit alert notification external storage is not ready.",
    );
  }
  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation audit alert notification external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({ teacherId }) => {
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/audit/alerts/notifications`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation audit alert notification readback failed.",
      );
    }
    return normalizeTeachingOperationAuditAlertNotificationOutbox(
      await response.json(),
      {
        teacherId,
        productionRuntime: isTeachingOperationProductionRuntime(input.env),
      },
    );
  };
}

function normalizeTeachingOperationAuditAlertNotificationDispatch(
  value: unknown,
  fallback: {
    teacherId: string;
    productionRuntime?: boolean;
  },
): TeachingOperationAuditAlertNotificationDispatch {
  const record = isRecord(value) ? value : {};
  const productionDatabaseAdapter =
    isTeachingOperationProductionDatabaseAdapterEvidence(record.productionDatabaseAdapter)
      ? record.productionDatabaseAdapter
      : undefined;
  if (fallback.productionRuntime && !productionDatabaseAdapter) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation audit alert notification dispatch is missing production database adapter evidence.",
    );
  }
  const notifications = Array.isArray(record.notifications)
    ? record.notifications
        .map(normalizeTeachingOperationAuditAlertNotification)
        .filter((notification) =>
          isTeachingOperationAuditAlertNotificationVisibleToTeacher(
            notification,
            fallback.teacherId,
          ),
        )
    : [];
  return {
    teacherId: fallback.teacherId,
    status: notifications.length > 0 ? "queued" : "clear",
    eventType: "teaching-operation-audit-alert-notification-dispatch",
    deliveryChannel: "admin-outbox",
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-notification-outbox",
    storageWritePolicy: "external-append-only-notification-outbox",
    notificationCount: notifications.length,
    notifications,
    ...(productionDatabaseAdapter ? { productionDatabaseAdapter } : {}),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingOperationAuditAlertNotificationOutbox(
  value: unknown,
  fallback: {
    teacherId: string;
    productionRuntime?: boolean;
  },
): TeachingOperationAuditAlertNotificationOutbox {
  const record = isRecord(value) ? value : {};
  const productionDatabaseAdapter =
    isTeachingOperationProductionDatabaseAdapterEvidence(record.productionDatabaseAdapter)
      ? record.productionDatabaseAdapter
      : undefined;
  if (fallback.productionRuntime && !productionDatabaseAdapter) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation audit alert notification readback is missing production database adapter evidence.",
    );
  }
  const notifications = Array.isArray(record.notifications)
    ? record.notifications
        .map(normalizeTeachingOperationAuditAlertNotification)
        .filter((notification) =>
          isTeachingOperationAuditAlertNotificationVisibleToTeacher(
            notification,
            fallback.teacherId,
          ),
        )
    : [];
  return {
    teacherId: fallback.teacherId,
    eventType: "teaching-operation-audit-alert-notification-outbox",
    deliveryChannel: "admin-outbox",
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-notification-outbox",
    recordCount: notifications.length,
    notifications,
    ...(productionDatabaseAdapter ? { productionDatabaseAdapter } : {}),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function assertProductionTeachingOperationAuditAlertNotificationDatabaseAdapterEvidence(
  input: {
    env: Record<string, string | undefined>;
    value: {
      productionDatabaseAdapter?: TeachingOperationProductionDatabaseAdapterEvidence;
    };
    error: string;
  },
) {
  if (
    isTeachingOperationProductionRuntime(input.env) &&
    !isTeachingOperationProductionDatabaseAdapterEvidence(
      input.value.productionDatabaseAdapter,
    )
  ) {
    throw new TeachingOperationStoreError(502, input.error);
  }
}

function isTeachingOperationAuditAlertNotificationVisibleToTeacher(
  notification: TeachingOperationAuditAlertNotification,
  teacherId: string,
) {
  return (
    notification.teacherId === teacherId &&
    notification.actorId === teacherId
  );
}

function normalizeTeachingOperationAuditAlertNotification(
  value: unknown,
): TeachingOperationAuditAlertNotification {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation audit alert notification is invalid.",
    );
  }
  return {
    notificationId: readSafeId(value.notificationId, "teaching operation alert notification id"),
    eventType: "teaching-operation-audit-alert-notification",
    deliveryChannel: "admin-outbox",
    deliveryStatus: "queued",
    teacherId: readSafeId(value.teacherId, "teaching operation alert notification teacher id"),
    alertId: readSafeId(value.alertId, "teaching operation alert id"),
    severity: "high",
    reason: "missing-course-context",
    auditId: readSafeId(value.auditId, "teaching operation audit id"),
    traceId: readSafeId(value.traceId, "teaching operation audit trace id"),
    actorId: readSafeId(value.actorId, "teaching operation audit actor id"),
    operationId: readSafeId(value.operationId, "teaching operation id"),
    actionSlot: value.actionSlot === "secondary" ? "secondary" : "primary",
    actionId: readSafeId(value.actionId, "teaching operation action id"),
    requestedBy: readSafeId(value.requestedBy, "teaching operation alert notification requester"),
    requestedAt: readIsoString(value.requestedAt),
    queuedAt: readIsoString(value.queuedAt),
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-notification-outbox",
    responsibleSession: "S12",
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

  const authenticatedTeacher = readUaisAuthenticatedTeacherSessionFromSignedCookies({
    request: input.request,
    secret,
    now: input.now,
  });
  if (
    !authenticatedTeacher ||
    authenticatedTeacher.role !== "teacher" ||
    !isSafeTeachingOperationAuditAlertNotificationActorId(authenticatedTeacher.actorId) ||
    !isSafeTeachingOperationAuditAlertNotificationActorId(authenticatedTeacher.sessionId)
  ) {
    return undefined;
  }
  return authenticatedTeacher;
}

function readAuthenticatedStudent(input: {
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
    claims.role !== "student" ||
    !isSafeTeachingOperationAuditAlertNotificationActorId(claims.account) ||
    !isSafeTeachingOperationAuditAlertNotificationActorId(claims.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: claims.account,
    role: "student",
  };
}

function isSafeTeachingOperationAuditAlertNotificationActorId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function isTeachingOperationProductionRuntime(env: Record<string, string | undefined>) {
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

function readSafeId(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value.trim())) {
    throw new TeachingOperationStoreError(502, `${label} is invalid.`);
  }
  return value.trim();
}

function readIsoString(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TeachingOperationStoreError(502, "Teaching operation alert notification timestamp is invalid.");
  }
  return new Date(Date.parse(value)).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    error: "Teaching operation audit alert notification request failed.",
    traceId,
    redaction: createRedaction(),
  }, traceId);
}

function jsonResponse(status: number, body: unknown, traceId?: string) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...(traceId ? { "x-uais-trace-id": traceId } : {}),
    },
  });
}

function createDeniedAccess(
  reasonCode: TeachingOperationAuditAlertNotificationsAccessDeniedReason,
  actor?: { actorId: string; role: "teacher" },
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(actor ? { actor } : {}),
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
