import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  UAIS_LOCAL_VERCEL_BUILD_CONFIRMATION,
  runVercelBuildDispatch,
} from "../scripts/vercel-build-dispatch.mjs";

const stagingProjectId = "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL";
const productionProjectId = "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA";

describe("default Vercel build dispatch", () => {
  it("routes the exact production project through the existing migration then build path", () => {
    const commandRunner = vi.fn(() => ({ status: 0 }));

    const result = runVercelBuildDispatch({
      env: { VERCEL_ENV: "production", VERCEL_PROJECT_ID: productionProjectId },
      commandRunner,
      cwd: "/repo-fixture",
      nodeExecutable: "/node-fixture",
    });

    expect(result).toMatchObject({ exitCode: 0, report: { status: "PASS" } });
    expect(commandRunner).toHaveBeenCalledTimes(2);
    expect(commandRunner.mock.calls[0]?.[0]).toMatchObject({
      label: "production-core-migrations",
      command: "/node-fixture",
      args: ["scripts/apply-core-migrations.mjs", "--deploy"],
      cwd: "/repo-fixture",
    });
    expect(commandRunner.mock.calls[1]?.[0]).toMatchObject({
      label: "production-next-build",
      command: "/node-fixture",
      args: ["node_modules/next/dist/bin/next", "build"],
    });
  });

  it("routes the exact isolated staging project only through the staging guard", () => {
    const commandRunner = vi.fn(() => ({ status: 0 }));

    const result = runVercelBuildDispatch({
      env: { VERCEL_ENV: "production", VERCEL_PROJECT_ID: stagingProjectId },
      commandRunner,
      cwd: "/repo-fixture",
      nodeExecutable: "/node-fixture",
    });

    expect(result).toMatchObject({ exitCode: 0, report: { status: "PASS" } });
    expect(commandRunner).toHaveBeenCalledTimes(1);
    expect(commandRunner).toHaveBeenCalledWith({
      label: "isolated-staging-build-guard",
      command: "/node-fixture",
      args: ["scripts/vercel-staging-build-guard.mjs"],
      cwd: "/repo-fixture",
      env: expect.objectContaining({ VERCEL_PROJECT_ID: stagingProjectId }),
    });
  });

  it.each(["prj_unknown", "", undefined])(
    "fails closed for an unrecognized Vercel project identity %s",
    (projectId) => {
      const commandRunner = vi.fn(() => ({ status: 0 }));

      const result = runVercelBuildDispatch({
        env: { VERCEL_ENV: "production", VERCEL_PROJECT_ID: projectId },
        commandRunner,
      });

      expect(result).toEqual({
        exitCode: 2,
        report: {
          target: "uais-vercel-build-dispatch",
          status: "BLOCKED_ENV",
          blockedReasons: ["recognized-vercel-project-id-required"],
          valuesRedacted: true,
        },
      });
      expect(commandRunner).not.toHaveBeenCalled();
    },
  );

  it("requires an exact one-use opt-in for the non-Vercel local entry", () => {
    const localRunner = vi.fn(() => ({ status: 0 }));
    expect(runVercelBuildDispatch({ env: {}, commandRunner: localRunner })).toMatchObject({
      exitCode: 2,
      report: {
        status: "BLOCKED_ENV",
        blockedReasons: ["explicit-local-vercel-build-confirmation-required"],
      },
    });
    expect(localRunner).not.toHaveBeenCalled();

    expect(
      runVercelBuildDispatch({
        env: {
          UAIS_LOCAL_VERCEL_BUILD_CONFIRMATION:
            UAIS_LOCAL_VERCEL_BUILD_CONFIRMATION,
        },
        commandRunner: localRunner,
      }).exitCode,
    ).toBe(0);
    expect(localRunner).toHaveBeenCalledTimes(2);

    const partialRunner = vi.fn(() => ({ status: 0 }));
    expect(
      runVercelBuildDispatch({
        env: { VERCEL_PROJECT_ID: "prj_unknown" },
        commandRunner: partialRunner,
      }),
    ).toMatchObject({ exitCode: 2, report: { status: "BLOCKED_ENV" } });
    expect(partialRunner).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL", "1"],
    ["VERCEL_URL", "candidate.example.vercel.app"],
    ["VERCEL_BRANCH_URL", "branch.example.vercel.app"],
    ["VERCEL_PROJECT_PRODUCTION_URL", "production.example.vercel.app"],
    ["VERCEL_TARGET_ENV", "staging"],
    ["VERCEL_DEPLOYMENT_ID", "dpl_fixture"],
    ["VERCEL_REGION", "hkg1"],
    ["VERCEL_GIT_COMMIT_SHA", "a".repeat(40)],
  ])(
    "fails closed when %s signals Vercel but the exact project identity is absent",
    (name, value) => {
      const commandRunner = vi.fn(() => ({ status: 0 }));

      expect(
        runVercelBuildDispatch({ env: { [name]: value }, commandRunner }),
      ).toMatchObject({
        exitCode: 2,
        report: {
          status: "BLOCKED_ENV",
          blockedReasons: ["recognized-vercel-project-id-required"],
        },
      });
      expect(commandRunner).not.toHaveBeenCalled();
    },
  );

  it("returns FAIL without starting later commands when a child fails", () => {
    const commandRunner = vi
      .fn()
      .mockReturnValueOnce({ status: 9 })
      .mockReturnValue({ status: 0 });

    const result = runVercelBuildDispatch({
      env: { VERCEL_ENV: "production", VERCEL_PROJECT_ID: productionProjectId },
      commandRunner,
    });

    expect(result).toMatchObject({
      exitCode: 1,
      report: {
        status: "FAIL",
        blockedReasons: ["production-core-migrations-failed"],
      },
    });
    expect(commandRunner).toHaveBeenCalledTimes(1);
  });

  it("binds the default package and Vercel config to the dispatcher", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      buildCommand?: string;
    };

    expect(packageJson.scripts?.["vercel-build"]).toBe(
      "node scripts/vercel-build-dispatch.mjs",
    );
    expect(vercelConfig.buildCommand).toBe("npm run vercel-build");
  });

  it("the executable default entry blocks an empty Vercel production identity", () => {
    const outcome = spawnSync(process.execPath, ["scripts/vercel-build-dispatch.mjs"], {
      cwd: process.cwd(),
      env: { VERCEL_ENV: "production" },
      encoding: "utf8",
    });

    expect(outcome.status).toBe(2);
    expect(JSON.parse(outcome.stderr.trim())).toMatchObject({
      target: "uais-vercel-build-dispatch",
      status: "BLOCKED_ENV",
      valuesRedacted: true,
    });
    expect(outcome.stdout).toBe("");
  });
});
