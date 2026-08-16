import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let openServers: Server[] = [];

describe("deployed learning PPT playback smoke", () => {
  afterEach(async () => {
    await Promise.all(openServers.map((server) => closeServerForTest(server)));
    openServers = [];
  });

  it("reports a redacted dry-run plan for deployed Kang Xia learning playback", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-learning-playback-dry-"));
    const envFile = join(tmpDir, "learning-playback.env");
    writeFileSync(envFile, "UAIS_DEPLOYMENT_BASE_URL=https://learning.example.test\n");

    const output = execFileSync("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      "uais-release-learning-smoke",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "learning-ppt-playback-deployment-smoke",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "ready",
        responsibleSession: "S22",
        releaseRunId: "uais-release-learning-smoke",
        routes: {
          learningPage: "/learning",
          playbackManifest: "/api/learning/ppt-playback/<course-id>",
          firstSlideAudio: "/api/learning/ppt-playback/audio/<manifest-id>/<audio-id>",
        },
        prerequisites: [
          {
            id: "s22-deployment-base-url",
            responsibleSession: "S22",
            requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
            status: "present",
          },
        ],
        checks: [
          "learning-page-http-200",
          "kang-xia-manifest-19-slides",
          "student-safe-manifest-redaction",
          "first-slide-audio-wav-response",
        ],
        blockedReasons: [],
        safety: expect.objectContaining({
          valuesRedacted: true,
          responseBodiesOmitted: true,
          audioPayloadOmitted: true,
          liveRequiresApproval: true,
          checksPublishedLearningPlayback: true,
          cookieValuesOmitted: true,
          remoteMutationRequiresApproval: true,
        }),
      }),
    );
    expect(body.deploymentFingerprint).toEqual({
      status: "present",
      value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
    });
    expect(output).not.toContain("learning.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("passes live approved local-production smoke when page, manifest, and WAV are published", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      if (request.url === "/learning") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<main>我的学习</main>");
        return;
      }
      if (request.url === "/api/learning/ppt-playback/elementary-math-research") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(createPlaybackManifest()));
        return;
      }
      if (
        request.url ===
        "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01"
      ) {
        response.writeHead(200, {
          "content-type": "audio/wav",
          "content-length": "2048",
        });
        response.end(createWavBytes(2048));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ]);
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "learning-ppt-playback-deployment-smoke",
        mode: "live",
        environment: "local-production",
        network: "enabled",
        status: "passed",
        responsibleSession: "S22",
        httpStatus: {
          learningPage: 200,
          playbackManifest: 200,
          firstSlideAudio: 200,
        },
        playback: {
          courseId: "elementary-math-research",
          audioManifestId:
            "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
          teacherName: "康霞博士",
          voiceLabel: "康霞博士克隆声音",
          slideCount: 19,
          firstSlideTitle: "自然数的序数理论",
          lastSlideTitle: "作业布置",
          firstAudioUrl:
            "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
        },
        audio: {
          contentType: "audio/wav",
          contentLength: 2048,
          wavHeader: "RIFF/WAVE",
        },
        results: {
          learningPageHttp200: "passed",
          playbackManifestKangXiaVoice: "passed",
          playbackManifestSlideCount: "passed",
          playbackManifestStudentSafeRedaction: "passed",
          firstSlideAudioWavHeaders: "passed",
        },
        blockedReasons: [],
      }),
    );
    expect(body.deploymentFingerprint).toEqual({
      status: "present",
      value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
    });
    expect(requests).toEqual([
      "GET /learning",
      "GET /api/learning/ppt-playback/elementary-math-research",
      "GET /api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
    ]);
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("server-side-cloned-qwen-voice");
  });

  it("can connect playback smoke through a pinned resolved address without leaking host or audio payload", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"} host=${request.headers.host ?? ""}`);
      if (request.url === "/learning") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<main>我的学习 <span>resolved-learning-secret</span></main>");
        return;
      }
      if (request.url === "/api/learning/ppt-playback/elementary-math-research") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(createPlaybackManifest()));
        return;
      }
      if (
        request.url ===
        "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01"
      ) {
        response.writeHead(200, {
          "content-type": "audio/wav",
          "content-length": "2048",
        });
        response.end(createWavBytes(2048));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const localBaseUrl = await listenForTest(server);
    const port = new URL(localBaseUrl).port;
    const baseUrl = `http://unresolved-learning-playback.example.test:${port}`;

    const output = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--resolved-address",
      "127.0.0.1",
    ]);
    const body = JSON.parse(output);

    expect(body.status).toBe("passed");
    expect(body.networkAddressOverride).toEqual({
      status: "enabled",
      addressSource: "pinned",
      valueRedacted: true,
    });
    expect(requests).toEqual([
      `GET /learning host=unresolved-learning-playback.example.test:${port}`,
      `GET /api/learning/ppt-playback/elementary-math-research host=unresolved-learning-playback.example.test:${port}`,
      `GET /api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01 host=unresolved-learning-playback.example.test:${port}`,
    ]);
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("unresolved-learning-playback.example.test");
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("resolved-learning-secret");
    expect(output).not.toContain("WAVEfmt");
  });

  it("accepts Vercel static WAV MIME type variants during live playback smoke", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/learning") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<main>我的学习</main>");
        return;
      }
      if (request.url === "/api/learning/ppt-playback/elementary-math-research") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(createPlaybackManifest()));
        return;
      }
      if (
        request.url ===
        "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01"
      ) {
        response.writeHead(200, {
          "content-type": "audio/wave",
          "content-length": "2048",
        });
        response.end(createWavBytes(2048));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ]);
    const body = JSON.parse(output);

    expect(body.status).toBe("passed");
    expect(body.audio).toEqual({
      contentType: "audio/wave",
      contentLength: 2048,
      wavHeader: "RIFF/WAVE",
    });
    expect(body.results.firstSlideAudioWavHeaders).toBe("passed");
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("/Users/");
  });

  it("retries transient live request failures before checking learning playback", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      if (requests.length === 1) {
        request.socket.destroy();
        return;
      }
      if (request.url === "/learning") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<main>我的学习 <span>retry-learning-secret</span></main>");
        return;
      }
      if (request.url === "/api/learning/ppt-playback/elementary-math-research") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(createPlaybackManifest()));
        return;
      }
      if (
        request.url ===
        "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01"
      ) {
        response.writeHead(200, {
          "content-type": "audio/wav",
          "content-length": "2048",
        });
        response.end(createWavBytes(2048));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ]);
    const body = JSON.parse(output);

    expect(body.status).toBe("passed");
    expect(body.networkRetryPolicy).toEqual({
      maxAttempts: 3,
      perAttemptTimeoutMs: 10000,
      retryOn: ["request-error"],
      valuesRedacted: true,
    });
    expect(body.networkAttempts).toEqual({
      attempted: 2,
      maxAttempts: 3,
      retried: true,
      valueRedacted: true,
    });
    expect(requests).toEqual([
      "GET /learning",
      "GET /learning",
      "GET /api/learning/ppt-playback/elementary-math-research",
      "GET /api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
    ]);
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("retry-learning-secret");
  });

  it("rejects production live playback smoke without a release-run id before deployment requests", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<main>Unexpected production playback smoke request.</main>");
    });
    const baseUrl = await listenForTest(server);

    const result = await execFileResultForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      baseUrl,
    ]);

    expect(result.exitCode).toBe(1);
    expect(requests).toEqual([]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Learning PPT playback deployment smoke requires --release-run-id",
    );
    expect(result.stderr).not.toContain(baseUrl);
    expect(result.stderr).not.toContain("Unexpected production playback smoke request");
    expect(result.stderr).not.toContain("/Users/");
  });

  it("binds live approved learning playback smoke to Vercel deployment evidence by fingerprint", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      if (request.url === "/learning") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<main>我的学习 <span>learning-evidence-bound-secret</span></main>");
        return;
      }
      if (request.url === "/api/learning/ppt-playback/elementary-math-research") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(createPlaybackManifest()));
        return;
      }
      if (
        request.url ===
        "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01"
      ) {
        response.writeHead(200, {
          "content-type": "audio/wav",
          "content-length": "2048",
        });
        response.end(createWavBytes(2048));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-learning-playback-vercel-evidence-"));
    const releaseRunId = "release-learning-playback-evidence-binding";
    const matchingEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "matching-vercel-production-deployment.json",
      releaseRunId,
    });
    const mismatchedEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://different-learning-production.example.test",
      filename: "mismatched-vercel-production-deployment.json",
      releaseRunId,
    });

    const matchedOutput = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      matchingEvidence,
    ]);
    const matchedBody = JSON.parse(matchedOutput);

    expect(requests).toEqual([
      "GET /learning",
      "GET /api/learning/ppt-playback/elementary-math-research",
      "GET /api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
    ]);
    expect(matchedBody.status).toBe("passed");
    expect(matchedBody.vercelProductionDeploymentEvidence).toEqual({
      target: "vercel-production-deployment",
      status: "matched",
      deploymentObservationStatus: "observed",
      releaseRunIdStatus: "matched",
      valueRedacted: true,
    });
    expect(matchedBody.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-vercel-production-deployment-evidence",
          responsibleSession: "S22",
          requiredEvidence: "vercel-production-deployment",
          status: "matched",
          valueRedacted: true,
        },
      ]),
    );
    expect(matchedOutput).not.toContain(baseUrl);
    expect(matchedOutput).not.toContain(tmpDir);
    expect(matchedOutput).not.toContain("learning-evidence-bound-secret");

    requests.length = 0;
    const mismatchedOutput = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      mismatchedEvidence,
    ], { reject: false });
    const mismatchedBody = JSON.parse(mismatchedOutput);

    expect(requests).toEqual([]);
    expect(mismatchedBody).toEqual(
      expect.objectContaining({
        status: "blocked",
        blockedReasons: ["vercel-production-deployment-fingerprint-mismatch"],
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "mismatched",
          deploymentObservationStatus: "observed",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
      }),
    );
    expect(mismatchedBody.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-vercel-production-deployment-evidence",
          responsibleSession: "S22",
          requiredEvidence: "vercel-production-deployment",
          status: "mismatched",
          valueRedacted: true,
        },
      ]),
    );
    expect(mismatchedOutput).not.toContain(baseUrl);
    expect(mismatchedOutput).not.toContain(tmpDir);
    expect(mismatchedOutput).not.toContain("different-learning-production.example.test");
  });

  it("fails live approved smoke when the first slide audio is only a tiny WAV header", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/learning") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<main>我的学习</main>");
        return;
      }
      if (request.url === "/api/learning/ppt-playback/elementary-math-research") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(createPlaybackManifest()));
        return;
      }
      if (
        request.url ===
        "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01"
      ) {
        response.writeHead(200, {
          "content-type": "audio/wav",
          "content-length": "44",
        });
        response.end(createWavBytes(44));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "learning-ppt-playback-deployment-smoke",
        mode: "live",
        environment: "local-production",
        status: "failed",
        httpStatus: {
          learningPage: 200,
          playbackManifest: 200,
          firstSlideAudio: 200,
        },
        audio: {
          contentType: "audio/wav",
          contentLength: 44,
          wavHeader: "RIFF/WAVE",
        },
        results: {
          learningPageHttp200: "passed",
          playbackManifestKangXiaVoice: "passed",
          playbackManifestSlideCount: "passed",
          playbackManifestStudentSafeRedaction: "passed",
          firstSlideAudioWavHeaders: "failed",
        },
        blockedReasons: ["firstSlideAudioWavHeaders-failed"],
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("/Users/");
  });

  it("classifies live request failures without leaking URLs or error text", async () => {
    const baseUrl = "http://127.0.0.1:9";

    const output = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("failed");
    expect(body.blockedReasons).toEqual(["learning-ppt-playback-smoke-request-failed"]);
    expect(body.networkError).toEqual({
      class: "TypeError",
      valueRedacted: true,
    });
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("ECONNREFUSED");
  });

  it("attaches a session cookie to every request without printing it", async () => {
    // Unauthenticated, this smoke read an auth redirect as a playback failure -
    // so the audio-tracing fix could not be verified on a deployment that
    // enforces sign-in at all.
    const cookieHeaders: Array<string | undefined> = [];
    const sessionCookie = "uais_app_session=smoke-session-value-not-for-logs";
    const server = createServer((request, response) => {
      cookieHeaders.push(request.headers.cookie);
      if (request.headers.cookie !== sessionCookie) {
        response.writeHead(302, { location: "/login" });
        response.end();
        return;
      }
      respondWithDemoPlayback(request, response);
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--session-cookie",
      sessionCookie,
    ]);
    const body = JSON.parse(output);

    expect(body.status).toBe("passed");
    expect(cookieHeaders).toEqual([sessionCookie, sessionCookie, sessionCookie]);
    expect(body.sessionCookie).toEqual({ status: "present", valueRedacted: true });
    expect(output).not.toContain("smoke-session-value-not-for-logs");
    expect(output).not.toContain(sessionCookie);
  });

  it("reads the session cookie from the environment so it can arrive by --env-file", async () => {
    const cookieHeaders: Array<string | undefined> = [];
    const sessionCookie = "uais_app_session=env-file-session-value";
    const server = createServer((request, response) => {
      cookieHeaders.push(request.headers.cookie);
      respondWithDemoPlayback(request, response);
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-learning-playback-cookie-"));
    const envFile = join(tmpDir, "smoke.env");
    writeFileSync(envFile, `UAIS_DEPLOYMENT_SESSION_COOKIE=${sessionCookie}\n`);

    const output = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--env-file",
      envFile,
    ]);

    expect(JSON.parse(output).status).toBe("passed");
    expect(cookieHeaders).toEqual([sessionCookie, sessionCookie, sessionCookie]);
    expect(output).not.toContain("env-file-session-value");
  });

  it("refuses a session cookie that would split the request into two", async () => {
    const result = await execFileResultForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--dry-run",
      "--environment",
      "local-production",
      "--base-url",
      "https://learning.example.test",
      "--session-cookie",
      "uais_app_session=a\r\nx-injected: 1",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("single-line cookie header value");
    expect(result.stderr).not.toContain("x-injected");
  });

  it("smokes a non-demo course against expectations derived from its own manifest", async () => {
    // The pinned Kang Xia constants made the FIRST REAL published lecture
    // unsmokeable: a correct deployment of the autumn course failed every check.
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      if (request.url === "/learning") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<main>我的学习</main>");
        return;
      }
      if (request.url === "/api/learning/ppt-playback/autumn-2026-research-methods") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(createAutumnPlaybackManifest()));
        return;
      }
      if (
        request.url ===
        "/api/learning/ppt-playback/audio/audio-manifest-autumn-2026-week-01/tts_autumn-2026-week-01_slide-01"
      ) {
        response.writeHead(200, { "content-type": "audio/wav", "content-length": "2048" });
        response.end(createWavBytes(2048));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--course-id",
      "autumn-2026-research-methods",
    ]);
    const body = JSON.parse(output);

    expect(body.status).toBe("passed");
    expect(body.expectations).toBe("derived");
    expect(body.checks).toEqual([
      "learning-page-http-200",
      "published-manifest-self-consistent",
      "student-safe-manifest-redaction",
      "first-slide-audio-wav-response",
    ]);
    expect(body.playback).toMatchObject({
      courseId: "autumn-2026-research-methods",
      audioManifestId: "audio-manifest-autumn-2026-week-01",
      teacherName: "康霞博士",
      slideCount: 3,
      firstSlideTitle: "研究问题从哪里来",
      lastSlideTitle: "本周作业",
    });
    expect(requests).toEqual([
      "GET /learning",
      "GET /api/learning/ppt-playback/autumn-2026-research-methods",
      "GET /api/learning/ppt-playback/audio/audio-manifest-autumn-2026-week-01/tts_autumn-2026-week-01_slide-01",
    ]);
  });

  it("fails a derived-expectation smoke when the deployed manifest contradicts itself", async () => {
    // A slideCount that disagrees with the slide list is what a half-published
    // deck looks like from outside.
    const server = createServer((request, response) => {
      if (request.url === "/learning") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<main>我的学习</main>");
        return;
      }
      if (request.url === "/api/learning/ppt-playback/autumn-2026-research-methods") {
        const manifest = createAutumnPlaybackManifest();
        manifest.playback.slideCount = 19;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(manifest));
        return;
      }
      if (
        request.url ===
        "/api/learning/ppt-playback/audio/audio-manifest-autumn-2026-week-01/tts_autumn-2026-week-01_slide-01"
      ) {
        response.writeHead(200, { "content-type": "audio/wav", "content-length": "2048" });
        response.end(createWavBytes(2048));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest(
      "node",
      [
        "scripts/learning-ppt-playback-deployment-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--course-id",
        "autumn-2026-research-methods",
      ],
      { reject: false },
    );
    const body = JSON.parse(output);

    expect(body.status).toBe("failed");
    expect(body.blockedReasons).toEqual(["playbackManifestSlideCount-failed"]);
  });

  it("refuses a course id that would escape into the request path", async () => {
    const result = await execFileResultForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--dry-run",
      "--environment",
      "local-production",
      "--base-url",
      "https://learning.example.test",
      "--course-id",
      "../../etc/passwd",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--course-id must match the published course id charset");
  });

  it("blocks production live smoke for non-remote-HTTPS deployment origins before requests", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<main>Unexpected local target.</main>");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/learning-ppt-playback-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      baseUrl,
      "--release-run-id",
      "release-learning-origin-block",
    ], { reject: false });
    const body = JSON.parse(output);

    expect(requests).toEqual([]);
    expect(body).toEqual(
      expect.objectContaining({
        target: "learning-ppt-playback-deployment-smoke",
        mode: "live",
        environment: "production",
        network: "enabled",
        status: "blocked",
        blockedReasons: ["production-deployment-origin-not-remote-https"],
        deploymentOrigin: {
          status: "present",
          originClass: "local-loopback",
          valueRedacted: true,
        },
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("Unexpected local target");
  });
});

function createPlaybackManifest() {
  const slides = Array.from({ length: 19 }, (_, index) => {
    const slideNumber = String(index + 1).padStart(2, "0");
    return {
      slideId: `slide-${slideNumber}`,
      slideNumber: index + 1,
      slideTitle:
        index === 0 ? "自然数的序数理论" : index === 18 ? "作业布置" : `Slide ${index + 1}`,
      narrationText: "student-safe narration",
      audioId: `tts_natural-number-ordinal-theory-ppt1_slide-${slideNumber}`,
      audioUrl:
        `/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-${slideNumber}`,
      durationSeconds: 15,
    };
  });
  return {
    playback: {
      status: "ready",
      courseId: "elementary-math-research",
      courseTitle: "初等数学研究",
      sourceDeckTitle: "初等数学研究+PPT1+自然数的序数理论.pptx",
      audioManifestId:
        "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1",
      teacherName: "康霞博士",
      voiceLabel: "康霞博士克隆声音",
      slideCount: 19,
      slides,
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "published-learning-ids-only",
      },
    },
  };
}

function respondWithDemoPlayback(
  request: { url?: string },
  response: {
    writeHead: (status: number, headers?: Record<string, string>) => void;
    end: (body?: string | Buffer) => void;
  },
) {
  if (request.url === "/learning") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<main>我的学习</main>");
    return;
  }
  if (request.url === "/api/learning/ppt-playback/elementary-math-research") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(createPlaybackManifest()));
    return;
  }
  if (
    request.url ===
    "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01"
  ) {
    response.writeHead(200, { "content-type": "audio/wav", "content-length": "2048" });
    response.end(createWavBytes(2048));
    return;
  }
  response.writeHead(404);
  response.end("not found");
}

/** A three-slide published lecture that shares nothing with the demo constants. */
function createAutumnPlaybackManifest() {
  const titles = ["研究问题从哪里来", "可观察证据", "本周作业"];
  const slides = titles.map((slideTitle, index) => {
    const slideNumber = String(index + 1).padStart(2, "0");
    return {
      slideId: `slide-${slideNumber}`,
      slideNumber: index + 1,
      slideTitle,
      narrationText: "student-safe narration",
      imageUrl: `/learning/ppt-playback/slides/autumn-2026-week-01/page-${slideNumber}.jpg`,
      audioId: `tts_autumn-2026-week-01_slide-${slideNumber}`,
      audioUrl: `/api/learning/ppt-playback/audio/audio-manifest-autumn-2026-week-01/tts_autumn-2026-week-01_slide-${slideNumber}`,
      durationSeconds: 15,
    };
  });
  return {
    playback: {
      status: "ready",
      courseId: "autumn-2026-research-methods",
      courseTitle: "大学研究方法",
      sourceDeckTitle: "第一周：研究问题",
      audioManifestId: "audio-manifest-autumn-2026-week-01",
      teacherName: "康霞博士",
      voiceLabel: "康霞博士克隆声音",
      slideCount: slides.length,
      slides,
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "published-learning-ids-only",
      },
    },
  };
}

function listenForTest(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      openServers.push(server);
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a TCP address.");
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServerForTest(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createWavBytes(byteLength: number) {
  const bytes = Buffer.alloc(byteLength);
  bytes.write("RIFF----WAVEfmt ", 0, "ascii");
  return bytes;
}

function execFileForTest(
  command: string,
  args: string[],
  options: { reject?: boolean } = {},
) {
  return new Promise<string>((resolve, reject) => {
    import("node:child_process").then(({ execFile }) => {
      execFile(
        command,
        args,
        { cwd: process.cwd(), encoding: "utf8" },
        (error, stdout) => {
          if (error && options.reject !== false) {
            reject(error);
            return;
          }
          resolve(stdout);
        },
      );
    });
  });
}

function execFileResultForTest(command: string, args: string[]) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      import("node:child_process").then(({ execFile }) => {
        execFile(
          command,
          args,
          { cwd: process.cwd(), encoding: "utf8" },
          (error, stdout, stderr) => {
            resolve({
              exitCode: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
              stdout,
              stderr,
            });
          },
        );
      }, reject);
    },
  );
}

function writeVercelDeploymentEvidenceForTest(
  tmpDir: string,
  {
    baseUrl,
    filename,
    releaseRunId,
  }: { baseUrl: string; filename: string; releaseRunId: string },
) {
  const path = join(tmpDir, filename);
  writeFileSync(
    path,
    JSON.stringify({
      target: "vercel-production-deployment",
      mode: "live",
      action: "deploy",
      environment: "production",
      status: "deployed",
      releaseRunId,
      deploymentFingerprint: createDeploymentFingerprintForTest(baseUrl),
      deploymentObservation: {
        status: "observed",
        observedAt: "2026-06-18T00:00:00.000Z",
        source: "harness-clock",
      },
    }),
  );
  return path;
}

function createDeploymentFingerprintForTest(baseUrl: string) {
  const origin = new URL(baseUrl).origin.toLowerCase();
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`,
  };
}
