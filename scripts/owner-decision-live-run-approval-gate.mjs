#!/usr/bin/env node

import { readFileSync } from "node:fs";

const readyStatuses = new Set([
  "accepted",
  "all-decisions-ready",
  "approved",
  "complete",
  "completed",
  "live-ready",
  "passed",
  "ready",
  "release-ready",
  "satisfied",
]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const liveRunPreflight = readJsonArg(args, "live-run-preflight");
  const releaseGate = readJsonArg(args, "release-gate");
  const enterpriseAudit = readJsonArg(args, "enterprise-live-evidence-audit");
  const ownerResponseCompletionValidation = args["owner-response-completion-validation"]
    ? readJsonArg(args, "owner-response-completion-validation")
    : null;
  const ownerResponsePostvalidationSuite = args["owner-response-postvalidation-suite"]
    ? readJsonArg(args, "owner-response-postvalidation-suite")
    : null;
  const gate = buildGate({
    ownerDecisionQueue,
    liveRunPreflight,
    releaseGate,
    enterpriseAudit,
    ownerResponseCompletionValidation,
    ownerResponsePostvalidationSuite,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(gate));
    return;
  }

  process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
}

function buildGate({
  ownerDecisionQueue,
  liveRunPreflight,
  releaseGate,
  enterpriseAudit,
  ownerResponseCompletionValidation,
  ownerResponsePostvalidationSuite,
}) {
  const queue = readRecordArray(ownerDecisionQueue.queue);
  const queueById = new Map(queue.map((item) => [readString(item.id, ""), item]));
  const acceptedOwnerResponseDecisionIds = buildAcceptedOwnerResponseDecisionIds(
    ownerResponseCompletionValidation,
  );
  const stages = readRecordArray(liveRunPreflight.preflightOrder).map((stage) =>
    buildStage(stage, queueById.get(readString(stage.id, "")), acceptedOwnerResponseDecisionIds),
  );
  const firstBlockedStage = stages.find((stage) => !stage.canRun) ?? null;
  const releaseGateStatus = readString(
    releaseGate.status,
    readString(liveRunPreflight.releaseGateStatus, readString(ownerDecisionQueue.releaseGateStatus, "unknown")),
  );
  const sourceOwnerDecisionQueueStatus = readString(ownerDecisionQueue.status, "unknown");
  const ownerDecisionQueueStatus = readString(
    ownerResponseCompletionValidation?.ownerDecisionQueueStatus,
    readString(
      ownerResponsePostvalidationSuite?.ownerDecisionQueueStatus,
      readString(liveRunPreflight.ownerDecisionQueueStatus, sourceOwnerDecisionQueueStatus),
    ),
  );
  const acceptedLiveEvidence = readNumber(
    enterpriseAudit.summary?.acceptedLiveEvidence,
    readNumber(
      enterpriseAudit.summary?.acceptedTargets,
      readNumber(liveRunPreflight.summary?.acceptedEnterpriseLiveEvidenceCount, 0),
    ),
  );
  const missingEnterpriseLiveTargetCount = readNumber(
    enterpriseAudit.summary?.missingRequiredTargetCount,
    readNumber(
      enterpriseAudit.summary?.missingRequiredTargets,
      Math.max(
        0,
        readNumber(liveRunPreflight.summary?.enterpriseLiveEvidenceTargetCount, 0) -
          readNumber(liveRunPreflight.summary?.acceptedEnterpriseLiveEvidenceCount, 0),
      ),
    ),
  );
  const globalBlockingReasons = buildGlobalBlockingReasons({
    releaseGateStatus,
    ownerDecisionQueueStatus,
    liveRunPreflight,
    enterpriseAudit,
    missingEnterpriseLiveTargetCount,
    ownerResponseCompletionValidation,
    ownerResponsePostvalidationSuite,
  });
  const blockedStageCount = stages.filter((stage) => !stage.canRun).length;
  const releaseReady = blockedStageCount === 0 && globalBlockingReasons.length === 0;
  const ownerResponseCompletionValidationCommands = readRecordArray(
    ownerResponseCompletionValidation?.individualOwnerResponseValidationCommands,
  )
    .map(sanitizeOwnerResponseValidationCommand)
    .filter(Boolean);
  const firstIncompleteOwnerResponse = sanitizeFirstIncompleteOwnerResponse(
    ownerResponseCompletionValidation?.firstIncompleteOwnerResponse,
  );
  const ownerResponseCompletionStatus = readString(
    ownerResponseCompletionValidation?.status,
    "not-provided",
  );
  const ownerResponsePostvalidationStatus = readString(
    ownerResponsePostvalidationSuite?.status,
    "not-provided",
  );
  const productionEvidenceRequired =
    ownerResponseCompletionValidation?.summary?.productionEvidenceRequired === true ||
    ownerResponsePostvalidationSuite?.productionEvidenceRequired === true;
  const postValidationMayProceed =
    ownerResponseCompletionValidation?.summary?.postValidationMayProceed === true;

  return {
    target: "owner-decision-live-run-approval-gate",
    status: releaseReady ? "approval-gate-ready" : "approval-gate-blocked",
    releaseReady,
    releaseGateStatus,
    ownerDecisionQueueStatus,
    sourceOwnerDecisionQueueStatus,
    ownerResponseCompletionStatus,
    ownerResponsePostvalidationStatus,
    productionEvidenceRequired,
    postValidationMayProceed,
    responsibleSession: "S22/S19/S10/S25",
    firstBlockedStageId: firstBlockedStage ? firstBlockedStage.id : null,
    firstIncompleteOwnerResponse,
    summary: {
      stageCount: stages.length,
      runnableStageCount: stages.filter((stage) => stage.canRun).length,
      blockedStageCount,
      ownerApprovalRequiredStageCount: stages.filter((stage) => stage.requiresOwnerApproval).length,
      acceptedLiveEvidence,
      missingEnterpriseLiveTargetCount,
      ownerResponseCompletionStatus,
      acceptedOwnerCompletionItemCount: readNumber(
        ownerResponseCompletionValidation?.summary?.acceptedItemCount,
        0,
      ),
      placeholderOwnerCompletionFieldCount: readNumber(
        ownerResponseCompletionValidation?.summary?.placeholderFieldTotal,
        0,
      ),
      ownerResponseIndividualValidationCommandCount:
        ownerResponseCompletionValidationCommands.length,
      postValidationMayProceed,
      ownerResponsePostvalidationStatus,
      ownerResponsePostvalidationExecutedCount: readNumber(
        ownerResponsePostvalidationSuite?.summary?.executedValidationCount,
        0,
      ),
      ownerResponsePostvalidationAcceptedCount: readNumber(
        ownerResponsePostvalidationSuite?.summary?.acceptedValidationCount,
        0,
      ),
      ownerResponsePostvalidationIncompleteCount: readNumber(
        ownerResponsePostvalidationSuite?.summary?.incompleteValidationCount,
        0,
      ),
      ownerResponsePostvalidationRejectedCount: readNumber(
        ownerResponsePostvalidationSuite?.summary?.rejectedValidationCount,
        0,
      ),
      ownerResponsePostvalidationFailedCount: readNumber(
        ownerResponsePostvalidationSuite?.summary?.failedValidationCount,
        0,
      ),
      ownerResponsePostvalidationUnsafeFindingTotal: readNumber(
        ownerResponsePostvalidationSuite?.summary?.unsafeFindingTotal,
        0,
      ),
      ownerResponsePostvalidationSafetyAttentionCount: readNumber(
        ownerResponsePostvalidationSuite?.summary?.safetyAttentionCount,
        0,
      ),
      releaseReady,
    },
    ownerResponseCompletionValidationCommands,
    globalBlockingReasons,
    stages,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildStage(stage, queueItem, acceptedOwnerResponseDecisionIds) {
  const id = readString(stage.id, "unknown-stage");
  const ownerResponseAccepted = acceptedOwnerResponseDecisionIds.has(id);
  const rawQueueStatus = readString(queueItem?.status, null);
  const queueStatus =
    ownerResponseAccepted && rawQueueStatus && !isReadyStatus(rawQueueStatus)
      ? "accepted"
      : rawQueueStatus;
  const rawCurrentStatus = readString(stage.currentStatus, queueStatus ?? "unknown");
  const currentStatus =
    ownerResponseAccepted && !isReadyStatus(rawCurrentStatus)
      ? "accepted-awaiting-production-evidence"
      : rawCurrentStatus;
  const blockingReasons = [];

  if (queueStatus && !isReadyStatus(queueStatus)) {
    blockingReasons.push(`queue-status-${queueStatus}`);
  }
  if (!isReadyStatus(currentStatus)) {
    blockingReasons.push(`stage-status-${currentStatus}`);
  }
  if (!queueStatus && currentStatus === "unknown") {
    blockingReasons.push("stage-status-unknown");
  }

  const uniqueBlockingReasons = [...new Set(blockingReasons)];
  const canRun = uniqueBlockingReasons.length === 0;

  return {
    order: readNumber(stage.order, null),
    id,
    gateStatus: canRun ? "ready" : "blocked",
    canRun,
    queueStatus,
    currentStatus,
    category: readString(queueItem?.category, "preflight-stage"),
    ownerSession: readString(stage.ownerSession, "unknown"),
    requiresOwnerApproval: !canRun && requiresOwnerApproval(queueStatus, currentStatus),
    ownerResponseAccepted,
    releaseGateRequirementIds: readStringArray(queueItem?.releaseGateRequirementIds),
    requiredEvidence: readStringArray(stage.requiredEvidence),
    requiredServerOnlyEnvNames: readStringArray(stage.requiredServerOnlyEnvNames),
    blockingReasons: uniqueBlockingReasons,
  };
}

function buildAcceptedOwnerResponseDecisionIds(ownerResponseCompletionValidation) {
  return new Set(
    readRecordArray(ownerResponseCompletionValidation?.validationItems)
      .filter((item) => readString(item.status, "") === "owner-response-completion-accepted")
      .map((item) => readString(item.decisionId, ""))
      .filter(Boolean),
  );
}

function buildGlobalBlockingReasons({
  releaseGateStatus,
  ownerDecisionQueueStatus,
  liveRunPreflight,
  enterpriseAudit,
  missingEnterpriseLiveTargetCount,
  ownerResponseCompletionValidation,
  ownerResponsePostvalidationSuite,
}) {
  const reasons = [];
  if (!isReadyStatus(releaseGateStatus)) {
    reasons.push(`release-gate-status-${releaseGateStatus}`);
  }
  if (isOwnerQueueBlockingStatus(ownerDecisionQueueStatus)) {
    reasons.push(`owner-queue-status-${ownerDecisionQueueStatus}`);
  }
  if (!isReadyStatus(readString(liveRunPreflight.status, "unknown"))) {
    reasons.push(`preflight-status-${readString(liveRunPreflight.status, "unknown")}`);
  }
  if (!isReadyStatus(readString(enterpriseAudit.status, "unknown"))) {
    reasons.push(`enterprise-audit-status-${readString(enterpriseAudit.status, "unknown")}`);
  }
  if (missingEnterpriseLiveTargetCount > 0) {
    reasons.push("enterprise-live-targets-missing");
  }
  if (
    readString(liveRunPreflight.summary?.releaseRunIdConsistency, "ready") !== "ready" &&
    readString(liveRunPreflight.summary?.releaseRunIdConsistency, "ready") !== "satisfied"
  ) {
    reasons.push("release-run-consistency-not-ready");
  }
  if (ownerResponseCompletionValidation) {
    const ownerResponseCompletionStatus = readString(
      ownerResponseCompletionValidation.status,
      "unknown",
    );
    const productionEvidenceRequired =
      ownerResponseCompletionValidation.summary?.productionEvidenceRequired === true;
    if (
      ownerResponseCompletionStatus !== "owner-response-completion-accepted" &&
      !productionEvidenceRequired
    ) {
      reasons.push(
        `owner-response-completion-validation-status-${ownerResponseCompletionStatus}`,
      );
    }
    if (
      ownerResponseCompletionValidation.summary?.postValidationMayProceed !== true &&
      !productionEvidenceRequired
    ) {
      reasons.push("owner-response-completion-not-authorized");
    }
  }
  if (ownerResponsePostvalidationSuite) {
    const ownerResponsePostvalidationStatus = readString(
      ownerResponsePostvalidationSuite.status,
      "unknown",
    );
    const postvalidationAwaitingProductionEvidence =
      ownerResponsePostvalidationStatus ===
        "owner-response-postvalidation-awaiting-production-evidence" ||
      ownerResponsePostvalidationSuite.productionEvidenceRequired === true;
    if (
      ownerResponsePostvalidationStatus !== "owner-response-postvalidation-accepted" &&
      !postvalidationAwaitingProductionEvidence
    ) {
      reasons.push(`owner-response-postvalidation-status-${ownerResponsePostvalidationStatus}`);
    }
    if (
      readNumber(ownerResponsePostvalidationSuite.summary?.failedValidationCount, 0) > 0 ||
      readNumber(ownerResponsePostvalidationSuite.summary?.rejectedValidationCount, 0) > 0 ||
      readNumber(ownerResponsePostvalidationSuite.summary?.incompleteValidationCount, 0) > 0
    ) {
      reasons.push("owner-response-postvalidation-not-clean");
    }
    if (readNumber(ownerResponsePostvalidationSuite.summary?.unsafeFindingTotal, 0) > 0) {
      reasons.push("owner-response-postvalidation-unsafe-findings");
    }
    if (readNumber(ownerResponsePostvalidationSuite.summary?.safetyAttentionCount, 0) > 0) {
      reasons.push("owner-response-postvalidation-needs-safety-review");
    }
  }
  return [...new Set(reasons)];
}

function isReadyStatus(status) {
  return typeof status === "string" && readyStatuses.has(status);
}

function isOwnerQueueBlockingStatus(status) {
  return (
    typeof status === "string" &&
    !isReadyStatus(status) &&
    status !== "owner-decisions-cleared-awaiting-production-evidence"
  );
}

function requiresOwnerApproval(...statuses) {
  return statuses
    .filter((status) => typeof status === "string")
    .some(
      (status) =>
        status.includes("owner") ||
        status.includes("approval") ||
        status.includes("human") ||
        status.includes("needed") ||
        status.includes("required") ||
        status.includes("blocked") ||
        status.includes("missing"),
    );
}

function renderMarkdown(gate) {
  const lines = [
    "# UAIS Owner Decision Live-Run Approval Gate",
    "",
    `Status: \`${gate.status}\``,
    `Release gate: \`${gate.releaseGateStatus}\``,
    `Owner queue: \`${gate.ownerDecisionQueueStatus}\``,
    `Release ready: \`${gate.summary.releaseReady}\``,
    `First blocked stage: \`${gate.firstBlockedStageId ?? "none-recorded"}\``,
    "",
    "This report performs no live operation. It is a preflight approval gate for env apply, deployment, live smokes, and release-run binding.",
    "",
    "## Summary",
    "",
    `Stages runnable: ${gate.summary.runnableStageCount} / ${gate.summary.stageCount}`,
    `Stages blocked: ${gate.summary.blockedStageCount}`,
    `Owner approval still required: ${gate.summary.ownerApprovalRequiredStageCount}`,
    `Accepted live evidence: ${gate.summary.acceptedLiveEvidence}`,
    `Missing enterprise live targets: ${gate.summary.missingEnterpriseLiveTargetCount}`,
    `Owner response completion: \`${gate.summary.ownerResponseCompletionStatus}\``,
    `Owner response individual validators: ${gate.summary.ownerResponseIndividualValidationCommandCount}`,
    `Owner response completion may proceed: \`${gate.summary.postValidationMayProceed}\``,
    `Owner response postvalidation: \`${gate.summary.ownerResponsePostvalidationStatus}\``,
    `Owner response postvalidation executed: ${gate.summary.ownerResponsePostvalidationExecutedCount}`,
    `Owner response postvalidation accepted: ${gate.summary.ownerResponsePostvalidationAcceptedCount}`,
    `Owner response postvalidation rejected: ${gate.summary.ownerResponsePostvalidationRejectedCount}`,
    `Owner response postvalidation failed: ${gate.summary.ownerResponsePostvalidationFailedCount}`,
    `Owner response postvalidation unsafe findings: ${gate.summary.ownerResponsePostvalidationUnsafeFindingTotal}`,
    `Owner response postvalidation safety attention: ${gate.summary.ownerResponsePostvalidationSafetyAttentionCount}`,
  ];

  if (gate.firstIncompleteOwnerResponse) {
    const firstIncompleteOwnerResponseHeading =
      gate.productionEvidenceRequired === true
        ? "## First Pending Production Evidence Labels"
        : "## First Incomplete Owner Response";
    const requiredOwnerInputFieldsLabel =
      gate.productionEvidenceRequired === true
        ? "Pending production evidence label fields:"
        : "Required owner input fields:";
    lines.push(
      "",
      firstIncompleteOwnerResponseHeading,
      "",
      `Decision: \`${gate.firstIncompleteOwnerResponse.decisionId}\``,
      `Status: \`${gate.firstIncompleteOwnerResponse.status}\``,
      `Missing fields: ${gate.firstIncompleteOwnerResponse.missingFieldCount}`,
      `Placeholder fields: ${gate.firstIncompleteOwnerResponse.placeholderFieldCount}`,
      `Unsafe findings: ${gate.firstIncompleteOwnerResponse.unsafeFindingCount}`,
      `Confirmation failures: ${gate.firstIncompleteOwnerResponse.confirmationFailureCount}`,
      "",
      requiredOwnerInputFieldsLabel,
      "",
      ...gate.firstIncompleteOwnerResponse.requiredOwnerInputFields.map(
        (field) => `- \`${field}\``,
      ),
      "",
      "Validation command:",
      "",
      "```sh",
      gate.firstIncompleteOwnerResponse.ownerResponseValidationCommand ?? "none-recorded",
      "```",
    );
  } else {
    lines.push("", "## First Incomplete Owner Response", "", "`none-recorded`");
  }

  lines.push(
    "",
    "## Stage Gate",
    "",
    "| Order | Stage | Current status | Gate status | Can run |",
    "| ---: | --- | --- | --- | --- |",
    ...gate.stages.map(
      (stage) =>
        `| ${stage.order ?? ""} | \`${stage.id}\` | ${stage.currentStatus} | ${stage.gateStatus} | ${stage.canRun} |`,
    ),
  );

  if (gate.globalBlockingReasons.length > 0) {
    lines.push("", "## Global Blocking Reasons", "");
    lines.push(...gate.globalBlockingReasons.map((reason) => `- \`${reason}\``));
  }

  if (gate.ownerResponseCompletionValidationCommands.length > 0) {
    lines.push(
      "",
      "## Owner Response Validation Commands",
      "",
      "| Rank | Decision | Command |",
      "| ---: | --- | --- |",
      ...gate.ownerResponseCompletionValidationCommands.map(
        (item) =>
          `| \`${item.rank ?? "?"}\` | \`${item.decisionId}\` | \`${item.ownerResponseValidationCommand}\` |`,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { format: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    index += 1;
  }
  if (!["json", "markdown"].includes(args.format)) {
    throw new Error("--format must be json or markdown");
  }
  return args;
}

function readJsonArg(args, key) {
  if (!args[key]) {
    throw new Error(`Missing required --${key}`);
  }
  return JSON.parse(readFileSync(args[key], "utf8"));
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function readNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function sanitizeOwnerResponseValidationCommand(item) {
  const rank = Number.isInteger(item.rank) ? item.rank : null;
  const decisionId = readString(item.decisionId, "");
  const ownerResponseValidationCommand = readString(item.ownerResponseValidationCommand, "");
  const commandPattern =
    /^node scripts\/owner-decision-[a-z0-9-]+-response-validation\.mjs --owner-response-template coordination\/reports\/[A-Za-z0-9._-]+\.json --owner-response path\/to\/filled-owner-response\.json$/;
  if (!decisionId || !commandPattern.test(ownerResponseValidationCommand)) {
    return null;
  }
  return { rank, decisionId, ownerResponseValidationCommand };
}

function sanitizeFirstIncompleteOwnerResponse(item) {
  if (!isRecord(item)) {
    return null;
  }
  return {
    rank: Number.isInteger(item.rank) ? item.rank : null,
    decisionId: readString(item.decisionId, "unknown-decision"),
    status: readString(item.status, "unknown"),
    missingFieldCount: readNumber(item.missingFieldCount, 0),
    placeholderFieldCount: readNumber(item.placeholderFieldCount, 0),
    unsafeFindingCount: readNumber(item.unsafeFindingCount, 0),
    confirmationFailureCount: readNumber(item.confirmationFailureCount, 0),
    requiredOwnerInputFields: readStringArray(item.requiredOwnerInputFields),
    ownerResponseValidationCommand: readString(item.ownerResponseValidationCommand, null),
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
