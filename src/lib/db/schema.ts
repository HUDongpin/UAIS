import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const uaisUsers = pgTable(
  "uais_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    account: text("account").notNull(),
    passwordHash: text("password_hash"),
    role: text("role").notNull(),
    displayName: text("display_name").notNull(),
    department: text("department"),
    status: text("status").notNull().default("invited"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("uais_users_account_unique").on(table.account),
    check("uais_users_role_check", sql`${table.role} IN ('student', 'teacher', 'admin')`),
    check(
      "uais_users_status_check",
      sql`${table.status} IN ('active', 'disabled', 'invited')`,
    ),
  ],
);

export const uaisCourses = pgTable(
  "uais_courses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("draft"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("uais_courses_slug_unique").on(table.slug),
    index("uais_courses_teacher_id_idx").on(table.teacherId),
    check("uais_courses_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
  ],
);

export const uaisLessons = pgTable(
  "uais_lessons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => uaisCourses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    contentRef: text("content_ref"),
    externalKey: text("external_key"),
    publishedManifestRef: text("published_manifest_ref"),
    status: text("status").notNull().default("published"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("uais_lessons_course_id_idx").on(table.courseId),
    uniqueIndex("uais_lessons_course_position_unique").on(table.courseId, table.position),
    uniqueIndex("uais_lessons_course_external_key_unique").on(table.courseId, table.externalKey),
    check("uais_lessons_position_check", sql`${table.position} > 0`),
    check("uais_lessons_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
  ],
);

export const uaisClasses = pgTable(
  "uais_classes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => uaisCourses.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    externalKey: text("external_key"),
    status: text("status").notNull().default("open"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("uais_classes_course_teacher_idx").on(table.courseId, table.teacherId),
    uniqueIndex("uais_classes_course_external_key_unique").on(
      table.courseId,
      table.externalKey,
    ),
    check("uais_classes_status_check", sql`${table.status} IN ('open', 'closed', 'archived')`),
  ],
);

export const uaisInviteCodes = pgTable(
  "uais_invite_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    classId: uuid("class_id")
      .notNull()
      .references(() => uaisClasses.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("uais_invite_codes_class_hash_unique").on(table.classId, table.codeHash),
    index("uais_invite_codes_class_status_idx").on(table.classId, table.status),
    check(
      "uais_invite_codes_status_check",
      sql`${table.status} IN ('active', 'revoked', 'expired')`,
    ),
  ],
);

export const uaisEnrollments = pgTable(
  "uais_enrollments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => uaisCourses.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => uaisClasses.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("pending"),
    progress: numeric("progress", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("uais_enrollments_user_course_class_unique").on(
      table.userId,
      table.courseId,
      table.classId,
    ),
    index("uais_enrollments_user_idx").on(table.userId),
    index("uais_enrollments_course_class_idx").on(table.courseId, table.classId),
    check(
      "uais_enrollments_state_check",
      sql`${table.state} IN ('pending', 'active', 'rejected', 'withdrawn', 'completed')`,
    ),
    check("uais_enrollments_progress_check", sql`${table.progress} >= 0 AND ${table.progress} <= 100`),
  ],
);

export const uaisAssessments = pgTable(
  "uais_assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => uaisLessons.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    rubricRef: text("rubric_ref"),
    activityKey: text("activity_key"),
    titleI18n: jsonb("title_i18n").$type<Record<string, string>>().notNull().default({}),
    instructionsI18n: jsonb("instructions_i18n")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    status: text("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    editRevision: integer("edit_revision").notNull().default(1),
    rubric: jsonb("rubric").$type<Array<Record<string, unknown>>>().notNull().default([]),
    formativeCheck: jsonb("formative_check").$type<Record<string, unknown>>(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    aiPolicy: text("ai_policy").notNull().default("teacher-requested-draft"),
    revisionPolicy: text("revision_policy").notNull().default("teacher-requested"),
    targetClassExternalId: text("target_class_external_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("uais_assessments_lesson_activity_version_unique").on(
      table.lessonId,
      table.activityKey,
      table.version,
    ),
    check("uais_assessments_type_check", sql`${table.type} IN ('quiz', 'assignment', 'discussion', 'manual')`),
    check("uais_assessments_status_check", sql`${table.status} IN ('draft', 'published', 'archived')`),
    check("uais_assessments_version_check", sql`${table.version} > 0`),
    check("uais_assessments_edit_revision_check", sql`${table.editRevision} > 0`),
    check(
      "uais_assessments_ai_policy_check",
      sql`${table.aiPolicy} IN ('teacher-requested-draft', 'disabled')`,
    ),
    check(
      "uais_assessments_revision_policy_check",
      sql`${table.revisionPolicy} = 'teacher-requested'`,
    ),
  ],
);

export const uaisSubmissions = pgTable(
  "uais_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => uaisAssessments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("draft"),
    score: numeric("score", { precision: 5, scale: 2, mode: "number" }),
    contentRef: text("content_ref"),
    legacyContentRef: text("legacy_content_ref"),
    classExternalId: text("class_external_id"),
    currentVersionNo: integer("current_version_no").notNull().default(1),
    acceptedVersionId: uuid("accepted_version_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lastSubmittedAt: timestamp("last_submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("uais_submissions_assessment_user_unique").on(table.assessmentId, table.userId),
    index("uais_submissions_user_idx").on(table.userId),
    check(
      "uais_submissions_state_check",
      sql`${table.state} IN ('draft', 'submitted', 'revision_requested', 'resubmitted', 'accepted')`,
    ),
    check("uais_submissions_current_version_check", sql`${table.currentVersionNo} >= 0`),
    check("uais_submissions_score_check", sql`${table.score} IS NULL OR (${table.score} >= 0 AND ${table.score} <= 100)`),
  ],
);

export const uaisSubmissionVersions = pgTable(
  "uais_submission_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => uaisSubmissions.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    status: text("status").notNull().default("draft"),
    contentText: text("content_text").notNull(),
    contentHash: text("content_hash").notNull(),
    draftRevision: integer("draft_revision").notNull().default(1),
    createdAt,
    updatedAt,
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uais_submission_versions_submission_version_unique").on(
      table.submissionId,
      table.versionNo,
    ),
    index("uais_submission_versions_submission_status_idx").on(
      table.submissionId,
      table.status,
      table.versionNo,
    ),
    check("uais_submission_versions_version_check", sql`${table.versionNo} > 0`),
    check("uais_submission_versions_status_check", sql`${table.status} IN ('draft', 'sealed')`),
    check("uais_submission_versions_content_length_check", sql`char_length(${table.contentText}) <= 20000`),
    check("uais_submission_versions_draft_revision_check", sql`${table.draftRevision} > 0`),
  ],
);

export const uaisFeedback = pgTable(
  "uais_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => uaisSubmissions.id, { onDelete: "cascade" }),
    submissionVersionId: uuid("submission_version_id")
      .notNull()
      .references(() => uaisSubmissionVersions.id, { onDelete: "restrict" }),
    teacherUserId: uuid("teacher_user_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "restrict" }),
    origin: text("origin").notNull(),
    status: text("status").notNull().default("draft"),
    rubricJudgments: jsonb("rubric_judgments")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    feedbackText: text("feedback_text").notNull().default(""),
    requiresRevision: boolean("requires_revision").notNull().default(false),
    aiTraceRef: text("ai_trace_ref"),
    sourceDraftRevision: integer("source_draft_revision").notNull().default(1),
    createdAt,
    updatedAt,
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    index("uais_feedback_submission_version_status_idx").on(
      table.submissionId,
      table.submissionVersionId,
      table.status,
      table.createdAt,
    ),
    index("uais_feedback_teacher_status_idx").on(
      table.teacherUserId,
      table.status,
      table.createdAt,
    ),
    uniqueIndex("uais_feedback_teacher_version_draft_unique")
      .on(table.submissionVersionId, table.teacherUserId)
      .where(sql`${table.status} = 'draft'`),
    check("uais_feedback_origin_check", sql`${table.origin} IN ('teacher', 'ai-assisted')`),
    check(
      "uais_feedback_status_check",
      sql`${table.status} IN ('draft', 'released', 'superseded')`,
    ),
    check("uais_feedback_source_revision_check", sql`${table.sourceDraftRevision} > 0`),
  ],
);

export const uaisFormativeAttempts = pgTable(
  "uais_formative_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => uaisAssessments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "cascade" }),
    classExternalId: text("class_external_id").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    responseJson: jsonb("response_json").$type<Record<string, unknown>>().notNull(),
    responseHash: text("response_hash").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (table) => [
    uniqueIndex("uais_formative_attempts_assessment_user_attempt_unique").on(
      table.assessmentId,
      table.userId,
      table.attemptNo,
    ),
    index("uais_formative_attempts_assessment_user_idx").on(
      table.assessmentId,
      table.userId,
      table.attemptedAt,
    ),
    check("uais_formative_attempts_attempt_no_check", sql`${table.attemptNo} > 0`),
  ],
);

export const uaisLearningEvents = pgTable(
  "uais_learning_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => uaisCourses.id, { onDelete: "cascade" }),
    classId: uuid("class_id").references(() => uaisClasses.id, { onDelete: "set null" }),
    assessmentId: uuid("assessment_id").references(() => uaisAssessments.id, {
      onDelete: "set null",
    }),
    submissionId: uuid("submission_id").references(() => uaisSubmissions.id, {
      onDelete: "set null",
    }),
    verb: text("verb").notNull(),
    objectId: text("object_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    source: text("source").notNull().default("learning-loop-api"),
    projectionVersion: integer("projection_version").notNull().default(0),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("uais_learning_events_idempotency_key_unique").on(table.idempotencyKey),
    index("uais_learning_events_user_course_time_idx").on(
      table.userId,
      table.courseId,
      table.occurredAt,
    ),
    index("uais_learning_events_course_verb_time_idx").on(
      table.courseId,
      table.verb,
      table.occurredAt,
    ),
    index("uais_learning_events_submission_time_idx").on(
      table.submissionId,
      table.occurredAt,
    ),
    check("uais_learning_events_schema_version_check", sql`${table.schemaVersion} > 0`),
    check(
      "uais_learning_events_projection_version_check",
      sql`${table.projectionVersion} >= 0`,
    ),
    check(
      "uais_learning_events_source_check",
      sql`${table.source} IN ('legacy', 'learning-loop-api', 'ppt-playback')`,
    ),
  ],
);

export const uaisLearnerProfiles = pgTable(
  "uais_learner_profiles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => uaisCourses.id, { onDelete: "cascade" }),
    mastery: jsonb("mastery").$type<Record<string, unknown>>().notNull().default({}),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
    progress: jsonb("progress").$type<Record<string, unknown>>().notNull().default({}),
    projectionVersion: integer("projection_version").notNull().default(0),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.courseId] }),
    check(
      "uais_learner_profiles_projection_version_check",
      sql`${table.projectionVersion} >= 0`,
    ),
  ],
);

export const uaisRecommendations = pgTable(
  "uais_recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => uaisCourses.id, { onDelete: "cascade" }),
    nextLessonId: uuid("next_lesson_id").references(() => uaisLessons.id, {
      onDelete: "set null",
    }),
    rationale: text("rationale").notNull(),
    reasonCode: text("reason_code").notNull().default("legacy-rationale"),
    nextActionType: text("next_action_type").notNull().default("collect-more-evidence"),
    sourceStateVersion: integer("source_state_version").notNull().default(0),
    sourceEventId: uuid("source_event_id").references(() => uaisLearningEvents.id, {
      onDelete: "set null",
    }),
    createdAt,
  },
  (table) => [
    index("uais_recommendations_user_course_time_idx").on(
      table.userId,
      table.courseId,
      table.createdAt,
    ),
    check(
      "uais_recommendations_source_state_version_check",
      sql`${table.sourceStateVersion} >= 0`,
    ),
  ],
);

export const uaisXapiOutbox = pgTable(
  "uais_xapi_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    learningEventId: uuid("learning_event_id")
      .notNull()
      .references(() => uaisLearningEvents.id, { onDelete: "cascade" }),
    statementId: uuid("statement_id").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastErrorCategory: text("last_error_category"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    createdAt,
    updatedAt,
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uais_xapi_outbox_learning_event_unique").on(table.learningEventId),
    uniqueIndex("uais_xapi_outbox_statement_unique").on(table.statementId),
    index("uais_xapi_outbox_dispatch_idx").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    check(
      "uais_xapi_outbox_status_check",
      sql`${table.status} IN ('pending', 'processing', 'sent', 'failed', 'dead')`,
    ),
    check(
      "uais_xapi_outbox_attempt_count_check",
      sql`${table.attemptCount} >= 0 AND ${table.attemptCount} <= 10`,
    ),
  ],
);

export const uaisIdempotencyRecords = pgTable(
  "uais_idempotency_records",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    requestHash: text("request_hash").notNull(),
    resourceId: text("resource_id").notNull(),
    responseReceipt: jsonb("response_receipt")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt,
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("uais_idempotency_records_actor_scope_idx").on(
      table.actorUserId,
      table.scope,
      table.createdAt,
    ),
  ],
);

export const uaisAuditLog = pgTable(
  "uais_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id").references(() => uaisUsers.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    traceId: text("trace_id"),
    auditReason: text("audit_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [
    index("uais_audit_log_target_idx").on(table.targetType, table.targetId, table.createdAt),
  ],
);

export const uaisExportJobs = pgTable(
  "uais_export_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    initiatorId: uuid("initiator_id").references(() => uaisUsers.id, { onDelete: "set null" }),
    scope: text("scope").notNull(),
    manifestId: text("manifest_id").notNull(),
    status: text("status").notNull(),
    deleteBy: timestamp("delete_by", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    check("uais_export_jobs_status_check", sql`${table.status} IN ('queued', 'ready', 'failed', 'deleted')`),
  ],
);

export const uaisProviderJobs = pgTable(
  "uais_provider_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerType: text("provider_type").notNull(),
    providerJobId: text("provider_job_id").notNull(),
    status: text("status").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    deleteBy: timestamp("delete_by", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("uais_provider_jobs_provider_job_unique").on(
      table.providerType,
      table.providerJobId,
    ),
    check(
      "uais_provider_jobs_status_check",
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'deleted')`,
    ),
  ],
);

// Sign-in identifiers, one account, many addresses.
//
// The cohort signs in with email and either a student's official or personal
// address is acceptable, so the address cannot be `uaisUsers.account`: two
// addresses would resolve to two accounts and split one student into two
// actors. `account` stays the stable teaching actorId (no '@', which eight
// route validators require) and these rows point at it.
//
// Deliberately NOT added to `uaisCoreSchemaTables` below - that object's key set
// is pinned by an exact assertion in tests/core-database-foundation.test.ts, and
// this table has no drizzle consumer today. The hand-written SQL in
// migrations/0005_user_login_identifiers.sql is the source of truth, as it is
// for every table here.
export const uaisUserLoginIdentifiers = pgTable(
  "uais_user_login_identifiers",
  {
    identifier: text("identifier").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => uaisUsers.id, { onDelete: "cascade" }),
    identifierKind: text("identifier_kind").notNull().default("email"),
    createdAt,
  },
  (table) => [
    index("uais_user_login_identifiers_user_id_idx").on(table.userId),
    check(
      "uais_user_login_identifiers_kind_check",
      sql`${table.identifierKind} IN ('email', 'account')`,
    ),
    check(
      "uais_user_login_identifiers_lowercase_check",
      sql`${table.identifier} = lower(${table.identifier})`,
    ),
  ],
);

export const uaisCoreSchemaTables = {
  users: uaisUsers,
  courses: uaisCourses,
  lessons: uaisLessons,
  classes: uaisClasses,
  inviteCodes: uaisInviteCodes,
  enrollments: uaisEnrollments,
  assessments: uaisAssessments,
  submissions: uaisSubmissions,
  submissionVersions: uaisSubmissionVersions,
  feedback: uaisFeedback,
  formativeAttempts: uaisFormativeAttempts,
  learningEvents: uaisLearningEvents,
  learnerProfiles: uaisLearnerProfiles,
  recommendations: uaisRecommendations,
  xapiOutbox: uaisXapiOutbox,
  idempotencyRecords: uaisIdempotencyRecords,
  auditLog: uaisAuditLog,
  exportJobs: uaisExportJobs,
  providerJobs: uaisProviderJobs,
};
