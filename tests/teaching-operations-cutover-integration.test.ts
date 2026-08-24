import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  backfillTeachingOperationsToPostgres,
  verifyTeachingOperationsParity,
} from "@/lib/server/teaching-operations-cutover";
import { createUaisTeachingOperationRepository } from "@/lib/server/teaching-operations-postgres-store";
import {
  loadTeachingOperationDatabase,
  loadTeachingOperationSnapshot,
  normalizeTeachingOperationDatabase,
  persistTeachingOperationDatabase,
  readTeachingOperationDatabase,
  TeachingOperationStoreError,
  type TeachingOperationDatabase,
} from "@/lib/server/teaching-operations-store";
import { authorizeLiveDatabaseTestFile } from "../scripts/run-db-tests.mjs";

// Phase 1 full expand -> migrate -> contract cutover for the teaching-operations
// entity, verified end-to-end against a real Postgres. The dedicated runner
// supplies the only accepted launch capability and serializes shared fixtures.
const authorization = await authorizeLiveDatabaseTestFile({
  env: process.env,
  lane: "legacy",
  testFile: "tests/teaching-operations-cutover-integration.test.ts",
});
if (authorization.exitCode !== 0) {
  throw new Error(`UAIS_DB_TEST ${JSON.stringify(authorization.report)}`);
}
const databaseUrl = authorization.databaseUrl ?? "";

function buildInviteCode(inviteId: string) {
  return {
    inviteId,
    operationId: "invite-code" as const,
    code: "55395057",
    status: "generated" as const,
    actorId: "teacher-kang",
    createdAt: "2026-07-18T10:00:00.000Z",
  };
}

function buildDatabase(inviteIds: string[]): TeachingOperationDatabase {
  return normalizeTeachingOperationDatabase({
    schemaVersion: "uais-teaching-operations-v1",
    updatedAt: "2026-07-18T10:00:00.000Z",
    records: [],
    auditEvents: [],
    domainProjections: [],
    inviteCodes: inviteIds.map(buildInviteCode),
    outbox: [],
    exportManifests: [],
  });
}

async function seedJsonFile(dataDir: string, database: TeachingOperationDatabase) {
  await writeFile(
    join(dataDir, "teaching-operations.json"),
    JSON.stringify(database),
    "utf8",
  );
}

describe(
  "teaching-operations durable cutover (integration)",
  () => {
    it("backfills JSON -> Postgres, verifies parity, switches reads, and rolls back safely", async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "uais-ops-cutover-"));
      const env = { UAIS_CORE_DATABASE_URL: databaseUrl };
      try {
        // EXPAND baseline: the JSON file is the current durable source of truth.
        const seeded = buildDatabase(["invite-a"]);
        await seedJsonFile(dataDir, seeded);
        const fromFile = await readTeachingOperationDatabase({ dataDir });
        expect(fromFile.inviteCodes).toHaveLength(1);

        // MIGRATE: backfill the JSON snapshot into managed Postgres, verify parity.
        const backfill = await backfillTeachingOperationsToPostgres({
          env,
          sourceDataDir: dataDir,
        });
        expect(backfill.status).toBe("parity");
        expect(backfill.entityCounts.inviteCodes).toBe(1);
        expect(backfill.managedRevision).toBeTruthy();
        // Redaction: no record contents leak (only counts).
        expect(JSON.stringify(backfill)).not.toContain("invite-a");

        // MIGRATE gate: the read-only parity check also reports parity.
        const parity = await verifyTeachingOperationsParity({ env, sourceDataDir: dataDir });
        expect(parity.status).toBe("parity");

        // CONTRACT (switch reads): the resolver returns the Postgres repository
        // when the backend flag is set, and it serves the same data.
        const postgresRepository = createUaisTeachingOperationRepository({
          env: {
            UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND: "postgres",
            UAIS_CORE_DATABASE_URL: databaseUrl,
          },
        });
        expect(postgresRepository).toBeDefined();
        const viaPostgres = await postgresRepository!.read();
        expect(viaPostgres.database.inviteCodes.map((code) => code.inviteId)).toEqual([
          "invite-a",
        ]);

        // CONTRACT (rollback): reads without the flag return to the untouched
        // JSON file, so a rollback loses no data.
        const rolledBack = await readTeachingOperationDatabase({ dataDir });
        expect(rolledBack).toEqual(seeded);

        // DRIFT DETECTION: mutating the source after backfill makes parity fail.
        await seedJsonFile(dataDir, buildDatabase(["invite-a", "invite-b"]));
        const drift = await verifyTeachingOperationsParity({ env, sourceDataDir: dataDir });
        expect(drift.status).toBe("mismatch");
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    });

    it("routes the store's backend-aware read/write helpers through Postgres under the dedicated flag", async () => {
      const postgresEnv = {
        UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND: "postgres",
        UAIS_CORE_DATABASE_URL: databaseUrl,
      };
      // Persist via the same store helper the operational functions now call,
      // in the way they call it: under the revision the read returned. Every
      // guarded flow does this (runGuardedTeachingOperationSnapshotWrite), and
      // the managed row refuses a writer that names no revision against an
      // existing snapshot - that writer read nothing, so replacing what it found
      // would drop whoever wrote it.
      const before = await loadTeachingOperationSnapshot({ env: postgresEnv });
      await persistTeachingOperationDatabase({
        database: buildDatabase(["invite-store-helper"]),
        env: postgresEnv,
        ...(before.revision ? { expectedRevision: before.revision } : {}),
      });
      // ...and read it back via the store helper — proving the read-switch routes
      // to Postgres (not the JSON file) when the dedicated backend var is set.
      const readBack = await loadTeachingOperationDatabase({ env: postgresEnv });
      expect(readBack.inviteCodes.map((code) => code.inviteId)).toEqual([
        "invite-store-helper",
      ]);

      // Without the flag, the same helper reads the file backend (byte-identical
      // to the pre-cutover behavior), confirming the switch is fully gated.
      const fileDataDir = await mkdtemp(join(tmpdir(), "uais-ops-file-"));
      try {
        const viaFile = await loadTeachingOperationDatabase({ dataDir: fileDataDir, env: {} });
        expect(viaFile.inviteCodes).toHaveLength(0);
      } finally {
        await rm(fileDataDir, { recursive: true, force: true });
      }
    });

    it("refuses an unguarded replace of the row on the real database", async () => {
      const postgresEnv = {
        UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND: "postgres",
        UAIS_CORE_DATABASE_URL: databaseUrl,
      };
      // The row exists by now (the tests above wrote it). A writer that names no
      // revision is a writer that read no snapshot, and letting it replace this
      // one is exactly how a concurrent teacher's action used to disappear. The
      // guard is a statement shape - a FOR UPDATE pre-check plus a conditional
      // ON CONFLICT - so it is only fully proven against a real Postgres.
      const error = await persistTeachingOperationDatabase({
        database: buildDatabase(["invite-unguarded"]),
        env: postgresEnv,
      }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(TeachingOperationStoreError);
      expect(error).toMatchObject({ status: 409 });
      // The refused write left the snapshot alone.
      const unchanged = await loadTeachingOperationDatabase({ env: postgresEnv });
      expect(unchanged.inviteCodes.map((code) => code.inviteId)).not.toContain(
        "invite-unguarded",
      );
    });
  },
);
