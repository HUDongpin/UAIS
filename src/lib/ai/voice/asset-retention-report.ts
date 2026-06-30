import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import type { StoredPptNarrationAudioManifest } from "@/lib/ai/voice/ppt-narration-assets";
import type {
  PrivateQwenClonedVoiceReference,
  PublicQwenClonedVoiceReference,
} from "@/lib/ai/voice/cloned-voice-registry";
import type { StoredTeacherVoiceSampleAsset } from "@/lib/ai/voice/sample-assets";

type UaisVoiceAssetRetentionStatus = "active" | "due-soon" | "due";

type UaisVoiceAssetRetentionItem =
  | {
      assetKind: "teacher-voice-sample";
      assetId: string;
      teacherId: string;
      action: "delete-source-sample";
      status: UaisVoiceAssetRetentionStatus;
      dueAt: string;
      daysUntilDue: number;
      responsibleSession: "S24";
    }
  | {
      assetKind: "qwen-cloned-voice-reference";
      assetId: string;
      teacherId: string;
      sampleAssetId: string;
      action: "review-or-revoke-provider-voice";
      status: UaisVoiceAssetRetentionStatus;
      dueAt: string;
      daysUntilDue: number;
      responsibleSession: "S24";
    }
  | {
      assetKind: "ppt-narration-audio-manifest";
      assetId: string;
      courseId: string;
      pptAssetId: string;
      action: "retain-derived-audio";
      status: UaisVoiceAssetRetentionStatus;
      dueAt: string;
      daysUntilDue: number;
      responsibleSession: "S24";
    };

export type UaisVoiceAssetRetentionReport = {
  provider: "qwen";
  scope: "teacher-voice-and-ppt-narration-assets";
  status: "ready" | "action-required";
  recordCounts: {
    teacherVoiceSamples: number;
    clonedVoiceRefs: number;
    pptAudioManifests: number;
  };
  items: UaisVoiceAssetRetentionItem[];
  responsibleSession: "S24/S12";
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "ids-only";
  };
};

const DUE_SOON_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TEACHER_VOICE_SAMPLE_DIR = join(
  cwd(),
  ".tmp",
  "uais-ai-assets",
  "teacher-voice-samples",
);
const DEFAULT_CLONED_VOICE_REGISTRY_DIR = join(
  cwd(),
  ".tmp",
  "uais-ai-assets",
  "qwen-cloned-voices",
);
const DEFAULT_AUDIO_ASSET_DIR = join(cwd(), ".tmp", "uais-ai-assets", "ppt-narration");

export async function readLocalUaisVoiceAssetRetentionReport(input: {
  now?: string;
  teacherVoiceSampleBaseDir?: string;
  clonedVoiceRegistryBaseDir?: string;
  pptAudioBaseDir?: string;
}): Promise<UaisVoiceAssetRetentionReport> {
  const [teacherVoiceSamples, clonedVoiceRefs, pptAudioManifests] = await Promise.all([
    readLocalTeacherVoiceSampleAssets(input.teacherVoiceSampleBaseDir),
    readLocalQwenClonedVoicePublicReferences(input.clonedVoiceRegistryBaseDir),
    readLocalPptNarrationAudioManifests(input.pptAudioBaseDir),
  ]);

  return createUaisVoiceAssetRetentionReport({
    now: input.now,
    teacherVoiceSamples,
    clonedVoiceRefs,
    pptAudioManifests,
  });
}

export function createUaisVoiceAssetRetentionReport(input: {
  now?: string;
  teacherVoiceSamples?: StoredTeacherVoiceSampleAsset[];
  clonedVoiceRefs?: PublicQwenClonedVoiceReference[];
  pptAudioManifests?: StoredPptNarrationAudioManifest[];
}): UaisVoiceAssetRetentionReport {
  const now = parseIso(input.now ?? new Date().toISOString(), "now");
  const teacherVoiceSamples = input.teacherVoiceSamples ?? [];
  const clonedVoiceRefs = input.clonedVoiceRefs ?? [];
  const pptAudioManifests = input.pptAudioManifests ?? [];
  const items: UaisVoiceAssetRetentionItem[] = [
    ...teacherVoiceSamples.map((asset) => {
      const dueAt = requireIso(asset.retention.deleteAfter, "teacher voice sample deleteAfter");
      return {
        assetKind: "teacher-voice-sample" as const,
        assetId: requireSafeId(asset.assetId, "teacher voice sample asset id"),
        teacherId: requireSafeId(asset.teacherId, "teacher id"),
        action: "delete-source-sample" as const,
        ...createDueStatus(now, dueAt),
        responsibleSession: "S24" as const,
      };
    }),
    ...clonedVoiceRefs.map((reference) => {
      const dueAt = requireIso(reference.retention.reviewAfter, "cloned voice reviewAfter");
      return {
        assetKind: "qwen-cloned-voice-reference" as const,
        assetId: requireSafeId(reference.voiceRefId, "voice reference id"),
        teacherId: requireSafeId(reference.teacherId, "teacher id"),
        sampleAssetId: requireSafeId(reference.sampleAssetId, "sample asset id"),
        action: "review-or-revoke-provider-voice" as const,
        ...createDueStatus(now, dueAt),
        responsibleSession: "S24" as const,
      };
    }),
    ...pptAudioManifests.map((manifest) => {
      const dueAt = requireIso(manifest.retention.deleteAfter, "PPT audio deleteAfter");
      return {
        assetKind: "ppt-narration-audio-manifest" as const,
        assetId: requireSafeId(manifest.id, "PPT audio manifest id"),
        courseId: requireSafeId(manifest.courseId, "course id"),
        pptAssetId: requireSafeId(manifest.pptAssetId, "PPT asset id"),
        action: "retain-derived-audio" as const,
        ...createDueStatus(now, dueAt),
        responsibleSession: "S24" as const,
      };
    }),
  ];
  const report: UaisVoiceAssetRetentionReport = {
    provider: "qwen",
    scope: "teacher-voice-and-ppt-narration-assets",
    status: items.some((item) => item.status !== "active") ? "action-required" : "ready",
    recordCounts: {
      teacherVoiceSamples: teacherVoiceSamples.length,
      clonedVoiceRefs: clonedVoiceRefs.length,
      pptAudioManifests: pptAudioManifests.length,
    },
    items,
    responsibleSession: "S24/S12",
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "ids-only",
    },
  };
  assertRetentionReportIsDisplaySafe(report);
  return report;
}

async function readLocalTeacherVoiceSampleAssets(baseDir?: string) {
  const resolvedBaseDir = resolveLocalBaseDir(baseDir, DEFAULT_TEACHER_VOICE_SAMPLE_DIR);
  const teacherEntries = await readDirEntries(resolvedBaseDir);
  const assets: StoredTeacherVoiceSampleAsset[] = [];

  for (const teacherEntry of teacherEntries) {
    if (!teacherEntry.isDirectory() || teacherEntry.name.startsWith(".")) {
      continue;
    }
    const teacherDir = resolve(resolvedBaseDir, teacherEntry.name);
    ensureWithinBase(resolvedBaseDir, teacherDir, "teacher voice sample directory");
    const assetEntries = await readDirEntries(teacherDir);
    for (const assetEntry of assetEntries) {
      if (!assetEntry.isFile() || !assetEntry.name.endsWith(".json")) {
        continue;
      }
      const metadataPath = resolve(teacherDir, assetEntry.name);
      ensureWithinBase(teacherDir, metadataPath, "teacher voice sample metadata");
      assets.push(JSON.parse(await readFile(metadataPath, "utf8")) as StoredTeacherVoiceSampleAsset);
    }
  }

  return assets.sort((left, right) =>
    `${left.teacherId}/${left.assetId}`.localeCompare(`${right.teacherId}/${right.assetId}`),
  );
}

async function readLocalQwenClonedVoicePublicReferences(baseDir?: string) {
  const resolvedBaseDir = resolveLocalBaseDir(baseDir, DEFAULT_CLONED_VOICE_REGISTRY_DIR);
  const entries = await readDirEntries(resolvedBaseDir);
  const references: PublicQwenClonedVoiceReference[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const filePath = resolve(resolvedBaseDir, entry.name);
    ensureWithinBase(resolvedBaseDir, filePath, "Qwen cloned voice reference");
    const privateReference = JSON.parse(
      await readFile(filePath, "utf8"),
    ) as PrivateQwenClonedVoiceReference;
    references.push(privateReference.publicReference);
  }

  return references.sort((left, right) => left.voiceRefId.localeCompare(right.voiceRefId));
}

async function readLocalPptNarrationAudioManifests(baseDir?: string) {
  const resolvedBaseDir = resolveLocalBaseDir(baseDir, DEFAULT_AUDIO_ASSET_DIR);
  const entries = await readDirEntries(resolvedBaseDir);
  const manifests: StoredPptNarrationAudioManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const manifestDir = resolve(resolvedBaseDir, entry.name);
    ensureWithinBase(resolvedBaseDir, manifestDir, "PPT narration audio manifest directory");
    const manifestPath = resolve(manifestDir, "manifest.json");
    ensureWithinBase(manifestDir, manifestPath, "PPT narration audio manifest");
    const manifest = await readFile(manifestPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    if (!manifest) {
      continue;
    }
    manifests.push(JSON.parse(manifest) as StoredPptNarrationAudioManifest);
  }

  return manifests.sort((left, right) => left.id.localeCompare(right.id));
}

async function readDirEntries(baseDir: string) {
  return readdir(baseDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
}

function resolveLocalBaseDir(baseDir: string | undefined, defaultBaseDir: string) {
  return baseDir ? resolve(baseDir) : defaultBaseDir;
}

function ensureWithinBase(baseDir: string, targetPath: string, label: string) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new Error(`Resolved ${label} path escapes the configured storage directory.`);
  }
}

function createDueStatus(now: Date, dueAt: string) {
  const daysUntilDue = Math.ceil((parseIso(dueAt, "dueAt").getTime() - now.getTime()) / DAY_MS);
  return {
    status: daysUntilDue <= 0 ? "due" : daysUntilDue <= DUE_SOON_DAYS ? "due-soon" : "active",
    dueAt,
    daysUntilDue,
  } as const;
}

function requireIso(value: string, label: string) {
  parseIso(value, label);
  return value;
}

function parseIso(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid ISO date.`);
  }
  return date;
}

function requireSafeId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function assertRetentionReportIsDisplaySafe(report: UaisVoiceAssetRetentionReport) {
  const serialized = JSON.stringify(report);
  if (UNSAFE_RETENTION_REPORT_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("Voice asset retention report contains non-display-safe data.");
  }
}

const UNSAFE_RETENTION_REPORT_PATTERNS = [
  /sk-[A-Za-z0-9]/,
  /(?:DASHSCOPE_API_KEY|DEEPSEEK_API_KEY|UAIS_LIVE_AI_APPROVAL_TOKEN|UAIS_AI_ACCESS_SIGNING_SECRET|UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET|UAIS_TEACHER_AUTH_ISSUER_SECRET)\s*=\s*[^"',}\]\s]+/,
  new RegExp("voice-qwen-" + "private"),
  /\/Users\/dongpinhu\/Library\/Containers/,
  /data:audio\/[^"',}\]\s]+base64/i,
  /audioBase64/i,
];
