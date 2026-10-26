import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { assertClassroomRecordWriteAllowed } from "@/lib/server/classroom-record-retention-store";
import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import type { LearningLoopPostgresClientFactory } from "@/lib/learning-loop/postgres-store";
import { decodeDraftMedia } from "@/lib/teaching/unit-draft-media";
import {
  ClassroomLessonError,
  normalizeLessonPackage,
  studentLessonContent,
  activityDraftFromTemplate,
  type ClassroomLessonSummary,
  type ClassroomTeacherLesson,
  type ClassroomStudentLesson,
  type LessonPackageV1,
  type LessonStudentContent,
} from "./domain";

type Sql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  begin: (run: (sql: Sql) => Promise<void>) => Promise<void>;
};
type Owner = { teacherAccount: string; courseId: string };
type Options = {
  env: Record<string, string | undefined>;
  createDatabase?: LearningLoopPostgresClientFactory;
  createId?: () => string;
};
export type LessonPublishReceipt = {
  status: "published";
  lessonKey: string;
  versionId: string;
  version: number;
  activityIds: string[];
};
function row(rows: unknown[]): Record<string, unknown> | undefined {
  return rows[0] as Record<string, unknown> | undefined;
}
function object(value: unknown): Record<string, unknown> {
  return typeof value === "string"
    ? JSON.parse(value)
    : ((value ?? {}) as Record<string, unknown>);
}
function required(value: unknown, code: string) {
  if (typeof value !== "string" || !value)
    throw new ClassroomLessonError(404, code);
  return value;
}
function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ClassroomLessonError(400, "lesson-revision-required");
}
function summary(value: Record<string, unknown>): ClassroomLessonSummary {
  const latestVersion = Number(value.latest_version ?? 0);
  const publishedDraftRevision = Number(value.published_draft_revision ?? 0);
  return {
    lessonKey: String(value.external_key),
    title: String(value.title),
    position: Number(value.position),
    status: value.status as ClassroomLessonSummary["status"],
    draftRevision: Number(value.draft_revision),
    draftTaskCount: Number(value.draft_task_count ?? 0),
    hasUnpublishedDraft:
      latestVersion === 0 ||
      Number(value.draft_revision) > publishedDraftRevision,
    latestVersion,
    latestRelease:
      latestVersion > 0
        ? {
            version: latestVersion,
            draftRevision: publishedDraftRevision,
            targetClassIds: Array.isArray(value.published_target_class_ids)
              ? value.published_target_class_ids.filter(
                  (id): id is string => typeof id === "string",
                )
              : [],
            publishedTaskCount: Number(value.published_task_count ?? 0),
          }
        : null,
    updatedAt: new Date(String(value.updated_at)).toISOString(),
  };
}

export function createClassroomLessonStore(options: Options) {
  if (getUaisCoreDatabaseReadiness(options.env).status !== "ready")
    throw new ClassroomLessonError(503, "core-database-required");
  const factory =
    options.createDatabase ??
    (getUaisCoreDatabasePool as unknown as LearningLoopPostgresClientFactory);
  const createId = options.createId ?? randomUUID;
  async function withDatabase<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
    const client = factory({ env: options.env });
    try {
      return await run(client.sql as Sql);
    } finally {
      await closeUaisCoreDatabaseClient(client);
    }
  }
  async function owned(
    sql: Sql,
    input: Owner & { lessonKey: string },
    lock = false,
  ) {
    const values = lock
      ? await sql`SELECT l.*, c.teacher_id FROM uais_lessons l JOIN uais_courses c ON c.id=l.course_id JOIN uais_users u ON u.id=c.teacher_id WHERE c.slug=${input.courseId} AND u.account=${input.teacherAccount} AND u.role='teacher' AND u.status='active' AND l.external_key=${input.lessonKey} AND l.content_kind='authored' FOR UPDATE OF l`
      : await readTeacherRows(sql, input);
    const value = row(values);
    if (!value) throw new ClassroomLessonError(404, "teacher-lesson-required");
    return value;
  }
  async function readTeacherRows(
    sql: Sql,
    input: Owner & { lessonKey?: string },
  ) {
    return sql`
      SELECT l.*, c.teacher_id,
        COALESCE(jsonb_array_length(l.draft_package->'tasks'),0) AS draft_task_count,
        latest.version_no AS latest_version,
        latest.draft_revision AS published_draft_revision,
        latest.target_class_ids AS published_target_class_ids,
        (SELECT count(*)::integer FROM uais_assessments a
         WHERE a.lesson_version_id=latest.id AND a.status='published') AS published_task_count
      FROM uais_lessons l
      JOIN uais_courses c ON c.id=l.course_id
      JOIN uais_users u ON u.id=c.teacher_id
      LEFT JOIN LATERAL (
        SELECT id,version_no,draft_revision,target_class_ids
        FROM uais_lesson_versions WHERE lesson_id=l.id
        ORDER BY version_no DESC LIMIT 1
      ) latest ON true
      WHERE c.slug=${input.courseId} AND u.account=${input.teacherAccount}
        AND u.role='teacher' AND u.status='active' AND l.content_kind='authored'
        AND (${input.lessonKey ?? null}::text IS NULL OR l.external_key=${input.lessonKey ?? null})
      ORDER BY l.position
    `;
  }
  return {
    async listTeacher(input: Owner): Promise<ClassroomLessonSummary[]> {
      return withDatabase(async (sql) =>
        (await readTeacherRows(sql, input)).map((value) =>
          summary(object(value)),
        ),
      );
    },
    async readTeacher(
      input: Owner & { lessonKey: string },
    ): Promise<ClassroomTeacherLesson> {
      return withDatabase(async (sql) => {
        const value = await owned(sql, input);
        return {
          ...summary(value),
          package: normalizeLessonPackage(object(value.draft_package), {
            allowIncomplete: true,
          }),
        };
      });
    },
    async importPackage(
      input: Owner & {
        courseTitle: string;
        package: unknown;
        idempotencyKey: string;
        allowIncomplete?: boolean;
      },
    ): Promise<{ lessonKey: string }> {
      const lessonPackage = normalizeLessonPackage(input.package, {
        allowIncomplete: input.allowIncomplete,
      });
      await validateImages(lessonPackage);
      return withDatabase(async (sql) => {
        let result: { lessonKey: string } | undefined;
        await sql.begin(async (tx) => {
          await assertClassroomRecordWriteAllowed(tx, input.courseId, {
            allowClosed: true,
          });
          const replay = await replayReceipt(
            tx,
            input,
            "classroom-lesson-import",
          );
          if (replay) {
            result = replay as { lessonKey: string };
            return;
          }
          const user = row(
            await tx`SELECT id FROM uais_users WHERE account=${input.teacherAccount} AND role='teacher' AND status='active'`,
          );
          const teacherId = required(user?.id, "account-projection-required");
          const course = row(
            await tx`INSERT INTO uais_courses(slug,title,teacher_id,status) VALUES(${input.courseId},${input.courseTitle},${teacherId},'published') ON CONFLICT(slug) DO UPDATE SET title=EXCLUDED.title WHERE uais_courses.teacher_id=EXCLUDED.teacher_id RETURNING id`,
          );
          const courseId = required(course?.id, "course-ownership-required");
          // Course lock serializes append positions without locking unrelated courses.
          await tx`SELECT id FROM uais_courses WHERE id=${courseId} FOR UPDATE`;
          const position = Number(
            row(
              await tx`SELECT COALESCE(max(position),0)+1 AS position FROM uais_lessons WHERE course_id=${courseId}`,
            )?.position ?? 1,
          );
          const lessonKey = `lesson-${createId()}`;
          await tx`INSERT INTO uais_lessons(course_id,title,position,external_key,status,content_kind,draft_package,draft_revision) VALUES(${courseId},${lessonPackage.studentContent.title},${position},${lessonKey},'draft','authored',${JSON.stringify(lessonPackage)}::text::jsonb,1)`;
          result = { lessonKey };
          await saveReceipt(
            tx,
            input,
            "classroom-lesson-import",
            teacherId,
            result,
            lessonKey,
          );
        });
        if (!result)
          throw new ClassroomLessonError(500, "lesson-transaction-incomplete");
        return result;
      });
    },
    async saveDraft(
      input: Owner & {
        lessonKey: string;
        package: unknown;
        expectedRevision: number;
      },
    ): Promise<{ lessonKey: string; draftRevision: number }> {
      revision(input.expectedRevision);
      const lessonPackage = normalizeLessonPackage(input.package, {
        allowIncomplete: true,
      });
      await validateImages(lessonPackage);
      return withDatabase(async (sql) => {
        let result: { lessonKey: string; draftRevision: number } | undefined;
        await sql.begin(async (tx) => {
          await assertClassroomRecordWriteAllowed(tx, input.courseId, {
            allowClosed: true,
          });
          const values =
            await tx`UPDATE uais_lessons l SET draft_package=${JSON.stringify(lessonPackage)}::text::jsonb,title=${lessonPackage.studentContent.title},draft_revision=draft_revision+1,updated_at=now() FROM uais_courses c,uais_users u WHERE l.course_id=c.id AND c.teacher_id=u.id AND c.slug=${input.courseId} AND u.account=${input.teacherAccount} AND u.role='teacher' AND u.status='active' AND l.external_key=${input.lessonKey} AND l.content_kind='authored' AND l.draft_revision=${input.expectedRevision} RETURNING l.external_key,l.draft_revision`;
          if (!values.length) {
            await owned(tx, input);
            throw new ClassroomLessonError(
              409,
              "lesson-draft-revision-conflict",
            );
          }
          result = {
            lessonKey: input.lessonKey,
            draftRevision: Number(row(values)?.draft_revision),
          };
        });
        if (!result)
          throw new ClassroomLessonError(500, "lesson-transaction-incomplete");
        return result;
      });
    },
    async publish(
      input: Owner & {
        lessonKey: string;
        expectedRevision: number;
        targetClasses: Array<{ externalId: string; name: string }>;
        taskIds: string[];
        idempotencyKey: string;
      },
    ): Promise<LessonPublishReceipt> {
      revision(input.expectedRevision);
      if (
        !input.targetClasses.length ||
        new Set(input.targetClasses.map((item) => item.externalId)).size !==
          input.targetClasses.length
      )
        throw new ClassroomLessonError(400, "lesson-target-classes-required");
      return withDatabase(async (sql) => {
        let result: LessonPublishReceipt | undefined;
        await sql.begin(async (tx) => {
          await assertClassroomRecordWriteAllowed(tx, input.courseId);
          const replay = await replayReceipt(
            tx,
            input,
            "classroom-lesson-publish",
          );
          if (replay) {
            result = replay as LessonPublishReceipt;
            return;
          }
          const lesson = await owned(tx, input, true);
          if (Number(lesson.draft_revision) !== input.expectedRevision)
            throw new ClassroomLessonError(
              409,
              "lesson-draft-revision-conflict",
            );
          const lessonPackage = normalizeLessonPackage(
            object(lesson.draft_package),
          );
          if (
            new Set(input.taskIds).size !== input.taskIds.length ||
            input.taskIds.some(
              (id) => !lessonPackage.tasks.some((task) => task.id === id),
            )
          )
            throw new ClassroomLessonError(
              400,
              "lesson-task-selection-invalid",
            );
          const version = Number(
            row(
              await tx`SELECT COALESCE(max(version_no),0)+1 AS version FROM uais_lesson_versions WHERE lesson_id=${lesson.id}`,
            )?.version ?? 1,
          );
          const versionId = createId();
          await tx`INSERT INTO uais_lesson_versions(id,lesson_id,version_no,primary_locale,student_content,teacher_guide,target_class_ids,draft_revision,published_by) VALUES(${versionId},${lesson.id},${version},${lessonPackage.primaryLocale},${JSON.stringify(studentLessonContent(lessonPackage))}::text::jsonb,${JSON.stringify(lessonPackage.teacherGuide)}::text::jsonb,${JSON.stringify(input.targetClasses.map((item) => item.externalId))}::text::jsonb,${input.expectedRevision},${lesson.teacher_id})`;
          const activityIds: string[] = [];
          for (const target of [...input.targetClasses].sort((a, b) =>
            a.externalId.localeCompare(b.externalId),
          )) {
            await tx`INSERT INTO uais_classes(course_id,teacher_id,name,external_key,status) VALUES(${lesson.course_id},${lesson.teacher_id},${target.name},${target.externalId},'open') ON CONFLICT(course_id,external_key) WHERE external_key IS NOT NULL DO NOTHING`;
            for (const template of lessonPackage.tasks
              .filter((task) => input.taskIds.includes(task.id))
              .sort((a, b) => a.id.localeCompare(b.id))) {
              const activity = activityDraftFromTemplate(
                template,
                input.lessonKey,
                target.externalId,
              );
              const activityId = createId();
              activityIds.push(activityId);
              // Stable family per lesson/template/class; each publish is a new task version.
              const activityKey = `lesson-task-${createHash("sha256").update(`${input.lessonKey}:${template.id}:${target.externalId}`).digest("hex").slice(0, 32)}`;
              await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"learning-activity-family:" + lesson.id + ":" + activityKey},0))`;
              const activityVersion = Number(
                row(
                  await tx`SELECT COALESCE(max(version),0)+1 AS version FROM uais_assessments WHERE lesson_id=${lesson.id} AND activity_key=${activityKey}`,
                )?.version ?? 1,
              );
              await tx`INSERT INTO uais_assessments(id,lesson_id,lesson_version_id,type,title,activity_key,title_i18n,instructions_i18n,status,version,edit_revision,rubric,formative_check,ai_policy,revision_policy,target_class_external_id,published_at) VALUES(${activityId},${lesson.id},${versionId},'assignment',${activity.title[lessonPackage.primaryLocale]},${activityKey},${JSON.stringify(activity.title)}::text::jsonb,${JSON.stringify(activity.instructions)}::text::jsonb,'published',${activityVersion},1,${JSON.stringify(activity.rubric)}::text::jsonb,${JSON.stringify(activity.checkpoint)}::text::jsonb,${activity.aiPolicy},'teacher-requested',${target.externalId},now())`;
            }
          }
          await tx`UPDATE uais_lessons SET status='published',updated_at=now() WHERE id=${lesson.id}`;
          result = {
            status: "published",
            lessonKey: input.lessonKey,
            versionId,
            version,
            activityIds,
          };
          await saveReceipt(
            tx,
            input,
            "classroom-lesson-publish",
            String(lesson.teacher_id),
            result,
            versionId,
          );
          await tx`INSERT INTO uais_audit_log(actor_id,action,target_type,target_id,metadata) VALUES(${lesson.teacher_id},'classroom-lesson-published','lesson-version',${versionId},${JSON.stringify({ lessonKey: input.lessonKey, version, taskCount: activityIds.length })}::text::jsonb)`;
        });
        if (!result)
          throw new ClassroomLessonError(500, "lesson-transaction-incomplete");
        return result;
      });
    },
    async listStudent(input: { courseId: string; classId: string }) {
      return withDatabase(async (sql) =>
        (
          await sql`SELECT DISTINCT ON(l.id) l.external_key,l.position,v.id AS version_id,v.version_no,v.student_content->>'title' AS title FROM uais_lessons l JOIN uais_courses c ON c.id=l.course_id JOIN uais_lesson_versions v ON v.lesson_id=l.id WHERE c.slug=${input.courseId} AND l.status='published' AND v.target_class_ids ? ${input.classId} ORDER BY l.id,v.version_no DESC`
        )
          .map((entry) => {
            const value = object(entry);
            return {
              lessonKey: String(value.external_key),
              title: String(value.title),
              position: Number(value.position),
              version: Number(value.version_no),
            };
          })
          .sort((a, b) => a.position - b.position),
      );
    },
    async readStudent(input: {
      courseId: string;
      classId: string;
      lessonKey: string;
      studentAccount: string;
      activityId?: string;
    }): Promise<ClassroomStudentLesson | undefined> {
      return withDatabase(async (sql) => {
        const value = row(
          await sql`SELECT v.id,v.version_no,v.student_content,v.primary_locale,l.external_key,l.position FROM uais_lesson_versions v JOIN uais_lessons l ON l.id=v.lesson_id JOIN uais_courses c ON c.id=l.course_id WHERE c.slug=${input.courseId} AND l.external_key=${input.lessonKey} AND v.target_class_ids ? ${input.classId} AND ((${input.activityId ?? null}::uuid IS NULL AND l.status='published') OR EXISTS(SELECT 1 FROM uais_assessments a WHERE a.id=${input.activityId ?? null}::uuid AND a.lesson_id=l.id AND a.lesson_version_id = v.id AND a.target_class_external_id=${input.classId} AND (a.status='published' OR (a.status='archived' AND EXISTS(SELECT 1 FROM uais_submissions s JOIN uais_users u ON u.id=s.user_id WHERE s.assessment_id=a.id AND u.account=${input.studentAccount}))))) ORDER BY v.version_no DESC LIMIT 1`,
        );
        if (!value) return undefined;
        const content = publicContent(object(value.student_content));
        const tasks =
          await sql`SELECT a.id,a.title_i18n,COALESCE(s.state,'not-started') AS state FROM uais_assessments a LEFT JOIN uais_users u ON u.account=${input.studentAccount} LEFT JOIN uais_submissions s ON s.assessment_id=a.id AND s.user_id=u.id WHERE a.lesson_version_id=${value.id} AND a.target_class_external_id=${input.classId} AND (a.status='published' OR (a.status='archived' AND s.id IS NOT NULL)) ORDER BY a.created_at,a.id`;
        return {
          lessonKey: input.lessonKey,
          courseId: input.courseId,
          classId: input.classId,
          title: content.title,
          position: Number(value.position),
          versionId: String(value.id),
          version: Number(value.version_no),
          content,
          tasks: tasks.map((entry) => {
            const task = object(entry);
            return {
              id: String(task.id),
              title: object(task.title_i18n) as {
                "zh-CN": string;
                "en-US": string;
              },
              state: String(task.state),
            };
          }),
        };
      });
    },
    async readPublishedScope(
      input: Owner & { lessonKey: string; targetClassId?: string },
    ) {
      return withDatabase(async (sql) => {
        const value = row(
          await sql`SELECT l.external_key,l.position,v.id,v.primary_locale,v.student_content->>'title' AS title FROM uais_lessons l JOIN uais_courses c ON c.id=l.course_id JOIN uais_users u ON u.id=c.teacher_id JOIN uais_lesson_versions v ON v.lesson_id=l.id WHERE c.slug=${input.courseId} AND u.account=${input.teacherAccount} AND u.role='teacher' AND u.status='active' AND l.external_key=${input.lessonKey} AND l.status='published' AND l.content_kind='authored' AND (${input.targetClassId ?? null}::text IS NULL OR v.target_class_ids ? ${input.targetClassId ?? null}::text) ORDER BY v.version_no DESC LIMIT 1`,
        );
        if (!value) return undefined;
        return {
          key: String(value.external_key),
          position: Number(value.position),
          title: { "zh-CN": String(value.title), "en-US": String(value.title) },
          manifestRef: String(value.id),
          contentKind: "authored" as const,
          versionId: String(value.id),
        };
      });
    },
  };
}

function publicContent(value: Record<string, unknown>): LessonStudentContent {
  // Stored JSON is still treated as untrusted; unrelated/private fields are never serialized.
  return studentLessonContent({
    studentContent: {
      title: String(value.title ?? ""),
      body: String(value.body ?? ""),
      objectives: Array.isArray(value.objectives)
        ? value.objectives.map(String)
        : [],
      questions: Array.isArray(value.questions)
        ? value.questions.map((entry) => {
            const q = object(entry);
            return { id: String(q.id), prompt: String(q.prompt) };
          })
        : [],
      ...(Array.isArray(value.mediaSlides)
        ? { mediaSlides: value.mediaSlides }
        : {}),
    },
  } as LessonPackageV1);
}
async function validateImages(value: LessonPackageV1) {
  for (const slide of value.studentContent.mediaSlides ?? []) {
    if (!slide.image) continue;
    try {
      const image = sharp(decodeDraftMedia(slide.image), {
        failOn: "warning",
        limitInputPixels: 40_000_000,
      });
      await image.stats();
    } catch {
      throw new ClassroomLessonError(400, "lesson-image-invalid");
    }
  }
}
async function replayReceipt(
  sql: Sql,
  input: Owner & { idempotencyKey: string },
  scope: string,
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(input.idempotencyKey))
    throw new ClassroomLessonError(400, "idempotency-key-required");
  // Separate statement: READ COMMITTED takes a fresh snapshot after a competing writer unlocks.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey},0))`;
  const previous = row(
    await sql`SELECT ir.*,u.account AS actor_account FROM uais_idempotency_records ir JOIN uais_users u ON u.id=ir.actor_user_id WHERE ir.idempotency_key=${input.idempotencyKey}`,
  );
  if (!previous) return undefined;
  if (
    previous.actor_account !== input.teacherAccount ||
    previous.scope !== scope
  )
    throw new ClassroomLessonError(409, "idempotency-key-scope-conflict");
  if (previous.request_hash !== hash(input))
    throw new ClassroomLessonError(409, "idempotency-key-payload-mismatch");
  return object(previous.response_receipt);
}
async function saveReceipt(
  sql: Sql,
  input: Owner & { idempotencyKey: string },
  scope: string,
  teacherId: string,
  receipt: unknown,
  resourceId: string,
) {
  await sql`INSERT INTO uais_idempotency_records(idempotency_key,actor_user_id,scope,request_hash,resource_id,response_receipt) VALUES(${input.idempotencyKey},${teacherId},${scope},${hash(input)},${resourceId},${JSON.stringify(receipt)}::text::jsonb)`;
}
function hash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
