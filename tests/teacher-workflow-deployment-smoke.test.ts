import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let openServers: Server[] = [];

describe("deployed teacher workflow page smoke", () => {
  afterEach(async () => {
    await Promise.all(openServers.map((server) => closeServerForTest(server)));
    openServers = [];
  });

  it("blocks production page smoke when Vercel deployment evidence is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-page-dry-"));
    const envFile = join(tmpDir, "teacher-page.env");
    writeFileSync(envFile, "UAIS_DEPLOYMENT_BASE_URL=https://teacher-page.example.test\n");

    const output = execFileSync("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-deployment-smoke",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "blocked",
        responsibleSession: "S22",
        route: "/teaching",
        prerequisites: [
          {
            id: "s22-deployment-base-url",
            responsibleSession: "S22",
            requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
            status: "present",
          },
          {
            id: "s22-vercel-production-deployment-evidence",
            responsibleSession: "S22",
            requiredEvidence: "vercel-production-deployment",
            status: "missing",
            valueRedacted: true,
          },
        ],
        blockedReasons: ["vercel-production-deployment-evidence-missing"],
        vercelProductionDeploymentEvidence: {
          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          valueRedacted: true,
        },
        safety: expect.objectContaining({
          valuesRedacted: true,
          responseBodyOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          checksRenderedTeacherWorkflowAnchors: true,
          cookieValuesOmitted: true,
          remoteMutationRequiresApproval: true,
        }),
      }),
    );
    expect(body.anchors).toEqual([
      "teacherWorkflowTitle",
      "voiceSampleUpload",
      "voiceSampleSelect",
      "uploadedSampleAudioPayload",
      "voiceSampleDurationGate",
      "selectedSampleIdentity",
      "preflight",
      "pptNarrationGenerate",
      "perSlideWavDownloads",
      "signedSessionBootstrap",
      "signedSessionReadiness",
      "workflowSessionActions",
      "serverWorkflowStatus",
      "serverWorkflowProgress",
    ]);
    expect(output).not.toContain("teacher-page.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("passes live approved smoke only when deployed teaching page contains teacher workflow anchors", async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe("/teaching");
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <main>
          <h1>Teacher PPT Narration Workflow</h1>
          <label>Upload/select 10-second teacher voice</label>
          <span data-uais-voice-sample-select="file-input"></span>
          <span data-uais-uploaded-sample-audio-payload="sampleAudioBase64"></span>
          <span data-uais-voice-sample-duration-gate="browser-metadata"></span>
          <span data-uais-selected-sample-identity="sampleAssetId voiceRefId"></span>
          <button>Run workflow preflight</button>
          <button>Generate PPT narration</button>
          <p>Per-slide WAV downloads appear after generation.</p>
          <section data-uais-signed-session-bootstrap="/api/ai/session"></section>
          <section data-uais-session-readiness="not-checked"></section>
          <section data-uais-workflow-session-actions="teacher-ppt-workflow-read voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"></section>
          <section data-uais-server-workflow-status="/api/ai/teacher-ppt-workflow"></section>
          <section data-uais-server-workflow-progress="auth-provider-storage-route"></section>
          <span>secret-page-body-should-not-leak</span>
        </main>
      `);
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
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
        target: "teacher-workflow-deployment-smoke",
        mode: "live",
        environment: "local-production",
        network: "enabled",
        status: "passed",
        responsibleSession: "S22",
        route: "/teaching",
        httpStatus: 200,
        blockedReasons: [],
      }),
    );
    expect(body.results).toEqual({
      teacherWorkflowTitle: "present",
      voiceSampleUpload: "present",
      voiceSampleSelect: "present",
      uploadedSampleAudioPayload: "present",
      voiceSampleDurationGate: "present",
      selectedSampleIdentity: "present",
      preflight: "present",
      pptNarrationGenerate: "present",
      perSlideWavDownloads: "present",
      signedSessionBootstrap: "present",
      signedSessionReadiness: "present",
      workflowSessionActions: "present",
      serverWorkflowStatus: "present",
      serverWorkflowProgress: "present",
    });
    expect(body.deploymentFingerprint).toEqual({
      status: "present",
      value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
    });
    expect(body.renderedPageFingerprint).toEqual({
      status: "present",
      value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
    });
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("secret-page-body-should-not-leak");
  });

  it("sends a redacted signed teacher cookie from the env file when the teaching page is protected", async () => {
    const cookie = "uais_teacher_auth_claims=claims-for-test; uais_teacher_auth_signature=signature-for-test";
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.headers.cookie ?? "");
      response.writeHead(200, { "content-type": "text/html" });
      if (request.headers.cookie === cookie) {
        response.end(fullTeacherWorkflowHtml("protected-page-body-should-not-leak"));
        return;
      }
      response.end("<main>Login required before teacher workflow access.</main>");
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-page-cookie-"));
    const envFile = join(tmpDir, "teacher-page-cookie.env");
    writeFileSync(envFile, `UAIS_TEACHER_WORKFLOW_SMOKE_COOKIE=${cookie}\n`);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--env-file",
      envFile,
    ]);
    const body = JSON.parse(output);

    expect(requests).toEqual([cookie]);
    expect(body.status).toBe("passed");
    expect(body.results).toEqual(
      expect.objectContaining({
        teacherWorkflowTitle: "present",
        signedSessionBootstrap: "present",
      }),
    );
    expect(output).not.toContain(cookie);
    expect(output).not.toContain("claims-for-test");
    expect(output).not.toContain("signature-for-test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("protected-page-body-should-not-leak");
    expect(output).not.toContain("Login required before teacher workflow access.");
  });

  it("passes live approved smoke when workflow anchors are emitted in a same-origin Next client chunk", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      if (request.url === "/teaching") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`
          <main>
            <h1>Server shell without workflow anchors</h1>
            <script src="/_next/static/chunks/teacher-workflow-client.js"></script>
          </main>
        `);
        return;
      }
      if (request.url === "/_next/static/chunks/teacher-workflow-client.js") {
        response.writeHead(200, { "content-type": "application/javascript" });
        response.end(`globalThis.__UAIS_WORKFLOW_CHUNK__ = ${JSON.stringify(fullTeacherWorkflowHtml("client-chunk-secret"))};`);
        return;
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ]);
    const body = JSON.parse(output);

    expect(requests).toEqual([
      "GET /teaching",
      "GET /_next/static/chunks/teacher-workflow-client.js",
    ]);
    expect(body.status).toBe("passed");
    expect(body.results).toEqual(
      Object.fromEntries(
        [
          "teacherWorkflowTitle",
          "voiceSampleUpload",
          "voiceSampleSelect",
          "uploadedSampleAudioPayload",
          "voiceSampleDurationGate",
          "selectedSampleIdentity",
          "preflight",
          "pptNarrationGenerate",
          "perSlideWavDownloads",
          "signedSessionBootstrap",
          "signedSessionReadiness",
          "workflowSessionActions",
          "serverWorkflowStatus",
          "serverWorkflowProgress",
        ].map((anchor) => [anchor, "present"]),
      ),
    );
    expect(body.clientChunkEvidence).toEqual({
      checked: true,
      fetched: 1,
      failed: 0,
      valuesRedacted: true,
    });
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("client-chunk-secret");
  });

  it("can connect through a pinned resolved address without leaking the deployment host", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"} host=${request.headers.host ?? ""}`);
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fullTeacherWorkflowHtml("resolved-address-page-secret"));
    });
    const localBaseUrl = await listenForTest(server);
    const port = new URL(localBaseUrl).port;
    const baseUrl = `http://unresolved-teacher-workflow.example.test:${port}`;

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
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

    expect(requests).toEqual([
      `GET /teaching host=unresolved-teacher-workflow.example.test:${port}`,
    ]);
    expect(body.status).toBe("passed");
    expect(body.networkAddressOverride).toEqual({
      status: "enabled",
      addressSource: "pinned",
      valueRedacted: true,
    });
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("unresolved-teacher-workflow.example.test");
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("resolved-address-page-secret");
  });

  it("retries transient live request failures before evaluating deployed teaching anchors", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      if (requests.length === 1) {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fullTeacherWorkflowHtml("retry-page-body-should-not-leak"));
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
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
    expect(requests).toEqual(["GET /teaching", "GET /teaching"]);
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("retry-page-body-should-not-leak");
  });

  it("rejects production live page smoke without a release-run id before deployment requests", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<main>Unexpected production page smoke request.</main>");
    });
    const baseUrl = await listenForTest(server);

    const result = await execFileResultForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
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
      "Teacher workflow deployment smoke requires --release-run-id",
    );
    expect(result.stderr).not.toContain(baseUrl);
    expect(result.stderr).not.toContain("Unexpected production page smoke request");
    expect(result.stderr).not.toContain("/Users/");
  });

  it("binds live approved page smoke to Vercel deployment evidence by fingerprint", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fullTeacherWorkflowHtml("deployment-evidence-bound-secret"));
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-page-vercel-evidence-"));
    const releaseRunId = "release-teacher-page-evidence-binding";
    const matchingEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "matching-vercel-production-deployment.json",
      releaseRunId,
    });
    const mismatchedEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://different-production.example.test",
      filename: "mismatched-vercel-production-deployment.json",
      releaseRunId,
    });

    const matchedOutput = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
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

    expect(requests).toEqual(["GET /teaching"]);
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
    expect(matchedOutput).not.toContain("deployment-evidence-bound-secret");

    requests.length = 0;
    const mismatchedOutput = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
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
    expect(mismatchedOutput).not.toContain("different-production.example.test");
  });

  it("still captures deployed page anchors when Vercel deployment evidence is not deployed", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "text/html" });
      response.end(fullTeacherWorkflowHtml("not-deployed-evidence-page-secret"));
    });
    const baseUrl = await listenForTest(server);
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-page-not-deployed-"));
    const releaseRunId = "release-teacher-page-not-deployed-binding";
    const blockedEvidence = join(tmpDir, "blocked-vercel-production-deployment.json");
    writeFileSync(
      blockedEvidence,
      JSON.stringify({
        target: "vercel-production-deployment",
        mode: "live",
        status: "blocked",
        environment: "production",
        releaseRunId,
        deploymentObservation: { status: "pending" },
        deploymentFingerprint: {
          status: "present",
          value: `sha256:${createHash("sha256")
            .update(new URL(baseUrl).origin.toLowerCase())
            .digest("hex")
            .slice(0, 16)}`,
        },
      }),
    );

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      blockedEvidence,
    ], { reject: false });
    const body = JSON.parse(output);

    expect(requests).toEqual(["GET /teaching"]);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-deployment-smoke",
        mode: "live",
        environment: "local-production",
        status: "passed",
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "not-deployed",
          deploymentObservationStatus: "pending",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
      }),
    );
    expect(body.results).toEqual(
      Object.fromEntries([
        "teacherWorkflowTitle",
        "voiceSampleUpload",
        "voiceSampleSelect",
        "uploadedSampleAudioPayload",
        "voiceSampleDurationGate",
        "selectedSampleIdentity",
        "preflight",
        "pptNarrationGenerate",
        "perSlideWavDownloads",
        "signedSessionBootstrap",
        "signedSessionReadiness",
        "workflowSessionActions",
        "serverWorkflowStatus",
        "serverWorkflowProgress",
      ].map((anchor) => [anchor, "present"])),
    );
    expect(body.deploymentEvidenceBindingStatus).toBe("not-proven");
    expect(body.productionReleaseEligible).toBe(false);
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("not-deployed-evidence-page-secret");
  });

  it("blocks production live page smoke for non-remote-HTTPS deployment origins before requests", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"}`);
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<main>Unexpected local production target.</main>");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      baseUrl,
      "--release-run-id",
      "release-teacher-origin-block",
    ], { reject: false });
    const body = JSON.parse(output);

    expect(requests).toEqual([]);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-deployment-smoke",
        mode: "live",
        environment: "production",
        network: "enabled",
        status: "blocked",
        blockedReasons: [
          "production-deployment-origin-not-remote-https",
          "vercel-production-deployment-evidence-missing",
        ],
        deploymentOrigin: {
          status: "present",
          originClass: "local-loopback",
          valueRedacted: true,
        },
        vercelProductionDeploymentEvidence: {
          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          valueRedacted: true,
        },
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("Unexpected local production target");
  });

  it("keeps live smoke failed when deployed page omits uploaded audio payload support", async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe("/teaching");
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <main>
          <h1>Teacher PPT Narration Workflow</h1>
          <label>Upload/select 10-second teacher voice</label>
          <span data-uais-voice-sample-select="file-input"></span>
          <span data-uais-selected-sample-identity="sampleAssetId voiceRefId"></span>
          <button>Run workflow preflight</button>
          <button>Generate PPT narration</button>
          <p>Per-slide WAV downloads appear after generation.</p>
          <section data-uais-signed-session-bootstrap="/api/ai/session"></section>
          <section data-uais-session-readiness="not-checked"></section>
          <section data-uais-server-workflow-status="/api/ai/teacher-ppt-workflow"></section>
          <section data-uais-server-workflow-progress="auth-provider-storage-route"></section>
        </main>
      `);
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("failed");
    expect(body.results).toEqual(
      expect.objectContaining({
        uploadedSampleAudioPayload: "missing",
      }),
    );
    expect(body.blockedReasons).toEqual(["teacher-workflow-deployment-anchors-missing"]);
    expect(output).not.toContain(baseUrl);
  });

  it("keeps live smoke failed when deployed page omits the voice sample duration gate marker", async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe("/teaching");
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <main>
          <h1>Teacher PPT Narration Workflow</h1>
          <label>Upload/select 10-second teacher voice</label>
          <span data-uais-voice-sample-select="file-input"></span>
          <span data-uais-uploaded-sample-audio-payload="sampleAudioBase64"></span>
          <span data-uais-selected-sample-identity="sampleAssetId voiceRefId"></span>
          <button>Run workflow preflight</button>
          <button>Generate PPT narration</button>
          <p>Per-slide WAV downloads appear after generation.</p>
          <section data-uais-signed-session-bootstrap="/api/ai/session"></section>
          <section data-uais-session-readiness="not-checked"></section>
          <section data-uais-workflow-session-actions="voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"></section>
          <section data-uais-server-workflow-status="/api/ai/teacher-ppt-workflow"></section>
          <section data-uais-server-workflow-progress="auth-provider-storage-route"></section>
        </main>
      `);
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("failed");
    expect(body.results).toEqual(
      expect.objectContaining({
        voiceSampleDurationGate: "missing",
      }),
    );
    expect(body.blockedReasons).toEqual(["teacher-workflow-deployment-anchors-missing"]);
    expect(output).not.toContain(baseUrl);
  });

  it("keeps live smoke failed when deployed page omits signed workflow session actions", async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe("/teaching");
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <main>
          <h1>Teacher PPT Narration Workflow</h1>
          <label>Upload/select 10-second teacher voice</label>
          <span data-uais-voice-sample-select="file-input"></span>
          <span data-uais-uploaded-sample-audio-payload="sampleAudioBase64"></span>
          <span data-uais-selected-sample-identity="sampleAssetId voiceRefId"></span>
          <button>Run workflow preflight</button>
          <button>Generate PPT narration</button>
          <p>Per-slide WAV downloads appear after generation.</p>
          <section data-uais-signed-session-bootstrap="/api/ai/session"></section>
          <section data-uais-session-readiness="not-checked"></section>
          <section data-uais-server-workflow-status="/api/ai/teacher-ppt-workflow"></section>
          <section data-uais-server-workflow-progress="auth-provider-storage-route"></section>
        </main>
      `);
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("failed");
    expect(body.results).toEqual(
      expect.objectContaining({
        workflowSessionActions: "missing",
      }),
    );
    expect(body.blockedReasons).toEqual(["teacher-workflow-deployment-anchors-missing"]);
    expect(output).not.toContain(baseUrl);
  });

  it("keeps live smoke failed when deployed page omits signed session readiness evidence", async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe("/teaching");
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <main>
          <h1>Teacher PPT Narration Workflow</h1>
          <label>Upload/select 10-second teacher voice</label>
          <span data-uais-voice-sample-select="file-input"></span>
          <span data-uais-uploaded-sample-audio-payload="sampleAudioBase64"></span>
          <span data-uais-voice-sample-duration-gate="browser-metadata"></span>
          <span data-uais-selected-sample-identity="sampleAssetId voiceRefId"></span>
          <button>Run workflow preflight</button>
          <button>Generate PPT narration</button>
          <p>Per-slide WAV downloads appear after generation.</p>
          <section data-uais-signed-session-bootstrap="/api/ai/session"></section>
          <section data-uais-workflow-session-actions="voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"></section>
          <section data-uais-server-workflow-status="/api/ai/teacher-ppt-workflow"></section>
          <section data-uais-server-workflow-progress="auth-provider-storage-route"></section>
        </main>
      `);
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("failed");
    expect(body.results).toEqual(
      expect.objectContaining({
        signedSessionReadiness: "missing",
      }),
    );
    expect(body.blockedReasons).toEqual(["teacher-workflow-deployment-anchors-missing"]);
    expect(output).not.toContain(baseUrl);
  });

  it("keeps live smoke failed when deployed page omits server workflow readiness progress", async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe("/teaching");
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <main>
          <h1>Teacher PPT Narration Workflow</h1>
          <label>Upload/select 10-second teacher voice</label>
          <span data-uais-voice-sample-select="file-input"></span>
          <span data-uais-uploaded-sample-audio-payload="sampleAudioBase64"></span>
          <span data-uais-voice-sample-duration-gate="browser-metadata"></span>
          <span data-uais-selected-sample-identity="sampleAssetId voiceRefId"></span>
          <button>Run workflow preflight</button>
          <button>Generate PPT narration</button>
          <p>Per-slide WAV downloads appear after generation.</p>
          <section data-uais-signed-session-bootstrap="/api/ai/session"></section>
          <section data-uais-session-readiness="not-checked"></section>
          <section data-uais-workflow-session-actions="voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"></section>
          <section data-uais-server-workflow-status="/api/ai/teacher-ppt-workflow"></section>
        </main>
      `);
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("failed");
    expect(body.results).toEqual(
      expect.objectContaining({
        serverWorkflowProgress: "missing",
      }),
    );
    expect(body.blockedReasons).toEqual(["teacher-workflow-deployment-anchors-missing"]);
    expect(output).not.toContain(baseUrl);
  });

  it("keeps live smoke failed when the deployment page misses workflow anchors", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<main>Teaching dashboard without workflow copy.</main>");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--base-url",
      baseUrl,
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("failed");
    expect(body.blockedReasons).toEqual(["teacher-workflow-deployment-anchors-missing"]);
    expect(Object.values(body.results).every((value) => value === "missing")).toBe(true);
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("Teaching dashboard without workflow copy.");
  });

  it("classifies live request failures without leaking URLs or error text", async () => {
    const baseUrl = "http://127.0.0.1:9";

    const output = await execFileForTest("node", [
      "scripts/teacher-workflow-deployment-smoke.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("failed");
    expect(body.blockedReasons).toEqual(["teacher-workflow-deployment-request-failed"]);
    expect(body.networkError).toEqual({
      class: "TypeError",
      valueRedacted: true,
    });
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("ECONNREFUSED");
  });
});

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
    }, reject);
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

function fullTeacherWorkflowHtml(secret: string) {
  return `
    <main>
      <h1>Teacher PPT Narration Workflow</h1>
      <label>Upload/select 10-second teacher voice</label>
      <span data-uais-voice-sample-select="file-input"></span>
      <span data-uais-uploaded-sample-audio-payload="sampleAudioBase64"></span>
      <span data-uais-voice-sample-duration-gate="browser-metadata"></span>
      <span data-uais-selected-sample-identity="sampleAssetId voiceRefId"></span>
      <button>Run workflow preflight</button>
      <button>Generate PPT narration</button>
      <p>Per-slide WAV downloads appear after generation.</p>
      <section data-uais-signed-session-bootstrap="/api/ai/session"></section>
      <section data-uais-session-readiness="not-checked"></section>
      <section data-uais-workflow-session-actions="teacher-ppt-workflow-read voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"></section>
      <section data-uais-server-workflow-status="/api/ai/teacher-ppt-workflow"></section>
      <section data-uais-server-workflow-progress="auth-provider-storage-route"></section>
      <span>${secret}</span>
    </main>
  `;
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
