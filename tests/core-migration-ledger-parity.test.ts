import { describe, expect, it } from "vitest";
import {
  assessCoreMigrationLedgerParity,
  areBothStagingMigrationLedgersReady,
  readCoreMigrationManifest,
} from "../scripts/core-migration-ledger-parity.mjs";

describe("core migration ledger parity", () => {
  it("derives the exact version and checksum manifest from repository migrations", async () => {
    const manifest = await readCoreMigrationManifest();

    expect(manifest.map((entry) => entry.version)).toEqual([
      "0001_core_poc",
      "0002_teaching_operations",
      "0003_learning_chatroom",
      "0004_app_account_login",
      "0005_user_login_identifiers",
      "0006_learning_chatroom_per_room",
      "0007_teaching_course_management_per_course",
      "0008_learning_closed_loop_domain",
      "0009_learning_event_outbox",
      "0010_teacher_ai_ownership",
      "0011_course_collaborator_acl",
      "0012_course_collaborator_identifier_retention",
    ]);
    expect(manifest.every((entry) => /^[a-f0-9]{64}$/.test(entry.checksum))).toBe(
      true,
    );
  });

  it("passes only an exact ordered version and checksum ledger", async () => {
    const expected = await readCoreMigrationManifest();

    expect(
      assessCoreMigrationLedgerParity({ expected, actual: expected }),
    ).toEqual({
      ready: true,
      appliedMigrationCount: expected.length,
      expectedMigrationCount: expected.length,
      exactVersionChecksumParity: true,
    });
  });

  it.each([
    ["empty", []],
    ["missing", [{ version: "0001_core_poc", checksum: "a".repeat(64) }]],
    [
      "wrong checksum",
      [{ version: "0001_core_poc", checksum: "f".repeat(64) }],
    ],
    [
      "extra",
      [
        { version: "0001_core_poc", checksum: "a".repeat(64) },
        { version: "9999_untracked", checksum: "b".repeat(64) },
      ],
    ],
  ])("blocks a %s ledger without exposing ledger contents", async (_label, actual) => {
    const expected = await readCoreMigrationManifest();

    expect(assessCoreMigrationLedgerParity({ expected, actual })).toEqual({
      ready: false,
      appliedMigrationCount: actual.length,
      expectedMigrationCount: expected.length,
      exactVersionChecksumParity: false,
    });
  });

  it("blocks the combined receipt when either source or restore differs", async () => {
    const expected = await readCoreMigrationManifest();
    const exact = assessCoreMigrationLedgerParity({ expected, actual: expected });
    const mismatched = assessCoreMigrationLedgerParity({
      expected,
      actual: expected.map((entry, index) =>
        index === expected.length - 1
          ? { ...entry, checksum: "0".repeat(64) }
          : entry,
      ),
    });

    expect(areBothStagingMigrationLedgersReady(exact, exact)).toBe(true);
    expect(areBothStagingMigrationLedgersReady(exact, mismatched)).toBe(false);
    expect(areBothStagingMigrationLedgersReady(mismatched, exact)).toBe(false);
  });
});
