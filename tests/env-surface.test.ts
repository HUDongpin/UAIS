import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyUaisEnvName,
  getUaisEnvSurfaceCatalog,
  summarizeUaisEnvSurface,
} from "@/lib/release/env-surface";

function readExampleEnvNames() {
  return readFileSync(join(process.cwd(), ".env.local.example"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0])
    .filter((name): name is string => Boolean(name));
}

describe("B-21 environment surface", () => {
  it("classifies the production POC env surface separately from legacy/future names", () => {
    const summary = summarizeUaisEnvSurface();

    expect(summary).toMatchObject({
      target: "uais-env-surface",
      status: "reviewable",
      safety: {
        valuesRedacted: true,
        realEnvFilesNotInspected: true,
        quarantinedNamesNotRequiredForCorePoc: true,
        nextPublicSecretsForbidden: true,
      },
    });
    // The cap makes a promotion a deliberate act rather than a drift. It moved
    // 21 -> 24 when durable storage stopped being optional: group chatrooms
    // refuse local JSON in production, so the backend selector, the storage
    // endpoint and its token are required for a core production surface rather
    // than "retained for a future enterprise module". It moved 24 -> 28 for the
    // launch auth surface: the teacher provider and its signing secret (a
    // deployed teacher could read courses and 401 on every write while they sat
    // in quarantine), the demo-auth escape hatch that had no catalog entry at
    // all, and the teaching-operations snapshot selector that live code reads.
    expect(summary.counts["active-production"]).toBeLessThanOrEqual(29);
    expect(summary.activeProductionNames).toEqual(
      expect.arrayContaining([
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH",
        "UAIS_TEACHER_AUTH_PROVIDER",
        "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
        "UAIS_CORE_DATABASE_URL",
        "UAIS_LANGGRAPH_PERSISTENCE_BACKEND",
        "UAIS_LRS_ENDPOINT",
        "UAIS_LEARNING_RECORD_OUTBOX_SECRET",
        "SENTRY_DSN",
        "NEXT_PUBLIC_SENTRY_DSN",
        "UAIS_UPTIME_CHECK_URL",
        "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
        "UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND",
        "UAIS_EXTERNAL_STORAGE_BASE_URL",
        "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      ]),
    );
    expect(summary.optionalLiveAiNames).toEqual(
      expect.arrayContaining([
        "UAIS_LEARNING_FEEDBACK_AI_ENABLED",
        "DEEPSEEK_API_KEY",
        "DASHSCOPE_API_KEY",
      ]),
    );
    expect(summary.quarantinedLegacyNames).toEqual(
      expect.arrayContaining([
        // The provider kinds that still need a service nobody has deployed.
        "UAIS_TEACHER_AUTH_ISSUER_SECRET",
        "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
      ]),
    );
    // Not merely present in the active tier - gone from quarantine, so a reader
    // of the legacy block cannot conclude the teacher surface is deferrable.
    expect(summary.quarantinedLegacyNames).not.toContain("UAIS_TEACHER_AUTH_PROVIDER");
    expect(summary.quarantinedLegacyNames).not.toContain(
      "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    );
  });

  it("catalogs the server-only secret that protects durable outbox dispatch", () => {
    expect(classifyUaisEnvName("UAIS_LEARNING_RECORD_OUTBOX_SECRET")).toMatchObject({
      tier: "active-production",
      owner: "S19/S12",
      valueKind: "secret",
      serverOnly: true,
      productionDefault: "required",
    });
  });

  // The September launch configuration, name by name. The catalog described a
  // production surface that required an external account service which has never
  // been deployed, and said nothing about the selectors that actually ship.
  it("tiers the launch auth selectors and leaves the external-service pair conditional", () => {
    const appProvider = classifyUaisEnvName("UAIS_APP_AUTH_PROVIDER");
    const teacherProvider = classifyUaisEnvName("UAIS_TEACHER_AUTH_PROVIDER");
    const teacherSecret = classifyUaisEnvName("UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET");

    // Greppable: an operator searching the catalog for the selector they are
    // about to set must find the entry that documents it.
    expect(appProvider?.purpose).toContain("database-accounts");
    expect(appProvider?.productionDefault).toBe("required");
    expect(teacherProvider?.purpose).toContain("database-account-cookie");
    expect(teacherProvider?.productionDefault).toBe("required");
    expect(teacherSecret?.productionDefault).toBe("required");
    expect(teacherSecret?.valueKind).toBe("secret");
    // The legacy selectors stay documented as supported future options rather
    // than being deleted.
    expect(appProvider?.purpose).toContain("trusted-account-provider");
    expect(teacherProvider?.purpose).toContain("oidc-jwks");

    // Required only for `trusted-account-provider`, catalogued exactly like the
    // external-storage endpoint pair: `optional`, with the condition in the
    // purpose. Marking them `required` made a launch deployment look
    // misconfigured for lacking a service it never calls.
    for (const name of ["UAIS_APP_AUTH_PROVIDER_URL", "UAIS_APP_AUTH_PROVIDER_TOKEN"]) {
      const entry = classifyUaisEnvName(name);
      expect(entry?.tier).toBe("active-production");
      expect(entry?.productionDefault).toBe("optional");
      expect(entry?.purpose).toContain("Required ONLY when UAIS_APP_AUTH_PROVIDER is");
      expect(entry?.purpose).toContain("trusted-account-provider");
    }
  });

  it("catalogs the demo-auth escape hatch as something production must not set", () => {
    const demoAuth = classifyUaisEnvName("UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH");

    // It was absent from the catalog entirely while being the one variable that
    // can put the repo's public demo accounts on the live site.
    expect(demoAuth).toMatchObject({
      tier: "active-production",
      serverOnly: true,
      productionDefault: "blocked-until-approved",
    });
    expect(demoAuth?.purpose).toContain("MUST be unset in production");
    // No live value, only the name and the shape.
    expect(JSON.stringify(demoAuth)).not.toContain("12345");
  });

  it("catalogs the teaching-operations snapshot selector, not only its external-append sibling", () => {
    const snapshotBackend = classifyUaisEnvName("UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND");

    // Live code reads it (teaching-operations-store.ts,
    // teaching-operations-postgres-store.ts); only the near-identically named
    // UAIS_TEACHING_OPERATIONS_BACKEND was catalogued, and that one does not
    // move the data.
    expect(snapshotBackend).toMatchObject({
      tier: "active-production",
      valueKind: "storage-backend",
      productionDefault: "optional",
    });
    expect(snapshotBackend?.purpose).toContain("UAIS_TEACHING_OPERATIONS_BACKEND");
    expect(classifyUaisEnvName("UAIS_TEACHING_OPERATIONS_BACKEND")?.tier).toBe(
      "quarantined-legacy",
    );
  });

  it("quarantines every isolated-staging INP name from production", () => {
    for (const name of [
      "UAIS_DB_TEST_DATABASE_URL",
      "UAIS_P2_STAGING_DATABASE_URL",
      "UAIS_P2_STAGING_RESTORE_DATABASE_URL",
      "P2_VERCEL_PROTECTION_BYPASS_SECRET",
      "P2_CANDIDATE_GIT_SHA",
      "P2_CANDIDATE_CONTENT_SHA",
      "P2_IMMUTABLE_DEPLOYMENT_URL",
      "UAIS_DEPLOYMENT_ENV",
      "UAIS_DEPLOYMENT_BASE_URL",
      "UAIS_STAGING_INP_RUM_ENABLED",
      "UAIS_STAGING_INP_COHORT_ID",
      "UAIS_STAGING_INP_HMAC_SECRET",
      "UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES",
      "CRON_SECRET",
    ]) {
      const entry = classifyUaisEnvName(name);
      expect(entry, name).toMatchObject({
        tier: "quarantined-legacy",
        serverOnly: true,
        productionDefault: "quarantined",
      });
      expect(entry?.purpose, name).toContain("isolated staging");
      expect(entry?.purpose, name).toContain("unset in production");
    }
  });

  it("keeps all example env names documented in the B-21 catalog without requiring them for core production", () => {
    const catalogNames = new Set(getUaisEnvSurfaceCatalog().map((entry) => entry.name));

    expect(readExampleEnvNames().filter((name) => !catalogNames.has(name))).toEqual([]);
    expect(classifyUaisEnvName("UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER")?.tier).toBe(
      "quarantined-legacy",
    );
    expect(classifyUaisEnvName("UAIS_APP_SESSION_SIGNING_SECRET")?.tier).toBe(
      "active-production",
    );
  });

  it("does not mark browser-readable env names as secrets", () => {
    const catalog = getUaisEnvSurfaceCatalog();
    const browserReadable = catalog.filter((entry) => entry.name.startsWith("NEXT_PUBLIC_"));

    expect(browserReadable).toHaveLength(1);
    expect(browserReadable[0]).toMatchObject({
      name: "NEXT_PUBLIC_SENTRY_DSN",
      serverOnly: false,
      valueKind: "dsn",
    });
    expect(browserReadable.every((entry) => entry.valueKind !== "secret")).toBe(true);
  });

  it("links the env surface from operator docs and deployment checks", () => {
    const docs = readFileSync(join(process.cwd(), "docs/env-surface.md"), "utf8");
    const checklist = readFileSync(
      join(process.cwd(), "docs/runbooks/pre-deploy-checklist.md"),
      "utf8",
    );
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

    expect(docs).toContain("B-21");
    expect(docs).toContain("active-production");
    expect(docs).toContain("quarantined-legacy");
    expect(checklist).toContain("docs/env-surface.md");
    expect(readme).toContain("docs/env-surface.md");
  });
});
