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
    expect(summary.counts["active-production"]).toBeLessThanOrEqual(21);
    expect(summary.activeProductionNames).toEqual(
      expect.arrayContaining([
        "UAIS_APP_SESSION_SIGNING_SECRET",
        "UAIS_APP_AUTH_PROVIDER",
        "UAIS_CORE_DATABASE_URL",
        "UAIS_LANGGRAPH_PERSISTENCE_BACKEND",
        "UAIS_LRS_ENDPOINT",
        "SENTRY_DSN",
        "NEXT_PUBLIC_SENTRY_DSN",
        "UAIS_UPTIME_CHECK_URL",
      ]),
    );
    expect(summary.optionalLiveAiNames).toEqual(
      expect.arrayContaining(["DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY"]),
    );
    expect(summary.quarantinedLegacyNames).toEqual(
      expect.arrayContaining([
        "UAIS_TEACHER_AUTH_PROVIDER",
        "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
        "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
      ]),
    );
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
