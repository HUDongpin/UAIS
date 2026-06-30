import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const databaseAdapterEnvForTest = {
  UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS: "managed-database",
  UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS: "up-to-date",
  UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY: "point-in-time-restore",
  UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL: "transactional",
};

describe("external storage production service launcher", () => {
  it("prints a redacted dry-run launch contract for the production storage service", () => {
    const dataDir = "/data/uais-external-storage/production-launcher-fixture";
    const accessToken = "strong-production-storage-launcher-token-fixture";
    const output = execFileSync("node", [
      "scripts/external-storage-service-production-launcher.mjs",
      "--dry-run",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        UAIS_EXTERNAL_STORAGE_DATA_DIR: dataDir,
        UAIS_EXTERNAL_STORAGE_HOST: "0.0.0.0",
        PORT: "8787",
        ...databaseAdapterEnvForTest,
      },
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-service-production-launcher",
        mode: "dry-run",
        status: "ready",
        serviceMode: "production",
        command:
          "node scripts/external-storage-service.mjs --host <host> --port <port> --data-dir <data-dir> --service-mode production",
        runtime: {
          node: "required",
          longRunningProcess: true,
          healthEndpoint: "/healthz",
          serviceTarget: "uais-external-storage-production-service",
        },
        launch: {
          hostBinding: "0.0.0.0",
          portSource: "PORT",
          dataDirSource: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
          persistentVolumeRequired: true,
          dataDirPersistence: "persistent-volume",
          valuesRedacted: true,
        },
        containerArtifact: {
          dockerfile: "Dockerfile.external-storage",
          dockerignore: ".dockerignore",
          persistentVolumePath: "/data/uais-external-storage",
          imageSecretsPolicy: "env-only-at-runtime",
          valueRedacted: true,
        },
        requiredEnv: expect.arrayContaining([
          {
            name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
            status: "present",
            strength: "sufficient",
            valueRedacted: true,
          },
          {
            name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
            status: "present",
            persistence: "persistent-volume",
            valueRedacted: true,
          },
          {
            name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
            status: "present",
            expected: "managed-database",
            valueRedacted: true,
          },
          {
            name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
            status: "present",
            expected: "up-to-date",
            valueRedacted: true,
          },
          {
            name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
            status: "present",
            expected: "point-in-time-restore",
            valueRedacted: true,
          },
          {
            name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
            status: "present",
            expected: "transactional",
            valueRedacted: true,
          },
        ]),
        blockedReasons: [],
        safety: {
          accessTokenOmitted: true,
          dataDirOmitted: true,
          localPrivatePathsOmitted: true,
          startupOutputRedacted: true,
          productionServiceModeForced: true,
        },
      }),
    );
    expect(output).not.toContain(accessToken);
    expect(output).not.toContain(dataDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks the production launch contract when the access token is weak", () => {
    const dataDir = "/data/uais-external-storage/weak-token-fixture";
    const output = execFileSync("node", [
      "scripts/external-storage-service-production-launcher.mjs",
      "--dry-run",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "weak-token",
        UAIS_EXTERNAL_STORAGE_DATA_DIR: dataDir,
        ...databaseAdapterEnvForTest,
      },
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        requiredEnv: expect.arrayContaining([
          {
            name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
            status: "present",
            strength: "insufficient",
            valueRedacted: true,
          },
          {
            name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
            status: "present",
            persistence: "persistent-volume",
            valueRedacted: true,
          },
        ]),
        blockedReasons: ["external-storage-access-token-weak"],
      }),
    );
    expect(output).not.toContain("weak-token");
    expect(output).not.toContain(dataDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks the production launch contract when the data dir is not a persistent volume path", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "uais-external-storage-launcher-ephemeral-"));
    const accessToken = "strong-production-storage-launcher-token-fixture";
    const output = execFileSync("node", [
      "scripts/external-storage-service-production-launcher.mjs",
      "--dry-run",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        UAIS_EXTERNAL_STORAGE_DATA_DIR: dataDir,
        ...databaseAdapterEnvForTest,
      },
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        launch: expect.objectContaining({
          dataDirPersistence: "not-proven",
          valuesRedacted: true,
        }),
        requiredEnv: expect.arrayContaining([
          {
            name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
            status: "present",
            persistence: "not-proven",
            valueRedacted: true,
          },
        ]),
        blockedReasons: ["external-storage-data-dir-persistent-volume-not-proven"],
      }),
    );
    expect(output).not.toContain(accessToken);
    expect(output).not.toContain(dataDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks the production launch contract without managed database adapter proof", () => {
    const dataDir = "/data/uais-external-storage/adapter-proof-fixture";
    const accessToken = "strong-production-storage-launcher-token-fixture";
    const output = execFileSync("node", [
      "scripts/external-storage-service-production-launcher.mjs",
      "--dry-run",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        UAIS_EXTERNAL_STORAGE_DATA_DIR: dataDir,
      },
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        requiredEnv: expect.arrayContaining([
          {
            name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
            status: "missing",
            expected: "managed-database",
            valueRedacted: true,
          },
          {
            name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
            status: "missing",
            expected: "up-to-date",
            valueRedacted: true,
          },
          {
            name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
            status: "missing",
            expected: "point-in-time-restore",
            valueRedacted: true,
          },
          {
            name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
            status: "missing",
            expected: "transactional",
            valueRedacted: true,
          },
        ]),
        blockedReasons: [
          "missing-UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
          "missing-UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
          "missing-UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
          "missing-UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
        ],
      }),
    );
    expect(output).not.toContain(accessToken);
    expect(output).not.toContain(dataDir);
    expect(output).not.toContain("/Users/");
  });
});
