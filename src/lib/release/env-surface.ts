export type UaisEnvSurfaceTier =
  | "active-production"
  | "optional-live-ai"
  | "quarantined-legacy";

export type UaisEnvSurfaceEntry = {
  name: string;
  tier: UaisEnvSurfaceTier;
  owner: "S19" | "S19/S12" | "S19/S22" | "S07/S19" | "S10/S22";
  valueKind:
    | "auth-provider"
    | "base-url"
    | "dsn"
    | "identifier"
    | "model"
    | "mode"
    | "secret"
    | "storage-backend"
    | "storage-path"
    | "version";
  serverOnly: boolean;
  productionDefault: "required" | "optional" | "blocked-until-approved" | "quarantined";
  purpose: string;
};

export type UaisEnvSurfaceSummary = {
  target: "uais-env-surface";
  status: "reviewable";
  activeProductionNames: string[];
  optionalLiveAiNames: string[];
  quarantinedLegacyNames: string[];
  counts: Record<UaisEnvSurfaceTier, number>;
  safety: {
    valuesRedacted: true;
    realEnvFilesNotInspected: true;
    quarantinedNamesNotRequiredForCorePoc: true;
    nextPublicSecretsForbidden: true;
  };
};

export const uaisEnvSurfaceCatalog = [
  {
    name: "UAIS_APP_SESSION_SIGNING_SECRET",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "required",
    purpose: "Signs the core UAIS app session cookie.",
  },
  {
    name: "UAIS_APP_AUTH_PROVIDER",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "auth-provider",
    serverOnly: true,
    productionDefault: "required",
    purpose: "Selects the production app auth provider mode.",
  },
  {
    name: "UAIS_APP_AUTH_PROVIDER_URL",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "base-url",
    serverOnly: true,
    productionDefault: "required",
    purpose: "Points the core app auth provider integration at its server endpoint.",
  },
  {
    name: "UAIS_APP_AUTH_PROVIDER_TOKEN",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "required",
    purpose: "Authenticates server-side calls to the core app auth provider.",
  },
  {
    name: "UAIS_CORE_DATABASE_URL",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "required",
    purpose: "Managed Postgres connection URL for the core UAIS database adapter.",
  },
  {
    name: "UAIS_LANGGRAPH_PERSISTENCE_BACKEND",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "storage-backend",
    serverOnly: true,
    productionDefault: "required",
    purpose: "Selects managed Postgres persistence for production LangGraph checkpoints and store.",
  },
  {
    name: "UAIS_LRS_ENDPOINT",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "base-url",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Learning Record Store endpoint for approved xAPI write/read checks.",
  },
  {
    name: "UAIS_LRS_USERNAME",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "identifier",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Learning Record Store username, stored only server-side.",
  },
  {
    name: "UAIS_LRS_PASSWORD",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Learning Record Store password, stored only server-side.",
  },
  {
    name: "UAIS_LRS_XAPI_VERSION",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "version",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "xAPI version override; defaults to 1.0.3 when omitted.",
  },
  {
    name: "SENTRY_DSN",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "dsn",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Server-side Sentry DSN for deployed observability.",
  },
  {
    name: "NEXT_PUBLIC_SENTRY_DSN",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "dsn",
    serverOnly: false,
    productionDefault: "optional",
    purpose: "Browser-readable Sentry DSN; it must not contain a secret token.",
  },
  {
    name: "SENTRY_ORG",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "identifier",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Sentry organization for release upload.",
  },
  {
    name: "SENTRY_PROJECT",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "identifier",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Sentry project for release upload.",
  },
  {
    name: "SENTRY_AUTH_TOKEN",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Sentry release-upload token, never included in reports.",
  },
  {
    name: "SENTRY_ENVIRONMENT",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "identifier",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Sentry environment label for preview, staging, or production.",
  },
  {
    name: "SENTRY_RELEASE",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "identifier",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Release id used for Sentry event grouping.",
  },
  {
    name: "SENTRY_TRACES_SAMPLE_RATE",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "mode",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Sentry tracing sample rate.",
  },
  {
    name: "SENTRY_ENABLE_LOGS",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "mode",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Optional Sentry logs toggle.",
  },
  {
    name: "UAIS_UPTIME_CHECK_URL",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "base-url",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "External uptime target for /healthz.",
  },
  {
    name: "UAIS_UPTIME_PROVIDER",
    tier: "active-production",
    owner: "S19/S22",
    valueKind: "identifier",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "External uptime provider name for redacted evidence.",
  },
  {
    name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "blocked-until-approved",
    purpose: "Owner approval token for live AI smoke checks.",
  },
  {
    name: "UAIS_AI_ACCESS_SIGNING_SECRET",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "blocked-until-approved",
    purpose: "Signs scoped AI access sessions when live AI routes are approved.",
  },
  {
    name: "DEEPSEEK_API_KEY",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "blocked-until-approved",
    purpose: "DeepSeek key for approved server-side text reasoning.",
  },
  {
    name: "DEEPSEEK_BASE_URL",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "base-url",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "DeepSeek-compatible base URL.",
  },
  {
    name: "DEEPSEEK_MODEL",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "model",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "DeepSeek text model override.",
  },
  {
    name: "DASHSCOPE_API_KEY",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "blocked-until-approved",
    purpose: "DashScope/Qwen key for approved multimodal, image, and voice work.",
  },
  {
    name: "DASHSCOPE_BASE_URL",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "base-url",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "DashScope-compatible base URL.",
  },
  {
    name: "QWEN_MULTIMODAL_MODEL",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "model",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Qwen multimodal model override.",
  },
  {
    name: "QWEN_IMAGE_MODEL",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "model",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Qwen image model override.",
  },
  {
    name: "QWEN_TTS_MODEL",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "model",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Qwen text-to-speech or voice model override.",
  },
  ...createQuarantinedLegacyEntries([
    "UAIS_TEACHER_AUTH_PROVIDER",
    "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    "UAIS_TEACHER_AUTH_OIDC_ISSUER",
    "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
    "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
    "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
    "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    "UAIS_TEACHER_AI_OWNERSHIP_DIR",
    "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
    "UAIS_TEACHING_OPERATIONS_BACKEND",
    "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
    "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
    "UAIS_EXTERNAL_STORAGE_BASE_URL",
    "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
    "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
    "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
    "UAIS_EXTERNAL_STORAGE_DATA_DIR",
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
    "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
    "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
    "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
    "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
    "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
    "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
    "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
    "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
    "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
    "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
    "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
    "UAIS_GRADEBOOK_RELEASE_PROVIDER",
    "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
    "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
    "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
    "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
    "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
    "UAIS_COURSE_EXPORT_PROVIDER",
    "UAIS_COURSE_EXPORT_PROVIDER_URL",
    "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
    "UAIS_GRADING_FEEDBACK_PROVIDER",
    "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
    "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
  ]),
] as const satisfies readonly UaisEnvSurfaceEntry[];

export function getUaisEnvSurfaceCatalog() {
  return [...uaisEnvSurfaceCatalog];
}

export function classifyUaisEnvName(name: string) {
  return uaisEnvSurfaceCatalog.find((entry) => entry.name === name) ?? null;
}

export function summarizeUaisEnvSurface(): UaisEnvSurfaceSummary {
  const activeProductionNames = readNamesForTier("active-production");
  const optionalLiveAiNames = readNamesForTier("optional-live-ai");
  const quarantinedLegacyNames = readNamesForTier("quarantined-legacy");

  return {
    target: "uais-env-surface",
    status: "reviewable",
    activeProductionNames,
    optionalLiveAiNames,
    quarantinedLegacyNames,
    counts: {
      "active-production": activeProductionNames.length,
      "optional-live-ai": optionalLiveAiNames.length,
      "quarantined-legacy": quarantinedLegacyNames.length,
    },
    safety: {
      valuesRedacted: true,
      realEnvFilesNotInspected: true,
      quarantinedNamesNotRequiredForCorePoc: true,
      nextPublicSecretsForbidden: true,
    },
  };
}

function readNamesForTier(tier: UaisEnvSurfaceTier) {
  return uaisEnvSurfaceCatalog
    .filter((entry) => entry.tier === tier)
    .map((entry) => entry.name)
    .sort();
}

function createQuarantinedLegacyEntries(names: string[]): UaisEnvSurfaceEntry[] {
  return names.map((name) => ({
    name,
    tier: "quarantined-legacy",
    owner: readLegacyOwner(name),
    valueKind: readLegacyValueKind(name),
    serverOnly: true,
    productionDefault: "quarantined",
    purpose: "Retained for historical release gates or future enterprise modules; not required for the core POC production surface.",
  }));
}

function readLegacyOwner(name: string): UaisEnvSurfaceEntry["owner"] {
  if (name.includes("TEACHER_AUTH")) return "S19/S12";
  if (name.includes("EXTERNAL_STORAGE") || name.includes("TEACHING_")) return "S19/S22";
  return "S10/S22";
}

function readLegacyValueKind(name: string): UaisEnvSurfaceEntry["valueKind"] {
  if (/(TOKEN|SECRET|PASSWORD)/.test(name)) return "secret";
  if (name.endsWith("_URL") || name.endsWith("_ISSUER") || name.endsWith("_JWKS_URL")) {
    return "base-url";
  }
  if (name.endsWith("_DIR")) return "storage-path";
  if (name.includes("BACKEND")) return "storage-backend";
  if (name.includes("PROVIDER")) return "auth-provider";
  return "identifier";
}
