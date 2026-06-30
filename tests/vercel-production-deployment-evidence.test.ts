import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vercel production deployment evidence harness", () => {
  it("prints a redacted dry-run deploy evidence contract without leaking env values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-dry-"));
    const envFile = join(tmpDir, "vercel-production.env");
    writeFileSync(
      envFile,
      [
        "VERCEL_TOKEN=secret-vercel-token",
        "UAIS_DEPLOYMENT_BASE_URL=https://private-production.example.test",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/vercel-production-deployment-evidence.mjs",
      "--dry-run",
      "--deploy",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--scope",
      "private-team",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-production-deployment",
        mode: "dry-run",
        action: "deploy",
        environment: "production",
        network: "disabled",
        status: "blocked",
        responsibleSession: "S22",
        blockedReasons: ["vercel-production-deployment-live-not-run"],
        deploymentOrigin: {
          status: "present",
          originClass: "remote-https",
          valueRedacted: true,
        },
        deploymentFingerprint: {
          status: "present",
          value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
        },
        safety: {
          valuesRedacted: true,
          deploymentUrlOmitted: true,
          deploymentUrlsOmitted: true,
          projectIdsOmitted: true,
          orgIdsOmitted: true,
          accountNamesOmitted: true,
          teamIdsOmitted: true,
          teamSlugsOmitted: true,
          tokenOmitted: true,
          tokenFlagForbidden: true,
          projectReadinessEvidencePathOmitted: true,
          envSyncEvidencePathOmitted: true,
          localPrivatePathsOmitted: true,
          cliOutputOmitted: true,
          liveRequiresApproval: true,
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-auth",
          status: "present",
          authMethods: ["VERCEL_TOKEN", "vercel-cli-login"],
          authMethod: "VERCEL_TOKEN",
          valueRedacted: true,
        }),
      ]),
    );
    expect(output).not.toContain("secret-vercel-token");
    expect(output).not.toContain("private-production.example.test");
    expect(output).not.toContain("private-team");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects live deploy evidence without explicit owner approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/vercel-production-deployment-evidence.mjs",
        "--live",
        "--deploy",
        "--environment",
        "production",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          VERCEL_TOKEN: "secret-vercel-token",
        },
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });

  it("runs approved live deploy with VERCEL_TOKEN env and omits token flags and deployment values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-live-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    const releaseRunId = "uais-release-2026-06-18T000000Z";
    const envSyncFile = writeAppliedVercelEnvSync(tmpDir, releaseRunId);
    writeFakeVercel(tmpDir, [
      "printf '%s\\n' \"$@\" > \"$FAKE_VERCEL_LOG\"",
      "for arg in \"$@\"; do",
      "  if [ \"$arg\" = \"--token\" ]; then echo 'token flag forbidden' >&2; exit 9; fi",
      "done",
      "printf 'Queued production deployment\\nhttps://private-production.example.test\\n'",
      "exit 0",
    ]);

    const output = execFileSync("node", [
      "scripts/vercel-production-deployment-evidence.mjs",
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--scope",
      "private-team",
      "--vercel-project-readiness",
      readinessFile,
      "--vercel-env-sync",
      envSyncFile,
      "--release-run-id",
      releaseRunId,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_TOKEN: "secret-vercel-token",
        FAKE_VERCEL_LOG: fakeLog,
      },
    });
    const body = JSON.parse(output);
    const fakeLogBody = readFileSync(fakeLog, "utf8");

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-production-deployment",
        mode: "live",
        action: "deploy",
        environment: "production",
        network: "enabled",
        releaseRunId,
        status: "deployed",
        deploymentOrigin: {
          status: "present",
          originClass: "remote-https",
          valueRedacted: true,
        },
        deploymentFingerprint: {
          status: "present",
          value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
        },
        deploymentObservation: {
          status: "observed",
          observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
          source: "harness-clock",
        },
        operation: {
          command: "vercel-deploy-production",
          status: "passed",
          stdoutOmitted: true,
          stderrOmitted: true,
        },
        envSyncApplyPreflightGuard: {
          status: "proved",
          requiredEvidence: "vercel-env-sync.applyPreflight",
          valuesRedacted: true,
          cliSafeToInvoke: true,
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-project-readiness",
          status: "ready",
          requiredEvidence: "vercel-project-readiness",
        }),
        expect.objectContaining({
          id: "s19-vercel-env-sync-apply-evidence",
          status: "applied",
          requiredEvidence: "vercel-env-sync",
        }),
      ]),
    );
    expect(fakeLogBody).toContain("deploy");
    expect(fakeLogBody).toContain("--prod");
    expect(fakeLogBody).toContain("--yes");
    expect(fakeLogBody).toContain("--scope");
    expect(fakeLogBody).not.toContain("--token");
    expect(fakeLogBody).not.toContain("secret-vercel-token");
    expect(Number.isFinite(Date.parse(body.deploymentObservation.observedAt))).toBe(true);
    expect(output).not.toContain("private-production.example.test");
    expect(output).not.toContain("secret-vercel-token");
    expect(output).not.toContain("private-team");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks approved live deploy without a release-run id before invoking Vercel", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-missing-run-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    const envSyncFile = writeAppliedVercelEnvSync(tmpDir);
    writeFakeVercel(tmpDir, [
      "printf 'unexpected invocation' > \"$FAKE_VERCEL_LOG\"",
      "printf 'Queued production deployment\\nhttps://private-production.example.test\\n'",
      "exit 0",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--scope",
      "private-team",
      "--vercel-project-readiness",
      readinessFile,
      "--vercel-env-sync",
      envSyncFile,
    ], {
      VERCEL_TOKEN: "secret-vercel-token",
      FAKE_VERCEL_LOG: fakeLog,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Vercel production deployment evidence requires --release-run-id",
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain("private-production.example.test");
    expect(result.stderr).not.toContain("private-team");
    expect(result.stderr).not.toContain("secret-vercel-token");
    expect(result.stderr).not.toContain(tmpDir);
    expect(result.stderr).not.toContain("/Users/");
  });

  it("blocks approved live inspect for a non-remote-HTTPS production origin before invoking Vercel", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-local-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    writeFakeVercel(tmpDir, [
      "printf 'unexpected invocation' > \"$FAKE_VERCEL_LOG\"",
      "exit 0",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--environment",
      "production",
      "--deployment-url",
      "http://127.0.0.1:3000",
      "--project-dir",
      tmpDir,
      "--release-run-id",
      "uais-release-2026-06-18T000000Z",
    ], {
      VERCEL_TOKEN: "secret-vercel-token",
      FAKE_VERCEL_LOG: fakeLog,
    });
    const body = JSON.parse(result.stdout);

    expect(result.status).not.toBe(0);
    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-production-deployment",
        mode: "live",
        action: "inspect",
        environment: "production",
        status: "blocked",
        blockedReasons: ["production-deployment-origin-not-remote-https"],
        deploymentOrigin: {
          status: "present",
          originClass: "local-loopback",
          valueRedacted: true,
        },
      }),
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain("127.0.0.1");
    expect(result.stdout).not.toContain("secret-vercel-token");
    expect(result.stdout).not.toContain(tmpDir);
  });

  it("blocks approved live production inspect without project and env evidence before invoking Vercel", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-inspect-guards-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    writeFakeVercel(tmpDir, [
      "printf 'unexpected invocation' > \"$FAKE_VERCEL_LOG\"",
      "exit 0",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--environment",
      "production",
      "--deployment-url",
      "https://private-production.example.test",
      "--project-dir",
      tmpDir,
      "--release-run-id",
      "uais-release-2026-06-18T000000Z",
    ], {
      VERCEL_TOKEN: "secret-vercel-token",
      FAKE_VERCEL_LOG: fakeLog,
    });
    const body = JSON.parse(result.stdout);

    expect(result.status).not.toBe(0);
    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-production-deployment",
        mode: "live",
        action: "inspect",
        environment: "production",
        status: "blocked",
        blockedReasons: [
          "vercel-project-readiness-not-ready",
          "vercel-env-sync-not-applied",
        ],
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-project-readiness",
          status: "missing",
          requiredEvidence: "vercel-project-readiness",
        }),
        expect.objectContaining({
          id: "s19-vercel-env-sync-apply-evidence",
          status: "missing",
          requiredEvidence: "vercel-env-sync",
        }),
      ]),
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain("private-production.example.test");
    expect(result.stdout).not.toContain("secret-vercel-token");
    expect(result.stdout).not.toContain(tmpDir);
  });

  it("blocks approved live deploy when neither VERCEL_TOKEN nor CLI auth is present before invoking deploy", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-token-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    writeFakeVercel(tmpDir, [
      "if [ \"$1\" = \"whoami\" ]; then exit 1; fi",
      "printf 'unexpected deploy invocation' > \"$FAKE_VERCEL_LOG\"",
      "exit 9",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--release-run-id",
      "uais-release-2026-06-18T000000Z",
    ], {
      VERCEL_TOKEN: "",
      HOME: tmpDir,
      FAKE_VERCEL_LOG: fakeLog,
    });
    const body = JSON.parse(result.stdout);

    expect(result.status).not.toBe(0);
    expect(body.blockedReasons).toEqual([
      "vercel-auth-missing",
      "vercel-project-readiness-not-ready",
      "vercel-env-sync-not-applied",
    ]);
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-auth",
          status: "missing",
          authMethods: ["VERCEL_TOKEN", "vercel-cli-login"],
          valueRedacted: true,
        }),
      ]),
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain(tmpDir);
  });

  it("accepts local Vercel CLI auth file evidence when whoami is unavailable", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-local-auth-file-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const authDir = join(tmpDir, "Library", "Application Support", "com.vercel.cli");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    const releaseRunId = "uais-release-local-auth-file";
    const envSyncFile = writeAppliedVercelEnvSync(tmpDir, releaseRunId);
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, "auth.json"), JSON.stringify({ token: "secret-local-vercel-auth-token" }));
    writeFakeVercel(tmpDir, [
      "if [ \"$1\" = \"whoami\" ]; then exit 1; fi",
      "printf '%s\\n' \"$@\" > \"$FAKE_VERCEL_LOG\"",
      "printf 'Queued production deployment\\nhttps://private-production.example.test\\n'",
      "exit 0",
    ]);

    const output = execFileSync("node", [
      "scripts/vercel-production-deployment-evidence.mjs",
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--vercel-project-readiness",
      readinessFile,
      "--vercel-env-sync",
      envSyncFile,
      "--release-run-id",
      releaseRunId,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_TOKEN: "",
        HOME: tmpDir,
        FAKE_VERCEL_LOG: fakeLog,
      },
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("deployed");
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-auth",
          status: "present",
          authMethod: "vercel-cli-login",
          valueRedacted: true,
        }),
      ]),
    );
    expect(readFileSync(fakeLog, "utf8")).toContain("deploy");
    expect(output).not.toContain("secret-local-vercel-auth-token");
    expect(output).not.toContain("private-production.example.test");
    expect(output).not.toContain(tmpDir);
  });

  it("runs approved live deploy with authenticated Vercel CLI when VERCEL_TOKEN is absent", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-cli-auth-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    const releaseRunId = "uais-release-2026-06-19T000000Z";
    const envSyncFile = writeAppliedVercelEnvSync(tmpDir, releaseRunId);
    writeFakeVercel(tmpDir, [
      "if [ \"$1\" = \"whoami\" ]; then printf 'fixture-user\\n'; exit 0; fi",
      "printf '%s\\n' \"$@\" > \"$FAKE_VERCEL_LOG\"",
      "for arg in \"$@\"; do",
      "  if [ \"$arg\" = \"--token\" ]; then echo 'token flag forbidden' >&2; exit 9; fi",
      "done",
      "printf 'Queued production deployment\\nhttps://private-production.example.test\\n'",
      "exit 0",
    ]);

    const output = execFileSync("node", [
      "scripts/vercel-production-deployment-evidence.mjs",
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--scope",
      "private-team",
      "--vercel-project-readiness",
      readinessFile,
      "--vercel-env-sync",
      envSyncFile,
      "--release-run-id",
      releaseRunId,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_TOKEN: "",
        FAKE_VERCEL_LOG: fakeLog,
      },
    });
    const body = JSON.parse(output);
    const fakeLogBody = readFileSync(fakeLog, "utf8");

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-production-deployment",
        mode: "live",
        action: "deploy",
        environment: "production",
        network: "enabled",
        releaseRunId,
        status: "deployed",
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-auth",
          status: "present",
          authMethod: "vercel-cli-login",
          valueRedacted: true,
        }),
      ]),
    );
    expect(fakeLogBody).toContain("deploy");
    expect(fakeLogBody).toContain("--prod");
    expect(fakeLogBody).toContain("--yes");
    expect(fakeLogBody).not.toContain("--token");
    expect(fakeLogBody).not.toContain("fixture-user");
    expect(output).not.toContain("private-production.example.test");
    expect(output).not.toContain("fixture-user");
    expect(output).not.toContain("private-team");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("runs approved live public-edge inspect without requiring Vercel CLI auth or invoking Vercel", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-public-edge-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    const releaseRunId = "uais-release-public-edge-observed";
    const envSyncFile = writeAppliedVercelEnvSync(tmpDir, releaseRunId);
    const deploymentUrl = "https://private-production.example.test";
    const publicEdgeObservationFile = writePublicEdgeObservation(tmpDir, deploymentUrl);
    writeFakeVercel(tmpDir, [
      "printf 'unexpected cli invocation' > \"$FAKE_VERCEL_LOG\"",
      "exit 9",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--environment",
      "production",
      "--deployment-url",
      deploymentUrl,
      "--project-dir",
      tmpDir,
      "--inspect-mode",
      "public-http",
      "--public-edge-observation",
      publicEdgeObservationFile,
      "--vercel-project-readiness",
      readinessFile,
      "--vercel-env-sync",
      envSyncFile,
      "--release-run-id",
      releaseRunId,
    ], {
      VERCEL_TOKEN: "",
      HOME: tmpDir,
      FAKE_VERCEL_LOG: fakeLog,
    });
    const body = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-production-deployment",
        mode: "live",
        action: "inspect",
        environment: "production",
        network: "enabled",
        releaseRunId,
        status: "deployed",
        deploymentObservation: {
          status: "observed",
          observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
          source: "public-vercel-edge",
        },
        operation: {
          command: "vercel-public-http-inspect",
          status: "passed",
          stdoutOmitted: true,
          stderrOmitted: true,
        },
        publicEdgeObservation: expect.objectContaining({
          status: "observed",
          edgeProvider: "vercel",
          responseBodyOmitted: true,
          headerValuesOmitted: true,
        }),
      }),
    );
    expect(body.prerequisites).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-auth",
        }),
      ]),
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain("private-production.example.test");
    expect(result.stdout).not.toContain("secret-vercel-token");
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("runs approved live deploy with teacher-auth scoped Vercel env evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-teacher-auth-scope-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    const releaseRunId = "uais-release-teacher-auth-scoped-deploy";
    const envSyncFile = writeAppliedVercelEnvSync(tmpDir, releaseRunId, {
      deploymentScope: "teacher-auth",
      externalStorageServiceFingerprint: undefined,
      applySummary: {
        status: "applied",
        appliedEntries: 5,
        appliedActions: 10,
        appliedByTarget: {
          production: 5,
          preview: 5,
        },
        localOnlyEntriesSkipped: 2,
        valuesRedacted: true,
        apiOutputOmitted: true,
      },
    });
    writeFakeVercel(tmpDir, [
      "if [ \"$1\" = \"whoami\" ]; then printf 'fixture-user\\n'; exit 0; fi",
      "printf '%s\\n' \"$@\" > \"$FAKE_VERCEL_LOG\"",
      "printf 'Queued production deployment\\nhttps://private-production.example.test\\n'",
      "exit 0",
    ]);

    const output = execFileSync("node", [
      "scripts/vercel-production-deployment-evidence.mjs",
      "--live",
      "--approved",
      "--deploy",
      "--deployment-scope",
      "teacher-auth",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--vercel-project-readiness",
      readinessFile,
      "--vercel-env-sync",
      envSyncFile,
      "--release-run-id",
      releaseRunId,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_TOKEN: "",
        FAKE_VERCEL_LOG: fakeLog,
      },
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-production-deployment",
        mode: "live",
        action: "deploy",
        deploymentScope: "teacher-auth",
        environment: "production",
        releaseRunId,
        status: "deployed",
        envSyncApplyPreflightGuard: {
          status: "proved",
          requiredEvidence: "vercel-env-sync.applyPreflight",
          valuesRedacted: true,
          cliSafeToInvoke: true,
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s19-vercel-env-sync-apply-evidence",
          status: "applied",
          requiredEvidence: "vercel-env-sync",
        }),
      ]),
    );
    expect(readFileSync(fakeLog, "utf8")).toContain("deploy");
    expect(output).not.toContain("private-production.example.test");
    expect(output).not.toContain("fixture-user");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks approved live deploy without ready project-readiness evidence before invoking Vercel", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-project-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    writeFakeVercel(tmpDir, [
      "printf 'unexpected invocation' > \"$FAKE_VERCEL_LOG\"",
      "exit 0",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--release-run-id",
      "uais-release-2026-06-18T000000Z",
    ], {
      VERCEL_TOKEN: "secret-vercel-token",
      FAKE_VERCEL_LOG: fakeLog,
    });
    const body = JSON.parse(result.stdout);

    expect(result.status).not.toBe(0);
    expect(body.blockedReasons).toEqual([
      "vercel-project-readiness-not-ready",
      "vercel-env-sync-not-applied",
    ]);
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-project-readiness",
          status: "missing",
          requiredEvidence: "vercel-project-readiness",
        }),
      ]),
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain("secret-vercel-token");
    expect(result.stdout).not.toContain(tmpDir);
  });

  it("blocks approved live deploy without applied Vercel env evidence before invoking Vercel", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-env-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    writeFakeVercel(tmpDir, [
      "printf 'unexpected invocation' > \"$FAKE_VERCEL_LOG\"",
      "exit 0",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--vercel-project-readiness",
      readinessFile,
      "--release-run-id",
      "uais-release-2026-06-18T000000Z",
    ], {
      VERCEL_TOKEN: "secret-vercel-token",
      FAKE_VERCEL_LOG: fakeLog,
    });
    const body = JSON.parse(result.stdout);

    expect(result.status).not.toBe(0);
    expect(body.blockedReasons).toEqual(["vercel-env-sync-not-applied"]);
    expect(body.operation).toEqual(
      expect.objectContaining({
        command: "vercel-deploy-production",
        status: "blocked-before-invocation",
        stdoutOmitted: true,
        stderrOmitted: true,
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s19-vercel-env-sync-apply-evidence",
          status: "missing",
          requiredEvidence: "vercel-env-sync",
        }),
      ]),
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain("secret-vercel-token");
    expect(result.stdout).not.toContain(tmpDir);
  });

  it("blocks approved live deploy when Vercel env evidence lacks storage fingerprint proof before invoking Vercel", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-env-fingerprint-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    const releaseRunId = "uais-release-2026-06-18T000000Z";
    const envSyncFile = writeAppliedVercelEnvSync(tmpDir, releaseRunId, {
      externalStorageServiceFingerprint: undefined,
    });
    writeFakeVercel(tmpDir, [
      "printf 'unexpected invocation' > \"$FAKE_VERCEL_LOG\"",
      "printf 'Queued production deployment\\nhttps://private-production.example.test\\n'",
      "exit 0",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--vercel-project-readiness",
      readinessFile,
      "--vercel-env-sync",
      envSyncFile,
      "--release-run-id",
      releaseRunId,
    ], {
      VERCEL_TOKEN: "secret-vercel-token",
      FAKE_VERCEL_LOG: fakeLog,
    });
    const body = JSON.parse(result.stdout);

    expect(result.status).not.toBe(0);
    expect(body.releaseRunId).toBe(releaseRunId);
    expect(body.blockedReasons).toEqual([
      "vercel-env-sync-external-storage-fingerprint-not-proven",
    ]);
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s19-vercel-env-sync-apply-evidence",
          status: "external-storage-fingerprint-missing",
          requiredEvidence: "vercel-env-sync",
        }),
      ]),
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain("secret-vercel-token");
    expect(result.stdout).not.toContain(tmpDir);
  });

  it("blocks approved live deploy when Vercel env evidence lacks redacted apply summary before invoking Vercel", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-env-summary-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    const releaseRunId = "uais-release-2026-06-18T000000Z";
    const envSyncFile = writeAppliedVercelEnvSync(tmpDir, releaseRunId, {
      applySummary: undefined,
    });
    writeFakeVercel(tmpDir, [
      "printf 'unexpected invocation' > \"$FAKE_VERCEL_LOG\"",
      "printf 'Queued production deployment\\nhttps://private-production.example.test\\n'",
      "exit 0",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--vercel-project-readiness",
      readinessFile,
      "--vercel-env-sync",
      envSyncFile,
      "--release-run-id",
      releaseRunId,
    ], {
      VERCEL_TOKEN: "secret-vercel-token",
      FAKE_VERCEL_LOG: fakeLog,
    });
    const body = JSON.parse(result.stdout);

    expect(result.status).not.toBe(0);
    expect(body.releaseRunId).toBe(releaseRunId);
    expect(body.blockedReasons).toEqual([
      "vercel-env-sync-apply-summary-not-proven",
    ]);
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s19-vercel-env-sync-apply-evidence",
          status: "apply-summary-missing",
          requiredEvidence: "vercel-env-sync",
        }),
      ]),
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain("secret-vercel-token");
    expect(result.stdout).not.toContain(tmpDir);
  });

  it("blocks approved live deploy when Vercel env evidence lacks passed apply preflight before invoking Vercel", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-env-preflight-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    const releaseRunId = "uais-release-2026-06-18T000000Z";
    const envSyncFile = writeAppliedVercelEnvSync(tmpDir, releaseRunId, {
      applyPreflight: undefined,
    });
    writeFakeVercel(tmpDir, [
      "printf 'unexpected invocation' > \"$FAKE_VERCEL_LOG\"",
      "printf 'Queued production deployment\\nhttps://private-production.example.test\\n'",
      "exit 0",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--vercel-project-readiness",
      readinessFile,
      "--vercel-env-sync",
      envSyncFile,
      "--release-run-id",
      releaseRunId,
    ], {
      VERCEL_TOKEN: "secret-vercel-token",
      FAKE_VERCEL_LOG: fakeLog,
    });
    const body = JSON.parse(result.stdout);

    expect(result.status).not.toBe(0);
    expect(body.releaseRunId).toBe(releaseRunId);
    expect(body.blockedReasons).toEqual([
      "vercel-env-sync-apply-preflight-not-proven",
    ]);
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s19-vercel-env-sync-apply-evidence",
          status: "apply-preflight-missing",
          requiredEvidence: "vercel-env-sync",
        }),
      ]),
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain("secret-vercel-token");
    expect(result.stdout).not.toContain(tmpDir);
  });

  it("blocks approved live deploy when Vercel env evidence is not bound to the release run", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-deployment-env-run-"));
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const readinessFile = writeReadyVercelProjectReadiness(tmpDir);
    const envSyncFile = writeAppliedVercelEnvSync(tmpDir);
    writeFakeVercel(tmpDir, [
      "printf 'unexpected invocation' > \"$FAKE_VERCEL_LOG\"",
      "exit 0",
    ]);

    const result = runEvidenceHarness([
      "--live",
      "--approved",
      "--deploy",
      "--environment",
      "production",
      "--project-dir",
      tmpDir,
      "--vercel-project-readiness",
      readinessFile,
      "--vercel-env-sync",
      envSyncFile,
      "--release-run-id",
      "uais-release-2026-06-18T000000Z",
    ], {
      VERCEL_TOKEN: "secret-vercel-token",
      FAKE_VERCEL_LOG: fakeLog,
    });
    const body = JSON.parse(result.stdout);

    expect(result.status).not.toBe(0);
    expect(body.releaseRunId).toBe("uais-release-2026-06-18T000000Z");
    expect(body.blockedReasons).toEqual(["vercel-env-sync-release-run-id-missing"]);
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s19-vercel-env-sync-apply-evidence",
          status: "release-run-missing",
          requiredEvidence: "vercel-env-sync",
        }),
      ]),
    );
    expect(fileContentsOrEmpty(fakeLog)).toBe("");
    expect(result.stdout).not.toContain("secret-vercel-token");
    expect(result.stdout).not.toContain(tmpDir);
  });
});

function runEvidenceHarness(args: string[], env: Record<string, string>) {
  try {
    const stdout = execFileSync("node", [
      "scripts/vercel-production-deployment-evidence.mjs",
      ...args,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
      stdio: "pipe",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const childError = error as {
      status?: number;
      stdout?: Buffer | string;
    };
    return {
      status: childError.status ?? 1,
      stdout: Buffer.isBuffer(childError.stdout)
        ? childError.stdout.toString("utf8")
        : childError.stdout ?? "",
      stderr: Buffer.isBuffer(childError.stderr)
        ? childError.stderr.toString("utf8")
        : childError.stderr ?? "",
    };
  }
}

function writeFakeVercel(baseDir: string, lines: string[]) {
  const binDir = join(baseDir, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, "vercel");
  writeFileSync(binPath, ["#!/bin/sh", ...lines, ""].join("\n"));
  chmodSync(binPath, 0o755);
}

function writeReadyVercelProjectReadiness(baseDir: string) {
  const readinessFile = join(baseDir, "vercel-project-readiness.json");
  writeFileSync(
    readinessFile,
    JSON.stringify({
      target: "vercel-project-readiness",
      mode: "local",
      status: "ready",
      checks: [
        { id: "s22-vercel-cli", status: "present" },
        { id: "s22-vercel-auth", status: "present" },
        { id: "s22-vercel-team-scope", status: "present" },
        { id: "s22-vercel-project-candidate", status: "present" },
        { id: "s22-vercel-project-link", status: "present" },
        { id: "s22-vercelignore-upload-hygiene", status: "present" },
      ],
      blockedReasons: [],
    }),
  );
  return readinessFile;
}

function writeAppliedVercelEnvSync(
  baseDir: string,
  releaseRunId?: string,
  overrides: Record<string, unknown> = {},
) {
  const envSyncFile = join(baseDir, "vercel-env-sync.json");
  const evidence = {
    target: "vercel-env-sync",
    mode: "apply",
    ...(releaseRunId ? { releaseRunId } : {}),
    projectReadinessEvidenceStatus: "ready",
    targets: ["production", "preview"],
    applySummary: {
      status: "applied",
      appliedEntries: 13,
      appliedActions: 26,
      appliedByTarget: {
        production: 13,
        preview: 13,
      },
      localOnlyEntriesSkipped: 2,
      valuesRedacted: true,
      cliOutputOmitted: true,
    },
    externalStorageServiceFingerprint: {
      status: "present",
      value: "sha256:1122334455667788",
      source: "origin",
      valueRedacted: true,
    },
    applyPreflight: {
      status: "passed",
      blockedReasons: [],
      valuesRedacted: true,
      cliSafeToInvoke: true,
    },
    safety: {
      valuesRedacted: true,
      applyRequiresApproval: true,
      applyRequiresLinkedProject: true,
      applyRequiresProjectReadiness: true,
      localOnlySmokeEnvNotSynced: true,
    },
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete (evidence as Record<string, unknown>)[key];
    } else {
      (evidence as Record<string, unknown>)[key] = value;
    }
  }
  writeFileSync(
    envSyncFile,
    JSON.stringify(evidence),
  );
  return envSyncFile;
}

function writePublicEdgeObservation(baseDir: string, deploymentUrl: string) {
  const publicEdgeObservationFile = join(baseDir, "vercel-public-edge-observation.json");
  writeFileSync(
    publicEdgeObservationFile,
    JSON.stringify({
      target: "vercel-public-edge-observation",
      mode: "live",
      environment: "production",
      status: "observed",
      deploymentOrigin: {
        status: "present",
        originClass: "remote-https",
        valueRedacted: true,
      },
      deploymentFingerprint: {
        status: "present",
        value: createTestDeploymentFingerprint(deploymentUrl),
      },
      httpStatus: 307,
      edgeProvider: "vercel",
      headerChecks: {
        serverVercel: "present",
        xVercelId: "present",
      },
      responseBodyOmitted: true,
      headerValuesOmitted: true,
      deploymentUrlOmitted: true,
      valuesRedacted: true,
    }),
  );
  return publicEdgeObservationFile;
}

function createTestDeploymentFingerprint(deploymentUrl: string) {
  const origin = new URL(deploymentUrl).origin.toLowerCase();
  return `sha256:${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`;
}

function fileContentsOrEmpty(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
