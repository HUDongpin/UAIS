#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packetIndex = readJsonArg(args, "packet-index");
  const manifest = buildManifest({
    packetIndex,
    packetIndexPath: args["packet-index"],
    reportsDir: args["reports-dir"],
    includes: args.include,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(manifest));
    return;
  }

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

function buildManifest({ packetIndex, packetIndexPath, reportsDir, includes }) {
  if (!reportsDir) {
    throw new Error("Missing required --reports-dir");
  }

  const artifacts = [];
  const missingArtifacts = [];
  const packetIndexFileName = basename(packetIndexPath);
  addArtifact({
    artifacts,
    missingArtifacts,
    role: "packet-index-json",
    filePath: packetIndexPath,
  });

  const packetIndexMarkdown = packetIndexFileName.replace(/\.json$/, ".md");
  const packetIndexMarkdownPath = join(reportsDir, packetIndexMarkdown);
  if (existsSync(packetIndexMarkdownPath)) {
    addArtifact({
      artifacts,
      missingArtifacts,
      role: "packet-index-markdown",
      filePath: packetIndexMarkdownPath,
    });
  }

  for (const packet of readRecordArray(packetIndex.packets)) {
    if (typeof packet.actionPacketFileName === "string") {
      addArtifact({
        artifacts,
        missingArtifacts,
        role: "action-packet-json",
        filePath: join(reportsDir, packet.actionPacketFileName),
        decisionId: readString(packet.decisionId, "unknown-decision"),
        rank: Number.isInteger(packet.rank) ? packet.rank : null,
      });
    }
    if (typeof packet.markdownPacketFileName === "string") {
      addArtifact({
        artifacts,
        missingArtifacts,
        role: "action-packet-markdown",
        filePath: join(reportsDir, packet.markdownPacketFileName),
        decisionId: readString(packet.decisionId, "unknown-decision"),
        rank: Number.isInteger(packet.rank) ? packet.rank : null,
      });
    }
  }

  for (const includePath of includes) {
    addArtifact({
      artifacts,
      missingArtifacts,
      role: "release-intake-include",
      filePath: includePath,
    });
  }
  const packetSafetyAttentionCount = readNumber(
    packetIndex.summary?.packetSafetyAttentionCount,
  );
  const packetIndexStatus = readString(packetIndex.status, "unknown");
  const ownerDecisionQueueStatus = readString(packetIndex.ownerDecisionQueueStatus, "unknown");
  const status =
    missingArtifacts.length > 0
      ? "manifest-incomplete"
      : packetSafetyAttentionCount > 0 ||
          packetIndexStatus === "action-packet-chain-needs-safety-review"
        ? "manifest-needs-safety-review"
        : "manifest-created";
  const releaseReady =
    packetIndex.summary?.releaseReady === true &&
    status === "manifest-created" &&
    missingArtifacts.length === 0 &&
    packetSafetyAttentionCount === 0 &&
    isReadyLikeStatus(ownerDecisionQueueStatus);

  return {
    target: "owner-decision-package-manifest",
    status,
    releaseGateStatus: readString(packetIndex.releaseGateStatus, "unknown"),
    ownerDecisionQueueStatus,
    packetIndexStatus,
    sourceIndexFileName: packetIndexFileName,
    summary: {
      queueItemCount: readNumber(packetIndex.summary?.queueItemCount),
      indexedPacketCount: readRecordArray(packetIndex.packets).length,
      artifactCount: artifacts.length,
      missingArtifactCount: missingArtifacts.length,
      includedArtifactCount: includes.length,
      packetSafetyAttentionCount,
      releaseReady,
    },
    artifacts,
    missingArtifacts,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: true,
      fileContentsOmitted: true,
    },
  };
}

function addArtifact({ artifacts, missingArtifacts, role, filePath, decisionId, rank }) {
  const fileName = basename(filePath);
  if (!existsSync(filePath)) {
    missingArtifacts.push({
      role,
      ...(decisionId ? { decisionId } : {}),
      ...(rank !== undefined ? { rank } : {}),
      fileName,
    });
    return;
  }

  const buffer = readFileSync(filePath);
  const stat = statSync(filePath);
  artifacts.push({
    role,
    ...(decisionId ? { decisionId } : {}),
    ...(rank !== undefined ? { rank } : {}),
    fileName,
    byteLength: stat.size,
    sha256: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
  });
}

function renderMarkdown(manifest) {
  const lines = [
    "# UAIS Owner Decision Package Manifest",
    "",
    `Status: \`${manifest.status}\``,
    `Release gate: \`${manifest.releaseGateStatus}\``,
    `Owner queue: \`${manifest.ownerDecisionQueueStatus}\``,
    `Source index: \`${manifest.sourceIndexFileName}\``,
    `Release ready: \`${manifest.summary.releaseReady}\``,
    `Artifacts fingerprinted: ${manifest.summary.artifactCount}`,
    `Missing artifacts: ${manifest.summary.missingArtifactCount}`,
    "",
    "| Role | Decision | File | Bytes | SHA-256 |",
    "| --- | --- | --- | ---: | --- |",
    ...manifest.artifacts.map((artifact) =>
      [
        "|",
        artifact.role,
        `| ${artifact.decisionId ? `\`${artifact.decisionId}\`` : "`package`"}`,
        `| ${artifact.fileName}`,
        `| ${artifact.byteLength}`,
        `| \`${artifact.sha256}\` |`,
      ].join(" "),
    ),
  ];

  if (manifest.missingArtifacts.length > 0) {
    lines.push("", "## Missing Artifacts", "");
    lines.push(
      ...manifest.missingArtifacts.map(
        (artifact) =>
          `- \`${artifact.role}\` ${artifact.decisionId ? `for \`${artifact.decisionId}\` ` : ""}(${artifact.fileName})`,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { format: "json", include: [] };
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
    if (key === "include") {
      args.include.push(value);
    } else {
      args[key] = value;
    }
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

function readNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
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
