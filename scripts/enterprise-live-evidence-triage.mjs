#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const responsibleSessionByTarget = {
  "app-auth-provider-readiness": ["Owner", "S12", "S19", "S22"],
  "teacher-auth-issuer-route-smoke": ["S12", "S22"],
  "teacher-auth-provider-readiness": ["Owner", "S12", "S19", "S22"],
  "external-storage-persistence": ["S12", "S22", "S24"],
  "external-storage-service-readiness": ["Owner", "S12", "S19", "S22", "S24"],
  "deployment-domain-reachability": ["S22"],
  "teacher-workflow-deployment-smoke": ["S22"],
  "teacher-workflow-browser-smoke": ["S22"],
  "teacher-workflow-live-generation-smoke": ["S07", "S22"],
  "learning-ppt-playback-deployment-smoke": ["S22", "S24"],
  "ppt-manual-playback-acceptance": ["Owner", "S24", "S22"],
  "deployment-route-smoke": ["S22"],
  "teaching-operations-route-smoke": ["S05", "S12", "S13", "S19", "S22"],
  "teaching-operation-detail-browser-smoke": ["S05", "S12", "S13", "S19", "S22"],
  "teaching-course-management-route-smoke": ["S05", "S12", "S13", "S19", "S22"],
  "external-storage-smoke": ["S12", "S22", "S24"],
};

const executionWaveDefinitions = [
  {
    id: "provider-and-env-decisions",
    label: "Provider and env decisions",
    gate:
      "Owner, S12, S19, S22, and S24 settle provider/service readiness before live production runs.",
    stopCondition:
      "Stop if owner provider choices, approved env placement, or service readiness cannot be confirmed.",
    targets: [
      "app-auth-provider-readiness",
      "teacher-auth-provider-readiness",
      "external-storage-service-readiness",
    ],
  },
  {
    id: "deployment-and-domain-binding",
    label: "Deployment and domain binding",
    gate:
      "S22 proves production deployment, domain reachability, and deployment route smoke prerequisites.",
    stopCondition:
      "Stop if production deployment, domain reachability, or deployment route proof cannot be produced.",
    targets: [
      "deployment-domain-reachability",
      "deployment-route-smoke",
      "teacher-workflow-deployment-smoke",
      "learning-ppt-playback-deployment-smoke",
    ],
  },
  {
    id: "auth-and-storage-readiness",
    label: "Auth and storage readiness",
    gate:
      "S12, S19, S22, and S24 prove auth issuer and external storage readiness on the shared run.",
    stopCondition:
      "Stop if auth issuer, provider readiness, or storage persistence proof is missing.",
    targets: [
      "teacher-auth-issuer-route-smoke",
      "external-storage-persistence",
      "external-storage-smoke",
    ],
  },
  {
    id: "workflow-and-ordinary-teaching-smokes",
    label: "Workflow and ordinary teaching smokes",
    gate:
      "S05, S07, S12, S13, S19, S22, and S24 prove production teaching and workflow routes.",
    stopCondition:
      "Stop if body-level result proof, target contract proof, or safety proof is missing.",
    targets: [
      "teacher-workflow-browser-smoke",
      "teacher-workflow-live-generation-smoke",
      "teaching-operations-route-smoke",
      "teaching-operation-detail-browser-smoke",
      "teaching-course-management-route-smoke",
    ],
  },
  {
    id: "manual-qa-and-final-audit",
    label: "Manual QA and final audit",
    gate:
      "Owner, S24, and S22 bind manual playback acceptance and final audit review to the shared run.",
    stopCondition:
      "Stop if human PowerPoint/WPS playback acceptance or final release-run consistency is missing.",
    targets: ["ppt-manual-playback-acceptance"],
  },
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const audit = readJsonArg(args, "enterprise-live-evidence-audit");
  const triage = buildTriage({
    audit,
    releaseGateStatus: readString(args["release-gate-status"], readString(audit.releaseGateStatus, "unknown")),
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(triage));
    return;
  }

  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}

function buildTriage({ audit, releaseGateStatus }) {
  const rows = readRecordArray(audit.rows);
  const summary = isRecord(audit.summary) ? audit.summary : {};
  const blockerCounts = countBlockers(rows);
  const nextActions = rows.map((row) => buildNextAction(row));
  const categories = buildCategories(rows);
  const executionWaves = buildExecutionWaves(nextActions);

  return {
    target: "enterprise-live-evidence-triage",
    status: readString(audit.status, "unknown"),
    releaseGateStatus,
    responsibleSession: "S22",
    summary: {
      totalTargets: readNumber(summary.totalProductionLiveNamed, rows.length),
      acceptedTargets: readNumber(summary.acceptedLiveEvidence, 0),
      blockedTargets: readNumber(summary.filenameOnlyOrBlocked, rows.length),
      missingRequiredTargets: readNumber(
        summary.missingRequiredTargetCount,
        readStringArray(audit.missingRequiredTargets).length,
      ),
      releaseRunIdConsistency: readString(summary.releaseRunIdConsistency, "missing"),
      sharedReleaseRunIdStatus: readString(summary.sharedReleaseRunIdStatus, "missing"),
    },
    missingRequiredTargets: readStringArray(audit.missingRequiredTargets),
    blockerCounts,
    categories,
    executionWaves,
    nextActions,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      cookieValuesOmitted: true,
      responseBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      usesAuditRowsOnly: true,
    },
  };
}

function buildNextAction(row) {
  const target = readString(row.target, readString(row.filenameTarget, "unknown-target"));
  const blockedReasons = readStringArray(row.blockedReasons);

  return {
    target,
    evidenceFileName: safeBasename(row.file),
    acceptanceStatus: readString(row.acceptanceStatus, "unknown"),
    current: {
      mode: readString(row.mode, "missing"),
      expectedMode: readString(row.expectedMode, expectedModeForTarget(target)),
      environment: readString(row.environment, "missing"),
      status: readString(row.status, "missing"),
      expectedStatus: readString(row.expectedStatus, expectedStatusForTarget(target)),
    },
    releaseRunIdStatus: readString(row.releaseRunIdStatus, "missing"),
    safetyStatus: readString(row.safetyStatus, "missing"),
    targetResultStatus: readString(row.targetResultStatus, "missing"),
    targetContractStatus: readString(row.targetContractStatus, "not-required"),
    blockedReasons,
    missingResultKeyCount: readStringArray(row.missingResultKeys).length,
    nextAction: nextActionForTarget({ target, blockedReasons }),
    responsibleSessions: responsibleSessionByTarget[target] ?? ["S22"],
  };
}

function nextActionForTarget({ target, blockedReasons }) {
  if (target === "ppt-manual-playback-acceptance") {
    return "Collect S24 human PowerPoint/WPS playback acceptance after production deployment, bound to the shared release-run ID.";
  }

  if (
    target === "teaching-operations-route-smoke" ||
    target === "teaching-operation-detail-browser-smoke" ||
    target === "teaching-course-management-route-smoke" ||
    target === "external-storage-smoke"
  ) {
    return "Run owner-approved production live smoke on the shared release-run ID with body-level result proof.";
  }

  if (blockedReasons.includes("release-run-missing")) {
    return "Rerun this production live evidence on the shared release-run ID with body-level result proof.";
  }

  return "Run owner-approved production live evidence for this target with body-level result proof.";
}

function buildCategories(rows) {
  return {
    ownerApprovedLiveRunRequired: targetsWithAny(rows, [
      "mode-not-live",
      "mode-not-record",
    ]).filter((target) => target !== "ppt-manual-playback-acceptance"),
    sharedReleaseRunRequired: targetsWithAny(rows, ["release-run-missing"]),
    targetResultProofRequired: targetsWithAny(rows, ["target-result-proof-missing"]),
    targetContractProofRequired: uniqueTargets([
      ...targetsWithAny(rows, ["target-contract-proof-missing"]),
      ...rows
        .filter((row) => readString(row.targetContractStatus, "not-required") === "missing")
        .map((row) => readString(row.target, readString(row.filenameTarget, "unknown-target"))),
    ]),
    safetyProofRequired: targetsWithAny(rows, ["safety-not-proven"]),
    manualHumanQaRequired: rows
      .filter((row) => readString(row.target, "") === "ppt-manual-playback-acceptance")
      .map((row) => readString(row.target, "ppt-manual-playback-acceptance")),
  };
}

function buildExecutionWaves(nextActions) {
  const actionByTarget = new Map(nextActions.map((action) => [action.target, action]));
  const coveredTargets = new Set();
  const waves = executionWaveDefinitions
    .map((definition) => {
      const targets = definition.targets
        .filter((target) => actionByTarget.has(target))
        .map((target) => {
          coveredTargets.add(target);
          return summarizeActionForWave(actionByTarget.get(target));
        });

      return {
        id: definition.id,
        label: definition.label,
        gate: definition.gate,
        stopCondition: definition.stopCondition,
        targetCount: targets.length,
        targets,
      };
    })
    .filter((wave) => wave.targetCount > 0);

  const unmappedTargets = nextActions
    .filter((action) => !coveredTargets.has(action.target))
    .map((action) => summarizeActionForWave(action));

  if (unmappedTargets.length > 0) {
    waves.push({
      id: "unmapped-evidence-targets",
      label: "Unmapped evidence targets",
      gate: "S22 reviews evidence targets that are not assigned to a known execution wave.",
      stopCondition: "Stop and update the triage wave map before running or accepting these targets.",
      targetCount: unmappedTargets.length,
      targets: unmappedTargets,
    });
  }

  return waves;
}

function summarizeActionForWave(action) {
  return {
    target: action.target,
    acceptanceStatus: action.acceptanceStatus,
    current: action.current,
    releaseRunIdStatus: action.releaseRunIdStatus,
    targetResultStatus: action.targetResultStatus,
    targetContractStatus: action.targetContractStatus,
    safetyStatus: action.safetyStatus,
    topBlockers: action.blockedReasons.slice(0, 3),
    responsibleSessions: action.responsibleSessions,
    nextAction: action.nextAction,
  };
}

function targetsWithAny(rows, reasons) {
  const reasonSet = new Set(reasons);
  return rows
    .filter((row) => readStringArray(row.blockedReasons).some((reason) => reasonSet.has(reason)))
    .map((row) => readString(row.target, readString(row.filenameTarget, "unknown-target")));
}

function uniqueTargets(targets) {
  return [...new Set(targets)];
}

function countBlockers(rows) {
  const counts = {};
  for (const row of rows) {
    for (const reason of readStringArray(row.blockedReasons)) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return counts;
}

function renderMarkdown(triage) {
  const lines = [
    "# UAIS Enterprise Live Evidence Triage",
    "",
    `Status: \`${triage.status}\``,
    `Release gate: \`${triage.releaseGateStatus}\``,
    `Accepted targets: ${triage.summary.acceptedTargets} / ${triage.summary.totalTargets}`,
    `Missing required targets: ${triage.summary.missingRequiredTargets}`,
    `Release-run consistency: \`${triage.summary.releaseRunIdConsistency}\``,
    "",
    "## Blocker Counts",
    "",
    "| Blocker | Count |",
    "| --- | ---: |",
    ...Object.entries(triage.blockerCounts).map(([reason, count]) => `| \`${reason}\` | ${count} |`),
    "",
    "## Execution Waves",
    "",
    ...renderExecutionWaves(triage.executionWaves),
    "",
    "## Category Queues",
    "",
    ...renderCategoryQueue("Owner-approved live run required", triage.categories.ownerApprovedLiveRunRequired),
    "",
    ...renderCategoryQueue("Shared release-run required", triage.categories.sharedReleaseRunRequired),
    "",
    ...renderCategoryQueue("Target result proof required", triage.categories.targetResultProofRequired),
    "",
    ...renderCategoryQueue("Target contract proof required", triage.categories.targetContractProofRequired),
    "",
    ...renderCategoryQueue("Safety proof required", triage.categories.safetyProofRequired),
    "",
    ...renderCategoryQueue("Manual human QA required", triage.categories.manualHumanQaRequired),
    "",
    "## Target Queue",
    "",
    "| Target | Current | Release Run | Result | Contract | Top Blockers | Next Action |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...triage.nextActions.map((action) =>
      [
        `| \`${action.target}\``,
        `| \`${action.current.mode}/${action.current.status}\``,
        `| \`${action.releaseRunIdStatus}\``,
        `| \`${action.targetResultStatus}\``,
        `| \`${action.targetContractStatus}\``,
        `| ${action.blockedReasons.slice(0, 3).map((reason) => `\`${reason}\``).join(", ")}`,
        `| ${action.nextAction} |`,
      ].join(" "),
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function renderExecutionWaves(waves) {
  if (waves.length === 0) {
    return ["No execution waves contain current targets."];
  }

  return waves.flatMap((wave) => [
    `### ${wave.label}`,
    "",
    `Wave ID: \`${wave.id}\``,
    `Gate: ${wave.gate}`,
    `Stop condition: ${wave.stopCondition}`,
    `Targets (${wave.targetCount}):`,
    ...wave.targets.map(
      (target) =>
        `- \`${target.target}\`: blockers ${formatInlineList(target.topBlockers)}; next ${target.nextAction}`,
    ),
    "",
  ]);
}

function renderCategoryQueue(label, targets) {
  return [
    `${label}:`,
    ...(targets.length > 0 ? targets.map((target) => `- \`${target}\``) : ["- `none-recorded`"]),
  ];
}

function formatInlineList(items) {
  return items.length > 0 ? items.map((item) => `\`${item}\``).join(", ") : "`none-recorded`";
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

function safeBasename(value) {
  return typeof value === "string" && value.length > 0 ? basename(value) : null;
}

function expectedModeForTarget(target) {
  return target === "ppt-manual-playback-acceptance" ? "record" : "live";
}

function expectedStatusForTarget(target) {
  if (
    target === "app-auth-provider-readiness" ||
    target === "teacher-auth-provider-readiness" ||
    target === "external-storage-service-readiness"
  ) {
    return "ready";
  }
  if (target === "deployment-domain-reachability") {
    return "reachable";
  }
  if (target === "ppt-manual-playback-acceptance") {
    return "accepted";
  }
  return "passed";
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
