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
    | "limit"
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
    purpose:
      "Signs the core UAIS app session cookie. At least 32 characters: a deployed runtime refuses a shorter value and mints no session, the same floor the teacher session secret enforces.",
  },
  {
    name: "UAIS_APP_AUTH_PROVIDER",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "auth-provider",
    serverOnly: true,
    productionDefault: "required",
    purpose:
      "Selects the production app auth provider mode. `database-accounts` is the launch selector: it authenticates against the uais_users rows on the core database and needs no second service. `trusted-account-provider` remains a supported future option, and `local-demo` - the value an unset variable falls back to - is refused in a production runtime.",
  },
  // Conditional, not required, and cataloged the same way the external-storage
  // endpoint pair below is: the launch selector does not read either of them.
  // They were marked `required`, which made the production surface look like it
  // needed an external account service that has never been deployed anywhere,
  // while the selector that does work needs nothing but the database URL.
  {
    name: "UAIS_APP_AUTH_PROVIDER_URL",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "base-url",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Points the core app auth provider integration at its server endpoint. Required ONLY when UAIS_APP_AUTH_PROVIDER is `trusted-account-provider`; the launch `database-accounts` selector reads neither this nor its token.",
  },
  {
    name: "UAIS_APP_AUTH_PROVIDER_TOKEN",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Authenticates server-side calls to the core app auth provider, at least 32 characters. Required ONLY when UAIS_APP_AUTH_PROVIDER is `trusted-account-provider`; the launch `database-accounts` selector reads neither this nor its endpoint.",
  },
  // Cataloged because it was not, and because it is the one name in this file
  // that can put published credentials on the live site. `local-demo` is the
  // fallback for an unset UAIS_APP_AUTH_PROVIDER, so a production runtime that
  // never set the selector is one variable away from serving logins from the two
  // demo accounts in src/lib/server/uais-app-auth-provider.ts. The provider
  // contract blocks that by default; this flag is the only thing that unblocks
  // it, and a deployment that reaches for it wants `database-accounts` instead.
  {
    name: "UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "mode",
    serverOnly: true,
    productionDefault: "blocked-until-approved",
    purpose:
      "Escape hatch that lets the `local-demo` provider mint sessions in a production runtime. It MUST be unset in production: setting it makes the repo's public demo accounts real logins on the deployed site. Read by resolveUaisAppAuthProviderContract in src/lib/server/uais-app-auth-provider.ts.",
  },
  // Promoted out of quarantine. Both names were carried in the legacy block as
  // "not required for the core POC production surface", which was true only
  // while every production-capable teacher provider needed an external service.
  // `database-account-cookie` needs none, so the teacher surface is now
  // launch-required rather than deferred: quarantined here meant a deployed
  // teacher could read the course list and then 401 on every write, which is
  // exactly what www.uais.top served. The remaining
  // UAIS_TEACHER_AUTH_ISSUER_SECRET / _OIDC_* names stay quarantined - they
  // belong to the two provider kinds that still need a service to exist.
  {
    name: "UAIS_TEACHER_AUTH_PROVIDER",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "auth-provider",
    serverOnly: true,
    productionDefault: "required",
    purpose:
      "Selects the teacher session provider. `database-account-cookie` is the launch selector: it mints a teacher cookie at login for an account the app auth provider already verified as role=teacher in uais_users, and needs no issuer URL and no second secret. `trusted-cookie-issuer` and `oidc-jwks` remain supported future options; `local-signed-cookie` is refused in production, and an unset value blocks the teacher surface outright.",
  },
  {
    name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "required",
    purpose:
      "Signs the teacher session cookie, at least 32 characters, with no development fallback because a committed constant would be a published forgery key for teacher writes. It is the ONLY secret the `database-account-cookie` selector needs; without it every teacher write - create course, invite codes, approvals, groups - answers 401 in production.",
  },
  {
    name: "UAIS_CORE_DATABASE_URL",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "required",
    purpose:
      "Managed Postgres connection URL for the core UAIS database adapter. Also required in the BUILD environment: `npm run vercel-build` applies migrations 0001-0007 from there, and a build without it ships an application whose database was never migrated.",
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
    name: "UAIS_LEARNING_RECORD_OUTBOX_SECRET",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "required",
    purpose:
      "Protects the server-only learning-record outbox dispatch endpoint. It must contain at least 32 characters and is never exposed to browsers, xAPI statements, logs, or evidence reports.",
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
    name: "UAIS_LEARNING_CHATROOM_RATE_LIMIT_MODE",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "mode",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Set to off to disable the learning chatroom per-actor spend guard; enforce by default.",
  },
  {
    name: "UAIS_LEARNING_CHATROOM_RATE_LIMIT_PER_MINUTE",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "limit",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Per-actor learning chatroom rounds allowed per minute; defaults to 6.",
  },
  {
    name: "UAIS_LEARNING_CHATROOM_RATE_LIMIT_PER_DAY",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "limit",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Per-actor learning chatroom rounds allowed per day; defaults to 120.",
  },
  // Group learning chatroom rollout (2026-08-08 group implementation plan,
  // D6/D9). The flag and history-read guard are read by
  // src/app/api/learning/chatroom/route.ts as of 2026-08-08 (Phases 0/2).
  {
    name: "UAIS_LEARNING_CHATROOM_GROUPS_MODE",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "mode",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Group learning chatroom feature flag; group rooms stay off unless it is set on.",
  },
  {
    name: "UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_MODE",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "mode",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Switch for the learning chatroom history-read guard; set to off to disable it, enforce by default.",
  },
  {
    name: "UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_MINUTE",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "limit",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Per-actor learning chatroom history reads allowed per minute; defaults to 30.",
  },
  {
    name: "UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_DAY",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "limit",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Per-actor learning chatroom history reads allowed per day; defaults to 2000.",
  },
  {
    name: "UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR",
    tier: "optional-live-ai",
    owner: "S19/S12",
    valueKind: "storage-path",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Directory of published lesson deck manifests; defaults to the repo-tracked data/learning-ppt-playback.",
  },
  {
    name: "UAIS_LEARNING_AI_GUIDE_RATE_LIMIT_MODE",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "mode",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Switch for the learning ask-box spend guard; set to off to disable it, enforce by default.",
  },
  {
    name: "UAIS_LEARNING_AI_GUIDE_RATE_LIMIT_PER_MINUTE",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "limit",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Per-actor learning ask-box AI requests allowed per minute; defaults to 30.",
  },
  {
    name: "UAIS_LEARNING_AI_GUIDE_RATE_LIMIT_PER_DAY",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "limit",
    serverOnly: true,
    productionDefault: "optional",
    purpose: "Per-actor learning ask-box AI requests allowed per day; defaults to 600.",
  },
  {
    name: "UAIS_LEARNING_FEEDBACK_AI_ENABLED",
    tier: "optional-live-ai",
    owner: "S07/S19",
    valueKind: "mode",
    serverOnly: true,
    productionDefault: "blocked-until-approved",
    purpose:
      "Exact true opt-in for teacher-requested P1 feedback drafts after owner approval; false or unset keeps the manual feedback path only.",
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
  // Local JSON persistence paths. They are quarantined rather than active
  // because every production runtime path asserts external storage and answers
  // 503 for local JSON persistence, so these only take effect in development,
  // tests, and non-production lanes. They carry explicit purposes instead of the
  // shared legacy string below because they are still read by current code.
  {
    name: "UAIS_TEACHING_COURSES_DATA_DIR",
    tier: "quarantined-legacy",
    owner: "S19/S12",
    valueKind: "storage-path",
    serverOnly: true,
    productionDefault: "quarantined",
    purpose:
      "Local JSON data directory for teaching course management outside production; defaults to .tmp/uais-teaching-course-management-db.",
  },
  {
    name: "UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR",
    tier: "quarantined-legacy",
    owner: "S19/S12",
    valueKind: "storage-path",
    serverOnly: true,
    productionDefault: "quarantined",
    purpose:
      "Optional split directory for local learning chatroom transcripts; falls back to UAIS_TEACHING_COURSES_DATA_DIR, then to .tmp/uais-learning-chatroom-transcripts-db.",
  },
  {
    name: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "storage-backend",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Selects the durable store for courses, chatroom transcripts and share links. Optional because a production runtime with UAIS_CORE_DATABASE_URL already defaults to Postgres; set it to `external` only to choose the external-storage service instead.",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "base-url",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "HTTPS base URL of the external storage service. Required ONLY when the backend selector is `external`; the default Postgres path needs no endpoint.",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "secret",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Bearer token for the external storage service, at least 32 characters. Required ONLY when the backend selector is `external`; it travels on every storage call, which is why that endpoint must be HTTPS.",
  },
  // The sibling of the quarantined UAIS_TEACHING_OPERATIONS_BACKEND below, and
  // a different variable despite the near-identical name. This one is read by
  // live code - src/lib/server/teaching-operations-store.ts and
  // teaching-operations-postgres-store.ts - and was missing from this catalog
  // entirely, so the only teaching-operations name an operator could find here
  // was the one that does NOT move the data.
  {
    name: "UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND",
    tier: "active-production",
    owner: "S19/S12",
    valueKind: "storage-backend",
    serverOnly: true,
    productionDefault: "optional",
    purpose:
      "Phase 1 cutover switch for teaching-operations snapshots: `postgres` or `managed` routes operational reads/writes to the core database, and unset keeps the JSON file path byte-identical. Deliberately separate from the external-append UAIS_TEACHING_OPERATIONS_BACKEND, which the external storage contract rejects under `postgres`.",
  },
  ...createQuarantinedLegacyEntries([
    "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    "UAIS_TEACHER_AUTH_OIDC_ISSUER",
    "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
    "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
    "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
    "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    "UAIS_TEACHER_AI_OWNERSHIP_DIR",
    "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
    // External-append selector only. The durable-storage switch for the same
    // entity is the active-production UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND
    // entry above.
    "UAIS_TEACHING_OPERATIONS_BACKEND",
    "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
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
