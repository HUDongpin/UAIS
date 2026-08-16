import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it, vi } from "vitest";
import { isLearningChatroomGroupsEnabled } from "@/lib/server/learning-chatroom-groups-flag";

// The production readiness preflight (blockers B2/B3/B4). These blockers are
// environment facts, not code paths, so nothing in the app could catch them -
// they surfaced only as a 503 on a learner's first message, or as group rooms
// that silently stayed off after a flip everyone believed had happened.
//
// The script is exercised as a CLI, the way an operator and CI run it, because
// the exit code IS the gate.

const runFile = promisify(execFile);
const scriptPath = "scripts/chatroom-production-readiness.mjs";
const fixtureDirs: string[] = [];

afterAll(async () => {
  await Promise.all(fixtureDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeEnvFile(lines: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "uais-chatroom-readiness-"));
  fixtureDirs.push(dir);
  const filePath = join(dir, "env.txt");
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

async function runPreflight(envFile: string, extra: string[] = []) {
  try {
    const { stdout } = await runFile("node", [scriptPath, "--env-file", envFile, "--json", ...extra], {
      cwd: process.cwd(),
    });
    return { exitCode: 0, report: JSON.parse(stdout) };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    return { exitCode: failure.code ?? 1, report: JSON.parse(failure.stdout ?? "{}") };
  }
}

const readyEnvLines = [
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
  "UAIS_EXTERNAL_STORAGE_BASE_URL=https://storage.example.com",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=this-token-is-long-enough-to-pass-32",
  "UAIS_LEARNING_CHATROOM_GROUPS_MODE=on",
  "DEEPSEEK_API_KEY=sk-fake-deepseek",
];

function findCheck(report: { checks: Array<{ blocker: string }> }, blocker: string) {
  const check = report.checks.find((entry) => entry.blocker === blocker);
  expect(check).toBeDefined();
  return check as Record<string, unknown> & { blockedReasons: string[]; status: string };
}

describe("chatroom production readiness preflight", () => {
  it("blocks an unset environment and names every unresolved blocker", async () => {
    const envFile = await writeEnvFile([]);
    const { exitCode, report } = await runPreflight(envFile);

    expect(exitCode).toBe(1);
    // Named like every other evidence file in the release chain, so the
    // aggregate gate that now consumes this report can refuse a file that is
    // not it rather than accepting any JSON carrying `status: "ready"`.
    expect(report.target).toBe("chatroom-production-readiness");
    expect(report.status).toBe("blocked");
    // An unset backend selector means local JSON, which production refuses.
    expect(findCheck(report, "B2").blockedReasons).toContain(
      "local-json-backend-refused-in-production",
    );
    expect(findCheck(report, "B4").blockedReasons).toContain("groups-mode-not-on");
    expect(findCheck(report, "provider").blockedReasons).toContain(
      "no-agent-provider-configured",
    );
  });

  it("catches the truthy-looking flag value that leaves group rooms off", async () => {
    // The trap this check exists for: `true` reads as enabled to a human and as
    // disabled to the app, so a flip appears to happen and nothing changes.
    for (const value of ["true", "1", "yes", "enabled"]) {
      const envFile = await writeEnvFile([
        ...readyEnvLines.filter((line) => !line.startsWith("UAIS_LEARNING_CHATROOM_GROUPS_MODE")),
        `UAIS_LEARNING_CHATROOM_GROUPS_MODE=${value}`,
      ]);
      const { report } = await runPreflight(envFile);
      const flag = findCheck(report, "B4");

      expect(flag.status).toBe("blocked");
      expect(flag.note).toMatch(/not the literal/);
      // The script must agree with the app's single reader, never drift from it.
      expect(isLearningChatroomGroupsEnabled({ UAIS_LEARNING_CHATROOM_GROUPS_MODE: value })).toBe(
        false,
      );
    }
  });

  it("accepts the spellings the app's reader accepts", async () => {
    for (const value of ["on", "On", " ON "]) {
      const envFile = await writeEnvFile([
        ...readyEnvLines.filter((line) => !line.startsWith("UAIS_LEARNING_CHATROOM_GROUPS_MODE")),
        `UAIS_LEARNING_CHATROOM_GROUPS_MODE=${value}`,
      ]);
      const { report } = await runPreflight(envFile);
      expect(findCheck(report, "B4").status).toBe("ready");
      expect(isLearningChatroomGroupsEnabled({ UAIS_LEARNING_CHATROOM_GROUPS_MODE: value })).toBe(
        true,
      );
    }
  });

  it("refuses a plaintext storage endpoint and a short access token", async () => {
    const envFile = await writeEnvFile([
      "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=external",
      // A bearer token rides every call, so http would leak it.
      "UAIS_EXTERNAL_STORAGE_BASE_URL=http://storage.example.com",
      "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=too-short",
      "UAIS_LEARNING_CHATROOM_GROUPS_MODE=on",
      "DEEPSEEK_API_KEY=sk-fake-deepseek",
    ]);
    const { report } = await runPreflight(envFile);
    const storage = findCheck(report, "B2");

    expect(storage.blockedReasons).toContain("non-https-UAIS_EXTERNAL_STORAGE_BASE_URL");
    expect(storage.blockedReasons).toContain(
      "invalid-UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN:too-short",
    );
  });

  it("reports whether a provider outage would still leave the room answering", async () => {
    const single = await runPreflight(await writeEnvFile(readyEnvLines));
    expect(findCheck(single.report, "provider").failoverAvailable).toBe(false);

    const both = await runPreflight(
      await writeEnvFile([...readyEnvLines, "DASHSCOPE_API_KEY=sk-fake-qwen"]),
    );
    const provider = findCheck(both.report, "provider");
    expect(provider.failoverAvailable).toBe(true);
    expect(provider.configuredRoles).toEqual(["text-reasoning", "multimodal"]);
  });

  it("passes a production deployment that has only the required core database", async () => {
    // The blocker B2 case: no UAIS_EXTERNAL_STORAGE_* anywhere, yet durable,
    // because the managed Postgres is already part of the production surface.
    const { exitCode, report } = await runPreflight(
      await writeEnvFile([
        "UAIS_CORE_DATABASE_URL=postgres://user:pass@db.example.com/uais",
        "UAIS_LEARNING_CHATROOM_GROUPS_MODE=on",
        "DEEPSEEK_API_KEY=sk-fake-deepseek",
      ]),
    );

    expect(report.status).toBe("ready");
    expect(exitCode).toBe(0);
    expect(findCheck(report, "B2").resolvedBackend).toBe("postgres");
    // Nothing to negotiate with: there is no separately versioned service.
    expect(findCheck(report, "B3").status).toBe("not-applicable");
    expect(findCheck(report, "B3").blockedReasons).toEqual([]);
  });

  it("treats an unprobed schema check as unverified rather than satisfied", async () => {
    const { exitCode, report } = await runPreflight(await writeEnvFile(readyEnvLines));

    // Everything the script can settle offline is settled...
    expect(findCheck(report, "B2").status).toBe("ready");
    expect(findCheck(report, "B4").status).toBe("ready");
    // ...but a separately deployed storage service is only provable by asking it.
    const schema = findCheck(report, "B3");
    expect(schema.status).toBe("skipped");
    expect(schema.blockedReasons).toContain("transcript-schema-v2-unverified");
    expect(exitCode).toBe(1);
  });

  it("never prints a secret value", async () => {
    const secret = "this-token-is-long-enough-to-pass-32";
    const { report } = await runPreflight(
      await writeEnvFile([...readyEnvLines, "DASHSCOPE_API_KEY=sk-fake-qwen"]),
    );
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("sk-fake-deepseek");
    expect(serialized).not.toContain("sk-fake-qwen");
    expect(report.safety.secretsPrinted).toBe(false);
  });
});

describe("group flag misconfiguration is visible at runtime", () => {
  it("warns once per distinct wrong value instead of failing silently", async () => {
    const { resetLearningChatroomGroupsFlagWarningsForTesting } = await import(
      "@/lib/server/learning-chatroom-groups-flag"
    );
    resetLearningChatroomGroupsFlagWarningsForTesting();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // The dangerous case: a deployment believes group rooms are live.
    expect(isLearningChatroomGroupsEnabled({ UAIS_LEARNING_CHATROOM_GROUPS_MODE: "true" })).toBe(
      false,
    );
    expect(isLearningChatroomGroupsEnabled({ UAIS_LEARNING_CHATROOM_GROUPS_MODE: "true" })).toBe(
      false,
    );
    // Read on nearly every request, so the warning is once per value, not per call.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      phase: "feature-flag",
      configuredValue: "true",
      expectedValue: "on",
    });

    // Unset is the documented default and must stay quiet.
    expect(isLearningChatroomGroupsEnabled({})).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    // A correct value never warns.
    expect(isLearningChatroomGroupsEnabled({ UAIS_LEARNING_CHATROOM_GROUPS_MODE: "On" })).toBe(
      true,
    );
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    resetLearningChatroomGroupsFlagWarningsForTesting();
  });
});
