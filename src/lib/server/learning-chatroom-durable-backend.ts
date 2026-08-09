import { getUaisCoreDatabaseReadiness } from "@/lib/db/core-database";
import { isUaisProductionRuntime } from "@/lib/server/production-database-adapter-evidence";

// Chooses where chatroom data actually lives, for both transcripts and share
// links, so the two can never disagree.
//
// This exists to close a real production blocker rather than to add a knob.
// Every chatroom store refuses local JSON in a production runtime - a serverless
// filesystem disappears between requests, so "durable" there would be a lie -
// and until now the only durable option was a separately operated
// external-storage service, reachable only after an operator set a base URL and
// a bearer token and kept that service in schema step with this app. A
// deployment that had done everything else right still answered 503 on the first
// message.
//
// The managed Postgres is already required in production, so it is the sensible
// default: a correctly provisioned production deployment now has durable
// transcripts and share links with no additional configuration and no second
// service to version-match.
//
// Order of preference:
//   1. an explicit `postgres`/`managed` selector - the operator asked for it
//   2. an explicit `external` selector - the operator asked for that instead
//   3. in a PRODUCTION runtime with a core database configured, Postgres
//   4. otherwise `undefined`, meaning the local JSON file store, which the
//      caller's own guard still refuses in production
//
// Step 3 is the one that closes the blocker, and it cannot break a working
// deployment: the state it changes is exactly the state that used to 503.

export type LearningChatroomDurableBackendSelection = "postgres" | "external" | "local-json";

export function selectLearningChatroomDurableBackend(
  env: Record<string, string | undefined>,
): LearningChatroomDurableBackendSelection {
  const selector = env.UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND?.trim().toLowerCase() ?? "";
  if (selector === "postgres" || selector === "managed") {
    return "postgres";
  }
  if (selector === "external") {
    return "external";
  }
  if (
    isUaisProductionRuntime(env) &&
    getUaisCoreDatabaseReadiness(env).status === "ready"
  ) {
    return "postgres";
  }
  return "local-json";
}

export function resolveLearningChatroomDurableBackend<TRepository>(input: {
  env: Record<string, string | undefined>;
  createPostgresRepository: () => TRepository;
  createExternalRepository: () => TRepository | undefined;
}): TRepository | undefined {
  const selection = selectLearningChatroomDurableBackend(input.env);
  if (selection === "postgres") {
    return input.createPostgresRepository();
  }
  if (selection === "external") {
    return input.createExternalRepository();
  }
  // `undefined` is the local-JSON answer, which is allowed outside production
  // and refused inside it by the caller's own assertion.
  return undefined;
}
