import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vercel REST auth scope readiness", () => {
  it("proves user, project, and env endpoints without leaking token or ids", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-rest-auth-scope-"));
    mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".vercel", "project.json"),
      JSON.stringify({
        projectId: "prj_rest_scope_fixture",
        orgId: "team_rest_scope_fixture",
        projectName: "uais-secret-project-name",
      }),
    );
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      expect(request.headers.authorization).toBe("Bearer fixture-rest-scope-token-secret");

      if (request.url === "/v2/user") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ user: { id: "user_secret_id", username: "secret-user" } }));
        return;
      }
      if (request.url === "/v9/projects/prj_rest_scope_fixture?teamId=team_rest_scope_fixture") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "prj_rest_scope_fixture", name: "uais-secret-project-name" }));
        return;
      }
      if (
        request.url ===
        "/v10/projects/prj_rest_scope_fixture/env?target=production&source=vercel-cli%3Aenv%3Als&teamId=team_rest_scope_fixture"
      ) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ envs: [{ key: "UAIS_AI_ACCESS_SIGNING_SECRET", value: "secret" }] }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected local REST fixture port.");
      }
      const result = await runNodeScript([
        "scripts/vercel-rest-auth-scope-readiness.mjs",
        "--live",
        "--approved",
        "--project-dir",
        tmpDir,
        "--vercel-api-base-url",
        `http://127.0.0.1:${address.port}`,
      ], {
        env: {
          ...process.env,
          VERCEL_TOKEN: "fixture-rest-scope-token-secret",
        },
      });
      const output = result.stdout;
      const body = JSON.parse(output);

      expect(result.status).toBe(0);
      expect(body).toEqual(
        expect.objectContaining({
          target: "vercel-rest-auth-scope-readiness",
          mode: "live",
          status: "ready",
          responsibleSession: "S22",
          readyAuthMethod: "env-token",
          projectLink: {
            status: "linked",
            projectId: "present",
            orgId: "present",
            orgScope: "team",
            projectName: "present",
            valuesRedacted: true,
          },
          probes: {
            user: {
              status: "passed",
              httpStatus: 200,
              failureClass: "none",
              responseBodyOmitted: true,
            },
            project: {
              status: "passed",
              httpStatus: 200,
              failureClass: "none",
              responseBodyOmitted: true,
            },
            envProduction: {
              status: "passed",
              httpStatus: 200,
              failureClass: "none",
              responseBodyOmitted: true,
            },
          },
          blockedReasons: [],
        }),
      );
      expect(requests).toEqual([
        "/v2/user",
        "/v9/projects/prj_rest_scope_fixture?teamId=team_rest_scope_fixture",
        "/v10/projects/prj_rest_scope_fixture/env?target=production&source=vercel-cli%3Aenv%3Als&teamId=team_rest_scope_fixture",
      ]);
      expect(output).not.toContain("fixture-rest-scope-token-secret");
      expect(output).not.toContain("prj_rest_scope_fixture");
      expect(output).not.toContain("team_rest_scope_fixture");
      expect(output).not.toContain("uais-secret-project-name");
      expect(output).not.toContain("secret-user");
      expect(output).not.toContain(tmpDir);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("classifies valid account auth with project env authorization failure", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-rest-auth-scope-blocked-"));
    mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".vercel", "project.json"),
      JSON.stringify({
        projectId: "prj_scope_blocked_fixture",
        orgId: "team_scope_blocked_fixture",
      }),
    );
    const server = createServer((request, response) => {
      if (request.url === "/v2/user") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ user: { id: "user_secret_id" } }));
        return;
      }
      if (request.url === "/v9/projects/prj_scope_blocked_fixture?teamId=team_scope_blocked_fixture") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "prj_scope_blocked_fixture" }));
        return;
      }
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "FORBIDDEN", message: "secret forbidden detail" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected local REST fixture port.");
      }
      const result = await runNodeScript([
        "scripts/vercel-rest-auth-scope-readiness.mjs",
        "--live",
        "--approved",
        "--project-dir",
        tmpDir,
        "--vercel-api-base-url",
        `http://127.0.0.1:${address.port}`,
      ], {
        env: {
          ...process.env,
          VERCEL_TOKEN: "fixture-rest-scope-token-secret",
        },
      });
      const output = result.stdout;
      const body = JSON.parse(output);

      expect(result.status).toBe(1);
      expect(body.status).toBe("blocked");
      expect(body.probes.user.status).toBe("passed");
      expect(body.probes.project.status).toBe("passed");
      expect(body.probes.envProduction).toEqual({
        status: "failed",
        httpStatus: 403,
        failureClass: "auth-required",
        responseBodyOmitted: true,
      });
      expect(body.blockedReasons).toEqual(["vercel-rest-env-auth-required"]);
      expect(output).not.toContain("secret forbidden detail");
      expect(output).not.toContain("fixture-rest-scope-token-secret");
      expect(output).not.toContain(tmpDir);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function runNodeScript(
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
      cwd: process.cwd(),
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}
