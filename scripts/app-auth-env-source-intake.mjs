#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const handoff = readJsonArg(args, "production-env-source-handoff");
  const appAuthPreflight = readJsonArg(args, "app-auth-preflight");
  const report = buildReport({ args, handoff, appAuthPreflight });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ args, handoff, appAuthPreflight }) {
  const request = findAppAuthRequest(handoff);
  const requiredServerOnlyEnvNames = uniqueStrings([
    ...readStringArray(request.requiredServerOnlyEnvNames),
    ...readStringArray(appAuthPreflight.requiredServerOnlyEnvNames),
  ]);
  const liveApproved = args.live === true && args.approved === true;
  const envFileProvided = typeof args["env-file"] === "string" && args["env-file"].length > 0;
  const evidenceHandleProvided =
    typeof args["evidence-handle"] === "string" && args["evidence-handle"].trim().length > 0;
  const approvedEvidenceHandleProvided = evidenceHandleProvided && args.approved === true;
  const envFileRead = liveApproved && envFileProvided;
  const parsedEnv = envFileRead ? parseEnvFile(args["env-file"]) : new Map();
  const envPresence = requiredServerOnlyEnvNames.map((name) => ({
    name,
    present: parsedEnv.has(name),
  }));
  const presentEnvNameCount = envPresence.filter((entry) => entry.present).length;
  const missingEnvNames = envPresence
    .filter((entry) => !entry.present)
    .map((entry) => entry.name);
  const readyForVercelEnvSyncDryRun =
    envFileRead && missingEnvNames.length === 0 && requiredServerOnlyEnvNames.length > 0;
  const approvedServerOnlyEnvSourceLabel = readString(
    request.approvedServerOnlyEnvSourceLabel,
    readString(appAuthPreflight.approvedServerOnlyEnvSourceLabel, ""),
  );
  const blockingInput = readyForVercelEnvSyncDryRun
    ? null
    : buildBlockingInput({
        envFileRead,
        missingEnvNames,
        approvedServerOnlyEnvSourceLabel,
        approvedEvidenceHandleProvided,
      });
  const operatorInputRequired = blockingInput !== null;
  const deferredMissingEvidence = readDeferredMissingEvidence({ request, appAuthPreflight });
  const missingEvidence = readyForVercelEnvSyncDryRun
    ? []
    : blockingInput
      ? [blockingInput.id]
      : [];
  const blockedReasons = readyForVercelEnvSyncDryRun
    ? []
    : blockingInput
      ? [`${blockingInput.id}-required`]
      : [];
  const status = readyForVercelEnvSyncDryRun
    ? "app-auth-env-source-intake-ready-for-vercel-env-sync-dry-run"
    : envFileProvided && !liveApproved
      ? "app-auth-env-source-intake-rejected-unapproved-env-file"
      : evidenceHandleProvided && !approvedEvidenceHandleProvided
        ? "app-auth-env-source-intake-rejected-unapproved-evidence-handle"
        : approvedEvidenceHandleProvided
          ? "app-auth-env-source-intake-approved-source-handle-recorded"
          : "app-auth-env-source-intake-awaiting-approved-source-path";
  const mode = envFileRead
    ? "live-approved-redacted-intake"
    : approvedEvidenceHandleProvided
      ? "approved-source-handle"
      : "dry-run";
  const safeNextAction = readyForVercelEnvSyncDryRun
    ? "run-s19-vercel-env-sync-dry-run-for-app-auth"
    : approvedEvidenceHandleProvided
      ? "run-s19-app-auth-env-presence-check-from-approved-source-handle"
      : "provide-approved-env-source-path-to-s19";

  return {
    target: "app-auth-env-source-intake",
    status,
    releaseReady: false,
    mode,
    responsibleSession: "S19/S22",
    approvedServerOnlyEnvSourceLabel,
    approvedProviderMode: readString(
      request.approvedProviderMode,
      readString(appAuthPreflight.approvedProviderMode, ""),
    ),
    approvedReleaseRunIdLabel: readString(
      request.approvedReleaseRunIdLabel,
      readString(appAuthPreflight.approvedReleaseRunIdLabel, ""),
    ),
    summary: {
      ownerInputRequired: false,
      operatorInputRequired,
      blockingInputRequired: operatorInputRequired,
      requiredEnvNameCount: requiredServerOnlyEnvNames.length,
      presentEnvNameCount,
      missingEnvNameCount: missingEnvNames.length,
      envFileProvided,
      ...(approvedEvidenceHandleProvided ? { sourceEvidenceHandleProvided: true } : {}),
      envValuesEmitted: false,
      readyForVercelEnvSyncDryRun,
      releaseReady: false,
    },
    requiredServerOnlyEnvNames,
    envPresence,
    missingEnvNames,
    blockingInput,
    blockedReasons,
    missingEvidence,
    deferredMissingEvidence,
    operatorInputPacket: buildOperatorInputPacket({
      blockingInput,
      approvedServerOnlyEnvSourceLabel,
      requiredServerOnlyEnvNames,
      readyForVercelEnvSyncDryRun,
      approvedEvidenceHandleProvided,
      safeNextAction,
    }),
    safeCommandTemplates: buildSafeCommandTemplates(appAuthPreflight),
    safeNextAction,
    forbiddenInputs: [
      "raw-env-values",
      "credential-values",
      "cookie-values",
      "endpoint-urls",
      "unapproved-env-source-paths",
    ],
    safety: {
      sourcePathOmitted: true,
      sourceEvidenceHandleOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      envFileRead,
      vercelApiCalled: false,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildOperatorInputPacket({
  blockingInput,
  approvedServerOnlyEnvSourceLabel,
  requiredServerOnlyEnvNames,
  readyForVercelEnvSyncDryRun,
  approvedEvidenceHandleProvided,
  safeNextAction,
}) {
  const status = readyForVercelEnvSyncDryRun
    ? "operator-input-cleared"
    : approvedEvidenceHandleProvided
      ? "operator-env-name-presence-evidence-required"
      : "operator-approved-source-required";
  const nextSafeCommandTemplateKey = readyForVercelEnvSyncDryRun
    ? "vercelEnvSyncDryRun"
    : approvedEvidenceHandleProvided
      ? "approvedEnvFilePresenceIntake"
      : "approvedSourceHandleIntake";
  const preferredInputMode = readyForVercelEnvSyncDryRun
    ? "vercel-env-sync-dry-run"
    : approvedEvidenceHandleProvided
      ? "approved-env-file-presence"
      : "approved-source-handle";
  const safeInputInstruction = approvedEvidenceHandleProvided
    ? "Use the approved source handle to produce redacted env-name presence evidence; do not paste raw values, URLs, cookies, credentials, or unredacted local paths into reports or chat."
    : readyForVercelEnvSyncDryRun
      ? "Use the redacted env-file presence proof for a dry-run env sync only; do not emit raw values, URLs, cookies, or credentials."
      : "Provide an approved source handle or approved env-file presence proof to S19 only; do not paste raw values, URLs, cookies, credentials, or unredacted local paths into reports or chat.";

  return {
    target: "app-auth-env-source-intake-operator-input",
    status,
    firstRequiredInputId: blockingInput ? blockingInput.id : null,
    approvedServerOnlyEnvSourceLabel,
    acceptedInputModes: ["approved-source-handle", "approved-env-file-presence"],
    requiredServerOnlyEnvNames,
    nextSafeAction: safeNextAction,
    nextSafeCommandTemplateKey,
    preferredInputMode,
    safeInputInstruction,
    approvedSourceLabelIsNotEvidence: true,
    valuesForbidden: true,
  };
}

function buildSafeCommandTemplates(appAuthPreflight) {
  return {
    approvedSourceHandleIntake:
      "node scripts/app-auth-env-source-intake.mjs --approved --evidence-handle <approved-source-handle> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
    approvedEnvFilePresenceIntake:
      "node scripts/app-auth-env-source-intake.mjs --live --approved --env-file <approved-env-file> --production-env-source-handoff <production-env-source-handoff> --app-auth-preflight <app-auth-preflight> > <app-auth-env-source-intake-evidence>",
    ...readRecord(appAuthPreflight.safeCommandTemplates),
  };
}

function readDeferredMissingEvidence({ request, appAuthPreflight }) {
  const requestDeferredMissingEvidence = readStringArray(request.deferredMissingEvidence);
  if (requestDeferredMissingEvidence.length > 0) {
    return requestDeferredMissingEvidence;
  }
  const requestMissingEvidence = readStringArray(request.missingEvidence);
  const downstreamRequestMissingEvidence = requestMissingEvidence.filter(
    (evidence) => evidence !== "approved-env-source-path",
  );
  if (downstreamRequestMissingEvidence.length > 0) {
    return downstreamRequestMissingEvidence;
  }
  return readStringArray(appAuthPreflight.missingEvidence);
}

function buildBlockingInput({
  envFileRead,
  missingEnvNames,
  approvedServerOnlyEnvSourceLabel,
  approvedEvidenceHandleProvided,
}) {
  if (envFileRead && missingEnvNames.length > 0) {
    return {
      id: "app-auth-required-env-names-missing",
      label: approvedServerOnlyEnvSourceLabel,
      reason:
        "S19 needs the approved app-auth env source to contain every required server-only env name before Vercel env-sync dry-run evidence can proceed.",
      valuesForbidden: true,
    };
  }

  if (approvedEvidenceHandleProvided) {
    return {
      id: "app-auth-env-name-presence-evidence",
      label: approvedServerOnlyEnvSourceLabel,
      reason:
        "S19 has an approved app-auth source handle, but still needs redacted env-name presence evidence before Vercel env-sync dry-run can proceed.",
      valuesForbidden: true,
    };
  }

  return {
    id: "approved-env-source-path",
    label: approvedServerOnlyEnvSourceLabel,
    reason:
      "S19 can read app-auth env names only after the approved server-only env source is available as a local path or evidence handle without exposing values.",
    valuesForbidden: true,
  };
}

function findAppAuthRequest(handoff) {
  const sourceRequests = readRecordArray(handoff.sourceRequests);
  return sourceRequests.find((request) =>
    readString(request.id, "") === "app-auth-provider-production-selector",
  ) ?? {};
}

function parseEnvFile(path) {
  if (!existsSync(path)) {
    throw new Error("Approved env file was not found.");
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const entries = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    if (key.length > 0) {
      entries.set(key, true);
    }
  }
  return entries;
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS App Auth Env Source Intake",
    "",
    `Status: \`${report.status}\``,
    `Mode: \`${report.mode}\``,
    `Env source label: \`${report.approvedServerOnlyEnvSourceLabel}\``,
    `Provider mode: \`${report.approvedProviderMode}\``,
    `Ready for Vercel env-sync dry run: \`${report.summary.readyForVercelEnvSyncDryRun}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Required Server-Only Env Names",
    "",
    ...report.envPresence.map((entry) =>
      `- \`${entry.name}\`: ${entry.present ? "present" : "pending"}`,
    ),
    "",
    "## Safe Command Templates",
    "",
    ...Object.entries(report.safeCommandTemplates).map(
      ([name, command]) => `- \`${name}\`: \`${command}\``,
    ),
    "",
    "## Forbidden Inputs",
    "",
    ...report.forbiddenInputs.map((input) => `- \`${input}\``),
  ];

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function readJsonArg(args, key) {
  const path = args[key];
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`Missing required --${key}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function readRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

main();
