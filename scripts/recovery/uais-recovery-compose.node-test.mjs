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
