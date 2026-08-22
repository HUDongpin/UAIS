import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cleanEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
};

describe("P2 protected operations gates", () => {
  it("reports BLOCKED_ENV instead of contacting a load target when staging is absent", () => {
    const result = run("scripts/p2-load-test.mjs", [], cleanEnv);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-staging-load",
      status: "BLOCKED_ENV",
      networkUsed: false,
      blockedReasons: expect.arrayContaining([
        "missing-P2_LOAD_BASE_URL",
        "missing-P2_LOAD_CONFIRM",
      ]),
    });
  });

  it("rejects production load targets before any request", () => {
    const result = run("scripts/p2-load-test.mjs", ["--dry-run"], {
      ...cleanEnv,
      P2_LOAD_BASE_URL: "https://uais.top",
      P2_LOAD_ALLOWLIST: "uais.top,staging.uais.top",
      P2_LOAD_CONFIRM: "staging",
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "FAIL",
      networkUsed: false,
      blockedReasons: ["production-hostname-rejected"],
    });
  });

  it("builds the 200-user staging load plan without using the network", () => {
    const result = run("scripts/p2-load-test.mjs", ["--dry-run"], {
      ...cleanEnv,
      P2_LOAD_BASE_URL: "https://staging.uais.top",
      P2_LOAD_ALLOWLIST: "staging.uais.top",
      P2_LOAD_CONFIRM: "staging",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "PASS",
      mode: "dry-run",
      networkUsed: false,
      scenarios: [
        expect.objectContaining({ id: "invite-join", users: 200 }),
        expect.objectContaining({
          id: "group-collaboration",
          users: 200,
          groups: 40,
          durationSeconds: 600,
          provider: "deterministic-stub",
        }),
      ],
    });
  });

  it("reports the missing staging executor explicitly instead of an empty blocker", () => {
    const result = run("scripts/p2-load-test.mjs", [], {
      ...cleanEnv,
      P2_LOAD_BASE_URL: "https://staging.uais.top",
      P2_LOAD_ALLOWLIST: "staging.uais.top",
      P2_LOAD_CONFIRM: "staging",
      P2_LOAD_FIXTURE_MANIFEST: "/redacted/p2-load-fixture.json",
      P2_LOAD_CLEANUP_CONFIRM: "run-id-cleanup",
    });

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "BLOCKED_ENV",
      networkUsed: false,
      blockedReasons: ["staging-load-executor-not-configured"],
    });
  });

  it("blocks live provider smoke until every cost and safety proof is present", () => {
    const result = run("scripts/p2-provider-live-smoke.mjs", [], cleanEnv);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-provider-live-smoke",
      status: "BLOCKED_ENV",
      networkUsed: false,
      maxRequests: 3,
      blockedReasons: expect.arrayContaining([
        "missing-P2_PROVIDER_LIVE_CONFIRM",
        "missing-P2_PROVIDER_BUDGET_CAP_USD",
        "missing-P2_PROVIDER_RATE_LIMIT_RPM",
        "missing-P2_PROVIDER_MONITORING",
      ]),
    });
  });

  it("builds the five-page Lighthouse plan without starting a server or browser", () => {
    const result = run("scripts/p2-performance-test.mjs", ["--dry-run"], cleanEnv);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-performance",
      status: "NOT_RUN",
      mode: "dry-run",
      networkUsed: false,
      pages: ["/login", "/courses", "/learning", "/learning/chatroom", "/teaching"],
      budgets: {
        lighthousePerformanceMinimum: 85,
        largestContentfulPaintMillisecondsMaximum: 2_500,
        cumulativeLayoutShiftMaximum: 0.1,
        totalBlockingTimeMillisecondsMaximum: 200,
      },
    });
  });

  it("rejects a production hostname before a Lighthouse request", () => {
    const result = run("scripts/p2-performance-test.mjs", ["--dry-run"], {
      ...cleanEnv,
      P2_PERFORMANCE_BASE_URL: "https://uais.top",
      P2_PERFORMANCE_ALLOWLIST: "uais.top,staging.uais.top",
      P2_PERFORMANCE_CONFIRM: "staging",
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "FAIL",
      networkUsed: false,
      blockedReasons: ["production-hostname-rejected"],
    });
  });

  it("lists the local P2 quality gate in its required order without executing it", () => {
    const result = run("scripts/p2-quality-gate.mjs", ["--dry-run"], cleanEnv);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-local-quality-gate",
      status: "NOT_RUN",
      commands: [
        "npm run lint",
        "npm run test",
        "npm run test:critical",
        "npm run build",
        "npm run test:p2:e2e",
        "npm run test:p2:a11y",
        "npm run test:p2:performance",
        "node scripts/p2-evidence-check.mjs",
      ],
    });
  });

  it("requires dedicated P2 database URLs and internal guards before migrations or writes", () => {
    const buildSource = readFileSync("scripts/p2-staging-build.mjs", "utf8");
    const liveSource = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");

    for (const source of [buildSource, liveSource]) {
      expect(source).toContain("UAIS_P2_STAGING_DATABASE_URL");
      expect(source).toContain("UAIS_P2_STAGING_RESTORE_DATABASE_URL");
      expect(source).toContain("isolated-p2-staging-source");
      expect(source).toContain("isolated-p2-staging-restore");
      expect(source).not.toContain("process.env.DATABASE_URL");
      expect(source).not.toContain("process.env.POSTGRES_URL");
    }

    const buildGuard = buildSource.indexOf("await assertDatabaseGuard(");
    const firstMigration = buildSource.indexOf(
      'runNode(["scripts/apply-core-migrations.mjs"]',
    );
    expect(buildGuard).toBeGreaterThan(-1);
    expect(firstMigration).toBeGreaterThan(buildGuard);

    const liveGuard = liveSource.indexOf("await validateDatabaseGuards(");
    const firstCleanup = liveSource.indexOf("await cleanupTaggedData(sourceSql");
    expect(liveGuard).toBeGreaterThan(-1);
    expect(firstCleanup).toBeGreaterThan(liveGuard);
  });

  it("binds manual staging fixtures and cleanup to the explicit load run ID", () => {
    const buildSource = readFileSync("scripts/p2-staging-build.mjs", "utf8");
    const liveSource = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");

    expect(buildSource).not.toMatch(/P2_LOAD_RUN_ID:\s*"p2-/);
    expect(liveSource).toContain('const manualPrefix = `${runId}-manual-`;');
    expect(liveSource).toContain(
      "const manualStudentAccount = `${manualPrefix}student`;",
    );
    expect(liveSource).toContain(
      "const manualTeacherAccount = `${manualPrefix}teacher`;",
    );
    expect(liveSource).not.toContain('"p2-manual-');
    expect(liveSource).toContain('courseName: "P2 Quality Pilot"');
    expect(liveSource).toContain('courseName: "P2 Manual Accessibility"');
    expect(liveSource).not.toContain('courseName: `P2 Quality Pilot ${runId}`');
    expect(liveSource).not.toContain('courseName: `P2 Manual Accessibility ${runId}`');
    expect(liveSource).toContain('currentStage = "manual-membership-join";');
    expect(liveSource).toContain('/^p2-[a-z0-9-]{8,23}$/');
    expect(liveSource).toContain("accountPrefixes: [manualPrefix]");
    expect(liveSource).toContain("textMarkers: [runId]");
  });

  it("keeps the staging build independent from the one-shot live load", () => {
    const buildSource = readFileSync("scripts/p2-staging-build.mjs", "utf8");

    expect(buildSource).not.toContain("scripts/p2-staging-live-load.mjs");
    expect(buildSource).not.toContain("P2_LOAD_RUN_ID");
    expect(buildSource).not.toContain("P2_LOAD_CLEANUP_CONFIRM");
  });

  it("plans the read-only health aggregate without database or fixture credentials", () => {
    const result = runTsx(
      "scripts/p2-staging-live-load.mjs",
      ["--dry-run", "--health-only"],
      {
        ...cleanEnv,
        P2_LOAD_BASE_URL: "https://staging.uais.top",
        P2_LOAD_ALLOWLIST: "staging.uais.top",
        P2_LOAD_CONFIRM: "staging",
        UAIS_DEPLOYMENT_ENV: "staging",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
      },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-isolated-staging-live-executor",
      status: "PASS",
      mode: "dry-run",
      phase: "health-only",
      blockedReasons: [],
      plan: {
        healthOnly: true,
        healthSamples: 15,
        healthIntervalSeconds: 60,
      },
      safety: {
        networkUsed: false,
      },
    });
  });
});

function run(
  script: string,
  args: string[],
  env: Record<string, string | undefined>,
) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
}

function runTsx(
  script: string,
  args: string[],
  env: Record<string, string | undefined>,
) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
}
