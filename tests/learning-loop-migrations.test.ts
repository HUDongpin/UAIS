import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  UAIS_CORE_DATABASE_MIGRATIONS,
  UAIS_CORE_DATABASE_MIGRATION_VERSIONS,
} from "@/lib/db/migrations";
import { uaisCoreSchemaTables } from "@/lib/db/schema";

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("P1 additive database migrations", () => {
  it("registers 0008 and 0009 in the runtime migration inventory", () => {
    expect(UAIS_CORE_DATABASE_MIGRATION_VERSIONS).toEqual(
      expect.arrayContaining([
        "0008_learning_closed_loop_domain",
        "0009_learning_event_outbox",
      ]),
    );
    expect(
      UAIS_CORE_DATABASE_MIGRATION_VERSIONS.indexOf("0008_learning_closed_loop_domain"),
    ).toBeLessThan(
      UAIS_CORE_DATABASE_MIGRATION_VERSIONS.indexOf("0009_learning_event_outbox"),
    );
    const domainMigration = UAIS_CORE_DATABASE_MIGRATIONS.find(
      (migration) => migration.version === "0008_learning_closed_loop_domain",
    );
    const outboxMigration = UAIS_CORE_DATABASE_MIGRATIONS.find(
      (migration) => migration.version === "0009_learning_event_outbox",
    );
    expect(domainMigration?.tables).toEqual(
      expect.arrayContaining([
        "uais_submission_versions",
        "uais_feedback",
        "uais_formative_attempts",
      ]),
    );
    expect(outboxMigration?.tables).toEqual(
      expect.arrayContaining(["uais_xapi_outbox", "uais_idempotency_records"]),
    );
  });

  it("keeps Drizzle names for every new relation used by the runtime", () => {
    expect(Object.keys(uaisCoreSchemaTables)).toEqual(
      expect.arrayContaining([
        "submissionVersions",
        "feedback",
        "formativeAttempts",
        "xapiOutbox",
        "idempotencyRecords",
      ]),
    );
  });

  it("preserves legacy submissions while mapping reviewed and returned states", () => {
    const migration = readProjectFile("migrations/0008_learning_closed_loop_domain.sql");

    expect(migration).toContain("WHEN 'reviewed' THEN 'accepted'");
    expect(migration).toContain("WHEN 'returned' THEN 'revision_requested'");
    expect(migration).toContain("legacy_content_ref");
    expect(migration).not.toMatch(/DROP\s+TABLE/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+uais_submissions/i);
  });

  it("adds unique revisions, event idempotency and a durable outbox without storing正文", () => {
    const domain = readProjectFile("migrations/0008_learning_closed_loop_domain.sql");
    const events = readProjectFile("migrations/0009_learning_event_outbox.sql");

    expect(domain).toContain("UNIQUE (submission_id, version_no)");
    expect(domain).toContain("UNIQUE (assessment_id, user_id)");
    expect(domain).toContain("FOREIGN KEY (submission_version_id, submission_id)");
    expect(domain).toContain("FOREIGN KEY (accepted_version_id, id)");
    expect(domain).toContain("uais_submission_versions_sealed_timestamp_check");
    expect(domain).toContain("uais_feedback_release_consistency_check");
    expect(domain).toContain("edit_revision integer NOT NULL DEFAULT 1");
    expect(events).toContain("idempotency_key text");
    expect(events).toContain("CREATE TABLE IF NOT EXISTS uais_xapi_outbox");
    expect(events).toContain("CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead'))");
    expect(events).not.toContain("content_text");
    expect(events).not.toContain("feedback_text");
    expect(events).not.toMatch(/DROP\s+TABLE/i);
  });

  it("wires a focused P1 suite and a strict redacted migration preflight", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["test:p1"]).toContain("learning-loop-domain.test.ts");
    expect(packageJson.scripts?.["test:critical"]).toContain(
      "learning-loop-critical-journey.test.ts",
    );
    expect(packageJson.scripts?.["db:preflight:p1"]).toBe(
      "node scripts/learning-loop-migration-preflight.mjs",
    );
  });
});
