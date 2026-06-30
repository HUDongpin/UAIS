#!/usr/bin/env node

import { basename } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const requiredApplications = ["Microsoft PowerPoint", "WPS Presentation"];

try {
  const options = parseArgs(process.argv.slice(2));
  const deploymentBinding = readDeploymentBinding(options);
  const packageData = readJson(options.packageJson, "package JSON");
  const preflightText = readFileSync(options.preflightReport, "utf8");
  const packageSummary = summarizePackage(packageData);
  const machinePreflightStatus = detectMachinePreflightStatus(preflightText);
  const openxmlIntegrity = options.openxmlIntegrity
    ? evaluateOpenxmlIntegrity(
        readJson(options.openxmlIntegrity, "OpenXML integrity evidence"),
        packageSummary,
      )
    : createMissingOpenxmlIntegrity();
  const reviewArtifacts = collectReviewArtifacts(preflightText);
  const manualRecord = options.manualRecord
    ? readJson(options.manualRecord, "manual acceptance record")
    : undefined;
  const manualAcceptance = manualRecord
    ? evaluateManualRecord(
        manualRecord,
        packageSummary,
        deploymentBinding.releaseRunId,
        deploymentBinding.deploymentFingerprint,
        deploymentBinding.deploymentObservedAt,
      )
    : createPendingManualAcceptance(
        deploymentBinding.releaseRunId,
        deploymentBinding.deploymentFingerprint,
      );
  const manualRecordTemplate = options.recordTemplateOut
    ? createManualRecordTemplate(
        packageSummary,
        deploymentBinding,
        readDesktopAppEvidenceVersionPrefill(options),
      )
    : undefined;
  const status =
    machinePreflightStatus === "passed" &&
    openxmlIntegrity.acceptanceGateStatus !== "blocked" &&
    manualAcceptance.status === "accepted"
      ? "accepted"
      : "blocked";
  const blockedReasons = [
    ...(machinePreflightStatus === "passed" ? [] : ["machine-preflight-not-passed"]),
    ...openxmlIntegrity.blockedReasons,
    ...manualAcceptance.blockedReasons,
  ];

  if (options.out) {
    writeFileSync(
      options.out,
      createChecklistMarkdown({
        packageSummary,
        machinePreflightStatus,
        reviewArtifacts,
      }),
    );
  }
  if (options.recordTemplateOut) {
    writeFileSync(options.recordTemplateOut, `${JSON.stringify(manualRecordTemplate, null, 2)}\n`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        target: "ppt-manual-playback-acceptance",
        mode: manualRecord ? "record" : "plan",
        ...(deploymentBinding.source === "vercel-production-deployment"
          ? { environment: "production" }
          : {}),
        status,
        responsibleSession: "S24",
        ...(deploymentBinding.releaseRunId ? { releaseRunId: deploymentBinding.releaseRunId } : {}),
        ...(deploymentBinding.deploymentFingerprint
          ? {
              deploymentFingerprint: {
                status: "present",
                value: deploymentBinding.deploymentFingerprint,
              },
            }
          : {}),
        deploymentEvidenceSource: deploymentBinding.source,
        deploymentObservationBindingStatus: deploymentBinding.observationBindingStatus,
        packageId: packageSummary.packageId,
        sourceDeckTitle: packageSummary.sourceDeckTitle,
        packageArtifactFingerprintStatus: packageSummary.artifactFingerprint ? "present" : "missing",
        packageTargetVoiceLabelStatus: packageSummary.targetVoiceLabelStatus,
        expectedSlideCount: packageSummary.expectedSlideCount,
        ...(reviewArtifacts.length > 0 ? { reviewArtifacts } : {}),
        machinePreflightStatus,
        openxmlIntegrityStatus: openxmlIntegrity.status,
        embeddedNarrationWavStatus: openxmlIntegrity.embeddedNarrationWavStatus,
        ...(openxmlIntegrity.evidence
          ? { openxmlIntegrityEvidence: openxmlIntegrity.evidence }
          : {}),
        manualAcceptanceStatus: manualAcceptance.status,
        manualRecordEvidenceStatus: manualAcceptance.recordEvidenceStatus,
        manualRecordPackageIdentityStatus: manualAcceptance.packageIdentityStatus,
        manualRecordArtifactFingerprintStatus: manualAcceptance.artifactFingerprintStatus,
        manualRecordReleaseRunStatus: manualAcceptance.releaseRunStatus,
        manualRecordDeploymentFingerprintStatus: manualAcceptance.deploymentFingerprintStatus,
        manualRecordAfterDeploymentStatus: manualAcceptance.afterDeploymentStatus,
        manualRecordTimingStatus: manualAcceptance.timingStatus,
        manualRecordConfirmationStatus: manualAcceptance.confirmationStatus,
        acceptedApplications: manualAcceptance.acceptedApplications,
        results: createManualPlaybackAcceptanceResults({
          machinePreflightStatus,
          openxmlIntegrity,
          manualAcceptance,
          packageSummary,
          deploymentBinding,
        }),
        blockedReasons,
        ...(options.recordTemplateOut
          ? {
              manualRecordTemplate: {
                fileName: basename(options.recordTemplateOut),
                status: "created",
                accepted: false,
                applications: requiredApplications,
                slideChecksPerApplication: packageSummary.expectedSlideCount,
                appVersionPrefillStatus: readAppVersionPrefillStatus(manualRecordTemplate),
                valuesRedacted: true,
              },
            }
          : {}),
        checklist: {
          fileName: options.out ? basename(options.out) : undefined,
          slideChecks: packageSummary.expectedSlideCount,
          requiredApplications,
          ...(reviewArtifacts.length > 0 ? { reviewArtifacts: reviewArtifacts.length } : {}),
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
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "PPT acceptance gate failed."}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {
    packageJson: undefined,
    preflightReport: undefined,
    out: undefined,
    manualRecord: undefined,
    recordTemplateOut: undefined,
    desktopAppEvidence: undefined,
    openxmlIntegrity: undefined,
    releaseRunId: undefined,
    deploymentFingerprint: undefined,
    deploymentObservedAt: undefined,
    vercelProductionDeployment: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--package-json") {
      options.packageJson = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--preflight-report") {
      options.preflightReport = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--out") {
      options.out = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--manual-record") {
      options.manualRecord = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--record-template-out") {
      options.recordTemplateOut = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--desktop-app-evidence") {
      options.desktopAppEvidence = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--openxml-integrity") {
      options.openxmlIntegrity = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = normalizeReleaseRunId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--deployment-fingerprint") {
      options.deploymentFingerprint = normalizeDeploymentFingerprint(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--deployment-observed-at") {
      options.deploymentObservedAt = normalizeDeploymentObservedAt(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--vercel-production-deployment") {
      options.vercelProductionDeployment = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/ppt-manual-playback-acceptance.mjs --package-json PATH --preflight-report PATH [--out PATH] [--manual-record PATH] [--openxml-integrity PATH] [--desktop-app-evidence PATH] [--release-run-id ID] [--deployment-fingerprint sha256:...] [--deployment-observed-at ISO_TIMESTAMP] [--vercel-production-deployment PATH]",
          "       add [--record-template-out PATH] to write a prefilled non-accepted manual record template.",
          "",
          "Creates a redacted S24 PowerPoint/WPS manual playback acceptance gate. Machine preflight never counts as final manual acceptance.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error("Unknown option.");
    }
  }

  if (!options.packageJson) {
    throw new Error("--package-json is required.");
  }
  if (!options.preflightReport) {
    throw new Error("--preflight-report is required.");
  }

  return options;
}

function readDeploymentBinding(options) {
  if (!options.vercelProductionDeployment) {
    return {
      releaseRunId: options.releaseRunId,
      deploymentFingerprint: options.deploymentFingerprint,
      deploymentObservedAt: options.deploymentObservedAt,
      source: options.deploymentFingerprint || options.deploymentObservedAt ? "command-options" : "missing",
      observationBindingStatus: options.deploymentObservedAt ? "proved" : "missing",
    };
  }

  const evidence = readJson(options.vercelProductionDeployment, "Vercel production deployment evidence");
  const binding = readVercelProductionDeploymentBinding(evidence);
  if (!binding.releaseRunId || !binding.deploymentFingerprint || !binding.deploymentObservedAt) {
    throw new Error("Vercel production deployment evidence is incomplete.");
  }
  return binding;
}

function readVercelProductionDeploymentBinding(evidence) {
  if (!isRecord(evidence)) {
    throw new Error("Vercel production deployment evidence must be an object.");
  }
  if (
    evidence.target !== "vercel-production-deployment" ||
    evidence.mode !== "live" ||
    evidence.environment !== "production" ||
    evidence.status !== "deployed"
  ) {
    throw new Error("Vercel production deployment evidence must be live production deployment evidence.");
  }
  const releaseRunId =
    typeof evidence.releaseRunId === "string"
      ? normalizeReleaseRunId(evidence.releaseRunId)
      : undefined;
  const deploymentFingerprint =
    isRecord(evidence.deploymentFingerprint) &&
    evidence.deploymentFingerprint.status === "present" &&
    typeof evidence.deploymentFingerprint.value === "string"
      ? normalizeDeploymentFingerprint(evidence.deploymentFingerprint.value)
      : undefined;
  const deploymentObservedAt =
    isRecord(evidence.deploymentObservation) &&
    evidence.deploymentObservation.status === "observed" &&
    typeof evidence.deploymentObservation.observedAt === "string"
      ? normalizeDeploymentObservedAt(evidence.deploymentObservation.observedAt)
      : undefined;

  return {
    releaseRunId,
    deploymentFingerprint,
    deploymentObservedAt,
    source: "vercel-production-deployment",
    observationBindingStatus: deploymentObservedAt ? "proved" : "missing",
  };
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizeReleaseRunId(value) {
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be a non-secret release identifier.");
  }
  return releaseRunId;
}

function normalizeDeploymentFingerprint(value) {
  const deploymentFingerprint = value.trim();
  if (!/^sha256:[a-f0-9]{16}$/.test(deploymentFingerprint)) {
    throw new Error("--deployment-fingerprint must be a redacted sha256 deployment fingerprint.");
  }
  return deploymentFingerprint;
}

function normalizeDeploymentObservedAt(value) {
  const observedAt = value.trim();
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) {
    throw new Error("--deployment-observed-at must be an ISO timestamp.");
  }
  return observedAt;
}

function createManualRecordTemplate(packageSummary, deploymentBinding, appVersionPrefill = new Map()) {
  return {
    recordType: "manual-ppt-playback-acceptance-template",
    packageId: packageSummary.packageId,
    sourceDeckTitle: packageSummary.sourceDeckTitle,
    releaseRunId: deploymentBinding.releaseRunId ?? "",
    deploymentFingerprint: deploymentBinding.deploymentFingerprint ?? "",
    deploymentObservedAt: deploymentBinding.deploymentObservedAt ?? "",
    artifactFingerprint: packageSummary.artifactFingerprint ?? "",
    status: "template-not-accepted",
    testedAt: "",
    tester: "",
    redaction: {
      doNotInclude: [
        "provider API keys",
        "approval tokens",
        "private cloned voice IDs",
        "source voice sample paths",
        "local private paths",
        "raw or base64 audio",
        "cookie values",
      ],
    },
    instructions: [
      "Open the narrated PPTX in each target application.",
      "Fill tester, testedAt, and application versions during the manual playback session.",
      "Keep packageId, releaseRunId, deploymentFingerprint, deploymentObservedAt, artifactFingerprint, slideId, and audioId unchanged.",
      "For each slide, set audioPlays to true only after hearing that slide narration in the target application.",
      "For each slide, set heardTargetVoice to true only after confirming the narration uses the target cloned voice.",
      "Keep audioPlays or heardTargetVoice false for any slide that is not heard, cuts off, uses the wrong voice, or cannot be triggered.",
      ...(appVersionPrefill.size > 0
        ? [
            "Desktop visual evidence may prefill application versions, but it does not prove audio playback.",
          ]
        : []),
      "Change status to accepted-after-human-playback only after human playback passes in both target applications.",
      "Run scripts/ppt-manual-playback-acceptance.mjs with this record to produce final acceptance evidence.",
    ],
    applications: requiredApplications.map((applicationName) => ({
      name: applicationName,
      version: appVersionPrefill.get(applicationName) ?? "",
      slideResults: createManualRecordTemplateSlideResults(packageSummary),
    })),
  };
}

function readDesktopAppEvidenceVersionPrefill(options) {
  if (!options.desktopAppEvidence) {
    return new Map();
  }
  const evidence = readJson(options.desktopAppEvidence, "desktop app evidence");
  if (!isRecord(evidence) || !Array.isArray(evidence.desktopApplicationEvidence)) {
    return new Map();
  }
  const versions = new Map();
  for (const applicationName of requiredApplications) {
    const entry = evidence.desktopApplicationEvidence.find(
      (candidate) => isRecord(candidate) && candidate.name === applicationName,
    );
    if (
      isRecord(entry) &&
      entry.openedTargetDeck === true &&
      entry.slideShowWindowOpened === true &&
      entry.humanAuditoryPlaybackConfirmed !== true &&
      typeof entry.version === "string" &&
      entry.version.trim()
    ) {
      versions.set(applicationName, entry.version.trim());
    }
  }
  return versions;
}

function readAppVersionPrefillStatus(template) {
  if (
    template?.applications?.some(
      (application) => typeof application?.version === "string" && application.version.trim(),
    )
  ) {
    return "prefilled-from-desktop-visual-evidence";
  }
  return "not-prefilled";
}

function createManualRecordTemplateSlideResults(packageSummary) {
  return Array.from({ length: packageSummary.expectedSlideCount }, (_, index) => {
    const slideNumber = index + 1;
    const binding = packageSummary.expectedSlideBindings.find(
      (candidate) => candidate.slideNumber === slideNumber,
    );
    return {
      slideNumber,
      ...(binding?.slideId ? { slideId: binding.slideId } : {}),
      ...(binding?.audioId ? { audioId: binding.audioId } : {}),
      audioPlays: false,
      ...(packageSummary.targetVoiceLabelStatus !== "not-required"
        ? { heardTargetVoice: false }
        : {}),
    };
  });
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
  const artifactFingerprint = readArtifactFingerprint(value);
  const expectedSlideCount = readExpectedSlideCount(value);
  const expectedSlideBindings = readExpectedSlideBindings(value, expectedSlideCount);
  const expectedVoiceLabel = readExpectedVoiceLabel(value);
  const targetVoiceLabelStatus = readTargetVoiceLabelStatus(value, expectedVoiceLabel);

  return {
    packageId,
    sourceDeckTitle,
    artifactFingerprint,
    expectedSlideCount,
    expectedSlideBindings,
    expectedVoiceLabel,
    targetVoiceLabelStatus,
  };
}

function readArtifactFingerprint(value) {
  if (typeof value.artifactFingerprint !== "string") {
    return undefined;
  }
  const artifactFingerprint = value.artifactFingerprint.trim();
  return /^sha256:[a-f0-9]{64}$/.test(artifactFingerprint)
    ? artifactFingerprint
    : undefined;
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

function readExpectedSlideBindings(value, expectedSlideCount) {
  if (!Array.isArray(value.slideScripts) || value.slideScripts.length !== expectedSlideCount) {
    return [];
  }
  const pptAssetId =
    typeof value.pptAssetId === "string" && value.pptAssetId.trim()
      ? value.pptAssetId.trim()
      : undefined;
  const bindings = [];
  for (let index = 0; index < value.slideScripts.length; index += 1) {
    const script = value.slideScripts[index];
    if (!isRecord(script) || typeof script.slideId !== "string" || !script.slideId.trim()) {
      return [];
    }
    const slideId = script.slideId.trim();
    bindings.push({
      slideNumber: index + 1,
      slideId,
      ...(pptAssetId ? { audioId: `tts_${pptAssetId}_${slideId}` } : {}),
    });
  }
  return bindings;
}

function readExpectedVoiceLabel(value) {
  if (!isRecord(value.teacherVoice)) {
    return undefined;
  }
  return typeof value.teacherVoice.targetVoiceLabel === "string" &&
    value.teacherVoice.targetVoiceLabel.trim()
    ? value.teacherVoice.targetVoiceLabel.trim()
    : undefined;
}

function readTargetVoiceLabelStatus(value, expectedVoiceLabel) {
  if (!isRecord(value.teacherVoice)) {
    return "not-required";
  }
  return expectedVoiceLabel ? "present" : "missing";
}

function readNonEmptyString(value, fieldName) {
  const field = value[fieldName];
  if (typeof field !== "string" || !field.trim()) {
    throw new Error(`Package JSON requires ${fieldName}.`);
  }
  return field.trim();
}

function detectMachinePreflightStatus(preflightText) {
  return /machine-preflight-passed/i.test(preflightText) ? "passed" : "missing";
}

function collectReviewArtifacts(preflightText) {
  const artifacts = [];
  const seen = new Set();
  const tableRowPattern = /^\|\s*([^|\n]+?)\s*\|\s*`([^`\n]+)`\s*\|/gm;

  for (const match of preflightText.matchAll(tableRowPattern)) {
    const label = match[1].trim();
    const kind = normalizeReviewArtifactKind(label);
    if (!kind) {
      continue;
    }

    const relativePath = normalizeSafeReviewArtifactPath(match[2]);
    if (!relativePath || seen.has(relativePath)) {
      continue;
    }

    seen.add(relativePath);
    artifacts.push({
      kind,
      label,
      relativePath,
      fileName: basename(relativePath.replace(/\/+$/, "")),
    });
  }

  return artifacts;
}

function normalizeReviewArtifactKind(label) {
  const normalized = label.toLowerCase();
  if (normalized === "narrated pptx") {
    return "narrated-pptx";
  }
  if (normalized === "zip export") {
    return "zip-export";
  }
  if (normalized === "audio manifest") {
    return "audio-manifest";
  }
  if (normalized === "source wav folder") {
    return "source-wav-folder";
  }
  if (normalized === "libreoffice pdf render") {
    return "pdf-render";
  }
  if (normalized === "render contact sheet") {
    return "render-contact-sheet";
  }
  return undefined;
}

function normalizeSafeReviewArtifactPath(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const relativePath = value.trim();
  if (!relativePath || !relativePath.startsWith(".tmp/")) {
    return undefined;
  }
  if (
    relativePath.startsWith("/") ||
    relativePath.startsWith("~") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    relativePath.includes("://")
  ) {
    return undefined;
  }
  if (relativePath.split("/").some((segment) => segment === "..")) {
    return undefined;
  }
  return relativePath;
}

function createMissingOpenxmlIntegrity() {
  return {
    status: "not-provided",
    embeddedNarrationWavStatus: "not-provided",
    acceptanceGateStatus: "not-required",
    blockedReasons: [],
    evidence: undefined,
  };
}

function evaluateOpenxmlIntegrity(evidence, packageSummary) {
  const blockedReasons = [];
  if (!isRecord(evidence) || evidence.target !== "ppt-narration-openxml-package-integrity") {
    blockedReasons.push("openxml-integrity-target-mismatch");
  }
  if (evidence.status !== "passed") {
    blockedReasons.push("openxml-integrity-not-passed");
  }
  if (evidence.packageId !== packageSummary.packageId) {
    blockedReasons.push("openxml-integrity-package-id-mismatch");
  }
  if (evidence.expectedSlideCount !== packageSummary.expectedSlideCount) {
    blockedReasons.push("openxml-integrity-slide-count-mismatch");
  }

  const validEmbeddedNarrationWavs =
    isRecord(evidence.counts) && Number.isInteger(evidence.counts.pptxValidEmbeddedNarrationWavs)
      ? evidence.counts.pptxValidEmbeddedNarrationWavs
      : 0;
  const nonEmptyEmbeddedNarrationWavs =
    isRecord(evidence.counts) && Number.isInteger(evidence.counts.pptxNonEmptyEmbeddedNarrationWavs)
      ? evidence.counts.pptxNonEmptyEmbeddedNarrationWavs
      : 0;
  const embeddedNarrationWavs = Array.isArray(evidence.embeddedNarrationWavs)
    ? evidence.embeddedNarrationWavs
    : [];
  const embeddedNarrationWavStatus =
    validEmbeddedNarrationWavs === packageSummary.expectedSlideCount &&
    nonEmptyEmbeddedNarrationWavs === packageSummary.expectedSlideCount &&
    embeddedNarrationWavs.length === packageSummary.expectedSlideCount &&
    embeddedNarrationWavs.every(
      (wav) =>
        isRecord(wav) &&
        wav.status === "valid" &&
        typeof wav.durationSeconds === "number" &&
        wav.durationSeconds > 0,
    )
      ? "passed"
      : "blocked";
  if (embeddedNarrationWavStatus !== "passed") {
    blockedReasons.push("openxml-embedded-narration-wav-not-passed");
  }

  const rawAudioOmitted =
    isRecord(evidence.safety) && evidence.safety.rawAudioOmitted === true;
  if (!rawAudioOmitted) {
    blockedReasons.push("openxml-integrity-raw-audio-redaction-not-proven");
  }

  return {
    status: blockedReasons.length === 0 ? "passed" : "blocked",
    embeddedNarrationWavStatus,
    acceptanceGateStatus: blockedReasons.length === 0 ? "passed" : "blocked",
    blockedReasons: [...new Set(blockedReasons)],
    evidence: {
      target: "ppt-narration-openxml-package-integrity",
      status: evidence.status === "passed" ? "passed" : "blocked",
      expectedSlideCount:
        Number.isInteger(evidence.expectedSlideCount) && evidence.expectedSlideCount > 0
          ? evidence.expectedSlideCount
          : 0,
      validEmbeddedNarrationWavs,
      nonEmptyEmbeddedNarrationWavs,
      rawAudioOmitted,
      valuesRedacted: true,
    },
  };
}

function createPendingManualAcceptance(releaseRunId, deploymentFingerprint) {
  return {
    status: "pending",
    recordEvidenceStatus: "missing",
    packageIdentityStatus: "missing",
    artifactFingerprintStatus: "missing",
    releaseRunStatus: releaseRunId ? "missing" : "not-required",
    deploymentFingerprintStatus: deploymentFingerprint ? "missing" : "not-required",
    afterDeploymentStatus: releaseRunId ? "missing" : "not-required",
    timingStatus: "missing",
    confirmationStatus: "missing",
    acceptedApplications: [],
    blockedReasons: [
      "manual-PowerPoint-playback-not-recorded",
      "manual-WPS-playback-not-recorded",
    ],
  };
}

function createManualPlaybackAcceptanceResults({
  machinePreflightStatus,
  openxmlIntegrity,
  manualAcceptance,
  packageSummary,
  deploymentBinding,
}) {
  const acceptedApplications = Array.isArray(manualAcceptance.acceptedApplications)
    ? manualAcceptance.acceptedApplications
    : [];
  const passedIf = (condition) => (condition ? "passed" : "blocked");

  return {
    manualPptMachinePreflightPassed: passedIf(machinePreflightStatus === "passed"),
    manualPptOpenxmlIntegrityPassed: passedIf(
      openxmlIntegrity.acceptanceGateStatus !== "blocked",
    ),
    manualPptRecordEvidenceComplete: passedIf(
      manualAcceptance.recordEvidenceStatus === "complete",
    ),
    manualPptPackageIdentityMatched: passedIf(
      manualAcceptance.packageIdentityStatus === "matched",
    ),
    manualPptArtifactFingerprintMatched: passedIf(
      packageSummary.artifactFingerprint &&
        manualAcceptance.artifactFingerprintStatus === "matched",
    ),
    manualPptTimingValid: passedIf(
      manualAcceptance.timingStatus === "valid-past-or-present",
    ),
    manualPptHumanConfirmationAccepted: passedIf(
      manualAcceptance.confirmationStatus === "accepted-after-human-playback",
    ),
    manualPptTargetVoiceLabelPresent: passedIf(
      packageSummary.targetVoiceLabelStatus === "present",
    ),
    manualPptPowerPointPlaybackAccepted: passedIf(
      acceptedApplications.includes("Microsoft PowerPoint"),
    ),
    manualPptWpsPlaybackAccepted: passedIf(
      acceptedApplications.includes("WPS Presentation"),
    ),
    manualPptReleaseRunBound: passedIf(
      Boolean(deploymentBinding.releaseRunId) &&
        manualAcceptance.releaseRunStatus === "matched",
    ),
    manualPptDeploymentFingerprintBound: passedIf(
      Boolean(deploymentBinding.deploymentFingerprint) &&
        manualAcceptance.deploymentFingerprintStatus === "matched",
    ),
    manualPptTestedAfterDeployment: passedIf(
      manualAcceptance.afterDeploymentStatus === "proved",
    ),
    manualPptDeploymentEvidenceSourceProduction: passedIf(
      deploymentBinding.source === "vercel-production-deployment" &&
        deploymentBinding.observationBindingStatus === "proved",
    ),
    manualPptSafetyRedacted: "passed",
  };
}

function evaluateManualRecord(
  record,
  packageSummary,
  releaseRunId,
  deploymentFingerprint,
  deploymentObservedAt,
) {
  if (!isRecord(record) || !Array.isArray(record.applications)) {
    return createPendingManualAcceptance(releaseRunId, deploymentFingerprint, deploymentObservedAt);
  }

  const packageIdentityStatus = readManualRecordPackageIdentityStatus(record, packageSummary);
  const releaseRunStatus = readManualRecordReleaseRunStatus(record, releaseRunId);
  const deploymentFingerprintStatus = readManualRecordDeploymentFingerprintStatus(
    record,
    deploymentFingerprint,
    releaseRunId,
  );
  const afterDeploymentStatus = readManualRecordAfterDeploymentStatus(
    record,
    deploymentObservedAt,
    releaseRunId,
  );
  if (packageIdentityStatus === "missing") {
    return {
      status: "pending",
      recordEvidenceStatus: "identity-missing",
      packageIdentityStatus,
      artifactFingerprintStatus: "missing",
      releaseRunStatus,
      deploymentFingerprintStatus,
      afterDeploymentStatus,
      timingStatus: readManualRecordTimingStatus(record),
      confirmationStatus: readManualRecordConfirmationStatus(record),
      acceptedApplications: [],
      blockedReasons: ["manual-record-package-identity-missing"],
    };
  }

  if (packageIdentityStatus === "mismatch") {
    return {
      status: "pending",
      recordEvidenceStatus: "mismatch",
      packageIdentityStatus,
      artifactFingerprintStatus: "missing",
      releaseRunStatus,
      deploymentFingerprintStatus,
      afterDeploymentStatus,
      timingStatus: readManualRecordTimingStatus(record),
      confirmationStatus: readManualRecordConfirmationStatus(record),
      acceptedApplications: [],
      blockedReasons: ["manual-record-package-mismatch"],
    };
  }

  const timingStatus = readManualRecordTimingStatus(record);
  const recordMetadataComplete = manualRecordHasCompleteMetadata(record, timingStatus);
  const artifactFingerprintStatus = readManualRecordArtifactFingerprintStatus(record, packageSummary);
  const confirmationStatus = readManualRecordConfirmationStatus(record);
  if (
    recordMetadataComplete &&
    (releaseRunStatus === "missing" || releaseRunStatus === "mismatch")
  ) {
    return {
      status: "pending",
      recordEvidenceStatus:
        releaseRunStatus === "mismatch" ? "release-run-mismatch" : "release-run-missing",
      packageIdentityStatus,
      artifactFingerprintStatus,
      releaseRunStatus,
      deploymentFingerprintStatus,
      afterDeploymentStatus,
      timingStatus,
      confirmationStatus,
      acceptedApplications: [],
      blockedReasons: [
        releaseRunStatus === "mismatch"
          ? "manual-record-release-run-mismatch"
          : "manual-record-release-run-missing",
      ],
    };
  }
  if (
    recordMetadataComplete &&
    (deploymentFingerprintStatus === "missing" || deploymentFingerprintStatus === "mismatch")
  ) {
    return {
      status: "pending",
      recordEvidenceStatus:
        deploymentFingerprintStatus === "mismatch"
          ? "deployment-fingerprint-mismatch"
          : "deployment-fingerprint-missing",
      packageIdentityStatus,
      artifactFingerprintStatus,
      releaseRunStatus,
      deploymentFingerprintStatus,
      afterDeploymentStatus,
      timingStatus,
      confirmationStatus,
      acceptedApplications: [],
      blockedReasons: [
        deploymentFingerprintStatus === "mismatch"
          ? "manual-record-deployment-fingerprint-mismatch"
          : "manual-record-deployment-fingerprint-missing",
      ],
    };
  }
  if (
    recordMetadataComplete &&
    afterDeploymentStatus !== "not-required" &&
    afterDeploymentStatus !== "proved"
  ) {
    return {
      status: "pending",
      recordEvidenceStatus:
        afterDeploymentStatus === "tested-before-deployment"
          ? "tested-before-deployment"
          : "deployment-observed-at-missing",
      packageIdentityStatus,
      artifactFingerprintStatus,
      releaseRunStatus,
      deploymentFingerprintStatus,
      afterDeploymentStatus,
      timingStatus,
      confirmationStatus,
      acceptedApplications: [],
      blockedReasons: [
        afterDeploymentStatus === "tested-before-deployment"
          ? "manual-record-tested-before-deployment"
          : "manual-record-deployment-observed-at-missing",
      ],
    };
  }
  if (recordMetadataComplete && artifactFingerprintStatus !== "matched") {
    return {
      status: "pending",
      recordEvidenceStatus:
        artifactFingerprintStatus === "mismatch" ? "artifact-mismatch" : "artifact-missing",
      packageIdentityStatus,
      artifactFingerprintStatus,
      releaseRunStatus,
      deploymentFingerprintStatus,
      afterDeploymentStatus,
      timingStatus,
      confirmationStatus,
      acceptedApplications: [],
      blockedReasons: [
        artifactFingerprintStatus === "mismatch"
          ? "manual-record-artifact-fingerprint-mismatch"
          : "manual-record-artifact-fingerprint-missing",
      ],
    };
  }
  if (
    recordMetadataComplete &&
    artifactFingerprintStatus === "matched" &&
    confirmationStatus !== "accepted-after-human-playback"
  ) {
    return {
      status: "pending",
      recordEvidenceStatus: "confirmation-missing",
      packageIdentityStatus,
      artifactFingerprintStatus,
      releaseRunStatus,
      deploymentFingerprintStatus,
      afterDeploymentStatus,
      timingStatus,
      confirmationStatus,
      acceptedApplications: [],
      blockedReasons: ["manual-record-human-confirmation-missing"],
    };
  }
  if (
    recordMetadataComplete &&
    artifactFingerprintStatus === "matched" &&
    confirmationStatus === "accepted-after-human-playback" &&
    packageSummary.targetVoiceLabelStatus === "missing"
  ) {
    return {
      status: "pending",
      recordEvidenceStatus: "target-voice-label-missing",
      packageIdentityStatus,
      artifactFingerprintStatus,
      releaseRunStatus,
      deploymentFingerprintStatus,
      afterDeploymentStatus,
      timingStatus,
      confirmationStatus,
      acceptedApplications: [],
      blockedReasons: ["manual-record-target-voice-label-missing"],
    };
  }
  const acceptedApplications = [];
  const blockedReasons = [];
  if (timingStatus === "future") {
    blockedReasons.push("manual-record-tested-at-in-future");
  } else if (!recordMetadataComplete) {
    blockedReasons.push("manual-record-metadata-incomplete");
  }
  if (releaseRunStatus === "missing" || releaseRunStatus === "mismatch") {
    blockedReasons.push(
      releaseRunStatus === "mismatch"
        ? "manual-record-release-run-mismatch"
        : "manual-record-release-run-missing",
    );
  }
  if (deploymentFingerprintStatus === "missing" || deploymentFingerprintStatus === "mismatch") {
    blockedReasons.push(
      deploymentFingerprintStatus === "mismatch"
        ? "manual-record-deployment-fingerprint-mismatch"
        : "manual-record-deployment-fingerprint-missing",
    );
  }
  if (afterDeploymentStatus === "missing" || afterDeploymentStatus === "tested-before-deployment") {
    blockedReasons.push(
      afterDeploymentStatus === "tested-before-deployment"
        ? "manual-record-tested-before-deployment"
        : "manual-record-deployment-observed-at-missing",
    );
  }
  for (const applicationName of requiredApplications) {
    const application = record.applications.find(
      (candidate) => isRecord(candidate) && candidate.name === applicationName,
    );
    if (
      !recordMetadataComplete ||
      !application ||
      !applicationHasCompleteSlidePlayback(application, packageSummary)
    ) {
      blockedReasons.push(
        applicationName === "Microsoft PowerPoint"
          ? "manual-PowerPoint-playback-not-recorded"
          : "manual-WPS-playback-not-recorded",
      );
      continue;
    }
    acceptedApplications.push(applicationName);
  }

  return {
    status: blockedReasons.length === 0 ? "accepted" : "pending",
    recordEvidenceStatus: recordMetadataComplete ? "complete" : "incomplete",
    packageIdentityStatus,
    artifactFingerprintStatus,
    releaseRunStatus,
    deploymentFingerprintStatus,
    afterDeploymentStatus,
    timingStatus,
    confirmationStatus,
    acceptedApplications,
    blockedReasons,
  };
}

function readManualRecordConfirmationStatus(record) {
  if (typeof record.status !== "string" || !record.status.trim()) {
    return "missing";
  }
  const status = record.status.trim();
  return status === "accepted-after-human-playback" || status === "template-not-accepted"
    ? status
    : "unsupported";
}

function readManualRecordArtifactFingerprintStatus(record, packageSummary) {
  if (!packageSummary.artifactFingerprint) {
    return "missing";
  }
  if (typeof record.artifactFingerprint !== "string" || !record.artifactFingerprint.trim()) {
    return "missing";
  }
  return record.artifactFingerprint.trim() === packageSummary.artifactFingerprint
    ? "matched"
    : "mismatch";
}

function readManualRecordPackageIdentityStatus(record, packageSummary) {
  if (typeof record.packageId === "string" && record.packageId.trim()) {
    return record.packageId.trim() === packageSummary.packageId ? "matched" : "mismatch";
  }
  if (typeof record.sourceDeckTitle === "string" && record.sourceDeckTitle.trim()) {
    return record.sourceDeckTitle.trim() === packageSummary.sourceDeckTitle
      ? "matched"
      : "mismatch";
  }
  return "missing";
}

function readManualRecordReleaseRunStatus(record, releaseRunId) {
  if (!releaseRunId) {
    return "not-required";
  }
  if (typeof record.releaseRunId !== "string" || !record.releaseRunId.trim()) {
    return "missing";
  }
  return record.releaseRunId.trim() === releaseRunId ? "matched" : "mismatch";
}

function readManualRecordDeploymentFingerprintStatus(record, deploymentFingerprint, releaseRunId) {
  if (!deploymentFingerprint) {
    return releaseRunId ? "missing" : "not-required";
  }
  if (typeof record.deploymentFingerprint !== "string" || !record.deploymentFingerprint.trim()) {
    return "missing";
  }
  return record.deploymentFingerprint.trim() === deploymentFingerprint ? "matched" : "mismatch";
}

function readManualRecordAfterDeploymentStatus(record, deploymentObservedAt, releaseRunId) {
  if (!releaseRunId) {
    return "not-required";
  }
  if (!deploymentObservedAt) {
    return "missing";
  }
  const testedAtMs =
    typeof record.testedAt === "string" ? Date.parse(record.testedAt) : Number.NaN;
  const deploymentObservedAtMs = Date.parse(deploymentObservedAt);
  if (!Number.isFinite(testedAtMs) || !Number.isFinite(deploymentObservedAtMs)) {
    return "missing";
  }
  return testedAtMs >= deploymentObservedAtMs ? "proved" : "tested-before-deployment";
}

function manualRecordHasCompleteMetadata(record, timingStatus = readManualRecordTimingStatus(record)) {
  if (typeof record.tester !== "string" || !record.tester.trim()) {
    return false;
  }
  if (timingStatus !== "valid-past-or-present") {
    return false;
  }
  for (const applicationName of requiredApplications) {
    const application = record.applications.find(
      (candidate) => isRecord(candidate) && candidate.name === applicationName,
    );
    if (!application || typeof application.version !== "string" || !application.version.trim()) {
      return false;
    }
  }
  return true;
}

function readManualRecordTimingStatus(record) {
  if (typeof record.testedAt !== "string" || !record.testedAt.trim()) {
    return "missing";
  }
  const testedAtMs = Date.parse(record.testedAt);
  if (!Number.isFinite(testedAtMs)) {
    return "invalid";
  }
  return testedAtMs <= Date.now() ? "valid-past-or-present" : "future";
}

function applicationHasCompleteSlidePlayback(application, packageSummary) {
  if (!Array.isArray(application.slideResults)) {
    return false;
  }
  if (application.slideResults.length !== packageSummary.expectedSlideCount) {
    return false;
  }

  const playedSlides = new Set();
  for (const result of application.slideResults) {
    if (!isRecord(result) || result.audioPlays !== true || !Number.isInteger(result.slideNumber)) {
      return false;
    }
    const expectedBinding = packageSummary.expectedSlideBindings.find(
      (binding) => binding.slideNumber === result.slideNumber,
    );
    if (expectedBinding) {
      if (result.slideId !== expectedBinding.slideId) {
        return false;
      }
      if (expectedBinding.audioId && result.audioId !== expectedBinding.audioId) {
        return false;
      }
    }
    if (packageSummary.targetVoiceLabelStatus !== "not-required" && result.heardTargetVoice !== true) {
      return false;
    }
    playedSlides.add(result.slideNumber);
  }

  for (let slideNumber = 1; slideNumber <= packageSummary.expectedSlideCount; slideNumber += 1) {
    if (!playedSlides.has(slideNumber)) {
      return false;
    }
  }
  return true;
}

function createChecklistMarkdown(input) {
  const lines = [
    "# S24 Manual PPT Playback Acceptance Checklist",
    "",
    `- Package ID: ${input.packageSummary.packageId}`,
    `- Source deck: ${input.packageSummary.sourceDeckTitle}`,
    `- Expected slide count: ${input.packageSummary.expectedSlideCount}`,
    `- Machine preflight status: ${input.machinePreflightStatus}`,
    "- Status: Pending manual PowerPoint/WPS playback",
    "- Redaction: Do not paste provider keys, private voice IDs, local private source paths, cookie values, or raw/base64 audio.",
    "",
    "## Required Applications",
    "",
    "- Microsoft PowerPoint",
    "- WPS Presentation",
    "",
  ];

  if (input.reviewArtifacts.length > 0) {
    lines.push(
      "## Artifacts To Open",
      "",
      ...input.reviewArtifacts.map(
        (artifact) => `- ${artifact.label}: \`${artifact.relativePath}\``,
      ),
      "",
    );
  }

  lines.push(
    "## Slide Playback Checks",
    "",
  );

  for (let slideNumber = 1; slideNumber <= input.packageSummary.expectedSlideCount; slideNumber += 1) {
    const padded = String(slideNumber).padStart(2, "0");
    const binding = input.packageSummary.expectedSlideBindings.find(
      (candidate) => candidate.slideNumber === slideNumber,
    );
    const bindingLabel = binding
      ? ` (${[binding.slideId, binding.audioId].filter(Boolean).join(" / ")})`
      : "";
    const voiceSuffix = input.packageSummary.targetVoiceLabelStatus !== "not-required"
      ? " and target cloned voice is heard"
      : "";
    lines.push(`- [ ] Slide ${padded} PowerPoint audio plays${voiceSuffix}${bindingLabel}`);
    lines.push(`- [ ] Slide ${padded} WPS audio plays${voiceSuffix}${bindingLabel}`);
  }

  lines.push(
    "",
    "## Acceptance Record",
    "",
    "- Tester:",
    "- Tested at:",
    "- PowerPoint version:",
    "- WPS Presentation version:",
    "- Record status: accepted-after-human-playback",
    "- Notes:",
    "",
    "Manual acceptance is complete only when every expected slide/audio id plays with the target cloned voice in both target applications and the record status is set to accepted-after-human-playback.",
  );

  return `${lines.join("\n")}\n`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
