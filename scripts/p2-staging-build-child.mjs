import { spawnSync } from "node:child_process";
import {
  readStagingRedactionValues,
  redactStagingChildOutput,
} from "./vercel-staging-build-guard.mjs";

const migrationPassthroughEnvNames = [
  "PATH",
  "NODE_PATH",
  "NODE_OPTIONS",
  "NODE_ENV",
  "TZ",
  "CI",
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "TMPDIR",
  "TMP",
  "TEMP",
  "VERCEL_ENV",
  "VERCEL_PROJECT_ID",
  "UAIS_DEPLOYMENT_ENV",
  "UAIS_LEARNING_CHATROOM_GROUPS_MODE",
];

export function createP2StagingMigrationChildEnv({
  baseEnv,
  databaseUrl,
  requiredGuard,
}) {
  return {
    ...selectEnvironment(baseEnv, migrationPassthroughEnvNames),
    UAIS_CORE_DATABASE_URL: databaseUrl,
    UAIS_CORE_DATABASE_REQUIRED_GUARD: requiredGuard,
  };
}

export function createP2StagingRuntimeChildEnv(baseEnv) {
  const isolatedEnv = { ...baseEnv };
  for (const name of Object.keys(isolatedEnv)) {
    if (
      name === "UAIS_CORE_DATABASE_URL" ||
      name === "UAIS_CORE_DATABASE_REQUIRED_GUARD" ||
      name === "DATABASE_URL" ||
      name === "POSTGRES_URL" ||
      name === "RESTORE_DATABASE_URL" ||
      name === "RESTORE_POSTGRES_URL" ||
      name === "UAIS_P2_STAGING_RESTORE_DATABASE_URL" ||
      name === "RESTORE_NEON_PROJECT_ID" ||
      name.startsWith("UAIS_DB_TEST_") ||
      name.startsWith("UAIS_P1_LOAD_TEST_") ||
      name.startsWith("UAIS_LIVE_DB_TEST_")
    ) {
      delete isolatedEnv[name];
    }
  }
  return isolatedEnv;
}

export function runRedactedP2StagingChild({
  args,
  env,
  cwd = process.cwd(),
  command = process.execPath,
  spawn = spawnSync,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  const result = spawn(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const redactValues = readStagingRedactionValues(env);
  writeRedacted(stdout, result.stdout, redactValues);
  writeRedacted(stderr, result.stderr, redactValues);
  return result;
}

function selectEnvironment(env, allowedNames) {
  return Object.fromEntries(
    allowedNames.flatMap((name) =>
      typeof env[name] === "string" ? [[name, env[name]]] : [],
    ),
  );
}

function writeRedacted(stream, value, redactValues) {
  if (typeof value !== "string" || value.length === 0) return;
  stream.write(redactStagingChildOutput(value, redactValues));
}
