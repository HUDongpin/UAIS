#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const DEFAULT_DOCKERFILE = "Dockerfile.external-storage";
const DEFAULT_DOCKERIGNORE = ".dockerignore";
// Client discovery may cold-start through endpoint-security scanning when a
// test or operator shim lives on an external volume. Keep that classification
// distinct from the tighter daemon-liveness bound so a slow client launch is
// not misreported as a missing installation.
const DOCKER_CLIENT_PROBE_TIMEOUT_MS = 6_000;
const DOCKER_DAEMON_PROBE_TIMEOUT_MS = 3_000;
const DOCKER_BUILD_TIMEOUT_MS = 300_000;

try {
  const options = parseArgs(process.argv.slice(2));
  const evidence = buildContainerReadiness(options);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "External storage container build readiness failed."}\n`,
  );
  process.exitCode = 1;
}

function buildContainerReadiness(options) {
  const dockerfile = readDockerfileStatus(options.dockerfile);
  const dockerignore = readDockerignoreStatus(options.dockerignore);
  const shouldProbeDocker = options.probeDocker || options.mode === "build";
  const docker = readDockerStatus(shouldProbeDocker);
  const image = {
    tagStatus: hasValue(options.imageTag) ? "present" : "missing",
    valueRedacted: true,
  };
  const preBuildBlockedReasons = [
    ...readDockerfileBlockedReasons(dockerfile),
    ...readDockerignoreBlockedReasons(dockerignore),
    ...(shouldProbeDocker && docker.client !== "present" ? ["docker-client-missing"] : []),
    ...(shouldProbeDocker && docker.daemon !== "available" && docker.client === "present"
      ? ["docker-daemon-unavailable"]
      : []),
  ];
  const build = readBuildStatus({
    options,
    preBuildBlockedReasons,
  });
  const blockedReasons = [
    ...preBuildBlockedReasons,
    ...readBuildBlockedReasons(build),
  ];

  return {
    target: "external-storage-container-build-readiness",
    mode: options.mode,
    ...(hasValue(options.releaseRunId) ? { releaseRunId: options.releaseRunId } : {}),
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    dockerfile,
    dockerignore,
    buildCommand: "docker build -f Dockerfile.external-storage -t <image-tag> .",
    image,
    docker,
    build,
    blockedReasons,
    safety: {
      imageTagOmitted: true,
      dockerOutputOmitted: true,
      localPrivatePathsOmitted: true,
      secretsExcludedFromContext: dockerignore.secretExclusion === "passed",
      buildNotRunInDryRun: options.mode === "dry-run",
      buildRunInApprovedMode: options.mode === "build" && options.approved === true,
      dockerProbeRun: shouldProbeDocker,
    },
  };
}

function readBuildStatus({ options, preBuildBlockedReasons }) {
  const base = {
    outputRedacted: true,
  };
  if (options.mode !== "build") {
    return {
      ...base,
      status: "not-run",
      invoked: false,
    };
  }
  if (options.approved !== true) {
    return {
      ...base,
      status: "not-run",
      invoked: false,
      blockedReason: "external-storage-container-build-approval-missing",
    };
  }
  if (!hasValue(options.imageTag)) {
    return {
      ...base,
      status: "not-run",
      invoked: false,
      blockedReason: "external-storage-container-image-tag-missing",
    };
  }
  if (preBuildBlockedReasons.length > 0) {
    return {
      ...base,
      status: "not-run",
      invoked: false,
    };
  }

  try {
    execFileSync("docker", [
      "build",
      "-f",
      options.dockerfile,
      "-t",
      options.imageTag,
      ".",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: DOCKER_BUILD_TIMEOUT_MS,
    });
    return {
      ...base,
      status: "passed",
      invoked: true,
    };
  } catch {
    return {
      ...base,
      status: "failed",
      invoked: true,
      blockedReason: "external-storage-container-build-failed",
    };
  }
}

function readDockerfileStatus(path) {
  if (!existsSync(path)) {
    return {
      path: publicPath(path, DEFAULT_DOCKERFILE),
      status: "missing",
      contract: "missing",
    };
  }
  const content = readFileSync(path, "utf8");
  const requiredSnippets = [
    "FROM node:24-alpine",
    "COPY scripts/external-storage-service.mjs scripts/external-storage-service-production-launcher.mjs ./scripts/",
    "ENV UAIS_EXTERNAL_STORAGE_DATA_DIR=/data/uais-external-storage",
    'VOLUME ["/data/uais-external-storage"]',
    'CMD ["node", "scripts/external-storage-service-production-launcher.mjs", "--live"]',
  ];
  const forbiddenSnippets = [
    "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=",
    ".env",
    "All API Keys",
  ];
  const contractPassed =
    requiredSnippets.every((snippet) => content.includes(snippet)) &&
    forbiddenSnippets.every((snippet) => !content.includes(snippet));
  return {
    path: publicPath(path, DEFAULT_DOCKERFILE),
    status: "present",
    contract: contractPassed ? "passed" : "failed",
  };
}

function readDockerignoreStatus(path) {
  if (!existsSync(path)) {
    return {
      path: publicPath(path, DEFAULT_DOCKERIGNORE),
      status: "missing",
      secretExclusion: "missing",
      generatedOutputExclusion: "missing",
    };
  }
  const content = readFileSync(path, "utf8");
  const secretPatterns = [".env*", "All API Keys.docx", "*.pem"];
  const generatedPatterns = [
    "node_modules",
    ".next",
    "coordination/reports",
    "coordination/session-logs",
    "output",
    "OpenMAIC-main.zip",
  ];
  return {
    path: publicPath(path, DEFAULT_DOCKERIGNORE),
    status: "present",
    secretExclusion: secretPatterns.every((pattern) => content.includes(pattern))
      ? "passed"
      : "failed",
    generatedOutputExclusion: generatedPatterns.every((pattern) => content.includes(pattern))
      ? "passed"
      : "failed",
  };
}

function readDockerStatus(shouldProbe) {
  if (!shouldProbe) {
    return {
      client: "not-checked",
      daemon: "not-checked",
      outputRedacted: true,
    };
  }

  try {
    execFileSync("docker", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: DOCKER_CLIENT_PROBE_TIMEOUT_MS,
    });
  } catch {
    return {
      client: "missing",
      daemon: "not-checked",
      outputRedacted: true,
    };
  }

  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: DOCKER_DAEMON_PROBE_TIMEOUT_MS,
    });
    return {
      client: "present",
      daemon: "available",
      outputRedacted: true,
    };
  } catch {
    return {
      client: "present",
      daemon: "unavailable",
      outputRedacted: true,
    };
  }
}

function readDockerfileBlockedReasons(dockerfile) {
  if (dockerfile.status === "missing") {
    return ["external-storage-dockerfile-missing"];
  }
  return dockerfile.contract === "passed" ? [] : ["external-storage-dockerfile-contract-failed"];
}

function readDockerignoreBlockedReasons(dockerignore) {
  if (dockerignore.status === "missing") {
    return ["external-storage-dockerignore-missing"];
  }
  const reasons = [];
  if (dockerignore.secretExclusion !== "passed") {
    reasons.push("external-storage-dockerignore-secret-exclusion-failed");
  }
  if (dockerignore.generatedOutputExclusion !== "passed") {
    reasons.push("external-storage-dockerignore-generated-output-exclusion-failed");
  }
  return reasons;
}

function readBuildBlockedReasons(build) {
  return hasValue(build.blockedReason) ? [build.blockedReason] : [];
}

function publicPath(path, defaultPath) {
  return path === defaultPath ? defaultPath : "redacted";
}

function parseArgs(args) {
  const options = {
    mode: "dry-run",
    dockerfile: DEFAULT_DOCKERFILE,
    dockerignore: DEFAULT_DOCKERIGNORE,
    imageTag: undefined,
    releaseRunId: undefined,
    approved: false,
    probeDocker: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.mode = "dry-run";
    } else if (arg === "--build") {
      options.mode = "build";
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--probe-docker") {
      options.probeDocker = true;
    } else if (arg === "--image-tag") {
      options.imageTag = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = normalizeReleaseRunId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--dockerfile") {
      options.dockerfile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--dockerignore") {
      options.dockerignore = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/external-storage-container-build-readiness.mjs --dry-run [--probe-docker] [--image-tag TAG] [--release-run-id ID]",
          "       node scripts/external-storage-container-build-readiness.mjs --build --approved --image-tag TAG [--release-run-id ID]",
          "",
          "Emits redacted readiness for the external storage container artifact. Offline dry-run checks only repository artifacts; --probe-docker explicitly checks the local client and daemon. Build mode requires explicit approval and omits Docker output.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!hasValue(value)) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizeReleaseRunId(value) {
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be 3-128 URL-safe-ish characters.");
  }
  return releaseRunId;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
