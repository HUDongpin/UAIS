import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import type { StoredPptNarrationAudioManifest } from "@/lib/ai/voice/ppt-narration-assets";

export type PptNarrationExportPackage = {
  bytes: Buffer;
  contentType: "application/zip";
  filename: string;
  manifestId: string;
  assetCount: number;
  byteLength: number;
  responsibleSession: "S24";
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "ids-only";
  };
};

export type CreatePptNarrationExportPackageInput = {
  manifestId: string;
  baseDir?: string;
};

type ZipEntryInput = {
  name: string;
  bytes: Buffer;
};

const DEFAULT_AUDIO_ASSET_DIR = join(cwd(), ".tmp", "uais-ai-assets", "ppt-narration");

export async function createPptNarrationExportPackage(
  input: CreatePptNarrationExportPackageInput,
): Promise<PptNarrationExportPackage> {
  const baseDir = resolveAudioAssetBaseDir(input.baseDir);
  const manifestId = requireSafeId(input.manifestId, "manifest id");
  const manifestDir = resolve(baseDir, manifestId);
  ensureWithinBase(baseDir, manifestDir);

  const manifestPath = resolve(manifestDir, "manifest.json");
  ensureWithinBase(manifestDir, manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StoredPptNarrationAudioManifest;
  assertManifestCanBeExported(manifest, manifestId);

  const entries: ZipEntryInput[] = [
    {
      name: "README.md",
      bytes: Buffer.from(createReadme(manifest), "utf8"),
    },
    {
      name: "manifest.json",
      bytes: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
    },
  ];

  for (const asset of manifest.assets) {
    const audioId = requireSafeId(asset.audioId, "audio id");
    const audioPath = resolve(manifestDir, `${audioId}.wav`);
    ensureWithinBase(manifestDir, audioPath);
    entries.push({
      name: `audio/${audioId}.wav`,
      bytes: await readFile(audioPath),
    });
  }

  const bytes = createStoreOnlyZip(entries);
  return {
    bytes,
    contentType: "application/zip",
    filename: `${manifestId}-ppt-narration.zip`,
    manifestId,
    assetCount: manifest.assets.length,
    byteLength: bytes.byteLength,
    responsibleSession: "S24",
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "ids-only",
    },
  };
}

function assertManifestCanBeExported(
  manifest: StoredPptNarrationAudioManifest,
  manifestId: string,
) {
  if (manifest.id !== manifestId) {
    throw new Error("PPT narration export manifest id mismatch.");
  }
  if (manifest.provider !== "qwen" || manifest.providerRole !== "ppt-narration") {
    throw new Error("PPT narration export requires a Qwen PPT narration manifest.");
  }
  if (manifest.voiceRef !== "server-side-cloned-qwen-voice") {
    throw new Error("PPT narration export must use a redacted server-side voice reference.");
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error("PPT narration export requires at least one audio asset.");
  }
}

function createReadme(manifest: StoredPptNarrationAudioManifest) {
  return [
    "# UAIS PPT Narration Audio Export",
    "",
    `Manifest: ${manifest.id}`,
    `Course: ${manifest.courseId}`,
    `PPT asset: ${manifest.pptAssetId}`,
    `Provider role: ${manifest.providerRole}`,
    `Target model: ${manifest.targetModel}`,
    `Audio assets: ${manifest.assets.length}`,
    "",
    "This package contains derived PPT narration WAV files and a redacted manifest.",
    "Real API keys, provider voice ids, source sample paths, and raw audio payloads are not included.",
    "",
  ].join("\n");
}

function createStoreOnlyZip(entries: ZipEntryInput[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    assertSafeZipEntryName(entry.name);
    const filename = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.bytes);
    const localHeader = createLocalFileHeader({
      filename,
      crc,
      size: entry.bytes.byteLength,
    });
    localParts.push(localHeader, entry.bytes);

    centralParts.push(
      createCentralDirectoryHeader({
        filename,
        crc,
        size: entry.bytes.byteLength,
        localHeaderOffset: offset,
      }),
    );
    offset += localHeader.byteLength + entry.bytes.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = createEndOfCentralDirectory({
    entryCount: entries.length,
    centralDirectorySize: centralDirectory.byteLength,
    centralDirectoryOffset: offset,
  });

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function createLocalFileHeader(input: { filename: Buffer; crc: number; size: number }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(input.crc, 14);
  header.writeUInt32LE(input.size, 18);
  header.writeUInt32LE(input.size, 22);
  header.writeUInt16LE(input.filename.byteLength, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, input.filename]);
}

function createCentralDirectoryHeader(input: {
  filename: Buffer;
  crc: number;
  size: number;
  localHeaderOffset: number;
}) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(input.crc, 16);
  header.writeUInt32LE(input.size, 20);
  header.writeUInt32LE(input.size, 24);
  header.writeUInt16LE(input.filename.byteLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(input.localHeaderOffset, 42);
  return Buffer.concat([header, input.filename]);
}

function createEndOfCentralDirectory(input: {
  entryCount: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
}) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(input.entryCount, 8);
  end.writeUInt16LE(input.entryCount, 10);
  end.writeUInt32LE(input.centralDirectorySize, 12);
  end.writeUInt32LE(input.centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function assertSafeZipEntryName(name: string) {
  if (
    name.startsWith("/") ||
    name.includes("..") ||
    name.includes("\\") ||
    /[\u0000-\u001f]/.test(name)
  ) {
    throw new Error("Invalid PPT narration export entry name.");
  }
}

function requireSafeId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function resolveAudioAssetBaseDir(baseDir?: string) {
  return baseDir ? resolve(baseDir) : DEFAULT_AUDIO_ASSET_DIR;
}

function ensureWithinBase(baseDir: string, targetPath: string) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new Error("Resolved PPT narration export path escapes the configured storage directory.");
  }
}
