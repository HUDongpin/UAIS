import { createHmac, timingSafeEqual } from "node:crypto";
import { parseOperatorAccountHashes } from "@/lib/observability/uais-staging-inp";

const operatorDigestDomain = "uais-staging-inp-operator:v1";

export function createUaisStagingInpOperatorAccountHash(
  account: string,
  secret: string,
) {
  if (!account.trim() || secret.trim().length < 32) return null;
  return createHmac("sha256", secret)
    .update(`${operatorDigestDomain}:${account}`)
    .digest("hex");
}

export function isApprovedUaisStagingInpOperator(
  account: string,
  env: Record<string, string | undefined>,
) {
  const secret = env.UAIS_STAGING_INP_HMAC_SECRET?.trim() ?? "";
  const digest = createUaisStagingInpOperatorAccountHash(account, secret);
  if (!digest) return false;
  const candidate = Buffer.from(digest, "hex");
  return parseOperatorAccountHashes(
    env.UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES,
  ).some((approved) => timingSafeEqual(candidate, Buffer.from(approved, "hex")));
}
