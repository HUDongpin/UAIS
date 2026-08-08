#!/usr/bin/env node

// Migrates UAIS-produced xAPI statements from the currently configured
// (shared) LRS store to a dedicated target LRS instance.
//
//   source: UAIS_LRS_ENDPOINT / UAIS_LRS_USERNAME / UAIS_LRS_PASSWORD
//   target: UAIS_LRS_TARGET_ENDPOINT / UAIS_LRS_TARGET_USERNAME / UAIS_LRS_TARGET_PASSWORD
//
// Statements are re-POSTed with their original ids, so the migration is
// idempotent: an identical re-POST is a no-op and a same-id conflict surfaces
// as HTTP 409 (reported separately, not a failure). Foreign statements from
// other applications sharing the source store are never migrated. Output is
// redacted: counts and fingerprints only — never statement bodies, actor
// identities, endpoints, or credentials.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const target = "lrs-migrate-uais-statements";
const defaultXapiVersion = "1.0.3";
const uaisXapiBase = "https://uais.top/xapi";
const uaisActorHomePages = ["https://uais.top/xapi/actors", "https://uais.top"];
const uaisSmokeSources = ["local-lrs-smoke", "lrs-live-write-read-smoke"];

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
    throw new Error("Live LRS statement migration requires --approved.");
  }
  if (plan.status === "blocked") {
    writeOutput(plan, options.out);
    process.exitCode = 1;
  } else {
    const result = await executeLiveMigration({ env, options });
    writeOutput(result, options.out);
    if (result.status !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "LRS statement migration failed."}\n`,
  );
  process.exitCode = 1;
}

function buildPlan({ env, options }) {
  const source = readLrsEnvGroup(env, "UAIS_LRS");
  const migrationTarget = readLrsEnvGroup(env, "UAIS_LRS_TARGET");
  const blockedReasons = [
    ...readGroupBlockedReasons(source, "UAIS_LRS"),
    ...readGroupBlockedReasons(migrationTarget, "UAIS_LRS_TARGET"),
  ];
  if (
    source.endpoint &&
    migrationTarget.endpoint &&
    isValidUrl(source.endpoint) &&
    isValidUrl(migrationTarget.endpoint) &&
    new URL(source.endpoint).origin === new URL(migrationTarget.endpoint).origin &&
    !options.allowSameEndpoint
  ) {
    blockedReasons.push("target-endpoint-matches-source");
  }

  return {
    target,
    mode: options.live ? "live" : "dry-run",
    status: blockedReasons.length > 0 ? "blocked" : "ready",
    blockedReasons,
    source: createRedactedEndpointSummary(source),
    migrationTarget: createRedactedEndpointSummary(migrationTarget),
    requiredEnv: [
      ...createGroupEnvReport(source, "UAIS_LRS"),
      ...createGroupEnvReport(migrationTarget, "UAIS_LRS_TARGET"),
    ],
    selection: {
      includesUaisAppStatements: true,
      includesSmokeStatements: options.includeSmoke,
      includesForeignStatements: false,
    },
    scanScope: {
      maxStatements: options.maxStatements,
      pageLimit: options.pageLimit,
    },
    safety: createSafety(),
  };
}

async function executeLiveMigration({ env, options }) {
  const plan = buildPlan({ env, options });
  if (plan.status === "blocked") {
    return plan;
  }

  const sourceConfig = createConfig(readLrsEnvGroup(env, "UAIS_LRS"));
  const targetConfig = createConfig(readLrsEnvGroup(env, "UAIS_LRS_TARGET"));

  const totals = {
    scanned: 0,
    selected: 0,
    skippedForeign: 0,
    skippedSmoke: 0,
    migrated: 0,
    conflicts: 0,
    failed: 0,
  };
  const failedStatementFingerprints = [];
  let pagesFetched = 0;
  let truncated = false;

  let nextUrl = new URL(createStatementsUrl(sourceConfig.endpoint));
  nextUrl.searchParams.set("limit", String(options.pageLimit));
  const sourceOrigin = new URL(sourceConfig.endpoint).origin;
  const visitedPageUrls = new Set();

  while (nextUrl) {
    visitedPageUrls.add(nextUrl.toString());
    const response = await safeFetch(nextUrl, {
      method: "GET",
      headers: createLrsHeaders(sourceConfig, { accept: "application/json" }),
    });
    if (response.status === "request-failed") {
      return {
        ...plan,
        mode: "live",
        status: "failed",
        failureKind: "source-request-failed",
        diagnostics: response.diagnostics,
        totals,
        pagesFetched,
      };
    }
    if (!response.ok) {
      return {
        ...plan,
        mode: "live",
        status: "failed",
        failureKind: "source-http-error",
        httpStatus: response.status,
        totals,
        pagesFetched,
      };
    }
    const body = await response.json().catch(() => undefined);
    const statements = isRecord(body) && Array.isArray(body.statements) ? body.statements : [];
    pagesFetched += 1;

    for (const statement of statements) {
      if (totals.scanned >= options.maxStatements) {
        truncated = true;
        break;
      }
      totals.scanned += 1;
      const kind = classifyStatement(statement);
      if (kind === "foreign") {
        totals.skippedForeign += 1;
        continue;
      }
      if ((kind === "uaisSmoke" || kind === "uaisOther") && !options.includeSmoke) {
        totals.skippedSmoke += 1;
        continue;
      }

      totals.selected += 1;
      const writeResult = await postStatementToTarget({
        config: targetConfig,
        statement,
      });
      if (writeResult === "migrated") {
        totals.migrated += 1;
      } else if (writeResult === "conflict") {
        totals.conflicts += 1;
      } else {
        totals.failed += 1;
        const statementId = isRecord(statement) && typeof statement.id === "string"
          ? statement.id
          : "";
        if (statementId && failedStatementFingerprints.length < 20) {
          failedStatementFingerprints.push(createFingerprint(statementId));
        }
      }
    }

    if (truncated) {
      break;
    }
    const more = isRecord(body) && typeof body.more === "string" ? body.more.trim() : "";
    nextUrl = resolveNextPageUrl({
      more,
      origin: sourceOrigin,
      statementsOnPage: statements.length,
      visitedPageUrls,
    });
  }

  return {
    ...plan,
    mode: "live",
    status: totals.failed > 0 ? "failed" : "passed",
    totals,
    failedStatementFingerprints,
    pagesFetched,
    truncated,
  };
}

// Follows the xAPI `more` link defensively: an empty page, an unparseable
// link, or a link that would revisit an already-fetched page ends pagination
// instead of looping forever against a misbehaving LRS.
function resolveNextPageUrl({ more, origin, statementsOnPage, visitedPageUrls }) {
  if (!more || statementsOnPage === 0) {
    return undefined;
  }
  try {
    const candidate = new URL(more, origin);
    return visitedPageUrls.has(candidate.toString()) ? undefined : candidate;
  } catch {
    return undefined;
  }
}

async function postStatementToTarget({ config, statement }) {
  const response = await safeFetch(createStatementsUrl(config.endpoint), {
    method: "POST",
    headers: createLrsHeaders(config, { "content-type": "application/json" }),
    body: JSON.stringify(statement),
  });
  if (response.status === "request-failed") {
    return "failed";
  }
  if (response.ok) {
    return "migrated";
  }
  return response.status === 409 ? "conflict" : "failed";
}

function classifyStatement(statement) {
  if (!isRecord(statement)) {
    return "foreign";
  }
  const context = isRecord(statement.context) ? statement.context : undefined;
  const extensions = context && isRecord(context.extensions) ? context.extensions : undefined;
  const smokeSource = extensions?.[`${uaisXapiBase}/extensions/source`];
  if (typeof smokeSource === "string" && uaisSmokeSources.includes(smokeSource)) {
    return "uaisSmoke";
  }
  if (extensions && Object.prototype.hasOwnProperty.call(extensions, `${uaisXapiBase}/extensions/event-type`)) {
    return "uaisApp";
  }
  const actor = isRecord(statement.actor) ? statement.actor : undefined;
  const account = actor && isRecord(actor.account) ? actor.account : undefined;
  if (typeof account?.homePage === "string" && uaisActorHomePages.includes(account.homePage)) {
    return "uaisOther";
  }
  return "foreign";
}

function readLrsEnvGroup(env, prefix) {
  return {
    endpoint: readValue(env[`${prefix}_ENDPOINT`]),
    username: readValue(env[`${prefix}_USERNAME`]),
    password: readValue(env[`${prefix}_PASSWORD`]),
    xapiVersion: readValue(env[`${prefix}_XAPI_VERSION`]) || defaultXapiVersion,
    xapiVersionExplicit: Boolean(readValue(env[`${prefix}_XAPI_VERSION`])),
  };
}

function readGroupBlockedReasons(group, prefix) {
  const reasons = [];
  if (!group.endpoint) reasons.push(`missing-${prefix}_ENDPOINT`);
  if (group.endpoint && !isValidUrl(group.endpoint)) reasons.push(`invalid-${prefix}_ENDPOINT`);
  if (group.endpoint && isValidUrl(group.endpoint) && !isHttpsOrLoopback(group.endpoint)) {
    reasons.push(`non-https-${prefix}_ENDPOINT`);
  }
  if (!group.username) reasons.push(`missing-${prefix}_USERNAME`);
  if (!group.password) reasons.push(`missing-${prefix}_PASSWORD`);
  return reasons;
}

function createGroupEnvReport(group, prefix) {
  return [
    {
      name: `${prefix}_ENDPOINT`,
      status: group.endpoint ? "present" : "missing",
      valueRedacted: true,
    },
    {
      name: `${prefix}_USERNAME`,
      status: group.username ? "present" : "missing",
      valueRedacted: true,
    },
    {
      name: `${prefix}_PASSWORD`,
      status: group.password ? "present" : "missing",
      valueRedacted: true,
    },
    {
      name: `${prefix}_XAPI_VERSION`,
      status: group.xapiVersionExplicit ? "present" : "defaulted",
      valueRedacted: true,
    },
  ];
}

function createRedactedEndpointSummary(group) {
  return {
    endpoint: group.endpoint
      ? {
          status: isValidUrl(group.endpoint) ? "present" : "invalid",
          fingerprint: isValidUrl(group.endpoint)
            ? createFingerprint(new URL(group.endpoint).origin.toLowerCase())
            : undefined,
          valueRedacted: true,
        }
      : {
          status: "missing",
          valueRedacted: true,
        },
    xapiVersion: group.xapiVersion,
  };
}

function createConfig(group) {
  return {
    endpoint: group.endpoint,
    username: group.username,
    password: group.password,
    xapiVersion: group.xapiVersion,
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
    includeSmoke: false,
    allowSameEndpoint: false,
    envFile: "",
    out: "",
    maxStatements: 20000,
    pageLimit: 100,
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
    } else if (arg === "--include-smoke") {
      options.includeSmoke = true;
    } else if (arg === "--allow-same-endpoint") {
      options.allowSameEndpoint = true;
    } else if (arg === "--env-file") {
      options.envFile = readRequiredArg(args, (index += 1), arg);
    } else if (arg === "--out") {
      options.out = readRequiredArg(args, (index += 1), arg);
    } else if (arg === "--max-statements") {
      options.maxStatements = readPositiveIntegerArg(args, (index += 1), arg);
    } else if (arg === "--page-limit") {
      options.pageLimit = Math.min(readPositiveIntegerArg(args, (index += 1), arg), 200);
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

function readPositiveIntegerArg(args, index, flag) {
  const value = Number(readRequiredArg(args, index, flag));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} requires a positive integer.`);
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
    foreignStatementsNeverMigrated: true,
    statementIdsPreserved: true,
    responseBodiesOmitted: true,
    endpointsRedacted: true,
    credentialsRedacted: true,
    statementContentsOmitted: true,
    failedStatementIdsFingerprinted: true,
  };
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
