#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const featureNames = [
  "voiceSampleUpload",
  "uploadedSampleAudioPayload",
  "voiceSampleDurationGate",
  "voiceSampleSelect",
  "selectedSampleIdentity",
  "preflight",
  "voiceRefDisplay",
  "pptNarrationGenerate",
  "perSlideWavDownloads",
  "workflowStepGating",
  "signedSessionBootstrap",
  "signedSessionReadiness",
  "authFailClosed",
  "serverWorkflowStatus",
];

const defaultCommand = "npm";
const defaultArgs = ["run", "test", "--", "tests/teaching-page.test.tsx"];

try {
  const options = parseArgs(process.argv.slice(2));
  const command = options.command ?? defaultCommand;
  const args = options.args.length > 0 ? options.args : defaultArgs;
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      UAIS_TEACHER_WORKFLOW_FEATURE_EVIDENCE: "1",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const passed = result.status === 0;
  const features = passed
    ? readFeatureEvidence(result.stdout)
    : Object.fromEntries(featureNames.map((feature) => [feature, false]));
  const allFeaturesPresent = featureNames.every((feature) => features[feature] === true);
  const status = passed && allFeaturesPresent ? "accepted" : "blocked";
  const evidenceStatus = passed
    ? allFeaturesPresent
      ? "feature-evidence-passed"
      : "feature-evidence-missing"
    : "test-failed";
  const blockedReasons = passed
    ? allFeaturesPresent
      ? []
      : ["teacher-workflow-ui-feature-evidence-missing"]
    : ["teacher-workflow-ui-test-failed"];

  process.stdout.write(
    `${JSON.stringify(
      {
        target: "teacher-workflow-ui-smoke",
        mode: "local-ui-test",
        status,
        responsibleSession: "S05",
        evidenceStatus,
        test: {
          file: "tests/teaching-page.test.tsx",
          scenario:
            "teacher workflow server-status bridge plus signed-session readiness, uploaded-audio duration gate, selected sample identity, fail-closed auth, step gating, preflight, voiceRef, and per-slide WAV downloads",
        },
        features,
        blockedReasons,
        safety: {
          secretsRedacted: true,
          commandOutputOmitted: true,
          localPrivatePathsOmitted: true,
          providerValuesOmitted: true,
        },
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Teacher workflow UI smoke failed."}\n`);
  process.exitCode = 1;
}

function readFeatureEvidence(stdout) {
  const fallback = Object.fromEntries(featureNames.map((feature) => [feature, false]));
  const markerLines = stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("UAIS_TEACHER_WORKFLOW_FEATURES "));
  if (markerLines.length === 0) {
    return fallback;
  }

  const merged = { ...fallback };
  for (const markerLine of markerLines) {
    try {
      const parsed = JSON.parse(
        markerLine.replace(/^.*?UAIS_TEACHER_WORKFLOW_FEATURES\s+/, ""),
      );
      for (const feature of featureNames) {
        merged[feature] = merged[feature] || parsed?.[feature] === true;
      }
    } catch {
      return fallback;
    }
  }
  return merged;
}

function parseArgs(args) {
  const options = {
    command: undefined,
    args: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--command") {
      options.command = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--arg") {
      options.args.push(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/teacher-workflow-ui-smoke.mjs [--command CMD --arg ARG ...]",
          "",
          "Runs a redacted local S05 teacher workflow UI smoke. Command output is never printed.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error("Unknown option.");
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
