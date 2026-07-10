# UAIS Dirty Worktree Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the frozen UAIS inventory into a clean compose branch as 115 owner-scoped commit candidates while keeping one local-generated Q0 path outside Git, then stop before root cleanup or local `main` integration.

**Architecture:** Keep `/Users/dongpinhu/Desktop/UAIS` frozen as the authoritative source. Use the single sibling compose worktree to create recovery tooling and evidence, copy R1-R5 in dependency order, verify source/compose hashes after every transfer, and commit each package with explicit pathspecs. Root cleanup, worktree pruning, and `main` fast-forward remain separately approval-gated.

**Tech Stack:** Git worktrees, Node.js 24 ESM, SHA-256, JSON manifests, npm, Next.js 16, TypeScript, ESLint, Vitest.

---

## Fixed Baselines

- Source: `/Users/dongpinhu/Desktop/UAIS`
- Compose: `/Users/dongpinhu/Desktop/UAIS-worktrees/recovery-compose-2026-07-10`
- Compose branch: `codex/uais-recovery-compose-2026-07-10`
- Source base: `d28d8a6cb2e8efbdf29bf7515de2ae7e93d500a8`
- Approved design commits: `b90ab66` and `81f93b4`
- Source status: 44 tracked modifications, 72 untracked paths, 0 staged paths
- Commit candidates: 115
- Q0: `docs/technical-advisory/.Rhistory`
- Independent planning fingerprint: `438d77328f144c895a14827bb3604b1a9d849517cc169aeca745cec726177948`

The tool must compute its own NUL-delimited status fingerprint. Do not hard-code the planning fingerprint.

## Global Stop Rules

- Stop if the source porcelain status or any candidate hash changes after snapshot.
- Stop if the source has a staged path.
- Stop if any candidate is missing, duplicated, symlinked, ignored, or mapped twice.
- Never inspect, hash, copy, stage, or commit Q0.
- Stop below 8 GiB free space before install/build.
- Never run `git reset`, `git clean`, `git worktree prune`, `git checkout main`, `git branch -f`, `git prune`, or source-root cleanup commands.
- Keep the existing generated Git `gc.log` untouched; metadata cleanup is deferred.

### Task 1: Align Package-Local Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-10-uais-dirty-worktree-recovery-design.md`
- Modify: `coordination/session-logs/2026-07-10-S25.md`

- [ ] **Step 1: Record the final dependency-local documentation map**

```text
R1: README.md, docs/architecture-map.md, docs/env-surface.md,
    docs/runbooks/observability.md, docs/runbooks/pre-deploy-checklist.md,
    docs/runbooks/production-rollback.md, docs/runbooks/staging-preview.md
R2: docs/API.md, docs/core-schema-design.md
R3: docs/performance-accessibility-baseline.md
R4: docs/adaptive-recommendations.md, docs/learner-profiles.md
R5: docs/privacy-baseline.md, technical-advisory documents, coordination evidence,
    CONTRIBUTING.md, SCOPE.md, and cross-package regression tests
```

Explain that focused tests travel with documents they directly read.

- [ ] **Step 2: Check and commit the clarification**

```bash
rg -n 'TBD|TODO|FIXME|PLACEHOLDER|\?\?\?' \
  docs/superpowers/specs/2026-07-10-uais-dirty-worktree-recovery-design.md \
  coordination/session-logs/2026-07-10-S25.md || true
git diff --check
git add -- \
  docs/superpowers/specs/2026-07-10-uais-dirty-worktree-recovery-design.md \
  coordination/session-logs/2026-07-10-S25.md
git diff --cached --check
git commit -m "docs: align recovery package dependencies"
```

Expected: two staged paths before commit; clean compose status afterward.

### Task 2: Build R0 Recovery Tooling With Tests

**Files:**
- Create: `scripts/recovery/uais-recovery-compose.mjs`
- Create: `scripts/recovery/uais-recovery-compose.test.mjs`
- Create: `coordination/release-intake/recovery-owner-packages.json`
- Modify: `coordination/release-intake/owner-pathspecs.json`

- [ ] **Step 1: Write failing unit tests**

Create `scripts/recovery/uais-recovery-compose.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createStatusFingerprint,
  parsePorcelainV1Z,
  validateDispositionConfig,
  validateRelativePath,
} from "./uais-recovery-compose.mjs";

test("parses unstaged tracked and untracked records", () => {
  assert.deepEqual(
    parsePorcelainV1Z(Buffer.from(" M README.md\0?? docs/new.md\0")),
    [
      { status: " M", path: "README.md", staged: false },
      { status: "??", path: "docs/new.md", staged: false },
    ],
  );
});

test("rejects staged and rename records", () => {
  assert.throws(() => parsePorcelainV1Z(Buffer.from("M  README.md\0")), /staged path/);
  assert.throws(() => parsePorcelainV1Z(Buffer.from("R  old.md -> new.md\0")), /rename/);
});

test("rejects unsafe relative paths", () => {
  for (const value of ["", "/tmp/a", "../a", "a/../../b", "a\0b"]) {
    assert.throws(() => validateRelativePath(value));
  }
  assert.equal(validateRelativePath("src/app/page.tsx"), "src/app/page.tsx");
});

test("requires 115 candidates and one Q0 disposition", () => {
  const candidates = Array.from({ length: 115 }, (_, index) => "path-" + index);
  const config = {
    version: 1,
    packages: { R1: candidates, R2: [], R3: [], R4: [], R5: [] },
    quarantine: [{ path: "docs/technical-advisory/.Rhistory", disposition: "Q0" }],
  };
  assert.deepEqual(validateDispositionConfig(config), {
    commitCandidateCount: 115,
    quarantineCount: 1,
  });
  assert.throws(
    () => validateDispositionConfig({
      ...config,
      packages: { ...config.packages, R2: ["path-0"] },
    }),
    /duplicate/,
  );
});

test("fingerprints exact nul-delimited bytes", () => {
  const nul = createStatusFingerprint(Buffer.from(" M README.md\0"));
  const newline = createStatusFingerprint(Buffer.from(" M README.md\n"));
  assert.equal(nul.length, 64);
  assert.notEqual(nul, newline);
});
```

- [ ] **Step 2: Verify the test fails**

```bash
node --test scripts/recovery/uais-recovery-compose.test.mjs
```

Expected: FAIL because `uais-recovery-compose.mjs` does not exist.

- [ ] **Step 3: Implement the recovery CLI**

Create `scripts/recovery/uais-recovery-compose.mjs` with these exports:

```js
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
  const packageNames = ["R1", "R2", "R3", "R4", "R5"];
  const seen = new Set();
  let commitCandidateCount = 0;
  for (const packageName of packageNames) {
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
```

Implement the following command contract in the same file:

```text
snapshot --source <root> --compose <root> --config <json> --backup <dir>
check-source --source <root> --manifest <json>
copy --package <R1-R5> --source <root> --compose <root> --manifest <json> --config <json>
verify --source <root> --compose <root> --manifest <json> --config <json> --out <json>
```

Required behavior:

- `snapshot` reads NUL-delimited status once; requires 44 ` M`, 72 `??`, zero staged, and exact equality with 116 dispositions.
- It hashes/copies only 115 candidates into the external backup, preserving paths.
- Q0 is recorded only as `{"path":"docs/technical-advisory/.Rhistory","disposition":"Q0","contentInspected":false}`.
- It writes stable, path-sorted `current-recovery-dirty-map.json` and `current-recovery-source-manifest.json`.
- `check-source` recomputes status fingerprint and 115 candidate hashes without opening Q0.
- `copy` runs `check-source`, rejects symlinks, copies one package, and verifies destination hashes.
- `verify` checks all 115 compose hashes, asserts Q0 absent, and writes parity JSON.
- JSON omits absolute local paths and values.
- CLI dispatch runs only when the file is executed directly, not when imported by tests.
+
The complete command implementation must use the following functions and dispatch. This code extends the exported validation functions above in the same file:

```js
const PACKAGE_NAMES = ["R1", "R2", "R3", "R4", "R5"];
const Q0_PATH = "docs/technical-advisory/.Rhistory";

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
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("candidate must be regular file: " + path);
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
  if (hashFile(absolutePath) !== entry.sha256) throw new Error("source hash drift: " + entry.path);
  const destination = join(destinationRoot, entry.path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(absolutePath, destination);
  if (hashFile(destination) !== entry.sha256) throw new Error("destination hash mismatch: " + entry.path);
}

function checkSource(source, manifest) {
  const rawStatus = readStatusBuffer(source);
  const fingerprint = createStatusFingerprint(rawStatus);
  if (fingerprint !== manifest.source.statusFingerprint) {
    throw new Error("source status fingerprint drift");
  }
  for (const entry of manifest.entries) {
    const { absolutePath } = assertCandidateFile(source, entry.path);
    if (hashFile(absolutePath) !== entry.sha256) throw new Error("source hash drift: " + entry.path);
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
  const trackedPaths = candidateEntries.filter((entry) => entry.status === " M").map((entry) => entry.path);
  const patch = execFileSync("git", ["diff", "--binary", "HEAD", "--", ...trackedPaths], { cwd: source });
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
```


- [ ] **Step 4: Create the exact package config**

Create `coordination/release-intake/recovery-owner-packages.json`. The package arrays must contain exactly the paths below and be sorted.

```json
{
  "version": 1,
  "packages": {
    "R1": [
      ".env.local.example",
      ".github/workflows/critical-flow.yml",
      "README.md",
      "docs/architecture-map.md",
      "docs/env-surface.md",
      "docs/runbooks/observability.md",
      "docs/runbooks/pre-deploy-checklist.md",
      "docs/runbooks/production-rollback.md",
      "docs/runbooks/staging-preview.md",
      "next.config.ts",
      "package-lock.json",
      "package.json",
      "src/app/healthz/route.ts",
      "src/instrumentation-client.ts",
      "src/instrumentation.ts",
      "src/lib/observability/sentry-options.ts",
      "src/lib/release/deployment-lanes.ts",
      "src/lib/release/env-surface.ts",
      "src/sentry.edge.config.ts",
      "src/sentry.server.config.ts",
      "tests/app-healthz.test.ts",
      "tests/critical-flow-gate-script.test.ts",
      "tests/deployment-lanes.test.ts",
      "tests/env-surface.test.ts",
      "tests/observability-readiness.test.ts",
      "tsconfig.json"
    ],
    "R2": [
      "docs/API.md",
      "docs/core-schema-design.md",
      "migrations/0001_core_poc.sql",
      "scripts/apply-core-migrations.mjs",
      "src/app/api/auth/app-session/route.ts",
      "src/app/api/teaching/course-cover/route.ts",
      "src/app/api/teaching/courses/route.ts",
      "src/lib/auth/uais-app-session.ts",
      "src/lib/db/core-database.ts",
      "src/lib/db/migrations.ts",
      "src/lib/db/schema.ts",
      "src/lib/server/learning-ai-guide-access.ts",
      "src/lib/server/learning-ppt-playback-access.ts",
      "src/lib/server/localized-route-metadata.ts",
      "src/lib/server/teaching-course-management-external-store.ts",
      "src/lib/server/teaching-course-management-postgres-store.ts",
      "src/lib/server/teaching-course-management-store.ts",
      "src/lib/server/teaching-course-management-types.ts",
      "src/lib/server/uais-app-auth-provider.ts",
      "src/lib/server/uais-app-session.ts",
      "src/lib/teaching/course-readback.ts",
      "src/proxy.ts",
      "tests/app-proxy-auth.test.ts",
      "tests/core-database-foundation.test.ts",
      "tests/core-schema-design.test.ts",
      "tests/teaching-course-management-api.test.ts",
      "tests/teaching-course-management-postgres-policy.test.ts",
      "tests/teaching-course-readback.test.ts",
      "tests/uais-app-session.test.ts"
    ],
    "R3": [
      "docs/performance-accessibility-baseline.md",
      "src/app/globals.css",
      "src/app/learning/chatroom/page.tsx",
      "src/app/learning/page.tsx",
      "src/app/legal-document.tsx",
      "src/app/teaching/page.tsx",
      "src/components/layout/header.tsx",
      "src/components/pages/course-plaza-page.tsx",
      "src/components/pages/learning-page-shell.tsx",
      "src/components/pages/learning-page.tsx",
      "src/components/pages/login-page.tsx",
      "src/components/pages/page-loading-shell.tsx",
      "src/components/pages/student-dashboard-page.tsx",
      "src/components/pages/teaching-page-shell.tsx",
      "src/components/pages/teaching-page.tsx",
      "src/components/teaching/teaching-operation-page.tsx",
      "tests/performance-accessibility-baseline.test.ts"
    ],
    "R4": [
      "docs/adaptive-recommendations.md",
      "docs/learner-profiles.md",
      "src/app/api/learning-records/analytics/route.ts",
      "src/app/api/learning-records/events/route.ts",
      "src/app/api/learning/ai-guide/hitl/route.ts",
      "src/app/api/learning/ai-guide/route.ts",
      "src/app/api/learning/ppt-playback/[courseId]/route.ts",
      "src/lib/adaptive-learning/recommendations.ts",
      "src/lib/ai/langgraph-runtime/runtime.ts",
      "src/lib/ai/orchestration/agent-loop.ts",
      "src/lib/ai/orchestration/learning-guide-graph.ts",
      "src/lib/learning-records/learner-profile.ts",
      "src/lib/learning/ppt-playback.ts",
      "tests/adaptive-recommendations.test.ts",
      "tests/ai-orchestration.test.ts",
      "tests/langgraph-runtime.test.ts",
      "tests/learner-profile.test.ts",
      "tests/learning-ai-guide-hitl-thread-scope.test.ts"
    ],
    "R5": [
      "CONTRIBUTING.md",
      "SCOPE.md",
      "coordination/reports/2026-07-08-critical-flow-regression-matrix.md",
      "coordination/session-logs/2026-07-08-S05.md",
      "coordination/session-logs/2026-07-08-S10.md",
      "coordination/session-logs/2026-07-08-S11.md",
      "coordination/session-logs/2026-07-08-S12.md",
      "coordination/session-logs/2026-07-08-S15.md",
      "coordination/session-logs/2026-07-08-S19.md",
      "coordination/session-logs/2026-07-08-S22.md",
      "coordination/session-logs/2026-07-09-S22.md",
      "docs/privacy-baseline.md",
      "docs/technical-advisory/20260708-UAIS-Codex-Verification-Report.md",
      "docs/technical-advisory/20260708-UAIS-Technical-Advisory-Report-Codex-Clean.docx",
      "docs/technical-advisory/20260708-UAIS-Technical-Advisory-Report-Codex-Tracked.docx",
      "docs/technical-advisory/UAIS_Executive_Summary.md",
      "docs/technical-advisory/UAIS_Issue_Register_and_Backlog.xlsx",
      "docs/technical-advisory/UAIS_Senior_Technical_Advisory_Report.docx",
      "docs/technical-advisory/UAIS_Target_Architecture.md",
      "docs/technical-advisory/UAIS_Technical_Review.md",
      "tests/advisory-recovery-governance.test.ts",
      "tests/critical-user-flow-matrix.test.ts",
      "tests/critical-user-flows-backend.test.ts",
      "tests/enterprise-closed-loop-regression.test.ts",
      "tests/privacy-baseline.test.ts"
    ]
  },
  "quarantine": [
    {
      "path": "docs/technical-advisory/.Rhistory",
      "disposition": "Q0",
      "contentInspected": false
    }
  ]
}
```

- [ ] **Step 5: Extend owner-pathspec coverage**

Modify `coordination/release-intake/owner-pathspecs.json` with:

```text
S10-docs-tooling: CONTRIBUTING.md, SCOPE.md
S22-release-config: tsconfig.json, .github/workflows/critical-flow.yml,
  src/app/healthz/, src/instrumentation.ts, src/instrumentation-client.ts,
  src/sentry.edge.config.ts, src/sentry.server.config.ts,
  src/lib/observability/, src/lib/release/deployment-lanes.ts
S19-env-example: src/lib/release/env-surface.ts
S12-backend-api: migrations/, scripts/apply-core-migrations.mjs, src/lib/db/, src/lib/teaching/
S15-adaptive-learning: src/lib/adaptive-learning/
local-archive-only: docs/technical-advisory/.Rhistory
```

- [ ] **Step 6: Run and commit R0 tooling checks**

```bash
node --test scripts/recovery/uais-recovery-compose.test.mjs
node --check scripts/recovery/uais-recovery-compose.mjs
jq -e '([.packages[] | length] | add) == 115 and (.quarantine | length) == 1' \
  coordination/release-intake/recovery-owner-packages.json
git diff --check
git add -- \
  scripts/recovery/uais-recovery-compose.mjs \
  scripts/recovery/uais-recovery-compose.test.mjs \
  coordination/release-intake/recovery-owner-packages.json \
  coordination/release-intake/owner-pathspecs.json
git diff --cached --check
git commit -m "chore: add UAIS recovery composition tooling"
```

Expected: 5 Node tests pass; exactly four staged paths before commit.

### Task 3: Snapshot Frozen Source And Commit R0 Evidence

**Files:**
- Create: `coordination/release-intake/current-recovery-dirty-map.json`
- Create: `coordination/release-intake/current-recovery-source-manifest.json`
- Create outside Git: `/Users/dongpinhu/Desktop/UAIS-dirty-worktree-backups/2026-07-10-recovery-source/`
- Modify: `coordination/session-logs/2026-07-10-S25.md`

- [ ] **Step 1: Check disk, branch, and staged state**

```bash
df -h /Users/dongpinhu/Desktop/UAIS
git -C /Users/dongpinhu/Desktop/UAIS branch --show-current
git -C /Users/dongpinhu/Desktop/UAIS diff --cached --quiet
```

Expected: at least 8 GiB free, rescue branch, zero staged.

- [ ] **Step 2: Snapshot**

```bash
node scripts/recovery/uais-recovery-compose.mjs snapshot \
  --source /Users/dongpinhu/Desktop/UAIS \
  --compose "$PWD" \
  --config coordination/release-intake/recovery-owner-packages.json \
  --backup /Users/dongpinhu/Desktop/UAIS-dirty-worktree-backups/2026-07-10-recovery-source
```

Expected: 116 dispositions, 115 candidates, 1 Q0, 44 tracked, 72 untracked, 0 staged.

- [ ] **Step 3: Validate and commit evidence**

```bash
jq -e '
  .summary.totalStatusPaths == 116 and
  .summary.commitCandidates == 115 and
  .summary.quarantinePaths == 1 and
  .summary.trackedModified == 44 and
  .summary.untracked == 72 and
  .summary.staged == 0
' coordination/release-intake/current-recovery-dirty-map.json
jq -e '
  (.entries | length) == 115 and
  (.quarantine[0].path == "docs/technical-advisory/.Rhistory") and
  (.quarantine[0].contentInspected == false)
' coordination/release-intake/current-recovery-source-manifest.json
git add -- \
  coordination/release-intake/current-recovery-dirty-map.json \
  coordination/release-intake/current-recovery-source-manifest.json \
  coordination/session-logs/2026-07-10-S25.md
git diff --cached --check
git commit -m "chore: establish UAIS recovery inventory"
```

Expected: three staged paths before commit.

### Task 4: Recover R1 Platform And Release Foundation

**Files:** Copy exactly 26 R1 paths.

- [ ] **Step 1: Guard and copy**

```bash
node scripts/recovery/uais-recovery-compose.mjs check-source \
  --source /Users/dongpinhu/Desktop/UAIS \
  --manifest coordination/release-intake/current-recovery-source-manifest.json
node scripts/recovery/uais-recovery-compose.mjs copy \
  --package R1 \
  --source /Users/dongpinhu/Desktop/UAIS \
  --compose "$PWD" \
  --manifest coordination/release-intake/current-recovery-source-manifest.json \
  --config coordination/release-intake/recovery-owner-packages.json
npm ci --no-audit --no-fund
```

Expected: 26 copies, no drift, install exit 0.

- [ ] **Step 2: Test**

```bash
npm run test -- \
  tests/app-healthz.test.ts \
  tests/critical-flow-gate-script.test.ts \
  tests/deployment-lanes.test.ts \
  tests/env-surface.test.ts \
  tests/observability-readiness.test.ts
npm run lint
git diff --check
```

Expected: 5 test files pass; lint/diff pass.

- [ ] **Step 3: Stage exact paths and commit**

```bash
jq -r '.packages.R1[]' coordination/release-intake/recovery-owner-packages.json |
  git add --pathspec-from-file=-
git diff --cached --name-only > /tmp/uais-r1-staged.txt
jq -r '.packages.R1[]' coordination/release-intake/recovery-owner-packages.json > /tmp/uais-r1-expected.txt
diff -u /tmp/uais-r1-expected.txt /tmp/uais-r1-staged.txt
git diff --cached --check
git commit -m "chore: recover UAIS platform and release foundation"
```

Expected: 26 exact staged paths; Q0 absent; clean afterward.

### Task 5: Recover R2 Auth, Backend, And Managed Data

**Files:** Copy exactly 29 R2 paths.

- [ ] **Step 1: Guard/copy R2**

```bash
node scripts/recovery/uais-recovery-compose.mjs check-source \
  --source /Users/dongpinhu/Desktop/UAIS \
  --manifest coordination/release-intake/current-recovery-source-manifest.json
node scripts/recovery/uais-recovery-compose.mjs copy \
  --package R2 \
  --source /Users/dongpinhu/Desktop/UAIS \
  --compose "$PWD" \
  --manifest coordination/release-intake/current-recovery-source-manifest.json \
  --config coordination/release-intake/recovery-owner-packages.json
```

Expected: 29 copies, no drift.

- [ ] **Step 2: Test R2**

```bash
npm run test -- \
  tests/app-proxy-auth.test.ts \
  tests/core-database-foundation.test.ts \
  tests/core-schema-design.test.ts \
  tests/teaching-course-management-api.test.ts \
  tests/teaching-course-management-postgres-policy.test.ts \
  tests/teaching-course-readback.test.ts \
  tests/uais-app-session.test.ts
npm run lint
git diff --check
```

Expected: 7 files pass; lint/diff pass.

- [ ] **Step 3: Exact-stage and commit R2**

```bash
jq -r '.packages.R2[]' coordination/release-intake/recovery-owner-packages.json |
  git add --pathspec-from-file=-
git diff --cached --name-only > /tmp/uais-r2-staged.txt
jq -r '.packages.R2[]' coordination/release-intake/recovery-owner-packages.json > /tmp/uais-r2-expected.txt
diff -u /tmp/uais-r2-expected.txt /tmp/uais-r2-staged.txt
git diff --cached --check
git commit -m "feat: recover UAIS backend and managed data slice"
```

Expected: 29 exact paths.

### Task 6: Recover R3 Product Routes And Pages

**Files:** Copy exactly 17 R3 paths.

- [ ] **Step 1: Guard/copy R3**

```bash
node scripts/recovery/uais-recovery-compose.mjs check-source \
  --source /Users/dongpinhu/Desktop/UAIS \
  --manifest coordination/release-intake/current-recovery-source-manifest.json
node scripts/recovery/uais-recovery-compose.mjs copy \
  --package R3 \
  --source /Users/dongpinhu/Desktop/UAIS \
  --compose "$PWD" \
  --manifest coordination/release-intake/current-recovery-source-manifest.json \
  --config coordination/release-intake/recovery-owner-packages.json
```

- [ ] **Step 2: Test R3**

```bash
npm run test -- tests/performance-accessibility-baseline.test.ts
npm run lint
git diff --check
```

Expected: focused test, lint, and diff pass.

- [ ] **Step 3: Exact-stage and commit R3**

```bash
jq -r '.packages.R3[]' coordination/release-intake/recovery-owner-packages.json |
  git add --pathspec-from-file=-
git diff --cached --name-only > /tmp/uais-r3-staged.txt
jq -r '.packages.R3[]' coordination/release-intake/recovery-owner-packages.json > /tmp/uais-r3-expected.txt
diff -u /tmp/uais-r3-expected.txt /tmp/uais-r3-staged.txt
git diff --cached --check
git commit -m "feat: recover UAIS product route and page slice"
```

Expected: 17 exact paths.

### Task 7: Recover R4 AI, Adaptive Learning, And Playback

**Files:** Copy exactly 18 R4 paths.

- [ ] **Step 1: Guard/copy R4**

```bash
node scripts/recovery/uais-recovery-compose.mjs check-source \
  --source /Users/dongpinhu/Desktop/UAIS \
  --manifest coordination/release-intake/current-recovery-source-manifest.json
node scripts/recovery/uais-recovery-compose.mjs copy \
  --package R4 \
  --source /Users/dongpinhu/Desktop/UAIS \
  --compose "$PWD" \
  --manifest coordination/release-intake/current-recovery-source-manifest.json \
  --config coordination/release-intake/recovery-owner-packages.json
```

- [ ] **Step 2: Test R4**

```bash
npm run test -- \
  tests/adaptive-recommendations.test.ts \
  tests/ai-orchestration.test.ts \
  tests/langgraph-runtime.test.ts \
  tests/learner-profile.test.ts \
  tests/learning-ai-guide-hitl-thread-scope.test.ts
npm run lint
git diff --check
```

Expected: 5 files pass; lint/diff pass.

- [ ] **Step 3: Exact-stage and commit R4**

```bash
jq -r '.packages.R4[]' coordination/release-intake/recovery-owner-packages.json |
  git add --pathspec-from-file=-
git diff --cached --name-only > /tmp/uais-r4-staged.txt
jq -r '.packages.R4[]' coordination/release-intake/recovery-owner-packages.json > /tmp/uais-r4-expected.txt
diff -u /tmp/uais-r4-expected.txt /tmp/uais-r4-staged.txt
git diff --cached --check
git commit -m "feat: recover UAIS AI and adaptive learning slice"
```

Expected: 18 exact paths.

### Task 8: Recover R5 Cross-Package Regression And Evidence

**Files:** Copy exactly 25 R5 paths.

- [ ] **Step 1: Guard/copy R5**

```bash
node scripts/recovery/uais-recovery-compose.mjs check-source \
  --source /Users/dongpinhu/Desktop/UAIS \
  --manifest coordination/release-intake/current-recovery-source-manifest.json
node scripts/recovery/uais-recovery-compose.mjs copy \
  --package R5 \
  --source /Users/dongpinhu/Desktop/UAIS \
  --compose "$PWD" \
  --manifest coordination/release-intake/current-recovery-source-manifest.json \
  --config coordination/release-intake/recovery-owner-packages.json
```

Expected: 25 copies; Q0 remains only in source.

- [ ] **Step 2: Test R5**

```bash
npm run test -- \
  tests/advisory-recovery-governance.test.ts \
  tests/critical-user-flow-matrix.test.ts \
  tests/critical-user-flows-backend.test.ts \
  tests/enterprise-closed-loop-regression.test.ts \
  tests/privacy-baseline.test.ts
git diff --check
```

Expected: 5 files and diff pass.

- [ ] **Step 3: Exact-stage and commit R5**

```bash
jq -r '.packages.R5[]' coordination/release-intake/recovery-owner-packages.json |
  git add --pathspec-from-file=-
git diff --cached --name-only > /tmp/uais-r5-staged.txt
jq -r '.packages.R5[]' coordination/release-intake/recovery-owner-packages.json > /tmp/uais-r5-expected.txt
diff -u /tmp/uais-r5-expected.txt /tmp/uais-r5-staged.txt
git diff --cached --check
! git diff --cached --name-only | rg -F 'docs/technical-advisory/.Rhistory'
git commit -m "test: recover UAIS regression and documentation slice"
```

Expected: 25 exact paths; Q0 absent.

### Task 9: Full Parity And Compose Gates

**Files:**
- Create: `coordination/release-intake/current-recovery-parity-report.json`
- Create: `coordination/reports/2026-07-10-uais-dirty-worktree-recovery-verification.md`
- Modify: `coordination/session-logs/2026-07-10-S25.md`

- [ ] **Step 1: Generate parity**

```bash
node scripts/recovery/uais-recovery-compose.mjs verify \
  --source /Users/dongpinhu/Desktop/UAIS \
  --compose "$PWD" \
  --manifest coordination/release-intake/current-recovery-source-manifest.json \
  --config coordination/release-intake/recovery-owner-packages.json \
  --out coordination/release-intake/current-recovery-parity-report.json
jq -e '
  .status == "passed" and
  .commitCandidates == 115 and
  .matched == 115 and
  .mismatched == 0 and
  .quarantinePaths == 1 and
  .quarantineAbsentFromCompose == true
' coordination/release-intake/current-recovery-parity-report.json
```

Expected: 115/115 parity; Q0 absent.

- [ ] **Step 2: Run full gates**

```bash
git diff --check
npm run lint
npm run test
NEXT_TELEMETRY_DISABLED=1 npm run build
```

Expected: lint/build pass; 159 test files and 1,982 tests pass.

- [ ] **Step 3: Write and commit verification evidence**

The verification report and S25 log must record:

```text
compose branch and commit before evidence commit
source branch/base and status fingerprint
116 dispositions: 115 candidates, one Q0
R1-R5 commit ids and path counts
115/115 parity
lint/test/build results
source root unchanged
Q0 not inspected/copied/staged
deferred approvals: main update, root cleanup, Q0 disposition,
worktree removal, stale-worktree prune
```

Then:

```bash
git add -- \
  coordination/release-intake/current-recovery-parity-report.json \
  coordination/reports/2026-07-10-uais-dirty-worktree-recovery-verification.md \
  coordination/session-logs/2026-07-10-S25.md
git diff --cached --check
git commit -m "docs: verify UAIS dirty-worktree recovery composition"
npm run release:clean-check
git status --short --untracked-files=all
```

Expected: three staged evidence paths; final compose clean.

### Task 10: Stop At Separate Approval Boundary

**Files:** None.

- [ ] **Step 1: Refresh source and worktree evidence**

```bash
git -C /Users/dongpinhu/Desktop/UAIS branch --show-current
git -C /Users/dongpinhu/Desktop/UAIS status --short --untracked-files=all
git worktree list --porcelain
```

Expected: frozen rescue inventory remains; compose is clean; two stale proof entries remain unpruned.

- [ ] **Step 2: Request owner approval**

Present compose commit, 115/115 parity, full gates, and these still-prohibited actions:

```text
1. fast-forward local main
2. restore 44 tracked source paths
3. remove 71 untracked commit-candidate paths
4. decide/apply Q0 disposition
5. remove compose worktree
6. prune two stale proof-worktree records
7. return root checkout to clean main
```

Do not run them before separate approval.
