import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vercel CLI auth readiness diagnostics", () => {
  it("blocks production deploy readiness when no token or CLI auth is available", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-auth-readiness-empty-"));
    const envFile = join(tmpDir, "empty.env");
    const projectFile = join(tmpDir, "project.json");
    writeFileSync(envFile, "DASHSCOPE_API_KEY=secret-qwen-fixture\n");
    writeFileSync(
      projectFile,
      JSON.stringify({
        projectId: "prj_secret_should_not_print",
        orgId: "team_secret_should_not_print",
        projectName: "uais",
      }),
    );

    const output = execFileSync("node", [
      "scripts/vercel-cli-auth-readiness.mjs",
      "--dry-run",
      "--env-file",
      envFile,
      "--project-file",
      projectFile,
      "--auth-file",
      join(tmpDir, "missing-auth.json"),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-cli-auth-readiness",
        mode: "dry-run",
        status: "blocked",
        responsibleSession: "S22",
        projectLink: {
          status: "linked",
          projectName: "uais",
          projectId: "present",
          orgId: "present",
          valuesRedacted: true,
        },
        authMethods: {
          envToken: "missing",
          vercelAuthToken: "missing",
          cliAuthJson: "missing",
          oidcDiscovery: "not-run",
          valuesRedacted: true,
        },
        blockedReasons: [
          "vercel-token-missing",
          "vercel-cli-auth-json-missing",
          "vercel-oidc-discovery-not-proven",
        ],
      }),
    );
    expect(output).not.toContain("secret-qwen-fixture");
    expect(output).not.toContain("prj_secret_should_not_print");
    expect(output).not.toContain("team_secret_should_not_print");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("marks token-based deploy auth ready without printing the token", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-auth-readiness-token-"));
    const envFile = join(tmpDir, "token.env");
    const projectFile = join(tmpDir, "project.json");
    writeFileSync(envFile, "VERCEL_TOKEN=vca_fixture_token_should_not_print\n");
    writeFileSync(projectFile, JSON.stringify({ projectName: "uais" }));

    const output = execFileSync("node", [
      "scripts/vercel-cli-auth-readiness.mjs",
      "--dry-run",
      "--env-file",
      envFile,
      "--project-file",
      projectFile,
      "--auth-file",
      join(tmpDir, "missing-auth.json"),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "ready",
        readyAuthMethod: "env-token",
        authMethods: expect.objectContaining({
          envToken: "present",
          vercelAuthToken: "present",
          cliAuthJson: "missing",
          oidcDiscovery: "not-required",
        }),
        blockedReasons: [],
      }),
    );
    expect(output).not.toContain("vca_fixture_token_should_not_print");
    expect(output).not.toContain(tmpDir);
  });

  it("keeps CLI-auth readiness blocked in dry-run until OIDC discovery is proved", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-auth-readiness-cli-auth-"));
    const authFile = join(tmpDir, "auth.json");
    const projectFile = join(tmpDir, "project.json");
    writeFileSync(authFile, JSON.stringify({ token: "cli_auth_secret_should_not_print" }));
    writeFileSync(projectFile, JSON.stringify({ projectName: "uais" }));

    const output = execFileSync("node", [
      "scripts/vercel-cli-auth-readiness.mjs",
      "--dry-run",
      "--project-file",
      projectFile,
      "--auth-file",
      authFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        readyAuthMethod: "missing",
        authMethods: expect.objectContaining({
          envToken: "missing",
          cliAuthJson: "present",
          oidcDiscovery: "not-run",
        }),
        blockedReasons: ["vercel-oidc-discovery-not-proven"],
      }),
    );
    expect(output).not.toContain("cli_auth_secret_should_not_print");
    expect(output).not.toContain(tmpDir);
  });
});
