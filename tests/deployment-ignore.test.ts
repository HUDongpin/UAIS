import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("deployment ignore hygiene", () => {
  it("keeps local secrets, generated assets, and large source bundles out of Vercel uploads", () => {
    const ignoreFile = readFileSync(".vercelignore", "utf8");
    const requiredPatterns = [
      ".env",
      ".env.*",
      "!.env.local.example",
      "All API Keys.docx",
      "OpenMAIC-main.zip",
      ".tmp/",
      "output/",
      "coordination/",
      ".git/",
      ".vercel/",
      "node_modules/",
      ".next/",
      "tsconfig.tsbuildinfo",
    ];

    for (const pattern of requiredPatterns) {
      expect(ignoreFile).toContain(pattern);
    }
  });

  it("emits redacted Vercel project readiness evidence without requiring a live project", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-readiness-"));
    writeFileSync(
      join(tmpDir, ".vercelignore"),
      [
        ".env",
        ".env.*",
        "!.env.local.example",
        "All API Keys.docx",
        "OpenMAIC-main.zip",
        ".tmp/",
        "output/",
        "coordination/",
        ".git/",
        ".vercel/",
        "node_modules/",
        ".next/",
        "tsconfig.tsbuildinfo",
      ].join("\n"),
    );
    mkdirSync(join(tmpDir, ".vercel"));
    mkdirSync(join(tmpDir, "node_modules", ".bin"), { recursive: true });
    const localVercelBin = join(tmpDir, "node_modules", ".bin", "vercel");
    writeFileSync(
      localVercelBin,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then printf '99.0.0-test\\n'; exit 0; fi",
        "if [ \"$1\" = \"whoami\" ]; then printf 'private-account-name\\n'; exit 0; fi",
        "if [ \"$1\" = \"teams\" ] && [ \"$2\" = \"list\" ]; then printf '{\"teams\":[{\"id\":\"team_private\",\"slug\":\"private-team\",\"name\":\"Private Team\",\"current\":true}],\"pagination\":{\"count\":1}}\\n'; exit 0; fi",
        "if [ \"$1\" = \"project\" ] && [ \"$2\" = \"ls\" ]; then printf '{\"projects\":[{\"id\":\"prj_private\",\"name\":\"uais\",\"latestProductionUrl\":\"private.example.vercel.app\"}],\"pagination\":{\"count\":1}}\\n'; exit 0; fi",
        "exit 1",
      ].join("\n"),
    );
    chmodSync(localVercelBin, 0o755);

    const output = execFileSync("node", [
      "scripts/vercel-project-readiness.mjs",
      "--project-dir",
      tmpDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-project-readiness",
        mode: "local",
        status: "blocked",
        responsibleSession: "S22",
        blockedReasons: ["vercel-project-not-linked"],
        safety: {
          valuesRedacted: true,
          projectIdsOmitted: true,
          orgIdsOmitted: true,
          accountNamesOmitted: true,
          teamIdsOmitted: true,
          teamSlugsOmitted: true,
          projectNamesOmitted: true,
          deploymentUrlsOmitted: true,
          localPrivatePathsOmitted: true,
        },
      }),
    );
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "s22-vercel-project-link", status: "missing" }),
        expect.objectContaining({ id: "s22-vercelignore-upload-hygiene", status: "present" }),
        expect.objectContaining({ id: "s22-vercel-project-candidate", status: "present" }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain('"projectId":');
    expect(output).not.toContain('"orgId":');
    expect(output).not.toContain("private-account-name");
    expect(output).not.toContain("team_private");
    expect(output).not.toContain("private.example.vercel.app");
  });

  it("detects a project-local Vercel CLI without requiring a global install", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-local-cli-"));
    writeFileSync(
      join(tmpDir, ".vercelignore"),
      [
        ".env",
        ".env.*",
        "!.env.local.example",
        "All API Keys.docx",
        "OpenMAIC-main.zip",
        ".tmp/",
        "output/",
        "coordination/",
        ".git/",
        ".vercel/",
        "node_modules/",
        ".next/",
        "tsconfig.tsbuildinfo",
      ].join("\n"),
    );
    mkdirSync(join(tmpDir, ".vercel"));
    mkdirSync(join(tmpDir, "node_modules", ".bin"), { recursive: true });
    const localVercelBin = join(tmpDir, "node_modules", ".bin", "vercel");
    writeFileSync(localVercelBin, "#!/bin/sh\nprintf '99.0.0-test\\n'\n");
    chmodSync(localVercelBin, 0o755);

    const output = execFileSync(process.execPath, [
      "scripts/vercel-project-readiness.mjs",
      "--project-dir",
      tmpDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
      },
    });
    const body = JSON.parse(output);

    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-cli",
          status: "present",
          evidence: "project-local-version-detected",
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("99.0.0-test");
  });

  it("emits redacted Vercel auth and team-scope readiness from a project-local CLI", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-auth-ready-"));
    writeFileSync(
      join(tmpDir, ".vercelignore"),
      [
        ".env",
        ".env.*",
        "!.env.local.example",
        "All API Keys.docx",
        "OpenMAIC-main.zip",
        ".tmp/",
        "output/",
        "coordination/",
        ".git/",
        ".vercel/",
        "node_modules/",
        ".next/",
        "tsconfig.tsbuildinfo",
      ].join("\n"),
    );
    mkdirSync(join(tmpDir, ".vercel"));
    mkdirSync(join(tmpDir, "node_modules", ".bin"), { recursive: true });
    const localVercelBin = join(tmpDir, "node_modules", ".bin", "vercel");
    writeFileSync(
      localVercelBin,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then printf '99.0.0-test\\n'; exit 0; fi",
        "if [ \"$1\" = \"whoami\" ]; then printf 'private-account-name\\n'; exit 0; fi",
        "if [ \"$1\" = \"teams\" ] && [ \"$2\" = \"list\" ]; then printf '{\"teams\":[{\"id\":\"team_private\",\"slug\":\"private-team\",\"name\":\"Private Team\",\"current\":true}],\"pagination\":{\"count\":1}}\\n'; exit 0; fi",
        "exit 1",
      ].join("\n"),
    );
    chmodSync(localVercelBin, 0o755);

    const output = execFileSync(process.execPath, [
      "scripts/vercel-project-readiness.mjs",
      "--project-dir",
      tmpDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
      },
    });
    const body = JSON.parse(output);

    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-auth",
          status: "present",
          evidence: "authenticated-account-detected",
        }),
        expect.objectContaining({
          id: "s22-vercel-team-scope",
          status: "present",
          evidence: "single-current-team-detected",
          teamCount: 1,
        }),
      ]),
    );
    expect(body.safety).toEqual(
      expect.objectContaining({
        accountNamesOmitted: true,
        teamIdsOmitted: true,
        teamSlugsOmitted: true,
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-account-name");
    expect(output).not.toContain("private-team");
    expect(output).not.toContain("team_private");
  });

  it("treats an authenticated personal Vercel account with no teams as an explicit scope", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-personal-scope-"));
    writeFileSync(
      join(tmpDir, ".vercelignore"),
      [
        ".env",
        ".env.*",
        "!.env.local.example",
        "All API Keys.docx",
        "OpenMAIC-main.zip",
        ".tmp/",
        "output/",
        "coordination/",
        ".git/",
        ".vercel/",
        "node_modules/",
        ".next/",
        "tsconfig.tsbuildinfo",
      ].join("\n"),
    );
    mkdirSync(join(tmpDir, ".vercel"));
    mkdirSync(join(tmpDir, "node_modules", ".bin"), { recursive: true });
    const localVercelBin = join(tmpDir, "node_modules", ".bin", "vercel");
    writeFileSync(
      localVercelBin,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then printf '99.0.0-test\\n'; exit 0; fi",
        "if [ \"$1\" = \"whoami\" ]; then printf 'private-personal-account\\n'; exit 0; fi",
        "if [ \"$1\" = \"teams\" ] && [ \"$2\" = \"list\" ]; then printf '{\"teams\":[],\"pagination\":{\"count\":0}}\\n'; exit 0; fi",
        "if [ \"$1\" = \"project\" ] && [ \"$2\" = \"ls\" ]; then printf '{\"projects\":[{\"id\":\"prj_private\",\"name\":\"uais\",\"latestProductionUrl\":\"private.example.vercel.app\"}],\"pagination\":{\"count\":1}}\\n'; exit 0; fi",
        "exit 1",
      ].join("\n"),
    );
    chmodSync(localVercelBin, 0o755);

    const output = execFileSync(process.execPath, [
      "scripts/vercel-project-readiness.mjs",
      "--project-dir",
      tmpDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
      },
    });
    const body = JSON.parse(output);

    expect(body.blockedReasons).toEqual(["vercel-project-not-linked"]);
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-auth",
          status: "present",
          evidence: "authenticated-account-detected",
        }),
        expect.objectContaining({
          id: "s22-vercel-team-scope",
          status: "present",
          evidence: "personal-account-scope-detected",
          teamCount: 0,
        }),
        expect.objectContaining({
          id: "s22-vercel-project-candidate",
          status: "present",
          evidence: "single-exact-project-candidate-detected",
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-personal-account");
    expect(output).not.toContain("prj_private");
    expect(output).not.toContain("private.example.vercel.app");
  });

  it("treats empty successful Vercel teams output as a personal account scope", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-empty-team-scope-"));
    writeFileSync(
      join(tmpDir, ".vercelignore"),
      [
        ".env",
        ".env.*",
        "!.env.local.example",
        "All API Keys.docx",
        "OpenMAIC-main.zip",
        ".tmp/",
        "output/",
        "coordination/",
        ".git/",
        ".vercel/",
        "node_modules/",
        ".next/",
        "tsconfig.tsbuildinfo",
      ].join("\n"),
    );
    mkdirSync(join(tmpDir, ".vercel"));
    mkdirSync(join(tmpDir, "node_modules", ".bin"), { recursive: true });
    const localVercelBin = join(tmpDir, "node_modules", ".bin", "vercel");
    writeFileSync(
      localVercelBin,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then printf '99.0.0-test\\n'; exit 0; fi",
        "if [ \"$1\" = \"whoami\" ]; then printf 'private-personal-account\\n'; exit 0; fi",
        "if [ \"$1\" = \"teams\" ] && [ \"$2\" = \"list\" ]; then printf 'Vercel CLI 54.14.0\\n' >&2; exit 0; fi",
        "if [ \"$1\" = \"project\" ] && [ \"$2\" = \"ls\" ]; then printf '{\"projects\":[{\"id\":\"prj_private\",\"name\":\"uais\"}],\"pagination\":{\"count\":1}}\\n'; exit 0; fi",
        "exit 1",
      ].join("\n"),
    );
    chmodSync(localVercelBin, 0o755);

    const output = execFileSync(process.execPath, [
      "scripts/vercel-project-readiness.mjs",
      "--project-dir",
      tmpDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
      },
    });
    const body = JSON.parse(output);

    expect(body.blockedReasons).toEqual(["vercel-project-not-linked"]);
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-team-scope",
          status: "present",
          evidence: "personal-account-scope-empty-output",
          teamCount: 0,
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-personal-account");
    expect(output).not.toContain("Vercel CLI");
    expect(output).not.toContain("prj_private");
  });

  it("does not treat malformed Vercel teams output as a personal account scope", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-malformed-team-scope-"));
    writeFileSync(
      join(tmpDir, ".vercelignore"),
      [
        ".env",
        ".env.*",
        "!.env.local.example",
        "All API Keys.docx",
        "OpenMAIC-main.zip",
        ".tmp/",
        "output/",
        "coordination/",
        ".git/",
        ".vercel/",
        "node_modules/",
        ".next/",
        "tsconfig.tsbuildinfo",
      ].join("\n"),
    );
    mkdirSync(join(tmpDir, ".vercel"));
    mkdirSync(join(tmpDir, "node_modules", ".bin"), { recursive: true });
    const localVercelBin = join(tmpDir, "node_modules", ".bin", "vercel");
    writeFileSync(
      localVercelBin,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then printf '99.0.0-test\\n'; exit 0; fi",
        "if [ \"$1\" = \"whoami\" ]; then printf 'private-personal-account\\n'; exit 0; fi",
        "if [ \"$1\" = \"teams\" ] && [ \"$2\" = \"list\" ]; then printf 'not-json-from-cli\\n'; exit 0; fi",
        "if [ \"$1\" = \"project\" ] && [ \"$2\" = \"ls\" ]; then printf '{\"projects\":[{\"id\":\"prj_private\",\"name\":\"uais\"}],\"pagination\":{\"count\":1}}\\n'; exit 0; fi",
        "exit 1",
      ].join("\n"),
    );
    chmodSync(localVercelBin, 0o755);

    const output = execFileSync(process.execPath, [
      "scripts/vercel-project-readiness.mjs",
      "--project-dir",
      tmpDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
      },
    });
    const body = JSON.parse(output);

    expect(body.blockedReasons).toContain("vercel-team-scope-missing");
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-team-scope",
          status: "missing",
          evidence: "team-list-unparseable",
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-personal-account");
    expect(output).not.toContain("not-json-from-cli");
    expect(output).not.toContain("prj_private");
  });

  it("accepts array-shaped Vercel teams output from older CLI versions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-array-team-scope-"));
    writeFileSync(
      join(tmpDir, ".vercelignore"),
      [
        ".env",
        ".env.*",
        "!.env.local.example",
        "All API Keys.docx",
        "OpenMAIC-main.zip",
        ".tmp/",
        "output/",
        "coordination/",
        ".git/",
        ".vercel/",
        "node_modules/",
        ".next/",
        "tsconfig.tsbuildinfo",
      ].join("\n"),
    );
    mkdirSync(join(tmpDir, ".vercel"));
    mkdirSync(join(tmpDir, "node_modules", ".bin"), { recursive: true });
    const localVercelBin = join(tmpDir, "node_modules", ".bin", "vercel");
    writeFileSync(
      localVercelBin,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then printf '99.0.0-test\\n'; exit 0; fi",
        "if [ \"$1\" = \"whoami\" ]; then printf 'private-account-name\\n'; exit 0; fi",
        "if [ \"$1\" = \"teams\" ] && [ \"$2\" = \"list\" ]; then printf '[{\"id\":\"team_private\",\"slug\":\"private-team\",\"name\":\"Private Team\",\"current\":true}]\\n'; exit 0; fi",
        "if [ \"$1\" = \"project\" ] && [ \"$2\" = \"ls\" ]; then printf '{\"projects\":[{\"id\":\"prj_private\",\"name\":\"uais\"}],\"pagination\":{\"count\":1}}\\n'; exit 0; fi",
        "exit 1",
      ].join("\n"),
    );
    chmodSync(localVercelBin, 0o755);

    const output = execFileSync(process.execPath, [
      "scripts/vercel-project-readiness.mjs",
      "--project-dir",
      tmpDir,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
      },
    });
    const body = JSON.parse(output);

    expect(body.blockedReasons).toEqual(["vercel-project-not-linked"]);
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-team-scope",
          status: "present",
          evidence: "single-current-team-detected",
          teamCount: 1,
        }),
      ]),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-account-name");
    expect(output).not.toContain("private-team");
    expect(output).not.toContain("team_private");
    expect(output).not.toContain("prj_private");
  });

  it("accepts an approved redacted Vercel scope without leaking or parsing team names", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-approved-scope-"));
    writeFileSync(
      join(tmpDir, ".vercelignore"),
      [
        ".env",
        ".env.*",
        "!.env.local.example",
        "All API Keys.docx",
        "OpenMAIC-main.zip",
        ".tmp/",
        "output/",
        "coordination/",
        ".git/",
        ".vercel/",
        "node_modules/",
        ".next/",
        "tsconfig.tsbuildinfo",
      ].join("\n"),
    );
    mkdirSync(join(tmpDir, ".vercel"));
    mkdirSync(join(tmpDir, "node_modules", ".bin"), { recursive: true });
    const localVercelBin = join(tmpDir, "node_modules", ".bin", "vercel");
    writeFileSync(
      localVercelBin,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then printf '99.0.0-test\\n'; exit 0; fi",
        "if [ \"$1\" = \"whoami\" ]; then printf 'private-account-name\\n'; exit 0; fi",
        "if [ \"$1\" = \"teams\" ] && [ \"$2\" = \"list\" ]; then printf 'team output should not be required\\n'; exit 0; fi",
        "if [ \"$1\" = \"project\" ] && [ \"$2\" = \"ls\" ]; then printf '{\"projects\":[{\"id\":\"prj_private\",\"name\":\"uais\"}],\"pagination\":{\"count\":1}}\\n'; exit 0; fi",
        "exit 1",
      ].join("\n"),
    );
    chmodSync(localVercelBin, 0o755);

    const output = execFileSync(process.execPath, [
      "scripts/vercel-project-readiness.mjs",
      "--project-dir",
      tmpDir,
      "--scope",
      "secret-approved-scope",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
      },
    });
    const body = JSON.parse(output);

    expect(body.blockedReasons).toEqual(["vercel-project-not-linked"]);
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-team-scope",
          status: "present",
          evidence: "approved-redacted-scope-provided",
          scopeSelection: "scope-option",
        }),
        expect.objectContaining({
          id: "s22-vercel-project-candidate",
          status: "present",
        }),
      ]),
    );
    expect(body.safety).toEqual(
      expect.objectContaining({
        teamSlugsOmitted: true,
        accountNamesOmitted: true,
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("secret-approved-scope");
    expect(output).not.toContain("private-account-name");
    expect(output).not.toContain("team output should not be required");
    expect(output).not.toContain("prj_private");
  });

  it("emits a redacted exact Vercel project-link candidate from a project-local CLI", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-project-candidate-"));
    writeFileSync(
      join(tmpDir, ".vercelignore"),
      [
        ".env",
        ".env.*",
        "!.env.local.example",
        "All API Keys.docx",
        "OpenMAIC-main.zip",
        ".tmp/",
        "output/",
        "coordination/",
        ".git/",
        ".vercel/",
        "node_modules/",
        ".next/",
        "tsconfig.tsbuildinfo",
      ].join("\n"),
    );
    mkdirSync(join(tmpDir, ".vercel"));
    mkdirSync(join(tmpDir, "node_modules", ".bin"), { recursive: true });
    const localVercelBin = join(tmpDir, "node_modules", ".bin", "vercel");
    writeFileSync(
      localVercelBin,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then printf '99.0.0-test\\n'; exit 0; fi",
        "if [ \"$1\" = \"whoami\" ]; then printf 'private-account-name\\n'; exit 0; fi",
        "if [ \"$1\" = \"teams\" ] && [ \"$2\" = \"list\" ]; then printf '{\"teams\":[{\"id\":\"team_private\",\"slug\":\"private-team\",\"name\":\"Private Team\",\"current\":true}],\"pagination\":{\"count\":1}}\\n'; exit 0; fi",
        "if [ \"$1\" = \"project\" ] && [ \"$2\" = \"ls\" ]; then printf '{\"projects\":[{\"id\":\"prj_private\",\"name\":\"private-uais-project\",\"latestProductionUrl\":\"private-uais-project.example.vercel.app\"}],\"pagination\":{\"count\":1}}\\n'; exit 0; fi",
        "exit 1",
      ].join("\n"),
    );
    chmodSync(localVercelBin, 0o755);

    const output = execFileSync(process.execPath, [
      "scripts/vercel-project-readiness.mjs",
      "--project-dir",
      tmpDir,
      "--project-name",
      "private-uais-project",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
      },
    });
    const body = JSON.parse(output);

    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-vercel-project-candidate",
          status: "present",
          evidence: "single-exact-project-candidate-detected",
          filteredProjectCount: 1,
          exactProjectNameCount: 1,
        }),
      ]),
    );
    expect(body.safety).toEqual(
      expect.objectContaining({
        projectNamesOmitted: true,
        deploymentUrlsOmitted: true,
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("private-uais-project");
    expect(output).not.toContain("prj_private");
    expect(output).not.toContain("private-uais-project.example.vercel.app");
  });
});
