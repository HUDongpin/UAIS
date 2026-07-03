#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const decisionSlugById = new Map([
  ["app-auth-provider-production-selector", "app-auth"],
  ["teacher-auth-provider-production-selector", "teacher-auth"],
  ["external-storage-production-service", "external-storage"],
  ["vercel-env-deploy-and-smoke-chain", "vercel-env-deploy"],
  ["ordinary-teaching-production-evidence", "ordinary-teaching-production-evidence"],
  ["manual-ppt-playback-acceptance", "manual-ppt-playback-acceptance"],
  ["enterprise-live-evidence-audit", "enterprise-live-evidence-audit"],
  ["production-release-run", "production-release-run"],
]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerDecisionQueue = readJsonArg(args, "owner-decision-queue");
  const reportsDir = args["reports-dir"];
  if (!reportsDir) {
    throw new Error("Missing required --reports-dir");
  }

  const manifest = buildManifest({
    ownerDecisionQueue,
    ownerDecisionQueuePath: args["owner-decision-queue"],
    reportsDir,
  });

  if (args.format === "markdown") {
    process.stdout.write(renderMarkdown(manifest));
    return;
  }

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

function buildManifest({ ownerDecisionQueue, ownerDecisionQueuePath, reportsDir }) {
  const artifacts = [];
  const missingArtifacts = [];
  const reportFileNames = new Set(readdirSync(reportsDir));
  const queueFileName = basename(ownerDecisionQueuePath);
  const queue = readRecordArray(ownerDecisionQueue.queue)
    .map((item) => ({
      rank: Number.isInteger(item.rank) ? item.rank : null,
      decisionId: readString(item.id, "unknown-decision"),
      queueStatus: readString(item.status, "unknown"),
      category: readString(item.category, "unknown"),
    }))
    .sort((a, b) => readRank(a.rank) - readRank(b.rank));

  addArtifact({
    artifacts,
    missingArtifacts,
    role: "owner-decision-queue-json",
    filePath: ownerDecisionQueuePath,
  });
  const queueMarkdownPath = join(reportsDir, queueFileName.replace(/\.json$/, ".md"));
  if (existsSync(queueMarkdownPath)) {
    addArtifact({
      artifacts,
      missingArtifacts,
      role: "owner-decision-queue-markdown",
      filePath: queueMarkdownPath,
    });
  }

  const responsePackages = queue.map((queueItem) => {
    const slug = decisionSlugById.get(queueItem.decisionId) ?? queueItem.decisionId;
    const templateJson = findReportFile(reportFileNames, slug, "response-template", ".json");
    const templateMarkdown = findReportFile(reportFileNames, slug, "response-template", ".md");
    const validationJson = findReportFile(reportFileNames, slug, "response-validation", ".json");
    const validationMarkdown = findReportFile(reportFileNames, slug, "response-validation", ".md");
    const templateReport = templateJson ? readJsonFile(join(reportsDir, templateJson)) : {};
    const validationReport = validationJson ? readJsonFile(join(reportsDir, validationJson)) : {};

    addResponseArtifact({
      artifacts,
      missingArtifacts,
      reportsDir,
      fileName: templateJson,
      role: "response-template-json",
      decisionId: queueItem.decisionId,
      rank: queueItem.rank,
      expectedFileName: `owner-decision-${slug}-response-template`,
    });
    addResponseArtifact({
      artifacts,
      missingArtifacts,
      reportsDir,
      fileName: templateMarkdown,
      role: "response-template-markdown",
      decisionId: queueItem.decisionId,
      rank: queueItem.rank,
      expectedFileName: `owner-decision-${slug}-response-template`,
      optional: true,
    });
    addResponseArtifact({
      artifacts,
      missingArtifacts,
      reportsDir,
      fileName: validationJson,
      role: "response-validation-json",
      decisionId: queueItem.decisionId,
      rank: queueItem.rank,
      expectedFileName: `owner-decision-${slug}-response-validation`,
    });
    addResponseArtifact({
      artifacts,
      missingArtifacts,
      reportsDir,
      fileName: validationMarkdown,
      role: "response-validation-markdown",
      decisionId: queueItem.decisionId,
      rank: queueItem.rank,
      expectedFileName: `owner-decision-${slug}-response-validation`,
      optional: true,
    });

    return {
      rank: queueItem.rank,
      decisionId: queueItem.decisionId,
      category: queueItem.category,
      queueStatus: queueItem.queueStatus,
      templateStatus: readString(templateReport.status, templateJson ? "unknown" : "missing"),
      validationStatus: readString(
        validationReport.status,
        validationJson ? "unknown" : "missing",
      ),
      templateFileName: templateJson,
      validationFileName: validationJson,
      templateMarkdownFileName: templateMarkdown,
      validationMarkdownFileName: validationMarkdown,
      missingFieldCount: readNumber(validationReport.summary?.missingFieldCount),
      unsafeFindingCount: readNumber(validationReport.summary?.unsafeFindingCount),
      releaseRunBindingPerformed: validationReport.summary?.releaseRunBindingPerformed === true,
      releaseReady:
        readString(validationReport.status, validationJson ? "unknown" : "missing") ===
          "owner-response-accepted" &&
        templateReport.summary?.releaseReady === true &&
        validationReport.summary?.releaseReady === true,
    };
  });

  const templateReportCount = responsePackages.filter((item) => item.templateFileName).length;
  const validationReportCount = responsePackages.filter((item) => item.validationFileName).length;
  const markdownReportCount = responsePackages.filter((item) => item.templateMarkdownFileName).length +
    responsePackages.filter((item) => item.validationMarkdownFileName).length +
    (existsSync(queueMarkdownPath) ? 1 : 0);
  const incompleteValidationCount = responsePackages.filter(
    (item) => item.validationStatus !== "owner-response-accepted",
  ).length;
  const unsafeFindingTotal = responsePackages.reduce(
    (total, item) => total + readNumber(item.unsafeFindingCount),
    0,
  );
  const releaseRunBindingPerformedCount = responsePackages.filter(
    (item) => item.releaseRunBindingPerformed,
  ).length;
  const safetyAttentionCount = unsafeFindingTotal + releaseRunBindingPerformedCount;
  const ownerDecisionQueueStatus = readString(ownerDecisionQueue.status, "unknown");
  const releaseReady =
    responsePackages.length > 0 &&
    missingArtifacts.length === 0 &&
    incompleteValidationCount === 0 &&
    safetyAttentionCount === 0 &&
    responsePackages.every((item) => item.releaseReady) &&
    isReadyLikeStatus(ownerDecisionQueueStatus);

  return {
    target: "owner-decision-response-package-manifest",
    status:
      missingArtifacts.length > 0
        ? "response-package-manifest-incomplete"
        : safetyAttentionCount > 0
          ? "response-package-manifest-needs-safety-review"
          : "response-package-manifest-created",
    releaseReady,
    releaseGateStatus: readString(ownerDecisionQueue.releaseGateStatus, "blocked"),
    ownerDecisionQueueStatus,
    sourceQueueFileName: queueFileName,
    summary: {
      queueItemCount: queue.length,
      responsePackageCount: responsePackages.length,
      templateReportCount,
      validationReportCount,
      markdownReportCount,
      artifactCount: artifacts.length,
      missingArtifactCount: missingArtifacts.length,
      incompleteValidationCount,
      unsafeFindingTotal,
      releaseRunBindingPerformedCount,
      safetyAttentionCount,
      releaseReady,
    },
    responsePackages,
    artifacts,
    missingArtifacts,
    safety: {
      sourcePathsOmitted: true,
      rawUrlsOmitted: true,
      secretValuesOmitted: true,
      responseBodiesOmitted: true,
      noLiveMutationPerformed: true,
      noDeploymentMutationPerformed: true,
      noReleaseRunBindingPerformed: releaseRunBindingPerformedCount === 0,
      fileContentsOmitted: true,
    },
  };
}

function findReportFile(reportFileNames, slug, kind, extension) {
  const matches = [...reportFileNames]
    .filter(
      (fileName) =>
        fileName.includes(`owner-decision-${slug}-${kind}`) &&
        fileName.endsWith(extension),
    )
    .sort();
  return matches.at(-1) ?? null;
}

function addResponseArtifact({
  artifacts,
  missingArtifacts,
  reportsDir,
  fileName,
  role,
  decisionId,
  rank,
  expectedFileName,
  optional = false,
}) {
  if (!fileName) {
    if (!optional) {
      missingArtifacts.push({
        role,
        decisionId,
        rank,
        fileName: `${expectedFileName}*.json`,
      });
    }
    return;
  }

  addArtifact({
    artifacts,
    missingArtifacts,
    role,
    filePath: join(reportsDir, fileName),
    decisionId,
    rank,
  });
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
    "# UAIS Owner Decision Response Package Manifest",
    "",
    `Status: \`${manifest.status}\``,
    `Release gate: \`${manifest.releaseGateStatus}\``,
    `Owner queue: \`${manifest.ownerDecisionQueueStatus}\``,
    `Source queue: \`${manifest.sourceQueueFileName}\``,
    `Release ready: \`${manifest.summary.releaseReady}\``,
    `Response packages: ${manifest.summary.responsePackageCount}`,
    `Artifacts fingerprinted: ${manifest.summary.artifactCount}`,
    `Missing artifacts: ${manifest.summary.missingArtifactCount}`,
    `Safety attention: ${manifest.summary.safetyAttentionCount}`,
    "",
    "## Response Packages",
    "",
    "| Rank | Decision | Queue status | Template | Validation | Missing fields | Unsafe findings |",
    "| ---: | --- | --- | --- | --- | ---: | ---: |",
    ...manifest.responsePackages.map((item) =>
      [
        `| \`${item.rank ?? "?"}\``,
        `| \`${item.decisionId}\``,
        `| \`${item.queueStatus}\``,
        `| \`${item.templateStatus}\``,
        `| \`${item.validationStatus}\``,
        `| ${item.missingFieldCount}`,
        `| ${item.unsafeFindingCount} |`,
      ].join(" "),
    ),
    "",
    "## Artifact Fingerprints",
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

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function readRank(value) {
  return Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER;
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

function readRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => isRecord(item)) : [];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
