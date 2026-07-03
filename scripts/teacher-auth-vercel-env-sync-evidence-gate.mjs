#!/usr/bin/env node

import { readFileSync } from "node:fs";

const defaultRequiredTeacherAuthEnvNames = [
  "UAIS_TEACHER_AUTH_PROVIDER",
  "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
  "UAIS_TEACHER_AUTH_ISSUER_SECRET",
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const teacherAuthPreflight = readJsonArg(args, "teacher-auth-preflight");
  const teacherAuthEnvSourceIntake =
    typeof args["teacher-auth-env-source-intake"] === "string"
      ? readJsonArg(args, "teacher-auth-env-source-intake")
      : undefined;
  const vercelEnvSync =
    typeof args["vercel-env-sync"] === "string"
      ? readJsonArg(args, "vercel-env-sync")
      : undefined;
  const report = buildReport({ teacherAuthPreflight, teacherAuthEnvSourceIntake, vercelEnvSync });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildReport({ teacherAuthPreflight, teacherAuthEnvSourceIntake, vercelEnvSync }) {
  const approvedProviderMode = readString(teacherAuthPreflight.approvedProviderMode, "");
  const approvedReleaseRunIdLabel = readString(
    teacherAuthPreflight.approvedReleaseRunIdLabel,
    "",
  );
  const upstreamAppAuthEvidenceCleared =
    teacherAuthPreflight.summary?.upstreamAppAuthEvidenceCleared === true;
  const teacherPreflightReady =
    upstreamAppAuthEvidenceCleared &&
    readString(teacherAuthPreflight.status, "") === "teacher-auth-production-evidence-preflight-ready";
  const requiredTeacherAuthEnvNames = readRequiredTeacherAuthEnvNames(teacherAuthPreflight);
  const vercelEnvSyncEvidenceStatus = evaluateVercelEnvSyncEvidence({
    evidence: vercelEnvSync,
    approvedProviderMode,
    approvedReleaseRunIdLabel,
    requiredTeacherAuthEnvNames,
  });
  const applyEvidenceAccepted =
    teacherPreflightReady &&
    vercelEnvSyncEvidenceStatus.status === "matched" &&
    vercelEnvSyncEvidenceStatus.applyPreflight === "proved" &&
    vercelEnvSyncEvidenceStatus.releaseRunIdStatus === "matched" &&
    vercelEnvSyncEvidenceStatus.requiredTeacherAuthEnvStatus === "present";
  const upstreamProductionEvidenceRequired = !teacherPreflightReady;
  const upstreamOperatorInputRequired =
    upstreamProductionEvidenceRequired &&
    teacherAuthEnvSourceIntake?.summary?.operatorInputRequired === true;
  const upstreamBlockingEvidence = upstreamProductionEvidenceRequired
    ? {
        id: "upstream-app-auth-production-evidence",
        label: "app-auth-production-evidence",
        reason:
          "Teacher-auth Vercel env-sync evidence must wait for app-auth production evidence before S19 runs or accepts teacher-auth env-sync evidence.",
        valuesForbidden: true,
        upstreamStatus: readString(teacherAuthPreflight.status, "unknown"),
        upstreamBlockedReasons: ["upstream-app-auth-production-evidence-not-cleared"],
        safeNextAction: readString(teacherAuthEnvSourceIntake?.safeNextAction, ""),
        upstreamOperatorInputRequired,
        upstreamMissingEvidence: readStringArray(
          teacherAuthEnvSourceIntake?.upstreamBlockingEvidence?.upstreamMissingEvidence,
        ),
        upstreamOperatorInputPacket: readSafeOperatorInputPacket(
          teacherAuthEnvSourceIntake?.upstreamBlockingEvidence?.upstreamOperatorInputPacket,
        ),
        upstreamSafeCommandTemplates: readSafeCommandTemplates(
          teacherAuthEnvSourceIntake?.upstreamBlockingEvidence?.upstreamSafeCommandTemplates,
        ),
      }
    : null;
  const status = readStatus({
    teacherPreflightReady,
    vercelEnvSync,
    applyEvidenceAccepted,
  });

  return {
    target: "teacher-auth-vercel-env-sync-evidence-gate",
    status,
    releaseReady: false,
    responsibleSession: "S19/S22",
    approvedServerOnlyEnvSourceLabel: readString(
      teacherAuthPreflight.approvedServerOnlyEnvSourceLabel,
      "",
    ),
    approvedProviderMode,
    approvedReleaseRunIdLabel,
    summary: {
      ownerInputRequired: false,
      operatorInputRequired: upstreamOperatorInputRequired,
      blockingInputRequired: upstreamOperatorInputRequired,
      upstreamProductionEvidenceRequired,
      upstreamAppAuthEvidenceCleared,
      teacherPreflightReady,
      vercelEnvSyncEvidenceProvided: vercelEnvSync !== undefined,
      applyEvidenceAccepted,
      teacherAuthEnvPresent:
        vercelEnvSyncEvidenceStatus.requiredTeacherAuthEnvStatus === "present",
      teacherAuthReadinessMayProceed: applyEvidenceAccepted,
      releaseReady: false,
    },
    vercelEnvSyncEvidenceStatus,
    requiredTeacherAuthEnvNames,
    upstreamBlockingEvidence,
    blockedReasons: applyEvidenceAccepted
      ? []
      : readBlockedReasons({
        teacherPreflightReady,
        vercelEnvSyncEvidenceStatus,
      }),
    safeNextAction: readSafeNextAction({
      teacherPreflightReady,
      applyEvidenceAccepted,
      upstreamBlockingEvidence,
    }),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      credentialValuesOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      envFileRead: false,
      vercelApiCalled: false,
      noCookieIssued: true,
      noEnvApplyPerformed: true,
      noDeploymentMutationPerformed: true,
      noLiveSmokePerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function readStatus({ teacherPreflightReady, vercelEnvSync, applyEvidenceAccepted }) {
  if (applyEvidenceAccepted) {
    return "teacher-auth-vercel-env-sync-evidence-gate-apply-evidence-accepted";
  }
  if (!teacherPreflightReady) {
    return "teacher-auth-vercel-env-sync-evidence-gate-waiting-for-upstream-app-auth";
  }
  if (vercelEnvSync === undefined) {
    return "teacher-auth-vercel-env-sync-evidence-gate-awaiting-vercel-env-sync-evidence";
  }
  return "teacher-auth-vercel-env-sync-evidence-gate-rejected";
}

function evaluateVercelEnvSyncEvidence({
  evidence,
  approvedProviderMode,
  approvedReleaseRunIdLabel,
  requiredTeacherAuthEnvNames,
}) {
  if (evidence === undefined) {
    return {
      target: "missing",
      status: "missing",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredTeacherAuthEnvStatus: "missing",
      valueRedacted: true,
    };
  }
  const base = {
    target: readString(evidence.target, "missing"),
    valueRedacted: true,
  };
  if (base.target !== "vercel-env-sync") {
    return {
      ...base,
      status: "invalid-target",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredTeacherAuthEnvStatus: "missing",
    };
  }
  const requiredTeacherAuthEnvStatus =
    readMissingTeacherAuthEnvNames(evidence, requiredTeacherAuthEnvNames).length === 0
      ? "present"
      : "missing";
  if (
    evidence.mode !== "apply" ||
    evidence.projectReadinessEvidenceStatus !== "ready" ||
    !hasProductionAndPreviewTargets(evidence.targets) ||
    !hasRedactedApplySummary(evidence)
  ) {
    return {
      ...base,
      status: "not-applied",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredTeacherAuthEnvStatus,
    };
  }
  if (!hasPassedApplyPreflight(evidence)) {
    return {
      ...base,
      status: "apply-preflight-missing",
      applyPreflight: "missing",
      releaseRunIdStatus: "missing",
      requiredTeacherAuthEnvStatus,
    };
  }
  if (evidence.releaseRunId !== approvedReleaseRunIdLabel) {
    return {
      ...base,
      status: "release-run-id-mismatch",
      applyPreflight: "proved",
      releaseRunIdStatus: "mismatched",
      requiredTeacherAuthEnvStatus,
    };
  }
  if (evidence.teacherAuthProviderMode !== approvedProviderMode) {
    return {
      ...base,
      status: "teacher-auth-provider-selector-mismatch",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredTeacherAuthEnvStatus,
    };
  }
  const missingTeacherAuthEnvNames = readMissingTeacherAuthEnvNames(
    evidence,
    requiredTeacherAuthEnvNames,
  );
  if (missingTeacherAuthEnvNames.length > 0) {
    return {
      ...base,
      status: "teacher-auth-env-missing",
      applyPreflight: "proved",
      releaseRunIdStatus: "matched",
      requiredTeacherAuthEnvStatus: "missing",
      missingTeacherAuthEnvNames,
    };
  }
  return {
    ...base,
    status: "matched",
    applyPreflight: "proved",
    releaseRunIdStatus: "matched",
    requiredTeacherAuthEnvStatus: "present",
  };
}

function readBlockedReasons({ teacherPreflightReady, vercelEnvSyncEvidenceStatus }) {
  const reasons = [];
  if (!teacherPreflightReady) {
    reasons.push("upstream-app-auth-production-evidence-not-cleared");
    return reasons;
  }
  if (vercelEnvSyncEvidenceStatus.status === "missing") {
    reasons.push("vercel-env-sync-evidence-missing");
  } else if (vercelEnvSyncEvidenceStatus.status === "not-applied") {
    reasons.push("vercel-env-sync-not-applied");
  } else if (vercelEnvSyncEvidenceStatus.status === "apply-preflight-missing") {
    reasons.push("vercel-env-sync-apply-preflight-not-proven");
  } else if (vercelEnvSyncEvidenceStatus.status === "release-run-id-mismatch") {
    reasons.push("vercel-env-sync-release-run-id-mismatch");
  } else if (vercelEnvSyncEvidenceStatus.status === "teacher-auth-provider-selector-mismatch") {
    reasons.push("vercel-env-sync-teacher-auth-provider-selector-mismatch");
  } else if (vercelEnvSyncEvidenceStatus.status === "teacher-auth-env-missing") {
    reasons.push("vercel-env-sync-teacher-auth-env-missing");
  } else if (vercelEnvSyncEvidenceStatus.status !== "matched") {
    reasons.push(`vercel-env-sync-evidence-${vercelEnvSyncEvidenceStatus.status}`);
  }
  return reasons;
}

function readSafeNextAction({ teacherPreflightReady, applyEvidenceAccepted, upstreamBlockingEvidence }) {
  if (applyEvidenceAccepted) {
    return "run-s22-teacher-auth-provider-readiness-with-accepted-env-sync-evidence";
  }
  if (!teacherPreflightReady) {
    return readString(
      upstreamBlockingEvidence?.safeNextAction,
      "wait-for-app-auth-production-evidence-before-teacher-auth-env-sync",
    );
  }
  return "run-s19-teacher-auth-vercel-env-sync-after-app-auth-clears";
}

function readMissingTeacherAuthEnvNames(evidence, requiredTeacherAuthEnvNames) {
  const entryStatusByName = new Map();
  if (Array.isArray(evidence.entries)) {
    for (const entry of evidence.entries) {
      if (!isRecord(entry)) {
        continue;
      }
      const name = readString(entry.name, readString(entry.key, ""));
      if (name.length > 0) {
        entryStatusByName.set(name, readString(entry.status, "missing"));
      }
    }
  }
  const envStatus = isRecord(evidence.envStatus) ? evidence.envStatus : {};
  const requiredEnv = isRecord(evidence.requiredEnv) ? evidence.requiredEnv : {};
  return requiredTeacherAuthEnvNames.filter((name) => {
    if (entryStatusByName.get(name) === "present") {
      return false;
    }
    if (envStatus[name] === "present" || requiredEnv[name] === "present") {
      return false;
    }
    return true;
  });
}

function readRequiredTeacherAuthEnvNames(teacherAuthPreflight) {
  const names = readStringArray(teacherAuthPreflight.requiredServerOnlyEnvNames);
  return names.length > 0 ? names : defaultRequiredTeacherAuthEnvNames;
}

function hasProductionAndPreviewTargets(targets) {
  return Array.isArray(targets) && targets.includes("production") && targets.includes("preview");
}

function hasRedactedApplySummary(evidence) {
  const summary = evidence.applySummary;
  const appliedByTarget = summary?.appliedByTarget;
  return (
    isRecord(summary) &&
    summary.status === "applied" &&
    Number.isInteger(summary.appliedActions) &&
    summary.appliedActions > 0 &&
    isRecord(appliedByTarget) &&
    Number.isInteger(appliedByTarget.production) &&
    appliedByTarget.production > 0 &&
    Number.isInteger(appliedByTarget.preview) &&
    appliedByTarget.preview > 0 &&
    Number.isInteger(summary.localOnlyEntriesSkipped) &&
    summary.localOnlyEntriesSkipped >= 0 &&
    summary.valuesRedacted === true &&
    (summary.cliOutputOmitted === true || summary.apiOutputOmitted === true)
  );
}

function hasPassedApplyPreflight(evidence) {
  const preflight = evidence.applyPreflight;
  return (
    isRecord(preflight) &&
    preflight.status === "passed" &&
    Array.isArray(preflight.blockedReasons) &&
    preflight.blockedReasons.length === 0 &&
    preflight.valuesRedacted === true &&
    preflight.cliSafeToInvoke === true
  );
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Teacher Auth Vercel Env Sync Evidence Gate",
    "",
    `Status: \`${report.status}\``,
    `Env source label: \`${report.approvedServerOnlyEnvSourceLabel}\``,
    `Provider mode: \`${report.approvedProviderMode}\``,
    `Operator input required: \`${report.summary.operatorInputRequired}\``,
    `Safe next action: \`${report.safeNextAction}\``,
    `Upstream production evidence required: \`${report.summary.upstreamProductionEvidenceRequired}\``,
    `Upstream app-auth evidence cleared: \`${report.summary.upstreamAppAuthEvidenceCleared}\``,
    `Teacher auth readiness may proceed: \`${report.summary.teacherAuthReadinessMayProceed}\``,
    `Release ready: \`${report.summary.releaseReady}\``,
    "",
    "## Evidence Status",
    "",
    `- Target: \`${report.vercelEnvSyncEvidenceStatus.target}\``,
    `- Status: \`${report.vercelEnvSyncEvidenceStatus.status}\``,
    `- Apply preflight: \`${report.vercelEnvSyncEvidenceStatus.applyPreflight}\``,
    `- Release run ID: \`${report.vercelEnvSyncEvidenceStatus.releaseRunIdStatus}\``,
    `- Required teacher-auth env: \`${report.vercelEnvSyncEvidenceStatus.requiredTeacherAuthEnvStatus}\``,
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
    "## Blocked Reasons",
    "",
    ...(report.blockedReasons.length > 0
      ? report.blockedReasons.map((reason) => `- \`${reason}\``)
      : ["- None"]),
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value, fallback) {
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

main();
