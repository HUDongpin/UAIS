#!/usr/bin/env node

import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createRequire } from "node:module";
import { delimiter, resolve } from "node:path";

const route = "/teaching";
const teacherAuthIssuerProofTtlSeconds = 300;
const defaultTeacherId = "s22-route-smoke-teacher";
const apiModes = new Set(["fixture-only", "live-workflow-status"]);
const browserInteractions = [
  "open-teaching-page",
  "hydrate-teacher-workflow",
  "verify-short-voice-sample-duration-gate",
  "select-voice-sample-file",
  "refresh-server-workflow",
  "submit-voice-sample-with-signed-session",
  "run-voice-clone-preflight",
  "save-voice-ref",
  "submit-ppt-narration",
  "verify-ppt-narration-slide-payload",
  "verify-per-slide-wav-download-links",
  "verify-per-slide-wav-download-href-contract",
];
const requiredResultKeys = [
  "openTeachingPage",
  "browserHydration",
  "voiceSampleDurationGate",
  "voiceSampleFileSelection",
  "serverWorkflowRefresh",
  "signedSessionBootstrap",
  "voiceSampleSubmit",
  "voiceClonePreflight",
  "voiceCloneStatus",
  "pptNarrationSubmit",
  "pptNarrationSlidePayload",
  "perSlideWavDownloadLinks",
  "perSlideWavDownloadHrefContract",
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Teacher workflow browser smoke requires explicit owner approval.");
  }
  if (options.live && options.environment === "production" && !hasValue(options.releaseRunId)) {
    throw new Error("Teacher workflow browser smoke requires --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_DEPLOYMENT_BASE_URL;
  const vercelProductionDeployment = readJsonEvidence(options.vercelProductionDeployment);
  const plan = buildPlan({
    mode,
    environment: options.environment,
    baseUrl,
    env,
    apiMode: options.apiMode,
    resolvedAddress: options.resolvedAddress,
    releaseRunId: options.releaseRunId,
    vercelProductionDeployment,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked" && !shouldRunDiagnosticLiveBrowserSmoke(plan)) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const result = await executeLiveBrowserSmoke({
      baseUrl,
      env,
      apiMode: options.apiMode,
      resolvedAddress: options.resolvedAddress,
    });
    const evidence = createLiveEvidence({ plan, result });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (result.status !== "passed" || plan.status === "blocked") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Teacher workflow browser smoke failed."}\n`,
  );
  process.exitCode = 1;
}

function shouldRunDiagnosticLiveBrowserSmoke(plan) {
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
  const browserPassed = result.status === "passed";
  const productionReleaseEligible =
    plan.status === "ready" && browserPassed && deploymentBindingProved;

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

function buildPlan({
  mode,
  environment,
  baseUrl,
  env,
  apiMode,
  resolvedAddress,
  releaseRunId,
  vercelProductionDeployment,
}) {
  const deploymentOrigin = describeDeploymentOrigin(baseUrl);
  const deploymentFingerprint = createDeploymentFingerprint(baseUrl);
  const vercelProductionDeploymentEvidence =
    vercelProductionDeployment === undefined && environment === "production"
      ? {
          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          valueRedacted: true,
        }
      : evaluateVercelProductionDeploymentEvidence({
          evidence: vercelProductionDeployment,
          deploymentFingerprint,
          releaseRunId,
        });
  const playwrightRuntimeStatus =
    mode === "live"
      ? canResolvePlaywrightRuntime()
        ? "present"
        : "missing"
      : "required-for-live";
  const prerequisites = [
    {
      id: "s22-deployment-base-url",
      responsibleSession: "S22",
      requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    {
      id: "s22-browser-automation-runtime",
      responsibleSession: "S22",
      runtime: "playwright",
      status: playwrightRuntimeStatus,
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
    ...createApiModePrerequisites({ env, apiMode }),
  ];
  const blockedReasons = [
    ...prerequisites.flatMap((prerequisite) =>
      readPrerequisiteBlockedReason(prerequisite),
    ),
    ...readProductionDeploymentOriginBlockedReasons({ environment, deploymentOrigin }),
    ...readVercelProductionDeploymentBlockedReasons(vercelProductionDeploymentEvidence),
  ];

  return {
    target: "teacher-workflow-browser-smoke",
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
    browserInteractions,
    apiInterceptionPolicy: createApiInterceptionPolicy(apiMode),
    runtimeSetup: createRuntimeSetup(),
    prerequisites,
    blockedReasons,
    safety: {
      valuesRedacted: true,
      cookieValuesOmitted: true,
      deploymentUrlOmitted: true,
      responseBodiesOmitted: true,
      screenshotsOmitted: true,
      audioPayloadOmitted: true,
      liveRequiresApproval: true,
      remoteMutationRequiresApproval: true,
    },
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
    releaseRunIdStatus: releaseRunId ? "matched" : "missing",
  };
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

function readPrerequisiteBlockedReason(prerequisite) {
  if (prerequisite.requiredEnv && prerequisite.status !== "present") {
    return [`missing-${prerequisite.requiredEnv}`];
  }
  if (
    prerequisite.id === "s22-browser-automation-runtime" &&
    prerequisite.status === "missing"
  ) {
    return ["teacher-workflow-browser-runtime-missing"];
  }
  return [];
}

async function executeLiveBrowserSmoke({ baseUrl, env, apiMode, resolvedAddress }) {
  const results = Object.fromEntries(requiredResultKeys.map((key) => [key, "pending"]));
  const observedWorkflowPayloads = {
    pptNarrationSlidePayload: "pending",
  };
  let browser;
  let lastInteraction = "launch-browser";
  try {
    const { chromium } = loadPlaywrightRuntime();
    browser = await chromium.launch({ headless: true });
    lastInteraction = "create-browser-context";
    const context = await browser.newContext();
    if (apiMode === "live-workflow-status") {
      lastInteraction = "install-teacher-auth-session-cookies";
      await installTeacherAuthSessionCookies({ context, baseUrl, env, resolvedAddress });
    }
    lastInteraction = "create-page";
    const page = await context.newPage();
    lastInteraction = "install-workflow-api-fixtures";
    await installWorkflowApiFixtures(page, { apiMode, observedWorkflowPayloads });

    lastInteraction = "open-teaching-page";
    await page.goto(`${stripTrailingSlashes(baseUrl)}${route}`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    results.openTeachingPage = "passed";

    lastInteraction = "open-agent-workspace";
    await clickLink(page, [/智能体配置/, /Agent Setup/]);
    lastInteraction = "wait-for-agent-workspace";
    await waitForAnyText(page, [/智能体配置工作台/, /Agent Setup Workspace/]);

    lastInteraction = "wait-for-teacher-ppt-workflow";
    await waitForAnyText(page, [
      /教师课件配音工作流/,
      /教师 PPT 配音工作流/,
      /Teacher PPT Narration Workflow/,
    ]);
    results.browserHydration = "passed";

    lastInteraction = "select-short-voice-sample";
    await setTeacherVoiceSampleFile(page, {
      name: "uais-teacher-browser-smoke-1s.wav",
      mimeType: "audio/wav",
      buffer: createSilentPcmWavBuffer({ durationSeconds: 1 }),
    });
    lastInteraction = "wait-for-short-voice-sample";
    await waitForAnyText(page, [/uais-teacher-browser-smoke-1s\.wav/]);
    lastInteraction = "force-short-voice-duration";
    await forceSelectedAudioMetadataDuration(page, 1);
    lastInteraction = "wait-for-short-duration-gate";
    await waitForAnyText(page, [
      /已选择音频 1\.0 秒，至少需要 10 秒。/,
      /Selected audio is 1\.0 seconds; at least 10 seconds is required\./,
    ]);
    lastInteraction = "verify-register-button-disabled";
    results.voiceSampleDurationGate = (await isButtonDisabled(page, [
      /登记教师声音/,
      /Register teacher voice/,
    ]))
      ? "passed"
      : "failed";

    lastInteraction = "select-valid-voice-sample";
    await setTeacherVoiceSampleFile(page, {
      name: "uais-teacher-browser-smoke-10s.wav",
      mimeType: "audio/wav",
      buffer: createSilentPcmWavBuffer({ durationSeconds: 10 }),
    });
    lastInteraction = "wait-for-valid-voice-sample";
    await waitForAnyText(page, [/uais-teacher-browser-smoke-10s\.wav/]);
    lastInteraction = "force-valid-voice-duration";
    await forceSelectedAudioMetadataDuration(page, 10);
    lastInteraction = "wait-for-valid-duration-gate";
    await waitForAnyText(page, [
      /已选择音频 10\.0 秒，可以登记。/,
      /Selected audio is 10\.0 seconds and can be registered\./,
    ]);
    results.voiceSampleFileSelection = "passed";

    lastInteraction = "refresh-server-workflow";
    await clickButton(page, [
      /刷新服务端工作流/,
      /刷新服务端 workflow/,
      /Refresh server workflow/,
    ]);
    lastInteraction = "wait-for-server-workflow";
    await waitForAnyText(page, [
      /服务端工作流可下载/,
      /服务端 workflow ready-for-downloads/,
      /Server workflow ready-for-downloads/,
    ]);
    results.serverWorkflowRefresh = "passed";

    lastInteraction = "register-teacher-voice";
    await clickButton(page, [/登记教师声音/, /Register teacher voice/]);
    lastInteraction = "wait-for-voice-sample-submit";
    await waitForAnyText(page, [
      /声音样本可用于复刻/,
      /声音样本 ready-for-clone/,
      /Voice sample ready-for-clone/,
    ]);
    results.signedSessionBootstrap = "passed";
    results.voiceSampleSubmit = "passed";

    lastInteraction = "run-workflow-preflight";
    await clickButton(page, [
      /运行工作流预检/,
      /运行 workflow 预检/,
      /Run workflow preflight/,
    ]);
    lastInteraction = "wait-for-workflow-preflight";
    await waitForAnyText(page, [/预检就绪/, /Preflight ready/]);
    results.voiceClonePreflight = "passed";

    lastInteraction = "save-voice-ref";
    await clickButton(page, [/保存声音引用/, /保存 voiceRef/, /Save voiceRef/]);
    lastInteraction = "wait-for-voice-ref";
    await waitForAnyText(page, [/声音引用就绪/, /voiceRefId:/]);
    results.voiceCloneStatus = "passed";

    lastInteraction = "submit-ppt-narration";
    await clickButton(page, [
      /^生成课件配音$/,
      /^生成 PPT 配音$/,
      /^Generate PPT narration$/,
    ]);
    lastInteraction = "wait-for-ppt-narration";
    await waitForAnyText(page, [
      /课件配音已排队/,
      /PPT 配音 queued: 19 页/,
      /PPT narration queued: 19 slides/,
    ]);
    results.pptNarrationSubmit = "passed";
    results.pptNarrationSlidePayload =
      observedWorkflowPayloads.pptNarrationSlidePayload === "passed"
        ? "passed"
        : "failed";

    lastInteraction = "verify-per-slide-wav-download-links";
    const wavLinkLocator = page.getByRole("link", {
      name: /下载(?:服务器)?第\s*\d+\s*页音频|下载 slide-\d{2} WAV|Download(?: server)? slide-\d{2} WAV/,
    });
    const wavLinks = await wavLinkLocator.count();
    results.perSlideWavDownloadLinks = wavLinks >= 19 ? "passed" : "failed";
    results.perSlideWavDownloadHrefContract =
      wavLinks >= 19 && (await hasProtectedPerSlideWavHrefContract(wavLinkLocator))
        ? "passed"
        : "failed";

    const allPassed = Object.values(results).every((value) => value === "passed");
    return {
      status: allPassed ? "passed" : "failed",
      renderedPageFingerprint: createRenderedPageFingerprint(await page.content()),
      results,
      blockedReasons: allPassed ? [] : ["teacher-workflow-browser-interaction-failed"],
    };
  } catch (error) {
    return {
      status: "failed",
      results,
      failureDiagnostics: createBrowserSmokeFailureDiagnostics({
        lastInteraction,
        error,
      }),
      blockedReasons: ["teacher-workflow-browser-interaction-failed"],
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function createBrowserSmokeFailureDiagnostics({ lastInteraction, error }) {
  return {
    lastInteraction,
    errorName: error instanceof Error ? error.name : "unknown-error",
    redaction: {
      message: "omitted",
      stack: "omitted",
      urls: "omitted",
      screenshots: "omitted",
    },
  };
}

async function hasProtectedPerSlideWavHrefContract(wavLinkLocator) {
  try {
    const hrefs = await wavLinkLocator.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    );
    const validHrefs = hrefs.filter(isProtectedPptNarrationAudioDownloadPath);
    return validHrefs.length >= 19 && new Set(validHrefs).size >= 19;
  } catch {
    return false;
  }
}

function isProtectedPptNarrationAudioDownloadPath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  try {
    const path = new URL(value, "https://redacted.invalid").pathname;
    return /^\/api\/ai\/ppt-narration\/audio\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(
      path,
    );
  } catch {
    return false;
  }
}

async function installWorkflowApiFixtures(page, { apiMode, observedWorkflowPayloads = {} }) {
  await page.route("**/api/ai/**", async (routeRequest) => {
    const request = routeRequest.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === "/api/ai/session" && request.method() === "POST") {
      if (
        apiMode === "live-workflow-status" &&
        readAiSessionRequestAction(request) === "teacher-ppt-workflow-read"
      ) {
        await routeRequest.continue();
        return;
      }
      await fulfillJson(routeRequest, {
        accessSession: {
          headers: {
            "x-uais-access-claims": "redacted-browser-smoke-claims",
            "x-uais-access-signature": "redacted-browser-smoke-signature",
          },
        },
        accessPlan: {
          redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
        },
      });
      return;
    }
    if (pathname === "/api/ai/teacher-ppt-workflow" && request.method() === "GET") {
      if (apiMode === "live-workflow-status") {
        await routeRequest.continue();
        return;
      }
      await fulfillJson(routeRequest, createServerWorkflowFixture());
      return;
    }
    if (pathname === "/api/ai/voice-sample" && request.method() === "POST") {
      await fulfillJson(routeRequest, {
        sample: {
          provider: "qwen",
          status: "ready-for-clone",
          sampleDurationSeconds: 10,
        },
        sampleAsset: {
          sampleAssetId: "teacher-kang-upload-uais-browser-smoke",
          storagePolicy: "server-side-redacted-teacher-voice-sample",
        },
        nextAction: "submit-qwen-voice-clone",
      });
      return;
    }
    if (pathname === "/api/ai/voice-clone/preflight" && request.method() === "POST") {
      await fulfillJson(routeRequest, {
        preflight: {
          status: "ready",
          checks: [
            { responsibleSession: "S07", status: "ready" },
            { responsibleSession: "S12", status: "ready" },
            { responsibleSession: "S19", status: "ready" },
            { responsibleSession: "S24", status: "ready" },
          ],
        },
      });
      return;
    }
    if (pathname === "/api/ai/voice-clone/status" && request.method() === "POST") {
      await fulfillJson(routeRequest, {
        voiceCloneReference: {
          voiceRefId: "qwen-voice-ref-teacher-kang-uais-browser-smoke",
          status: "ready",
          voiceRef: "server-side-cloned-qwen-voice",
        },
      });
      return;
    }
    if (pathname === "/api/ai/ppt-narration" && request.method() === "POST") {
      observedWorkflowPayloads.pptNarrationSlidePayload =
        hasValidPptNarrationSlidePayload(readJsonRequestPayload(request))
          ? "passed"
          : "failed";
      await fulfillJson(routeRequest, {
        pptNarrationJob: {
          provider: "qwen",
          status: "queued",
          slideCount: 19,
          audioManifestId: "audio-manifest-uais-browser-smoke",
        },
        pptNarrationAssets: {
          id: "audio-manifest-uais-browser-smoke",
          assets: createPptNarrationAssets(),
        },
      });
      return;
    }
    await routeRequest.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "fixture-not-found" }),
    });
  });
}

function readJsonRequestPayload(request) {
  try {
    const payload = request.postData?.();
    if (!hasValue(payload)) {
      return undefined;
    }
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function hasValidPptNarrationSlidePayload(payload) {
  if (!isRecord(payload) || !isRecord(payload.pptNarration)) {
    return false;
  }
  const slideScripts = payload.pptNarration.slideScripts;
  if (!Array.isArray(slideScripts) || slideScripts.length !== 19) {
    return false;
  }
  return slideScripts.every((script, index) => {
    if (!isRecord(script)) {
      return false;
    }
    const slideNumber = String(index + 1).padStart(2, "0");
    return (
      script.slideId === `slide-${slideNumber}` &&
      hasValue(script.narrationText)
    );
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fulfillJson(routeRequest, body) {
  await routeRequest.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function readAiSessionRequestAction(request) {
  try {
    const body = JSON.parse(request.postData() ?? "{}");
    return typeof body.action === "string" ? body.action : undefined;
  } catch {
    return undefined;
  }
}

function createServerWorkflowFixture() {
  return {
    workflow: {
      teacherId: "teacher-kang",
      courseId: "research-methods",
      pptAssetId: "kang-xia-ppt-19",
      status: "ready-for-downloads",
      nextAction: "review-and-download-ppt-narration",
      steps: [
        { id: "voice-sample", status: "ready", sampleAssetId: "teacher-kang-10s-sample" },
        {
          id: "voice-clone",
          status: "ready",
          voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
        },
        { id: "ppt-material", status: "ready", pptAssetId: "kang-xia-ppt-19" },
        {
          id: "ppt-narration",
          status: "ready",
          audioManifestId: "audio-manifest-kang-xia-ppt-19",
        },
      ],
      downloads: {
        audioManifestId: "audio-manifest-kang-xia-ppt-19",
        exportDownloadUrl: "/api/ai/ppt-narration/export/audio-manifest-kang-xia-ppt-19",
        audioDownloadPattern:
          "/api/ai/ppt-narration/audio/audio-manifest-kang-xia-ppt-19/{audioId}",
      },
      redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
    },
    agentHandoffPlan: {
      framework: "openmaic-style-teacher-ppt-narration",
      status: "ready-for-teacher-review",
      nextAgent: {
        responsibleSession: "S24",
        action: "review-and-download-ppt-narration",
      },
    },
  };
}

function createPptNarrationAssets() {
  return Array.from({ length: 19 }, (_, index) => {
    const slideNumber = String(index + 1).padStart(2, "0");
    return {
      slideId: `slide-${slideNumber}`,
      audioId: `audio-slide-${slideNumber}`,
      downloadUrl: `/api/ai/ppt-narration/audio/audio-manifest-uais-browser-smoke/audio-slide-${slideNumber}`,
    };
  });
}

async function installTeacherAuthSessionCookies({ context, baseUrl, env, resolvedAddress }) {
  const normalizedBaseUrl = stripTrailingSlashes(baseUrl);
  const teacherId = readBrowserSmokeTeacherId(env);
  const response = await requestDeploymentResource(`${normalizedBaseUrl}/api/ai/teacher-auth/issue`, {
    method: "POST",
    headers: {
      ...createSignedAdminHeaders({
        actorId: "s22-browser-smoke-admin",
        secret: requireEnv(env, "UAIS_AI_ACCESS_SIGNING_SECRET"),
      }),
      ...createTrustedTeacherAuthIssuerHeaders({
        teacherId,
        secret: requireEnv(env, "UAIS_TEACHER_AUTH_ISSUER_SECRET"),
      }),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      teacherId,
      ttlSeconds: teacherAuthIssuerProofTtlSeconds,
    }),
    resolvedAddress,
    timeoutMs: 10_000,
  });
  if (!response.ok) {
    throw new Error("Teacher workflow browser smoke could not issue teacher auth cookies.");
  }

  const cookies = createPlaywrightCookiesFromSetCookieHeaders({
    setCookieHeaders: readSetCookieHeaders(response.headers),
    baseUrl: normalizedBaseUrl,
  });
  if (cookies.length < 2) {
    throw new Error("Teacher workflow browser smoke did not receive signed teacher auth cookies.");
  }
  await context.addCookies(cookies);
}

function createPlaywrightCookiesFromSetCookieHeaders({ setCookieHeaders, baseUrl }) {
  const secure = new URL(baseUrl).protocol === "https:";
  return setCookieHeaders
    .map((header) => header.split(";")[0]?.trim())
    .filter(Boolean)
    .flatMap((cookiePair) => {
      const separatorIndex = cookiePair.indexOf("=");
      if (separatorIndex === -1) {
        return [];
      }
      const name = cookiePair.slice(0, separatorIndex);
      if (
        name !== "uais_teacher_auth_claims" &&
        name !== "uais_teacher_auth_signature"
      ) {
        return [];
      }
      return [
        {
          name,
          value: cookiePair.slice(separatorIndex + 1),
          url: baseUrl,
          httpOnly: true,
          secure,
          sameSite: "Lax",
        },
      ];
    });
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

async function clickButton(page, names) {
  const button = page.getByRole("button", { name: combineRegex(names) });
  await button.click({ timeout: 15_000 });
}

async function clickLink(page, names) {
  const link = page.getByRole("link", { name: combineRegex(names) });
  await link.click({ timeout: 15_000 });
}

async function isButtonDisabled(page, names) {
  const button = page.getByRole("button", { name: combineRegex(names) });
  return await button.evaluate((element) => {
    if (element instanceof HTMLButtonElement) {
      return element.disabled;
    }
    return element.getAttribute("aria-disabled") === "true";
  });
}

async function waitForAnyText(page, patterns) {
  await page.getByText(combineRegex(patterns)).first().waitFor({ timeout: 15_000 });
}

async function forceSelectedAudioMetadataDuration(page, durationSeconds) {
  const probe = page.locator('[data-uais-selected-audio-probe="metadata"]');
  await probe.waitFor({ state: "attached", timeout: 15_000 });
  await probe.evaluate((audio, durationSeconds) => {
    Object.defineProperty(audio, "duration", {
      configurable: true,
      get: () => durationSeconds,
    });
    audio.dispatchEvent(new Event("loadedmetadata", { bubbles: true }));
  }, durationSeconds);
}

async function setTeacherVoiceSampleFile(page, filePayload) {
  const fileInput = page.locator("#teacher-voice-sample");
  await fileInput.setInputFiles(filePayload);
  if (typeof fileInput.dispatchEvent === "function") {
    await fileInput.dispatchEvent("input");
    await fileInput.dispatchEvent("change");
  }
}

function combineRegex(patterns) {
  return new RegExp(patterns.map((pattern) => pattern.source).join("|"));
}

function createSilentPcmWavBuffer({ durationSeconds }) {
  const channelCount = 1;
  const sampleRate = 8_000;
  const bitsPerSample = 16;
  const blockAlign = (channelCount * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = Math.ceil(durationSeconds * byteRate);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
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
    apiMode: "fixture-only",
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
    } else if (arg === "--api-mode") {
      options.apiMode = normalizeApiMode(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--vercel-production-deployment") {
      options.vercelProductionDeployment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/teacher-workflow-browser-smoke.mjs [--dry-run] [--live --approved --base-url URL] [--resolved-address IP] [--environment production|preview|local-production|unspecified] [--env-file PATH] [--release-run-id ID] [--vercel-production-deployment PATH]",
          "",
          "Outputs redacted deployed /teaching browser-interaction smoke JSON. Live mode uses Playwright and fixture-intercepts mutating workflow APIs so it does not mutate remote provider or storage state.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
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

function createApiModePrerequisites({ env, apiMode }) {
  if (apiMode !== "live-workflow-status") {
    return [];
  }

  const requiredEnv = [
    {
      id: "s12-teacher-workflow-browser-auth-bootstrap",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
      status: env.UAIS_TEACHER_AUTH_PROVIDER === "trusted-cookie-issuer" ? "present" : "missing",
    },
    {
      id: "s19-teacher-workflow-browser-ai-access-secret",
      responsibleSession: "S19",
      requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
      status: hasValue(env.UAIS_AI_ACCESS_SIGNING_SECRET) ? "present" : "missing",
    },
    {
      id: "s19-teacher-workflow-browser-session-secret",
      responsibleSession: "S19",
      requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      status: hasValue(env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET) ? "present" : "missing",
    },
    {
      id: "s12-teacher-workflow-browser-issuer-secret",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      status: hasValue(env.UAIS_TEACHER_AUTH_ISSUER_SECRET) ? "present" : "missing",
    },
  ];

  return requiredEnv;
}

function createApiInterceptionPolicy(apiMode) {
  if (apiMode === "live-workflow-status") {
    return {
      workflowApis: "live-workflow-status",
      remoteMutations: "fixture-blocked",
      responseBodiesOmitted: true,
    };
  }

  return {
    workflowApis: "fixture-only",
    remoteMutations: "blocked",
    responseBodiesOmitted: true,
  };
}

function normalizeApiMode(value) {
  const apiMode = value.trim().toLowerCase();
  if (!apiModes.has(apiMode)) {
    throw new Error("--api-mode must be fixture-only or live-workflow-status.");
  }
  return apiMode;
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

function normalizeResolvedAddress(value) {
  const resolvedAddress = value.trim();
  if (!/^[A-Za-z0-9:.]+$/.test(resolvedAddress)) {
    throw new Error("--resolved-address must be a non-secret IP address or host literal.");
  }
  return resolvedAddress;
}

function readBrowserSmokeTeacherId(env) {
  return (
    env.UAIS_TEACHER_WORKFLOW_BROWSER_SMOKE_TEACHER_ID?.trim() ||
    env.UAIS_TEACHER_AUTH_ROUTE_SMOKE_TEACHER_ID?.trim() ||
    defaultTeacherId
  );
}

function requireEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Teacher workflow browser smoke requires ${name}.`);
  }
  return value;
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

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
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
  { method = "GET", headers = {}, body, resolvedAddress, timeoutMs, redirectsRemaining = 3 } = {},
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
          const responseBody = Buffer.concat(chunks);
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
                body: status === 303 ? undefined : body,
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
            text: async () => responseBody.toString("utf8"),
            arrayBuffer: async () =>
              responseBody.buffer.slice(
                responseBody.byteOffset,
                responseBody.byteOffset + responseBody.byteLength,
              ),
            json: async () => JSON.parse(responseBody.toString("utf8")),
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
    if (body !== undefined) {
      clientRequest.write(body);
    }
    clientRequest.end();
  });
}

function createHeaderAccessor(headers) {
  return {
    getSetCookie() {
      const value = headers["set-cookie"];
      if (Array.isArray(value)) {
        return value;
      }
      return typeof value === "string" ? [value] : [];
    },
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

function canResolvePlaywrightRuntime() {
  return resolvePlaywrightRuntime() !== undefined;
}

function loadPlaywrightRuntime() {
  const resolution = resolvePlaywrightRuntime();
  if (!resolution) {
    throw new Error("Playwright runtime is unavailable.");
  }
  return resolution.runtimeRequire(resolution.specifier);
}

function resolvePlaywrightRuntime() {
  const runtimeRequire = createRequire(import.meta.url);
  const explicitNodePath = process.env.NODE_PATH?.trim();
  const specifiers = explicitNodePath
    ? explicitNodePath
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => resolve(entry, "playwright"))
    : ["playwright"];

  for (const specifier of specifiers) {
    try {
      runtimeRequire.resolve(specifier);
      return { runtimeRequire, specifier };
    } catch {
      // Try the next explicit runtime root. When NODE_PATH is present it is an
      // intentional override (including for the documented npx command), so a
      // repository-local package must not silently replace it.
    }
  }
  return undefined;
}

function createRuntimeSetup() {
  return {
    packageName: "playwright",
    moduleResolution: "node-require-resolution",
    moduleStatus: canResolvePlaywrightRuntime() ? "present" : "missing",
    npxStatus: canRunNpx() ? "present" : "missing",
    packageInstallCommand: "npm install --save-dev playwright",
    browserInstallCommand: "npx playwright install chromium",
    liveCommand:
      "node -- scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence>",
    transientRuntimeCommand:
      "npx --yes --package playwright --call 'NODE_PATH=\"$(dirname \"$(dirname \"$(command -v playwright)\")\")\" node -- scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence>'",
  };
}

function canRunNpx() {
  const result = spawnSync("npx", ["--version"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

function createDeploymentFingerprint(baseUrl) {
  if (!hasValue(baseUrl)) {
    return { status: "missing" };
  }
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(stripTrailingSlashes(baseUrl)).digest("hex").slice(0, 16)}`,
  };
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

function describeDeploymentOrigin(baseUrl) {
  if (!hasValue(baseUrl)) {
    return { status: "missing", originClass: "missing", valueRedacted: true };
  }
  try {
    const url = new URL(baseUrl);
    return {
      status: "present",
      originClass: classifyOrigin(url),
      valueRedacted: true,
    };
  } catch {
    return { status: "invalid", originClass: "invalid", valueRedacted: true };
  }
}

function classifyOrigin(url) {
  if (url.protocol !== "https:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1"
      ? "local-loopback"
      : "insecure-http";
  }
  if (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname.endsWith(".local")
  ) {
    return "local-loopback";
  }
  if (isPrivateHostname(url.hostname)) {
    return "private-network";
  }
  return "remote-https";
}

function isPrivateHostname(hostname) {
  if (/^10\./.test(hostname)) {
    return true;
  }
  if (/^192\.168\./.test(hostname)) {
    return true;
  }
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}
