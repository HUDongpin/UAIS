import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileForTest = promisify(execFile);

describe("teacher workflow live generation smoke", () => {
  it("prints Node v24-safe help usage for env-file arguments", () => {
    const output = execFileSync("node", [
      "scripts/teacher-workflow-live-generation-smoke.mjs",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain(
      "Usage: node -- scripts/teacher-workflow-live-generation-smoke.mjs",
    );
    expect(output).toContain("--env-file");
    expect(output).not.toContain(
      "Usage: node scripts/teacher-workflow-live-generation-smoke.mjs",
    );
  });

  it("reports a redacted dry-run plan for owner-approved live provider generation", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-live-generation-"));
    const envFile = join(tmpDir, "teacher-live-generation.env");
    const baseUrl = "https://teacher-live-generation.example.test";
    const externalStorageBaseUrl = "https://storage.teacher-live-generation.example.test/api";
    const releaseRunId = "release-live-generation-dry-run";
    writeFileSync(
      envFile,
      [
        `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}`,
        `UAIS_EXTERNAL_STORAGE_BASE_URL=${externalStorageBaseUrl}`,
        "",
      ].join("\n"),
    );
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      { releaseRunId },
    );
    const externalStorageServiceReadiness =
      writeExternalStorageServiceReadinessEvidenceForTest(tmpDir, {
        externalStorageBaseUrl,
        releaseRunId,
      });

    const output = execFileSync("node", [
      "scripts/teacher-workflow-live-generation-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
      "--external-storage-service-readiness",
      externalStorageServiceReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-live-generation-smoke",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "ready",
        responsibleSession: "S22",
        route: "/teaching",
        releaseRunId,
        deploymentOrigin: {
          status: "present",
          originClass: "remote-https",
          valueRedacted: true,
        },
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "matched",
          deploymentObservationStatus: "observed",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        teacherAuthProviderReadinessEvidence: {
          target: "teacher-auth-provider-readiness",
          status: "matched",
          authProviderMode: "trusted-cookie-issuer",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        storageServiceFingerprint: {
          ...createStorageServiceFingerprintForTest(externalStorageBaseUrl),
          source: "origin",
          valueRedacted: true,
        },
        externalStorageServiceReadinessEvidence: {
          target: "external-storage-service-readiness",
          status: "matched",
          releaseRunIdStatus: "matched",
          valueRedacted: true,
        },
        providerMutationPolicy: {
          workflowApis: "live-workflow-status",
          remoteMutations: "live-provider-approved",
          liveProviderApproved: true,
          responseBodiesOmitted: true,
          providerTaskIdsRedacted: true,
        },
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
        safety: expect.objectContaining({
          valuesRedacted: true,
          providerTaskIdsRedacted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          cookieValuesOmitted: true,
          remoteMutationRequiresApproval: true,
        }),
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-deployment-base-url",
          responsibleSession: "S22",
          requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
          status: "present",
        },
        expect.objectContaining({
          id: "s19-dashscope-api-key",
          status: "required-for-live",
          valueRedacted: true,
        }),
        expect.objectContaining({
          id: "s19-live-ai-approval-token",
          status: "required-for-live",
          valueRedacted: true,
        }),
        expect.objectContaining({
          id: "s24-approved-teacher-voice-sample",
          status: "required-for-live",
          valueRedacted: true,
        }),
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(externalStorageBaseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks production dry-run without teacher auth provider readiness binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-live-generation-auth-binding-"));
    const envFile = join(tmpDir, "teacher-live-generation.env");
    const baseUrl = "https://teacher-live-generation.example.test";
    const releaseRunId = "release-live-generation-auth-binding";
    writeFileSync(envFile, `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}\n`);
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });

    const output = execFileSync("node", [
      "scripts/teacher-workflow-live-generation-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("teacher-auth-provider-readiness-evidence-missing");
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-teacher-auth-provider-readiness-evidence",
          responsibleSession: "S22",
          requiredEvidence: "teacher-auth-provider-readiness",
          status: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks production dry-run without external storage service readiness binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-live-generation-storage-binding-"));
    const envFile = join(tmpDir, "teacher-live-generation.env");
    const baseUrl = "https://teacher-live-generation.example.test";
    const externalStorageBaseUrl = "https://storage.teacher-live-generation.example.test";
    const releaseRunId = "release-live-generation-storage-binding";
    writeFileSync(
      envFile,
      [
        `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}`,
        `UAIS_EXTERNAL_STORAGE_BASE_URL=${externalStorageBaseUrl}`,
        "",
      ].join("\n"),
    );
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId,
    });
    const teacherAuthProviderReadiness = writeTeacherAuthProviderReadinessEvidenceForTest(
      tmpDir,
      { releaseRunId },
    );

    const output = execFileSync("node", [
      "scripts/teacher-workflow-live-generation-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--release-run-id",
      releaseRunId,
      "--vercel-production-deployment",
      vercelProductionDeployment,
      "--teacher-auth-provider-readiness",
      teacherAuthProviderReadiness,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain(
      "external-storage-service-readiness-evidence-missing",
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-external-storage-service-readiness-evidence",
          responsibleSession: "S22",
          requiredEvidence: "external-storage-service-readiness",
          status: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(externalStorageBaseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects live generation without explicit owner approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/teacher-workflow-live-generation-smoke.mjs",
        "--live",
        "--environment",
        "production",
        "--release-run-id",
        "release-live-generation-approval",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow(/requires explicit owner approval/);
  });

  it("emits issued teacher auth cookie provenance after live issuer bootstrap", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-live-generation-auth-"));
    const envFile = join(tmpDir, "teacher-live-generation.env");
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push(`${request.method ?? "UNKNOWN"} ${url.pathname}`);
      if (request.method === "POST") {
        await readRequestBody(request);
      }

      if (request.method === "POST" && url.pathname === "/api/ai/teacher-auth/issue") {
        response.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": [
            "uais_teacher_auth_claims=redacted-claims; Path=/; HttpOnly; SameSite=Lax",
            "uais_teacher_auth_signature=redacted-signature; Path=/; HttpOnly; SameSite=Lax",
          ],
        });
        response.end(JSON.stringify({ status: "issued" }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/ai/session") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            accessSession: {
              headers: {
                "x-uais-access-claims": "redacted-access-claims",
                "x-uais-access-signature": "redacted-access-signature",
              },
            },
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/ai/voice-sample") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            voiceCloneSubmission: { taskId: "redacted-provider-task" },
            voiceCloneReference: { voiceRefId: "voice-ref-live-generation-test" },
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/ai/voice-clone/preflight") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            preflight: {
              status: "ready",
              checks: [{ id: "consent", status: "ready" }],
            },
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/ai/ppt-narration") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            pptNarrationAssets: {
              id: "manifest-live-generation-test",
              assets: [{ audioId: "audio-live-generation-test" }],
            },
          }),
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/ai/ppt-narration/export/manifest-live-generation-test"
      ) {
        response.writeHead(200, { "content-type": "application/zip" });
        response.end("redacted-zip");
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname ===
          "/api/ai/ppt-narration/audio/manifest-live-generation-test/audio-live-generation-test"
      ) {
        response.writeHead(200, { "content-type": "audio/wav" });
        response.end("redacted-audio");
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not-found" }));
    });
    const baseUrl = await listenForTest(server);
    writeFileSync(
      envFile,
      [
        `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}`,
        "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.live-generation.example.test",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-teacher-session-live-generation",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-ai-access-live-generation",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-teacher-issuer-live-generation",
        "DASHSCOPE_API_KEY=secret-dashscope-live-generation",
        "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-live-approval-generation",
        "UAIS_TEACHER_WORKFLOW_LIVE_SAMPLE_AUDIO_BASE64=UkVEQUNURUQ=",
        "",
      ].join("\n"),
    );

    try {
      const { stdout } = await execFileForTest(
        "node",
        [
          "scripts/teacher-workflow-live-generation-smoke.mjs",
          "--live",
          "--approved",
          "--environment",
          "local-production",
          "--env-file",
          envFile,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
        },
      );
      const body = JSON.parse(stdout);

      expect(body).toEqual(
        expect.objectContaining({
          target: "teacher-workflow-live-generation-smoke",
          mode: "live",
          environment: "local-production",
          status: "passed",
          auth: "issued-teacher-auth-cookie",
          results: Object.fromEntries(
            [
              "signedSessionBootstrap",
              "voiceSampleSubmit",
              "voiceClonePreflight",
              "voiceCloneStatusSucceeded",
              "pptNarrationSubmit",
              "generatedAudioManifest",
              "generatedZipExport",
              "perSlideAudioDownload",
            ].map((key) => [key, "passed"]),
          ),
        }),
      );
      expect(requests).toEqual([
        "POST /api/ai/teacher-auth/issue",
        "POST /api/ai/session",
        "POST /api/ai/voice-sample",
        "POST /api/ai/session",
        "POST /api/ai/voice-clone/preflight",
        "POST /api/ai/session",
        "POST /api/ai/ppt-narration",
        "POST /api/ai/session",
        "GET /api/ai/ppt-narration/export/manifest-live-generation-test",
        "POST /api/ai/session",
        "GET /api/ai/ppt-narration/audio/manifest-live-generation-test/audio-live-generation-test",
      ]);
      expect(stdout).not.toContain("redacted-claims");
      expect(stdout).not.toContain("redacted-signature");
      expect(stdout).not.toContain(tmpDir);
      expect(stdout).not.toContain("/Users/");
    } finally {
      await closeServerForTest(server);
    }
  });
});

function listenForTest(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not expose a TCP address."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServerForTest(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<void>((resolve, reject) => {
    request.on("data", () => undefined);
    request.on("end", () => resolve());
    request.on("error", reject);
  });
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

function writeTeacherAuthProviderReadinessEvidenceForTest(
  tmpDir: string,
  { releaseRunId }: { releaseRunId: string },
) {
  const path = join(tmpDir, "teacher-auth-provider-readiness.json");
  writeFileSync(
    path,
    JSON.stringify({
      target: "teacher-auth-provider-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId,
      authProviderMode: "trusted-cookie-issuer",
      redactionSafety: {
        valuesRedacted: true,
        secretsOmitted: true,
        cookieValuesOmitted: true,
        responseBodiesOmitted: true,
        noCookieIssued: true,
      },
    }),
  );
  return path;
}

function writeExternalStorageServiceReadinessEvidenceForTest(
  tmpDir: string,
  {
    externalStorageBaseUrl,
    releaseRunId,
  }: { externalStorageBaseUrl: string; releaseRunId: string },
) {
  const path = join(tmpDir, "external-storage-service-readiness.json");
  writeFileSync(
    path,
    JSON.stringify({
      target: "external-storage-service-readiness",
      mode: "live",
      environment: "production",
      status: "ready",
      releaseRunId,
      storageServiceFingerprint:
        createStorageServiceFingerprintForTest(externalStorageBaseUrl),
      redactionSafety: {
        valuesRedacted: true,
        secretsOmitted: true,
        responseBodiesOmitted: true,
      },
    }),
  );
  return path;
}

function createDeploymentFingerprintForTest(baseUrl: string) {
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(baseUrl.replace(/\/+$/, "")).digest("hex").slice(0, 16)}`,
  };
}

function createStorageServiceFingerprintForTest(baseUrl: string) {
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(new URL(baseUrl).origin).digest("hex").slice(0, 16)}`,
    source: "origin",
    valueRedacted: true,
  };
}
