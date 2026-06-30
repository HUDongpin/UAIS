import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const envFileHelpScripts = [
  "scripts/ai-provider-smoke.mjs",
  "scripts/ai-route-smoke.mjs",
  "scripts/external-storage-service-readiness.mjs",
  "scripts/external-storage-smoke.mjs",
  "scripts/learning-ppt-playback-deployment-smoke.mjs",
  "scripts/production-e2e-orchestrator.mjs",
  "scripts/qwen-voice-disposable-create-smoke.mjs",
  "scripts/qwen-voice-revoke-smoke.mjs",
  "scripts/teacher-auth-provider-readiness.mjs",
  "scripts/teacher-workflow-browser-smoke.mjs",
  "scripts/teacher-workflow-deployment-smoke.mjs",
  "scripts/teacher-workflow-live-generation-smoke.mjs",
  "scripts/vercel-env-sync.mjs",
  "scripts/vercel-production-deployment-evidence.mjs",
] as const;

describe("Node v24-safe env-file CLI help usage", () => {
  it.each(envFileHelpScripts)(
    "prints node -- usage for %s",
    (scriptPath) => {
      const output = execFileSync("node", [scriptPath, "--help"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      expect(output).toContain(`Usage: node -- ${scriptPath}`);
      expect(output).toContain("--env-file");
      expect(output).not.toContain(`Usage: node ${scriptPath}`);
    },
  );
});
