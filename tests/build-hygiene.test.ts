import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production build hygiene", () => {
  it("does not depend on Google Fonts during Next.js build", () => {
    const layoutSource = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

    expect(layoutSource).not.toContain("next/font/google");
  });
});
