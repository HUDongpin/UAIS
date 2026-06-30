#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const target = "lrs-live-write-read-smoke";
const defaultXapiVersion = "1.0.3";
const uaisXapiBase = "https://uais.top/xapi";

try {
  const options = parseArgs(process.argv.slice(2));
  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const plan = buildPlan({ env, options });

  if (options.dryRun) {
    writeOutput(plan, options.out);
    process.exit(0);
  }

  if (!options.approved) {
    throw new Error("Live LRS write/read smoke requires --approved.");
  }
  if (options.environment === "production" && !hasValue(options.releaseRunId)) {
    throw new Error("Production LRS write/read smoke requires --release-run-id.");
  }
  if (plan.status === "blocked") {
    writeOutput(plan, options.out);
    process.exitCode = 1;
  } else {
    const result = await executeLiveSmoke({
      env,
      options,
    });
    writeOutput(result, options.out);
    if (result.status !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "LRS live write/read smoke failed."}\n`,
  );
  process.exitCode = 1;
}

function buildPlan({ env, options }) {
  const endpoint = readValue(env.UAIS_LRS_ENDPOINT);
  const username = readValue(env.UAIS_LRS_USERNAME);
  const password = readValue(env.UAIS_LRS_PASSWORD);
  const xapiVersion = readValue(env.UAIS_LRS_XAPI_VERSION) || defaultXapiVersion;
  const blockedReasons = [];
  if (!endpoint) blockedReasons.push("missing-UAIS_LRS_ENDPOINT");
  if (endpoint && !isValidUrl(endpoint)) blockedReasons.push("invalid-UAIS_LRS_ENDPOINT");
  if (endpoint && !isHttpsOrLoopback(endpoint)) {
    blockedReasons.push("non-https-lrs-endpoint");
  }
  if (!username) blockedReasons.push("missing-UAIS_LRS_USERNAME");
  if (!password) blockedReasons.push("missing-UAIS_LRS_PASSWORD");

  return {
    target,
    mode: options.live ? "live" : "dry-run",
    environment: options.environment,
    releaseRunId: options.releaseRunId || "not-supplied",
    status: blockedReasons.length > 0 ? "blocked" : "ready",
    blockedReasons,
    endpoint: endpoint
      ? {
          status: isValidUrl(endpoint) ? "present" : "invalid",
          fingerprint: isValidUrl(endpoint)
            ? createFingerprint(new URL(endpoint).origin.toLowerCase())
            : undefined,
          valueRedacted: true,
        }
      : {
          status: "missing",
          valueRedacted: true,
        },
    requiredEnv: [
      {
        name: "UAIS_LRS_ENDPOINT",
        status: endpoint ? "present" : "missing",
        valueRedacted: true,
      },
      {
        name: "UAIS_LRS_USERNAME",
        status: username ? "present" : "missing",
        valueRedacted: true,
      },
      {
        name: "UAIS_LRS_PASSWORD",
        status: password ? "present" : "missing",
        valueRedacted: true,
      },
      {
        name: "UAIS_LRS_XAPI_VERSION",
        status: readValue(env.UAIS_LRS_XAPI_VERSION) ? "present" : "defaulted",
        valueRedacted: true,
      },
    ],
    xapiVersion,
    safety: createSafety(),
  };
}

async function executeLiveSmoke({ env, options }) {
  const plan = buildPlan({ env, options });
  if (plan.status === "blocked") {
    return plan;
  }

  const config = {
    endpoint: readValue(env.UAIS_LRS_ENDPOINT),
    username: readValue(env.UAIS_LRS_USERNAME),
    password: readValue(env.UAIS_LRS_PASSWORD),
    xapiVersion: readValue(env.UAIS_LRS_XAPI_VERSION) || defaultXapiVersion,
  };
  const statementId = randomUUID();
  const actor = {
    objectType: "Agent",
    account: {
      homePage: `${uaisXapiBase}/actors`,
      name: "admin:lrs-live-smoke",
    },
  };
  const activityId = `${uaisXapiBase}/activities/live-lrs-write-read-smoke/${safePathSegment(
    options.releaseRunId || statementId,
  )}`;
  const statement = {
    id: statementId,
    actor,
    verb: {
      id: "http://adlnet.gov/expapi/verbs/experienced",
      display: {
        "en-US": "experienced",
      },
    },
    object: {
      id: activityId,
      objectType: "Activity",
      definition: {
        name: {
          "en-US": "UAIS live LRS write/read smoke",
        },
        description: {
          "en-US": "Owner-approved UAIS production LRS write/read smoke statement.",
        },
        type: "http://adlnet.gov/expapi/activities/course",
      },
    },
    result: {
      success: true,
      completion: true,
      response: "UAIS live LRS write/read smoke completed.",
    },
    context: {
      platform: "UAIS",
      language: "zh-CN",
      contextActivities: {
        grouping: [
          {
            id: `${uaisXapiBase}/activities/release-runs/${safePathSegment(
              options.releaseRunId || "manual-live-lrs-smoke",
            )}`,
          },
        ],
      },
      extensions: {
        [`${uaisXapiBase}/extensions/source`]: "lrs-live-write-read-smoke",
        [`${uaisXapiBase}/extensions/environment`]: options.environment,
      },
    },
    timestamp: new Date().toISOString(),
  };

  const write = await postStatement({ config, statement });
  if (write.status !== "passed") {
    return {
      ...plan,
      mode: "live",
      status: "failed",
      write,
      readByStatementId: createSkippedResult("write-failed"),
      targetedRead: createSkippedResult("write-failed"),
    };
  }
  const readByStatementId = await readStatementById({ config, statementId });
  const targetedRead = await readStatementsByTarget({
    config,
    actor,
    verb: statement.verb.id,
    activityId,
    statementId,
  });
  const status =
    write.status === "passed" &&
    readByStatementId.status === "passed" &&
    targetedRead.status === "passed"
      ? "passed"
      : "failed";

  return {
    ...plan,
    mode: "live",
    status,
    write,
    readByStatementId,
    targetedRead,
  };
}

async function postStatement({ config, statement }) {
  const response = await safeFetch(createStatementsUrl(config.endpoint), {
    method: "POST",
    headers: createLrsHeaders(config, {
      "content-type": "application/json",
    }),
    body: JSON.stringify(statement),
  });
  if (response.status === "request-failed") {
    return createRequestFailedResult(response);
  }
  const responseText = await response.text();
  const parsed = parseJson(responseText);
  const statementId =
    Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : statement.id;

  return {
    status: response.ok ? "passed" : "failed",
    httpStatus: response.status,
    responseShape: classifyResponseShape(responseText, parsed),
    statementId: {
      status: statementId ? "present" : "missing",
      fingerprint: statementId ? createFingerprint(statementId) : undefined,
      valueRedacted: true,
    },
    responseBodyOmitted: true,
  };
}

async function readStatementById({ config, statementId }) {
  const url = new URL(createStatementsUrl(config.endpoint));
  url.searchParams.set("statementId", statementId);
  const response = await safeFetch(url, {
    method: "GET",
    headers: createLrsHeaders(config, {
      accept: "application/json",
    }),
  });
  if (response.status === "request-failed") {
    return createRequestFailedResult(response, {
      statementId: {
        fingerprint: createFingerprint(statementId),
        valueRedacted: true,
      },
    });
  }
  const body = await response.json().catch(() => undefined);
  const matched = isRecord(body) && body.id === statementId;

  return {
    status: response.ok && matched ? "passed" : "failed",
    httpStatus: response.status,
    statementMatched: matched,
    statementId: {
      fingerprint: createFingerprint(statementId),
      valueRedacted: true,
    },
    responseBodyOmitted: true,
  };
}

async function readStatementsByTarget({ config, actor, verb, activityId, statementId }) {
  const url = new URL(createStatementsUrl(config.endpoint));
  url.searchParams.set("agent", JSON.stringify(actor));
  url.searchParams.set("verb", verb);
  url.searchParams.set("activity", activityId);
  url.searchParams.set("related_activities", "true");
  url.searchParams.set("limit", "10");
  const response = await safeFetch(url, {
    method: "GET",
    headers: createLrsHeaders(config, {
      accept: "application/json",
    }),
  });
  if (response.status === "request-failed") {
    return {
      ...createRequestFailedResult(response),
      relatedActivities: true,
      smokeStatementFound: false,
    };
  }
  const body = await response.json().catch(() => undefined);
  const statements = isRecord(body) && Array.isArray(body.statements) ? body.statements : [];
  const smokeStatementFound = statements.some((statement) => {
    return isRecord(statement) && statement.id === statementId;
  });

  return {
    status: response.ok && smokeStatementFound ? "passed" : "failed",
    httpStatus: response.status,
    relatedActivities: true,
    statementsReturned: statements.length,
    smokeStatementFound,
    responseBodyOmitted: true,
  };
}

async function safeFetch(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    return {
      status: "request-failed",
      diagnostics: createSafeFetchDiagnostics(error),
    };
  }
}

function createRequestFailedResult(response, extra = {}) {
  return {
    status: "failed",
    httpStatus: 0,
    failureKind: "request-failed",
    diagnostics: response.diagnostics,
    responseBodyOmitted: true,
    ...extra,
  };
}

function createSkippedResult(reason) {
  return {
    status: "skipped",
    reason,
    responseBodyOmitted: true,
  };
}

function createSafeFetchDiagnostics(error) {
  const cause = error instanceof Error && isRecord(error.cause) ? error.cause : undefined;
  return {
    message: "LRS request failed before an HTTP response.",
    code:
      typeof cause?.code === "string" && /^[A-Z0-9_]+$/.test(cause.code)
        ? cause.code
        : "request-failed",
    valueRedacted: true,
  };
}

function createLrsHeaders(config, extraHeaders = {}) {
  return {
    ...extraHeaders,
    "X-Experience-API-Version": config.xapiVersion,
    Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString(
      "base64",
    )}`,
  };
}

function createStatementsUrl(endpoint) {
  const url = new URL(endpoint);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath.endsWith("/statements")
    ? normalizedPath
    : `${normalizedPath}/statements`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseArgs(args) {
  const options = {
    dryRun: true,
    live: false,
    approved: false,
    environment: "production",
    releaseRunId: "",
    envFile: "",
    out: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
      options.dryRun = false;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--environment") {
      options.environment = readRequiredArg(args, (index += 1), arg);
    } else if (arg === "--release-run-id") {
      options.releaseRunId = readRequiredArg(args, (index += 1), arg);
    } else if (arg === "--env-file") {
      options.envFile = readRequiredArg(args, (index += 1), arg);
    } else if (arg === "--out") {
      options.out = readRequiredArg(args, (index += 1), arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readEnvFile(path) {
  if (!path) {
    return {};
  }
  const env = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = unquoteEnvValue(match[2].trim());
  }
  return env;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readRequiredArg(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function writeOutput(value, outPath) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, serialized, { mode: 0o600 });
  }
  process.stdout.write(serialized);
}

function createSafety() {
  return {
    liveWriteRequiresApproval: true,
    responseBodiesOmitted: true,
    endpointRedacted: true,
    credentialsRedacted: true,
    statementIdFingerprinted: true,
    queryPolicy: "statementId-plus-agent-verb-activity",
  };
}

function classifyResponseShape(responseText, parsed) {
  if (!responseText.trim()) return "empty";
  if (Array.isArray(parsed)) return "statement-ids-array";
  if (parsed && typeof parsed === "object") return "json-object";
  return "text";
}

function parseJson(value) {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readValue(value) {
  return hasValue(value) ? value.trim() : "";
}

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isHttpsOrLoopback(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function createFingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function safePathSegment(value) {
  return encodeURIComponent(String(value).trim().replace(/\s+/g, "-"));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
