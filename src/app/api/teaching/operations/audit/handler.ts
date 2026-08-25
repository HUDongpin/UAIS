import { randomUUID } from "node:crypto";
import { getUaisCoreDatabaseReadiness } from "@/lib/db/core-database";
import {
  normalizeExternalTeachingOperationAuditReadbackRecord,
  isTeachingOperationProductionDatabaseAdapterEvidence,
  normalizeTeachingOperationAuditReadbackDomainProjection,
  normalizeTeachingOperationAuditReadbackEvent,
  readTeachingOperationDatabase,
  resolveTeachingOperationDataDir,
  TeachingOperationStoreError,
  type TeachingOperationAuditEvent,
  type TeachingOperationDomainProjection,
  type TeachingOperationProductionDatabaseAdapterEvidence,
  type TeachingOperationRecord,
  type TeachingOperationRollbackProjection,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeacherAiOwnershipAdapter } from "@/lib/server/teacher-ai-ownership-store";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import type { TeachingCourseCapabilityDecision } from "@/lib/server/teaching-course-collaborator-access";
import { createTeachingCourseCollaboratorPostgresStore } from "@/lib/server/teaching-course-collaborator-postgres-store";
import { resolveTeachingOperationCollaboratorCapability } from "@/lib/server/teaching-operation-collaborator-policy";

type TeachingOperationAuditGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
  readTeachingCourseCapability?: ReadTeachingCourseCapability;
  readExternalTeachingOperationAudit?: TeachingOperationExternalAuditAdapter;
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

type ReadTeachingCourseCapability = (input: {
  principalAccount: string;
  courseId: string;
  capability: unknown;
}) => Promise<TeachingCourseCapabilityDecision>;

type TeachingOperationExternalAuditAdapter = (input: {
  teacherId: string;
}) => Promise<{
  events: TeachingOperationAuditEvent[];
  records: TeachingOperationRecord[];
  domainProjections: TeachingOperationDomainProjection[];
  rollbackRecords: TeachingOperationRollbackReadbackRecord[];
  productionDatabaseAdapter?: TeachingOperationProductionDatabaseAdapterEvidence;
  storagePolicy: "external-redacted-teaching-operation-audit-log";
  storageWritePolicy: "external-append-only-audit-log";
}>;

type TeachingOperationAuditEvidenceSource = {
  events: TeachingOperationAuditEvent[];
  records: TeachingOperationRecord[];
  domainProjections: TeachingOperationDomainProjection[];
  rollbackRecords: TeachingOperationRollbackReadbackRecord[];
  productionDatabaseAdapter?: TeachingOperationProductionDatabaseAdapterEvidence;
  storagePolicy:
    | "external-redacted-teaching-operation-audit-log"
    | "local-json-teaching-operation-audit-log";
  storageWritePolicy:
    | "external-append-only-audit-log"
    | "read-only-local-json-file";
};

type TeachingOperationRollbackReadbackRecord = {
  rollbackId: string;
  action: "rollback-teaching-operation-record";
  teacherId: string;
  targetRecordId: string;
  courseId: string;
  targetOperationId: string;
  targetActionSlot: "primary" | "secondary";
  targetActionId: string;
  rollbackReason: string;
  status: "persisted";
  rolledBackAt: string;
  storagePolicy:
    | "external-redacted-teaching-operation-rollback"
    | "domain-projection-teaching-operation-rollback";
  storageWritePolicy:
    | "external-append-only-rollback-log"
    | "read-only-local-json-file";
  responsibleSession: "S12";
  redaction: ReturnType<typeof createRedaction>;
};

type TeachingOperationAuditAccessDeniedReason =
  | "authenticated-session-required"
  | "teacher-auth-provider-not-production-ready"
  | "teacher-role-required"
  | "teacher-course-ownership-required"
  | "teacher-course-ownership-check-failed"
  | "teacher-course-capability-check-failed"
  | Extract<
      TeachingCourseCapabilityDecision,
      { authorized: false }
    >["reasonCode"];

export function createTeachingOperationAuditGetHandler(
  deps: TeachingOperationAuditGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const getTeachingOperationCourseOwnership =
    deps.getTeachingOperationCourseOwnership ??
    createTeachingOperationCourseOwnershipAdapter({
      env,
      fetch: deps.fetch,
    });
  const readTeachingCourseCapability =
    deps.readTeachingCourseCapability ??
    createTeachingCourseCapabilityAdapter({ env, now: deps.now });

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
      let ownership: TeachingOperationCourseOwnership | undefined;
      let ownershipCheckFailed = false;
      if (getTeachingOperationCourseOwnership) {
        try {
          ownership = await getTeachingOperationCourseOwnership({
            request,
            authenticatedTeacher,
          });
        } catch {
          ownershipCheckFailed = true;
        }
      }
      const ownershipMatchesActor =
        ownership?.teacherId === authenticatedTeacher.actorId;
      if (!ownershipMatchesActor && !readTeachingCourseCapability) {
        const reasonCode = ownershipCheckFailed
          ? "teacher-course-ownership-check-failed"
          : "teacher-course-ownership-required";
        return jsonResponse(ownershipCheckFailed ? 503 : 403, {
          error: ownershipCheckFailed
            ? "UAIS teaching operation audit course ownership check failed."
            : "UAIS teaching operation course ownership is required.",
          traceId,
          access: createDeniedAccess(reasonCode, {
            actorId: authenticatedTeacher.actorId,
            role: authenticatedTeacher.role,
          }),
          redaction: createRedaction(),
        }, traceId);
      }
      const ownedCourseIds = ownershipMatchesActor && ownership
        ? [...new Set(ownership.courseIds ?? [])].sort()
        : [];
      const ownedCourseIdSet = new Set(ownedCourseIds);
      const externalAudit =
        deps.readExternalTeachingOperationAudit ??
        createUaisTeachingOperationExternalAuditAdapter({
          env,
          fetch: deps.fetch,
        });

      if (isTeachingOperationProductionRuntime(env) && !externalAudit) {
        throw new TeachingOperationStoreError(
          503,
          "Production teaching operation audit readback requires external storage.",
        );
      }

      let auditSource: TeachingOperationAuditEvidenceSource;
      if (externalAudit) {
        auditSource = await externalAudit({
          teacherId: authenticatedTeacher.actorId,
        });
      } else {
        const database = await readTeachingOperationDatabase({
          dataDir: resolveTeachingOperationDataDir(env.UAIS_TEACHING_OPERATIONS_DATA_DIR),
        });
        auditSource = {
          events: database.auditEvents,
          records: database.records,
          domainProjections: database.domainProjections,
          rollbackRecords: database.domainProjections
            .filter(isTeachingOperationRollbackProjection)
            .map(createLocalRollbackReadbackRecord),
          storagePolicy: "local-json-teaching-operation-audit-log",
          storageWritePolicy: "read-only-local-json-file",
        };
      }

      const visibility = await resolveTeachingOperationAuditVisibility({
        actorId: authenticatedTeacher.actorId,
        ownershipFallbackReason: ownershipMatchesActor
          ? undefined
          : ownershipCheckFailed
            ? "teacher-course-ownership-check-failed"
            : "teacher-course-ownership-required",
        ownedCourseIds,
        ownedCourseIdSet,
        source: auditSource,
        readTeachingCourseCapability,
      });
      if (visibility.status === "capability-check-failed") {
        return jsonResponse(503, {
          error: "UAIS teaching operation audit course capability check failed.",
          traceId,
          access: createDeniedAccess("teacher-course-capability-check-failed", {
            actorId: authenticatedTeacher.actorId,
            role: authenticatedTeacher.role,
          }),
          redaction: createRedaction(),
        }, traceId);
      }
      if (visibility.status === "denied") {
        const ownershipFailure =
          visibility.reasonCode === "teacher-course-ownership-check-failed";
        const ownershipRequired =
          visibility.reasonCode === "teacher-course-ownership-required";
        return jsonResponse(ownershipFailure ? 503 : 403, {
          error: ownershipFailure
            ? "UAIS teaching operation audit course ownership check failed."
            : ownershipRequired
              ? "UAIS teaching operation course ownership is required."
              : "UAIS teaching operation audit course capability is required.",
          traceId,
          access: createDeniedAccess(visibility.reasonCode, {
            actorId: authenticatedTeacher.actorId,
            role: authenticatedTeacher.role,
          }),
          redaction: createRedaction(),
        }, traceId);
      }

      return jsonResponse(200, {
        traceId,
        actorId: authenticatedTeacher.actorId,
        courseIds: visibility.courseIds,
        records: visibility.records,
        auditEvents: visibility.auditEvents,
        domainProjections: visibility.domainProjections,
        rollbackRecords: visibility.rollbackRecords,
        recordCount: visibility.records.length,
        auditEventCount: visibility.auditEvents.length,
        domainProjectionCount: visibility.domainProjections.length,
        rollbackRecordCount: visibility.rollbackRecords.length,
        ...(auditSource.productionDatabaseAdapter
          ? { productionDatabaseAdapter: auditSource.productionDatabaseAdapter }
          : {}),
        storagePolicy: auditSource.storagePolicy,
        storageWritePolicy: auditSource.storageWritePolicy,
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

function createTeachingCourseCapabilityAdapter(input: {
  env: Record<string, string | undefined>;
  now?: Date;
}): ReadTeachingCourseCapability | undefined {
  if (getUaisCoreDatabaseReadiness(input.env).status !== "ready") {
    return undefined;
  }
  const fixedNow = input.now;
  const store = createTeachingCourseCollaboratorPostgresStore({
    env: input.env,
    ...(fixedNow ? { now: () => fixedNow } : {}),
  });
  return async (request) => store.readCapability(request);
}

type TeachingOperationAuditVisibilityResult =
  | {
      status: "authorized";
      courseIds: string[];
      records: TeachingOperationRecord[];
      auditEvents: TeachingOperationAuditEvent[];
      domainProjections: TeachingOperationDomainProjection[];
      rollbackRecords: TeachingOperationRollbackReadbackRecord[];
    }
  | {
      status: "denied";
      reasonCode: TeachingOperationAuditAccessDeniedReason;
    }
  | {
      status: "capability-check-failed";
    };

async function resolveTeachingOperationAuditVisibility(input: {
  actorId: string;
  ownershipFallbackReason?: Extract<
    TeachingOperationAuditAccessDeniedReason,
    "teacher-course-ownership-required" | "teacher-course-ownership-check-failed"
  >;
  ownedCourseIds: string[];
  ownedCourseIdSet: Set<string>;
  source: TeachingOperationAuditEvidenceSource;
  readTeachingCourseCapability?: ReadTeachingCourseCapability;
}): Promise<TeachingOperationAuditVisibilityResult> {
  const collaboratorCandidates = new Map<
    string,
    {
      courseId: string;
      operationId: TeachingOperationRecord["operationId"];
      actionSlot: TeachingOperationRecord["actionSlot"];
      capability: NonNullable<
        ReturnType<typeof resolveTeachingOperationCollaboratorCapability>
      >;
    }
  >();
  let firstDeniedReason: TeachingOperationAuditAccessDeniedReason | undefined;

  for (const record of input.source.records) {
    if (
      record.actorId !== input.actorId ||
      typeof record.courseId !== "string" ||
      input.ownedCourseIdSet.has(record.courseId)
    ) {
      continue;
    }
    const capability = resolveTeachingOperationCollaboratorCapability({
      operationId: record.operationId,
      actionSlot: record.actionSlot,
    });
    if (!capability) {
      firstDeniedReason ??= "collaborator-scope-required";
      continue;
    }
    const key = createTeachingOperationCapabilityKey({
      courseId: record.courseId,
      operationId: record.operationId,
      actionSlot: record.actionSlot,
    });
    collaboratorCandidates.set(key, {
      courseId: record.courseId,
      operationId: record.operationId,
      actionSlot: record.actionSlot,
      capability,
    });
  }

  const authorizedCapabilityKeys = new Set<string>();
  const sortedCandidates = [...collaboratorCandidates.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [key, candidate] of sortedCandidates) {
    if (!input.readTeachingCourseCapability) {
      firstDeniedReason ??= "teacher-course-ownership-required";
      continue;
    }
    let decision: TeachingCourseCapabilityDecision;
    try {
      decision = await input.readTeachingCourseCapability({
        principalAccount: input.actorId,
        courseId: candidate.courseId,
        capability: candidate.capability,
      });
    } catch {
      return { status: "capability-check-failed" };
    }
    if (!decision.authorized) {
      firstDeniedReason ??= decision.reasonCode;
      continue;
    }
    authorizedCapabilityKeys.add(key);
  }

  const records = input.source.records.filter((record) => {
    if (typeof record.courseId !== "string") {
      return false;
    }
    if (input.ownedCourseIdSet.has(record.courseId)) {
      return true;
    }
    return (
      record.actorId === input.actorId &&
      authorizedCapabilityKeys.has(
        createTeachingOperationCapabilityKey({
          courseId: record.courseId,
          operationId: record.operationId,
          actionSlot: record.actionSlot,
        }),
      )
    );
  });
  const visibleRecordCourses = new Map(
    records.flatMap((record) =>
      typeof record.courseId === "string"
        ? [[record.recordId, record.courseId] as const]
        : [],
    ),
  );
  const collaboratorCourseIds = records
    .filter(
      (record) =>
        typeof record.courseId === "string" &&
        !input.ownedCourseIdSet.has(record.courseId),
    )
    .map((record) => record.courseId as string);
  const courseIds = [...new Set([...input.ownedCourseIds, ...collaboratorCourseIds])].sort();
  const auditEvents = input.source.events.filter((event) => {
    if (isAuditEventCourseVisible(event, input.ownedCourseIdSet)) {
      return true;
    }
    if (event.actorId !== input.actorId) {
      return false;
    }
    if (
      "courseId" in event &&
      typeof event.courseId === "string" &&
      "operationId" in event &&
      typeof event.operationId === "string" &&
      "actionSlot" in event &&
      (event.actionSlot === "primary" || event.actionSlot === "secondary")
    ) {
      return authorizedCapabilityKeys.has(
        createTeachingOperationCapabilityKey({
          courseId: event.courseId,
          operationId: event.operationId,
          actionSlot: event.actionSlot,
        }),
      );
    }
    return (
      "targetRecordId" in event &&
      typeof event.targetRecordId === "string" &&
      "courseId" in event &&
      typeof event.courseId === "string" &&
      visibleRecordCourses.get(event.targetRecordId) === event.courseId
    );
  });
  const domainProjections = input.source.domainProjections.filter((projection) => {
    if (input.ownedCourseIdSet.has(projection.courseId)) {
      return true;
    }
    if (
      "operationRecordId" in projection &&
      typeof projection.operationRecordId === "string" &&
      visibleRecordCourses.get(projection.operationRecordId) === projection.courseId
    ) {
      return true;
    }
    return (
      "targetRecordId" in projection &&
      typeof projection.targetRecordId === "string" &&
      visibleRecordCourses.get(projection.targetRecordId) === projection.courseId
    );
  });
  const rollbackRecords = input.source.rollbackRecords.filter(
    (rollbackRecord) =>
      rollbackRecord.teacherId === input.actorId &&
      (input.ownedCourseIdSet.has(rollbackRecord.courseId) ||
        visibleRecordCourses.get(rollbackRecord.targetRecordId) ===
          rollbackRecord.courseId),
  );

  if (
    input.ownedCourseIds.length === 0 &&
    authorizedCapabilityKeys.size === 0 &&
    (collaboratorCandidates.size > 0 || firstDeniedReason || input.ownershipFallbackReason)
  ) {
    return {
      status: "denied",
      reasonCode:
        firstDeniedReason ??
        input.ownershipFallbackReason ??
        "teacher-course-ownership-required",
    };
  }

  return {
    status: "authorized",
    courseIds,
    records,
    auditEvents,
    domainProjections,
    rollbackRecords,
  };
}

function createTeachingOperationCapabilityKey(input: {
  courseId: string;
  operationId: string;
  actionSlot: "primary" | "secondary";
}) {
  return `${input.courseId}\u0000${input.operationId}\u0000${input.actionSlot}`;
}

function createUaisTeachingOperationExternalAuditAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalAuditAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_OPERATIONS_BACKEND",
    value: input.env.UAIS_TEACHING_OPERATIONS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });
  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation audit external storage is not ready.",
    );
  }
  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation audit external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({ teacherId }) => {
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/audit`,
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
        "External teaching operation audit readback failed.",
      );
    }
    const body = await response.json();
    if (!isRecord(body)) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation audit readback response is invalid.",
      );
    }
    if ("teacherId" in body) {
      const responseTeacherId = readRequiredString(body.teacherId);
      if (responseTeacherId !== teacherId) {
        throw new TeachingOperationStoreError(
          502,
          "External teaching operation audit readback response is invalid.",
        );
      }
    }
    const events = Array.isArray(body.auditEvents)
      ? body.auditEvents
      : Array.isArray(body.events)
        ? body.events
        : [];
    const records = Array.isArray(body.records) ? body.records : [];
    const domainProjections = Array.isArray(body.domainProjections)
      ? body.domainProjections
      : [];
    const rollbackRecords = Array.isArray(body.rollbackRecords)
      ? body.rollbackRecords
      : Array.isArray(body.rollbacks)
        ? body.rollbacks
        : [];
    const productionDatabaseAdapter =
      isTeachingOperationProductionDatabaseAdapterEvidence(body.productionDatabaseAdapter)
        ? body.productionDatabaseAdapter
        : undefined;
    if (isTeachingOperationProductionRuntime(input.env) && !productionDatabaseAdapter) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation audit readback is missing production database adapter evidence.",
      );
    }

    try {
      return {
        events: events.map(normalizeTeachingOperationAuditReadbackEvent),
        records: records.map(normalizeExternalTeachingOperationAuditReadbackRecord),
        domainProjections: domainProjections.map(
          normalizeTeachingOperationAuditReadbackDomainProjection,
        ),
        rollbackRecords: rollbackRecords
          .map(normalizeExternalRollbackReadbackRecord)
          .filter(isDefined),
        ...(productionDatabaseAdapter ? { productionDatabaseAdapter } : {}),
        storagePolicy: "external-redacted-teaching-operation-audit-log",
        storageWritePolicy: "external-append-only-audit-log",
      };
    } catch (error) {
      if (error instanceof TeachingOperationStoreError) {
        throw new TeachingOperationStoreError(
          502,
          "External teaching operation audit readback response is invalid.",
        );
      }
      throw error;
    }
  };
}

function isTeachingOperationRollbackProjection(
  projection: TeachingOperationDomainProjection,
): projection is TeachingOperationRollbackProjection {
  return projection.objectType === "operation-rollback";
}

function createLocalRollbackReadbackRecord(
  projection: TeachingOperationRollbackProjection,
): TeachingOperationRollbackReadbackRecord {
  return {
    rollbackId: projection.objectId,
    action: "rollback-teaching-operation-record",
    teacherId: projection.rolledBackBy,
    targetRecordId: projection.targetRecordId,
    courseId: projection.courseId,
    targetOperationId: projection.targetOperationId,
    targetActionSlot: projection.targetActionSlot,
    targetActionId: projection.targetActionId,
    rollbackReason: projection.rollbackReason,
    status: "persisted",
    rolledBackAt: projection.rolledBackAt,
    storagePolicy: projection.storagePolicy,
    storageWritePolicy: "read-only-local-json-file",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeExternalRollbackReadbackRecord(
  value: unknown,
): TeachingOperationRollbackReadbackRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    value.action !== "rollback-teaching-operation-record" ||
    value.status !== "persisted" ||
    value.storagePolicy !== "external-redacted-teaching-operation-rollback" ||
    value.storageWritePolicy !== "external-append-only-rollback-log" ||
    value.responsibleSession !== "S12"
  ) {
    return undefined;
  }

  const rollbackId = readRequiredString(value.rollbackId);
  const teacherId = readRequiredString(value.teacherId);
  const targetRecordId = readRequiredString(value.targetRecordId);
  const courseId = readRequiredString(value.courseId);
  const targetOperationId = readRequiredString(value.targetOperationId);
  const targetActionSlot = readActionSlot(value.targetActionSlot);
  const targetActionId = readRequiredString(value.targetActionId);
  const rollbackReason = readRequiredString(value.rollbackReason);
  const rolledBackAt = readRequiredString(value.rolledBackAt);

  if (
    !rollbackId ||
    !teacherId ||
    !targetRecordId ||
    !courseId ||
    !targetOperationId ||
    !targetActionSlot ||
    !targetActionId ||
    !rollbackReason ||
    !rolledBackAt
  ) {
    return undefined;
  }

  return {
    rollbackId,
    action: "rollback-teaching-operation-record",
    teacherId,
    targetRecordId,
    courseId,
    targetOperationId,
    targetActionSlot,
    targetActionId,
    rollbackReason,
    status: "persisted",
    rolledBackAt,
    storagePolicy: "external-redacted-teaching-operation-rollback",
    storageWritePolicy: "external-append-only-rollback-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readActionSlot(value: unknown): "primary" | "secondary" | undefined {
  return value === "primary" || value === "secondary" ? value : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isAuditEventCourseVisible(
  event: TeachingOperationAuditEvent,
  courseIds: Set<string>,
) {
  if ("courseId" in event && typeof event.courseId === "string") {
    return courseIds.has(event.courseId);
  }
  if ("impactedCourseIds" in event) {
    return event.impactedCourseIds.some((courseId) => courseIds.has(courseId));
  }
  return false;
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function isSafeTeachingOperationId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function readAuthenticatedTeacher(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}) {
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

function isTeachingOperationProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
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
    error: "Teaching operation audit request failed.",
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
  reasonCode: TeachingOperationAuditAccessDeniedReason,
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
