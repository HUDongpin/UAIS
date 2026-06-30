import { createHmac, timingSafeEqual } from "node:crypto";

export const UAIS_ACCESS_CLAIMS_HEADER = "x-uais-access-claims";
export const UAIS_ACCESS_SIGNATURE_HEADER = "x-uais-access-signature";
export const UAIS_ACTOR_ID_HEADER = "x-uais-actor-id";
export const UAIS_ACTOR_ROLE_HEADER = "x-uais-actor-role";
export const UAIS_TEACHER_SCOPE_HEADER = "x-uais-teacher-ids";
export const UAIS_COURSE_SCOPE_HEADER = "x-uais-course-ids";
export const UAIS_SAMPLE_ASSET_SCOPE_HEADER = "x-uais-sample-asset-ids";
export const UAIS_PPT_ASSET_SCOPE_HEADER = "x-uais-ppt-asset-ids";
export const UAIS_VOICE_REF_SCOPE_HEADER = "x-uais-voice-ref-ids";
export const UAIS_AUDIO_MANIFEST_SCOPE_HEADER = "x-uais-audio-manifest-ids";

export type UaisAiActorRole = "teacher" | "admin";

export type UaisAiResourceScope = {
  teacherId?: string;
  courseId?: string;
  pptAssetId?: string;
  sampleAssetId?: string;
  voiceRefId?: string;
  providerTaskId?: string;
  audioManifestId?: string;
  audioId?: string;
};

export type UaisAiAccessAction =
  | "live-chat"
  | "voice-sample-submit"
  | "voice-clone-preflight"
  | "voice-clone-status"
  | "voice-clone-revoke"
  | "voice-lifecycle-audit-read"
  | "voice-asset-retention-read"
  | "ppt-narration-submit"
  | "ppt-narration-audio-download"
  | "ppt-narration-export-download"
  | "teacher-auth-session-issue"
  | "teacher-ppt-workflow-read"
  | "provider-readiness"
  | "provider-smoke-plan"
  | "lrs-readiness"
  | "lrs-live-smoke"
  | "lrs-analytics-read";
export type UaisAiAdminAccessAction = Extract<
  UaisAiAccessAction,
  | "provider-readiness"
  | "provider-smoke-plan"
  | "teacher-auth-session-issue"
  | "voice-lifecycle-audit-read"
  | "voice-asset-retention-read"
  | "lrs-readiness"
  | "lrs-live-smoke"
  | "lrs-analytics-read"
>;

export type UaisAiAccessAuthMode = "signed-session" | "scoped-headers";

export type UaisAiAccessSessionClaims = {
  actor: {
    actorId: string;
    role: UaisAiActorRole;
  };
  scopes?: {
    teacherIds?: string[];
    courseIds?: string[];
    sampleAssetIds?: string[];
    pptAssetIds?: string[];
    voiceRefIds?: string[];
    audioManifestIds?: string[];
  };
  issuedAt?: string;
  expiresAt: string;
};

export type UaisAiTrustedActorAccessSession = {
  responsibleSession: "S12";
  headers: Record<string, string>;
  claims: UaisAiAccessSessionClaims;
  redaction: UaisAiAccessDecision["redaction"];
};

export type UaisAiAccessDecision = {
  status: "authorized" | "denied";
  responsibleSession: "S12";
  authMode: UaisAiAccessAuthMode;
  action: UaisAiAccessAction;
  reasonCode:
    | "authorized"
    | "actor-context-required"
    | "actor-role-invalid"
    | "admin-role-required"
    | "teacher-scope-denied"
    | "course-scope-denied"
    | "sample-asset-scope-denied"
    | "ppt-asset-scope-denied"
    | "voice-ref-scope-denied"
    | "audio-manifest-scope-denied"
    | "resource-context-invalid"
    | "signed-session-required"
    | "signed-session-secret-missing"
    | "signed-session-invalid"
    | "signed-session-expired";
  actor?: {
    actorId: string;
    role: UaisAiActorRole;
  };
  resource?: UaisAiResourceScope;
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "ids-only";
  };
};

export class UaisAiAccessDeniedError extends Error {
  readonly decision: UaisAiAccessDecision;

  constructor(decision: UaisAiAccessDecision) {
    super(`UAIS AI access denied: ${decision.reasonCode}`);
    this.name = "UaisAiAccessDeniedError";
    this.decision = decision;
  }
}

export function assertUaisAiAccess(input: {
  request: Request;
  action: UaisAiAccessAction;
  resource?: UaisAiResourceScope;
  env?: Record<string, string | undefined>;
  now?: Date;
  requireSignedSession?: boolean;
}): UaisAiAccessDecision {
  const decision = authorizeUaisAiAccess(input);
  if (decision.status === "denied") {
    throw new UaisAiAccessDeniedError(decision);
  }
  return decision;
}

export function assertUaisAiAdminAccess(input: {
  request: Request;
  env?: Record<string, string | undefined>;
  now?: Date;
  action: UaisAiAdminAccessAction;
  requireSignedSession?: boolean;
}): UaisAiAccessDecision {
  const decision = authorizeUaisAiAccess(input);
  if (decision.status === "denied") {
    throw new UaisAiAccessDeniedError(decision);
  }
  if (decision.actor?.role !== "admin") {
    throw new UaisAiAccessDeniedError(
      denied(
        input.action,
        "admin-role-required",
        decision.actor,
        decision.resource,
        decision.authMode,
      ),
    );
  }
  return decision;
}

export function assertProductionUaisAiAdminAccess(input: {
  request: Request;
  env: Record<string, string | undefined>;
  action: UaisAiAdminAccessAction;
}) {
  if (!isUaisAiProductionRuntime(input.env)) {
    return undefined;
  }
  return assertUaisAiAdminAccess(input);
}

export function authorizeUaisAiAccess(input: {
  request: Request;
  action: UaisAiAccessAction;
  resource?: UaisAiResourceScope;
  env?: Record<string, string | undefined>;
  now?: Date;
  requireSignedSession?: boolean;
}): UaisAiAccessDecision {
  const signedSessionDecision = authorizeSignedSession(input);
  if (signedSessionDecision) {
    return signedSessionDecision;
  }
  const env = input.env ?? process.env;
  const resource = compactResource(input.resource);
  if (input.requireSignedSession || isUaisAiProductionRuntime(env)) {
    const signingSecret = env.UAIS_AI_ACCESS_SIGNING_SECRET ?? process.env.UAIS_AI_ACCESS_SIGNING_SECRET;
    if (!signingSecret) {
      return denied(
        input.action,
        "signed-session-secret-missing",
        undefined,
        resource,
        "scoped-headers",
      );
    }
    return denied(
      input.action,
      "signed-session-required",
      undefined,
      resource,
      "scoped-headers",
    );
  }

  const actorId = readHeader(input.request, UAIS_ACTOR_ID_HEADER);
  const roleValue = readHeader(input.request, UAIS_ACTOR_ROLE_HEADER);

  if (!actorId || !isSafeUaisAiAccessId(actorId) || !roleValue) {
    return denied(input.action, "actor-context-required", undefined, undefined, "scoped-headers");
  }

  if (roleValue !== "teacher" && roleValue !== "admin") {
    return denied(input.action, "actor-role-invalid", undefined, resource, "scoped-headers");
  }

  if (!isSafeUaisAiAccessResource(resource)) {
    return denied(input.action, "actor-context-required", undefined, undefined, "scoped-headers");
  }

  const role: UaisAiActorRole = roleValue;
  const actor = { actorId, role };
  return authorizeActorScope({
    action: input.action,
    actor,
    resource,
    authMode: "scoped-headers",
    scopes: {
      teacherIds: readCsvHeader(input.request, UAIS_TEACHER_SCOPE_HEADER),
      courseIds: readCsvHeader(input.request, UAIS_COURSE_SCOPE_HEADER),
      sampleAssetIds: readCsvHeader(input.request, UAIS_SAMPLE_ASSET_SCOPE_HEADER),
      pptAssetIds: readCsvHeader(input.request, UAIS_PPT_ASSET_SCOPE_HEADER),
      voiceRefIds: readCsvHeader(input.request, UAIS_VOICE_REF_SCOPE_HEADER),
      audioManifestIds: readCsvHeader(input.request, UAIS_AUDIO_MANIFEST_SCOPE_HEADER),
    },
  });
}

function isUaisAiProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

export function createUaisAiAccessSessionHeaders(input: {
  claims: UaisAiAccessSessionClaims;
  secret: string;
}) {
  const claims = base64UrlEncode(Buffer.from(JSON.stringify(input.claims), "utf8"));
  return {
    [UAIS_ACCESS_CLAIMS_HEADER]: claims,
    [UAIS_ACCESS_SIGNATURE_HEADER]: signAccessClaims(claims, input.secret),
  };
}

export function createUaisAiAccessSessionForTrustedActor(input: {
  actor: {
    actorId: string;
    role: UaisAiActorRole;
  };
  scopes?: UaisAiAccessSessionClaims["scopes"];
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): UaisAiTrustedActorAccessSession {
  const secret = input.secret.trim();
  if (!secret) {
    throw new Error("UAIS AI access signing secret is required.");
  }

  const actorId = input.actor.actorId.trim();
  if (
    !actorId ||
    !isSafeUaisAiAccessId(actorId) ||
    (input.actor.role !== "teacher" && input.actor.role !== "admin")
  ) {
    throw new Error("UAIS AI trusted actor context is invalid.");
  }

  const issuedAt = input.now ?? new Date();
  const ttlSeconds = clampSessionTtlSeconds(input.ttlSeconds);
  const scopes = compactClaimsScopes(input.scopes);
  const claims: UaisAiAccessSessionClaims = {
    actor: {
      actorId,
      role: input.actor.role,
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString(),
    ...(scopes ? { scopes } : {}),
  };

  return {
    responsibleSession: "S12",
    headers: createUaisAiAccessSessionHeaders({ claims, secret }),
    claims,
    redaction: createRedaction(),
  };
}

function authorizeSignedSession(input: {
  request: Request;
  action: UaisAiAccessAction;
  resource?: UaisAiResourceScope;
  env?: Record<string, string | undefined>;
  now?: Date;
}): UaisAiAccessDecision | undefined {
  const claimsHeader = readHeader(input.request, UAIS_ACCESS_CLAIMS_HEADER);
  const signatureHeader = readHeader(input.request, UAIS_ACCESS_SIGNATURE_HEADER);
  const resource = compactResource(input.resource);
  const safeResource = isSafeUaisAiAccessResource(resource) ? resource : undefined;
  if (!claimsHeader && !signatureHeader) {
    return undefined;
  }
  const authMode: UaisAiAccessAuthMode = "signed-session";
  const secret = input.env?.UAIS_AI_ACCESS_SIGNING_SECRET ?? process.env.UAIS_AI_ACCESS_SIGNING_SECRET;
  if (!secret) {
    return denied(input.action, "signed-session-secret-missing", undefined, safeResource, authMode);
  }
  if (!claimsHeader || !signatureHeader || !isValidAccessSignature(claimsHeader, signatureHeader, secret)) {
    return denied(input.action, "signed-session-invalid", undefined, safeResource, authMode);
  }

  const claims = parseSignedSessionClaims(claimsHeader);
  if (!claims) {
    return denied(input.action, "signed-session-invalid", undefined, safeResource, authMode);
  }
  if (resource && !safeResource) {
    return denied(input.action, "resource-context-invalid", undefined, undefined, authMode);
  }
  const expiresAt = Date.parse(claims.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    return denied(input.action, "signed-session-invalid", undefined, safeResource, authMode);
  }
  if (expiresAt <= (input.now ?? new Date()).getTime()) {
    return denied(input.action, "signed-session-expired", claims.actor, safeResource, authMode);
  }
  return authorizeActorScope({
    action: input.action,
    actor: claims.actor,
    resource: safeResource,
    authMode,
    scopes: {
      teacherIds: arrayToSet(claims.scopes?.teacherIds),
      courseIds: arrayToSet(claims.scopes?.courseIds),
      sampleAssetIds: arrayToSet(claims.scopes?.sampleAssetIds),
      pptAssetIds: arrayToSet(claims.scopes?.pptAssetIds),
      voiceRefIds: arrayToSet(claims.scopes?.voiceRefIds),
      audioManifestIds: arrayToSet(claims.scopes?.audioManifestIds),
    },
  });
}

function authorizeActorScope(input: {
  action: UaisAiAccessAction;
  actor: { actorId: string; role: UaisAiActorRole };
  resource: UaisAiResourceScope | undefined;
  authMode: UaisAiAccessAuthMode;
  scopes: {
    teacherIds: Set<string>;
    courseIds: Set<string>;
    sampleAssetIds: Set<string>;
    pptAssetIds: Set<string>;
    voiceRefIds: Set<string>;
    audioManifestIds: Set<string>;
  };
}) {
  if (input.actor.role === "admin") {
    return authorized(input.action, input.actor, input.resource, input.authMode);
  }

  if (
    input.resource?.teacherId &&
    input.resource.teacherId !== input.actor.actorId &&
    !input.scopes.teacherIds.has(input.resource.teacherId)
  ) {
    return denied(input.action, "teacher-scope-denied", input.actor, input.resource, input.authMode);
  }

  if (input.resource?.courseId && !input.scopes.courseIds.has(input.resource.courseId)) {
    return denied(input.action, "course-scope-denied", input.actor, input.resource, input.authMode);
  }

  if (input.resource?.sampleAssetId && !input.scopes.sampleAssetIds.has(input.resource.sampleAssetId)) {
    return denied(input.action, "sample-asset-scope-denied", input.actor, input.resource, input.authMode);
  }

  if (input.resource?.pptAssetId && !input.scopes.pptAssetIds.has(input.resource.pptAssetId)) {
    return denied(input.action, "ppt-asset-scope-denied", input.actor, input.resource, input.authMode);
  }

  if (input.resource?.voiceRefId && !input.scopes.voiceRefIds.has(input.resource.voiceRefId)) {
    return denied(input.action, "voice-ref-scope-denied", input.actor, input.resource, input.authMode);
  }

  if (input.resource?.audioManifestId && !input.scopes.audioManifestIds.has(input.resource.audioManifestId)) {
    return denied(input.action, "audio-manifest-scope-denied", input.actor, input.resource, input.authMode);
  }

  return authorized(input.action, input.actor, input.resource, input.authMode);
}

export function isUaisAiAccessDeniedError(error: unknown): error is UaisAiAccessDeniedError {
  return error instanceof UaisAiAccessDeniedError;
}

export function createUaisAiAccessDeniedResponse(error: UaisAiAccessDeniedError) {
  return Response.json(
    {
      error: "UAIS AI access denied.",
      access: error.decision,
    },
    { status: 403 },
  );
}

function authorized(
  action: UaisAiAccessAction,
  actor: { actorId: string; role: UaisAiActorRole },
  resource: UaisAiResourceScope | undefined,
  authMode: UaisAiAccessAuthMode,
): UaisAiAccessDecision {
  return {
    status: "authorized",
    responsibleSession: "S12",
    authMode,
    action,
    reasonCode: "authorized",
    actor,
    ...(resource ? { resource } : {}),
    redaction: createRedaction(),
  };
}

function denied(
  action: UaisAiAccessAction,
  reasonCode: Exclude<UaisAiAccessDecision["reasonCode"], "authorized">,
  actor: { actorId: string; role: UaisAiActorRole } | undefined,
  resource: UaisAiResourceScope | undefined,
  authMode: UaisAiAccessAuthMode,
): UaisAiAccessDecision {
  return {
    status: "denied",
    responsibleSession: "S12",
    authMode,
    action,
    reasonCode,
    ...(actor ? { actor } : {}),
    ...(resource ? { resource } : {}),
    redaction: createRedaction(),
  };
}

function createRedaction(): UaisAiAccessDecision["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function readHeader(request: Request, name: string) {
  const value = request.headers.get(name);
  return value?.trim() || undefined;
}

function readCsvHeader(request: Request, name: string) {
  const value = readHeader(request, name);
  if (!value) {
    return new Set<string>();
  }

  return new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function parseSignedSessionClaims(claimsHeader: string): UaisAiAccessSessionClaims | undefined {
  try {
    const claims = JSON.parse(Buffer.from(claimsHeader, "base64url").toString("utf8")) as UaisAiAccessSessionClaims;
    if (
      !claims.actor?.actorId ||
      !isSafeUaisAiAccessId(claims.actor.actorId) ||
      (claims.actor.role !== "teacher" && claims.actor.role !== "admin")
    ) {
      return undefined;
    }
    if (typeof claims.expiresAt !== "string" || !claims.expiresAt.trim()) {
      return undefined;
    }
    if (!areSafeUaisAiAccessScopes(claims.scopes)) {
      return undefined;
    }
    return claims;
  } catch {
    return undefined;
  }
}

function isSafeUaisAiAccessId(value: string) {
  return (
    value.length >= 1 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/.test(value)
  );
}

function areSafeUaisAiAccessScopes(scopes: UaisAiAccessSessionClaims["scopes"] | undefined) {
  if (!scopes) {
    return true;
  }
  return [
    scopes.teacherIds,
    scopes.courseIds,
    scopes.sampleAssetIds,
    scopes.pptAssetIds,
    scopes.voiceRefIds,
    scopes.audioManifestIds,
  ].every((values) => (values ?? []).every((value) => isSafeUaisAiAccessId(value)));
}

function isSafeUaisAiAccessResource(resource: UaisAiResourceScope | undefined) {
  if (!resource) {
    return true;
  }
  return Object.values(resource).every((value) => value === undefined || isSafeUaisAiAccessId(value));
}

function isValidAccessSignature(claimsHeader: string, signatureHeader: string, secret: string) {
  const expected = signAccessClaims(claimsHeader, secret);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signatureHeader);
  return expectedBytes.byteLength === actualBytes.byteLength && timingSafeEqual(expectedBytes, actualBytes);
}

function signAccessClaims(claimsHeader: string, secret: string) {
  return base64UrlEncode(createHmac("sha256", secret).update(claimsHeader).digest());
}

function base64UrlEncode(bytes: Buffer) {
  return bytes.toString("base64url");
}

function clampSessionTtlSeconds(ttlSeconds: number | undefined) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds === undefined) {
    return 300;
  }
  return Math.min(Math.max(Math.floor(ttlSeconds), 1), 900);
}

function compactClaimsScopes(scopes: UaisAiAccessSessionClaims["scopes"] | undefined) {
  if (!scopes) {
    return undefined;
  }

  const compacted: NonNullable<UaisAiAccessSessionClaims["scopes"]> = {};
  const teacherIds = normalizeScopeList(scopes.teacherIds);
  const courseIds = normalizeScopeList(scopes.courseIds);
  const sampleAssetIds = normalizeScopeList(scopes.sampleAssetIds);
  const pptAssetIds = normalizeScopeList(scopes.pptAssetIds);
  const voiceRefIds = normalizeScopeList(scopes.voiceRefIds);
  const audioManifestIds = normalizeScopeList(scopes.audioManifestIds);
  if (teacherIds.length > 0) compacted.teacherIds = teacherIds;
  if (courseIds.length > 0) compacted.courseIds = courseIds;
  if (sampleAssetIds.length > 0) compacted.sampleAssetIds = sampleAssetIds;
  if (pptAssetIds.length > 0) compacted.pptAssetIds = pptAssetIds;
  if (voiceRefIds.length > 0) compacted.voiceRefIds = voiceRefIds;
  if (audioManifestIds.length > 0) compacted.audioManifestIds = audioManifestIds;
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function normalizeScopeList(values: string[] | undefined) {
  const normalized = Array.from(arrayToSet(values));
  if (!normalized.every((value) => isSafeUaisAiAccessId(value))) {
    throw new Error("UAIS AI trusted actor scopes are invalid.");
  }
  return normalized;
}

function arrayToSet(values: string[] | undefined) {
  return new Set((values ?? []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()));
}

function compactResource(resource: UaisAiResourceScope | undefined) {
  if (!resource) {
    return undefined;
  }

  const compacted = Object.fromEntries(
    Object.entries(resource).filter(
      (entry): entry is [keyof UaisAiResourceScope, string] =>
        typeof entry[1] === "string" && entry[1].trim() !== "",
    ),
  ) as UaisAiResourceScope;
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}
