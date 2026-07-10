import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("B-16 critical-flow gate script", () => {
  it("exposes a stable npm script for the current critical journey gate", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const script = packageJson.scripts?.["test:critical"] ?? "";

    expect(script).toContain("vitest run");
    expect(script).toContain("tests/critical-user-flows-backend.test.ts");
    expect(script).toContain("tests/critical-user-flow-matrix.test.ts");
    expect(script).toContain("tests/app-proxy-auth.test.ts");
    expect(script).toContain("tests/uais-app-session.test.ts");
    expect(script).toContain("tests/teaching-course-management-api.test.ts");
    expect(script).toContain("tests/learner-profile.test.ts");
    expect(readProjectFile("README.md")).toContain("npm run test:critical");
  });
});
