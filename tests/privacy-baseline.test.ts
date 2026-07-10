import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("B-22 privacy baseline", () => {
  it("defines minimum student PII, role access, retention, and production stop conditions", () => {
    const baseline = readProjectFile("docs/privacy-baseline.md");

    expect(baseline).toContain("B-22");
    expect(baseline).toContain("minimum student PII");
    expect(baseline).toContain("/privacy");
    expect(baseline).toContain("/terms");
    expect(baseline).toContain("Role Access Baseline");
    expect(baseline).toContain("Retention And Deletion");
    expect(baseline).toContain("Production Stop Conditions");
    expect(baseline).toContain("No production cohort may start");

    for (const marker of [
      "Student:",
      "Teacher:",
      "Admin:",
      "Public/anonymous:",
      "AI processing inputs",
      "Student learning records",
      "LRS/xAPI queries enforce self-scope",
      "Exports and share links cannot bypass authentication or role scope",
    ]) {
      expect(baseline).toContain(marker);
    }

    expect(baseline).not.toMatch(/Phoebe|12345|sk-[A-Za-z0-9]|BEGIN PRIVATE KEY/);
  });

  it("keeps operator docs, API contracts, and legal notices connected", () => {
    const readme = readProjectFile("README.md");
    const api = readProjectFile("docs/API.md");
    const architectureMap = readProjectFile("docs/architecture-map.md");
    const privacyPage = readProjectFile("src/app/privacy/page.tsx");
    const termsPage = readProjectFile("src/app/terms/page.tsx");

    expect(readme).toContain("docs/privacy-baseline.md");
    expect(api).toContain("docs/privacy-baseline.md");
    expect(architectureMap).toContain("Privacy Baseline");
    expect(architectureMap).toContain("docs/privacy-baseline.md");

    expect(privacyPage).toContain("AI Services and Third-Party Processing");
    expect(privacyPage).toContain("Retention and Deletion");
    expect(privacyPage).toContain("Your Rights and Choices");
    expect(privacyPage).toContain("We do not sell your personal information.");
    expect(termsPage).toContain("Data, Records, and System Security");
    expect(termsPage).toContain("AI-Generated Content and Teaching Responsibility");
  });
});
