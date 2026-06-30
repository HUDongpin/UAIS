import { execFile, execFileSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("LRS live write/read smoke CLI", () => {
  it("plans redacted live LRS prerequisites without exposing configured values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-lrs-smoke-dry-"));
    const envFile = join(tmpDir, "lrs.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LRS_ENDPOINT=https://lrs-production.example.test/xapi/",
        "UAIS_LRS_USERNAME=secret-lrs-user",
        "UAIS_LRS_PASSWORD=secret-lrs-password",
        "UAIS_LRS_XAPI_VERSION=1.0.3",
      ].join("\n"),
    );

    const output = execFileSync(
      "node",
      ["scripts/lrs-live-write-read-smoke.mjs", "--dry-run", "--env-file", envFile],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "lrs-live-write-read-smoke",
        mode: "dry-run",
        status: "ready",
        requiredEnv: expect.arrayContaining([
          { name: "UAIS_LRS_ENDPOINT", status: "present", valueRedacted: true },
          { name: "UAIS_LRS_USERNAME", status: "present", valueRedacted: true },
          { name: "UAIS_LRS_PASSWORD", status: "present", valueRedacted: true },
          { name: "UAIS_LRS_XAPI_VERSION", status: "present", valueRedacted: true },
        ]),
      }),
    );
    expect(output).not.toContain("lrs-production.example.test");
    expect(output).not.toContain("secret-lrs-user");
    expect(output).not.toContain("secret-lrs-password");
  });

  it("writes one safe xAPI statement and reads it back with targeted filters", async () => {
    const requests: Array<{
      method?: string;
      url?: string;
      headers: IncomingMessage["headers"];
      body: string;
    }> = [];
    let writtenStatement: Record<string, unknown> | undefined;
    const server = createServer(async (request, response) => {
      const body = await readRequestBody(request);
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      });
      response.setHeader("content-type", "application/json");

      if (request.method === "POST" && request.url === "/xapi/statements") {
        writtenStatement = JSON.parse(body) as Record<string, unknown>;
        response.statusCode = 200;
        response.end(JSON.stringify([writtenStatement.id]));
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/xapi/statements?")) {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.searchParams.has("statementId")) {
          response.statusCode = 200;
          response.end(JSON.stringify(writtenStatement));
          return;
        }
        response.statusCode = 200;
        response.end(JSON.stringify({ statements: [writtenStatement], more: "" }));
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not-found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected test LRS server address.");
    }
    const endpoint = `http://127.0.0.1:${address.port}/xapi/`;
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-lrs-smoke-live-"));
    const envFile = join(tmpDir, "lrs.env");
    const outFile = join(tmpDir, "lrs-smoke.json");
    writeFileSync(
      envFile,
      [
        `UAIS_LRS_ENDPOINT=${endpoint}`,
        "UAIS_LRS_USERNAME=secret-lrs-user",
        "UAIS_LRS_PASSWORD=secret-lrs-password",
        "UAIS_LRS_XAPI_VERSION=1.0.3",
      ].join("\n"),
    );

    try {
      const { stdout } = await execFileAsync(
        "node",
        [
          "scripts/lrs-live-write-read-smoke.mjs",
          "--live",
          "--approved",
          "--environment",
          "production",
          "--release-run-id",
          "release-lrs-live-smoke-test",
          "--env-file",
          envFile,
          "--out",
          outFile,
        ],
        { cwd: process.cwd() },
      );
      const body = JSON.parse(stdout);
      const writeRequest = requests.find((item) => item.method === "POST");
      const targetedReadRequest = requests.find(
        (item) => item.method === "GET" && item.url?.includes("related_activities=true"),
      );

      expect(body).toEqual(
        expect.objectContaining({
          target: "lrs-live-write-read-smoke",
          mode: "live",
          environment: "production",
          releaseRunId: "release-lrs-live-smoke-test",
          status: "passed",
          write: expect.objectContaining({
            status: "passed",
            httpStatus: 200,
            statementId: expect.objectContaining({
              status: "present",
              valueRedacted: true,
            }),
          }),
          readByStatementId: expect.objectContaining({
            status: "passed",
            httpStatus: 200,
            statementMatched: true,
          }),
          targetedRead: expect.objectContaining({
            status: "passed",
            httpStatus: 200,
            smokeStatementFound: true,
            relatedActivities: true,
          }),
        }),
      );
      expect(writeRequest?.headers["x-experience-api-version"]).toBe("1.0.3");
      expect(writeRequest?.headers.authorization).toBe(
        `Basic ${Buffer.from("secret-lrs-user:secret-lrs-password", "utf8").toString("base64")}`,
      );
      expect(JSON.parse(writeRequest?.body ?? "{}")).toEqual(
        expect.objectContaining({
          verb: expect.objectContaining({
            id: "http://adlnet.gov/expapi/verbs/experienced",
          }),
          object: expect.objectContaining({
            id: expect.stringContaining("/live-lrs-write-read-smoke/"),
          }),
        }),
      );
      expect(targetedReadRequest?.url).toContain("agent=");
      expect(targetedReadRequest?.url).toContain("verb=");
      expect(targetedReadRequest?.url).toContain("activity=");
      expect(stdout).not.toContain(endpoint);
      expect(stdout).not.toContain("secret-lrs-user");
      expect(stdout).not.toContain("secret-lrs-password");
      expect(stdout).not.toContain(String(writtenStatement?.id));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
