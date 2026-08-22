// Read-only, redacted preflight for the P1 0008/0009 migrations.
// It intentionally reports counts and state categories only; it never selects
// submission content, feedback text, credentials, or identities.
import { argv, env } from "node:process";
import postgres from "postgres";

const migrations = [
  "0008_learning_closed_loop_domain",
  "0009_learning_event_outbox",
];
const countNames = [
  "users",
  "courses",
  "lessons",
  "assessments",
  "submissions",
  "learningEvents",
  "learnerProfiles",
  "recommendations",
];
const plan = {
  target: "learning-loop-migration-preflight",
  status: "plan",
  migrations,
  counts: countNames,
  legacySubmissionStates: ["draft", "submitted", "reviewed", "returned"],
  safety: {
    readOnly: true,
    studentContentSelected: false,
    feedbackTextSelected: false,
    identitiesSelected: false,
  },
  valueRedacted: true,
};

if (argv.includes("--plan")) {
  process.stdout.write(`${JSON.stringify(plan)}\n`);
} else {
  await runLivePreflight();
}

async function runLivePreflight() {
  const selected = readDatabaseUrl();
  if (!selected) {
    process.stderr.write(
      `${JSON.stringify({
        target: plan.target,
        status: "blocked",
        reasonCode: "managed-postgres-url-required",
        acceptedEnvNames: ["UAIS_CORE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"],
        valueRedacted: true,
      })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const sql = postgres(selected.value, { max: 1, prepare: false });
  try {
    let report;
    await sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      const [counts] = await tx`
        SELECT
          (SELECT count(*)::integer FROM uais_users) AS users,
          (SELECT count(*)::integer FROM uais_courses) AS courses,
          (SELECT count(*)::integer FROM uais_lessons) AS lessons,
          (SELECT count(*)::integer FROM uais_assessments) AS assessments,
          (SELECT count(*)::integer FROM uais_submissions) AS submissions,
          (SELECT count(*)::integer FROM uais_learning_events) AS learning_events,
          (SELECT count(*)::integer FROM uais_learner_profiles) AS learner_profiles,
          (SELECT count(*)::integer FROM uais_recommendations) AS recommendations
      `;
      const submissionStates = await tx`
        SELECT state, count(*)::integer AS count
        FROM uais_submissions
        GROUP BY state
        ORDER BY state
      `;
      const [duplicates] = await tx`
        SELECT count(*)::integer AS duplicate_groups
        FROM (
          SELECT assessment_id, user_id
          FROM uais_submissions
          GROUP BY assessment_id, user_id
          HAVING count(*) > 1
        ) duplicate_submission_groups
      `;
      const appliedMigrations = await tx`
        SELECT version
        FROM uais_schema_migrations
        WHERE version = ANY(${migrations})
        ORDER BY version
      `;
      report = {
        target: plan.target,
        status:
          Number(duplicates?.duplicate_groups ?? 0) === 0 ? "ready" : "blocked",
        reasonCode:
          Number(duplicates?.duplicate_groups ?? 0) === 0
            ? "preflight-counts-recorded"
            : "duplicate-legacy-submissions-require-reconciliation",
        selectedEnvName: selected.name,
        migrations,
        appliedMigrations: appliedMigrations.map((row) => row.version),
        counts: {
          users: Number(counts?.users ?? 0),
          courses: Number(counts?.courses ?? 0),
          lessons: Number(counts?.lessons ?? 0),
          assessments: Number(counts?.assessments ?? 0),
          submissions: Number(counts?.submissions ?? 0),
          learningEvents: Number(counts?.learning_events ?? 0),
          learnerProfiles: Number(counts?.learner_profiles ?? 0),
          recommendations: Number(counts?.recommendations ?? 0),
        },
        submissionStates: submissionStates.map((row) => ({
          state: row.state,
          count: Number(row.count),
        })),
        duplicateAssessmentUserGroups: Number(duplicates?.duplicate_groups ?? 0),
        safety: plan.safety,
        valueRedacted: true,
      };
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report?.status !== "ready") process.exitCode = 1;
  } catch {
    process.stderr.write(
      `${JSON.stringify({
        target: plan.target,
        status: "blocked",
        reasonCode: "preflight-query-failed",
        valueRedacted: true,
      })}\n`,
    );
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function readDatabaseUrl() {
  for (const name of ["UAIS_CORE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"]) {
    const value = env[name]?.trim();
    if (value) return { name, value };
  }
  return undefined;
}
