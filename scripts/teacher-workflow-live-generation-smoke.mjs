#!/usr/bin/env node

import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const route = "/teaching";
const teacherAuthIssuerProofTtlSeconds = 300;
const defaultTeacherId = "s22-live-generation-teacher";
const liveApprovalHeader = "x-uais-live-ai-approval";
const acceptedTeacherAuthProviderModes = ["trusted-cookie-issuer", "oidc-jwks"];
const requiredResultKeys = [
  "signedSessionBootstrap",
  "voiceSampleSubmit",
  "voiceClonePreflight",
  "voiceCloneStatusSucceeded",
  "pptNarrationSubmit",
  "generatedAudioManifest",
  "generatedZipExport",
  "perSlideAudioDownload",
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Teacher workflow live generation smoke requires explicit owner approval.");
  }
  if (options.live && options.environment === "production" && !hasValue(options.releaseRunId)) {
    throw new Error("Teacher workflow live generation smoke requires --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_DEPLOYMENT_BASE_URL;
  const externalStorageBaseUrl = env.UAIS_EXTERNAL_STORAGE_BASE_URL;
  const vercelProductionDeployment = readJsonEvidence(options.vercelProductionDeployment);
  const teacherAuthProviderReadiness = readJsonEvidence(options.teacherAuthProviderReadiness);
  const externalStorageServiceReadiness = readJsonEvidence(
    options.externalStorageServiceReadiness,
  );
  const plan = buildPlan({
    mode,
    environment: options.environment,
    baseUrl,
    externalStorageBaseUrl,
    env,
    releaseRunId: options.releaseRunId,
    vercelProductionDeployment,
    teacherAuthProviderReadiness,
    externalStorageServiceReadiness,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const result = await executeLiveGenerationSmoke({
      baseUrl,
      env,
      releaseRunId: options.releaseRunId,
    });
    const evidence = createLiveEvidence({ plan, result });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (evidence.status !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${
      error instanceof Error
        ? error.message
        : "Teacher workflow live generation smoke failed."
    }\n`,
  );
  process.exitCode = 1;
}

function buildPlan({
  mode,
  environment,
  baseUrl,
  externalStorageBaseUrl,
  env,
  releaseRunId,
  vercelProductionDeployment,
  teacherAuthProviderReadiness,
  externalStorageServiceReadiness,
}) {
  const deploymentOrigin = describeDeploymentOrigin(baseUrl);
  const deploymentFingerprint = createDeploymentFingerprint(baseUrl);
  const storageServiceFingerprint = createStorageServiceFingerprint(externalStorageBaseUrl);
  const vercelProductionDeploymentEvidence =
    vercelProductionDeployment === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        }
      : evaluateVercelProductionDeploymentEvidence({
          evidence: vercelProductionDeployment,
          deploymentFingerprint,
          releaseRunId,
        });
  const teacherAuthProviderReadinessEvidence =
    teacherAuthProviderReadiness === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          authProviderMode: "missing",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        }
      : evaluateTeacherAuthProviderReadinessEvidence({
          evidence: teacherAuthProviderReadiness,
          releaseRunId,
        });
  const externalStorageServiceReadinessEvidence =
    externalStorageServiceReadiness === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          valueRedacted: true,
          releaseRunIdStatus: "missing",
        }
      : evaluateExternalStorageServiceReadinessEvidence({
          evidence: externalStorageServiceReadiness,
          releaseRunId,
          storageServiceFingerprint,
        });
  const prerequisites = [
    {
      id: "s22-deployment-base-url",
      responsibleSession: "S22",
      requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    ...createLivePrerequisites({ env, mode }),
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
    ...(teacherAuthProviderReadinessEvidence
      ? [
          {
            id: "s22-teacher-auth-provider-readiness-evidence",
            responsibleSession: "S22",
            requiredEvidence: "teacher-auth-provider-readiness",
            status: teacherAuthProviderReadinessEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
    ...(externalStorageServiceReadinessEvidence
      ? [
          {
            id: "s22-external-storage-service-readiness-evidence",
            responsibleSession: "S22",
            requiredEvidence: "external-storage-service-readiness",
            status: externalStorageServiceReadinessEvidence.status,
            valueRedacted: true,
          },
        ]
      : []),
  ];
  const blockedReasons = [
    ...prerequisites.flatMap((prerequisite) =>
      readPrerequisiteBlockedReason(prerequisite),
    ),
    ...readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }),
    ...readVercelProductionDeploymentBlockedReasons(vercelProductionDeploymentEvidence),
    ...readTeacherAuthProviderReadinessBlockedReasons(teacherAuthProviderReadinessEvidence),
    ...readExternalStorageServiceReadinessBlockedReasons(
      externalStorageServiceReadinessEvidence,
    ),
  ];

  return {
    target: "teacher-workflow-live-generation-smoke",
    mode,
    environment,
    network: mode === "live" ? "enabled" : "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S22",
    ...(releaseRunId ? { releaseRunId } : {}),
    route,
    deploymentFingerprint,
    deploymentOrigin,
    storageServiceFingerprint,
    ...(vercelProductionDeploymentEvidence
      ? { vercelProductionDeploymentEvidence }
      : {}),
    ...(teacherAuthProviderReadinessEvidence
      ? { teacherAuthProviderReadinessEvidence }
      : {}),
    ...(externalStorageServiceReadinessEvidence
      ? { externalStorageServiceReadinessEvidence }
      : {}),
    liveGenerationInteractions: [
      "issue-signed-teacher-ai-session",
      "submit-live-voice-sample",
      "run-live-provider-preflight",
      "poll-live-voice-clone-status",
      "submit-live-ppt-narration",
      "verify-generated-audio-manifest",
      "verify-generated-export-download",
      "verify-generated-per-slide-audio-download",
    ],
    providerMutationPolicy: {
      workflowApis: "live-workflow-status",
      remoteMutations: "live-provider-approved",
      liveProviderApproved: true,
      responseBodiesOmitted: true,
      providerTaskIdsRedacted: true,
    },
    prerequisites,
    blockedReasons,
    safety: createSafety(),
  };
}

function createLivePrerequisites({ env, mode }) {
  const liveStatus = (value) =>
    mode === "live" ? (hasValue(value) ? "present" : "missing") : "required-for-live";
  return [
    {
      id: "s12-teacher-auth-session-signing-secret",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      status: liveStatus(env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET),
      valueRedacted: true,
    },
    {
      id: "s12-ai-access-signing-secret",
      responsibleSession: "S12",
      requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
      status: liveStatus(env.UAIS_AI_ACCESS_SIGNING_SECRET),
      valueRedacted: true,
    },
    {
      id: "s12-teacher-auth-issuer-secret",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      status: liveStatus(env.UAIS_TEACHER_AUTH_ISSUER_SECRET),
      valueRedacted: true,
    },
    {
      id: "s19-dashscope-api-key",
      responsibleSession: "S19",
      requiredEnv: "DASHSCOPE_API_KEY",
      status: liveStatus(env.DASHSCOPE_API_KEY),
      valueRedacted: true,
    },
    {
      id: "s19-live-ai-approval-token",
      responsibleSession: "S19",
      requiredEnv: "UAIS_LIVE_AI_APPROVAL_TOKEN",
      status: liveStatus(env.UAIS_LIVE_AI_APPROVAL_TOKEN),
      valueRedacted: true,
    },
    {
      id: "s24-approved-teacher-voice-sample",
      responsibleSession: "S24",
      requiredEnv: "UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_AUDIO_BASE64",
      alternativeEnv: "UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_AUDIO_BASE64_FILE",
      status: liveStatus(
        env.UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_AUDIO_BASE64 ??
          env.UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_AUDIO_BASE64_FILE,
      ),
      valueRedacted: true,
    },
  ];
}

async function executeLiveGenerationSmoke({ baseUrl, env, releaseRunId }) {
  const results = Object.fromEntries(requiredResultKeys.map((key) => [key, "pending"]));
  const normalizedBaseUrl = stripTrailingSlashes(baseUrl);
  const resource = createLiveGenerationResource({ env, releaseRunId });
  const sampleAudioBase64 = readLiveSampleAudioBase64(env);
  const liveApprovalToken = requireEnv(env, "UAIS_LIVE_AI_APPROVAL_TOKEN");
  const teacherAuth = await issueTeacherAuthCookies({
    baseUrl: normalizedBaseUrl,
    env,
    teacherId: resource.teacherId,
  });
  const cookies = teacherAuth.cookieHeader;
  const voiceSampleSession = await issueTeacherAiSession({
    baseUrl: normalizedBaseUrl,
    cookies,
    action: "voice-sample-submit",
    resource: {
      teacherId: resource.teacherId,
      sampleAssetId: resource.sampleAssetId,
    },
  });
  results.signedSessionBootstrap = "passed";

  const voiceSample = await postJson({
    url: `${normalizedBaseUrl}/api/ai/voice-sample`,
    headers: {
      ...voiceSampleSession.headers,
      [liveApprovalHeader]: liveApprovalToken,
    },
    body: {
      executionMode: "live",
      liveProviderApproved: true,
      teacherId: resource.teacherId,
      consentConfirmed: true,
      consentScope: "ppt-narration",
      sampleAssetId: resource.sampleAssetId,
      sampleDurationSeconds: resource.sampleDurationSeconds,
      mimeType: "audio/wav",
      sourceKind: "owner-provided",
      language: resource.language,
      targetVoiceLabel: resource.targetVoiceLabel,
      sampleAudioBase64,
      sampleText: resource.sampleText,
      languageHint: resource.language,
    },
  });
  results.voiceSampleSubmit = voiceSample.ok ? "passed" : "failed";

  const preflightSession = await issueTeacherAiSession({
    baseUrl: normalizedBaseUrl,
    cookies,
    action: "voice-clone-preflight",
    resource: {
      teacherId: resource.teacherId,
      sampleAssetId: resource.sampleAssetId,
    },
  });
  const preflight = await postJson({
    url: `${normalizedBaseUrl}/api/ai/voice-clone/preflight`,
    headers: {
      ...preflightSession.headers,
      [liveApprovalHeader]: liveApprovalToken,
    },
    body: {
      liveProviderApproved: true,
      teacherId: resource.teacherId,
      consentConfirmed: true,
      consentScope: "ppt-narration",
      sampleAssetId: resource.sampleAssetId,
      sampleDurationSeconds: resource.sampleDurationSeconds,
      mimeType: "audio/wav",
      sourceKind: "owner-provided",
      language: resource.language,
      targetVoiceLabel: resource.targetVoiceLabel,
    },
  });
  results.voiceClonePreflight = preflight.ok && isPreflightReady(preflight.body)
    ? "passed"
    : "failed";

  const providerTaskId = readString(voiceSample.body?.voiceCloneSubmission?.taskId);
  const voiceRefIdFromSubmit = readString(voiceSample.body?.voiceCloneReference?.voiceRefId);
  const statusResult =
    voiceRefIdFromSubmit
      ? { voiceRefId: voiceRefIdFromSubmit, ready: true }
      : await pollVoiceCloneStatus({
          baseUrl: normalizedBaseUrl,
          cookies,
          env,
          liveApprovalToken,
          providerTaskId,
          resource,
        });
  const voiceRefId = statusResult.voiceRefId;
  results.voiceCloneStatusSucceeded = statusResult.ready ? "passed" : "failed";

  const pptSession = await issueTeacherAiSession({
    baseUrl: normalizedBaseUrl,
    cookies,
    action: "ppt-narration-submit",
    resource: {
      teacherId: resource.teacherId,
      courseId: resource.courseId,
      sampleAssetId: resource.sampleAssetId,
      pptAssetId: resource.pptAssetId,
      voiceRefId,
    },
  });
  const pptNarration = await postJson({
    url: `${normalizedBaseUrl}/api/ai/ppt-narration`,
    headers: {
      ...pptSession.headers,
      [liveApprovalHeader]: liveApprovalToken,
    },
    body: {
      executionMode: "live",
      liveProviderApproved: true,
      voiceClone: {
        teacherId: resource.teacherId,
        consentConfirmed: true,
        sampleAssetId: resource.sampleAssetId,
        sampleDurationSeconds: resource.sampleDurationSeconds,
        language: resource.language,
        targetVoiceLabel: resource.targetVoiceLabel,
      },
      pptNarration: {
        courseId: resource.courseId,
        pptAssetId: resource.pptAssetId,
        clonedVoiceRef: voiceRefId,
        language: resource.language,
        slideScripts: resource.slideScripts,
        targetModel: resource.targetModel,
      },
    },
  });
  results.pptNarrationSubmit = pptNarration.ok ? "passed" : "failed";
  const manifestId = readString(pptNarration.body?.pptNarrationAssets?.id);
  const firstAudioId = readString(pptNarration.body?.pptNarrationAssets?.assets?.[0]?.audioId);
  results.generatedAudioManifest = manifestId && firstAudioId ? "passed" : "failed";

  const downloadSession = await issueTeacherAiSession({
    baseUrl: normalizedBaseUrl,
    cookies,
    action: "ppt-narration-export-download",
    resource: {
      teacherId: resource.teacherId,
      courseId: resource.courseId,
      pptAssetId: resource.pptAssetId,
      voiceRefId,
      audioManifestId: manifestId,
    },
  });
  const exportDownload = await getResource({
    url: `${normalizedBaseUrl}/api/ai/ppt-narration/export/${encodeURIComponent(manifestId)}`,
    headers: downloadSession.headers,
  });
  results.generatedZipExport = exportDownload.ok ? "passed" : "failed";

  const audioSession = await issueTeacherAiSession({
    baseUrl: normalizedBaseUrl,
    cookies,
    action: "ppt-narration-audio-download",
    resource: {
      teacherId: resource.teacherId,
      courseId: resource.courseId,
      pptAssetId: resource.pptAssetId,
      voiceRefId,
      audioManifestId: manifestId,
      audioId: firstAudioId,
    },
  });
  const audioDownload = await getResource({
    url: `${normalizedBaseUrl}/api/ai/ppt-narration/audio/${encodeURIComponent(
      manifestId,
    )}/${encodeURIComponent(firstAudioId)}`,
    headers: audioSession.headers,
  });
  results.perSlideAudioDownload = audioDownload.ok ? "passed" : "failed";

  const allPassed = Object.values(results).every((value) => value === "passed");
  return {
    status: allPassed ? "passed" : "failed",
    auth: teacherAuth.auth,
    results,
    providerEvidence: {
      voiceCloneSubmission: providerTaskId ? "present-redacted" : "missing",
      voiceCloneReference: voiceRefId ? "present-redacted" : "missing",
      pptNarrationSubmission: pptNarration.ok ? "present-redacted" : "missing",
      audioManifest: manifestId ? "present-redacted" : "missing",
      valuesRedacted: true,
    },
    blockedReasons: allPassed
      ? []
      : ["teacher-workflow-live-generation-interaction-failed"],
  };
}

async function pollVoiceCloneStatus({
  baseUrl,
  cookies,
  env,
  liveApprovalToken,
  providerTaskId,
  resource,
}) {
  if (!providerTaskId) {
    return { ready: false };
  }
  const attempts = readPositiveInteger(env.UAIS_TEACHER_WORKFLOW_LIVE_STATUS_ATTEMPTS, 12);
  const delayMs = readPositiveInteger(env.UAIS_TEACHER_WORKFLOW_LIVE_STATUS_DELAY_MS, 10_000);
  for (let index = 0; index < attempts; index += 1) {
    const statusSession = await issueTeacherAiSession({
      baseUrl,
      cookies,
      action: "voice-clone-status",
      resource: {
        teacherId: resource.teacherId,
        sampleAssetId: resource.sampleAssetId,
      },
    });
    const response = await postJson({
      url: `${baseUrl}/api/ai/voice-clone/status`,
      headers: {
        ...statusSession.headers,
        [liveApprovalHeader]: liveApprovalToken,
      },
      body: {
        executionMode: "live",
        liveProviderApproved: true,
        providerTaskId,
        teacherId: resource.teacherId,
        sampleAssetId: resource.sampleAssetId,
      },
    });
    const voiceRefId = readString(response.body?.voiceCloneReference?.voiceRefId);
    if (response.ok && voiceRefId) {
      return { ready: true, voiceRefId };
    }
    if (index + 1 < attempts) {
      await wait(delayMs);
    }
  }
  return { ready: false };
}

function createLiveEvidence({ plan, result }) {
  return {
    ...plan,
    ...result,
    status: plan.status === "ready" && result.status === "passed" ? "passed" : "failed",
    providerMutationPolicy: {
      workflowApis: "live-workflow-status",
      remoteMutations: "live-provider-approved",
      liveProviderApproved: true,
      responseBodiesOmitted: true,
      providerTaskIdsRedacted: true,
    },
    safety: createSafety(),
  };
}

async function issueTeacherAuthCookies({ baseUrl, env, teacherId }) {
  const response = await postJson({
    url: `${baseUrl}/api/ai/teacher-auth/issue`,
    headers: {
      ...createSignedAdminHeaders({
        actorId: "s22-live-generation-admin",
        secret: requireEnv(env, "UAIS_AI_ACCESS_SIGNING_SECRET"),
      }),
      ...createTrustedTeacherAuthIssuerHeaders({
        teacherId,
        secret: requireEnv(env, "UAIS_TEACHER_AUTH_ISSUER_SECRET"),
      }),
    },
    body: {
      teacherId,
      ttlSeconds: teacherAuthIssuerProofTtlSeconds,
    },
  });
  if (!response.ok) {
    throw new Error("Teacher workflow live generation smoke could not issue teacher auth cookies.");
  }
  const cookiePairs = readSetCookieHeaders(response.headers)
    .map((header) => header.split(";")[0]?.trim())
    .filter(Boolean);
  const hasClaimsCookie = cookiePairs.some((cookiePair) =>
    cookiePair.startsWith("uais_teacher_auth_claims="),
  );
  const hasSignatureCookie = cookiePairs.some((cookiePair) =>
    cookiePair.startsWith("uais_teacher_auth_signature="),
  );
  if (!hasClaimsCookie || !hasSignatureCookie) {
    throw new Error("Teacher workflow live generation smoke did not receive teacher auth cookies.");
  }
  return {
    cookieHeader: cookiePairs.join("; "),
    auth: "issued-teacher-auth-cookie",
  };
}

async function issueTeacherAiSession({ baseUrl, cookies, action, resource }) {
  const response = await postJson({
    url: `${baseUrl}/api/ai/session`,
    headers: {
      cookie: cookies,
    },
    body: {
      action,
      ttlSeconds: 300,
      resource,
    },
  });
  const headers = response.body?.accessSession?.headers;
  if (!response.ok || !isRecord(headers)) {
    throw new Error("Teacher workflow live generation smoke could not issue an AI session.");
  }
  return {
    headers: Object.fromEntries(
      Object.entries(headers).filter(([, value]) => typeof value === "string"),
    ),
  };
}

async function postJson({ url, headers = {}, body }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => undefined);
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body: json,
  };
}

async function getResource({ url, headers = {} }) {
  const response = await fetch(url, { method: "GET", headers });
  await response.arrayBuffer().catch(() => undefined);
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
  };
}

function createLiveGenerationResource({ env, releaseRunId }) {
  const safeReleaseId = normalizeId(releaseRunId ?? "manual");
  const sampleAssetId =
    readString(env.UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_ASSET_ID) ??
    `live-smoke-sample-${safeReleaseId}`;
  return {
    teacherId: readString(env.UAIS_TEACHER_WORKFLOW_LIVE_TEACHER_ID) ?? defaultTeacherId,
    courseId: readString(env.UAIS_TEACHER_WORKFLOW_LIVE_COURSE_ID) ?? "research-methods",
    sampleAssetId,
    pptAssetId: readString(env.UAIS_TEACHER_WORKFLOW_LIVE_PPT_ASSET_ID) ?? "kang-xia-ppt-19",
    sampleDurationSeconds: readPositiveInteger(
      env.UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_DURATION_SECONDS,
      10,
    ),
    targetVoiceLabel:
      readString(env.UAIS_TEACHER_WORKFLOW_LIVE_TARGET_VOICE_LABEL) ??
      `uais-live-smoke-${safeReleaseId}`,
    sampleText:
      readString(env.UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_TEXT) ??
      "This is an owner-approved UAIS production smoke test voice sample.",
    language: readLocale(env.UAIS_TEACHER_WORKFLOW_LIVE_LANGUAGE),
    targetModel: readString(env.UAIS_TEACHER_WORKFLOW_LIVE_TARGET_MODEL) ?? "qwen-tts",
    slideScripts: [
      {
        slideId: "slide-01",
        narrationText:
          readString(env.UAIS_TEACHER_WORKFLOW_LIVE_NARRATION_TEXT) ??
          "UAIS production live generation smoke test.",
      },
    ],
  };
}

function readLiveSampleAudioBase64(env) {
  if (hasValue(env.UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_AUDIO_BASE64)) {
    return env.UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_AUDIO_BASE64.trim();
  }
  const filePath = env.UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_AUDIO_BASE64_FILE?.trim();
  if (filePath) {
    return readFileSync(filePath, "utf8").trim();
  }
  throw new Error(
    "Teacher workflow live generation smoke requires an approved teacher sample audio payload.",
  );
}

function isPreflightReady(body) {
  if (!isRecord(body) || !isRecord(body.preflight) || !Array.isArray(body.preflight.checks)) {
    return false;
  }
  return body.preflight.status === "ready" &&
    body.preflight.checks.every((check) => check.status === "ready");
}

function createSafety() {
  return {
    valuesRedacted: true,
    providerTaskIdsRedacted: true,
    cookieValuesOmitted: true,
    responseBodiesOmitted: true,
    liveRequiresApproval: true,
    remoteMutationRequiresApproval: true,
  };
}

function evaluateVercelProductionDeploymentEvidence({
  evidence,
  deploymentFingerprint,
  releaseRunId,
}) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      deploymentObservationStatus: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }
  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const deploymentObservationStatus = readDeploymentObservationStatus(evidence);
  const summary = {
    target,
    deploymentObservationStatus,
    valueRedacted: true,
  };
  if (target !== "vercel-production-deployment") {
    return { ...summary, status: "invalid-target", releaseRunIdStatus: "missing" };
  }
  if (evidence.mode !== "live" || evidence.status !== "deployed") {
    return { ...summary, status: "not-deployed", releaseRunIdStatus: "missing" };
  }
  if (deploymentObservationStatus !== "observed") {
    return { ...summary, status: "not-observed", releaseRunIdStatus: "missing" };
  }
  if (releaseRunId && evidence.releaseRunId !== releaseRunId) {
    return { ...summary, status: "release-run-id-mismatch", releaseRunIdStatus: "mismatch" };
  }
  const evidenceFingerprint = isRecord(evidence.deploymentFingerprint)
    ? evidence.deploymentFingerprint
    : undefined;
  if (
    !evidenceFingerprint ||
    evidenceFingerprint.status !== "present" ||
    typeof evidenceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "fingerprint-missing", releaseRunIdStatus: "missing" };
  }
  if (deploymentFingerprint.status !== "present") {
    return {
      ...summary,
      status: "deployment-fingerprint-missing",
      releaseRunIdStatus: "missing",
    };
  }
  if (evidenceFingerprint.value !== deploymentFingerprint.value) {
    return { ...summary, status: "mismatched", releaseRunIdStatus: "missing" };
  }
  return {
    ...summary,
    status: "matched",
    releaseRunIdStatus: releaseRunId ? "matched" : "missing",
  };
}

function evaluateTeacherAuthProviderReadinessEvidence({ evidence, releaseRunId }) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      authProviderMode: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const authProviderMode =
    typeof evidence.authProviderMode === "string" ? evidence.authProviderMode : "missing";
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    authProviderMode,
    releaseRunIdStatus,
    valueRedacted: true,
  };
  if (target !== "teacher-auth-provider-readiness") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "ready"
  ) {
    return { ...summary, status: "not-ready" };
  }
  if (!acceptedTeacherAuthProviderModes.includes(authProviderMode)) {
    return { ...summary, status: "auth-provider-mode-missing" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }
  return { ...summary, status: "matched" };
}

function evaluateExternalStorageServiceReadinessEvidence({
  evidence,
  releaseRunId,
  storageServiceFingerprint,
}) {
  if (evidence === undefined) {
    return undefined;
  }
  if (!isRecord(evidence)) {
    return {
      target: "missing",
      status: "invalid",
      valueRedacted: true,
      releaseRunIdStatus: "missing",
    };
  }

  const target = typeof evidence.target === "string" ? evidence.target : "missing";
  const releaseRunIdStatus = releaseRunId
    ? evidence.releaseRunId === releaseRunId
      ? "matched"
      : "mismatched"
    : "missing";
  const summary = {
    target,
    releaseRunIdStatus,
    valueRedacted: true,
  };
  if (target !== "external-storage-service-readiness") {
    return { ...summary, status: "invalid-target" };
  }
  if (
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "ready"
  ) {
    return { ...summary, status: "not-ready" };
  }
  if (releaseRunId && releaseRunIdStatus !== "matched") {
    return { ...summary, status: "release-run-id-mismatch" };
  }

  const readinessFingerprint = readStorageServiceFingerprint(evidence);
  if (!readinessFingerprint) {
    return { ...summary, status: "fingerprint-missing" };
  }
  if (
    storageServiceFingerprint.status !== "present" ||
    typeof storageServiceFingerprint.value !== "string"
  ) {
    return { ...summary, status: "smoke-fingerprint-missing" };
  }
  if (readinessFingerprint !== storageServiceFingerprint.value) {
    return { ...summary, status: "mismatched" };
  }
  return { ...summary, status: "matched" };
}

function readStorageServiceFingerprint(evidence) {
  if (!isRecord(evidence) || !isRecord(evidence.storageServiceFingerprint)) {
    return undefined;
  }
  const fingerprint = evidence.storageServiceFingerprint;
  if (
    fingerprint.status === "present" &&
    typeof fingerprint.value === "string" &&
    /^sha256:[a-f0-9]{16}$/.test(fingerprint.value) &&
    fingerprint.source === "origin" &&
    fingerprint.valueRedacted === true
  ) {
    return fingerprint.value;
  }
  return undefined;
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

function readTeacherAuthProviderReadinessBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["teacher-auth-provider-readiness-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["teacher-auth-provider-readiness-release-run-mismatch"];
  }
  return ["teacher-auth-provider-readiness-not-proven"];
}

function readExternalStorageServiceReadinessBlockedReasons(evidenceStatus) {
  if (!evidenceStatus || evidenceStatus.status === "matched") {
    return [];
  }
  if (evidenceStatus.status === "missing") {
    return ["external-storage-service-readiness-evidence-missing"];
  }
  if (evidenceStatus.status === "release-run-id-mismatch") {
    return ["external-storage-service-readiness-release-run-mismatch"];
  }
  if (evidenceStatus.status === "mismatched") {
    return ["external-storage-service-readiness-fingerprint-mismatch"];
  }
  return [`external-storage-service-readiness-evidence-${evidenceStatus.status}`];
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

function readPrerequisiteBlockedReason(prerequisite) {
  if (prerequisite.status === "missing") {
    return [`missing-${prerequisite.requiredEnv ?? prerequisite.requiredEvidence}`];
  }
  if (
    prerequisite.status &&
    !["present", "required-for-live", "matched"].includes(prerequisite.status)
  ) {
    return [`${prerequisite.id}-${prerequisite.status}`];
  }
  return [];
}

function describeDeploymentOrigin(baseUrl) {
  if (!hasValue(baseUrl)) {
    return {
      status: "missing",
      originClass: "missing",
      valueRedacted: true,
    };
  }
  try {
    const url = new URL(baseUrl);
    return {
      status: "present",
      originClass: url.protocol === "https:" ? "remote-https" : "local-or-insecure",
      valueRedacted: true,
    };
  } catch {
    return {
      status: "missing",
      originClass: "missing",
      valueRedacted: true,
    };
  }
}

function createDeploymentFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return { status: "missing", valueRedacted: true };
  }
  return {
    status: "present",
    value: `sha256:${createHash("sha256")
      .update(stripTrailingSlashes(baseUrl))
      .digest("hex")
      .slice(0, 16)}`,
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
      value: `sha256:${createHash("sha256")
        .update(parsed.origin)
        .digest("hex")
        .slice(0, 16)}`,
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

function createSignedAdminHeaders({ actorId, secret }) {
  const issuedAt = new Date();
  const claims = {
    actor: {
      actorId,
      role: "admin",
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 300_000).toISOString(),
  };
  const claimsHeader = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return {
    "x-uais-access-claims": claimsHeader,
    "x-uais-access-signature": createHmac("sha256", secret)
      .update(claimsHeader)
      .digest("base64url"),
  };
}

function createTrustedTeacherAuthIssuerHeaders({ teacherId, secret }) {
  const issuedAt = new Date();
  const claims = {
    issuerId: "trusted-cookie-issuer",
    teacherId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + teacherAuthIssuerProofTtlSeconds * 1000,
    ).toISOString(),
  };
  const claimsHeader = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return {
    "x-uais-teacher-auth-issuer-claims": claimsHeader,
    "x-uais-teacher-auth-issuer-signature": createHmac("sha256", secret)
      .update(claimsHeader)
      .digest("base64url"),
  };
}

function readSetCookieHeaders(headers) {
  const setCookies = headers.getSetCookie?.();
  if (setCookies?.length) {
    return setCookies;
  }
  const combined = headers.get("set-cookie");
  return combined
    ? combined.split(/,\s*(?=uais_teacher_auth_(?:claims|signature)=)/)
    : [];
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

function readEnvFile(envFile) {
  if (!envFile) {
    return {};
  }
  const values = {};
  const content = readFileSync(envFile, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key) {
      values[key] = value.replace(/^"(.*)"$/, "$1");
    }
  }
  return values;
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    environment: "unspecified",
    envFile: ".env.local",
    baseUrl: undefined,
    releaseRunId: undefined,
    vercelProductionDeployment: undefined,
    teacherAuthProviderReadiness: undefined,
    externalStorageServiceReadiness: undefined,
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
    } else if (arg === "--release-run-id") {
      options.releaseRunId = normalizeReleaseRunId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--vercel-production-deployment") {
      options.vercelProductionDeployment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--teacher-auth-provider-readiness") {
      options.teacherAuthProviderReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--external-storage-service-readiness") {
      options.externalStorageServiceReadiness = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/teacher-workflow-live-generation-smoke.mjs [--dry-run] [--live --approved --base-url URL] [--environment production|preview|local-production|unspecified] [--env-file PATH] [--release-run-id ID] [--vercel-production-deployment PATH] [--teacher-auth-provider-readiness PATH] [--external-storage-service-readiness PATH]",
          "",
          "Outputs redacted live provider-generation smoke JSON. Live mode performs owner-approved remote provider mutations and omits response bodies, secrets, sample audio, URLs, and provider task ids from evidence.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readArgValue(args, index, arg) {
  const value = args[index + 1];
  if (!hasValue(value) || value.startsWith("--")) {
    throw new Error(`${arg} requires a value.`);
  }
  return value;
}

function normalizeEnvironment(value) {
  const allowed = new Set(["production", "preview", "local-production", "unspecified"]);
  if (!allowed.has(value)) {
    throw new Error(`Unsupported environment: ${value}`);
  }
  return value;
}

function normalizeReleaseRunId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value)) {
    throw new Error("--release-run-id must be 3-128 URL-safe-ish characters.");
  }
  return value;
}

function normalizeId(value) {
  return String(value)
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "manual";
}

function readLocale(value) {
  return value === "en-US" ? "en-US" : "zh-CN";
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requireEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
