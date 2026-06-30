#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MIN_PRODUCTION_ACCESS_TOKEN_LENGTH = 32;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8787;
const PRODUCTION_PERSISTENT_VOLUME_PATH = "/data/uais-external-storage";
const DATABASE_ADAPTER_ENV_REQUIREMENTS = [
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
    expected: "managed-database",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
    expected: "up-to-date",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
    expected: "point-in-time-restore",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
    expected: "transactional",
  },
];
const SERVICE_SCRIPT_PATH = fileURLToPath(
  new URL("./external-storage-service.mjs", import.meta.url),
);

try {
  const options = parseArgs(process.argv.slice(2));
  const contract = buildLaunchContract({
    mode: options.dryRun ? "dry-run" : "live",
    env: process.env,
  });

  if (options.dryRun || contract.status === "blocked") {
    process.stdout.write(`${JSON.stringify(createPublicContract(contract), null, 2)}\n`);
    if (!options.dryRun && contract.status === "blocked") {
      process.exitCode = 1;
    }
  } else {
    launchService(contract);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "External storage production launcher failed."}\n`,
  );
  process.exitCode = 1;
}

function buildLaunchContract({ mode, env }) {
  const accessToken = readEnvValue(env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN);
  const dataDir = readEnvValue(env.UAIS_EXTERNAL_STORAGE_DATA_DIR);
  const host = readEnvValue(env.UAIS_EXTERNAL_STORAGE_HOST) || DEFAULT_HOST;
  const portValue = readEnvValue(env.PORT) || String(DEFAULT_PORT);
  const port = Number(portValue);
  const tokenStrength = readTokenStrength(accessToken);
  const dataDirStatus = hasValue(dataDir) ? "present" : "missing";
  const dataDirPersistence = readDataDirPersistence(dataDir);
  const portStatus = Number.isInteger(port) && port > 0 && port <= 65_535 ? "present" : "invalid";
  const databaseAdapterRequiredEnv = DATABASE_ADAPTER_ENV_REQUIREMENTS.map((requirement) =>
    readDatabaseAdapterEnvRequirement(env, requirement),
  );
  const blockedReasons = [
    ...(hasValue(accessToken) ? [] : ["missing-UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN"]),
    ...(tokenStrength === "insufficient" ? ["external-storage-access-token-weak"] : []),
    ...(dataDirStatus === "present" ? [] : ["missing-UAIS_EXTERNAL_STORAGE_DATA_DIR"]),
    ...(dataDirStatus === "present" && dataDirPersistence !== "persistent-volume"
      ? ["external-storage-data-dir-persistent-volume-not-proven"]
      : []),
    ...(portStatus === "present" ? [] : ["external-storage-port-invalid"]),
    ...databaseAdapterRequiredEnv.flatMap((entry) =>
      entry.status === "present"
        ? []
        : entry.status === "missing"
          ? [`missing-${entry.name}`]
          : [`external-storage-${entry.name.toLowerCase().replaceAll("_", "-")}-not-proven`],
    ),
  ];

  return {
    target: "external-storage-service-production-launcher",
    mode,
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    serviceMode: "production",
    command:
      "node scripts/external-storage-service.mjs --host <host> --port <port> --data-dir <data-dir> --service-mode production",
    runtime: {
      node: "required",
      longRunningProcess: true,
      healthEndpoint: "/healthz",
      serviceTarget: "uais-external-storage-production-service",
    },
    launch: {
      hostBinding: host,
      portSource: "PORT",
      dataDirSource: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
      persistentVolumeRequired: true,
      dataDirPersistence,
      valuesRedacted: true,
    },
    containerArtifact: {
      dockerfile: "Dockerfile.external-storage",
      dockerignore: ".dockerignore",
      persistentVolumePath: PRODUCTION_PERSISTENT_VOLUME_PATH,
      imageSecretsPolicy: "env-only-at-runtime",
      valueRedacted: true,
    },
    requiredEnv: [
      {
        name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
        status: hasValue(accessToken) ? "present" : "missing",
        strength: tokenStrength,
        valueRedacted: true,
      },
      {
        name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
        status: dataDirStatus,
        persistence: dataDirPersistence,
        valueRedacted: true,
      },
      ...databaseAdapterRequiredEnv,
    ],
    blockedReasons,
    safety: {
      accessTokenOmitted: true,
      dataDirOmitted: true,
      localPrivatePathsOmitted: true,
      startupOutputRedacted: true,
      productionServiceModeForced: true,
    },
    _runtime: {
      host,
      port,
      dataDir,
    },
  };
}

function readDatabaseAdapterEnvRequirement(env, requirement) {
  const value = readEnvValue(env[requirement.name]);
  return {
    name: requirement.name,
    status: !hasValue(value) ? "missing" : value === requirement.expected ? "present" : "invalid",
    expected: requirement.expected,
    valueRedacted: true,
  };
}

function launchService(contract) {
  const child = spawn(process.execPath, [
    SERVICE_SCRIPT_PATH,
    "--host",
    contract._runtime.host,
    "--port",
    String(contract._runtime.port),
    "--data-dir",
    contract._runtime.dataDir,
    "--service-mode",
    "production",
  ], {
    env: process.env,
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

function createPublicContract(contract) {
  const publicContract = { ...contract };
  delete publicContract._runtime;
  return publicContract;
}

function readTokenStrength(value) {
  if (!hasValue(value)) {
    return "missing";
  }
  return value.trim().length >= MIN_PRODUCTION_ACCESS_TOKEN_LENGTH
    ? "sufficient"
    : "insufficient";
}

function readDataDirPersistence(value) {
  if (!hasValue(value)) {
    return "missing";
  }
  const normalizedPath = resolve(value.trim());
  return normalizedPath === PRODUCTION_PERSISTENT_VOLUME_PATH ||
    normalizedPath.startsWith(`${PRODUCTION_PERSISTENT_VOLUME_PATH}${sep}`)
    ? "persistent-volume"
    : "not-proven";
}

function readEnvValue(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseArgs(args) {
  const options = {
    dryRun: false,
  };
  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--live") {
      options.dryRun = false;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/external-storage-service-production-launcher.mjs [--dry-run|--live]",
          "",
          "Launches the UAIS external storage service in production mode using env-only secrets.",
          "Required env: UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN, UAIS_EXTERNAL_STORAGE_DATA_DIR, UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS, UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS, UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY, UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL.",
          "Optional env: UAIS_EXTERNAL_STORAGE_HOST, PORT.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}
