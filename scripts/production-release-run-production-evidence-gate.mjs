#!/usr/bin/env node

import { readFileSync } from "node:fs";

const provedEvidence = [
  "final-release-gate-ready",
  "owner-checklist-clear",
  "enterprise-live-evidence-audit-cleared",
  "one-public-release-run-id-used-across-production-evidence",
  "vercel-production-deployment-bound-to-release-run",
  "redacted-production-evidence-set-bound-to-release-run",
  "redacted-release-summary-ready",
  "rollback-or-hold-plan-present",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const productionReleaseRunPreflight = readJsonArg(args, "production-release-run-preflight");
  const enterpriseAuditGate =
    typeof args["enterprise-audit-gate"] === "string"
      ? readJsonArg(args, "enterprise-audit-gate")
      : undefined;
  const finalReleaseGate =
    typeof args["final-release-gate"] === "string"
      ? readJsonArg(args, "final-release-gate")
      : undefined;
  const releaseRunRecord =
    typeof args["release-run-record"] === "string"
      ? readJsonArg(args, "release-run-record")
      : undefined;
  const report = buildReport({
    productionReleaseRunPreflight,
    enterpriseAuditGate,
    finalReleaseGate,
    releaseRunRecord,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({
  productionReleaseRunPreflight,
  enterpriseAuditGate,
  finalReleaseGate,
  releaseRunRecord,
}) {
  const preflightSummary = isRecord(productionReleaseRunPreflight.summary)
    ? productionReleaseRunPreflight.summary
    : {};
  const ownerResponseAccepted = preflightSummary.ownerResponseAccepted === true;
  const finalReleaseGateReady = preflightSummary.finalReleaseGateReady === true;
  const enterpriseAuditPreflightCleared = preflightSummary.enterpriseAuditPreflightCleared === true;
  const releaseRunConsistencyCleared = preflightSummary.releaseRunConsistencyCleared === true;
  const releaseRunBindingApproved =
    preflightSummary.releaseRunBindingMayProceedAfterSeparateOwnerAction === true;
  const preflightReady =
    readString(productionReleaseRunPreflight.status, "") ===
      "production-release-run-production-evidence-preflight-ready" &&
    ownerResponseAccepted &&
    finalReleaseGateReady &&
    enterpriseAuditPreflightCleared &&
    releaseRunConsistencyCleared &&
    releaseRunBindingApproved;
  const enterpriseAuditGateStatus = evaluateEnterpriseAuditGate(enterpriseAuditGate);
  const finalReleaseGateStatus = evaluateFinalReleaseGate(finalReleaseGate);
  const releaseRunRecordStatus = evaluateReleaseRunRecord({
    releaseRunRecord,
    expectedReleaseRunId: readReleaseRunId(finalReleaseGate) || readReleaseRunId(enterpriseAuditGate),
  });
  const enterpriseAuditGateAccepted =
    enterpriseAuditGateStatus.status ===
    "enterprise-live-evidence-audit-production-evidence-gate-cleared";
  const finalReleaseGateAccepted = finalReleaseGateStatus.status === "ready";
  const releaseRunRecordAccepted = releaseRunRecordStatus.status === "bound";
  const releaseRunBound =
    enterpriseAuditGateStatus.releaseRunBound === true &&
    finalReleaseGateStatus.releaseRunConsistencyStatus === "matched" &&
    releaseRunRecordStatus.releaseRunIdStatus === "matched";
  const productionReleaseRunCleared =
    preflightReady &&
    enterpriseAuditGateAccepted &&
    finalReleaseGateAccepted &&
    releaseRunRecordAccepted &&
    releaseRunBound;
  const upstreamEvidenceRequired = !productionReleaseRunCleared && !preflightReady;
  const upstreamOperatorInputRequired =
    upstreamEvidenceRequired && enterpriseAuditGate?.summary?.operatorInputRequired === true;
  const upstreamBlockingEvidence = upstreamEvidenceRequired
    ? {
        id: "upstream-enterprise-live-evidence-audit-production-evidence-gate",
        label: "enterprise-live-evidence-audit-production-evidence-gate",
        reason:
          "Production release-run evidence must wait for final release gate and enterprise live-evidence audit evidence before release-run binding can be requested.",
        valuesForbidden: true,
        upstreamStatus: readString(enterpriseAuditGate?.status, "unknown"),
        safeNextAction: readString(enterpriseAuditGate?.safeNextAction, ""),
        upstreamOperatorInputRequired,
        upstreamMissingEvidence: readStringArray(
          enterpriseAuditGate?.upstreamBlockingEvidence?.upstreamMissingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          enterpriseAuditGate?.upstreamBlockingEvidence?.upstreamOperatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          enterpriseAuditGate?.upstreamBlockingEvidence?.upstreamSafeCommandTemplates,
        ),
      }
    : null;

  return {
    target: "production-release-run-production-evidence-gate",
    status: readStatus({ productionReleaseRunCleared, preflightReady }),
    releaseReady: false,
    responsibleSession: "S22/S10/S25",
    summary: {
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      ownerResponseAccepted,
      finalReleaseGateReady,
      enterpriseAuditPreflightCleared,
      releaseRunConsistencyCleared,
      releaseRunBindingApproved,
      preflightReady,
      enterpriseAuditGateProvided: enterpriseAuditGate !== undefined,
      enterpriseAuditGateAccepted,
      finalReleaseGateProvided: finalReleaseGate !== undefined,
      finalReleaseGateAccepted,
      releaseRunRecordProvided: releaseRunRecord !== undefined,
      releaseRunRecordAccepted,
      releaseRunBound,
      productionReleaseRunCleared,
      releaseReady: false,
    },
    enterpriseAuditGateStatus,
    finalReleaseGateStatus,
    releaseRunRecordStatus,
    upstreamBlockingEvidence,
    provedEvidence: productionReleaseRunCleared ? provedEvidence : [],
    blockedReasons: buildBlockedReasons({
      productionReleaseRunPreflight,
      ownerResponseAccepted,
      finalReleaseGateReady,
      enterpriseAuditPreflightCleared,
      releaseRunConsistencyCleared,
      releaseRunBindingApproved,
      enterpriseAuditGateStatus,
      finalReleaseGateStatus,
      releaseRunRecordStatus,
      productionReleaseRunCleared,
    }),
    safeNextAction: readSafeNextAction({
      productionReleaseRunCleared,
      preflightReady,
      upstreamBlockingEvidence,
    }),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      deploymentUrlsOmitted: true,
      cookieValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      liveSmokeRun: false,
      releaseGateRefreshPerformed: false,
      releaseRunBindingPerformed: false,
      noRemoteWritePerformed: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      finalReleaseGateReadyEvidenceRequired: true,
      ownerApprovalRequired: true,
    },
  };
}

function readStatus({ productionReleaseRunCleared, preflightReady }) {
  if (productionReleaseRunCleared) {
    return "production-release-run-production-evidence-gate-cleared";
  }
  if (!preflightReady) {
    return "production-release-run-production-evidence-gate-waiting-for-final-release-gate";
  }
  return "production-release-run-production-evidence-gate-awaiting-release-run-record";
}

function evaluateEnterpriseAuditGate(evidence) {
  if (evidence === undefined) {
    return {
      target: "enterprise-live-evidence-audit-production-evidence-gate",
      status: "missing",
      releaseRunBound: false,
      valueRedacted: true,
    };
  }
  const summary = isRecord(evidence.summary) ? evidence.summary : {};
  return {
    target: readString(evidence.target, "missing"),
    status:
      evidence.target === "enterprise-live-evidence-audit-production-evidence-gate" &&
      evidence.status === "enterprise-live-evidence-audit-production-evidence-gate-cleared" &&
      summary.enterpriseLiveEvidenceAuditCleared === true &&
      summary.releaseRunBound === true
        ? "enterprise-live-evidence-audit-production-evidence-gate-cleared"
        : "not-cleared",
    releaseRunBound: summary.releaseRunBound === true,
    valueRedacted: true,
  };
}

function evaluateFinalReleaseGate(evidence) {
  if (evidence === undefined) {
    return {
      target: "production-e2e-release-gate",
      status: "missing",
      ownerDecisionQueueStatus: "missing",
      releaseRunConsistencyStatus: "missing",
      valueRedacted: true,
    };
  }
  const summary = isRecord(evidence.summary) ? evidence.summary : {};
  const releaseRunConsistencyStatus = readString(
    summary.productionReleaseRunConsistencyStatus,
    readString(evidence.productionReleaseRunConsistencyStatus, "missing"),
  );
  return {
    target: readString(evidence.target, "missing"),
    status:
      evidence.target === "production-e2e-release-gate" &&
      (evidence.status === "ready" || evidence.releaseGateStatus === "ready") &&
      evidence.ownerDecisionQueueStatus === "no-owner-decisions-required" &&
      summary.releaseReady === true &&
      releaseRunConsistencyStatus === "matched"
        ? "ready"
        : "not-ready",
    ownerDecisionQueueStatus: readString(evidence.ownerDecisionQueueStatus, "missing"),
    releaseRunConsistencyStatus,
    valueRedacted: true,
  };
}

function evaluateReleaseRunRecord({ releaseRunRecord, expectedReleaseRunId }) {
  if (releaseRunRecord === undefined) {
    return {
      target: "production-release-run",
      status: "missing",
      releaseRunIdStatus: "missing",
      valueRedacted: true,
    };
  }
  const releaseRunIdStatus =
    expectedReleaseRunId && releaseRunRecord.releaseRunId === expectedReleaseRunId
      ? "matched"
      : "mismatched";
  return {
    target: readString(releaseRunRecord.target, "missing"),
    status: isReleaseRunRecordAccepted(releaseRunRecord) ? "bound" : "not-bound",
    releaseRunIdStatus,
    valueRedacted: true,
  };
}

function isReleaseRunRecordAccepted(record) {
  return (
    record.target === "production-release-run" &&
    record.mode === "record" &&
    record.status === "bound" &&
    record.finalReleaseGateStatus === "ready" &&
    record.ownerChecklistStatus === "no-owner-decisions-required" &&
    record.enterpriseAuditGateStatus === "cleared" &&
    record.sharedReleaseRunIdStatus === "matched" &&
    record.vercelProductionDeploymentStatus === "bound" &&
    record.productionEvidenceSetStatus === "matched" &&
    record.redactedReleaseSummaryStatus === "ready" &&
    record.rollbackOrHoldPlanStatus === "present" &&
    hasReleaseRunRecordSafety(record.safety)
  );
}

function hasReleaseRunRecordSafety(safety) {
  return (
    isRecord(safety) &&
    safety.valuesRedacted === true &&
    safety.deploymentUrlsOmitted === true &&
    safety.cookieValuesOmitted === true &&
    safety.credentialValuesOmitted === true &&
    safety.responseBodiesOmitted === true &&
    safety.localPathsOmitted === true
  );
}

function buildBlockedReasons({
  productionReleaseRunPreflight,
  ownerResponseAccepted,
  finalReleaseGateReady,
  enterpriseAuditPreflightCleared,
  releaseRunConsistencyCleared,
  releaseRunBindingApproved,
  enterpriseAuditGateStatus,
  finalReleaseGateStatus,
  releaseRunRecordStatus,
  productionReleaseRunCleared,
}) {
  if (productionReleaseRunCleared) {
    return [];
  }
  return uniqueStrings([
    ...(!finalReleaseGateReady ? ["final-release-gate-not-ready"] : []),
    ...(!enterpriseAuditPreflightCleared ? ["enterprise-live-evidence-audit-not-ready"] : []),
    ...(!releaseRunConsistencyCleared ? ["release-run-consistency-not-cleared"] : []),
    ...(!ownerResponseAccepted ? ["production-release-run-owner-response-not-accepted"] : []),
    ...(!releaseRunBindingApproved
      ? ["release-run-binding-not-approved-for-separate-owner-action"]
      : []),
    ...(enterpriseAuditGateStatus.status === "missing"
      ? ["enterprise-live-evidence-audit-gate-missing"]
      : enterpriseAuditGateStatus.status ===
          "enterprise-live-evidence-audit-production-evidence-gate-cleared"
        ? []
        : [`enterprise-live-evidence-audit-gate-${enterpriseAuditGateStatus.status}`]),
    ...(finalReleaseGateStatus.status === "missing"
      ? ["final-release-gate-evidence-missing"]
      : finalReleaseGateStatus.status === "ready"
        ? []
        : [`final-release-gate-evidence-${finalReleaseGateStatus.status}`]),
    ...(releaseRunRecordStatus.status === "missing"
      ? ["production-release-run-record-missing"]
      : releaseRunRecordStatus.status === "bound"
        ? []
        : [`production-release-run-record-${releaseRunRecordStatus.status}`]),
    ...readStringArray(productionReleaseRunPreflight.blockedReasons),
  ]);
}

function readSafeNextAction({ productionReleaseRunCleared, preflightReady, upstreamBlockingEvidence }) {
  if (productionReleaseRunCleared) {
    return "publish-redacted-production-release-run-summary";
  }
  if (!preflightReady) {
    return readString(upstreamBlockingEvidence?.safeNextAction, "wait-for-final-release-gate-ready");
  }
  return "prepare-redacted-production-release-run-record";
}

function readReleaseRunId(evidence) {
  return isRecord(evidence) && typeof evidence.releaseRunId === "string"
    ? evidence.releaseRunId
    : "";
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Production Release Run Production Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Preflight ready: \`${report.summary.preflightReady}\``,
    `Final release gate accepted: \`${report.summary.finalReleaseGateAccepted}\``,
    `Enterprise audit gate accepted: \`${report.summary.enterpriseAuditGateAccepted}\``,
    `Release-run record accepted: \`${report.summary.releaseRunRecordAccepted}\``,
    `Release run bound: \`${report.summary.releaseRunBound}\``,
    "",
    "This gate reads only redacted evidence reports. It does not read env files, run production smokes, refresh the release gate, deploy, call Vercel, or bind a release run.",
    "",
    "## Evidence Status",
    "",
    `- Enterprise audit gate: \`${report.enterpriseAuditGateStatus.status}\``,
    `- Final release gate: \`${report.finalReleaseGateStatus.status}\``,
    `- Release-run record: \`${report.releaseRunRecordStatus.status}\``,
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

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
