#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const digestPattern = /^[0-9a-f]{64}$/;

export const uaisStagingCandidateContentEntries = [
  ".env.local.example",
  ".vercelignore",
  "data",
  "migrations",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "postcss.config.mjs",
  "public",
  "scripts",
  "src",
  "tsconfig.json",
  "vercel.json",
  "vercel.staging.json",
];

/**
 * Hashes the deployable application source, not coordination evidence, local
 * secrets, dependencies, caches, or generated build output. Paths and lengths
 * are framed so two different file layouts cannot produce the same byte stream.
 */
/**
 * @param {string} root
 * @param {readonly string[]} entries
 */
export function computeUaisStagingCandidateContentSha(
  root = process.cwd(),
  entries = uaisStagingCandidateContentEntries,
) {
  const { absoluteRoot, files } = collectCandidateContent(root, entries);
  return hashCandidateFiles(
    absoluteRoot,
    files,
    "uais-staging-candidate-content:v1\0",
  );
}

/**
 * Returns only path names, file counts and hashes. This is safe to emit when a
 * remote builder reports a content mismatch: it identifies which allowlisted
 * entry the platform changed without exposing source bytes or environment
 * values.
 * @param {string} root
 * @param {readonly string[]} entries
 */
export function computeUaisStagingCandidateContentManifest(
  root = process.cwd(),
  entries = uaisStagingCandidateContentEntries,
) {
  const { absoluteRoot, filesByEntry, files } = collectCandidateContent(
    root,
    entries,
  );
  return {
    sha256: hashCandidateFiles(
      absoluteRoot,
      files,
      "uais-staging-candidate-content:v1\0",
    ),
    entries: filesByEntry.map(({ entry, files: entryFiles }) => ({
      path: entry,
      fileCount: entryFiles.length,
      sha256: hashCandidateFiles(
        absoluteRoot,
        entryFiles,
        `uais-staging-candidate-content-entry:v1\0${entry}\0`,
      ),
    })),
    valuesRedacted: true,
  };
}

/** @param {string} root @param {readonly string[]} entries */
function collectCandidateContent(root, entries) {
  const absoluteRoot = resolve(root);
  const filesByEntry = entries.map((entry) => ({
    entry,
    files: collectFiles(absoluteRoot, entry).sort(),
  }));
  const files = filesByEntry.flatMap(({ files: entryFiles }) => entryFiles).sort();
  if (files.length === 0) {
    throw new Error("UAIS staging candidate content allowlist is empty");
  }
  return { absoluteRoot, filesByEntry, files };
}

/**
 * @param {string} absoluteRoot
 * @param {readonly string[]} files
 * @param {string} domain
 */
function hashCandidateFiles(absoluteRoot, files, domain) {
  const hash = createHash("sha256");
  hash.update(domain);
  for (const relativePath of files) {
    const absolutePath = resolve(absoluteRoot, relativePath);
    const contents = readFileSync(absolutePath);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(String(contents.byteLength));
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Called by next.config before a staging collection build can proceed.
 * @param {{env?: Record<string, string | undefined>, root?: string, entries?: readonly string[]}} input
 */
export function resolveUaisStagingBuildContentSha({
  env = process.env,
  root = process.cwd(),
  entries = uaisStagingCandidateContentEntries,
} = {}) {
  if (env.UAIS_DEPLOYMENT_ENV !== "staging") {
    return "";
  }
  const expected = env.P2_CANDIDATE_CONTENT_SHA ?? "";
  if (!digestPattern.test(expected)) {
    throw new Error("P2_CANDIDATE_CONTENT_SHA is required for staging builds");
  }
  const computed = computeUaisStagingCandidateContentSha(root, entries);
  if (computed !== expected) {
    throw new Error("P2_CANDIDATE_CONTENT_SHA does not match deployable source");
  }
  return computed;
}

/** @param {string} root @param {string} entry */
function collectFiles(root, entry) {
  const absolutePath = resolve(root, entry);
  if (!absolutePath.startsWith(`${root}${sep}`) && absolutePath !== root) {
    throw new Error("UAIS staging candidate content entry escaped project root");
  }
  if (!existsSync(absolutePath)) {
    throw new Error(`UAIS staging candidate content entry is missing: ${entry}`);
  }
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`UAIS staging candidate content rejects symlinks: ${entry}`);
  }
  if (!stat.isDirectory()) return [toPosix(relative(root, absolutePath))];
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((item) => {
    const child = `${entry}/${item.name}`;
    return collectFiles(root, child);
  });
}

/** @param {string} value */
function toPosix(value) {
  return value.split(sep).join("/");
}

const mainModule =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (mainModule) {
  const digest = computeUaisStagingCandidateContentSha(
    readOption(process.argv.slice(2), "--root") ?? process.cwd(),
  );
  process.stdout.write(`${digest}\n`);
}

/** @param {string[]} argv @param {string} name */
function readOption(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}
