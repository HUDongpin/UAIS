#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const handoff = readJsonArg(args, "production-env-source-handoff");
  const externalStoragePreflight = readJsonArg(args, "external-storage-preflight");
  const teacherAuthProductionEvidenceGate =
    typeof args["teacher-auth-production-evidence-gate"] === "string"
      ? readJsonArg(args, "teacher-auth-production-evidence-gate")
      : undefined;
  const report = buildReport({
    args,
    handoff,
    externalStoragePreflight,
    teacherAuthProductionEvidenceGate,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ args, handoff, externalStoragePreflight, teacherAuthProductionEvidenceGate }) {
  const request = findRequest(handoff);
  const requiredServerOnlyEnvNames = uniqueStrings([
    ...readStringArray(request.requiredServerOnlyEnvNames),
    ...readStringArray(externalStoragePreflight.requiredServerOnlyEnvNames),
  ]);
  const upstreamAuthEvidenceCleared =
    externalStoragePreflight.summary?.upstreamAuthEvidenceCleared === true;
  const liveApproved = args.live === true && args.approved === true;
  const envFileProvided = typeof args["env-file"] === "string" && args["env-file"].length > 0;
  const envFileRead = upstreamAuthEvidenceCleared && liveApproved && envFileProvided;
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
    readString(externalStoragePreflight.approvedServerOnlyEnvSourceLabel, ""),
  );
  const upstreamEvidenceRequired = !upstreamAuthEvidenceCleared;
  const upstreamOperatorInputRequired =
    upstreamEvidenceRequired &&
    teacherAuthProductionEvidenceGate?.summary?.operatorInputRequired === true;
  const blockingInput =
    readyForVercelEnvSyncDryRun || upstreamEvidenceRequired
      ? null
      : buildBlockingInput(approvedServerOnlyEnvSourceLabel);
  const upstreamBlockingEvidence = upstreamEvidenceRequired
    ? {
        id: "upstream-auth-production-evidence",
        label: "app-auth-and-teacher-auth-production-evidence",
        reason:
          "External-storage env-source intake must wait for app-auth and teacher-auth production evidence before S19 reads the approved external-storage env source.",
        valuesForbidden: true,
        upstreamStatus: readString(teacherAuthProductionEvidenceGate?.status, "unknown"),
        safeNextAction: readString(teacherAuthProductionEvidenceGate?.safeNextAction, ""),
        upstreamOperatorInputRequired,
        upstreamMissingEvidence: readStringArray(
          teacherAuthProductionEvidenceGate?.upstreamBlockingEvidence?.upstreamMissingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          teacherAuthProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamOperatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          teacherAuthProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamSafeCommandTemplates,
        ),
      }
    : null;
  const downstreamMissingEvidence = readDownstreamMissingEvidence({
    request,
    externalStoragePreflight,
  });
  const missingEvidence = readMissingEvidence({
    readyForVercelEnvSyncDryRun,
    upstreamBlockingEvidence,
    blockingInput,
  });
  const deferredMissingEvidence =
    readyForVercelEnvSyncDryRun ? [] : downstreamMissingEvidence;

  return {
    target: "external-storage-env-source-intake",
    status: readStatus({
      upstreamAuthEvidenceCleared,
      readyForVercelEnvSyncDryRun,
      envFileProvided,
      liveApproved,
    }),
    releaseReady: false,
    mode: envFileRead ? "live-approved-redacted-intake" : "dry-run",
    responsibleSession: "S19/S22",
    approvedServiceClass: readString(
      request.approvedServiceClass,
      readString(externalStoragePreflight.approvedServiceClass, ""),
    ),
    approvedRemoteHttpsExternalStorageServiceLabel: readString(
      request.approvedRemoteHttpsExternalStorageServiceLabel,
      readString(externalStoragePreflight.approvedRemoteHttpsExternalStorageServiceLabel, ""),
    ),
    approvedServerOnlyEnvSourceLabel,
    approvedReleaseRunIdLabel: readString(
      request.approvedReleaseRunIdLabel,
      readString(externalStoragePreflight.approvedReleaseRunIdLabel, ""),
    ),
    approvedSmokeTeacherIdLabel: readString(
      request.approvedSmokeTeacherIdLabel,
      readString(externalStoragePreflight.approvedSmokeTeacherIdLabel, ""),
    ),
    summary: {
      ownerInputRequired: false,
      operatorInputRequired: blockingInput !== null || upstreamOperatorInputRequired,
      blockingInputRequired: blockingInput !== null || upstreamOperatorInputRequired,
      upstreamEvidenceRequired,
      upstreamAuthEvidenceCleared,
      requiredEnvNameCount: requiredServerOnlyEnvNames.length,
      presentEnvNameCount,
      missingEnvNameCount: missingEnvNames.length,
      envFileProvided,
      envValuesEmitted: false,
      readyForVercelEnvSyncDryRun,
      releaseReady: false,
    },
    requiredServerOnlyEnvNames,
    envPresence,
    missingEnvNames,
    blockingInput,
    upstreamBlockingEvidence,
    missingEvidence,
    deferredMissingEvidence,
    safeCommandTemplates: readRecord(externalStoragePreflight.safeCommandTemplates),
    blockedReasons: buildBlockedReasons({
      upstreamAuthEvidenceCleared,
      envFileProvided,
      liveApproved,
      readyForVercelEnvSyncDryRun,
    }),
    safeNextAction: readSafeNextAction({
      upstreamAuthEvidenceCleared,
      readyForVercelEnvSyncDryRun,
      upstreamBlockingEvidence,
    }),
    forbiddenInputs: [
      "raw-env-values",
      "credential-values",
      "cookie-values",
      "endpoint-urls",
      "unapproved-env-source-paths",
    ],
    safety: {
      sourcePathOmitted: true,
      rawUrlsOmitted: true,
      endpointValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead,
      vercelApiCalled: false,
      noRemoteWritePerformed: true,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function readDownstreamMissingEvidence({ request, externalStoragePreflight }) {
  const requestDeferredMissingEvidence = readStringArray(request.deferredMissingEvidence);
  if (requestDeferredMissingEvidence.length > 0) {
    return requestDeferredMissingEvidence;
  }
  const requestMissingEvidence = readStringArray(request.missingEvidence);
  if (requestMissingEvidence.length > 0) {
    return requestMissingEvidence;
  }
  return readStringArray(externalStoragePreflight.missingEvidence);
}

function readMissingEvidence({
  readyForVercelEnvSyncDryRun,
  upstreamBlockingEvidence,
  blockingInput,
}) {
  if (readyForVercelEnvSyncDryRun) {
    return [];
  }
  if (upstreamBlockingEvidence) {
    return [upstreamBlockingEvidence.id];
  }
  if (blockingInput) {
    return [blockingInput.id];
  }
  return [];
}

function buildBlockingInput(approvedServerOnlyEnvSourceLabel) {
  return {
    id: "approved-env-source-path",
    label: approvedServerOnlyEnvSourceLabel,
    reason:
      "S19 can read external-storage env names only after the approved server-only env source is available as a local path or evidence handle without exposing values.",
    valuesForbidden: true,
  };
}

function readStatus({
  upstreamAuthEvidenceCleared,
  readyForVercelEnvSyncDryRun,
  envFileProvided,
  liveApproved,
}) {
  if (!upstreamAuthEvidenceCleared) {
    return "external-storage-env-source-intake-waiting-for-upstream-auth";
  }
  if (readyForVercelEnvSyncDryRun) {
    return "external-storage-env-source-intake-ready-for-vercel-env-sync-dry-run";
  }
  if (envFileProvided && !liveApproved) {
    return "external-storage-env-source-intake-rejected-unapproved-env-file";
  }
  return "external-storage-env-source-intake-awaiting-approved-source-path";
}

function buildBlockedReasons({
  upstreamAuthEvidenceCleared,
  envFileProvided,
  liveApproved,
  readyForVercelEnvSyncDryRun,
}) {
  if (readyForVercelEnvSyncDryRun) {
    return [];
  }
  return uniqueStrings([
    ...(!upstreamAuthEvidenceCleared
      ? ["upstream-auth-production-evidence-not-cleared"]
      : []),
    ...(envFileProvided && !liveApproved ? ["unapproved-env-file-rejected"] : []),
  ]);
}

function readSafeNextAction({
  upstreamAuthEvidenceCleared,
  readyForVercelEnvSyncDryRun,
  upstreamBlockingEvidence,
}) {
  if (readyForVercelEnvSyncDryRun) {
    return "run-s19-vercel-env-sync-dry-run-for-external-storage";
  }
  if (!upstreamAuthEvidenceCleared) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "wait-for-app-and-teacher-auth-production-evidence-before-external-storage-env-source-intake",
    );
  }
  return "provide-approved-env-source-path-to-s19";
}

function findRequest(handoff) {
  return readRecordArray(handoff.sourceRequests).find((request) =>
    readString(request.id, "") === "external-storage-production-service",
  ) ?? {};
}

function parseEnvFile(path) {
  if (!existsSync(path)) {
    throw new Error("Approved env file was not found.");
  }
  const entries = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
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
    "# UAIS External Storage Env Source Intake",
    "",
    `Status: \`${report.status}\``,
    `Mode: \`${report.mode}\``,
    `Env source label: \`${report.approvedServerOnlyEnvSourceLabel}\``,
    `Service label: \`${report.approvedRemoteHttpsExternalStorageServiceLabel}\``,
    `Owner input required: \`${report.summary.ownerInputRequired}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Upstream evidence required: \`${report.summary.upstreamEvidenceRequired}\``,
    `Upstream auth cleared: \`${report.summary.upstreamAuthEvidenceCleared}\``,
    `Ready for Vercel env-sync dry run: \`${report.summary.readyForVercelEnvSyncDryRun}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Blocking Input",
    "",
    ...(report.blockingInput
      ? [`- \`${report.blockingInput.id}\`: \`${report.blockingInput.label}\``]
      : ["- `none-recorded`"]),
    "",
    "## Upstream Blocking Evidence",
    "",
    ...(report.upstreamBlockingEvidence
      ? [
          `- \`${report.upstreamBlockingEvidence.id}\`: \`${report.upstreamBlockingEvidence.label}\``,
        ]
      : ["- `none-recorded`"]),
    ...(report.upstreamBlockingEvidence &&
    Object.keys(report.upstreamBlockingEvidence.upstreamOperatorInputPacket ?? {}).length > 0
      ? [
          "",
          "## Upstream Operator Input Packet",
          "",
          `- Status: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.status}\``,
          `- First required input: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.firstRequiredInputId}\``,
          `- Next safe action: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.nextSafeAction}\``,
          `- Next command template: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.nextSafeCommandTemplateKey}\``,
          `- Values forbidden: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.valuesForbidden}\``,
          `- Preferred input mode: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.preferredInputMode ?? "not-recorded"}\``,
          `- Safe input instruction: ${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.safeInputInstruction ?? "not-recorded"}`,
          `- Approved source label is evidence: \`${report.upstreamBlockingEvidence.upstreamOperatorInputPacket.approvedSourceLabelIsNotEvidence === true ? "false" : "not-recorded"}\``,
        ]
      : []),
    ...(report.upstreamBlockingEvidence &&
    Object.keys(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates ?? {}).length > 0
      ? [
          "",
          "## Upstream Safe Operator Command Templates",
          "",
          ...Object.entries(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates).map(
            ([name, command]) => `- \`${name}\`: \`${command}\``,
          ),
        ]
      : []),
    "",
    "## Required Server-Only Env Names",
    "",
    ...report.envPresence.map((entry) =>
      `- \`${entry.name}\`: ${entry.present ? "present" : "pending"}`,
    ),
    "",
    "## Blocked Reasons",
    "",
    ...formatBullets(report.blockedReasons),
    "",
    "## Forbidden Inputs",
    "",
    ...report.forbiddenInputs.map((input) => `- \`${input}\``),
  ];

  return `${lines.join("\n")}\n`;
}

function formatBullets(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``) : ["- `none-recorded`"];
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
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
  return isRecord(value) ? value : {};
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSafeCommandTemplates(value) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([name, command]) =>
        /^[A-Za-z0-9._:-]+$/.test(name) &&
        typeof command === "string" &&
        !/\/Users\/|https?:\/\/|(?:SECRET|TOKEN|KEY|PASSWORD|COOKIE|CREDENTIAL)\s*=/i.test(
          command,
        ),
    ),
  );
}

function readSafeOperatorInputPacket(value) {
  if (!isRecord(value)) {
    return {};
  }
  return {
    target: readString(value.target, ""),
    status: readString(value.status, ""),
    firstRequiredInputId: readString(value.firstRequiredInputId, ""),
    approvedServerOnlyEnvSourceLabel: readString(value.approvedServerOnlyEnvSourceLabel, ""),
    acceptedInputModes: readStringArray(value.acceptedInputModes),
    requiredServerOnlyEnvNames: readStringArray(value.requiredServerOnlyEnvNames),
    nextSafeAction: readString(value.nextSafeAction, ""),
    nextSafeCommandTemplateKey: readString(value.nextSafeCommandTemplateKey, ""),
    ...(readString(value.preferredInputMode, "").length > 0
      ? { preferredInputMode: readString(value.preferredInputMode, "") }
      : {}),
    ...(readString(value.safeInputInstruction, "").length > 0
      ? { safeInputInstruction: readString(value.safeInputInstruction, "") }
      : {}),
    ...(value.approvedSourceLabelIsNotEvidence === true
      ? { approvedSourceLabelIsNotEvidence: true }
      : {}),
    valuesForbidden: value.valuesForbidden === true,
  };
}

main();
