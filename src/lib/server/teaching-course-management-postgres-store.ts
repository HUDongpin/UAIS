import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import {
  mergeTeachingCourseManagementCourseDatabases,
  selectTeachingClassInviteCodeClaims,
  selectTeachingCourseManagementCourseDatabase,
} from "@/lib/server/teaching-course-management-course-partition";
import {
  createEmptyDatabase,
  normalizeTeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-database-normalizer";
import {
  TeachingCourseManagementStoreError,
  type TeachingCourseManagementDatabase,
  type TeachingCourseManagementRepository,
  type TeachingCourseManagementStorageDescriptor,
} from "@/lib/server/teaching-course-management-store";

// Course management on the core database, ONE ROW PER COURSE.
//
// It used to be a single row keyed 'default' holding every course, class,
// membership, group and audit event in the deployment. Every teacher action and
// every student join took FOR UPDATE on that row and rewrote the whole corpus,
// and the optimistic revision was a sha256 of all of it - so two teachers in
// unrelated departments serialised behind each other, an approval could lose to
// a class creation three courses away, and the row grew without bound while the
// chatroom's authorization read had to pull all of it on every 2.5s poll.
// migrations/0004_app_account_login.sql already documents why that shape must
// not spread; this is the store it was written about.
//
// The key is now the course id, so a row is contended only by the people working
// on ITS course and its revision moves only when that course moves. The row
// still holds the same database envelope the application reads, carrying just
// that course's records, so no reader learns a new shape. See
// migrations/0007_teaching_course_management_per_course.sql, which retires the
// old row.
//
// Two things stay corpus-wide on purpose:
//   * READS that legitimately span courses - the course list, invite-code
//     discovery, the operations exports - enumerate the rows and merge them.
//     They carry no revision: there is no single row for an optimistic guard to
//     be about, and inventing one would let a corpus-wide writer believe it had
//     a lock it never took.
//   * The 8-DIGIT INVITE-CODE NAMESPACE, which is not a record and cannot be
//     partitioned: a student joins with a bare code and no course context, so
//     two courses must never mint the same one. It gets its own dedicated table
//     (`uais_teaching_class_invite_code_claims`) which every course write
//     reconciles inside the same transaction, so a cross-course collision aborts
//     the write instead of silently pointing a join at the wrong course.

// Test seam. The store reaches a real Postgres through the pooled accessor;
// injecting that factory lets a suite drive the SQL shape, the revision guard,
// the claims reconciliation and the connection cleanup without a server, which
// is the difference between "this compiles" and "this issues the statements it
// claims to".
export type TeachingCourseManagementPostgresClientFactory = (input: {
  env: Record<string, string | undefined>;
  max?: number;
}) => {
  sql: {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    begin: (run: (sql: never) => Promise<void>) => Promise<void>;
    end: (options?: { timeout?: number }) => Promise<void>;
  };
};

const postgresTeachingCourseManagementStorage: TeachingCourseManagementStorageDescriptor = {
  recordStoragePolicy: "postgres-teaching-course-management-snapshot",
  auditStoragePolicy: "postgres-teaching-course-management-audit-log",
  storageWritePolicy: "postgres-transactional-snapshot-replace",
};

// The selector is no longer read here. `selectUaisDurableSnapshotBackend` is
// the single reader for the whole snapshot family, so that course management
// and the chatroom stores cannot resolve to different backends from the same
// environment - see uais-durable-snapshot-backend.ts.

export function createUaisTeachingCourseManagementPostgresRepository(input: {
  env: Record<string, string | undefined>;
  createDatabase?: TeachingCourseManagementPostgresClientFactory;
}): TeachingCourseManagementRepository {
  const readiness = getUaisCoreDatabaseReadiness(input.env);
  if (readiness.status !== "ready") {
    throw new TeachingCourseManagementStoreError(
      503,
      "Postgres teaching course management storage requires UAIS_CORE_DATABASE_URL.",
      {
        coreDatabase: readiness,
      },
    );
  }

  return {
    storage: postgresTeachingCourseManagementStorage,
    read: async (scope) => {
      const courseKey = readCourseKey(scope?.courseId);
      const client = (input.createDatabase ?? getUaisCoreDatabasePool)({ env: input.env });
      try {
        // An unnamed course means "every course", which is how the course list,
        // the invite-code lookup and the operations exports still work after the
        // re-key.
        if (!courseKey) {
          const rows = await client.sql`
            SELECT database
            FROM uais_teaching_course_management_snapshots
            ORDER BY snapshot_key
          `;
          return { database: mergeTeachingCourseManagementCourseDatabases(rows) };
        }

        const rows = await client.sql`
          SELECT database, revision
          FROM uais_teaching_course_management_snapshots
          WHERE snapshot_key = ${courseKey}
        `;

        if (rows.length === 0) {
          return {
            database: createEmptyDatabase(),
          };
        }

        const row = rows[0] as {
          database?: unknown;
          revision?: unknown;
        };
        const revision = typeof row.revision === "string" ? row.revision.trim() : "";
        return {
          database: normalizeTeachingCourseManagementDatabase(row.database),
          ...(revision ? { revision } : {}),
        };
      } finally {
        // Releases an injected test double or a disposable client exactly as
        // before; a pooled client is kept open for the next request. See
        // closeUaisCoreDatabaseClient for why the distinction is a marker
        // rather than a flag the caller passes.
        await closeUaisCoreDatabaseClient(client);
      }
    },
    write: async ({ database, expectedRevision, courseId }) => {
      const courseKey = readCourseKey(courseId);
      if (!courseKey) {
        // A corpus-wide replace is no longer expressible: it would have to take
        // every course's lock at once, and its expectedRevision would be about a
        // row that no longer exists. Refusing loudly beats writing the whole
        // deployment's course management into one course's row.
        throw new TeachingCourseManagementStoreError(
          500,
          "Postgres teaching course management writes are per course and require a course id.",
        );
      }
      const courseDatabase = selectTeachingCourseManagementCourseDatabase(
        database,
        courseKey,
      );
      const revision = createTeachingCourseManagementSnapshotRevision(courseDatabase);
      const claims = selectTeachingClassInviteCodeClaims(courseDatabase);
      const client = (input.createDatabase ?? getUaisCoreDatabasePool)({ env: input.env });
      try {
        await client.sql.begin(async (sql: TransactionSql) => {
          const rows = await sql`
            SELECT revision
            FROM uais_teaching_course_management_snapshots
            WHERE snapshot_key = ${courseKey}
            FOR UPDATE
          `;
          const currentRevision =
            typeof rows[0]?.revision === "string" ? rows[0].revision.trim() : undefined;
          // Strict equality, not "both sides present": a writer that read no row
          // and then finds one has been overtaken by whoever created the course,
          // and overwriting it would silently drop that teacher's first record.
          if (rows.length > 0 && currentRevision !== expectedRevision) {
            throw new TeachingCourseManagementStoreError(
              409,
              "Postgres teaching course management snapshot changed; retry required.",
            );
          }

          // Serialize to a JSON string and cast text -> jsonb. Do NOT pass the
          // object (via sql.json() or directly): in postgres v3.4.9 a jsonb
          // parameter that the server describes as type 3802 reaches Bind
          // unserialized inside sql.begin() and throws "The string argument must
          // be of type string ... Received an instance of Object". Forcing the
          // parameter to text ($n::text) sends the raw JSON string, then ::jsonb
          // parses it server-side. Verified against a real Postgres round-trip.
          //
          // The WHERE on the conflict path closes the window FOR UPDATE cannot:
          // a lock on a row that does not exist yet locks nothing, so two
          // requests creating the same course at the same instant both see no row
          // and both insert. The second one's DO UPDATE is then skipped,
          // RETURNING is empty, and it retries against the row the first one
          // committed.
          const applied = await sql`
            INSERT INTO uais_teaching_course_management_snapshots (
              snapshot_key,
              database,
              revision,
              updated_at
            )
            VALUES (
              ${courseKey},
              ${JSON.stringify(courseDatabase)}::text::jsonb,
              ${revision},
              now()
            )
            ON CONFLICT (snapshot_key)
            DO UPDATE SET
              database = EXCLUDED.database,
              revision = EXCLUDED.revision,
              updated_at = EXCLUDED.updated_at
            WHERE uais_teaching_course_management_snapshots.revision
              IS NOT DISTINCT FROM ${expectedRevision ?? null}::text
            RETURNING snapshot_key
          `;
          if (applied.length === 0) {
            throw new TeachingCourseManagementStoreError(
              409,
              "Postgres teaching course management snapshot changed; retry required.",
            );
          }

          await reconcileTeachingClassInviteCodeClaims({ sql, courseKey, claims });
        });
      } finally {
        // Releases an injected test double or a disposable client exactly as
        // before; a pooled client is kept open for the next request. See
        // closeUaisCoreDatabaseClient for why the distinction is a marker
        // rather than a flag the caller passes.
        await closeUaisCoreDatabaseClient(client);
      }
    },
  };
}

// The one invariant the re-key cannot express as a row: an invite code is
// unique across the whole deployment, because a student types the code alone.
//
// This runs inside the course row's transaction, so a code the course no longer
// holds is released and a code another course already holds aborts the write
// rather than leaving two classes reachable by the same 8 digits. The handlers
// already retry a 409 against a freshly read corpus, which is exactly the right
// answer: the loser re-allocates the next free code.
//
// The claims are a projection of the course rows, rebuilt from the envelope on
// every write, so they cannot drift into a second source of truth - at worst a
// crashed write leaves a code reserved that nobody holds, which fails closed.
async function reconcileTeachingClassInviteCodeClaims(input: {
  sql: TransactionSql;
  courseKey: string;
  claims: Array<{ inviteCode: string; classId: string }>;
}) {
  const claimsJson = JSON.stringify(input.claims);

  // An empty claim list makes the NOT IN subquery empty, so this releases every
  // code the course held - which is what a rolled-back course creation means.
  await input.sql`
    DELETE FROM uais_teaching_class_invite_code_claims
    WHERE course_id = ${input.courseKey}
      AND invite_code NOT IN (
        SELECT claim->>'inviteCode'
        FROM jsonb_array_elements(${claimsJson}::text::jsonb) AS claim
      )
  `;

  if (input.claims.length === 0) {
    return;
  }

  // Same text -> jsonb cast, same reason as the snapshot above. The WHERE on the
  // conflict path is the cross-course gate: a code this course already holds is
  // refreshed, a code another course holds is skipped, and the short RETURNING
  // is how the store learns that happened.
  const claimed = await input.sql`
    INSERT INTO uais_teaching_class_invite_code_claims (
      invite_code,
      course_id,
      class_id,
      claimed_at
    )
    SELECT
      claim->>'inviteCode',
      ${input.courseKey},
      claim->>'classId',
      now()
    FROM jsonb_array_elements(${claimsJson}::text::jsonb) AS claim
    ON CONFLICT (invite_code)
    DO UPDATE SET
      class_id = EXCLUDED.class_id,
      claimed_at = EXCLUDED.claimed_at
    WHERE uais_teaching_class_invite_code_claims.course_id = ${input.courseKey}
    RETURNING invite_code
  `;
  if (claimed.length !== input.claims.length) {
    throw new TeachingCourseManagementStoreError(
      409,
      "Teaching class invite code already exists.",
    );
  }
}

function readCourseKey(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function createTeachingCourseManagementSnapshotRevision(
  database: TeachingCourseManagementDatabase,
) {
  return `rev-${createHash("sha256").update(JSON.stringify(database)).digest("hex").slice(0, 24)}`;
}
