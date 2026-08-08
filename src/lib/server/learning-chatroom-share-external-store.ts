import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import {
  createEmptyLearningChatroomShareDatabase,
  LearningChatroomShareStoreError,
  normalizeLearningChatroomShareDatabase,
  type LearningChatroomShareDatabase,
  type LearningChatroomShareRepository,
  type LearningChatroomShareStorageDescriptor,
} from "@/lib/server/learning-chatroom-share-store";
import {
  isUaisProductionDatabaseAdapterEvidence,
  isUaisProductionRuntime,
} from "@/lib/server/production-database-adapter-evidence";

// External-storage adapter for share links, the sibling of the transcript
// adapter. Until this existed the share store's `repository` seam had no
// factory, so a deployed runtime always fell through to the local JSON branch
// and `assertLearningChatroomShareLocalJsonRuntimeAllowed` refused it: minting
// and the public `/share` page both failed closed in production while every
// local run passed.
//
// A share record names a room that the public page then renders live, so it
// follows the same durability decision as the course records the room is
// authorized against - one backend setting rather than a second switch that
// could leave a deployment with durable courses and vanishing share links.
const learningChatroomShareBackendEnvName =
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND" as const;

const externalLearningChatroomShareStorage: LearningChatroomShareStorageDescriptor = {
  shareStoragePolicy: "external-redacted-learning-chatroom-shares",
  storageWritePolicy: "external-optimistic-snapshot-replace",
};

export function createUaisLearningChatroomShareRepository(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): LearningChatroomShareRepository | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: learningChatroomShareBackendEnvName,
    value: input.env[learningChatroomShareBackendEnvName],
    responsibleSession: "S12",
    env: input.env,
  });

  // `undefined` is the local-JSON answer, not a failure: the caller falls back
  // to the file store, which is allowed everywhere except a production runtime.
  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new LearningChatroomShareStoreError(
      503,
      "Learning chatroom share storage backend is not ready.",
    );
  }

  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new LearningChatroomShareStoreError(
      503,
      "Learning chatroom share external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;
  const databaseUrl = `${config.baseUrl}/learning-chatroom-shares/database`;

  return {
    storage: externalLearningChatroomShareStorage,
    read: async () => {
      const response = await fetchImpl(databaseUrl, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      });

      // A 404 is an empty store in development. In production it means the
      // resource is not actually provisioned, and answering "no shares" there
      // would silently turn every existing link into a 404 page.
      if (response.status === 404) {
        if (isUaisProductionRuntime(input.env)) {
          throw new LearningChatroomShareStoreError(
            502,
            "External learning chatroom share read acknowledgement is missing production database adapter evidence.",
          );
        }
        return { database: createEmptyLearningChatroomShareDatabase() };
      }
      if (!response.ok) {
        throw new LearningChatroomShareStoreError(
          502,
          "External learning chatroom share read failed.",
        );
      }

      const body = (await response.json()) as {
        database?: LearningChatroomShareDatabase;
        productionDatabaseAdapter?: unknown;
        revision?: unknown;
      };
      if (
        isUaisProductionRuntime(input.env) &&
        !isUaisProductionDatabaseAdapterEvidence(body.productionDatabaseAdapter)
      ) {
        throw new LearningChatroomShareStoreError(
          502,
          "External learning chatroom share read acknowledgement is missing production database adapter evidence.",
        );
      }
      const revision = typeof body.revision === "string" ? body.revision.trim() : "";
      if (isUaisProductionRuntime(input.env) && !revision) {
        throw new LearningChatroomShareStoreError(
          502,
          "External learning chatroom share read acknowledgement is missing snapshot revision.",
        );
      }

      return {
        database: body.database
          ? normalizeLearningChatroomShareDatabase(body.database)
          : createEmptyLearningChatroomShareDatabase(),
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
          action: "replace-learning-chatroom-shares-database",
          ...(expectedRevision ? { expectedRevision } : {}),
          database,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      // 409 is the optimistic-concurrency signal the store retries on; anything
      // else is a genuine failure and must not look like a successful mint.
      if (response.status === 409) {
        throw new LearningChatroomShareStoreError(
          409,
          "External learning chatroom share snapshot changed; retry required.",
        );
      }
      if (!response.ok) {
        throw new LearningChatroomShareStoreError(
          502,
          "External learning chatroom share persistence failed.",
        );
      }
      const acknowledgement = await response.json().catch(() => undefined);
      if (
        isUaisProductionRuntime(input.env) &&
        !isUaisProductionDatabaseAdapterEvidence(
          isRecord(acknowledgement) ? acknowledgement.productionDatabaseAdapter : undefined,
        )
      ) {
        throw new LearningChatroomShareStoreError(
          502,
          "External learning chatroom share persistence acknowledgement is missing production database adapter evidence.",
        );
      }
      // A service that acknowledges before it has actually swapped the snapshot
      // would otherwise let the mint route answer 201 with a link whose record
      // was never stored. Requiring the new revision in production is what makes
      // "persisted" mean persisted.
      const acknowledgementRevision =
        isRecord(acknowledgement) && typeof acknowledgement.revision === "string"
          ? acknowledgement.revision.trim()
          : "";
      if (isUaisProductionRuntime(input.env) && !acknowledgementRevision) {
        throw new LearningChatroomShareStoreError(
          502,
          "External learning chatroom share persistence acknowledgement is missing snapshot revision.",
        );
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
