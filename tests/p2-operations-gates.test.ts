import { spawnSync } from "node:child_process";
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
