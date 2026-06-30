import type {
  UaisAiAccessAction,
  UaisAiAccessDecision,
  UaisAiAccessSessionClaims,
  UaisAiResourceScope,
} from "@/lib/server/ai-access-control";

export type UaisTeacherAiResourceOwnership = {
  teacherId: string;
  courseIds?: string[];
  sampleAssets?: Array<{
    sampleAssetId: string;
    courseId?: string;
  }>;
  pptAssets?: Array<{
    pptAssetId: string;
    courseId?: string;
  }>;
  clonedVoiceRefs?: Array<{
    voiceRefId: string;
    sampleAssetId?: string;
  }>;
  audioManifests?: Array<{
    audioManifestId: string;
    courseId?: string;
    pptAssetId?: string;
    voiceRefId?: string;
  }>;
};

export type UaisTeacherAiWorkflowAction = Extract<
  UaisAiAccessAction,
  | "live-chat"
  | "voice-sample-submit"
  | "voice-clone-preflight"
  | "voice-clone-status"
  | "voice-clone-revoke"
  | "teacher-ppt-workflow-read"
  | "ppt-narration-submit"
  | "ppt-narration-audio-download"
  | "ppt-narration-export-download"
>;

export type UaisTeacherAiWorkflowAccessPlan = {
  responsibleSession: "S12";
  action: UaisTeacherAiWorkflowAction;
  resource: UaisAiResourceScope;
  grants: NonNullable<UaisAiAccessSessionClaims["scopes"]>;
  requestedScopes: NonNullable<UaisAiAccessSessionClaims["scopes"]>;
  redaction: UaisAiAccessDecision["redaction"];
};

type NormalizedTeacherAiOwnership = {
  teacherId: string;
  courseIds: string[];
  sampleAssets: Array<{
    sampleAssetId: string;
    courseId?: string;
  }>;
  pptAssets: Array<{
    pptAssetId: string;
    courseId?: string;
  }>;
  clonedVoiceRefs: Array<{
    voiceRefId: string;
    sampleAssetId?: string;
  }>;
  audioManifests: Array<{
    audioManifestId: string;
    courseId?: string;
    pptAssetId?: string;
    voiceRefId?: string;
  }>;
};

export function createUaisTeacherAiResourceGrants(
  ownership: UaisTeacherAiResourceOwnership,
): NonNullable<UaisAiAccessSessionClaims["scopes"]> {
  const normalized = normalizeOwnership(ownership);
  return compactScopes({
    teacherIds: [normalized.teacherId],
    courseIds: uniqueIds([
      ...normalized.courseIds,
      ...normalized.sampleAssets.map((asset) => asset.courseId),
      ...normalized.pptAssets.map((asset) => asset.courseId),
      ...normalized.audioManifests.map((manifest) => manifest.courseId),
    ]),
    sampleAssetIds: uniqueIds(normalized.sampleAssets.map((asset) => asset.sampleAssetId)),
    pptAssetIds: uniqueIds(normalized.pptAssets.map((asset) => asset.pptAssetId)),
    voiceRefIds: uniqueIds(normalized.clonedVoiceRefs.map((reference) => reference.voiceRefId)),
    audioManifestIds: uniqueIds(
      normalized.audioManifests.map((manifest) => manifest.audioManifestId),
    ),
  });
}

export function createUaisTeacherAiWorkflowAccessPlan(input: {
  ownership: UaisTeacherAiResourceOwnership;
  action: UaisTeacherAiWorkflowAction;
  resource: UaisAiResourceScope;
}): UaisTeacherAiWorkflowAccessPlan {
  const normalized = normalizeOwnership(input.ownership);
  const grants = createUaisTeacherAiResourceGrants(input.ownership);
  const resource = compactResource(input.resource);
  const requestedScopes = createRequestedScopes(resource);

  assertResourceScopeIsGranted({
    normalized,
    grants,
    requestedScopes,
    resource,
  });

  return {
    responsibleSession: "S12",
    action: input.action,
    resource,
    grants,
    requestedScopes,
    redaction: createRedaction(),
  };
}

function assertResourceScopeIsGranted(input: {
  normalized: NormalizedTeacherAiOwnership;
  grants: NonNullable<UaisAiAccessSessionClaims["scopes"]>;
  requestedScopes: NonNullable<UaisAiAccessSessionClaims["scopes"]>;
  resource: UaisAiResourceScope;
}) {
  const { normalized, grants, requestedScopes, resource } = input;

  assertScopeListIsGranted("teacherId", requestedScopes.teacherIds, grants.teacherIds);
  assertScopeListIsGranted("courseId", requestedScopes.courseIds, grants.courseIds);
  assertScopeListIsGranted("sampleAssetId", requestedScopes.sampleAssetIds, grants.sampleAssetIds);
  assertScopeListIsGranted("pptAssetId", requestedScopes.pptAssetIds, grants.pptAssetIds);
  assertScopeListIsGranted("voiceRefId", requestedScopes.voiceRefIds, grants.voiceRefIds);
  assertScopeListIsGranted(
    "audioManifestId",
    requestedScopes.audioManifestIds,
    grants.audioManifestIds,
  );

  const sampleAsset = resource.sampleAssetId
    ? findById(normalized.sampleAssets, "sampleAssetId", resource.sampleAssetId)
    : undefined;
  if (resource.sampleAssetId && !sampleAsset) {
    throw new Error(`Teacher AI resource is not granted: sampleAssetId=${resource.sampleAssetId}`);
  }
  if (resource.courseId && sampleAsset?.courseId && sampleAsset.courseId !== resource.courseId) {
    throw new Error("Teacher AI resource relation mismatch: sampleAssetId courseId.");
  }

  const pptAsset = resource.pptAssetId
    ? findById(normalized.pptAssets, "pptAssetId", resource.pptAssetId)
    : undefined;
  if (resource.pptAssetId && !pptAsset) {
    throw new Error(`Teacher AI resource is not granted: pptAssetId=${resource.pptAssetId}`);
  }
  if (resource.courseId && pptAsset?.courseId && pptAsset.courseId !== resource.courseId) {
    throw new Error("Teacher AI resource relation mismatch: pptAssetId courseId.");
  }

  const voiceRef = resource.voiceRefId
    ? findById(normalized.clonedVoiceRefs, "voiceRefId", resource.voiceRefId)
    : undefined;
  if (resource.voiceRefId && !voiceRef) {
    throw new Error(`Teacher AI resource is not granted: voiceRefId=${resource.voiceRefId}`);
  }
  if (
    resource.sampleAssetId &&
    voiceRef?.sampleAssetId &&
    voiceRef.sampleAssetId !== resource.sampleAssetId
  ) {
    throw new Error("Teacher AI resource relation mismatch: voiceRefId sampleAssetId.");
  }

  const audioManifest = resource.audioManifestId
    ? findById(normalized.audioManifests, "audioManifestId", resource.audioManifestId)
    : undefined;
  if (resource.audioManifestId && !audioManifest) {
    throw new Error(
      `Teacher AI resource is not granted: audioManifestId=${resource.audioManifestId}`,
    );
  }
  if (
    resource.courseId &&
    audioManifest?.courseId &&
    audioManifest.courseId !== resource.courseId
  ) {
    throw new Error("Teacher AI resource relation mismatch: audioManifestId courseId.");
  }
  if (
    resource.pptAssetId &&
    audioManifest?.pptAssetId &&
    audioManifest.pptAssetId !== resource.pptAssetId
  ) {
    throw new Error("Teacher AI resource relation mismatch: audioManifestId pptAssetId.");
  }
  if (
    resource.voiceRefId &&
    audioManifest?.voiceRefId &&
    audioManifest.voiceRefId !== resource.voiceRefId
  ) {
    throw new Error("Teacher AI resource relation mismatch: audioManifestId voiceRefId.");
  }
}

function assertScopeListIsGranted(
  fieldName: string,
  requested: string[] | undefined,
  granted: string[] | undefined,
) {
  const grantedSet = new Set(granted ?? []);
  for (const value of requested ?? []) {
    if (!grantedSet.has(value)) {
      throw new Error(`Teacher AI resource is not granted: ${fieldName}=${value}`);
    }
  }
}

function createRequestedScopes(
  resource: UaisAiResourceScope,
): NonNullable<UaisAiAccessSessionClaims["scopes"]> {
  return compactScopes({
    teacherIds: uniqueIds([resource.teacherId]),
    courseIds: uniqueIds([resource.courseId]),
    sampleAssetIds: uniqueIds([resource.sampleAssetId]),
    pptAssetIds: uniqueIds([resource.pptAssetId]),
    voiceRefIds: uniqueIds([resource.voiceRefId]),
    audioManifestIds: uniqueIds([resource.audioManifestId]),
  });
}

function normalizeOwnership(
  ownership: UaisTeacherAiResourceOwnership,
): NormalizedTeacherAiOwnership {
  const teacherId = normalizeRequiredId(ownership.teacherId, "teacherId");
  return {
    teacherId,
    courseIds: uniqueIds(ownership.courseIds),
    sampleAssets: normalizeSampleAssets(ownership.sampleAssets),
    pptAssets: normalizePptAssets(ownership.pptAssets),
    clonedVoiceRefs: normalizeClonedVoiceRefs(ownership.clonedVoiceRefs),
    audioManifests: normalizeAudioManifests(ownership.audioManifests),
  };
}

function normalizeSampleAssets(
  values: UaisTeacherAiResourceOwnership["sampleAssets"],
): NormalizedTeacherAiOwnership["sampleAssets"] {
  const normalized: NormalizedTeacherAiOwnership["sampleAssets"] = [];
  for (const value of values ?? []) {
    const sampleAssetId = normalizeOptionalId(value.sampleAssetId);
    if (sampleAssetId) {
      normalized.push({
        sampleAssetId,
        ...(normalizeOptionalId(value.courseId)
          ? { courseId: normalizeOptionalId(value.courseId) }
          : {}),
      });
    }
  }
  return normalized;
}

function normalizePptAssets(
  values: UaisTeacherAiResourceOwnership["pptAssets"],
): NormalizedTeacherAiOwnership["pptAssets"] {
  const normalized: NormalizedTeacherAiOwnership["pptAssets"] = [];
  for (const value of values ?? []) {
    const pptAssetId = normalizeOptionalId(value.pptAssetId);
    if (pptAssetId) {
      normalized.push({
        pptAssetId,
        ...(normalizeOptionalId(value.courseId)
          ? { courseId: normalizeOptionalId(value.courseId) }
          : {}),
      });
    }
  }
  return normalized;
}

function normalizeClonedVoiceRefs(
  values: UaisTeacherAiResourceOwnership["clonedVoiceRefs"],
): NormalizedTeacherAiOwnership["clonedVoiceRefs"] {
  const normalized: NormalizedTeacherAiOwnership["clonedVoiceRefs"] = [];
  for (const value of values ?? []) {
    const voiceRefId = normalizeOptionalId(value.voiceRefId);
    if (voiceRefId) {
      normalized.push({
        voiceRefId,
        ...(normalizeOptionalId(value.sampleAssetId)
          ? { sampleAssetId: normalizeOptionalId(value.sampleAssetId) }
          : {}),
      });
    }
  }
  return normalized;
}

function normalizeAudioManifests(
  values: UaisTeacherAiResourceOwnership["audioManifests"],
): NormalizedTeacherAiOwnership["audioManifests"] {
  const normalized: NormalizedTeacherAiOwnership["audioManifests"] = [];
  for (const value of values ?? []) {
    const audioManifestId = normalizeOptionalId(value.audioManifestId);
    if (audioManifestId) {
      normalized.push({
        audioManifestId,
        ...(normalizeOptionalId(value.courseId)
          ? { courseId: normalizeOptionalId(value.courseId) }
          : {}),
        ...(normalizeOptionalId(value.pptAssetId)
          ? { pptAssetId: normalizeOptionalId(value.pptAssetId) }
          : {}),
        ...(normalizeOptionalId(value.voiceRefId)
          ? { voiceRefId: normalizeOptionalId(value.voiceRefId) }
          : {}),
      });
    }
  }
  return normalized;
}

function compactScopes(
  scopes: NonNullable<UaisAiAccessSessionClaims["scopes"]>,
): NonNullable<UaisAiAccessSessionClaims["scopes"]> {
  const compacted: NonNullable<UaisAiAccessSessionClaims["scopes"]> = {};
  if (scopes.teacherIds?.length) compacted.teacherIds = scopes.teacherIds;
  if (scopes.courseIds?.length) compacted.courseIds = scopes.courseIds;
  if (scopes.sampleAssetIds?.length) compacted.sampleAssetIds = scopes.sampleAssetIds;
  if (scopes.pptAssetIds?.length) compacted.pptAssetIds = scopes.pptAssetIds;
  if (scopes.voiceRefIds?.length) compacted.voiceRefIds = scopes.voiceRefIds;
  if (scopes.audioManifestIds?.length) compacted.audioManifestIds = scopes.audioManifestIds;
  return compacted;
}

function compactResource(resource: UaisAiResourceScope) {
  return Object.fromEntries(
    Object.entries(resource)
      .map(([key, value]) => [key, normalizeOptionalId(value)] as const)
      .filter((entry): entry is [keyof UaisAiResourceScope, string] => Boolean(entry[1])),
  ) as UaisAiResourceScope;
}

function findById<T extends Record<K, string | undefined>, K extends keyof T>(
  values: T[],
  key: K,
  value: string,
) {
  return values.find((candidate) => candidate[key] === value);
}

function normalizeRequiredId(value: string, fieldName: string) {
  const normalized = normalizeOptionalId(value);
  if (!normalized) {
    throw new Error(`Teacher AI ownership ${fieldName} is required.`);
  }
  return normalized;
}

function normalizeOptionalId(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function uniqueIds(values: Array<string | undefined> | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map(normalizeOptionalId)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function createRedaction(): UaisAiAccessDecision["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
