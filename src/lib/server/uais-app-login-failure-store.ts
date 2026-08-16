import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";

// Durable brute-force protection for POST /api/auth/app-session.
//
// The thresholds are FIXED CONSTANTS, not env names. The release env catalog's
// active-production tier is saturated, and more importantly a login lockout is
// not a knob an operator should be tuning under pressure - the same reasoning
// the share-link limiter records for its own fixed limits.
//
// The numbers are chosen against two opposite failure modes:
//
//   - Too strict, and a per-account lockout becomes a denial-of-service anyone
//     can aim at 200 known university names. That is why the lockout is SHORT
//     and the threshold is generous: an attacker can cost a student fifteen
//     minutes, not a semester.
//   - Too loose, and credential stuffing succeeds. Ten attempts per fifteen
//     minutes is far above real mistyping and far below a useful attack rate.
//
// Keying is per account, deliberately NOT per IP. A lecture hall shares one
// campus NAT egress address, so an IP-keyed limiter would throttle the whole
// class the moment one student fumbled a password - the same constraint the
// share-link limiter documents. The account key is the normalized account, so
// it carries no personal data beyond the identifier already in the URL of every
// authenticated request.

const maxFailuresBeforeLockout = 10;
const failureWindowMs = 15 * 60 * 1000;
const lockoutMs = 15 * 60 * 1000;

export type UaisAppLoginFailureClientFactory = (input: {
  env: Record<string, string | undefined>;
  max?: number;
}) => {
  pooled?: boolean;
  sql: {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    end: (options?: { timeout?: number }) => Promise<void> | void;
  };
};

export type UaisAppLoginFailureGuard = {
  /**
   * True when the account is inside an active lockout window. Callers must
   * answer a locked-out attempt with the SAME 401 body as a wrong password -
   * a distinct status would turn this into an account-existence oracle.
   */
  isLockedOut: (input: { accountKey: string; nowMs: number }) => Promise<boolean>;
  recordFailure: (input: { accountKey: string; nowMs: number }) => Promise<void>;
  clearFailures: (input: { accountKey: string }) => Promise<void>;
};

export function createUaisAppLoginFailureGuard(input: {
  env: Record<string, string | undefined>;
  createDatabase?: UaisAppLoginFailureClientFactory;
}): UaisAppLoginFailureGuard | undefined {
  if (getUaisCoreDatabaseReadiness(input.env).status !== "ready") {
    return undefined;
  }

  // Acquires through the same `createDatabase ?? pool` seam every other store
  // uses, and releases through the shared helper so an injected test double is
  // still closed while a pooled client is kept.
  const openClient = () =>
    (input.createDatabase ?? getUaisCoreDatabasePool)({ env: input.env, max: 1 });

  return {
    isLockedOut: async ({ accountKey, nowMs }) => {
      const client = openClient();
      try {
        const rows = await client.sql`
          SELECT locked_until
          FROM uais_app_login_failures
          WHERE account_key = ${accountKey}
        `;
        const lockedUntil = readTimestampMs(
          (rows[0] as { locked_until?: unknown } | undefined)?.locked_until,
        );
        return lockedUntil !== undefined && lockedUntil > nowMs;
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    recordFailure: async ({ accountKey, nowMs }) => {
      const now = new Date(nowMs).toISOString();
      const windowStart = new Date(nowMs - failureWindowMs).toISOString();
      const lockedUntil = new Date(nowMs + lockoutMs).toISOString();

      // One statement, no read-modify-write: the whole decision - restart the
      // window, increment, and lock when the count crosses the threshold - is
      // expressed in the UPSERT, so two concurrent attempts on the same account
      // cannot interleave into a lost increment and no row is ever held under a
      // lock across a round trip.
      const client = openClient();
      try {
        await client.sql`
          INSERT INTO uais_app_login_failures (
            account_key, failure_count, first_failure_at, last_failure_at, locked_until, updated_at
          )
          VALUES (${accountKey}, 1, ${now}, ${now}, NULL, ${now})
          ON CONFLICT (account_key) DO UPDATE SET
            failure_count = CASE
              WHEN uais_app_login_failures.first_failure_at IS NULL
                OR uais_app_login_failures.first_failure_at < ${windowStart}
              THEN 1
              ELSE uais_app_login_failures.failure_count + 1
            END,
            first_failure_at = CASE
              WHEN uais_app_login_failures.first_failure_at IS NULL
                OR uais_app_login_failures.first_failure_at < ${windowStart}
              THEN ${now}::timestamptz
              ELSE uais_app_login_failures.first_failure_at
            END,
            last_failure_at = ${now},
            locked_until = CASE
              WHEN uais_app_login_failures.first_failure_at IS NOT NULL
                AND uais_app_login_failures.first_failure_at >= ${windowStart}
                AND uais_app_login_failures.failure_count + 1 >= ${maxFailuresBeforeLockout}
              THEN ${lockedUntil}::timestamptz
              ELSE NULL
            END,
            updated_at = ${now}
        `;
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },

    // A correct password ends the window immediately: the counter exists to
    // slow down guessing, not to punish a student who eventually remembered.
    clearFailures: async ({ accountKey }) => {
      const client = openClient();
      try {
        await client.sql`
          DELETE FROM uais_app_login_failures WHERE account_key = ${accountKey}
        `;
      } finally {
        await closeUaisCoreDatabaseClient(client);
      }
    },
  };
}

function readTimestampMs(value: unknown) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}
