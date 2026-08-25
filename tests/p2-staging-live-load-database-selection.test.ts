import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getUaisCoreDatabaseReadiness } from "@/lib/db/core-database";
import { UAIS_STAGING_INP_PROJECT_ID } from "@/lib/observability/uais-staging-inp";

const source = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");
const isolatedDatabaseUrl =
  "postgresql://isolated-user:redacted@example.test/uais-staging";

describe("P2 staging live-load database selection", () => {
  it("routes fixture repositories through the isolated staging database selector", () => {
    expect(source).toContain(
      "UAIS_P2_STAGING_DATABASE_URL: sourceDatabaseUrl",
    );
    expect(source).toContain('UAIS_CORE_DATABASE_URL: ""');
    expect(source).not.toContain(
      "UAIS_CORE_DATABASE_URL: sourceDatabaseUrl",
    );
  });

  it("keeps the exact staging runtime ready only with the dedicated selector", () => {
    const exactStagingEnv = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: UAIS_STAGING_INP_PROJECT_ID,
      UAIS_DEPLOYMENT_ENV: "staging",
      UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
      NEON_PROJECT_ID: "isolated-staging-project",
      UAIS_P2_STAGING_DATABASE_URL: isolatedDatabaseUrl,
      UAIS_CORE_DATABASE_URL: "",
      DATABASE_URL: "",
      POSTGRES_URL: "",
    };

    expect(getUaisCoreDatabaseReadiness(exactStagingEnv)).toMatchObject({
      status: "ready",
      selectedEnvName: "UAIS_P2_STAGING_DATABASE_URL",
    });
    expect(
      getUaisCoreDatabaseReadiness({
        ...exactStagingEnv,
        UAIS_CORE_DATABASE_URL: isolatedDatabaseUrl,
      }),
    ).toMatchObject({
      status: "blocked",
      blockedReason: "missing-managed-postgres-url",
    });
  });
});
