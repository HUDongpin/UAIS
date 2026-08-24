import { describe, expect, it } from "vitest";
import {
  getUaisStagingDeploymentBinding,
  type UaisStagingDeploymentBinding,
} from "@/lib/server/uais-staging-deployment-binding";

const candidateGitSha = "a".repeat(40);
const candidateContentSha = "b".repeat(64);
const immutableStagingHost = "uais-staging-current-team.vercel.app";

function boundEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
    VERCEL_GIT_COMMIT_SHA: candidateGitSha,
    VERCEL_URL: immutableStagingHost,
    UAIS_DEPLOYMENT_ENV: "staging",
    UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
    UAIS_STAGING_INP_RUM_ENABLED: "no",
    P2_CANDIDATE_GIT_SHA: candidateGitSha,
    P2_CANDIDATE_CONTENT_SHA: candidateContentSha,
    ...overrides,
  };
}

describe("UAIS isolated staging live deployment binding", () => {
  it.each(["no", "yes"])(
    "returns a redacted same-SHA attestation with RUM=%s and no RUM credentials",
    (rumMode) => {
      const binding = getUaisStagingDeploymentBinding(
        boundEnv({ UAIS_STAGING_INP_RUM_ENABLED: rumMode }),
        candidateContentSha,
      );

      expect(binding).toEqual<UaisStagingDeploymentBinding>({
        status: "bound",
        lane: "isolated-staging",
        project: "uais-staging",
        stagingInpRum: rumMode === "yes" ? "enabled" : "disabled",
        candidateGitSha,
        candidateContentSha,
        deploymentHostFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        valuesRedacted: true,
      });
      expect(JSON.stringify(binding)).not.toContain(immutableStagingHost);
    },
  );

  it.each([
    ["a non-production Vercel target", { VERCEL_ENV: "preview" }, candidateContentSha],
    [
      "the UAIS production project",
      { VERCEL_PROJECT_ID: "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA" },
      candidateContentSha,
    ],
    ["an unknown project", { VERCEL_PROJECT_ID: "prj_unknown" }, candidateContentSha],
    ["a production app marker", { UAIS_DEPLOYMENT_ENV: "production" }, candidateContentSha],
    ["disabled group rooms", { UAIS_LEARNING_CHATROOM_GROUPS_MODE: "off" }, candidateContentSha],
    ["a missing RUM mode", { UAIS_STAGING_INP_RUM_ENABLED: undefined }, candidateContentSha],
    ["an unknown RUM mode", { UAIS_STAGING_INP_RUM_ENABLED: "on" }, candidateContentSha],
    ["a mutable alias", { VERCEL_URL: "staging.uais.top" }, candidateContentSha],
    ["a URL instead of an immutable host", { VERCEL_URL: `https://${immutableStagingHost}` }, candidateContentSha],
    ["an invalid candidate Git SHA", { P2_CANDIDATE_GIT_SHA: "main" }, candidateContentSha],
    ["an invalid deployed Git SHA", { VERCEL_GIT_COMMIT_SHA: "main" }, candidateContentSha],
    ["a different deployed Git SHA", { VERCEL_GIT_COMMIT_SHA: "c".repeat(40) }, candidateContentSha],
    ["an invalid candidate content SHA", { P2_CANDIDATE_CONTENT_SHA: "dirty" }, candidateContentSha],
    ["a missing compiled content SHA", {}, ""],
    ["a different compiled content SHA", {}, "d".repeat(64)],
  ] as const)("does not claim a binding for %s", (_label, override, compiledContentSha) => {
    expect(
      getUaisStagingDeploymentBinding(boundEnv(override), compiledContentSha),
    ).toBeNull();
  });

  it("does not emit full hosts, database configuration, provider settings or secrets", () => {
    const secret = "owner-only-secret-value-that-must-not-leak";
    const databaseUrl = "postgres://owner:password@staging-db.example.test/uais";
    const providerEndpoint = "https://provider-private.example.test/v1";
    const binding = getUaisStagingDeploymentBinding(
      boundEnv({
        UAIS_CORE_DATABASE_URL: databaseUrl,
        UAIS_STAGING_INP_HMAC_SECRET: secret,
        UAIS_PROVIDER_ENDPOINT: providerEndpoint,
      }),
      candidateContentSha,
    );
    const serialized = JSON.stringify(binding);

    expect(binding?.status).toBe("bound");
    expect(serialized).not.toContain(immutableStagingHost);
    expect(serialized).not.toContain(databaseUrl);
    expect(serialized).not.toContain(providerEndpoint);
    expect(serialized).not.toContain(secret);
  });
});
