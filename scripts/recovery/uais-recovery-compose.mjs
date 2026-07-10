#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_NAMES = ["R1", "R2", "R3", "R4", "R5"];
const Q0_PATH = "docs/technical-advisory/.Rhistory";

export function createStatusFingerprint(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function validateRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || isAbsolute(value)) {
    throw new Error("invalid relative path: " + String(value));
  }
  const normalized = normalize(value).replaceAll("\\", "/");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("path escapes recovery root: " + value);
  }
  return normalized;
}

export function parsePorcelainV1Z(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean).map((record) => {
    const status = record.slice(0, 2);
    const path = validateRelativePath(record.slice(3));
    if (status.includes("R") || path.includes(" -> ")) {
      throw new Error("rename not supported: " + path);
    }
    const staged = status !== "??" && status[0] !== " ";
    if (staged) throw new Error("staged path not allowed: " + path);
    if (!["??", " M", " D"].includes(status)) {
      throw new Error("unsupported status " + status + ": " + path);
    }
    return { status, path, staged };
  });
}

export function validateDispositionConfig(config) {
  if (config?.version !== 1 || typeof config.packages !== "object") {
    throw new Error("invalid recovery disposition config");
  }
  const seen = new Set();
  let commitCandidateCount = 0;
  for (const packageName of PACKAGE_NAMES) {
    const paths = config.packages[packageName];
    if (!Array.isArray(paths)) throw new Error("missing package " + packageName);
    commitCandidateCount += paths.length;
    for (const rawPath of paths) {
      const path = validateRelativePath(rawPath);
      if (seen.has(path)) throw new Error("duplicate recovery path: " + path);
      seen.add(path);
    }
  }
  const quarantine = config.quarantine ?? [];
  for (const entry of quarantine) {
    const path = validateRelativePath(entry.path);
    if (seen.has(path)) throw new Error("duplicate quarantine path: " + path);
    if (entry.disposition !== "Q0") throw new Error("unsupported quarantine disposition");
    seen.add(path);
  }
  if (seen.size !== 116 || commitCandidateCount !== 115 || quarantine.length !== 1) {
    throw new Error("expected 115 commit candidates and one quarantine path");
  }
  return { commitCandidateCount, quarantineCount: quarantine.length };
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const value = tokens[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("invalid CLI arguments");
    options[flag.slice(2)] = value;
  }
  return { command, options };
}

function requireOption(options, name) {
  const value = options[name];
  if (!value) throw new Error("missing --" + name);
  return resolve(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function readStatusBuffer(source) {
  return execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: source,
  });
}

function readGitText(source, args) {
  return execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim();
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertCandidateFile(source, path) {
  const absolutePath = join(source, path);
  if (!existsSync(absolutePath)) throw new Error("candidate missing: " + path);
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("candidate must be regular file: " + path);
  }
  const ignored = spawnSync("git", ["check-ignore", "-q", "--", path], { cwd: source });
  if (ignored.status === 0) throw new Error("candidate is ignored: " + path);
  return { absolutePath, stat };
}

function flattenPackages(config) {
  return PACKAGE_NAMES.flatMap((packageName) =>
    config.packages[packageName].map((path) => ({ path, package: packageName })),
  );
}

function assertExactStatusSet(statusEntries, config) {
  const statusPaths = statusEntries.map((entry) => entry.path).sort();
  const dispositionPaths = [
    ...flattenPackages(config).map((entry) => entry.path),
    ...config.quarantine.map((entry) => entry.path),
  ].sort();
  if (JSON.stringify(statusPaths) !== JSON.stringify(dispositionPaths)) {
    const statusSet = new Set(statusPaths);
    const dispositionSet = new Set(dispositionPaths);
    const missingDisposition = statusPaths.filter((path) => !dispositionSet.has(path));
    const absentFromStatus = dispositionPaths.filter((path) => !statusSet.has(path));
    throw new Error(JSON.stringify({ missingDisposition, absentFromStatus }));
  }
}

function loadValidatedConfig(path) {
  const config = readJson(path);
  validateDispositionConfig(config);
  if (
    config.quarantine[0].path !== Q0_PATH ||
    config.quarantine[0].contentInspected !== false
  ) {
    throw new Error("invalid Q0 contract");
  }
  return config;
}

function buildCandidateEntries(source, statusEntries, config) {
  const statusByPath = new Map(statusEntries.map((entry) => [entry.path, entry]));
  return flattenPackages(config)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, package: packageName }) => {
      const { absolutePath, stat } = assertCandidateFile(source, path);
      return {
        path,
        package: packageName,
        status: statusByPath.get(path).status,
        size: stat.size,
        sha256: hashFile(absolutePath),
      };
    });
}

function assertCounts(statusEntries) {
  const trackedModified = statusEntries.filter((entry) => entry.status === " M").length;
  const untracked = statusEntries.filter((entry) => entry.status === "??").length;
  const staged = statusEntries.filter((entry) => entry.staged).length;
  if (trackedModified !== 44 || untracked !== 72 || staged !== 0) {
    throw new Error(JSON.stringify({ trackedModified, untracked, staged }));
  }
  return { trackedModified, untracked, staged };
}

function copyCandidate(source, destinationRoot, entry) {
  const { absolutePath } = assertCandidateFile(source, entry.path);
  if (hashFile(absolutePath) !== entry.sha256) {
    throw new Error("source hash drift: " + entry.path);
  }
  const destination = join(destinationRoot, entry.path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(absolutePath, destination);
  if (hashFile(destination) !== entry.sha256) {
    throw new Error("destination hash mismatch: " + entry.path);
  }
}

function checkSource(source, manifest) {
  const rawStatus = readStatusBuffer(source);
  const fingerprint = createStatusFingerprint(rawStatus);
  if (fingerprint !== manifest.source.statusFingerprint) {
    throw new Error("source status fingerprint drift");
  }
  for (const entry of manifest.entries) {
    const { absolutePath } = assertCandidateFile(source, entry.path);
    if (hashFile(absolutePath) !== entry.sha256) {
      throw new Error("source hash drift: " + entry.path);
    }
  }
  return { status: "passed", fingerprint, checked: manifest.entries.length };
}

function snapshot(options) {
  const source = requireOption(options, "source");
  const compose = requireOption(options, "compose");
  const configPath = requireOption(options, "config");
  const backup = requireOption(options, "backup");
  if (existsSync(backup)) throw new Error("backup path already exists: choose a new empty path");

  const config = loadValidatedConfig(configPath);
  const rawStatus = readStatusBuffer(source);
  const statusEntries = parsePorcelainV1Z(rawStatus)
    .sort((left, right) => left.path.localeCompare(right.path));
  assertExactStatusSet(statusEntries, config);
  const counts = assertCounts(statusEntries);
  const candidateEntries = buildCandidateEntries(source, statusEntries, config);
  const statusByPath = new Map(statusEntries.map((entry) => [entry.path, entry]));
  const quarantine = [{
    path: Q0_PATH,
    disposition: "Q0",
    status: statusByPath.get(Q0_PATH).status,
    contentInspected: false,
  }];
  const sourceMetadata = {
    branch: readGitText(source, ["branch", "--show-current"]),
    head: readGitText(source, ["rev-parse", "HEAD"]),
    statusFingerprint: createStatusFingerprint(rawStatus),
  };
  const summary = {
    totalStatusPaths: statusEntries.length,
    commitCandidates: candidateEntries.length,
    quarantinePaths: quarantine.length,
    trackedModified: counts.trackedModified,
    untracked: counts.untracked,
    staged: counts.staged,
  };
  const dirtyMap = {
    version: 1,
    source: sourceMetadata,
    summary,
    entries: statusEntries.map((entry) => {
      const candidate = candidateEntries.find((item) => item.path === entry.path);
      return candidate
        ? { status: entry.status, path: entry.path, package: candidate.package }
        : { status: entry.status, path: entry.path, disposition: "Q0", contentInspected: false };
    }),
  };
  const manifest = { version: 1, source: sourceMetadata, summary, entries: candidateEntries, quarantine };

  mkdirSync(backup, { recursive: false });
  for (const entry of candidateEntries) copyCandidate(source, join(backup, "files"), entry);
  const trackedPaths = candidateEntries
    .filter((entry) => entry.status === " M")
    .map((entry) => entry.path);
  const patch = execFileSync("git", ["diff", "--binary", "HEAD", "--", ...trackedPaths], {
    cwd: source,
  });
  writeFileSync(join(backup, "tracked-changes.diff"), patch);
  writeJson(join(backup, "manifest.json"), manifest);
  writeJson(join(compose, "coordination/release-intake/current-recovery-dirty-map.json"), dirtyMap);
  writeJson(join(compose, "coordination/release-intake/current-recovery-source-manifest.json"), manifest);
  process.stdout.write(JSON.stringify(summary) + "\n");
}

function copyPackage(options) {
  const source = requireOption(options, "source");
  const compose = requireOption(options, "compose");
  const manifest = readJson(requireOption(options, "manifest"));
  const config = loadValidatedConfig(requireOption(options, "config"));
  const packageName = options.package;
  if (!PACKAGE_NAMES.includes(packageName)) throw new Error("invalid recovery package");
  checkSource(source, manifest);
  const expectedPaths = new Set(config.packages[packageName]);
  const entries = manifest.entries.filter((entry) => entry.package === packageName);
  if (entries.length !== expectedPaths.size || entries.some((entry) => !expectedPaths.has(entry.path))) {
    throw new Error("manifest/config package mismatch: " + packageName);
  }
  for (const entry of entries) copyCandidate(source, compose, entry);
  process.stdout.write(JSON.stringify({ package: packageName, copied: entries.length }) + "\n");
}

function verifyParity(options) {
  const source = requireOption(options, "source");
  const compose = requireOption(options, "compose");
  const manifest = readJson(requireOption(options, "manifest"));
  const config = loadValidatedConfig(requireOption(options, "config"));
  checkSource(source, manifest);
  const expectedPaths = flattenPackages(config).map((entry) => entry.path).sort();
  const manifestPaths = manifest.entries.map((entry) => entry.path).sort();
  if (JSON.stringify(expectedPaths) !== JSON.stringify(manifestPaths)) {
    throw new Error("manifest/config candidate mismatch");
  }
  const mismatches = [];
  for (const entry of manifest.entries) {
    const destination = join(compose, entry.path);
    if (!existsSync(destination) || lstatSync(destination).isSymbolicLink()) {
      mismatches.push(entry.path);
    } else if (hashFile(destination) !== entry.sha256) {
      mismatches.push(entry.path);
    }
  }
  const quarantineAbsentFromCompose = !existsSync(join(compose, Q0_PATH));
  const report = {
    version: 1,
    status: mismatches.length === 0 && quarantineAbsentFromCompose ? "passed" : "failed",
    commitCandidates: manifest.entries.length,
    matched: manifest.entries.length - mismatches.length,
    mismatched: mismatches.length,
    mismatchPaths: mismatches,
    quarantinePaths: manifest.quarantine.length,
    quarantineAbsentFromCompose,
  };
  writeJson(requireOption(options, "out"), report);
  if (report.status !== "passed") throw new Error("recovery parity failed");
  process.stdout.write(JSON.stringify(report) + "\n");
}

function main(argv) {
  const { command, options } = parseArgs(argv);
  if (command === "snapshot") return snapshot(options);
  if (command === "check-source") {
    const source = requireOption(options, "source");
    const manifest = readJson(requireOption(options, "manifest"));
    process.stdout.write(JSON.stringify(checkSource(source, manifest)) + "\n");
    return;
  }
  if (command === "copy") return copyPackage(options);
  if (command === "verify") return verifyParity(options);
  throw new Error("unknown recovery command: " + String(command));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  }
}
