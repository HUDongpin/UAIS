import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ordinaryTeachingProviderEnvNames = [
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
  "UAIS_COURSE_EXPORT_PROVIDER",
  "UAIS_COURSE_EXPORT_PROVIDER_URL",
  "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
  "UAIS_GRADING_FEEDBACK_PROVIDER",
  "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
  "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
];
const appAuthProviderEnvNames = [
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
];

describe("Vercel env inventory evidence harness", () => {
  it("lists remote Vercel env metadata without leaking values", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-inventory-"));
    const nodeBin = join(tmpDir, "node_modules", ".bin");
    mkdirSync(nodeBin, { recursive: true });
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const fakeVercel = join(nodeBin, "vercel");
    writeFileSync(
      fakeVercel,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" >> \"$FAKE_VERCEL_LOG\"",
        "case \" $* \" in",
        "  *' production '*) printf '%s\\n' '[{\"key\":\"UAIS_AI_ACCESS_SIGNING_SECRET\",\"target\":[\"production\"],\"value\":\"secret-production-value\"},{\"key\":\"UAIS_TEACHER_AUTH_PROVIDER\",\"target\":[\"production\"]},{\"key\":\"DEEPSEEK_API_KEY\",\"target\":[\"production\"],\"value\":\"secret-deepseek\"}]' ;;",
        "  *' preview '*) printf '%s\\n' '[{\"key\":\"UAIS_AI_ACCESS_SIGNING_SECRET\",\"target\":[\"preview\"]},{\"key\":\"UAIS_TEACHER_AUTH_PROVIDER\",\"target\":[\"preview\"]}]' ;;",
        "  *) printf '%s\\n' '[]' ;;",
        "esac",
      ].join("\n"),
    );
    chmodSync(fakeVercel, 0o755);

    const result = spawnSync("node", [
      "scripts/vercel-env-inventory.mjs",
      "--project-dir",
      tmpDir,
      "--release-run-id",
      "uais-env-inventory-test",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_VERCEL_LOG: fakeLog,
      },
    });
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(1);
    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-inventory",
        mode: "live",
        responsibleSession: "S19",
        releaseRunId: "uais-env-inventory-test",
        status: "blocked",
        environments: ["production", "preview"],
        blockedReasons: ["vercel-env-inventory-required-env-missing"],
        safety: {
          valuesRedacted: true,
          rawCliOutputOmitted: true,
          stderrOmitted: true,
          tokenOmitted: true,
          localPrivatePathsOmitted: true,
          noMutation: true,
        },
      }),
    );
    expect(body.remoteEnvCounts).toEqual({
      production: 3,
      preview: 2,
    });
    expect(body.requiredEnvCoverage).toEqual(
      expect.arrayContaining([
        {
          name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
          production: "missing",
          preview: "missing",
          valueRedacted: true,
        },
        {
          name: "UAIS_AI_ACCESS_SIGNING_SECRET",
          production: "present",
          preview: "present",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
          production: "missing",
          preview: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(body.optionalEnvCoverage).toEqual(
      expect.arrayContaining([
        {
          name: "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
          production: "missing",
          preview: "missing",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
          production: "missing",
          preview: "missing",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
          production: "missing",
          preview: "missing",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
          production: "missing",
          preview: "missing",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
          production: "missing",
          preview: "missing",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
          production: "missing",
          preview: "missing",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
          production: "missing",
          preview: "missing",
          valueRedacted: true,
        },
      ]),
    );
    expect(body.remoteEnvNames.production).toEqual([
      "DEEPSEEK_API_KEY",
      "UAIS_AI_ACCESS_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_PROVIDER",
    ]);
    const loggedInvocations = readFileSync(fakeLog, "utf8");
    expect(loggedInvocations).toContain("--non-interactive");
    expect(output).not.toContain("secret-production-value");
    expect(output).not.toContain("secret-deepseek");
    expect(output).not.toContain(tmpDir);
  });

  it("marks required env coverage unknown when remote inventory commands fail", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-inventory-failed-"));
    const nodeBin = join(tmpDir, "node_modules", ".bin");
    mkdirSync(nodeBin, { recursive: true });
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const fakeVercel = join(nodeBin, "vercel");
    writeFileSync(
      fakeVercel,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" >> \"$FAKE_VERCEL_LOG\"",
        "printf '%s\\n' 'auth failed secret-production-value /Users/private-path' >&2",
        "exit 1",
      ].join("\n"),
    );
    chmodSync(fakeVercel, 0o755);

    const result = spawnSync("node", [
      "scripts/vercel-env-inventory.mjs",
      "--project-dir",
      tmpDir,
      "--release-run-id",
      "uais-env-inventory-failed-test",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_VERCEL_LOG: fakeLog,
      },
    });
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(1);
    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-inventory",
        mode: "live",
        status: "blocked",
        command: {
          name: "vercel-env-list",
          format: "json",
          statusByEnvironment: {
            production: "failed",
            preview: "failed",
          },
          failureClassByEnvironment: {
            production: "auth-required",
            preview: "auth-required",
          },
          attemptsByEnvironment: {
            production: 1,
            preview: 1,
          },
          stdoutOmitted: true,
          stderrOmitted: true,
        },
        blockedReasons: ["vercel-env-inventory-command-not-passed"],
      }),
    );
    expect(body.requiredEnvCoverage).toEqual(
      expect.arrayContaining([
        {
          name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
          production: "unknown",
          preview: "unknown",
          valueRedacted: true,
        },
      ]),
    );
    expect(body.missingRequiredEnv).toEqual([]);
    expect(body.unobservedRequiredEnv).toEqual(
      expect.arrayContaining([
        {
          name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
          environment: "production",
          valueRedacted: true,
        },
        {
          name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
          environment: "preview",
          valueRedacted: true,
        },
      ]),
    );
    expect(body.optionalEnvCoverage).toEqual(
      expect.arrayContaining([
        {
          name: "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
          production: "unknown",
          preview: "unknown",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
          production: "unknown",
          preview: "unknown",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
          production: "unknown",
          preview: "unknown",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
          production: "unknown",
          preview: "unknown",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
          production: "unknown",
          preview: "unknown",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
          production: "unknown",
          preview: "unknown",
          valueRedacted: true,
        },
        {
          name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
          production: "unknown",
          preview: "unknown",
          valueRedacted: true,
        },
      ]),
    );
    expect(body.unobservedRequiredEnv).toHaveLength(80);
    const loggedInvocations = readFileSync(fakeLog, "utf8");
    expect(loggedInvocations).toContain("--non-interactive");
    expect(output).not.toContain("secret-production-value");
    expect(output).not.toContain("/Users/private-path");
    expect(output).not.toContain(tmpDir);
  });

  it("blocks observed inventory when ordinary teaching provider envs are missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-inventory-provider-env-"));
    const nodeBin = join(tmpDir, "node_modules", ".bin");
    mkdirSync(nodeBin, { recursive: true });
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const fakeVercel = join(nodeBin, "vercel");
    const legacyRequiredEnv = [
      "UAIS_LIVE_AI_APPROVAL_TOKEN",
      "UAIS_AI_ACCESS_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_PROVIDER",
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
      "UAIS_TEACHING_OPERATIONS_BACKEND",
      "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
      "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
      "UAIS_EXTERNAL_STORAGE_BASE_URL",
      "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      "DEEPSEEK_API_KEY",
      "DASHSCOPE_API_KEY",
    ];
    const legacyInventory = JSON.stringify(
      legacyRequiredEnv.map((key) => ({ key, target: ["production"] })),
    );
    writeFileSync(
      fakeVercel,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" >> \"$FAKE_VERCEL_LOG\"",
        `printf '%s\\n' '${legacyInventory}'`,
      ].join("\n"),
    );
    chmodSync(fakeVercel, 0o755);

    const result = spawnSync("node", [
      "scripts/vercel-env-inventory.mjs",
      "--project-dir",
      tmpDir,
      "--release-run-id",
      "uais-env-inventory-provider-env-test",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_VERCEL_LOG: fakeLog,
      },
    });
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(1);
    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("vercel-env-inventory-required-env-missing");
    const expectedMissingProviderEnvNames = [
      ...appAuthProviderEnvNames,
      ...ordinaryTeachingProviderEnvNames,
    ];

    expect(body.requiredEnvCoverage).toEqual(
      expect.arrayContaining(
        expectedMissingProviderEnvNames.map((name) => ({
          name,
          production: "missing",
          preview: "missing",
          valueRedacted: true,
        })),
      ),
    );
    expect(body.missingRequiredEnv).toEqual(
      expect.arrayContaining(
        expectedMissingProviderEnvNames.flatMap((name) => [
          { name, environment: "production", valueRedacted: true },
          { name, environment: "preview", valueRedacted: true },
        ]),
      ),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("retries transient Vercel env inventory network errors without leaking stderr", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-inventory-retry-"));
    const nodeBin = join(tmpDir, "node_modules", ".bin");
    mkdirSync(nodeBin, { recursive: true });
    const fakeLog = join(tmpDir, "fake-vercel.log");
    const fakeVercel = join(nodeBin, "vercel");
    const completeRequiredEnv = [
      "UAIS_LIVE_AI_APPROVAL_TOKEN",
      "UAIS_AI_ACCESS_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_PROVIDER",
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
      "UAIS_TEACHING_OPERATIONS_BACKEND",
      "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
      "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
      "UAIS_EXTERNAL_STORAGE_BASE_URL",
      "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      ...appAuthProviderEnvNames,
      ...ordinaryTeachingProviderEnvNames,
      "DEEPSEEK_API_KEY",
      "DASHSCOPE_API_KEY",
    ];
    const completeInventory = JSON.stringify(
      completeRequiredEnv.map((key) => ({ key, target: ["production"] })),
    );
    writeFileSync(
      fakeVercel,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" >> \"$FAKE_VERCEL_LOG\"",
        "case \" $* \" in",
        "  *' production '*)",
        `    count_file="${tmpDir}/production-count"`,
        "    count=0",
        "    if [ -f \"$count_file\" ]; then count=$(cat \"$count_file\"); fi",
        "    count=$((count + 1))",
        "    printf '%s' \"$count\" > \"$count_file\"",
        "    if [ \"$count\" -eq 1 ]; then",
        "      printf '%s\\n' 'fetch failed secret-production-value /Users/private-path' >&2",
        "      exit 1",
        "    fi",
        `    printf '%s\\n' '${completeInventory}'`,
        "    ;;",
        "  *' preview '*)",
        `    printf '%s\\n' '${completeInventory}'`,
        "    ;;",
        "  *) printf '%s\\n' '[]' ;;",
        "esac",
      ].join("\n"),
    );
    chmodSync(fakeVercel, 0o755);

    const result = spawnSync("node", [
      "scripts/vercel-env-inventory.mjs",
      "--project-dir",
      tmpDir,
      "--release-run-id",
      "uais-env-inventory-retry-test",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_VERCEL_LOG: fakeLog,
      },
    });
    const output = result.stdout;
    const body = JSON.parse(output);

    expect(result.status).toBe(0);
    expect(body).toEqual(
      expect.objectContaining({
        target: "vercel-env-inventory",
        status: "observed",
        blockedReasons: [],
        command: expect.objectContaining({
          statusByEnvironment: {
            production: "passed",
            preview: "passed",
          },
          failureClassByEnvironment: {
            production: "none",
            preview: "none",
          },
          attemptsByEnvironment: {
            production: 2,
            preview: 1,
          },
          stdoutOmitted: true,
          stderrOmitted: true,
        }),
      }),
    );
    expect(body.missingRequiredEnv).toEqual([]);
    expect(body.unobservedRequiredEnv).toEqual([]);
    expect(output).not.toContain("secret-production-value");
    expect(output).not.toContain("/Users/private-path");
    expect(output).not.toContain(tmpDir);
  });

  it("reads remote Vercel env metadata through the REST API without leaking tokens or values", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-vercel-env-inventory-rest-"));
    mkdirSync(join(tmpDir, ".vercel"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".vercel", "project.json"),
      JSON.stringify({
        projectId: "prj_rest_fixture",
        orgId: "team_rest_fixture",
      }),
    );

    const requiredEnvNames = [
      "UAIS_LIVE_AI_APPROVAL_TOKEN",
      "UAIS_AI_ACCESS_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_PROVIDER",
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
      "UAIS_TEACHING_OPERATIONS_BACKEND",
      "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
      "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
      "UAIS_EXTERNAL_STORAGE_BASE_URL",
      "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      ...appAuthProviderEnvNames,
      ...ordinaryTeachingProviderEnvNames,
      "DEEPSEEK_API_KEY",
      "DASHSCOPE_API_KEY",
    ];
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      expect(request.headers.authorization).toBe("Bearer fixture-rest-token-secret");

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const target = url.searchParams.get("target");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          envs: requiredEnvNames.map((key) => ({
            key,
            target: [target],
            value: `secret-${target}-${key}`,
          })),
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected local REST fixture port.");
      }
      const result = await runNodeScript([
        "scripts/vercel-env-inventory.mjs",
        "--method",
        "rest",
        "--project-dir",
        tmpDir,
        "--vercel-api-base-url",
        `http://127.0.0.1:${address.port}`,
        "--release-run-id",
        "uais-env-inventory-rest-test",
      ], {
        env: {
          ...process.env,
          VERCEL_TOKEN: "fixture-rest-token-secret",
        },
      });
      const output = result.stdout;
      const body = JSON.parse(output);

      expect(result.status).toBe(0);
      expect(body).toEqual(
        expect.objectContaining({
          target: "vercel-env-inventory",
          mode: "live",
          responsibleSession: "S19",
          releaseRunId: "uais-env-inventory-rest-test",
          status: "observed",
          command: expect.objectContaining({
            name: "vercel-env-rest-list",
            format: "json",
            statusByEnvironment: {
              production: "passed",
              preview: "passed",
            },
            failureClassByEnvironment: {
              production: "none",
              preview: "none",
            },
            stdoutOmitted: true,
            stderrOmitted: true,
            apiOutputOmitted: true,
          }),
          blockedReasons: [],
        }),
      );
      expect(body.remoteEnvCounts).toEqual({
        production: requiredEnvNames.length,
        preview: requiredEnvNames.length,
      });
      expect(body.missingRequiredEnv).toEqual([]);
      expect(body.unobservedRequiredEnv).toEqual([]);
      expect(requests).toEqual([
        "/v10/projects/prj_rest_fixture/env?target=production&teamId=team_rest_fixture",
        "/v10/projects/prj_rest_fixture/env?target=preview&teamId=team_rest_fixture",
      ]);
      expect(output).not.toContain("fixture-rest-token-secret");
      expect(output).not.toContain("secret-production-DEEPSEEK_API_KEY");
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
