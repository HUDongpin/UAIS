#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const defaultDeploymentScope = "full";

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Vercel production deployment evidence requires explicit owner approval.");
  }
  if (
    options.live &&
    (options.deploy || options.environment === "production") &&
    !hasValue(options.releaseRunId)
  ) {
    throw new Error("Vercel production deployment evidence requires --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const action = options.deploy ? "deploy" : "inspect";
  const inspectMode = action === "inspect" ? options.inspectMode : "cli";
  const deploymentUrl = options.deploymentUrl || env.UAIS_DEPLOYMENT_BASE_URL;
  const vercelProjectReadiness = readJsonEvidence(options.vercelProjectReadiness);
  const vercelEnvSync = readJsonEvidence(options.vercelEnvSync);
  const publicEdgeObservation = readJsonEvidence(options.publicEdgeObservation);
  const plan = buildPlan({
    mode,
    action,
    inspectMode,
    environment: options.environment,
    deploymentUrl,
    deploymentScope: options.deploymentScope,
    env,
    projectDir: options.projectDir,
    vercelProjectReadiness,
    vercelEnvSync,
    releaseRunId: options.releaseRunId,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(1);
  }

  const result =
    action === "deploy"
      ? runVercelDeploy({ env, projectDir: options.projectDir, scope: options.scope })
      : inspectMode === "public-http"
      ? await runPublicHttpInspect({
          deploymentUrl,
          publicEdgeObservation,
        })
      : runVercelInspect({
          env,
          projectDir: options.projectDir,
          scope: options.scope,
          deploymentUrl,
        });
  const evidence = finishLiveEvidence({ plan, result, fallbackDeploymentUrl: deploymentUrl });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.status !== "deployed") {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Vercel production deployment evidence failed."}\n`,
  );
  process.exitCode = 1;
}

function buildPlan({
  mode,
  action,
  inspectMode,
  environment,
  deploymentUrl,
  deploymentScope,
  env,
  projectDir,
  vercelProjectReadiness,
  vercelEnvSync,
  releaseRunId,
}) {
  const requiresDeploymentGuards = action === "deploy" || environment === "production";
  const deploymentOrigin = describeDeploymentOrigin(deploymentUrl);
  const originBlockedReasons = readProductionDeploymentOriginBlockedReasons({
    action,
    environment,
    deploymentOrigin,
  });
  const evaluatedVercelProjectReadinessStatus =
    readVercelProjectReadinessStatus(vercelProjectReadiness);
  const vercelProjectReadinessStatus =
    mode === "dry-run" &&
    requiresDeploymentGuards &&
    evaluatedVercelProjectReadinessStatus === "missing"
      ? "required-for-live"
      : evaluatedVercelProjectReadinessStatus;
  const evaluatedVercelEnvSyncStatus = readVercelEnvSyncStatus(
    vercelEnvSync,
    releaseRunId,
    deploymentScope,
  );
  const vercelEnvSyncStatus =
    mode === "dry-run" &&
    requiresDeploymentGuards &&
    evaluatedVercelEnvSyncStatus === "missing"
      ? "required-for-live"
      : evaluatedVercelEnvSyncStatus;
  const envSyncApplyPreflightGuard = buildEnvSyncApplyPreflightGuard(
    vercelEnvSync,
    vercelEnvSyncStatus,
  );
  const usesPublicHttpInspect = action === "inspect" && inspectMode === "public-http";
  const shouldCheckAuth = mode === "live" && originBlockedReasons.length === 0 && !usesPublicHttpInspect;
  const vercelAuth = describeVercelAuth({ env, mode, projectDir, shouldCheckAuth });
  const operationCommand = action === "deploy"
    ? "vercel-deploy-production"
    : usesPublicHttpInspect
    ? "vercel-public-http-inspect"
    : "vercel-inspect-production";
  const prerequisites = [
    ...(usesPublicHttpInspect
      ? []
      : [
          {
            id: "s22-vercel-auth",
            responsibleSession: "S22",
            authMethods: ["VERCEL_TOKEN", "vercel-cli-login"],
            status: vercelAuth.status,
            authMethod: vercelAuth.authMethod,
            valueRedacted: true,
          },
        ]),
    ...(requiresDeploymentGuards
      ? [
          {
            id: "s22-vercel-project-readiness",
            responsibleSession: "S22",
            requiredEvidence: "vercel-project-readiness",
            status: vercelProjectReadinessStatus,
            valueRedacted: true,
          },
          {
            id: "s19-vercel-env-sync-apply-evidence",
            responsibleSession: "S19",
            requiredEvidence: "vercel-env-sync",
            status: vercelEnvSyncStatus,
            valueRedacted: true,
          },
        ]
      : []),
    ...(action === "inspect"
      ? [
          {
            id: "s22-production-deployment-url",
            responsibleSession: "S22",
            requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
            status: hasValue(deploymentUrl) ? "present" : "missing",
            valueRedacted: true,
          },
        ]
      : []),
  ];
  const missingReasons =
    mode === "live" && originBlockedReasons.length === 0
      ? prerequisites.flatMap((prerequisite) =>
          readPrerequisiteBlockedReasons(prerequisite),
        )
      : [];
  const blockedReasons = [
    ...missingReasons,
    ...originBlockedReasons,
    ...(mode === "dry-run" ? ["vercel-production-deployment-live-not-run"] : []),
  ];

  return {
    target: "vercel-production-deployment",
    mode,
    action,
    ...(usesPublicHttpInspect ? { inspectMode } : {}),
    environment,
    network: mode === "live" ? "enabled" : "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S22",
    ...(deploymentScope !== defaultDeploymentScope ? { deploymentScope } : {}),
    ...(releaseRunId ? { releaseRunId } : {}),
    deploymentFingerprint: createDeploymentFingerprint(deploymentUrl),
    deploymentObservation: createDeploymentObservation(mode === "live" ? "pending" : "not-run"),
    deploymentOrigin,
    ...(requiresDeploymentGuards ? { envSyncApplyPreflightGuard } : {}),
    operation: {
      command: operationCommand,
      status: mode === "dry-run"
        ? "not-run"
        : blockedReasons.length > 0
        ? "blocked-before-invocation"
        : "pending",
      stdoutOmitted: true,
      stderrOmitted: true,
    },
    prerequisites,
    blockedReasons,
    safety: buildSafety(),
  };
}

function finishLiveEvidence({ plan, result, fallbackDeploymentUrl }) {
  if (result.status !== "passed") {
    return {
      ...plan,
      status: "failed",
      deploymentObservation: createDeploymentObservation("not-observed", result.observationSource),
      operation: {
        ...plan.operation,
        status: "failed",
      },
      ...(result.publicEdgeObservation ? { publicEdgeObservation: result.publicEdgeObservation } : {}),
      blockedReasons: ["vercel-production-deployment-command-failed"],
    };
  }

  const deploymentUrl = result.deploymentUrl || fallbackDeploymentUrl;
  const deploymentOrigin = describeDeploymentOrigin(deploymentUrl);
  const deploymentFingerprint = createDeploymentFingerprint(deploymentUrl);
  const deploymentObservation = createDeploymentObservation("observed", result.observationSource);
  if (
    plan.environment === "production" &&
    (deploymentOrigin.status !== "present" || deploymentOrigin.originClass !== "remote-https")
  ) {
    return {
      ...plan,
      status: "failed",
      deploymentOrigin,
      deploymentFingerprint,
      deploymentObservation,
      operation: {
        ...plan.operation,
        status: "failed",
      },
      blockedReasons: ["vercel-production-deployment-origin-not-remote-https"],
    };
  }
  if (deploymentFingerprint.status !== "present") {
    return {
      ...plan,
      status: "failed",
      deploymentOrigin,
      deploymentFingerprint,
      deploymentObservation: createDeploymentObservation("not-observed"),
      operation: {
        ...plan.operation,
        status: "failed",
      },
      blockedReasons: ["vercel-production-deployment-fingerprint-missing"],
    };
  }

  return {
    ...plan,
    status: "deployed",
    deploymentOrigin,
    deploymentFingerprint,
    deploymentObservation,
    ...(result.publicEdgeObservation ? { publicEdgeObservation: result.publicEdgeObservation } : {}),
    operation: {
      ...plan.operation,
      status: "passed",
    },
    blockedReasons: [],
  };
}

function runVercelDeploy({ env, projectDir, scope }) {
  const vercelCommand = resolveVercelCommand(resolve(projectDir ?? "."));
  const args = ["deploy", "--prod", "--yes"];
  if (hasValue(scope)) {
    args.push("--scope", scope);
  }
  const result = spawnSync(vercelCommand, args, {
    cwd: resolve(projectDir ?? "."),
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status === 0 ? "passed" : "failed",
    deploymentUrl: extractDeploymentUrl(`${result.stdout ?? ""}\n${result.stderr ?? ""}`),
  };
}

function runVercelInspect({ env, projectDir, scope, deploymentUrl }) {
  const vercelCommand = resolveVercelCommand(resolve(projectDir ?? "."));
  const args = ["inspect", deploymentUrl];
  if (hasValue(scope)) {
    args.push("--scope", scope);
  }
  const result = spawnSync(vercelCommand, args, {
    cwd: resolve(projectDir ?? "."),
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status === 0 ? "passed" : "failed",
    deploymentUrl,
  };
}

async function runPublicHttpInspect({ deploymentUrl, publicEdgeObservation }) {
  if (publicEdgeObservation.status === "present") {
    return buildPublicHttpInspectResultFromEvidence({
      deploymentUrl,
      publicEdgeObservation: publicEdgeObservation.body,
    });
  }
  if (publicEdgeObservation.status === "invalid") {
    return {
      status: "failed",
      deploymentUrl,
      observationSource: "public-vercel-edge",
      publicEdgeObservation: {
        status: "invalid",
        edgeProvider: "unproved",
        responseBodyOmitted: true,
        headerValuesOmitted: true,
        deploymentUrlOmitted: true,
        valuesRedacted: true,
      },
    };
  }
  if (typeof fetch !== "function") {
    return {
      status: "failed",
      deploymentUrl,
      observationSource: "public-vercel-edge",
      publicEdgeObservation: {
        status: "not-observed",
        edgeProvider: "unproved",
        responseBodyOmitted: true,
        headerValuesOmitted: true,
        deploymentUrlOmitted: true,
        valuesRedacted: true,
      },
    };
  }

  try {
    const response = await fetch(deploymentUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    const serverHeader = response.headers.get("server") ?? "";
    const xVercelId = response.headers.get("x-vercel-id") ?? "";
    const edgeProviderObserved =
      serverHeader.toLowerCase().includes("vercel") || hasValue(xVercelId);
    const httpStatusObserved = response.status >= 200 && response.status < 400;
    const observed = edgeProviderObserved && httpStatusObserved;
    return {
      status: observed ? "passed" : "failed",
      deploymentUrl,
      observationSource: "public-vercel-edge",
      publicEdgeObservation: {
        status: observed ? "observed" : "not-observed",
        httpStatus: response.status,
        edgeProvider: edgeProviderObserved ? "vercel" : "unproved",
        headerChecks: {
          serverVercel: serverHeader.toLowerCase().includes("vercel") ? "present" : "missing",
          xVercelId: hasValue(xVercelId) ? "present" : "missing",
          location: response.headers.has("location") ? "present" : "missing",
        },
        responseBodyOmitted: true,
        headerValuesOmitted: true,
        deploymentUrlOmitted: true,
        valuesRedacted: true,
      },
    };
  } catch {
    return {
      status: "failed",
      deploymentUrl,
      observationSource: "public-vercel-edge",
      publicEdgeObservation: {
        status: "not-observed",
        edgeProvider: "unproved",
        responseBodyOmitted: true,
        headerValuesOmitted: true,
        deploymentUrlOmitted: true,
        valuesRedacted: true,
      },
    };
  }
}

function buildPublicHttpInspectResultFromEvidence({ deploymentUrl, publicEdgeObservation }) {
  const sanitizedObservation = sanitizePublicEdgeObservation(publicEdgeObservation);
  return {
    status: isObservedPublicEdgeObservation(publicEdgeObservation, deploymentUrl)
      ? "passed"
      : "failed",
    deploymentUrl,
    observationSource: "public-vercel-edge",
    publicEdgeObservation: sanitizedObservation,
  };
}

function isObservedPublicEdgeObservation(observation, deploymentUrl) {
  const expectedFingerprint = createDeploymentFingerprint(deploymentUrl);
  const fingerprint = observation?.deploymentFingerprint;
  const origin = observation?.deploymentOrigin;
  const headerChecks = observation?.headerChecks;
  const vercelHeaderObserved =
    headerChecks?.serverVercel === "present" || headerChecks?.xVercelId === "present";
  return (
    observation?.target === "vercel-public-edge-observation" &&
    observation?.status === "observed" &&
    observation?.mode === "live" &&
    observation?.environment === "production" &&
    Number.isInteger(observation?.httpStatus) &&
    observation.httpStatus >= 200 &&
    observation.httpStatus < 400 &&
    observation?.edgeProvider === "vercel" &&
    vercelHeaderObserved &&
    origin?.status === "present" &&
    origin?.originClass === "remote-https" &&
    origin?.valueRedacted === true &&
    fingerprint?.status === "present" &&
    fingerprint?.value === expectedFingerprint.value &&
    observation?.responseBodyOmitted === true &&
    observation?.headerValuesOmitted === true &&
    observation?.deploymentUrlOmitted === true &&
    observation?.valuesRedacted === true
  );
}

function sanitizePublicEdgeObservation(observation) {
  const headerChecks = observation?.headerChecks;
  return {
    status: observation?.status === "observed" ? "observed" : "not-observed",
    ...(Number.isInteger(observation?.httpStatus) ? { httpStatus: observation.httpStatus } : {}),
    edgeProvider: observation?.edgeProvider === "vercel" ? "vercel" : "unproved",
    ...(headerChecks && typeof headerChecks === "object"
      ? {
          headerChecks: {
            serverVercel: headerChecks.serverVercel === "present" ? "present" : "missing",
            xVercelId: headerChecks.xVercelId === "present" ? "present" : "missing",
            ...(headerChecks.location === "present" || headerChecks.location === "missing"
              ? { location: headerChecks.location }
              : {}),
          },
        }
      : {}),
    responseBodyOmitted: observation?.responseBodyOmitted === true,
    headerValuesOmitted: observation?.headerValuesOmitted === true,
    deploymentUrlOmitted: observation?.deploymentUrlOmitted === true,
    valuesRedacted: observation?.valuesRedacted === true,
  };
}

function describeVercelAuth({ env, mode, projectDir, shouldCheckAuth }) {
  if (hasValue(env.VERCEL_TOKEN)) {
    return {
      status: "present",
      authMethod: "VERCEL_TOKEN",
    };
  }
  if (mode !== "live" || !shouldCheckAuth) {
    return {
      status: "missing",
      authMethod: "not-checked",
    };
  }
  if (hasLocalVercelCliAuth(env)) {
    return {
      status: "present",
      authMethod: "vercel-cli-login",
    };
  }

  const projectRoot = resolve(projectDir ?? ".");
  const vercelCommand = resolveVercelCommand(projectRoot);
  const result = spawnSync(vercelCommand, ["whoami"], {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0
    ? {
        status: "present",
        authMethod: "vercel-cli-login",
      }
    : {
        status: "missing",
        authMethod: "missing",
      };
}

function hasLocalVercelCliAuth(env) {
  return readVercelAuthFileCandidates(env).some((authFile) => {
    if (!existsSync(authFile)) {
      return false;
    }
    try {
      const parsed = JSON.parse(readFileSync(authFile, "utf8"));
      return hasValue(parsed?.token);
    } catch {
      return false;
    }
  });
}

function readVercelAuthFileCandidates(env) {
  const home = hasValue(env.HOME) ? env.HOME.trim() : homedir();
  return [
    join(home, ".vercel", "auth.json"),
    join(home, ".config", "vercel", "auth.json"),
    join(home, "Library", "Application Support", "com.vercel.cli", "auth.json"),
  ];
}

function extractDeploymentUrl(output) {
  const match = output.match(/https:\/\/[^\s"'<>]+/i);
  return match?.[0];
}

function readProductionDeploymentOriginBlockedReasons({ action, environment, deploymentOrigin }) {
  if (action === "deploy") {
    return [];
  }
  if (
    environment !== "production" ||
    deploymentOrigin.status !== "present" ||
    deploymentOrigin.originClass === "remote-https"
  ) {
    return [];
  }
  return ["production-deployment-origin-not-remote-https"];
}

function buildEnvSyncApplyPreflightGuard(evidence, vercelEnvSyncStatus) {
  const preflight = evidence.status === "present" ? evidence.body?.applyPreflight : undefined;
  const proved = evidence.status === "present" && hasPassedApplyPreflight(evidence.body);
  return {
    status: vercelEnvSyncStatus === "required-for-live"
      ? "required-for-live"
      : proved
      ? "proved"
      : "missing",
    requiredEvidence: "vercel-env-sync.applyPreflight",
    valuesRedacted: true,
    cliSafeToInvoke: preflight?.cliSafeToInvoke === true && proved,
  };
}

function buildSafety() {
  return {
    valuesRedacted: true,
    deploymentUrlOmitted: true,
    deploymentUrlsOmitted: true,
    projectIdsOmitted: true,
    orgIdsOmitted: true,
    accountNamesOmitted: true,
    teamIdsOmitted: true,
    teamSlugsOmitted: true,
    tokenOmitted: true,
    tokenFlagForbidden: true,
    projectReadinessEvidencePathOmitted: true,
    envSyncEvidencePathOmitted: true,
    localPrivatePathsOmitted: true,
    cliOutputOmitted: true,
    liveRequiresApproval: true,
  };
}

function resolveVercelCommand(projectDir) {
  const localBin = join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "vercel.cmd" : "vercel");
  return existsSync(localBin) ? localBin : "vercel";
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    deploy: false,
    environment: "unspecified",
    envFile: undefined,
    deploymentUrl: undefined,
    projectDir: ".",
    scope: undefined,
    deploymentScope: defaultDeploymentScope,
    vercelProjectReadiness: undefined,
    vercelEnvSync: undefined,
    releaseRunId: undefined,
    inspectMode: "cli",
    publicEdgeObservation: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--deploy") {
      options.deploy = true;
    } else if (arg === "--environment") {
      options.environment = normalizeEnvironment(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--deployment-url") {
      options.deploymentUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--project-dir") {
      options.projectDir = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--scope") {
      options.scope = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--deployment-scope") {
      options.deploymentScope = normalizeDeploymentScope(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--vercel-project-readiness") {
      options.vercelProjectReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-env-sync") {
      options.vercelEnvSync = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = normalizeReleaseRunId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--inspect-mode") {
      options.inspectMode = normalizeInspectMode(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--public-edge-observation") {
      options.publicEdgeObservation = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/vercel-production-deployment-evidence.mjs [--dry-run|--live --approved] [--deploy|--deployment-url URL] [--environment production|preview|local-production|unspecified] [--env-file PATH] [--project-dir PATH] [--scope TEAM] [--deployment-scope full|teacher-auth] [--inspect-mode cli|public-http] [--public-edge-observation PATH] [--vercel-project-readiness PATH] [--vercel-env-sync PATH] [--release-run-id ID]",
          "",
          "Outputs redacted Vercel production deployment evidence. Auth uses VERCEL_TOKEN or an existing Vercel CLI login; --token flags are never accepted or printed.",
        ].join("\n"),
      );
      process.exit(0);
    } else if (arg === "--token") {
      throw new Error("Use VERCEL_TOKEN in the environment; --token is forbidden.");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readPrerequisiteBlockedReasons(prerequisite) {
  if (prerequisite.id === "s22-vercel-auth" && prerequisite.status !== "present") {
    return ["vercel-auth-missing"];
  }
  if (prerequisite.requiredEnv && prerequisite.status !== "present") {
    return [`missing-${prerequisite.requiredEnv}`];
  }
  if (
    prerequisite.id === "s22-vercel-project-readiness" &&
    prerequisite.status !== "ready"
  ) {
    return ["vercel-project-readiness-not-ready"];
  }
  if (
    prerequisite.id === "s19-vercel-env-sync-apply-evidence" &&
    prerequisite.status !== "applied"
  ) {
    if (prerequisite.status === "release-run-missing") {
      return ["vercel-env-sync-release-run-id-missing"];
    }
    if (prerequisite.status === "release-run-mismatch") {
      return ["vercel-env-sync-release-run-id-mismatch"];
    }
    if (prerequisite.status === "deployment-scope-mismatch") {
      return ["vercel-env-sync-deployment-scope-mismatch"];
    }
    if (prerequisite.status === "external-storage-fingerprint-missing") {
      return ["vercel-env-sync-external-storage-fingerprint-not-proven"];
    }
    if (prerequisite.status === "apply-summary-missing") {
      return ["vercel-env-sync-apply-summary-not-proven"];
    }
    if (prerequisite.status === "apply-preflight-missing") {
      return ["vercel-env-sync-apply-preflight-not-proven"];
    }
    return ["vercel-env-sync-not-applied"];
  }
  return [];
}

function readJsonEvidence(path) {
  if (!path) {
    return { status: "missing" };
  }
  try {
    return {
      status: "present",
      body: JSON.parse(readFileSync(path, "utf8")),
    };
  } catch {
    return { status: "invalid" };
  }
}

function readVercelProjectReadinessStatus(evidence) {
  if (evidence.status !== "present") {
    return evidence.status;
  }
  const requiredChecks = [
    "s22-vercel-cli",
    "s22-vercel-auth",
    "s22-vercel-team-scope",
    "s22-vercel-project-candidate",
    "s22-vercel-project-link",
    "s22-vercelignore-upload-hygiene",
  ];
  const checks = Array.isArray(evidence.body?.checks) ? evidence.body.checks : [];
  const presentChecks = new Set(
    checks
      .filter((check) => typeof check === "object" && check !== null && check.status === "present")
      .map((check) => check.id)
      .filter((id) => typeof id === "string"),
  );
  const allChecksPresent = requiredChecks.every((checkId) => presentChecks.has(checkId));
  return evidence.body?.target === "vercel-project-readiness" &&
    evidence.body?.status === "ready" &&
    allChecksPresent
    ? "ready"
    : "blocked";
}

function readVercelEnvSyncStatus(evidence, releaseRunId, deploymentScope = defaultDeploymentScope) {
  if (evidence.status !== "present") {
    return evidence.status;
  }
  const targets = Array.isArray(evidence.body?.targets) ? evidence.body.targets : [];
  const targetCoverage =
    targets.includes("production") && targets.includes("preview") ? "present" : "missing";
  const applied =
    evidence.body?.target === "vercel-env-sync" &&
    evidence.body?.mode === "apply" &&
    evidence.body?.projectReadinessEvidenceStatus === "ready" &&
    targetCoverage === "present";
  if (!applied) {
    return "blocked";
  }
  const evidenceDeploymentScope =
    typeof evidence.body?.deploymentScope === "string"
      ? evidence.body.deploymentScope
      : defaultDeploymentScope;
  if (deploymentScope !== evidenceDeploymentScope) {
    return "deployment-scope-mismatch";
  }
  if (releaseRunId) {
    const envReleaseRunId =
      typeof evidence.body?.releaseRunId === "string"
        ? evidence.body.releaseRunId.trim()
        : "";
    if (!envReleaseRunId) {
      return "release-run-missing";
    }
    if (envReleaseRunId !== releaseRunId) {
      return "release-run-mismatch";
    }
  }
  if (
    deploymentScope !== "teacher-auth" &&
    !hasRedactedExternalStorageServiceFingerprint(evidence.body)
  ) {
    return "external-storage-fingerprint-missing";
  }
  if (!hasRedactedApplySummary(evidence.body)) {
    return "apply-summary-missing";
  }
  if (!hasPassedApplyPreflight(evidence.body)) {
    return "apply-preflight-missing";
  }
  return "applied";
}

function hasRedactedExternalStorageServiceFingerprint(evidence) {
  const fingerprint = evidence?.externalStorageServiceFingerprint;
  return (
    typeof fingerprint === "object" &&
    fingerprint !== null &&
    fingerprint.status === "present" &&
    typeof fingerprint.value === "string" &&
    /^sha256:[a-f0-9]{16}$/.test(fingerprint.value) &&
    fingerprint.source === "origin" &&
    fingerprint.valueRedacted === true
  );
}

function hasRedactedApplySummary(evidence) {
  const summary = evidence?.applySummary;
  const appliedByTarget = summary?.appliedByTarget;
  return (
    typeof summary === "object" &&
    summary !== null &&
    summary.status === "applied" &&
    Number.isInteger(summary.appliedActions) &&
    summary.appliedActions > 0 &&
    typeof appliedByTarget === "object" &&
    appliedByTarget !== null &&
    Number.isInteger(appliedByTarget.production) &&
    appliedByTarget.production > 0 &&
    Number.isInteger(appliedByTarget.preview) &&
    appliedByTarget.preview > 0 &&
    Number.isInteger(summary.localOnlyEntriesSkipped) &&
    summary.localOnlyEntriesSkipped >= 0 &&
    summary.valuesRedacted === true &&
    (summary.cliOutputOmitted === true || summary.apiOutputOmitted === true)
  );
}

function hasPassedApplyPreflight(evidence) {
  const preflight = evidence?.applyPreflight;
  return (
    typeof preflight === "object" &&
    preflight !== null &&
    preflight.status === "passed" &&
    Array.isArray(preflight.blockedReasons) &&
    preflight.blockedReasons.length === 0 &&
    preflight.valuesRedacted === true &&
    preflight.cliSafeToInvoke === true
  );
}

function normalizeEnvironment(value) {
  const environment = value.trim().toLowerCase();
  if (
    environment !== "production" &&
    environment !== "preview" &&
    environment !== "local-production" &&
    environment !== "unspecified"
  ) {
    throw new Error("--environment must be production, preview, local-production, or unspecified.");
  }
  return environment;
}

function normalizeDeploymentScope(value) {
  const deploymentScope = value.trim();
  if (deploymentScope === "full" || deploymentScope === "teacher-auth") {
    return deploymentScope;
  }
  throw new Error("--deployment-scope must be full or teacher-auth.");
}

function normalizeInspectMode(value) {
  const inspectMode = value.trim();
  if (inspectMode === "cli" || inspectMode === "public-http") {
    return inspectMode;
  }
  throw new Error("--inspect-mode must be cli or public-http.");
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizeReleaseRunId(value) {
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be a non-secret release identifier.");
  }
  return releaseRunId;
}

function readEnvFile(envFile) {
  if (!envFile) {
    return {};
  }

  const parsed = {};
  const content = readFileSync(envFile, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      parsed[key] = stripQuotes(value);
    }
  }

  return parsed;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function describeDeploymentOrigin(deploymentUrl) {
  const originClass = classifyDeploymentOrigin(deploymentUrl);
  return {
    status: originClass === "missing" ? "missing" : "present",
    originClass,
    valueRedacted: true,
  };
}

function classifyDeploymentOrigin(deploymentUrl) {
  if (!hasValue(deploymentUrl)) {
    return "missing";
  }

  try {
    const origin = new URL(deploymentUrl);
    const hostClass = classifyOriginHost(origin.hostname);
    if (hostClass !== "remote") {
      return hostClass;
    }
    return origin.protocol === "https:" ? "remote-https" : "insecure-http";
  } catch {
    return "invalid";
  }
}

function classifyOriginHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") {
    return "local-loopback";
  }
  const octets = host.split(".").map((part) => Number(part));
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    if (octets[0] === 127) {
      return "local-loopback";
    }
    if (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    ) {
      return "private-network";
    }
  }
  return "remote";
}

function createDeploymentFingerprint(deploymentUrl) {
  if (!hasValue(deploymentUrl)) {
    return { status: "missing" };
  }

  try {
    const origin = new URL(deploymentUrl).origin.toLowerCase();
    return {
      status: "present",
      value: `sha256:${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`,
    };
  } catch {
    return { status: "missing" };
  }
}

function createDeploymentObservation(status, source = "harness-clock") {
  if (status === "observed") {
    return {
      status: "observed",
      observedAt: new Date().toISOString(),
      source,
    };
  }
  return { status };
}
