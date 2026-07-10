export type UaisSentryRuntime = "client" | "edge" | "server";

export type UaisSentryInitOptions = {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRate: number;
  sendDefaultPii: false;
  enableLogs: boolean;
};

export type UaisObservabilityReadiness = {
  target: "uais-observability";
  status: "ready" | "blocked";
  checks: Array<{
    id: string;
    status: "present" | "missing";
    owner: "S19" | "S22";
  }>;
  redaction: {
    valuesRedacted: true;
    dsnValuesOmitted: true;
    tokensOmitted: true;
    urlsOmitted: true;
  };
};

export function createUaisSentryInitOptions(
  env: Record<string, string | undefined>,
  runtime: UaisSentryRuntime,
): UaisSentryInitOptions | undefined {
  const dsn = readSentryDsn(env, runtime);
  if (!dsn) {
    return undefined;
  }

  const release = readNonEmpty(env.SENTRY_RELEASE) ?? readNonEmpty(env.VERCEL_GIT_COMMIT_SHA);

  return {
    dsn,
    environment:
      readNonEmpty(env.SENTRY_ENVIRONMENT) ??
      readNonEmpty(env.VERCEL_ENV) ??
      readNonEmpty(env.NODE_ENV) ??
      "development",
    ...(release ? { release } : {}),
    tracesSampleRate: readSampleRate(env.SENTRY_TRACES_SAMPLE_RATE, 0.1),
    sendDefaultPii: false,
    enableLogs: readBoolean(env.SENTRY_ENABLE_LOGS),
  };
}

export function getUaisObservabilityReadiness(
  env: Record<string, string | undefined>,
): UaisObservabilityReadiness {
  const checks: UaisObservabilityReadiness["checks"] = [
    {
      id: "sentry-server-dsn",
      status: readNonEmpty(env.SENTRY_DSN) ? "present" : "missing",
      owner: "S19",
    },
    {
      id: "sentry-client-dsn",
      status: readNonEmpty(env.NEXT_PUBLIC_SENTRY_DSN) ? "present" : "missing",
      owner: "S19",
    },
    {
      id: "sentry-project-binding",
      status:
        readNonEmpty(env.SENTRY_ORG) && readNonEmpty(env.SENTRY_PROJECT)
          ? "present"
          : "missing",
      owner: "S22",
    },
    {
      id: "sentry-source-map-token",
      status: readNonEmpty(env.SENTRY_AUTH_TOKEN) ? "present" : "missing",
      owner: "S19",
    },
    {
      id: "external-uptime-url",
      status: readNonEmpty(env.UAIS_UPTIME_CHECK_URL) ? "present" : "missing",
      owner: "S22",
    },
  ];

  return {
    target: "uais-observability",
    status: checks.every((check) => check.status === "present") ? "ready" : "blocked",
    checks,
    redaction: {
      valuesRedacted: true,
      dsnValuesOmitted: true,
      tokensOmitted: true,
      urlsOmitted: true,
    },
  };
}

function readSentryDsn(env: Record<string, string | undefined>, runtime: UaisSentryRuntime) {
  if (runtime === "client") {
    return readNonEmpty(env.NEXT_PUBLIC_SENTRY_DSN);
  }
  return readNonEmpty(env.SENTRY_DSN) ?? readNonEmpty(env.NEXT_PUBLIC_SENTRY_DSN);
}

function readSampleRate(value: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

function readBoolean(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function readNonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
