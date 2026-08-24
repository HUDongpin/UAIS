import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

describe("P1 migration preflight CLI", () => {
  it("prints a redacted plan without opening a database connection", async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["scripts/learning-loop-migration-preflight.mjs", "--plan"],
      { cwd: process.cwd(), env: {} },
    );
    const report = JSON.parse(stdout.trim());

    expect(report).toMatchObject({
      target: "learning-loop-migration-preflight",
      status: "plan",
      valueRedacted: true,
      migrations: ["0008_learning_closed_loop_domain", "0009_learning_event_outbox"],
    });
    expect(report.counts).toEqual(
      expect.arrayContaining([
        "users",
        "courses",
        "lessons",
        "assessments",
        "submissions",
        "learningEvents",
      ]),
    );
    expect(JSON.stringify(report)).not.toContain("content_text");
    expect(JSON.stringify(report)).not.toContain("feedback_text");
    expect(JSON.stringify(report)).not.toContain("postgres://");
  });

  it("refuses ordinary database variables for the destructive DB test lane", async () => {
    let observed:
      | { code?: number; stderr?: string; stdout?: string }
      | undefined;
    try {
      await promisify(execFile)(process.execPath, ["scripts/run-db-tests.mjs"], {
        cwd: process.cwd(),
        env: {
          DATABASE_URL: "postgres://ordinary-variable-must-not-be-used.invalid/uais",
          POSTGRES_URL: "postgres://ordinary-variable-must-not-be-used.invalid/uais",
          UAIS_CORE_DATABASE_URL:
            "postgres://ordinary-variable-must-not-be-used.invalid/uais",
        },
      });
    } catch (error) {
      observed = error as { code?: number; stderr?: string; stdout?: string };
    }

    expect(observed?.code).toBe(2);
    const report = JSON.parse(observed?.stderr?.trim() ?? "{}");
    expect(report).toMatchObject({
      target: "uais-postgres-integration-lane",
      status: "launch-critical-skipped",
      reasonCode: "dedicated-db-test-database-url-required",
      acceptedEnvName: "UAIS_DB_TEST_DATABASE_URL",
      valueRedacted: true,
    });
    expect(JSON.stringify(report)).not.toContain("postgres://");
  });

  it("guards direct integration-test execution before migrations or writes", async () => {
    const source = await readFile(
      "tests/learning-loop-postgres-integration.test.ts",
      "utf8",
    );
    const runnerSource = await readFile("scripts/run-db-tests.mjs", "utf8");

    expect(source).toContain("authorizeLiveDatabaseTestFile");
    expect(source).toContain('lane: "legacy"');
    expect(source).toContain(
      'testFile: "tests/learning-loop-postgres-integration.test.ts"',
    );
    expect(source).not.toContain(
      "const databaseUrl = process.env.UAIS_CORE_DATABASE_URL?.trim();",
    );
    const guardIndex = source.indexOf("authorizeLiveDatabaseTestFile({");
    const migrationIndex = source.indexOf('"scripts/apply-core-migrations.mjs"');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(migrationIndex).toBeGreaterThan(guardIndex);
    expect(runnerSource).toContain("dedicated-runner-capability-required");
    expect(runnerSource).toContain("isolated-uais-db-test");
    expect(runnerSource).toContain("isolated-p2-staging-source");
  });
});
