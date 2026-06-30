import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("teacher workflow UI smoke evidence", () => {
  it("keeps evidence blocked when the UI workflow command passes without feature markers", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-ui-smoke-pass-"));
    const command = join(tmpDir, "pass.mjs");
    writeFileSync(command, "process.stdout.write('secret-ui-test-output /Users/local-path');\n");
    chmodSync(command, 0o755);

    const output = execFileSync("node", [
      "scripts/teacher-workflow-ui-smoke.mjs",
      "--command",
      "node",
      "--arg",
      command,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.evidenceStatus).toBe("feature-evidence-missing");
    expect(body.blockedReasons).toEqual(["teacher-workflow-ui-feature-evidence-missing"]);
    expect(Object.values(body.features).every((value) => value === false)).toBe(true);
    expect(output).not.toContain("secret-ui-test-output");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("reports accepted evidence when the UI workflow command emits all feature markers", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-ui-smoke-feature-pass-"));
    const command = join(tmpDir, "pass.mjs");
    writeFileSync(
      command,
      [
        "process.stdout.write('secret-ui-test-output /Users/local-path\\n');",
        "process.stdout.write('UAIS_TEACHER_WORKFLOW_FEATURES {\"voiceSampleUpload\":true,\"uploadedSampleAudioPayload\":true,\"voiceSampleDurationGate\":true,\"voiceSampleSelect\":true,\"selectedSampleIdentity\":true,\"preflight\":true,\"voiceRefDisplay\":true,\"pptNarrationGenerate\":true,\"perSlideWavDownloads\":true,\"workflowStepGating\":true,\"signedSessionBootstrap\":true,\"signedSessionReadiness\":true,\"authFailClosed\":true}\\n');",
        "process.stdout.write('UAIS_TEACHER_WORKFLOW_FEATURES {\"serverWorkflowStatus\":true}\\n');",
      ].join("\n"),
    );
    chmodSync(command, 0o755);

    const output = execFileSync("node", [
      "scripts/teacher-workflow-ui-smoke.mjs",
      "--command",
      "node",
      "--arg",
      command,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-ui-smoke",
        mode: "local-ui-test",
        status: "accepted",
        responsibleSession: "S05",
        evidenceStatus: "feature-evidence-passed",
        features: {
          voiceSampleUpload: true,
          uploadedSampleAudioPayload: true,
          voiceSampleDurationGate: true,
          voiceSampleSelect: true,
          selectedSampleIdentity: true,
          preflight: true,
          voiceRefDisplay: true,
          pptNarrationGenerate: true,
          perSlideWavDownloads: true,
          workflowStepGating: true,
          signedSessionBootstrap: true,
          signedSessionReadiness: true,
          authFailClosed: true,
          serverWorkflowStatus: true,
        },
        safety: {
          secretsRedacted: true,
          commandOutputOmitted: true,
          localPrivatePathsOmitted: true,
          providerValuesOmitted: true,
        },
      }),
    );
    expect(output).not.toContain("secret-ui-test-output");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps evidence blocked when uploaded sample audio payload proof is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-ui-smoke-upload-payload-"));
    const command = join(tmpDir, "pass.mjs");
    writeFileSync(
      command,
      [
        "process.stdout.write('UAIS_TEACHER_WORKFLOW_FEATURES {\"voiceSampleUpload\":true,\"voiceSampleSelect\":true,\"selectedSampleIdentity\":true,\"preflight\":true,\"voiceRefDisplay\":true,\"pptNarrationGenerate\":true,\"perSlideWavDownloads\":true,\"workflowStepGating\":true,\"signedSessionBootstrap\":true,\"signedSessionReadiness\":true,\"authFailClosed\":true,\"serverWorkflowStatus\":true}\\n');",
      ].join("\n"),
    );
    chmodSync(command, 0o755);

    const output = execFileSync("node", [
      "scripts/teacher-workflow-ui-smoke.mjs",
      "--command",
      "node",
      "--arg",
      command,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.evidenceStatus).toBe("feature-evidence-missing");
    expect(body.features.uploadedSampleAudioPayload).toBe(false);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps evidence blocked when signed session readiness proof is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-ui-smoke-session-ready-"));
    const command = join(tmpDir, "pass.mjs");
    writeFileSync(
      command,
      [
        "process.stdout.write('UAIS_TEACHER_WORKFLOW_FEATURES {\"voiceSampleUpload\":true,\"uploadedSampleAudioPayload\":true,\"voiceSampleDurationGate\":true,\"voiceSampleSelect\":true,\"selectedSampleIdentity\":true,\"preflight\":true,\"voiceRefDisplay\":true,\"pptNarrationGenerate\":true,\"perSlideWavDownloads\":true,\"workflowStepGating\":true,\"signedSessionBootstrap\":true,\"authFailClosed\":true,\"serverWorkflowStatus\":true}\\n');",
      ].join("\n"),
    );
    chmodSync(command, 0o755);

    const output = execFileSync("node", [
      "scripts/teacher-workflow-ui-smoke.mjs",
      "--command",
      "node",
      "--arg",
      command,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.evidenceStatus).toBe("feature-evidence-missing");
    expect(body.features.signedSessionReadiness).toBe(false);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("keeps evidence blocked when the UI workflow command fails", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-ui-smoke-fail-"));
    const command = join(tmpDir, "fail.mjs");
    writeFileSync(
      command,
      "process.stderr.write('secret-ui-failure /Users/local-path'); process.exit(1);\n",
    );
    chmodSync(command, 0o755);

    const output = execFileSync("node", [
      "scripts/teacher-workflow-ui-smoke.mjs",
      "--command",
      "node",
      "--arg",
      command,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.evidenceStatus).toBe("test-failed");
    expect(body.blockedReasons).toEqual(["teacher-workflow-ui-test-failed"]);
    expect(Object.values(body.features).every((value) => value === false)).toBe(true);
    expect(output).not.toContain("secret-ui-failure");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});
