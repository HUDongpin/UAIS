import { sql } from "drizzle-orm";
import {
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
    createdAt,
    updatedAt,
  },
  (table) => [
    index("uais_lessons_course_id_idx").on(table.courseId),
    uniqueIndex("uais_lessons_course_position_unique").on(table.courseId, table.position),
    check("uais_lessons_position_check", sql`${table.position} > 0`),
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
    status: text("status").notNull().default("open"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("uais_classes_course_teacher_idx").on(table.courseId, table.teacherId),
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
    createdAt,
    updatedAt,
  },
  (table) => [
    check("uais_assessments_type_check", sql`${table.type} IN ('quiz', 'assignment', 'discussion', 'manual')`),
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
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("uais_submissions_user_idx").on(table.userId),
    check("uais_submissions_state_check", sql`${table.state} IN ('draft', 'submitted', 'reviewed', 'returned')`),
    check("uais_submissions_score_check", sql`${table.score} IS NULL OR (${table.score} >= 0 AND ${table.score} <= 100)`),
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
    verb: text("verb").notNull(),
    objectId: text("object_id").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
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
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.courseId] }),
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

export const uaisCoreSchemaTables = {
  users: uaisUsers,
  courses: uaisCourses,
  lessons: uaisLessons,
  classes: uaisClasses,
  inviteCodes: uaisInviteCodes,
  enrollments: uaisEnrollments,
  assessments: uaisAssessments,
  submissions: uaisSubmissions,
  learningEvents: uaisLearningEvents,
  learnerProfiles: uaisLearnerProfiles,
  recommendations: uaisRecommendations,
  auditLog: uaisAuditLog,
  exportJobs: uaisExportJobs,
  providerJobs: uaisProviderJobs,
};
