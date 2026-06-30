import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("external storage persistence smoke", () => {
  it("preserves a mounted route prefix when checking production persistence", async () => {
    const accessToken = "fixture-access-token-not-real-000000000000";
    const teacherId = "teacher-mounted-prefix";
    const proofId = "proof-mounted-prefix";
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push(`${request.method ?? "UNKNOWN"} ${url.pathname}`);
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");

      if (request.method === "GET" && url.pathname === "/api/external-storage/healthz") {
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            apiContractVersion: "uais-external-storage-v1",
            durableBackingStore: {
              status: "ready",
              storageMode: "file-backed",
              probe: "write-read-delete",
              ownershipWritePolicy: "external-atomic-merge",
              lifecycleAuditWritePolicy: "append-only-redacted-lifecycle-audit",
              valueRedacted: true,
            },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }

      if (request.headers.authorization !== `Bearer ${accessToken}`) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === `/api/external-storage/teacher-ai-ownership/${teacherId}/merge`
      ) {
        await readJsonBody(request);
        response.end(
          JSON.stringify({
            status: "merged",
            storageWritePolicy: "external-atomic-merge",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/external-storage/qwen-voice-lifecycle-audit"
      ) {
        await readJsonBody(request);
        response.end(
          JSON.stringify({
            status: "recorded",
            provider: "qwen",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("test server did not bind a TCP port");
      }
      const baseUrl = `http://127.0.0.1:${address.port}/api/external-storage`;
      const result = await execFileAsync("node", [
        "scripts/external-storage-persistence-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--phase",
        "write",
        "--base-url",
        baseUrl,
        "--teacher-id",
        teacherId,
        "--proof-id",
        proofId,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
        },
      });

      const body = JSON.parse(result.stdout);
      expect(body.status).toBe("passed");
      expect(requests).toEqual([
        "GET /api/external-storage/healthz",
        `POST /api/external-storage/teacher-ai-ownership/${teacherId}/merge`,
        "POST /api/external-storage/qwen-voice-lifecycle-audit",
      ]);
      expect(result.stdout).not.toContain(accessToken);
      expect(result.stdout).not.toContain(baseUrl);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("proves write and read phases with the same redacted persistence marker", async () => {
    const accessToken = "fixture-access-token-not-real-000000000000";
    const teacherId = "teacher-persistence-smoke";
    const proofId = "proof-persistence-smoke-20260620";
    const state = {
      ownership: undefined as Record<string, unknown> | undefined,
      auditEvents: [] as Record<string, unknown>[],
    };
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");

      if (request.method === "GET" && url.pathname === "/healthz") {
        response.end(
          JSON.stringify({
            status: "ok",
            target: "uais-external-storage-production-service",
            productionServiceIdentity: {
              status: "proved",
              serviceMode: "production",
              serviceTarget: "uais-external-storage-production-service",
              valueRedacted: true,
            },
            apiContractVersion: "uais-external-storage-v1",
            durableBackingStore: {
              status: "ready",
              storageMode: "file-backed",
              probe: "write-read-delete",
              ownershipWritePolicy: "external-atomic-merge",
              lifecycleAuditWritePolicy: "append-only-redacted-lifecycle-audit",
              valueRedacted: true,
            },
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }

      if (request.headers.authorization !== `Bearer ${accessToken}`) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      const ownershipMatch = url.pathname.match(/^\/teacher-ai-ownership\/([^/]+)$/);
      if (request.method === "GET" && ownershipMatch) {
        response.statusCode = state.ownership ? 200 : 404;
        response.end(JSON.stringify(state.ownership ?? { error: "missing" }));
        return;
      }

      const mergeMatch = url.pathname.match(/^\/teacher-ai-ownership\/([^/]+)\/merge$/);
      if (request.method === "POST" && mergeMatch) {
        const body = await readJsonBody(request);
        state.ownership = body.ownership;
        response.end(
          JSON.stringify({
            teacherId,
            status: "merged",
            storageWritePolicy: "external-atomic-merge",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/qwen-voice-lifecycle-audit") {
        const body = await readJsonBody(request);
        if (
          body.deletionReason !== "owner-request" ||
          body.localReference?.status !== "deleted" ||
          body.localAuditRecord?.storagePolicy !== "local-redacted-lifecycle-audit"
        ) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid lifecycle policy" }));
          return;
        }
        state.auditEvents.push(body);
        response.end(
          JSON.stringify({
            status: "recorded",
            provider: "qwen",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/qwen-voice-lifecycle-audit") {
        response.end(
          JSON.stringify({
            provider: "qwen",
            eventType: "qwen-voice-lifecycle",
            events: state.auditEvents,
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          }),
        );
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("test server did not bind a TCP port");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const commonArgs = [
        "scripts/external-storage-persistence-smoke.mjs",
        "--live",
        "--approved",
        "--environment",
        "local-production",
        "--base-url",
        baseUrl,
        "--teacher-id",
        teacherId,
        "--proof-id",
        proofId,
      ];
      const env = {
        ...process.env,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
      };

      const writeResult = await execFileAsync("node", [
        ...commonArgs,
        "--phase",
        "write",
      ], {
        cwd: process.cwd(),
        env,
      });
      const readResult = await execFileAsync("node", [
        ...commonArgs,
        "--phase",
        "read",
      ], {
        cwd: process.cwd(),
        env,
      });
      const writeBody = JSON.parse(writeResult.stdout);
      const readBody = JSON.parse(readResult.stdout);

      expect(writeBody).toEqual(
        expect.objectContaining({
          target: "external-storage-persistence",
          mode: "live",
          environment: "local-production",
          phase: "write",
          status: "passed",
          persistenceProofFingerprint: {
            status: "present",
            value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
            valueRedacted: true,
          },
          storageServiceFingerprint: {
            status: "present",
            value: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
            source: "origin",
            valueRedacted: true,
          },
        }),
      );
      expect(readBody).toEqual(
        expect.objectContaining({
          target: "external-storage-persistence",
          mode: "live",
          environment: "local-production",
          phase: "read",
          status: "passed",
          persistenceProofFingerprint: writeBody.persistenceProofFingerprint,
          storageServiceFingerprint: writeBody.storageServiceFingerprint,
          results: expect.arrayContaining([
            expect.objectContaining({
              id: "s22-external-storage-persisted-ownership-read",
              status: "ok",
            }),
            expect.objectContaining({
              id: "s24-external-storage-persisted-audit-read",
              status: "ok",
            }),
          ]),
        }),
      );

      const combined = `${writeResult.stdout}\n${readResult.stdout}`;
      expect(combined).not.toContain(accessToken);
      expect(combined).not.toContain(baseUrl);
      expect(combined).not.toContain(teacherId);
      expect(combined).not.toContain(proofId);
      expect(combined).not.toContain("/Users/");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

async function readJsonBody(request: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
