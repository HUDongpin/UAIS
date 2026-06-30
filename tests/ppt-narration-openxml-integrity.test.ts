import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("PPT narration OpenXML package integrity", () => {
  it("creates a redacted integrity report for a narrated PPTX package", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-openxml-integrity-"));
    const narratedPptx = join(tmpDir, "kangxia-narrated.pptx");
    const exportZip = join(tmpDir, "kangxia-export.zip");
    const manifestPath = join(tmpDir, "manifest.json");
    const packageJson = join(tmpDir, "package.json");
    const pdfRender = join(tmpDir, "render.pdf");
    const contactSheet = join(tmpDir, "contact-sheet.jpg");

    writeFileSync(narratedPptx, createStoredZip(createNarratedPptxEntries()));
    writeFileSync(exportZip, createStoredZip(createExportZipEntries()));
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "audio-manifest-test",
        assets: [
          { slideId: "slide-01", audioId: "tts_unit_slide-01", format: "wav" },
          { slideId: "slide-02", audioId: "tts_unit_slide-02", format: "wav" },
        ],
      }),
    );
    writeFileSync(pdfRender, "pdf-render-fixture");
    writeFileSync(contactSheet, "contact-sheet-fixture");
    const fullArtifactFingerprint = `sha256:${createHash("sha256")
      .update(createStoredZip(createNarratedPptxEntries()))
      .digest("hex")}`;
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: fullArtifactFingerprint,
        expectedSlideCount: 2,
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-narration-openxml-package-integrity.mjs",
      "--package-json",
      packageJson,
      "--narrated-pptx",
      narratedPptx,
      "--export-zip",
      exportZip,
      "--manifest",
      manifestPath,
      "--pdf-render",
      pdfRender,
      "--contact-sheet",
      contactSheet,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "ppt-narration-openxml-package-integrity",
        status: "passed",
        responsibleSession: "S24",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        expectedSlideCount: 2,
        packageArtifactFingerprintStatus: "matched",
        manualAcceptanceStatus: "not-a-human-playback-record",
        counts: {
          manifestAssets: 2,
          pptxSlideXmls: 2,
          pptxSlideRelationshipFiles: 2,
          pptxEmbeddedNarrationWavs: 2,
          pptxValidEmbeddedNarrationWavs: 2,
          pptxNonEmptyEmbeddedNarrationWavs: 2,
          exportZipWavs: 2,
        },
        safety: {
          secretsIncluded: false,
          rawAudioOmitted: true,
          localPrivatePathsOmitted: true,
          fullArtifactFingerprintsOmitted: true,
          machineIntegrityNotFinalManualAcceptance: true,
        },
      }),
    );
    expect(body.artifacts.narratedPptx).toEqual(
      expect.objectContaining({
        status: "present",
        fileName: "kangxia-narrated.pptx",
        fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
        fullFingerprintStatus: "matched-package-artifact",
        valueRedacted: true,
      }),
    );
    expect(body.slideAudioRelations).toEqual([
      expect.objectContaining({
        slideId: "slide-01",
        expectedTarget: "../media/kangxia_narration_slide_01.wav",
        audioRelationship: "present",
        targetStatus: "matched",
      }),
      expect.objectContaining({
        slideId: "slide-02",
        expectedTarget: "../media/kangxia_narration_slide_02.wav",
        audioRelationship: "present",
        targetStatus: "matched",
      }),
    ]);
    expect(body.embeddedNarrationWavs).toEqual([
      expect.objectContaining({
        slideId: "slide-01",
        fileName: "kangxia_narration_slide_01.wav",
        status: "valid",
        container: "RIFF/WAVE",
        audioFormat: "pcm",
        channels: 1,
        sampleRate: 24000,
        bitsPerSample: 16,
        dataBytes: expect.any(Number),
        durationSeconds: expect.any(Number),
      }),
      expect.objectContaining({
        slideId: "slide-02",
        fileName: "kangxia_narration_slide_02.wav",
        status: "valid",
        container: "RIFF/WAVE",
        audioFormat: "pcm",
        channels: 1,
        sampleRate: 24000,
        bitsPerSample: 16,
        dataBytes: expect.any(Number),
        durationSeconds: expect.any(Number),
      }),
    ]);
    expect(body.embeddedNarrationWavs[0].durationSeconds).toBeGreaterThan(0);
    expect(output).not.toContain(fullArtifactFingerprint);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks integrity when a slide audio relationship targets the wrong WAV", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-openxml-integrity-blocked-"));
    const narratedPptx = join(tmpDir, "kangxia-narrated.pptx");
    const exportZip = join(tmpDir, "kangxia-export.zip");
    const manifestPath = join(tmpDir, "manifest.json");
    const packageJson = join(tmpDir, "package.json");

    writeFileSync(narratedPptx, createStoredZip(createNarratedPptxEntries({ badSecondTarget: true })));
    writeFileSync(exportZip, createStoredZip(createExportZipEntries()));
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "audio-manifest-test",
        assets: [
          { slideId: "slide-01", audioId: "tts_unit_slide-01", format: "wav" },
          { slideId: "slide-02", audioId: "tts_unit_slide-02", format: "wav" },
        ],
      }),
    );
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        expectedSlideCount: 2,
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-narration-openxml-package-integrity.mjs",
      "--package-json",
      packageJson,
      "--narrated-pptx",
      narratedPptx,
      "--export-zip",
      exportZip,
      "--manifest",
      manifestPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.blockedReasons).toContain("pptx-slide-audio-target-mismatch");
    expect(body.slideAudioRelations[1]).toEqual(
      expect.objectContaining({
        slideId: "slide-02",
        audioRelationship: "present",
        targetStatus: "mismatch",
      }),
    );
    expect(output).not.toContain("wrong_file.wav");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("blocks integrity when an embedded narration WAV is malformed", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-openxml-invalid-wav-"));
    const narratedPptx = join(tmpDir, "kangxia-narrated.pptx");
    const exportZip = join(tmpDir, "kangxia-export.zip");
    const manifestPath = join(tmpDir, "manifest.json");
    const packageJson = join(tmpDir, "package.json");

    writeFileSync(narratedPptx, createStoredZip(createNarratedPptxEntries({ badSecondWav: true })));
    writeFileSync(exportZip, createStoredZip(createExportZipEntries()));
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: "audio-manifest-test",
        assets: [
          { slideId: "slide-01", audioId: "tts_unit_slide-01", format: "wav" },
          { slideId: "slide-02", audioId: "tts_unit_slide-02", format: "wav" },
        ],
      }),
    );
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        expectedSlideCount: 2,
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-narration-openxml-package-integrity.mjs",
      "--package-json",
      packageJson,
      "--narrated-pptx",
      narratedPptx,
      "--export-zip",
      exportZip,
      "--manifest",
      manifestPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.counts.pptxValidEmbeddedNarrationWavs).toBe(1);
    expect(body.blockedReasons).toContain("pptx-embedded-narration-wav-invalid");
    expect(body.embeddedNarrationWavs[1]).toEqual(
      expect.objectContaining({
        slideId: "slide-02",
        status: "invalid",
        container: "invalid",
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});

function createNarratedPptxEntries(options: { badSecondTarget?: boolean; badSecondWav?: boolean } = {}) {
  const slideOneTarget = "../media/kangxia_narration_slide_01.wav";
  const slideTwoTarget = options.badSecondTarget
    ? "../media/wrong_file.wav"
    : "../media/kangxia_narration_slide_02.wav";
  return new Map([
    ["ppt/slides/slide1.xml", Buffer.from("<p:sld />")],
    ["ppt/slides/slide2.xml", Buffer.from("<p:sld />")],
    ["ppt/slides/_rels/slide1.xml.rels", Buffer.from(createSlideRels(slideOneTarget))],
    ["ppt/slides/_rels/slide2.xml.rels", Buffer.from(createSlideRels(slideTwoTarget))],
    ["ppt/media/kangxia_narration_slide_01.wav", createTinyWav()],
    ["ppt/media/kangxia_narration_slide_02.wav", options.badSecondWav ? Buffer.from("not-a-wav") : createTinyWav()],
  ]);
}

function createExportZipEntries() {
  return new Map([
    ["README.md", Buffer.from("Kang Xia narration export")],
    ["manifest.json", Buffer.from("{}")],
    ["audio/tts_unit_slide-01.wav", createTinyWav()],
    ["audio/tts_unit_slide-02.wav", createTinyWav()],
  ]);
}

function createSlideRels(target: string) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio" Target="${target}"/>`,
    "</Relationships>",
  ].join("");
}

function createTinyWav() {
  const dataBytes = 4800;
  const header = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0xc0, 0x5d, 0x00, 0x00, 0x80, 0xbb, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
    0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
  ]);
  const data = Buffer.alloc(dataBytes);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, data]);
}

function createStoredZip(entries: Map<string, Buffer>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name);
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + content.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.size, 8);
  eocd.writeUInt16LE(entries.size, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function crc32(input: Buffer) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
