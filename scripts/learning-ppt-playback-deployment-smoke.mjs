#!/usr/bin/env node

// Deployed-learning-playback smoke.
//
//   node -- scripts/learning-ppt-playback-deployment-smoke.mjs --dry-run
//   node -- scripts/learning-ppt-playback-deployment-smoke.mjs --live --approved \
//     --environment production --base-url https://… --release-run-id … \
//     [--course-id autumn-2026-research-methods] [--session-cookie "<cookie>"]
//
// With no course and no cookie it checks the compiled-in Kang Xia demo deck
// against pinned constants, which is what every release-gate invocation of this
// script has always done.
//
// Two things it could not do before. It sent no credentials, so on a deployment
// that enforces authentication every request came back as a redirect to the
// login page and the smoke reported a playback failure that was really an
// unauthenticated request - the audio-tracing fix could not be verified at all.
// And it compared the manifest against nineteen hardcoded demo values, so the
// FIRST REAL published lecture was unsmokeable: a correct deployment of the
// autumn course failed every check.
//
// `--session-cookie` (or UAIS_DEPLOYMENT_SESSION_COOKIE, so the value can arrive
// through --env-file rather than a shell history) attaches a session to every
// request. `--course-id` points the smoke at any published course and switches
// the expectations from pinned to DERIVED: slide count, titles and teacher come
// from the deployed manifest itself, and the checks verify the manifest is
// internally consistent and its first WAV really streams. Cookie values are
// never printed, and neither is the course id's response body.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const routes = {
  learningPage: "/learning",
  playbackManifest: "/api/learning/ppt-playback/<course-id>",
  firstSlideAudio: "/api/learning/ppt-playback/audio/<manifest-id>/<audio-id>",
};

const publishedPlayback = {
  courseId: "elementary-math-research",
  manifestId: "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
  teacherName: "康霞博士",
  voiceLabel: "康霞博士克隆声音",
  slideCount: 19,
  firstSlideId: "slide-01",
  firstSlideTitle: "自然数的序数理论",
  firstAudioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
  lastSlideTitle: "作业布置",
};

const minimumFirstSlideAudioContentLength = 1024;

const pinnedChecks = [
  "learning-page-http-200",
  "kang-xia-manifest-19-slides",
  "student-safe-manifest-redaction",
  "first-slide-audio-wav-response",
];

// The derived set asserts the same properties without naming the lecture: a
// manifest whose slide count matches its own slide list, whose slides are
// slide-01..slide-NN in order, and whose first audio URL streams a real WAV.
const derivedChecks = [
  "learning-page-http-200",
  "published-manifest-self-consistent",
  "student-safe-manifest-redaction",
  "first-slide-audio-wav-response",
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
    throw new Error("Learning PPT playback deployment smoke requires explicit owner approval.");
  }
  if (options.live && options.environment === "production" && !hasValue(options.releaseRunId)) {
    throw new Error("Learning PPT playback deployment smoke requires --release-run-id.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const mode = options.live ? "live" : "dry-run";
  const baseUrl = options.baseUrl || env.UAIS_DEPLOYMENT_BASE_URL;
  const sessionCookie = normalizeSessionCookie(
    options.sessionCookie ?? env.UAIS_DEPLOYMENT_SESSION_COOKIE,
  );
  // A course id lands in a request path, so it gets the catalog's own charset.
  const courseId = options.courseId ?? publishedPlayback.courseId;
  const expectations = options.courseId ? "derived" : "pinned";
  const vercelProductionDeployment = readJsonEvidence(options.vercelProductionDeployment);
  const plan = buildPlan({
    mode,
    environment: options.environment,
    baseUrl,
    resolvedAddress: options.resolvedAddress,
    releaseRunId: options.releaseRunId,
    vercelProductionDeployment,
    expectations,
    sessionCookie,
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  if (plan.status === "blocked") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const result = await executeLiveSmoke({
      baseUrl,
      resolvedAddress: options.resolvedAddress,
      courseId,
      expectations,
      sessionCookie,
    });
    process.stdout.write(`${JSON.stringify({ ...plan, ...result }, null, 2)}\n`);
    if (result.status !== "passed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Learning PPT playback deployment smoke failed."}\n`,
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
  expectations,
  sessionCookie,
}) {
  const deploymentOrigin = describeDeploymentOrigin(baseUrl);
  const deploymentFingerprint = createDeploymentFingerprint(baseUrl);
  const vercelProductionDeploymentEvidence = evaluateVercelProductionDeploymentEvidence({
    evidence: vercelProductionDeployment,
    deploymentFingerprint,
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
    target: "learning-ppt-playback-deployment-smoke",
    mode,
    environment,
    network: mode === "live" ? "enabled" : "disabled",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S22",
    ...(releaseRunId ? { releaseRunId } : {}),
    routes,
    deploymentFingerprint,
    deploymentOrigin,
    networkAddressOverride: describeNetworkAddressOverride(resolvedAddress),
    ...(vercelProductionDeploymentEvidence
      ? { vercelProductionDeploymentEvidence }
      : {}),
    // Reported only when one was supplied, so the release-gate invocation's
    // output shape is unchanged. The value itself never appears.
    ...(sessionCookie ? { sessionCookie: { status: "present", valueRedacted: true } } : {}),
    ...(expectations === "derived" ? { expectations } : {}),
    networkRetryPolicy,
    prerequisites,
    checks: expectations === "derived" ? derivedChecks : pinnedChecks,
    blockedReasons,
    safety: {
      valuesRedacted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      audioPayloadOmitted: true,
      liveRequiresApproval: true,
      remoteMutationRequiresApproval: true,
      checksPublishedLearningPlayback: true,
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

async function executeLiveSmoke({
  baseUrl,
  resolvedAddress,
  courseId,
  expectations,
  sessionCookie,
}) {
  let lastError;
  for (let attempt = 1; attempt <= networkRetryPolicy.maxAttempts; attempt += 1) {
    try {
      const learningPage = await requestDeploymentResource(
        `${stripTrailingSlashes(baseUrl)}${routes.learningPage}`,
        {
          headers: withSessionCookie({ accept: "text/html" }, sessionCookie),
          resolvedAddress,
          timeoutMs: networkRetryPolicy.perAttemptTimeoutMs,
        },
      );
      const manifestResponse = await requestDeploymentResource(
        `${stripTrailingSlashes(baseUrl)}/api/learning/ppt-playback/${courseId}`,
        {
          headers: withSessionCookie({ accept: "application/json" }, sessionCookie),
          resolvedAddress,
          timeoutMs: networkRetryPolicy.perAttemptTimeoutMs,
        },
      );
      const manifestBody = manifestResponse.ok ? await manifestResponse.json() : undefined;
      const playback = isRecord(manifestBody?.playback) ? manifestBody.playback : undefined;
      const slides = Array.isArray(playback?.slides) ? playback.slides : [];
      const firstSlide = isRecord(slides[0]) ? slides[0] : undefined;
      const lastSlide = isRecord(slides.at(-1)) ? slides.at(-1) : undefined;
      const manifestMatchesPublishedPlayback = manifestResponse.ok
        ? expectations === "derived"
          ? isSelfConsistentPlaybackManifest({ playback, slides, firstSlide, lastSlide, courseId })
          : playback?.status === "ready" &&
            playback.courseId === publishedPlayback.courseId &&
            playback.audioManifestId === publishedPlayback.manifestId &&
            playback.teacherName === publishedPlayback.teacherName &&
            playback.voiceLabel === publishedPlayback.voiceLabel &&
            firstSlide?.slideId === publishedPlayback.firstSlideId &&
            firstSlide?.slideTitle === publishedPlayback.firstSlideTitle &&
            firstSlide?.audioId === publishedPlayback.firstAudioId &&
            typeof firstSlide?.audioUrl === "string" &&
            firstSlide.audioUrl.startsWith("/api/learning/ppt-playback/audio/") &&
            lastSlide?.slideTitle === publishedPlayback.lastSlideTitle
        : false;
      // Derived mode takes the count from the deployment's own manifest: the
      // property worth checking is that `slideCount` and `slides` agree, since a
      // disagreement is what a half-published deck looks like.
      const manifestSlideCount =
        expectations === "derived"
          ? slides.length > 0 && playback?.slideCount === slides.length
          : playback?.slideCount === publishedPlayback.slideCount &&
            slides.length === publishedPlayback.slideCount;
      const studentSafeRedaction = isStudentSafePlaybackManifest(playback);
      const audio = await verifyFirstSlideAudio({
        baseUrl,
        audioUrl: typeof firstSlide?.audioUrl === "string" ? firstSlide.audioUrl : undefined,
        resolvedAddress,
        sessionCookie,
      });
      const results = {
        learningPageHttp200: learningPage.ok ? "passed" : "failed",
        playbackManifestKangXiaVoice: manifestMatchesPublishedPlayback ? "passed" : "failed",
        playbackManifestSlideCount: manifestSlideCount ? "passed" : "failed",
        playbackManifestStudentSafeRedaction: studentSafeRedaction ? "passed" : "failed",
        firstSlideAudioWavHeaders: audio.status,
      };
      const blockedReasons = Object.entries(results)
        .filter(([, status]) => status !== "passed")
        .map(([key]) => `${key}-failed`);

      return {
        status: blockedReasons.length === 0 ? "passed" : "failed",
        httpStatus: {
          learningPage: learningPage.status,
          playbackManifest: manifestResponse.status,
          firstSlideAudio: audio.httpStatus,
        },
        ...(expectations === "derived" ? { expectations } : {}),
        playback: playback
          ? {
              courseId: playback.courseId,
              audioManifestId: playback.audioManifestId,
              teacherName: playback.teacherName,
              voiceLabel: playback.voiceLabel,
              slideCount: playback.slideCount,
              firstSlideTitle: firstSlide?.slideTitle,
              lastSlideTitle: lastSlide?.slideTitle,
              firstAudioUrl: firstSlide?.audioUrl,
            }
          : undefined,
        audio: {
          contentType: audio.contentType,
          contentLength: audio.contentLength,
          wavHeader: audio.wavHeader,
        },
        networkAttempts: createNetworkAttempts(attempt),
        results,
        blockedReasons,
      };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    status: "failed",
    results: {
      learningPageHttp200: "failed",
      playbackManifestKangXiaVoice: "failed",
      playbackManifestSlideCount: "failed",
      playbackManifestStudentSafeRedaction: "failed",
      firstSlideAudioWavHeaders: "failed",
    },
    networkAttempts: createNetworkAttempts(networkRetryPolicy.maxAttempts),
    networkError: classifyNetworkError(lastError),
    blockedReasons: ["learning-ppt-playback-smoke-request-failed"],
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

async function verifyFirstSlideAudio({ baseUrl, audioUrl, resolvedAddress, sessionCookie }) {
  if (!audioUrl) {
    return {
      status: "failed",
      httpStatus: undefined,
      contentType: undefined,
      contentLength: undefined,
      wavHeader: "missing",
    };
  }

  const response = await requestDeploymentResource(new URL(audioUrl, baseUrl), {
    headers: withSessionCookie({ accept: "audio/wav" }, sessionCookie),
    resolvedAddress,
    timeoutMs: networkRetryPolicy.perAttemptTimeoutMs,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const header = Buffer.from(bytes.slice(0, 12)).toString("ascii");
  const contentType = response.headers.get("content-type");
  const contentLength = Number(response.headers.get("content-length") ?? bytes.byteLength);
  const hasWavHeader = header.startsWith("RIFF") && header.includes("WAVE");

  return {
    status:
      response.ok &&
      isWavContentType(contentType) &&
      Number.isFinite(contentLength) &&
      contentLength >= minimumFirstSlideAudioContentLength &&
      hasWavHeader
        ? "passed"
        : "failed",
    httpStatus: response.status,
    contentType,
    contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    wavHeader: hasWavHeader ? "RIFF/WAVE" : "missing",
  };
}

function isWavContentType(contentType) {
  if (typeof contentType !== "string") {
    return false;
  }
  return /^audio\/(wav|wave|x-wav)(?:\s*;|$)/i.test(contentType);
}

// What "this deck is really published" looks like without knowing which deck it
// is: the manifest answers for the course that was asked for, its slide list is
// slide-01..slide-NN in the order audio lookup indexes by, its teacher and voice
// are filled in, and its first slide points at the audio route.
function isSelfConsistentPlaybackManifest({ playback, slides, firstSlide, lastSlide, courseId }) {
  return (
    playback?.status === "ready" &&
    playback.courseId === courseId &&
    hasValue(playback.audioManifestId) &&
    hasValue(playback.teacherName) &&
    hasValue(playback.voiceLabel) &&
    slides.length > 0 &&
    slides.every(
      (slide, index) =>
        isRecord(slide) && slide.slideId === `slide-${String(index + 1).padStart(2, "0")}`,
    ) &&
    hasValue(firstSlide?.slideTitle) &&
    hasValue(lastSlide?.slideTitle) &&
    typeof firstSlide?.audioUrl === "string" &&
    firstSlide.audioUrl.startsWith(
      `/api/learning/ppt-playback/audio/${playback.audioManifestId}/`,
    )
  );
}

function withSessionCookie(headers, sessionCookie) {
  return sessionCookie ? { ...headers, cookie: sessionCookie } : headers;
}

// Shape-checked, never printed. A value carrying CR or LF would split the
// request into two, so it is refused rather than sanitized - an operator pasting
// a mangled cookie should hear about it before a release gate records a pass.
function normalizeSessionCookie(value) {
  if (!hasValue(value)) {
    return undefined;
  }
  const sessionCookie = value.trim();
  if (/[\r\n\0]/.test(sessionCookie)) {
    throw new Error("--session-cookie must be a single-line cookie header value.");
  }
  return sessionCookie;
}

function isStudentSafePlaybackManifest(playback) {
  const serializedPlayback = JSON.stringify(playback ?? {});
  return (
    !serializedPlayback.includes("/api/ai/ppt-narration/audio") &&
    !serializedPlayback.includes("server-side-cloned-qwen-voice") &&
    !serializedPlayback.includes("DASHSCOPE_API_KEY") &&
    !serializedPlayback.includes("/Users/") &&
    !/data:audio\/[^"',}\]\s]+base64/i.test(serializedPlayback)
  );
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
    courseId: undefined,
    sessionCookie: undefined,
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
    } else if (arg === "--course-id") {
      options.courseId = normalizeCourseId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--session-cookie") {
      options.sessionCookie = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-production-deployment") {
      options.vercelProductionDeployment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/learning-ppt-playback-deployment-smoke.mjs [--dry-run] [--live --approved --base-url URL] [--resolved-address IP] [--environment production|preview|local-production|unspecified] [--env-file PATH] [--release-run-id ID] [--course-id COURSE] [--session-cookie COOKIE] [--vercel-production-deployment PATH]",
          "",
          "Outputs redacted deployed /learning Kang Xia PPT playback smoke JSON. Dry-run never uses network; live mode checks public playback manifest and first WAV without printing URLs or response bodies.",
          "",
          "--course-id smokes any published course and derives its expectations - slide count, titles, teacher - from the deployed manifest instead of the pinned Kang Xia demo values. With no --course-id the pinned demo expectations apply, unchanged.",
          "--session-cookie (or UAIS_DEPLOYMENT_SESSION_COOKIE via --env-file) attaches a session to every request, so an auth-enforcing deployment can be smoked. The value is never printed.",
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

// The catalog's own charset: a course id is interpolated into a request path.
function normalizeCourseId(value) {
  const courseId = value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(courseId)) {
    throw new Error("--course-id must match the published course id charset.");
  }
  return courseId;
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
