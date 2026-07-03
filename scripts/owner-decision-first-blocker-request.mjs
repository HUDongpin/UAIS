#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const approvalGate = readJsonArg(args, "approval-gate");
  const liveRunPreflight = readJsonArg(args, "live-run-preflight");
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const actionPacketIndex = args["action-packet-index"]
    ? readJsonArg(args, "action-packet-index")
    : null;
  const ownerResponseCompletionPacket = args["owner-response-completion-packet"]
    ? readJsonArg(args, "owner-response-completion-packet")
    : null;
  const productionEvidenceExecutionPlan = args["production-evidence-execution-plan"]
    ? readJsonArg(args, "production-evidence-execution-plan")
    : null;
  const operatorEvidence = args["operator-evidence"]
    ? readJsonArg(args, "operator-evidence")
    : null;
  const actionPackets = readActionPackets({
    reportsDir: args["reports-dir"],
    date: args.date,
    actionPacketIndex,
  });
  const report = buildReport({
    approvalGate,
    liveRunPreflight,
    ownerDecisionQueue,
    actionPackets,
    ownerResponseCompletionPacket,
    productionEvidenceExecutionPlan,
    operatorEvidence,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({
  approvalGate,
  liveRunPreflight,
  ownerDecisionQueue,
  actionPackets,
  ownerResponseCompletionPacket,
  productionEvidenceExecutionPlan,
  operatorEvidence,
}) {
  const firstBlockedStageId = readString(approvalGate.firstBlockedStageId, null);
  const stages = readRecordArray(approvalGate.stages);
  const preflightStages = readRecordArray(liveRunPreflight.preflightOrder);
  const queueItems = readRecordArray(ownerDecisionQueue.queue);
  const completionItems = readRecordArray(ownerResponseCompletionPacket?.ownerCompletionItems);
  const sourceOwnerDecisionQueueStatus = readString(ownerDecisionQueue.status, "unknown");
  const ownerDecisionQueueStatus = readString(
    approvalGate.ownerDecisionQueueStatus,
    sourceOwnerDecisionQueueStatus,
  );
  const firstStage = stages.find((stage) => stage.id === firstBlockedStageId) ?? null;
  const preflightStage =
    preflightStages.find((stage) => stage.id === firstBlockedStageId) ?? null;
  const queueItem = queueItems.find((item) => item.id === firstBlockedStageId) ?? null;
  const packetEntry = actionPackets.find(
    (entry) => entry.packet.decisionId === firstBlockedStageId,
  );
  const completionItem =
    completionItems.find((item) => item.decisionId === firstBlockedStageId) ?? null;
  const productionEvidencePhase = findProductionEvidencePhase({
    productionEvidenceExecutionPlan,
    firstBlockedStageId,
  });
  const operatorInputPacket = readOperatorInputPacketForStage({
    productionEvidenceExecutionPlan,
    firstBlockedStageId,
  });
  const globalBlockingReasons = uniqueStrings([
    ...readSafeBlockingReasons(approvalGate.globalBlockingReasons),
    ...(firstBlockedStageId ? [] : buildOwnerQueueBlockingReasons(ownerDecisionQueueStatus)),
  ]);
  const ownerRequest =
    firstBlockedStageId && firstStage
      ? buildOwnerRequest({
          firstBlockedStageId,
          firstStage,
          preflightStage,
          queueItem,
          packetEntry,
          completionItem,
          productionEvidencePhase,
          operatorEvidence,
          operatorInputPacket,
        })
      : null;
  const globalBlockerRequest =
    !ownerRequest &&
    globalBlockingReasons.length > 0
      ? buildGlobalBlockerRequest({
          gateStatus: readString(approvalGate.status, "unknown"),
          globalBlockingReasons,
        })
      : null;
  const downstreamStillBlocked = buildDownstreamStillBlocked({ stages, firstStage });
  const firstOperatorAction = buildFirstOperatorAction(ownerRequest);
  const firstOwnerAction = firstOperatorAction ? null : buildFirstOwnerAction(ownerRequest);
  const status =
    firstOperatorAction
      ? "operator-action-required"
      : ownerRequest || globalBlockerRequest
        ? "owner-action-required"
        : "no-owner-action-required";
  const releaseReady =
    approvalGate.summary?.releaseReady === true &&
    isReadyLikeStatus(ownerDecisionQueueStatus) &&
    status === "no-owner-action-required" &&
    !firstBlockedStageId &&
    globalBlockingReasons.length === 0 &&
    downstreamStillBlocked.length === 0;

  return {
    target: "owner-decision-first-blocker-request",
    status,
    releaseReady,
    ownerDecisionQueueStatus,
    sourceOwnerDecisionQueueStatus,
    responsibleSession: "S22/S19/S10",
    firstBlockedStageId,
    firstOwnerAction,
    firstOperatorAction,
    summary: {
      approvalGateStatus: readString(approvalGate.status, "unknown"),
      stageCount: readNumber(approvalGate.summary?.stageCount, stages.length),
      blockedStageCount: readNumber(
        approvalGate.summary?.blockedStageCount,
        stages.filter((stage) => stage.canRun === false).length,
      ),
      acceptedLiveEvidence: readNumber(approvalGate.summary?.acceptedLiveEvidence, 0),
      missingEnterpriseLiveTargetCount: readNumber(
        approvalGate.summary?.missingEnterpriseLiveTargetCount,
        0,
      ),
      releaseReady,
    },
    ownerRequest,
    globalBlockerRequest,
    globalStillBlocked: globalBlockingReasons,
    downstreamStillBlocked,
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

function buildFirstOwnerAction(ownerRequest) {
  if (!isRecord(ownerRequest)) {
    return null;
  }
  const completion = isRecord(ownerRequest.ownerResponseCompletion)
    ? ownerRequest.ownerResponseCompletion
    : null;
  return {
    decisionId: readString(ownerRequest.id, "unknown-decision"),
    queueStatus: readString(ownerRequest.queueStatus, "unknown"),
    currentStatus: readString(ownerRequest.currentStatus, "unknown"),
    ownerInputRequired: readString(
      ownerRequest.ownerInputRequired,
      readString(ownerRequest.nextOwnerQuestion, ""),
    ),
    validationStatus: readString(completion?.validationStatus, "none-recorded"),
    missingFieldCount: readNumber(completion?.missingFieldCount, 0),
    requiredOwnerInputFields: readStringArray(completion?.requiredOwnerInputFields),
    ownerResponseValidationCommand: readString(
      completion?.ownerResponseValidationCommand,
      null,
    ),
    copySafeOwnerReplyStubAvailable: Boolean(completion?.copySafeOwnerReplyStub),
    forbiddenUntilApproved: uniqueStrings([
      ...readStringArray(ownerRequest.forbiddenUntilApproved),
      ...readStringArray(completion?.stillForbiddenUntilSeparateApproval),
    ]),
  };
}

function buildFirstOperatorAction(ownerRequest) {
  if (!isRecord(ownerRequest) || !isOperatorActionStatus(ownerRequest.currentStatus)) {
    return null;
  }
  return {
    decisionId: readString(ownerRequest.id, "unknown-decision"),
    queueStatus: readString(ownerRequest.queueStatus, "unknown"),
    currentStatus: readString(ownerRequest.currentStatus, "unknown"),
    ownerSession: readString(ownerRequest.ownerSession, "unknown"),
    safeNextAction: readString(ownerRequest.safeNextAction, ""),
    requiredProductionEvidence: readStringArray(ownerRequest.requiredEvidence),
    requiredServerOnlyEnvNames: readStringArray(ownerRequest.requiredServerOnlyEnvNames),
    blockingReasons: readStringArray(ownerRequest.blockingReasons),
    safeCommandTemplates: readSafeCommandTemplates(ownerRequest.safeCommandTemplates),
    ...(isRecord(ownerRequest.operatorInputPacket)
      ? { operatorInputPacket: ownerRequest.operatorInputPacket }
      : {}),
  };
}

function buildGlobalBlockerRequest({ gateStatus, globalBlockingReasons }) {
  return {
    id: "approval-gate-global-blocker",
    category: "global-approval-gate",
    gateStatus,
    ownerInputRequired:
      "Resolve global approval-gate blockers before env apply, deployment, live smoke, or release-run binding.",
    blockingReasons: globalBlockingReasons,
    safeNextActions: buildGlobalSafeNextActions(globalBlockingReasons),
    forbiddenUntilResolved: [
      "run-vercel-env-apply",
      "run-vercel-production-deploy",
      "run-production-live-smokes",
      "run-enterprise-live-evidence-audit",
      "bind-production-release-run-id",
    ],
  };
}

function buildGlobalSafeNextActions(globalBlockingReasons) {
  const actions = [];
  if (globalBlockingReasons.some((reason) => reason.startsWith("owner-queue-status-"))) {
    actions.push("complete-owner-decision-queue-before-release-readiness");
  }
  if (globalBlockingReasons.some((reason) => reason.startsWith("owner-response-postvalidation"))) {
    actions.push(
      "review-owner-response-postvalidation-suite-report",
      "rerun-owner-response-extraction-and-postvalidation-after-corrected-owner-response",
    );
  }
  if (globalBlockingReasons.some((reason) => reason.startsWith("owner-response-completion"))) {
    actions.push(
      "review-owner-response-completion-validation-report",
      "fill-or-correct-owner-response-completion-packet",
    );
  }
  if (globalBlockingReasons.includes("enterprise-live-targets-missing")) {
    actions.push("collect-owner-approved-enterprise-live-evidence");
  }
  if (globalBlockingReasons.includes("release-run-consistency-not-ready")) {
    actions.push("bind-shared-release-run-id-after-owner-approval");
  }
  if (actions.length === 0) {
    actions.push("review-approval-gate-global-blocking-reasons");
  }
  return uniqueStrings(actions);
}

function buildOwnerQueueBlockingReasons(ownerDecisionQueueStatus) {
  return isReadyLikeStatus(ownerDecisionQueueStatus)
    ? []
    : [`owner-queue-status-${ownerDecisionQueueStatus}`];
}

function buildOwnerRequest({
  firstBlockedStageId,
  firstStage,
  preflightStage,
  queueItem,
  packetEntry,
  completionItem,
  productionEvidencePhase,
  operatorEvidence,
  operatorInputPacket,
}) {
  const packet = packetEntry?.packet;
  const rawCurrentStatus = readString(
    firstStage.currentStatus,
    readString(preflightStage?.currentStatus, "unknown"),
  );
  const isOperatorAction = isOperatorActionStatus(rawCurrentStatus);
  const phaseMissingEvidence = readStringArray(productionEvidencePhase?.missingEvidence);
  const phaseSafeNextAction = readString(productionEvidencePhase?.nextSafeAction, "");
  const safeNextAction =
    isOperatorAction && phaseSafeNextAction
      ? phaseSafeNextAction
      : readString(preflightStage?.safeNextAction, "");
  const requiredEvidence =
    isOperatorAction && phaseMissingEvidence.length > 0
      ? phaseMissingEvidence
      : uniqueStrings([
          ...readStringArray(preflightStage?.requiredEvidence),
          ...readStringArray(packet?.requiredEvidence),
        ]);
  const safeCommandTemplates =
    isOperatorAction && operatorEvidenceMatchesStage({ operatorEvidence, firstBlockedStageId })
      ? readSafeCommandTemplates(operatorEvidence?.safeCommandTemplates)
      : {};
  return {
    id: firstBlockedStageId,
    order: readNumber(firstStage.order, readNumber(preflightStage?.order, null)),
    queueRank: readNumber(queueItem?.rank, readNumber(packet?.queueRank, null)),
    category: readString(queueItem?.category, readString(firstStage.category, "preflight-stage")),
    queueStatus: readString(firstStage.queueStatus, readString(queueItem?.status, "unknown")),
    currentStatus: rawCurrentStatus,
    gateStatus: readString(firstStage.gateStatus, "blocked"),
    blockingReasons: readStringArray(firstStage.blockingReasons),
    ownerSession: readString(preflightStage?.ownerSession, "unknown"),
    ownerInputRequired: buildOwnerInputRequired({
      firstStage,
      preflightStage,
      queueItem,
      safeNextAction,
    }),
    nextOwnerQuestion: readString(queueItem?.nextOwnerQuestion, ""),
    requiredServerOnlyEnvNames: uniqueStrings([
      ...readStringArray(preflightStage?.requiredServerOnlyEnvNames),
      ...readStringArray(packet?.requiredEnvNames),
      ...readStringArray(packet?.currentModeRequiredEnvNames),
    ]),
    requiredEvidence,
    safeNextAction,
    safeCommandTemplates,
    operatorInputPacket,
    safeNextActions: readStringArray(packet?.safeNextActions),
    forbiddenUntilApproved: readStringArray(packet?.forbiddenUntilApproved),
    stopIf: readStringArray(preflightStage?.stopIf),
    stopConditions: readStringArray(packet?.stopConditions),
    actionPacketFileName: packetEntry ? basename(packetEntry.fileName) : null,
    actionPacketStatus: readString(packet?.status, "missing"),
    actionPacketClassification: readString(packet?.classification, "missing"),
    currentEvidenceSummary: sanitizeEvidenceSummary(packet?.currentEvidenceSummary),
    ownerResponseCompletion: buildOwnerResponseCompletion(completionItem),
  };
}

function readOperatorInputPacketForStage({
  productionEvidenceExecutionPlan,
  firstBlockedStageId,
}) {
  if (!isRecord(productionEvidenceExecutionPlan?.operatorInputPacket)) {
    return null;
  }
  const packet = sanitizeOperatorInputPacket(productionEvidenceExecutionPlan.operatorInputPacket);
  if (!operatorInputPacketMatchesStage({ packet, firstBlockedStageId })) {
    return null;
  }
  return packet;
}

function sanitizeOperatorInputPacket(packet) {
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

function operatorInputPacketMatchesStage({ packet, firstBlockedStageId }) {
  const target = readString(packet.target, "");
  return (
    {
      "app-auth-env-source-intake-operator-input": "app-auth-provider-production-selector",
      "teacher-auth-env-source-intake-operator-input": "teacher-auth-provider-production-selector",
      "external-storage-env-source-intake-operator-input": "external-storage-production-service",
    }[target] === firstBlockedStageId
  );
}

function operatorEvidenceMatchesStage({ operatorEvidence, firstBlockedStageId }) {
  const target = readString(operatorEvidence?.target, "");
  return (
    {
      "app-auth-env-source-intake": "app-auth-provider-production-selector",
      "teacher-auth-env-source-intake": "teacher-auth-provider-production-selector",
      "external-storage-env-source-intake": "external-storage-production-service",
    }[target] === firstBlockedStageId
  );
}

function buildOwnerInputRequired({ firstStage, preflightStage, queueItem, safeNextAction }) {
  const currentStatus = readString(firstStage.currentStatus, "");
  if (currentStatus === "accepted-awaiting-production-evidence" && safeNextAction) {
    return `Owner response accepted; next required step: ${safeNextAction}`;
  }
  return readString(
    preflightStage?.ownerInputRequired,
    readString(queueItem?.nextOwnerQuestion, ""),
  );
}

function findProductionEvidencePhase({ productionEvidenceExecutionPlan, firstBlockedStageId }) {
  if (!firstBlockedStageId) {
    return null;
  }
  return (
    readRecordArray(productionEvidenceExecutionPlan?.phases).find(
      (phase) => readString(phase.id, "") === firstBlockedStageId,
    ) ?? null
  );
}

function buildOwnerResponseCompletion(completionItem) {
  if (!isRecord(completionItem)) {
    return null;
  }
  const templateFileName = readString(completionItem.templateFileName, null);
  const validationFileName = readString(completionItem.validationFileName, null);
  return {
    validationStatus: readString(completionItem.validationStatus, "unknown"),
    ownerResponseStatus: readString(completionItem.ownerResponseStatus, "unknown"),
    templateFileName,
    validationFileName,
    ownerResponseValidationCommand: buildOwnerResponseValidationCommand({
      templateFileName,
      validationFileName,
    }),
    missingFieldCount: readNumber(completionItem.missingFieldCount, 0),
    requiredOwnerInputFields: readStringArray(completionItem.requiredOwnerInputFields),
    requiredOwnerLabelFields: readStringArray(completionItem.requiredOwnerLabelFields),
    blockedReasons: readStringArray(completionItem.blockedReasons),
    stillForbiddenUntilSeparateApproval: readStringArray(
      completionItem.stillForbiddenUntilSeparateApproval,
    ),
    postValidationAllowedChecks: readStringArray(completionItem.postValidationAllowedChecks),
    copySafeOwnerReplyStub: isRecord(completionItem.copySafeOwnerReplyStub)
      ? completionItem.copySafeOwnerReplyStub
      : null,
  };
}

function buildDownstreamStillBlocked({ stages, firstStage }) {
  if (!firstStage) {
    return [];
  }
  const firstOrder = readNumber(firstStage.order, 0);
  return stages
    .filter((stage) => stage.canRun === false && readNumber(stage.order, 0) > firstOrder)
    .map((stage) => ({
      order: readNumber(stage.order, null),
      id: readString(stage.id, "unknown-stage"),
      gateStatus: readString(stage.gateStatus, "blocked"),
      currentStatus: readString(stage.currentStatus, "unknown"),
    }));
}

function readActionPackets({ reportsDir, date, actionPacketIndex }) {
  if (!reportsDir || !existsSync(reportsDir)) {
    return [];
  }
  const entriesByDecisionId = new Map();

  for (const entry of readActionPacketsFromIndex({ reportsDir, actionPacketIndex })) {
    entriesByDecisionId.set(entry.packet.decisionId, entry);
  }

  for (const entry of readActionPacketsByDate({ reportsDir, date })) {
    if (!entriesByDecisionId.has(entry.packet.decisionId)) {
      entriesByDecisionId.set(entry.packet.decisionId, entry);
    }
  }

  return [...entriesByDecisionId.values()].sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  );
}

function readActionPacketsFromIndex({ reportsDir, actionPacketIndex }) {
  return readRecordArray(actionPacketIndex?.packets)
    .map((packetIndexItem) => basename(readString(packetIndexItem.actionPacketFileName, "")))
    .filter(Boolean)
    .map((fileName) => readActionPacketFile({ reportsDir, fileName }))
    .filter(Boolean);
}

function readActionPacketsByDate({ reportsDir, date }) {
  if (!date) {
    return [];
  }
  return readdirSync(reportsDir)
    .filter(
      (fileName) =>
        fileName.startsWith(`${date}-`) &&
        fileName.endsWith("-action-packet-enterprise-runthrough.json"),
    )
    .sort()
    .map((fileName) => readActionPacketFile({ reportsDir, fileName }))
    .filter(Boolean);
}

function readActionPacketFile({ reportsDir, fileName }) {
  const filePath = join(reportsDir, fileName);
  if (!existsSync(filePath)) {
    return null;
  }
  const packet = JSON.parse(readFileSync(filePath, "utf8"));
  if (typeof packet.decisionId !== "string") {
    return null;
  }
  return { fileName, packet };
}

function sanitizeEvidenceSummary(summary) {
  if (!isRecord(summary)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(summary).filter(
      ([, value]) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null,
    ),
  );
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Owner Decision First-Blocker Request",
    "",
    `Status: \`${report.status}\``,
    `Approval gate: \`${report.summary.approvalGateStatus}\``,
    `First blocked stage: \`${report.firstBlockedStageId ?? "none-recorded"}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "This report performs no live operation. It identifies the first owner action needed before env apply, deployment, live smoke, or release-run binding.",
  ];

  if (report.firstOperatorAction) {
    lines.push(
      "",
      "## First Operator Action",
      "",
      `Decision: \`${report.firstOperatorAction.decisionId}\``,
      `Current status: \`${report.firstOperatorAction.currentStatus}\``,
      `Queue status: \`${report.firstOperatorAction.queueStatus}\``,
      `Safe next action: \`${report.firstOperatorAction.safeNextAction || "none-recorded"}\``,
      `Required production evidence: ${formatInlineList(report.firstOperatorAction.requiredProductionEvidence)}`,
    );

    const safeCommandTemplateEntries = Object.entries(
      report.firstOperatorAction.safeCommandTemplates ?? {},
    );
    if (report.firstOperatorAction.operatorInputPacket) {
      lines.push(
        "",
        "## Operator Input Packet",
        "",
        `- Status: \`${report.firstOperatorAction.operatorInputPacket.status}\``,
        `- First required input: \`${report.firstOperatorAction.operatorInputPacket.firstRequiredInputId}\``,
        `- Next safe action: \`${report.firstOperatorAction.operatorInputPacket.nextSafeAction}\``,
        `- Next command template: \`${report.firstOperatorAction.operatorInputPacket.nextSafeCommandTemplateKey}\``,
        `- Values forbidden: \`${report.firstOperatorAction.operatorInputPacket.valuesForbidden}\``,
        `- Preferred input mode: \`${report.firstOperatorAction.operatorInputPacket.preferredInputMode ?? "not-recorded"}\``,
        `- Safe input instruction: ${report.firstOperatorAction.operatorInputPacket.safeInputInstruction ?? "not-recorded"}`,
        `- Approved source label is evidence: \`${report.firstOperatorAction.operatorInputPacket.approvedSourceLabelIsNotEvidence === true ? "false" : "not-recorded"}\``,
      );
    }
    if (safeCommandTemplateEntries.length > 0) {
      lines.push(
        "",
        "## Safe Operator Command Templates",
        "",
        ...safeCommandTemplateEntries.map(([name, command]) => `- \`${name}\`: \`${command}\``),
      );
    }
  }

  if (report.ownerRequest) {
    lines.push(
      "",
      "## Owner Request",
      "",
      `Decision: \`${report.ownerRequest.id}\``,
      `Current status: \`${report.ownerRequest.currentStatus}\``,
      `Queue status: \`${report.ownerRequest.queueStatus}\``,
      "",
      report.ownerRequest.ownerInputRequired || report.ownerRequest.nextOwnerQuestion,
      "",
      "## Required Evidence",
      "",
      ...formatBullets(report.ownerRequest.requiredEvidence),
    );

    if (report.ownerRequest.requiredServerOnlyEnvNames.length > 0) {
      lines.push("", "## Server-Only Env Names", "");
      lines.push(...formatBullets(report.ownerRequest.requiredServerOnlyEnvNames));
    }

    if (report.ownerRequest.safeNextActions.length > 0) {
      lines.push("", "## Safe Next Actions", "");
      lines.push(...formatBullets(report.ownerRequest.safeNextActions));
    }

    if (report.ownerRequest.ownerResponseCompletion) {
      lines.push(
        "",
        "## Owner Response Completion",
        "",
        `Validation status: \`${report.ownerRequest.ownerResponseCompletion.validationStatus}\``,
        `Missing fields: ${report.ownerRequest.ownerResponseCompletion.missingFieldCount}`,
        "",
        "Required owner input fields:",
        "",
        ...formatBullets(report.ownerRequest.ownerResponseCompletion.requiredOwnerInputFields),
      );

      if (
        report.ownerRequest.ownerResponseCompletion.stillForbiddenUntilSeparateApproval.length > 0
      ) {
        lines.push(
          "",
          "## Still Forbidden Until Separate Approval",
          "",
          ...formatBullets(
            report.ownerRequest.ownerResponseCompletion.stillForbiddenUntilSeparateApproval,
          ),
        );
      }

      if (report.ownerRequest.ownerResponseCompletion.copySafeOwnerReplyStub) {
        lines.push(
          "",
          "## Copy-Safe Owner Reply Stub",
          "",
          "```json",
          JSON.stringify(
            report.ownerRequest.ownerResponseCompletion.copySafeOwnerReplyStub,
            null,
            2,
          ),
          "```",
        );
      }

      if (report.ownerRequest.ownerResponseCompletion.ownerResponseValidationCommand) {
        lines.push(
          "",
          "## Validation Command",
          "",
          "```sh",
          report.ownerRequest.ownerResponseCompletion.ownerResponseValidationCommand,
          "```",
        );
      }
    }

    if (report.ownerRequest.forbiddenUntilApproved.length > 0) {
      lines.push("", "## Forbidden Until Approved", "");
      lines.push(...formatBullets(report.ownerRequest.forbiddenUntilApproved));
    }
  }

  if (report.globalBlockerRequest) {
    lines.push(
      "",
      "## Global Blocker Request",
      "",
      `Gate status: \`${report.globalBlockerRequest.gateStatus}\``,
      "",
      report.globalBlockerRequest.ownerInputRequired,
      "",
      "## Global Blocking Reasons",
      "",
      ...formatBullets(report.globalBlockerRequest.blockingReasons),
      "",
      "## Safe Next Actions",
      "",
      ...formatBullets(report.globalBlockerRequest.safeNextActions),
      "",
      "## Forbidden Until Resolved",
      "",
      ...formatBullets(report.globalBlockerRequest.forbiddenUntilResolved),
    );
  }

  if (report.ownerRequest && report.globalStillBlocked.length > 0) {
    lines.push("", "## Global Still Blocked", "", ...formatBullets(report.globalStillBlocked));
  }

  if (report.downstreamStillBlocked.length > 0) {
    lines.push("", "## Downstream Still Blocked", "");
    lines.push("| Order | Stage | Status |", "| ---: | --- | --- |");
    lines.push(
      ...report.downstreamStillBlocked.map(
        (stage) => `| ${stage.order ?? ""} | \`${stage.id}\` | ${stage.currentStatus} |`,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatBullets(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``) : ["- `none-recorded`"];
}

function formatInlineList(values) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "`none-recorded`";
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

function readSafeBlockingReasons(value) {
  return readStringArray(value).filter((item) => /^[A-Za-z0-9._:-]+$/.test(item));
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

function readNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function isReadyLikeStatus(status) {
  return [
    "ready",
    "passed",
    "complete",
    "completed",
    "accepted",
    "approved",
    "live-ready",
    "release-ready",
    "satisfied",
    "all-decisions-ready",
    "no-owner-decisions-required",
    "owner-decisions-complete",
  ].includes(readString(status, "unknown"));
}

function isOperatorActionStatus(status) {
  return ["accepted-awaiting-production-evidence", "waiting-for-live-evidence"].includes(
    readString(status, "unknown"),
  );
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function buildOwnerResponseValidationCommand({ templateFileName, validationFileName }) {
  if (!templateFileName || !validationFileName) {
    return null;
  }
  const templateBaseName = basename(templateFileName);
  const validationBaseName = basename(validationFileName);
  const match = validationBaseName.match(
    /^\d{4}-\d{2}-\d{2}-(owner-decision-.+)-enterprise-runthrough\.json$/,
  );
  const scriptBaseName = match ? `${match[1]}.mjs` : null;
  if (!scriptBaseName || scriptBaseName.includes("/") || scriptBaseName.includes("..")) {
    return null;
  }
  return [
    `node scripts/${scriptBaseName}`,
    `--owner-response-template coordination/reports/${templateBaseName}`,
    "--owner-response path/to/filled-owner-response.json",
  ].join(" ");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
