import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import {
  createEmptyLearningChatroomTranscriptDatabase,
  LearningChatroomTranscriptStoreError,
  normalizeLearningChatroomTranscriptDatabase,
  type LearningChatroomTranscriptDatabase,
  type LearningChatroomTranscriptRepository,
  type LearningChatroomTranscriptStorageDescriptor,
} from "@/lib/server/learning-chatroom-transcript-store";
import {
  isUaisProductionDatabaseAdapterEvidence,
  isUaisProductionRuntime,
} from "@/lib/server/production-database-adapter-evidence";

// Chatroom transcripts hang off the course records the round is authorized
// against, so they follow the course-management backend decision instead of
// introducing a second storage-backend switch: one setting keeps a deployment
// from ending up with durable courses and non-durable transcripts.
const learningChatroomTranscriptBackendEnvName =
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND" as const;

const externalLearningChatroomTranscriptStorage: LearningChatroomTranscriptStorageDescriptor =
  {
    transcriptStoragePolicy: "external-redacted-learning-chatroom-transcripts",
    storageWritePolicy: "external-optimistic-snapshot-replace",
  };

export function createUaisLearningChatroomTranscriptRepository(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): LearningChatroomTranscriptRepository | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: learningChatroomTranscriptBackendEnvName,
    value: input.env[learningChatroomTranscriptBackendEnvName],
    responsibleSession: "S12",
    env: input.env,
  });

  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new LearningChatroomTranscriptStoreError(
      503,
      "Learning chatroom transcript storage backend is not ready.",
    );
  }

  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new LearningChatroomTranscriptStoreError(
      503,
      "Learning chatroom transcript external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;
  const databaseUrl = `${config.baseUrl}/learning-chatroom-transcripts/database`;

  return {
    storage: externalLearningChatroomTranscriptStorage,
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
          throw new LearningChatroomTranscriptStoreError(
            502,
            "External learning chatroom transcript read acknowledgement is missing production database adapter evidence.",
          );
        }
        return { database: createEmptyLearningChatroomTranscriptDatabase() };
      }
      if (!response.ok) {
        throw new LearningChatroomTranscriptStoreError(
          502,
          "External learning chatroom transcript read failed.",
        );
      }

      const body = (await response.json()) as {
        database?: LearningChatroomTranscriptDatabase;
        productionDatabaseAdapter?: unknown;
        revision?: unknown;
      };
      if (
        isUaisProductionRuntime(input.env) &&
        !isUaisProductionDatabaseAdapterEvidence(body.productionDatabaseAdapter)
      ) {
        throw new LearningChatroomTranscriptStoreError(
          502,
          "External learning chatroom transcript read acknowledgement is missing production database adapter evidence.",
        );
      }
      const revision = typeof body.revision === "string" ? body.revision.trim() : "";
      if (isUaisProductionRuntime(input.env) && !revision) {
        throw new LearningChatroomTranscriptStoreError(
          502,
          "External learning chatroom transcript read acknowledgement is missing snapshot revision.",
        );
      }

      return {
        database: body.database
          ? normalizeLearningChatroomTranscriptDatabase(body.database)
          : createEmptyLearningChatroomTranscriptDatabase(),
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
          action: "replace-learning-chatroom-transcripts-database",
          ...(expectedRevision ? { expectedRevision } : {}),
          database,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 409) {
        throw new LearningChatroomTranscriptStoreError(
          409,
          "External learning chatroom transcript snapshot changed; retry required.",
        );
      }
      if (!response.ok) {
        throw new LearningChatroomTranscriptStoreError(
          502,
          "External learning chatroom transcript persistence failed.",
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
        throw new LearningChatroomTranscriptStoreError(
          502,
          "External learning chatroom transcript persistence acknowledgement is missing production database adapter evidence.",
        );
      }
      const acknowledgementRevision =
        isRecord(acknowledgement) && typeof acknowledgement.revision === "string"
          ? acknowledgement.revision.trim()
          : "";
      if (isUaisProductionRuntime(input.env) && !acknowledgementRevision) {
        throw new LearningChatroomTranscriptStoreError(
          502,
          "External learning chatroom transcript persistence acknowledgement is missing snapshot revision.",
        );
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
