import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  createP2StagingMigrationChildEnv,
  createP2StagingRuntimeChildEnv,
  runRedactedP2StagingChild,
} from "../scripts/p2-staging-build-child.mjs";

const sourceUrl =
  "postgresql://source-user:source-secret@source.example.test/uais";
const restoreUrl =
  "postgresql://restore-user:restore-secret@restore.example.test/uais";
const providerSecret = "deepseek-provider-secret-fixture-123456";

const baseEnv = {
  PATH: "/fixture/bin",
  TMPDIR: "/fixture/tmp",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
  UAIS_DEPLOYMENT_ENV: "staging",
  UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
  UAIS_P2_STAGING_DATABASE_URL: sourceUrl,
  UAIS_P2_STAGING_RESTORE_DATABASE_URL: restoreUrl,
  UAIS_DB_TEST_DATABASE_URL:
    "postgresql://db-test-user:db-test-secret@db-test.example.test/uais",
  UAIS_P1_LOAD_TEST_DATABASE_URL:
    "postgresql://load-user:load-secret@load.example.test/uais",
  UAIS_CORE_DATABASE_URL:
    "postgresql://generic-user:generic-secret@generic.example.test/uais",
  DATABASE_URL:
    "postgresql://generic-user:generic-secret@generic.example.test/uais",
  POSTGRES_URL:
    "postgresql://generic-user:generic-secret@generic.example.test/uais",
  RESTORE_DATABASE_URL: restoreUrl,
  RESTORE_POSTGRES_URL: restoreUrl,
  UAIS_CORE_DATABASE_REQUIRED_GUARD: "ambient-guard-must-not-reach-runtime",
  RESTORE_NEON_PROJECT_ID: "restore-project-fixture",
  DEEPSEEK_API_KEY: providerSecret,
};

describe("P2 source/restore staging child isolation", () => {
  it("gives each migration child only its single target and guard contract", () => {
    const source = createP2StagingMigrationChildEnv({
      baseEnv,
      databaseUrl: sourceUrl,
      requiredGuard: "isolated-p2-staging-source",
    });
    const restore = createP2StagingMigrationChildEnv({
      baseEnv,
      databaseUrl: restoreUrl,
      requiredGuard: "isolated-p2-staging-restore",
    });

    for (const [child, selectedUrl, rejectedUrl] of [
      [source, sourceUrl, restoreUrl],
      [restore, restoreUrl, sourceUrl],
    ] as const) {
      expect(child.UAIS_CORE_DATABASE_URL).toBe(selectedUrl);
      expect(Object.values(child)).not.toContain(rejectedUrl);
      expect(child).not.toHaveProperty("UAIS_P2_STAGING_DATABASE_URL");
      expect(child).not.toHaveProperty("UAIS_P2_STAGING_RESTORE_DATABASE_URL");
      expect(child).not.toHaveProperty("UAIS_DB_TEST_DATABASE_URL");
      expect(child).not.toHaveProperty("UAIS_P1_LOAD_TEST_DATABASE_URL");
      expect(child).not.toHaveProperty("DEEPSEEK_API_KEY");
      expect(child.TMPDIR).toBe("/fixture/tmp");
    }
  });

  it("keeps the source runtime target but removes restore/test/generic targets", () => {
    const runtime = createP2StagingRuntimeChildEnv(baseEnv);

    expect(runtime.UAIS_P2_STAGING_DATABASE_URL).toBe(sourceUrl);
    expect(runtime.DEEPSEEK_API_KEY).toBe(providerSecret);
    for (const name of [
      "UAIS_P2_STAGING_RESTORE_DATABASE_URL",
      "RESTORE_NEON_PROJECT_ID",
      "UAIS_DB_TEST_DATABASE_URL",
      "UAIS_P1_LOAD_TEST_DATABASE_URL",
      "UAIS_CORE_DATABASE_URL",
      "DATABASE_URL",
      "POSTGRES_URL",
      "RESTORE_DATABASE_URL",
      "RESTORE_POSTGRES_URL",
      "UAIS_CORE_DATABASE_REQUIRED_GUARD",
    ]) {
      expect(runtime).not.toHaveProperty(name);
    }
  });

  it("captures and redacts every inherited child secret before forwarding output", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const spawn = vi.fn(() => ({
      status: 9,
      stdout: `${sourceUrl}\n${providerSecret}\n`,
      stderr: `${restoreUrl}\n`,
    }));

    const result = runRedactedP2StagingChild({
      args: ["fixture-script.mjs"],
      env: baseEnv,
      spawn,
      stdout: { write: (value: string) => stdout.push(value) },
      stderr: { write: (value: string) => stderr.push(value) },
    });

    expect(result.status).toBe(9);
    expect(spawn).toHaveBeenCalledOnce();
    const forwarded = `${stdout.join("")}\n${stderr.join("")}`;
    for (const secret of [sourceUrl, restoreUrl, providerSecret]) {
      expect(forwarded).not.toContain(secret);
    }
    expect(forwarded).toContain("[REDACTED_POSTGRES_DSN]");
    expect(forwarded).toContain("[REDACTED]");
  });

  it("blocks malformed credential-bearing DSNs before client construction without echoing them", () => {
    const invalidSource =
      "postgresql://source-user:source-secret-that-must-not-leak@%invalid/uais";
    const invalidRestore =
      "postgresql://restore-user:restore-secret-that-must-not-leak@%other/uais";
    const outcome = spawnSync(
      process.execPath,
      ["scripts/p2-staging-build.mjs", "--guard-only"],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
          UAIS_DEPLOYMENT_ENV: "staging",
          UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
          UAIS_P2_STAGING_DATABASE_URL: invalidSource,
          UAIS_P2_STAGING_RESTORE_DATABASE_URL: invalidRestore,
          NEON_PROJECT_ID: "source-project-fixture",
          RESTORE_NEON_PROJECT_ID: "restore-project-fixture",
        },
        encoding: "utf8",
      },
    );

    expect(outcome.status).toBe(2);
    const output = `${outcome.stdout}\n${outcome.stderr}`;
    expect(output).toContain("dedicated-source-staging-database-url-invalid");
    expect(output).toContain("dedicated-restore-staging-database-url-invalid");
    expect(output).not.toContain(invalidSource);
    expect(output).not.toContain(invalidRestore);
    expect(output).not.toContain("must-not-leak");
  });
});
