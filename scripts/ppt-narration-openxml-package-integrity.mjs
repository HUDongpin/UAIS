#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename } from "node:path";
import { inflateRawSync } from "node:zlib";

try {
  const options = parseArgs(process.argv.slice(2));
  const packageData = readJson(options.packageJson, "package JSON");
  const packageSummary = summarizePackage(packageData);
  const narratedPptxBuffer = readFileSync(options.narratedPptx);
  const exportZipBuffer = readFileSync(options.exportZip);
  const manifest = readJson(options.manifest, "audio manifest");
  const pptxZip = readZipEntries(narratedPptxBuffer);
  const exportZip = readZipEntries(exportZipBuffer);
  const slideAudioRelations = inspectSlideAudioRelations(pptxZip, packageSummary.expectedSlideCount);
  const embeddedNarrationWavs = inspectEmbeddedNarrationWavs(
    pptxZip,
    packageSummary.expectedSlideCount,
  );
  const counts = {
    manifestAssets: Array.isArray(manifest.assets) ? manifest.assets.length : 0,
    pptxSlideXmls: countMatchingEntries(pptxZip, /^ppt\/slides\/slide\d+\.xml$/),
    pptxSlideRelationshipFiles: countMatchingEntries(
      pptxZip,
      /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/,
    ),
    pptxEmbeddedNarrationWavs: countMatchingEntries(
      pptxZip,
      /^ppt\/media\/kangxia_narration_slide_\d+\.wav$/i,
    ),
    pptxValidEmbeddedNarrationWavs: embeddedNarrationWavs.filter(
      (wav) => wav.status === "valid",
    ).length,
    pptxNonEmptyEmbeddedNarrationWavs: embeddedNarrationWavs.filter(
      (wav) => typeof wav.dataBytes === "number" && wav.dataBytes > 0,
    ).length,
    exportZipWavs: countMatchingEntries(exportZip, /\.wav$/i),
    ...(options.renderedPagesDir
      ? { renderedPageImages: countRenderedPageImages(options.renderedPagesDir) }
      : {}),
  };
  const narratedPptxFingerprint = fullSha256(narratedPptxBuffer);
  const packageArtifactFingerprintStatus = readPackageArtifactFingerprintStatus(
    packageSummary.artifactFingerprint,
    narratedPptxFingerprint,
  );
  const blockedReasons = collectBlockedReasons({
    counts,
    packageArtifactFingerprintStatus,
    expectedSlideCount: packageSummary.expectedSlideCount,
    slideAudioRelations,
    embeddedNarrationWavs,
  });
  const report = {
    target: "ppt-narration-openxml-package-integrity",
    status: blockedReasons.length === 0 ? "passed" : "blocked",
    checkedAt: new Date().toISOString(),
    responsibleSession: "S24",
    packageId: packageSummary.packageId,
    sourceDeckTitle: packageSummary.sourceDeckTitle,
    expectedSlideCount: packageSummary.expectedSlideCount,
    packageArtifactFingerprintStatus,
    artifacts: {
      narratedPptx: summarizeArtifact(
        options.narratedPptx,
        narratedPptxBuffer,
        readNarratedPptxFullFingerprintStatus(packageArtifactFingerprintStatus),
      ),
      exportZip: summarizeArtifact(options.exportZip, exportZipBuffer, "computed-and-redacted"),
      manifest: summarizeArtifact(
        options.manifest,
        readFileSync(options.manifest),
        "computed-and-redacted",
      ),
      ...(options.pdfRender
        ? {
            pdfRender: summarizeOptionalFileArtifact(options.pdfRender),
          }
        : {}),
      ...(options.contactSheet
        ? {
            contactSheet: summarizeOptionalFileArtifact(options.contactSheet),
          }
        : {}),
    },
    counts,
    slideAudioRelations,
    embeddedNarrationWavs,
    blockedReasons,
    manualAcceptanceStatus: "not-a-human-playback-record",
    safety: {
      secretsIncluded: false,
      rawAudioOmitted: true,
      localPrivatePathsOmitted: true,
      fullArtifactFingerprintsOmitted: true,
      machineIntegrityNotFinalManualAcceptance: true,
    },
  };

  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    writeFileSync(options.out, output);
  }
  process.stdout.write(output);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "PPTX integrity check failed."}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {
    packageJson: undefined,
    narratedPptx: undefined,
    exportZip: undefined,
    manifest: undefined,
    pdfRender: undefined,
    contactSheet: undefined,
    renderedPagesDir: undefined,
    out: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--package-json") {
      options.packageJson = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--narrated-pptx") {
      options.narratedPptx = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--export-zip") {
      options.exportZip = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--manifest") {
      options.manifest = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--pdf-render") {
      options.pdfRender = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--contact-sheet") {
      options.contactSheet = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--rendered-pages-dir") {
      options.renderedPagesDir = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--out") {
      options.out = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/ppt-narration-openxml-package-integrity.mjs --package-json PATH --narrated-pptx PATH --export-zip PATH --manifest PATH [--pdf-render PATH] [--contact-sheet PATH] [--rendered-pages-dir PATH] [--out PATH]",
          "",
          "Creates a redacted S24 OpenXML package-integrity report for a narrated PPTX. This is not final human PowerPoint/WPS playback acceptance.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error("Unknown option.");
    }
  }

  for (const [key, flag] of [
    ["packageJson", "--package-json"],
    ["narratedPptx", "--narrated-pptx"],
    ["exportZip", "--export-zip"],
    ["manifest", "--manifest"],
  ]) {
    if (!options[key]) {
      throw new Error(`${flag} is required.`);
    }
  }
  return options;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Unable to read ${label}.`);
  }
}

function summarizePackage(value) {
  if (!isRecord(value)) {
    throw new Error("Package JSON must be an object.");
  }
  const packageId = readNonEmptyString(value, "packageId");
  const sourceDeckTitle = readNonEmptyString(value, "sourceDeckTitle");
  const expectedSlideCount = readExpectedSlideCount(value);
  return {
    packageId,
    sourceDeckTitle,
    expectedSlideCount,
    artifactFingerprint:
      typeof value.artifactFingerprint === "string" && /^sha256:[a-f0-9]{64}$/.test(value.artifactFingerprint.trim())
        ? value.artifactFingerprint.trim()
        : undefined,
  };
}

function readExpectedSlideCount(value) {
  if (Number.isInteger(value.expectedSlideCount) && value.expectedSlideCount > 0) {
    return value.expectedSlideCount;
  }
  if (Array.isArray(value.slideScripts) && value.slideScripts.length > 0) {
    return value.slideScripts.length;
  }
  throw new Error("Package JSON requires a positive expectedSlideCount or slideScripts array.");
}

function readNonEmptyString(value, fieldName) {
  const field = value[fieldName];
  if (typeof field !== "string" || !field.trim()) {
    throw new Error(`Package JSON requires ${fieldName}.`);
  }
  return field.trim();
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP central directory is invalid.");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    entries.set(name, {
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      buffer,
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("ZIP end of central directory was not found.");
}

function readZipEntryText(zipEntries, name) {
  const entry = zipEntries.get(name);
  if (!entry) {
    return undefined;
  }
  return readZipEntryBuffer(entry).toString("utf8");
}

function readZipEntryBuffer(entry) {
  const { buffer, localHeaderOffset, compressedSize, method } = entry;
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("ZIP local file header is invalid.");
  }
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
  if (method === 0) {
    return compressed;
  }
  if (method === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error("Unsupported ZIP compression method.");
}

function inspectSlideAudioRelations(pptxZip, expectedSlideCount) {
  return Array.from({ length: expectedSlideCount }, (_, index) => {
    const slideNumber = index + 1;
    const paddedSlideNumber = String(slideNumber).padStart(2, "0");
    const relationshipFile = `slide${slideNumber}.xml.rels`;
    const relationshipPath = `ppt/slides/_rels/${relationshipFile}`;
    const expectedTarget = `../media/kangxia_narration_slide_${paddedSlideNumber}.wav`;
    const mediaPath = `ppt/media/kangxia_narration_slide_${paddedSlideNumber}.wav`;
    const relText = readZipEntryText(pptxZip, relationshipPath);
    const targets = relText ? readAudioTargets(relText) : [];
    const targetStatus = targets.includes(expectedTarget)
      ? pptxZip.has(mediaPath)
        ? "matched"
        : "media-missing"
      : targets.length > 0
        ? "mismatch"
        : "missing";
    return {
      slideId: `slide-${paddedSlideNumber}`,
      relationshipFile,
      expectedTarget,
      audioRelationship: targets.length > 0 ? "present" : "missing",
      targetStatus,
    };
  });
}

function readAudioTargets(relText) {
  return Array.from(relText.matchAll(/\bTarget="([^"]+\.wav)"/gi), (match) => match[1]);
}

function inspectEmbeddedNarrationWavs(pptxZip, expectedSlideCount) {
  return Array.from({ length: expectedSlideCount }, (_, index) => {
    const slideNumber = index + 1;
    const paddedSlideNumber = String(slideNumber).padStart(2, "0");
    const fileName = `kangxia_narration_slide_${paddedSlideNumber}.wav`;
    const mediaPath = `ppt/media/${fileName}`;
    const entry = pptxZip.get(mediaPath);
    if (!entry) {
      return {
        slideId: `slide-${paddedSlideNumber}`,
        fileName,
        status: "missing",
        container: "missing",
      };
    }
    return {
      slideId: `slide-${paddedSlideNumber}`,
      fileName,
      ...inspectWavBuffer(readZipEntryBuffer(entry)),
    };
  });
}

function inspectWavBuffer(buffer) {
  if (
    buffer.length < 12 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return {
      status: "invalid",
      container: "invalid",
    };
  }

  let offset = 12;
  let format;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) {
      return {
        status: "invalid",
        container: "RIFF/WAVE",
      };
    }

    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormatCode: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (!format) {
    return {
      status: "invalid",
      container: "RIFF/WAVE",
    };
  }

  const bytesPerSecond =
    format.sampleRate * format.channels * Math.max(format.bitsPerSample, 1) / 8;
  const durationSeconds =
    dataBytes > 0 && bytesPerSecond > 0
      ? Math.round((dataBytes / bytesPerSecond) * 1000) / 1000
      : 0;
  const audioFormat = format.audioFormatCode === 1 ? "pcm" : "unsupported";
  const status =
    audioFormat === "pcm" &&
    format.channels > 0 &&
    format.sampleRate > 0 &&
    format.bitsPerSample > 0 &&
    dataBytes > 0
      ? "valid"
      : "invalid";

  return {
    status,
    container: "RIFF/WAVE",
    audioFormat,
    channels: format.channels,
    sampleRate: format.sampleRate,
    bitsPerSample: format.bitsPerSample,
    dataBytes,
    durationSeconds,
  };
}

function countMatchingEntries(zipEntries, pattern) {
  let count = 0;
  for (const name of zipEntries.keys()) {
    if (pattern.test(name)) {
      count += 1;
    }
  }
  return count;
}

function countRenderedPageImages(path) {
  if (!existsSync(path)) {
    return 0;
  }
  return readdirSync(path).filter((fileName) => /\.(jpg|jpeg|png)$/i.test(fileName)).length;
}

function summarizeArtifact(path, buffer, fullFingerprintStatus) {
  return {
    status: "present",
    fileName: basename(path),
    sizeBytes: buffer.length,
    fingerprint: redactedSha256(buffer),
    fullFingerprintStatus,
    valueRedacted: true,
  };
}

function summarizeOptionalFileArtifact(path) {
  if (!existsSync(path)) {
    return {
      status: "missing",
      fileName: basename(path),
    };
  }
  const buffer = readFileSync(path);
  return {
    status: "present",
    fileName: basename(path),
    sizeBytes: statSync(path).size,
    fingerprint: redactedSha256(buffer),
    fullFingerprintStatus: "computed-and-redacted",
    valueRedacted: true,
  };
}

function collectBlockedReasons({
  counts,
  packageArtifactFingerprintStatus,
  expectedSlideCount,
  slideAudioRelations,
  embeddedNarrationWavs,
}) {
  const reasons = [];
  if (packageArtifactFingerprintStatus === "missing") {
    reasons.push("package-artifact-fingerprint-missing");
  } else if (packageArtifactFingerprintStatus === "mismatch") {
    reasons.push("package-artifact-fingerprint-mismatch");
  }
  if (counts.manifestAssets !== expectedSlideCount) {
    reasons.push("manifest-asset-count-mismatch");
  }
  if (counts.pptxSlideXmls !== expectedSlideCount) {
    reasons.push("pptx-slide-count-mismatch");
  }
  if (counts.pptxSlideRelationshipFiles !== expectedSlideCount) {
    reasons.push("pptx-slide-relationship-count-mismatch");
  }
  if (counts.pptxEmbeddedNarrationWavs !== expectedSlideCount) {
    reasons.push("pptx-embedded-narration-wav-count-mismatch");
  }
  if (counts.pptxValidEmbeddedNarrationWavs !== expectedSlideCount) {
    reasons.push("pptx-embedded-narration-wav-invalid");
  }
  if (counts.pptxNonEmptyEmbeddedNarrationWavs !== expectedSlideCount) {
    reasons.push("pptx-embedded-narration-wav-empty");
  }
  if (counts.exportZipWavs !== expectedSlideCount) {
    reasons.push("export-zip-wav-count-mismatch");
  }
  if (slideAudioRelations.some((relation) => relation.targetStatus === "mismatch")) {
    reasons.push("pptx-slide-audio-target-mismatch");
  }
  if (slideAudioRelations.some((relation) => relation.targetStatus === "missing")) {
    reasons.push("pptx-slide-audio-relationship-missing");
  }
  if (slideAudioRelations.some((relation) => relation.targetStatus === "media-missing")) {
    reasons.push("pptx-slide-audio-media-missing");
  }
  if (embeddedNarrationWavs.some((wav) => wav.status === "missing")) {
    reasons.push("pptx-embedded-narration-wav-missing");
  }
  return [...new Set(reasons)];
}

function readPackageArtifactFingerprintStatus(packageArtifactFingerprint, narratedPptxFingerprint) {
  if (!packageArtifactFingerprint) {
    return "missing";
  }
  return packageArtifactFingerprint === narratedPptxFingerprint ? "matched" : "mismatch";
}

function readNarratedPptxFullFingerprintStatus(packageArtifactFingerprintStatus) {
  if (packageArtifactFingerprintStatus === "matched") {
    return "matched-package-artifact";
  }
  if (packageArtifactFingerprintStatus === "mismatch") {
    return "mismatched-package-artifact";
  }
  return "package-artifact-missing";
}

function fullSha256(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function redactedSha256(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex").slice(0, 16)}`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
