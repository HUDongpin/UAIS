import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UAIS_CORE_DATABASE_MIGRATIONS } from "@/lib/db/migrations";

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function compactSql(sql: string) {
  return sql.replace(/--.*$/gm, " ").replace(/\s+/g, " ").trim();
}

describe("teaching-course collaborator ACL migration", () => {
  it("backfills a stable opaque identifier id before making it required and unique", () => {
    const sql = compactSql(readProjectFile("migrations/0011_course_collaborator_acl.sql"));
    const add = sql.indexOf(
      "ALTER TABLE uais_user_login_identifiers ADD COLUMN IF NOT EXISTS identifier_id uuid",
    );
    const backfill = sql.indexOf(
      "UPDATE uais_user_login_identifiers SET identifier_id = gen_random_uuid() WHERE identifier_id IS NULL",
    );
    const defaultValue = sql.indexOf(
      "ALTER COLUMN identifier_id SET DEFAULT gen_random_uuid()",
    );
    const notNull = sql.indexOf("ALTER COLUMN identifier_id SET NOT NULL");

    expect(add).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(add);
    expect(defaultValue).toBeGreaterThan(backfill);
    expect(notNull).toBeGreaterThan(defaultValue);
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uais_user_login_identifiers_identifier_id_unique ON uais_user_login_identifiers (identifier_id)",
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uais_user_login_identifiers_user_identifier_id_unique ON uais_user_login_identifiers (user_id, identifier_id)",
    );
  });

  it("creates one canonical grant row with foreign keys and lifecycle invariants", () => {
    const sql = compactSql(readProjectFile("migrations/0011_course_collaborator_acl.sql"));

    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS uais_course_collaborator_grants",
    );
    expect(sql).toContain(
      "course_id text NOT NULL REFERENCES uais_teaching_course_management_snapshots(snapshot_key)",
    );
    expect(sql).toContain(
      "recipient_user_id uuid NOT NULL REFERENCES uais_users(id)",
    );
    expect(sql).toContain(
      "recipient_identifier_id uuid REFERENCES uais_user_login_identifiers(identifier_id) ON DELETE SET NULL",
    );
    expect(sql).toContain(
      "CONSTRAINT uais_course_collaborator_grants_recipient_identifier_owner_fk FOREIGN KEY (recipient_user_id, recipient_identifier_id) REFERENCES uais_user_login_identifiers(user_id, identifier_id)",
    );
    expect(sql).toContain(
      "granted_by_user_id uuid NOT NULL REFERENCES uais_users(id)",
    );
    expect(sql).toContain("revoked_by_user_id uuid REFERENCES uais_users(id)");
    expect(sql).toContain("UNIQUE (course_id, recipient_user_id)");
    expect(sql).toContain("CHECK (revision > 0)");
    expect(sql).toContain("CHECK (expires_at IS NULL OR expires_at > granted_at)");
    expect(sql).toContain(
      "CHECK (revoked_at IS NULL OR revoked_at >= granted_at)",
    );
    expect(sql).toContain(
      "CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL))",
    );
    expect(sql).toContain(
      "role IN ('observer', 'reviewer', 'teaching-assistant', 'co-instructor')",
    );
  });

  it("indexes both nullable identifier references for retention deletion", () => {
    const sql = compactSql(readProjectFile("migrations/0011_course_collaborator_acl.sql"));

    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS uais_course_collaborator_grants_recipient_identifier_idx ON uais_course_collaborator_grants (recipient_identifier_id) WHERE recipient_identifier_id IS NOT NULL",
    );
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS uais_course_collaborator_notification_recipient_identifier_idx ON uais_course_collaborator_notification_outbox (recipient_identifier_id) WHERE recipient_identifier_id IS NOT NULL",
    );
  });

  it("corrects both composite identifier foreign keys with column-scoped SET NULL", () => {
    const sql = compactSql(
      readProjectFile(
        "migrations/0012_course_collaborator_identifier_retention.sql",
      ),
    );

    expect(sql).toContain(
      "ALTER TABLE uais_course_collaborator_grants DROP CONSTRAINT IF EXISTS uais_course_collaborator_grants_recipient_identifier_owner_fk",
    );
    expect(sql).toContain(
      "CONSTRAINT uais_course_collaborator_grants_recipient_identifier_owner_fk FOREIGN KEY (recipient_user_id, recipient_identifier_id) REFERENCES uais_user_login_identifiers(user_id, identifier_id) ON DELETE SET NULL (recipient_identifier_id)",
    );
    expect(sql).toContain(
      "ALTER TABLE uais_course_collaborator_notification_outbox DROP CONSTRAINT IF EXISTS uais_course_collaborator_outbox_recipient_identifier_owner_fk",
    );
    expect(sql).toContain(
      "CONSTRAINT uais_course_collaborator_outbox_recipient_identifier_owner_fk FOREIGN KEY (recipient_user_id, recipient_identifier_id) REFERENCES uais_user_login_identifiers(user_id, identifier_id) ON DELETE SET NULL (recipient_identifier_id)",
    );
    expect(sql.match(/ON DELETE SET NULL \(recipient_identifier_id\)/g)).toHaveLength(2);
  });

  it("pins the frozen role ceilings and rejects wildcard or unknown stored scopes", () => {
    const sql = compactSql(readProjectFile("migrations/0011_course_collaborator_acl.sql"));

    expect(sql).toContain(
      "role = 'observer' AND scopes <@ ARRAY['course.read']::text[]",
    );
    expect(sql).toContain(
      "role = 'reviewer' AND scopes <@ ARRAY['course.read', 'course.grading.manage']::text[]",
    );
    expect(sql).toContain(
      "role = 'teaching-assistant' AND scopes <@ ARRAY['course.read', 'course.content.write', 'course.students.manage', 'course.grading.manage']::text[]",
    );
    expect(sql).toContain(
      "role = 'co-instructor' AND scopes <@ ARRAY['course.read', 'course.content.write', 'course.students.manage', 'course.grading.manage', 'course.settings.manage', 'course.export']::text[]",
    );
    expect(sql).toContain("CHECK (cardinality(scopes) > 0)");
    expect(sql).not.toContain("'*'");
  });

  it("creates an opaque, retryable notification outbox without email material", () => {
    const source = readProjectFile("migrations/0011_course_collaborator_acl.sql");
    const sql = compactSql(source);

    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS uais_course_collaborator_notification_outbox",
    );
    expect(sql).toContain(
      "grant_id uuid NOT NULL REFERENCES uais_course_collaborator_grants(id)",
    );
    expect(sql).toContain(
      "recipient_identifier_id uuid REFERENCES uais_user_login_identifiers(identifier_id) ON DELETE SET NULL",
    );
    expect(sql).toContain(
      "recipient_user_id uuid NOT NULL REFERENCES uais_users(id)",
    );
    expect(sql).toContain(
      "CONSTRAINT uais_course_collaborator_outbox_recipient_identifier_owner_fk FOREIGN KEY (recipient_user_id, recipient_identifier_id) REFERENCES uais_user_login_identifiers(user_id, identifier_id)",
    );
    expect(sql).toContain("event_type IN ('grant-issued', 'grant-revoked')");
    expect(sql).toContain(
      "status IN ('pending', 'processing', 'sent', 'failed', 'dead')",
    );
    expect(sql).toContain("UNIQUE (grant_id, event_type, grant_revision)");
    expect(sql).not.toContain("recipient_identifier_id uuid NOT NULL");
    expect(source).not.toMatch(/recipient_email|email_hash|recipient_email_hash/i);
  });

  it("registers the ACL tables and the immutable follow-up correction", () => {
    expect(UAIS_CORE_DATABASE_MIGRATIONS.slice(-2)).toEqual([
      {
        version: "0011_course_collaborator_acl",
        path: "migrations/0011_course_collaborator_acl.sql",
        tables: [
          "uais_course_collaborator_grants",
          "uais_course_collaborator_notification_outbox",
        ],
      },
      {
        version: "0012_course_collaborator_identifier_retention",
        path: "migrations/0012_course_collaborator_identifier_retention.sql",
        tables: [],
      },
    ]);
  });
});
