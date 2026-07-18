import { join, resolve } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";
import { resolveTeachingOperationDataDir } from "@/lib/server/teaching-operation-data-dir";

// Characterization tests for the teaching-operation data-dir resolver.
// These pin the EXACT current behavior (including its quirks) so the helper can
// be extracted from the 4,926-line teaching-operations-store without any change
// in behavior. Phase 3 gate: characterization tests precede the extraction.
describe("resolveTeachingOperationDataDir", () => {
  const defaultDir = join(cwd(), ".tmp", "uais-teaching-operations-db");

  it("resolves a configured directory to an absolute path", () => {
    expect(resolveTeachingOperationDataDir("/data/uais-ops")).toBe(
      resolve("/data/uais-ops"),
    );
  });

  it("resolves a configured relative directory against the cwd", () => {
    expect(resolveTeachingOperationDataDir("var/uais-ops")).toBe(
      resolve("var/uais-ops"),
    );
  });

  it("falls back to the default .tmp directory when none is configured", () => {
    expect(resolveTeachingOperationDataDir(undefined)).toBe(defaultDir);
    expect(resolveTeachingOperationDataDir("")).toBe(defaultDir);
  });

  it("treats a whitespace-only value as unconfigured (uses the default)", () => {
    expect(resolveTeachingOperationDataDir("   ")).toBe(defaultDir);
  });

  it("passes the raw (untrimmed) value to resolve once the trimmed value is truthy", () => {
    // Quirk pinned intentionally: the trim only gates the branch; the raw value
    // (with surrounding whitespace) is what gets resolved.
    expect(resolveTeachingOperationDataDir("  /data/uais-ops  ")).toBe(
      resolve("  /data/uais-ops  "),
    );
  });
});
