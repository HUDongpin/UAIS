import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("deployed teacher workflow browser smoke", () => {
  it("prints Node v24-safe help usage for env-file arguments", () => {
    const output = execFileSync("node", [
      "scripts/teacher-workflow-browser-smoke.mjs",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("Usage: node -- scripts/teacher-workflow-browser-smoke.mjs");
    expect(output).not.toContain("Usage: node scripts/teacher-workflow-browser-smoke.mjs");
  });

  it("recognizes the current Chinese teacher workflow UI copy", () => {
    const source = readFileSync("scripts/teacher-workflow-browser-smoke.mjs", "utf8");

    expect(source).toContain("教师课件配音工作流");
    expect(source).toContain("智能体配置工作台");
    expect(source).toContain("刷新服务端工作流");
    expect(source).toContain("服务端工作流可下载");
    expect(source).toContain("声音样本可用于复刻");
    expect(source).toContain("运行工作流预检");
    expect(source).toContain("预检就绪");
    expect(source).toContain("保存声音引用");
    expect(source).toContain("声音引用就绪");
    expect(source).toContain("^生成课件配音$");
    expect(source).toContain("课件配音已排队");
    expect(source).toContain("下载(?:服务器)?第");
    expect(source).toContain("UAIS_TEACHER_AUTH_ROUTE_SMOKE_TEACHER_ID");
  });

  it("reports a redacted dry-run browser interaction plan", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-smoke-"));
    const envFile = join(tmpDir, "teacher-browser.env");
    const baseUrl = "https://teacher-browser.example.test";
    writeFileSync(envFile, `UAIS_DEPLOYMENT_BASE_URL=${baseUrl}\n`);
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId: "release-browser-dry-run",
    });

    const output = execFileSync("node", [
      "scripts/teacher-workflow-browser-smoke.mjs",
      "--dry-run",
      "--environment",
      "production",
      "--env-file",
      envFile,
      "--vercel-production-deployment",
      vercelProductionDeployment,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
        mode: "dry-run",
        environment: "production",
        network: "disabled",
        status: "ready",
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
            id: "s22-browser-automation-runtime",
            responsibleSession: "S22",
            runtime: "playwright",
            status: "required-for-live",
          },
          {
            id: "s22-vercel-production-deployment-evidence",
            responsibleSession: "S22",
            requiredEvidence: "vercel-production-deployment",
            status: "matched",
            valueRedacted: true,
          },
        ],
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "matched",
          deploymentObservationStatus: "observed",
          releaseRunIdStatus: "missing",
          valueRedacted: true,
        },
        browserInteractions: [
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
        ],
        apiInterceptionPolicy: {
          workflowApis: "fixture-only",
          remoteMutations: "blocked",
          responseBodiesOmitted: true,
        },
        runtimeSetup: {
          packageName: "playwright",
          moduleResolution: "node-require-resolution",
          moduleStatus: expect.stringMatching(/^(present|missing)$/),
          npxStatus: "present",
          packageInstallCommand: "npm install --save-dev playwright",
          browserInstallCommand: "npx playwright install chromium",
          liveCommand:
            "node -- scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence>",
          transientRuntimeCommand:
            "npx --yes --package playwright --call 'NODE_PATH=\"$(dirname \"$(dirname \"$(command -v playwright)\")\")\" node -- scripts/teacher-workflow-browser-smoke.mjs --live --approved --environment production --base-url <deployment-url> --env-file <env-file> --release-run-id <release-run-id> --vercel-production-deployment <vercel-production-deployment-evidence>'",
        },
        safety: expect.objectContaining({
          valuesRedacted: true,
          deploymentUrlOmitted: true,
          responseBodiesOmitted: true,
          screenshotsOmitted: true,
          audioPayloadOmitted: true,
          liveRequiresApproval: true,
          cookieValuesOmitted: true,
          remoteMutationRequiresApproval: true,
        }),
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("plans a local browser smoke mode that reads the real protected workflow status route", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-live-workflow-"));
    const envFile = join(tmpDir, "teacher-browser-live-workflow.env");
    writeFileSync(
      envFile,
      [
        "UAIS_DEPLOYMENT_BASE_URL=http://127.0.0.1:43123",
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-browser-ai-access-fixture",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-browser-teacher-session-fixture",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-browser-teacher-issuer-fixture",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/teacher-workflow-browser-smoke.mjs",
      "--dry-run",
      "--environment",
      "local-production",
      "--env-file",
      envFile,
      "--api-mode",
      "live-workflow-status",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
        mode: "dry-run",
        environment: "local-production",
        status: "ready",
        apiInterceptionPolicy: {
          workflowApis: "live-workflow-status",
          remoteMutations: "fixture-blocked",
          responseBodiesOmitted: true,
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s12-teacher-workflow-browser-auth-bootstrap",
          responsibleSession: "S12",
          requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
          status: "present",
        },
        {
          id: "s19-teacher-workflow-browser-ai-access-secret",
          responsibleSession: "S19",
          requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
          status: "present",
        },
        {
          id: "s19-teacher-workflow-browser-session-secret",
          responsibleSession: "S19",
          requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          status: "present",
        },
        {
          id: "s12-teacher-workflow-browser-issuer-secret",
          responsibleSession: "S12",
          requiredEnv: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
          status: "present",
        },
      ]),
    );
    expect(output).not.toContain("43123");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("secret-browser");
    expect(output).not.toContain("/Users/");
  });

  it("uses the real signed AI session route when reading live workflow status", () => {
    const source = readFileSync("scripts/teacher-workflow-browser-smoke.mjs", "utf8");

    expect(source).toContain('if (pathname === "/api/ai/session" && request.method() === "POST")');
    expect(source).toContain('if (apiMode === "live-workflow-status")');
    expect(source).toContain('readAiSessionRequestAction(request) === "teacher-ppt-workflow-read"');
    expect(source).toContain("await routeRequest.continue();");
  });

  it("can issue teacher auth cookies through a pinned resolved address during live browser smoke", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-resolved-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const gotoMarker = join(tmpDir, "goto-called.marker");
    const envFile = join(tmpDir, "teacher-browser.env");
    const requests: string[] = [];
    writePassingPlaywrightRuntimeForTest({ nodeModulesDir, gotoMarker });
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "UNKNOWN"} ${request.url ?? "/"} host=${request.headers.host ?? ""}`);
      if (request.url === "/api/ai/teacher-auth/issue" && request.method === "POST") {
        response.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": [
            "uais_teacher_auth_claims=redacted-claims; Path=/; HttpOnly",
            "uais_teacher_auth_signature=redacted-signature; Path=/; HttpOnly",
          ],
        });
        response.end(JSON.stringify({ status: "issued" }));
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const localBaseUrl = await listenForTest(server);
    const port = new URL(localBaseUrl).port;
    const baseUrl = `http://unresolved-teacher-browser.example.test:${port}`;
    writeFileSync(
      envFile,
      [
        "UAIS_AI_ACCESS_SIGNING_SECRET=secret-browser-ai-access-fixture",
        "UAIS_TEACHER_AUTH_PROVIDER=trusted-cookie-issuer",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET=secret-browser-teacher-session-fixture",
        "UAIS_TEACHER_AUTH_ISSUER_SECRET=secret-browser-teacher-issuer-fixture",
      ].join("\n"),
    );

    try {
      const output = await execFileForTest("node", [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
        "--api-mode",
        "live-workflow-status",
        "--resolved-address",
        "127.0.0.1",
      ], {
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        reject: false,
      });
      const body = JSON.parse(output);

      expect(requests).toEqual([
        `POST /api/ai/teacher-auth/issue host=unresolved-teacher-browser.example.test:${port}`,
      ]);
      expect(existsSync(`${gotoMarker}.cookies`)).toBe(true);
      expect(body.results).toEqual(
        Object.fromEntries([
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
        ].map((key) => [key, "passed"])),
      );
      expect(body.status).toBe("passed");
      expect(body.networkAddressOverride).toEqual({
        status: "enabled",
        addressSource: "pinned",
        valueRedacted: true,
      });
      expect(output).not.toContain(baseUrl);
      expect(output).not.toContain("unresolved-teacher-browser.example.test");
      expect(output).not.toContain("127.0.0.1");
      expect(output).not.toContain("secret-browser");
      expect(output).not.toContain(tmpDir);
    } finally {
      await closeServerForTest(server);
    }
  });

  it("rejects live browser smoke without explicit owner approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--environment",
        "production",
        "--base-url",
        "https://teacher-browser.example.test",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });

  it("reports a missing Playwright runtime before live browser interactions", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-runtime-missing-"));
    const emptyNodeModulesDir = join(tmpDir, "empty-node-modules");
    mkdirSync(emptyNodeModulesDir, { recursive: true });
    const baseUrl = "https://teacher-browser.example.test";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId: "release-browser-runtime-missing",
    });
    const result = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--release-run-id",
        "release-browser-runtime-missing",
        "--vercel-production-deployment",
        vercelProductionDeployment,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: emptyNodeModulesDir,
        },
        stdio: "pipe",
      },
    );
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(1);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        environment: "production",
        network: "enabled",
        status: "blocked",
        blockedReasons: ["teacher-workflow-browser-runtime-missing"],
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-browser-automation-runtime",
          responsibleSession: "S22",
          runtime: "playwright",
          status: "missing",
        },
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects production live browser smoke without a release-run id before browser navigation", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-missing-run-id-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const gotoMarker = join(tmpDir, "goto-called.marker");
    const baseUrl = "https://teacher-browser.example.test";
    writePassingPlaywrightRuntimeForTest({ nodeModulesDir, gotoMarker });
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId: "release-browser-existing-deployment",
    });

    const result = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--vercel-production-deployment",
        vercelProductionDeployment,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        stdio: "pipe",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Teacher workflow browser smoke requires --release-run-id",
    );
    expect(existsSync(gotoMarker)).toBe(false);
    expect(result.stderr).not.toContain(baseUrl);
    expect(result.stderr).not.toContain(tmpDir);
    expect(result.stderr).not.toContain("/Users/");
  });

  it("requires Vercel production deployment evidence for production browser smoke plans", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-missing-vercel-"));
    const envFile = join(tmpDir, "teacher-browser-missing-vercel.env");
    writeFileSync(envFile, "UAIS_DEPLOYMENT_BASE_URL=https://teacher-browser.example.test\n");

    const output = execFileSync("node", [
      "scripts/teacher-workflow-browser-smoke.mjs",
      "--dry-run",
      "--environment",
        "production",
        "--env-file",
        envFile,
        "--release-run-id",
        "release-browser-missing-vercel",
      ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
        mode: "dry-run",
        environment: "production",
        status: "blocked",
        blockedReasons: ["vercel-production-deployment-evidence-missing"],
        vercelProductionDeploymentEvidence: {
          target: "missing",
          status: "missing",
          deploymentObservationStatus: "missing",
          valueRedacted: true,
        },
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-vercel-production-deployment-evidence",
          responsibleSession: "S22",
          requiredEvidence: "vercel-production-deployment",
          status: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(output).not.toContain("teacher-browser.example.test");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("can use a Playwright runtime resolved from NODE_PATH", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-node-path-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const baseUrl = "https://teacher-browser.example.test";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId: "release-browser-node-path",
    });
    const playwrightDir = join(nodeModulesDir, "playwright");
    mkdirSync(playwrightDir, { recursive: true });
    writeFileSync(
      join(playwrightDir, "package.json"),
      JSON.stringify({ name: "playwright", version: "0.0.0-smoke", main: "index.js" }),
    );
    writeFileSync(
      join(playwrightDir, "index.js"),
`
let durationGateChecked = false;
let apiHandler;

function createRequest(pathname, body) {
  return {
    request: () => ({
      url: () => "https://teacher-browser.example.test" + pathname,
      method: () => "POST",
      postData: () => JSON.stringify(body),
    }),
    continue: async () => undefined,
    fulfill: async () => undefined,
  };
}

function createValidPptNarrationPayload() {
  return {
    pptNarration: {
      slideScripts: Array.from({ length: 19 }, (_, index) => {
        const slideNumber = String(index + 1).padStart(2, "0");
        return {
          slideId: "slide-" + slideNumber,
          narrationText: "Browser smoke narration for slide " + slideNumber,
        };
      }),
    },
  };
}

const page = {
  route: async (_pattern, handler) => {
    apiHandler = handler;
  },
  goto: async () => undefined,
  locator: () => ({
    setInputFiles: async () => undefined,
    waitFor: async () => undefined,
    evaluate: async (callback) => {
      if (String(callback).includes("durationSeconds")) {
        durationGateChecked = true;
      }
      return false;
    },
  }),
  getByText: () => ({ first: () => ({ waitFor: async () => undefined }) }),
  getByRole: (role, options = {}) => role === "link"
    ? {
        click: async () => undefined,
        count: async () => 19,
        evaluateAll: async () => Array.from({ length: 19 }, (_, index) => {
          const slideNumber = String(index + 1).padStart(2, "0");
          return "/api/ai/ppt-narration/audio/audio-manifest-uais-browser-smoke/audio-slide-" + slideNumber;
        }),
      }
    : {
        click: async () => {
          if (options.name?.test("生成 PPT 配音")) {
            await apiHandler(createRequest("/api/ai/ppt-narration", createValidPptNarrationPayload()));
          }
        },
        evaluate: async () => Boolean(options.name?.test("登记教师声音") && durationGateChecked),
      },
  content: async () => "<html><body>teacher workflow smoke</body></html>",
};

module.exports = {
  chromium: {
    launch: async () => ({
      newContext: async () => ({
        newPage: async () => page,
      }),
      close: async () => undefined,
    }),
  },
};
`,
    );

    const result = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--release-run-id",
        "release-browser-node-path",
        "--vercel-production-deployment",
        vercelProductionDeployment,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        stdio: "pipe",
      },
    );
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(0);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        environment: "production",
        network: "enabled",
        status: "passed",
        blockedReasons: [],
        results: expect.objectContaining({
          browserHydration: "passed",
          voiceSampleDurationGate: "passed",
          pptNarrationSlidePayload: "passed",
          perSlideWavDownloadLinks: "passed",
        }),
      }),
    );
    expect(body.prerequisites).toEqual(
      expect.arrayContaining([
        {
          id: "s22-browser-automation-runtime",
          responsibleSession: "S22",
          runtime: "playwright",
          status: "present",
        },
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("dispatches file-input events after setting the teacher voice sample in browser smoke", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-file-events-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const baseUrl = "https://teacher-browser.example.test";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId: "release-browser-file-events",
    });
    const playwrightDir = join(nodeModulesDir, "playwright");
    mkdirSync(playwrightDir, { recursive: true });
    writeFileSync(
      join(playwrightDir, "package.json"),
      JSON.stringify({ name: "playwright", version: "0.0.0-smoke", main: "index.js" }),
    );
    writeFileSync(
      join(playwrightDir, "index.js"),
`
let apiHandler;
let durationGateChecked = false;
let fileInputEventCount = 0;

function createRequest(pathname, body) {
  return {
    request: () => ({
      url: () => "https://teacher-browser.example.test" + pathname,
      method: () => "POST",
      postData: () => JSON.stringify(body),
    }),
    continue: async () => undefined,
    fulfill: async () => undefined,
  };
}

function createValidPptNarrationPayload() {
  return {
    pptNarration: {
      slideScripts: Array.from({ length: 19 }, (_, index) => {
        const slideNumber = String(index + 1).padStart(2, "0");
        return {
          slideId: "slide-" + slideNumber,
          narrationText: "Browser smoke narration for slide " + slideNumber,
        };
      }),
    },
  };
}

const page = {
  route: async (_pattern, handler) => {
    apiHandler = handler;
  },
  goto: async () => undefined,
  locator: (selector) => ({
    setInputFiles: async () => undefined,
    dispatchEvent: async (eventName) => {
      if (selector === "#teacher-voice-sample" && (eventName === "input" || eventName === "change")) {
        fileInputEventCount += 1;
      }
    },
    waitFor: async () => undefined,
    evaluate: async (callback) => {
      if (String(callback).includes("durationSeconds")) {
        durationGateChecked = true;
      }
      return false;
    },
  }),
  getByText: (pattern) => ({
    first: () => ({
      waitFor: async () => {
        if (pattern.test("uais-teacher-browser-smoke-1s.wav") && fileInputEventCount < 2) {
          throw new Error("file input events were not dispatched after setInputFiles");
        }
      },
    }),
  }),
  getByRole: (role, options = {}) => role === "link"
    ? {
        click: async () => undefined,
        count: async () => 19,
        evaluateAll: async () => Array.from({ length: 19 }, (_, index) => {
          const slideNumber = String(index + 1).padStart(2, "0");
          return "/api/ai/ppt-narration/audio/audio-manifest-uais-browser-smoke/audio-slide-" + slideNumber;
        }),
      }
    : {
        click: async () => {
          if (options.name?.test("生成 PPT 配音")) {
            await apiHandler(createRequest("/api/ai/ppt-narration", createValidPptNarrationPayload()));
          }
        },
        evaluate: async () => Boolean(options.name?.test("登记教师声音") && durationGateChecked),
      },
  content: async () => "<html><body>teacher workflow smoke</body></html>",
};

module.exports = {
  chromium: {
    launch: async () => ({
      newContext: async () => ({ newPage: async () => page }),
      close: async () => undefined,
    }),
  },
};
`,
    );

    const result = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--release-run-id",
        "release-browser-file-events",
        "--vercel-production-deployment",
        vercelProductionDeployment,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        stdio: "pipe",
      },
    );
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(0);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        status: "passed",
        blockedReasons: [],
        results: expect.objectContaining({
          voiceSampleDurationGate: "passed",
          voiceSampleFileSelection: "passed",
          pptNarrationSlidePayload: "passed",
        }),
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("binds live browser smoke to Vercel deployment evidence by fingerprint before navigation", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-vercel-evidence-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const gotoMarker = join(tmpDir, "goto-called.marker");
    writePassingPlaywrightRuntimeForTest({ nodeModulesDir, gotoMarker });
    const releaseRunId = "release-browser-evidence-binding";
    const baseUrl = "https://teacher-browser.example.test";
    const matchingEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "matching-vercel-production-deployment.json",
      releaseRunId,
    });
    const mismatchedEvidence = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl: "https://different-browser-production.example.test",
      filename: "mismatched-vercel-production-deployment.json",
      releaseRunId,
    });

    const matchedResult = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--release-run-id",
        releaseRunId,
        "--vercel-production-deployment",
        matchingEvidence,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        stdio: "pipe",
      },
    );
    const matchedOutput = matchedResult.stdout;

    expect(matchedResult.status).toBe(0);
    const matchedBody = JSON.parse(matchedOutput);

    expect(existsSync(gotoMarker)).toBe(true);
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

    const mismatchMarker = join(tmpDir, "mismatch-goto-called.marker");
    writePassingPlaywrightRuntimeForTest({ nodeModulesDir, gotoMarker: mismatchMarker });
    const mismatchedResult = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--release-run-id",
        releaseRunId,
        "--vercel-production-deployment",
        mismatchedEvidence,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        stdio: "pipe",
      },
    );
    const mismatchedOutput = mismatchedResult.stdout;

    expect(mismatchedResult.status).toBe(1);
    const mismatchedBody = JSON.parse(mismatchedOutput);

    expect(existsSync(mismatchMarker)).toBe(false);
    expect(mismatchedBody).toEqual(
      expect.objectContaining({
        status: "blocked",
        blockedReasons: ["vercel-production-deployment-fingerprint-mismatch"],
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "mismatched",
          deploymentObservationStatus: "observed",
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
    expect(mismatchedOutput).not.toContain("different-browser-production.example.test");
  });

  it("still captures browser workflow results when Vercel deployment evidence is not deployed", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-not-deployed-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const gotoMarker = join(tmpDir, "goto-called.marker");
    writePassingPlaywrightRuntimeForTest({ nodeModulesDir, gotoMarker });
    const releaseRunId = "release-browser-not-deployed-binding";
    const baseUrl = "https://teacher-browser.example.test";
    const blockedEvidence = join(tmpDir, "blocked-vercel-production-deployment.json");
    writeFileSync(
      blockedEvidence,
      JSON.stringify({
        target: "vercel-production-deployment",
        mode: "live",
        action: "inspect",
        environment: "production",
        status: "blocked",
        releaseRunId,
        deploymentObservation: { status: "pending" },
        deploymentFingerprint: createDeploymentFingerprintForTest(baseUrl),
      }),
    );

    const result = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--release-run-id",
        releaseRunId,
        "--vercel-production-deployment",
        blockedEvidence,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        stdio: "pipe",
      },
    );
    const body = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(existsSync(gotoMarker)).toBe(true);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        environment: "production",
        status: "passed",
        deploymentEvidenceBindingStatus: "not-proven",
        productionReleaseEligible: false,
        diagnosticBlockedReasons: ["vercel-production-deployment-evidence-not-deployed"],
        vercelProductionDeploymentEvidence: {
          target: "vercel-production-deployment",
          status: "not-deployed",
          deploymentObservationStatus: "pending",
          valueRedacted: true,
        },
        results: expect.objectContaining({
          openTeachingPage: "passed",
          voiceSampleDurationGate: "passed",
          pptNarrationSlidePayload: "passed",
          perSlideWavDownloadHrefContract: "passed",
        }),
      }),
    );
    expect(result.stdout).not.toContain(baseUrl);
    expect(result.stdout).not.toContain(tmpDir);
    expect(result.stdout).not.toContain("/Users/");
  });

  it("targets the PPT narration workflow button without matching the AI ops contract button", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-ppt-button-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const baseUrl = "https://teacher-browser.example.test";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId: "release-browser-ppt-button",
    });
    const playwrightDir = join(nodeModulesDir, "playwright");
    mkdirSync(playwrightDir, { recursive: true });
    writeFileSync(
      join(playwrightDir, "package.json"),
      JSON.stringify({ name: "playwright", version: "0.0.0-smoke", main: "index.js" }),
    );
    writeFileSync(
      join(playwrightDir, "index.js"),
      `
const buttonLabels = [
  "刷新服务端 workflow",
  "登记教师声音",
  "运行 workflow 预检",
  "保存 voiceRef",
  "生成 PPT 配音",
  "生成 PPT 配音合同",
];

let durationGateChecked = false;
let apiHandler;

function createRequest(pathname, body) {
  return {
    request: () => ({
      url: () => "https://teacher-browser.example.test" + pathname,
      method: () => "POST",
      postData: () => JSON.stringify(body),
    }),
    continue: async () => undefined,
    fulfill: async () => undefined,
  };
}

function createValidPptNarrationPayload() {
  return {
    pptNarration: {
      slideScripts: Array.from({ length: 19 }, (_, index) => {
        const slideNumber = String(index + 1).padStart(2, "0");
        return {
          slideId: "slide-" + slideNumber,
          narrationText: "Browser smoke narration for slide " + slideNumber,
        };
      }),
    },
  };
}

const page = {
  route: async (_pattern, handler) => {
    apiHandler = handler;
  },
  goto: async () => undefined,
  locator: () => ({
    setInputFiles: async () => undefined,
    waitFor: async () => undefined,
    evaluate: async (callback) => {
      if (String(callback).includes("durationSeconds")) {
        durationGateChecked = true;
      }
      return false;
    },
  }),
  getByText: () => ({ first: () => ({ waitFor: async () => undefined }) }),
  getByRole: (role, options = {}) => {
    if (role === "link") {
      return {
        click: async () => undefined,
        count: async () => 19,
        evaluateAll: async () => Array.from({ length: 19 }, (_, index) => {
          const slideNumber = String(index + 1).padStart(2, "0");
          return "/api/ai/ppt-narration/audio/audio-manifest-uais-browser-smoke/audio-slide-" + slideNumber;
        }),
      };
    }
    const matcher = options.name;
    const matches = buttonLabels.filter((label) => matcher.test(label));
    if (matches.length !== 1) {
      throw new Error("strict mode violation");
    }
    return {
      click: async () => {
        if (matcher.test("登记教师声音") && !durationGateChecked) {
          throw new Error("duration gate was not checked before voice registration");
        }
        if (matcher.test("生成 PPT 配音")) {
          await apiHandler(createRequest("/api/ai/ppt-narration", createValidPptNarrationPayload()));
        }
      },
      evaluate: async () => Boolean(matcher.test("登记教师声音") && durationGateChecked),
    };
  },
  content: async () => "<html><body>teacher workflow smoke</body></html>",
};

module.exports = {
  chromium: {
    launch: async () => ({
      newContext: async () => ({ newPage: async () => page }),
      close: async () => undefined,
    }),
  },
};
`,
    );

    const result = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--release-run-id",
        "release-browser-ppt-button",
        "--vercel-production-deployment",
        vercelProductionDeployment,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        stdio: "pipe",
      },
    );
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(0);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        status: "passed",
        blockedReasons: [],
        results: expect.objectContaining({
          voiceSampleDurationGate: "passed",
          pptNarrationSubmit: "passed",
          pptNarrationSlidePayload: "passed",
          perSlideWavDownloadLinks: "passed",
        }),
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects browser smoke when per-slide WAV links are not protected audio download routes", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-wav-hrefs-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const baseUrl = "https://teacher-browser.example.test";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId: "release-browser-wav-hrefs",
    });
    const playwrightDir = join(nodeModulesDir, "playwright");
    mkdirSync(playwrightDir, { recursive: true });
    writeFileSync(
      join(playwrightDir, "package.json"),
      JSON.stringify({ name: "playwright", version: "0.0.0-smoke", main: "index.js" }),
    );
    writeFileSync(
      join(playwrightDir, "index.js"),
`
let durationGateChecked = false;
let apiHandler;

function createRequest(pathname, body) {
  return {
    request: () => ({
      url: () => "https://teacher-browser.example.test" + pathname,
      method: () => "POST",
      postData: () => JSON.stringify(body),
    }),
    continue: async () => undefined,
    fulfill: async () => undefined,
  };
}

function createValidPptNarrationPayload() {
  return {
    pptNarration: {
      slideScripts: Array.from({ length: 19 }, (_, index) => {
        const slideNumber = String(index + 1).padStart(2, "0");
        return {
          slideId: "slide-" + slideNumber,
          narrationText: "Browser smoke narration for slide " + slideNumber,
        };
      }),
    },
  };
}

const page = {
  route: async (_pattern, handler) => {
    apiHandler = handler;
  },
  goto: async () => undefined,
  locator: () => ({
    setInputFiles: async () => undefined,
    waitFor: async () => undefined,
    evaluate: async (callback) => {
      if (String(callback).includes("durationSeconds")) {
        durationGateChecked = true;
      }
      return false;
    },
  }),
  getByText: () => ({ first: () => ({ waitFor: async () => undefined }) }),
  getByRole: (role, options = {}) => {
    if (role === "link") {
      return {
        click: async () => undefined,
        count: async () => 19,
        evaluateAll: async () => Array.from({ length: 19 }, (_, index) => "/downloads/fake-slide-" + index + ".wav"),
      };
    }
    return {
      click: async () => {
        if (options.name?.test("生成 PPT 配音")) {
          await apiHandler(createRequest("/api/ai/ppt-narration", createValidPptNarrationPayload()));
        }
      },
      evaluate: async () => Boolean(options.name?.test("登记教师声音") && durationGateChecked),
    };
  },
  content: async () => "<html><body>teacher workflow smoke</body></html>",
};

module.exports = {
  chromium: {
    launch: async () => ({
      newContext: async () => ({
        addCookies: async () => undefined,
        newPage: async () => page,
      }),
      close: async () => undefined,
    }),
  },
};
`,
    );

    const result = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--release-run-id",
        "release-browser-wav-hrefs",
        "--vercel-production-deployment",
        vercelProductionDeployment,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        stdio: "pipe",
      },
    );
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(1);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        status: "failed",
        blockedReasons: ["teacher-workflow-browser-interaction-failed"],
        results: expect.objectContaining({
          pptNarrationSlidePayload: "passed",
          perSlideWavDownloadLinks: "passed",
          perSlideWavDownloadHrefContract: "failed",
        }),
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/downloads/fake-slide");
    expect(output).not.toContain("/Users/");
  });

  it("rejects browser smoke when the PPT narration request omits the 19 slide scripts", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-slide-payload-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const baseUrl = "https://teacher-browser.example.test";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId: "release-browser-slide-payload",
    });
    const playwrightDir = join(nodeModulesDir, "playwright");
    mkdirSync(playwrightDir, { recursive: true });
    writeFileSync(
      join(playwrightDir, "package.json"),
      JSON.stringify({ name: "playwright", version: "0.0.0-smoke", main: "index.js" }),
    );
    writeFileSync(
      join(playwrightDir, "index.js"),
      `
let durationGateChecked = false;
let apiHandler;

function createRequest(pathname, body) {
  return {
    request: () => ({
      url: () => "https://teacher-browser.example.test" + pathname,
      method: () => "POST",
      postData: () => JSON.stringify(body),
    }),
    continue: async () => undefined,
    fulfill: async () => undefined,
  };
}

const page = {
  route: async (_pattern, handler) => {
    apiHandler = handler;
  },
  goto: async () => undefined,
  locator: () => ({
    setInputFiles: async () => undefined,
    waitFor: async () => undefined,
    evaluate: async (callback) => {
      if (String(callback).includes("durationSeconds")) {
        durationGateChecked = true;
      }
      return false;
    },
  }),
  getByText: () => ({ first: () => ({ waitFor: async () => undefined }) }),
  getByRole: (role, options = {}) => {
    if (role === "link") {
      return {
        click: async () => undefined,
        count: async () => 19,
        evaluateAll: async () => Array.from({ length: 19 }, (_, index) => {
          const slideNumber = String(index + 1).padStart(2, "0");
          return "/api/ai/ppt-narration/audio/audio-manifest-uais-browser-smoke/audio-slide-" + slideNumber;
        }),
      };
    }
    return {
      click: async () => {
        if (options.name?.test("生成 PPT 配音")) {
          await apiHandler(createRequest("/api/ai/ppt-narration", {
            pptNarration: {
              slideScripts: [{ slideId: "slide-01", script: "only one slide" }],
            },
          }));
        }
      },
      evaluate: async () => Boolean(options.name?.test("登记教师声音") && durationGateChecked),
    };
  },
  content: async () => "<html><body>teacher workflow smoke</body></html>",
};

module.exports = {
  chromium: {
    launch: async () => ({
      newContext: async () => ({ newPage: async () => page }),
      close: async () => undefined,
    }),
  },
};
`,
    );

    const result = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--release-run-id",
        "release-browser-slide-payload",
        "--vercel-production-deployment",
        vercelProductionDeployment,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        stdio: "pipe",
      },
    );
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(1);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
        mode: "live",
        status: "failed",
        blockedReasons: ["teacher-workflow-browser-interaction-failed"],
        results: expect.objectContaining({
          pptNarrationSlidePayload: "failed",
          perSlideWavDownloadLinks: "passed",
          perSlideWavDownloadHrefContract: "passed",
        }),
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("only one slide");
    expect(output).not.toContain("/Users/");
  });

  it("blocks production browser smoke for non-remote-HTTPS deployment origins before browser navigation", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-teacher-browser-origin-block-"));
    const nodeModulesDir = join(tmpDir, "node_modules");
    const baseUrl = "http://127.0.0.1:65535";
    const vercelProductionDeployment = writeVercelDeploymentEvidenceForTest(tmpDir, {
      baseUrl,
      filename: "vercel-production-deployment.json",
      releaseRunId: "release-browser-origin-block",
    });
    const playwrightDir = join(nodeModulesDir, "playwright");
    const gotoMarker = join(tmpDir, "goto-called.marker");
    mkdirSync(playwrightDir, { recursive: true });
    writeFileSync(
      join(playwrightDir, "package.json"),
      JSON.stringify({ name: "playwright", version: "0.0.0-smoke", main: "index.js" }),
    );
    writeFileSync(
      join(playwrightDir, "index.js"),
      `
const { writeFileSync } = require("node:fs");

const page = {
  route: async () => undefined,
  goto: async () => {
    writeFileSync(${JSON.stringify(gotoMarker)}, "called");
  },
  locator: () => ({ setInputFiles: async () => undefined }),
  getByText: () => ({ first: () => ({ waitFor: async () => undefined }) }),
  getByRole: () => ({ count: async () => 0, click: async () => undefined }),
  content: async () => "",
};

module.exports = {
  chromium: {
    launch: async () => ({
      newContext: async () => ({ newPage: async () => page }),
      close: async () => undefined,
    }),
  },
};
`,
    );

    const result = spawnSync(
      "node",
      [
        "scripts/teacher-workflow-browser-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "production",
        "--base-url",
        baseUrl,
        "--release-run-id",
        "release-browser-origin-block",
        "--vercel-production-deployment",
        vercelProductionDeployment,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: nodeModulesDir,
        },
        stdio: "pipe",
      },
    );
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(1);
    expect(existsSync(gotoMarker)).toBe(false);
    expect(body).toEqual(
      expect.objectContaining({
        target: "teacher-workflow-browser-smoke",
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
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("65535");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function writePassingPlaywrightRuntimeForTest({
  nodeModulesDir,
  gotoMarker,
}: {
  nodeModulesDir: string;
  gotoMarker: string;
}) {
  const playwrightDir = join(nodeModulesDir, "playwright");
  mkdirSync(playwrightDir, { recursive: true });
  writeFileSync(
    join(playwrightDir, "package.json"),
    JSON.stringify({ name: "playwright", version: "0.0.0-smoke", main: "index.js" }),
  );
  writeFileSync(
    join(playwrightDir, "index.js"),
`
const { writeFileSync } = require("node:fs");

let durationGateChecked = false;
let apiHandler;

function createRequest(pathname, body) {
  return {
    request: () => ({
      url: () => "https://teacher-browser.example.test" + pathname,
      method: () => "POST",
      postData: () => JSON.stringify(body),
    }),
    continue: async () => undefined,
    fulfill: async () => undefined,
  };
}

function createValidPptNarrationPayload() {
  return {
    pptNarration: {
      slideScripts: Array.from({ length: 19 }, (_, index) => {
        const slideNumber = String(index + 1).padStart(2, "0");
        return {
          slideId: "slide-" + slideNumber,
          narrationText: "Browser smoke narration for slide " + slideNumber,
        };
      }),
    },
  };
}

const page = {
  route: async (_pattern, handler) => {
    apiHandler = handler;
  },
  goto: async () => {
    writeFileSync(${JSON.stringify(gotoMarker)}, "called");
  },
  locator: () => ({
    setInputFiles: async () => undefined,
    waitFor: async () => undefined,
    evaluate: async (callback) => {
      if (String(callback).includes("durationSeconds")) {
        durationGateChecked = true;
      }
      return false;
    },
  }),
  getByText: () => ({ first: () => ({ waitFor: async () => undefined }) }),
  getByRole: (role, options = {}) => role === "link"
    ? {
        click: async () => undefined,
        count: async () => 19,
        evaluateAll: async () => Array.from({ length: 19 }, (_, index) => {
          const slideNumber = String(index + 1).padStart(2, "0");
          return "/api/ai/ppt-narration/audio/audio-manifest-uais-browser-smoke/audio-slide-" + slideNumber;
        }),
      }
    : {
        click: async () => {
          if (options.name?.test("生成 PPT 配音")) {
            await apiHandler(createRequest("/api/ai/ppt-narration", createValidPptNarrationPayload()));
          }
        },
        evaluate: async () => Boolean(options.name?.test("登记教师声音") && durationGateChecked),
      },
  content: async () => "<html><body>teacher workflow smoke</body></html>",
};

module.exports = {
  chromium: {
    launch: async () => ({
      newContext: async () => ({
        addCookies: async () => {
          writeFileSync(${JSON.stringify(gotoMarker)} + ".cookies", "called");
        },
        newPage: async () => page,
      }),
      close: async () => undefined,
    }),
  },
};
`,
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
  return {
    status: "present",
    value: `sha256:${createHash("sha256").update(baseUrl.replace(/\/+$/, "")).digest("hex").slice(0, 16)}`,
  };
}

function listenForTest(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
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
  options: { env?: NodeJS.ProcessEnv; reject?: boolean } = {},
) {
  return new Promise<string>((resolve, reject) => {
    import("node:child_process").then(({ execFile }) => {
      execFile(
        command,
        args,
        { cwd: process.cwd(), encoding: "utf8", env: options.env },
        (error, stdout, stderr) => {
          if (error) {
            if (options.reject === false) {
              resolve(stdout);
              return;
            }
            reject(new Error(stderr || stdout || error.message));
            return;
          }
          resolve(stdout);
        },
      );
    }, reject);
  });
}
