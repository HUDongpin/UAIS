import { createHash } from "node:crypto";
import {
  UAIS_PRODUCTION_NEON_PROJECT_ID,
  UAIS_PRODUCTION_PROJECT_ID,
  UAIS_STAGING_INP_MINIMUM_DISTINCT_OPERATORS,
  UAIS_STAGING_INP_PROJECT_ID,
  isUaisStagingInpCohortIdForCandidate,
  isUaisStagingInpImmutableDeploymentHost,
  parseOperatorAccountHashes,
  type UaisStagingInpBinding,
} from "@/lib/observability/uais-staging-inp";
import { UAIS_COMPILED_STAGING_CONTENT_SHA } from "@/lib/server/uais-staging-inp-build-identity";

const digestPattern = /^[0-9a-f]{64}$/;
const gitShaPattern = /^[0-9a-f]{40}$/;

export function getUaisStagingInpGuard(
  env: Record<string, string | undefined>,
  verifiedContentSha = UAIS_COMPILED_STAGING_CONTENT_SHA,
): { enabled: boolean; reasons: string[] } {
  const reasons = getUaisStagingInpCleanupGuard(env).reasons;
  if (env.UAIS_STAGING_INP_RUM_ENABLED !== "yes") {
    reasons.push("explicit-opt-in-missing");
  }
  if (env.UAIS_LEARNING_CHATROOM_GROUPS_MODE !== "on") {
    reasons.push("staging-groups-mode-required");
  }
  const neonProjectId = env.NEON_PROJECT_ID?.trim() ?? "";
  if (!neonProjectId) {
    reasons.push("staging-database-identity-missing");
  } else if (neonProjectId === UAIS_PRODUCTION_NEON_PROJECT_ID) {
    reasons.push("production-database-identity-rejected");
  }
  if (!gitShaPattern.test(env.P2_CANDIDATE_GIT_SHA ?? "")) {
    reasons.push("candidate-git-sha-invalid");
  } else if (env.P2_CANDIDATE_GIT_SHA !== env.VERCEL_GIT_COMMIT_SHA) {
    reasons.push("candidate-git-sha-mismatch");
  }
  if (!digestPattern.test(env.P2_CANDIDATE_CONTENT_SHA ?? "")) {
    reasons.push("candidate-content-sha-invalid");
  }
  if (!digestPattern.test(verifiedContentSha)) {
    reasons.push("verified-build-content-sha-missing");
  } else if (env.P2_CANDIDATE_CONTENT_SHA !== verifiedContentSha) {
    reasons.push("candidate-content-sha-mismatch");
  }
  if (
    !isUaisStagingInpCohortIdForCandidate(
      env.UAIS_STAGING_INP_COHORT_ID ?? "",
      env.P2_CANDIDATE_GIT_SHA ?? "",
    )
  ) {
    reasons.push("cohort-id-not-candidate-bound");
  }
  if ((env.UAIS_STAGING_INP_HMAC_SECRET?.trim().length ?? 0) < 32) {
    reasons.push("hmac-secret-missing-or-weak");
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(
    env.UAIS_STAGING_INP_HMAC_KEY_VERSION?.trim() ?? "",
  )) {
    reasons.push("hmac-key-version-missing-or-invalid");
  }
  if ((env.UAIS_APP_SESSION_SIGNING_SECRET?.trim().length ?? 0) < 32) {
    reasons.push("session-secret-missing-or-weak");
  }
  if (!hasStrictOperatorAccountHashList(env.UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES)) {
    reasons.push("approved-operator-allowlist-missing");
  }
  if ((env.CRON_SECRET?.trim().length ?? 0) < 32) {
    reasons.push("cron-secret-missing-or-weak");
  }
  if ((env.P2_VERCEL_PROTECTION_BYPASS_SECRET?.trim().length ?? 0) < 32) {
    reasons.push("protection-bypass-secret-missing-or-weak");
  }
  if (!hasDistinctStagingSecrets(env)) {
    reasons.push("staging-secret-reuse-rejected");
  }
  return { enabled: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function getUaisStagingInpCleanupGuard(
  env: Record<string, string | undefined>,
): { enabled: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (env.VERCEL_ENV !== "production") reasons.push("vercel-environment-mismatch");
  if (env.VERCEL_PROJECT_ID !== UAIS_STAGING_INP_PROJECT_ID) {
    reasons.push("isolated-staging-project-mismatch");
  }
  if (env.VERCEL_PROJECT_ID === UAIS_PRODUCTION_PROJECT_ID) {
    reasons.push("production-project-rejected");
  }
  if (env.UAIS_DEPLOYMENT_ENV !== "staging") {
    reasons.push("staging-deployment-marker-missing");
  }
  if (!env.UAIS_P2_STAGING_DATABASE_URL?.trim()) {
    reasons.push("staging-database-url-missing");
  }
  if (!gitShaPattern.test(env.VERCEL_GIT_COMMIT_SHA ?? "")) {
    reasons.push("deployment-git-sha-invalid");
  }
  if (!isUaisStagingInpImmutableDeploymentHost(env.VERCEL_URL ?? "")) {
    reasons.push("immutable-deployment-host-invalid");
  }
  return { enabled: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function getUaisStagingInpBinding(
  env: Record<string, string | undefined>,
  verifiedContentSha = UAIS_COMPILED_STAGING_CONTENT_SHA,
): UaisStagingInpBinding | null {
  if (!getUaisStagingInpGuard(env, verifiedContentSha).enabled) return null;
  return {
    cohortId: env.UAIS_STAGING_INP_COHORT_ID ?? "",
    candidateGitSha: env.P2_CANDIDATE_GIT_SHA ?? "",
    candidateContentSha: env.P2_CANDIDATE_CONTENT_SHA ?? "",
    deploymentHost: env.VERCEL_URL ?? "",
    collectorKeyVersion: env.UAIS_STAGING_INP_HMAC_KEY_VERSION?.trim() ?? "",
    operatorAllowlistFingerprint: createNonSecretFingerprint(
      "uais-staging-inp-operator-allowlist:v1",
      parseOperatorAccountHashes(
        env.UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES,
      )
        .sort()
        .join(","),
    ),
  };
}

function hasStrictOperatorAccountHashList(value: string | undefined) {
  if (!value) return false;
  const tokens = value.split(",").map((item) => item.trim().toLowerCase());
  return (
    tokens.length >= UAIS_STAGING_INP_MINIMUM_DISTINCT_OPERATORS &&
    tokens.length <= 20 &&
    tokens.every((item) => digestPattern.test(item)) &&
    new Set(tokens).size === tokens.length
  );
}

function createNonSecretFingerprint(domain: string, value: string) {
  return createHash("sha256")
    .update(`${domain}\u0000${value}`)
    .digest("hex");
}

function hasDistinctStagingSecrets(env: Record<string, string | undefined>) {
  const secrets = [
    env.UAIS_STAGING_INP_HMAC_SECRET,
    env.UAIS_APP_SESSION_SIGNING_SECRET,
    env.CRON_SECRET,
    env.P2_VERCEL_PROTECTION_BYPASS_SECRET,
  ]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
  return new Set(secrets).size === secrets.length;
}
