import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const databaseEnvNames = [
  "UAIS_DB_TEST_DATABASE_URL",
  "UAIS_DB_TEST_LIVE_MUTATION_CONFIRMATION",
  "UAIS_DB_TEST_NEON_PROJECT_ID",
  "UAIS_DB_TEST_DSN_FINGERPRINT_NONCE",
  "UAIS_DB_TEST_DSN_FINGERPRINT",
  "UAIS_CORE_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "UAIS_DETERMINISTIC_DB_SKIP",
] as const;

describe("staging INP live Postgres entry guard", () => {
  it("returns nonzero BLOCKED_ENV instead of passing when invoked directly without a live target", () => {
    const outcome = runLiveIntegrationDirectly(withoutDatabaseEnvironment());

    expect(outcome.status).not.toBe(0);
    expect(`${outcome.stdout}\n${outcome.stderr}`).toContain("BLOCKED_ENV");
    expect(`${outcome.stdout}\n${outcome.stderr}`).not.toContain("postgres://");
    expect(`${outcome.stdout}\n${outcome.stderr}`).not.toContain(
      "postgresql://",
    );
  });

  it("does not treat a dedicated URL alone or an inexact skip marker as authorization", () => {
    const fixtureUrl =
      "postgresql://fixture-user:fixture-password@fixture.invalid/uais_test";
    const outcome = runLiveIntegrationDirectly(
      withoutDatabaseEnvironment({
        UAIS_DB_TEST_DATABASE_URL: fixtureUrl,
        UAIS_DETERMINISTIC_DB_SKIP: "1",
      }),
    );
    const output = `${outcome.stdout}\n${outcome.stderr}`;

    expect(outcome.status).not.toBe(0);
    expect(output).toContain("BLOCKED_ENV");
    expect(output).not.toContain(fixtureUrl);
    expect(output).not.toContain("fixture-password");
    expect(output).not.toContain("fixture.invalid");
  });

  it("labels ambient generic database aliases BLOCKED_ENV rather than skipped or passed", () => {
    const genericUrl =
      "postgresql://generic-user:generic-password@generic.invalid/uais";
    const outcome = runLiveIntegrationDirectly(
      withoutDatabaseEnvironment({ DATABASE_URL: genericUrl }),
    );
    const output = `${outcome.stdout}\n${outcome.stderr}`;

    expect(outcome.status).not.toBe(0);
    expect(output).toContain("BLOCKED_ENV");
    expect(output).not.toContain("launch-critical-skipped");
    expect(output).not.toContain(genericUrl);
    expect(output).not.toContain("generic-password");
  });
});

function runLiveIntegrationDirectly(env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--no-file-parallelism",
      "tests/staging-inp-rum-postgres-integration.test.ts",
    ],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    },
  );
}

function withoutDatabaseEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of databaseEnvNames) delete env[name];
  return { ...env, ...overrides };
}
