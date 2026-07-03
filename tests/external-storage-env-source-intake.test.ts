import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const requiredEnvNames = [
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
  "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
  "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
  "UAIS_EXTERNAL_STORAGE_DATA_DIR",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
];
const upstreamOperatorInputPacket = {
  target: "app-auth-env-source-intake-operator-input",
  status: "operator-approved-source-required",
  firstRequiredInputId: "approved-env-source-path",
  approvedServerOnlyEnvSourceLabel: "UAIS-production-app-auth-env-source",
  acceptedInputModes: ["approved-source-handle", "approved-env-file-presence"],
  requiredServerOnlyEnvNames: [
    "UAIS_APP_SESSION_SIGNING_SECRET",
    "UAIS_APP_AUTH_PROVIDER",
    "UAIS_APP_AUTH_PROVIDER_URL",
    "UAIS_APP_AUTH_PROVIDER_TOKEN",
  ],
  nextSafeAction: "provide-approved-env-source-path-to-s19",
  nextSafeCommandTemplateKey: "approvedSourceHandleIntake",
  valuesForbidden: true,
};

describe("external storage env source intake", () => {
  it("keeps external-storage env intake waiting until upstream auth evidence clears", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-env-source-intake-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const handoffPath = writeJson(reportsDir, "handoff.json", buildHandoff());
    const preflightPath = writeJson(reportsDir, "external-storage-preflight.json", {
      target: "external-storage-production-evidence-preflight",
      status: "external-storage-production-evidence-preflight-waiting-for-upstream-auth",
      approvedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel:
        "UAIS-approved-remote-HTTPS-external-storage-service",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-external-storage-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      approvedSmokeTeacherIdLabel: "UAIS-approved-smoke-teacher-label",
      upstreamBlockers: [
        "app-auth-production-evidence-missing",
        "teacher-auth-production-evidence-missing",
      ],
      summary: {
        upstreamAuthEvidenceCleared: false,
        s19DryRunMayProceedAfterAuthClears: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: requiredEnvNames,
    });
    const teacherAuthGatePath = writeJson(reportsDir, "teacher-auth-gate.json", {
      target: "teacher-auth-production-evidence-gate",
      status: "teacher-auth-production-evidence-gate-waiting-for-upstream-app-auth",
      summary: {
        operatorInputRequired: true,
        blockingInputRequired: true,
        teacherAuthProductionEvidenceCleared: false,
        releaseReady: false,
      },
      safeNextAction: "provide-approved-env-source-path-to-s19",
      blockedReasons: ["upstream-app-auth-production-evidence-not-cleared"],
      upstreamBlockingEvidence: {
        id: "upstream-teacher-auth-vercel-env-sync-evidence-gate",
        valuesForbidden: true,
        upstreamMissingEvidence: ["approved-env-source-path"],
        upstreamOperatorInputPacket,
        upstreamSafeCommandTemplates: {
          approvedSourceHandleIntake:
            "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
        },
      },
      sourceEvidenceHandle: "/Users/private/approved-app-auth.env",
    });

    const output = execFileSync("node", [
      "scripts/external-storage-env-source-intake.mjs",
      "--production-env-source-handoff",
      handoffPath,
      "--external-storage-preflight",
      preflightPath,
      "--teacher-auth-production-evidence-gate",
      teacherAuthGatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-env-source-intake",
        status: "external-storage-env-source-intake-waiting-for-upstream-auth",
        releaseReady: false,
        mode: "dry-run",
        responsibleSession: "S19/S22",
        approvedServiceClass: "approved-remote-https-external-storage-service",
        approvedRemoteHttpsExternalStorageServiceLabel:
          "UAIS-approved-remote-HTTPS-external-storage-service",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-external-storage-env-source",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        approvedSmokeTeacherIdLabel: "UAIS-approved-smoke-teacher-label",
        summary: {
          ownerInputRequired: false,
          operatorInputRequired: true,
          blockingInputRequired: true,
          upstreamEvidenceRequired: true,
          upstreamAuthEvidenceCleared: false,
          requiredEnvNameCount: 14,
          presentEnvNameCount: 0,
          missingEnvNameCount: 14,
          envFileProvided: false,
          envValuesEmitted: false,
          readyForVercelEnvSyncDryRun: false,
          releaseReady: false,
        },
        blockedReasons: ["upstream-auth-production-evidence-not-cleared"],
      }),
    );
    expect(body.blockingInput).toBeNull();
    expect(body.upstreamBlockingEvidence).toEqual({
      id: "upstream-auth-production-evidence",
      label: "app-auth-and-teacher-auth-production-evidence",
      reason:
        "External-storage env-source intake must wait for app-auth and teacher-auth production evidence before S19 reads the approved external-storage env source.",
      valuesForbidden: true,
      upstreamStatus: "teacher-auth-production-evidence-gate-waiting-for-upstream-app-auth",
      safeNextAction: "provide-approved-env-source-path-to-s19",
      upstreamOperatorInputRequired: true,
      upstreamMissingEvidence: ["approved-env-source-path"],
      upstreamOperatorInputPacket,
      upstreamSafeCommandTemplates: {
        approvedSourceHandleIntake:
          "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
      },
    });
    expect(body.missingEvidence).toEqual(["upstream-auth-production-evidence"]);
    expect(body.deferredMissingEvidence).toEqual([
      "vercel-env-sync-evidence-with-external-storage-env-present",
      "external-storage-service-readiness-production-live-ready",
    ]);
    expect(body.requiredServerOnlyEnvNames).toEqual(requiredEnvNames);
    expect(body.safeNextAction).toBe("provide-approved-env-source-path-to-s19");
    expect(body.safety.envFileRead).toBe(false);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");

    const markdown = execFileSync("node", [
      "scripts/external-storage-env-source-intake.mjs",
      "--production-env-source-handoff",
      handoffPath,
      "--external-storage-preflight",
      preflightPath,
      "--teacher-auth-production-evidence-gate",
      teacherAuthGatePath,
      "--format",
      "markdown",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(markdown).toContain("Operator input required: `true`");
    expect(markdown).toContain("Safe next action: `provide-approved-env-source-path-to-s19`");
    expect(markdown).toContain("## Upstream Operator Input Packet");
    expect(markdown).toContain("- First required input: `approved-env-source-path`");
    expect(markdown).toContain("- Next command template: `approvedSourceHandleIntake`");
    expect(markdown).toContain("## Upstream Safe Operator Command Templates");
    expect(markdown).toContain(
      "`approvedSourceHandleIntake`: `node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle>",
    );
    expect(markdown).not.toContain(tmpDir);
    expect(markdown).not.toContain("/Users/");
  });

  it("reads an approved test env file only after upstream auth is cleared and reports redacted presence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-external-storage-env-source-intake-live-"));
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir);
    const fakeEndpoint = "https://external-storage.example.test/private";
    const fakeToken = "secret-external-storage-token";
    const envPath = join(tmpDir, "approved-external-storage.env");
    writeFileSync(
      envPath,
      [
        "UAIS_TEACHER_AI_OWNERSHIP_BACKEND=external",
        "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND=external",
        "UAIS_TEACHING_OPERATIONS_BACKEND=external",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
        "UAIS_TEACHING_COURSE_ASSETS_BACKEND=external",
        `UAIS_EXTERNAL_STORAGE_BASE_URL=${fakeEndpoint}`,
        `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=${fakeToken}`,
        "UAIS_EXTERNAL_STORAGE_SERVICE_MODE=remote-https",
        "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR=server-managed",
        "UAIS_EXTERNAL_STORAGE_DATA_DIR=server-managed",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS=managed",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS=ready",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY=enabled",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL=enabled",
        "",
      ].join("\n"),
    );
    const handoffPath = writeJson(reportsDir, "handoff.json", buildHandoff());
    const preflightPath = writeJson(reportsDir, "external-storage-preflight.json", {
      target: "external-storage-production-evidence-preflight",
      status: "external-storage-production-evidence-preflight-ready",
      approvedServiceClass: "approved-remote-https-external-storage-service",
      approvedRemoteHttpsExternalStorageServiceLabel:
        "UAIS-approved-remote-HTTPS-external-storage-service",
      approvedServerOnlyEnvSourceLabel: "UAIS-production-external-storage-env-source",
      approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
      approvedSmokeTeacherIdLabel: "UAIS-approved-smoke-teacher-label",
      summary: {
        upstreamAuthEvidenceCleared: true,
        s19DryRunMayProceedAfterAuthClears: true,
        releaseReady: false,
      },
      requiredServerOnlyEnvNames: requiredEnvNames,
    });

    const output = execFileSync("node", [
      "scripts/external-storage-env-source-intake.mjs",
      "--live",
      "--approved",
      "--env-file",
      envPath,
      "--production-env-source-handoff",
      handoffPath,
      "--external-storage-preflight",
      preflightPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("external-storage-env-source-intake-ready-for-vercel-env-sync-dry-run");
    expect(body.releaseReady).toBe(false);
    expect(body.mode).toBe("live-approved-redacted-intake");
    expect(body.summary).toEqual({
      ownerInputRequired: false,
      operatorInputRequired: false,
      blockingInputRequired: false,
      upstreamEvidenceRequired: false,
      upstreamAuthEvidenceCleared: true,
      requiredEnvNameCount: 14,
      presentEnvNameCount: 14,
      missingEnvNameCount: 0,
      envFileProvided: true,
      envValuesEmitted: false,
      readyForVercelEnvSyncDryRun: true,
      releaseReady: false,
    });
    expect(body.envPresence.every((entry: { present: boolean }) => entry.present)).toBe(true);
    expect(body.safeNextAction).toBe("run-s19-vercel-env-sync-dry-run-for-external-storage");
    expect(body.blockingInput).toBeNull();
    expect(body.upstreamBlockingEvidence).toBeNull();
    expect(body.safety.envFileRead).toBe(true);
    expect(output).not.toContain(fakeEndpoint);
    expect(output).not.toContain(fakeToken);
    expect(output).not.toContain(envPath);
    expect(output).not.toContain("/Users/");
  });
});

function buildHandoff() {
  return {
    target: "production-env-source-handoff",
    status: "production-env-source-handoff-awaiting-approved-env-source-path",
    sourceRequests: [
      {
        id: "external-storage-production-service",
        kind: "external-storage",
        requestStatus: "waiting-for-upstream-production-evidence",
        approvedServiceClass: "approved-remote-https-external-storage-service",
        approvedRemoteHttpsExternalStorageServiceLabel:
          "UAIS-approved-remote-HTTPS-external-storage-service",
        approvedServerOnlyEnvSourceLabel: "UAIS-production-external-storage-env-source",
        approvedReleaseRunIdLabel: "UAIS-enterprise-run-2026-07-XX",
        approvedSmokeTeacherIdLabel: "UAIS-approved-smoke-teacher-label",
        requiredServerOnlyEnvNames: requiredEnvNames,
        missingEvidence: [
          "vercel-env-sync-evidence-with-external-storage-env-present",
          "external-storage-service-readiness-production-live-ready",
        ],
      },
    ],
  };
}

function writeJson(dir: string, name: string, value: unknown) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
