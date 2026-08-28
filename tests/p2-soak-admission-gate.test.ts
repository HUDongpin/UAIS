import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeUaisStagingCandidateContentSha } from "../scripts/p2-staging-candidate-content.mjs";
import {
  createSoakEvidenceIndexSigningPayload,
  createSoakEvidenceReceiptSigningPayload,
} from "../scripts/p2-soak-evidence-resolver.mjs";
import { runP2SoakAdmissionGate } from "../scripts/p2-soak-admission-gate.mjs";
import * as soakGateModule from "../scripts/p2-soak-admission-gate.mjs";

const cwd = process.cwd();
const currentGitSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd,
  encoding: "utf8",
}).trim();
const currentContentSha256 = computeUaisStagingCandidateContentSha(cwd);
const currentLockfileSha256 = createHash("sha256")
  .update(readFileSync(join(cwd, "package-lock.json")))
  .digest("hex");
const deploymentId = "dpl_SignedSoakEvidenceCandidate12345";
const deploymentHost = "uais-staging-signed-candidate.vercel.app";
const projectId = "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL";
const authorityKeyId = "s22-soak-authority-test-1";
const p1RunId = "p1-live-all-gates-01";
const p2RunId = "p2-live-all-gates-01";
const rumCohortId = "p2-inp-real-adults-01";
const rumRunId = rumCohortId;
const manualExecutionId = "manual-a11y-all-gates-01";
const receiptSchemas = [
  "uais.staging-health.v1",
  "uais.p1-load.v1",
  "uais.p2-load.v1",
  "uais.rum-approval.v1",
  "uais.manual-accessibility.v1",
  "uais.dependency-review.v1",
  "uais.production-safety.v1",
] as const;
const sourceAuthorityRoles: Record<(typeof receiptSchemas)[number], string> = {
  "uais.staging-health.v1": "health-probe-issuer",
  "uais.p1-load.v1": "p1-load-issuer",
  "uais.p2-load.v1": "p2-load-issuer",
  "uais.rum-approval.v1": "rum-independent-approver",
  "uais.manual-accessibility.v1": "manual-a11y-reviewer",
  "uais.dependency-review.v1": "dependency-audit-reviewer",
  "uais.production-safety.v1": "production-safety-verifier",
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("P2 staging soak admission gate", () => {
  it("rejects the legacy scalar green manifest and arbitrary evidenceRefs", () => {
    const directory = makeTemporaryDirectory();
    const trusted = createSignedBundle();
    const manifestPath = join(directory, "legacy-green.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        decision: "SOAK_ADMITTED",
        candidate: { gitSha: currentGitSha, evidenceClass: "current-candidate" },
        gates: {
          stagingHealth: {
            status: "PASS",
            evidenceClass: "current-candidate-external",
            evidenceRefs: ["caller-controlled-string"],
            sampleCount: 16,
            successCount: 16,
          },
        },
      }),
      "utf8",
    );

    const result = runGate(manifestPath, trusted.trustPolicyPath, trusted);

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({
      status: "FAIL",
      soakAdmitted: false,
      validationErrors: expect.arrayContaining(["manifest-schema-version-unsupported"]),
    });
  });

  it("fails closed when the independent trust policy is missing", () => {
    const bundle = createSignedBundle();

    const result = runGate(
      bundle.manifestPath,
      join(bundle.directory, "absent-policy.json"),
      bundle,
    );

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({
      status: "FAIL",
      soakAdmitted: false,
      validationErrors: expect.arrayContaining(["trust-policy-missing-or-unreadable"]),
    });
  });

  it("requires owner UID plus 0700 parent and 0600 file for owner pins", () => {
    const inspectSecureOwnerPinsFile = (
      soakGateModule as unknown as {
        inspectSecureOwnerPinsFile?: (
          path: string,
          expectedUid?: number,
        ) => { ok: boolean; errors?: string[] };
      }
    ).inspectSecureOwnerPinsFile;
    expect(inspectSecureOwnerPinsFile).toBeTypeOf("function");

    const bundle = createSignedBundle();
    const directory = makeTemporaryDirectory();
    const ownerPinPath = join(directory, "owner-pins.json");
    chmodSync(directory, 0o700);
    writeFileSync(ownerPinPath, JSON.stringify(bundle.ownerPins), "utf8");
    chmodSync(ownerPinPath, 0o600);

    expect(inspectSecureOwnerPinsFile!(ownerPinPath)).toMatchObject({ ok: true });
    expect(inspectSecureOwnerPinsFile!(ownerPinPath, null as never)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["owner-trust-pins-owner-invalid"]),
    });
    expect(
      inspectSecureOwnerPinsFile!(ownerPinPath, (process.getuid?.() ?? 0) + 1),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["owner-trust-pins-owner-invalid"]),
    });

    chmodSync(directory, 0o755);
    expect(inspectSecureOwnerPinsFile!(ownerPinPath)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["owner-trust-pins-parent-invalid"]),
    });
  });

  it("keeps the injectable core non-authoritative even for a fully valid packet", () => {
    const bundle = createSignedBundle();

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status, JSON.stringify(result.body)).toBe(2);
    expect(result.body).toMatchObject({
      target: "p2-staging-soak-admission",
      status: "SOAK_NOT_ADMITTED",
      soakAdmitted: false,
      candidate: {
        gitSha: currentGitSha,
        contentSha256: currentContentSha256,
        deploymentId,
        deploymentHost,
        projectId,
        matchesCurrentSource: true,
      },
      gates: {
        "staging-health": true,
        "p1-conservation": true,
        "p1-cleanup": true,
        "p1-performance": true,
        "p2-invite-ramp": true,
        "p2-active-user-ramp": true,
        "p2-sustained-load": true,
        "field-inp-p75": true,
        "voiceover-safari": true,
        "nvda-chrome": true,
        "keyboard-journey": true,
        "reflow-200": true,
        "reduced-motion": true,
        "touch-targets": true,
        "non-color-information": true,
        "production-dependency-audit": true,
        "full-tree-dependency-review": true,
      },
      blockedReasons: ["non-authoritative-injected-core"],
      safety: {
        productionAuthorization: "NO",
        productionGroupMode: "off",
        noProductionMutation: true,
        sourceAuthorityVerified: true,
      },
      evidenceBoundary: {
        manifestIsContentAddressedIndexOnly: true,
        sourceMetricsRecomputed: true,
        ownerTrustPinsVerified: false,
        packetSignatureVerified: true,
        sourceSignaturesVerified: true,
        admissionEligibleInvocation: false,
      },
    });
    expect(result.body).not.toHaveProperty("rawReceipts");
    expect(result.body).not.toHaveProperty("trustPolicyPath");
  });

  it("does not let a caller opt the injectable core into authority", () => {
    const bundle = createSignedBundle();

    const result = runP2SoakAdmissionGate({
      manifestPath: bundle.manifestPath,
      trustPolicyPath: bundle.trustPolicyPath,
      ownerPins: bundle.ownerPins,
      root: cwd,
      authoritative: true,
    } as never);

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      soakAdmitted: false,
      blockedReasons: ["non-authoritative-injected-core"],
      evidenceBoundary: {
        ownerTrustPinsVerified: false,
        admissionEligibleInvocation: false,
      },
    });
  });

  it("rejects owner pins whose RUM run and cohort IDs differ", () => {
    const bundle = createSignedBundle();
    bundle.ownerPins.expectedRuns.rum.runId = "p2-inp-different-owner-run";

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(
      expect.arrayContaining(["expected-rum-run-cohort-id-mismatch"]),
    );
  });

  it("keeps authentic diagnostic or simulated P1/P2 evidence promotion-ineligible", () => {
    const bundle = createSignedBundle((payloads) => {
      payloads["uais.p1-load.v1"].executionClass = "diagnostic";
      payloads["uais.p1-load.v1"].performance.passClaimAuthorized = false;
      payloads["uais.p2-load.v1"].executionClass = "simulation";
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({
      status: "SOAK_NOT_ADMITTED",
      soakAdmitted: false,
      blockedReasons: expect.arrayContaining([
        "p1-conservation-not-pass",
        "p1-cleanup-not-pass",
        "p1-performance-not-pass",
        "p2-invite-ramp-not-pass",
        "p2-active-user-ramp-not-pass",
        "p2-sustained-load-not-pass",
      ]),
    });
  });

  it("rejects an artifact whose indexed digest no longer matches its bytes", () => {
    const bundle = createSignedBundle();
    const artifactPath = join(bundle.packetRoot, bundle.manifest.artifacts[0].path);
    writeFileSync(artifactPath, "{}", "utf8");

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({
      status: "FAIL",
      soakAdmitted: false,
      validationErrors: expect.arrayContaining([
        "artifact:staging-health:byte-length-mismatch",
      ]),
    });
  });

  it("does not let sustained load pass when the same-run active-user ramp fails", () => {
    const bundle = createSignedBundle((payloads) => {
      payloads["uais.p2-load.v1"].activeUserStages[4].latenciesMs = Array(200).fill(2_500);
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({
      status: "SOAK_NOT_ADMITTED",
      gates: {
        "p2-active-user-ramp": false,
        "p2-sustained-load": false,
      },
      blockedReasons: expect.arrayContaining([
        "p2-active-user-ramp-not-pass",
        "p2-sustained-load-not-pass",
      ]),
    });
  });

  it("does not promote unapproved RUM or automated assistive-technology evidence", () => {
    const bundle = createSignedBundle((payloads) => {
      payloads["uais.rum-approval.v1"].independentApprovalVerified = false;
      payloads["uais.manual-accessibility.v1"].executionClass = "automated";
      payloads["uais.manual-accessibility.v1"].gates.voiceOverSafari.humanVerified = false;
      payloads["uais.manual-accessibility.v1"].gates.nvdaChrome.humanVerified = false;
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({
      status: "SOAK_NOT_ADMITTED",
      blockedReasons: expect.arrayContaining([
        "field-inp-p75-not-pass",
        "voiceover-safari-not-pass",
        "nvda-chrome-not-pass",
      ]),
    });
  });

  it("rejects a RUM approver key that is also declared as the collector", () => {
    const bundle = createSignedBundle();
    bundle.ownerPins.rumAuthorities.collector.publicKeySpkiSha256 =
      bundle.ownerPins.rumAuthorities.approver.publicKeySpkiSha256;

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({
      validationErrors: expect.arrayContaining([
        "owner-rum-authority-key-material-not-distinct",
      ]),
    });
  });

  it("rejects a forged nested RUM source receipt not signed by the owner-pinned collector", () => {
    const bundle = createSignedBundle(undefined, {
      afterCollectorSign(payloads) {
        payloads["uais.rum-approval.v1"].collectorSourceReceipt.signature.signatureBase64 =
          Buffer.alloc(64, 7).toString("base64");
      },
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(
      expect.arrayContaining(["artifact:rum-approval:rum-collector-signature-invalid"]),
    );
  });

  it("rejects an owner-pinned collector receipt bound to another candidate", () => {
    const bundle = createSignedBundle((payloads) => {
      payloads["uais.rum-approval.v1"].collectorSourceReceipt.payload.candidateGitSha =
        "a".repeat(40);
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(
      expect.arrayContaining(["artifact:rum-approval:rum-collector-candidate-mismatch"]),
    );
  });

  it("accepts a producer-compatible RUM histogram with more than 256 buckets", () => {
    const bundle = createSignedBundle((payloads) => {
      const histogram = Array.from({ length: 257 }, (_, valueMs) => ({
        valueMs,
        count: 1,
      }));
      for (const group of payloads["uais.rum-approval.v1"].collectorSourceReceipt.payload.groups) {
        group.histogram = histogram.map((bucket) => ({ ...bucket }));
        group.sampleCount = 257;
        group.p75Ms = 192;
      }
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status, JSON.stringify(result.body)).toBe(2);
    expect(result.body).toMatchObject({
      gates: { "field-inp-p75": true },
      blockedReasons: ["non-authoritative-injected-core"],
    });
  });

  it.each([
    ["more than 1000 buckets", (group: RumGroup) => {
      group.histogram = Array.from({ length: 1_001 }, (_, valueMs) => ({
        valueMs,
        count: 1,
      }));
      group.sampleCount = 1_001;
      group.p75Ms = 750;
    }],
    ["more than 4000 samples", (group: RumGroup) => {
      group.histogram = [{ valueMs: 180, count: 4_001 }];
      group.sampleCount = 4_001;
      group.p75Ms = 180;
    }],
    ["a fractional valueMs", (group: RumGroup) => {
      group.histogram = [{ valueMs: 180.5, count: 30 }];
      group.sampleCount = 30;
      group.p75Ms = 180.5;
    }],
    ["a valueMs above 60000", (group: RumGroup) => {
      group.histogram = [{ valueMs: 60_001, count: 30 }];
      group.sampleCount = 30;
      group.p75Ms = 60_001;
    }],
  ])("rejects a RUM histogram with %s", (_name, mutateGroup) => {
    const bundle = createSignedBundle((payloads) => {
      mutateGroup(
        payloads["uais.rum-approval.v1"].collectorSourceReceipt.payload.groups[0],
      );
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(
      expect.arrayContaining(["artifact:rum-approval:rum-group-metrics-invalid"]),
    );
  });

  it("accepts fully signed RUM evidence at the exact 4000-sample global budget", () => {
    const bundle = createSignedBundle((payloads) => {
      setRumTotalSampleCount(
        payloads["uais.rum-approval.v1"].collectorSourceReceipt.payload.groups,
        4_000,
      );
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status, JSON.stringify(result.body)).toBe(2);
    expect(result.body).toMatchObject({
      gates: { "field-inp-p75": true },
      blockedReasons: ["non-authoritative-injected-core"],
    });
  });

  it("rejects fully signed RUM evidence totaling 4001 samples across 12 groups", () => {
    const bundle = createSignedBundle((payloads) => {
      setRumTotalSampleCount(
        payloads["uais.rum-approval.v1"].collectorSourceReceipt.payload.groups,
        4_001,
      );
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(
      expect.arrayContaining([
        "artifact:rum-approval:rum-total-sample-budget-exceeded",
      ]),
    );
  });

  it.each([
    ["raw cleanup before account cleanup", (cleanup: RumCleanupReceipt) => {
      cleanup.rawSampleCleanupVerifiedAt = new Date(
        Date.parse(cleanup.accountCleanupVerifiedAt) - 1,
      ).toISOString();
    }],
    ["cleanup verification gap above 60 seconds", (cleanup: RumCleanupReceipt) => {
      cleanup.rawSampleCleanupVerifiedAt = new Date(
        Date.parse(cleanup.accountCleanupVerifiedAt) + 60_001,
      ).toISOString();
    }],
  ])("rejects RUM cleanup with %s", (_name, mutateCleanup) => {
    const bundle = createSignedBundle((payloads) => {
      mutateCleanup(
        payloads["uais.rum-approval.v1"].collectorSourceReceipt.payload.cleanupReceipt,
      );
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(
      expect.arrayContaining(["artifact:rum-approval:rum-cleanup-receipt-invalid"]),
    );
  });

  it.each([
    ["one millisecond", 1],
    ["sixty seconds", 60_000],
  ])("rejects a fully signed RUM receipt whose generatedAt is %s after raw cleanup", (
    _name,
    offsetMs,
  ) => {
    const bundle = createSignedBundle((payloads) => {
      const source =
        payloads["uais.rum-approval.v1"].collectorSourceReceipt.payload;
      if (offsetMs === 60_000) {
        const generatedAtMs = Date.parse(source.generatedAt);
        source.measurementCompletedAt = new Date(generatedAtMs - 61_000).toISOString();
        source.cleanupReceipt.accountCleanupVerifiedAt =
          new Date(generatedAtMs - 60_001).toISOString();
        source.cleanupReceipt.rawSampleCleanupVerifiedAt =
          new Date(generatedAtMs - 60_000).toISOString();
        source.cleanupReceiptSha256 = sha256(
          canonicalJsonBytes(source.cleanupReceipt),
        );
      } else {
        source.generatedAt = new Date(
          Date.parse(source.cleanupReceipt.rawSampleCleanupVerifiedAt) + offsetMs,
        ).toISOString();
      }
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(
      expect.arrayContaining(["artifact:rum-approval:rum-cleanup-receipt-invalid"]),
    );
  });

  it("rejects a self-signed packet when its policy is not the owner-pinned policy", () => {
    const bundle = createSignedBundle();
    bundle.ownerPins.trustPolicySha256 = "0".repeat(64);

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({
      status: "FAIL",
      validationErrors: expect.arrayContaining(["trust-policy-sha256-mismatch"]),
    });
  });

  it.each([
    ["duplicate", (payloads: ReturnType<typeof passingPayloads>) => {
      payloads["uais.staging-health.v1"].samples[8].observedAt =
        payloads["uais.staging-health.v1"].samples[7].observedAt;
    }],
    ["sparse gap", (payloads: ReturnType<typeof passingPayloads>) => {
      payloads["uais.staging-health.v1"].samples[8].observedAt =
        new Date(Date.parse(payloads["uais.staging-health.v1"].samples[7].observedAt) + 5 * 60_000).toISOString();
    }],
    ["future", (payloads: ReturnType<typeof passingPayloads>) => {
      payloads["uais.staging-health.v1"].samples[15].observedAt = "2099-01-01T00:00:00.000Z";
    }],
  ])("rejects %s health chronology instead of trusting a 15-minute min/max", (_name, mutate) => {
    const bundle = createSignedBundle(mutate);

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({ status: "FAIL", soakAdmitted: false });
  });

  it("rejects health evidence that is stale at gate evaluation time", () => {
    const evaluationNowMs = Date.now();
    const bundle = createSignedBundle();

    const result = runGate(
      bundle.manifestPath,
      bundle.trustPolicyPath,
      bundle,
      evaluationNowMs + 10 * 60_000,
    );

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(
      expect.arrayContaining(["artifact:staging-health:health-evaluation-freshness-invalid"]),
    );
  });

  it.each([
    ["RUM", 25 * 60 * 60_000,
      "artifact:rum-approval:rum-evaluation-freshness-invalid"],
    ["manual", 25 * 60 * 60_000,
      "artifact:manual-accessibility:manual-evaluation-freshness-invalid"],
    ["production", 11 * 60_000,
      "artifact:production-safety:production-safety-evaluation-freshness-invalid"],
  ])("rejects %s evidence stale relative to evaluation now", (
    _name,
    ageMs,
    expectedError,
  ) => {
    const evaluationNowMs = Date.now();
    const bundle = createSignedBundle();

    const result = runGate(
      bundle.manifestPath,
      bundle.trustPolicyPath,
      bundle,
      evaluationNowMs + ageMs,
    );

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(expect.arrayContaining([expectedError]));
  });

  it("keeps P1 conservation false when event/outbox conservation is broken", () => {
    const bundle = createSignedBundle((payloads) => {
      payloads["uais.p1-load.v1"].conservation.outbox = 439;
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({
      gates: { "p1-conservation": false },
      blockedReasons: expect.arrayContaining(["p1-conservation-not-pass"]),
    });
  });

  it.each([
    ["duplicate invitee", (payloads: ReturnType<typeof passingPayloads>) => {
      const finalStage = payloads["uais.p2-load.v1"].inviteStages[4];
      finalStage.inviteeFingerprints[199] = finalStage.inviteeFingerprints[0];
    }],
    ["duplicate group", (payloads: ReturnType<typeof passingPayloads>) => {
      const topology = payloads["uais.p2-load.v1"].groupTopology;
      topology[39].groupFingerprint = topology[0].groupFingerprint;
    }],
    ["missing group", (payloads: ReturnType<typeof passingPayloads>) => {
      payloads["uais.p2-load.v1"].groupTopology =
        payloads["uais.p2-load.v1"].groupTopology.slice(0, 39);
    }],
    ["duplicate actor across groups", (payloads: ReturnType<typeof passingPayloads>) => {
      const topology = payloads["uais.p2-load.v1"].groupTopology;
      topology[39].actorFingerprints[4] = topology[0].actorFingerprints[0];
    }],
  ])("rejects P2 topology with %s", (_name, mutate) => {
    const bundle = createSignedBundle(mutate);

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({ status: "FAIL", soakAdmitted: false });
  });

  it("does not accept different final invitee and active-actor cohorts", () => {
    const bundle = createSignedBundle((payloads) => {
      payloads["uais.p2-load.v1"].inviteStages[4].inviteeFingerprints[199] =
        digestText("p2-invitee-not-in-active-cohort");
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({
      gates: { "p2-sustained-load": false },
      blockedReasons: expect.arrayContaining(["p2-sustained-load-not-pass"]),
    });
  });

  it("rejects sustained load without exact per-actor request conservation", () => {
    const bundle = createSignedBundle((payloads) => {
      const firstGroup = payloads["uais.p2-load.v1"].sustained.groupRequestCounts[0];
      firstGroup.actorRequestCounts[0].requestCount = 9;
      firstGroup.actorRequestCounts[1].requestCount = 11;
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(
      expect.arrayContaining([
        "artifact:p2-load:p2-sustained-actor-request-conservation-invalid",
      ]),
    );
  });

  it("rejects a same-candidate packet that mixes an owner-unpinned run id", () => {
    const bundle = createSignedBundle((payloads) => {
      payloads["uais.p1-load.v1"].runId = "p1-live-older-replayed-run";
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({
      validationErrors: expect.arrayContaining([
        "artifact:p1-load:p1-run-id-mismatch",
      ]),
    });
  });

  it.each([
    ["P2", (payloads: ReturnType<typeof passingPayloads>) => {
      payloads["uais.p2-load.v1"].runId = "p2-live-older-replayed-run";
    }, "artifact:p2-load:p2-run-id-mismatch"],
    ["RUM", (payloads: ReturnType<typeof passingPayloads>) => {
      payloads["uais.rum-approval.v1"].cohortId = "p2-inp-older-replayed-cohort";
    }, "artifact:rum-approval:rum-cohort-id-mismatch"],
    ["manual", (payloads: ReturnType<typeof passingPayloads>) => {
      payloads["uais.manual-accessibility.v1"].executionId =
        "manual-a11y-older-replayed-run";
    }, "artifact:manual-accessibility:manual-execution-id-mismatch"],
  ])("rejects a same-candidate packet with owner-unpinned %s evidence", (_name, mutate, error) => {
    const bundle = createSignedBundle(mutate);

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({
      validationErrors: expect.arrayContaining([error]),
    });
  });

  it.each([
    ["wrong lockfile", (payloads: ReturnType<typeof passingPayloads>) => {
      payloads["uais.dependency-review.v1"].productionAudit.lockfileSha256 = "f".repeat(64);
    }, 1],
    ["extended mitigation", (payloads: ReturnType<typeof passingPayloads>) => {
      payloads["uais.dependency-review.v1"].fullTreeReview.mitigationExpiresAt = "2027-09-10T23:59:59Z";
    }, 2],
    ["critical inherited debt", (payloads: ReturnType<typeof passingPayloads>) => {
      const counts = payloads["uais.dependency-review.v1"].fullTreeReview.counts;
      counts.critical = 1;
      counts.total = 11;
    }, 2],
    ["different noncritical debt vector", (payloads: ReturnType<typeof passingPayloads>) => {
      const counts = payloads["uais.dependency-review.v1"].fullTreeReview.counts;
      counts.moderate = 8;
      counts.high = 2;
    }, 2],
    ["MITIGATED_OPEN with a zero vector", (payloads: ReturnType<typeof passingPayloads>) => {
      const counts = payloads["uais.dependency-review.v1"].fullTreeReview.counts;
      counts.moderate = 0;
      counts.high = 0;
      counts.total = 0;
    }, 2],
    ["CLEAN with debt", (payloads: ReturnType<typeof passingPayloads>) => {
      const review = payloads["uais.dependency-review.v1"].fullTreeReview;
      review.disposition = "CLEAN";
      review.mitigationAccepted = false;
      review.mitigationExpiresAt = null as never;
    }, 2],
  ])("does not admit dependency evidence with %s", (_name, mutate, expectedExit) => {
    const bundle = createSignedBundle(mutate);

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(expectedExit);
    expect(result.body).toMatchObject({ status: expectedExit === 1 ? "FAIL" : "SOAK_NOT_ADMITTED" });
  });

  it("expires the exact owner mitigation at evaluation time", () => {
    const bundle = createSignedBundle();

    const result = runGate(
      bundle.manifestPath,
      bundle.trustPolicyPath,
      bundle,
      Date.parse("2026-09-11T00:00:00Z"),
    );

    expect(result.status).toBe(1);
    expect(result.body.validationErrors).toEqual(
      expect.arrayContaining([
        "artifact:dependency-review:owner-dependency-mitigation-expired-at-evaluation",
      ]),
    );
  });

  it("keeps production safety false when a production alias changed", () => {
    const bundle = createSignedBundle((payloads) => {
      payloads["uais.production-safety.v1"].productionAliasChanged = true;
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({
      safety: { noProductionMutation: false },
      blockedReasons: expect.arrayContaining([
        "production-safety-boundary-not-preserved",
      ]),
    });
  });

  it("reports authenticated soakStarted instead of hardcoding false", () => {
    const bundle = createSignedBundle((payloads) => {
      payloads["uais.production-safety.v1"].soakStarted = true;
    });

    const result = runGate(bundle.manifestPath, bundle.trustPolicyPath, bundle);

    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({
      soak: { started: true, startedAt: null },
      blockedReasons: expect.arrayContaining(["soak-already-started"]),
    });
  });
});

type Candidate = {
  gitSha: string;
  contentSha256: string;
  deploymentId: string;
  deploymentHost: string;
  projectId: string;
};

type Artifact = {
  id: string;
  path: string;
  receiptSchema: string;
  byteLength: number;
  sha256: string;
};

type Manifest = {
  schemaVersion: number;
  kind: string;
  evidenceSetId: string;
  candidate: Candidate;
  issuedAt: string;
  expiresAt: string;
  artifacts: Artifact[];
  authority: { keyId: string; algorithm: string; role: string };
  signature: string;
};

type RumApproval = ReturnType<typeof passingPayloads>["uais.rum-approval.v1"];
type RumGroup = RumApproval["collectorSourceReceipt"]["payload"]["groups"][number];
type RumCleanupReceipt = RumApproval["collectorSourceReceipt"]["payload"]["cleanupReceipt"];

function createSignedBundle(
  mutate?: (payloads: ReturnType<typeof passingPayloads>) => void,
  options: {
    receiptIssuedAtBySchema?: Partial<Record<(typeof receiptSchemas)[number], number>>;
    afterCollectorSign?: (payloads: ReturnType<typeof passingPayloads>) => void;
  } = {},
) {
  const directory = makeTemporaryDirectory();
  const packetRoot = join(directory, "packet");
  const receiptsRoot = join(packetRoot, "receipts");
  mkdirSync(receiptsRoot, { recursive: true });
  const manifestPath = join(packetRoot, "index.json");
  const trustPolicyPath = join(directory, "trust-policy.json");
  const now = Date.now();
  const issuedAt = new Date(now - 10_000).toISOString();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  const evidenceSetId = "evset_540dc39_all_gates_01";
  const candidate: Candidate = {
    gitSha: currentGitSha,
    contentSha256: currentContentSha256,
    deploymentId,
    deploymentHost,
    projectId,
  };
  const indexKeys = generateKeyPairSync("ed25519");
  const sourceKeys = Object.fromEntries(
    receiptSchemas.map((receiptSchema) => [
      receiptSchema,
      generateKeyPairSync("ed25519"),
    ]),
  );
  const collectorKeys = generateKeyPairSync("ed25519");
  const collectorAuthority = {
    keyId: "s22-rum-collector-test-1",
    keyVersion: "v1",
    publicKeySpkiPem: collectorKeys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    publicKeySpkiSha256: sha256(
      collectorKeys.publicKey.export({ format: "der", type: "spki" }),
    ),
  };
  const payloads = passingPayloads(now, candidate, collectorAuthority);
  mutate?.(payloads);
  signCollectorSourceReceipt(
    payloads["uais.rum-approval.v1"],
    collectorKeys.privateKey,
  );
  options.afterCollectorSign?.(payloads);
  const artifacts = receiptSchemas.map((receiptSchema, index) => {
    const id = artifactId(receiptSchema);
    const relativePath = `receipts/${String(index + 1).padStart(2, "0")}-${id}.json`;
    const sourceAuthority = {
      keyId: `s22-${artifactId(receiptSchema)}-source-test-1`,
      algorithm: "Ed25519",
      role: sourceAuthorityRoles[receiptSchema],
    };
    const envelope = {
      schemaVersion: 1,
      kind: "uais-soak-evidence-receipt",
      artifactId: id,
      receiptSchema,
      evidenceSetId,
      candidate,
      issuedAt: new Date(
        options.receiptIssuedAtBySchema?.[receiptSchema] ?? now - 10_000,
      ).toISOString(),
      expiresAt,
      payload: payloads[receiptSchema],
      sourceAuthority,
      sourceSignature: "",
    };
    envelope.sourceSignature = sign(
      null,
      createSoakEvidenceReceiptSigningPayload(envelope),
      sourceKeys[receiptSchema].privateKey,
    ).toString("base64url");
    const bytes = Buffer.from(JSON.stringify(envelope));
    writeFileSync(join(packetRoot, relativePath), bytes);
    return {
      id,
      path: relativePath,
      receiptSchema,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    };
  });
  const manifest: Manifest = {
    schemaVersion: 2,
    kind: "uais-soak-evidence-index",
    evidenceSetId,
    candidate,
    issuedAt,
    expiresAt,
    artifacts,
    authority: {
      keyId: authorityKeyId,
      algorithm: "Ed25519",
      role: "soak-evidence-issuer",
    },
    signature: "",
  };
  manifest.signature = sign(
    null,
    createSoakEvidenceIndexSigningPayload(manifest),
    indexKeys.privateKey,
  ).toString("base64url");
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  const earliestReceiptIssuedAt = Math.min(
    now - 10_000,
    ...Object.values(options.receiptIssuedAtBySchema ?? {}).filter(
      (value): value is number => typeof value === "number",
    ),
  );
  const authorityWindow = {
    candidate,
    evidenceSetId,
    notBefore: new Date(earliestReceiptIssuedAt - 60 * 60 * 1000).toISOString(),
    notAfter: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  };
  const trustPolicy = {
    schemaVersion: 1,
    kind: "uais-soak-evidence-trust-policy",
    policyId: "s22-soak-authority-test-policy-v1",
    authorities: [
      {
        keyId: manifest.authority.keyId,
        algorithm: "Ed25519",
        role: "soak-evidence-issuer",
        publicKeyPem: indexKeys.publicKey.export({ format: "pem", type: "spki" }),
        ...authorityWindow,
        allowedReceiptSchemas: [...receiptSchemas],
      },
      ...receiptSchemas.map((receiptSchema) => ({
        keyId: `s22-${artifactId(receiptSchema)}-source-test-1`,
        algorithm: "Ed25519",
        role: sourceAuthorityRoles[receiptSchema],
        publicKeyPem: sourceKeys[receiptSchema].publicKey.export({
          format: "pem",
          type: "spki",
        }),
        ...authorityWindow,
        allowedReceiptSchemas: [receiptSchema],
      })),
    ],
  };
  const trustPolicyBytes = Buffer.from(JSON.stringify(trustPolicy));
  writeFileSync(trustPolicyPath, trustPolicyBytes);
  const ownerPins = {
    schemaVersion: 1,
    kind: "uais-soak-admission-owner-pins",
    ownerDecisionDigestSha256: digestText("owner-decision-bundle-v2-test"),
    trustPolicySha256: sha256(trustPolicyBytes),
    authorityKeyId,
    evidenceSetId,
    candidate,
    expectedRuns: {
      p1: p1RunId,
      p2: p2RunId,
      rum: {
        runId: rumRunId,
        cohortId: rumCohortId,
      },
      manual: manualExecutionId,
    },
    dependencyMitigation: {
      disposition: "MITIGATED_OPEN",
      counts: {
        info: 0,
        low: 0,
        moderate: 9,
        high: 1,
        critical: 0,
        total: 10,
      },
      expiresAt: "2026-09-10T23:59:59Z",
    },
    rumAuthorities: {
      collector: collectorAuthority,
      approver: {
        keyId: "s22-rum-approval-source-test-1",
        publicKeySpkiSha256: sha256(
          sourceKeys["uais.rum-approval.v1"].publicKey.export({
            format: "der",
            type: "spki",
          }),
        ),
      },
      index: {
        keyId: authorityKeyId,
        publicKeySpkiSha256: sha256(
          indexKeys.publicKey.export({ format: "der", type: "spki" }),
        ),
      },
    },
    productionAuthorization: "NO",
  };
  return {
    directory,
    packetRoot,
    manifestPath,
    trustPolicyPath,
    trustPolicySha256: ownerPins.trustPolicySha256,
    authorityKeyId: ownerPins.authorityKeyId,
    ownerPins,
    manifest,
  };
}

function passingPayloads(
  now: number,
  candidate: Candidate = {
    gitSha: currentGitSha,
    contentSha256: currentContentSha256,
    deploymentId,
    deploymentHost,
    projectId,
  },
  collectorAuthority = {
    keyId: "s22-rum-collector-test-1",
    keyVersion: "v1",
    publicKeySpkiPem: "test-only-placeholder",
    publicKeySpkiSha256: digestText("test-only-collector-spki"),
  },
) {
  const phaseTargets = [5, 20, 50, 100, 200];
  const operationSamples = (count: number, value = 1_200) => Array(count).fill(value);
  const healthStart = now - 920_000;
  const actorFingerprints = Array.from({ length: 200 }, (_, index) =>
    digestText(`p2-actor-${index + 1}`),
  );
  const groupFingerprints = Array.from({ length: 40 }, (_, index) =>
    digestText(`p2-group-${index + 1}`),
  );
  const groupTopology = groupFingerprints.map((groupFingerprint, index) => ({
    groupFingerprint,
    actorFingerprints: actorFingerprints.slice(index * 5, index * 5 + 5),
  }));
  const operatorFingerprints = [1, 2, 3].map((value) =>
    digestText(`rum-human-${value}`),
  );
  const measurementStartedAt = new Date(now - 30 * 60 * 1000).toISOString();
  const measurementCompletedAt = new Date(now - 20_000).toISOString();
  const cleanupReceipt = {
    schemaVersion: 1,
    kind: "uais-staging-inp-rum-cleanup",
    actionScope: "cleanup-staging-rum-only",
    runId: rumRunId,
    cohortId: rumCohortId,
    rawSampleRowsRemaining: 0,
    accountMappingsRemaining: 0,
    temporaryAccountsRemaining: 0,
    cohortTombstoneRetained: true,
    accountCleanupVerifiedAt: new Date(now - 19_000).toISOString(),
    rawSampleCleanupVerifiedAt: new Date(now - 15_000).toISOString(),
  };
  const rumSourcePayload = {
    schemaVersion: 1,
    kind: "uais-staging-inp-rum-source",
    actionScope: "collect-real-user-inp-staging-only",
    candidateGitSha: candidate.gitSha,
    candidateContentSha256: candidate.contentSha256,
    projectId: candidate.projectId,
    deploymentId: candidate.deploymentId,
    deploymentHost: candidate.deploymentHost,
    runId: rumRunId,
    cohortId: rumCohortId,
    collectorKeyVersion: collectorAuthority.keyVersion,
    collectorKeyId: collectorAuthority.keyId,
    collectorPublicKeySpkiSha256: collectorAuthority.publicKeySpkiSha256,
    operatorAllowlistSha256: sha256(canonicalJsonBytes(operatorFingerprints)),
    operatorFingerprints,
    measurementStartedAt,
    measurementCompletedAt,
    generatedAt: new Date(now - 15_000).toISOString(),
    accountMappingDigestSha256: digestText("rum-account-mapping"),
    sourceReportSha256: digestText("rum-source-report"),
    percentileAlgorithm: "postgresql-percentile-cont-linear-interpolation-v1",
    groups: rumGroups().map((group) => ({
      ...group,
      sampleCount: 30,
      distinctOperatorCount: 3,
      distinctAdultHumanCount: 3,
      p75Ms: 180,
      histogram: [{ valueMs: 180, count: 30 }],
    })),
    cleanupReceipt,
    cleanupReceiptSha256: sha256(canonicalJsonBytes(cleanupReceipt)),
  };
  const approvedGroupKeysSha256 = sha256(canonicalJsonBytes(
    rumSourcePayload.groups.map(({ role, journey, viewportClass }) => ({
      role,
      journey,
      viewportClass,
    })),
  ));
  return {
    "uais.staging-health.v1": {
      status: "PASS",
      executionClass: "external-live",
      samples: Array.from({ length: 16 }, (_, index) => ({
        observedAt: new Date(healthStart + index * 60_000).toISOString(),
        httpStatus: 200,
        app: "ok",
        database: "ok",
        migrations: "ok",
        candidateBound: true,
        deploymentId,
        deploymentHost,
        requestIdFingerprint: digestText(`health-request-${index + 1}`),
      })),
    },
    "uais.p1-load.v1": {
      status: "PASS",
      executionClass: "live",
      runId: p1RunId,
      studentCount: 200,
      conservation: {
        attempts: 200,
        submissions: 200,
        versions: 200,
        profiles: 200,
        duplicateVersions: 0,
        accepted: 20,
        awaiting: 180,
        events: 440,
        outbox: 440,
      },
      cleanup: {
        sourceRowsRemaining: 0,
        restoreRowsRemaining: 0,
        exactPrefixResidueZero: true,
        leaseReleased: true,
      },
      performance: {
        passClaimAuthorized: true,
        autosaveWindowMs: 300_000,
        submitWindowMs: 29_500,
        maximumSubmitWindowMs: 30_000,
        maximumOperationP95Ms: 1_500,
        operationSamplesMs: {
          taskRead: operationSamples(200),
          checkpoint: operationSamples(200),
          autosave: operationSamples(600),
          submit: operationSamples(200),
          teacherDecision: operationSamples(20),
        },
      },
    },
    "uais.p2-load.v1": {
      status: "PASS",
      executionClass: "live",
      runId: p2RunId,
      maximumP95Ms: 2_000,
      inviteStages: phaseTargets.map((targetUsers) => ({
        targetUsers,
        completedUsers: targetUsers,
        inviteeFingerprints: actorFingerprints.slice(0, targetUsers),
        latenciesMs: operationSamples(targetUsers),
      })),
      activeUserStages: phaseTargets.map((targetActiveUsers) => ({
        targetActiveUsers,
        observedDistinctActors: targetActiveUsers,
        actorFingerprints: actorFingerprints.slice(0, targetActiveUsers),
        latenciesMs: operationSamples(targetActiveUsers),
      })),
      groupTopology,
      sustained: {
        activeUsers: 200,
        rounds: 10,
        requestCount: 2_000,
        latenciesMs: operationSamples(2_000),
        actorFingerprints,
        groupRequestCounts: groupFingerprints.map((groupFingerprint, groupIndex) => ({
          groupFingerprint,
          requestCount: 50,
          actorRequestCounts: actorFingerprints
            .slice(groupIndex * 5, groupIndex * 5 + 5)
            .map((actorFingerprint) => ({
              actorFingerprint,
              requestCount: 10,
            })),
        })),
      },
      cleanup: {
        sourceRowsRemaining: 0,
        restoreRowsRemaining: 0,
        runTaggedResidueZero: true,
      },
    },
    "uais.rum-approval.v1": {
      status: "PASS",
      executionClass: "real-user",
      runId: rumRunId,
      cohortId: rumCohortId,
      independentApprovalVerified: true,
      approvedAt: new Date(now - 12_000).toISOString(),
      approvedGroupKeysSha256,
      approvedOperatorFingerprints: operatorFingerprints,
      collectorSourceReceiptSha256: "",
      collectorSourceReceipt: {
        payload: rumSourcePayload,
        signature: {
          algorithm: "Ed25519",
          keyId: collectorAuthority.keyId,
          payloadSha256: "",
          signatureBase64: "",
        },
      },
    },
    "uais.manual-accessibility.v1": {
      status: "PASS",
      executionClass: "human",
      executionId: manualExecutionId,
      observedAt: new Date(now - 20_000).toISOString(),
      routeMatrixDigestSha256: digestText("manual-route-matrix"),
      reviewerIndependent: true,
      productionHostOpened: false,
      isolatedBackendVerified: true,
      cleanupResidueZero: true,
      gates: {
        voiceOverSafari: {
          status: "PASS",
          humanVerified: true,
          roles: ["student", "teacher"],
          os: "macOS",
          osVersion: "macOS 15.6",
          browser: "Safari",
          browserVersion: "Safari 18.6",
          assistiveTechnology: "VoiceOver",
          assistiveTechnologyVersion: "VoiceOver 15.6",
          journeys: ["student", "teacher"].map((role) => ({
            role,
            route: role === "student" ? "/learning" : "/teaching",
            status: "PASS",
            spokenOutputEvidenceSha256: digestText(`voiceover-${role}-speech`),
            rotorEvidenceSha256: digestText(`voiceover-${role}-rotor`),
          })),
        },
        nvdaChrome: {
          status: "PASS",
          humanVerified: true,
          roles: ["student", "teacher"],
          os: "Windows 11",
          osVersion: "Windows 11 24H2",
          browser: "Chrome",
          browserVersion: "Chrome 140.0.0",
          assistiveTechnology: "NVDA",
          assistiveTechnologyVersion: "NVDA 2026.1",
          journeys: ["student", "teacher"].map((role) => ({
            role,
            route: role === "student" ? "/learning" : "/teaching",
            status: "PASS",
            speechEvidenceSha256: digestText(`nvda-${role}-speech`),
            focusNavigationEvidenceSha256: digestText(`nvda-${role}-focus`),
          })),
        },
        keyboardJourney: humanGate("keyboard"),
        reflow200: humanGate("reflow"),
        reducedMotion: humanGate("reduced-motion"),
        touchTargets: humanGate("touch-targets"),
        nonColorInformation: humanGate("non-color"),
      },
    },
    "uais.dependency-review.v1": {
      status: "PASS",
      productionAudit: {
        lockfileSha256: currentLockfileSha256,
        scanner: "npm-audit",
        scannerVersion: "11.6.0",
        dependencyScope: "production",
        reachability: "production-tree",
        counts: {
          info: 0,
          low: 0,
          moderate: 0,
          high: 0,
          critical: 0,
          total: 0,
        },
      },
      fullTreeReview: {
        lockfileSha256: currentLockfileSha256,
        scanner: "npm-audit",
        scannerVersion: "11.6.0",
        disposition: "MITIGATED_OPEN",
        counts: {
          info: 0,
          low: 0,
          moderate: 9,
          high: 1,
          critical: 0,
          total: 10,
        },
        reachabilityReviewed: true,
        mitigationAccepted: true,
        mitigationExpiresAt: "2026-09-10T23:59:59Z",
        vercelDevAllowed: false,
        forceFixApplied: false,
        majorDowngradeApplied: false,
        overrideApplied: false,
        lockfileEdited: false,
      },
    },
    "uais.production-safety.v1": {
      verifierClass: "independent-git-vercel-neon-alias-readback",
      observedAt: new Date(now - 20_000).toISOString(),
      productionProjectId: "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA",
      stagingProjectId: projectId,
      productionDomains: ["uais.top", "www.uais.top"],
      stagingAlias: "staging.uais.top",
      remoteMainSha: "d".repeat(40),
      candidateOnRemoteMain: false,
      productionGroupMode: "off",
      productionAuthorization: "NO",
      mainPushed: false,
      productionAliasChanged: false,
      productionDomainConfigurationChanged: false,
      productionDeployed: false,
      productionEnvironmentChanged: false,
      productionFeatureFlagsChanged: false,
      productionDatabaseChanged: false,
      soakStarted: false,
      gitReadbackReceiptSha256: digestText("git-readback"),
      vercelReadbackReceiptSha256: digestText("vercel-readback"),
      databaseReadbackReceiptSha256: digestText("database-readback"),
      aliasReadbackReceiptSha256: digestText("alias-readback"),
      environmentFingerprintSha256: digestText("production-env-fingerprint"),
      featureFlagsFingerprintSha256: digestText("production-flag-fingerprint"),
    },
  };
}

function humanGate(label: string) {
  return {
    status: "PASS",
    humanVerified: true,
    roles: ["student", "teacher"],
    evidenceSha256: digestText(`manual-${label}-evidence`),
  };
}

function setRumTotalSampleCount(groups: RumGroup[], total: number) {
  const minimumOtherGroups = (groups.length - 1) * 30;
  groups.forEach((group, index) => {
    const sampleCount = index === 0 ? total - minimumOtherGroups : 30;
    group.sampleCount = sampleCount;
    group.p75Ms = 180;
    group.histogram = [{ valueMs: 180, count: sampleCount }];
  });
}

function signCollectorSourceReceipt(
  approval: ReturnType<typeof passingPayloads>["uais.rum-approval.v1"],
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
) {
  const payloadBytes = canonicalJsonBytes(approval.collectorSourceReceipt.payload);
  approval.collectorSourceReceipt.signature.payloadSha256 = sha256(payloadBytes);
  approval.collectorSourceReceipt.signature.signatureBase64 = sign(
    null,
    payloadBytes,
    privateKey,
  ).toString("base64");
  approval.collectorSourceReceiptSha256 = sha256(
    canonicalJsonBytes(approval.collectorSourceReceipt),
  );
}

function canonicalJsonBytes(value: unknown) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new TypeError("canonical JSON supports only finite JSON values");
}

function rumGroups() {
  const groups = [];
  for (const journey of ["student-learning", "student-chatroom"]) {
    for (const viewportClass of ["compact", "wide"]) {
      groups.push({ role: "student", journey, viewportClass });
    }
  }
  for (const journey of [
    "teacher-home",
    "teacher-course-settings",
    "teacher-activities",
    "teacher-submissions",
  ]) {
    for (const viewportClass of ["compact", "wide"]) {
      groups.push({ role: "teacher", journey, viewportClass });
    }
  }
  return groups;
}

function artifactId(schema: string) {
  return schema
    .replace("uais.", "")
    .replace(/\.v\d+$/, "")
    .replaceAll(".", "-");
}

function runGate(
  manifestPath: string,
  trustPolicyPath: string,
  pins: { ownerPins: Record<string, unknown> },
  evaluationNowMs = Date.now(),
) {
  const result = runP2SoakAdmissionGate({
    manifestPath,
    trustPolicyPath,
    ownerPins: pins.ownerPins,
    root: cwd,
    evaluationNowMs,
  });
  return { status: result.exitCode, body: result.report, stderr: "" };
}

function makeTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "uais-soak-admission-v2-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function digestText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
