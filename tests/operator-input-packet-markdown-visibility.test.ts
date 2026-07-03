import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packetHeadingPattern = /"## (?:Upstream )?Operator Input Packet"/g;

const requiredMarkdownLabels = [
  "Preferred input mode",
  "Safe input instruction",
  "Approved source label is evidence",
];

const expectedOperatorPacketMarkdownScripts = [
  "enterprise-live-evidence-audit-production-evidence-gate.mjs",
  "external-storage-env-source-intake.mjs",
  "external-storage-production-evidence-gate.mjs",
  "external-storage-vercel-env-sync-evidence-gate.mjs",
  "manual-ppt-playback-acceptance-production-evidence-gate.mjs",
  "ordinary-teaching-production-evidence-gate.mjs",
  "owner-decision-first-blocker-request.mjs",
  "production-env-source-handoff.mjs",
  "production-evidence-execution-plan.mjs",
  "production-evidence-reuse-audit.mjs",
  "production-release-run-production-evidence-gate.mjs",
  "teacher-auth-env-source-intake.mjs",
  "teacher-auth-production-evidence-gate.mjs",
  "teacher-auth-vercel-env-sync-evidence-gate.mjs",
  "vercel-env-deploy-production-evidence-gate.mjs",
];

describe("operator input packet markdown visibility", () => {
  it("renders safe source-handle guidance in every operator packet markdown section", () => {
    const scriptsDir = join(process.cwd(), "scripts");
    const scriptNames = readdirSync(scriptsDir).filter((name) => name.endsWith(".mjs"));
    const checkedSections = [];
    const checkedScriptNames = new Set<string>();

    for (const scriptName of scriptNames) {
      const source = readFileSync(join(scriptsDir, scriptName), "utf8");

      for (const match of source.matchAll(packetHeadingPattern)) {
        const sectionSource = source.slice(match.index, match.index + 1_100);
        checkedSections.push(`${scriptName}:${match.index}`);
        checkedScriptNames.add(scriptName);

        for (const label of requiredMarkdownLabels) {
          expect(
            sectionSource,
            `${scriptName} operator packet markdown must render ${label}`,
          ).toContain(label);
        }
      }
    }

    expect([...checkedScriptNames].sort()).toEqual(expectedOperatorPacketMarkdownScripts);
    expect(checkedSections.length).toBeGreaterThan(0);
  });
});
