#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const requiredVercelIgnorePatterns = [
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

try {
  const options = parseArgs(process.argv.slice(2));
  const projectDir = resolve(options.projectDir ?? ".");
  const vercelCommand = resolveVercelCommand(projectDir);
  const checks = [
    checkVercelCli(vercelCommand),
    checkVercelAuth(vercelCommand),
    checkVercelTeamScope(vercelCommand, { scope: options.scope }),
    checkVercelProjectCandidate(vercelCommand, projectDir, {
      projectName: options.projectName,
      projectId: options.projectId,
    }),
    checkVercelProjectLink(projectDir),
    checkVercelIgnoreUploadHygiene(projectDir),
  ];
  const blockedReasons = checks.flatMap((check) =>
    check.status === "present" ? [] : [check.blockedReason],
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        target: "vercel-project-readiness",
        mode: "local",
        status: blockedReasons.length === 0 ? "ready" : "blocked",
        responsibleSession: "S22",
        checks,
        blockedReasons,
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
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Vercel project readiness check failed."}\n`,
  );
  process.exitCode = 1;
}

function parseArgs(args) {
const options = {
    projectDir: undefined,
    projectName: "uais",
    projectId: undefined,
    scope: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project-dir") {
      const projectDir = args[index + 1];
      if (!projectDir) {
        throw new Error("--project-dir requires a path.");
      }
      options.projectDir = projectDir;
      index += 1;
    } else if (arg === "--project-name") {
      const projectName = args[index + 1];
      if (!projectName) {
        throw new Error("--project-name requires a value.");
      }
      options.projectName = projectName;
      index += 1;
    } else if (arg === "--project-id") {
      const projectId = args[index + 1];
      if (!projectId) {
        throw new Error("--project-id requires a value.");
      }
      options.projectId = projectId;
      index += 1;
    } else if (arg === "--scope") {
      const scope = args[index + 1];
      if (!scope) {
        throw new Error("--scope requires a value.");
      }
      options.scope = scope;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/vercel-project-readiness.mjs [--project-dir PATH] [--project-name NAME] [--project-id ID] [--scope SCOPE]",
          "",
          "Outputs redacted local Vercel project-link and upload-hygiene readiness evidence.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function checkVercelCli(vercelCommand) {
  const result = spawnSync(vercelCommand.command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    id: "s22-vercel-cli",
    status: result.status === 0 ? "present" : "missing",
    evidence:
      result.status === 0 && vercelCommand.source === "project-local"
        ? "project-local-version-detected"
        : result.status === 0
        ? "global-version-detected"
        : "not-found",
    blockedReason: "vercel-cli-missing",
  };
}

function checkVercelAuth(vercelCommand) {
  const result = spawnSync(vercelCommand.command, ["whoami"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    id: "s22-vercel-auth",
    status: result.status === 0 ? "present" : "missing",
    evidence: result.status === 0 ? "authenticated-account-detected" : "not-authenticated",
    blockedReason: "vercel-auth-missing",
  };
}

function checkVercelTeamScope(vercelCommand, { scope }) {
  if (hasValue(scope)) {
    return {
      id: "s22-vercel-team-scope",
      status: "present",
      evidence: "approved-redacted-scope-provided",
      scopeSelection: "scope-option",
      blockedReason: "vercel-team-scope-missing",
    };
  }

  const result = spawnSync(vercelCommand.command, ["teams", "list", "--format", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return {
      id: "s22-vercel-team-scope",
      status: "missing",
      evidence: "team-list-unavailable",
      blockedReason: "vercel-team-scope-missing",
    };
  }

  const teamParse = parseTeams(result.stdout);
  if (!teamParse.ok) {
    if (result.stdout.trim() === "") {
      return {
        id: "s22-vercel-team-scope",
        status: "present",
        evidence: "personal-account-scope-empty-output",
        teamCount: 0,
        blockedReason: "vercel-team-scope-missing",
      };
    }
    return {
      id: "s22-vercel-team-scope",
      status: "missing",
      evidence: "team-list-unparseable",
      blockedReason: "vercel-team-scope-missing",
    };
  }

  const teams = teamParse.teams;
  if (teams.length === 0) {
    return {
      id: "s22-vercel-team-scope",
      status: "present",
      evidence: "personal-account-scope-detected",
      teamCount: 0,
      blockedReason: "vercel-team-scope-missing",
    };
  }
  const currentTeamCount = teams.filter((team) => team.current === true).length;
  if (currentTeamCount === 1) {
    return {
      id: "s22-vercel-team-scope",
      status: "present",
      evidence: "single-current-team-detected",
      teamCount: teams.length,
      blockedReason: "vercel-team-scope-missing",
    };
  }
  return {
    id: "s22-vercel-team-scope",
    status: "missing",
    evidence: teams.length > 1 ? "team-scope-selection-required" : "team-scope-missing",
    teamCount: teams.length,
    blockedReason: teams.length > 1 ? "vercel-team-scope-ambiguous" : "vercel-team-scope-missing",
  };
}

function checkVercelProjectCandidate(vercelCommand, projectDir, { projectName, projectId }) {
  if (isVercelProjectLinked(projectDir)) {
    return {
      id: "s22-vercel-project-candidate",
      status: "present",
      evidence: "link-marker-present",
      blockedReason: "vercel-project-candidate-missing",
    };
  }
  if (hasValue(projectId)) {
    return {
      id: "s22-vercel-project-candidate",
      status: "present",
      evidence: "approved-redacted-project-id-provided",
      candidateSelection: "project-id",
      blockedReason: "vercel-project-candidate-missing",
    };
  }

  const result = spawnSync(
    vercelCommand.command,
    ["project", "ls", "--filter", projectName, "--format", "json"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    return {
      id: "s22-vercel-project-candidate",
      status: "missing",
      evidence: "project-list-unavailable",
      blockedReason: "vercel-project-candidate-missing",
    };
  }

  const projects = parseProjects(result.stdout);
  const exactProjectNameCount = projects.filter((project) => project.name === projectName).length;
  if (exactProjectNameCount === 1) {
    return {
      id: "s22-vercel-project-candidate",
      status: "present",
      evidence: "single-exact-project-candidate-detected",
      filteredProjectCount: projects.length,
      exactProjectNameCount,
      blockedReason: "vercel-project-candidate-missing",
    };
  }
  return {
    id: "s22-vercel-project-candidate",
    status: "missing",
    evidence: exactProjectNameCount > 1 ? "exact-project-candidate-ambiguous" : "exact-project-candidate-missing",
    filteredProjectCount: projects.length,
    exactProjectNameCount,
    blockedReason:
      exactProjectNameCount > 1 ? "vercel-project-candidate-ambiguous" : "vercel-project-candidate-missing",
  };
}

function resolveVercelCommand(projectDir) {
  const projectLocalBin = join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "vercel.cmd" : "vercel");
  return existsSync(projectLocalBin)
    ? { command: projectLocalBin, source: "project-local" }
    : { command: "vercel", source: "global" };
}

function parseTeams(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const teamValues = Array.isArray(parsed?.teams) ? parsed.teams : Array.isArray(parsed) ? parsed : undefined;
    if (!teamValues) {
      return { ok: false, teams: [] };
    }
    return {
      ok: true,
      teams: teamValues.filter((team) => typeof team === "object" && team !== null),
    };
  } catch {
    return { ok: false, teams: [] };
  }
}

function parseProjects(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const projects = Array.isArray(parsed?.projects) ? parsed.projects : Array.isArray(parsed) ? parsed : [];
    return projects
      .filter((project) => typeof project === "object" && project !== null)
      .map((project) => ({
        name: typeof project.name === "string" ? project.name : undefined,
      }));
  } catch {
    return [];
  }
}

function checkVercelProjectLink(projectDir) {
  const linked = isVercelProjectLinked(projectDir);

  return {
    id: "s22-vercel-project-link",
    status: linked ? "present" : "missing",
    evidence: linked ? "link-marker-present" : "link-marker-missing",
    blockedReason: "vercel-project-not-linked",
  };
}

function isVercelProjectLinked(projectDir) {
  return hasValue(process.env.VERCEL_PROJECT_ID) && hasValue(process.env.VERCEL_ORG_ID)
    ? true
    : existsSync(join(projectDir, ".vercel", "project.json")) ||
        existsSync(join(projectDir, ".vercel", "repo.json"));
}

function checkVercelIgnoreUploadHygiene(projectDir) {
  const ignorePath = join(projectDir, ".vercelignore");
  if (!existsSync(ignorePath)) {
    return {
      id: "s22-vercelignore-upload-hygiene",
      status: "missing",
      evidence: "file-missing",
      missingPatterns: requiredVercelIgnorePatterns,
      blockedReason: "vercelignore-upload-hygiene-incomplete",
    };
  }

  const ignoreFile = readFileSync(ignorePath, "utf8");
  const missingPatterns = requiredVercelIgnorePatterns.filter(
    (pattern) => !ignoreFile.includes(pattern),
  );

  return {
    id: "s22-vercelignore-upload-hygiene",
    status: missingPatterns.length === 0 ? "present" : "missing",
    evidence: missingPatterns.length === 0 ? "required-patterns-present" : "required-patterns-missing",
    missingPatterns,
    blockedReason: "vercelignore-upload-hygiene-incomplete",
  };
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}
