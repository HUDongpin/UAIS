import { timingSafeEqual } from "node:crypto";
import { getUaisStagingInpCleanupGuard } from "@/lib/server/uais-staging-inp-runtime";
import { createUaisStagingInpPostgresStore } from "@/lib/server/uais-staging-inp-store";

type ExpiryPurgeDependencies = {
  env?: Record<string, string | undefined>;
  purgeExpired?: () => Promise<{
    deletedCount: number;
    remainingExpiredCount: number;
    zeroResidue: boolean;
    valuesRedacted: true;
  }>;
};

export function createStagingInpExpiryPurgeHandler(
  dependencies: ExpiryPurgeDependencies = {},
) {
  const env = dependencies.env ?? process.env;
  return async function get(request: Request) {
    const cronSecret = env.CRON_SECRET?.trim() ?? "";
    if (!getUaisStagingInpCleanupGuard(env).enabled || cronSecret.length < 32) {
      return response(404, "not-found");
    }
    if (!hasExactBearerSecret(request, cronSecret)) {
      return response(401, "unauthorized");
    }
    try {
      const purgeExpired =
        dependencies.purgeExpired ??
        createUaisStagingInpPostgresStore({ env }).purgeExpired;
      const receipt = await purgeExpired();
      return Response.json(
        {
          target: "uais-staging-inp-expiry-purge",
          status: receipt.zeroResidue ? "PASS" : "FAIL",
          deletedCount: receipt.deletedCount,
          remainingExpiredCount: receipt.remainingExpiredCount,
          zeroResidue: receipt.zeroResidue,
          valuesRedacted: true,
        },
        {
          status: receipt.zeroResidue ? 200 : 503,
          headers: noStoreHeaders,
        },
      );
    } catch {
      return response(503, "temporarily-unavailable");
    }
  };
}

function hasExactBearerSecret(request: Request, expected: string) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
  );
}

const noStoreHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function response(status: number, responseStatus: string) {
  return Response.json(
    {
      target: "uais-staging-inp-expiry-purge",
      status: responseStatus,
      valuesRedacted: true,
    },
    { status, headers: noStoreHeaders },
  );
}
