import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("RootLayout Vercel Analytics", () => {
  const layoutSource = readFileSync(
    join(process.cwd(), "src/app/layout.tsx"),
    "utf8",
  );

  it("injects the Vercel Analytics component from the Next.js entrypoint", () => {
    expect(layoutSource).toContain(
      'import { Analytics } from "@vercel/analytics/next";',
    );
    expect(layoutSource).toMatch(/<body[^>]*>[\s\S]*<Analytics\s*\/>[\s\S]*<\/body>/);
  });

  it("declares Vercel Analytics as a project dependency", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    const analyticsDependency = packageJson.dependencies?.["@vercel/analytics"];

    expect(analyticsDependency).toEqual(expect.any(String));
    if (typeof analyticsDependency !== "string") {
      return;
    }
    expect(analyticsDependency).toMatch(/^\^?\d+\.\d+\.\d+/);
  });
});
