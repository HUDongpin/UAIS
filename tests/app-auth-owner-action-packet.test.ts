import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app auth owner action packet", () => {
  it("summarizes the first owner-gated app auth decision without exposing credential values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-owner-packet-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          ownerDecisionNeeded: "choose-production-app-auth-provider-and-approved-server-only-env-source",
          acceptedOptions: ["trusted-account-provider"],
          blockedReasons: ["app-auth-provider-readiness-not-live-ready"],
          appAuthProviderReadinessSummary: {
            evidenceStatus: "dry-run-blocked",
            blockedReason: "app-auth-provider-readiness-not-live-ready",
            evidenceEnvironment: "production",
            appAuthProviderMode: "trusted-account-provider",
            endpointSecurity: "remote-https",
            vercelEnvSyncEvidence: {
              status: "missing",
              applyPreflight: "missing",
              releaseRunIdStatus: "missing",
              requiredAppAuthEnvStatus: "missing",
              valueRedacted: true,
            },
          },
          safeNextActions: [
            "confirm-production-app-auth-provider-mode",
            "bind-server-only-app-auth-env-through-s19-vercel-env-sync",
            "run-approved-app-auth-provider-readiness-after-env-sync",
          ],
          forbiddenUntilApproved: [
            "inspect-or-print-app-auth-credential-values",
            "run-live-app-auth-provider-network-call",
          ],
          proofNeeded: [
            "app-auth-provider-readiness-live-production-ready",
            "vercel-env-sync-app-auth-selector-and-env-binding",
          ],
        },
      ],
      leakedUrl: "https://private-app-auth.example.test",
      leakedSecret: "secret-app-auth-provider-token",
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "app-auth-provider-production-selector",
          rank: 1,
          category: "owner-decision",
          releaseGateRequirementIds: ["app-auth-provider-readiness"],
          enterpriseAuditMissingTargets: ["app-auth-provider-readiness"],
          nextOwnerQuestion: "Confirm production app auth provider mode and approved server-only env source.",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/app-auth-owner-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "app-auth-owner-action-packet",
        status: "owner-decision-needed",
        releaseGateStatus: "blocked",
        responsibleSession: "S22",
        decisionId: "app-auth-provider-production-selector",
        queueRank: 1,
        classification: "owner-env-live-evidence-blocked",
        ownerDecisionNeeded: "choose-production-app-auth-provider-and-approved-server-only-env-source",
        acceptedOptions: ["trusted-account-provider"],
        requiredEnvNames: [
          "UAIS_APP_SESSION_SIGNING_SECRET",
          "UAIS_APP_AUTH_PROVIDER",
          "UAIS_APP_AUTH_PROVIDER_URL",
          "UAIS_APP_AUTH_PROVIDER_TOKEN",
        ],
        requiredEvidence: [
          "vercel-env-sync-evidence-with-app-auth-env-present",
          "app-auth-provider-readiness-production-live-ready",
          "same-release-run-id-bound-to-app-auth-readiness",
        ],
        currentEvidenceSummary: {
          evidenceStatus: "dry-run-blocked",
          evidenceEnvironment: "production",
          appAuthProviderMode: "trusted-account-provider",
          endpointSecurity: "remote-https",
          vercelEnvSyncStatus: "missing",
          releaseRunIdStatus: "missing",
          requiredAppAuthEnvStatus: "missing",
        },
        commands: expect.objectContaining({
          vercelEnvSyncDryRun: "node scripts/vercel-env-sync.mjs --dry-run --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-dry-run-evidence>",
          vercelEnvSyncApply: "node scripts/vercel-env-sync.mjs --apply --approved --scope full --env-file <approved-env-file> --vercel-project-readiness <vercel-project-readiness-evidence> --release-run-id <release-run-id> > <vercel-env-sync-evidence>",
          appAuthReadinessLive: "node scripts/app-auth-provider-readiness.mjs --live --approved --environment production --env-file <approved-env-file> --release-run-id <release-run-id> --vercel-env-sync <vercel-env-sync-evidence> > <app-auth-provider-readiness-evidence>",
        }),
        safety: {
          sourcePathsOmitted: true,
          valuesRedacted: true,
          envValuesOmitted: true,
          liveMutationPerformed: false,
          deploymentMutationPerformed: false,
        },
      }),
    );
    expect(body.stopConditions).toEqual(
      expect.arrayContaining([
        "Stop if owner has not approved the app auth provider mode and env source.",
        "Stop if approved env source is unavailable to S19.",
        "Stop if live provider readiness would call a remote endpoint without explicit approval.",
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("https://private-app-auth.example.test");
    expect(output).not.toContain("secret-app-auth-provider-token");
  });

  it("renders a markdown app auth owner packet for handoff", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-app-auth-owner-packet-md-"));
    const ownerChecklist = writeJson(tmpDir, "owner-checklist.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      decisions: [
        {
          id: "app-auth-provider-production-selector",
          status: "owner-decision-needed",
          acceptedOptions: ["trusted-account-provider"],
          blockedReasons: ["app-auth-provider-readiness-not-live-ready"],
          appAuthProviderReadinessSummary: {
            evidenceStatus: "dry-run-blocked",
            evidenceEnvironment: "production",
            appAuthProviderMode: "trusted-account-provider",
            endpointSecurity: "remote-https",
            vercelEnvSyncEvidence: {
              status: "missing",
              releaseRunIdStatus: "missing",
              requiredAppAuthEnvStatus: "missing",
            },
          },
          safeNextActions: ["confirm-production-app-auth-provider-mode"],
          forbiddenUntilApproved: ["inspect-or-print-app-auth-credential-values"],
        },
      ],
    });
    const ownerQueue = writeJson(tmpDir, "owner-queue.json", {
      status: "owner-decisions-required",
      releaseGateStatus: "blocked",
      queue: [
        {
          id: "app-auth-provider-production-selector",
          rank: 1,
          nextOwnerQuestion: "Confirm production app auth provider mode and approved server-only env source.",
        },
      ],
    });

    const output = execFileSync("node", [
      "scripts/app-auth-owner-action-packet.mjs",
      "--owner-checklist",
      ownerChecklist,
      "--owner-decision-queue",
      ownerQueue,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# UAIS App Auth Owner Action Packet");
    expect(output).toContain("Status: `owner-decision-needed`");
    expect(output).toContain("Queue rank: 1");
    expect(output).toContain("`UAIS_APP_SESSION_SIGNING_SECRET`");
    expect(output).toContain("`UAIS_APP_AUTH_PROVIDER_TOKEN`");
    expect(output).toContain("Do not inspect, print, or copy credential values.");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writeJson(tmpDir: string, filename: string, body: unknown) {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, JSON.stringify(body, null, 2));
  return filePath;
}
