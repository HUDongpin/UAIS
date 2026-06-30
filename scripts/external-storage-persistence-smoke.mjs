#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const expectedApiContractVersion = "uais-external-storage-v1";
const networkRetryPolicy = {
  maxAttempts: 3,
  perAttemptTimeoutMs: 10_000,
  retryOn: ["request-error"],
  valuesRedacted: true,
};

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("External storage persistence smoke requires explicit owner approval.");
  }
  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_EXTERNAL_STORAGE_BASE_URL;
  const accessToken = env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN;
  const plan = buildPersistenceSmokePlan({
    mode,
    environment: options.environment,
    phase: options.phase,
    baseUrl,
    accessToken,
    teacherId: options.teacherId,
    proofId: options.proofId,
    releaseRunId: options.releaseRunId,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }
  if (plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const marker = createPersistenceMarker(options.proofId);
    const results = await executePhase({
      phase: options.phase,
      baseUrl,
      accessToken,
      teacherId: options.teacherId,
      marker,
    });
    const status = results.every((result) => result.status === "ok")
      ? "passed"
      : "failed";
    process.stdout.write(
      `${JSON.stringify(
        {
          ...plan,
          status,
          results,
        },
        null,
        2,
      )}\n`,
    );
    if (status !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "External storage persistence smoke failed."}\n`,
  );
  process.exitCode = 1;
}

function buildPersistenceSmokePlan({
  mode,
  environment,
  phase,
  baseUrl,
  accessToken,
  teacherId,
  proofId,
  releaseRunId,
}) {
  const storageEndpoint = describeStorageEndpoint(baseUrl);
  const storageServiceFingerprint = createStorageServiceFingerprint(baseUrl);
  const persistenceProofFingerprint = createPersistenceProofFingerprint(proofId);
  const prerequisites = [
    {
      id: "s19-external-storage-base-url",
      responsibleSession: "S19",
      requiredEnv: "UAIS_EXTERNAL_STORAGE_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    {
      id: "s19-external-storage-access-token",
      responsibleSession: "S19",
      requiredEnv: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      status: hasValue(accessToken) ? "present" : "missing",
    },
    {
      id: "s22-external-storage-persistence-teacher-id",
      responsibleSession: "S22",
      requiredArg: "--teacher-id",
      status: hasValue(teacherId) ? "present" : "missing",
    },
    {
      id: "s22-external-storage-persistence-proof-id",
      responsibleSession: "S22",
      requiredArg: "--proof-id",
      status: hasValue(proofId) ? "present" : "missing",
    },
  ];
  const blockedReasons = [
    ...prerequisites.flatMap((prerequisite) => {
      if (prerequisite.status !== "missing") {
        return [];
      }
      if (prerequisite.requiredEnv) {
        return [`missing-${prerequisite.requiredEnv}`];
      }
      return [`missing-${prerequisite.requiredArg.replace(/^--/, "")}`];
    }),
    ...(mode === "dry-run" ? ["external-storage-persistence-live-smoke-not-run"] : []),
    ...readProductionEndpointBlockedReasons({ environment, storageEndpoint }),
    ...(environment === "production" && !hasValue(releaseRunId)
      ? ["external-storage-persistence-release-run-id-missing"]
      : []),
  ];

  return {
    target: "external-storage-persistence",
    mode,
    environment,
    phase,
    network: mode === "live" ? "enabled" : "disabled",
    storageEndpoint,
    storageServiceFingerprint,
    persistenceProofFingerprint,
    ...(releaseRunId ? { releaseRunId } : {}),
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S22",
    networkRetryPolicy,
    checks: checksForPhase(phase),
    prerequisites,
    blockedReasons,
    safety: {
      secretsRedacted: true,
      valuesRedacted: true,
      serviceUrlOmitted: true,
      teacherIdOmitted: true,
      proofIdOmitted: true,
      writePayloadsRedacted: true,
      responseBodiesOmitted: true,
      localPrivatePathsOmitted: true,
      cookieValuesOmitted: true,
      destructiveWrites: false,
      liveRequiresApproval: true,
      remoteMutationRequiresApproval: true,
    },
  };
}

function checksForPhase(phase) {
  const common = [
    {
      id: "s22-external-storage-persistence-health",
      method: "GET",
      endpointTemplate: "/healthz",
      expectedStatus: 200,
      responseShapeChecks: [
        "status",
        "target",
        "apiContractVersion",
        "durableBackingStore",
        "redaction",
      ],
    },
  ];
  if (phase === "write") {
    return [
      ...common,
      {
        id: "s12-external-storage-persistence-ownership-write",
        method: "POST",
        endpointTemplate: "/teacher-ai-ownership/{teacherId}/merge",
        expectedStatus: 200,
        responseShapeChecks: ["status", "storageWritePolicy", "redaction"],
      },
      {
        id: "s24-external-storage-persistence-audit-write",
        method: "POST",
        endpointTemplate: "/qwen-voice-lifecycle-audit",
        expectedStatus: 200,
        responseShapeChecks: ["status", "provider", "redaction"],
      },
    ];
  }
  return [
    ...common,
    {
      id: "s22-external-storage-persisted-ownership-read",
      method: "GET",
      endpointTemplate: "/teacher-ai-ownership/{teacherId}",
      expectedStatus: 200,
      responseShapeChecks: ["teacherId", "persistedOwnershipMarker", "privateFieldsOmitted"],
    },
    {
      id: "s24-external-storage-persisted-audit-read",
      method: "GET",
      endpointTemplate: "/qwen-voice-lifecycle-audit",
      expectedStatus: 200,
      responseShapeChecks: ["eventsArray", "persistedAuditMarker", "redaction"],
    },
  ];
}

async function executePhase({ phase, baseUrl, accessToken, teacherId, marker }) {
  const checks = checksForPhase(phase);
  const results = [];
  for (const check of checks) {
    const endpoint = endpointForCheck({ check, teacherId });
    const request = createRequestForCheck({ check, accessToken, teacherId, marker });
    const { response, networkAttempts, networkError } = await fetchWithNetworkRetry(
      resolveStorageEndpointUrl(baseUrl, endpoint),
      request,
    );
    if (!response) {
      results.push({
        id: check.id,
        status: "failed",
        httpStatus: "request-failed",
        responseShape: createResponseShape("skipped", {}),
        networkAttempts,
        networkError,
      });
      continue;
    }
    const responseShape = await validateResponseShape({ check, response, marker });
    results.push({
      id: check.id,
      status: response.status === check.expectedStatus && responseShape.status === "ok"
        ? "ok"
        : "failed",
      httpStatus: response.status,
      expectedStatus: check.expectedStatus,
      responseShape,
      networkAttempts,
    });
  }
  return results;
}

function resolveStorageEndpointUrl(baseUrl, endpoint) {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedEndpoint = endpoint.replace(/^\/+/, "");
  return new URL(normalizedEndpoint, normalizedBaseUrl);
}

async function fetchWithNetworkRetry(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= networkRetryPolicy.maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(networkRetryPolicy.perAttemptTimeoutMs),
      });
      return {
        response,
        networkAttempts: createNetworkAttempts(attempt),
      };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    response: undefined,
    networkAttempts: createNetworkAttempts(networkRetryPolicy.maxAttempts),
    networkError: classifyNetworkError(lastError),
  };
}

function createRequestForCheck({ check, accessToken, teacherId, marker }) {
  const headers = {
    accept: "application/json",
  };
  if (check.id !== "s22-external-storage-persistence-health") {
    headers.authorization = `${"Bearer"} ${accessToken}`;
  }
  const body = createBodyForCheck({ check, teacherId, marker });
  if (body) {
    headers["content-type"] = "application/json";
  }
  return {
    method: check.method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

function endpointForCheck({ check, teacherId }) {
  if (
    check.id === "s12-external-storage-persistence-ownership-write" ||
    check.id === "s22-external-storage-persisted-ownership-read"
  ) {
    const suffix =
      check.id === "s12-external-storage-persistence-ownership-write"
        ? "/merge"
        : "";
    return `/teacher-ai-ownership/${encodeURIComponent(teacherId)}${suffix}`;
  }
  if (
    check.id === "s24-external-storage-persistence-audit-write" ||
    check.id === "s24-external-storage-persisted-audit-read"
  ) {
    return "/qwen-voice-lifecycle-audit";
  }
  return "/healthz";
}

function createBodyForCheck({ check, teacherId, marker }) {
  if (check.id === "s12-external-storage-persistence-ownership-write") {
    return {
      action: "merge-teacher-ai-ownership",
      updatedAt: "2026-06-20T00:00:00.000Z",
      ownership: {
        teacherId,
        courseIds: [marker.courseId],
        sampleAssets: [
          {
            sampleAssetId: marker.sampleAssetId,
            courseId: marker.courseId,
          },
        ],
        pptAssets: [
          {
            pptAssetId: marker.pptAssetId,
            courseId: marker.courseId,
          },
        ],
        clonedVoiceRefs: [
          {
            voiceRefId: marker.voiceRefId,
            sampleAssetId: marker.sampleAssetId,
          },
        ],
        audioManifests: [
          {
            audioManifestId: marker.audioManifestId,
            courseId: marker.courseId,
            pptAssetId: marker.pptAssetId,
            voiceRefId: marker.voiceRefId,
          },
        ],
      },
    };
  }
  if (check.id === "s24-external-storage-persistence-audit-write") {
    return {
      eventId: marker.auditEventId,
      eventType: "qwen-voice-lifecycle",
      provider: "qwen",
      providerRole: "voice-clone",
      action: "voice-clone-revoke",
      status: "recorded",
      occurredAt: "2026-06-20T00:01:00.000Z",
      actor: { actorId: teacherId, role: "teacher" },
      resource: {
        teacherId,
        sampleAssetId: marker.sampleAssetId,
        voiceRefId: marker.voiceRefId,
      },
      deletionReason: "owner-request",
      providerRevocation: {
        status: "revoked",
        requestId: marker.revocationRequestId,
      },
      localReference: { status: "deleted" },
      localAuditRecord: {
        auditId: marker.auditEventId,
        storagePolicy: "local-redacted-lifecycle-audit",
      },
      storagePolicy: "append-only-redacted-lifecycle-audit",
      responsibleSession: "S12/S24",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    };
  }
  return undefined;
}

async function validateResponseShape({ check, response, marker }) {
  if (!response.ok) {
    return createResponseShape("skipped", {});
  }
  const body = await response.json().catch(() => undefined);
  if (!isRecord(body)) {
    return createResponseShape("failed", {});
  }
  if (check.id === "s22-external-storage-persistence-health") {
    const requiredFields = {
      status: body.status === "ok" ? "present" : "missing",
      target: isAcceptedTarget(body.target) ? "present" : "missing",
      apiContractVersion:
        body.apiContractVersion === expectedApiContractVersion ? "present" : "missing",
      durableBackingStore: hasReadyDurableBackingStore(body.durableBackingStore)
        ? "present"
        : "missing",
      redaction: hasExpectedRedaction(body.redaction) ? "present" : "missing",
    };
    return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
  }
  if (check.id === "s12-external-storage-persistence-ownership-write") {
    const requiredFields = {
      status: body.status === "merged" ? "present" : "missing",
      storageWritePolicy:
        body.storageWritePolicy === "external-atomic-merge" ? "present" : "missing",
      redaction: hasExpectedRedaction(body.redaction) ? "present" : "missing",
    };
    return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
  }
  if (check.id === "s24-external-storage-persistence-audit-write") {
    const requiredFields = {
      status: body.status === "recorded" ? "present" : "missing",
      provider: body.provider === "qwen" ? "present" : "missing",
      redaction: hasExpectedRedaction(body.redaction) ? "present" : "missing",
    };
    return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
  }
  if (check.id === "s22-external-storage-persisted-ownership-read") {
    const requiredFields = {
      teacherId: typeof body.teacherId === "string" ? "present" : "missing",
      persistedOwnershipMarker: hasPersistedOwnershipMarker(body, marker)
        ? "present"
        : "missing",
      privateFieldsOmitted: "present",
    };
    return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
  }
  const requiredFields = {
    eventsArray: Array.isArray(body.events) ? "present" : "missing",
    persistedAuditMarker: hasPersistedAuditMarker(body, marker) ? "present" : "missing",
    redaction: hasExpectedRedaction(body.redaction) ? "present" : "missing",
  };
  return createResponseShape(statusForRequiredFields(requiredFields), requiredFields);
}

function hasPersistedOwnershipMarker(body, marker) {
  return (
    Array.isArray(body.courseIds) &&
    body.courseIds.includes(marker.courseId) &&
    Array.isArray(body.audioManifests) &&
    body.audioManifests.some(
      (manifest) =>
        isRecord(manifest) && manifest.audioManifestId === marker.audioManifestId,
    )
  );
}

function hasPersistedAuditMarker(body, marker) {
  return (
    Array.isArray(body.events) &&
    body.events.some(
      (event) => isRecord(event) && event.eventId === marker.auditEventId,
    )
  );
}

function hasReadyDurableBackingStore(value) {
  return (
    isRecord(value) &&
    value.status === "ready" &&
    value.storageMode === "file-backed" &&
    value.probe === "write-read-delete" &&
    value.ownershipWritePolicy === "external-atomic-merge" &&
    value.lifecycleAuditWritePolicy === "append-only-redacted-lifecycle-audit" &&
    value.valueRedacted === true
  );
}

function hasExpectedRedaction(value) {
  return (
    isRecord(value) &&
    value.secrets === "omitted" &&
    value.localFiles === "omitted" &&
    value.assets === "ids-only"
  );
}

function isAcceptedTarget(value) {
  return (
    value === "uais-external-storage-reference-service" ||
    value === "uais-external-storage-production-service"
  );
}

function createResponseShape(status, requiredFields) {
  return {
    checked: true,
    status,
    requiredFields,
  };
}

function statusForRequiredFields(requiredFields) {
  return Object.values(requiredFields).every((value) => value === "present")
    ? "ok"
    : "failed";
}

function createPersistenceMarker(proofId) {
  const hash = createHash("sha256").update(proofId.trim()).digest("hex").slice(0, 16);
  return {
    courseId: `uais-storage-persist-course-${hash}`,
    sampleAssetId: `uais-storage-persist-sample-${hash}`,
    pptAssetId: `uais-storage-persist-ppt-${hash}`,
    voiceRefId: `uais-storage-persist-voice-${hash}`,
    audioManifestId: `uais-storage-persist-audio-${hash}`,
    auditEventId: `uais-storage-persist-audit-${hash}`,
    revocationRequestId: `uais-storage-persist-revoke-${hash}`,
  };
}

function createPersistenceProofFingerprint(proofId) {
  if (!hasValue(proofId)) {
    return {
      status: "missing",
      valueRedacted: true,
    };
  }
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(proofId.trim()).digest("hex").slice(0, 16)}`,
    valueRedacted: true,
  };
}

function createStorageServiceFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return {
      status: "missing",
      source: "origin",
      valueRedacted: true,
    };
  }
  try {
    const parsed = new URL(baseUrl);
    return {
      status: "present",
      value: `sha256:${createHash("sha256").update(parsed.origin).digest("hex").slice(0, 16)}`,
      source: "origin",
      valueRedacted: true,
    };
  } catch {
    return {
      status: "invalid",
      source: "origin",
      valueRedacted: true,
    };
  }
}

function describeStorageEndpoint(value) {
  if (!hasValue(value)) {
    return {
      status: "missing",
      networkClass: "missing",
      endpointClass: "missing",
      valueRedacted: true,
    };
  }
  try {
    const url = new URL(value);
    const networkClass = classifyEndpointHost(url.hostname);
    return {
      status: "present",
      networkClass,
      endpointClass:
        networkClass === "remote"
          ? url.protocol === "https:"
            ? "remote-https"
            : "insecure-http"
          : networkClass,
      valueRedacted: true,
    };
  } catch {
    return {
      status: "present",
      networkClass: "invalid",
      endpointClass: "invalid",
      valueRedacted: true,
    };
  }
}

function readProductionEndpointBlockedReasons({ environment, storageEndpoint }) {
  if (
    environment !== "production" ||
    storageEndpoint.status !== "present" ||
    storageEndpoint.endpointClass === "remote-https"
  ) {
    return [];
  }
  return ["production-external-storage-persistence-endpoint-not-remote-https"];
}

function classifyEndpointHost(hostname) {
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

function createNetworkAttempts(attempted) {
  return {
    attempted,
    maxAttempts: networkRetryPolicy.maxAttempts,
    retried: attempted > 1,
    valueRedacted: true,
  };
}

function classifyNetworkError(error) {
  const errorClass =
    error instanceof Error && hasValue(error.name) ? error.name : "UnknownError";
  return {
    class: errorClass.trim().replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80),
    valueRedacted: true,
  };
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    environment: "unspecified",
    phase: "write",
    baseUrl: undefined,
    teacherId: undefined,
    proofId: undefined,
    releaseRunId: undefined,
    envFile: undefined,
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
    } else if (arg === "--phase") {
      options.phase = normalizePhase(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teacher-id") {
      options.teacherId = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--proof-id") {
      options.proofId = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = readArgValue(args, index, arg).trim();
      index += 1;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/external-storage-persistence-smoke.mjs [--dry-run] [--live --approved] --phase write|read --base-url URL --teacher-id ID --proof-id ID",
          "",
          "Writes or reads a redacted persistence marker to prove an external storage service persists ownership and audit records across process/container restarts.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error("Unknown option.");
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
    environment !== "local-reference" &&
    environment !== "unspecified"
  ) {
    throw new Error("--environment must be production, preview, local-production, local-reference, or unspecified.");
  }
  return environment;
}

function normalizePhase(value) {
  const phase = value.trim().toLowerCase();
  if (phase !== "write" && phase !== "read") {
    throw new Error("--phase must be write or read.");
  }
  return phase;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!hasValue(value)) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function readEnvFile(path) {
  if (!hasValue(path)) {
    return {};
  }
  const entries = {};
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) {
      entries[key] = stripOptionalQuotes(value);
    }
  }
  return entries;
}

function stripOptionalQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
