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
  // The two account-provisioning scripts share one --env-file implementation.
  // The seed script advertised the flag in its help long before it read it, so
  // an operator following the help text ran against whatever their shell
  // happened to export; both are pinned here now.
  "scripts/reset-uais-account-password.mjs",
  "scripts/seed-uais-accounts.mjs",
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

// `--env-file` typed as the FINAL argument carries no value, and every one of
// these scripts reads options as "the token after the flag" - so the flag read
// back as "not passed" and the run silently used the ambient environment. For a
// roster import or a password reset that is the wrong deployment, reported as a
// clean success. These three now say so instead.
describe("value-taking CLI options refuse an empty value", () => {
  it.each([
    ["scripts/seed-uais-accounts.mjs", ["--roster", "./roster.csv"]],
    [
      "scripts/reset-uais-account-password.mjs",
      ["--account", "s2026001", "--confirm", "s2026001"],
    ],
    ["scripts/publish-learning-deck.mjs", ["--deck", "./deck.json"]],
  ] as const)("refuses a trailing --env-file for %s", (scriptPath, leadingArgs) => {
    let stderr = "";
    let exitCode = 0;
    try {
      execFileSync("node", [scriptPath, ...leadingArgs, "--env-file"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: process.env.PATH },
      });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      exitCode = failure.status ?? 1;
      stderr = failure.stderr ?? "";
    }

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--env-file requires a value.");
  });
});
