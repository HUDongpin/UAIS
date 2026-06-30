import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseRunId = "uais-release-2026-06-18T000000Z";

function runJson(args: string[]) {
  return JSON.parse(
    execFileSync("node", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    }),
  );
}

function runCli(args: string[]) {
  try {
    const stdout = execFileSync("node", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const childError = error as {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
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

describe("release run evidence binding", () => {
  it("lets production evidence producers emit the same release run id", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-release-run-id-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia Natural Number Ordinal Theory",
        expectedSlideCount: 19,
      }),
    );
    writeFileSync(preflightReport, "machine-preflight-passed");

    const vercelDeployment = runJson([
      "scripts/vercel-production-deployment-evidence.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--deployment-url",
      "https://uais-production.example.test",
      "--release-run-id",
      releaseRunId,
    ]);
    const deployedPage = runJson([
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--base-url",
      "https://uais-production.example.test",
      "--release-run-id",
      releaseRunId,
    ]);
    const browserSmoke = runJson([
      "scripts/teacher-workflow-browser-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--base-url",
      "https://uais-production.example.test",
      "--release-run-id",
      releaseRunId,
    ]);
    const routeSmoke = runJson([
      "scripts/ai-route-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--base-url",
      "https://uais-production.example.test",
      "--release-run-id",
      releaseRunId,
    ]);
    const externalStorageSmoke = runJson([
      "scripts/external-storage-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--base-url",
      "https://uais-storage.example.test",
      "--teacher-id",
      "teacher-smoke",
      "--release-run-id",
      releaseRunId,
    ]);
    const pptAcceptance = runJson([
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--release-run-id",
      releaseRunId,
    ]);

    expect([
      vercelDeployment,
      deployedPage,
      browserSmoke,
      routeSmoke,
      externalStorageSmoke,
      pptAcceptance,
    ]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ releaseRunId }),
        expect.objectContaining({ releaseRunId }),
        expect.objectContaining({ releaseRunId }),
        expect.objectContaining({ releaseRunId }),
        expect.objectContaining({ releaseRunId }),
        expect.objectContaining({ releaseRunId }),
      ]),
    );
  });

  it("rejects invalid release run ids across production evidence producers without echoing the value", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-release-run-invalid-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const invalidReleaseRunId = "secret-/Users/local-path";
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia Natural Number Ordinal Theory",
        expectedSlideCount: 19,
      }),
    );
    writeFileSync(preflightReport, "machine-preflight-passed");

    const commands = [
      [
        "scripts/vercel-env-sync.mjs",
        "--dry-run",
        "--project",
        "uais",
        "--release-run-id",
        invalidReleaseRunId,
      ],
      [
        "scripts/vercel-production-deployment-evidence.mjs",
        "--dry-run",
        "--environment",
        "production",
        "--deployment-url",
        "https://uais-production.example.test",
        "--release-run-id",
        invalidReleaseRunId,
      ],
      [
        "scripts/teacher-workflow-deployment-smoke.mjs",
        "--dry-run",
        "--environment",
        "production",
        "--base-url",
        "https://uais-production.example.test",
        "--release-run-id",
        invalidReleaseRunId,
      ],
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--dry-run",
        "--environment",
        "production",
        "--base-url",
        "https://uais-production.example.test",
        "--release-run-id",
        invalidReleaseRunId,
      ],
      [
        "scripts/ai-route-smoke.mjs",
        "--dry-run",
        "--environment",
        "production",
        "--base-url",
        "https://uais-production.example.test",
        "--release-run-id",
        invalidReleaseRunId,
      ],
      [
        "scripts/external-storage-smoke.mjs",
        "--dry-run",
        "--environment",
        "production",
        "--base-url",
        "https://uais-storage.example.test",
        "--teacher-id",
        "teacher-smoke",
        "--release-run-id",
        invalidReleaseRunId,
      ],
      [
        "scripts/teacher-auth-provider-readiness.mjs",
        "--dry-run",
        "--environment",
        "production",
        "--release-run-id",
        invalidReleaseRunId,
      ],
      [
        "scripts/external-storage-service-readiness.mjs",
        "--dry-run",
        "--environment",
        "production",
        "--base-url",
        "https://uais-storage.example.test",
        "--release-run-id",
        invalidReleaseRunId,
      ],
      [
        "scripts/ppt-manual-playback-acceptance.mjs",
        "--package-json",
        packageJson,
        "--preflight-report",
        preflightReport,
        "--release-run-id",
        invalidReleaseRunId,
      ],
    ];

    for (const command of commands) {
      const result = runCli(command);
      expect(result.status, command[0]).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`, command[0]).toContain(
        "--release-run-id must be a non-secret release identifier.",
      );
      expect(`${result.stdout}\n${result.stderr}`, command[0]).not.toContain(
        invalidReleaseRunId,
      );
      expect(`${result.stdout}\n${result.stderr}`, command[0]).not.toContain(tmpDir);
      expect(`${result.stdout}\n${result.stderr}`, command[0]).not.toContain("/Users/");
    }
  });
});
