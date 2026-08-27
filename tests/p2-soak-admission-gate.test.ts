import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cwd = process.cwd();
const currentGitSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd,
  encoding: "utf8",
}).trim();
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("P2 staging soak admission gate", () => {
  it("keeps the current 376 evidence fail-closed and names every upstream blocker", () => {
    const result = runGate(blockedManifest());

    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({
      target: "p2-staging-soak-admission",
      status: "SOAK_NOT_ADMITTED",
      soakAdmitted: false,
      blockedReasons: expect.arrayContaining([
        "staging-health-not-pass",
        "p1-performance-not-pass",
        "p2-active-user-ramp-not-pass",
        "p2-sustained-load-not-pass",
        "field-inp-p75-not-pass",
        "voiceover-safari-not-pass",
        "nvda-chrome-not-pass",
        "keyboard-journey-not-pass",
        "reflow-200-not-pass",
        "reduced-motion-not-pass",
        "touch-targets-not-pass",
        "non-color-information-not-pass",
      ]),
      safety: {
        productionAuthorization: "NO",
        productionGroupMode: "off",
        noProductionMutation: true,
      },
    });
  });

  it("rejects a sustained PASS that follows a failed active-user ramp", () => {
    const manifest = greenManifest();
    manifest.gates.p2.activeUserRamp = {
      status: "FAIL",
      evidenceClass: "current-candidate-regional",
      evidenceRefs: ["failed-ramp"],
      targetActiveUsers: 200,
      aggregateP95Ms: 3146,
      maximumP95Ms: 2000,
    };

    const result = runGate(manifest);

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({
      status: "FAIL",
      soakAdmitted: false,
      validationErrors: expect.arrayContaining([
        "p2-sustained-pass-requires-active-user-ramp-pass",
        "manifest-soak-admitted-contradicts-gates",
      ]),
    });
  });

  it("rejects machine-only evidence that tries to satisfy a human manual gate", () => {
    const manifest = greenManifest();
    manifest.gates.manualAccessibility.voiceOverSafari.evidenceClass =
      "automated-browser";

    const result = runGate(manifest);

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({
      status: "FAIL",
      soakAdmitted: false,
      validationErrors: expect.arrayContaining([
        "voiceover-safari-pass-requires-human-attested-evidence",
        "manifest-soak-admitted-contradicts-gates",
      ]),
    });
  });

  it("admits a not-yet-started soak only when every exact-candidate gate is green", () => {
    const result = runGate(greenManifest());

    expect(result.status).toBe(0);
    expect(result.body).toMatchObject({
      target: "p2-staging-soak-admission",
      status: "SOAK_ADMITTED",
      soakAdmitted: true,
      blockedReasons: [],
      candidate: {
        gitSha: currentGitSha,
        matchesHead: true,
      },
      safety: {
        productionAuthorization: "NO",
        productionGroupMode: "off",
        noProductionMutation: true,
      },
    });
  });
});

function runGate(manifest: ReturnType<typeof greenManifest>) {
  const directory = mkdtempSync(join(tmpdir(), "uais-soak-admission-"));
  temporaryDirectories.push(directory);
  const manifestPath = join(directory, "soak-admission.json");
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  const result = spawnSync(
    process.execPath,
    ["scripts/p2-soak-admission-gate.mjs", "--manifest", manifestPath],
    { cwd, encoding: "utf8" },
  );
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(result.stdout);
  } catch {
    body = {};
  }
  return { status: result.status, body, stderr: result.stderr };
}

function blockedManifest(): ReturnType<typeof greenManifest> {
  const manifest = greenManifest();
  manifest.decision = "SOAK_NOT_ADMITTED";
  manifest.gates.stagingHealth = {
    status: "FAIL",
    evidenceClass: "current-candidate-external",
    evidenceRefs: ["bound-376-health-database-unreachable-four-of-four"],
    sampleCount: 4,
    successCount: 0,
    app: "ok",
    database: "unreachable",
    migrations: "unknown",
  };
  manifest.gates.p1.performance = {
    status: "FAIL",
    evidenceClass: "current-candidate-external",
    evidenceRefs: ["cle1-cross-region-failed-p1-executor"],
    studentCount: 200,
    submitWindowMs: 31_133,
    maximumSubmitWindowMs: 30_000,
    operationP95Ms: {
      taskRead: 4740.06,
      checkpoint: 6727.26,
      autosave: 4663.57,
      submit: 10899.04,
      teacherDecision: 7966.47,
    },
    maximumOperationP95Ms: 1500,
  };
  manifest.gates.p2.activeUserRamp = {
    status: "FAIL",
    evidenceClass: "current-candidate-external",
    evidenceRefs: ["376-active-user-ramp-3146ms"],
    targetActiveUsers: 200,
    aggregateP95Ms: 3146,
    maximumP95Ms: 2000,
  };
  manifest.gates.p2.sustained = {
    status: "NOT_RUN",
    evidenceClass: "not-executed-after-ramp-failure",
    evidenceRefs: ["376-run-stopped-before-sustained"],
    activeUsers: 200,
    rounds: 10,
  };
  manifest.gates.rum.fieldInpP75 = {
    status: "NOT_RUN",
    evidenceClass: "no-approved-real-user-cohort",
    evidenceRefs: ["approved-real-user-rum-absent"],
    p75Ms: null,
    maximumP75Ms: 200,
    groups: 0,
    requiredGroups: 12,
    minimumSamplesPerGroup: 30,
    minimumDistinctOperatorsPerGroup: 3,
  };
  for (const gate of Object.values(manifest.gates.manualAccessibility)) {
    gate.status = "NOT_RUN";
    gate.evidenceClass = "human-evidence-absent";
    gate.evidenceRefs = ["human-signoff-required"];
  }
  return manifest;
}

function greenManifest() {
  const currentCandidate = {
    status: "PASS",
    evidenceClass: "current-candidate",
    evidenceRefs: ["current-candidate-evidence"],
  };
  const humanGate = {
    status: "PASS",
    evidenceClass: "human-attested",
    evidenceRefs: ["signed-human-record"],
  };
  return {
    schemaVersion: 1,
    decision: "SOAK_ADMITTED",
    candidate: {
      gitSha: currentGitSha,
      evidenceClass: "current-candidate",
    },
    gates: {
      stagingHealth: {
        status: "PASS",
        evidenceClass: "current-candidate-external",
        evidenceRefs: ["bound-current-candidate-health-pass"],
        sampleCount: 15,
        successCount: 15,
        app: "ok",
        database: "ok",
        migrations: "ok",
      },
      p1: {
        conservation: {
          ...currentCandidate,
          studentCount: 200,
          attempts: 200,
          submissions: 200,
          versions: 200,
          profiles: 200,
          duplicateVersions: 0,
        },
        cleanup: {
          ...currentCandidate,
          sourceRowsRemaining: 0,
          restoreRowsRemaining: 0,
        },
        performance: {
          status: "PASS",
          evidenceClass: "current-candidate-regional",
          evidenceRefs: ["regional-live-p1-pass"],
          studentCount: 200,
          submitWindowMs: 29_999,
          maximumSubmitWindowMs: 30_000,
          operationP95Ms: {
            taskRead: 1400,
            checkpoint: 1400,
            autosave: 1400,
            submit: 1400,
            teacherDecision: 1400,
          },
          maximumOperationP95Ms: 1500,
        },
      },
      p2: {
        inviteRamp: {
          status: "PASS",
          evidenceClass: "current-candidate-regional",
          evidenceRefs: ["regional-invite-ramp-pass"],
          targetUsers: 200,
          aggregateP95Ms: 1900,
          maximumP95Ms: 2000,
        },
        activeUserRamp: {
          status: "PASS",
          evidenceClass: "current-candidate-regional",
          evidenceRefs: ["regional-active-user-ramp-pass"],
          targetActiveUsers: 200,
          aggregateP95Ms: 1999,
          maximumP95Ms: 2000,
        },
        sustained: {
          status: "PASS",
          evidenceClass: "current-candidate-regional",
          evidenceRefs: ["regional-sustained-pass"],
          activeUsers: 200,
          rounds: 10,
        },
      },
      rum: {
        fieldInpP75: {
          status: "PASS",
          evidenceClass: "approved-real-user-rum",
          evidenceRefs: ["approved-real-user-rum-pass"],
          p75Ms: 199,
          maximumP75Ms: 200,
          groups: 12,
          requiredGroups: 12,
          minimumSamplesPerGroup: 30,
          minimumDistinctOperatorsPerGroup: 3,
        },
      },
      manualAccessibility: {
        voiceOverSafari: { ...humanGate },
        nvdaChrome: { ...humanGate },
        keyboardJourney: { ...humanGate },
        reflow200: { ...humanGate },
        reducedMotion: { ...humanGate },
        touchTargets: { ...humanGate },
        nonColorInformation: { ...humanGate },
      },
      dependencies: {
        productionAudit: {
          status: "PASS",
          evidenceClass: "current-lockfile-audit",
          evidenceRefs: ["production-audit-zero"],
          vulnerabilities: 0,
        },
        fullTreeReview: {
          status: "PASS",
          evidenceClass: "reviewed-mitigation",
          evidenceRefs: ["full-tree-reachability-and-mitigation-review"],
          disposition: "MITIGATED_OPEN",
          moderate: 9,
          high: 1,
          unsafeDowngradeApplied: false,
        },
      },
    },
    safety: {
      productionGroupMode: "off",
      productionAuthorization: "NO",
      mainPushed: false,
      productionDeployed: false,
      productionEnvironmentChanged: false,
      productionFeatureFlagsChanged: false,
    },
    soak: {
      started: false,
      startedAt: null,
    },
  };
}
