import { randomUUID } from "node:crypto";
import { closeUaisCoreDatabaseClient, getUaisCoreDatabasePool, getUaisCoreDatabaseReadiness } from "@/lib/db/core-database";
import { assertClassroomRecordWriteAllowed } from "@/lib/server/classroom-record-retention-store";
import { LearningLoopStoreError, type LearningLoopPostgresClientFactory } from "./postgres-store";
import { submissionImageCountLimit, submissionImageUrl, type SubmissionImage } from "./submission-image-policy";
import { validateSubmissionImage } from "./submission-image-validation";

type ImageSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  begin: (run: (sql: ImageSql) => Promise<void>) => Promise<void>;
  end: (options?: { timeout?: number }) => Promise<void> | void;
};
type MutationScope = {
  studentAccount: string; activityId: string; classExternalId: string;
  submissionVersionId: string; expectedDraftRevision: number;
};
type Row = Record<string, unknown>;

export function createSubmissionImageStore(options: {
  env: Record<string, string | undefined>;
  createDatabase?: LearningLoopPostgresClientFactory;
}) {
  if (getUaisCoreDatabaseReadiness(options.env).status !== "ready") {
    throw new LearningLoopStoreError(503, "core-database-required");
  }
  const createDatabase = options.createDatabase ?? getUaisCoreDatabasePool;
  return {
    async upload(input: MutationScope & { clientAttachmentId: string; bytes: Uint8Array; mime: string }) {
      assertUuid(input.submissionVersionId); assertUuid(input.clientAttachmentId);
      const image = await validateSubmissionImage(input.bytes, input.mime);
      const client = createDatabase({ env: options.env, max: 1 });
      let result: { attachment: SubmissionImage; revision: number } | undefined;
      try {
        await (client.sql as ImageSql).begin(async sql => {
          const version = await lockOwnedVersion(sql, input);
          const existing = first(await sql`
            SELECT * FROM uais_submission_attachments
            WHERE submission_version_id=${input.submissionVersionId} AND client_attachment_id=${input.clientAttachmentId}
          `);
          // Replaying a lost upload response must not consume another image slot.
          if (existing) {
            if (existing.sha256 !== image.sha256) throw new LearningLoopStoreError(409, "submission-image-idempotency-conflict");
            result = { attachment: mapSubmissionImage(existing), revision: Number(version.draft_revision) };
            return;
          }
          assertWritableVersion(version, input.expectedDraftRevision);
          const counts = first(await sql`
            SELECT count(*)::integer AS count, COALESCE(max(position),0)::integer AS last_position
            FROM uais_submission_attachments WHERE submission_version_id=${input.submissionVersionId}
          `)!;
          if (Number(counts.count) >= submissionImageCountLimit) throw new LearningLoopStoreError(409, "submission-image-count-limit");
          const created = first(await sql`
            INSERT INTO uais_submission_attachments (
              id,submission_version_id,client_attachment_id,position,mime,byte_length,width,height,sha256,content
            ) VALUES (${randomUUID()},${input.submissionVersionId},${input.clientAttachmentId},
              ${Number(counts.last_position) + 1},${image.mime},${image.bytes.length},${image.width},${image.height},${image.sha256},${image.bytes})
            RETURNING id,submission_version_id,client_attachment_id,position,mime,byte_length,width,height,sha256
          `)!;
          const revision = await advanceRevision(sql, input.submissionVersionId, String(version.submission_id));
          result = { attachment: mapSubmissionImage(created), revision };
        });
      } finally { await closeUaisCoreDatabaseClient(client); }
      if (!result) throw new LearningLoopStoreError(500, "submission-image-write-missing");
      return result;
    },

    async remove(input: MutationScope & { attachmentId: string }) {
      assertUuid(input.submissionVersionId); assertUuid(input.attachmentId);
      const client = createDatabase({ env: options.env, max: 1 });
      let revision = 0;
      try {
        await (client.sql as ImageSql).begin(async sql => {
          const version = await lockOwnedVersion(sql, input);
          assertWritableVersion(version, input.expectedDraftRevision);
          const removed = await sql`
            DELETE FROM uais_submission_attachments
            WHERE id=${input.attachmentId} AND submission_version_id=${input.submissionVersionId} RETURNING id
          `;
          revision = removed.length
            ? await advanceRevision(sql, input.submissionVersionId, String(version.submission_id))
            : Number(version.draft_revision);
        });
      } finally { await closeUaisCoreDatabaseClient(client); }
      return { revision, status: "removed" as const };
    },

    async list(submissionVersionId: string) {
      assertUuid(submissionVersionId);
      const client = createDatabase({ env: options.env, max: 1 });
      try { return await readSubmissionImages(client.sql as ImageSql, submissionVersionId); }
      finally { await closeUaisCoreDatabaseClient(client); }
    },

    async read(input: { attachmentId: string; actorAccount: string; role: "student" | "teacher" }) {
      assertUuid(input.attachmentId);
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        const row = first(await (client.sql as ImageSql)`
          SELECT image.*,s.id AS submission_id,a.id AS activity_id,c.slug AS course_external_id,
            s.class_external_id,l.external_key AS lesson_key
          FROM uais_submission_attachments image
          JOIN uais_submission_versions v ON v.id=image.submission_version_id
          JOIN uais_submissions s ON s.id=v.submission_id
          JOIN uais_assessments a ON a.id=s.assessment_id
          JOIN uais_lessons l ON l.id=a.lesson_id
          JOIN uais_courses c ON c.id=l.course_id
          JOIN uais_users actor ON actor.account=${input.actorAccount} AND actor.role=${input.role} AND actor.status='active'
          WHERE image.id=${input.attachmentId}
            AND ((${input.role}='student' AND s.user_id=actor.id) OR (${input.role}='teacher' AND c.teacher_id=actor.id))
        `);
        if (!row) throw new LearningLoopStoreError(404, "submission-image-not-found");
        return { attachment: mapSubmissionImage(row), bytes: Buffer.from(row.content as Uint8Array),
          submissionId: String(row.submission_id), activityId: String(row.activity_id),
          courseId: String(row.course_external_id), classId: String(row.class_external_id), lessonKey: String(row.lesson_key) };
      } finally { await closeUaisCoreDatabaseClient(client); }
    },
  };
}

async function lockOwnedVersion(sql: ImageSql, input: MutationScope) {
  if (!Number.isSafeInteger(input.expectedDraftRevision) || input.expectedDraftRevision < 1) throw new LearningLoopStoreError(400, "submission-draft-revision-required");
  // Acquire the course lock before version locks, in the same order as retention purge.
  const scope = first(await sql`
    SELECT c.slug FROM uais_submission_versions v
    JOIN uais_submissions s ON s.id=v.submission_id JOIN uais_users u ON u.id=s.user_id
    JOIN uais_assessments a ON a.id=s.assessment_id JOIN uais_lessons l ON l.id=a.lesson_id
    JOIN uais_courses c ON c.id=l.course_id
    WHERE v.id=${input.submissionVersionId} AND a.id=${input.activityId}
      AND u.account=${input.studentAccount} AND u.role='student' AND u.status='active'
      AND s.class_external_id=${input.classExternalId}
  `);
  if (!scope) throw new LearningLoopStoreError(404, "submission-draft-required");
  await assertClassroomRecordWriteAllowed(sql, String(scope.slug));
  const row = first(await sql`
    SELECT v.id,v.status,v.draft_revision,v.version_no,s.id AS submission_id,s.state,s.current_version_no,a.status AS activity_status
    FROM uais_submission_versions v JOIN uais_submissions s ON s.id=v.submission_id
    JOIN uais_assessments a ON a.id=s.assessment_id JOIN uais_users u ON u.id=s.user_id
    WHERE v.id=${input.submissionVersionId} AND a.id=${input.activityId} AND u.account=${input.studentAccount}
      AND s.class_external_id=${input.classExternalId} FOR UPDATE OF s,v
  `);
  if (!row) throw new LearningLoopStoreError(404, "submission-draft-required");
  return row;
}

function assertWritableVersion(row: Row, expectedRevision: number) {
  if (row.status !== "draft" || row.state !== "draft" || row.version_no !== row.current_version_no || row.activity_status !== "published") {
    throw new LearningLoopStoreError(409, "submission-version-sealed");
  }
  if (Number(row.draft_revision) !== expectedRevision) throw new LearningLoopStoreError(409, "stale-draft-revision", { latestRevision: Number(row.draft_revision) });
}

async function advanceRevision(sql: ImageSql, versionId: string, submissionId: string) {
  const row = first(await sql`UPDATE uais_submission_versions SET draft_revision=draft_revision+1,updated_at=now() WHERE id=${versionId} RETURNING draft_revision`)!;
  await sql`UPDATE uais_submissions SET updated_at=now() WHERE id=${submissionId}`;
  return Number(row.draft_revision);
}

export async function readSubmissionImages(sql: Pick<ImageSql, never> & ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>), versionId: string): Promise<SubmissionImage[]> {
  return (await sql`
    SELECT id,submission_version_id,client_attachment_id,position,mime,byte_length,width,height,sha256
    FROM uais_submission_attachments WHERE submission_version_id=${versionId} ORDER BY position,id
  `).map(value => mapSubmissionImage(value as Row));
}

export async function readSubmissionImageVersions(sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>, submissionId: string) {
  const rows = await sql`
    SELECT image.id,image.submission_version_id,image.client_attachment_id,image.position,image.mime,
      image.byte_length,image.width,image.height,image.sha256
    FROM uais_submission_attachments image JOIN uais_submission_versions v ON v.id=image.submission_version_id
    WHERE v.submission_id=${submissionId} ORDER BY v.version_no,image.position,image.id
  `;
  const byVersion = new Map<string, SubmissionImage[]>();
  for (const value of rows) {
    const image = mapSubmissionImage(value as Row);
    byVersion.set(image.submissionVersionId, [...byVersion.get(image.submissionVersionId) ?? [], image]);
  }
  return byVersion;
}

export function mapSubmissionImage(row: Row): SubmissionImage {
  return { id: String(row.id), submissionVersionId: String(row.submission_version_id), clientAttachmentId: String(row.client_attachment_id),
    position: Number(row.position), mime: row.mime as SubmissionImage["mime"], byteLength: Number(row.byte_length),
    width: Number(row.width), height: Number(row.height), sha256: String(row.sha256), url: submissionImageUrl(String(row.id)) };
}
function first(rows: unknown[]) { return rows[0] as Row | undefined; }
function assertUuid(value: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new LearningLoopStoreError(400, "submission-image-id-invalid");
}
