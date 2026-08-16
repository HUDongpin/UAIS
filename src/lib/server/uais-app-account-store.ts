import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import {
  burnUaisAccountPasswordVerification,
  verifyUaisAccountPassword,
} from "@/lib/server/uais-app-password-hash";

// First-party UAIS accounts on the core database.
//
// `uais_users` has been migrated on every deploy since 0001 with `password_hash`,
// `role` and `status` columns, and until now nothing read or wrote it: the whole
// account universe was two hardcoded demo logins whose password is public in
// this repository. This module is the reader the schema was always anticipating.
//
// It authenticates and nothing else. Provisioning is `scripts/seed-uais-accounts.mjs`;
// lockout is `uais-app-login-failure-store.ts`; deciding whether this provider is
// production-ready is `uais-app-auth-provider.ts`.

// Test seam, matching the chatroom Postgres stores: injecting the client factory
// lets a suite drive the real query shape without a server.
export type UaisAppAccountClientFactory = (input: {
  env: Record<string, string | undefined>;
  max?: number;
}) => {
  pooled?: boolean;
  sql: {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    end: (options?: { timeout?: number }) => Promise<void> | void;
  };
};

export type UaisAppAccountAuthenticator = (input: {
  account: string;
  password: string;
}) => Promise<UaisAppSessionUser | null>;

// Two different things, deliberately kept apart.
//
// The ACCOUNT is the stable internal principal id. It becomes the teaching
// `actorId` and the chatroom author id, and eight route-level validators plus
// `isBridgeableActorId` independently require this exact shape - notably
// WITHOUT `@`. It never changes for the life of a student's record.
//
// A LOGIN IDENTIFIER is something a student types to sign in. The cohort signs
// in with email, and either their official or their personal address is
// acceptable, so one account has several - which is precisely why the email
// cannot be the account: two addresses would otherwise mean two actors, two
// chatroom rooms and two membership records for the same student.
const uaisAccountPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const uaisAccountMaxLength = 120;

// Intentionally permissive within one hard rule: exactly one `@`, with a dotted
// domain and no whitespace. This is a lookup key, not an assertion that the
// address deliverable - the roster is the authority on that - and a
// stricter grammar would reject valid institutional addresses (`+` tags, long
// TLDs, unicode local parts) and lock a real student out on their first day.
const uaisLoginEmailPattern = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
// RFC 5321 caps an address at 254 octets. Anything longer is not an address.
const uaisLoginIdentifierMaxLength = 254;

// `department` is nullable in the schema but required (and non-empty) on
// UaisAppSessionUser, and the session-claims parser rejects a non-string. A row
// with no department must still be able to sign in, so it gets a neutral label
// rather than an unmintable session.
//
// `display_name` is NOT NULL in the schema, so it has no equivalent constant:
// when it is unusable the account itself stands in, which is a real, unique,
// non-secret identifier the session already carries - and is visible enough in
// the room for the owner to notice and correct the row.
const defaultDepartmentLabel = "UAIS";

export function createUaisAppAccountAuthenticator(input: {
  env: Record<string, string | undefined>;
  createDatabase?: UaisAppAccountClientFactory;
}): UaisAppAccountAuthenticator | undefined {
  if (getUaisCoreDatabaseReadiness(input.env).status !== "ready") {
    return undefined;
  }

  return async ({ account, password }) => {
    const identifier = normalizeUaisLoginIdentifier(account);
    if (!identifier) {
      // Still burn the work: an identifier that fails the shape rule must not
      // answer faster than one that fails the password.
      await burnUaisAccountPasswordVerification(password);
      return null;
    }

    const row = await readActiveAccountRow({
      env: input.env,
      createDatabase: input.createDatabase,
      identifier,
    });

    if (!row) {
      await burnUaisAccountPasswordVerification(password);
      return null;
    }

    const verified = await verifyUaisAccountPassword({
      plaintext: password,
      encoded: row.passwordHash,
    });
    if (!verified) {
      return null;
    }

    return {
      account: row.account,
      role: row.role,
      displayName: row.displayName,
      department: row.department,
    };
  };
}

/**
 * Normalizes what a student typed into the sign-in box.
 *
 * Accepts an email address or a bare account. Everything is stored lower-cased
 * and compared exactly, so the lookup is served by the primary key on
 * `uais_user_login_identifiers` and by `uais_users_account_unique` - a
 * `lower(...)` expression could use neither index. Case-insensitive sign-in is
 * what students expect from an email, and what the demo authenticator already
 * did for accounts.
 *
 * Also the lockout key. Keying on the SUBMITTED identifier rather than on the
 * resolved account is deliberate: resolving first would mean a database read
 * before the lockout check, which is exactly the work a lockout exists to
 * refuse. The cost is that a student's two addresses carry separate counters,
 * so an attacker holding both gets two budgets - twenty attempts per fifteen
 * minutes instead of ten, still far below a useful rate.
 */
export function normalizeUaisLoginIdentifier(account: string) {
  const normalized = account.trim().toLowerCase();
  if (!normalized || normalized.length > uaisLoginIdentifierMaxLength) {
    return undefined;
  }
  if (uaisLoginEmailPattern.test(normalized)) {
    return normalized;
  }
  return normalized.length <= uaisAccountMaxLength && uaisAccountPattern.test(normalized)
    ? normalized
    : undefined;
}

async function readActiveAccountRow(input: {
  env: Record<string, string | undefined>;
  createDatabase?: UaisAppAccountClientFactory;
  identifier: string;
}) {
  const client = (input.createDatabase ?? getUaisCoreDatabasePool)({
    env: input.env,
    max: 1,
  });
  try {
    // One statement, two ways in: a registered login identifier (the cohort's
    // email addresses) or the account itself. A student with an official and a
    // personal address resolves to the SAME `uais_users` row either way, which
    // is the whole point of the identifier table.
    //
    // `status = 'active'` is the disable switch: a withdrawn or suspended
    // student keeps their row and their history but cannot sign in.
    // `password_hash IS NOT NULL` excludes the 'invited' rows a roster import
    // creates before an initial password is set.
    const rows = await client.sql`
      SELECT u.account, u.password_hash, u.role, u.display_name, u.department
      FROM uais_users u
      WHERE u.status = 'active'
        AND u.password_hash IS NOT NULL
        AND (
          u.account = ${input.identifier}
          OR EXISTS (
            SELECT 1
            FROM uais_user_login_identifiers i
            WHERE i.identifier = ${input.identifier}
              AND i.user_id = u.id
          )
        )
      LIMIT 1
    `;
    const row = rows[0] as
      | {
          account?: unknown;
          password_hash?: unknown;
          role?: unknown;
          display_name?: unknown;
          department?: unknown;
        }
      | undefined;
    if (!row) {
      return undefined;
    }

    const account = readAccountIdentifier(row.account);
    const passwordHash = typeof row.password_hash === "string" ? row.password_hash : "";
    const role = row.role;
    if (!account || !passwordHash || !isUaisAppRole(role)) {
      // A row that cannot produce a valid session is treated as no row rather
      // than as a 500: one malformed record must not take the login route down
      // for everyone. Only the three fields that ARE the session qualify - the
      // labels below degrade instead, because a label can be wrong without the
      // session being invalid.
      return undefined;
    }

    return {
      account,
      passwordHash,
      role,
      displayName: readAccountLabel(row.display_name) ?? account,
      department: readAccountLabel(row.department) ?? defaultDepartmentLabel,
    };
  } finally {
    await closeUaisCoreDatabaseClient(client);
  }
}

// The account is an IDENTITY, so it is bounded rather than filtered.
//
// It used to run through the same credential-shaped rejection the labels below
// document, which was never a defence here and could only ever delete a real
// student: `secretary`, `tokenizer` and a surname romanised as `token` are all
// legal accounts under the roster's own charset, and the seed script will happily
// create them. Nothing downstream gives this value any special meaning either -
// the claims are base64url JSON and the response body is JSON - so the filter
// bought nothing and cost a permanent 401.
//
// The bound that remains is the one the account genuinely has: a non-empty
// string no longer than the column's working limit.
function readAccountIdentifier(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= uaisAccountMaxLength ? normalized : undefined;
}

// A display name or a department is a LABEL: it decorates a room, a transcript
// and a header, and nothing keys on it.
//
// Sanitising remote-sourced text this way is right for the trusted-provider path
// (uais-app-auth-provider.ts), where the payload comes from a service this
// deployment does not control. Applied to a first-party roster row it produced
// the worst failure mode in the whole login path: a teacher whose title is
// "Secretary" - or any name containing "token" or "api key" - matched the
// pattern, the row was discarded as unreadable, and the account answered a
// permanent 401 with no server-side trace and nothing for the owner to look at.
//
// So a hit DEGRADES rather than vanishes, exactly as a null department already
// did: the caller substitutes a safe label, the student signs in, and the wrong
// name is visible in the room - a diagnosable bug instead of a silent lockout.
function readAccountLabel(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().slice(0, 160);
  if (!normalized || /\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function isUaisAppRole(value: unknown): value is UaisAppSessionUser["role"] {
  return value === "teacher" || value === "student" || value === "admin";
}
