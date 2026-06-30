import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";

export type StoreQwenClonedVoiceReferenceInput = {
  baseDir?: string;
  teacherId: string;
  sampleAssetId: string;
  providerTaskId: string;
  clonedVoiceId: string;
  targetModel?: string;
  createdAt?: string;
};

export type PublicQwenClonedVoiceReference = {
  voiceRefId: string;
  teacherId: string;
  sampleAssetId: string;
  provider: "qwen";
  providerRole: "voice-clone";
  status: "ready";
  providerTaskId: string;
  targetModel?: string;
  voiceRef: "server-side-cloned-qwen-voice";
  storagePolicy: "local-private-cloned-voice-reference";
  responsibleSession: "S07/S12/S24";
  retention: QwenClonedVoiceReferenceRetentionPolicy;
  provenance: QwenClonedVoiceReferenceProvenance;
};

export type QwenClonedVoiceReferenceRetentionPolicy = {
  classification: "provider-cloned-voice-reference-sensitive";
  policy: "revoke-provider-voice-and-delete-reference-on-owner-request-or-sample-expiry";
  createdAt: string;
  reviewAfter: string;
  reviewAfterDays: 30;
  deletionTrigger: "owner-request-or-source-sample-deletion";
  responsibleSession: "S24";
};

export type QwenClonedVoiceReferenceProvenance = {
  provider: "qwen";
  providerRole: "voice-clone";
  sourceSampleAssetId: string;
  providerTaskId: string;
  voiceRef: "server-side-cloned-qwen-voice";
  privateProviderVoiceId: "server-side-only";
};

export type PrivateQwenClonedVoiceReference = {
  publicReference: PublicQwenClonedVoiceReference;
  clonedVoiceId: string;
};

export type QwenClonedVoiceDeletionReason = "owner-request" | "source-sample-deletion";

export type RevokeAndDeleteQwenClonedVoiceReferenceInput = {
  baseDir?: string;
  voiceRefId: string;
  deletionReason: QwenClonedVoiceDeletionReason;
  deletedAt?: string;
  revokeProviderVoice: (input: {
    clonedVoiceId: string;
    publicReference: PublicQwenClonedVoiceReference;
  }) => Promise<{ status: "revoked" }>;
};

export type RevokeAndDeleteQwenClonedVoiceReferenceResult = {
  voiceRefId: string;
  provider: "qwen";
  providerRole: "voice-clone";
  status: "revoked-and-deleted";
  deletionReason: QwenClonedVoiceDeletionReason;
  providerRevocation: {
    status: "revoked";
    provider: "qwen";
    providerRole: "voice-clone";
  };
  localReference: {
    status: "deleted";
    storagePolicy: "local-private-cloned-voice-reference";
  };
  auditRecord: {
    auditId: string;
    written: true;
    storagePolicy: "local-redacted-lifecycle-audit";
  };
  responsibleSession: "S24/S12";
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "ids-only";
  };
};

export type QwenClonedVoiceLifecycleAuditRecord = {
  auditId: string;
  voiceRefId: string;
  deletionReason: QwenClonedVoiceDeletionReason;
  deletedAt: string;
  providerRevocation: {
    status: "revoked";
  };
  localReference: {
    status: "deleted";
  };
  responsibleSession: "S24/S12";
};

export type QwenClonedVoiceLifecycleAuditIndex = {
  provider: "qwen";
  providerRole: "voice-clone";
  storagePolicy: "local-redacted-lifecycle-audit";
  recordCount: number;
  records: QwenClonedVoiceLifecycleAuditRecord[];
  responsibleSession: "S24/S12";
  redaction: RevokeAndDeleteQwenClonedVoiceReferenceResult["redaction"];
};

const DEFAULT_CLONED_VOICE_REGISTRY_DIR = join(
  cwd(),
  ".tmp",
  "uais-ai-assets",
  "qwen-cloned-voices",
);

export async function storeQwenClonedVoiceReference(
  input: StoreQwenClonedVoiceReferenceInput,
): Promise<PublicQwenClonedVoiceReference> {
  const baseDir = resolveClonedVoiceRegistryBaseDir(input.baseDir);
  const teacherId = requireSafeId(input.teacherId, "teacher id");
  const sampleAssetId = requireSafeId(input.sampleAssetId, "sample asset id");
  const voiceRefId = buildVoiceRefId(teacherId, sampleAssetId);
  const registryDir = resolve(baseDir);
  ensureWithinBase(baseDir, registryDir);
  await mkdir(registryDir, { recursive: true });

  if (!input.clonedVoiceId.trim()) {
    throw new Error("A cloned voice id is required before storing a voice reference.");
  }

  const publicReference: PublicQwenClonedVoiceReference = {
    voiceRefId,
    teacherId,
    sampleAssetId,
    provider: "qwen",
    providerRole: "voice-clone",
    status: "ready",
    providerTaskId: input.providerTaskId,
    targetModel: input.targetModel,
    voiceRef: "server-side-cloned-qwen-voice",
    storagePolicy: "local-private-cloned-voice-reference",
    responsibleSession: "S07/S12/S24",
    retention: createQwenClonedVoiceReferenceRetentionPolicy(input.createdAt),
    provenance: {
      provider: "qwen",
      providerRole: "voice-clone",
      sourceSampleAssetId: sampleAssetId,
      providerTaskId: input.providerTaskId,
      voiceRef: "server-side-cloned-qwen-voice",
      privateProviderVoiceId: "server-side-only",
    },
  };

  await writeFile(
    resolve(registryDir, `${voiceRefId}.json`),
    JSON.stringify(
      {
        publicReference,
        clonedVoiceId: input.clonedVoiceId,
      },
      null,
      2,
    ),
  );
  return publicReference;
}

export async function readQwenClonedVoiceReference(input: {
  baseDir?: string;
  voiceRefId: string;
}): Promise<PrivateQwenClonedVoiceReference> {
  const baseDir = resolveClonedVoiceRegistryBaseDir(input.baseDir);
  const voiceRefId = requireSafeId(input.voiceRefId, "voice reference id");
  const filePath = resolve(baseDir, `${voiceRefId}.json`);
  ensureWithinBase(baseDir, filePath);
  const reference = JSON.parse(await readFile(filePath, "utf8")) as PrivateQwenClonedVoiceReference;
  if (!reference.clonedVoiceId?.trim()) {
    throw new Error("Stored Qwen voice reference is missing the private cloned voice id.");
  }
  return reference;
}

export async function revokeAndDeleteQwenClonedVoiceReference(
  input: RevokeAndDeleteQwenClonedVoiceReferenceInput,
): Promise<RevokeAndDeleteQwenClonedVoiceReferenceResult> {
  const baseDir = resolveClonedVoiceRegistryBaseDir(input.baseDir);
  const voiceRefId = requireSafeId(input.voiceRefId, "voice reference id");
  const filePath = resolve(baseDir, `${voiceRefId}.json`);
  ensureWithinBase(baseDir, filePath);

  const reference = await readQwenClonedVoiceReference({
    baseDir,
    voiceRefId,
  });
  await input.revokeProviderVoice({
    clonedVoiceId: reference.clonedVoiceId,
    publicReference: reference.publicReference,
  });
  await unlink(filePath);
  const auditId = `qwen-cloned-voice-revocation-${voiceRefId}`;
  await writeDeletionAuditRecord({
    baseDir,
    audit: {
      auditId,
      voiceRefId,
      provider: "qwen",
      providerRole: "voice-clone",
      deletionReason: input.deletionReason,
      deletedAt: input.deletedAt ?? new Date().toISOString(),
      providerRevocation: {
        status: "revoked",
      },
      localReference: {
        status: "deleted",
      },
      responsibleSession: "S24/S12",
      redaction: createRedaction(),
    },
  });

  return {
    voiceRefId,
    provider: "qwen",
    providerRole: "voice-clone",
    status: "revoked-and-deleted",
    deletionReason: input.deletionReason,
    providerRevocation: {
      status: "revoked",
      provider: "qwen",
      providerRole: "voice-clone",
    },
    localReference: {
      status: "deleted",
      storagePolicy: "local-private-cloned-voice-reference",
    },
    auditRecord: {
      auditId,
      written: true,
      storagePolicy: "local-redacted-lifecycle-audit",
    },
    responsibleSession: "S24/S12",
    redaction: createRedaction(),
  };
}

export async function listQwenClonedVoiceLifecycleAuditRecords(input: {
  baseDir?: string;
}): Promise<QwenClonedVoiceLifecycleAuditIndex> {
  const baseDir = resolveClonedVoiceRegistryBaseDir(input.baseDir);
  const auditDir = resolve(baseDir, ".deletion-audit");
  ensureWithinBase(baseDir, auditDir);
  const filenames = await readdir(auditDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const records: QwenClonedVoiceLifecycleAuditRecord[] = [];

  for (const filename of filenames) {
    if (!filename.endsWith(".json")) {
      continue;
    }
    const voiceRefId = requireSafeId(filename.slice(0, -".json".length), "voice reference id");
    const auditPath = resolve(auditDir, `${voiceRefId}.json`);
    ensureWithinBase(auditDir, auditPath);
    records.push(toLifecycleAuditRecord(JSON.parse(await readFile(auditPath, "utf8"))));
  }

  records.sort((left, right) => {
    const byDeletedAt = left.deletedAt.localeCompare(right.deletedAt);
    return byDeletedAt === 0 ? left.auditId.localeCompare(right.auditId) : byDeletedAt;
  });

  return {
    provider: "qwen",
    providerRole: "voice-clone",
    storagePolicy: "local-redacted-lifecycle-audit",
    recordCount: records.length,
    records,
    responsibleSession: "S24/S12",
    redaction: createRedaction(),
  };
}

function buildVoiceRefId(teacherId: string, sampleAssetId: string) {
  return `qwen-voice-ref-${teacherId}-${sampleAssetId}`;
}

function requireSafeId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function resolveClonedVoiceRegistryBaseDir(baseDir?: string) {
  return baseDir ? resolve(baseDir) : DEFAULT_CLONED_VOICE_REGISTRY_DIR;
}

function ensureWithinBase(baseDir: string, targetPath: string) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new Error("Resolved cloned voice registry path escapes the configured storage directory.");
  }
}

async function writeDeletionAuditRecord(input: {
  baseDir: string;
  audit: {
    auditId: string;
    voiceRefId: string;
    provider: "qwen";
    providerRole: "voice-clone";
    deletionReason: QwenClonedVoiceDeletionReason;
    deletedAt: string;
    providerRevocation: {
      status: "revoked";
    };
    localReference: {
      status: "deleted";
    };
    responsibleSession: "S24/S12";
    redaction: RevokeAndDeleteQwenClonedVoiceReferenceResult["redaction"];
  };
}) {
  const auditDir = resolve(input.baseDir, ".deletion-audit");
  ensureWithinBase(input.baseDir, auditDir);
  await mkdir(auditDir, { recursive: true });
  const auditPath = resolve(auditDir, `${input.audit.voiceRefId}.json`);
  ensureWithinBase(auditDir, auditPath);
  await writeFile(auditPath, JSON.stringify(input.audit, null, 2));
}

function toLifecycleAuditRecord(value: unknown): QwenClonedVoiceLifecycleAuditRecord {
  const record = value as QwenClonedVoiceLifecycleAuditRecord;
  if (
    !record.auditId?.trim() ||
    !record.voiceRefId?.trim() ||
    (record.deletionReason !== "owner-request" && record.deletionReason !== "source-sample-deletion") ||
    !record.deletedAt?.trim() ||
    record.providerRevocation?.status !== "revoked" ||
    record.localReference?.status !== "deleted" ||
    record.responsibleSession !== "S24/S12"
  ) {
    throw new Error("Invalid Qwen cloned voice lifecycle audit record.");
  }

  return {
    auditId: record.auditId,
    voiceRefId: record.voiceRefId,
    deletionReason: record.deletionReason,
    deletedAt: record.deletedAt,
    providerRevocation: {
      status: "revoked",
    },
    localReference: {
      status: "deleted",
    },
    responsibleSession: "S24/S12",
  };
}

function createQwenClonedVoiceReferenceRetentionPolicy(
  createdAt = new Date().toISOString(),
): QwenClonedVoiceReferenceRetentionPolicy {
  return {
    classification: "provider-cloned-voice-reference-sensitive",
    policy: "revoke-provider-voice-and-delete-reference-on-owner-request-or-sample-expiry",
    createdAt,
    reviewAfter: addDaysIso(createdAt, 30),
    reviewAfterDays: 30,
    deletionTrigger: "owner-request-or-source-sample-deletion",
    responsibleSession: "S24",
  };
}

function addDaysIso(isoDate: string, days: number) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error("createdAt must be a valid ISO date.");
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function createRedaction(): RevokeAndDeleteQwenClonedVoiceReferenceResult["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
