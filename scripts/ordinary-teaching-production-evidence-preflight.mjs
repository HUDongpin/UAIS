#!/usr/bin/env node

import { readFileSync } from "node:fs";

const decisionId = "ordinary-teaching-production-evidence";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerResponseValidation = readJsonArg(args, "owner-response-validation");
  const approvalGate = readJsonArg(args, "approval-gate");
  const ordinaryPrerequisiteIndex = readJsonArg(args, "ordinary-prerequisite-index");
  const ordinaryTeachingActionPacket = readJsonArg(args, "ordinary-teaching-action-packet");
  const appAuthPreflight = args["app-auth-preflight"]
    ? readJsonArg(args, "app-auth-preflight")
    : {};
  const teacherAuthPreflight = args["teacher-auth-preflight"]
    ? readJsonArg(args, "teacher-auth-preflight")
    : {};
  const externalStoragePreflight = args["external-storage-preflight"]
    ? readJsonArg(args, "external-storage-preflight")
    : {};
  const vercelEnvDeployPreflight = args["vercel-env-deploy-preflight"]
    ? readJsonArg(args, "vercel-env-deploy-preflight")
    : {};
  const report = buildPreflight({
    ownerResponseValidation,
    approvalGate,
    ordinaryPrerequisiteIndex,
    ordinaryTeachingActionPacket,
    appAuthPreflight,
    teacherAuthPreflight,
    externalStoragePreflight,
    vercelEnvDeployPreflight,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildPreflight({
  ownerResponseValidation,
  approvalGate,
  ordinaryPrerequisiteIndex,
  ordinaryTeachingActionPacket,
  appAuthPreflight,
  teacherAuthPreflight,
  externalStoragePreflight,
  vercelEnvDeployPreflight,
}) {
  const ownerResponseAccepted =
    readString(ownerResponseValidation.status, "") === "owner-response-accepted";
  const stages = readRecordArray(approvalGate.stages);
  const ordinaryStage = stages.find((stage) => readString(stage.id, "") === decisionId) || {};
  const ordinaryStageWaitingForLiveEvidence =
    readString(ordinaryStage.queueStatus, "") === "waiting-for-live-evidence" ||
    readString(ordinaryStage.currentStatus, "") === "waiting-for-live-evidence";
  const ownerPrerequisites = readRecordArray(ordinaryPrerequisiteIndex.ownerPrerequisites);
  const incompleteOwnerPrerequisiteCount = readNumber(
    ordinaryPrerequisiteIndex.summary?.incompleteOwnerPrerequisiteCount,
    ownerPrerequisites.filter((item) => item.accepted !== true).length,
  );
  const ownerPrerequisitesAccepted =
    incompleteOwnerPrerequisiteCount === 0 &&
    (ownerPrerequisites.length === 0 || ownerPrerequisites.every((item) => item.accepted === true));
  const missingPrerequisiteEvidence = readRecordArray(
    ordinaryPrerequisiteIndex.missingPrerequisiteEvidence,
  );
  const missingSmokeTargets = readRecordArray(ordinaryPrerequisiteIndex.missingSmokeTargets);
  const upstreamPreflightBlockers = buildUpstreamPreflightBlockers({
    appAuthPreflight,
    teacherAuthPreflight,
    externalStoragePreflight,
    vercelEnvDeployPreflight,
  });
  const upstreamProductionEvidenceCleared =
    missingPrerequisiteEvidence.length === 0 && upstreamPreflightBlockers.length === 0;
  const smokeTargetsCleared = missingSmokeTargets.length === 0;
  const ordinaryOwnerResponseCanBeAccepted =
    ordinaryPrerequisiteIndex.summary?.ordinaryOwnerResponseCanBeAccepted === true;
  const requiredEvidence = uniqueStrings([
    ...readStringArray(ownerResponseValidation.requiredEvidenceAfterApproval),
    ...readStringArray(ordinaryStage.requiredEvidence),
    ...readStringArray(ordinaryPrerequisiteIndex.requiredEvidenceAfterApproval),
    ...readStringArray(ordinaryTeachingActionPacket.requiredEvidence),
  ]);
  const requiredOwnerInputFields = uniqueStrings([
    ...readStringArray(approvalGate.firstIncompleteOwnerResponse?.requiredOwnerInputFields),
    ...missingLabelFields(ownerResponseValidation.redactedOwnerResponse),
  ]);
  const safeCommandTemplates = buildSafeCommandTemplates({
    actionPacket: ordinaryTeachingActionPacket,
    prerequisiteIndex: ordinaryPrerequisiteIndex,
    ownerResponseValidation,
  });
  const blockedReasons = uniqueStrings([
    ...(!ownerPrerequisitesAccepted ? ["owner-prerequisite-responses-incomplete"] : []),
    ...(!ordinaryStageWaitingForLiveEvidence
      ? ["ordinary-teaching-stage-not-waiting-for-live-evidence"]
      : []),
    ...(!upstreamProductionEvidenceCleared ? ["upstream-production-evidence-not-cleared"] : []),
    ...(!ownerResponseAccepted ? ["ordinary-owner-response-not-accepted"] : []),
    ...(!ordinaryOwnerResponseCanBeAccepted
      ? ["ordinary-owner-response-not-ready-for-acceptance"]
      : []),
    ...(!smokeTargetsCleared ? ["ordinary-live-smoke-targets-not-cleared"] : []),
    ...missingPrerequisiteEvidence.map((item) => `${readString(item.id, "unknown")}-missing`),
    ...missingSmokeTargets.map((item) => `${readString(item.id, "unknown")}-missing`),
  ]);
  const status = !ownerPrerequisitesAccepted
    ? "ordinary-teaching-production-evidence-preflight-blocked"
    : !upstreamProductionEvidenceCleared
      ? "ordinary-teaching-production-evidence-preflight-waiting-for-upstream-production-evidence"
      : !ownerResponseAccepted
        ? ordinaryOwnerResponseCanBeAccepted
          ? "ordinary-teaching-production-evidence-preflight-waiting-for-owner-evidence-labels"
          : "ordinary-teaching-production-evidence-preflight-blocked"
        : !smokeTargetsCleared
          ? "ordinary-teaching-production-evidence-preflight-waiting-for-live-smokes"
          : "ordinary-teaching-production-evidence-preflight-ready";

  return {
    target: "ordinary-teaching-production-evidence-preflight",
    status,
    releaseReady: false,
    responsibleSession: "S22/S19/S12/S10",
    ownerDecisionId: decisionId,
    summary: {
      ownerResponseAccepted,
      ordinaryStageWaitingForLiveEvidence,
      ownerPrerequisitesAccepted,
      upstreamProductionEvidenceCleared,
      smokeTargetsCleared,
      ordinaryOwnerResponseCanBeAccepted,
      requiredEvidenceCount: requiredEvidence.length,
      missingPrerequisiteEvidenceCount: missingPrerequisiteEvidence.length,
      missingSmokeTargetCount: missingSmokeTargets.length,
      ordinaryOwnerMissingFieldCount: readNumber(
        ordinaryPrerequisiteIndex.summary?.ordinaryOwnerMissingFieldCount,
        readNumber(ownerResponseValidation.summary?.missingFieldCount),
      ),
      requiredOwnerInputFieldCount: requiredOwnerInputFields.length,
      commandTemplateCount: Object.keys(safeCommandTemplates).length,
      releaseReady: false,
    },
    upstreamBlockers: upstreamPreflightBlockers,
    requiredOwnerInputFields,
    requiredEvidence,
    missingPrerequisiteEvidence,
    missingSmokeTargets,
    blockedReasons,
    safeCommandTemplates,
    safeNextActions: uniqueStrings([
      ...readStringArray(ordinaryPrerequisiteIndex.nextSafeActions),
      ...readStringArray(ordinaryTeachingActionPacket.safeNextActions),
      ...readStringArray(ownerResponseValidation.postValidationAllowedChecks),
    ]),
    forbiddenUntilEvidenceExists: uniqueStrings([
      ...readStringArray(ordinaryPrerequisiteIndex.stillForbiddenUntilResolved),
      ...readStringArray(ordinaryTeachingActionPacket.forbiddenUntilApproved),
      ...readStringArray(ownerResponseValidation.stillForbiddenUntilSeparateApproval),
    ]),
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmittedFromMarkdown: true,
      deploymentUrlsOmitted: true,
      teacherIdsOmitted: true,
      courseIdsOmitted: true,
      cookieValuesOmitted: true,
      credentialValuesOmitted: true,
      responseBodiesOmitted: true,
      commandBodiesRedactedToTemplates: true,
      envFileRead: false,
      vercelApiCalled: false,
      liveSmokePerformed: false,
      noRemoteWritePerformed: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noEnvApplyPerformed: true,
      noReleaseRunBindingPerformed: true,
    },
  };
}

function buildUpstreamPreflightBlockers({
  appAuthPreflight,
  teacherAuthPreflight,
  externalStoragePreflight,
  vercelEnvDeployPreflight,
}) {
  const blockers = [];
  if (!preflightEvidenceCleared(appAuthPreflight)) {
    blockers.push("app-auth-production-evidence-not-cleared");
  }
  if (!preflightEvidenceCleared(teacherAuthPreflight)) {
    blockers.push("teacher-auth-production-evidence-not-cleared");
  }
  if (!preflightEvidenceCleared(externalStoragePreflight)) {
    blockers.push("external-storage-production-evidence-not-cleared");
  }
  if (!preflightEvidenceCleared(vercelEnvDeployPreflight)) {
    blockers.push("vercel-production-deployment-evidence-not-cleared");
  }
  return blockers;
}

function preflightEvidenceCleared(preflight) {
  return (
    readString(preflight.status, "").includes("ready") &&
    preflight.releaseReady === true &&
    preflight.summary?.missingEvidenceCount === 0
  );
}

function missingLabelFields(redactedOwnerResponse) {
  if (!isRecord(redactedOwnerResponse)) {
    return [];
  }
  return [
    "approvedAppAuthReadinessEvidenceLabel",
    "approvedTeacherAuthReadinessEvidenceLabel",
    "approvedExternalStorageReadinessEvidenceLabel",
    "approvedVercelProductionDeploymentEvidenceLabel",
    "approvedDeploymentReachabilityEvidenceLabel",
    "approvedTeacherAuthCookieLabel",
    "approvedSmokeTeacherIdLabel",
    "approvedSmokeCourseIdLabel",
    "approvedOtherTeacherIdLabel",
    "approvedStudentIdLabel",
    "approvedReleaseRunIdLabel",
  ].filter((field) => !isSafeLabel(redactedOwnerResponse[field]));
}

function buildSafeCommandTemplates({ actionPacket, prerequisiteIndex, ownerResponseValidation }) {
  const commandNames = uniqueStrings([
    ...Object.keys(readRecord(actionPacket.commands)),
    ...readStringArray(prerequisiteIndex.requiredCommandNames),
    ...readStringArray(ownerResponseValidation.requiredCommandNames),
    "teachingOperationsRouteSmoke",
    "operationDetailBrowserSmoke",
    "teachingCourseManagementRouteSmoke",
  ]);
  const commands = readRecord(actionPacket.commands);
  const templates = {};
  for (const commandName of commandNames) {
    templates[commandName] = sanitizeCommandTemplate(
      readString(commands[commandName], defaultCommandTemplate(commandName)),
    );
  }
  return templates;
}

function defaultCommandTemplate(commandName) {
  switch (commandName) {
    case "teachingOperationsRouteSmoke":
      return "node scripts/teaching-operations-route-smoke.mjs --base-url <deployment-base-url-label> --teacher-auth-cookie-label <teacher-auth-cookie-label> --release-run-id <release-run-id-label> > <teaching-operations-route-smoke-evidence>";
    case "operationDetailBrowserSmoke":
      return "node scripts/operation-detail-browser-smoke.mjs --base-url <deployment-base-url-label> --smoke-teacher-label <smoke-teacher-label> --course-label <smoke-course-label> --release-run-id <release-run-id-label> > <operation-detail-browser-smoke-evidence>";
    case "teachingCourseManagementRouteSmoke":
      return "node scripts/teaching-course-management-route-smoke.mjs --base-url <deployment-base-url-label> --smoke-teacher-label <smoke-teacher-label> --course-label <smoke-course-label> --release-run-id <release-run-id-label> > <teaching-course-management-route-smoke-evidence>";
    default:
      return `node scripts/${commandName}.mjs --base-url <deployment-base-url-label> --release-run-id <release-run-id-label> > <${commandName}-evidence>`;
  }
}

function sanitizeCommandTemplate(command) {
  return command
    .replace(/https?:\/\/\S+/g, "<deployment-base-url-label>")
    .replace(/\/Users\/\S+/g, "<local-path-omitted>")
    .replace(/--teacher-cookie\s+\S+/g, "--teacher-auth-cookie-label <teacher-auth-cookie-label>")
    .replace(/--cookie\s+\S+/g, "--teacher-auth-cookie-label <teacher-auth-cookie-label>")
    .replace(/--teacher-id\s+\S+/g, "--smoke-teacher-label <smoke-teacher-label>")
    .replace(/--student-id\s+\S+/g, "--student-label <student-label>")
    .replace(/--course-id\s+\S+/g, "--course-label <smoke-course-label>")
    .replace(/<approved-teacher-auth-cookie>/g, "<teacher-auth-cookie-label>")
    .replace(/<smoke-teacher-id>/g, "<smoke-teacher-label>")
    .replace(/<smoke-course-id>/g, "<smoke-course-label>")
    .replace(/<deployment-url>/g, "<deployment-base-url-label>");
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Ordinary Teaching Production Evidence Preflight",
    "",
    `Status: \`${report.status}\``,
    `Release ready: \`${report.releaseReady}\``,
    `Owner decision: \`${report.ownerDecisionId}\``,
    `Owner prerequisites accepted: \`${report.summary.ownerPrerequisitesAccepted}\``,
    `Upstream production evidence cleared: \`${report.summary.upstreamProductionEvidenceCleared}\``,
    `Smoke targets cleared: \`${report.summary.smokeTargetsCleared}\``,
    `Required owner input fields: ${report.summary.requiredOwnerInputFieldCount}`,
    `Missing prerequisite evidence: ${report.summary.missingPrerequisiteEvidenceCount}`,
    `Missing smoke targets: ${report.summary.missingSmokeTargetCount}`,
    "",
    "This preflight reads only existing redacted coordination reports. It does not read env files, print cookies, expose deployment URLs, run live smokes, deploy, apply Vercel env, or bind a release run.",
    "",
    "## Upstream Blockers",
    "",
    ...formatBullets(report.upstreamBlockers),
    "",
    "## Missing Prerequisite Evidence",
    "",
    ...formatBullets(report.missingPrerequisiteEvidence.map((item) => item.id)),
    "",
    "## Missing Smoke Targets",
    "",
    ...formatBullets(report.missingSmokeTargets.map((item) => item.id)),
    "",
    "## Required Owner Input Fields",
    "",
    ...formatBullets(report.requiredOwnerInputFields),
    "",
    "## Safe Command Templates",
    "",
    "```sh",
    ...Object.values(report.safeCommandTemplates),
    "```",
  ];

  if (report.blockedReasons.length > 0) {
    lines.push("", "## Blocked Reasons", "");
    lines.push(...formatBullets(report.blockedReasons));
  }

  if (report.forbiddenUntilEvidenceExists.length > 0) {
    lines.push("", "## Still Forbidden", "");
    lines.push(...formatBullets(report.forbiddenUntilEvidenceExists));
  }

  return `${lines.join("\n")}\n`;
}

function formatBullets(values) {
  return values.length > 0 ? values.map((value) => `- \`${value}\``) : ["- `none-recorded`"];
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

function readRecord(value) {
  return isRecord(value) ? value : {};
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

function isSafeLabel(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
