import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const externalStorageServiceReadinessDryRunResults = {
  externalStorageEndpointRemoteHttps: "passed",
  externalStorageHealthContract: "blocked",
  externalStorageOrdinaryTeachingSchemas: "blocked",
  externalStorageTeachingOperationsSchema: "blocked",
  externalStorageTeachingCourseManagementSchema: "blocked",
  externalStorageTeachingCourseAssetsSchema: "blocked",
  externalStorageVercelEnvSync: "blocked",
  externalStorageProductionLaunchContract: "blocked",
  externalStoragePersistenceEvidence: "blocked",
  externalStorageReadinessSafety: "passed",
};

describe("external storage production service readiness evidence", () => {
  it("prints a redacted dry-run contract without proving production readiness", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-storage-service-readiness-"));
    const envFile = join(tmpDir, "storage.env");
    writeFileSync(
      envFile,
      "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage-production.example.test",
    );

    const output = execFileSync("node", [
      "scripts/external-storage-service-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      "uais-release-2026-06-18T000000Z",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-service-readiness",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "blocked",
        releaseRunId: "uais-release-2026-06-18T000000Z",
        responsibleSession: "S22",
        blockedReasons: ["external-storage-service-live-readiness-not-run"],
        storageEndpoint: {
          status: "present",
          networkClass: "remote",
          endpointClass: "remote-https",
          valueRedacted: true,
        },
        storageServiceFingerprint: {
          status: "present",
          value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
          source: "origin",
          valueRedacted: true,
        },
        results: externalStorageServiceReadinessDryRunResults,
        safety: expect.objectContaining({
          valuesRedacted: true,
          serviceUrlOmitted: true,
          responseBodiesOmitted: true,
          localPrivatePathsOmitted: true,
          liveRequiresApproval: true,
          noWriteOperations: true,
          cookieValuesOmitted: true,
          remoteMutationRequiresApproval: true,
        }),
      }),
    );
    expect(output).not.toContain("storage-production.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("storage.env");
    expect(output).not.toContain("/Users/");
  });

  it("blocks production readiness before network calls when the endpoint is not remote HTTPS", () => {
    const output = execFileSync("node", [
      "scripts/external-storage-service-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--base-url",
      "http://127.0.0.1:8787",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        storageEndpoint: {
          status: "present",
          networkClass: "local-loopback",
          endpointClass: "local-loopback",
          valueRedacted: true,
        },
        blockedReasons: expect.arrayContaining([
          "external-storage-service-live-readiness-not-run",
          "production-external-storage-service-endpoint-not-remote-https",
        ]),
      }),
    );
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("/Users/");
  });

  it("rejects live production checks without explicit owner approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/external-storage-service-readiness.mjs",
        "--live",
        "--environment",
        "production",
        "--base-url",
        "https://storage-production.example.test",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });

  it("blocks live production readiness when Vercel env sync points to a different storage service", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-storage-service-env-sync-binding-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const releaseRunId = "uais-release-storage-env-sync-binding";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          applyPreflight: {
            status: "passed",
            blockedReasons: [],
            valuesRedacted: true,
            cliSafeToInvoke: true,
          },
          externalStorageServiceFingerprint: createStorageServiceFingerprintForTest(
            "https://different-storage-service.example.test",
          ),
        },
        null,
        2,
      ),
    );

    const result = await execFileResultForTest("node", [
      "scripts/external-storage-service-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      "https://storage-production.example.test",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-service-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        blockedReasons: ["vercel-env-sync-external-storage-fingerprint-mismatch"],
        vercelEnvSyncEvidence: {
          target: "vercel-env-sync",
          status: "mismatched",
          valueRedacted: true,
          applyPreflight: "proved",
          releaseRunIdStatus: "missing",
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s19-vercel-env-sync-apply-evidence",
          responsibleSession: "S19",
          requiredEvidence: "vercel-env-sync",
          status: "mismatched",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain("storage-production.example.test");
    expect(result.stdout).not.toContain("different-storage-service.example.test");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks live production readiness when Vercel env sync lacks passed apply preflight proof", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-storage-service-env-sync-preflight-"));
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const releaseRunId = "uais-release-storage-env-sync-preflight";
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        {
          target: "vercel-env-sync",
          mode: "apply",
          releaseRunId,
          projectReadinessEvidenceStatus: "ready",
          targets: ["production", "preview"],
          applySummary: {
            status: "applied",
            appliedActions: 4,
            appliedByTarget: { production: 2, preview: 2 },
            localOnlyEntriesSkipped: 2,
            valuesRedacted: true,
            cliOutputOmitted: true,
          },
          externalStorageServiceFingerprint: createStorageServiceFingerprintForTest(
            "https://storage-production.example.test",
          ),
        },
        null,
        2,
      ),
    );

    const result = await execFileResultForTest("node", [
      "scripts/external-storage-service-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      "https://storage-production.example.test",
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
    ]);
    const body = result.stdout
      ? JSON.parse(result.stdout)
      : { stderr: result.stderr, stdout: "missing-json-evidence" };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-service-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        blockedReasons: ["vercel-env-sync-apply-preflight-not-proven"],
        vercelEnvSyncEvidence: {
          target: "vercel-env-sync",
          status: "apply-preflight-missing",
          valueRedacted: true,
          applyPreflight: "missing",
          releaseRunIdStatus: "missing",
        },
      }),
    );
    expect(body).not.toHaveProperty("health");
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s19-vercel-env-sync-apply-evidence",
          responsibleSession: "S19",
          requiredEvidence: "vercel-env-sync",
          status: "apply-preflight-missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain("storage-production.example.test");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks live production readiness when the production launch contract is not ready", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-storage-service-launch-contract-"));
    const releaseRunId = "uais-release-storage-launch-contract";
    const baseUrl = "https://storage-production.example.test";
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const launchContractFile = join(tmpDir, "launch-contract.json");
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        createMatchedVercelEnvSyncForTest({ baseUrl, releaseRunId }),
        null,
        2,
      ),
    );
    writeFileSync(
      launchContractFile,
      JSON.stringify(
        {
          target: "external-storage-service-production-launcher",
          mode: "dry-run",
          status: "blocked",
          serviceMode: "production",
          requiredEnv: [
            {
              name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
              status: "present",
              strength: "insufficient",
              valueRedacted: true,
            },
          ],
          blockedReasons: ["external-storage-access-token-weak"],
          safety: {
            accessTokenOmitted: true,
            dataDirOmitted: true,
            localPrivatePathsOmitted: true,
            startupOutputRedacted: true,
            productionServiceModeForced: true,
          },
          leakedToken: "secret-production-storage-token",
          leakedPath: "/Users/private/storage",
        },
        null,
        2,
      ),
    );

    const result = await execFileResultForTest("node", [
      "scripts/external-storage-service-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      baseUrl,
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
      "--external-storage-production-launch-contract",
      launchContractFile,
    ]);
    const body = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-service-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        blockedReasons: ["external-storage-production-launch-contract-not-ready"],
        productionLaunchContractEvidence: {
          target: "external-storage-service-production-launcher",
          status: "not-ready",
          valueRedacted: true,
          serviceMode: "production",
          runtime: "missing",
          envContract: "missing",
          dataDirPersistence: "missing",
          containerArtifact: "missing",
          redactionSafety: "proved",
        },
      }),
    );
    expect(body).not.toHaveProperty("health");
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-external-storage-production-launch-contract",
          responsibleSession: "S22",
          requiredEvidence: "external-storage-service-production-launcher",
          status: "not-ready",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain(baseUrl);
    expect(result.stdout).not.toContain("secret-production-storage-token");
    expect(result.stdout).not.toContain("/Users/private/storage");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks readiness when the production launch contract lacks persistent-volume data-dir proof", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-storage-service-launch-volume-"));
    const baseUrl = "https://storage-production.example.test";
    const launchContractFile = join(tmpDir, "launch-contract.json");
    writeFileSync(
      launchContractFile,
      JSON.stringify(
        {
          target: "external-storage-service-production-launcher",
          mode: "dry-run",
          status: "ready",
          serviceMode: "production",
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
            valuesRedacted: true,
          },
          containerArtifact: {
            dockerfile: "Dockerfile.external-storage",
            dockerignore: ".dockerignore",
            persistentVolumePath: "/data/uais-external-storage",
            imageSecretsPolicy: "env-only-at-runtime",
            valueRedacted: true,
          },
          requiredEnv: [
            {
              name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
              status: "present",
              strength: "sufficient",
              valueRedacted: true,
            },
            {
              name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
              status: "present",
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
          ],
          blockedReasons: [],
          safety: {
            accessTokenOmitted: true,
            dataDirOmitted: true,
            localPrivatePathsOmitted: true,
            startupOutputRedacted: true,
            productionServiceModeForced: true,
          },
          leakedPath: "/Users/private/storage",
        },
        null,
        2,
      ),
    );

    const result = await execFileResultForTest("node", [
      "scripts/external-storage-service-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--base-url",
      baseUrl,
      "--external-storage-production-launch-contract",
      launchContractFile,
    ]);
    const body = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-service-readiness",
        mode: "dry-run",
        environment: "production",
        status: "blocked",
        blockedReasons: [
          "external-storage-production-launch-contract-not-ready",
          "external-storage-service-live-readiness-not-run",
        ],
        productionLaunchContractEvidence: {
          target: "external-storage-service-production-launcher",
          status: "not-ready",
          valueRedacted: true,
          serviceMode: "production",
          runtime: "proved",
          envContract: "proved",
          dataDirPersistence: "missing",
          containerArtifact: "proved",
          redactionSafety: "proved",
        },
      }),
    );
    expect(result.stdout).not.toContain(baseUrl);
    expect(result.stdout).not.toContain("/Users/private/storage");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks readiness when the production launch contract lacks database adapter proof", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-storage-service-launch-adapter-"));
    const baseUrl = "https://storage-production.example.test";
    const launchContractFile = join(tmpDir, "launch-contract.json");
    const launchContract = createReadyProductionLaunchContractForTest();
    writeFileSync(
      launchContractFile,
      JSON.stringify(
        {
          ...launchContract,
          requiredEnv: launchContract.requiredEnv.filter(
            (entry) => !entry.name.startsWith("UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_"),
          ),
        },
        null,
        2,
      ),
    );

    const result = await execFileResultForTest("node", [
      "scripts/external-storage-service-readiness.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--base-url",
      baseUrl,
      "--external-storage-production-launch-contract",
      launchContractFile,
    ]);
    const body = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-service-readiness",
        mode: "dry-run",
        environment: "production",
        status: "blocked",
        blockedReasons: [
          "external-storage-production-launch-contract-not-ready",
          "external-storage-service-live-readiness-not-run",
        ],
        productionLaunchContractEvidence: {
          target: "external-storage-service-production-launcher",
          status: "not-ready",
          valueRedacted: true,
          serviceMode: "production",
          runtime: "proved",
          envContract: "missing",
          dataDirPersistence: "proved",
          containerArtifact: "proved",
          redactionSafety: "proved",
        },
      }),
    );
    expect(result.stdout).not.toContain(baseUrl);
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks live production readiness without Vercel env sync evidence before health requests", async () => {
    const result = await execFileResultForTest("node", [
      "scripts/external-storage-service-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      "https://storage-production.example.test",
      "--release-run-id",
      "uais-release-storage-env-sync-missing",
    ]);
    const body = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-service-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        blockedReasons: ["vercel-env-sync-evidence-missing"],
        vercelEnvSyncEvidence: {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        },
      }),
    );
    expect(body).not.toHaveProperty("health");
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s19-vercel-env-sync-apply-evidence",
          responsibleSession: "S19",
          requiredEvidence: "vercel-env-sync",
          status: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain("storage-production.example.test");
    expect(result.stdout).not.toContain("missing-undefined");
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks live production readiness without durable persistence evidence before health requests", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-storage-service-persistence-missing-"));
    const releaseRunId = "uais-release-storage-persistence-missing";
    const baseUrl = "https://storage-production.example.test";
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const launchContractFile = join(tmpDir, "launch-contract.json");
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        createMatchedVercelEnvSyncForTest({ baseUrl, releaseRunId }),
        null,
        2,
      ),
    );
    writeFileSync(
      launchContractFile,
      JSON.stringify(createReadyProductionLaunchContractForTest(), null, 2),
    );

    const result = await execFileResultForTest("node", [
      "scripts/external-storage-service-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      baseUrl,
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
      "--external-storage-production-launch-contract",
      launchContractFile,
    ]);
    const body = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-service-readiness",
        mode: "live",
        environment: "production",
        status: "blocked",
        blockedReasons: ["external-storage-persistence-evidence-missing"],
        persistenceEvidence: {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        },
      }),
    );
    expect(body).not.toHaveProperty("health");
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-external-storage-persistence-evidence",
          responsibleSession: "S22",
          requiredEvidence: "external-storage-persistence",
          status: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain(baseUrl);
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks durable persistence evidence when the artifact target is stale", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-storage-service-persistence-target-"));
    const releaseRunId = "uais-release-storage-persistence-target";
    const baseUrl = "http://127.0.0.1:8787";
    const envSyncFile = join(tmpDir, "vercel-env-sync.json");
    const launchContractFile = join(tmpDir, "launch-contract.json");
    const persistenceFile = join(tmpDir, "external-storage-persistence.json");
    const storageServiceFingerprint = createStorageServiceFingerprintForTest(baseUrl);
    writeFileSync(
      envSyncFile,
      JSON.stringify(
        createMatchedVercelEnvSyncForTest({ baseUrl, releaseRunId }),
        null,
        2,
      ),
    );
    writeFileSync(
      launchContractFile,
      JSON.stringify(createReadyProductionLaunchContractForTest(), null, 2),
    );
    writeFileSync(
      persistenceFile,
      JSON.stringify(
        {
          target: "external-storage-persistence-smoke",
          mode: "live",
          environment: "production",
          phase: "read",
          status: "passed",
          releaseRunId,
          storageEndpoint: {
            status: "present",
            networkClass: "remote",
            endpointClass: "remote-https",
            valueRedacted: true,
          },
          storageServiceFingerprint,
          results: [
            {
              id: "s22-external-storage-persistence-health",
              status: "ok",
            },
            {
              id: "s12-external-storage-persistence-ownership-read",
              status: "ok",
            },
            {
              id: "s24-external-storage-persistence-audit-read",
              status: "ok",
            },
          ],
          safety: {
            valuesRedacted: true,
            cookieValuesOmitted: true,
            responseBodiesOmitted: true,
            liveRequiresApproval: true,
            remoteMutationRequiresApproval: true,
            serviceUrlOmitted: true,
            teacherIdOmitted: true,
            proofIdOmitted: true,
          },
        },
        null,
        2,
      ),
    );

    const result = await execFileResultForTest("node", [
      "scripts/external-storage-service-readiness.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      baseUrl,
      "--release-run-id",
      releaseRunId,
      "--vercel-env-sync",
      envSyncFile,
      "--external-storage-production-launch-contract",
      launchContractFile,
      "--external-storage-persistence",
      persistenceFile,
    ]);
    const body = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(body.blockedReasons).toEqual(
      expect.arrayContaining([
        "production-external-storage-service-endpoint-not-remote-https",
        "external-storage-persistence-evidence-invalid-target",
      ]),
    );
    expect(body.persistenceEvidence).toEqual({
      target: "unexpected",
      status: "invalid-target",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
    });
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-external-storage-persistence-evidence",
          responsibleSession: "S22",
          requiredEvidence: "external-storage-persistence",
          status: "invalid-target",
          valueRedacted: true,
        },
      ]),
    );
    expect(result.stdout).not.toContain(baseUrl);
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("blocks live readiness outside the production environment before issuing reusable evidence", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.setHeader("content-type", "application/json");
        response.setHeader("cache-control", "no-store");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: createProvedProductionServiceIdentityForTest(),
            durableBackingStore: createReadyDurableBackingStoreForTest(),
            teachingOperationsStorageSchema: createReadyTeachingOperationsStorageSchemaForTest(),
            ...createReadyOrdinaryCourseStorageSchemasForTest(),
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      let stdout = "";

      await expect(
        execFileAsync(
          "node",
          [
            "scripts/external-storage-service-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--base-url",
            baseUrl,
            "--release-run-id",
            "uais-release-2026-06-18T000000Z",
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          target: "external-storage-service-readiness",
          mode: "live",
          environment: "preview",
          status: "blocked",
          releaseRunId: "uais-release-2026-06-18T000000Z",
          blockedReasons: ["external-storage-service-readiness-not-production"],
          health: expect.objectContaining({
            status: "ok",
            apiContractVersion: "matched",
            cacheControl: "no-store",
            productionServiceIdentity: "proved",
            durableBackingStore: "ready",
            redaction: "present",
          }),
        }),
      );
      expect(stdout).not.toContain(baseUrl);
      expect(stdout).not.toContain("127.0.0.1");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("retries transient health request failures before evaluating readiness evidence", async () => {
    let attempts = 0;
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        attempts += 1;
        if (attempts === 1) {
          request.socket.destroy();
          return;
        }
        response.setHeader("content-type", "application/json");
        response.setHeader("cache-control", "no-store");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: createProvedProductionServiceIdentityForTest(),
            durableBackingStore: createReadyDurableBackingStoreForTest(),
            teachingOperationsStorageSchema: createReadyTeachingOperationsStorageSchemaForTest(),
            ...createReadyOrdinaryCourseStorageSchemasForTest(),
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const result = await execFileResultForTest("node", [
        "scripts/external-storage-service-readiness.mjs",
        "--live",
        "--approved",
        "--environment",
        "preview",
        "--base-url",
        baseUrl,
      ]);
      const body = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(1);
      expect(body).toEqual(
        expect.objectContaining({
          target: "external-storage-service-readiness",
          mode: "live",
          environment: "preview",
          status: "blocked",
          blockedReasons: ["external-storage-service-readiness-not-production"],
          networkRetryPolicy: {
            maxAttempts: 3,
            perAttemptTimeoutMs: 10_000,
            retryOn: ["request-error"],
            valuesRedacted: true,
          },
          health: expect.objectContaining({
            status: "ok",
            apiContractVersion: "matched",
            productionServiceIdentity: "proved",
            durableBackingStore: "ready",
            redaction: "present",
            networkAttempts: {
              attempted: 2,
              maxAttempts: 3,
              retried: true,
              valueRedacted: true,
            },
          }),
        }),
      );
      expect(attempts).toBe(2);
      expect(result.stdout).not.toContain(baseUrl);
      expect(result.stdout).not.toContain("127.0.0.1");
      expect(result.stdout).not.toContain("/Users/");
      expect(result.stderr).toBe("");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("blocks live readiness when health omits the external storage API contract version", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            productionServiceIdentity: createProvedProductionServiceIdentityForTest(),
            durableBackingStore: createReadyDurableBackingStoreForTest(),
            teachingOperationsStorageSchema: createReadyTeachingOperationsStorageSchemaForTest(),
            ...createReadyOrdinaryCourseStorageSchemasForTest(),
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      let stdout = "";

      await expect(
        execFileAsync(
          "node",
          [
            "scripts/external-storage-service-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--base-url",
            baseUrl,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          status: "blocked",
          health: expect.objectContaining({
            apiContractVersion: "missing",
            productionServiceIdentity: "proved",
            durableBackingStore: "ready",
            redaction: "present",
          }),
          blockedReasons: expect.arrayContaining([
            "external-storage-service-readiness-not-production",
            "external-storage-service-api-contract-not-proven",
          ]),
        }),
      );
      expect(stdout).not.toContain(baseUrl);
      expect(stdout).not.toContain("127.0.0.1");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("blocks live readiness when health does not prove cache-control no-store", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: createProvedProductionServiceIdentityForTest(),
            durableBackingStore: createReadyDurableBackingStoreForTest(),
            teachingOperationsStorageSchema: createReadyTeachingOperationsStorageSchemaForTest(),
            ...createReadyOrdinaryCourseStorageSchemasForTest(),
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      let stdout = "";

      await expect(
        execFileAsync(
          "node",
          [
            "scripts/external-storage-service-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--base-url",
            baseUrl,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          status: "blocked",
          health: expect.objectContaining({
            cacheControl: "missing",
            apiContractVersion: "matched",
            productionServiceIdentity: "proved",
            durableBackingStore: "ready",
            redaction: "present",
          }),
          blockedReasons: expect.arrayContaining([
            "external-storage-service-readiness-not-production",
            "external-storage-service-cache-control-not-proven",
          ]),
        }),
      );
      expect(stdout).not.toContain(baseUrl);
      expect(stdout).not.toContain("127.0.0.1");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("blocks live readiness when durable backing-store health omits write-read policy proof", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: createProvedProductionServiceIdentityForTest(),
            durableBackingStore: { status: "ready" },
            teachingOperationsStorageSchema: createReadyTeachingOperationsStorageSchemaForTest(),
            ...createReadyOrdinaryCourseStorageSchemasForTest(),
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      let stdout = "";

      await expect(
        execFileAsync(
          "node",
          [
            "scripts/external-storage-service-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--base-url",
            baseUrl,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          status: "blocked",
          health: expect.objectContaining({
            status: "ok",
            apiContractVersion: "matched",
            productionServiceIdentity: "proved",
            durableBackingStore: "not-ready",
            redaction: "present",
          }),
          blockedReasons: expect.arrayContaining([
            "external-storage-service-readiness-not-production",
            "external-storage-service-durable-backing-store-not-ready",
          ]),
        }),
      );
      expect(stdout).not.toContain(baseUrl);
      expect(stdout).not.toContain("127.0.0.1");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("blocks live readiness when ordinary course databases omit schema migration health proof", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: createProvedProductionServiceIdentityForTest(),
            durableBackingStore: createReadyDurableBackingStoreForTest(),
            teachingOperationsStorageSchema: createReadyTeachingOperationsStorageSchemaForTest(),
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      let stdout = "";

      await expect(
        execFileAsync(
          "node",
          [
            "scripts/external-storage-service-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--base-url",
            baseUrl,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          status: "blocked",
          health: expect.objectContaining({
            status: "ok",
            apiContractVersion: "matched",
            cacheControl: "no-store",
            durableBackingStore: "ready",
            teachingCourseManagementStorageSchema: expect.objectContaining({
              status: "missing",
              schemaVersion: "missing",
            }),
            teachingCourseAssetsStorageSchema: expect.objectContaining({
              status: "missing",
              schemaVersion: "missing",
            }),
          }),
          blockedReasons: expect.arrayContaining([
            "external-storage-service-readiness-not-production",
            "external-storage-service-teaching-course-management-schema-not-proven",
            "external-storage-service-teaching-course-assets-schema-not-proven",
          ]),
        }),
      );
      expect(stdout).not.toContain(baseUrl);
      expect(stdout).not.toContain("127.0.0.1");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("blocks live readiness when teaching operations omit production database adapter proof", async () => {
    const schemaWithoutDatabaseAdapter = Object.fromEntries(
      Object.entries(createReadyTeachingOperationsStorageSchemaForTest()).filter(
        ([key]) => key !== "productionDatabaseAdapter",
      ),
    );
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: createProvedProductionServiceIdentityForTest(),
            durableBackingStore: createReadyDurableBackingStoreForTest(),
            teachingOperationsStorageSchema: schemaWithoutDatabaseAdapter,
            ...createReadyOrdinaryCourseStorageSchemasForTest(),
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      let stdout = "";

      await expect(
        execFileAsync(
          "node",
          [
            "scripts/external-storage-service-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--base-url",
            baseUrl,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          status: "blocked",
          health: expect.objectContaining({
            status: "ok",
            apiContractVersion: "matched",
            cacheControl: "no-store",
            durableBackingStore: "ready",
            teachingOperationsStorageSchema: expect.objectContaining({
              status: "ready",
              schemaVersion: "matched",
              productionDatabaseAdapter: {
                status: "missing",
                providerClass: "missing",
                migrationStatus: "missing",
                backupPolicy: "missing",
                concurrencyControl: "missing",
                valueRedacted: false,
              },
            }),
          }),
          blockedReasons: expect.arrayContaining([
            "external-storage-service-readiness-not-production",
            "external-storage-service-teaching-operations-database-adapter-not-proven",
          ]),
        }),
      );
      expect(stdout).not.toContain(baseUrl);
      expect(stdout).not.toContain("127.0.0.1");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("blocks live readiness when course-management schema omits production database adapter proof", async () => {
    const courseManagementSchemaWithoutDatabaseAdapter = Object.fromEntries(
      Object.entries(createReadySnapshotStorageSchemaForTest(
        "uais-teaching-course-management-v1",
      )).filter(([key]) => key !== "productionDatabaseAdapter"),
    );
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: createProvedProductionServiceIdentityForTest(),
            durableBackingStore: createReadyDurableBackingStoreForTest(),
            teachingOperationsStorageSchema: createReadyTeachingOperationsStorageSchemaForTest(),
            teachingCourseManagementStorageSchema: courseManagementSchemaWithoutDatabaseAdapter,
            teachingCourseAssetsStorageSchema: createReadySnapshotStorageSchemaForTest(
              "uais-teaching-course-assets-v1",
            ),
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      let stdout = "";

      await expect(
        execFileAsync(
          "node",
          [
            "scripts/external-storage-service-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--base-url",
            baseUrl,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          status: "blocked",
          health: expect.objectContaining({
            status: "ok",
            apiContractVersion: "matched",
            cacheControl: "no-store",
            durableBackingStore: "ready",
            teachingCourseManagementStorageSchema: expect.objectContaining({
              status: "ready",
              schemaVersion: "matched",
              productionDatabaseAdapter: {
                status: "missing",
                providerClass: "missing",
                migrationStatus: "missing",
                backupPolicy: "missing",
                concurrencyControl: "missing",
                valueRedacted: false,
              },
            }),
          }),
          blockedReasons: expect.arrayContaining([
            "external-storage-service-readiness-not-production",
            "external-storage-service-teaching-course-management-database-adapter-not-proven",
          ]),
        }),
      );
      expect(stdout).not.toContain(baseUrl);
      expect(stdout).not.toContain("127.0.0.1");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("blocks live readiness when course-assets schema omits production database adapter proof", async () => {
    const courseAssetsSchemaWithoutDatabaseAdapter = Object.fromEntries(
      Object.entries(createReadySnapshotStorageSchemaForTest(
        "uais-teaching-course-assets-v1",
      )).filter(([key]) => key !== "productionDatabaseAdapter"),
    );
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: createProvedProductionServiceIdentityForTest(),
            durableBackingStore: createReadyDurableBackingStoreForTest(),
            teachingOperationsStorageSchema: createReadyTeachingOperationsStorageSchemaForTest(),
            teachingCourseManagementStorageSchema: createReadySnapshotStorageSchemaForTest(
              "uais-teaching-course-management-v1",
            ),
            teachingCourseAssetsStorageSchema: courseAssetsSchemaWithoutDatabaseAdapter,
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      let stdout = "";

      await expect(
        execFileAsync(
          "node",
          [
            "scripts/external-storage-service-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--base-url",
            baseUrl,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          status: "blocked",
          health: expect.objectContaining({
            status: "ok",
            apiContractVersion: "matched",
            cacheControl: "no-store",
            durableBackingStore: "ready",
            teachingCourseAssetsStorageSchema: expect.objectContaining({
              status: "ready",
              schemaVersion: "matched",
              productionDatabaseAdapter: {
                status: "missing",
                providerClass: "missing",
                migrationStatus: "missing",
                backupPolicy: "missing",
                concurrencyControl: "missing",
                valueRedacted: false,
              },
            }),
          }),
          blockedReasons: expect.arrayContaining([
            "external-storage-service-readiness-not-production",
            "external-storage-service-teaching-course-assets-database-adapter-not-proven",
          ]),
        }),
      );
      expect(stdout).not.toContain(baseUrl);
      expect(stdout).not.toContain("127.0.0.1");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("blocks live readiness when ordinary course schemas omit backup and restore-drill proof", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            productionServiceIdentity: createProvedProductionServiceIdentityForTest(),
            durableBackingStore: createReadyDurableBackingStoreForTest(),
            teachingOperationsStorageSchema: createReadyTeachingOperationsStorageSchemaForTest(),
            teachingCourseManagementStorageSchema:
              createReadySnapshotStorageSchemaWithoutBackupForTest(
                "uais-teaching-course-management-v1",
              ),
            teachingCourseAssetsStorageSchema:
              createReadySnapshotStorageSchemaWithoutBackupForTest(
                "uais-teaching-course-assets-v1",
              ),
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      let stdout = "";

      await expect(
        execFileAsync(
          "node",
          [
            "scripts/external-storage-service-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--base-url",
            baseUrl,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          status: "blocked",
          health: expect.objectContaining({
            status: "ok",
            apiContractVersion: "matched",
            cacheControl: "no-store",
            durableBackingStore: "ready",
            teachingCourseManagementStorageSchema: expect.objectContaining({
              status: "ready",
              schemaVersion: "matched",
              backupStore: "missing",
              restoreDrillLog: "missing",
            }),
            teachingCourseAssetsStorageSchema: expect.objectContaining({
              status: "ready",
              schemaVersion: "matched",
              backupStore: "missing",
              restoreDrillLog: "missing",
            }),
          }),
          blockedReasons: expect.arrayContaining([
            "external-storage-service-readiness-not-production",
            "external-storage-service-teaching-course-management-schema-not-proven",
            "external-storage-service-teaching-course-assets-schema-not-proven",
          ]),
        }),
      );
      expect(stdout).not.toContain(baseUrl);
      expect(stdout).not.toContain("127.0.0.1");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("blocks live readiness when health omits explicit production service identity proof", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            durableBackingStore: createReadyDurableBackingStoreForTest(),
            teachingOperationsStorageSchema: createReadyTeachingOperationsStorageSchemaForTest(),
            ...createReadyOrdinaryCourseStorageSchemasForTest(),
            redaction: { values: "omitted" },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected test storage service to listen on a TCP port.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      let stdout = "";

      await expect(
        execFileAsync(
          "node",
          [
            "scripts/external-storage-service-readiness.mjs",
            "--live",
            "--approved",
            "--environment",
            "preview",
            "--base-url",
            baseUrl,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
          },
        ).catch((error: unknown) => {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          throw error;
        }),
      ).rejects.toThrow();

      const body = JSON.parse(stdout);
      expect(body).toEqual(
        expect.objectContaining({
          status: "blocked",
          health: expect.objectContaining({
            status: "ok",
            apiContractVersion: "matched",
            productionServiceIdentity: "missing",
            durableBackingStore: "ready",
            redaction: "present",
          }),
          blockedReasons: expect.arrayContaining([
            "external-storage-service-readiness-not-production",
            "external-storage-service-production-identity-not-proven",
          ]),
        }),
      );
      expect(stdout).not.toContain(baseUrl);
      expect(stdout).not.toContain("127.0.0.1");
      expect(stdout).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

function createStorageServiceFingerprintForTest(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`,
    source: "origin",
    valueRedacted: true,
  };
}

function createReadyDurableBackingStoreForTest() {
  return {
    status: "ready",
    storageMode: "file-backed",
    probe: "write-read-delete",
    ownershipWritePolicy: "external-atomic-merge",
    lifecycleAuditWritePolicy: "append-only-redacted-lifecycle-audit",
    valueRedacted: true,
  };
}

function createReadyTeachingOperationsStorageSchemaForTest() {
  return {
    status: "ready",
    schemaVersion: "uais-teaching-operations-v1",
    migrationStatus: "up-to-date",
    operationLedger: "jsonl-append-only",
    auditLedger: "jsonl-append-only",
    rollbackLedger: "jsonl-append-only",
    backupStore: "json-atomic-snapshot",
    restoreDrillLog: "jsonl-append-only",
    concurrencyControl: "atomic-append-and-rename",
    productionDatabaseAdapter: {
      status: "ready",
      providerClass: "managed-database",
      migrationStatus: "up-to-date",
      backupPolicy: "point-in-time-restore",
      concurrencyControl: "transactional",
      valueRedacted: true,
    },
    valueRedacted: true,
  };
}

function createReadyOrdinaryCourseStorageSchemasForTest() {
  return {
    teachingCourseManagementStorageSchema: createReadySnapshotStorageSchemaForTest(
      "uais-teaching-course-management-v1",
    ),
    teachingCourseAssetsStorageSchema: createReadySnapshotStorageSchemaForTest(
      "uais-teaching-course-assets-v1",
    ),
  };
}

function createReadySnapshotStorageSchemaForTest(schemaVersion: string) {
  return {
    status: "ready",
    schemaVersion,
    migrationStatus: "up-to-date",
    snapshotStore: "json-atomic-snapshot",
    auditLog: "jsonl-append-only",
    backupStore: "json-atomic-snapshot",
    restoreDrillLog: "jsonl-append-only",
    revisionControl: "optimistic-revision",
    concurrencyControl: "atomic-rename-with-revision-check",
    productionDatabaseAdapter: {
      status: "ready",
      providerClass: "managed-database",
      migrationStatus: "up-to-date",
      backupPolicy: "point-in-time-restore",
      concurrencyControl: "transactional",
      valueRedacted: true,
    },
    valueRedacted: true,
  };
}

function createReadySnapshotStorageSchemaWithoutBackupForTest(schemaVersion: string) {
  return {
    status: "ready",
    schemaVersion,
    migrationStatus: "up-to-date",
    snapshotStore: "json-atomic-snapshot",
    auditLog: "jsonl-append-only",
    revisionControl: "optimistic-revision",
    concurrencyControl: "atomic-rename-with-revision-check",
    valueRedacted: true,
  };
}

function createProvedProductionServiceIdentityForTest() {
  return {
    status: "proved",
    serviceMode: "production",
    serviceTarget: "uais-external-storage-production-service",
    valueRedacted: true,
  };
}

function createMatchedVercelEnvSyncForTest({
  baseUrl,
  releaseRunId,
}: {
  baseUrl: string;
  releaseRunId: string;
}) {
  return {
    target: "vercel-env-sync",
    mode: "apply",
    releaseRunId,
    projectReadinessEvidenceStatus: "ready",
    targets: ["production", "preview"],
    applySummary: {
      status: "applied",
      appliedActions: 4,
      appliedByTarget: { production: 2, preview: 2 },
      localOnlyEntriesSkipped: 2,
      valuesRedacted: true,
      cliOutputOmitted: true,
    },
    applyPreflight: {
      status: "passed",
      blockedReasons: [],
      valuesRedacted: true,
      cliSafeToInvoke: true,
    },
    externalStorageServiceFingerprint: createStorageServiceFingerprintForTest(baseUrl),
  };
}

function createReadyProductionLaunchContractForTest() {
  return {
    target: "external-storage-service-production-launcher",
    mode: "dry-run",
    status: "ready",
    serviceMode: "production",
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
      dataDirPersistence: "persistent-volume",
      persistentVolumeRequired: true,
      valuesRedacted: true,
    },
    containerArtifact: {
      dockerfile: "Dockerfile.external-storage",
      dockerignore: ".dockerignore",
      persistentVolumePath: "/data/uais-external-storage",
      imageSecretsPolicy: "env-only-at-runtime",
      valueRedacted: true,
    },
    requiredEnv: [
      {
        name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
        status: "present",
        strength: "sufficient",
        valueRedacted: true,
      },
      {
        name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
        status: "present",
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
    ],
    blockedReasons: [],
    safety: {
      accessTokenOmitted: true,
      dataDirOmitted: true,
      localPrivatePathsOmitted: true,
      startupOutputRedacted: true,
      productionServiceModeForced: true,
    },
  };
}

async function execFileResultForTest(command: string, args: string[]) {
  try {
    const stdout = await execFileAsync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return {
      exitCode: 0,
      stdout: stdout.stdout,
      stderr: stdout.stderr,
    };
  } catch (error: unknown) {
    const candidate = error as {
      code?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };
    return {
      exitCode: typeof candidate.code === "number" ? candidate.code : 1,
      stdout: String(candidate.stdout ?? ""),
      stderr: String(candidate.stderr ?? ""),
    };
  }
}
