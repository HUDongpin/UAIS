import { createHash } from "node:crypto";
import {
  UAIS_STAGING_INP_PROJECT_ID,
  isUaisStagingInpImmutableDeploymentHost,
} from "@/lib/observability/uais-staging-inp";
import { UAIS_COMPILED_STAGING_CONTENT_SHA } from "@/lib/server/uais-staging-inp-build-identity";

const gitShaPattern = /^[0-9a-f]{40}$/;
const contentShaPattern = /^[0-9a-f]{64}$/;

export type UaisStagingDeploymentBinding = {
  status: "bound";
  lane: "isolated-staging";
  project: "uais-staging";
  stagingInpRum: "enabled" | "disabled";
  candidateGitSha: string;
  candidateContentSha: string;
  deploymentHostFingerprint: string;
  valuesRedacted: true;
};

export function getUaisStagingDeploymentBinding(
  env: Record<string, string | undefined>,
  compiledContentSha = UAIS_COMPILED_STAGING_CONTENT_SHA,
): UaisStagingDeploymentBinding | null {
  const candidateGitSha = env.P2_CANDIDATE_GIT_SHA ?? "";
  const candidateContentSha = env.P2_CANDIDATE_CONTENT_SHA ?? "";
  const deploymentHost = env.VERCEL_URL ?? "";
  const stagingInpRumMode = env.UAIS_STAGING_INP_RUM_ENABLED ?? "";
  if (
    env.VERCEL_ENV !== "production" ||
    env.VERCEL_PROJECT_ID !== UAIS_STAGING_INP_PROJECT_ID ||
    env.UAIS_DEPLOYMENT_ENV !== "staging" ||
    env.UAIS_LEARNING_CHATROOM_GROUPS_MODE !== "on" ||
    (stagingInpRumMode !== "yes" && stagingInpRumMode !== "no") ||
    !isUaisStagingInpImmutableDeploymentHost(deploymentHost) ||
    !gitShaPattern.test(candidateGitSha) ||
    !gitShaPattern.test(env.VERCEL_GIT_COMMIT_SHA ?? "") ||
    candidateGitSha !== env.VERCEL_GIT_COMMIT_SHA ||
    !contentShaPattern.test(candidateContentSha) ||
    !contentShaPattern.test(compiledContentSha) ||
    candidateContentSha !== compiledContentSha
  ) {
    return null;
  }

  return {
    status: "bound",
    lane: "isolated-staging",
    project: "uais-staging",
    stagingInpRum: stagingInpRumMode === "yes" ? "enabled" : "disabled",
    candidateGitSha,
    candidateContentSha,
    deploymentHostFingerprint: createHash("sha256")
      .update(`uais-staging-deployment-host:v1\u0000${deploymentHost}`)
      .digest("hex"),
    valuesRedacted: true,
  };
}
