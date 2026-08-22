import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import {
  LearningLoopStoreError,
  type LearningLoopPostgresClientFactory,
} from "@/lib/learning-loop/postgres-store";
import {
  recommendNextLearningAction,
  type NextLearningAction,
} from "@/lib/learning-loop/recommendation";
import type { LearningSubmissionState } from "@/lib/learning-loop/domain";

type ReadSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  begin: (run: (sql: ReadSql) => Promise<void>) => Promise<void>;
  end: (options?: { timeout?: number }) => Promise<void> | void;
};

type ReadStoreOptions = {
  env: Record<string, string | undefined>;
  createDatabase?: LearningLoopPostgresClientFactory;
  now?: () => Date;
};

export function createUaisLearningLoopPostgresReadStore(options: ReadStoreOptions) {
  const readiness = getUaisCoreDatabaseReadiness(options.env);
  if (readiness.status !== "ready") {
    throw new LearningLoopStoreError(503, "core-database-required", {
      target: readiness.target,
      status: readiness.status,
      valueRedacted: true,
    });
  }
  const createDatabase =
    options.createDatabase ??
    (getUaisCoreDatabasePool as unknown as LearningLoopPostgresClientFactory);
  const readNow = options.now ?? (() => new Date());

  return {
    async listActivities(input: {
      teacherAccount: string;
      courseExternalId: string;
    }) {
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const teacherId = await requireUserId(
          client.sql as ReadSql,
          input.teacherAccount,
          "teacher",
        );
        const rows = await (client.sql as ReadSql)`
          SELECT
            a.id, a.activity_key, a.version, a.edit_revision, a.status, a.title_i18n,
            a.instructions_i18n, a.rubric, a.formative_check, a.due_at,
            a.ai_policy, a.revision_policy, a.target_class_external_id,
            a.published_at, a.archived_at, a.updated_at,
            l.external_key AS lesson_key, l.position AS lesson_position
          FROM uais_assessments a
          JOIN uais_lessons l ON l.id = a.lesson_id
          JOIN uais_courses c ON c.id = l.course_id
          WHERE c.slug = ${input.courseExternalId}
            AND c.teacher_id = ${teacherId}
          ORDER BY l.position, a.activity_key, a.version DESC
        `;
        return {
          courseId: input.courseExternalId,
          activities: rows.map(mapTeacherActivity),
          dataFreshAt:
            newestTimestamp(rows.map((row) => readRecord(row).updated_at)) ??
            readNow().toISOString(),
        };
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async readActivity(input: { teacherAccount: string; activityId: string }) {
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const teacherId = await requireUserId(
          client.sql as ReadSql,
          input.teacherAccount,
          "teacher",
        );
        const rows = await (client.sql as ReadSql)`
          SELECT
            a.id, a.activity_key, a.version, a.edit_revision, a.status, a.title_i18n,
            a.instructions_i18n, a.rubric, a.formative_check, a.due_at,
            a.ai_policy, a.revision_policy, a.target_class_external_id,
            a.published_at, a.archived_at, a.updated_at,
            l.external_key AS lesson_key, l.position AS lesson_position,
            c.slug AS course_external_id
          FROM uais_assessments a
          JOIN uais_lessons l ON l.id = a.lesson_id
          JOIN uais_courses c ON c.id = l.course_id
          WHERE a.id = ${input.activityId} AND c.teacher_id = ${teacherId}
          LIMIT 1
        `;
        const row = firstRow(rows);
        if (!row) throw new LearningLoopStoreError(404, "teacher-activity-required");
        return {
          courseId: readString(row.course_external_id),
          activity: mapTeacherActivity(row),
        };
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async readActivityScope(input: { activityId: string }) {
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const rows = await (client.sql as ReadSql)`
          SELECT
            c.slug AS course_external_id,
            a.target_class_external_id AS class_external_id,
            l.external_key AS lesson_key
          FROM uais_assessments a
          JOIN uais_lessons l ON l.id = a.lesson_id
          JOIN uais_courses c ON c.id = l.course_id
          WHERE a.id = ${input.activityId}
          LIMIT 1
        `;
        const row = firstRow(rows);
        if (!row) throw new LearningLoopStoreError(404, "learning-activity-required");
        return {
          courseId: readString(row.course_external_id),
          classId: readString(row.class_external_id),
          lessonKey: readString(row.lesson_key),
        };
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async readStudentUnit(input: {
      studentAccount: string;
      courseExternalId: string;
      classExternalId: string;
      lessonKey: string;
    }) {
      const client = createDatabase({ env: options.env, max: 1 });
      let result: Record<string, unknown> | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const studentId = await requireUserId(sql, input.studentAccount, "student");
          const activityRows = await sql`
            SELECT
              a.id AS activity_id, a.version AS activity_version,
              a.status AS activity_status,
              a.title_i18n, a.instructions_i18n, a.rubric, a.formative_check,
              a.due_at, a.ai_policy, l.id AS lesson_id,
              l.external_key AS lesson_key, l.position AS lesson_position,
              l.title AS lesson_title, c.id AS course_id,
              c.slug AS course_external_id, cl.id AS class_id,
              cl.external_key AS class_external_id
            FROM uais_assessments a
            JOIN uais_lessons l ON l.id = a.lesson_id
            JOIN uais_courses c ON c.id = l.course_id
            JOIN uais_classes cl
              ON cl.course_id = c.id AND cl.external_key = a.target_class_external_id
            WHERE c.slug = ${input.courseExternalId}
              AND cl.external_key = ${input.classExternalId}
              AND l.external_key = ${input.lessonKey}
              AND (
                a.status = 'published'
                OR (
                  a.status = 'archived'
                  AND EXISTS (
                    SELECT 1 FROM uais_submissions existing_submission
                    WHERE existing_submission.assessment_id = a.id
                      AND existing_submission.user_id = ${studentId}
                  )
                )
              )
            ORDER BY
              EXISTS (
                SELECT 1 FROM uais_submissions existing_submission
                WHERE existing_submission.assessment_id = a.id
                  AND existing_submission.user_id = ${studentId}
              ) DESC,
              (a.status = 'published') DESC,
              a.version DESC
            LIMIT 1
          `;
          const activity = firstRow(activityRows);
          if (!activity) {
            throw new LearningLoopStoreError(404, "published-learning-unit-required");
          }

          const attemptRows = await sql`
            SELECT count(*)::integer AS count, max(attempted_at) AS last_attempted_at
            FROM uais_formative_attempts
            WHERE assessment_id = ${readString(activity.activity_id)}
              AND user_id = ${studentId}
          `;
          const attempt = firstRow(attemptRows);
          const attemptCount = readInteger(attempt?.count);
          const submissionRows = await sql`
            SELECT
              s.id AS submission_id, s.state AS submission_state,
              s.current_version_no, v.id AS version_id,
              v.status AS version_status, v.content_text, v.draft_revision,
              v.submitted_at, s.updated_at
            FROM uais_submissions s
            JOIN uais_submission_versions v
              ON v.submission_id = s.id AND v.version_no = s.current_version_no
            WHERE s.assessment_id = ${readString(activity.activity_id)}
              AND s.user_id = ${studentId}
            LIMIT 1
          `;
          const submission = firstRow(submissionRows);
          const versions = submission
            ? await sql`
                SELECT id, version_no, status, content_text, draft_revision, submitted_at
                FROM uais_submission_versions
                WHERE submission_id = ${readString(submission.submission_id)}
                ORDER BY version_no
              `
            : [];
          const feedback = submission
            ? await sql`
                SELECT
                  id, submission_version_id, origin, status, rubric_judgments,
                  feedback_text, requires_revision, released_at
                FROM uais_feedback
                WHERE submission_id = ${readString(submission.submission_id)}
                  AND status IN ('released', 'superseded')
                ORDER BY released_at, created_at
              `
            : [];
          const profileRows = await sql`
            SELECT projection_version, last_event_at
            FROM uais_learner_profiles
            WHERE user_id = ${studentId}
              AND course_id = ${readString(activity.course_id)}
          `;
          const profile = firstRow(profileRows);
          const submissionState = submission
            ? readSubmissionState(submission.submission_state)
            : undefined;
          const currentVersion = submission
            ? {
                id: readString(submission.version_id),
                versionNo: readInteger(submission.current_version_no),
                status: readVersionStatus(submission.version_status),
                contentText: readString(submission.content_text),
                draftRevision: readInteger(submission.draft_revision),
                submittedAt: readOptionalTimestamp(submission.submitted_at),
              }
            : undefined;
          const dataFreshAt = newestTimestamp([
            profile?.last_event_at,
            submission?.updated_at,
            attempt?.last_attempted_at,
          ]) ?? readNow().toISOString();

          result = {
            unit: {
              courseId: readString(activity.course_external_id),
              classId: readString(activity.class_external_id),
              lessonKey: readString(activity.lesson_key),
              position: readInteger(activity.lesson_position),
              title: readString(activity.lesson_title),
            },
            activity: {
              id: readString(activity.activity_id),
              version: readInteger(activity.activity_version),
              status: readActivityState(activity.activity_status),
              title: readRecord(activity.title_i18n),
              instructions: readRecord(activity.instructions_i18n),
              rubric: readArray(activity.rubric),
              checkpoint: createStudentCheckpoint(
                activity.formative_check,
                attemptCount > 0,
              ),
              dueAt: readOptionalTimestamp(activity.due_at),
              aiPolicy: readString(activity.ai_policy),
            },
            formative: {
              attempted: attemptCount > 0,
              attemptCount,
              lastAttemptedAt: readOptionalTimestamp(attempt?.last_attempted_at),
            },
            ...(submission
              ? {
                  submission: {
                    id: readString(submission.submission_id),
                    state: submissionState,
                    currentVersionNo: readInteger(submission.current_version_no),
                    currentVersion,
                    versions: versions.map(mapStudentVersion),
                  },
                }
              : {}),
            feedback: feedback.map(mapStudentFeedback),
            completion: {
              completed: submissionState === "accepted",
              basis: "teacher-accepted-current-version",
            },
            playbackProgress: {
              status: "not-authoritative",
              percent: null,
            },
            projectionVersion: readInteger(profile?.projection_version),
            dataFreshAt,
          };
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      if (!result) {
        throw new LearningLoopStoreError(500, "learning-unit-readback-missing");
      }
      return result as {
        unit: Record<string, unknown>;
        activity: Record<string, unknown>;
        formative: { attempted: boolean; attemptCount: number };
        submission?: Record<string, unknown>;
        feedback: Array<Record<string, unknown>>;
        completion: { completed: boolean; basis: string };
        playbackProgress: { status: string; percent: null };
        projectionVersion: number;
        dataFreshAt: string;
      };
    },

    async readStudentDashboard(input: {
      studentAccount: string;
      scopes: Array<{ courseId: string; courseTitle: string; classId: string }>;
    }) {
      const scopes = normalizeDashboardScopes(input.scopes);
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const studentId = await requireUserId(
          client.sql as ReadSql,
          input.studentAccount,
          "student",
        );
        const rows =
          scopes.length === 0
            ? []
            : await (client.sql as ReadSql)`
                WITH authorized_scope AS (
                  SELECT course_external_id, class_external_id
                  FROM jsonb_to_recordset(${JSON.stringify(
                    scopes.map((scope) => ({
                      course_external_id: scope.courseId,
                      class_external_id: scope.classId,
                    })),
                  )}::text::jsonb) AS scope(
                    course_external_id text,
                    class_external_id text
                  )
                ), latest_activities AS (
                  SELECT DISTINCT ON (c.id, l.id, a.activity_key)
                    c.id AS course_id, c.slug AS course_external_id,
                    cl.external_key AS class_external_id,
                    l.external_key AS lesson_key, l.position AS lesson_position,
                    a.id AS activity_id, a.due_at, a.updated_at AS activity_updated_at
                  FROM authorized_scope scope
                  JOIN uais_courses c ON c.slug = scope.course_external_id
                  JOIN uais_classes cl
                    ON cl.course_id = c.id
                    AND cl.external_key = scope.class_external_id
                  JOIN uais_lessons l ON l.course_id = c.id AND l.status = 'published'
                  JOIN uais_assessments a
                    ON a.lesson_id = l.id
                    AND a.target_class_external_id = cl.external_key
                  LEFT JOIN uais_submissions preferred_submission
                    ON preferred_submission.assessment_id = a.id
                    AND preferred_submission.user_id = ${studentId}
                  WHERE a.status = 'published'
                    OR (a.status = 'archived' AND preferred_submission.id IS NOT NULL)
                  ORDER BY
                    c.id, l.id, a.activity_key,
                    (preferred_submission.id IS NOT NULL) DESC,
                    (a.status = 'published') DESC,
                    a.version DESC
                )
                SELECT
                  la.course_external_id, la.class_external_id,
                  la.lesson_key, la.lesson_position, la.activity_id, la.due_at,
                  EXISTS (
                    SELECT 1 FROM uais_formative_attempts fa
                    WHERE fa.assessment_id = la.activity_id
                      AND fa.user_id = ${studentId}
                  ) AS checkpoint_attempted,
                  s.state AS submission_state,
                  GREATEST(
                    la.activity_updated_at,
                    COALESCE(s.updated_at, la.activity_updated_at),
                    COALESCE(lp.last_event_at, la.activity_updated_at)
                  ) AS updated_at,
                  COALESCE(lp.projection_version, 0)::integer AS projection_version
                FROM latest_activities la
                LEFT JOIN uais_submissions s
                  ON s.assessment_id = la.activity_id AND s.user_id = ${studentId}
                LEFT JOIN uais_learner_profiles lp
                  ON lp.course_id = la.course_id AND lp.user_id = ${studentId}
                ORDER BY la.course_external_id, la.lesson_position
              `;
        const mappedRows = rows.map(mapStudentDashboardUnit);
        const courses = scopes.map((scope) => {
          const courseRows = mappedRows.filter(
            (row) =>
              row.courseId === scope.courseId && row.classId === scope.classId,
          );
          const nextAction = recommendNextLearningAction({
            units: courseRows.map((row) => ({
              lessonKey: row.lessonKey,
              position: row.position,
              checkpointAttempted: row.checkpointAttempted,
              ...(row.submissionState
                ? { submissionState: row.submissionState }
                : {}),
            })),
          });
          return {
            courseId: scope.courseId,
            courseTitle: scope.courseTitle,
            classId: scope.classId,
            units: courseRows.map((row) => ({
              lessonKey: row.lessonKey,
              position: row.position,
              activityId: row.activityId,
              formative: { attempted: row.checkpointAttempted },
              submission: { state: row.submissionState ?? "not-started" },
              feedback: {
                status:
                  row.submissionState === "revision_requested"
                    ? "revision-required"
                    : row.submissionState === "accepted"
                      ? "accepted"
                      : row.submissionState === "submitted" ||
                          row.submissionState === "resubmitted"
                        ? "awaiting-teacher"
                        : "none",
              },
              completion: {
                completed: row.submissionState === "accepted",
                basis: "teacher-accepted-current-version",
              },
              dueAt: row.dueAt,
            })),
            counts: createStudentDashboardCounts(courseRows, readNow()),
            nextAction,
            playbackProgress: { status: "not-authoritative", percent: null },
            projectionVersion: Math.max(
              0,
              ...courseRows.map((row) => row.projectionVersion),
            ),
            dataFreshAt:
              newestTimestamp(courseRows.map((row) => row.updatedAt)) ??
              readNow().toISOString(),
          };
        });
        return {
          courses,
          nextAction: selectGlobalNextAction(courses.map((course) => course.nextAction)),
          dataFreshAt:
            newestTimestamp(courses.map((course) => course.dataFreshAt)) ??
            readNow().toISOString(),
        };
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async readSubmissionScope(input: { submissionId: string }) {
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const rows = await (client.sql as ReadSql)`
          SELECT
            c.slug AS course_external_id,
            s.class_external_id,
            a.id AS activity_id,
            l.external_key AS lesson_key,
            v.id AS current_version_id
          FROM uais_submissions s
          JOIN uais_submission_versions v
            ON v.submission_id = s.id AND v.version_no = s.current_version_no
          JOIN uais_assessments a ON a.id = s.assessment_id
          JOIN uais_lessons l ON l.id = a.lesson_id
          JOIN uais_courses c ON c.id = l.course_id
          WHERE s.id = ${input.submissionId}
          LIMIT 1
        `;
        const row = firstRow(rows);
        if (!row) throw new LearningLoopStoreError(404, "learning-submission-required");
        return {
          courseId: readString(row.course_external_id),
          classId: readString(row.class_external_id),
          activityId: readString(row.activity_id),
          lessonKey: readString(row.lesson_key),
          currentVersionId: readString(row.current_version_id),
        };
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async listActivitySubmissions(input: {
      teacherAccount: string;
      activityId: string;
      classExternalId?: string;
      state?: LearningSubmissionState;
      cursor?: string;
      limit?: number;
    }) {
      const state = input.state ? readSubmissionState(input.state) : undefined;
      const cursor = input.cursor ? decodeSubmissionCursor(input.cursor) : undefined;
      const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 25)));
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const teacherId = await requireUserId(
          client.sql as ReadSql,
          input.teacherAccount,
          "teacher",
        );
        const rows = await (client.sql as ReadSql)`
          SELECT
            s.id AS submission_id, s.state AS submission_state,
            s.current_version_no, v.id AS current_version_id,
            u.account AS student_account, u.display_name AS student_display_name,
            s.class_external_id,
            (SELECT count(*)::integer FROM uais_formative_attempts fa
              WHERE fa.assessment_id = s.assessment_id
                AND fa.user_id = s.user_id) AS checkpoint_attempt_count,
            s.last_submitted_at, s.updated_at
          FROM uais_submissions s
          JOIN uais_submission_versions v
            ON v.submission_id = s.id AND v.version_no = s.current_version_no
          JOIN uais_users u ON u.id = s.user_id
          JOIN uais_assessments a ON a.id = s.assessment_id
          JOIN uais_lessons l ON l.id = a.lesson_id
          JOIN uais_courses c ON c.id = l.course_id
          WHERE s.assessment_id = ${input.activityId}
            AND c.teacher_id = ${teacherId}
            AND (
              ${input.classExternalId ?? null}::text IS NULL
              OR s.class_external_id = ${input.classExternalId ?? null}
            )
            AND (${state ?? null}::text IS NULL OR s.state = ${state ?? null})
            AND (
              ${cursor?.updatedAt ?? null}::timestamptz IS NULL
              OR (s.updated_at, s.id) < (
                ${cursor?.updatedAt ?? null}::timestamptz,
                ${cursor?.submissionId ?? null}::uuid
              )
            )
          ORDER BY s.updated_at DESC, s.id DESC
          LIMIT ${limit + 1}
        `;
        const pageRows = rows.slice(0, limit);
        const last = rows.length > limit ? readRecord(pageRows.at(-1)) : undefined;
        return {
          activityId: input.activityId,
          submissions: pageRows.map(mapTeacherSubmissionQueueRow),
          nextCursor: last
            ? encodeSubmissionCursor({
                updatedAt: requireTimestamp(last.updated_at, "submission-cursor-invalid"),
                submissionId: readString(last.submission_id),
              })
            : null,
          dataFreshAt:
            newestTimestamp(pageRows.map((row) => readRecord(row).updated_at)) ??
            readNow().toISOString(),
        };
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async readTeacherSubmission(input: {
      teacherAccount: string;
      submissionId: string;
    }) {
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const teacherId = await requireUserId(
          client.sql as ReadSql,
          input.teacherAccount,
          "teacher",
        );
        const rows = await (client.sql as ReadSql)`
          SELECT
            s.id AS submission_id, s.state AS submission_state,
            s.current_version_no, v.id AS current_version_id,
            u.account AS student_account, u.display_name AS student_display_name,
            c.slug AS course_external_id, s.class_external_id,
            a.id AS activity_id, a.title_i18n, a.instructions_i18n,
            a.rubric, a.ai_policy, l.external_key AS lesson_key,
            (SELECT count(*)::integer FROM uais_formative_attempts fa
              WHERE fa.assessment_id = s.assessment_id
                AND fa.user_id = s.user_id) AS checkpoint_attempt_count,
            s.updated_at
          FROM uais_submissions s
          JOIN uais_submission_versions v
            ON v.submission_id = s.id AND v.version_no = s.current_version_no
          JOIN uais_users u ON u.id = s.user_id
          JOIN uais_assessments a ON a.id = s.assessment_id
          JOIN uais_lessons l ON l.id = a.lesson_id
          JOIN uais_courses c ON c.id = l.course_id
          WHERE s.id = ${input.submissionId} AND c.teacher_id = ${teacherId}
          LIMIT 1
        `;
        const row = firstRow(rows);
        if (!row) throw new LearningLoopStoreError(404, "teacher-submission-required");
        const versions = await (client.sql as ReadSql)`
          SELECT
            id, version_no, status, content_text, content_hash,
            draft_revision, created_at, updated_at, submitted_at
          FROM uais_submission_versions
          WHERE submission_id = ${input.submissionId}
          ORDER BY version_no
        `;
        const feedback = await (client.sql as ReadSql)`
          SELECT
            id, submission_version_id, origin, status, rubric_judgments,
            feedback_text, requires_revision, ai_trace_ref,
            source_draft_revision, created_at, updated_at, released_at
          FROM uais_feedback
          WHERE submission_id = ${input.submissionId}
            AND (status <> 'draft' OR teacher_user_id = ${teacherId})
          ORDER BY created_at, id
        `;
        return {
          id: readString(row.submission_id),
          state: readSubmissionState(row.submission_state),
          currentVersionNo: readInteger(row.current_version_no),
          currentVersionId: readString(row.current_version_id),
          student: {
            account: readString(row.student_account),
            displayName: readString(row.student_display_name),
          },
          courseId: readString(row.course_external_id),
          classId: readString(row.class_external_id),
          activityId: readString(row.activity_id),
          lessonKey: readString(row.lesson_key),
          activity: {
            title: readRecord(row.title_i18n),
            instructions: readRecord(row.instructions_i18n),
            rubric: readArray(row.rubric),
            aiPolicy: readString(row.ai_policy),
          },
          rubric: readArray(row.rubric),
          formative: {
            attempted: readInteger(row.checkpoint_attempt_count) > 0,
            attemptCount: readInteger(row.checkpoint_attempt_count),
          },
          versions: versions.map(mapTeacherSubmissionVersion),
          feedback: feedback.map(mapTeacherFeedback),
          dataFreshAt:
            newestTimestamp([
              row.updated_at,
              ...versions.map((value) => readRecord(value).updated_at),
              ...feedback.map((value) => readRecord(value).updated_at),
            ]) ?? readNow().toISOString(),
        };
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async readLearningInsights(input: {
      teacherAccount: string;
      courseExternalId: string;
      classExternalId?: string;
      approvedStudentCounts?: Record<string, number>;
    }) {
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const teacherId = await requireUserId(
          client.sql as ReadSql,
          input.teacherAccount,
          "teacher",
        );
        const rows = await (client.sql as ReadSql)`
          WITH active_families AS (
            SELECT DISTINCT ON (
              a.lesson_id, a.activity_key, a.target_class_external_id
            )
              c.id AS course_id,
              a.lesson_id,
              a.activity_key,
              a.target_class_external_id,
              a.due_at,
              a.updated_at AS activity_updated_at
            FROM uais_assessments a
            JOIN uais_lessons l ON l.id = a.lesson_id
            JOIN uais_courses c ON c.id = l.course_id
            WHERE c.slug = ${input.courseExternalId}
              AND c.teacher_id = ${teacherId}
              AND a.status = 'published'
              AND a.activity_key IS NOT NULL
              AND (
                ${input.classExternalId ?? null}::text IS NULL
                OR a.target_class_external_id = ${input.classExternalId ?? null}
              )
            ORDER BY
              a.lesson_id, a.activity_key, a.target_class_external_id,
              a.version DESC
          ), family_submissions AS (
            SELECT DISTINCT ON (
              family.lesson_id, family.activity_key,
              family.target_class_external_id, s.user_id
            )
              family.lesson_id,
              family.activity_key,
              family.target_class_external_id,
              s.id AS submission_id,
              s.user_id,
              s.state AS submission_state,
              s.updated_at AS submission_updated_at,
              COALESCE(lp.projection_version, 0)::integer AS projection_version,
              versioned_activity.version
            FROM active_families family
            JOIN uais_assessments versioned_activity
              ON versioned_activity.lesson_id = family.lesson_id
              AND versioned_activity.activity_key = family.activity_key
              AND versioned_activity.target_class_external_id =
                family.target_class_external_id
            JOIN uais_submissions s
              ON s.assessment_id = versioned_activity.id
            LEFT JOIN uais_learner_profiles lp
              ON lp.course_id = family.course_id AND lp.user_id = s.user_id
            ORDER BY
              family.lesson_id, family.activity_key,
              family.target_class_external_id, s.user_id,
              versioned_activity.version DESC, s.updated_at DESC
          )
          SELECT
            family.lesson_id,
            family.activity_key,
            family.target_class_external_id,
            family.due_at,
            submission.submission_id,
            submission.user_id AS student_id,
            submission.submission_state,
            COALESCE(submission.projection_version, 0)::integer AS projection_version,
            GREATEST(
              family.activity_updated_at,
              COALESCE(submission.submission_updated_at, family.activity_updated_at)
            ) AS data_fresh_at
          FROM active_families family
          LEFT JOIN family_submissions submission
            ON submission.lesson_id = family.lesson_id
            AND submission.activity_key = family.activity_key
            AND submission.target_class_external_id =
              family.target_class_external_id
          ORDER BY
            family.target_class_external_id,
            family.lesson_id,
            family.activity_key,
            submission.user_id
        `;
        const aggregate = aggregateLearningInsightRows({
          rows,
          approvedStudentCounts: input.approvedStudentCounts ?? {},
          now: readNow(),
        });
        return {
          courseId: input.courseExternalId,
          ...(input.classExternalId ? { classId: input.classExternalId } : {}),
          counts: {
            notStarted: aggregate.notStarted,
            draft: aggregate.draft,
            submitted: aggregate.submitted,
            revisionRequested: aggregate.revisionRequested,
            resubmitted: aggregate.resubmitted,
            accepted: aggregate.accepted,
            overdue: aggregate.overdue,
          },
          projectionVersion: aggregate.projectionVersion,
          dataFreshAt: aggregate.dataFreshAt ?? readNow().toISOString(),
        };
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },
  };
}

type StudentDashboardUnit = ReturnType<typeof mapStudentDashboardUnit>;

function aggregateLearningInsightRows(input: {
  rows: unknown[];
  approvedStudentCounts: Record<string, number>;
  now: Date;
}) {
  const families = new Map<
    string,
    {
      classId: string;
      dueAt?: string;
      states: LearningSubmissionState[];
    }
  >();
  let projectionVersion = 0;
  const dataFreshAtValues: unknown[] = [];
  for (const value of input.rows) {
    const row = readRecord(value);
    const classId = readString(row.target_class_external_id);
    const key = `${readString(row.lesson_id)}:${readString(row.activity_key)}:${classId}`;
    const family = families.get(key) ?? {
      classId,
      dueAt: readOptionalTimestamp(row.due_at),
      states: [],
    };
    if (readString(row.submission_id)) {
      family.states.push(readSubmissionState(row.submission_state));
    }
    families.set(key, family);
    projectionVersion = Math.max(
      projectionVersion,
      readInteger(row.projection_version),
    );
    dataFreshAtValues.push(row.data_fresh_at);
  }
  const counts = {
    notStarted: 0,
    draft: 0,
    submitted: 0,
    revisionRequested: 0,
    resubmitted: 0,
    accepted: 0,
    overdue: 0,
  };
  for (const family of families.values()) {
    const approved = Math.max(
      0,
      Math.floor(input.approvedStudentCounts[family.classId] ?? 0),
    );
    counts.notStarted += Math.max(0, approved - family.states.length);
    counts.draft += family.states.filter((state) => state === "draft").length;
    counts.submitted += family.states.filter((state) => state === "submitted").length;
    counts.revisionRequested += family.states.filter(
      (state) => state === "revision_requested",
    ).length;
    counts.resubmitted += family.states.filter((state) => state === "resubmitted").length;
    const accepted = family.states.filter((state) => state === "accepted").length;
    counts.accepted += accepted;
    if (family.dueAt && Date.parse(family.dueAt) < input.now.getTime()) {
      counts.overdue += Math.max(0, approved - accepted);
    }
  }
  return {
    ...counts,
    projectionVersion,
    dataFreshAt: newestTimestamp(dataFreshAtValues),
  };
}

function normalizeDashboardScopes(
  value: Array<{ courseId: string; courseTitle: string; classId: string }>,
) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new LearningLoopStoreError(400, "student-dashboard-scopes-invalid");
  }
  const seen = new Set<string>();
  return value.map((scope) => {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(scope.courseId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(scope.classId)
    ) {
      throw new LearningLoopStoreError(400, "student-dashboard-scope-invalid");
    }
    const key = `${scope.courseId}:${scope.classId}`;
    if (seen.has(key)) {
      throw new LearningLoopStoreError(409, "student-dashboard-scope-duplicate");
    }
    seen.add(key);
    return {
      courseId: scope.courseId,
      courseTitle: scope.courseTitle.trim() || scope.courseId,
      classId: scope.classId,
    };
  });
}

function mapStudentDashboardUnit(value: unknown) {
  const row = readRecord(value);
  const submissionState = row.submission_state
    ? readSubmissionState(row.submission_state)
    : undefined;
  return {
    courseId: readString(row.course_external_id),
    classId: readString(row.class_external_id),
    lessonKey: readString(row.lesson_key),
    position: readInteger(row.lesson_position),
    activityId: readString(row.activity_id),
    checkpointAttempted: row.checkpoint_attempted === true,
    ...(submissionState ? { submissionState } : {}),
    dueAt: readOptionalTimestamp(row.due_at),
    updatedAt: readOptionalTimestamp(row.updated_at),
    projectionVersion: readInteger(row.projection_version),
  };
}

function createStudentDashboardCounts(rows: StudentDashboardUnit[], now: Date) {
  const count = (state: StudentDashboardUnit["submissionState"]) =>
    rows.filter((row) => row.submissionState === state).length;
  return {
    notStarted: rows.filter((row) => !row.submissionState).length,
    draft: count("draft"),
    submitted: count("submitted"),
    revisionRequested: count("revision_requested"),
    resubmitted: count("resubmitted"),
    accepted: count("accepted"),
    completedUnits: count("accepted"),
    overdue: rows.filter(
      (row) =>
        row.submissionState !== "accepted" &&
        Boolean(row.dueAt && Date.parse(row.dueAt) < now.getTime()),
    ).length,
  };
}

function selectGlobalNextAction(actions: NextLearningAction[]): NextLearningAction {
  if (actions.length === 0) {
    return { type: "collect-more-evidence", reasonCode: "no-published-learning-units" };
  }
  const priorities: Record<NextLearningAction["type"], number> = {
    "revise-submission": 1,
    "await-teacher-review": 2,
    "complete-checkpoint": 3,
    "continue-draft": 4,
    "start-submission": 4,
    "open-next-lesson": 5,
    "course-complete": 6,
    "collect-more-evidence": 7,
  };
  return actions.reduce((best, action) =>
    priorities[action.type] < priorities[best.type] ? action : best,
  );
}

async function requireUserId(
  sql: ReadSql,
  account: string,
  role: "student" | "teacher",
) {
  const rows =
    role === "student"
      ? await sql`
          SELECT id FROM uais_users
          WHERE account = ${account} AND role = 'student' AND status = 'active'
          LIMIT 2
        `
      : await sql`
          SELECT id FROM uais_users
          WHERE account = ${account} AND role = 'teacher' AND status = 'active'
          LIMIT 2
        `;
  if (rows.length !== 1) {
    throw new LearningLoopStoreError(409, "account-projection-required", {
      role,
      valueRedacted: true,
    });
  }
  const id = readString(firstRow(rows)?.id);
  if (!id) throw new LearningLoopStoreError(409, "account-projection-required");
  return id;
}

function createStudentCheckpoint(value: unknown, attempted: boolean) {
  const checkpoint = { ...readRecord(value) };
  if (!attempted) {
    delete checkpoint.correctOptionId;
    delete checkpoint.explanation;
  }
  return checkpoint;
}

function mapTeacherActivity(value: unknown) {
  const row = readRecord(value);
  return {
    id: readString(row.id),
    activityKey: readString(row.activity_key),
    version: readInteger(row.version),
    editRevision: readInteger(row.edit_revision),
    status: readString(row.status),
    lessonKey: readString(row.lesson_key),
    lessonPosition: readInteger(row.lesson_position),
    targetClassId: readString(row.target_class_external_id),
    title: readRecord(row.title_i18n),
    instructions: readRecord(row.instructions_i18n),
    rubric: readArray(row.rubric),
    checkpoint: readRecord(row.formative_check),
    dueAt: readOptionalTimestamp(row.due_at),
    aiPolicy: readString(row.ai_policy),
    revisionPolicy: readString(row.revision_policy),
    publishedAt: readOptionalTimestamp(row.published_at),
    archivedAt: readOptionalTimestamp(row.archived_at),
    updatedAt: readOptionalTimestamp(row.updated_at),
  };
}

function mapStudentVersion(value: unknown) {
  const row = readRecord(value);
  return {
    id: readString(row.id),
    versionNo: readInteger(row.version_no),
    status: readVersionStatus(row.status),
    contentText: readString(row.content_text),
    draftRevision: readInteger(row.draft_revision),
    submittedAt: readOptionalTimestamp(row.submitted_at),
  };
}

function mapStudentFeedback(value: unknown) {
  const row = readRecord(value);
  return {
    id: readString(row.id),
    submissionVersionId: readString(row.submission_version_id),
    origin: row.origin === "ai-assisted" ? "ai-assisted" : "teacher",
    status: row.status === "superseded" ? "superseded" : "released",
    rubricJudgments: readRecord(row.rubric_judgments),
    feedbackText: readString(row.feedback_text),
    requiresRevision: row.requires_revision === true,
    releasedAt: readOptionalTimestamp(row.released_at),
  };
}

function mapTeacherSubmissionQueueRow(value: unknown) {
  const row = readRecord(value);
  const attemptCount = readInteger(row.checkpoint_attempt_count);
  return {
    id: readString(row.submission_id),
    state: readSubmissionState(row.submission_state),
    currentVersionNo: readInteger(row.current_version_no),
    currentVersionId: readString(row.current_version_id),
    student: {
      account: readString(row.student_account),
      displayName: readString(row.student_display_name),
    },
    classId: readString(row.class_external_id),
    formative: { attempted: attemptCount > 0, attemptCount },
    lastSubmittedAt: readOptionalTimestamp(row.last_submitted_at),
    updatedAt: readOptionalTimestamp(row.updated_at),
  };
}

function mapTeacherSubmissionVersion(value: unknown) {
  const row = readRecord(value);
  return {
    id: readString(row.id),
    versionNo: readInteger(row.version_no),
    status: readVersionStatus(row.status),
    contentText: readString(row.content_text),
    draftRevision: readInteger(row.draft_revision),
    createdAt: readOptionalTimestamp(row.created_at),
    updatedAt: readOptionalTimestamp(row.updated_at),
    submittedAt: readOptionalTimestamp(row.submitted_at),
  };
}

function mapTeacherFeedback(value: unknown) {
  const row = readRecord(value);
  const status = readString(row.status);
  if (status !== "draft" && status !== "released" && status !== "superseded") {
    throw new LearningLoopStoreError(500, "feedback-status-invalid");
  }
  return {
    id: readString(row.id),
    submissionVersionId: readString(row.submission_version_id),
    origin: row.origin === "ai-assisted" ? "ai-assisted" : "teacher",
    status,
    rubricJudgments: readRecord(row.rubric_judgments),
    feedbackText: readString(row.feedback_text),
    requiresRevision: row.requires_revision === true,
    sourceDraftRevision: readInteger(row.source_draft_revision),
    aiAssisted: Boolean(readString(row.ai_trace_ref)),
    createdAt: readOptionalTimestamp(row.created_at),
    updatedAt: readOptionalTimestamp(row.updated_at),
    releasedAt: readOptionalTimestamp(row.released_at),
  };
}

function encodeSubmissionCursor(input: {
  updatedAt: string;
  submissionId: string;
}) {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeSubmissionCursor(value: string) {
  try {
    if (!/^[A-Za-z0-9_-]{1,500}$/.test(value)) throw new Error("invalid");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      updatedAt?: unknown;
      submissionId?: unknown;
    };
    const submissionId = readString(parsed.submissionId);
    if (!/^[0-9a-f-]{36}$/i.test(submissionId)) throw new Error("invalid");
    return {
      updatedAt: requireTimestamp(parsed.updatedAt, "submission-cursor-invalid"),
      submissionId,
    };
  } catch (error) {
    if (error instanceof LearningLoopStoreError) throw error;
    throw new LearningLoopStoreError(400, "submission-cursor-invalid");
  }
}

function requireTimestamp(value: unknown, reasonCode: string) {
  const timestamp = readOptionalTimestamp(value);
  if (!timestamp) throw new LearningLoopStoreError(400, reasonCode);
  return timestamp;
}

function readSubmissionState(value: unknown): LearningSubmissionState {
  if (
    value === "draft" ||
    value === "submitted" ||
    value === "revision_requested" ||
    value === "resubmitted" ||
    value === "accepted"
  ) {
    return value;
  }
  throw new LearningLoopStoreError(500, "submission-state-invalid");
}

function readActivityState(value: unknown) {
  if (value === "published" || value === "archived") return value;
  throw new LearningLoopStoreError(500, "learning-activity-state-invalid");
}

function readVersionStatus(value: unknown) {
  if (value === "draft" || value === "sealed") return value;
  throw new LearningLoopStoreError(500, "submission-version-status-invalid");
}

function newestTimestamp(values: unknown[]) {
  const timestamps = values
    .map(readOptionalTimestamp)
    .filter((value): value is string => Boolean(value))
    .sort();
  return timestamps.at(-1);
}

function readOptionalTimestamp(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function firstRow(rows: unknown[]) {
  const value = rows[0];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return readRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown) {
  if (typeof value === "string") {
    try {
      return readArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : 0;
}
