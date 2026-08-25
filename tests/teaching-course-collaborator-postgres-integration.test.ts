import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createUaisCoreDatabase,
  getUaisCoreDatabasePool,
  resetUaisCoreDatabasePoolForTesting,
} from "@/lib/db/core-database";
import {
  TeachingCourseCollaboratorStoreError,
  createTeachingCourseCollaboratorPostgresStore,
} from "@/lib/server/teaching-course-collaborator-postgres-store";
import { authorizeLiveDatabaseTestFile } from "../scripts/run-db-tests.mjs";

const testFile =
  "tests/teaching-course-collaborator-postgres-integration.test.ts";
const authorization = await authorizeLiveDatabaseTestFile({
  env: process.env,
  lane: "legacy",
  testFile,
});
if (
  authorization.exitCode !== 0 ||
  !("databaseUrl" in authorization) ||
  typeof authorization.databaseUrl !== "string" ||
  authorization.databaseUrl.length === 0
) {
  throw new Error(`UAIS_DB_TEST ${JSON.stringify(authorization.report)}`);
}
const databaseUrl = authorization.databaseUrl;

type FixturePrincipal = {
  id: string;
  account: string;
};

type FixtureRecipient = FixturePrincipal & {
  email: string;
  identifierId: string;
};

type CollaboratorFixture = {
  owner: FixturePrincipal;
  recipients: FixtureRecipient[];
  courseIds: string[];
};

describe("teaching-course collaborator ACL on real PostgreSQL", () => {
  const env = { UAIS_CORE_DATABASE_URL: databaseUrl };
  const suffix = randomUUID().replaceAll("-", "");
  const accountPrefix = `collab.it.${suffix}.`;
  const coursePrefix = `collab-it-${suffix}-`;
  const requestPrefix = `collab-it-${suffix}-`;
  const fixtureTimestamp = "2026-08-25T08:00:00.000Z";

  function client() {
    return getUaisCoreDatabasePool({ env });
  }

  function store() {
    return createTeachingCourseCollaboratorPostgresStore({
      env,
      now: () => new Date(fixtureTimestamp),
    });
  }

  async function createTeacher(label: string): Promise<FixturePrincipal> {
    const account = `${accountPrefix}${label}`;
    const rows = await client().sql`
      INSERT INTO uais_users (
        account,
        role,
        display_name,
        department,
        status
      ) VALUES (
        ${account},
        'teacher',
        'Collaborator integration actor',
        'Integration',
        'active'
      )
      RETURNING id
    `;
    return {
      id: readRequiredUuid(rows[0]?.id, `${label} id`),
      account,
    };
  }

  async function createFixture(input: {
    label: string;
    courseCount?: number;
    recipientCount?: number;
  }): Promise<CollaboratorFixture> {
    const database = client();
    const ownerAccount = `${accountPrefix}${input.label}.owner`;
    const ownerRows = await database.sql`
      INSERT INTO uais_users (
        account,
        role,
        display_name,
        department,
        status
      ) VALUES (
        ${ownerAccount},
        'teacher',
        'Collaborator integration owner',
        'Integration',
        'active'
      )
      RETURNING id
    `;
    const ownerId = readRequiredUuid(ownerRows[0]?.id, "owner id");
    const courseIds: string[] = [];
    for (let index = 0; index < (input.courseCount ?? 1); index += 1) {
      const courseId = `${coursePrefix}${input.label}-${index + 1}`;
      courseIds.push(courseId);
      await database.sql`
        INSERT INTO uais_teaching_course_management_snapshots (
          snapshot_key,
          database,
          revision,
          updated_at
        ) VALUES (
          ${courseId},
          ${JSON.stringify({
            schemaVersion: "uais-teaching-course-management-v1",
            updatedAt: fixtureTimestamp,
            courses: [
              {
                courseId,
                ownerTeacherId: ownerAccount,
                status: "draft",
              },
            ],
          })}::text::jsonb,
          ${`rev-${input.label}-${index + 1}`},
          ${fixtureTimestamp}
        )
      `;
    }

    const recipients: FixtureRecipient[] = [];
    for (let index = 0; index < (input.recipientCount ?? 1); index += 1) {
      const recipientAccount = `${accountPrefix}${input.label}.recipient.${index + 1}`;
      const recipientEmail = `${input.label}.${index + 1}.${suffix}@example.test`;
      const recipientRows = await database.sql`
        INSERT INTO uais_users (
          account,
          role,
          display_name,
          department,
          status
        ) VALUES (
          ${recipientAccount},
          'teacher',
          'Collaborator integration recipient',
          'Integration',
          'active'
        )
        RETURNING id
      `;
      const recipientId = readRequiredUuid(
        recipientRows[0]?.id,
        "recipient id",
      );
      const identifierRows = await database.sql`
        INSERT INTO uais_user_login_identifiers (
          identifier,
          user_id,
          identifier_kind
        ) VALUES (
          ${recipientEmail},
          ${recipientId},
          'email'
        )
        RETURNING identifier_id
      `;
      recipients.push({
        id: recipientId,
        account: recipientAccount,
        email: recipientEmail,
        identifierId: readRequiredUuid(
          identifierRows[0]?.identifier_id,
          "identifier id",
        ),
      });
    }

    return {
      owner: { id: ownerId, account: ownerAccount },
      recipients,
      courseIds,
    };
  }

  async function grant(input: {
    fixture: CollaboratorFixture;
    courseIndex?: number;
    recipientIndex?: number;
    key: string;
    traceId: string;
  }) {
    const courseId = input.fixture.courseIds[input.courseIndex ?? 0];
    const recipient = input.fixture.recipients[input.recipientIndex ?? 0];
    if (!courseId || !recipient) {
      throw new Error("collaborator integration fixture is incomplete");
    }
    return store().grant({
      actorAccount: input.fixture.owner.account,
      courseId,
      recipientEmail: recipient.email,
      role: "observer",
      scopes: ["course.read"],
      idempotencyKey: input.key,
      traceId: input.traceId,
    });
  }

  async function dropIdempotencyFailureTrigger() {
    const database = client();
    await database.sql`
      DROP TRIGGER IF EXISTS uais_test_reject_course_collaborator_idempotency
      ON uais_idempotency_records
    `;
    await database.sql`
      DROP FUNCTION IF EXISTS public.uais_test_reject_course_collaborator_idempotency()
    `;
  }

  beforeAll(async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(
      process.execPath,
      ["scripts/apply-core-migrations.mjs"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          UAIS_CORE_DATABASE_URL: databaseUrl,
        } as NodeJS.ProcessEnv,
      },
    );
    await dropIdempotencyFailureTrigger();
  }, 180_000);

  afterAll(async () => {
    const database = client();
    try {
      await dropIdempotencyFailureTrigger();
      await database.sql`
        DELETE FROM uais_idempotency_records
        WHERE idempotency_key LIKE ${`${requestPrefix}%`}
      `;
      await database.sql`
        DELETE FROM uais_audit_log
        WHERE trace_id LIKE ${`${requestPrefix}%`}
      `;
      await database.sql`
        DELETE FROM uais_teaching_course_management_snapshots
        WHERE snapshot_key LIKE ${`${coursePrefix}%`}
      `;
      await database.sql`
        DELETE FROM uais_user_login_identifiers
        WHERE identifier LIKE ${`%.${suffix}@example.test`}
      `;
      await database.sql`
        DELETE FROM uais_users
        WHERE account LIKE ${`${accountPrefix}%`}
      `;
    } finally {
      await resetUaisCoreDatabasePoolForTesting();
    }
  }, 60_000);

  it("applies both ACL migrations and nulls retained identifier references", async () => {
    const fixture = await createFixture({ label: "identifier-null" });
    const receipt = await grant({
      fixture,
      key: `${requestPrefix}identifier-null`,
      traceId: `${requestPrefix}identifier-null`,
    });
    const database = client();

    const ledgerRows = await database.sql`
      SELECT version, checksum
      FROM uais_schema_migrations
      WHERE version IN (
        '0011_course_collaborator_acl',
        '0012_course_collaborator_identifier_retention'
      )
      ORDER BY version
    `;
    expect(ledgerRows.map((row) => row.version)).toEqual([
      "0011_course_collaborator_acl",
      "0012_course_collaborator_identifier_retention",
    ]);
    expect(
      ledgerRows.every((row) => /^[a-f0-9]{64}$/.test(String(row.checksum))),
    ).toBe(true);

    const indexRows = await database.sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'uais_course_collaborator_grants_recipient_identifier_idx',
          'uais_course_collaborator_notification_recipient_identifier_idx'
        )
      ORDER BY indexname
    `;
    expect(indexRows.map((row) => row.indexname)).toEqual([
      "uais_course_collaborator_grants_recipient_identifier_idx",
      "uais_course_collaborator_notification_recipient_identifier_idx",
    ]);

    await database.sql`
      DELETE FROM uais_user_login_identifiers
      WHERE identifier_id = ${fixture.recipients[0]?.identifierId}
    `;
    const references = await database.sql`
      SELECT
        collaborator_grant.recipient_identifier_id AS grant_identifier_id,
        outbox.recipient_identifier_id AS outbox_identifier_id
      FROM uais_course_collaborator_grants collaborator_grant
      JOIN uais_course_collaborator_notification_outbox outbox
        ON outbox.grant_id = collaborator_grant.id
      WHERE collaborator_grant.id = ${receipt.grantId}
    `;
    expect(references).toEqual([
      { grant_identifier_id: null, outbox_identifier_id: null },
    ]);
  }, 120_000);

  it("restricts grantor and revoker deletion and cascades course, recipient, and outbox deletion", async () => {
    const courseCascade = await createFixture({ label: "course-cascade" });
    const courseReceipt = await grant({
      fixture: courseCascade,
      key: `${requestPrefix}course-cascade`,
      traceId: `${requestPrefix}course-cascade`,
    });
    const database = client();

    await expectRestrictedUserDeletion(
      database.sql`
        DELETE FROM uais_users
        WHERE id = ${courseCascade.owner.id}
      `,
      "uais_course_collaborator_grants_granted_by_user_id_fkey",
    );

    const revoker = await createTeacher("course-cascade.revoker");
    const revokedRows = await database.sql`
      UPDATE uais_course_collaborator_grants
      SET revoked_at = '2026-08-25T08:00:01.000Z',
          revoked_by_user_id = ${revoker.id},
          revision = revision + 1,
          updated_at = '2026-08-25T08:00:01.000Z'
      WHERE id = ${courseReceipt.grantId}
      RETURNING granted_by_user_id, revoked_by_user_id, revoked_at
    `;
    expect(revokedRows).toHaveLength(1);
    expect(revokedRows[0]).toMatchObject({
      granted_by_user_id: courseCascade.owner.id,
      revoked_by_user_id: revoker.id,
    });
    expect(revokedRows[0]?.revoked_at).toBeTruthy();
    await expectRestrictedUserDeletion(
      database.sql`
        DELETE FROM uais_users
        WHERE id = ${revoker.id}
      `,
      "uais_course_collaborator_grants_revoked_by_user_id_fkey",
    );

    await database.sql`
      DELETE FROM uais_teaching_course_management_snapshots
      WHERE snapshot_key = ${courseCascade.courseIds[0]}
    `;
    const courseCascadeRows = await database.sql`
      SELECT
        (SELECT count(*)::integer
         FROM uais_course_collaborator_grants
         WHERE id = ${courseReceipt.grantId}) AS grants,
        (SELECT count(*)::integer
         FROM uais_course_collaborator_notification_outbox
         WHERE grant_id = ${courseReceipt.grantId}) AS outbox
    `;
    expect(courseCascadeRows[0]).toMatchObject({ grants: 0, outbox: 0 });

    const recipientCascade = await createFixture({ label: "recipient-cascade" });
    const recipientReceipt = await grant({
      fixture: recipientCascade,
      key: `${requestPrefix}recipient-cascade`,
      traceId: `${requestPrefix}recipient-cascade`,
    });
    await database.sql`
      DELETE FROM uais_users
      WHERE id = ${recipientCascade.recipients[0]?.id}
    `;
    const recipientCascadeRows = await database.sql`
      SELECT
        (SELECT count(*)::integer
         FROM uais_course_collaborator_grants
         WHERE id = ${recipientReceipt.grantId}) AS grants,
        (SELECT count(*)::integer
         FROM uais_course_collaborator_notification_outbox
         WHERE grant_id = ${recipientReceipt.grantId}) AS outbox
    `;
    expect(recipientCascadeRows[0]).toMatchObject({ grants: 0, outbox: 0 });
  }, 120_000);

  it("rolls back grant, audit, and outbox when the final idempotency insert fails", async () => {
    const fixture = await createFixture({ label: "late-rollback" });
    const key = `${requestPrefix}late-rollback`;
    const traceId = `${requestPrefix}late-rollback`;
    const database = client();

    await database.sql`
      CREATE OR REPLACE FUNCTION public.uais_test_reject_course_collaborator_idempotency()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        RAISE EXCEPTION 'forced collaborator idempotency failure'
          USING ERRCODE = 'P0001';
        RETURN NEW;
      END;
      $function$
    `;
    await database.sql`
      CREATE TRIGGER uais_test_reject_course_collaborator_idempotency
      BEFORE INSERT ON uais_idempotency_records
      FOR EACH ROW
      EXECUTE FUNCTION public.uais_test_reject_course_collaborator_idempotency()
    `;

    try {
      await expect(
        grant({ fixture, key, traceId }),
      ).rejects.toThrow("forced collaborator idempotency failure");
    } finally {
      await dropIdempotencyFailureTrigger();
    }

    const rollbackRows = await database.sql`
      SELECT
        (SELECT count(*)::integer
         FROM uais_course_collaborator_grants
         WHERE course_id = ${fixture.courseIds[0]}) AS grants,
        (SELECT count(*)::integer
         FROM uais_audit_log
         WHERE trace_id = ${traceId}) AS audits,
        (SELECT count(*)::integer
         FROM uais_course_collaborator_notification_outbox
         WHERE recipient_user_id = ${fixture.recipients[0]?.id}) AS outbox,
        (SELECT count(*)::integer
         FROM uais_idempotency_records
         WHERE idempotency_key = ${key}) AS idempotency
    `;
    expect(rollbackRows[0]).toMatchObject({
      grants: 0,
      audits: 0,
      outbox: 0,
      idempotency: 0,
    });
  }, 120_000);

  it("serializes one idempotency key globally across grant and revoke scopes", async () => {
    const fixture = await createFixture({
      label: "global-key",
      courseCount: 2,
      recipientCount: 2,
    });
    const prepared = await grant({
      fixture,
      courseIndex: 0,
      recipientIndex: 0,
      key: `${requestPrefix}global-key-prepared`,
      traceId: `${requestPrefix}global-key-prepared`,
    });
    const key = `${requestPrefix}global-key-contended`;
    const grantTrace = `${requestPrefix}global-key-grant`;
    const revokeTrace = `${requestPrefix}global-key-revoke`;
    const backendPids = new Set<number>();
    let barrierArrivals = 0;
    let releaseBarrier: () => void = () => undefined;
    const bothConnectionsReady = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const contendedStore = createTeachingCourseCollaboratorPostgresStore({
      env,
      now: () => new Date(fixtureTimestamp),
      createDatabase: () => {
        const database = createUaisCoreDatabase({ env, max: 1 });
        return {
          sql: {
            begin: async (run: (sql: TransactionSql) => Promise<void>) => {
              await database.sql.begin(async (sql) => {
                const backendRows = await sql`
                  SELECT pg_backend_pid() AS backend_pid
                `;
                const backendPid = Number(backendRows[0]?.backend_pid);
                if (!Number.isSafeInteger(backendPid) || backendPid <= 0) {
                  throw new Error("missing collaborator contention backend PID");
                }
                backendPids.add(backendPid);
                barrierArrivals += 1;
                if (barrierArrivals === 2) releaseBarrier();
                await bothConnectionsReady;
                await run(sql);
              });
            },
            end: (options) => database.sql.end(options),
          },
        };
      },
    });

    const outcomes = await Promise.allSettled([
      contendedStore.grant({
        actorAccount: fixture.owner.account,
        courseId: fixture.courseIds[1] ?? "",
        recipientEmail: fixture.recipients[1]?.email ?? "",
        role: "observer",
        scopes: ["course.read"],
        idempotencyKey: key,
        traceId: grantTrace,
      }),
      contendedStore.revoke({
        actorAccount: fixture.owner.account,
        courseId: fixture.courseIds[0] ?? "",
        grantId: prepared.grantId,
        idempotencyKey: key,
        traceId: revokeTrace,
      }),
    ]);

    expect(backendPids.size).toBe(2);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    if (!rejected || rejected.status !== "rejected") {
      throw new Error("one contended collaborator request must be rejected");
    }
    expect(rejected.reason).toBeInstanceOf(TeachingCourseCollaboratorStoreError);
    expect(rejected.reason).toMatchObject({
      status: 409,
      reasonCode: "idempotency-key-scope-conflict",
    });

    const database = client();
    const contentionRows = await database.sql`
      SELECT
        (SELECT count(*)::integer
         FROM uais_idempotency_records
         WHERE idempotency_key = ${key}) AS idempotency,
        (SELECT count(*)::integer
         FROM uais_audit_log
         WHERE trace_id IN (${grantTrace}, ${revokeTrace})) AS audits
    `;
    expect(contentionRows[0]).toMatchObject({ idempotency: 1, audits: 1 });
  }, 120_000);

  it("preserves aggregate serialization for different keys targeting one canonical grant row", async () => {
    // This public-operation case proves the aggregate canonical-row outcome.
    // The focused injected-SQL test separately pins the resource advisory-lock
    // statement and ordering; the owner snapshot lock may also serialize this
    // end-to-end path before the resource lock is reached.
    const fixture = await createFixture({ label: "resource-lock" });
    const firstKey = `${requestPrefix}resource-lock-a`;
    const secondKey = `${requestPrefix}resource-lock-b`;
    const receipts = await Promise.all([
      grant({
        fixture,
        key: firstKey,
        traceId: `${requestPrefix}resource-lock-a`,
      }),
      grant({
        fixture,
        key: secondKey,
        traceId: `${requestPrefix}resource-lock-b`,
      }),
    ]);

    expect(receipts.map((receipt) => receipt.status).sort()).toEqual([
      "already-active",
      "persisted",
    ]);
    expect(new Set(receipts.map((receipt) => receipt.grantId)).size).toBe(1);
    expect(receipts.every((receipt) => receipt.revision === 1)).toBe(true);

    const grantId = receipts[0]?.grantId ?? "";
    const database = client();
    const serializationRows = await database.sql`
      SELECT
        (SELECT count(*)::integer
         FROM uais_course_collaborator_grants
         WHERE id = ${grantId}) AS grants,
        (SELECT count(*)::integer
         FROM uais_audit_log
         WHERE target_id = ${grantId}
           AND action = 'course-collaborator-grant-issued') AS audits,
        (SELECT count(*)::integer
         FROM uais_course_collaborator_notification_outbox
         WHERE grant_id = ${grantId}
           AND event_type = 'grant-issued') AS outbox,
        (SELECT count(*)::integer
         FROM uais_idempotency_records
         WHERE idempotency_key IN (${firstKey}, ${secondKey})) AS idempotency
    `;
    expect(serializationRows[0]).toMatchObject({
      grants: 1,
      audits: 1,
      outbox: 1,
      idempotency: 2,
    });
  }, 120_000);
});

async function expectRestrictedUserDeletion(
  operation: PromiseLike<unknown>,
  expectedConstraint: string,
) {
  let rejection: unknown;
  try {
    await operation;
  } catch (error) {
    rejection = error;
  }

  expect(rejection).toMatchObject({ constraint_name: expectedConstraint });
  const code =
    rejection && typeof rejection === "object" && "code" in rejection
      ? rejection.code
      : undefined;
  // PostgreSQL 18 reports the SQL-standard RESTRICT violation (23001).
  // Supported 15-17 targets report the broader foreign-key violation (23503).
  expect(["23001", "23503"]).toContain(code);
}

function readRequiredUuid(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`missing ${label}`);
  }
  return value;
}
