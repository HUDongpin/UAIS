import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createUaisSentryInitOptions,
  getUaisObservabilityReadiness,
} from "@/lib/observability/sentry-options";

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("B-05 observability readiness", () => {
  it("keeps Sentry disabled until a DSN is supplied and never enables default PII", () => {
    expect(createUaisSentryInitOptions({}, "server")).toBeUndefined();
    expect(createUaisSentryInitOptions({}, "client")).toBeUndefined();

    const options = createUaisSentryInitOptions(
      {
        SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
        SENTRY_ENVIRONMENT: "staging",
        SENTRY_RELEASE: "release-2026-07-08",
        SENTRY_TRACES_SAMPLE_RATE: "0.25",
        SENTRY_ENABLE_LOGS: "true",
      },
      "server",
    );

    expect(options).toEqual({
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "staging",
      release: "release-2026-07-08",
      tracesSampleRate: 0.25,
      sendDefaultPii: false,
      enableLogs: true,
    });
  });

  it("reports observability readiness without exposing DSNs, tokens, or URLs", () => {
    const readiness = getUaisObservabilityReadiness({
      SENTRY_DSN: "https://private-dsn.example/1",
      NEXT_PUBLIC_SENTRY_DSN: "https://public-dsn.example/2",
      SENTRY_ORG: "private-org",
      SENTRY_PROJECT: "private-project",
      SENTRY_AUTH_TOKEN: "secret-sentry-token",
      UAIS_UPTIME_CHECK_URL: "https://www.uais.top/healthz",
    });
    const serialized = JSON.stringify(readiness);

    expect(readiness.status).toBe("ready");
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sentry-server-dsn", status: "present" }),
        expect.objectContaining({ id: "sentry-client-dsn", status: "present" }),
        expect.objectContaining({ id: "sentry-project-binding", status: "present" }),
        expect.objectContaining({ id: "sentry-source-map-token", status: "present" }),
        expect.objectContaining({ id: "external-uptime-url", status: "present" }),
      ]),
    );
    expect(readiness.redaction).toEqual({
      valuesRedacted: true,
      dsnValuesOmitted: true,
      tokensOmitted: true,
      urlsOmitted: true,
    });
    expect(serialized).not.toContain("private-dsn");
    expect(serialized).not.toContain("public-dsn");
    expect(serialized).not.toContain("secret-sentry-token");
    expect(serialized).not.toContain("www.uais.top");
  });

  it("wires the Next.js Sentry files and operator docs with blank env placeholders", () => {
    const nextConfig = readProjectFile("next.config.ts");
    const instrumentation = readProjectFile("src/instrumentation.ts");
    const clientConfig = readProjectFile("src/instrumentation-client.ts");
    const serverConfig = readProjectFile("src/sentry.server.config.ts");
    const edgeConfig = readProjectFile("src/sentry.edge.config.ts");
    const envExample = readProjectFile(".env.local.example");
    const runbook = readProjectFile("docs/runbooks/observability.md");

    expect(nextConfig).toContain("withSentryConfig");
    expect(nextConfig).toContain("SENTRY_AUTH_TOKEN");
    expect(nextConfig).toContain("sourcemaps");
    expect(instrumentation).toContain("captureRequestError");
    expect(clientConfig).toContain("captureRouterTransitionStart");
    expect(serverConfig).toContain('"server"');
    expect(edgeConfig).toContain('"edge"');

    for (const envName of [
      "SENTRY_DSN=",
      "NEXT_PUBLIC_SENTRY_DSN=",
      "SENTRY_ORG=",
      "SENTRY_PROJECT=",
      "SENTRY_AUTH_TOKEN=",
      "UAIS_UPTIME_CHECK_URL=",
    ]) {
      expect(envExample).toContain(envName);
    }

    expect(runbook).toContain("sendDefaultPii");
    expect(runbook).toContain("false");
    expect(runbook).toContain("UAIS_UPTIME_CHECK_URL");
  });
});
