import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeUaisStagingCandidateContentSha,
  resolveUaisStagingBuildContentSha,
} from "../scripts/p2-staging-candidate-content.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("staging candidate build content binding", () => {
  it("is deterministic and changes when an allowlisted deployable file changes", () => {
    const root = mkdtempSync(join(tmpdir(), "uais-staging-content-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "route.ts"), "export const value = 1;\n");
    writeFileSync(join(root, "package.json"), "{\"name\":\"fixture\"}\n");

    const first = computeUaisStagingCandidateContentSha(root, ["package.json", "src"]);
    const repeated = computeUaisStagingCandidateContentSha(root, ["src", "package.json"]);
    writeFileSync(join(root, "src", "route.ts"), "export const value = 2;\n");
    const changed = computeUaisStagingCandidateContentSha(root, ["package.json", "src"]);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(repeated).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("fails a staging collection build when the asserted digest differs", () => {
    const root = mkdtempSync(join(tmpdir(), "uais-staging-content-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "route.ts"), "export const value = 1;\n");
    writeFileSync(join(root, "package.json"), "{\"name\":\"fixture\"}\n");

    expect(() =>
      resolveUaisStagingBuildContentSha({
        root,
        env: {
          UAIS_DEPLOYMENT_ENV: "staging",
          UAIS_STAGING_INP_RUM_ENABLED: "yes",
          P2_CANDIDATE_CONTENT_SHA: "f".repeat(64),
        },
        entries: ["package.json", "src"],
      }),
    ).toThrow(/does not match deployable source/);
  });

  it("also binds a base staging build when RUM is explicitly disabled", () => {
    const root = mkdtempSync(join(tmpdir(), "uais-staging-content-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "route.ts"), "export const value = 1;\n");
    writeFileSync(join(root, "package.json"), "{\"name\":\"fixture\"}\n");
    const digest = computeUaisStagingCandidateContentSha(root, ["package.json", "src"]);

    expect(
      resolveUaisStagingBuildContentSha({
        root,
        env: {
          UAIS_DEPLOYMENT_ENV: "staging",
          UAIS_STAGING_INP_RUM_ENABLED: "no",
          P2_CANDIDATE_CONTENT_SHA: digest,
        },
        entries: ["package.json", "src"],
      }),
    ).toBe(digest);
  });

  it("keeps the Next config check bound across the exact Vercel materialization", () => {
    const root = mkdtempSync(join(tmpdir(), "uais-staging-vercel-config-"));
    temporaryRoots.push(root);
    const candidateGitSha = "a".repeat(40);
    const sourceConfig = {
      $schema: "https://openapi.vercel.sh/vercel.json",
      framework: "nextjs",
      buildCommand: "npm run vercel-build",
      git: { deploymentEnabled: { "*": false, "**": false, main: true } },
    };
    writeFileSync(
      join(root, "vercel.json"),
      `${JSON.stringify(sourceConfig, null, 2)}\n`,
    );
    const digest = computeUaisStagingCandidateContentSha(root, [
      "vercel.json",
    ]);
    writeFileSync(
      join(root, "vercel.json"),
      `${JSON.stringify({
        ...sourceConfig,
        name: "uais-staging",
        version: 2,
      })}\n`,
    );
    const env = {
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
      VERCEL_GIT_COMMIT_SHA: candidateGitSha,
      P2_CANDIDATE_GIT_SHA: candidateGitSha,
      P2_CANDIDATE_CONTENT_SHA: digest,
      UAIS_DEPLOYMENT_ENV: "staging",
      UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
      UAIS_STAGING_INP_RUM_ENABLED: "no",
    };

    expect(
      resolveUaisStagingBuildContentSha({
        root,
        env,
        entries: ["vercel.json"],
      }),
    ).toBe(digest);

    writeFileSync(
      join(root, "vercel.json"),
      `${JSON.stringify({
        ...sourceConfig,
        name: "uais-staging",
        version: 3,
      })}\n`,
    );
    expect(() =>
      resolveUaisStagingBuildContentSha({
        root,
        env,
        entries: ["vercel.json"],
      }),
    ).toThrow(/does not match deployable source/);
  });

  it("rejects symlinks instead of hashing only a target pathname", () => {
    const root = mkdtempSync(join(tmpdir(), "uais-staging-content-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "outside.ts"), "export const secret = 1;\n");
    symlinkSync(join(root, "outside.ts"), join(root, "src", "linked.ts"));

    expect(() => computeUaisStagingCandidateContentSha(root, ["src"])).toThrow(
      /rejects symlinks/,
    );
  });
});
