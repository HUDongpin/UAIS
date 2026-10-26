import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
} from "@/lib/db/core-database";
import { teachingActorOwnsCourse } from "./teaching-actor-id";

export type ClassroomRecordSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown[]>;

export class ClassroomRecordRetentionError extends Error {
  constructor(
    public readonly status: number,
    public readonly reasonCode: string,
  ) {
    super(reasonCode);
    this.name = "ClassroomRecordRetentionError";
  }
}

export function classroomRecordPurgeAfter(closedAt: string) {
  const time = Date.parse(closedAt);
  if (!Number.isFinite(time))
    throw new ClassroomRecordRetentionError(400, "course-close-date-invalid");
  return new Date(time + 180 * 24 * 60 * 60 * 1_000).toISOString();
}

// Must run INSIDE the caller's transaction. A shared advisory lock covers the
// absent-row case too: closing/purging takes its exclusive counterpart, so a
// pre-close request cannot land after the records were removed.
export async function assertClassroomRecordWriteAllowed(
  sql: ClassroomRecordSql | TransactionSql,
  courseExternalId: string,
  options: { allowClosed?: boolean } = {},
) {
  const query = sql as ClassroomRecordSql;
  await query`SELECT pg_advisory_xact_lock_shared(hashtextextended(${"uais-classroom-records:" + courseExternalId}, 0))`;
  const rows =
    await query`SELECT closed_at, purged_at FROM uais_course_record_retention WHERE course_external_id = ${courseExternalId}`;
  const record = rows[0] as
    { closed_at?: unknown; purged_at?: unknown } | undefined;
  if (record?.purged_at)
    throw new ClassroomRecordRetentionError(423, "course-records-purged");
  if (record?.closed_at && !options.allowClosed)
    throw new ClassroomRecordRetentionError(423, "course-records-closed");
}

export async function assertClassroomSnapshotWriteAllowed(
  sql: ClassroomRecordSql | TransactionSql,
  courseExternalId: string,
  next: Record<string, unknown>,
) {
  const query = sql as ClassroomRecordSql;
  await query`SELECT pg_advisory_xact_lock_shared(hashtextextended(${"uais-classroom-records:" + courseExternalId}, 0))`;
  const [row] =
    (await query`SELECT closed_at,purged_at FROM uais_course_record_retention WHERE course_external_id=${courseExternalId}`) as Array<{
      closed_at?: unknown;
      purged_at?: unknown;
    }>;
  if (row?.purged_at)
    throw new ClassroomRecordRetentionError(423, "course-records-purged");
  if (!row?.closed_at) return;
  const [current] =
    (await query`SELECT database FROM uais_teaching_course_management_snapshots WHERE snapshot_key=${courseExternalId} FOR UPDATE`) as Array<{
      database?: Record<string, unknown>;
    }>;
  for (const field of [
    "memberships",
    "learningGroups",
    "studentRosters",
    "studentGroupSuggestions",
    "studentPreviewSessions",
  ]) {
    if (
      JSON.stringify(current?.database?.[field] ?? []) !==
      JSON.stringify(next[field] ?? [])
    ) {
      throw new ClassroomRecordRetentionError(423, "course-records-closed");
    }
  }
}
export type ClassroomRecordRetentionState = {
  courseId: string;
  retentionDays: 180;
  closedAt: string | null;
  purgeAfter: string | null;
  purgedAt: string | null;
  eligibleForPurge: boolean;
  counts: Record<string, number>;
  confirmationDigest: string;
};

type CourseOwner = { id: string | null; teacher_id: string };
type RetentionInput = { courseId: string; teacherAccount: string };
type RetentionClient = { sql: Sql; pooled?: boolean };

export const classroomPrivateSnapshotFields = [
  "memberships",
  "learningGroups",
  "studentPreviewSessions",
  "studentRosters",
  "studentGroupSuggestions",
  "dashboardStates",
  "dashboardSnapshots",
  "gradingQueues",
  "gradebookUpdates",
  "gradingFeedbackDrafts",
  "exportManifests",
  "exportRedactionValidations",
  "auditEvents",
] as const;
const classroomOperationFields = [
  "records",
  "auditEvents",
  "domainProjections",
  "exportManifests",
  "providerOperations",
] as const;

const classroomAuditActions = new Set([
  "generate-student-preview-session",
  "sync-student-roster",
  "sync-student-roster-provider",
  "generate-student-group-suggestions",
  "refresh-dashboard",
  "lock-dashboard-snapshot",
  "create-export-manifest",
  "export-course-data-provider",
  "validate-export-redaction-scope",
  "save-grading-queue",
  "generate-grading-feedback-draft",
  "generate-grading-feedback-provider",
  "join-class-by-invite",
  "approve-class-membership",
  "approve-class-memberships",
  "reject-class-membership",
  "remove-class-membership",
  "create-learning-group",
  "auto-split-learning-groups",
  "update-learning-group-members",
  "rename-learning-group",
  "delete-learning-group",
]);
const classroomOperationIds = new Set([
  "students",
  "data-export",
  "dashboard",
  "quiz-board",
  "grading",
]);
const classroomProjectionTypes = new Set([
  "student-preview-session",
  "dashboard-state",
  "quiz-board-state",
  "group-suggestions",
  "ai-feedback-draft",
  "dashboard-snapshot",
  "quiz-item-review",
  "export-manifest",
  "redaction-validation",
  "student-roster",
  "enrollment-access",
  "grading-queue",
  "gradebook-update",
  "grade-release-notification",
  "grade-release-rollback-notification",
]);

// Preview and deletion use the same bounded classification. Course publication,
// material/KB edits and teacher settings keep their provenance after student
// evidence expires; this feature is not a general audit-log deletion command.
export function isClassroomSnapshotRecord(
  field: string,
  item: Record<string, unknown>,
  source: "course" | "operations" = "course",
) {
  if (source === "course") {
    if (field !== "auditEvents") return true;
    return (
      item.actorRole === "student" ||
      classroomAuditActions.has(String(item.action))
    );
  }
  if (field === "exportManifests" || field === "providerOperations")
    return true;
  if (field === "domainProjections") {
    return (
      classroomProjectionTypes.has(String(item.objectType)) ||
      (item.objectType === "operation-rollback" &&
        classroomOperationIds.has(String(item.targetOperationId)))
    );
  }
  return (
    classroomOperationIds.has(String(item.operationId)) ||
    item.actionId === "preview-student-view" ||
    item.eventType === "teaching-gradebook-update.released" ||
    item.eventType === "teaching-gradebook-update.release-rolled-back"
  );
}

export function createClassroomRecordRetentionStore(options: {
  env: Record<string, string | undefined>;
  now?: () => Date;
  createDatabase?: (input: {
    env: Record<string, string | undefined>;
  }) => RetentionClient;
}) {
  async function transaction<T>(
    input: RetentionInput,
    exclusive: boolean,
    run: (
      sql: ClassroomRecordSql,
      owner: CourseOwner,
      now: string,
    ) => Promise<T>,
  ): Promise<T> {
    const client = (options.createDatabase ?? getUaisCoreDatabasePool)({
      env: options.env,
    });
    try {
      return (await client.sql.begin(async (tx) => {
        const sql = tx as unknown as ClassroomRecordSql;
        const key = `uais-classroom-records:${input.courseId}`;
        if (exclusive)
          await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        else
          await sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
        // A newly created course is authoritative in the managed snapshot;
        // normalized course rows appear only after its first lesson/activity.
        // Read-only retention must not create that projection as a side effect.
        const rows =
          await sql`SELECT u.id AS teacher_id,s.database FROM uais_users u JOIN uais_teaching_course_management_snapshots s ON s.snapshot_key=${input.courseId} WHERE lower(u.account)=lower(${input.teacherAccount}) AND u.role='teacher' AND u.status='active' FOR SHARE OF s`;
        const snapshot = rows[0] as
          | {
              teacher_id: string;
              database: {
                courses?: Array<{
                  courseId?: unknown;
                  ownerTeacherId?: unknown;
                }>;
              };
            }
          | undefined;
        const ownsSnapshot = snapshot?.database?.courses?.some(
          (course) =>
            typeof course.courseId === "string" &&
            typeof course.ownerTeacherId === "string" &&
            teachingActorOwnsCourse({
              courseId: input.courseId,
              candidateCourseId: course.courseId,
              ownerTeacherId: course.ownerTeacherId,
              actorId: input.teacherAccount,
            }),
        );
        if (!snapshot || !ownsSnapshot)
          throw new ClassroomRecordRetentionError(
            403,
            "course-retention-owner-required",
          );
        const projections =
          await sql`SELECT id,teacher_id FROM uais_courses WHERE slug=${input.courseId}`;
        const projected = projections[0] as
          { id: string; teacher_id: string } | undefined;
        if (projected && projected.teacher_id !== snapshot.teacher_id)
          throw new ClassroomRecordRetentionError(
            403,
            "course-retention-owner-required",
          );
        const owner: CourseOwner = {
          id: projected?.id ?? null,
          teacher_id: snapshot.teacher_id,
        };
        return run(sql, owner, (options.now?.() ?? new Date()).toISOString());
      })) as T;
    } finally {
      await closeUaisCoreDatabaseClient(client);
    }
  }
  return {
    read(input: RetentionInput) {
      return transaction(input, false, (sql, owner, now) =>
        readRetentionState(sql, input.courseId, owner.id, now),
      );
    },
    close(input: RetentionInput) {
      return transaction(input, true, async (sql, owner, now) => {
        const inserted =
          await sql`INSERT INTO uais_course_record_retention (course_external_id,closed_at,purge_after,updated_at) VALUES (${input.courseId},${now},${classroomRecordPurgeAfter(now)},${now}) ON CONFLICT (course_external_id) DO NOTHING RETURNING course_external_id`;
        if (inserted.length)
          await writeRetentionAudit(
            sql,
            input.courseId,
            owner.teacher_id,
            "classroom-record-period-closed",
            { retentionDays: 180, closedAt: now },
          );
        return readRetentionState(sql, input.courseId, owner.id, now);
      });
    },
    purge(input: RetentionInput & { confirmationDigest: string }) {
      return transaction(input, true, async (sql, owner, now) => {
        const preview = await readRetentionState(
          sql,
          input.courseId,
          owner.id,
          now,
        );
        if (preview.purgedAt) return preview;
        if (!preview.eligibleForPurge)
          throw new ClassroomRecordRetentionError(
            409,
            "course-retention-not-expired",
          );
        if (preview.confirmationDigest !== input.confirmationDigest)
          throw new ClassroomRecordRetentionError(
            409,
            "course-retention-preview-stale",
          );
        await deleteClassroomEvidence(sql, input.courseId, owner.id);
        await sql`UPDATE uais_course_record_retention SET purged_at=${now},updated_at=${now} WHERE course_external_id=${input.courseId}`;
        await writeRetentionAudit(
          sql,
          input.courseId,
          owner.teacher_id,
          "classroom-records-purged",
          {
            counts: preview.counts,
            closedAt: preview.closedAt,
            purgeAfter: preview.purgeAfter,
            backups: "not-included",
            downloadedCopies: "not-included",
          },
        );
        return readRetentionState(sql, input.courseId, owner.id, now);
      });
    },
  };
}

async function readRetentionState(
  sql: ClassroomRecordSql,
  courseId: string,
  coreCourseId: string | null,
  now: string,
): Promise<ClassroomRecordRetentionState> {
  const [row] =
    (await sql`SELECT closed_at,purge_after,purged_at FROM uais_course_record_retention WHERE course_external_id=${courseId}`) as Array<{
      closed_at: unknown;
      purge_after: unknown;
      purged_at: unknown;
    }>;
  const [aggregate] = (await sql`
    WITH activities AS (SELECT a.id FROM uais_assessments a JOIN uais_lessons l ON l.id=a.lesson_id WHERE l.course_id=${coreCourseId}),
      submissions AS (SELECT s.* FROM uais_submissions s WHERE s.assessment_id IN (SELECT id FROM activities)),
      versions AS (SELECT v.* FROM uais_submission_versions v WHERE v.submission_id IN (SELECT id FROM submissions)),
      feedback AS (SELECT f.* FROM uais_feedback f WHERE f.submission_id IN (SELECT id FROM submissions)),
      resources AS (SELECT id::text FROM submissions UNION SELECT id::text FROM versions UNION SELECT id::text FROM feedback UNION SELECT id::text FROM uais_formative_attempts WHERE assessment_id IN (SELECT id FROM activities) UNION SELECT id::text FROM uais_learning_events WHERE course_id=${coreCourseId})
    SELECT jsonb_build_object(
      'submissions',(SELECT count(*) FROM submissions), 'versions',(SELECT count(*) FROM versions),
      'images',(SELECT count(*) FROM uais_submission_attachments WHERE submission_version_id IN (SELECT id FROM versions)),
      'feedback',(SELECT count(*) FROM feedback),
      'formativeAttempts',(SELECT count(*) FROM uais_formative_attempts WHERE assessment_id IN (SELECT id FROM activities)),
      'learningEvents',(SELECT count(*) FROM uais_learning_events WHERE course_id=${coreCourseId}),
      'chatMessages',(SELECT count(*) FROM uais_learning_chatroom_messages WHERE course_external_id=${courseId}),
      'liveChatRooms',(SELECT count(*) FROM uais_learning_chatroom_transcript_snapshots s WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(s.database->'transcripts') t WHERE t->>'courseId'=${courseId})),
      'enrollments',(SELECT count(*) FROM uais_enrollments WHERE course_id=${coreCourseId}),
      'learnerProfiles',(SELECT count(*) FROM uais_learner_profiles WHERE course_id=${coreCourseId}),
      'recommendations',(SELECT count(*) FROM uais_recommendations WHERE course_id=${coreCourseId}),
      'classroomAuditRecords',(SELECT count(*) FROM uais_audit_log WHERE target_id IN (SELECT id FROM resources) OR (metadata->>'courseId'=${courseId} AND target_type IN ('learning-submission','learning-feedback','learning-event','learning-formative-attempt','submission-image','class-membership','learning-group')))
    ) AS counts,
    md5(concat(
      (SELECT string_agg(id::text||updated_at::text,',' ORDER BY id) FROM submissions),
      (SELECT string_agg(id::text||updated_at::text,',' ORDER BY id) FROM versions),
      (SELECT string_agg(id::text||updated_at::text,',' ORDER BY id) FROM feedback),
      (SELECT string_agg(id::text||message::text,',' ORDER BY id) FROM uais_learning_chatroom_messages WHERE course_external_id=${courseId})
    )) AS fingerprint
  `) as Array<{ counts: Record<string, number>; fingerprint: string }>;
  const snapshotRecords = await readSnapshotEvidence(sql, courseId);
  const counts = { ...aggregate.counts, ...snapshotRecords.counts };
  const closedAt = iso(row?.closed_at),
    purgeAfter = iso(row?.purge_after),
    purgedAt = iso(row?.purged_at);
  return {
    courseId,
    retentionDays: 180,
    closedAt,
    purgeAfter,
    purgedAt,
    eligibleForPurge: Boolean(
      purgeAfter && !purgedAt && Date.parse(now) >= Date.parse(purgeAfter),
    ),
    counts,
    confirmationDigest: createHash("sha256")
      .update(
        JSON.stringify({
          courseId,
          closedAt,
          purgeAfter,
          purgedAt,
          counts,
          fingerprint: aggregate.fingerprint,
          snapshotFingerprint: snapshotRecords.fingerprint,
        }),
      )
      .digest("hex"),
  };
}

async function readSnapshotEvidence(sql: ClassroomRecordSql, courseId: string) {
  const current =
    (await sql`SELECT database FROM uais_teaching_course_management_snapshots WHERE snapshot_key=${courseId}`) as Array<{
      database: Record<string, unknown>;
    }>;
  const retired =
    (await sql`SELECT database FROM uais_teaching_course_management_snapshots_retired`) as Array<{
      database: Record<string, unknown>;
    }>;
  const chats =
    (await sql`SELECT database FROM uais_learning_chatroom_transcript_snapshots_retired`) as Array<{
      database: Record<string, unknown>;
    }>;
  const shares =
    (await sql`SELECT database FROM uais_learning_chatroom_share_snapshots`) as Array<{
      database: Record<string, unknown>;
    }>;
  const operations =
    (await sql`SELECT database FROM uais_teaching_operations_snapshots`) as Array<{
      database: Record<string, unknown>;
    }>;
  const values = (
    rows: Array<{ database: Record<string, unknown> }>,
    fields: readonly string[],
    source: "course" | "operations" = "course",
  ) =>
    rows.flatMap(({ database }) =>
      fields.flatMap((field) =>
        Array.isArray(database[field])
          ? (database[field] as Array<Record<string, unknown>>).filter(
              (item) =>
                item.courseId === courseId &&
                isClassroomSnapshotRecord(field, item, source),
            )
          : [],
      ),
    );
  const currentPrivate = values(current, classroomPrivateSnapshotFields),
    retiredPrivate = values(retired, classroomPrivateSnapshotFields);
  const retiredChats = values(chats, ["transcripts"]),
    courseShares = values(shares, ["shares"]);
  const courseOperations = values(
    operations,
    classroomOperationFields,
    "operations",
  );
  return {
    counts: {
      courseSnapshotRecords: currentPrivate.length,
      retiredCourseRecords: retiredPrivate.length,
      retiredChatMessages: retiredChats.reduce(
        (total, item) =>
          total + (Array.isArray(item.messages) ? item.messages.length : 0),
        0,
      ),
      shareLinks: courseShares.length,
      operationRecords: courseOperations.length,
    },
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify([
          currentPrivate,
          retiredPrivate,
          retiredChats,
          courseShares,
          courseOperations,
        ]),
      )
      .digest("hex"),
  };
}

async function deleteClassroomEvidence(
  sql: ClassroomRecordSql,
  courseId: string,
  coreCourseId: string | null,
) {
  // Remove replay receipts before their resources, so no later retry can claim
  // that a deleted submission or feedback still exists.
  await sql`
    WITH activities AS (SELECT a.id FROM uais_assessments a JOIN uais_lessons l ON l.id=a.lesson_id WHERE l.course_id=${coreCourseId}),
      submissions AS (SELECT id FROM uais_submissions WHERE assessment_id IN (SELECT id FROM activities)),
      resources AS (
        SELECT id::text FROM submissions UNION SELECT id::text FROM uais_submission_versions WHERE submission_id IN (SELECT id FROM submissions)
        UNION SELECT id::text FROM uais_feedback WHERE submission_id IN (SELECT id FROM submissions)
        UNION SELECT id::text FROM uais_formative_attempts WHERE assessment_id IN (SELECT id FROM activities)
        UNION SELECT id::text FROM uais_learning_events WHERE course_id=${coreCourseId}
      ), removed_receipts AS (DELETE FROM uais_idempotency_records WHERE resource_id IN (SELECT id FROM resources) RETURNING idempotency_key)
    DELETE FROM uais_audit_log WHERE target_id IN (SELECT id FROM resources) OR (metadata->>'courseId'=${courseId} AND target_type IN ('learning-submission','learning-feedback','learning-event','learning-formative-attempt','submission-image','class-membership','learning-group'))
  `;
  await sql`DELETE FROM uais_feedback WHERE submission_id IN (SELECT s.id FROM uais_submissions s JOIN uais_assessments a ON a.id=s.assessment_id JOIN uais_lessons l ON l.id=a.lesson_id WHERE l.course_id=${coreCourseId})`;
  // Clear the accepted-version back-reference before cascading versions/images.
  await sql`UPDATE uais_submissions SET accepted_version_id=NULL,current_version_no=0 WHERE assessment_id IN (SELECT a.id FROM uais_assessments a JOIN uais_lessons l ON l.id=a.lesson_id WHERE l.course_id=${coreCourseId})`;
  await sql`DELETE FROM uais_submissions WHERE assessment_id IN (SELECT a.id FROM uais_assessments a JOIN uais_lessons l ON l.id=a.lesson_id WHERE l.course_id=${coreCourseId})`;
  await sql`DELETE FROM uais_formative_attempts WHERE assessment_id IN (SELECT a.id FROM uais_assessments a JOIN uais_lessons l ON l.id=a.lesson_id WHERE l.course_id=${coreCourseId})`;
  await sql`DELETE FROM uais_learning_events WHERE course_id=${coreCourseId}`;
  await sql`DELETE FROM uais_learner_profiles WHERE course_id=${coreCourseId}`;
  await sql`DELETE FROM uais_recommendations WHERE course_id=${coreCourseId}`;
  await sql`DELETE FROM uais_enrollments WHERE course_id=${coreCourseId}`;
  await sql`DELETE FROM uais_learning_chatroom_messages WHERE course_external_id=${courseId}`;
  await sql`DELETE FROM uais_learning_chatroom_transcript_snapshots WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(database->'transcripts') t WHERE t->>'courseId'=${courseId})`;
  await stripSnapshotCourseRecords(
    sql,
    "uais_teaching_course_management_snapshots",
    classroomPrivateSnapshotFields,
    courseId,
  );
  await stripSnapshotCourseRecords(
    sql,
    "uais_teaching_course_management_snapshots_retired",
    classroomPrivateSnapshotFields,
    courseId,
  );
  await stripSnapshotCourseRecords(
    sql,
    "uais_learning_chatroom_transcript_snapshots_retired",
    ["transcripts"],
    courseId,
  );
  await stripSnapshotCourseRecords(
    sql,
    "uais_learning_chatroom_share_snapshots",
    ["shares"],
    courseId,
  );
  await stripSnapshotCourseRecords(
    sql,
    "uais_teaching_operations_snapshots",
    classroomOperationFields,
    courseId,
  );
}

type SnapshotTable =
  | "uais_teaching_course_management_snapshots"
  | "uais_teaching_course_management_snapshots_retired"
  | "uais_learning_chatroom_transcript_snapshots_retired"
  | "uais_learning_chatroom_share_snapshots"
  | "uais_teaching_operations_snapshots";
async function stripSnapshotCourseRecords(
  sql: ClassroomRecordSql,
  table: SnapshotTable,
  fields: readonly string[],
  courseId: string,
) {
  // Identifiers are a closed internal enum. Queries stay literal to keep both
  // parameterisation and the affected tables reviewable.
  const rows = (
    table === "uais_teaching_course_management_snapshots"
      ? await sql`SELECT snapshot_key,database FROM uais_teaching_course_management_snapshots WHERE snapshot_key=${courseId} FOR UPDATE`
      : table === "uais_teaching_course_management_snapshots_retired"
        ? await sql`SELECT snapshot_key,database FROM uais_teaching_course_management_snapshots_retired FOR UPDATE`
        : table === "uais_learning_chatroom_transcript_snapshots_retired"
          ? await sql`SELECT snapshot_key,database FROM uais_learning_chatroom_transcript_snapshots_retired FOR UPDATE`
          : table === "uais_teaching_operations_snapshots"
            ? await sql`SELECT snapshot_key,database FROM uais_teaching_operations_snapshots FOR UPDATE`
            : await sql`SELECT snapshot_key,database FROM uais_learning_chatroom_share_snapshots FOR UPDATE`
  ) as Array<{ snapshot_key: string; database: Record<string, unknown> }>;
  for (const row of rows) {
    let changed = false;
    const database = structuredClone(row.database);
    for (const field of fields) {
      if (!Array.isArray(database[field])) continue;
      const items = database[field] as Array<Record<string, unknown>>;
      const retained = items.filter(
        (item) =>
          item.courseId !== courseId ||
          !isClassroomSnapshotRecord(
            field,
            item,
            table === "uais_teaching_operations_snapshots"
              ? "operations"
              : "course",
          ),
      );
      if (retained.length !== items.length) {
        changed = true;
        database[field] = retained;
      }
    }
    if (!changed) continue;
    database.updatedAt = new Date().toISOString();
    const payload = JSON.stringify(database),
      revision = `retention-${createHash("sha256").update(payload).digest("hex").slice(0, 24)}`;
    if (table === "uais_teaching_course_management_snapshots")
      await sql`UPDATE uais_teaching_course_management_snapshots SET database=${payload}::text::jsonb,revision=${revision},updated_at=now() WHERE snapshot_key=${row.snapshot_key}`;
    else if (table === "uais_teaching_course_management_snapshots_retired")
      await sql`UPDATE uais_teaching_course_management_snapshots_retired SET database=${payload}::text::jsonb,revision=${revision},updated_at=now() WHERE snapshot_key=${row.snapshot_key}`;
    else if (table === "uais_learning_chatroom_transcript_snapshots_retired")
      await sql`UPDATE uais_learning_chatroom_transcript_snapshots_retired SET database=${payload}::text::jsonb,revision=${revision},updated_at=now() WHERE snapshot_key=${row.snapshot_key}`;
    else if (table === "uais_teaching_operations_snapshots")
      await sql`UPDATE uais_teaching_operations_snapshots SET database=${payload}::text::jsonb,revision=${revision},updated_at=now() WHERE snapshot_key=${row.snapshot_key}`;
    else
      await sql`UPDATE uais_learning_chatroom_share_snapshots SET database=${payload}::text::jsonb,revision=${revision},updated_at=now() WHERE snapshot_key=${row.snapshot_key}`;
  }
}

async function writeRetentionAudit(
  sql: ClassroomRecordSql,
  courseId: string,
  actorId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await sql`INSERT INTO uais_audit_log (actor_id,action,target_type,target_id,metadata) VALUES (${actorId},${action},'course-record-retention',${courseId},${JSON.stringify(metadata)}::text::jsonb)`;
}
function iso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : typeof value === "string" && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString()
      : null;
}
