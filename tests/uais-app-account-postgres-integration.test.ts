import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getUaisCoreDatabasePool,
  resetUaisCoreDatabasePoolForTesting,
} from "@/lib/db/core-database";
import {
  createUaisAppAccountAuthenticator,
  normalizeUaisLoginIdentifier,
} from "@/lib/server/uais-app-account-store";
import { createUaisAppLoginFailureGuard } from "@/lib/server/uais-app-login-failure-store";
import { hashUaisAccountPassword } from "@/lib/server/uais-app-password-hash";

// Real-Postgres coverage for the first-party account login path.
//
// tests/uais-app-account-auth.test.ts drives the authenticator with an injected
// client, which proves the statement it issues. What it cannot prove is that the
// statement matches the rows `scripts/seed-uais-accounts.mjs` actually creates:
// the two-way lookup (account OR registered email) crosses a foreign key and a
// primary key that only exist in the schema, and a student who cannot sign in on
// the first day of term is the most expensive failure this deployment has.
//
// The lockout counter is here for the opposite reason: its whole decision -
// restart the window, increment, lock at the threshold - lives inside one UPSERT,
// so a double can only report that the SQL was sent, never that Postgres agreed
// with it.
//
// DB-backed integration test. It SKIPS unless UAIS_CORE_DATABASE_URL points at a
// reachable Postgres, so the normal suite and CI stay DB-free. To run it locally
// against an ephemeral Postgres:
//
//   docker run -d --name uais-local-pg -e POSTGRES_PASSWORD=uais_local_dev \
//     -e POSTGRES_DB=uais_core -p 55432:5432 postgres:16
//   UAIS_CORE_DATABASE_URL="postgresql://postgres:uais_local_dev@127.0.0.1:55432/uais_core" \
//     npm run test:db
const databaseUrl = process.env.UAIS_CORE_DATABASE_URL?.trim();

describe.skipIf(!databaseUrl)("UAIS app accounts on Postgres (integration)", () => {
  const env = { UAIS_CORE_DATABASE_URL: databaseUrl };
  // Unique per run: this database outlives the suite, and an account that
  // collided with a previous run would make the seed a silent no-op.
  const suffix = randomUUID().replace(/-/g, "");
  const activeAccount = `integration.active.${suffix}`;
  const disabledAccount = `integration.disabled.${suffix}`;
  const officialEmail = `${activeAccount}@integration.example.test`;
  const personalEmail = `${activeAccount}.personal@integration.example.test`;
  const password = "IntegrationPassphrase7";

  beforeAll(async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(process.execPath, ["scripts/apply-core-migrations.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, UAIS_CORE_DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv,
    });

    // The shape scripts/seed-uais-accounts.mjs writes: a `uais_users` row with a
    // scrypt hash from the app's own hasher, plus the addresses the student may
    // sign in with in `uais_user_login_identifiers`. Written here with the app's
    // hasher rather than the script's copy, so a drift between the two encodings
    // fails this suite instead of a real student's first login.
    const client = getUaisCoreDatabasePool({ env });
    const passwordHash = await hashUaisAccountPassword(password);
    const rows = await client.sql`
      INSERT INTO uais_users (account, password_hash, role, display_name, department, status)
      VALUES (
        ${activeAccount},
        ${passwordHash},
        'student',
        'Integration Student',
        '学生账号',
        'active'
      )
      ON CONFLICT (account) DO NOTHING
      RETURNING id
    `;
    const userId = (rows[0] as { id?: string } | undefined)?.id;
    expect(userId).toBeTruthy();

    for (const identifier of [officialEmail, personalEmail]) {
      await client.sql`
        INSERT INTO uais_user_login_identifiers (identifier, user_id, identifier_kind)
        VALUES (${identifier}, ${userId}, 'email')
        ON CONFLICT (identifier) DO NOTHING
      `;
    }

    // `status` is the disable switch a withdrawn student keeps their history
    // behind, so it needs a row of its own to be worth asserting.
    await client.sql`
      INSERT INTO uais_users (account, password_hash, role, display_name, department, status)
      VALUES (
        ${disabledAccount},
        ${passwordHash},
        'student',
        'Integration Disabled Student',
        '学生账号',
        'disabled'
      )
      ON CONFLICT (account) DO NOTHING
    `;
  }, 180_000);

  afterAll(async () => {
    const client = getUaisCoreDatabasePool({ env });
    // Identifiers cascade with the user row; the failure counters are keyed by
    // the submitted identifier and have no foreign key, so they go explicitly.
    await client.sql`
      DELETE FROM uais_app_login_failures
      WHERE account_key IN (${activeAccount}, ${officialEmail}, ${personalEmail})
    `;
    await client.sql`
      DELETE FROM uais_users WHERE account IN (${activeAccount}, ${disabledAccount})
    `;
    await resetUaisCoreDatabasePoolForTesting();
  }, 60_000);

  describe("account lookup", () => {
    it("signs a seeded student in by account and by either registered address", async () => {
      const authenticate = createUaisAppAccountAuthenticator({ env });
      expect(authenticate).toBeDefined();

      const byAccount = await authenticate?.({ account: activeAccount, password });
      expect(byAccount).toEqual({
        account: activeAccount,
        role: "student",
        displayName: "Integration Student",
        department: "学生账号",
      });

      // Both addresses resolve to the SAME account, which is the invariant
      // uais_user_login_identifiers exists for: one student, one actor id, one
      // chatroom room, whichever address they typed.
      for (const identifier of [officialEmail, personalEmail, officialEmail.toUpperCase()]) {
        const byEmail = await authenticate?.({ account: identifier, password });
        expect(byEmail?.account, identifier).toBe(activeAccount);
      }
    });

    it("refuses a wrong password, an unknown identifier, and a disabled account", async () => {
      const authenticate = createUaisAppAccountAuthenticator({ env });

      expect(await authenticate?.({ account: activeAccount, password: "wrong-password" })).toBeNull();
      expect(
        await authenticate?.({ account: `absent.${suffix}`, password }),
      ).toBeNull();
      expect(await authenticate?.({ account: disabledAccount, password })).toBeNull();
    });
  });

  describe("login failure lockout", () => {
    it("locks an account at the threshold and clears on a correct password", async () => {
      const guard = createUaisAppLoginFailureGuard({ env });
      expect(guard).toBeDefined();

      const accountKey = normalizeUaisLoginIdentifier(activeAccount);
      expect(accountKey).toBe(activeAccount);
      const nowMs = Date.parse("2026-08-16T09:00:00.000Z");
      await guard?.clearFailures({ accountKey: accountKey as string });

      // Nine failures inside the window are still nine chances at a typo.
      for (let attempt = 0; attempt < 9; attempt += 1) {
        await guard?.recordFailure({ accountKey: accountKey as string, nowMs: nowMs + attempt });
      }
      expect(
        await guard?.isLockedOut({ accountKey: accountKey as string, nowMs: nowMs + 9 }),
      ).toBe(false);

      await guard?.recordFailure({ accountKey: accountKey as string, nowMs: nowMs + 10 });
      expect(
        await guard?.isLockedOut({ accountKey: accountKey as string, nowMs: nowMs + 11 }),
      ).toBe(true);
      // Short by design: an attacker can cost a student fifteen minutes, not a
      // semester.
      expect(
        await guard?.isLockedOut({
          accountKey: accountKey as string,
          nowMs: nowMs + 16 * 60 * 1000,
        }),
      ).toBe(false);

      await guard?.clearFailures({ accountKey: accountKey as string });
      expect(
        await guard?.isLockedOut({ accountKey: accountKey as string, nowMs: nowMs + 11 }),
      ).toBe(false);
    });

    it("restarts the window rather than accumulating across it", async () => {
      const guard = createUaisAppLoginFailureGuard({ env });
      const accountKey = officialEmail;
      const nowMs = Date.parse("2026-08-16T09:00:00.000Z");
      await guard?.clearFailures({ accountKey });

      for (let attempt = 0; attempt < 9; attempt += 1) {
        await guard?.recordFailure({ accountKey, nowMs: nowMs + attempt });
      }
      // One failure an hour later starts a fresh window, so yesterday's typos
      // cannot combine with today's into a lockout.
      const laterMs = nowMs + 60 * 60 * 1000;
      await guard?.recordFailure({ accountKey, nowMs: laterMs });
      expect(await guard?.isLockedOut({ accountKey, nowMs: laterMs + 1 })).toBe(false);

      await guard?.clearFailures({ accountKey });
    });
  });
});
