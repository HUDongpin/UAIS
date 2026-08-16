// The one place the core-database migration inventory is written down for code
// that cannot read the `migrations/` directory.
//
// It used to be written down three times: this module (0001 only), the readiness
// contract in src/lib/db/core-database.ts (`migrations: ["0001_core_poc"]`, also
// 0001 only), and the runner in scripts/apply-core-migrations.mjs (all of them).
// The runner grew 0002-0007 and the other two did not, so every readiness report
// the release evidence collected claimed a one-migration database while the
// deployment needed seven - the reports were most confident exactly where they
// were most wrong.
//
// The directory is now the single source of truth: the runner derives its work
// list from `migrations/*.sql` and can no longer lag behind a file that exists,
// and `tests/core-database-foundation.test.ts` pins this list against the same
// directory so the projection below cannot drift either. It stays a literal
// because its consumers run where the directory does not: /healthz executes from
// a serverless bundle that traces `.ts` imports and no `.sql` files.
export const UAIS_CORE_DATABASE_MIGRATIONS = [
  {
    version: "0001_core_poc",
    path: "migrations/0001_core_poc.sql",
    tables: [
      "uais_users",
      "uais_courses",
      "uais_lessons",
      "uais_classes",
      "uais_invite_codes",
      "uais_enrollments",
      "uais_assessments",
      "uais_submissions",
      "uais_learning_events",
      "uais_learner_profiles",
      "uais_recommendations",
      "uais_audit_log",
      "uais_export_jobs",
      "uais_provider_jobs",
      "uais_teaching_course_management_snapshots",
    ],
  },
  {
    version: "0002_teaching_operations",
    path: "migrations/0002_teaching_operations.sql",
    tables: ["uais_teaching_operations_snapshots"],
  },
  {
    version: "0003_learning_chatroom",
    path: "migrations/0003_learning_chatroom.sql",
    tables: [
      "uais_learning_chatroom_transcript_snapshots",
      "uais_learning_chatroom_share_snapshots",
    ],
  },
  {
    version: "0004_app_account_login",
    path: "migrations/0004_app_account_login.sql",
    tables: ["uais_app_login_failures"],
  },
  {
    version: "0005_user_login_identifiers",
    path: "migrations/0005_user_login_identifiers.sql",
    tables: ["uais_user_login_identifiers"],
  },
  {
    version: "0006_learning_chatroom_per_room",
    path: "migrations/0006_learning_chatroom_per_room.sql",
    tables: ["uais_learning_chatroom_transcript_snapshots_retired"],
  },
  {
    version: "0007_teaching_course_management_per_course",
    path: "migrations/0007_teaching_course_management_per_course.sql",
    tables: [
      "uais_teaching_class_invite_code_claims",
      "uais_teaching_course_management_snapshots_retired",
    ],
  },
] as const;

export type UaisCoreDatabaseMigrationVersion =
  (typeof UAIS_CORE_DATABASE_MIGRATIONS)[number]["version"];

/** The versions the runner records, in the order it applies them. */
export const UAIS_CORE_DATABASE_MIGRATION_VERSIONS: readonly UaisCoreDatabaseMigrationVersion[] =
  UAIS_CORE_DATABASE_MIGRATIONS.map((migration) => migration.version);

/**
 * The ledger `scripts/apply-core-migrations.mjs` creates and inserts into, and
 * the table /healthz reads to answer "is this database current for this build".
 * Both name it literally in their SQL, as every store in this repo does;
 * `tests/core-database-foundation.test.ts` asserts this value appears in both
 * sources, so the writer and the reader cannot drift onto different tables.
 */
export const UAIS_CORE_DATABASE_MIGRATIONS_TABLE = "uais_schema_migrations";
