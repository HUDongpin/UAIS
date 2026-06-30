import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Qwen disposable voice revoke smoke CLI", () => {
  it("revokes only a disposable Qwen voice reference and writes redacted audit records", async () => {
    const registryDir = mkdtempSync(join(tmpdir(), "uais-disposable-qwen-voice-"));
    const envFile = join(registryDir, "env.test");
    const voiceRefId = "qwen-voice-ref-disposable-s24-delete-smoke-sample";
    const clonedVoiceId = "private-qwen-cloned-voice-id-should-not-leak";
    writeFileSync(envFile, "DASHSCOPE_API_KEY=secret-qwen-revoke-smoke\n");
    writeFileSync(
      join(registryDir, `${voiceRefId}.json`),
      JSON.stringify(
        {
          publicReference: {
            voiceRefId,
            teacherId: "disposable-teacher",
            sampleAssetId: "s24-delete-smoke-sample",
            provider: "qwen",
            providerRole: "voice-clone",
            status: "ready",
            providerTaskId: "disposable-provider-task",
            voiceRef: "server-side-cloned-qwen-voice",
            storagePolicy: "local-private-cloned-voice-reference",
            responsibleSession: "S07/S12/S24",
            retention: {
              classification: "provider-cloned-voice-reference-sensitive",
              policy: "revoke-provider-voice-and-delete-reference-on-owner-request-or-sample-expiry",
              createdAt: "2026-06-17T00:00:00.000Z",
              reviewAfter: "2026-07-17T00:00:00.000Z",
              reviewAfterDays: 30,
              deletionTrigger: "owner-request-or-source-sample-deletion",
              responsibleSession: "S24",
            },
            provenance: {
              provider: "qwen",
              providerRole: "voice-clone",
              sourceSampleAssetId: "s24-delete-smoke-sample",
              providerTaskId: "disposable-provider-task",
              voiceRef: "server-side-cloned-qwen-voice",
              privateProviderVoiceId: "server-side-only",
            },
          },
          clonedVoiceId,
        },
        null,
        2,
      ),
    );

    const requests: Array<{ authorization?: string; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        requests.push({
          authorization: headerToString(request.headers.authorization),
          body,
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ request_id: "request-disposable-delete" }));
      });
    });
    const baseUrl = await listenForTest(server);

    try {
      const output = await execFileForTest("node", [
        "scripts/qwen-voice-revoke-smoke.mjs",
        "--live",
        "--approved",
        "--voice-ref-id",
        voiceRefId,
        "--registry-dir",
        registryDir,
        "--base-url",
        baseUrl,
        "--env-file",
        envFile,
      ]);
      const body = JSON.parse(output);

      expect(body).toEqual(
        expect.objectContaining({
          target: "qwen-disposable-voice-revoke-smoke",
          mode: "live",
          network: "enabled",
          responsibleSession: "S24/S12",
          voiceRefId,
          status: "revoked-and-deleted",
          providerRevocation: expect.objectContaining({
            status: "revoked",
            httpStatus: 200,
            requestId: "request-disposable-delete",
          }),
          localReference: { status: "deleted" },
          audit: {
            localDeletionRecord: "written",
            lifecycleEvent: "written",
          },
        }),
      );
      expect(body.prerequisites).toContainEqual({
        id: "s19-qwen-env",
        responsibleSession: "S19",
        requiredEnv: "DASHSCOPE_API_KEY",
        status: "present",
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].authorization).toBe("Bearer secret-qwen-revoke-smoke");
      expect(JSON.parse(requests[0].body)).toEqual({
        model: "qwen-voice-enrollment",
        input: {
          action: "delete",
          voice: clonedVoiceId,
        },
      });
      expect(existsSync(join(registryDir, `${voiceRefId}.json`))).toBe(false);
      const localAudit = JSON.parse(
        readFileSync(join(registryDir, ".deletion-audit", `${voiceRefId}.json`), "utf8"),
      );
      expect(localAudit).toEqual(
        expect.objectContaining({
          voiceRefId,
          deletionReason: "owner-request",
          providerRevocation: { status: "revoked" },
          localReference: { status: "deleted" },
        }),
      );
      const lifecycleJsonl = readFileSync(
        join(registryDir, ".lifecycle-audit", "qwen-voice-lifecycle-audit.jsonl"),
        "utf8",
      );
      expect(lifecycleJsonl).toContain(voiceRefId);
      expect(output).not.toContain("secret-qwen-revoke-smoke");
      expect(output).not.toContain(clonedVoiceId);
      expect(output).not.toContain(registryDir);
    } finally {
      await closeServerForTest(server);
    }
  });

  it("rejects non-disposable voice references before reading provider credentials", () => {
    const registryDir = mkdtempSync(join(tmpdir(), "uais-non-disposable-qwen-voice-"));
    const envFile = join(registryDir, "env.test");
    mkdirSync(registryDir, { recursive: true });
    writeFileSync(envFile, "DASHSCOPE_API_KEY=secret-qwen-revoke-smoke\n");

    expect(() =>
      execFileSync("node", [
        "scripts/qwen-voice-revoke-smoke.mjs",
        "--live",
        "--approved",
        "--voice-ref-id",
        "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
        "--registry-dir",
        registryDir,
        "--base-url",
        "http://127.0.0.1:65535",
        "--env-file",
        envFile,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("disposable voiceRef");
  });

  it("rejects live revoke smoke without explicit approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/qwen-voice-revoke-smoke.mjs",
        "--live",
        "--voice-ref-id",
        "qwen-voice-ref-disposable-s24-delete-smoke-sample",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("explicit owner approval");
  });
});

async function listenForTest(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServerForTest(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function execFileForTest(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function headerToString(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
