#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const route = "/teaching";
const anchors = [
  {
    id: "teacherWorkflowTitle",
    patterns: ["Teacher PPT Narration Workflow", "教师 PPT 配音工作流"],
  },
  {
    id: "voiceSampleUpload",
    patterns: ["Upload/select 10-second teacher voice", "上传/选择 10 秒教师声音"],
  },
  {
    id: "voiceSampleSelect",
    patterns: [
      'data-uais-voice-sample-select="file-input"',
      '"data-uais-voice-sample-select":"file-input"',
    ],
  },
  {
    id: "uploadedSampleAudioPayload",
    patterns: [
      'data-uais-uploaded-sample-audio-payload="sampleAudioBase64"',
      '"data-uais-uploaded-sample-audio-payload":"sampleAudioBase64"',
    ],
  },
  {
    id: "voiceSampleDurationGate",
    patterns: [
      'data-uais-voice-sample-duration-gate="browser-metadata"',
      '"data-uais-voice-sample-duration-gate":"browser-metadata"',
    ],
  },
  {
    id: "selectedSampleIdentity",
    patterns: [
      'data-uais-selected-sample-identity="sampleAssetId voiceRefId"',
      '"data-uais-selected-sample-identity":"sampleAssetId voiceRefId"',
    ],
  },
  {
    id: "preflight",
    patterns: ["Run workflow preflight", "运行 workflow 预检"],
  },
  {
    id: "pptNarrationGenerate",
    patterns: ["Generate PPT narration", "生成 PPT 配音"],
  },
  {
    id: "perSlideWavDownloads",
    patterns: [
      "Per-slide WAV downloads appear after generation.",
      "生成后显示每页 WAV 下载。",
    ],
  },
  {
    id: "signedSessionBootstrap",
    patterns: [
      'data-uais-signed-session-bootstrap="/api/ai/session"',
      '"data-uais-signed-session-bootstrap":"/api/ai/session"',
    ],
  },
  {
    id: "signedSessionReadiness",
    patterns: [
      'data-uais-session-readiness="not-checked"',
      'data-uais-session-readiness="signed-ai-access-ready"',
      'data-uais-session-readiness="signed-ai-access-blocked"',
      '"data-uais-session-readiness":',
    ],
  },
  {
    id: "workflowSessionActions",
    patterns: [
      'data-uais-workflow-session-actions="teacher-ppt-workflow-read voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"',
      'data-uais-workflow-session-actions="voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"',
      '"data-uais-workflow-session-actions":"teacher-ppt-workflow-read voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"',
      '"data-uais-workflow-session-actions":"voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"',
    ],
  },
  {
    id: "serverWorkflowStatus",
    patterns: [
      'data-uais-server-workflow-status="/api/ai/teacher-ppt-workflow"',
      '"data-uais-server-workflow-status":"/api/ai/teacher-ppt-workflow"',
    ],
  },
  {
    id: "serverWorkflowProgress",
    patterns: [
      'data-uais-server-workflow-progress="auth-provider-storage-route"',
      '"data-uais-server-workflow-progress":"auth-provider-storage-route"',
    ],
  },
];
const networkRetryPolicy = {
  maxAttempts: 3,
  perAttemptTimeoutMs: 10_000,
  retryOn: ["request-error"],
  valuesRedacted: true,
};

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Teacher workflow deployment smoke requires explicit owner approval.");
  }
  if (options.live && options.environment === "production" && !hasValue(options.releaseRunId)) {
    throw new Error("Teacher workflow deployment smoke requires --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const teacherCookie = normalizeCookieHeader(
    options.cookie || env.UAIS_TEACHER_WORKFLOW_SMOKE_COOKIE,
  );
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_DEPLOYMENT_BASE_URL;
  const vercelProductionDeployment = readJsonEvidence(options.vercelProductionDeployment);
  const plan = buildPlan({
    mode,
    environment: options.environment,
    baseUrl,
    resolvedAddress: options.resolvedAddress,
    releaseRunId: options.releaseRunId,
    vercelProductionDeployment,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked" && !shouldRunDiagnosticLiveSmoke(plan)) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const result = await executeLiveSmoke({
      baseUrl,
      resolvedAddress: options.resolvedAddress,
      teacherCookie,
    });
    const evidence = createLiveEvidence({ plan, result });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (result.status !== "passed" || plan.status === "blocked") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Teacher workflow deployment smoke failed."}\n`,
  );
  process.exitCode = 1;
}

function buildPlan({
  mode,
  environment,
  baseUrl,
  resolvedAddress,
  releaseRunId,
  vercelProductionDeployment,
}) {
  const deploymentOrigin = describeDeploymentOrigin(baseUrl);
  const deploymentFingerprint = createDeploymentFingerprint(baseUrl);
  const vercelProductionDeploymentEvidence = evaluateVercelProductionDeploymentEvidence({
    evidence: vercelProductionDeployment,
    deploymentFingerprint,
    environment,
    releaseRunId,
  });
  const prerequisites = [
    {
      id: "s22-deployment-base-url",
      responsibleSession: "S22",
      requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    ...(vercelProductionDeploymentEvidence
      ? [
          {
            id: "s22-vercel-production-deployment-evidence",
            responsibleSession: "S22",
            requiredEvidence: "vercel-production-deployment",
            status: vercelProductionDeploymentEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
  ];
  const blockedReasons = [
    ...prerequisites.flatMap((prerequisite) => {
      if (typeof prerequisite.requiredEnv !== "string") {
        return [];
      }
      return prerequisite.status === "present" ? [] : [`missing-${prerequisite.requiredEnv}`];
    }),
    ...readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }),
    ...readVercelProductionDeploymentBlockedReasons(vercelProductionDeploymentEvidence),
  ];

  return {
    target: "teacher-workflow-deployment-smoke",
    mode,
    environment,
    network: mode === "live" ? "enabled" : "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S22",
    ...(releaseRunId ? { releaseRunId } : {}),
    route,
    deploymentFingerprint,
    deploymentOrigin,
    networkAddressOverride: describeNetworkAddressOverride(resolvedAddress),
    ...(vercelProductionDeploymentEvidence
      ? { vercelProductionDeploymentEvidence }
      : {}),
    networkRetryPolicy,
    anchors: anchors.map((anchor) => anchor.id),
    prerequisites,
    blockedReasons,
    safety: {
      valuesRedacted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      responseBodyOmitted: true,
      liveRequiresApproval: true,
      remoteMutationRequiresApproval: true,
      checksRenderedTeacherWorkflowAnchors: true,
    },
  };
}

function shouldRunDiagnosticLiveSmoke(plan) {
  if (!isRecord(plan) || plan.mode !== "live" || plan.status !== "blocked") {
    return false;
  }
  if (!Array.isArray(plan.blockedReasons) || plan.blockedReasons.length === 0) {
    return false;
  }
  return plan.blockedReasons.every(isDiagnosticOnlyBlockedReason);
}

function isDiagnosticOnlyBlockedReason(reason) {
  return (
    reason === "vercel-production-deployment-evidence-missing" ||
    reason === "vercel-production-deployment-evidence-not-deployed" ||
    reason === "vercel-production-deployment-evidence-not-observed" ||
    reason === "vercel-production-deployment-evidence-release-run-id-mismatch" ||
    reason === "vercel-production-deployment-evidence-fingerprint-missing" ||
    reason === "vercel-production-deployment-evidence-deployment-fingerprint-missing"
  );
}

function createLiveEvidence({ plan, result }) {
  const deploymentBindingProved =
    isRecord(plan.vercelProductionDeploymentEvidence) &&
    plan.vercelProductionDeploymentEvidence.status === "matched";
  const pagePassed = result.status === "passed";
  const productionReleaseEligible = plan.status === "ready" && pagePassed && deploymentBindingProved;

  return {
    ...plan,
    ...result,
    deploymentEvidenceBindingStatus: deploymentBindingProved ? "proved" : "not-proven",
    productionReleaseEligible,
    ...(plan.status === "blocked"
      ? {
          diagnosticBlockedReasons: plan.blockedReasons,
        }
      : {}),
  };
}

function evaluateVercelProductionDeploymentEvidence({
  evidence,
  deploymentFingerprint,
  environment,
  releaseRunId,
}) {
  if (evidence === undefined) {
    if (environment === "production") {
      return {
        target: "missing",
        status: "missing",
        deploymentObservationStatus: "missing",
        valueRedacted: true,
      };
    }
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      deploymentObservationStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const deploymentObservationStatus = readDeploymentObservationStatus(evidence);
  const summary = {
    target,
    deploymentObservationStatus,
    releaseRunIdStatus: readReleaseRunIdStatus(evidence, releaseRunId),
    valueRedacted: true,
  };
  if (target !== "vercel-production-deployment") {
    return { ...summary, status: "invalid-target" };
  }
  if (evidence.mode !== "live" || evidence.status !== "deployed") {
    return { ...summary, status: "not-deployed" };
  }
  if (deploymentObservationStatus !== "observed") {
    return { ...summary, status: "not-observed" };
  }
  if (releaseRunId && evidence.releaseRunId !== releaseRunId) {
    return { ...summary, status: "release-run-id-mismatch" };
  }

  const evidenceFingerprint = isRecord(evidence.deploymentFingerprint)
    ? evidence.deploymentFingerprint
    : undefined;
  if (
    !evidenceFingerprint ||
    evidenceFingerprint.status !== "present" ||
    typeof evidenceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (deploymentFingerprint.status !== "present") {
    return { ...summary, status: "deployment-fingerprint-missing" };
  }
  if (evidenceFingerprint.value !== deploymentFingerprint.value) {
    return { ...summary, status: "mismatched" };
  }

  return {
    ...summary,
    status: "matched",
  };
}

function readReleaseRunIdStatus(evidence, releaseRunId) {
  if (!releaseRunId) {
    return "missing";
  }
  return evidence.releaseRunId === releaseRunId ? "matched" : "mismatched";
}

function readDeploymentObservationStatus(evidence) {
  return isRecord(evidence.deploymentObservation) &&
    typeof evidence.deploymentObservation.status === "string"
    ? evidence.deploymentObservation.status
    : "missing";
}

function readVercelProductionDeploymentBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["vercel-production-deployment-fingerprint-mismatch"];
  }
  return [`vercel-production-deployment-evidence-${evidenceStatus.status}`];
}

function readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }) {
  if (
    environment !== "production" ||
    deploymentOrigin.status !== "present" ||
    deploymentOrigin.originClass === "remote-https"
  ) {
    return [];
  }
  return ["production-deployment-origin-not-remote-https"];
}

async function executeLiveSmoke({ baseUrl, resolvedAddress, teacherCookie }) {
  let lastError;
  for (let attempt = 1; attempt <= networkRetryPolicy.maxAttempts; attempt += 1) {
    try {
      const response = await requestDeploymentResource(`${stripTrailingSlashes(baseUrl)}${route}`, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml",
          ...(hasValue(teacherCookie) ? { cookie: teacherCookie } : {}),
        },
        resolvedAddress,
        timeoutMs: networkRetryPolicy.perAttemptTimeoutMs,
      });
      const body = await response.text().catch(() => "");
      const clientChunkEvidence = response.ok
        ? await readClientChunkEvidence({
            body,
            baseUrl,
            resolvedAddress,
            teacherCookie,
          })
        : createEmptyClientChunkEvidence();
      const results = evaluateAnchors(
        [body, ...clientChunkEvidence.bodies].join(" "),
      );
      const anchorsPresent = Object.values(results).every((value) => value === "present");
      const status = response.ok && anchorsPresent ? "passed" : "failed";
      return {
        status,
        httpStatus: response.status,
        renderedPageFingerprint: createRenderedPageFingerprint(body),
        clientChunkEvidence: createPublicClientChunkEvidence(clientChunkEvidence),
        networkAttempts: createNetworkAttempts(attempt),
        results,
        blockedReasons:
          status === "passed"
            ? []
            : [
                response.ok
                  ? "teacher-workflow-deployment-anchors-missing"
                  : "teacher-workflow-deployment-http-not-ok",
              ],
      };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    status: "failed",
    results: Object.fromEntries(anchors.map((anchor) => [anchor.id, "missing"])),
    networkAttempts: createNetworkAttempts(networkRetryPolicy.maxAttempts),
    networkError: classifyNetworkError(lastError),
    blockedReasons: ["teacher-workflow-deployment-request-failed"],
  }
}

function createNetworkAttempts(attempted) {
  return {
    attempted,
    maxAttempts: networkRetryPolicy.maxAttempts,
    retried: attempted > 1,
    valueRedacted: true,
  };
}

function evaluateAnchors(body) {
  const normalized = normalizeAnchorSearchCorpus(body);
  return Object.fromEntries(
    anchors.map((anchor) => [
      anchor.id,
      anchor.patterns.some((pattern) => normalized.includes(pattern)) ? "present" : "missing",
    ]),
  );
}

function normalizeAnchorSearchCorpus(body) {
  return body
    .replace(/\\"/g, '"')
    .replace(/\\u0022/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

async function readClientChunkEvidence({ body, baseUrl, resolvedAddress, teacherCookie }) {
  const urls = readClientChunkUrls(body, baseUrl).slice(0, 50);
  if (urls.length === 0) {
    return createEmptyClientChunkEvidence();
  }

  const bodies = [];
  let fetched = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      const response = await requestDeploymentResource(url, {
        method: "GET",
        headers: {
          accept: "application/javascript,text/javascript,*/*",
          ...(hasValue(teacherCookie) ? { cookie: teacherCookie } : {}),
        },
        resolvedAddress,
        timeoutMs: networkRetryPolicy.perAttemptTimeoutMs,
        redirectsRemaining: 1,
      });
      if (!response.ok) {
        failed += 1;
        continue;
      }
      bodies.push(await response.text().catch(() => ""));
      fetched += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    checked: true,
    fetched,
    failed,
    valuesRedacted: true,
    bodies,
  };
}

function createEmptyClientChunkEvidence() {
  return {
    checked: false,
    fetched: 0,
    failed: 0,
    valuesRedacted: true,
    bodies: [],
  };
}

function createPublicClientChunkEvidence(evidence) {
  return {
    checked: evidence.checked,
    fetched: evidence.fetched,
    failed: evidence.failed,
    valuesRedacted: true,
  };
}

function readClientChunkUrls(body, baseUrl) {
  const urls = new Set();
  const scriptSrcPattern = /<script\b[^>]*\bsrc=(["'])(.*?)\1/gi;
  const quotedStaticChunkPattern = /["'](\/_next\/static\/[^"']+?\.js(?:\?[^"']*)?)["']/g;
  for (const match of body.matchAll(scriptSrcPattern)) {
    const normalized = normalizeClientChunkUrl(match[2], baseUrl);
    if (normalized) {
      urls.add(normalized);
    }
  }
  for (const match of body.matchAll(quotedStaticChunkPattern)) {
    const normalized = normalizeClientChunkUrl(match[1], baseUrl);
    if (normalized) {
      urls.add(normalized);
    }
  }
  return [...urls];
}

function normalizeClientChunkUrl(value, baseUrl) {
  if (!hasValue(value) || !hasValue(baseUrl)) {
    return undefined;
  }
  try {
    const url = new URL(value, baseUrl);
    const base = new URL(baseUrl);
    if (url.origin !== base.origin) {
      return undefined;
    }
    if (!url.pathname.startsWith("/_next/static/") || !url.pathname.endsWith(".js")) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    environment: "unspecified",
    envFile: undefined,
    baseUrl: undefined,
    resolvedAddress: undefined,
    releaseRunId: undefined,
    cookie: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--environment") {
      options.environment = normalizeEnvironment(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--resolved-address") {
      options.resolvedAddress = normalizeResolvedAddress(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = normalizeReleaseRunId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--vercel-production-deployment") {
      options.vercelProductionDeployment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--cookie") {
      options.cookie = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/teacher-workflow-deployment-smoke.mjs [--dry-run] [--live --approved --base-url URL] [--resolved-address IP] [--environment production|preview|local-production|unspecified] [--env-file PATH] [--cookie COOKIE] [--release-run-id ID] [--vercel-production-deployment PATH]",
          "",
          "Outputs redacted deployed /teaching smoke JSON. Dry-run never uses network; live mode checks rendered workflow anchors without printing URLs or response bodies.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
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

function normalizeCookieHeader(value) {
  if (!hasValue(value)) {
    return undefined;
  }
  const cookie = value.trim();
  if (/[\r\n]/.test(cookie)) {
    throw new Error("Teacher workflow smoke cookie must be a single-line header value.");
  }
  return cookie;
}

function normalizeResolvedAddress(value) {
  const resolvedAddress = value.trim();
  if (!/^[A-Za-z0-9:.]+$/.test(resolvedAddress)) {
    throw new Error("--resolved-address must be a non-secret IP address or host literal.");
  }
  return resolvedAddress;
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

function readJsonEvidence(evidencePath) {
  if (!evidencePath) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch {
    return null;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function classifyNetworkError(error) {
  const errorClass =
    error instanceof Error && hasValue(error.name) ? error.name : "UnknownError";
  return {
    class: sanitizeErrorClass(errorClass),
    valueRedacted: true,
  };
}

function describeNetworkAddressOverride(resolvedAddress) {
  if (!hasValue(resolvedAddress)) {
    return {
      status: "disabled",
      valueRedacted: true,
    };
  }

  return {
    status: "enabled",
    addressSource: "pinned",
    valueRedacted: true,
  };
}

async function requestDeploymentResource(
  resourceUrl,
  { method = "GET", headers = {}, resolvedAddress, timeoutMs, redirectsRemaining = 3 } = {},
) {
  const originalUrl = new URL(resourceUrl);
  const request = originalUrl.protocol === "https:" ? httpsRequest : httpRequest;
  if (originalUrl.protocol !== "https:" && originalUrl.protocol !== "http:") {
    throw createRedactedRequestError();
  }

  const requestHeaders = { ...headers };
  if (hasValue(resolvedAddress)) {
    requestHeaders.host = originalUrl.host;
  }

  return new Promise((resolve, reject) => {
    const clientRequest = request(
      {
        protocol: originalUrl.protocol,
        hostname: hasValue(resolvedAddress) ? resolvedAddress : originalUrl.hostname,
        port: originalUrl.port || undefined,
        path: `${originalUrl.pathname}${originalUrl.search}`,
        method,
        headers: requestHeaders,
        ...(originalUrl.protocol === "https:" ? { servername: originalUrl.hostname } : {}),
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          const status = response.statusCode ?? 0;
          const location = readHeader(response.headers, "location");
          if (
            redirectsRemaining > 0 &&
            [301, 302, 303, 307, 308].includes(status) &&
            hasValue(location)
          ) {
            resolve(
              requestDeploymentResource(new URL(location, originalUrl).toString(), {
                method: status === 303 ? "GET" : method,
                headers,
                resolvedAddress,
                timeoutMs,
                redirectsRemaining: redirectsRemaining - 1,
              }),
            );
            return;
          }

          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: createHeaderAccessor(response.headers),
            text: async () => body.toString("utf8"),
            arrayBuffer: async () =>
              body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
            json: async () => JSON.parse(body.toString("utf8")),
          });
        });
      },
    );

    clientRequest.on("error", () => reject(createRedactedRequestError()));
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      clientRequest.setTimeout(timeoutMs, () => {
        clientRequest.destroy(createRedactedRequestError());
      });
    }
    clientRequest.end();
  });
}

function createHeaderAccessor(headers) {
  return {
    get(name) {
      return readHeader(headers, name);
    },
  };
}

function readHeader(headers, name) {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return typeof value === "string" ? value : null;
}

function createRedactedRequestError() {
  return new TypeError("request failed");
}

function sanitizeErrorClass(value) {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]/g, "-");
  return normalized === "" ? "UnknownError" : normalized.slice(0, 80);
}

function describeDeploymentOrigin(baseUrl) {
  const originClass = classifyDeploymentOrigin(baseUrl);
  return {
    status: originClass === "missing" ? "missing" : "present",
    originClass,
    valueRedacted: true,
  };
}

function classifyDeploymentOrigin(baseUrl) {
  if (!hasValue(baseUrl)) {
    return "missing";
  }

  try {
    const origin = new URL(baseUrl);
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

function createDeploymentFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return { status: "missing" };
  }

  try {
    const origin = new URL(baseUrl).origin.toLowerCase();
    return {
      status: "present",
      value: `sha256:${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`,
    };
  } catch {
    return { status: "missing" };
  }
}

function createRenderedPageFingerprint(body) {
  if (!hasValue(body)) {
    return { status: "missing" };
  }

  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(body).digest("hex").slice(0, 16)}`,
  };
}
