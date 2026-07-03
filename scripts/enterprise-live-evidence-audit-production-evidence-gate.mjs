#!/usr/bin/env node

import { readFileSync } from "node:fs";

const provedEvidence = [
  "body-level-production-live-evidence-audit-proof",
  "all-orchestrated-production-live-targets-present",
  "shared-release-run-id-across-production-live-evidence",
  "required-production-live-safety-redaction-flags",
  "target-specific-result-proof-keys-body-proven",
  "target-specific-contract-proof-keys-body-proven",
  "filename-only-production-live-evidence-rejected",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const enterpriseAuditPreflight = readJsonArg(args, "enterprise-audit-preflight");
  const ordinaryTeachingProductionEvidenceGate =
    typeof args["ordinary-teaching-production-evidence-gate"] === "string"
      ? readJsonArg(args, "ordinary-teaching-production-evidence-gate")
      : undefined;
  const enterpriseAuditReport =
    typeof args["enterprise-audit-report"] === "string"
      ? readJsonArg(args, "enterprise-audit-report")
      : undefined;
  const report = buildReport({
    enterpriseAuditPreflight,
    ordinaryTeachingProductionEvidenceGate,
    enterpriseAuditReport,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({
  enterpriseAuditPreflight,
  ordinaryTeachingProductionEvidenceGate,
  enterpriseAuditReport,
}) {
  const preflightSummary = isRecord(enterpriseAuditPreflight.summary)
    ? enterpriseAuditPreflight.summary
    : {};
  const ownerResponseAccepted = preflightSummary.ownerResponseAccepted === true;
  const liveEvidenceTargetsCleared = preflightSummary.liveEvidenceTargetsCleared === true;
  const upstreamProductionPreflightsCleared =
    preflightSummary.upstreamProductionPreflightsCleared === true;
  const releaseRunConsistencyCleared = preflightSummary.releaseRunConsistencyCleared === true;
  const preflightReady =
    readString(enterpriseAuditPreflight.status, "") ===
      "enterprise-live-evidence-audit-production-evidence-preflight-ready" &&
    ownerResponseAccepted &&
    liveEvidenceTargetsCleared &&
    upstreamProductionPreflightsCleared &&
    releaseRunConsistencyCleared;
  const auditReportStatus = evaluateAuditReport({
    auditReport: enterpriseAuditReport,
    requiredTargetCount: readNumber(preflightSummary.requiredTargetCount),
  });
  const auditReportAccepted = auditReportStatus.status === "ready";
  const releaseRunBound =
    auditReportStatus.releaseRunIdConsistency === "matched" &&
    auditReportStatus.sharedReleaseRunIdStatus === "present";
  const enterpriseLiveEvidenceAuditCleared =
    preflightReady && auditReportAccepted && releaseRunBound;
  const upstreamEvidenceRequired = !enterpriseLiveEvidenceAuditCleared && !preflightReady;
  const upstreamOperatorInputRequired =
    upstreamEvidenceRequired &&
    ordinaryTeachingProductionEvidenceGate?.summary?.operatorInputRequired === true;
  const upstreamBlockingEvidence = upstreamEvidenceRequired
    ? {
        id: "upstream-ordinary-teaching-production-evidence-gate",
        label: "ordinary-teaching-production-evidence-gate",
        reason:
          "Enterprise live evidence audit must wait for all upstream production evidence gates before the final live-evidence audit can be requested.",
        valuesForbidden: true,
        upstreamStatus: readString(ordinaryTeachingProductionEvidenceGate?.status, "unknown"),
        safeNextAction: readString(ordinaryTeachingProductionEvidenceGate?.safeNextAction, ""),
        upstreamOperatorInputRequired,
        upstreamMissingEvidence: readStringArray(
          ordinaryTeachingProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamMissingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          ordinaryTeachingProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamOperatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          ordinaryTeachingProductionEvidenceGate?.upstreamBlockingEvidence
            ?.upstreamSafeCommandTemplates,
        ),
      }
    : null;

  return {
    target: "enterprise-live-evidence-audit-production-evidence-gate",
    status: readStatus({ enterpriseLiveEvidenceAuditCleared, preflightReady }),
    releaseReady: false,
    responsibleSession: "S22/S10/S25",
    summary: {
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      ownerResponseAccepted,
      liveEvidenceTargetsCleared,
      upstreamProductionPreflightsCleared,
      releaseRunConsistencyCleared,
      preflightReady,
      auditReportProvided: enterpriseAuditReport !== undefined,
      auditReportAccepted,
      requiredTargetCount: readNumber(
        preflightSummary.requiredTargetCount,
        auditReportStatus.requiredTargetCount,
      ),
      acceptedLiveEvidenceCount: auditReportStatus.acceptedLiveEvidenceCount,
      missingRequiredTargetCount: auditReportStatus.missingRequiredTargetCount,
      filenameOnlyOrBlocked: auditReportStatus.filenameOnlyOrBlocked,
      releaseRunBound,
      enterpriseLiveEvidenceAuditCleared,
      releaseReady: false,
    },
    auditReportStatus: omitInternalAuditCounts(auditReportStatus),
    upstreamBlockingEvidence,
    acceptedTargets: enterpriseLiveEvidenceAuditCleared
      ? readStringArray(enterpriseAuditReport.acceptedTargets)
      : [],
    missingRequiredTargets: enterpriseLiveEvidenceAuditCleared
      ? []
      : readStringArray(enterpriseAuditPreflight.missingRequiredTargets),
    provedEvidence: enterpriseLiveEvidenceAuditCleared ? provedEvidence : [],
    blockedReasons: buildBlockedReasons({
      ownerResponseAccepted,
      liveEvidenceTargetsCleared,
      upstreamProductionPreflightsCleared,
      releaseRunConsistencyCleared,
      auditReportStatus,
      enterpriseLiveEvidenceAuditCleared,
    }),
    safeNextAction: readSafeNextAction({
      enterpriseLiveEvidenceAuditCleared,
      preflightReady,
      upstreamBlockingEvidence,
    }),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      fileNamesOmitted: true,
      cookieValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      liveAuditRun: false,
      releaseGateRefreshPerformed: false,
      noRemoteWritePerformed: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      filenameOnlyEvidenceRejected: true,
      liveEvidenceRequired: true,
    },
  };
}

function readStatus({ enterpriseLiveEvidenceAuditCleared, preflightReady }) {
  if (enterpriseLiveEvidenceAuditCleared) {
    return "enterprise-live-evidence-audit-production-evidence-gate-cleared";
  }
  if (!preflightReady) {
    return "enterprise-live-evidence-audit-production-evidence-gate-waiting-for-required-live-evidence";
  }
  return "enterprise-live-evidence-audit-production-evidence-gate-awaiting-audit-report";
}

function evaluateAuditReport({ auditReport, requiredTargetCount }) {
  if (auditReport === undefined) {
    return {
      target: "enterprise-live-evidence-audit",
      status: "missing",
      releaseRunIdConsistency: "missing",
      sharedReleaseRunIdStatus: "missing",
      valueRedacted: true,
      requiredTargetCount,
      acceptedLiveEvidenceCount: 0,
      missingRequiredTargetCount: requiredTargetCount,
      filenameOnlyOrBlocked: requiredTargetCount,
    };
  }

  const summary = isRecord(auditReport.summary) ? auditReport.summary : {};
  const requiredTargets = readStringArray(auditReport.requiredTargets);
  const acceptedTargets = readStringArray(auditReport.acceptedTargets);
  const missingRequiredTargets = readStringArray(auditReport.missingRequiredTargets);
  const rows = readRecordArray(auditReport.rows);
  const base = {
    target: readString(auditReport.target, "missing"),
    status: readString(auditReport.status, "missing"),
    releaseRunIdConsistency: readString(summary.releaseRunIdConsistency, "missing"),
    sharedReleaseRunIdStatus: readString(summary.sharedReleaseRunIdStatus, "missing"),
    valueRedacted: true,
    requiredTargetCount: requiredTargets.length || readNumber(summary.totalProductionLiveNamed),
    acceptedLiveEvidenceCount: readNumber(summary.acceptedLiveEvidence),
    missingRequiredTargetCount: readNumber(summary.missingRequiredTargetCount),
    filenameOnlyOrBlocked: readNumber(summary.filenameOnlyOrBlocked),
  };
  if (base.target !== "enterprise-live-evidence-audit") {
    return { ...base, status: "invalid-target" };
  }
  if (auditReport.status !== "ready") {
    return { ...base, status: "not-ready" };
  }
  if (
    base.releaseRunIdConsistency !== "matched" ||
    base.sharedReleaseRunIdStatus !== "present" ||
    readNumber(summary.distinctReleaseRunIdCount) !== 1
  ) {
    return { ...base, status: "release-run-not-bound" };
  }
  if (
    readNumber(summary.filenameOnlyOrBlocked) !== 0 ||
    readNumber(summary.missingRequiredTargetCount) !== 0 ||
    readNumber(summary.unexpectedTargetCount) !== 0 ||
    readNumber(summary.unexpectedEvidenceFileCount) !== 0 ||
    summary.requiredTargetProofStatus !== "proved" ||
    missingRequiredTargets.length !== 0
  ) {
    return { ...base, status: "target-proof-incomplete" };
  }
  if (
    requiredTargets.length === 0 ||
    acceptedTargets.length !== requiredTargets.length ||
    readNumber(summary.acceptedLiveEvidence) !== requiredTargets.length
  ) {
    return { ...base, status: "accepted-target-count-mismatch" };
  }
  if (!rowsProveAcceptedTargets({ rows, requiredTargets })) {
    return { ...base, status: "row-proof-incomplete" };
  }
  if (!hasAuditSafety(auditReport.safety)) {
    return { ...base, status: "redaction-safety-missing" };
  }
  return { ...base, status: "ready" };
}

function rowsProveAcceptedTargets({ rows, requiredTargets }) {
  const rowsByTarget = new Map(
    rows
      .filter((row) => typeof row.target === "string")
      .map((row) => [row.target, row]),
  );
  return requiredTargets.every((target) => {
    const row = rowsByTarget.get(target);
    return (
      row?.acceptanceStatus === "accepted-live-evidence" &&
      row?.releaseRunIdStatus === "present" &&
      row?.safetyStatus === "proved" &&
      row?.targetResultStatus === "proved" &&
      ["proved", "not-required"].includes(readString(row?.targetEnvStatus, "")) &&
      ["proved", "not-required"].includes(readString(row?.targetContractStatus, ""))
    );
  });
}

function hasAuditSafety(safety) {
  return (
    isRecord(safety) &&
    safety.valuesRedacted === true &&
    safety.cookieValuesOmitted === true &&
    safety.localPathsOmitted === true &&
    safety.fileNamesOnly === true &&
    safety.responseBodiesOmitted === true
  );
}

function omitInternalAuditCounts(auditReportStatus) {
  return {
    target: auditReportStatus.target,
    status: auditReportStatus.status,
    releaseRunIdConsistency: auditReportStatus.releaseRunIdConsistency,
    sharedReleaseRunIdStatus: auditReportStatus.sharedReleaseRunIdStatus,
    valueRedacted: auditReportStatus.valueRedacted,
  };
}

function buildBlockedReasons({
  ownerResponseAccepted,
  liveEvidenceTargetsCleared,
  upstreamProductionPreflightsCleared,
  releaseRunConsistencyCleared,
  auditReportStatus,
  enterpriseLiveEvidenceAuditCleared,
}) {
  if (enterpriseLiveEvidenceAuditCleared) {
    return [];
  }
  return uniqueStrings([
    ...(!liveEvidenceTargetsCleared ? ["enterprise-live-required-targets-missing"] : []),
    ...(!upstreamProductionPreflightsCleared
      ? ["upstream-production-preflights-not-cleared"]
      : []),
    ...(!releaseRunConsistencyCleared ? ["release-run-consistency-not-cleared"] : []),
    ...(!ownerResponseAccepted ? ["enterprise-audit-owner-response-not-accepted"] : []),
    ...(auditReportStatus.status === "missing"
      ? ["enterprise-live-evidence-audit-report-missing"]
      : [`enterprise-live-evidence-audit-report-${auditReportStatus.status}`]),
  ]);
}

function readSafeNextAction({
  enterpriseLiveEvidenceAuditCleared,
  preflightReady,
  upstreamBlockingEvidence,
}) {
  if (enterpriseLiveEvidenceAuditCleared) {
    return "advance-production-release-run-preflight";
  }
  if (!preflightReady) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "wait-for-approved-production-live-evidence-files",
    );
  }
  return "run-enterprise-live-evidence-audit-after-all-target-evidence-exists";
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Enterprise Live Evidence Audit Production Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Preflight ready: \`${report.summary.preflightReady}\``,
    `Audit report accepted: \`${report.summary.auditReportAccepted}\``,
    `Accepted live evidence: ${report.summary.acceptedLiveEvidenceCount} / ${report.summary.requiredTargetCount}`,
    `Missing required targets: ${report.summary.missingRequiredTargetCount}`,
    `Filename-only or blocked evidence: ${report.summary.filenameOnlyOrBlocked}`,
    `Release run bound: \`${report.summary.releaseRunBound}\``,
    "",
    "This gate reads only redacted evidence reports. It does not read env files, run the enterprise audit, refresh the release gate, deploy, call Vercel, or bind a release run.",
    "",
    "## Audit Report Status",
    "",
    `- \`${report.auditReportStatus.status}\``,
    "",
    "## Proved Evidence",
    "",
    ...formatBullets(report.provedEvidence),
    "",
    "## Blocked Reasons",
    "",
    ...formatBullets(report.blockedReasons),
    "",
    "## Safe Next Action",
    "",
    `- \`${report.safeNextAction}\``,
    "",
  ];

  if (report.upstreamBlockingEvidence) {
    lines.push(
      "## Upstream Blocking Evidence",
      "",
      `- \`${report.upstreamBlockingEvidence.id}\`: \`${report.upstreamBlockingEvidence.label}\``,
      `- Safe next action: \`${report.upstreamBlockingEvidence.safeNextAction}\``,
      "",
    );
    if (Object.keys(report.upstreamBlockingEvidence.upstreamOperatorInputPacket ?? {}).length > 0) {
      lines.push(
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
        "",
      );
    }
    if (
      Object.keys(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates ?? {}).length > 0
    ) {
      lines.push(
        "## Upstream Safe Operator Command Templates",
        "",
        ...Object.entries(report.upstreamBlockingEvidence.upstreamSafeCommandTemplates).map(
          ([name, command]) => `- \`${name}\`: \`${command}\``,
        ),
        "",
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatBullets(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return ["- `none-recorded`"];
  }
  return values.map((value) => `- \`${value}\``);
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
    if (typeof next === "string" && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function readJsonArg(args, key) {
  const filePath = args[key];
  if (typeof filePath !== "string") {
    throw new Error(`Missing required --${key} path`);
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
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

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function readNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
