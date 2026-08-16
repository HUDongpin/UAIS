-- 0004_app_account_login: durable per-account login failure counters.
--
-- POST /api/auth/app-session had no rate limit, no lockout and no failure
-- delay. That was survivable only while the entire account universe was two
-- demo logins; against a real cohort, credential-stuffing 200 known university
-- names is trivial and leaves no trace anywhere in the system.
--
-- Why a keyed table rather than the single-row jsonb snapshot pattern the
-- chatroom and course-management stores use: a snapshot row would serialise
-- every login attempt in the cohort through one FOR UPDATE lock, which is a
-- self-inflicted denial of service at 09:00 on the first day of term. One row
-- per account contends only with repeat attempts on the SAME account.
--
-- Why it cannot be the in-process limiter (src/lib/server/ai-request-rate-limit.ts):
-- that limiter is per serverless instance, so an attacker simply spreads
-- attempts across instances and is never locked out at all.
--
-- Deliberately NOT stored here: passwords, password fragments, hashes, client
-- IP addresses, user agents, or any user-supplied text beyond the account key
-- itself. A failure counter needs none of it, and a table of "who failed to log
-- in, from where" is a liability with no operational use.
--
-- Idempotent; safe to re-apply. The runner re-applies on every deploy and
-- checksum-locks the file once applied, so any correction ships as 0005.
CREATE TABLE IF NOT EXISTS uais_app_login_failures (
  account_key text PRIMARY KEY,
  failure_count integer NOT NULL DEFAULT 0,
  first_failure_at timestamptz,
  last_failure_at timestamptz,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Supports the periodic prune of rows whose window has long since expired, so
-- the table stays proportional to recently-active accounts rather than to every
-- account that ever mistyped a password.
CREATE INDEX IF NOT EXISTS uais_app_login_failures_updated_at_idx
  ON uais_app_login_failures(updated_at);
