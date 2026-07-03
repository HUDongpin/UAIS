#!/usr/bin/env node

import { readFileSync } from "node:fs";

const phaseDefinitions = [
  {
    id: "app-auth-provider-production-selector",
    inputKey: "appAuthPreflight",
    label: "App auth production evidence",
  },
  {
    id: "teacher-auth-provider-production-selector",
    inputKey: "teacherAuthPreflight",
    label: "Teacher auth production evidence",
  },
  {
    id: "external-storage-production-service",
    inputKey: "externalStoragePreflight",
    label: "External storage production evidence",
  },
  {
    id: "vercel-env-deploy-and-smoke-chain",
    inputKey: "vercelEnvDeployPreflight",
    label: "Vercel env deploy and smoke chain",
  },
  {
    id: "manual-ppt-playback-acceptance",
    inputKey: "manualPptPreflight",
    label: "Manual PPT playback production binding",
  },
  {
    id: "ordinary-teaching-production-evidence",
    inputKey: "ordinaryTeachingPreflight",
    label: "Ordinary teaching production evidence",
  },
  {
    id: "enterprise-live-evidence-audit",
    inputKey: "enterpriseAuditPreflight",
    label: "Enterprise live evidence audit",
  },
  {
    id: "production-release-run",
    inputKey: "productionReleaseRunPreflight",
    label: "Production release-run binding readiness",
  },
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputs = {
    gapMatrix: readJsonArg(args, "gap-matrix"),
    appAuthPreflight: readJsonArg(args, "app-auth-preflight"),
    appAuthEnvSourceIntake: args["app-auth-env-source-intake"]
      ? readJsonArg(args, "app-auth-env-source-intake")
      : {},
    teacherAuthPreflight: readJsonArg(args, "teacher-auth-preflight"),
    externalStoragePreflight: readJsonArg(args, "external-storage-preflight"),
    vercelEnvDeployPreflight: readJsonArg(args, "vercel-env-deploy-preflight"),
    manualPptPreflight: readJsonArg(args, "manual-ppt-preflight"),
    ordinaryTeachingPreflight: readJsonArg(args, "ordinary-teaching-preflight"),
    enterpriseAuditPreflight: readJsonArg(args, "enterprise-audit-preflight"),
    productionReleaseRunPreflight: readJsonArg(args, "production-release-run-preflight"),
  };
  const plan = buildPlan(inputs);

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(plan));
    return;
  }

  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

function buildPlan(inputs) {
  const actionClassCounts = isRecord(inputs.gapMatrix.summary?.actionClassCounts)
    ? inputs.gapMatrix.summary.actionClassCounts
    : {};
  const phases = phaseDefinitions.map((definition) =>
    buildPhase({
      definition,
      preflight: inputs[definition.inputKey],
      appAuthEnvSourceIntake: inputs.appAuthEnvSourceIntake,
    }),
  );
  const firstActionablePhase =
    phases.find((phase) => phase.status === "ready-for-s19-env-sync-dry-run") ??
    phases.find((phase) => phase.status.startsWith("waiting-")) ??
    phases[0];
  const ownerInputRequired = readNumber(actionClassCounts.needsOwnerInput) > 0;
  const blockingInput =
    firstActionablePhase?.id === "app-auth-provider-production-selector" &&
    firstActionablePhase.status === "ready-for-s19-env-sync-dry-run"
      ? (readBlockingInput(inputs.appAuthEnvSourceIntake) ??
        buildApprovedEnvSourcePathInput(inputs.appAuthPreflight))
      : null;
  const operatorInputPacket = blockingInput
    ? readOperatorInputPacket(inputs.appAuthEnvSourceIntake)
    : null;
  const operatorInputRequired = blockingInput !== null;
  const status = ownerInputRequired
    ? "production-evidence-execution-plan-waiting-for-owner-input"
    : blockingInput
      ? "production-evidence-execution-plan-awaiting-approved-env-source-path"
      : "production-evidence-execution-plan-waiting-for-production-evidence";
  const firstSafeAction = blockingInput
    ? "provide-approved-env-source-path-to-s19"
    : (firstActionablePhase?.nextSafeAction ?? "wait-for-upstream-production-evidence");
  const phasesWithCurrentSafeAction = blockingInput
    ? phases.map((phase) => bubbleBlockingSafeAction({ phase, firstSafeAction }))
    : phases;

  return {
    target: "production-evidence-execution-plan",
    status,
    releaseReady: false,
    firstWorkstreamId: firstActionablePhase?.id ?? null,
    firstSafeAction,
    summary: {
      ownerInputRequired,
      operatorInputRequired,
      blockingInputRequired: blockingInput !== null,
      acceptedAwaitingProductionEvidence: readNumber(
        actionClassCounts.acceptedAwaitingProductionEvidence,
      ),
      awaitingProductionEvidenceLabels: readNumber(
        actionClassCounts.awaitingProductionEvidenceLabels,
      ),
      needsOwnerInput: readNumber(actionClassCounts.needsOwnerInput),
      phaseCount: phases.length,
      releaseReady: false,
    },
    blockingInput,
    operatorInputPacket,
    phases: phasesWithCurrentSafeAction,
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
      noProviderNetworkCallPerformed: true,
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

function bubbleBlockingSafeAction({ phase, firstSafeAction }) {
  if (phase.nextSafeAction !== "wait-for-upstream-production-evidence") {
    return phase;
  }
  return {
    ...phase,
    nextSafeAction: firstSafeAction,
  };
}

function buildPhase({ definition, preflight, appAuthEnvSourceIntake }) {
  const preflightStatus = readString(preflight.status, "missing");
  const releaseReady = preflight.releaseReady === true || preflight.summary?.releaseReady === true;
  const appAuthIntakeOverride = readAppAuthIntakePhaseOverride({
    definition,
    appAuthEnvSourceIntake,
  });
  const missingEvidence =
    appAuthIntakeOverride?.missingEvidence ?? readStringArray(preflight.missingEvidence);
  const blockedReasons =
    appAuthIntakeOverride?.blockedReasons ?? readStringArray(preflight.blockedReasons);
  const safeCommandTemplates = isRecord(preflight.safeCommandTemplates)
    ? preflight.safeCommandTemplates
    : {};
  const status = classifyPhaseStatus({ definition, preflight, preflightStatus, releaseReady });

  return {
    id: definition.id,
    label: definition.label,
    status,
    preflightStatus,
    releaseReady,
    nextSafeAction: readPhaseNextSafeAction(status),
    missingEvidence,
    blockedReasons,
    ...(appAuthIntakeOverride?.deferredMissingEvidence.length > 0
      ? { deferredMissingEvidence: appAuthIntakeOverride.deferredMissingEvidence }
      : {}),
    ...(Object.keys(safeCommandTemplates).length > 0 ? { safeCommandTemplates } : {}),
  };
}

function readAppAuthIntakePhaseOverride({ definition, appAuthEnvSourceIntake }) {
  if (definition.id !== "app-auth-provider-production-selector") {
    return null;
  }
  if (!isRecord(appAuthEnvSourceIntake)) {
    return null;
  }
  if (appAuthEnvSourceIntake.summary?.readyForVercelEnvSyncDryRun === true) {
    return null;
  }
  const missingEvidence = readStringArray(appAuthEnvSourceIntake.missingEvidence);
  const blockedReasons = readStringArray(appAuthEnvSourceIntake.blockedReasons);
  if (missingEvidence.length === 0 && blockedReasons.length === 0) {
    return null;
  }
  return {
    missingEvidence,
    blockedReasons,
    deferredMissingEvidence: readStringArray(appAuthEnvSourceIntake.deferredMissingEvidence),
  };
}

function classifyPhaseStatus({ definition, preflight, preflightStatus, releaseReady }) {
  if (releaseReady) {
    return "production-evidence-ready";
  }
  if (
    definition.id === "app-auth-provider-production-selector" &&
    preflightStatus === "app-auth-production-evidence-preflight-ready" &&
    preflight.summary?.s19DryRunMayProceed === true
  ) {
    return "ready-for-s19-env-sync-dry-run";
  }
  if (preflightStatus.includes("waiting-for-upstream-app-auth")) {
    return "waiting-for-upstream-app-auth";
  }
  if (preflightStatus.includes("waiting-for-upstream-auth")) {
    return "waiting-for-upstream-auth";
  }
  if (preflightStatus.includes("waiting-for-upstream-provider-evidence")) {
    return "waiting-for-upstream-provider-evidence";
  }
  if (preflightStatus.includes("waiting-for-production-deployment-binding")) {
    return "waiting-for-production-deployment-binding";
  }
  if (preflightStatus.includes("waiting-for-upstream-production-evidence")) {
    return "waiting-for-upstream-production-evidence";
  }
  if (preflightStatus.includes("waiting-for-required-live-evidence")) {
    return "waiting-for-required-live-evidence";
  }
  if (preflightStatus.includes("waiting-for-final-release-gate")) {
    return "waiting-for-final-release-gate";
  }
  return "waiting-for-production-evidence";
}

function readPhaseNextSafeAction(status) {
  if (status === "ready-for-s19-env-sync-dry-run") {
    return "provide-approved-env-source-path-to-s19";
  }
  if (status === "production-evidence-ready") {
    return "continue-to-next-phase";
  }
  return "wait-for-upstream-production-evidence";
}

function buildApprovedEnvSourcePathInput(appAuthPreflight) {
  return {
    id: "approved-env-source-path",
    label: readString(appAuthPreflight.approvedServerOnlyEnvSourceLabel, "none-recorded"),
    reason:
      "S19 can prepare env sync evidence only after the approved server-only env source is available as a local path without exposing values.",
    valuesForbidden: true,
  };
}

function readBlockingInput(value) {
  return isRecord(value?.blockingInput) ? value.blockingInput : null;
}

function renderMarkdown(plan) {
  const lines = [
    "# UAIS Production Evidence Execution Plan",
    "",
    `Status: \`${plan.status}\``,
    `Release ready: \`${plan.releaseReady}\``,
    `First workstream: \`${plan.firstWorkstreamId ?? "none-recorded"}\``,
    `First safe action: \`${plan.firstSafeAction}\``,
    `Owner input required: \`${plan.summary.ownerInputRequired}\``,
    `Operator input required: \`${plan.summary.operatorInputRequired}\``,
    "",
    "This plan reads only redacted coordination reports. It does not read env files, call Vercel, apply env, deploy, run live smokes, call provider endpoints, or bind a release run.",
    "",
  ];

  if (plan.blockingInput) {
    lines.push("## Blocking Input", "");
    lines.push(
      `- \`${plan.blockingInput.id}\`: \`${plan.blockingInput.label}\``,
      `- Reason: ${plan.blockingInput.reason}`,
      `- Values forbidden: \`${plan.blockingInput.valuesForbidden}\``,
      "",
    );
  }

  if (plan.operatorInputPacket) {
    lines.push("## Operator Input Packet", "");
    lines.push(
      `- Status: \`${plan.operatorInputPacket.status}\``,
      `- First required input: \`${plan.operatorInputPacket.firstRequiredInputId}\``,
      `- Next safe action: \`${plan.operatorInputPacket.nextSafeAction}\``,
      `- Next command template: \`${plan.operatorInputPacket.nextSafeCommandTemplateKey}\``,
      `- Values forbidden: \`${plan.operatorInputPacket.valuesForbidden}\``,
      `- Preferred input mode: \`${plan.operatorInputPacket.preferredInputMode ?? "not-recorded"}\``,
      `- Safe input instruction: ${plan.operatorInputPacket.safeInputInstruction ?? "not-recorded"}`,
      `- Approved source label is evidence: \`${plan.operatorInputPacket.approvedSourceLabelIsNotEvidence === true ? "false" : "not-recorded"}\``,
      "",
    );
  }

  lines.push("## Phases", "");
  lines.push("| Phase | Status | Next safe action | Missing evidence |");
  lines.push("| --- | --- | --- | ---: |");
  for (const phase of plan.phases) {
    lines.push(
      `| \`${phase.id}\` | \`${phase.status}\` | \`${phase.nextSafeAction}\` | ${phase.missingEvidence.length} |`,
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

function readNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
