import { createHash } from "node:crypto";
import type { UaisProviderRole } from "@/lib/ai/orchestration/types";
import {
  resolveUaisStorageBackendContract,
  type UaisStorageBackendBlockedReason,
  type UaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import {
  resolveUaisTeacherAuthProviderContract,
  type UaisTeacherAuthProviderBlockedReason,
  type UaisTeacherAuthProviderContract,
} from "@/lib/server/teacher-auth-provider-contract";
import {
  getRedactedProviderReadiness,
  listProviderRoleConfigs,
  type RedactedProviderReadiness,
  type UaisProviderId,
} from "@/lib/ai/providers/registry";

export type ProviderSmokePlanMode = "dry-run" | "live";

export type ProviderSmokePlanCheck = RedactedProviderReadiness & {
  roles: UaisProviderRole[];
  action: "verify-text-reasoning-contract" | "verify-multimodal-voice-ppt-contract";
};

export type ProviderSmokePlanRouteCheck = {
  id:
    | "s22-retention-readiness-route"
    | "s22-voice-lifecycle-audit-route"
    | "s22-ai-readiness-route"
    | "s22-ai-smoke-plan-route"
    | "s22-teacher-auth-issuer-route"
    | "s22-teacher-ai-session-route"
    | "s22-teacher-ownership-route"
    | "s22-teacher-ppt-workflow-route";
  route:
    | "/api/ai/voice-assets/retention-readiness"
    | "/api/ai/voice-clone/lifecycle-audit"
    | "/api/ai/readiness"
    | "/api/ai/smoke-plan"
    | "/api/ai/teacher-auth/issue"
    | "/api/ai/session"
    | "/api/ai/teacher-ownership"
    | "/api/ai/teacher-ppt-workflow";
  method: "GET" | "POST";
  action:
    | "verify-admin-retention-readiness-route"
    | "verify-admin-voice-lifecycle-audit-route"
    | "verify-admin-ai-readiness-route"
    | "verify-admin-ai-smoke-plan-route"
    | "verify-admin-teacher-auth-issuer-route"
    | "verify-oidc-teacher-auth-issuer-route"
    | "verify-issued-teacher-ai-session-route"
    | "verify-issued-teacher-ownership-route"
    | "verify-signed-teacher-ppt-workflow-route";
  auth: "signed-admin-ai-access" | "issued-teacher-auth-cookie" | "oidc-jwks-bearer-token";
  expectedStatus: 200;
  responsibleSessions: ["S22", "S12", "S24"] | ["S22", "S12", "S19"] | ["S22", "S12", "S24", "S19"];
  requestBodyShape?: "teacher-auth-session-issue" | "teacher-ai-session-issue";
  responseHeaderChecks?: [
    "teacherAuthClaimsSetCookie",
    "teacherAuthSignatureSetCookie",
    "httpOnlySameSiteSecureMaxAge",
    "priorityHigh",
    "issuerProofBoundedMaxAge",
  ];
  responseShapeChecks?: [
    (
      | "accessSession"
      | "accessPlan"
      | "authProviderContract"
      | "s12TeacherAiSessionBoundary"
      | "signedContractDirectCallDenied"
      | "ownership"
      | "consistency"
      | "s12TeacherOwnershipSummary"
      | "workflow"
      | "workflowReadyForDownloads"
      | "workflowDownloadContract"
      | "workflowAudioDownloadPattern"
      | "workflowExportDownloadUrl"
      | "agentHandoffPlan"
      | "agentHandoffPlanFramework"
      | "s22ReleaseSmokeAgent"
    ),
    ...(
      | "accessSession"
      | "accessPlan"
      | "authProviderContract"
      | "s12TeacherAiSessionBoundary"
      | "signedContractDirectCallDenied"
      | "ownership"
      | "consistency"
      | "s12TeacherOwnershipSummary"
      | "workflow"
      | "workflowReadyForDownloads"
      | "workflowDownloadContract"
      | "workflowAudioDownloadPattern"
      | "workflowExportDownloadUrl"
      | "agentHandoffPlan"
      | "agentHandoffPlanFramework"
      | "s22ReleaseSmokeAgent"
    )[],
  ];
};

export type ProviderSmokePlan = {
  mode: ProviderSmokePlanMode;
  network: "disabled" | "enabled";
  checks: ProviderSmokePlanCheck[];
  routeChecks: ProviderSmokePlanRouteCheck[];
  safety: {
    secretsRedacted: true;
    dryRunUsesNetwork: false;
    liveRequiresApproval: true;
  };
};

export type DeploymentEnvManifest = {
  target: "vercel";
  responsibleSession: "S19";
  entries: DeploymentEnvManifestEntry[];
  safety: {
    valuesRedacted: true;
    nextPublicForbidden: true;
    liveProviderApprovalRequired: true;
  };
};

export type DeploymentReadinessGate = {
  target: "vercel";
  status: "ready" | "blocked";
  responsibleSession: "S19";
  checks: DeploymentReadinessGateCheck[];
  blockedReasons: DeploymentReadinessBlockedReason[];
  safety: {
    valuesRedacted: true;
    serverOnlySecretsRequired: true;
    nextPublicSecretsForbidden: true;
  };
};

export type DeploymentRouteSmokeGate = {
  target: "deployment-route-smoke";
  status: "ready" | "blocked";
  responsibleSession: "S22";
  authProviderMode: string;
  deploymentFingerprint: DeploymentFingerprint;
  prerequisites: DeploymentRouteSmokeGatePrerequisite[];
  routeChecks: ProviderSmokePlanRouteCheck[];
  blockedReasons: DeploymentRouteSmokeGateBlockedReason[];
  safety: {
    secretsRedacted: true;
    valuesRedacted: true;
    signedAdminAccess: true;
    issuedTeacherAuthCookie: true;
    oidcBearerTokenOmitted: true;
    responseBodiesOmitted: true;
    liveRequiresApproval: true;
  };
};

export type DeploymentFingerprint =
  | {
      status: "present";
      value: string;
    }
  | {
      status: "missing";
    };

export type DeploymentRouteSmokeGatePrerequisite = {
  id:
    | "s22-deployment-base-url"
    | "s19-ai-access-signing-secret"
    | "s12-teacher-auth-provider"
    | "s19-teacher-auth-session-signing-secret"
    | "s12-teacher-auth-issuer-secret"
    | "s12-teacher-auth-oidc-issuer"
    | "s12-teacher-auth-oidc-audience"
    | "s12-teacher-auth-oidc-jwks-url"
    | "s12-teacher-auth-oidc-teacher-id-claim"
    | "s22-teacher-auth-oidc-smoke-token"
    | "s22-teacher-auth-oidc-smoke-teacher-id";
  responsibleSession: "S12" | "S19" | "S22";
  requiredEnv:
    | "UAIS_DEPLOYMENT_BASE_URL"
    | "UAIS_AI_ACCESS_SIGNING_SECRET"
    | "UAIS_TEACHER_AUTH_PROVIDER"
    | "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET"
    | "UAIS_TEACHER_AUTH_ISSUER_SECRET"
    | "UAIS_TEACHER_AUTH_OIDC_ISSUER"
    | "UAIS_TEACHER_AUTH_OIDC_AUDIENCE"
    | "UAIS_TEACHER_AUTH_OIDC_JWKS_URL"
    | "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM"
    | "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN"
    | "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID";
  status: "present" | "missing";
};

export type DeploymentReadinessGateCheck = {
  id:
    | "s19-live-approval-token"
    | "s19-ai-access-signing-secret"
    | "s12-teacher-auth-provider"
    | "s19-teacher-auth-session-signing-secret"
    | "s12-teacher-auth-issuer-secret"
    | "s12-teacher-ownership-backend"
    | "s24-voice-lifecycle-audit-backend"
    | "s19-deepseek-env"
    | "s19-qwen-env"
    | "s19-next-public-secret-scan";
  responsibleSession: "S19" | "S12" | "S24";
  status: "ready" | "blocked";
  requiredEnv?:
    | "UAIS_LIVE_AI_APPROVAL_TOKEN"
    | "UAIS_AI_ACCESS_SIGNING_SECRET"
    | "UAIS_TEACHER_AUTH_PROVIDER"
    | "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET"
    | "UAIS_TEACHER_AUTH_ISSUER_SECRET"
    | "UAIS_TEACHER_AUTH_OIDC_ISSUER"
    | "UAIS_TEACHER_AUTH_OIDC_AUDIENCE"
    | "UAIS_TEACHER_AUTH_OIDC_JWKS_URL"
    | "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM"
    | "UAIS_TEACHER_AI_OWNERSHIP_BACKEND"
    | "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND"
    | "DEEPSEEK_API_KEY"
    | "DASHSCOPE_API_KEY";
  description: string;
  forbiddenEnvNames?: string[];
  backendContract?: UaisStorageBackendContract;
  authProviderContract?: UaisTeacherAuthProviderContract;
};

export type DeploymentReadinessBlockedReason =
  | "missing-UAIS_LIVE_AI_APPROVAL_TOKEN"
  | "missing-UAIS_AI_ACCESS_SIGNING_SECRET"
  | "missing-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET"
  | "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET"
  | "missing-UAIS_TEACHER_AUTH_OIDC_ISSUER"
  | "missing-UAIS_TEACHER_AUTH_OIDC_AUDIENCE"
  | "missing-UAIS_TEACHER_AUTH_OIDC_JWKS_URL"
  | "missing-UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM"
  | "missing-DEEPSEEK_API_KEY"
  | "missing-DASHSCOPE_API_KEY"
  | "next-public-secret-env-present"
  | UaisTeacherAuthProviderBlockedReason
  | UaisStorageBackendBlockedReason;

export type DeploymentRouteSmokeGateBlockedReason =
  | "missing-UAIS_DEPLOYMENT_BASE_URL"
  | "missing-UAIS_AI_ACCESS_SIGNING_SECRET"
  | "missing-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET"
  | "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET"
  | "missing-UAIS_TEACHER_AUTH_OIDC_ISSUER"
  | "missing-UAIS_TEACHER_AUTH_OIDC_AUDIENCE"
  | "missing-UAIS_TEACHER_AUTH_OIDC_JWKS_URL"
  | "missing-UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM"
  | "missing-UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN"
  | "missing-UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID"
  | UaisTeacherAuthProviderBlockedReason;

export type DeploymentEnvManifestEntry = {
  name: string;
  provider: UaisProviderId | "uais";
  roles: UaisProviderRole[];
  valueType:
    | "secret"
    | "base-url"
    | "model"
    | "storage-backend"
    | "auth-provider"
    | "service-mode"
    | "storage-path"
    | "database-adapter-proof";
  status: "present" | "missing";
  serverOnly: true;
  vercelTargets: ["production", "preview"];
  defaultValue?: string;
};

export type BuildProviderSmokePlanInput = {
  mode?: ProviderSmokePlanMode;
  env: Record<string, string | undefined>;
  liveApproved?: boolean;
};

export type ProviderSmokeResult =
  | {
      provider: UaisProviderId;
      status: "ok" | "failed";
      httpStatus: number;
      model: string;
    }
  | {
      provider: UaisProviderId;
      status: "skipped";
      reason: "missing-required-env";
    };

export type ExecuteProviderSmokeInput = {
  env: Record<string, string | undefined>;
  liveApproved?: boolean;
  fetch?: typeof fetch;
};

export function buildProviderSmokePlan(input: BuildProviderSmokePlanInput): ProviderSmokePlan {
  const mode = input.mode ?? "dry-run";
  if (mode === "live" && input.liveApproved !== true) {
    throw new Error("Live provider smoke checks require explicit owner approval.");
  }

  const readiness = getRedactedProviderReadiness(input.env);
  const rolesByProvider = groupRolesByProvider();

  return {
    mode,
    network: mode === "live" ? "enabled" : "disabled",
    checks: readiness.map((entry) => ({
      ...entry,
      roles: rolesByProvider.get(entry.provider) ?? [],
      action: smokeActionForProvider(entry.provider),
    })),
    routeChecks: buildProviderSmokeRouteChecks(),
    safety: {
      secretsRedacted: true,
      dryRunUsesNetwork: false,
      liveRequiresApproval: true,
    },
  };
}

export function buildDeploymentEnvManifest(input: {
  env: Record<string, string | undefined>;
}): DeploymentEnvManifest {
  const entries: DeploymentEnvManifestEntry[] = deploymentEnvDefinitions.map((definition) => ({
    ...definition,
    status: hasValue(input.env[definition.name]) ? "present" : "missing",
    serverOnly: true,
    vercelTargets: ["production", "preview"],
  }));

  return {
    target: "vercel",
    responsibleSession: "S19",
    entries,
    safety: {
      valuesRedacted: true,
      nextPublicForbidden: true,
      liveProviderApprovalRequired: true,
    },
  };
}

export function buildDeploymentReadinessGate(input: {
  env: Record<string, string | undefined>;
}): DeploymentReadinessGate {
  const forbiddenEnvNames = Object.keys(input.env).filter(isForbiddenNextPublicSecretEnvName);
  const teacherAuthProviderContract = resolveUaisTeacherAuthProviderContract({
    env: input.env,
  });
  const teacherOwnershipBackendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    value: input.env.UAIS_TEACHER_AI_OWNERSHIP_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });
  const voiceLifecycleAuditBackendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
    value: input.env.UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND,
    responsibleSession: "S24",
    env: input.env,
  });
  const checks: DeploymentReadinessGateCheck[] = [
    {
      id: "s19-live-approval-token",
      responsibleSession: "S19",
      requiredEnv: "UAIS_LIVE_AI_APPROVAL_TOKEN",
      status: hasValue(input.env.UAIS_LIVE_AI_APPROVAL_TOKEN) ? "ready" : "blocked",
      description: "S19 API Configuration requires a server-only live-provider approval token.",
    },
    {
      id: "s19-ai-access-signing-secret",
      responsibleSession: "S19",
      requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
      status: hasValue(input.env.UAIS_AI_ACCESS_SIGNING_SECRET) ? "ready" : "blocked",
      description:
        "S19 API Configuration requires a server-only signing secret for S12 AI access session claims.",
    },
    {
      id: "s12-teacher-auth-provider",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
      status:
        teacherAuthProviderContract.productionStatus === "ready" ? "ready" : "blocked",
      description:
        "S12 Backend/API Platform requires an explicit trusted teacher-auth provider before production teacher AI sessions.",
      authProviderContract: teacherAuthProviderContract,
    },
    {
      id: "s19-teacher-auth-session-signing-secret",
      responsibleSession: "S19",
      requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      status: hasValue(input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET)
        ? "ready"
        : "blocked",
      description:
        "S19 API Configuration requires a server-only signing secret for S12 teacher-auth session cookies.",
    },
    {
      id: "s12-teacher-auth-issuer-secret",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      status:
        teacherAuthProviderContract.providerKind === "oidc-jwks" ||
        hasValue(input.env.UAIS_TEACHER_AUTH_ISSUER_SECRET)
        ? "ready"
        : "blocked",
      description:
        "S12 Backend/API Platform requires a server-only trusted issuer secret before teacher-auth cookies can be issued.",
    },
    {
      id: "s12-teacher-ownership-backend",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
      status:
        teacherOwnershipBackendContract.productionStatus === "ready" ? "ready" : "blocked",
      description:
        "S12 Backend/API Platform requires a durable implemented teacher AI ownership backend before production live AI usage.",
      backendContract: teacherOwnershipBackendContract,
    },
    {
      id: "s19-deepseek-env",
      responsibleSession: "S19",
      requiredEnv: "DEEPSEEK_API_KEY",
      status: hasValue(input.env.DEEPSEEK_API_KEY) ? "ready" : "blocked",
      description: "S19 API Configuration requires DeepSeek text-reasoning credentials.",
    },
    {
      id: "s19-qwen-env",
      responsibleSession: "S19",
      requiredEnv: "DASHSCOPE_API_KEY",
      status: hasValue(input.env.DASHSCOPE_API_KEY) ? "ready" : "blocked",
      description:
        "S19 API Configuration requires Qwen multimodal, voice, and PPT credentials.",
    },
    {
      id: "s24-voice-lifecycle-audit-backend",
      responsibleSession: "S24",
      requiredEnv: "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
      status:
        voiceLifecycleAuditBackendContract.productionStatus === "ready" ? "ready" : "blocked",
      description:
        "S24 Asset and Export Quality requires a durable implemented Qwen voice lifecycle audit backend before production live AI usage.",
      backendContract: voiceLifecycleAuditBackendContract,
    },
    {
      id: "s19-next-public-secret-scan",
      responsibleSession: "S19",
      status: forbiddenEnvNames.length === 0 ? "ready" : "blocked",
      description: "S19 API Configuration forbids provider secrets in NEXT_PUBLIC env names.",
      ...(forbiddenEnvNames.length > 0 ? { forbiddenEnvNames } : {}),
    },
  ];
  const blockedReasons = uniqueBlockedReasons(
    checks.flatMap((check): DeploymentReadinessBlockedReason[] => {
      if (check.status !== "blocked") {
        return [];
      }

      if (check.backendContract?.blockedReason) {
        return [check.backendContract.blockedReason];
      }

      if (check.authProviderContract?.blockedReason) {
        return [check.authProviderContract.blockedReason];
      }

      if (check.requiredEnv) {
        return [`missing-${check.requiredEnv}` as DeploymentReadinessBlockedReason];
      }

      return ["next-public-secret-env-present"];
    }),
  );

  return {
    target: "vercel",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S19",
    checks,
    blockedReasons,
    safety: {
      valuesRedacted: true,
      serverOnlySecretsRequired: true,
      nextPublicSecretsForbidden: true,
    },
  };
}

export function buildDeploymentRouteSmokeGate(input: {
  env: Record<string, string | undefined>;
  baseUrl?: string;
}): DeploymentRouteSmokeGate {
  const baseUrl = input.baseUrl ?? input.env.UAIS_DEPLOYMENT_BASE_URL;
  const teacherAuthProviderContract = resolveUaisTeacherAuthProviderContract({
    env: input.env,
  });
  const authProviderMode = teacherAuthProviderContract.providerKind;
  const sharedPrerequisites: DeploymentRouteSmokeGatePrerequisite[] = [
    {
      id: "s22-deployment-base-url",
      responsibleSession: "S22",
      requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
      status: hasValue(baseUrl) ? "present" : "missing",
    },
    {
      id: "s19-ai-access-signing-secret",
      responsibleSession: "S19",
      requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
      status: hasValue(input.env.UAIS_AI_ACCESS_SIGNING_SECRET) ? "present" : "missing",
    },
    {
      id: "s12-teacher-auth-provider",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
      status:
        teacherAuthProviderContract.productionStatus === "ready" ? "present" : "missing",
    },
    {
      id: "s19-teacher-auth-session-signing-secret",
      responsibleSession: "S19",
      requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
      status: hasValue(input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET)
        ? "present"
        : "missing",
    },
  ];
  const trustedIssuerPrerequisites: DeploymentRouteSmokeGatePrerequisite[] = [
    {
      id: "s12-teacher-auth-issuer-secret",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
      status: hasValue(input.env.UAIS_TEACHER_AUTH_ISSUER_SECRET)
        ? "present"
        : "missing",
    },
  ];
  const oidcPrerequisites: DeploymentRouteSmokeGatePrerequisite[] = [
    {
      id: "s12-teacher-auth-oidc-issuer",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_ISSUER",
      status: hasValue(input.env.UAIS_TEACHER_AUTH_OIDC_ISSUER) ? "present" : "missing",
    },
    {
      id: "s12-teacher-auth-oidc-audience",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
      status: hasValue(input.env.UAIS_TEACHER_AUTH_OIDC_AUDIENCE) ? "present" : "missing",
    },
    {
      id: "s12-teacher-auth-oidc-jwks-url",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
      status: hasValue(input.env.UAIS_TEACHER_AUTH_OIDC_JWKS_URL) ? "present" : "missing",
    },
    {
      id: "s12-teacher-auth-oidc-teacher-id-claim",
      responsibleSession: "S12",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
      status: hasValue(input.env.UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM)
        ? "present"
        : "missing",
    },
    {
      id: "s22-teacher-auth-oidc-smoke-token",
      responsibleSession: "S22",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN",
      status: hasValue(input.env.UAIS_TEACHER_AUTH_OIDC_SMOKE_BEARER_TOKEN)
        ? "present"
        : "missing",
    },
    {
      id: "s22-teacher-auth-oidc-smoke-teacher-id",
      responsibleSession: "S22",
      requiredEnv: "UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID",
      status: hasValue(input.env.UAIS_TEACHER_AUTH_OIDC_SMOKE_TEACHER_ID)
        ? "present"
        : "missing",
    },
  ];
  const prerequisites =
    authProviderMode === "oidc-jwks"
      ? [...sharedPrerequisites, ...oidcPrerequisites]
      : [...sharedPrerequisites, ...trustedIssuerPrerequisites];
  const blockedReasons = uniqueBlockedReasons([
    ...prerequisites.flatMap((prerequisite): DeploymentRouteSmokeGateBlockedReason[] =>
      prerequisite.status === "missing" ? [`missing-${prerequisite.requiredEnv}`] : [],
    ),
    ...(teacherAuthProviderContract.blockedReason
      ? [teacherAuthProviderContract.blockedReason]
      : []),
  ]);

  return {
    target: "deployment-route-smoke",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S22",
    authProviderMode,
    deploymentFingerprint: createDeploymentFingerprint(baseUrl),
    prerequisites,
    routeChecks: buildProviderSmokeRouteChecks(authProviderMode),
    blockedReasons,
    safety: {
      secretsRedacted: true,
      valuesRedacted: true,
      signedAdminAccess: true,
      issuedTeacherAuthCookie: true,
      oidcBearerTokenOmitted: true,
      responseBodiesOmitted: true,
      liveRequiresApproval: true,
    },
  };
}

function createDeploymentFingerprint(baseUrl: string | undefined): DeploymentFingerprint {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    return { status: "missing" };
  }

  try {
    const origin = new URL(baseUrl).origin.toLowerCase();
    return {
      status: "present",
      value: `sha256:${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`,
    };
  } catch {
    return { status: "missing" };
  }
}

export async function executeProviderSmoke(
  input: ExecuteProviderSmokeInput,
): Promise<ProviderSmokeResult[]> {
  if (input.liveApproved !== true) {
    throw new Error("Live provider smoke checks require explicit owner approval.");
  }

  const fetchImpl = input.fetch ?? fetch;
  const deepseek = await smokeDeepSeek(input.env, fetchImpl);
  const qwen = await smokeQwen(input.env, fetchImpl);

  return [deepseek, qwen];
}

async function smokeDeepSeek(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
): Promise<ProviderSmokeResult> {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      provider: "deepseek",
      status: "skipped",
      reason: "missing-required-env",
    };
  }

  const model = env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  const baseUrl = (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK." }],
      stream: false,
    }),
  });

  return {
    provider: "deepseek",
    status: response.ok ? "ok" : "failed",
    httpStatus: response.status,
    model,
  };
}

async function smokeQwen(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
): Promise<ProviderSmokeResult> {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return {
      provider: "qwen",
      status: "skipped",
      reason: "missing-required-env",
    };
  }

  const model = env.QWEN_MULTIMODAL_MODEL ?? "qwen3.5-omni-plus";
  const baseUrl = qwenCompatibleBaseUrl(env.DASHSCOPE_BASE_URL);
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK." }],
      stream: false,
    }),
  });

  return {
    provider: "qwen",
    status: response.ok ? "ok" : "failed",
    httpStatus: response.status,
    model,
  };
}

function qwenCompatibleBaseUrl(baseUrl: string | undefined) {
  const normalized = (baseUrl ?? "https://dashscope.aliyuncs.com").replace(/\/$/, "");
  if (normalized.endsWith("/compatible-mode/v1")) {
    return normalized;
  }

  return `${normalized}/compatible-mode/v1`;
}

function groupRolesByProvider() {
  const rolesByProvider = new Map<UaisProviderId, UaisProviderRole[]>();

  for (const config of listProviderRoleConfigs()) {
    const roles = rolesByProvider.get(config.provider) ?? [];
    roles.push(config.role);
    rolesByProvider.set(config.provider, roles);
  }

  return rolesByProvider;
}

function smokeActionForProvider(
  provider: UaisProviderId,
): ProviderSmokePlanCheck["action"] {
  if (provider === "deepseek") {
    return "verify-text-reasoning-contract";
  }

  return "verify-multimodal-voice-ppt-contract";
}

function buildProviderSmokeRouteChecks(authProviderMode = "trusted-cookie-issuer"): ProviderSmokePlanRouteCheck[] {
  return [
    {
      id: "s22-retention-readiness-route",
      route: "/api/ai/voice-assets/retention-readiness",
      method: "GET",
      action: "verify-admin-retention-readiness-route",
      auth: "signed-admin-ai-access",
      expectedStatus: 200,
      responsibleSessions: ["S22", "S12", "S24"],
    },
    {
      id: "s22-voice-lifecycle-audit-route",
      route: "/api/ai/voice-clone/lifecycle-audit",
      method: "GET",
      action: "verify-admin-voice-lifecycle-audit-route",
      auth: "signed-admin-ai-access",
      expectedStatus: 200,
      responsibleSessions: ["S22", "S12", "S24"],
    },
    {
      id: "s22-ai-readiness-route",
      route: "/api/ai/readiness",
      method: "GET",
      action: "verify-admin-ai-readiness-route",
      auth: "signed-admin-ai-access",
      expectedStatus: 200,
      responsibleSessions: ["S22", "S12", "S19"],
    },
    {
      id: "s22-ai-smoke-plan-route",
      route: "/api/ai/smoke-plan",
      method: "GET",
      action: "verify-admin-ai-smoke-plan-route",
      auth: "signed-admin-ai-access",
      expectedStatus: 200,
      responsibleSessions: ["S22", "S12", "S19"],
    },
	    {
	      id: "s22-teacher-auth-issuer-route",
      route: "/api/ai/teacher-auth/issue",
      method: "POST",
      action:
        authProviderMode === "oidc-jwks"
          ? "verify-oidc-teacher-auth-issuer-route"
          : "verify-admin-teacher-auth-issuer-route",
      auth: authProviderMode === "oidc-jwks" ? "oidc-jwks-bearer-token" : "signed-admin-ai-access",
      expectedStatus: 200,
      responsibleSessions: ["S22", "S12", "S19"],
      requestBodyShape: "teacher-auth-session-issue",
      responseHeaderChecks: [
        "teacherAuthClaimsSetCookie",
        "teacherAuthSignatureSetCookie",
        "httpOnlySameSiteSecureMaxAge",
        "priorityHigh",
        "issuerProofBoundedMaxAge",
      ],
    },
    {
      id: "s22-teacher-ai-session-route",
      route: "/api/ai/session",
      method: "POST",
      action: "verify-issued-teacher-ai-session-route",
      auth: "issued-teacher-auth-cookie",
      expectedStatus: 200,
      responsibleSessions: ["S22", "S12", "S19"],
      requestBodyShape: "teacher-ai-session-issue",
      responseShapeChecks: [
        "accessSession",
        "accessPlan",
        "authProviderContract",
        "s12TeacherAiSessionBoundary",
        "signedContractDirectCallDenied",
      ],
    },
    {
      id: "s22-teacher-ownership-route",
      route: "/api/ai/teacher-ownership",
      method: "GET",
      action: "verify-issued-teacher-ownership-route",
      auth: "issued-teacher-auth-cookie",
      expectedStatus: 200,
      responsibleSessions: ["S22", "S12", "S24", "S19"],
      responseShapeChecks: [
        "ownership",
        "consistency",
        "s12TeacherOwnershipSummary",
      ],
    },
    {
      id: "s22-teacher-ppt-workflow-route",
      route: "/api/ai/teacher-ppt-workflow",
      method: "GET",
      action: "verify-signed-teacher-ppt-workflow-route",
      auth: "issued-teacher-auth-cookie",
      expectedStatus: 200,
      responsibleSessions: ["S22", "S12", "S24", "S19"],
      responseShapeChecks: [
        "workflow",
        "workflowReadyForDownloads",
        "workflowDownloadContract",
        "workflowAudioDownloadPattern",
        "workflowExportDownloadUrl",
        "agentHandoffPlan",
        "agentHandoffPlanFramework",
        "s22ReleaseSmokeAgent",
      ],
    },
  ];
}

const deploymentEnvDefinitions: Array<
  Omit<DeploymentEnvManifestEntry, "status" | "serverOnly" | "vercelTargets">
> = [
  {
    name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_AI_ACCESS_SIGNING_SECRET",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_TEACHER_AUTH_PROVIDER",
    provider: "uais",
    roles: [],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_TEACHER_AUTH_OIDC_ISSUER",
    provider: "uais",
    roles: [],
    valueType: "base-url",
  },
  {
    name: "UAIS_TEACHER_AUTH_OIDC_AUDIENCE",
    provider: "uais",
    roles: [],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_TEACHER_AUTH_OIDC_JWKS_URL",
    provider: "uais",
    roles: [],
    valueType: "base-url",
  },
  {
    name: "UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM",
    provider: "uais",
    roles: [],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_TEACHING_OPERATIONS_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
    provider: "uais",
    roles: [],
    valueType: "base-url",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
    provider: "uais",
    roles: [],
    valueType: "service-mode",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
    provider: "uais",
    roles: [],
    valueType: "storage-path",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATA_DIR",
    provider: "uais",
    roles: [],
    valueType: "storage-path",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
    provider: "uais",
    roles: [],
    valueType: "database-adapter-proof",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
    provider: "uais",
    roles: [],
    valueType: "database-adapter-proof",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
    provider: "uais",
    roles: [],
    valueType: "database-adapter-proof",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
    provider: "uais",
    roles: [],
    valueType: "database-adapter-proof",
  },
  {
    name: "DEEPSEEK_API_KEY",
    provider: "deepseek",
    roles: ["text-reasoning"],
    valueType: "secret",
  },
  {
    name: "DEEPSEEK_BASE_URL",
    provider: "deepseek",
    roles: ["text-reasoning"],
    valueType: "base-url",
    defaultValue: "https://api.deepseek.com",
  },
  {
    name: "DEEPSEEK_MODEL",
    provider: "deepseek",
    roles: ["text-reasoning"],
    valueType: "model",
    defaultValue: "deepseek-v4-flash",
  },
  {
    name: "DASHSCOPE_API_KEY",
    provider: "qwen",
    roles: ["multimodal", "image-generation", "voice-clone", "ppt-narration"],
    valueType: "secret",
  },
  {
    name: "DASHSCOPE_BASE_URL",
    provider: "qwen",
    roles: ["multimodal", "image-generation", "voice-clone", "ppt-narration"],
    valueType: "base-url",
    defaultValue: "https://dashscope.aliyuncs.com",
  },
  {
    name: "QWEN_MULTIMODAL_MODEL",
    provider: "qwen",
    roles: ["multimodal"],
    valueType: "model",
    defaultValue: "qwen3.5-omni-plus",
  },
  {
    name: "QWEN_IMAGE_MODEL",
    provider: "qwen",
    roles: ["image-generation"],
    valueType: "model",
    defaultValue: "qwen-image-2.0",
  },
  {
    name: "QWEN_TTS_MODEL",
    provider: "qwen",
    roles: ["voice-clone", "ppt-narration"],
    valueType: "model",
    defaultValue: "qwen3-tts-vc-realtime-2026-01-15",
  },
];

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim() !== "";
}

function uniqueBlockedReasons<T extends string>(values: T[]) {
  return Array.from(new Set(values));
}

function isForbiddenNextPublicSecretEnvName(name: string) {
  if (!name.startsWith("NEXT_PUBLIC_")) {
    return false;
  }

  return /(API_KEY|TOKEN|SECRET|DASHSCOPE|DEEPSEEK|QWEN)/i.test(name);
}
