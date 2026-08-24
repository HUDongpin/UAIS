import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function readCoreMigrationManifest({ root = process.cwd() } = {}) {
  const migrationsDirectory = join(root, "migrations");
  const entries = (await readdir(migrationsDirectory))
    .filter((entry) => entry.endsWith(".sql"))
    .sort();

  return Promise.all(
    entries.map(async (entry) => {
      const migrationSql = await readFile(join(migrationsDirectory, entry), "utf8");
      return {
        version: entry.slice(0, -".sql".length),
        checksum: createHash("sha256").update(migrationSql).digest("hex"),
      };
    }),
  );
}

export function assessCoreMigrationLedgerParity({ expected, actual }) {
  const exactVersionChecksumParity =
    expected.length > 0 &&
    actual.length === expected.length &&
    expected.every(
      (entry, index) =>
        actual[index]?.version === entry.version &&
        actual[index]?.checksum === entry.checksum,
    );

  return {
    ready: exactVersionChecksumParity,
    appliedMigrationCount: actual.length,
    expectedMigrationCount: expected.length,
    exactVersionChecksumParity,
  };
}

export function areBothStagingMigrationLedgersReady(source, restore) {
  return source.ready === true && restore.ready === true;
}
