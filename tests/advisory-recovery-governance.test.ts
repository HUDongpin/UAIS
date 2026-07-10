import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("advisory recovery governance", () => {
  it("declares the B-07 core POC scope and experimental boundary", () => {
    expect(existsSync(join(root, "SCOPE.md"))).toBe(true);

    const scope = readProjectFile("SCOPE.md");

    expect(scope).toContain("B-07");
    expect(scope).toContain("Core Product Surface");
    expect(scope).toContain("/learning/chatroom");
    expect(scope).toContain("/api/teaching/courses");
    expect(scope).toContain("Parked / Experimental Surface");
    expect(scope).toContain("src/lib/ai/voice");
    expect(scope).toContain("npm run test:critical");
    expect(scope).toContain("does not physically move");
    expect(scope).toContain("legacy modules into a new directory");
  });

  it("adds a CI workflow for the current B-16 critical-flow gate", () => {
    const workflow = readProjectFile(".github/workflows/critical-flow.yml");

    expect(workflow).toContain("pull_request");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run test:critical");
    expect(workflow).toContain("tests/critical-flow-gate-script.test.ts");
    expect(workflow).toContain("tests/advisory-recovery-governance.test.ts");
    expect(workflow).toContain("tests/core-database-foundation.test.ts");
    expect(workflow).toContain("tests/env-surface.test.ts");
    expect(workflow).toContain("--experimental-build-mode compile");
  });
});
