#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const releaseGate = readJsonArg(args, "release-gate");
  const enterpriseAudit = readJsonArg(args, "enterprise-live-evidence-audit");
  const report = buildIndex({
    ownerDecisionQueue,
    releaseGate,
    enterpriseAudit,
    reportsDir: args["reports-dir"],
    date: args.date,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(report));
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildIndex({ ownerDecisionQueue, releaseGate, enterpriseAudit, reportsDir, date }) {
  const queue = readRecordArray(ownerDecisionQueue.queue);
  const packetEntries = readActionPacketEntries({ reportsDir, date });
  const packetByDecisionId = new Map(
    packetEntries.map((entry) => [entry.packet.decisionId, entry]),
  );
  const queueDecisionIds = new Set(queue.map((item) => item.id).filter(Boolean));
  const packets = queue.map((item) => buildPacketIndexItem(item, packetByDecisionId));
  const missingPacketDecisionIds = packets
    .filter((item) => item.actionPacketFileName === null)
    .map((item) => item.decisionId);
  const extraPacketDecisionIds = packetEntries
    .map((entry) => entry.packet.decisionId)
    .filter((decisionId) => typeof decisionId === "string" && !queueDecisionIds.has(decisionId))
    .sort();
  const packetSafetyAttentionCount = packets.filter(
    (packet) => packet.safetyAttention.length > 0,
  ).length;
  const acceptedLiveEvidence = readSafeNumber(enterpriseAudit.summary?.acceptedLiveEvidence);
  const missingEnterpriseLiveTargetCount = readSafeNumber(
    enterpriseAudit.summary?.missingRequiredTargetCount,
  );
  const ownerDecisionQueueStatus = readString(ownerDecisionQueue.status, "unknown");
  const status =
    missingPacketDecisionIds.length > 0 || extraPacketDecisionIds.length > 0
      ? "incomplete-action-packet-chain"
      : packetSafetyAttentionCount > 0
        ? "action-packet-chain-needs-safety-review"
        : "complete-action-packet-chain";
  const releaseReady =
    (releaseGate.status === "ready" || releaseGate.status === "passed") &&
    status === "complete-action-packet-chain" &&
    packetSafetyAttentionCount === 0 &&
    acceptedLiveEvidence > 0 &&
    missingEnterpriseLiveTargetCount === 0 &&
    isReadyLikeStatus(ownerDecisionQueueStatus);

  return {
    target: "owner-decision-action-packet-index",
    status,
    releaseGateStatus: readString(releaseGate.status, readString(ownerDecisionQueue.releaseGateStatus, "unknown")),
    ownerDecisionQueueStatus,
    responsibleSession: "S22",
    generatedForDate: readString(date, "unknown-date"),
    summary: {
      queueItemCount: queue.length,
      actionPacketCount: packetEntries.length,
      matchedPacketCount: packets.length - missingPacketDecisionIds.length,
      missingPacketCount: missingPacketDecisionIds.length,
      extraPacketCount: extraPacketDecisionIds.length,
      packetSafetyAttentionCount,
      acceptedLiveEvidence,
      missingEnterpriseLiveTargetCount,
      releaseReady,
    },
    missingPacketDecisionIds,
    extraPacketDecisionIds,
    packets,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      releaseGateStillBlocked: releaseGate.status === "blocked",
    },
  };
}

function readActionPacketEntries({ reportsDir, date }) {
  if (!reportsDir) {
    throw new Error("Missing required --reports-dir");
  }
  if (!date) {
    throw new Error("Missing required --date");
  }

  return readdirSync(reportsDir)
    .filter(
      (fileName) =>
        fileName.startsWith(`${date}-`) &&
        fileName.endsWith("-action-packet-enterprise-runthrough.json"),
    )
    .sort()
    .map((fileName) => {
      const packet = JSON.parse(readFileSync(join(reportsDir, fileName), "utf8"));
      const markdownFileName = fileName.replace(/\.json$/, ".md");
      return {
        fileName,
        markdownFileName: existsSync(join(reportsDir, markdownFileName))
          ? markdownFileName
          : null,
        packet,
      };
    })
    .filter((entry) => typeof entry.packet.decisionId === "string");
}

function buildPacketIndexItem(queueItem, packetByDecisionId) {
  const decisionId = readString(queueItem.id, "unknown-decision");
  const entry = packetByDecisionId.get(decisionId);
  const packet = entry?.packet;
  const safety = buildPacketSafety(packet);

  return {
    rank: Number.isInteger(queueItem.rank) ? queueItem.rank : null,
    decisionId,
    category: readString(queueItem.category, "unknown-category"),
    queueStatus: readString(queueItem.status, "unknown"),
    packetStatus: readString(packet?.status, "missing"),
    releaseGateStatus: readString(packet?.releaseGateStatus, "missing"),
    classification: readString(packet?.classification, "missing"),
    actionPacketFileName: entry ? basename(entry.fileName) : null,
    markdownPacketFileName: entry?.markdownFileName ? basename(entry.markdownFileName) : null,
    nextOwnerQuestion: readString(queueItem.nextOwnerQuestion, ""),
    blockedReasons: readStringArray(queueItem.blockedReasons),
    releaseGateRequirementIds: readStringArray(queueItem.releaseGateRequirementIds),
    enterpriseAuditMissingTargets: readStringArray(queueItem.enterpriseAuditMissingTargets),
    safety: safety.flags,
    safetyAttention: safety.attention,
  };
}

function buildPacketSafety(packet) {
  const safety = isRecord(packet?.safety) ? packet.safety : {};
  const hasRawUrlField = packetHasMatchingField(packet, isRawUrlField);
  const hasResponseBodyField = packetHasMatchingField(packet, isResponseBodyField);
  const flags = {
    sourcePathsOmitted: readSafetyFlag(safety, "sourcePathsOmitted"),
    rawUrlsOmitted: hasRawUrlField
      ? readSafetyFlag(safety, "rawUrlsOmitted") ||
        readSafetyFlag(safety, "audioUrlsOmitted") ||
        readSafetyFlag(safety, "endpointValuesOmitted")
      : true,
    secretValuesOmitted: packetHasMatchingField(packet, isSecretValueField)
      ? readSafetyFlag(safety, "secretValuesOmitted") ||
        readSafetyFlag(safety, "valuesRedacted") ||
        readSafetyFlag(safety, "envValuesOmitted")
      : true,
    responseBodiesOmitted: hasResponseBodyField
      ? readSafetyFlag(safety, "responseBodiesOmitted")
      : true,
  };
  const attention = [];
  if (!flags.sourcePathsOmitted) {
    attention.push("source-path-field-without-omission-flag");
  }
  if (!flags.rawUrlsOmitted) {
    attention.push("raw-url-field-without-omission-flag");
  }
  if (!flags.secretValuesOmitted) {
    attention.push("secret-value-field-without-redaction-flag");
  }
  if (!flags.responseBodiesOmitted) {
    attention.push("response-body-field-without-omission-flag");
  }
  return { flags, attention };
}

function renderMarkdown(report) {
  const lines = [
    "# UAIS Owner Decision Action Packet Index",
    "",
    `Status: \`${report.status}\``,
    `Release gate: \`${report.releaseGateStatus}\``,
    `Owner queue: \`${report.ownerDecisionQueueStatus}\``,
    `Action packet chain: ${report.summary.matchedPacketCount} / ${report.summary.queueItemCount}`,
    `Accepted live evidence: ${report.summary.acceptedLiveEvidence}`,
    `Missing enterprise live targets: ${report.summary.missingEnterpriseLiveTargetCount}`,
    "",
    "This index is not release-ready evidence while the release gate is blocked.",
    "",
    "| Rank | Decision | Category | Queue status | Packet status | Packet |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.packets.map((packet) =>
      [
        "|",
        packet.rank ?? "",
        `| \`${packet.decisionId}\``,
        `| ${packet.category}`,
        `| ${packet.queueStatus}`,
        `| ${packet.packetStatus}`,
        `| ${packet.actionPacketFileName ?? "missing"} |`,
      ].join(" "),
    ),
    "",
    `Missing packet decisions: ${formatInlineList(report.missingPacketDecisionIds)}`,
    `Extra packet decisions: ${formatInlineList(report.extraPacketDecisionIds)}`,
  ];
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

function readSafeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function readSafetyFlag(safety, key) {
  return isRecord(safety) && safety[key] === true;
}

function packetHasMatchingField(value, matchesKey) {
  if (Array.isArray(value)) {
    return value.some((item) => packetHasMatchingField(item, matchesKey));
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(
    ([key, item]) => key !== "safety" && (matchesKey(key) || packetHasMatchingField(item, matchesKey)),
  );
}

function isRawUrlField(key) {
  return /(?:^|[A-Z_-])(?:rawUrl|url|urls|endpointUrl|endpointUrls|baseUrl|deploymentUrl|deploymentBaseUrl)$/i.test(key);
}

function isResponseBodyField(key) {
  return /(?:responseBody|rawResponse|bodyText|bodyJson)/i.test(key);
}

function isSecretValueField(key) {
  return /(?:secret|token|credential|cookie|password).*(?:value|body|raw|content|assignment)|(?:raw|plain).*(?:secret|token|credential|cookie|password)/i.test(
    key,
  );
}

function formatInlineList(values) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "`none-recorded`";
}

function isReadyLikeStatus(status) {
  return [
    "ready",
    "passed",
    "complete",
    "completed",
    "accepted",
    "no-owner-decisions-required",
    "owner-decisions-complete",
  ].includes(readString(status, "unknown"));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
