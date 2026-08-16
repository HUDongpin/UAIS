#!/usr/bin/env node

// Group-chatroom production readiness preflight (blockers B2/B3/B4).
//
// The chatroom is green locally and still cannot be trusted in a deployed lane
// until three environment facts hold, and none of them is checked by anything
// today:
//
//   B2  the stores are external - local JSON is refused in a production runtime,
//       so an unset backend selector means the room 503s on first use
//   B3  the external-storage service accepts transcript schema v2 - an older
//       separately-deployed service rejects every write
//   B4  the feature flag is the exact literal `on` - `true`, `1`, `yes` and a
//       stray capital all leave group rooms off, silently
//
// This reads an environment and reports what would happen, so the flip is
// decided on evidence instead of hope. It never prints a secret: values are
// classified (present / absent / too short) and never echoed. The live probe is
// opt-in because it spends a real request against the storage service.
//
// Usage:
//   node scripts/chatroom-production-readiness.mjs [--env-file .env.production]
//                                                  [--probe] [--json] [--help]
// Exit code 1 when any blocker is unresolved, so CI can gate on it.

import { readFileSync } from "node:fs";

const minimumAccessTokenLength = 32;
const transcriptSchemaVersion = "uais-learning-chatroom-transcripts-v2";
const probeTimeoutMs = 10_000;

// Kept in step with src/lib/server/learning-chatroom-groups-flag.ts. The reader
// there is the single source of truth in the app; this script cannot import a
// .ts module, so it restates the comparison and says so.
function isGroupsModeEnabled(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "on";
}

function classifySecret(value, { minimumLength = 0 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    return { status: "absent", valueRedacted: true };
  }
  if (value.trim().length < minimumLength) {
    return { status: "too-short", minimumLength, valueRedacted: true };
  }
  return { status: "present", valueRedacted: true };
}

function checkStorageBackend(env) {
  const selector = env.UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND?.trim().toLowerCase() ?? "";
  const blockedReasons = [];

  const coreDatabaseConfigured = ["UAIS_CORE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"].some(
    (name) => (env[name] ?? "").trim() !== "",
  );
  const usesPostgres =
    selector === "postgres" ||
    selector === "managed" ||
    // The default in a production runtime: the managed database is already a
    // required part of the surface, so a correct deployment is durable without
    // any storage-specific configuration at all.
    (selector === "" && coreDatabaseConfigured);

  const baseUrl = env.UAIS_EXTERNAL_STORAGE_BASE_URL?.trim() ?? "";
  const token = classifySecret(env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN, {
    minimumLength: minimumAccessTokenLength,
  });

  if (usesPostgres) {
    if (!coreDatabaseConfigured) {
      blockedReasons.push("missing-UAIS_CORE_DATABASE_URL");
    }
  } else if (selector === "external") {
    if (!baseUrl) {
      blockedReasons.push("missing-UAIS_EXTERNAL_STORAGE_BASE_URL");
    } else if (!baseUrl.startsWith("https://")) {
      // A token travels on every call; plaintext transport would leak it.
      blockedReasons.push("non-https-UAIS_EXTERNAL_STORAGE_BASE_URL");
    }
    if (token.status !== "present") {
      blockedReasons.push(`invalid-UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:${token.status}`);
    }
  } else {
    // Neither a durable selector nor a core database: production refuses local
    // JSON, so the room would 503 on the first message.
    blockedReasons.push("local-json-backend-refused-in-production");
  }

  return {
    blocker: "B2",
    title: "Durable storage configured",
    selector: selector || "(unset)",
    resolvedBackend: usesPostgres
      ? "postgres"
      : selector === "external"
        ? "external"
        : "local-json",
    coreDatabaseConfigured,
    baseUrlConfigured: Boolean(baseUrl),
    baseUrlIsHttps: baseUrl.startsWith("https://"),
    accessToken: token,
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    blockedReasons,
  };
}

function checkGroupsFlag(env) {
  const raw = env.UAIS_LEARNING_CHATROOM_GROUPS_MODE;
  const enabled = isGroupsModeEnabled(raw);
  const blockedReasons = [];
  let note;

  if (!enabled) {
    blockedReasons.push("groups-mode-not-on");
    if (typeof raw === "string" && raw.trim() !== "") {
      // The most common real mistake: a truthy-looking value that the reader
      // deliberately does not accept.
      note = "value is set but is not the literal `on`; group rooms stay off";
    }
  }

  return {
    blocker: "B4",
    title: "Group rooms enabled",
    // The raw value is a mode name, not a secret, but only its shape is
    // reported so a report can be pasted anywhere.
    valuePresent: typeof raw === "string" && raw.trim() !== "",
    enabled,
    status: enabled ? "ready" : "blocked",
    blockedReasons,
    ...(note ? { note } : {}),
  };
}

function checkProviderKeys(env) {
  const deepSeek = classifySecret(env.DEEPSEEK_API_KEY);
  const dashscope = classifySecret(env.DASHSCOPE_API_KEY);
  const configured = [
    ...(deepSeek.status === "present" ? ["text-reasoning"] : []),
    ...(dashscope.status === "present" ? ["multimodal"] : []),
  ];

  return {
    blocker: "provider",
    title: "Agent providers configured",
    deepSeek,
    dashscope,
    configuredRoles: configured,
    // One provider answers every agent; two means an outage degrades the room
    // to a model change instead of silencing it.
    failoverAvailable: configured.length > 1,
    status: configured.length > 0 ? "ready" : "blocked",
    blockedReasons: configured.length === 0 ? ["no-agent-provider-configured"] : [],
  };
}

async function probeTranscriptSchema(env) {
  const backend = checkStorageBackend(env).resolvedBackend;
  if (backend !== "external") {
    // Nothing to negotiate: Postgres storage is this deployment's own schema,
    // so there is no separately versioned service that could predate v2.
    return {
      blocker: "B3",
      title: "External storage accepts transcript schema v2",
      status: "not-applicable",
      reason: `durable-backend-is-${backend}`,
      blockedReasons: [],
    };
  }

  const baseUrl = env.UAIS_EXTERNAL_STORAGE_BASE_URL?.trim() ?? "";
  const token = env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN ?? "";
  if (!baseUrl || !token) {
    return {
      blocker: "B3",
      title: "External storage accepts transcript schema v2",
      status: "skipped",
      reason: "external-storage-not-configured",
      blockedReasons: ["transcript-schema-v2-unverified"],
    };
  }

  // Asks the service what it SPEAKS rather than inferring it from stored data.
  // A service built before v2 has no `learningChatroomStorageSchema` at all, so
  // its absence is the signal - which is why a missing field blocks instead of
  // being treated as "probably fine".
  const url = `${baseUrl.replace(/\/$/, "")}/healthz`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    const body = await response.json().catch(() => undefined);
    const declared = body?.learningChatroomStorageSchema;
    const accepted = declared?.transcripts?.acceptedSchemaVersions;

    if (!declared) {
      return {
        blocker: "B3",
        title: "External storage accepts transcript schema v2",
        status: "blocked",
        httpStatus: response.status,
        // Either the service predates v2, or it is not reachable/ready at all.
        blockedReasons: response.ok
          ? ["storage-service-predates-transcript-schema-v2"]
          : [`storage-service-unhealthy:${response.status}`],
      };
    }

    const ready = Array.isArray(accepted) && accepted.includes(transcriptSchemaVersion);
    return {
      blocker: "B3",
      title: "External storage accepts transcript schema v2",
      status: ready ? "ready" : "blocked",
      httpStatus: response.status,
      declaredTranscriptSchema: declared.transcripts ?? "(absent)",
      declaredShareSchema: declared.shares ?? "(absent)",
      expectedSchemaVersion: transcriptSchemaVersion,
      blockedReasons: ready ? [] : ["transcript-schema-version-not-accepted"],
    };
  } catch {
    // The endpoint and the failure mode are reportable; the token is not.
    return {
      blocker: "B3",
      title: "External storage accepts transcript schema v2",
      status: "blocked",
      blockedReasons: ["storage-service-request-failed"],
      valuesRedacted: true,
    };
  }
}

function readEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  const parsed = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[name] = value;
  }
  return parsed;
}

function parseArgs(args) {
  const options = { envFile: undefined, probe: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--probe") {
      options.probe = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

const helpText = `Group-chatroom production readiness preflight.

  --env-file <path>  read the environment from a file instead of process.env
  --probe            additionally call the external storage service (B3)
  --json             print the machine-readable report only
  --help             show this message

Exits 1 when any blocker is unresolved. No secret value is ever printed.
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText);
    return;
  }

  const env = options.envFile ? readEnvFile(options.envFile) : process.env;

  const checks = [checkStorageBackend(env), checkGroupsFlag(env), checkProviderKeys(env)];
  checks.push(
    options.probe
      ? await probeTranscriptSchema(env)
      : checkStorageBackend(env).resolvedBackend !== "external"
        ? {
            blocker: "B3",
            title: "External storage accepts transcript schema v2",
            status: "not-applicable",
            reason: `durable-backend-is-${checkStorageBackend(env).resolvedBackend}`,
            blockedReasons: [],
          }
        : {
            blocker: "B3",
            title: "External storage accepts transcript schema v2",
            status: "skipped",
            reason: "probe-not-requested",
            // Unverified is not satisfied: a separately deployed service is only
            // provable by asking it.
            blockedReasons: ["transcript-schema-v2-unverified"],
          },
  );

  const blocked = checks.filter((check) => check.blockedReasons.length > 0);
  const report = {
    // Named the way every other evidence file in the release chain is named, so
    // the aggregate gate can refuse a file that is not this report rather than
    // accepting any JSON that happens to carry `status: "ready"`.
    target: "chatroom-production-readiness",
    generatedAt: new Date().toISOString(),
    source: options.envFile ? "env-file" : "process-env",
    probed: options.probe,
    status: blocked.length === 0 ? "ready" : "blocked",
    checks,
    blockedReasons: blocked.flatMap((check) => check.blockedReasons),
    safety: {
      secretsPrinted: false,
      valuesRedacted: true,
      flagComparisonMirrors: "src/lib/server/learning-chatroom-groups-flag.ts",
    },
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Chatroom production readiness: ${report.status}\n\n`);
    for (const check of checks) {
      const mark =
        check.blockedReasons.length > 0
          ? "BLOCK"
          : check.status === "ready"
            ? "ok  "
            : check.status === "not-applicable"
              ? "n/a "
              : "skip";
      process.stdout.write(`  [${mark}] ${check.blocker}  ${check.title}\n`);
      for (const reason of check.blockedReasons) {
        process.stdout.write(`         - ${reason}\n`);
      }
      if (check.note) {
        process.stdout.write(`         note: ${check.note}\n`);
      }
    }
    process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);
  }

  if (blocked.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Chatroom readiness check failed."}\n`,
  );
  process.exitCode = 1;
});
