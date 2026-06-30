import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("login visual regression evidence CLI", () => {
  it("documents the reference-image visual comparison workflow", () => {
    const output = execFileSync("node", ["scripts/login-visual-regression.mjs", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("Usage: node scripts/login-visual-regression.mjs");
    expect(output).toContain("--reference");
    expect(output).toContain("--max-diff");
    expect(output).toContain("766x332");
  });

  it("reports blocked evidence when a requested reference image is missing", () => {
    const output = execFileSync("node", [
      "scripts/login-visual-regression.mjs",
      "--dry-run",
      "--reference",
      "/definitely/missing/uais-login-reference.png",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "login-visual-regression",
        status: "blocked",
        evidenceStatus: "reference-missing",
        mode: "html-overlay",
        maxDiffRatio: 0.03,
      }),
    );
    expect(body.crop).toEqual(
      expect.objectContaining({
        width: 766,
        height: 332,
      }),
    );
    expect(body.blockedReasons).toEqual(["login-reference-image-missing"]);
  });

  it("can emit a current-baseline plan without requiring a reference image", () => {
    const output = execFileSync("node", ["scripts/login-visual-regression.mjs", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "login-visual-regression",
        status: "evidence-only",
        evidenceStatus: "current-baseline",
      }),
    );
    expect(body.outputs).toEqual(
      expect.objectContaining({
        pageScreenshot: "output/playwright/uais-login-visual-page.png",
        crop: "output/playwright/uais-login-visual-deck-766x332.png",
        diff: null,
      }),
    );
  });

  it("accepts an existing current crop when it matches the reference within threshold", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-login-visual-match-"));
    const reference = createSolidPng(tmpDir, "reference.png", whitePixelPng);
    const current = createSolidPng(tmpDir, "current.png", whitePixelPng);
    const diff = join(tmpDir, "diff.png");

    const output = execFileSync("node", [
      "scripts/login-visual-regression.mjs",
      "--reference",
      reference,
      "--current",
      current,
      "--diff",
      diff,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "accepted",
        evidenceStatus: "visual-diff-passed",
        diffRatio: 0,
      }),
    );
    expect(body.generated).toEqual({
      pageScreenshot: false,
      crop: false,
      diff: true,
    });
  }, 15000);

  it("blocks an existing current crop when visual difference is above threshold", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-login-visual-diff-"));
    const reference = createSolidPng(tmpDir, "reference.png", whitePixelPng);
    const current = createSolidPng(tmpDir, "current.png", blackPixelPng);
    const diff = join(tmpDir, "diff.png");

    const output = execFileSync("node", [
      "scripts/login-visual-regression.mjs",
      "--reference",
      reference,
      "--current",
      current,
      "--diff",
      diff,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.evidenceStatus).toBe("visual-diff-failed");
    expect(body.diffRatio).toBeGreaterThan(0.03);
    expect(body.blockedReasons).toEqual(["login-visual-diff-above-threshold"]);
  }, 15000);
});

const whitePixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lQnJ2QAAAABJRU5ErkJggg==";

const blackPixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function createSolidPng(tmpDir: string, name: string, base64Png: string) {
  const source = join(tmpDir, `source-${name}`);
  const output = join(tmpDir, name);
  writeFileSync(source, Buffer.from(base64Png, "base64"));
  execFileSync("sips", ["-z", "332", "766", source, "--out", output], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  return output;
}
