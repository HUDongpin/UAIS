import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("PPT manual playback acceptance gate", () => {
  it("creates a manual PowerPoint/WPS acceptance checklist while keeping acceptance blocked", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const checklistPath = join(tmpDir, "manual-acceptance-checklist.md");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        expectedSlideCount: 3,
        teacherVoice: {
          teacherId: "teacher-kang",
          voiceRefId: "qwen-voice-ref-public-test",
          voiceRef: "server-side-cloned-qwen-voice",
        },
        slideScripts: [
          { slideId: "slide-01", narrationText: "Slide one narration." },
          { slideId: "slide-02", narrationText: "Slide two narration." },
          { slideId: "slide-03", narrationText: "Slide three narration." },
        ],
      }),
    );
    writeFileSync(
      preflightReport,
      [
        "# Kang Xia Narrated PPTX Playback Preflight",
        "",
        "S24 preflight status: `machine-preflight-passed`.",
        "",
        "Remaining QA gap: open the narrated PPTX in the target desktop presentation app.",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--out",
      checklistPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);
    const checklist = readFileSync(checklistPath, "utf8");

    expect(body).toEqual(
      expect.objectContaining({
        target: "ppt-manual-playback-acceptance",
        mode: "plan",
        status: "blocked",
        responsibleSession: "S24",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        expectedSlideCount: 3,
        machinePreflightStatus: "passed",
        manualAcceptanceStatus: "pending",
        blockedReasons: [
          "manual-PowerPoint-playback-not-recorded",
          "manual-WPS-playback-not-recorded",
        ],
        checklist: {
          fileName: "manual-acceptance-checklist.md",
          slideChecks: 3,
          requiredApplications: ["Microsoft PowerPoint", "WPS Presentation"],
        },
        safety: {
          valuesRedacted: true,
          secretsRedacted: true,
          cookieValuesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          remoteMutationRequiresApproval: true,
          localPrivatePathsOmitted: true,
          machinePreflightNotFinalAcceptance: true,
          rawAudioOmitted: true,
        },
      }),
    );
    expect(checklist).toContain("S24 Manual PPT Playback Acceptance Checklist");
    expect(checklist).toContain("Status: Pending manual PowerPoint/WPS playback");
    expect(checklist).toContain("Record status: accepted-after-human-playback");
    expect(checklist).toContain("- [ ] Slide 01 PowerPoint audio plays");
    expect(checklist).toContain("- [ ] Slide 03 WPS audio plays");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("qwen-voice-ref-public-test");
    expect(checklist).not.toContain("qwen-voice-ref-public-test");
  });

  it("binds enhanced OpenXML WAV integrity evidence before manual playback acceptance", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-openxml-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const openxmlIntegrity = join(tmpDir, "openxml-integrity.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        expectedSlideCount: 3,
        slideScripts: [
          { slideId: "slide-01", narrationText: "Slide one narration." },
          { slideId: "slide-02", narrationText: "Slide two narration." },
          { slideId: "slide-03", narrationText: "Slide three narration." },
        ],
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      openxmlIntegrity,
      JSON.stringify({
        target: "ppt-narration-openxml-package-integrity",
        status: "passed",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        expectedSlideCount: 3,
        counts: {
          pptxValidEmbeddedNarrationWavs: 3,
          pptxNonEmptyEmbeddedNarrationWavs: 3,
        },
        embeddedNarrationWavs: [
          { slideId: "slide-01", status: "valid", durationSeconds: 15.52 },
          { slideId: "slide-02", status: "valid", durationSeconds: 14.88 },
          { slideId: "slide-03", status: "valid", durationSeconds: 16.08 },
        ],
        safety: {
          rawAudioOmitted: true,
        },
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--openxml-integrity",
      openxmlIntegrity,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "ppt-manual-playback-acceptance",
        status: "blocked",
        machinePreflightStatus: "passed",
        openxmlIntegrityStatus: "passed",
        embeddedNarrationWavStatus: "passed",
        manualAcceptanceStatus: "pending",
        blockedReasons: [
          "manual-PowerPoint-playback-not-recorded",
          "manual-WPS-playback-not-recorded",
        ],
      }),
    );
    expect(body.openxmlIntegrityEvidence).toEqual({
      target: "ppt-narration-openxml-package-integrity",
      status: "passed",
      expectedSlideCount: 3,
      validEmbeddedNarrationWavs: 3,
      nonEmptyEmbeddedNarrationWavs: 3,
      rawAudioOmitted: true,
      valuesRedacted: true,
    });
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("writes a deployment-bound manual acceptance record template without accepting playback", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-record-template-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const templatePath = join(tmpDir, "manual-record-template.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expectedSlideCount: 2,
        pptAssetId: "natural-number-ordinal-theory-ppt1",
        teacherVoice: {
          targetVoiceLabel: "Kang Xia PPT narration voice",
          voiceRefId: "qwen-voice-ref-private-test",
        },
        slideScripts: [
          { slideId: "slide-01", narrationText: "Slide one narration." },
          { slideId: "slide-02", narrationText: "Slide two narration." },
        ],
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--release-run-id",
      "uais-production-chain-20260620",
      "--deployment-fingerprint",
      "sha256:7c8e0f8c7195d5b9",
      "--deployment-observed-at",
      "2026-06-20T10:00:00.000Z",
      "--record-template-out",
      templatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);
    const template = JSON.parse(readFileSync(templatePath, "utf8"));

    expect(body).toEqual(
      expect.objectContaining({
        target: "ppt-manual-playback-acceptance",
        mode: "plan",
        status: "blocked",
        manualAcceptanceStatus: "pending",
        manualRecordTemplate: {
          fileName: "manual-record-template.json",
          status: "created",
          accepted: false,
          applications: ["Microsoft PowerPoint", "WPS Presentation"],
          slideChecksPerApplication: 2,
          appVersionPrefillStatus: "not-prefilled",
          valuesRedacted: true,
        },
      }),
    );
    expect(template).toEqual(
      expect.objectContaining({
        recordType: "manual-ppt-playback-acceptance-template",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        releaseRunId: "uais-production-chain-20260620",
        deploymentFingerprint: "sha256:7c8e0f8c7195d5b9",
        deploymentObservedAt: "2026-06-20T10:00:00.000Z",
        artifactFingerprint:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "template-not-accepted",
        testedAt: "",
        tester: "",
      }),
    );
    expect(template.applications).toHaveLength(2);
    expect(template.applications[0]).toEqual(
      expect.objectContaining({
        name: "Microsoft PowerPoint",
        version: "",
        slideResults: [
          {
            slideNumber: 1,
            slideId: "slide-01",
            audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
            audioPlays: false,
            heardTargetVoice: false,
          },
          {
            slideNumber: 2,
            slideId: "slide-02",
            audioId: "tts_natural-number-ordinal-theory-ppt1_slide-02",
            audioPlays: false,
            heardTargetVoice: false,
          },
        ],
      }),
    );
    expect(template.applications[1].name).toBe("WPS Presentation");
    expect(template.instructions).toContain(
      "Change status to accepted-after-human-playback only after human playback passes in both target applications.",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("qwen-voice-ref-private-test");
    expect(JSON.stringify(template)).not.toContain("qwen-voice-ref-private-test");
  });

  it("prefills manual record app versions from desktop visual evidence without accepting playback", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-record-template-desktop-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const desktopEvidence = join(tmpDir, "desktop-evidence.json");
    const templatePath = join(tmpDir, "manual-record-template.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expectedSlideCount: 1,
        teacherVoice: {
          targetVoiceLabel: "Kang Xia PPT narration voice",
        },
        slideScripts: [{ slideId: "slide-01", narrationText: "Slide one narration." }],
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      desktopEvidence,
      JSON.stringify({
        target: "kangxia-ppt-desktop-app-open-visual-evidence",
        desktopApplicationEvidence: [
          {
            name: "Microsoft PowerPoint",
            version: "16.110",
            openedTargetDeck: true,
            slideShowWindowOpened: true,
            humanAuditoryPlaybackConfirmed: false,
          },
          {
            name: "WPS Presentation",
            applicationName: "WPS Office",
            version: "7.2.2",
            openedTargetDeck: true,
            slideShowWindowOpened: true,
            humanAuditoryPlaybackConfirmed: false,
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--desktop-app-evidence",
      desktopEvidence,
      "--record-template-out",
      templatePath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);
    const template = JSON.parse(readFileSync(templatePath, "utf8"));

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.manualRecordTemplate).toEqual(
      expect.objectContaining({
        appVersionPrefillStatus: "prefilled-from-desktop-visual-evidence",
        accepted: false,
      }),
    );
    expect(template.status).toBe("template-not-accepted");
    expect(template.testedAt).toBe("");
    expect(template.tester).toBe("");
    expect(template.applications[0]).toEqual(
      expect.objectContaining({
        name: "Microsoft PowerPoint",
        version: "16.110",
        slideResults: [
          {
            slideNumber: 1,
            slideId: "slide-01",
            audioPlays: false,
            heardTargetVoice: false,
          },
        ],
      }),
    );
    expect(template.applications[1]).toEqual(
      expect.objectContaining({
        name: "WPS Presentation",
        version: "7.2.2",
        slideResults: [
          {
            slideNumber: 1,
            slideId: "slide-01",
            audioPlays: false,
            heardTargetVoice: false,
          },
        ],
      }),
    );
    expect(template.instructions).toContain(
      "Desktop visual evidence may prefill application versions, but it does not prove audio playback.",
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("adds safe narrated PPTX review artifact paths to the manual checklist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-review-artifacts-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const checklistPath = join(tmpDir, "manual-acceptance-checklist.md");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        expectedSlideCount: 1,
        teacherVoice: {
          targetVoiceLabel: "Kang Xia PPT narration voice",
        },
        slideScripts: [
          { slideId: "slide-01", narrationText: "Slide one narration." },
        ],
      }),
    );
    writeFileSync(
      preflightReport,
      [
        "# Kang Xia Narrated PPTX Playback Preflight",
        "",
        "| Artifact | Relative path |",
        "| --- | --- |",
        "| Narrated PPTX | `.tmp/uais-ai-assets/ppt-narration-pptx/kangxia-narrated.pptx` |",
        "| ZIP export | `.tmp/uais-ai-assets/ppt-narration-exports/kangxia-ppt-narration.zip` |",
        "| Source voice sample | `/Users/example/private/source-voice.wav` |",
        "",
        "S24 preflight status: `machine-preflight-passed`.",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--out",
      checklistPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);
    const checklist = readFileSync(checklistPath, "utf8");

    expect(body.reviewArtifacts).toEqual([
      {
        kind: "narrated-pptx",
        label: "Narrated PPTX",
        relativePath: ".tmp/uais-ai-assets/ppt-narration-pptx/kangxia-narrated.pptx",
        fileName: "kangxia-narrated.pptx",
      },
      {
        kind: "zip-export",
        label: "ZIP export",
        relativePath: ".tmp/uais-ai-assets/ppt-narration-exports/kangxia-ppt-narration.zip",
        fileName: "kangxia-ppt-narration.zip",
      },
    ]);
    expect(body.checklist.reviewArtifacts).toBe(2);
    expect(checklist).toContain("## Artifacts To Open");
    expect(checklist).toContain("- Narrated PPTX: `.tmp/uais-ai-assets/ppt-narration-pptx/kangxia-narrated.pptx`");
    expect(checklist).toContain("- ZIP export: `.tmp/uais-ai-assets/ppt-narration-exports/kangxia-ppt-narration.zip`");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(checklist).not.toContain("/Users/");
    expect(checklist).not.toContain("source-voice.wav");
  });

  it("rejects manual acceptance when the narrated PPTX artifact fingerprint is not a full SHA-256 value", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-short-artifact-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:aaaa1111bbbb2222",
        expectedSlideCount: 1,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:aaaa1111bbbb2222",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [{ slideNumber: 1, audioPlays: true }],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [{ slideNumber: 1, audioPlays: true }],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.packageArtifactFingerprintStatus).toBe("missing");
    expect(body.manualRecordArtifactFingerprintStatus).toBe("missing");
    expect(body.blockedReasons).toEqual(["manual-record-artifact-fingerprint-missing"]);
    expect(output).not.toContain("sha256:aaaa1111bbbb2222");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("accepts only a complete manual record for every slide in both target apps", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-record-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        pptAssetId: "natural-number-ordinal-theory-ppt1",
        expectedSlideCount: 2,
        slideScripts: [
          { slideId: "slide-01", narrationText: "Slide one narration." },
          { slideId: "slide-02", narrationText: "Slide two narration." },
        ],
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              {
                slideNumber: 1,
                slideId: "slide-01",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
                audioPlays: true,
              },
              {
                slideNumber: 2,
                slideId: "slide-02",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-02",
                audioPlays: true,
              },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              {
                slideNumber: 1,
                slideId: "slide-01",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
                audioPlays: true,
              },
              {
                slideNumber: 2,
                slideId: "slide-02",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-02",
                audioPlays: true,
              },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("accepted");
    expect(body.manualAcceptanceStatus).toBe("accepted");
    expect(body.manualRecordEvidenceStatus).toBe("complete");
    expect(body.manualRecordPackageIdentityStatus).toBe("matched");
    expect(body.packageArtifactFingerprintStatus).toBe("present");
    expect(body.manualRecordArtifactFingerprintStatus).toBe("matched");
    expect(body.manualRecordTimingStatus).toBe("valid-past-or-present");
    expect(body.manualRecordConfirmationStatus).toBe("accepted-after-human-playback");
    expect(body.acceptedApplications).toEqual(["Microsoft PowerPoint", "WPS Presentation"]);
    expect(body.blockedReasons).toEqual([]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  });

  it("rejects manual records when slide playback is not bound to the expected slide and audio ids", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-slide-binding-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        pptAssetId: "natural-number-ordinal-theory-ppt1",
        expectedSlideCount: 2,
        slideScripts: [
          { slideId: "slide-01", narrationText: "Slide one narration." },
          { slideId: "slide-02", narrationText: "Slide two narration." },
        ],
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              {
                slideNumber: 1,
                slideId: "slide-01",
                audioId: "tts_other-deck_slide-01",
                audioPlays: true,
              },
              {
                slideNumber: 2,
                slideId: "slide-02",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-02",
                audioPlays: true,
              },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              {
                slideNumber: 1,
                slideId: "slide-01",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
                audioPlays: true,
              },
              {
                slideNumber: 2,
                slideId: "slide-02",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-02",
                audioPlays: true,
              },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.acceptedApplications).toEqual(["WPS Presentation"]);
    expect(body.blockedReasons).toEqual(["manual-PowerPoint-playback-not-recorded"]);
    expect(output).not.toContain("tts_other-deck_slide-01");
    expect(output).not.toContain("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects manual records that do not confirm the target cloned voice per slide", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-target-voice-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        pptAssetId: "natural-number-ordinal-theory-ppt1",
        expectedSlideCount: 1,
        teacherVoice: {
          targetVoiceLabel: "Kang Xia PPT narration voice",
        },
        slideScripts: [
          { slideId: "slide-01", narrationText: "Slide one narration." },
        ],
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              {
                slideNumber: 1,
                slideId: "slide-01",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
                audioPlays: true,
                heardTargetVoice: false,
              },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              {
                slideNumber: 1,
                slideId: "slide-01",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
                audioPlays: true,
                heardTargetVoice: true,
              },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.acceptedApplications).toEqual(["WPS Presentation"]);
    expect(body.blockedReasons).toEqual(["manual-PowerPoint-playback-not-recorded"]);
    expect(output).not.toContain("Kang Xia PPT narration voice");
    expect(output).not.toContain("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects teacher-voice manual records when the package omits a target voice label", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-target-label-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        pptAssetId: "natural-number-ordinal-theory-ppt1",
        expectedSlideCount: 1,
        teacherVoice: {
          teacherId: "teacher-kang",
          voiceRefId: "qwen-voice-ref-public-test",
          voiceRef: "server-side-cloned-qwen-voice",
        },
        slideScripts: [
          { slideId: "slide-01", narrationText: "Slide one narration." },
        ],
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              {
                slideNumber: 1,
                slideId: "slide-01",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
                audioPlays: true,
                heardTargetVoice: true,
              },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              {
                slideNumber: 1,
                slideId: "slide-01",
                audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
                audioPlays: true,
                heardTargetVoice: true,
              },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.packageTargetVoiceLabelStatus).toBe("missing");
    expect(body.manualRecordEvidenceStatus).toBe("target-voice-label-missing");
    expect(body.acceptedApplications).toEqual([]);
    expect(body.blockedReasons).toEqual(["manual-record-target-voice-label-missing"]);
    expect(output).not.toContain("qwen-voice-ref-public-test");
    expect(output).not.toContain("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("binds accepted manual records to the requested production deployment fingerprint", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-deployment-fingerprint-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
          sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
          artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          teacherVoice: { targetVoiceLabel: "Kang Xia PPT narration voice" },
          expectedSlideCount: 2,
        }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        deploymentFingerprint: "sha256:1111222233334444",
        releaseRunId: "uais-release-current",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
              name: "Microsoft PowerPoint",
              version: "manual-test-version",
              slideResults: [
                { slideNumber: 1, audioPlays: true, heardTargetVoice: true },
                { slideNumber: 2, audioPlays: true, heardTargetVoice: true },
              ],
            },
            {
              name: "WPS Presentation",
              version: "manual-test-version",
              slideResults: [
                { slideNumber: 1, audioPlays: true, heardTargetVoice: true },
                { slideNumber: 2, audioPlays: true, heardTargetVoice: true },
              ],
            },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
      "--release-run-id",
      "uais-release-current",
      "--deployment-fingerprint",
      "sha256:1111222233334444",
      "--deployment-observed-at",
      "2026-06-17T07:00:00.000Z",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("accepted");
    expect(body.manualAcceptanceStatus).toBe("accepted");
    expect(body.deploymentFingerprint).toEqual({
      status: "present",
      value: "sha256:1111222233334444",
    });
    expect(body.manualRecordDeploymentFingerprintStatus).toBe("matched");
    expect(body.manualRecordAfterDeploymentStatus).toBe("proved");
    expect(body.blockedReasons).toEqual([]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  });

  it("derives release-run, fingerprint, and observation time from Vercel production deployment evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-vercel-deployment-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    const vercelProductionDeployment = join(tmpDir, "vercel-production-deployment.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
          packageId: "kangxia-natural-number-ordinal-theory-v1",
          sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
          artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          teacherVoice: { targetVoiceLabel: "Kang Xia PPT narration voice" },
          expectedSlideCount: 2,
        }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      vercelProductionDeployment,
      JSON.stringify({
        target: "vercel-production-deployment",
        mode: "live",
        environment: "production",
        status: "deployed",
        releaseRunId: "uais-release-current",
        deploymentFingerprint: {
          status: "present",
          value: "sha256:1111222233334444",
        },
        deploymentObservation: {
          status: "observed",
          observedAt: "2026-06-17T07:00:00.000Z",
          source: "harness-clock",
        },
      }),
    );
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        deploymentFingerprint: "sha256:1111222233334444",
        releaseRunId: "uais-release-current",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
              name: "Microsoft PowerPoint",
              version: "manual-test-version",
              slideResults: [
                { slideNumber: 1, audioPlays: true, heardTargetVoice: true },
                { slideNumber: 2, audioPlays: true, heardTargetVoice: true },
              ],
            },
            {
              name: "WPS Presentation",
              version: "manual-test-version",
              slideResults: [
                { slideNumber: 1, audioPlays: true, heardTargetVoice: true },
                { slideNumber: 2, audioPlays: true, heardTargetVoice: true },
              ],
            },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
      "--vercel-production-deployment",
      vercelProductionDeployment,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("accepted");
    expect(body.environment).toBe("production");
    expect(body.releaseRunId).toBe("uais-release-current");
      expect(body.deploymentFingerprint).toEqual({
        status: "present",
        value: "sha256:1111222233334444",
      });
      expect(body.deploymentEvidenceSource).toBe("vercel-production-deployment");
      expect(body.deploymentObservationBindingStatus).toBe("proved");
      expect(body.manualRecordReleaseRunStatus).toBe("matched");
      expect(body.manualRecordDeploymentFingerprintStatus).toBe("matched");
      expect(body.manualRecordAfterDeploymentStatus).toBe("proved");
      expect(body.results).toEqual({
        manualPptMachinePreflightPassed: "passed",
        manualPptOpenxmlIntegrityPassed: "passed",
        manualPptRecordEvidenceComplete: "passed",
        manualPptPackageIdentityMatched: "passed",
        manualPptArtifactFingerprintMatched: "passed",
        manualPptTimingValid: "passed",
        manualPptHumanConfirmationAccepted: "passed",
        manualPptTargetVoiceLabelPresent: "passed",
        manualPptPowerPointPlaybackAccepted: "passed",
        manualPptWpsPlaybackAccepted: "passed",
        manualPptReleaseRunBound: "passed",
        manualPptDeploymentFingerprintBound: "passed",
        manualPptTestedAfterDeployment: "passed",
        manualPptDeploymentEvidenceSourceProduction: "passed",
        manualPptSafetyRedacted: "passed",
      });
      expect(body.blockedReasons).toEqual([]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(output).not.toContain("2026-06-17T07:00:00.000Z");
    expect(output).not.toContain("2026-06-17T08:00:00.000Z");
  });

  it("rejects non-production Vercel deployment evidence before binding manual acceptance", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-vercel-preview-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    const vercelProductionDeployment = join(tmpDir, "vercel-production-deployment.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        expectedSlideCount: 2,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      vercelProductionDeployment,
      JSON.stringify({
        target: "vercel-production-deployment",
        mode: "live",
        environment: "preview",
        status: "deployed",
        releaseRunId: "uais-release-current",
        deploymentFingerprint: {
          status: "present",
          value: "sha256:1111222233334444",
        },
        deploymentObservation: {
          status: "observed",
          observedAt: "2026-06-17T07:00:00.000Z",
          source: "harness-clock",
        },
      }),
    );
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        deploymentFingerprint: "sha256:1111222233334444",
        releaseRunId: "uais-release-current",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
        ],
      }),
    );

    expect(() =>
      execFileSync("node", [
        "scripts/ppt-manual-playback-acceptance.mjs",
        "--package-json",
        packageJson,
        "--preflight-report",
        preflightReport,
        "--manual-record",
        manualRecord,
        "--vercel-production-deployment",
        vercelProductionDeployment,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow("live production deployment evidence");
  });

  it("rejects production release manual records without deployment observed time proof", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-deployment-time-required-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        expectedSlideCount: 2,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        deploymentFingerprint: "sha256:1111222233334444",
        releaseRunId: "uais-release-current",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
      "--release-run-id",
      "uais-release-current",
      "--deployment-fingerprint",
      "sha256:1111222233334444",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.manualRecordEvidenceStatus).toBe("deployment-observed-at-missing");
    expect(body.manualRecordReleaseRunStatus).toBe("matched");
    expect(body.manualRecordDeploymentFingerprintStatus).toBe("matched");
    expect(body.manualRecordAfterDeploymentStatus).toBe("missing");
    expect(body.acceptedApplications).toEqual([]);
    expect(body.blockedReasons).toEqual(["manual-record-deployment-observed-at-missing"]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("2026-06-17T08:00:00.000Z");
  });

  it("rejects production release manual records without expected deployment fingerprint binding", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-release-deployment-required-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        expectedSlideCount: 2,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        releaseRunId: "uais-release-current",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
      "--release-run-id",
      "uais-release-current",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.manualRecordEvidenceStatus).toBe("deployment-fingerprint-missing");
    expect(body.manualRecordReleaseRunStatus).toBe("matched");
    expect(body.manualRecordDeploymentFingerprintStatus).toBe("missing");
    expect(body.acceptedApplications).toEqual([]);
    expect(body.blockedReasons).toEqual(["manual-record-deployment-fingerprint-missing"]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  });

  it("rejects complete manual records that are not bound to the requested release run", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-release-run-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        expectedSlideCount: 2,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "accepted-after-human-playback",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
      "--release-run-id",
      "uais-release-current",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.manualRecordEvidenceStatus).toBe("release-run-missing");
    expect(body.manualRecordReleaseRunStatus).toBe("missing");
    expect(body.acceptedApplications).toEqual([]);
    expect(body.blockedReasons).toEqual(["manual-record-release-run-missing"]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
    expect(output).not.toContain("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  });

  it("rejects complete manual records from a different PPT artifact fingerprint", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-artifact-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        expectedSlideCount: 2,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.manualRecordEvidenceStatus).toBe("artifact-mismatch");
    expect(body.packageArtifactFingerprintStatus).toBe("present");
    expect(body.manualRecordArtifactFingerprintStatus).toBe("mismatch");
    expect(body.acceptedApplications).toEqual([]);
    expect(body.blockedReasons).toEqual(["manual-record-artifact-fingerprint-mismatch"]);
    expect(output).not.toContain("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(output).not.toContain("sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects slide-complete manual records that keep the template-not-accepted status", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-confirmation-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        expectedSlideCount: 2,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        status: "template-not-accepted",
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        artifactFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.manualRecordEvidenceStatus).toBe("confirmation-missing");
    expect(body.manualRecordConfirmationStatus).toBe("template-not-accepted");
    expect(body.acceptedApplications).toEqual([]);
    expect(body.blockedReasons).toEqual(["manual-record-human-confirmation-missing"]);
    expect(output).not.toContain("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects slide-complete manual records with a future tested-at timestamp", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-future-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        expectedSlideCount: 2,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        testedAt: "2999-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.manualRecordEvidenceStatus).toBe("incomplete");
    expect(body.manualRecordTimingStatus).toBe("future");
    expect(body.acceptedApplications).toEqual([]);
    expect(body.blockedReasons).toEqual([
      "manual-record-tested-at-in-future",
      "manual-PowerPoint-playback-not-recorded",
      "manual-WPS-playback-not-recorded",
    ]);
    expect(output).not.toContain("2999-06-17");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects slide-complete manual records without tester, timestamp, and app-version evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-metadata-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        expectedSlideCount: 2,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        testedAt: "",
        tester: "",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
          {
            name: "WPS Presentation",
            version: "",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.manualRecordEvidenceStatus).toBe("incomplete");
    expect(body.manualRecordTimingStatus).toBe("missing");
    expect(body.acceptedApplications).toEqual([]);
    expect(body.blockedReasons).toEqual([
      "manual-record-metadata-incomplete",
      "manual-PowerPoint-playback-not-recorded",
      "manual-WPS-playback-not-recorded",
    ]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects complete manual records without package identity evidence", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-package-missing-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        expectedSlideCount: 2,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.manualRecordEvidenceStatus).toBe("identity-missing");
    expect(body.manualRecordPackageIdentityStatus).toBe("missing");
    expect(body.acceptedApplications).toEqual([]);
    expect(body.blockedReasons).toEqual(["manual-record-package-identity-missing"]);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("rejects complete manual records from a different PPT package", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-acceptance-package-id-"));
    const packageJson = join(tmpDir, "package.json");
    const preflightReport = join(tmpDir, "preflight.md");
    const manualRecord = join(tmpDir, "manual-record.json");
    writeFileSync(
      packageJson,
      JSON.stringify({
        packageId: "kangxia-natural-number-ordinal-theory-v1",
        sourceDeckTitle: "Kang Xia natural number ordinal theory deck.pptx",
        expectedSlideCount: 2,
      }),
    );
    writeFileSync(preflightReport, "S24 preflight status: `machine-preflight-passed`.");
    writeFileSync(
      manualRecord,
      JSON.stringify({
        packageId: "different-ppt-package-v1",
        sourceDeckTitle: "Different deck.pptx",
        testedAt: "2026-06-17T08:00:00.000Z",
        tester: "S24 manual QA",
        applications: [
          {
            name: "Microsoft PowerPoint",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
          {
            name: "WPS Presentation",
            version: "manual-test-version",
            slideResults: [
              { slideNumber: 1, audioPlays: true },
              { slideNumber: 2, audioPlays: true },
            ],
          },
        ],
      }),
    );

    const output = execFileSync("node", [
      "scripts/ppt-manual-playback-acceptance.mjs",
      "--package-json",
      packageJson,
      "--preflight-report",
      preflightReport,
      "--manual-record",
      manualRecord,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.manualAcceptanceStatus).toBe("pending");
    expect(body.manualRecordEvidenceStatus).toBe("mismatch");
    expect(body.manualRecordPackageIdentityStatus).toBe("mismatch");
    expect(body.acceptedApplications).toEqual([]);
    expect(body.blockedReasons).toContain("manual-record-package-mismatch");
    expect(output).not.toContain("different-ppt-package-v1");
    expect(output).not.toContain("Different deck.pptx");
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});
