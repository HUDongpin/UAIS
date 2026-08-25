import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import {
  authorizeTeachingCourseCapability,
  type TeachingCourseCapabilityDecision,
  type TeachingCourseCapabilityPrincipal,
} from "@/lib/server/teaching-course-collaborator-access";
import {
  TeachingCourseCollaboratorValidationError,
  createTeachingCourseCollaboratorAlreadyActiveReceipt,
  createTeachingCourseCollaboratorPersistedReceipt,
  getTeachingCourseCollaboratorGrantStatus,
  isTeachingCourseCollaboratorPublicId,
  isTeachingCourseCollaboratorRequestId,
  isTeachingCourseCollaboratorUuid,
  normalizeTeachingCourseCollaboratorExpiryTimestamp,
  normalizeTeachingCourseCollaboratorGrantPolicy,
  normalizeTeachingCourseCollaboratorPersistedReceipt,
  normalizeTeachingCourseCollaboratorRoleAndScopes,
  type TeachingCourseCollaboratorGrant,
  type TeachingCourseCollaboratorPersistedReceipt,
  type TeachingCourseCollaboratorReceipt,
  type TeachingCourseCollaboratorRole,
  type TeachingCourseDelegatableCapability,
} from "@/lib/server/teaching-course-collaborator-types";

type TeachingCourseCollaboratorRootSql = {
  begin: (run: (sql: TransactionSql) => Promise<void>) => Promise<void>;
  end: (options?: { timeout?: number }) => Promise<void> | void;
};

export type TeachingCourseCollaboratorPostgresClientFactory = (input: {
  env: Record<string, string | undefined>;
  max?: number;
}) => {
  pooled?: boolean;
  sql: TeachingCourseCollaboratorRootSql;
};

export class TeachingCourseCollaboratorStoreError extends Error {
  readonly status: number;
  readonly reasonCode: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    reasonCode: string,
    details?: Record<string, unknown>,
  ) {
    super(reasonCode);
    this.name = "TeachingCourseCollaboratorStoreError";
    this.status = status;
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

type StoreOptions = {
  env: Record<string, string | undefined>;
  createDatabase?: TeachingCourseCollaboratorPostgresClientFactory;
  now?: () => Date;
};

type GrantInput = {
  actorAccount: string;
  courseId: string;
  recipientEmail: string;
  role: unknown;
  scopes: unknown;
  expiresAt?: unknown;
  idempotencyKey: string;
  traceId: string;
};

type OwnerContext = {
  userId: string;
  account: string;
};

type RecipientContext = {
  userId: string;
  account: string;
  role: "student" | "teacher" | "admin";
  status: "active" | "disabled" | "invited";
  identifierId: string;
};

type PersistedTeachingCourseCollaboratorGrant =
  TeachingCourseCollaboratorGrant & {
    recipientIdentifierId?: string;
  };

type IdempotencyReplayBinding =
  | {
      kind: "grant";
      courseId: string;
      recipientUserId: string;
      role: TeachingCourseCollaboratorRole;
      scopes: TeachingCourseDelegatableCapability[];
      expiresAt?: string;
    }
  | {
      kind: "revoke";
      courseId: string;
      grantId: string;
    };

const grantIdempotencyScope = "teaching-course-collaborator-grant";
const revokeIdempotencyScope = "teaching-course-collaborator-revoke";
const safeAccountPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const registeredEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createTeachingCourseCollaboratorPostgresStore(
  options: StoreOptions,
) {
  if (!options.createDatabase) {
    const readiness = getUaisCoreDatabaseReadiness(options.env);
    if (readiness.status !== "ready") {
      throw new TeachingCourseCollaboratorStoreError(
        503,
        "core-database-required",
        {
          target: readiness.target,
          status: readiness.status,
          valueRedacted: true,
        },
      );
    }
  }
  const createDatabase: TeachingCourseCollaboratorPostgresClientFactory =
    options.createDatabase ?? getUaisCoreDatabasePool;
  const readNow = options.now ?? (() => new Date());

  return {
    async grant(input: GrantInput): Promise<TeachingCourseCollaboratorReceipt> {
      const actorAccount = requireAccount(input.actorAccount);
      const courseId = requirePublicId(input.courseId, "course-id-invalid");
      const registeredEmail = normalizeRegisteredEmail(input.recipientEmail);
      const idempotencyKey = requireRequestId(
        input.idempotencyKey,
        "idempotency-key-invalid",
      );
      const traceId = requireRequestId(input.traceId, "trace-id-invalid");
      const normalizedRequest = normalizeGrantRequest({
        role: input.role,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
      });
      const client = createDatabase({ env: options.env, max: 1 });
      let receipt: TeachingCourseCollaboratorReceipt | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const owner = await requireCourseOwner({
            sql,
            actorAccount,
            courseId,
            lock: "update",
          });
          // This is the only statement that receives the submitted address. It
          // resolves the address to stable identifiers, after owner authority
          // has already been established, and the address is never reused.
          const recipient = await resolveRegisteredRecipient({
            sql,
            registeredEmail,
          });
          const requestHash = hashJson({
            action: "grant-course-collaborator",
            actorUserId: owner.userId,
            courseId,
            recipientUserId: recipient.userId,
            recipientIdentifierId: recipient.identifierId,
            role: normalizedRequest.role,
            scopes: normalizedRequest.scopes,
            expiresAt: normalizedRequest.expiresAt ?? null,
          });
          await lockGrantMutation({
            sql,
            idempotencyKey,
            courseId,
            recipientUserId: recipient.userId,
          });
          const replay = await readIdempotentReceipt({
            sql,
            actorUserId: owner.userId,
            key: idempotencyKey,
            scope: grantIdempotencyScope,
            requestHash,
            binding: {
              kind: "grant",
              courseId,
              recipientUserId: recipient.userId,
              role: normalizedRequest.role,
              scopes: normalizedRequest.scopes,
              expiresAt: normalizedRequest.expiresAt,
            },
          });
          if (replay) {
            receipt = replay;
            return;
          }
          assertEligibleRecipient({ owner, recipient });
          const mutationNow = readNow();
          const persistedAt = mutationNow.toISOString();
          const policy = normalizePolicy({
            role: normalizedRequest.role,
            scopes: normalizedRequest.scopes,
            grantedAt: persistedAt,
            expiresAt: normalizedRequest.expiresAt,
          });

          const existingRows = await sql`
            SELECT
              id,
              course_id,
              recipient_user_id,
              recipient_identifier_id,
              granted_by_user_id,
              role,
              scopes,
              revision,
              granted_at,
              expires_at,
              revoked_at,
              revoked_by_user_id
            FROM uais_course_collaborator_grants
            WHERE course_id = ${courseId}
              AND recipient_user_id = ${recipient.userId}
            FOR UPDATE
          `;
          if (existingRows.length > 1) {
            throw new TeachingCourseCollaboratorStoreError(
              500,
              "canonical-grant-uniqueness-violated",
            );
          }
          const existing = existingRows[0]
            ? readGrantRow(existingRows[0], mutationNow)
            : undefined;
          if (existing?.status === "active") {
            if (
              !isSameActiveGrantRequest({
                existing,
                recipientIdentifierId: recipient.identifierId,
                grantedByUserId: owner.userId,
                role: policy.role,
                scopes: policy.scopes,
                expiresAt: policy.expiresAt,
              })
            ) {
              throw new TeachingCourseCollaboratorStoreError(
                409,
                "active-grant-change-requires-revoke",
              );
            }
            receipt = createTeachingCourseCollaboratorAlreadyActiveReceipt({
              grant: toSafeGrant(existing),
              traceId,
              persistedAt,
            });
            await writeIdempotentReceipt({
              sql,
              actorUserId: owner.userId,
              key: idempotencyKey,
              scope: grantIdempotencyScope,
              requestHash,
              receipt,
              persistedAt,
            });
            return;
          }

          const storedScopes = sql.array(policy.scopes, 25);
          const rows = await sql`
            INSERT INTO uais_course_collaborator_grants (
              course_id,
              recipient_user_id,
              recipient_identifier_id,
              granted_by_user_id,
              role,
              scopes,
              revision,
              granted_at,
              expires_at,
              revoked_at,
              revoked_by_user_id,
              created_at,
              updated_at
            )
            VALUES (
              ${courseId},
              ${recipient.userId},
              ${recipient.identifierId},
              ${owner.userId},
              ${policy.role},
              ${storedScopes}::text[],
              1,
              ${policy.grantedAt},
              ${policy.expiresAt ?? null},
              NULL,
              NULL,
              ${persistedAt},
              ${persistedAt}
            )
            ON CONFLICT (course_id, recipient_user_id)
            DO UPDATE SET
              recipient_identifier_id = EXCLUDED.recipient_identifier_id,
              granted_by_user_id = EXCLUDED.granted_by_user_id,
              role = EXCLUDED.role,
              scopes = EXCLUDED.scopes,
              revision = uais_course_collaborator_grants.revision + 1,
              granted_at = EXCLUDED.granted_at,
              expires_at = EXCLUDED.expires_at,
              revoked_at = NULL,
              revoked_by_user_id = NULL,
              updated_at = EXCLUDED.updated_at
            WHERE uais_course_collaborator_grants.revoked_at IS NOT NULL
              OR (
                uais_course_collaborator_grants.expires_at IS NOT NULL
                AND uais_course_collaborator_grants.expires_at <= EXCLUDED.granted_at
              )
            RETURNING
              id,
              course_id,
              recipient_user_id,
              recipient_identifier_id,
              granted_by_user_id,
              role,
              scopes,
              revision,
              granted_at,
              expires_at,
              revoked_at,
              revoked_by_user_id
          `;
          const grant = readRequiredGrant(rows, mutationNow);
          assertGrantWriteMatches({
            grant,
            courseId,
            recipientUserId: recipient.userId,
            recipientIdentifierId: recipient.identifierId,
            grantedByUserId: owner.userId,
          });
          receipt = createTeachingCourseCollaboratorPersistedReceipt({
            grant: toSafeGrant(grant),
            event: "grant-issued",
            traceId,
            persistedAt,
          });
          await writeAudit({
            sql,
            actorUserId: owner.userId,
            receipt,
            persistedAt,
          });
          await writeOutbox({
            sql,
            grant,
            event: "grant-issued",
            persistedAt,
          });
          await writeIdempotentReceipt({
            sql,
            actorUserId: owner.userId,
            key: idempotencyKey,
            scope: grantIdempotencyScope,
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

    async read(input: {
      actorAccount: string;
      courseId: string;
      recipientUserId: string;
    }): Promise<TeachingCourseCollaboratorGrant | undefined> {
      const actorAccount = requireAccount(input.actorAccount);
      const courseId = requirePublicId(input.courseId, "course-id-invalid");
      const recipientUserId = requireUuid(
        input.recipientUserId,
        "recipient-user-id-invalid",
        400,
      );
      const client = createDatabase({ env: options.env, max: 1 });
      let grant: TeachingCourseCollaboratorGrant | undefined;
      try {
        await client.sql.begin(async (sql) => {
          await requireCourseOwner({
            sql,
            actorAccount,
            courseId,
            lock: "share",
          });
          const rows = await sql`
            SELECT
              id,
              course_id,
              recipient_user_id,
              recipient_identifier_id,
              granted_by_user_id,
              role,
              scopes,
              revision,
              granted_at,
              expires_at,
              revoked_at,
              revoked_by_user_id
            FROM uais_course_collaborator_grants
            WHERE course_id = ${courseId}
              AND recipient_user_id = ${recipientUserId}
            LIMIT 2
          `;
          if (rows.length > 1) {
            throw new TeachingCourseCollaboratorStoreError(
              500,
              "canonical-grant-uniqueness-violated",
            );
          }
          grant = rows.length === 1
            ? toSafeGrant(readRequiredGrant(rows, readNow()))
            : undefined;
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return grant;
    },

    async list(input: {
      actorAccount: string;
      courseId: string;
    }): Promise<TeachingCourseCollaboratorGrant[]> {
      const actorAccount = requireAccount(input.actorAccount);
      const courseId = requirePublicId(input.courseId, "course-id-invalid");
      const client = createDatabase({ env: options.env, max: 1 });
      let grants: TeachingCourseCollaboratorGrant[] = [];
      try {
        await client.sql.begin(async (sql) => {
          await requireCourseOwner({
            sql,
            actorAccount,
            courseId,
            lock: "share",
          });
          const rows = await sql`
            SELECT
              id,
              course_id,
              recipient_user_id,
              recipient_identifier_id,
              granted_by_user_id,
              role,
              scopes,
              revision,
              granted_at,
              expires_at,
              revoked_at,
              revoked_by_user_id
            FROM uais_course_collaborator_grants
            WHERE course_id = ${courseId}
            ORDER BY recipient_user_id, id
          `;
          grants = rows.map((row) => toSafeGrant(readGrantRow(row, readNow())));
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
      return grants;
    },

    async revoke(input: {
      actorAccount: string;
      courseId: string;
      grantId: string;
      idempotencyKey: string;
      traceId: string;
    }): Promise<TeachingCourseCollaboratorPersistedReceipt> {
      const actorAccount = requireAccount(input.actorAccount);
      const courseId = requirePublicId(input.courseId, "course-id-invalid");
      const grantId = requireUuid(input.grantId, "grant-id-invalid", 400);
      const idempotencyKey = requireRequestId(
        input.idempotencyKey,
        "idempotency-key-invalid",
      );
      const traceId = requireRequestId(input.traceId, "trace-id-invalid");
      const client = createDatabase({ env: options.env, max: 1 });
      let receipt: TeachingCourseCollaboratorPersistedReceipt | undefined;
      try {
        await client.sql.begin(async (sql) => {
          const owner = await requireCourseOwner({
            sql,
            actorAccount,
            courseId,
            lock: "update",
          });
          const requestHash = hashJson({
            action: "revoke-course-collaborator",
            actorUserId: owner.userId,
            courseId,
            grantId,
          });
          await lockIdempotencyKey(sql, idempotencyKey);
          const replay = await readIdempotentReceipt({
            sql,
            actorUserId: owner.userId,
            key: idempotencyKey,
            scope: revokeIdempotencyScope,
            requestHash,
            binding: {
              kind: "revoke",
              courseId,
              grantId,
            },
          });
          if (replay) {
            if (replay.status !== "persisted") throwInvalidIdempotencyReceipt();
            receipt = replay;
            return;
          }
          const existingRows = await sql`
            SELECT
              id,
              course_id,
              recipient_user_id,
              recipient_identifier_id,
              granted_by_user_id,
              role,
              scopes,
              revision,
              granted_at,
              expires_at,
              revoked_at,
              revoked_by_user_id
            FROM uais_course_collaborator_grants
            WHERE id = ${grantId}
              AND course_id = ${courseId}
            FOR UPDATE
          `;
          if (existingRows.length !== 1) {
            throw new TeachingCourseCollaboratorStoreError(
              404,
              "collaborator-grant-not-found",
            );
          }
          const mutationNow = readNow();
          const persistedAt = mutationNow.toISOString();
          const existing = readRequiredGrant(existingRows, mutationNow);
          if (existing.revokedAt) {
            throw new TeachingCourseCollaboratorStoreError(
              409,
              "grant-already-revoked",
            );
          }
          const updatedRows = await sql`
            UPDATE uais_course_collaborator_grants
            SET
              revoked_at = ${persistedAt},
              revoked_by_user_id = ${owner.userId},
              revision = revision + 1,
              updated_at = ${persistedAt}
            WHERE id = ${grantId}
              AND course_id = ${courseId}
              AND revoked_at IS NULL
            RETURNING
              id,
              course_id,
              recipient_user_id,
              recipient_identifier_id,
              granted_by_user_id,
              role,
              scopes,
              revision,
              granted_at,
              expires_at,
              revoked_at,
              revoked_by_user_id
          `;
          if (updatedRows.length !== 1) {
            throw new TeachingCourseCollaboratorStoreError(
              409,
              "grant-already-revoked",
            );
          }
          const grant = readRequiredGrant(updatedRows, mutationNow);
          receipt = createTeachingCourseCollaboratorPersistedReceipt({
            grant: toSafeGrant(grant),
            event: "grant-revoked",
            traceId,
            persistedAt,
          });
          await writeAudit({
            sql,
            actorUserId: owner.userId,
            receipt,
            persistedAt,
          });
          await writeOutbox({
            sql,
            grant,
            event: "grant-revoked",
            persistedAt,
          });
          await writeIdempotentReceipt({
            sql,
            actorUserId: owner.userId,
            key: idempotencyKey,
            scope: revokeIdempotencyScope,
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

    async readCapability(input: {
      principalAccount: string;
      courseId: string;
      capability: unknown;
    }): Promise<TeachingCourseCapabilityDecision> {
      const principalAccount = requireAccount(input.principalAccount);
      const courseId = requirePublicId(input.courseId, "course-id-invalid");
      const client = createDatabase({ env: options.env, max: 1 });
      try {
        let rows: readonly unknown[] = [];
        await client.sql.begin(async (sql) => {
          rows = await sql`
            WITH requested_principal AS (
              SELECT principal.id, principal.account, principal.role, principal.status
              FROM uais_users principal
              WHERE principal.account = ${principalAccount}
            )
            SELECT
              principal.id AS principal_user_id,
              principal.account AS principal_account,
              principal.role AS principal_role,
              principal.status AS principal_status,
              owner.id AS owner_user_id,
              grant.id,
              grant.course_id,
              grant.recipient_user_id,
              grant.recipient_identifier_id,
              grant.granted_by_user_id,
              grant.role,
              grant.scopes,
              grant.revision,
              grant.granted_at,
              grant.expires_at,
              grant.revoked_at,
              grant.revoked_by_user_id
            FROM requested_principal principal
            LEFT JOIN uais_teaching_course_management_snapshots snapshot
              ON snapshot.snapshot_key = ${courseId}
            LEFT JOIN LATERAL jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(snapshot.database->'courses') = 'array'
                  THEN snapshot.database->'courses'
                ELSE '[]'::jsonb
              END
            ) AS course(record)
              ON course.record->>'courseId' = ${courseId}
            LEFT JOIN uais_users owner
              ON owner.account = course.record->>'ownerTeacherId'
              AND owner.role = 'teacher'
              AND owner.status = 'active'
            LEFT JOIN uais_course_collaborator_grants grant
              ON grant.course_id = snapshot.snapshot_key
              AND grant.recipient_user_id = principal.id
            LIMIT 2
          `;
        });
        if (rows.length !== 1) {
          return authorizeTeachingCourseCapability({
            principal: undefined,
            course: { courseId, ownerUserId: "" },
            capability: input.capability,
            now: readNow(),
          });
        }
        const row = readRecord(rows[0], "capability-readback-invalid");
        const principal = readCapabilityPrincipal(row);
        const ownerUserId = readOptionalUuid(row.owner_user_id) ?? "";
        const grant = readOptionalUuid(row.id)
          ? toSafeGrant(readGrantRow(row, readNow()))
          : undefined;
        return authorizeTeachingCourseCapability({
          principal,
          course: { courseId, ownerUserId },
          capability: input.capability,
          grant,
          now: readNow(),
        });
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },
  };
}

async function requireCourseOwner(input: {
  sql: TransactionSql;
  actorAccount: string;
  courseId: string;
  lock: "update" | "share";
}): Promise<OwnerContext> {
  const rows =
    input.lock === "update"
      ? await input.sql`
          SELECT
            owner.id AS owner_user_id,
            owner.account AS owner_account
          FROM uais_teaching_course_management_snapshots snapshot
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(snapshot.database->'courses') = 'array'
                THEN snapshot.database->'courses'
              ELSE '[]'::jsonb
            END
          ) AS course(record)
          JOIN uais_users owner
            ON owner.account = course.record->>'ownerTeacherId'
          WHERE snapshot.snapshot_key = ${input.courseId}
            AND course.record->>'courseId' = ${input.courseId}
            AND owner.account = ${input.actorAccount}
            AND owner.role = 'teacher'
            AND owner.status = 'active'
          LIMIT 2
          FOR UPDATE OF snapshot
          FOR SHARE OF owner
        `
      : await input.sql`
          SELECT
            owner.id AS owner_user_id,
            owner.account AS owner_account
          FROM uais_teaching_course_management_snapshots snapshot
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(snapshot.database->'courses') = 'array'
                THEN snapshot.database->'courses'
              ELSE '[]'::jsonb
            END
          ) AS course(record)
          JOIN uais_users owner
            ON owner.account = course.record->>'ownerTeacherId'
          WHERE snapshot.snapshot_key = ${input.courseId}
            AND course.record->>'courseId' = ${input.courseId}
            AND owner.account = ${input.actorAccount}
            AND owner.role = 'teacher'
            AND owner.status = 'active'
          LIMIT 2
          FOR SHARE OF snapshot, owner
        `;
  if (rows.length !== 1) {
    throw new TeachingCourseCollaboratorStoreError(
      403,
      "course-owner-required",
    );
  }
  const row = readRecord(rows[0], "course-owner-readback-invalid");
  return {
    userId: requireUuid(row.owner_user_id, "course-owner-readback-invalid"),
    account: requireAccountValue(row.owner_account, "course-owner-readback-invalid"),
  };
}

async function resolveRegisteredRecipient(input: {
  sql: TransactionSql;
  registeredEmail: string;
}): Promise<RecipientContext> {
  const rows = await input.sql`
    SELECT
      recipient.id AS recipient_user_id,
      recipient.account AS recipient_account,
      recipient.role AS recipient_role,
      recipient.status AS recipient_status,
      i.identifier_id AS recipient_identifier_id
    FROM uais_user_login_identifiers i
    JOIN uais_users recipient ON recipient.id = i.user_id
    WHERE i.identifier = ${input.registeredEmail}
      AND i.identifier_kind = 'email'
    LIMIT 2
    FOR SHARE OF i, recipient
  `;
  if (rows.length === 0) {
    throw new TeachingCourseCollaboratorStoreError(404, "recipient-unknown");
  }
  if (rows.length !== 1) {
    throw new TeachingCourseCollaboratorStoreError(
      409,
      "recipient-identifier-ambiguous",
    );
  }
  const row = readRecord(rows[0], "recipient-readback-invalid");
  const role = readPrincipalRole(row.recipient_role);
  const status = readPrincipalStatus(row.recipient_status);
  if (!role || !status) {
    throw new TeachingCourseCollaboratorStoreError(
      500,
      "recipient-readback-invalid",
    );
  }
  return {
    userId: requireUuid(row.recipient_user_id, "recipient-readback-invalid"),
    account: requireAccountValue(
      row.recipient_account,
      "recipient-readback-invalid",
    ),
    role,
    status,
    identifierId: requireUuid(
      row.recipient_identifier_id,
      "recipient-readback-invalid",
    ),
  };
}

function assertEligibleRecipient(input: {
  owner: OwnerContext;
  recipient: RecipientContext;
}) {
  if (
    input.owner.userId === input.recipient.userId ||
    input.owner.account === input.recipient.account
  ) {
    throw new TeachingCourseCollaboratorStoreError(
      409,
      "recipient-self-denied",
    );
  }
  if (
    input.recipient.role !== "teacher" ||
    input.recipient.status !== "active"
  ) {
    throw new TeachingCourseCollaboratorStoreError(
      409,
      "recipient-active-teacher-required",
    );
  }
}

async function lockIdempotencyKey(
  sql: TransactionSql,
  key: string,
) {
  await sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
  `;
}

async function lockGrantMutation(input: {
  sql: TransactionSql;
  idempotencyKey: string;
  courseId: string;
  recipientUserId: string;
}) {
  // Every writer of the globally keyed idempotency ledger uses this one-bigint
  // namespace. Acquire it first and in its own statement so cross-subsystem
  // reuse deterministically observes the existing scope instead of racing the
  // ledger primary key.
  await lockIdempotencyKey(input.sql, input.idempotencyKey);

  // This separate two-integer namespace serializes distinct keys targeting the
  // same canonical grant, including first-write races where no row exists for
  // SELECT ... FOR UPDATE yet. Neither lock contains the submitted address.
  await input.sql`
    SELECT pg_advisory_xact_lock(
      1430346061,
      hashtext(${`${input.courseId}:${input.recipientUserId}`})
    )
  `;
}

async function readIdempotentReceipt(input: {
  sql: TransactionSql;
  actorUserId: string;
  key: string;
  scope: string;
  requestHash: string;
  binding: IdempotencyReplayBinding;
}) {
  const rows = await input.sql`
    SELECT actor_user_id, scope, request_hash, resource_id, response_receipt
    FROM uais_idempotency_records
    WHERE idempotency_key = ${input.key}
    FOR UPDATE
  `;
  if (rows.length === 0) return undefined;
  if (rows.length !== 1) {
    throw new TeachingCourseCollaboratorStoreError(
      500,
      "idempotency-record-invalid",
    );
  }
  const row = readRecord(rows[0], "idempotency-record-invalid");
  if (
    readString(row.actor_user_id) !== input.actorUserId ||
    readString(row.scope) !== input.scope
  ) {
    throw new TeachingCourseCollaboratorStoreError(
      409,
      "idempotency-key-scope-conflict",
    );
  }
  if (readString(row.request_hash) !== input.requestHash) {
    throw new TeachingCourseCollaboratorStoreError(
      409,
      "idempotency-key-payload-mismatch",
    );
  }
  let receipt: TeachingCourseCollaboratorReceipt;
  try {
    receipt = normalizeTeachingCourseCollaboratorPersistedReceipt(
      row.response_receipt,
    );
  } catch {
    throwInvalidIdempotencyReceipt();
  }
  assertIdempotencyReceiptBinding({
    resourceId: readString(row.resource_id),
    receipt,
    binding: input.binding,
  });
  return receipt;
}

function assertIdempotencyReceiptBinding(input: {
  resourceId: string | undefined;
  receipt: TeachingCourseCollaboratorReceipt;
  binding: IdempotencyReplayBinding;
}) {
  if (!input.resourceId || input.resourceId !== input.receipt.grantId) {
    throwInvalidIdempotencyReceipt();
  }

  if (input.binding.kind === "revoke") {
    if (
      input.receipt.status !== "persisted" ||
      input.receipt.event !== "grant-revoked" ||
      input.receipt.courseId !== input.binding.courseId ||
      input.receipt.grantId !== input.binding.grantId
    ) {
      throwInvalidIdempotencyReceipt();
    }
    return;
  }

  if (
    (input.receipt.status === "persisted" &&
      input.receipt.event !== "grant-issued") ||
    input.receipt.courseId !== input.binding.courseId ||
    input.receipt.recipientUserId !== input.binding.recipientUserId ||
    input.receipt.role !== input.binding.role ||
    !sameStringList(input.receipt.scopes, input.binding.scopes) ||
    (input.receipt.expiresAt ?? null) !==
      (input.binding.expiresAt ?? null)
  ) {
    throwInvalidIdempotencyReceipt();
  }
}

function throwInvalidIdempotencyReceipt(): never {
  throw new TeachingCourseCollaboratorStoreError(
    500,
    "idempotency-receipt-invalid",
  );
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function writeIdempotentReceipt(input: {
  sql: TransactionSql;
  actorUserId: string;
  key: string;
  scope: string;
  requestHash: string;
  receipt: TeachingCourseCollaboratorReceipt;
  persistedAt: string;
}) {
  await input.sql`
    INSERT INTO uais_idempotency_records (
      idempotency_key,
      actor_user_id,
      scope,
      request_hash,
      resource_id,
      response_receipt,
      created_at
    )
    VALUES (
      ${input.key},
      ${input.actorUserId},
      ${input.scope},
      ${input.requestHash},
      ${input.receipt.grantId},
      ${JSON.stringify(input.receipt)}::text::jsonb,
      ${input.persistedAt}
    )
  `;
}

async function writeAudit(input: {
  sql: TransactionSql;
  actorUserId: string;
  receipt: TeachingCourseCollaboratorPersistedReceipt;
  persistedAt: string;
}) {
  const metadata = {
    event: input.receipt.event,
    courseId: input.receipt.courseId,
    recipientUserId: input.receipt.recipientUserId,
    role: input.receipt.role,
    scopes: input.receipt.scopes,
    revision: input.receipt.revision,
    grantStatus: input.receipt.grantStatus,
    ...(input.receipt.expiresAt ? { expiresAt: input.receipt.expiresAt } : {}),
  };
  await input.sql`
    INSERT INTO uais_audit_log (
      actor_id,
      action,
      target_type,
      target_id,
      trace_id,
      metadata,
      created_at
    )
    VALUES (
      ${input.actorUserId},
      ${`course-collaborator-${input.receipt.event}`},
      'course-collaborator-grant',
      ${input.receipt.grantId},
      ${input.receipt.traceId},
      ${JSON.stringify(metadata)}::text::jsonb,
      ${input.persistedAt}
    )
  `;
}

async function writeOutbox(input: {
  sql: TransactionSql;
  grant: PersistedTeachingCourseCollaboratorGrant;
  event: "grant-issued" | "grant-revoked";
  persistedAt: string;
}) {
  await input.sql`
    INSERT INTO uais_course_collaborator_notification_outbox (
      grant_id,
      grant_revision,
      recipient_user_id,
      recipient_identifier_id,
      event_type,
      status,
      attempt_count,
      next_attempt_at,
      created_at,
      updated_at
    )
    VALUES (
      ${input.grant.grantId},
      ${input.grant.revision},
      ${input.grant.recipientUserId},
      ${input.grant.recipientIdentifierId ?? null},
      ${input.event},
      'pending',
      0,
      ${input.persistedAt},
      ${input.persistedAt},
      ${input.persistedAt}
    )
  `;
}

function readRequiredGrant(rows: unknown[], now: Date) {
  if (rows.length !== 1) {
    throw new TeachingCourseCollaboratorStoreError(
      500,
      "grant-write-readback-invalid",
    );
  }
  return readGrantRow(rows[0], now);
}

function readGrantRow(
  value: unknown,
  now: Date,
): PersistedTeachingCourseCollaboratorGrant {
  const row = readRecord(value, "collaborator-grant-readback-invalid");
  const grantedAt = readIsoTimestamp(
    row.granted_at,
    "collaborator-grant-readback-invalid",
  );
  const expiresAt = readOptionalIsoTimestamp(
    row.expires_at,
    "collaborator-grant-readback-invalid",
  );
  const revokedAt = readOptionalIsoTimestamp(
    row.revoked_at,
    "collaborator-grant-readback-invalid",
  );
  const revokedByUserId = readOptionalUuid(row.revoked_by_user_id);
  if (Boolean(revokedAt) !== Boolean(revokedByUserId)) {
    throw new TeachingCourseCollaboratorStoreError(
      500,
      "collaborator-grant-readback-invalid",
    );
  }
  const policy = normalizeStoredPolicy({
    role: row.role,
    scopes: row.scopes,
    grantedAt,
    expiresAt,
  });
  return {
    grantId: requireUuid(row.id, "collaborator-grant-readback-invalid"),
    courseId: requirePublicId(
      row.course_id,
      "collaborator-grant-readback-invalid",
    ),
    recipientUserId: requireUuid(
      row.recipient_user_id,
      "collaborator-grant-readback-invalid",
    ),
    recipientIdentifierId: readNullableUuid(
      row.recipient_identifier_id,
      "collaborator-grant-readback-invalid",
    ),
    grantedByUserId: requireUuid(
      row.granted_by_user_id,
      "collaborator-grant-readback-invalid",
    ),
    role: policy.role,
    scopes: policy.scopes,
    status: getTeachingCourseCollaboratorGrantStatus(
      {
        grantedAt: policy.grantedAt,
        expiresAt: policy.expiresAt,
        revokedAt,
      },
      now,
    ),
    revision: readPositiveInteger(
      row.revision,
      "collaborator-grant-readback-invalid",
    ),
    grantedAt: policy.grantedAt,
    ...(policy.expiresAt ? { expiresAt: policy.expiresAt } : {}),
    ...(revokedAt ? { revokedAt } : {}),
    ...(revokedByUserId ? { revokedByUserId } : {}),
  };
}

function assertGrantWriteMatches(input: {
  grant: PersistedTeachingCourseCollaboratorGrant;
  courseId: string;
  recipientUserId: string;
  recipientIdentifierId: string;
  grantedByUserId: string;
}) {
  if (
    input.grant.courseId !== input.courseId ||
    input.grant.recipientUserId !== input.recipientUserId ||
    input.grant.recipientIdentifierId !== input.recipientIdentifierId ||
    input.grant.grantedByUserId !== input.grantedByUserId ||
    input.grant.status !== "active"
  ) {
    throw new TeachingCourseCollaboratorStoreError(
      500,
      "grant-write-readback-invalid",
    );
  }
}

function isSameActiveGrantRequest(input: {
  existing: PersistedTeachingCourseCollaboratorGrant;
  recipientIdentifierId: string;
  grantedByUserId: string;
  role: TeachingCourseCollaboratorGrant["role"];
  scopes: TeachingCourseCollaboratorGrant["scopes"];
  expiresAt?: string;
}) {
  return (
    input.existing.recipientIdentifierId === input.recipientIdentifierId &&
    input.existing.grantedByUserId === input.grantedByUserId &&
    input.existing.role === input.role &&
    input.existing.scopes.length === input.scopes.length &&
    input.existing.scopes.every((scope, index) => scope === input.scopes[index]) &&
    (input.existing.expiresAt ?? undefined) === input.expiresAt
  );
}

function toSafeGrant(
  grant: PersistedTeachingCourseCollaboratorGrant,
): TeachingCourseCollaboratorGrant {
  return {
    grantId: grant.grantId,
    courseId: grant.courseId,
    recipientUserId: grant.recipientUserId,
    grantedByUserId: grant.grantedByUserId,
    role: grant.role,
    scopes: [...grant.scopes],
    status: grant.status,
    revision: grant.revision,
    grantedAt: grant.grantedAt,
    ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
    ...(grant.revokedAt ? { revokedAt: grant.revokedAt } : {}),
    ...(grant.revokedByUserId
      ? { revokedByUserId: grant.revokedByUserId }
      : {}),
  };
}

function readCapabilityPrincipal(
  row: Record<string, unknown>,
): TeachingCourseCapabilityPrincipal | undefined {
  const userId = readOptionalUuid(row.principal_user_id);
  const account = readString(row.principal_account)?.trim();
  const role = readPrincipalRole(row.principal_role);
  const status = readPrincipalStatus(row.principal_status);
  return userId && account && role && status
    ? { userId, account, role, status }
    : undefined;
}

function readPrincipalRole(value: unknown) {
  return value === "student" || value === "teacher" || value === "admin"
    ? value
    : undefined;
}

function readPrincipalStatus(value: unknown) {
  return value === "active" || value === "disabled" || value === "invited"
    ? value
    : undefined;
}

function normalizeGrantRequest(input: {
  role: unknown;
  scopes: unknown;
  expiresAt?: unknown;
}): Pick<TeachingCourseCollaboratorGrant, "role" | "scopes"> & {
  expiresAt?: string;
} {
  try {
    const assignment = normalizeTeachingCourseCollaboratorRoleAndScopes(input);
    if (input.expiresAt === undefined || input.expiresAt === null) {
      return assignment;
    }
    return {
      ...assignment,
      expiresAt: normalizeTeachingCourseCollaboratorExpiryTimestamp(
        input.expiresAt,
      ),
    };
  } catch (error) {
    if (error instanceof TeachingCourseCollaboratorValidationError) {
      throw new TeachingCourseCollaboratorStoreError(400, error.reasonCode);
    }
    throw error;
  }
}

function normalizePolicy(input: {
  role: unknown;
  scopes: unknown;
  grantedAt: unknown;
  expiresAt?: unknown;
}) {
  try {
    return normalizeTeachingCourseCollaboratorGrantPolicy(input);
  } catch (error) {
    if (error instanceof TeachingCourseCollaboratorValidationError) {
      throw new TeachingCourseCollaboratorStoreError(400, error.reasonCode);
    }
    throw error;
  }
}

function normalizeStoredPolicy(input: {
  role: unknown;
  scopes: unknown;
  grantedAt: unknown;
  expiresAt?: unknown;
}) {
  try {
    return normalizeTeachingCourseCollaboratorGrantPolicy(input);
  } catch {
    throw new TeachingCourseCollaboratorStoreError(
      500,
      "collaborator-grant-readback-invalid",
    );
  }
}

function normalizeRegisteredEmail(value: unknown) {
  if (typeof value !== "string") {
    throw new TeachingCourseCollaboratorStoreError(
      400,
      "recipient-email-invalid",
    );
  }
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 320 ||
    !registeredEmailPattern.test(normalized)
  ) {
    throw new TeachingCourseCollaboratorStoreError(
      400,
      "recipient-email-invalid",
    );
  }
  return normalized;
}

function requireAccount(value: unknown) {
  if (typeof value !== "string" || !safeAccountPattern.test(value.trim())) {
    throw new TeachingCourseCollaboratorStoreError(400, "actor-account-invalid");
  }
  return value.trim();
}

function requireAccountValue(value: unknown, reasonCode: string) {
  if (typeof value !== "string" || !safeAccountPattern.test(value.trim())) {
    throw new TeachingCourseCollaboratorStoreError(500, reasonCode);
  }
  return value.trim();
}

function requirePublicId(value: unknown, reasonCode: string) {
  const normalized = typeof value === "string" ? value.trim() : value;
  if (!isTeachingCourseCollaboratorPublicId(normalized)) {
    throw new TeachingCourseCollaboratorStoreError(400, reasonCode);
  }
  return normalized;
}

function requireRequestId(value: unknown, reasonCode: string) {
  const normalized = typeof value === "string" ? value.trim() : value;
  if (!isTeachingCourseCollaboratorRequestId(normalized)) {
    throw new TeachingCourseCollaboratorStoreError(400, reasonCode);
  }
  return normalized;
}

function requireUuid(value: unknown, reasonCode: string, status = 500) {
  const normalized = typeof value === "string" ? value.trim() : value;
  if (!isTeachingCourseCollaboratorUuid(normalized)) {
    throw new TeachingCourseCollaboratorStoreError(status, reasonCode);
  }
  return normalized.toLowerCase();
}

function readOptionalUuid(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : value;
  return isTeachingCourseCollaboratorUuid(normalized)
    ? normalized.toLowerCase()
    : undefined;
}

function readNullableUuid(value: unknown, reasonCode: string) {
  return value === null || value === undefined
    ? undefined
    : requireUuid(value, reasonCode);
}

function readIsoTimestamp(value: unknown, reasonCode: string) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(readString(value) ?? "");
  if (!Number.isFinite(timestamp)) {
    throw new TeachingCourseCollaboratorStoreError(500, reasonCode);
  }
  return new Date(timestamp).toISOString();
}

function readOptionalIsoTimestamp(value: unknown, reasonCode: string) {
  return value === null || value === undefined
    ? undefined
    : readIsoTimestamp(value, reasonCode);
}

function readPositiveInteger(value: unknown, reasonCode: string) {
  const numberValue =
    typeof value === "bigint" ? Number(value) : Number(readString(value) ?? value);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) {
    throw new TeachingCourseCollaboratorStoreError(500, reasonCode);
  }
  return numberValue;
}

function readRecord(value: unknown, reasonCode: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TeachingCourseCollaboratorStoreError(500, reasonCode);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function requireReceipt<T extends TeachingCourseCollaboratorReceipt>(
  receipt: T | undefined,
): T {
  if (!receipt) {
    throw new TeachingCourseCollaboratorStoreError(
      500,
      "transaction-receipt-missing",
    );
  }
  return receipt;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
