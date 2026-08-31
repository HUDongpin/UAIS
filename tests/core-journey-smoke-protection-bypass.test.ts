import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const smokeScript = resolve(repositoryRoot, "scripts/core-journey-smoke.mjs");
const fetchStub = resolve(repositoryRoot, "tests/fixtures/core-journey-fetch-stub.mjs");
const testBypassSecret = "test-only-vercel-automation-bypass-secret";

type CapturedRequest = {
  path: string;
  method: string;
  protectionBypass: string | null;
};

function runSmoke(baseUrl: string) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      fetchStub,
      smokeScript,
      "--base-url",
      baseUrl,
      "--signed-gate",
      "true",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_AUTOMATION_BYPASS_SECRET: testBypassSecret,
      },
    },
  );

  expect(result.status, result.stderr || result.stdout).toBe(0);
  const captureLine = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("UAIS_TEST_BYPASS_CAPTURE="));
  expect(captureLine).toBeDefined();

  return JSON.parse(
    Buffer.from(captureLine!.slice("UAIS_TEST_BYPASS_CAPTURE=".length), "base64url").toString(
      "utf8",
    ),
  ) as CapturedRequest[];
}

describe("core journey Vercel automation bypass", () => {
  it("sends the bypass header on every request to the UAIS immutable Vercel host", () => {
    const requests = runSmoke(
      "https://uais-test-peter-dongpin-hu-s-projects.vercel.app",
    );

    expect(requests.length).toBeGreaterThan(0);
    expect(new Set(requests.map((request) => request.protectionBypass))).toEqual(
      new Set([testBypassSecret]),
    );
  });

  it.each([
    "https://www.uais.top",
    "https://attacker-project.vercel.app",
  ])("does not send the project-wide bypass secret to %s", (baseUrl) => {
    const requests = runSmoke(baseUrl);

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.protectionBypass === null)).toBe(true);
  });

  it("injects the GitHub Actions bypass secret into the smoke step", () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/promotion-gate.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
    );
  });
});
