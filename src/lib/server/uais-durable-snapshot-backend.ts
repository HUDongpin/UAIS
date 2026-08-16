import { getUaisCoreDatabaseReadiness } from "@/lib/db/core-database";
import { isUaisProductionRuntime } from "@/lib/server/production-database-adapter-evidence";

// Where the durable snapshot resources actually live.
//
// One selector, `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND`, governs the whole
// snapshot family - course management, chatroom transcripts, chatroom shares -
// because they are read together on a single request and must never disagree
// about which backend holds the truth.
//
// This module exists because that agreement had drifted. The chatroom grew a
// production auto-default to Postgres (closing B2), while course management
// still required the selector to be set explicitly. The result was a live trap:
// an unset selector left the chatroom durable and the course-management store
// resolving to local JSON, which production refuses - so the student course
// list, invite join, approvals and groups all answered 503 on a deployment the
// readiness script called ready. Both now resolve through the same function, so
// the two cannot diverge again.
//
// Order of preference:
//   1. an explicit `postgres`/`managed` selector - the operator asked for it
//   2. an explicit `external` selector - the operator asked for that instead
//   3. in a PRODUCTION runtime with a core database configured, Postgres
//   4. otherwise `local-json`, which every caller's own guard still refuses in
//      production
//
// Step 3 cannot break a working deployment: the state it changes is exactly the
// state that used to 503.

export type UaisDurableSnapshotBackendSelection = "postgres" | "external" | "local-json";

export const UAIS_DURABLE_SNAPSHOT_BACKEND_ENV_NAME =
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND";

export function selectUaisDurableSnapshotBackend(
  env: Record<string, string | undefined>,
): UaisDurableSnapshotBackendSelection {
  const selector = env[UAIS_DURABLE_SNAPSHOT_BACKEND_ENV_NAME]?.trim().toLowerCase() ?? "";
  if (selector === "postgres" || selector === "managed") {
    return "postgres";
  }
  if (selector === "external") {
    return "external";
  }
  if (isUaisProductionRuntime(env) && getUaisCoreDatabaseReadiness(env).status === "ready") {
    return "postgres";
  }
  return "local-json";
}

export function resolveUaisDurableSnapshotBackend<TRepository>(input: {
  env: Record<string, string | undefined>;
  createPostgresRepository: () => TRepository;
  createExternalRepository: () => TRepository | undefined;
}): TRepository | undefined {
  const selection = selectUaisDurableSnapshotBackend(input.env);
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
