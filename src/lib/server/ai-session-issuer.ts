import {
  createUaisAiAccessSessionForTrustedActor,
  type UaisAiAccessDecision,
  type UaisAiAccessSessionClaims,
  type UaisAiActorRole,
  type UaisAiTrustedActorAccessSession,
} from "@/lib/server/ai-access-control";

export type UaisAuthenticatedTeacherSession = {
  sessionId: string;
  actorId: string;
  role: Extract<UaisAiActorRole, "teacher">;
  authenticatedAt: string;
  expiresAt: string;
  grants: NonNullable<UaisAiAccessSessionClaims["scopes"]>;
};

export type UaisAuthenticatedTeacherAiAccessSession = UaisAiTrustedActorAccessSession & {
  authSource: "uais-authenticated-session";
  authSessionRef: "server-side-auth-session";
};

export function createUaisAiAccessSessionFromAuthenticatedTeacher(input: {
  authenticatedSession: UaisAuthenticatedTeacherSession;
  requestedScopes: NonNullable<UaisAiAccessSessionClaims["scopes"]>;
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): UaisAuthenticatedTeacherAiAccessSession {
  const now = input.now ?? new Date();
  assertAuthenticatedTeacherSessionIsUsable(input.authenticatedSession, now);
  const requestedScopes = normalizeScopes(input.requestedScopes);
  const grants = normalizeScopes(input.authenticatedSession.grants);
  if (!scopesAreGranted(requestedScopes, grants)) {
    throw new Error("Authenticated teacher session is not authorized for requested AI scopes.");
  }

  const authenticatedSessionExpiresAt = Date.parse(input.authenticatedSession.expiresAt);
  const ttlSeconds = Math.max(
    1,
    Math.floor((authenticatedSessionExpiresAt - now.getTime()) / 1000),
  );
  const issued = createUaisAiAccessSessionForTrustedActor({
    actor: {
      actorId: input.authenticatedSession.actorId,
      role: "teacher",
    },
    scopes: requestedScopes,
    secret: input.secret,
    now,
    ttlSeconds: Math.min(input.ttlSeconds ?? ttlSeconds, ttlSeconds),
  });

  return {
    ...issued,
    authSource: "uais-authenticated-session",
    authSessionRef: "server-side-auth-session",
    redaction: createRedaction(),
  };
}

function assertAuthenticatedTeacherSessionIsUsable(
  session: UaisAuthenticatedTeacherSession,
  now: Date,
) {
  if (!session.sessionId.trim() || !session.actorId.trim() || session.role !== "teacher") {
    throw new Error("Authenticated teacher session is invalid.");
  }

  const authenticatedAt = Date.parse(session.authenticatedAt);
  const expiresAt = Date.parse(session.expiresAt);
  if (!Number.isFinite(authenticatedAt) || !Number.isFinite(expiresAt)) {
    throw new Error("Authenticated teacher session timestamps are invalid.");
  }
  if (expiresAt <= now.getTime()) {
    throw new Error("Authenticated teacher session is expired.");
  }
}

function normalizeScopes(
  scopes: NonNullable<UaisAiAccessSessionClaims["scopes"]>,
): NonNullable<UaisAiAccessSessionClaims["scopes"]> {
  const normalized: NonNullable<UaisAiAccessSessionClaims["scopes"]> = {};
  const teacherIds = normalizeScopeList(scopes.teacherIds);
  const courseIds = normalizeScopeList(scopes.courseIds);
  const sampleAssetIds = normalizeScopeList(scopes.sampleAssetIds);
  const pptAssetIds = normalizeScopeList(scopes.pptAssetIds);
  const voiceRefIds = normalizeScopeList(scopes.voiceRefIds);
  const audioManifestIds = normalizeScopeList(scopes.audioManifestIds);
  if (teacherIds.length > 0) normalized.teacherIds = teacherIds;
  if (courseIds.length > 0) normalized.courseIds = courseIds;
  if (sampleAssetIds.length > 0) normalized.sampleAssetIds = sampleAssetIds;
  if (pptAssetIds.length > 0) normalized.pptAssetIds = pptAssetIds;
  if (voiceRefIds.length > 0) normalized.voiceRefIds = voiceRefIds;
  if (audioManifestIds.length > 0) normalized.audioManifestIds = audioManifestIds;
  return normalized;
}

function normalizeScopeList(values: string[] | undefined) {
  return Array.from(
    new Set((values ?? []).filter((value) => value.trim()).map((value) => value.trim())),
  );
}

function scopesAreGranted(
  requestedScopes: NonNullable<UaisAiAccessSessionClaims["scopes"]>,
  grants: NonNullable<UaisAiAccessSessionClaims["scopes"]>,
) {
  return (
    scopeListIsGranted(requestedScopes.teacherIds, grants.teacherIds) &&
    scopeListIsGranted(requestedScopes.courseIds, grants.courseIds) &&
    scopeListIsGranted(requestedScopes.sampleAssetIds, grants.sampleAssetIds) &&
    scopeListIsGranted(requestedScopes.pptAssetIds, grants.pptAssetIds) &&
    scopeListIsGranted(requestedScopes.voiceRefIds, grants.voiceRefIds) &&
    scopeListIsGranted(requestedScopes.audioManifestIds, grants.audioManifestIds)
  );
}

function scopeListIsGranted(requested: string[] | undefined, granted: string[] | undefined) {
  const grantedSet = new Set(granted ?? []);
  return (requested ?? []).every((value) => grantedSet.has(value));
}

function createRedaction(): UaisAiAccessDecision["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
