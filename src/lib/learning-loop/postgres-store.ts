/* eslint-disable max-lines -- P1 commands stay co-located until their shared transaction primitives and idempotency contract are frozen. */
import { createHash, randomUUID } from "node:crypto";
import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import {
  assertLearningActivityTransition,
  assertSubmissionDecision,
  assertSubmissionTransition,
  normalizeLearningActivityDraft,
  normalizeRubricJudgments,
  normalizeSubmissionContent,
  type LearningActivityDraft,
} from "@/lib/learning-loop/domain";
import { createDeterministicXapiStatementId } from "@/lib/learning-loop/outbox";
import {
  learningEventCatalog,
  type LearningRecordEventInput,
  type LearningRecordEventType,
} from "@/lib/learning-records/xapi-events";

type LearningLoopSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  begin: (run: (sql: LearningLoopSql) => Promise<void>) => Promise<void>;
  end: (options?: { timeout?: number }) => Promise<void> | void;
};

type LearningLoopPostgresClient = {
  pooled?: boolean;
  sql: LearningLoopSql;
};

export type LearningLoopPostgresClientFactory = (input: {
  env: Record<string, string | undefined>;
  max?: number;
}) => LearningLoopPostgresClient;

export type LearningLoopPersistedReceipt = {
  status: "persisted";
  resourceId: string;
  state: string;
  revision: number;
  eventId?: string;
  traceId: string;
  persistedAt: string;
};

export class LearningLoopStoreError extends Error {
  readonly status: number;
  readonly reasonCode: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    reasonCode: string,
    details?: Record<string, unknown>,
  ) {
    super(reasonCode);
    this.name = "LearningLoopStoreError";
    this.status = status;
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

type StoreOptions = {
  env: Record<string, string | undefined>;
  createDatabase?: LearningLoopPostgresClientFactory;
  createId?: () => string;
  now?: () => Date;
};

export function createUaisLearningLoopPostgresStore(options: StoreOptions) {
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
  const createId = options.createId ?? randomUUID;
  const readNow = options.now ?? (() => new Date());

  return {
    async createActivity(input: {
      teacherAccount: string;
      course: { externalId: string; title: string };
      class: { externalId: string; name: string };
      lesson: {
        key: string;
        position: number;
        title: { "zh-CN": string; "en-US": string };
        manifestRef: string;
      };
      draft: unknown;
      idempotencyKey: string;
      traceId: string;
    }): Promise<LearningLoopPersistedReceipt> {
      const draft = normalizeLearningActivityDraft(input.draft);
      const persistedAt = readNow().toISOString();
      const requestHash = hashJson({
        action: "create-activity",
        teacherAccount: input.teacherAccount,
        course: input.course,
        class: input.class,
        lesson: input.lesson,
        draft,
      });
      const client = createDatabase({ env: options.env, max: 1 });
      let receipt: LearningLoopPersistedReceipt | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const replay = await readIdempotentReceipt({
            sql,
            actorAccount: input.teacherAccount,
            key: input.idempotencyKey,
            scope: "teacher-create-activity",
            requestHash,
          });
          if (replay) {
            receipt = replay;
            return;
          }

          const teacherId = await requireUserId({
            sql,
            account: input.teacherAccount,
            role: "teacher",
          });
          const courseRows = await sql`
            INSERT INTO uais_courses (slug, title, teacher_id, status, created_at, updated_at)
            VALUES (${input.course.externalId}, ${input.course.title}, ${teacherId}, 'published', ${persistedAt}, ${persistedAt})
            ON CONFLICT (slug)
            DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at
            WHERE uais_courses.teacher_id = EXCLUDED.teacher_id
            RETURNING id
          `;
          const courseId = readRequiredId(courseRows, "course-ownership-required");
          const classRows = await sql`
            INSERT INTO uais_classes (
              course_id, teacher_id, name, external_key, status, created_at, updated_at
            )
            VALUES (
              ${courseId}, ${teacherId}, ${input.class.name}, ${input.class.externalId},
              'open', ${persistedAt}, ${persistedAt}
            )
            ON CONFLICT (course_id, external_key) WHERE external_key IS NOT NULL
            DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at
            WHERE uais_classes.teacher_id = EXCLUDED.teacher_id
            RETURNING id
          `;
          readRequiredId(classRows, "class-ownership-required");
          const lessonRows = await sql`
            INSERT INTO uais_lessons (
              course_id, title, position, external_key, published_manifest_ref,
              status, created_at, updated_at
            )
            VALUES (
              ${courseId}, ${input.lesson.title["zh-CN"]}, ${input.lesson.position},
              ${input.lesson.key}, ${input.lesson.manifestRef}, 'published',
              ${persistedAt}, ${persistedAt}
            )
            ON CONFLICT (course_id, external_key) WHERE external_key IS NOT NULL
            DO UPDATE SET
              title = EXCLUDED.title,
              position = EXCLUDED.position,
              published_manifest_ref = EXCLUDED.published_manifest_ref,
              status = 'published',
              updated_at = EXCLUDED.updated_at
            RETURNING id
          `;
          const lessonId = readRequiredId(lessonRows, "lesson-registration-failed");
          const activityId = createId();
          const activityRows = await sql`
            INSERT INTO uais_assessments (
              id, lesson_id, type, title, activity_key, title_i18n,
              instructions_i18n, status, version, edit_revision, rubric, formative_check,
              due_at, ai_policy, revision_policy, target_class_external_id,
              created_at, updated_at
            )
            VALUES (
              ${activityId}, ${lessonId}, 'assignment', ${draft.title["zh-CN"]},
              ${activityId}, ${JSON.stringify(draft.title)}::text::jsonb,
              ${JSON.stringify(draft.instructions)}::text::jsonb, 'draft', 1, 1,
              ${JSON.stringify(draft.rubric)}::text::jsonb,
              ${JSON.stringify(draft.checkpoint)}::text::jsonb,
              ${draft.dueAt ?? null}, ${draft.aiPolicy}, ${draft.revisionPolicy},
              ${input.class.externalId}, ${persistedAt}, ${persistedAt}
            )
            RETURNING id, created_at
          `;
          const resourceId = readRequiredId(activityRows, "activity-create-failed");
          receipt = {
            status: "persisted",
            resourceId,
            state: "draft",
            revision: 1,
            traceId: input.traceId,
            persistedAt,
          };
          await writeAudit({
            sql,
            actorId: teacherId,
            action: "learning-activity-created",
            targetType: "learning-activity",
            targetId: resourceId,
            traceId: input.traceId,
            metadata: {
              courseId: input.course.externalId,
              classId: input.class.externalId,
              lessonKey: input.lesson.key,
              activityVersion: 1,
            },
            persistedAt,
          });
          await writeIdempotentReceipt({
            sql,
            actorUserId: teacherId,
            key: input.idempotencyKey,
            scope: "teacher-create-activity",
            requestHash,
            receipt,
            persistedAt,
          });
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return requireReceipt(receipt);
    },

    async updateActivity(input: {
      teacherAccount: string;
      activityId: string;
      expectedEditRevision: number;
      operation: "save" | "publish" | "archive" | "adjust-due-date" | "create-version";
      draft?: unknown;
      dueAt?: string | null;
      idempotencyKey: string;
      traceId: string;
    }): Promise<LearningLoopPersistedReceipt> {
      const normalizedDraft =
        input.operation === "save" || input.operation === "create-version"
          ? normalizeLearningActivityDraft(input.draft)
          : undefined;
      const dueAt =
        input.operation === "adjust-due-date"
          ? normalizeOptionalTimestamp(input.dueAt, "activity-due-at-invalid")
          : undefined;
      const persistedAt = readNow().toISOString();
      const requestHash = hashJson({
        action: "update-activity",
        teacherAccount: input.teacherAccount,
        activityId: input.activityId,
        expectedEditRevision: input.expectedEditRevision,
        operation: input.operation,
        draft: normalizedDraft,
        dueAt,
      });
      const client = createDatabase({ env: options.env, max: 1 });
      let receipt: LearningLoopPersistedReceipt | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const replay = await readIdempotentReceipt({
            sql,
            actorAccount: input.teacherAccount,
            key: input.idempotencyKey,
            scope: "teacher-update-activity",
            requestHash,
          });
          if (replay) {
            receipt = replay;
            return;
          }
          const teacherId = await requireUserId({
            sql,
            account: input.teacherAccount,
            role: "teacher",
          });
          const rows = await sql`
            SELECT
              a.id, a.activity_key, a.status, a.version, a.edit_revision,
              a.title_i18n, a.instructions_i18n, a.rubric, a.formative_check,
              a.due_at, a.ai_policy, a.revision_policy,
              a.target_class_external_id, l.id AS lesson_id,
              l.external_key AS lesson_key
            FROM uais_assessments a
            JOIN uais_lessons l ON l.id = a.lesson_id
            JOIN uais_courses c ON c.id = l.course_id
            WHERE a.id = ${input.activityId} AND c.teacher_id = ${teacherId}
            FOR UPDATE OF a
          `;
          const row = firstRow(rows);
          if (!row) throw new LearningLoopStoreError(404, "teacher-activity-required");
          const currentEditRevision = readInteger(row.edit_revision);
          if (currentEditRevision !== input.expectedEditRevision) {
            throw new LearningLoopStoreError(409, "stale-activity-revision", {
              latestRevision: currentEditRevision,
              recoveryAction: "reload-activity",
            });
          }
          const currentState = readActivityState(row.status);
          let resourceId = input.activityId;
          let nextState = currentState;
          let nextEditRevision = currentEditRevision + 1;

          if (input.operation === "publish") {
            assertLearningActivityTransition(currentState, "published");
            normalizeLearningActivityDraft({
              lessonKey: readString(row.lesson_key),
              targetClassId: readString(row.target_class_external_id),
              title: readRecord(row.title_i18n),
              instructions: readRecord(row.instructions_i18n),
              checkpoint: readRecord(row.formative_check),
              rubric: readArray(row.rubric),
              ...(readOptionalIsoTimestamp(row.due_at)
                ? { dueAt: readOptionalIsoTimestamp(row.due_at) }
                : {}),
              aiPolicy: readString(row.ai_policy),
              revisionPolicy: readString(row.revision_policy),
            });
            await sql`
              UPDATE uais_assessments
              SET status = 'archived', archived_at = ${persistedAt},
                  updated_at = ${persistedAt}
              WHERE lesson_id = ${readString(row.lesson_id)}
                AND activity_key = ${readString(row.activity_key)}
                AND id <> ${input.activityId}
                AND status = 'published'
            `;
            const updated = await sql`
              UPDATE uais_assessments
              SET status = 'published', published_at = ${persistedAt},
                  edit_revision = edit_revision + 1, updated_at = ${persistedAt}
              WHERE id = ${input.activityId} AND status = 'draft'
              RETURNING id, edit_revision
            `;
            resourceId = readRequiredId(updated, "activity-publish-conflict");
            nextEditRevision = readInteger(firstRow(updated)?.edit_revision);
            nextState = "published";
          } else if (input.operation === "archive") {
            assertLearningActivityTransition(currentState, "archived");
            const updated = await sql`
              UPDATE uais_assessments
              SET status = 'archived', archived_at = ${persistedAt},
                  edit_revision = edit_revision + 1, updated_at = ${persistedAt}
              WHERE id = ${input.activityId} AND status = 'published'
              RETURNING id, edit_revision
            `;
            resourceId = readRequiredId(updated, "activity-archive-conflict");
            nextEditRevision = readInteger(firstRow(updated)?.edit_revision);
            nextState = "archived";
          } else if (input.operation === "adjust-due-date") {
            if (currentState === "archived") {
              throw new LearningLoopStoreError(409, "archived-activity-immutable");
            }
            const updated = await sql`
              UPDATE uais_assessments
              SET due_at = ${dueAt ?? null}, edit_revision = edit_revision + 1,
                  updated_at = ${persistedAt}
              WHERE id = ${input.activityId} AND status <> 'archived'
              RETURNING id, edit_revision
            `;
            resourceId = readRequiredId(updated, "activity-due-date-conflict");
            nextEditRevision = readInteger(firstRow(updated)?.edit_revision);
          } else if (input.operation === "save") {
            if (currentState !== "draft" || !normalizedDraft) {
              throw new LearningLoopStoreError(409, "published-activity-version-required");
            }
            assertActivityIdentityUnchanged(normalizedDraft, row);
            const updated = await sql`
              UPDATE uais_assessments
              SET title = ${normalizedDraft.title["zh-CN"]},
                  title_i18n = ${JSON.stringify(normalizedDraft.title)}::text::jsonb,
                  instructions_i18n = ${JSON.stringify(normalizedDraft.instructions)}::text::jsonb,
                  rubric = ${JSON.stringify(normalizedDraft.rubric)}::text::jsonb,
                  formative_check = ${JSON.stringify(normalizedDraft.checkpoint)}::text::jsonb,
                  due_at = ${normalizedDraft.dueAt ?? null},
                  ai_policy = ${normalizedDraft.aiPolicy},
                  revision_policy = ${normalizedDraft.revisionPolicy},
                  edit_revision = edit_revision + 1, updated_at = ${persistedAt}
              WHERE id = ${input.activityId} AND status = 'draft'
              RETURNING id, edit_revision
            `;
            resourceId = readRequiredId(updated, "activity-save-conflict");
            nextEditRevision = readInteger(firstRow(updated)?.edit_revision);
          } else {
            if (currentState !== "published" || !normalizedDraft) {
              throw new LearningLoopStoreError(409, "published-activity-version-required");
            }
            assertActivityIdentityUnchanged(normalizedDraft, row);
            resourceId = createId();
            const nextVersion = readInteger(row.version) + 1;
            await sql`
              INSERT INTO uais_assessments (
                id, lesson_id, type, title, activity_key, title_i18n,
                instructions_i18n, status, version, edit_revision, rubric,
                formative_check, due_at, ai_policy, revision_policy,
                target_class_external_id, created_at, updated_at
              )
              VALUES (
                ${resourceId}, ${readString(row.lesson_id)}, 'assignment',
                ${normalizedDraft.title["zh-CN"]}, ${readString(row.activity_key)},
                ${JSON.stringify(normalizedDraft.title)}::text::jsonb,
                ${JSON.stringify(normalizedDraft.instructions)}::text::jsonb,
                'draft', ${nextVersion}, 1,
                ${JSON.stringify(normalizedDraft.rubric)}::text::jsonb,
                ${JSON.stringify(normalizedDraft.checkpoint)}::text::jsonb,
                ${normalizedDraft.dueAt ?? null}, ${normalizedDraft.aiPolicy},
                ${normalizedDraft.revisionPolicy}, ${normalizedDraft.targetClassId},
                ${persistedAt}, ${persistedAt}
              )
            `;
            nextState = "draft";
            nextEditRevision = 1;
          }

          receipt = {
            status: "persisted",
            resourceId,
            state: nextState,
            revision: nextEditRevision,
            traceId: input.traceId,
            persistedAt,
          };
          await writeAudit({
            sql,
            actorId: teacherId,
            action: `learning-activity-${input.operation}`,
            targetType: "learning-activity",
            targetId: resourceId,
            traceId: input.traceId,
            metadata: {
              sourceActivityId: input.activityId,
              operation: input.operation,
              activityVersion:
                input.operation === "create-version"
                  ? readInteger(row.version) + 1
                  : readInteger(row.version),
              editRevision: nextEditRevision,
              ...(input.operation === "adjust-due-date" ? { dueAt } : {}),
            },
            persistedAt,
          });
          await writeIdempotentReceipt({
            sql,
            actorUserId: teacherId,
            key: input.idempotencyKey,
            scope: "teacher-update-activity",
            requestHash,
            receipt,
            persistedAt,
          });
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return requireReceipt(receipt);
    },

    async recordLearningEvent(input: {
      studentAccount: string;
      classExternalId: string;
      event: LearningRecordEventInput;
      idempotencyKey: string;
      traceId: string;
    }): Promise<LearningLoopPersistedReceipt> {
      const event = normalizeRedactedLearningEvent(input.event, input.classExternalId);
      const persistedAt = readNow().toISOString();
      const requestHash = hashJson({
        action: "record-learning-event",
        studentAccount: input.studentAccount,
        classExternalId: input.classExternalId,
        event,
      });
      const client = createDatabase({ env: options.env, max: 1 });
      let receipt: LearningLoopPersistedReceipt | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const replay = await readIdempotentReceipt({
            sql,
            actorAccount: input.studentAccount,
            key: input.idempotencyKey,
            scope: "student-learning-event",
            requestHash,
          });
          if (replay) {
            receipt = replay;
            return;
          }
          const studentId = await requireUserId({
            sql,
            account: input.studentAccount,
            role: "student",
          });
          const scopeRows = await sql`
            SELECT c.id AS course_id, cl.id AS class_id
            FROM uais_courses c
            JOIN uais_classes cl
              ON cl.course_id = c.id AND cl.external_key = ${input.classExternalId}
            WHERE c.slug = ${event.context.courseId}
              AND c.status <> 'archived'
              AND cl.status <> 'archived'
            LIMIT 2
          `;
          if (scopeRows.length !== 1) {
            throw new LearningLoopStoreError(409, "learning-scope-projection-required");
          }
          const scope = firstRow(scopeRows);
          const courseId = readString(scope?.course_id);
          const classId = readString(scope?.class_id);
          if (!courseId || !classId) {
            throw new LearningLoopStoreError(409, "learning-scope-projection-required");
          }

          const eventId = createId();
          const projectionVersion = await writeGenericLearningEventProjection({
            sql,
            studentId,
            courseId,
            event,
            persistedAt,
          });
          const eventContext = createStoredLearningEventContext(event);
          await sql`
            INSERT INTO uais_learning_events (
              id, user_id, course_id, class_id, verb, object_id,
              idempotency_key, schema_version, source, projection_version,
              context, occurred_at, created_at
            )
            VALUES (
              ${eventId}, ${studentId}, ${courseId}, ${classId}, ${event.type},
              ${event.object.id}, ${`learning-loop:${input.idempotencyKey}`}, 1,
              'learning-loop-api', ${projectionVersion},
              ${JSON.stringify(eventContext)}::text::jsonb, ${persistedAt}, ${persistedAt}
            )
          `;
          await sql`
            INSERT INTO uais_xapi_outbox (
              id, learning_event_id, statement_id, status, attempt_count,
              next_attempt_at, created_at, updated_at
            )
            VALUES (
              ${createId()}, ${eventId}, ${createDeterministicXapiStatementId(eventId)},
              'pending', 0, ${persistedAt}, ${persistedAt}, ${persistedAt}
            )
          `;
          receipt = {
            status: "persisted",
            resourceId: eventId,
            state: "persisted",
            revision: projectionVersion,
            eventId,
            traceId: input.traceId,
            persistedAt,
          };
          await writeAudit({
            sql,
            actorId: studentId,
            action: "learning-event-recorded",
            targetType: "learning-event",
            targetId: eventId,
            traceId: input.traceId,
            metadata: {
              eventType: event.type,
              objectId: event.object.id,
              courseId: event.context.courseId,
              classId: input.classExternalId,
              projectionVersion,
            },
            persistedAt,
          });
          await writeIdempotentReceipt({
            sql,
            actorUserId: studentId,
            key: input.idempotencyKey,
            scope: "student-learning-event",
            requestHash,
            receipt,
            persistedAt,
          });
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return requireReceipt(receipt);
    },

    async recordFormativeAttempt(input: {
      studentAccount: string;
      activityId: string;
      classExternalId: string;
      response: unknown;
      idempotencyKey: string;
      traceId: string;
    }): Promise<LearningLoopPersistedReceipt> {
      const response = normalizeFormativeResponse(input.response);
      const responseHash = hashJson(response);
      const persistedAt = readNow().toISOString();
      const requestHash = hashJson({
        action: "record-formative-attempt",
        studentAccount: input.studentAccount,
        activityId: input.activityId,
        classExternalId: input.classExternalId,
        response,
      });
      const client = createDatabase({ env: options.env, max: 1 });
      let receipt: LearningLoopPersistedReceipt | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const replay = await readIdempotentReceipt({
            sql,
            actorAccount: input.studentAccount,
            key: input.idempotencyKey,
            scope: "student-formative-attempt",
            requestHash,
          });
          if (replay) {
            receipt = replay;
            return;
          }
          const studentId = await requireUserId({
            sql,
            account: input.studentAccount,
            role: "student",
          });
          const rows = await sql`
            SELECT
              a.id AS activity_id, a.formative_check, a.rubric,
              l.id AS lesson_id, l.external_key AS lesson_key,
              c.id AS course_id, c.slug AS course_external_id,
              cl.id AS class_id
            FROM uais_assessments a
            JOIN uais_lessons l ON l.id = a.lesson_id
            JOIN uais_courses c ON c.id = l.course_id
            JOIN uais_classes cl
              ON cl.course_id = c.id AND cl.external_key = a.target_class_external_id
            WHERE a.id = ${input.activityId}
              AND a.status = 'published'
              AND a.target_class_external_id = ${input.classExternalId}
          `;
          const row = firstRow(rows);
          if (!row) {
            throw new LearningLoopStoreError(404, "published-activity-required");
          }
          assertFormativeResponseMatchesCheckpoint(response, row.formative_check);
          await sql`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${`formative:${input.activityId}:${studentId}`}, 0)
            )
          `;
          const attemptRows = await sql`
            SELECT COALESCE(max(attempt_no), 0)::integer AS attempt_no
            FROM uais_formative_attempts
            WHERE assessment_id = ${input.activityId} AND user_id = ${studentId}
          `;
          const attemptNo = readInteger(firstRow(attemptRows)?.attempt_no) + 1;
          const attemptId = createId();
          await sql`
            INSERT INTO uais_formative_attempts (
              id, assessment_id, user_id, class_external_id, attempt_no,
              response_json, response_hash, attempted_at, created_at
            )
            VALUES (
              ${attemptId}, ${input.activityId}, ${studentId}, ${input.classExternalId},
              ${attemptNo}, ${JSON.stringify(response)}::text::jsonb, ${responseHash},
              ${persistedAt}, ${persistedAt}
            )
          `;
          const eventId = createId();
          const projectionVersion = await writeFormativeProjection({
            sql,
            studentId,
            courseId: readString(row.course_id),
            lessonKey: readString(row.lesson_key),
            persistedAt,
            attemptNo,
          });
          await sql`
            INSERT INTO uais_learning_events (
              id, user_id, course_id, class_id, assessment_id,
              verb, object_id, idempotency_key, schema_version, source,
              projection_version, context, occurred_at, created_at
            )
            VALUES (
              ${eventId}, ${studentId}, ${readString(row.course_id)}, ${readString(row.class_id)},
              ${input.activityId}, 'formative-check.attempted',
              ${`activity:${input.activityId}:checkpoint`},
              ${`learning-loop:${input.idempotencyKey}`}, 1, 'learning-loop-api',
              ${projectionVersion},
              ${JSON.stringify({
                activityId: input.activityId,
                classId: input.classExternalId,
                lessonKey: readString(row.lesson_key),
                attemptNo,
                checkpointKind: response.kind,
              })}::text::jsonb,
              ${persistedAt}, ${persistedAt}
            )
          `;
          await sql`
            INSERT INTO uais_recommendations (
              id, user_id, course_id, next_lesson_id, rationale, reason_code,
              next_action_type, source_state_version, source_event_id, created_at
            )
            VALUES (
              ${createId()}, ${studentId}, ${readString(row.course_id)}, ${readString(row.lesson_id)},
              'The formative checkpoint is complete; start the required submission.',
              'submission-not-started', 'start-submission', ${projectionVersion},
              ${eventId}, ${persistedAt}
            )
          `;
          await sql`
            INSERT INTO uais_xapi_outbox (
              id, learning_event_id, statement_id, status, attempt_count,
              next_attempt_at, created_at, updated_at
            )
            VALUES (
              ${createId()}, ${eventId}, ${createDeterministicXapiStatementId(eventId)},
              'pending', 0, ${persistedAt}, ${persistedAt}, ${persistedAt}
            )
          `;
          receipt = {
            status: "persisted",
            resourceId: attemptId,
            state: "attempted",
            revision: attemptNo,
            eventId,
            traceId: input.traceId,
            persistedAt,
          };
          await writeAudit({
            sql,
            actorId: studentId,
            action: "learning-formative-attempt-recorded",
            targetType: "learning-activity",
            targetId: input.activityId,
            traceId: input.traceId,
            metadata: {
              attemptId,
              attemptNo,
              checkpointKind: response.kind,
              responseHash,
              eventId,
            },
            persistedAt,
          });
          await writeIdempotentReceipt({
            sql,
            actorUserId: studentId,
            key: input.idempotencyKey,
            scope: "student-formative-attempt",
            requestHash,
            receipt,
            persistedAt,
          });
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return requireReceipt(receipt);
    },

    async claimBatch(input: {
      workerId: string;
      limit: number;
      claimedAt: string;
    }) {
      const client = createDatabase({ env: options.env, max: 1 });
      let rows: unknown[] = [];
      try {
        await client.sql.begin(async (sql) => {
          rows = await sql`
            WITH candidates AS (
              SELECT id
              FROM uais_xapi_outbox
              WHERE (
                  (status IN ('pending', 'failed') AND next_attempt_at <= ${input.claimedAt})
                  OR (
                    status = 'processing'
                    AND locked_at <= ${input.claimedAt}::timestamptz - interval '10 minutes'
                  )
                )
                AND attempt_count < 10
              ORDER BY next_attempt_at, created_at
              FOR UPDATE SKIP LOCKED
              LIMIT ${Math.max(1, Math.min(100, Math.floor(input.limit)))}
            ), claimed AS (
              UPDATE uais_xapi_outbox o
              SET status = 'processing', locked_at = ${input.claimedAt},
                  locked_by = ${input.workerId}, updated_at = ${input.claimedAt}
              FROM candidates
              WHERE o.id = candidates.id
              RETURNING o.*
            )
            SELECT
              claimed.id AS outbox_id,
              claimed.learning_event_id,
              claimed.statement_id,
              claimed.attempt_count,
              u.id::text AS actor_id,
              u.role AS actor_role,
              e.verb AS event_type,
              e.object_id,
              c.slug AS course_external_id,
              cl.external_key AS class_external_id,
              l.external_key AS lesson_key,
              e.context,
              e.occurred_at
            FROM claimed
            JOIN uais_learning_events e ON e.id = claimed.learning_event_id
            JOIN uais_users u ON u.id = e.user_id
            JOIN uais_courses c ON c.id = e.course_id
            LEFT JOIN uais_classes cl ON cl.id = e.class_id
            LEFT JOIN uais_assessments a ON a.id = e.assessment_id
            LEFT JOIN uais_lessons l ON l.id = a.lesson_id
            ORDER BY claimed.next_attempt_at, claimed.created_at
          `;
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return rows.map(mapClaimedOutboxRow);
    },

    async markSent(input: { outboxId: string; workerId: string; sentAt: string }) {
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        await client.sql`
          UPDATE uais_xapi_outbox
          SET status = 'sent', sent_at = ${input.sentAt}, updated_at = ${input.sentAt},
              locked_at = NULL, locked_by = NULL, last_error_category = NULL
          WHERE id = ${input.outboxId} AND status = 'processing'
            AND locked_by = ${input.workerId}
        `;
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async markFailed(input: {
      outboxId: string;
      workerId: string;
      status: "failed" | "dead";
      attemptCount: number;
      errorCategory: string;
      nextAttemptAt: string;
    }) {
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.errorCategory)) {
        throw new LearningLoopStoreError(400, "outbox-error-category-invalid");
      }
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        await client.sql`
          UPDATE uais_xapi_outbox
          SET status = ${input.status}, attempt_count = ${input.attemptCount},
              next_attempt_at = ${input.nextAttemptAt},
              last_error_category = ${input.errorCategory},
              updated_at = now(), locked_at = NULL, locked_by = NULL
          WHERE id = ${input.outboxId} AND status = 'processing'
            AND locked_by = ${input.workerId}
        `;
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async replayDead(input: { outboxId: string; replayedAt: string }) {
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const rows = await client.sql`
          UPDATE uais_xapi_outbox
          SET status = 'pending', attempt_count = 0, next_attempt_at = ${input.replayedAt},
              last_error_category = NULL, updated_at = ${input.replayedAt},
              locked_at = NULL, locked_by = NULL
          WHERE id = ${input.outboxId} AND status = 'dead'
          RETURNING id
        `;
        if (rows.length !== 1) {
          throw new LearningLoopStoreError(404, "dead-outbox-row-required");
        }
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async readOutboxBacklog(input: { now: string }) {
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const rows = await client.sql`
          SELECT
            count(*) FILTER (WHERE status IN ('pending', 'failed', 'processing'))::integer AS pending_count,
            count(*) FILTER (WHERE status = 'dead')::integer AS dead_count,
            COALESCE(
              EXTRACT(EPOCH FROM (
                ${input.now}::timestamptz -
                (min(created_at) FILTER (WHERE status IN ('pending', 'failed', 'processing', 'dead')))
              )),
              0
            )::integer AS max_age_seconds
          FROM uais_xapi_outbox
        `;
        const row = firstRow(rows);
        return {
          pendingCount: readInteger(row?.pending_count),
          deadCount: readInteger(row?.dead_count),
          maxAgeSeconds: Math.max(0, readInteger(row?.max_age_seconds)),
        };
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async saveSubmissionDraft(input: {
      studentAccount: string;
      activityId: string;
      classExternalId: string;
      contentText: string;
      expectedDraftRevision: number;
      traceId: string;
    }): Promise<LearningLoopPersistedReceipt> {
      const contentText = normalizeSubmissionContent(input.contentText);
      const contentHash = hashText(contentText);
      const persistedAt = readNow().toISOString();
      const client = createDatabase({ env: options.env, max: 1 });
      let receipt: LearningLoopPersistedReceipt | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const studentId = await requireUserId({
            sql,
            account: input.studentAccount,
            role: "student",
          });
          const activityRows = await sql`
            SELECT a.id
            FROM uais_assessments a
            WHERE a.id = ${input.activityId}
              AND a.status = 'published'
              AND a.target_class_external_id = ${input.classExternalId}
          `;
          readRequiredId(activityRows, "published-activity-required");
          const attemptRows = await sql`
            SELECT count(*)::integer AS count
            FROM uais_formative_attempts
            WHERE assessment_id = ${input.activityId} AND user_id = ${studentId}
          `;
          if (readCount(attemptRows) < 1) {
            throw new LearningLoopStoreError(409, "formative-attempt-required");
          }
          const submissionRows = await sql`
            SELECT
              s.id, s.state, s.current_version_no,
              v.id AS version_id, v.draft_revision, v.content_text
            FROM uais_submissions s
            JOIN uais_submission_versions v
              ON v.submission_id = s.id AND v.version_no = s.current_version_no
            WHERE s.assessment_id = ${input.activityId} AND s.user_id = ${studentId}
            FOR UPDATE OF s, v
          `;
          const existing = firstRow(submissionRows);
          if (!existing) {
            if (input.expectedDraftRevision !== 0) {
              throw staleDraftError(0, "");
            }
            const submissionId = createId();
            const versionId = createId();
            await sql`
              INSERT INTO uais_submissions (
                id, assessment_id, user_id, state, class_external_id,
                current_version_no, created_at, updated_at
              )
              VALUES (
                ${submissionId}, ${input.activityId}, ${studentId}, 'draft',
                ${input.classExternalId}, 1, ${persistedAt}, ${persistedAt}
              )
            `;
            await sql`
              INSERT INTO uais_submission_versions (
                id, submission_id, version_no, status, content_text,
                content_hash, draft_revision, created_at, updated_at
              )
              VALUES (
                ${versionId}, ${submissionId}, 1, 'draft', ${contentText},
                ${contentHash}, 1, ${persistedAt}, ${persistedAt}
              )
            `;
            receipt = {
              status: "persisted",
              resourceId: submissionId,
              state: "draft",
              revision: 1,
              traceId: input.traceId,
              persistedAt,
            };
          } else {
            const state = readString(existing.state);
            const currentVersionNo = readInteger(existing.current_version_no);
            const latestRevision = readInteger(existing.draft_revision);
            const latestContent = readString(existing.content_text);
            if (state === "revision_requested") {
              const nextVersionNo = currentVersionNo + 1;
              assertSubmissionTransition({
                from: "revision_requested",
                to: "draft",
                versionNo: nextVersionNo,
                previousVersionNo: currentVersionNo,
              });
              if (input.expectedDraftRevision !== 0) {
                throw staleDraftError(0, latestContent);
              }
              const versionId = createId();
              await sql`
                INSERT INTO uais_submission_versions (
                  id, submission_id, version_no, status, content_text,
                  content_hash, draft_revision, created_at, updated_at
                )
                VALUES (
                  ${versionId}, ${readString(existing.id)}, ${nextVersionNo}, 'draft',
                  ${contentText}, ${contentHash}, 1, ${persistedAt}, ${persistedAt}
                )
              `;
              await sql`
                UPDATE uais_submissions
                SET state = 'draft', current_version_no = ${nextVersionNo}, updated_at = ${persistedAt}
                WHERE id = ${readString(existing.id)}
              `;
              receipt = {
                status: "persisted",
                resourceId: readString(existing.id),
                state: "draft",
                revision: 1,
                traceId: input.traceId,
                persistedAt,
              };
            } else {
              if (state !== "draft") {
                throw new LearningLoopStoreError(409, "submission-version-sealed");
              }
              if (latestRevision !== input.expectedDraftRevision) {
                throw staleDraftError(latestRevision, latestContent);
              }
              const nextRevision = latestRevision + 1;
              await sql`
                UPDATE uais_submission_versions
                SET content_text = ${contentText}, content_hash = ${contentHash},
                    draft_revision = ${nextRevision}, updated_at = ${persistedAt}
                WHERE id = ${readString(existing.version_id)} AND status = 'draft'
              `;
              receipt = {
                status: "persisted",
                resourceId: readString(existing.id),
                state: "draft",
                revision: nextRevision,
                traceId: input.traceId,
                persistedAt,
              };
            }
          }
          await writeAudit({
            sql,
            actorId: studentId,
            action: "learning-submission-draft-saved",
            targetType: "learning-submission",
            targetId: receipt.resourceId,
            traceId: input.traceId,
            metadata: {
              activityId: input.activityId,
              draftRevision: receipt.revision,
              contentHash,
            },
            persistedAt,
          });
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return requireReceipt(receipt);
    },

    async submitSubmission(input: {
      studentAccount: string;
      activityId: string;
      classExternalId: string;
      expectedDraftRevision: number;
      idempotencyKey: string;
      traceId: string;
    }): Promise<LearningLoopPersistedReceipt> {
      const persistedAt = readNow().toISOString();
      const requestHash = hashJson({
        action: "submit-submission",
        studentAccount: input.studentAccount,
        activityId: input.activityId,
        classExternalId: input.classExternalId,
        expectedDraftRevision: input.expectedDraftRevision,
      });
      const client = createDatabase({ env: options.env, max: 1 });
      let receipt: LearningLoopPersistedReceipt | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const replay = await readIdempotentReceipt({
            sql,
            actorAccount: input.studentAccount,
            key: input.idempotencyKey,
            scope: "student-submit-submission",
            requestHash,
          });
          if (replay) {
            receipt = replay;
            return;
          }
          const studentId = await requireUserId({
            sql,
            account: input.studentAccount,
            role: "student",
          });
          const rows = await sql`
            SELECT
              s.id AS submission_id, s.state, s.current_version_no,
              v.id AS version_id, v.status AS version_status, v.draft_revision,
              a.id AS activity_id, l.id AS lesson_id, l.external_key AS lesson_key,
              c.id AS course_id, cl.id AS class_id,
              (SELECT count(*)::integer FROM uais_formative_attempts fa
                WHERE fa.assessment_id = a.id AND fa.user_id = s.user_id) AS checkpoint_attempts
            FROM uais_submissions s
            JOIN uais_submission_versions v
              ON v.submission_id = s.id AND v.version_no = s.current_version_no
            JOIN uais_assessments a ON a.id = s.assessment_id
            JOIN uais_lessons l ON l.id = a.lesson_id
            JOIN uais_courses c ON c.id = l.course_id
            JOIN uais_classes cl
              ON cl.course_id = c.id AND cl.external_key = s.class_external_id
            WHERE s.assessment_id = ${input.activityId}
              AND s.user_id = ${studentId}
              AND s.class_external_id = ${input.classExternalId}
              AND a.status = 'published'
            FOR UPDATE OF s, v
          `;
          const row = firstRow(rows);
          if (!row) {
            throw new LearningLoopStoreError(404, "submission-draft-required");
          }
          if (readInteger(row.checkpoint_attempts) < 1) {
            throw new LearningLoopStoreError(409, "formative-attempt-required");
          }
          if (readString(row.state) !== "draft" || readString(row.version_status) !== "draft") {
            throw new LearningLoopStoreError(409, "submission-version-sealed");
          }
          const draftRevision = readInteger(row.draft_revision);
          if (draftRevision !== input.expectedDraftRevision) {
            throw new LearningLoopStoreError(409, "stale-draft-revision", {
              latestRevision: draftRevision,
              recoveryAction: "reload-and-merge",
            });
          }
          const versionNo = readInteger(row.current_version_no);
          const nextState = versionNo === 1 ? "submitted" : "resubmitted";
          assertSubmissionTransition({ from: "draft", to: nextState, versionNo });
          await sql`
            UPDATE uais_submission_versions
            SET status = 'sealed', submitted_at = ${persistedAt}, updated_at = ${persistedAt}
            WHERE id = ${readString(row.version_id)} AND status = 'draft'
          `;
          await sql`
            UPDATE uais_submissions
            SET state = ${nextState}, submitted_at = COALESCE(submitted_at, ${persistedAt}),
                last_submitted_at = ${persistedAt}, updated_at = ${persistedAt}
            WHERE id = ${readString(row.submission_id)}
          `;

          const eventId = createId();
          const projectionVersion = await writeSubmissionProjection({
            sql,
            studentId,
            courseId: readString(row.course_id),
            lessonId: readString(row.lesson_id),
            lessonKey: readString(row.lesson_key),
            submissionState: nextState,
            persistedAt,
            eventId,
          });
          await sql`
            INSERT INTO uais_learning_events (
              id, user_id, course_id, class_id, assessment_id, submission_id,
              verb, object_id, idempotency_key, schema_version, source,
              projection_version, context, occurred_at, created_at
            )
            VALUES (
              ${eventId}, ${studentId}, ${readString(row.course_id)}, ${readString(row.class_id)},
              ${input.activityId}, ${readString(row.submission_id)},
              ${nextState === "resubmitted"
                ? "submission.resubmitted"
                : "submission.submitted"},
              ${`submission:${readString(row.submission_id)}:v${versionNo}`},
              ${`learning-loop:${input.idempotencyKey}`}, 1, 'learning-loop-api',
              ${projectionVersion},
              ${JSON.stringify({
                activityId: input.activityId,
                classId: input.classExternalId,
                lessonKey: readString(row.lesson_key),
                submissionState: nextState,
                versionNo,
              })}::text::jsonb,
              ${persistedAt}, ${persistedAt}
            )
          `;
          await sql`
            INSERT INTO uais_recommendations (
              id, user_id, course_id, next_lesson_id, rationale, reason_code,
              next_action_type, source_state_version, source_event_id, created_at
            )
            VALUES (
              ${createId()}, ${studentId}, ${readString(row.course_id)}, ${readString(row.lesson_id)},
              'Teacher review is pending for the current submission.',
              'teacher-review-pending', 'await-teacher-review', ${projectionVersion},
              ${eventId}, ${persistedAt}
            )
          `;
          const outboxId = createId();
          await sql`
            INSERT INTO uais_xapi_outbox (
              id, learning_event_id, statement_id, status, attempt_count,
              next_attempt_at, created_at, updated_at
            )
            VALUES (
              ${outboxId}, ${eventId}, ${createDeterministicXapiStatementId(eventId)},
              'pending', 0, ${persistedAt}, ${persistedAt}, ${persistedAt}
            )
          `;
          receipt = {
            status: "persisted",
            resourceId: readString(row.submission_id),
            state: nextState,
            revision: draftRevision,
            eventId,
            traceId: input.traceId,
            persistedAt,
          };
          await writeAudit({
            sql,
            actorId: studentId,
            action: "learning-submission-sealed",
            targetType: "learning-submission",
            targetId: receipt.resourceId,
            traceId: input.traceId,
            metadata: {
              activityId: input.activityId,
              versionNo,
              submissionState: nextState,
              eventId,
            },
            persistedAt,
          });
          await writeIdempotentReceipt({
            sql,
            actorUserId: studentId,
            key: input.idempotencyKey,
            scope: "student-submit-submission",
            requestHash,
            receipt,
            persistedAt,
          });
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return requireReceipt(receipt);
    },

    async reserveAiFeedbackRequest(input: {
      teacherAccount: string;
      submissionId: string;
      expectedSubmissionVersionId: string;
      expectedFeedbackRevision: number;
      idempotencyKey: string;
      traceId: string;
    }) {
      requireIdempotencyKey(input.idempotencyKey);
      if (
        !Number.isInteger(input.expectedFeedbackRevision) ||
        input.expectedFeedbackRevision < 0
      ) {
        throw new LearningLoopStoreError(400, "feedback-draft-revision-invalid");
      }
      const requestHash = createAiFeedbackRequestHash(input);
      const persistedAt = readNow().toISOString();
      const client = createDatabase({ env: options.env, max: 1 });
      let result:
        | { status: "reserved"; requestHash: string }
        | { status: "completed"; requestHash: string; receipt: LearningLoopPersistedReceipt }
        | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const teacherId = await requireUserId({
            sql,
            account: input.teacherAccount,
            role: "teacher",
          });
          await sql`
            SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))
          `;
          const existingRows = await sql`
            SELECT
              actor_user_id, scope, request_hash, response_receipt
            FROM uais_idempotency_records
            WHERE idempotency_key = ${input.idempotencyKey}
            FOR UPDATE
          `;
          const existing = firstRow(existingRows);
          if (existing) {
            if (
              readString(existing.actor_user_id) !== teacherId ||
              readString(existing.scope) !== "teacher-ai-feedback-request"
            ) {
              throw new LearningLoopStoreError(409, "idempotency-key-scope-conflict");
            }
            if (readString(existing.request_hash) !== requestHash) {
              throw new LearningLoopStoreError(409, "idempotency-key-payload-mismatch");
            }
            const stored = readRecord(existing.response_receipt);
            if (stored.status === "persisted") {
              result = {
                status: "completed",
                requestHash,
                receipt: parsePersistedReceipt(stored),
              };
              return;
            }
            throw new LearningLoopStoreError(
              409,
              stored.status === "failed"
                ? "ai-feedback-request-failed-use-new-key"
                : "ai-feedback-request-in-progress",
            );
          }
          const rows = await sql`
            SELECT
              s.id AS submission_id, s.state,
              v.id AS version_id, v.status AS version_status
            FROM uais_submissions s
            JOIN uais_submission_versions v
              ON v.submission_id = s.id AND v.version_no = s.current_version_no
            JOIN uais_assessments a ON a.id = s.assessment_id
            JOIN uais_lessons l ON l.id = a.lesson_id
            JOIN uais_courses c ON c.id = l.course_id
            WHERE s.id = ${input.submissionId} AND c.teacher_id = ${teacherId}
            FOR UPDATE OF s, v
          `;
          const row = firstRow(rows);
          if (!row) {
            throw new LearningLoopStoreError(404, "teacher-submission-required");
          }
          if (readString(row.version_id) !== input.expectedSubmissionVersionId) {
            throw new LearningLoopStoreError(409, "stale-submission-version", {
              latestSubmissionVersionId: readString(row.version_id),
              recoveryAction: "reload-submission",
            });
          }
          if (
            readString(row.version_status) !== "sealed" ||
            !["submitted", "resubmitted"].includes(readString(row.state))
          ) {
            throw new LearningLoopStoreError(409, "reviewable-submission-required");
          }
          await sql`
            INSERT INTO uais_idempotency_records (
              idempotency_key, actor_user_id, scope, request_hash,
              resource_id, response_receipt, created_at, expires_at
            )
            VALUES (
              ${input.idempotencyKey}, ${teacherId}, 'teacher-ai-feedback-request',
              ${requestHash}, ${createId()},
              ${JSON.stringify({
                status: "pending",
                traceId: input.traceId,
                submissionId: input.submissionId,
                submissionVersionId: input.expectedSubmissionVersionId,
              })}::text::jsonb,
              ${persistedAt}, ${new Date(
                readNow().getTime() + 7 * 24 * 60 * 60 * 1_000,
              ).toISOString()}
            )
          `;
          result = { status: "reserved", requestHash };
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      if (!result) {
        throw new LearningLoopStoreError(500, "ai-feedback-reservation-missing");
      }
      return result;
    },

    async failAiFeedbackRequest(input: {
      teacherAccount: string;
      idempotencyKey: string;
      requestHash: string;
      errorCategory: string;
      traceId: string;
    }) {
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.errorCategory)) {
        throw new LearningLoopStoreError(400, "ai-feedback-error-category-invalid");
      }
      const failedAt = readNow().toISOString();
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const teacherRows = await client.sql`
          SELECT id FROM uais_users
          WHERE account = ${input.teacherAccount}
            AND role = 'teacher' AND status = 'active'
          LIMIT 2
        `;
        const teacherId = readRequiredId(
          teacherRows,
          "account-projection-required",
        );
        await client.sql`
          UPDATE uais_idempotency_records
          SET response_receipt = ${JSON.stringify({
            status: "failed",
            reasonCode: "ai-feedback-request-failed",
            errorCategory: input.errorCategory,
            traceId: input.traceId,
            failedAt,
          })}::text::jsonb
          WHERE idempotency_key = ${input.idempotencyKey}
            AND actor_user_id = ${teacherId}
            AND scope = 'teacher-ai-feedback-request'
            AND request_hash = ${input.requestHash}
            AND response_receipt->>'status' = 'pending'
        `;
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    async saveFeedbackDraft(input: {
      teacherAccount: string;
      submissionId: string;
      expectedSubmissionVersionId: string;
      expectedFeedbackRevision: number;
      feedbackText: string;
      rubricJudgments: unknown;
      origin: "teacher" | "ai-assisted";
      aiTraceRef?: string;
      idempotencyKey?: string;
      aiRequest?: { idempotencyKey: string; requestHash: string };
      traceId: string;
    }): Promise<LearningLoopPersistedReceipt> {
      if (
        !Number.isInteger(input.expectedFeedbackRevision) ||
        input.expectedFeedbackRevision < 0
      ) {
        throw new LearningLoopStoreError(400, "feedback-draft-revision-invalid");
      }
      if (input.origin !== "teacher" && input.origin !== "ai-assisted") {
        throw new LearningLoopStoreError(400, "feedback-origin-invalid");
      }
      const feedbackText = normalizeFeedbackDraftText(input.feedbackText);
      if (Boolean(input.idempotencyKey) === Boolean(input.aiRequest)) {
        throw new LearningLoopStoreError(400, "feedback-idempotency-contract-invalid");
      }
      const requestHash = input.idempotencyKey
        ? hashJson({
            action: "save-feedback-draft",
            teacherAccount: input.teacherAccount,
            submissionId: input.submissionId,
            expectedSubmissionVersionId: input.expectedSubmissionVersionId,
            expectedFeedbackRevision: input.expectedFeedbackRevision,
            feedbackText,
            rubricJudgments: input.rubricJudgments,
            origin: input.origin,
          })
        : undefined;
      const persistedAt = readNow().toISOString();
      const client = createDatabase({ env: options.env, max: 1 });
      let receipt: LearningLoopPersistedReceipt | undefined;
      try {
        await client.sql.begin(async (sql) => {
          if (input.idempotencyKey && requestHash) {
            const replay = await readIdempotentReceipt({
              sql,
              actorAccount: input.teacherAccount,
              key: input.idempotencyKey,
              scope: "teacher-save-feedback-draft",
              requestHash,
            });
            if (replay) {
              receipt = replay;
              return;
            }
          }
          const teacherId = await requireUserId({
            sql,
            account: input.teacherAccount,
            role: "teacher",
          });
          const rows = await sql`
            SELECT
              s.id AS submission_id, s.state, s.current_version_no,
              v.id AS version_id, v.status AS version_status,
              a.id AS activity_id, a.rubric
            FROM uais_submissions s
            JOIN uais_submission_versions v
              ON v.submission_id = s.id AND v.version_no = s.current_version_no
            JOIN uais_assessments a ON a.id = s.assessment_id
            JOIN uais_lessons l ON l.id = a.lesson_id
            JOIN uais_courses c ON c.id = l.course_id
            WHERE s.id = ${input.submissionId} AND c.teacher_id = ${teacherId}
            FOR UPDATE OF s, v
          `;
          const row = firstRow(rows);
          if (!row) {
            throw new LearningLoopStoreError(404, "teacher-submission-required");
          }
          const versionId = readString(row.version_id);
          if (versionId !== input.expectedSubmissionVersionId) {
            throw new LearningLoopStoreError(409, "stale-submission-version", {
              latestSubmissionVersionId: versionId,
              recoveryAction: "reload-submission",
            });
          }
          if (
            readString(row.version_status) !== "sealed" ||
            !["submitted", "resubmitted"].includes(readString(row.state))
          ) {
            throw new LearningLoopStoreError(409, "reviewable-submission-required");
          }
          const rubricJudgments = normalizeRubricJudgments(
            input.rubricJudgments,
            readRubricDimensionIds(row.rubric),
          );
          const draftRows = await sql`
            SELECT
              id, source_draft_revision, feedback_text, rubric_judgments,
              origin, ai_trace_ref
            FROM uais_feedback
            WHERE submission_id = ${input.submissionId}
              AND submission_version_id = ${versionId}
              AND teacher_user_id = ${teacherId}
              AND status = 'draft'
            FOR UPDATE
          `;
          const existing = firstRow(draftRows);
          const aiTraceRef =
            input.origin === "ai-assisted"
              ? normalizeAiTraceRef(
                  input.origin,
                  input.aiTraceRef ?? readString(existing?.ai_trace_ref),
                )
              : undefined;
          const latestRevision = readInteger(existing?.source_draft_revision);
          if (latestRevision !== input.expectedFeedbackRevision) {
            throw new LearningLoopStoreError(409, "stale-feedback-draft-revision", {
              latestFeedbackRevision: latestRevision,
              latestFeedback: existing
                ? {
                    feedbackText: readString(existing.feedback_text),
                    rubricJudgments: readRecord(existing.rubric_judgments),
                  }
                : undefined,
              recoveryAction: "reload-feedback-draft",
            });
          }
          const nextRevision = latestRevision + 1;
          const feedbackId = existing ? readString(existing.id) : createId();
          const updated = await sql`
            INSERT INTO uais_feedback (
              id, submission_id, submission_version_id, teacher_user_id,
              origin, status, rubric_judgments, feedback_text,
              requires_revision, ai_trace_ref, source_draft_revision,
              created_at, updated_at
            )
            VALUES (
              ${feedbackId}, ${input.submissionId}, ${versionId}, ${teacherId},
              ${input.origin}, 'draft',
              ${JSON.stringify(rubricJudgments)}::text::jsonb, ${feedbackText},
              false, ${aiTraceRef ?? null}, ${nextRevision},
              ${persistedAt}, ${persistedAt}
            )
            ON CONFLICT (submission_version_id, teacher_user_id)
              WHERE status = 'draft'
            DO UPDATE SET
              origin = EXCLUDED.origin,
              rubric_judgments = EXCLUDED.rubric_judgments,
              feedback_text = EXCLUDED.feedback_text,
              ai_trace_ref = EXCLUDED.ai_trace_ref,
              source_draft_revision = EXCLUDED.source_draft_revision,
              updated_at = EXCLUDED.updated_at
            RETURNING id, source_draft_revision
          `;
          const saved = firstRow(updated);
          if (!saved) {
            throw new LearningLoopStoreError(409, "feedback-draft-save-conflict");
          }
          receipt = {
            status: "persisted",
            resourceId: readString(saved.id),
            state: "draft",
            revision: readInteger(saved.source_draft_revision),
            traceId: input.traceId,
            persistedAt,
          };
          if (input.aiRequest) {
            requireIdempotencyKey(input.aiRequest.idempotencyKey);
            if (!/^[0-9a-f]{64}$/.test(input.aiRequest.requestHash)) {
              throw new LearningLoopStoreError(400, "ai-feedback-request-hash-invalid");
            }
            const completionRows = await sql`
              UPDATE uais_idempotency_records
              SET resource_id = ${receipt.resourceId},
                  response_receipt = ${JSON.stringify(receipt)}::text::jsonb
              WHERE idempotency_key = ${input.aiRequest.idempotencyKey}
                AND actor_user_id = ${teacherId}
                AND scope = 'teacher-ai-feedback-request'
                AND request_hash = ${input.aiRequest.requestHash}
                AND response_receipt->>'status' = 'pending'
              RETURNING idempotency_key
            `;
            if (completionRows.length !== 1) {
              throw new LearningLoopStoreError(409, "ai-feedback-reservation-required");
            }
          }
          await writeAudit({
            sql,
            actorId: teacherId,
            action: "learning-feedback-draft-saved",
            targetType: "learning-feedback",
            targetId: receipt.resourceId,
            traceId: input.traceId,
            metadata: {
              submissionId: input.submissionId,
              submissionVersionId: versionId,
              activityId: readString(row.activity_id),
              origin: input.origin,
              feedbackRevision: receipt.revision,
            },
            persistedAt,
          });
          if (input.idempotencyKey && requestHash) {
            await writeIdempotentReceipt({
              sql,
              actorUserId: teacherId,
              key: input.idempotencyKey,
              scope: "teacher-save-feedback-draft",
              requestHash,
              receipt,
              persistedAt,
            });
          }
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return requireReceipt(receipt);
    },

    async decideSubmission(input: {
      teacherAccount: string;
      submissionId: string;
      expectedSubmissionVersionId: string;
      decision: "request-revision" | "accept";
      feedbackText: string;
      rubricJudgments: unknown;
      origin: "teacher" | "ai-assisted";
      aiTraceRef?: string;
      idempotencyKey: string;
      traceId: string;
    }): Promise<LearningLoopPersistedReceipt> {
      const decision = assertSubmissionDecision({
        decision: input.decision,
        feedbackText: input.feedbackText,
      });
      const feedbackText = normalizeSubmissionContent(decision.feedbackText);
      if (input.origin !== "teacher" && input.origin !== "ai-assisted") {
        throw new LearningLoopStoreError(400, "feedback-origin-invalid");
      }
      const persistedAt = readNow().toISOString();
      const requestHash = hashJson({
        action: "decide-submission",
        teacherAccount: input.teacherAccount,
        submissionId: input.submissionId,
        expectedSubmissionVersionId: input.expectedSubmissionVersionId,
        decision: input.decision,
        feedbackText,
        rubricJudgments: input.rubricJudgments,
        origin: input.origin,
      });
      const client = createDatabase({ env: options.env, max: 1 });
      let receipt: LearningLoopPersistedReceipt | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const replay = await readIdempotentReceipt({
            sql,
            actorAccount: input.teacherAccount,
            key: input.idempotencyKey,
            scope: "teacher-submission-decision",
            requestHash,
          });
          if (replay) {
            receipt = replay;
            return;
          }
          const teacherId = await requireUserId({
            sql,
            account: input.teacherAccount,
            role: "teacher",
          });
          const rows = await sql`
            SELECT
              s.id AS submission_id, s.user_id AS student_id, s.state,
              s.current_version_no, v.id AS version_id, v.status AS version_status,
              a.id AS activity_id, a.rubric, l.id AS lesson_id,
              l.external_key AS lesson_key, c.id AS course_id, cl.id AS class_id
            FROM uais_submissions s
            JOIN uais_submission_versions v
              ON v.submission_id = s.id AND v.version_no = s.current_version_no
            JOIN uais_assessments a ON a.id = s.assessment_id
            JOIN uais_lessons l ON l.id = a.lesson_id
            JOIN uais_courses c ON c.id = l.course_id
            JOIN uais_classes cl
              ON cl.course_id = c.id AND cl.external_key = s.class_external_id
            WHERE s.id = ${input.submissionId}
              AND c.teacher_id = ${teacherId}
            FOR UPDATE OF s, v
          `;
          const row = firstRow(rows);
          if (!row) {
            throw new LearningLoopStoreError(404, "teacher-submission-required");
          }
          const versionId = readString(row.version_id);
          if (versionId !== input.expectedSubmissionVersionId) {
            throw new LearningLoopStoreError(409, "stale-submission-version", {
              latestSubmissionVersionId: versionId,
              recoveryAction: "reload-submission",
            });
          }
          if (readString(row.version_status) !== "sealed") {
            throw new LearningLoopStoreError(409, "sealed-submission-version-required");
          }
          const currentState = readSubmissionState(row.state);
          const versionNo = readInteger(row.current_version_no);
          const nextState = input.decision === "accept" ? "accepted" : "revision_requested";
          assertSubmissionTransition({ from: currentState, to: nextState, versionNo });
          const rubricDimensionIds = readRubricDimensionIds(row.rubric);
          const rubricJudgments = normalizeRubricJudgments(
            input.rubricJudgments,
            rubricDimensionIds,
          );
          const aiTraceRef =
            input.origin === "ai-assisted"
              ? normalizeAiTraceRef(
                  input.origin,
                  input.aiTraceRef ??
                    readString(
                      firstRow(await sql`
                        SELECT ai_trace_ref
                        FROM uais_feedback
                        WHERE submission_id = ${input.submissionId}
                          AND submission_version_id = ${versionId}
                          AND teacher_user_id = ${teacherId}
                          AND status = 'draft'
                          AND origin = 'ai-assisted'
                        LIMIT 1
                      `)?.ai_trace_ref,
                    ),
                )
              : undefined;

          await sql`
            UPDATE uais_feedback
            SET status = 'superseded', updated_at = ${persistedAt}
            WHERE submission_id = ${input.submissionId}
              AND status = 'released'
              AND submission_version_id <> ${versionId}
          `;
          const feedbackId = createId();
          await sql`
            INSERT INTO uais_feedback (
              id, submission_id, submission_version_id, teacher_user_id,
              origin, status, rubric_judgments, feedback_text,
              requires_revision, ai_trace_ref, source_draft_revision,
              created_at, updated_at, released_at
            )
            VALUES (
              ${feedbackId}, ${input.submissionId}, ${versionId}, ${teacherId},
              ${input.origin}, 'released', ${JSON.stringify(rubricJudgments)}::text::jsonb,
              ${feedbackText}, ${input.decision === "request-revision"},
              ${aiTraceRef ?? null}, 1, ${persistedAt}, ${persistedAt}, ${persistedAt}
            )
          `;
          await sql`
            UPDATE uais_submissions
            SET state = ${nextState}, reviewed_at = ${persistedAt},
                accepted_version_id = ${input.decision === "accept" ? versionId : null},
                updated_at = ${persistedAt}
            WHERE id = ${input.submissionId}
          `;

          const feedbackEventId = createId();
          const decisionEventId = createId();
          const studentId = readString(row.student_id);
          const courseId = readString(row.course_id);
          const classId = readString(row.class_id);
          const activityId = readString(row.activity_id);
          const lessonId = readString(row.lesson_id);
          const lessonKey = readString(row.lesson_key);
          const projectionVersion = await writeSubmissionProjection({
            sql,
            studentId,
            courseId,
            lessonId,
            lessonKey,
            submissionState: nextState,
            persistedAt,
            eventId: decisionEventId,
          });
          const eventContext = {
            activityId,
            lessonKey,
            submissionState: nextState,
            versionNo,
            rubricDimensionIds,
          };
          await sql`
            INSERT INTO uais_learning_events (
              id, user_id, course_id, class_id, assessment_id, submission_id,
              verb, object_id, idempotency_key, schema_version, source,
              projection_version, context, occurred_at, created_at
            )
            VALUES
              (
                ${feedbackEventId}, ${teacherId}, ${courseId}, ${classId}, ${activityId},
                ${input.submissionId}, 'feedback.released',
                ${`submission:${input.submissionId}:v${versionNo}:feedback`},
                ${`learning-loop:${input.idempotencyKey}:feedback`}, 1,
                'learning-loop-api', ${projectionVersion},
                ${JSON.stringify(eventContext)}::text::jsonb, ${persistedAt}, ${persistedAt}
              ),
              (
                ${decisionEventId}, ${teacherId}, ${courseId}, ${classId}, ${activityId},
                ${input.submissionId},
                ${input.decision === "accept"
                  ? "submission.accepted"
                  : "submission.revision-requested"},
                ${`submission:${input.submissionId}:v${versionNo}`},
                ${`learning-loop:${input.idempotencyKey}:decision`}, 1,
                'learning-loop-api', ${projectionVersion},
                ${JSON.stringify(eventContext)}::text::jsonb, ${persistedAt}, ${persistedAt}
              )
          `;
          await sql`
            INSERT INTO uais_recommendations (
              id, user_id, course_id, next_lesson_id, rationale, reason_code,
              next_action_type, source_state_version, source_event_id, created_at
            )
            VALUES (
              ${createId()}, ${studentId}, ${courseId}, ${lessonId},
              ${input.decision === "accept"
                ? "The current learning unit is accepted."
                : "Revise the current submission using released teacher feedback."},
              ${input.decision === "accept"
                ? "current-unit-accepted"
                : "revision-requested"},
              ${input.decision === "accept" ? "open-next-lesson" : "revise-submission"},
              ${projectionVersion}, ${decisionEventId}, ${persistedAt}
            )
          `;
          await sql`
            INSERT INTO uais_xapi_outbox (
              id, learning_event_id, statement_id, status, attempt_count,
              next_attempt_at, created_at, updated_at
            )
            VALUES
              (
                ${createId()}, ${feedbackEventId},
                ${createDeterministicXapiStatementId(feedbackEventId)}, 'pending', 0,
                ${persistedAt}, ${persistedAt}, ${persistedAt}
              ),
              (
                ${createId()}, ${decisionEventId},
                ${createDeterministicXapiStatementId(decisionEventId)}, 'pending', 0,
                ${persistedAt}, ${persistedAt}, ${persistedAt}
              )
          `;
          receipt = {
            status: "persisted",
            resourceId: input.submissionId,
            state: nextState,
            revision: versionNo,
            eventId: decisionEventId,
            traceId: input.traceId,
            persistedAt,
          };
          await writeAudit({
            sql,
            actorId: teacherId,
            action:
              input.decision === "accept"
                ? "learning-submission-accepted"
                : "learning-submission-revision-requested",
            targetType: "learning-submission",
            targetId: input.submissionId,
            traceId: input.traceId,
            metadata: {
              activityId,
              versionId,
              versionNo,
              feedbackId,
              origin: input.origin,
              rubricDimensionIds,
              decisionEventId,
            },
            persistedAt,
          });
          await writeIdempotentReceipt({
            sql,
            actorUserId: teacherId,
            key: input.idempotencyKey,
            scope: "teacher-submission-decision",
            requestHash,
            receipt,
            persistedAt,
          });
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return requireReceipt(receipt);
    },
  };
}

async function writeGenericLearningEventProjection(input: {
  sql: LearningLoopSql;
  studentId: string;
  courseId: string;
  event: LearningRecordEventInput;
  persistedAt: string;
}) {
  const profileRows = await input.sql`
    SELECT progress, projection_version
    FROM uais_learner_profiles
    WHERE user_id = ${input.studentId} AND course_id = ${input.courseId}
    FOR UPDATE
  `;
  const current = firstRow(profileRows);
  const projectionVersion = readInteger(current?.projection_version ?? 0) + 1;
  const progress = {
    ...readRecord(current?.progress),
    lastEventType: input.event.type,
    lastEventObjectId: input.event.object.id,
    ...(input.event.context.lessonId
      ? { lastLessonKey: input.event.context.lessonId }
      : {}),
    updatedAt: input.persistedAt,
  };
  await input.sql`
    INSERT INTO uais_learner_profiles (
      user_id, course_id, mastery, preferences, progress,
      projection_version, last_event_at, updated_at
    )
    VALUES (
      ${input.studentId}, ${input.courseId}, '{}'::jsonb, '{}'::jsonb,
      ${JSON.stringify(progress)}::text::jsonb, ${projectionVersion},
      ${input.persistedAt}, ${input.persistedAt}
    )
    ON CONFLICT (user_id, course_id)
    DO UPDATE SET
      progress = EXCLUDED.progress,
      projection_version = EXCLUDED.projection_version,
      last_event_at = EXCLUDED.last_event_at,
      updated_at = EXCLUDED.updated_at
  `;
  return projectionVersion;
}

async function writeSubmissionProjection(input: {
  sql: LearningLoopSql;
  studentId: string;
  courseId: string;
  lessonId: string;
  lessonKey: string;
  submissionState: string;
  persistedAt: string;
  eventId: string;
}) {
  const profileRows = await input.sql`
    SELECT progress, projection_version
    FROM uais_learner_profiles
    WHERE user_id = ${input.studentId} AND course_id = ${input.courseId}
    FOR UPDATE
  `;
  const current = firstRow(profileRows);
  const projectionVersion = readInteger(current?.projection_version ?? 0) + 1;
  const progress = {
    ...readRecord(current?.progress),
    lastLessonKey: input.lessonKey,
    lastSubmissionState: input.submissionState,
    updatedAt: input.persistedAt,
  };
  await input.sql`
    INSERT INTO uais_learner_profiles (
      user_id, course_id, mastery, preferences, progress,
      projection_version, last_event_at, updated_at
    )
    VALUES (
      ${input.studentId}, ${input.courseId}, '{}'::jsonb, '{}'::jsonb,
      ${JSON.stringify(progress)}::text::jsonb, ${projectionVersion},
      ${input.persistedAt}, ${input.persistedAt}
    )
    ON CONFLICT (user_id, course_id)
    DO UPDATE SET
      progress = EXCLUDED.progress,
      projection_version = EXCLUDED.projection_version,
      last_event_at = EXCLUDED.last_event_at,
      updated_at = EXCLUDED.updated_at
  `;
  return projectionVersion;
}

async function writeFormativeProjection(input: {
  sql: LearningLoopSql;
  studentId: string;
  courseId: string;
  lessonKey: string;
  persistedAt: string;
  attemptNo: number;
}) {
  const profileRows = await input.sql`
    SELECT progress, projection_version
    FROM uais_learner_profiles
    WHERE user_id = ${input.studentId} AND course_id = ${input.courseId}
    FOR UPDATE
  `;
  const current = firstRow(profileRows);
  const projectionVersion = readInteger(current?.projection_version ?? 0) + 1;
  const progress = {
    ...readRecord(current?.progress),
    lastLessonKey: input.lessonKey,
    lastCheckpointAttemptNo: input.attemptNo,
    lastCheckpointAttemptedAt: input.persistedAt,
    updatedAt: input.persistedAt,
  };
  await input.sql`
    INSERT INTO uais_learner_profiles (
      user_id, course_id, mastery, preferences, progress,
      projection_version, last_event_at, updated_at
    )
    VALUES (
      ${input.studentId}, ${input.courseId}, '{}'::jsonb, '{}'::jsonb,
      ${JSON.stringify(progress)}::text::jsonb, ${projectionVersion},
      ${input.persistedAt}, ${input.persistedAt}
    )
    ON CONFLICT (user_id, course_id)
    DO UPDATE SET
      progress = EXCLUDED.progress,
      projection_version = EXCLUDED.projection_version,
      last_event_at = EXCLUDED.last_event_at,
      updated_at = EXCLUDED.updated_at
  `;
  return projectionVersion;
}

function normalizeRedactedLearningEvent(
  value: LearningRecordEventInput,
  authorizedClassId: string,
): LearningRecordEventInput {
  if (!Object.hasOwn(learningEventCatalog, value.type)) {
    throw new LearningLoopStoreError(400, "learning-event-type-invalid");
  }
  const objectId = normalizeBoundedIdentifier(
    value.object?.id,
    500,
    "learning-event-object-invalid",
  );
  const objectName = normalizeBoundedIdentifier(
    value.object?.name,
    200,
    "learning-event-object-invalid",
  );
  const courseId = normalizeBoundedIdentifier(
    value.context?.courseId,
    160,
    "learning-event-course-invalid",
  );
  const classId = normalizeBoundedIdentifier(
    authorizedClassId,
    160,
    "learning-event-class-invalid",
  );
  const lessonId = value.context?.lessonId
    ? normalizeBoundedIdentifier(
        value.context.lessonId,
        160,
        "learning-event-lesson-invalid",
      )
    : undefined;
  const result = value.result
    ? {
        ...(typeof value.result.success === "boolean"
          ? { success: value.result.success }
          : {}),
        ...(typeof value.result.completion === "boolean"
          ? { completion: value.result.completion }
          : {}),
        ...(typeof value.result.duration === "string" && value.result.duration.length <= 80
          ? { duration: value.result.duration }
          : {}),
      }
    : undefined;
  const competencyIds = value.context?.competencyIds
    ?.filter((item): item is string => typeof item === "string")
    .slice(0, 20)
    .map((item) => item.trim().slice(0, 120))
    .filter(Boolean);
  return {
    type: value.type,
    object: {
      id: objectId,
      name: objectName,
      ...(value.object.type ? { type: value.object.type } : {}),
      ...(typeof value.object.interactionType === "string" &&
      value.object.interactionType.length <= 80
        ? { interactionType: value.object.interactionType }
        : {}),
    },
    ...(result && Object.keys(result).length > 0 ? { result } : {}),
    context: {
      courseId,
      classId,
      ...(lessonId ? { lessonId } : {}),
      ...(typeof value.context.locale === "string" && value.context.locale.length <= 20
        ? { locale: value.context.locale }
        : {}),
      ...(competencyIds && competencyIds.length > 0 ? { competencyIds } : {}),
    },
  };
}

function createStoredLearningEventContext(event: LearningRecordEventInput) {
  return {
    classId: event.context.classId,
    ...(event.context.lessonId ? { lessonKey: event.context.lessonId } : {}),
    ...(event.context.locale ? { locale: event.context.locale } : {}),
    ...(event.context.competencyIds
      ? { competencyIds: event.context.competencyIds }
      : {}),
    ...(event.result ? { result: event.result } : {}),
  };
}

function normalizeBoundedIdentifier(
  value: unknown,
  maxLength: number,
  reasonCode: string,
) {
  const text = readString(value).trim();
  if (!text || Array.from(text).length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new LearningLoopStoreError(400, reasonCode);
  }
  return text;
}

type NormalizedFormativeResponse =
  | { kind: "single-choice"; optionId: string }
  | { kind: "short-answer"; text: string };

function normalizeFormativeResponse(value: unknown): NormalizedFormativeResponse {
  const input = readRecord(value);
  if (input.kind === "single-choice") {
    const optionId = readString(input.optionId);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(optionId)) {
      throw new LearningLoopStoreError(400, "formative-option-invalid");
    }
    return { kind: "single-choice", optionId };
  }
  if (input.kind === "short-answer") {
    const text = normalizeSubmissionContent(input.text);
    if (Array.from(text).length > 4_000) {
      throw new LearningLoopStoreError(400, "formative-response-too-long");
    }
    return { kind: "short-answer", text };
  }
  throw new LearningLoopStoreError(400, "formative-response-invalid");
}

function assertFormativeResponseMatchesCheckpoint(
  response: NormalizedFormativeResponse,
  checkpointValue: unknown,
) {
  const checkpoint = readRecord(checkpointValue);
  if (checkpoint.kind !== response.kind) {
    throw new LearningLoopStoreError(400, "formative-response-kind-mismatch");
  }
  if (response.kind === "single-choice") {
    const options = Array.isArray(checkpoint.options) ? checkpoint.options : [];
    if (
      !options.some(
        (option) => readString(readRecord(option).id) === response.optionId,
      )
    ) {
      throw new LearningLoopStoreError(400, "formative-option-invalid");
    }
  }
}

function readRubricDimensionIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw new LearningLoopStoreError(500, "activity-rubric-invalid");
  }
  const ids = value.map((dimension) => readString(readRecord(dimension).id));
  if (
    ids.length < 3 ||
    ids.length > 5 ||
    ids.some((id) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new LearningLoopStoreError(500, "activity-rubric-invalid");
  }
  return ids;
}

function readSubmissionState(value: unknown) {
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
  if (value === "draft" || value === "published" || value === "archived") {
    return value;
  }
  throw new LearningLoopStoreError(500, "activity-state-invalid");
}

function readArray(value: unknown): unknown[] {
  if (typeof value === "string") {
    try {
      return readArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function normalizeOptionalTimestamp(value: unknown, reasonCode: string) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new LearningLoopStoreError(400, reasonCode);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new LearningLoopStoreError(400, reasonCode);
  }
  return new Date(timestamp).toISOString();
}

function readOptionalIsoTimestamp(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  const text = readString(value);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    throw new LearningLoopStoreError(500, "activity-due-at-invalid");
  }
  return new Date(timestamp).toISOString();
}

function assertActivityIdentityUnchanged(
  draft: LearningActivityDraft,
  row: Record<string, unknown>,
) {
  if (
    draft.lessonKey !== readString(row.lesson_key) ||
    draft.targetClassId !== readString(row.target_class_external_id)
  ) {
    throw new LearningLoopStoreError(409, "activity-identity-immutable");
  }
}

function normalizeAiTraceRef(
  origin: "teacher" | "ai-assisted",
  value: string | undefined,
) {
  if (origin === "teacher" && !value) return undefined;
  const normalized = value?.trim();
  if (!normalized || !/^[0-9a-f]{64}$/.test(normalized)) {
    throw new LearningLoopStoreError(400, "ai-trace-reference-invalid");
  }
  return normalized;
}

function normalizeFeedbackDraftText(value: unknown) {
  if (typeof value !== "string") {
    throw new LearningLoopStoreError(400, "feedback-text-invalid");
  }
  if (!value.trim()) return "";
  return normalizeSubmissionContent(value);
}

function mapClaimedOutboxRow(value: unknown) {
  const row = readRecord(value);
  const eventType = readLearningEventType(row.event_type);
  return {
    outboxId: readString(row.outbox_id),
    learningEventId: readString(row.learning_event_id),
    statementId: readString(row.statement_id),
    attemptCount: readInteger(row.attempt_count),
    actorId: readString(row.actor_id),
    actorRole: readActorRole(row.actor_role),
    eventType,
    objectId: readString(row.object_id),
    objectName: getLearningEventObjectName(eventType),
    courseExternalId: readString(row.course_external_id),
    ...(readString(row.class_external_id)
      ? { classExternalId: readString(row.class_external_id) }
      : {}),
    ...(readString(row.lesson_key) ? { lessonKey: readString(row.lesson_key) } : {}),
    context: readRecord(row.context),
    occurredAt: readIsoTimestamp(row.occurred_at),
  };
}

function readLearningEventType(value: unknown): LearningRecordEventType {
  const eventType = readString(value);
  if (!Object.hasOwn(learningEventCatalog, eventType)) {
    throw new LearningLoopStoreError(500, "outbox-event-type-invalid");
  }
  return eventType as LearningRecordEventType;
}

function readActorRole(value: unknown): "student" | "teacher" | "admin" {
  if (value === "student" || value === "teacher" || value === "admin") return value;
  throw new LearningLoopStoreError(500, "outbox-actor-role-invalid");
}

function getLearningEventObjectName(eventType: LearningRecordEventType) {
  if (eventType === "formative-check.attempted") return "Formative checkpoint attempt";
  if (eventType.startsWith("submission.")) return "Structured learning submission";
  if (eventType === "feedback.released") return "Teacher feedback";
  if (eventType === "lesson.viewed") return "Published lesson";
  if (eventType === "course.viewed" || eventType === "course.completed") return "Course";
  return "UAIS learning activity";
}

function readIsoTimestamp(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const text = readString(value);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    throw new LearningLoopStoreError(500, "outbox-timestamp-invalid");
  }
  return new Date(timestamp).toISOString();
}

async function requireUserId(input: {
  sql: LearningLoopSql;
  account: string;
  role: "teacher" | "student";
}) {
  const rows =
    input.role === "teacher"
      ? await input.sql`
          SELECT id FROM uais_users
          WHERE account = ${input.account} AND role = 'teacher' AND status = 'active'
          LIMIT 2
        `
      : await input.sql`
          SELECT id FROM uais_users
          WHERE account = ${input.account} AND role = 'student' AND status = 'active'
          LIMIT 2
        `;
  if (rows.length !== 1) {
    throw new LearningLoopStoreError(409, "account-projection-required", {
      role: input.role,
      valueRedacted: true,
    });
  }
  return readRequiredId(rows, "account-projection-required");
}

async function readIdempotentReceipt(input: {
  sql: LearningLoopSql;
  actorAccount: string;
  key: string;
  scope: string;
  requestHash: string;
}) {
  requireIdempotencyKey(input.key);
  await input.sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.key}, 0))`;
  const rows = await input.sql`
    SELECT u.account AS actor_account, ir.scope, ir.request_hash, ir.response_receipt
    FROM uais_idempotency_records ir
    JOIN uais_users u ON u.id = ir.actor_user_id
    WHERE ir.idempotency_key = ${input.key}
    FOR UPDATE OF ir
  `;
  const row = firstRow(rows);
  if (!row) return undefined;
  if (
    readString(row.actor_account) !== input.actorAccount ||
    readString(row.scope) !== input.scope
  ) {
    throw new LearningLoopStoreError(409, "idempotency-key-scope-conflict");
  }
  if (readString(row.request_hash) !== input.requestHash) {
    throw new LearningLoopStoreError(409, "idempotency-key-payload-mismatch");
  }
  return parsePersistedReceipt(readRecord(row.response_receipt));
}

function parsePersistedReceipt(
  value: Record<string, unknown>,
): LearningLoopPersistedReceipt {
  const receipt = value as Partial<LearningLoopPersistedReceipt>;
  if (
    receipt.status !== "persisted" ||
    typeof receipt.resourceId !== "string" ||
    typeof receipt.state !== "string" ||
    typeof receipt.revision !== "number" ||
    typeof receipt.traceId !== "string" ||
    typeof receipt.persistedAt !== "string"
  ) {
    throw new LearningLoopStoreError(500, "idempotency-receipt-invalid");
  }
  return receipt as LearningLoopPersistedReceipt;
}

function createAiFeedbackRequestHash(input: {
  teacherAccount: string;
  submissionId: string;
  expectedSubmissionVersionId: string;
  expectedFeedbackRevision: number;
}) {
  return hashJson({
    action: "generate-ai-feedback-draft",
    teacherAccount: input.teacherAccount,
    submissionId: input.submissionId,
    expectedSubmissionVersionId: input.expectedSubmissionVersionId,
    expectedFeedbackRevision: input.expectedFeedbackRevision,
  });
}

async function writeIdempotentReceipt(input: {
  sql: LearningLoopSql;
  actorUserId: string;
  key: string;
  scope: string;
  requestHash: string;
  receipt: LearningLoopPersistedReceipt;
  persistedAt: string;
}) {
  await input.sql`
    INSERT INTO uais_idempotency_records (
      idempotency_key, actor_user_id, scope, request_hash,
      resource_id, response_receipt, created_at
    )
    VALUES (
      ${input.key}, ${input.actorUserId}, ${input.scope}, ${input.requestHash},
      ${input.receipt.resourceId}, ${JSON.stringify(input.receipt)}::text::jsonb,
      ${input.persistedAt}
    )
  `;
}

async function writeAudit(input: {
  sql: LearningLoopSql;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  traceId: string;
  metadata: Record<string, unknown>;
  persistedAt: string;
}) {
  await input.sql`
    INSERT INTO uais_audit_log (
      actor_id, action, target_type, target_id, trace_id, metadata, created_at
    )
    VALUES (
      ${input.actorId}, ${input.action}, ${input.targetType}, ${input.targetId},
      ${input.traceId}, ${JSON.stringify(input.metadata)}::text::jsonb, ${input.persistedAt}
    )
  `;
}

function staleDraftError(latestRevision: number, latestContent: string) {
  return new LearningLoopStoreError(409, "stale-draft-revision", {
    latestRevision,
    latestContent,
    recoveryAction: "reload-and-merge",
  });
}

function requireReceipt(receipt: LearningLoopPersistedReceipt | undefined) {
  if (!receipt) {
    throw new LearningLoopStoreError(500, "transaction-receipt-missing");
  }
  return receipt;
}

function readRequiredId(rows: unknown[], reasonCode: string) {
  const id = readString(firstRow(rows)?.id);
  if (!id) {
    throw new LearningLoopStoreError(409, reasonCode);
  }
  return id;
}

function readCount(rows: unknown[]) {
  return readInteger(firstRow(rows)?.count);
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

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : 0;
}

function hashJson(value: unknown) {
  return hashText(JSON.stringify(value));
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requireIdempotencyKey(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new LearningLoopStoreError(400, "idempotency-key-invalid");
  }
}

export type { LearningActivityDraft };
