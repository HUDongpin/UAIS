import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("staging INP RootLayout wiring", () => {
  it("requires the staging guard and a valid immutable candidate binding", () => {
    expect(layout).toContain("getUaisStagingInpGuard");
    expect(layout).toContain("getUaisStagingInpBinding");
    expect(layout).toMatch(/getUaisStagingInpGuard\(process\.env\)/);
    expect(layout).toMatch(/getUaisStagingInpBinding\(process\.env\)/);
    expect(layout).toMatch(/stagingInpGuard\.enabled/);
    expect(layout).toMatch(/stagingInpBinding/);
  });

  it("mounts only for an allowlisted signed student or teacher operator", () => {
    expect(layout).toContain("UaisStagingInpReporter");
    expect(layout).toContain("isApprovedUaisStagingInpOperator");
    expect(layout).toMatch(/initialSessionUser\?\.role === "student"/);
    expect(layout).toMatch(/initialSessionUser\?\.role === "teacher"/);
    expect(layout).toMatch(
      /isApprovedUaisStagingInpOperator\(initialSessionUser\.account, process\.env\)/,
    );
    expect(layout).toMatch(
      /stagingInpEnabled\s*\?\s*(?:\(\s*)?<UaisStagingInpReporter enabled\s*\/?>/,
    );
  });
});
