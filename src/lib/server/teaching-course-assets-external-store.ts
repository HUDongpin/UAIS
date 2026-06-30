import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import {
  normalizeTeachingCourseAssetsDatabase,
  TeachingCourseAssetsStoreError,
  type TeachingCourseAssetsDatabase,
  type TeachingCourseAssetsRepository,
  type TeachingCourseAssetsStorageDescriptor,
} from "@/lib/server/teaching-course-assets-store";
import {
  isUaisProductionDatabaseAdapterEvidence,
  isUaisProductionRuntime,
} from "@/lib/server/production-database-adapter-evidence";

const externalTeachingCourseAssetsStorage: TeachingCourseAssetsStorageDescriptor = {
  assetStoragePolicy: "external-redacted-teaching-course-cover-assets",
  auditStoragePolicy: "external-redacted-teaching-course-cover-audit-log",
  storageWritePolicy: "external-optimistic-snapshot-replace",
};

export function createUaisTeachingCourseAssetsRepository(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingCourseAssetsRepository | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
    value: input.env.UAIS_TEACHING_COURSE_ASSETS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingCourseAssetsStoreError(
      503,
      "Teaching course cover asset storage backend is not ready.",
    );
  }

  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingCourseAssetsStoreError(
      503,
      "Teaching course cover asset external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;
  const databaseUrl = `${config.baseUrl}/teaching-course-assets/database`;

  return {
    storage: externalTeachingCourseAssetsStorage,
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
          throw new TeachingCourseAssetsStoreError(
            502,
            "External teaching course cover asset read acknowledgement is missing production database adapter evidence.",
          );
        }
        return {
          database: createEmptyDatabase(),
        };
      }
      if (!response.ok) {
        throw new TeachingCourseAssetsStoreError(
          502,
          "External teaching course cover asset read failed.",
        );
      }

      const body = (await response.json()) as {
        database?: TeachingCourseAssetsDatabase;
        productionDatabaseAdapter?: unknown;
        revision?: unknown;
      };
      if (
        isUaisProductionRuntime(input.env) &&
        !isUaisProductionDatabaseAdapterEvidence(body.productionDatabaseAdapter)
      ) {
        throw new TeachingCourseAssetsStoreError(
          502,
          "External teaching course cover asset read acknowledgement is missing production database adapter evidence.",
        );
      }
      const revision = typeof body.revision === "string" ? body.revision.trim() : "";
      if (isUaisProductionRuntime(input.env) && !revision) {
        throw new TeachingCourseAssetsStoreError(
          502,
          "External teaching course cover asset read acknowledgement is missing snapshot revision.",
        );
      }
      const database = body.database
        ? normalizeTeachingCourseAssetsDatabase(body.database)
        : createEmptyDatabase();

      return {
        database,
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
          action: "replace-teaching-course-assets-database",
          ...(expectedRevision ? { expectedRevision } : {}),
          database,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 409) {
        throw new TeachingCourseAssetsStoreError(
          409,
          "External teaching course cover asset snapshot changed; retry required.",
        );
      }
      if (!response.ok) {
        throw new TeachingCourseAssetsStoreError(
          502,
          "External teaching course cover asset persistence failed.",
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
        throw new TeachingCourseAssetsStoreError(
          502,
          "External teaching course cover asset persistence acknowledgement is missing production database adapter evidence.",
        );
      }
      const acknowledgementRevision =
        isRecord(acknowledgement) && typeof acknowledgement.revision === "string"
          ? acknowledgement.revision.trim()
          : "";
      if (isUaisProductionRuntime(input.env) && !acknowledgementRevision) {
        throw new TeachingCourseAssetsStoreError(
          502,
          "External teaching course cover asset persistence acknowledgement is missing snapshot revision.",
        );
      }
    },
  };
}

function createEmptyDatabase(): TeachingCourseAssetsDatabase {
  return {
    schemaVersion: "uais-teaching-course-assets-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    assets: [],
    auditEvents: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
