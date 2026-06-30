import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Qwen disposable voice create smoke CLI", () => {
  it("creates a disposable Qwen voice reference and stores only the private provider id locally", async () => {
    const registryDir = mkdtempSync(join(tmpdir(), "uais-disposable-qwen-create-"));
    const envFile = join(registryDir, "env.test");
    const sampleAudio = join(registryDir, "sample.wav");
    const teacherId = "disposable-teacher";
    const sampleAssetId = "s24-delete-smoke-sample";
    const voiceRefId = "qwen-voice-ref-disposable-disposable-teacher-s24-delete-smoke-sample";
    const clonedVoiceId = "private-disposable-cloned-voice-id-should-not-leak";
    writeFileSync(envFile, "DASHSCOPE_API_KEY=secret-qwen-create-smoke\n");
    writeFileSync(sampleAudio, "RIFF....WAVEfmt disposable smoke sample");

    const requests: Array<{ authorization?: string; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        requests.push({
          authorization: headerToString(request.headers.authorization),
          body: Buffer.concat(chunks).toString("utf8"),
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            request_id: "request-disposable-create",
            output: {
              voice: clonedVoiceId,
              target_model: "qwen3-tts-vc-realtime-2026-01-15",
            },
          }),
        );
      });
    });
    const baseUrl = await listenForTest(server);

    try {
      const output = await execFileForTest("node", [
        "scripts/qwen-voice-disposable-create-smoke.mjs",
        "--live",
        "--approved",
        "--teacher-id",
        teacherId,
        "--sample-asset-id",
        sampleAssetId,
        "--sample-audio",
        sampleAudio,
        "--sample-text",
        "This disposable voice sample is for a short smoke test only.",
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
          target: "qwen-disposable-voice-create-smoke",
          mode: "live",
          network: "enabled",
          responsibleSession: "S24/S12",
          voiceRefId,
          status: "created",
          providerEnrollment: expect.objectContaining({
            provider: "qwen",
            providerRole: "voice-clone",
            status: "submitted",
            httpStatus: 200,
            requestId: "request-disposable-create",
            targetModel: "qwen3-tts-vc-realtime-2026-01-15",
          }),
          localReference: {
            status: "stored",
            storagePolicy: "local-private-cloned-voice-reference",
          },
        }),
      );
      expect(body.safety).toEqual(
        expect.objectContaining({
          disposableVoiceRefCreated: true,
          privateVoiceIdRedacted: true,
          sampleAudioRedacted: true,
          liveRequiresApproval: true,
        }),
      );
      expect(body.prerequisites).toContainEqual({
        id: "s19-qwen-env",
        responsibleSession: "S19",
        requiredEnv: "DASHSCOPE_API_KEY",
        status: "present",
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].authorization).toBe("Bearer secret-qwen-create-smoke");
      const providerBody = JSON.parse(requests[0].body);
      expect(providerBody).toEqual(
        expect.objectContaining({
          model: "qwen-voice-enrollment",
          input: expect.objectContaining({
            action: "create",
            target_model: "qwen3-tts-vc-realtime-2026-01-15",
            text: "This disposable voice sample is for a short smoke test only.",
          }),
        }),
      );
      expect(providerBody.input.audio.data).toMatch(/^data:audio\/wav;base64,/);
      const referencePath = join(registryDir, `${voiceRefId}.json`);
      expect(existsSync(referencePath)).toBe(true);
      const reference = JSON.parse(readFileSync(referencePath, "utf8"));
      expect(reference.publicReference).toEqual(
        expect.objectContaining({
          voiceRefId,
          teacherId,
          sampleAssetId,
          provider: "qwen",
          providerRole: "voice-clone",
          status: "ready",
          storagePolicy: "local-private-cloned-voice-reference",
          responsibleSession: "S07/S12/S24",
        }),
      );
      expect(reference.publicReference.retention).toEqual(
        expect.objectContaining({
          classification: "provider-cloned-voice-reference-sensitive",
          reviewAfterDays: 30,
          responsibleSession: "S24",
        }),
      );
      expect(reference.clonedVoiceId).toBe(clonedVoiceId);
      expect(output).not.toContain("secret-qwen-create-smoke");
      expect(output).not.toContain(clonedVoiceId);
      expect(output).not.toContain(sampleAudio);
      expect(output).not.toContain(registryDir);
      expect(output).not.toContain("data:audio/wav;base64");
    } finally {
      await closeServerForTest(server);
    }
  });

  it("reports a redacted dry-run plan without reading local sample audio", () => {
    const output = execFileSync("node", [
      "scripts/qwen-voice-disposable-create-smoke.mjs",
      "--dry-run",
      "--teacher-id",
      "disposable-teacher",
      "--sample-asset-id",
      "s24-delete-smoke-sample",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "qwen-disposable-voice-create-smoke",
        mode: "dry-run",
        network: "disabled",
        responsibleSession: "S24/S12",
        voiceRefId: "qwen-voice-ref-disposable-disposable-teacher-s24-delete-smoke-sample",
      }),
    );
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("data:audio");
  });

  it("rejects live create smoke without explicit approval", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/qwen-voice-disposable-create-smoke.mjs",
        "--live",
        "--teacher-id",
        "disposable-teacher",
        "--sample-asset-id",
        "s24-delete-smoke-sample",
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
