import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

let openServers: Server[] = [];

describe("deployment reachability diagnostics", () => {
  afterEach(async () => {
    await Promise.all(openServers.map((server) => closeServerForTest(server)));
    openServers = [];
  });

  it("classifies per-route HEAD timeouts without leaking URLs or response bodies", async () => {
    const server = createServer((request, response) => {
      if (request.method !== "HEAD") {
        response.writeHead(405);
        response.end("method not allowed");
        return;
      }
      if (request.url === "/" || request.url === "/learning") {
        response.writeHead(200, {
          "content-type": "text/html",
          "x-secret-test-header": "secret-header-value",
        });
        response.end("secret-body-should-not-leak");
        return;
      }
      if (request.url === "/teaching") {
        setTimeout(() => {
          response.writeHead(200, { "content-type": "text/html" });
          response.end("late-secret-body-should-not-leak");
        }, 1000);
        return;
      }
      response.writeHead(404);
      response.end("not found");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/deployment-reachability-diagnostics.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--timeout-ms",
      "250",
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "deployment-reachability-diagnostics",
        mode: "live",
        environment: "local-production",
        network: "enabled",
        status: "blocked",
        responsibleSession: "S22",
        deploymentOrigin: {
          status: "present",
          originClass: "local-loopback",
          valueRedacted: true,
        },
        blockedReasons: ["head-teaching-timeout"],
        safety: expect.objectContaining({
          valuesRedacted: true,
          urlsOmitted: true,
          hostnamesOmitted: true,
          responseBodiesOmitted: true,
          responseHeadersOmitted: true,
          localPrivatePathsOmitted: true,
          liveRequiresApproval: true,
          cookieValuesOmitted: true,
          remoteMutationRequiresApproval: true,
        }),
      }),
    );
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "head-root",
          method: "HEAD",
          route: "/",
          status: "reachable",
          httpStatusClass: "2xx",
        }),
        expect.objectContaining({
          id: "head-teaching",
          method: "HEAD",
          route: "/teaching",
          status: "timeout",
          networkError: {
            class: "TimeoutError",
            valueRedacted: true,
          },
        }),
        expect.objectContaining({
          id: "head-learning",
          method: "HEAD",
          route: "/learning",
          status: "reachable",
          httpStatusClass: "2xx",
        }),
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("secret-header-value");
    expect(output).not.toContain("secret-body-should-not-leak");
    expect(output).not.toContain("late-secret-body-should-not-leak");
    expect(output).not.toContain("/Users/");
  });

  it("records sanitized transport error codes without leaking the target origin", async () => {
    const baseUrl = "http://127.0.0.1:9";

    const output = await execFileForTest("node", [
      "scripts/deployment-reachability-diagnostics.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--timeout-ms",
      "100",
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "transport-origin",
          status: "failed",
          networkError: {
            class: "Error",
            code: "ECONNREFUSED",
            valueRedacted: true,
          },
        }),
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("/Users/");
  });

  it("uses a pinned resolved address when the local resolver cannot resolve the deployment host", async () => {
    const server = createServer((request, response) => {
      if (request.method !== "HEAD") {
        response.writeHead(405);
        response.end("method not allowed");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end("secret-pinned-address-body");
    });
    openServers.push(server);
    const port = await listenOnAnyAddressForTest(server);
    const baseUrl = `http://unresolved-deployment.example.test:${port}`;

    const output = await execFileForTest("node", [
      "scripts/deployment-reachability-diagnostics.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      baseUrl,
      "--resolved-address",
      "127.0.0.1",
      "--timeout-ms",
      "100",
    ]);
    const body = JSON.parse(output);

    expect(body.status).toBe("passed");
    expect(body.blockedReasons).toEqual([]);
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dns-origin",
          status: "pinned-address",
          addressCount: 1,
          valueRedacted: true,
        }),
        expect.objectContaining({
          id: "transport-origin",
          status: "connected",
          addressSource: "pinned",
          valueRedacted: true,
        }),
        expect.objectContaining({
          id: "head-root",
          status: "reachable",
          addressSource: "pinned",
          valueRedacted: true,
        }),
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("unresolved-deployment.example.test");
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("secret-pinned-address-body");
    expect(output).not.toContain("/Users/");
  });

  it("can emit route-smoke domain reachability evidence bound to the release run", async () => {
    const server = createServer((request, response) => {
      if (request.method !== "HEAD") {
        response.writeHead(405);
        response.end("method not allowed");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end("secret-domain-evidence-body");
    });
    openServers.push(server);
    const port = await listenOnAnyAddressForTest(server);
    const baseUrl = `http://custom-domain.example.test:${port}`;
    const releaseRunId = "release-domain-reachability-2026-06-26";

    const output = await execFileForTest("node", [
      "scripts/deployment-reachability-diagnostics.mjs",
      "--live",
      "--approved",
      "--environment",
      "production",
      "--base-url",
      baseUrl,
      "--resolved-address",
      "127.0.0.1",
      "--timeout-ms",
      "100",
      "--domain-reachability-evidence",
      "--release-run-id",
      releaseRunId,
    ]);
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "deployment-domain-reachability",
        mode: "live",
        environment: "production",
        network: "enabled",
        status: "reachable",
        responsibleSession: "S22",
        releaseRunId,
        deploymentFingerprint: {
          status: "present",
          value: `sha256:${createHash("sha256").update(baseUrl).digest("hex").slice(0, 16)}`,
          valueRedacted: true,
        },
        domainOrigin: {
          status: "present",
          originClass: "insecure-http",
          valueRedacted: true,
        },
          httpObservation: {
            status: "observed",
            checkedRoutes: ["/", "/teaching", "/learning"],
            valueRedacted: true,
          },
          blockedReasons: [],
          results: {
            deploymentDomainOriginRemoteHttps: "blocked",
            deploymentDomainDnsOriginReachable: "passed",
            deploymentDomainTransportConnected: "passed",
            deploymentDomainRootHttpReachable: "passed",
            deploymentDomainTeachingHttpReachable: "passed",
            deploymentDomainLearningHttpReachable: "passed",
            deploymentDomainFingerprintBound: "passed",
            deploymentDomainReadinessSafety: "passed",
          },
          safety: expect.objectContaining({
            valuesRedacted: true,
            urlsOmitted: true,
            responseBodiesOmitted: true,
            noMutation: true,
          }),
      }),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("custom-domain.example.test");
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("secret-domain-evidence-body");
    expect(output).not.toContain("/Users/");
  });

  it("classifies Vercel deployment protection without leaking cookies or response bodies", async () => {
    const server = createServer((request, response) => {
      if (request.method !== "HEAD") {
        response.writeHead(405);
        response.end("method not allowed");
        return;
      }
      response.writeHead(401, {
        "content-type": "text/html",
        "set-cookie":
          "_vercel_sso_nonce=secret-sso-nonce; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Lax",
        "x-secret-test-header": "secret-header-value",
      });
      response.end("secret-vercel-sso-body");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/deployment-reachability-diagnostics.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--timeout-ms",
      "100",
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toEqual([
      "head-root-deployment-protected",
      "head-teaching-deployment-protected",
      "head-learning-deployment-protected",
    ]);
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "head-root",
          method: "HEAD",
          route: "/",
          status: "deployment-protected",
          httpStatusClass: "4xx",
          deploymentProtection: {
            provider: "vercel",
            evidence: "sso-cookie",
            valueRedacted: true,
          },
        }),
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("secret-sso-nonce");
    expect(output).not.toContain("_vercel_sso_nonce");
    expect(output).not.toContain("secret-header-value");
    expect(output).not.toContain("secret-vercel-sso-body");
    expect(output).not.toContain("/Users/");
  });

  it("treats 404 route responses as blocked http errors", async () => {
    const server = createServer((request, response) => {
      if (request.method !== "HEAD") {
        response.writeHead(405);
        response.end("method not allowed");
        return;
      }
      if (request.url === "/teaching") {
        response.writeHead(404, { "content-type": "text/html" });
        response.end("secret-not-found-body");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end("secret-ok-body");
    });
    const baseUrl = await listenForTest(server);

    const output = await execFileForTest("node", [
      "scripts/deployment-reachability-diagnostics.mjs",
      "--live",
      "--approved",
      "--environment",
      "local-production",
      "--base-url",
      baseUrl,
      "--timeout-ms",
      "100",
    ], { reject: false });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toEqual(["head-teaching-http-error"]);
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "head-teaching",
          method: "HEAD",
          route: "/teaching",
          status: "http-error",
          httpStatusClass: "4xx",
        }),
      ]),
    );
    expect(output).not.toContain(baseUrl);
    expect(output).not.toContain("127.0.0.1");
    expect(output).not.toContain("secret-not-found-body");
    expect(output).not.toContain("secret-ok-body");
    expect(output).not.toContain("/Users/");
  });
});

function listenOnAnyAddressForTest(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "0.0.0.0", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a TCP address.");
      }
      resolve(address.port);
    });
  });
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

function execFileForTest(
  command: string,
  args: string[],
  options: { reject?: boolean } = {},
) {
  return new Promise<string>((resolve, reject) => {
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
}
