import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import {
  createEmptyLearningChatroomTranscriptDatabase,
  LearningChatroomTranscriptStoreError,
  learningChatroomTranscriptRoomKeyMismatchReasonCode,
  normalizeLearningChatroomTranscriptDatabase,
  type LearningChatroomTranscriptDatabase,
  type LearningChatroomTranscriptRepository,
  type LearningChatroomTranscriptStorageDescriptor,
} from "@/lib/server/learning-chatroom-transcript-store";
import { snapshotContentionReasonCode } from "./optimistic-write-retry";
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
    read: async (scope) => {
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
        return {
          database: createEmptyLearningChatroomTranscriptDatabase(),
          // The external CAS endpoint defines the empty resource's revision as
          // `rev-empty`; handing it forward lets a legitimate first PUT carry
          // a guard instead of falling back to an unguarded create.
          revision: "rev-empty",
          ...(scope?.transcriptId ? { transcriptId: scope.transcriptId } : {}),
        };
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
      const hasRevisionField = Object.prototype.hasOwnProperty.call(body, "revision");
      const database = body.database
        ? normalizeLearningChatroomTranscriptDatabase(body.database)
        : createEmptyLearningChatroomTranscriptDatabase();
      const effectiveRevision =
        !hasRevisionField &&
        database.updatedAt === "1970-01-01T00:00:00.000Z" &&
        database.transcripts.length === 0
          ? "rev-empty"
          : revision;
      if (
        !isValidSnapshotRevision(effectiveRevision) ||
        (database.transcripts.length > 0 && effectiveRevision === "rev-empty")
      ) {
        throw new LearningChatroomTranscriptStoreError(
          503,
          "External learning chatroom transcript read acknowledgement is missing or invalid snapshot revision.",
          "transcript-snapshot-revision-required",
        );
      }

      return {
        database,
        ...(effectiveRevision ? { revision: effectiveRevision } : {}),
        ...(scope?.transcriptId ? { transcriptId: scope.transcriptId } : {}),
      };
    },
    write: async ({ database, expectedRevision, transcriptId }) => {
      const normalizedDatabase = normalizeLearningChatroomTranscriptDatabase(database);
      if (
        transcriptId &&
        normalizedDatabase.transcripts.length > 0 &&
        !normalizedDatabase.transcripts.some(
          (transcript) => transcript.transcriptId === transcriptId,
        )
      ) {
        throw new LearningChatroomTranscriptStoreError(
          409,
          "External learning chatroom transcript write snapshot room key does not match the request.",
          learningChatroomTranscriptRoomKeyMismatchReasonCode,
        );
      }
      // The external endpoint is a compare-and-swap API.  A first PUT must
      // carry the revision handed back by the request-local GET (normally
      // `rev-empty`), never omit the guard and accidentally create over a
      // concurrent first writer.  A missing revision is therefore a local
      // protocol failure, not a blind write that can be retried.
      if (!expectedRevision?.trim()) {
        throw new LearningChatroomTranscriptStoreError(
          503,
          "External learning chatroom transcript write requires the handed snapshot revision.",
          "transcript-snapshot-revision-required",
        );
      }
      const handedRevision = expectedRevision.trim();
      if (!isValidSnapshotRevision(handedRevision)) {
        throw new LearningChatroomTranscriptStoreError(
          503,
          "External learning chatroom transcript write requires a valid snapshot revision.",
          "transcript-snapshot-revision-required",
        );
      }
      const response = await fetchImpl(databaseUrl, {
        method: "PUT",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "replace-learning-chatroom-transcripts-database",
          expectedRevision: handedRevision,
          database: normalizedDatabase,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 409) {
        throw new LearningChatroomTranscriptStoreError(
          409,
          "External learning chatroom transcript snapshot changed; retry required.",
          snapshotContentionReasonCode,
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

function isValidSnapshotRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 120 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
