import { randomBytes } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { getUaisCoreDatabasePool } from "@/lib/db/core-database";
import { parseClassroomRosterCsv, type ClassroomRosterRow, type ClassroomInitialCredential } from "@/lib/teaching/classroom-roster";
import { hashUaisAccountPassword, verifyUaisAccountPassword } from "@/lib/server/uais-app-password-hash";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import { isSameTeachingActorId } from "@/lib/server/teaching-actor-id";
import { assertClassroomRecordWriteAllowed } from "./classroom-record-retention-store";

type DatabaseSql = Sql | TransactionSql;
type RosterScope = { actorId: string; courseId: string; classId: string };
type UserRow = { id: string; account: string; role: string; status: string; display_name: string; password_hash: string; department: string | null };
export class ClassroomAccountError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export function createClassroomRosterStore(input: { env: Record<string, string | undefined>; sql?: Sql }) {
  const sql = input.sql ?? getUaisCoreDatabasePool({ env: input.env }).sql;
  return {
    preview: async (scope: RosterScope & { csv: string }) => sql.begin(async tx => {
      await requireClassOwner(tx, scope);
      return classifyRows(tx, parseClassroomRosterCsv(scope.csv));
    }),
    import: async (scope: RosterScope & { csv: string }) => sql.begin(async tx => {
      await assertClassroomRecordWriteAllowed(tx, scope.courseId);
      await requireClassOwner(tx, scope);
      const parsed = parseClassroomRosterCsv(scope.csv);
      if (parsed.some(row => row.status !== "valid")) throw new ClassroomAccountError(400, "roster-invalid-rows");
      // Same global ordering across overlapping imports avoids deadlocks; locking
      // both account and email keeps concurrent teachers from claiming an identity.
      const identifiers = [...new Set(parsed.flatMap(row => [row.account, ...(row.email ? [row.email] : [])]))].sort();
      for (const identifier of identifiers) await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`classroom-roster:${identifier}`}, 0))`;
      const rows = await classifyRows(tx, parsed);
      if (rows.some(row => row.status === "invalid")) throw new ClassroomAccountError(409, "roster-identity-conflict");
      const credentials: ClassroomInitialCredential[] = [];
      for (const row of rows) {
        if (row.status === "existing") continue;
        const initialPassword = randomBytes(18).toString("base64url");
        const passwordHash = await hashUaisAccountPassword(initialPassword);
        const users = await tx<{ id: string }[]>`INSERT INTO uais_users (account, display_name, role, status, password_hash, department) VALUES (${row.account}, ${row.displayName}, 'student', 'active', ${passwordHash}, 'UAIS') RETURNING id`;
        const userId = users[0].id;
        if (row.email) await tx`INSERT INTO uais_user_login_identifiers (identifier, user_id, identifier_kind) VALUES (${row.email}, ${userId}, 'email')`;
        await tx`INSERT INTO uais_classroom_account_onboarding (user_id, provisioned_by, course_key, class_key) VALUES (${userId}, ${scope.actorId.toLowerCase()}, ${scope.courseId}, ${scope.classId})`;
        credentials.push({ account: row.account, displayName: row.displayName, initialPassword });
      }
      // Plaintext is returned to this authenticated request only, never stored.
      return { rows, credentials, createdCount: credentials.length, existingCount: rows.length - credentials.length };
    }),
    list: async (scope: RosterScope) => sql.begin(async tx => {
      await requireClassOwner(tx, scope);
      return tx<{ account: string; displayName: string; activated: boolean }[]>`SELECT u.account, u.display_name AS "displayName", (o.activated_at IS NOT NULL) AS activated FROM uais_classroom_account_onboarding o JOIN uais_users u ON u.id = o.user_id WHERE o.provisioned_by = ${scope.actorId.toLowerCase()} AND o.course_key = ${scope.courseId} AND o.class_key = ${scope.classId} ORDER BY u.account`;
    }),
    reissue: async (scope: RosterScope & { account: string }) => sql.begin(async tx => {
      await assertClassroomRecordWriteAllowed(tx, scope.courseId);
      await requireClassOwner(tx, scope);
      const rows = await tx<UserRow[]>`SELECT u.* FROM uais_classroom_account_onboarding o JOIN uais_users u ON u.id = o.user_id WHERE u.account = ${scope.account} AND o.provisioned_by = ${scope.actorId.toLowerCase()} AND o.course_key = ${scope.courseId} AND o.class_key = ${scope.classId} AND o.activated_at IS NULL AND u.role = 'student' AND u.status = 'active' FOR UPDATE OF o, u`;
      if (!rows.length) throw new ClassroomAccountError(403, "initial-credential-reissue-denied");
      const initialPassword = randomBytes(18).toString("base64url");
      const hash = await hashUaisAccountPassword(initialPassword);
      await tx`UPDATE uais_users SET password_hash = ${hash}, updated_at = now() WHERE id = ${rows[0].id}`;
      await tx`UPDATE uais_classroom_account_onboarding SET credential_version = credential_version + 1, updated_at = now() WHERE user_id = ${rows[0].id}`;
      return { account: rows[0].account, displayName: rows[0].display_name, initialPassword };
    }),
    setFirstPassword: async (setup: { account: string; credentialVersion: number; password: string }): Promise<UaisAppSessionUser> => {
      if (setup.password.length < 12 || setup.password.length > 128) throw new ClassroomAccountError(400, "password-length-12-128");
      return sql.begin(async tx => {
        const rows = await tx<UserRow[]>`SELECT u.* FROM uais_users u JOIN uais_classroom_account_onboarding o ON o.user_id = u.id WHERE u.account = ${setup.account} AND o.credential_version = ${setup.credentialVersion} AND o.activated_at IS NULL AND u.status = 'active' AND u.role = 'student' FOR UPDATE OF o, u`;
        if (!rows.length) throw new ClassroomAccountError(401, "password-setup-expired");
        const user = rows[0];
        if (await verifyUaisAccountPassword({ plaintext: setup.password, encoded: user.password_hash })) throw new ClassroomAccountError(400, "password-must-differ-from-initial");
        const hash = await hashUaisAccountPassword(setup.password);
        await tx`UPDATE uais_users SET password_hash = ${hash}, updated_at = now() WHERE id = ${user.id}`;
        await tx`UPDATE uais_classroom_account_onboarding SET activated_at = now(), credential_version = credential_version + 1, updated_at = now() WHERE user_id = ${user.id}`;
        return { account: user.account, displayName: user.display_name, role: "student", department: user.department ?? "UAIS" };
      });
    },
  };
}

/** Authoritative snapshot, locked against concurrent ownership/class removal. */
async function requireClassOwner(sql: DatabaseSql, scope: RosterScope) {
  const rows = await sql<{ database: { courses?: { courseId: string; ownerTeacherId: string }[]; classes?: { classId: string; courseId: string; ownerTeacherId: string }[] } }[]>`SELECT database FROM uais_teaching_course_management_snapshots WHERE snapshot_key = ${scope.courseId} FOR SHARE`;
  const db = rows[0]?.database;
  const course = db?.courses?.find(course => course.courseId === scope.courseId);
  const classItem = db?.classes?.find(item => item.courseId === scope.courseId && item.classId === scope.classId);
  if (!course || !classItem || !isSameTeachingActorId(course.ownerTeacherId, scope.actorId) || !isSameTeachingActorId(classItem.ownerTeacherId, scope.actorId)) throw new ClassroomAccountError(403, "class-owner-required");
}
async function classifyRows(sql: DatabaseSql, rows: ClassroomRosterRow[]): Promise<ClassroomRosterRow[]> {
  const result: ClassroomRosterRow[] = [];
  for (const row of rows) {
    if (row.status !== "valid") { result.push(row); continue; }
    const users = await sql<UserRow[]>`SELECT DISTINCT u.id, u.account, u.role, u.status, u.display_name FROM uais_users u LEFT JOIN uais_user_login_identifiers i ON i.user_id = u.id WHERE lower(u.account) = ${row.account} OR i.identifier = ${row.account} OR (${row.email ?? null}::text IS NOT NULL AND i.identifier = ${row.email ?? null})`;
    if (!users.length) result.push({ ...row, status: "new" });
    else if (users.length === 1 && users[0].account.toLowerCase() === row.account && users[0].role === "student" && users[0].status === "active") result.push({ ...row, status: "existing", displayName: users[0].display_name });
    else result.push({ ...row, status: "invalid", error: "Identity belongs to another account, is disabled or is not a student." });
  }
  return result;
}
