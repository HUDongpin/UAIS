#!/usr/bin/env node

import { readFileSync } from "node:fs";

const requestInputs = [
  { flag: "app-auth-preflight", kind: "app-auth" },
  { flag: "teacher-auth-preflight", kind: "teacher-auth" },
  { flag: "external-storage-preflight", kind: "external-storage" },
  { flag: "vercel-env-deploy-preflight", kind: "vercel-env-deploy" },
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const executionPlan = readJsonArg(args, "execution-plan");
  const preflights = requestInputs.map((input) => ({
    kind: input.kind,
    report: readJsonArg(args, input.flag),
  }));
  const handoff = buildHandoff({ executionPlan, preflights });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(handoff));
    return;
  }

  process.stdout.write(`${JSON.stringify(handoff, null, 2)}\n`);
}

function buildHandoff({ executionPlan, preflights }) {
  const firstRequiredSourceLabel = readString(
    executionPlan.blockingInput?.label,
    findFirstNonEmpty(preflights.map(({ report }) => report.approvedServerOnlyEnvSourceLabel)),
  );
  const firstSafeAction = readString(
    executionPlan.firstSafeAction,
    "provide-approved-env-source-path-to-s19",
  );
  const phaseById = new Map(
    readRecordArray(executionPlan.phases)
      .map((phase) => [readString(phase.id, ""), phase])
      .filter(([id]) => id.length > 0),
  );
  const sourceRequests = preflights.map(({ kind, report }) =>
    buildSourceRequest({ kind, report, firstRequiredSourceLabel, phaseById }),
  );
  const uniqueServerOnlyEnvNames = uniqueStrings(
    sourceRequests.flatMap((request) => request.requiredServerOnlyEnvNames),
  );
  const immediateRequestCount = sourceRequests.filter(
    (request) => request.requestStatus === "ready-for-approved-env-source-path",
  ).length;
  const upstreamGatedRequestCount = sourceRequests.filter(
    (request) => request.requestStatus === "waiting-for-upstream-production-evidence",
  ).length;
  const status =
    firstRequiredSourceLabel.length > 0
      ? "production-env-source-handoff-awaiting-approved-env-source-path"
      : "production-env-source-handoff-missing-approved-source-label";
  const blockingInput = firstRequiredSourceLabel.length > 0
    ? {
        id: "approved-env-source-path",
        label: firstRequiredSourceLabel,
        reason:
          "S19 can start the production env-source handoff only after the approved server-only env source is available as a local path or evidence handle without exposing values.",
        valuesForbidden: true,
      }
    : null;
  const operatorInputPacket = readOperatorInputPacket(executionPlan);
  const operatorInputRequired = blockingInput !== null;
  const ownerInputRequired = firstRequiredSourceLabel.length === 0;
  const nextOperatorSafeInstruction =
    "Provide the approved local env source path or evidence handle to S19 only; do not paste raw values, URLs, cookies, or credentials into reports or chat.";

  return {
    target: "production-env-source-handoff",
    status,
    responsibleSession: "S19/S22",
    releaseReady: false,
    firstRequiredSourceLabel,
    firstSafeAction,
    nextOperatorSafeInstruction,
    nextOwnerSafeInstruction: nextOperatorSafeInstruction,
    summary: {
      ownerInputRequired,
      operatorInputRequired,
      blockingInputRequired: operatorInputRequired,
      sourceRequestCount: sourceRequests.length,
      uniqueServerOnlyEnvNameCount: uniqueServerOnlyEnvNames.length,
      immediateRequestCount,
      upstreamGatedRequestCount,
      envValuesRequired: false,
      releaseReady: false,
    },
    blockingInput,
    operatorInputPacket,
    sourceRequests,
    uniqueServerOnlyEnvNames,
    forbiddenInputs: [
      "raw-env-values",
      "credential-values",
      "cookie-values",
      "endpoint-urls",
      "unapproved-env-source-paths",
    ],
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function readOperatorInputPacket(value) {
  if (!isRecord(value?.operatorInputPacket)) {
    return null;
  }
  const packet = value.operatorInputPacket;
  return {
    target: readString(packet.target, ""),
    status: readString(packet.status, ""),
    firstRequiredInputId: readString(packet.firstRequiredInputId, ""),
    approvedServerOnlyEnvSourceLabel: readString(packet.approvedServerOnlyEnvSourceLabel, ""),
    acceptedInputModes: readStringArray(packet.acceptedInputModes),
    requiredServerOnlyEnvNames: readStringArray(packet.requiredServerOnlyEnvNames),
    nextSafeAction: readString(packet.nextSafeAction, ""),
    nextSafeCommandTemplateKey: readString(packet.nextSafeCommandTemplateKey, ""),
    ...(readString(packet.preferredInputMode, "").length > 0
      ? { preferredInputMode: readString(packet.preferredInputMode, "") }
      : {}),
    ...(readString(packet.safeInputInstruction, "").length > 0
      ? { safeInputInstruction: readString(packet.safeInputInstruction, "") }
      : {}),
    ...(packet.approvedSourceLabelIsNotEvidence === true
      ? { approvedSourceLabelIsNotEvidence: true }
      : {}),
    valuesForbidden: packet.valuesForbidden === true,
  };
}

function buildSourceRequest({ kind, report, firstRequiredSourceLabel, phaseById }) {
  const upstreamBlockers = readStringArray(report.upstreamBlockers);
  const requestId = readString(report.ownerDecisionId, kind);
  const phase = phaseById.get(requestId) ?? {};
  const phaseStatus = readString(phase.status, "none-recorded");
  const nextSafeAction = readString(phase.nextSafeAction, "wait-for-upstream-production-evidence");
  const phaseMissingEvidence = readStringArray(phase.missingEvidence);
  const phaseBlockedReasons = readStringArray(phase.blockedReasons);
  const deferredMissingEvidence = readStringArray(phase.deferredMissingEvidence);
  const approvedServerOnlyEnvSourceLabel = readString(
    report.approvedServerOnlyEnvSourceLabel,
    "",
  );
  const requestStatus = resolveRequestStatus({
    report,
    upstreamBlockers,
    approvedServerOnlyEnvSourceLabel,
    firstRequiredSourceLabel,
  });
  const safeCommandTemplates = readRecord(report.safeCommandTemplates);

  return {
    id: requestId,
    kind,
    requestStatus,
    phaseStatus,
    nextSafeAction,
    preflightStatus: readString(report.status, "unknown"),
    approvedServerOnlyEnvSourceLabel,
    approvedReleaseRunIdLabel: readString(report.approvedReleaseRunIdLabel, ""),
    approvedProviderMode: readString(report.approvedProviderMode, ""),
    approvedServiceClass: readString(report.approvedServiceClass, ""),
    approvedRemoteHttpsExternalStorageServiceLabel: readString(
      report.approvedRemoteHttpsExternalStorageServiceLabel,
      "",
    ),
    approvedSmokeTeacherIdLabel: readString(report.approvedSmokeTeacherIdLabel, ""),
    upstreamBlockers,
    requiredServerOnlyEnvNames: readStringArray(report.requiredServerOnlyEnvNames),
    missingEvidence:
      phaseMissingEvidence.length > 0 ? phaseMissingEvidence : readStringArray(report.missingEvidence),
    ...(phaseBlockedReasons.length > 0 ? { blockedReasons: phaseBlockedReasons } : {}),
    ...(deferredMissingEvidence.length > 0 ? { deferredMissingEvidence } : {}),
    safeCommandTemplateKeys: Object.keys(safeCommandTemplates),
    safeCommandTemplates,
    valueDisclosureForbidden: true,
  };
}

function resolveRequestStatus({
  report,
  upstreamBlockers,
  approvedServerOnlyEnvSourceLabel,
  firstRequiredSourceLabel,
}) {
  const status = readString(report.status, "");
  if (upstreamBlockers.length > 0 || status.includes("waiting-for-upstream")) {
    return "waiting-for-upstream-production-evidence";
  }
  if (
    approvedServerOnlyEnvSourceLabel.length > 0 &&
    approvedServerOnlyEnvSourceLabel === firstRequiredSourceLabel
  ) {
    return "ready-for-approved-env-source-path";
  }
  if (status.includes("ready")) {
    return "ready-for-approved-env-source-path";
  }
  return "waiting-for-approved-env-source-label";
}

function renderMarkdown(handoff) {
  const lines = [
    "# UAIS Production Env Source Handoff",
    "",
    `Status: \`${handoff.status}\``,
    `First required source: \`${handoff.firstRequiredSourceLabel}\``,
    `First safe action: \`${handoff.firstSafeAction}\``,
    `Owner input required: \`${handoff.summary.ownerInputRequired}\``,
    `Operator input required: \`${handoff.summary.operatorInputRequired}\``,
    `Unique server-only env names: ${handoff.summary.uniqueServerOnlyEnvNameCount}`,
    `Release ready: \`${handoff.summary.releaseReady}\``,
    "",
    handoff.nextOperatorSafeInstruction,
    "",
    "## Blocking Input",
    "",
    ...(handoff.blockingInput
      ? [`- \`${handoff.blockingInput.id}\`: \`${handoff.blockingInput.label}\``]
      : ["- `none`"]),
    "",
    ...(handoff.operatorInputPacket
      ? [
          "## Operator Input Packet",
          "",
          `- Status: \`${handoff.operatorInputPacket.status}\``,
          `- First required input: \`${handoff.operatorInputPacket.firstRequiredInputId}\``,
          `- Next safe action: \`${handoff.operatorInputPacket.nextSafeAction}\``,
          `- Next command template: \`${handoff.operatorInputPacket.nextSafeCommandTemplateKey}\``,
          `- Values forbidden: \`${handoff.operatorInputPacket.valuesForbidden}\``,
          `- Preferred input mode: \`${handoff.operatorInputPacket.preferredInputMode ?? "not-recorded"}\``,
          `- Safe input instruction: ${handoff.operatorInputPacket.safeInputInstruction ?? "not-recorded"}`,
          `- Approved source label is evidence: \`${handoff.operatorInputPacket.approvedSourceLabelIsNotEvidence === true ? "false" : "not-recorded"}\``,
          "",
        ]
      : []),
    "## Source Requests",
    "",
    "| Request | Status | Next safe action | Env source label | Env names |",
    "| --- | --- | --- | --- | ---: |",
    ...handoff.sourceRequests.map((request) =>
      [
        `| \`${request.id}\``,
        `| \`${request.requestStatus}\``,
        `| \`${request.nextSafeAction}\``,
        `| \`${request.approvedServerOnlyEnvSourceLabel}\``,
        `| ${request.requiredServerOnlyEnvNames.length} |`,
      ].join(" "),
    ),
    "",
    "## Server-Only Env Names",
    "",
    ...handoff.uniqueServerOnlyEnvNames.map((name) => `- \`${name}\``),
    "",
    "## Forbidden Inputs",
    "",
    ...handoff.forbiddenInputs.map((input) => `- \`${input}\``),
  ];

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { include: [] };
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function findFirstNonEmpty(values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? "";
}

main();
