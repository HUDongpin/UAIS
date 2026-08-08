#!/usr/bin/env node

// Read-only tenant-isolation audit for the configured UAIS LRS store.
// Pages GET /statements via the xAPI `more` link and classifies every
// statement as UAIS app traffic, UAIS smoke traffic, other UAIS-actor
// traffic, or foreign (another application sharing the store). Output is
// redacted: counts, fingerprints, verb hostnames, and timestamp ranges only —
// never statement bodies, actor identities, endpoints, or credentials.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const target = "lrs-tenant-isolation-audit";
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
    throw new Error("Live LRS tenant-isolation audit requires --approved.");
  }
  if (plan.status === "blocked") {
    writeOutput(plan, options.out);
    process.exitCode = 1;
  } else {
    const result = await executeLiveAudit({ env, options });
    writeOutput(result, options.out);
    if (result.status !== "passed") {
      process.exitCode = 1;
    } else if (options.expectDedicated && result.totals.foreign > 0) {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "LRS tenant-isolation audit failed."}\n`,
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
  if (endpoint && isValidUrl(endpoint) && !isHttpsOrLoopback(endpoint)) {
    blockedReasons.push("non-https-lrs-endpoint");
  }
  if (!username) blockedReasons.push("missing-UAIS_LRS_USERNAME");
  if (!password) blockedReasons.push("missing-UAIS_LRS_PASSWORD");

  return {
    target,
    mode: options.live ? "live" : "dry-run",
    status: blockedReasons.length > 0 ? "blocked" : "ready",
    blockedReasons,
    readOnly: true,
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
      { name: "UAIS_LRS_ENDPOINT", status: endpoint ? "present" : "missing", valueRedacted: true },
      { name: "UAIS_LRS_USERNAME", status: username ? "present" : "missing", valueRedacted: true },
      { name: "UAIS_LRS_PASSWORD", status: password ? "present" : "missing", valueRedacted: true },
      {
        name: "UAIS_LRS_XAPI_VERSION",
        status: readValue(env.UAIS_LRS_XAPI_VERSION) ? "present" : "defaulted",
        valueRedacted: true,
      },
    ],
    xapiVersion,
    scanScope: {
      maxStatements: options.maxStatements,
      pageLimit: options.pageLimit,
    },
    safety: createSafety(),
  };
}

async function executeLiveAudit({ env, options }) {
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

  const totals = { scanned: 0, uaisApp: 0, uaisSmoke: 0, uaisOther: 0, foreign: 0 };
  const actorFingerprints = new Set();
  const foreignVerbHostCounts = new Map();
  let earliestTimestamp = "";
  let latestTimestamp = "";
  let pagesFetched = 0;
  let truncated = false;

  let nextUrl = new URL(createStatementsUrl(config.endpoint));
  nextUrl.searchParams.set("limit", String(options.pageLimit));
  const endpointOrigin = new URL(config.endpoint).origin;
  const visitedPageUrls = new Set();

  while (nextUrl) {
    visitedPageUrls.add(nextUrl.toString());
    const response = await safeFetch(nextUrl, {
      method: "GET",
      headers: createLrsHeaders(config, { accept: "application/json" }),
    });
    if (response.status === "request-failed") {
      return {
        ...plan,
        mode: "live",
        status: "failed",
        failureKind: "request-failed",
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
        failureKind: "http-error",
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
      totals[kind] += 1;
      const actorFingerprint = createActorFingerprint(statement);
      if (actorFingerprint) {
        actorFingerprints.add(actorFingerprint);
      }
      if (kind === "foreign") {
        const host = readVerbHost(statement);
        foreignVerbHostCounts.set(host, (foreignVerbHostCounts.get(host) ?? 0) + 1);
      }
      const timestamp = isRecord(statement) && typeof statement.stored === "string"
        ? statement.stored
        : isRecord(statement) && typeof statement.timestamp === "string"
          ? statement.timestamp
          : "";
      if (timestamp) {
        if (!earliestTimestamp || timestamp < earliestTimestamp) earliestTimestamp = timestamp;
        if (!latestTimestamp || timestamp > latestTimestamp) latestTimestamp = timestamp;
      }
    }

    if (truncated) {
      break;
    }
    const more = isRecord(body) && typeof body.more === "string" ? body.more.trim() : "";
    nextUrl = resolveNextPageUrl({
      more,
      origin: endpointOrigin,
      statementsOnPage: statements.length,
      visitedPageUrls,
    });
  }

  const verdict =
    totals.scanned === 0
      ? "empty"
      : totals.foreign > 0
        ? "shared"
        : truncated
          ? "no-foreign-in-scanned-window"
          : "dedicated";

  return {
    ...plan,
    mode: "live",
    status: "passed",
    verdict,
    totals,
    distinctActors: {
      count: actorFingerprints.size,
      identitiesFingerprinted: true,
    },
    foreignVerbHosts: [...foreignVerbHostCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([host, count]) => ({ host, count })),
    timestampRange: {
      earliest: earliestTimestamp || "none",
      latest: latestTimestamp || "none",
    },
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

function createActorFingerprint(statement) {
  if (!isRecord(statement) || !isRecord(statement.actor)) {
    return "";
  }
  const actor = statement.actor;
  const identity = isRecord(actor.account)
    ? `account:${actor.account.homePage ?? ""}:${actor.account.name ?? ""}`
    : typeof actor.mbox === "string"
      ? `mbox:${actor.mbox}`
      : typeof actor.name === "string"
        ? `name:${actor.name}`
        : "";
  return identity ? createFingerprint(identity) : "";
}

function readVerbHost(statement) {
  const verbId =
    isRecord(statement) && isRecord(statement.verb) && typeof statement.verb.id === "string"
      ? statement.verb.id
      : "";
  try {
    return new URL(verbId).host || "unknown";
  } catch {
    return "unknown";
  }
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
    expectDedicated: false,
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
    } else if (arg === "--expect-dedicated") {
      options.expectDedicated = true;
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
    readOnly: true,
    liveReadRequiresApproval: true,
    responseBodiesOmitted: true,
    endpointRedacted: true,
    credentialsRedacted: true,
    actorIdentitiesFingerprinted: true,
    statementContentsOmitted: true,
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
