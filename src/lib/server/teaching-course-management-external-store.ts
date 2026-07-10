import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import {
  TeachingCourseManagementStoreError,
  type TeachingCourseManagementDatabase,
  type TeachingCourseManagementRepository,
  type TeachingCourseManagementStorageDescriptor,
} from "@/lib/server/teaching-course-management-store";
import {
  isUaisProductionDatabaseAdapterEvidence,
  isUaisProductionRuntime,
} from "@/lib/server/production-database-adapter-evidence";
import {
  createUaisTeachingCourseManagementPostgresRepository,
  isUaisTeachingCourseManagementPostgresSelector,
} from "@/lib/server/teaching-course-management-postgres-store";

const externalTeachingCourseManagementStorage: TeachingCourseManagementStorageDescriptor = {
  recordStoragePolicy: "external-redacted-teaching-course-management-snapshot",
  auditStoragePolicy: "external-redacted-teaching-course-management-audit-log",
  storageWritePolicy: "external-optimistic-snapshot-replace",
};

export function createUaisTeachingCourseManagementRepository(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingCourseManagementRepository | undefined {
  if (
    isUaisTeachingCourseManagementPostgresSelector(
      input.env.UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND,
    )
  ) {
    return createUaisTeachingCourseManagementPostgresRepository({ env: input.env });
  }

  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
    value: input.env.UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingCourseManagementStoreError(
      503,
      "Teaching course management storage backend is not ready.",
    );
  }

  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingCourseManagementStoreError(
      503,
      "Teaching course management external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;
  const databaseUrl = `${config.baseUrl}/teaching-course-management/database`;

  return {
    storage: externalTeachingCourseManagementStorage,
    read: async () => {
      const response = await fetchImpl(databaseUrl, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 404) {
        if (isUaisProductionRuntime(input.env)) {
          throw new TeachingCourseManagementStoreError(
            502,
            "External teaching course management read acknowledgement is missing production database adapter evidence.",
          );
        }
        return {
          database: createEmptyDatabase(),
        };
      }
      if (!response.ok) {
        throw new TeachingCourseManagementStoreError(
          502,
          "External teaching course management read failed.",
        );
      }

      const body = (await response.json()) as {
        database?: TeachingCourseManagementDatabase;
        productionDatabaseAdapter?: unknown;
        revision?: unknown;
      };
      if (
        isUaisProductionRuntime(input.env) &&
        !isUaisProductionDatabaseAdapterEvidence(body.productionDatabaseAdapter)
      ) {
        throw new TeachingCourseManagementStoreError(
          502,
          "External teaching course management read acknowledgement is missing production database adapter evidence.",
        );
      }
      const revision = typeof body.revision === "string" ? body.revision.trim() : "";
      if (isUaisProductionRuntime(input.env) && !revision) {
        throw new TeachingCourseManagementStoreError(
          502,
          "External teaching course management read acknowledgement is missing snapshot revision.",
        );
      }

      return {
        database: body.database ?? createEmptyDatabase(),
        ...(revision ? { revision } : {}),
      };
    },
    write: async ({ database, expectedRevision }) => {
      const response = await fetchImpl(databaseUrl, {
        method: "PUT",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "replace-teaching-course-management-database",
          ...(expectedRevision ? { expectedRevision } : {}),
          database,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 409) {
        throw new TeachingCourseManagementStoreError(
          409,
          "External teaching course management snapshot changed; retry required.",
        );
      }
      if (!response.ok) {
        const diagnostics = await createExternalTeachingCourseManagementWriteDiagnostics(
          response,
        );
        throw new TeachingCourseManagementStoreError(
          502,
          "External teaching course management persistence failed.",
          diagnostics,
        );
      }
      const acknowledgement = await response.json().catch(() => undefined);
      if (
        isUaisProductionRuntime(input.env) &&
        !isUaisProductionDatabaseAdapterEvidence(
          isRecord(acknowledgement)
            ? acknowledgement.productionDatabaseAdapter
            : undefined,
        )
      ) {
        throw new TeachingCourseManagementStoreError(
          502,
          "External teaching course management persistence acknowledgement is missing production database adapter evidence.",
        );
      }
      const acknowledgementRevision =
        isRecord(acknowledgement) && typeof acknowledgement.revision === "string"
          ? acknowledgement.revision.trim()
          : "";
      if (isUaisProductionRuntime(input.env) && !acknowledgementRevision) {
        throw new TeachingCourseManagementStoreError(
          502,
          "External teaching course management persistence acknowledgement is missing snapshot revision.",
        );
      }
    },
  };
}

function createEmptyDatabase(): TeachingCourseManagementDatabase {
  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    courses: [],
    classes: [],
    memberships: [],
    auditEvents: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function createExternalTeachingCourseManagementWriteDiagnostics(response: Response) {
  const body = await response.json().catch(() => undefined);
  const upstreamError =
    isRecord(body) &&
    typeof body.error === "string" &&
    isSafeExternalDiagnosticText(body.error)
      ? body.error.slice(0, 240)
      : undefined;
  return {
    externalTeachingCourseManagement: {
      status: "failed",
      upstreamStatus: response.status,
      ...(upstreamError ? { upstreamError } : {}),
      valueRedacted: true,
    },
  };
}

function isSafeExternalDiagnosticText(value: string) {
  return (
    !/https?:\/\//i.test(value) &&
    !/bearer\s+[a-z0-9._-]+/i.test(value) &&
    !/token|secret|password|api[_-]?key/i.test(value) &&
    !value.includes("/Users/") &&
    !value.includes("\\")
  );
}
