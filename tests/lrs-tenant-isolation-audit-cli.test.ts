import { execFile, execFileSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const uaisAppStatement = {
  id: "audit-uais-app-1",
  actor: {
    objectType: "Agent",
    account: { homePage: "https://uais.top/xapi/actors", name: "learner:student-001" },
  },
  verb: { id: "http://adlnet.gov/expapi/verbs/viewed", display: { "en-US": "viewed" } },
  object: {
    id: "https://uais.top/xapi/activities/course-1/lesson-1",
    objectType: "Activity",
    definition: { name: { "en-US": "Lesson" }, type: "https://uais.top/xapi/activity-types/lesson" },
  },
  context: {
    platform: "UAIS",
    language: "zh-CN",
    extensions: {
      "https://uais.top/xapi/extensions/event-type": "lesson.viewed",
      "https://uais.top/xapi/extensions/course-id": "course-1",
    },
  },
  stored: "2026-06-30T03:01:00.000Z",
  timestamp: "2026-06-30T03:01:00.000Z",
};

const uaisSmokeStatement = {
  id: "audit-uais-smoke-1",
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
  stored: "2026-06-27T15:50:00.000Z",
  timestamp: "2026-06-27T15:50:00.000Z",
};

function createForeignStatement(id: string) {
  return {
    id,
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
    stored: "2026-07-15T09:00:00.000Z",
    timestamp: "2026-07-15T09:00:00.000Z",
  };
}

function writeLrsEnvFile(dirPrefix: string, endpoint: string) {
  const tmpDir = mkdtempSync(join(tmpdir(), dirPrefix));
  const envFile = join(tmpDir, "lrs.env");
  writeFileSync(
    envFile,
    [
      `UAIS_LRS_ENDPOINT=${endpoint}`,
      "UAIS_LRS_USERNAME=secret-lrs-user",
      "UAIS_LRS_PASSWORD=secret-lrs-password",
      "UAIS_LRS_XAPI_VERSION=1.0.3",
    ].join("\n"),
  );
  return envFile;
}

async function startFakeLrs(pages: Array<Record<string, unknown>[]>) {
  const requests: Array<{ method?: string; url?: string; headers: IncomingMessage["headers"] }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url?.startsWith("/xapi/statements")) {
      const url = new URL(request.url, "http://127.0.0.1");
      const pageIndex = Number(url.searchParams.get("cursor") ?? "0");
      const statements = pages[pageIndex] ?? [];
      const more =
        pageIndex + 1 < pages.length ? `/xapi/statements?cursor=${pageIndex + 1}` : "";
      response.statusCode = 200;
      response.end(JSON.stringify({ statements, more }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not-found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected fake LRS server address.");
  }
  return {
    server,
    requests,
    endpoint: `http://127.0.0.1:${address.port}/xapi/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("LRS tenant isolation audit CLI", () => {
  it("plans a redacted read-only audit without exposing configured values", () => {
    const envFile = writeLrsEnvFile(
      "uais-lrs-audit-dry-",
      "https://lrs-production.example.test/xapi/",
    );

    const output = execFileSync(
      "node",
      ["scripts/lrs-tenant-isolation-audit.mjs", "--dry-run", "--env-file", envFile],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "lrs-tenant-isolation-audit",
        mode: "dry-run",
        status: "ready",
        readOnly: true,
        requiredEnv: expect.arrayContaining([
          { name: "UAIS_LRS_ENDPOINT", status: "present", valueRedacted: true },
          { name: "UAIS_LRS_PASSWORD", status: "present", valueRedacted: true },
        ]),
      }),
    );
    expect(output).not.toContain("lrs-production.example.test");
    expect(output).not.toContain("secret-lrs-user");
    expect(output).not.toContain("secret-lrs-password");
  });

  it("classifies shared-store traffic across paged reads with redacted output", async () => {
    const fakeLrs = await startFakeLrs([
      [uaisAppStatement, uaisSmokeStatement, createForeignStatement("audit-foreign-1")],
      [createForeignStatement("audit-foreign-2")],
    ]);
    const envFile = writeLrsEnvFile("uais-lrs-audit-live-", fakeLrs.endpoint);

    try {
      const { stdout } = await execFileAsync(
        "node",
        [
          "scripts/lrs-tenant-isolation-audit.mjs",
          "--live",
          "--approved",
          "--env-file",
          envFile,
        ],
        { cwd: process.cwd() },
      );
      const body = JSON.parse(stdout);

      expect(body).toEqual(
        expect.objectContaining({
          target: "lrs-tenant-isolation-audit",
          mode: "live",
          status: "passed",
          verdict: "shared",
          totals: {
            scanned: 4,
            uaisApp: 1,
            uaisSmoke: 1,
            uaisOther: 0,
            foreign: 2,
          },
          pagesFetched: 2,
          truncated: false,
          foreignVerbHosts: [{ host: "www.aais.site", count: 2 }],
          timestampRange: {
            earliest: "2026-06-27T15:50:00.000Z",
            latest: "2026-07-15T09:00:00.000Z",
          },
        }),
      );
      expect(body.distinctActors).toEqual({ count: 3, identitiesFingerprinted: true });
      expect(fakeLrs.requests[0]?.headers["x-experience-api-version"]).toBe("1.0.3");
      expect(stdout).not.toContain(fakeLrs.endpoint);
      expect(stdout).not.toContain("learner:student-001");
      expect(stdout).not.toContain("learner:aais-77");
      expect(stdout).not.toContain("secret-lrs-user");
      expect(stdout).not.toContain("secret-lrs-password");
    } finally {
      await fakeLrs.close();
    }
  });

  it("reports a dedicated store and satisfies --expect-dedicated", async () => {
    const fakeLrs = await startFakeLrs([[uaisAppStatement, uaisSmokeStatement]]);
    const envFile = writeLrsEnvFile("uais-lrs-audit-dedicated-", fakeLrs.endpoint);

    try {
      const { stdout } = await execFileAsync(
        "node",
        [
          "scripts/lrs-tenant-isolation-audit.mjs",
          "--live",
          "--approved",
          "--expect-dedicated",
          "--env-file",
          envFile,
        ],
        { cwd: process.cwd() },
      );
      const body = JSON.parse(stdout);

      expect(body).toEqual(
        expect.objectContaining({
          verdict: "dedicated",
          totals: expect.objectContaining({ scanned: 2, foreign: 0 }),
        }),
      );
    } finally {
      await fakeLrs.close();
    }
  });
});
