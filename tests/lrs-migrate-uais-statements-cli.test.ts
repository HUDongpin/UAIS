import { execFile, execFileSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

function createUaisAppStatement(id: string) {
  return {
    id,
    actor: {
      objectType: "Agent",
      account: { homePage: "https://uais.top/xapi/actors", name: "learner:student-001" },
    },
    verb: { id: "http://adlnet.gov/expapi/verbs/viewed", display: { "en-US": "viewed" } },
    object: {
      id: "https://uais.top/xapi/activities/course-1/lesson-1",
      objectType: "Activity",
      definition: {
        name: { "en-US": "Lesson" },
        type: "https://uais.top/xapi/activity-types/lesson",
      },
    },
    context: {
      platform: "UAIS",
      language: "zh-CN",
      extensions: {
        "https://uais.top/xapi/extensions/event-type": "lesson.viewed",
        "https://uais.top/xapi/extensions/course-id": "course-1",
      },
    },
    timestamp: "2026-06-30T03:01:00.000Z",
  };
}

const uaisSmokeStatement = {
  id: "migrate-smoke-1",
  actor: {
    objectType: "Agent",
    account: { homePage: "https://uais.top/xapi/actors", name: "admin:lrs-live-smoke" },
  },
  verb: { id: "http://adlnet.gov/expapi/verbs/experienced", display: { "en-US": "experienced" } },
  object: {
    id: "https://uais.top/xapi/activities/live-lrs-write-read-smoke/run-1",
    objectType: "Activity",
    definition: { name: { "en-US": "Smoke" }, type: "http://adlnet.gov/expapi/activities/course" },
  },
  context: {
    platform: "UAIS",
    language: "zh-CN",
    extensions: { "https://uais.top/xapi/extensions/source": "lrs-live-write-read-smoke" },
  },
  timestamp: "2026-06-27T15:50:00.000Z",
};

const foreignStatement = {
  id: "migrate-foreign-1",
  actor: {
    objectType: "Agent",
    account: { homePage: "https://www.aais.site/xapi/actors", name: "learner:aais-77" },
  },
  verb: { id: "https://www.aais.site/xapi/verbs/reviewed", display: { "en-US": "reviewed" } },
  object: {
    id: "https://www.aais.site/xapi/activities/courses/aais-course",
    objectType: "Activity",
    definition: {
      name: { "en-US": "AAIS course" },
      type: "http://adlnet.gov/expapi/activities/course",
    },
  },
  context: { platform: "AAIS", language: "zh-CN" },
  timestamp: "2026-07-15T09:00:00.000Z",
};

function writeMigrationEnvFile(dirPrefix: string, sourceEndpoint: string, targetEndpoint: string) {
  const tmpDir = mkdtempSync(join(tmpdir(), dirPrefix));
  const envFile = join(tmpDir, "lrs-migration.env");
  writeFileSync(
    envFile,
    [
      `UAIS_LRS_ENDPOINT=${sourceEndpoint}`,
      "UAIS_LRS_USERNAME=secret-source-user",
      "UAIS_LRS_PASSWORD=secret-source-password",
      "UAIS_LRS_XAPI_VERSION=1.0.3",
      `UAIS_LRS_TARGET_ENDPOINT=${targetEndpoint}`,
      "UAIS_LRS_TARGET_USERNAME=secret-target-user",
      "UAIS_LRS_TARGET_PASSWORD=secret-target-password",
    ].join("\n"),
  );
  return envFile;
}

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

describe("LRS UAIS statement migration CLI", () => {
  it("blocks when the dedicated target LRS configuration is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-lrs-migrate-blocked-"));
    const envFile = join(tmpDir, "lrs.env");
    writeFileSync(
      envFile,
      [
        "UAIS_LRS_ENDPOINT=https://lrs-shared.example.test/xapi/",
        "UAIS_LRS_USERNAME=secret-source-user",
        "UAIS_LRS_PASSWORD=secret-source-password",
      ].join("\n"),
    );

    const output = execFileSync(
      "node",
      ["scripts/lrs-migrate-uais-statements.mjs", "--dry-run", "--env-file", envFile],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "lrs-migrate-uais-statements",
        mode: "dry-run",
        status: "blocked",
        blockedReasons: expect.arrayContaining([
          "missing-UAIS_LRS_TARGET_ENDPOINT",
          "missing-UAIS_LRS_TARGET_USERNAME",
          "missing-UAIS_LRS_TARGET_PASSWORD",
        ]),
      }),
    );
    expect(output).not.toContain("lrs-shared.example.test");
    expect(output).not.toContain("secret-source-user");
    expect(output).not.toContain("secret-source-password");
  });

  it("refuses to migrate into the same LRS instance", async () => {
    const envFile = writeMigrationEnvFile(
      "uais-lrs-migrate-same-",
      "https://lrs-shared.example.test/xapi/",
      "https://lrs-shared.example.test/other-store/",
    );

    const result = await execFileAsync(
      "node",
      ["scripts/lrs-migrate-uais-statements.mjs", "--live", "--approved", "--env-file", envFile],
      { cwd: process.cwd() },
    ).catch((error: { code?: number; stdout?: string }) => error);

    expect(result.code).toBe(1);
    const body = JSON.parse(String(result.stdout));
    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        blockedReasons: expect.arrayContaining(["target-endpoint-matches-source"]),
      }),
    );
  });

  it("migrates only UAIS statements with preserved ids and redacted reporting", async () => {
    const sourcePages = [
      [createUaisAppStatement("migrate-app-1"), foreignStatement],
      [createUaisAppStatement("migrate-app-2"), uaisSmokeStatement],
    ];
    const sourceServer = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url?.startsWith("/xapi/statements")) {
        const url = new URL(request.url, "http://127.0.0.1");
        const pageIndex = Number(url.searchParams.get("cursor") ?? "0");
        const statements = sourcePages[pageIndex] ?? [];
        const more =
          pageIndex + 1 < sourcePages.length ? `/xapi/statements?cursor=${pageIndex + 1}` : "";
        response.statusCode = 200;
        response.end(JSON.stringify({ statements, more }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not-found" }));
    });

    const targetWrites: Array<{ headers: IncomingMessage["headers"]; body: string }> = [];
    const targetServer = createServer(async (request, response) => {
      const body = await readRequestBody(request);
      response.setHeader("content-type", "application/json");
      if (request.method === "POST" && request.url === "/xapi/statements") {
        targetWrites.push({ headers: request.headers, body });
        const statement = JSON.parse(body) as { id?: string };
        if (statement.id === "migrate-app-2") {
          response.statusCode = 409;
          response.end(JSON.stringify({ error: "conflict" }));
          return;
        }
        response.statusCode = 200;
        response.end(JSON.stringify([statement.id]));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not-found" }));
    });

    await new Promise<void>((resolve) => sourceServer.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
    const sourceAddress = sourceServer.address();
    const targetAddress = targetServer.address();
    if (
      !sourceAddress ||
      typeof sourceAddress === "string" ||
      !targetAddress ||
      typeof targetAddress === "string"
    ) {
      throw new Error("Expected fake LRS server addresses.");
    }
    const envFile = writeMigrationEnvFile(
      "uais-lrs-migrate-live-",
      `http://127.0.0.1:${sourceAddress.port}/xapi/`,
      `http://127.0.0.1:${targetAddress.port}/xapi/`,
    );

    try {
      const { stdout } = await execFileAsync(
        "node",
        ["scripts/lrs-migrate-uais-statements.mjs", "--live", "--approved", "--env-file", envFile],
        { cwd: process.cwd() },
      );
      const body = JSON.parse(stdout);

      expect(body).toEqual(
        expect.objectContaining({
          target: "lrs-migrate-uais-statements",
          mode: "live",
          status: "passed",
          totals: {
            scanned: 4,
            selected: 2,
            skippedForeign: 1,
            skippedSmoke: 1,
            migrated: 1,
            conflicts: 1,
            failed: 0,
          },
          pagesFetched: 2,
          truncated: false,
        }),
      );
      expect(targetWrites).toHaveLength(2);
      const migratedIds = targetWrites.map(
        (write) => (JSON.parse(write.body) as { id?: string }).id,
      );
      expect(migratedIds).toEqual(["migrate-app-1", "migrate-app-2"]);
      expect(targetWrites[0]?.headers.authorization).toBe(
        `Basic ${Buffer.from("secret-target-user:secret-target-password", "utf8").toString("base64")}`,
      );
      for (const write of targetWrites) {
        expect(write.body).not.toContain("aais");
      }
      expect(stdout).not.toContain("secret-source-user");
      expect(stdout).not.toContain("secret-source-password");
      expect(stdout).not.toContain("secret-target-user");
      expect(stdout).not.toContain("secret-target-password");
      expect(stdout).not.toContain("learner:student-001");
      expect(stdout).not.toContain(`127.0.0.1:${sourceAddress.port}`);
    } finally {
      await new Promise<void>((resolve) => sourceServer.close(() => resolve()));
      await new Promise<void>((resolve) => targetServer.close(() => resolve()));
    }
  });
});
