// Password reset for one first-party UAIS account.
//
//   node -- scripts/reset-uais-account-password.mjs \
//     --account s2026001 --confirm s2026001 [--out ./credential.csv] [--dry-run]
//
// Sets a new password on an account that already exists and clears the lockout
// that a forgotten password usually arrives with. Until this script there was no
// password change path of ANY kind in the product: no route, no UI, and a seed
// script that is `ON CONFLICT (account) DO NOTHING` by design, so a student who
// forgot their initial password - or a teacher whose slip leaked - had no way
// back in short of an operator writing SQL by hand.
//
// The account is named twice on purpose. --account selects, --confirm
// acknowledges, and the two must match exactly. A reset is not reversible: the
// previous hash is gone, and the student's current password stops working the
// moment this lands. Typing the account a second time is the cheapest possible
// guard against resetting the row above or below the one intended.
//
// SAFETY PROPERTIES, all deliberate and all shared with the seed script:
//
//   - Never prints the new password to stdout. A generated password goes to the
//     --out file (0600) or nowhere at all; the stdout summary carries statuses
//     and counts, so a CI log or a shared terminal cannot leak a credential.
//   - Never prints the database URL, the account, or any row value. The account
//     is written only into the --out file the operator asked for.
//   - --password is supported but is the WEAKER channel: a value on the command
//     line lands in shell history and in the process table, where none of the
//     redaction above can reach it. Prefer the generated password.
//   - Refuses a password shorter than the shared minimum, so a reset cannot
//     install a credential the roster import would have rejected.
//   - Changes exactly one column on exactly one row. It never creates an
//     account, never re-activates a disabled one, and never touches the login
//     identifiers - a reset is not a place to fix an identity mistake.
import { argv, env as processEnv, exit, stderr, stdout } from "node:process";
import {
  accountMaxLength,
  accountPattern,
  databaseUrlEnvNames,
  findOptionMissingValue,
  generateInitialPassword,
  hashAccountPassword,
  isEmail,
  minimumAccountPasswordLength,
  openCoreDatabase,
  readDatabaseUrl,
  readOption,
  resolveScriptEnv,
  writeInitialPasswordFile,
} from "./lib/uais-account-provisioning.mjs";

if (argv.includes("--help") || argv.includes("-h")) {
  stdout.write(
    [
      "Usage: node -- scripts/reset-uais-account-password.mjs --account <identifier> --confirm <identifier> [options]",
      "",
      "Options:",
      "  --account <identifier>  Account or registered email address to reset (required)",
      "  --confirm <identifier>  Repeat the identifier exactly, to acknowledge the reset (required)",
      "  --password <value>      New password. Generated when absent.",
      "  --out <path>            Write the new password here (mode 0600)",
      "  --dry-run               Validate and report without writing to the database",
      "  --env-file <path>       Load environment variables from a file before running",
      "  --help                  Show this message",
      "",
      "Reads the database URL from one of:",
      `  ${databaseUrlEnvNames.join(", ")}`,
      "",
      `A new password shorter than ${minimumAccountPasswordLength} characters is refused.`,
      "Clears the account's login-failure lockout rows, so the reset unlocks immediately.",
      "Never prints the new password, the account, or the database URL to stdout.",
      "",
    ].join("\n"),
  );
  exit(0);
}

// Before anything is read or resolved. An option typed as the final token
// carries no value and used to read back as "not passed": `--env-file` at the
// end of the line meant resetting a password on whatever deployment the ambient
// environment happened to name, reported as a clean success. This covers every
// value-taking option, --password included, so the guard cannot be forgotten for
// one of them.
const optionMissingValue = findOptionMissingValue(argv, [
  "--account",
  "--confirm",
  "--password",
  "--out",
  "--env-file",
]);
if (optionMissingValue) {
  stderr.write(`Blocked: ${optionMissingValue} requires a value.\n`);
  exit(1);
}

// Lower-cased for the same reason the store lower-cases what a student types:
// accounts and login identifiers are stored lower-cased and compared exactly, so
// the unique index serves the lookup. A reset that skipped this would miss the
// row for an operator who typed `S2026001`.
const identifier = (readOption(argv, "--account") ?? "").trim().toLowerCase();
const confirmation = (readOption(argv, "--confirm") ?? "").trim().toLowerCase();
const suppliedPassword = readOption(argv, "--password");
const outPath = readOption(argv, "--out");
const dryRun = argv.includes("--dry-run");

if (!identifier) {
  stderr.write("Blocked: --account <identifier> is required.\n");
  exit(1);
}
const identifierKind = classifyIdentifier(identifier);
if (!identifierKind) {
  stderr.write("Blocked: --account must be a UAIS account or a registered email address.\n");
  exit(1);
}
if (!confirmation) {
  stderr.write(
    "Blocked: --confirm <identifier> is required, and must repeat --account exactly.\n",
  );
  exit(1);
}
if (confirmation !== identifier) {
  // Named without echoing either value: the point of the guard is that the two
  // differ, and printing them back would put an account into a shared terminal.
  stderr.write("Blocked: --confirm does not match --account. Nothing was changed.\n");
  exit(1);
}
// `--password` as the last token would read as "no password supplied" and
// silently generate one, which is not what an operator who typed the flag is
// about to hand the student. Now caught by the generic guard at the top of the
// file, together with every other option that expects a value.
if (suppliedPassword !== undefined && suppliedPassword.length < minimumAccountPasswordLength) {
  stderr.write(
    `Blocked: --password must be at least ${minimumAccountPasswordLength} characters.\n`,
  );
  exit(1);
}

const password = suppliedPassword ?? generateInitialPassword();
const passwordSource = suppliedPassword === undefined ? "generated" : "supplied";
// A generated password that is never written down cannot be given to the
// student, and the reset has then locked them out more thoroughly than the
// forgotten password did. Refused before the row is touched.
if (passwordSource === "generated" && !outPath && !dryRun) {
  stderr.write(
    "Blocked: --out <path> is required for a generated password, which is never printed.\n",
  );
  exit(1);
}

let env;
try {
  env = resolveScriptEnv({ argv, env: processEnv });
} catch {
  // The path itself is not echoed: it is a local private path, and this script
  // is run against production from an operator's laptop.
  stderr.write("Blocked: --env-file could not be read.\n");
  exit(1);
}
const databaseUrl = readDatabaseUrl(env);

// Declared before the dry-run exit so the summary has one shape in every mode:
// a dry-run reports the same fields, all of them still empty.
let resolvedAccount;
let accountStatus;
let lockoutRowsCleared = 0;

if (dryRun) {
  stdout.write(
    JSON.stringify(createSummary({ status: "dry-run" }), null, 2) + "\n",
  );
  exit(0);
}

if (!databaseUrl) {
  stderr.write(
    `Blocked: set one of ${databaseUrlEnvNames.join(", ")} before resetting a UAIS password.\n`,
  );
  exit(1);
}

const sql = await openCoreDatabase(databaseUrl.value);
try {
  const passwordHash = await hashAccountPassword(password);
  await sql.begin(async (tx) => {
    // The same two ways in the login route has: the account itself, or an
    // address registered to it. An operator holding a student's email should
    // not have to look the account up by hand first.
    const [owner] = await tx`
      SELECT u.id, u.account, u.status
      FROM uais_users u
      WHERE u.account = ${identifier}
        OR EXISTS (
          SELECT 1
          FROM uais_user_login_identifiers i
          WHERE i.identifier = ${identifier}
            AND i.user_id = u.id
        )
      LIMIT 1
    `;
    if (!owner) {
      return;
    }
    resolvedAccount = owner.account;
    accountStatus = owner.status;

    // password_hash only. Not `status`, so a reset can never silently
    // re-activate an account an operator disabled, and not the identifiers, so
    // it can never silently change who signs in as this student.
    await tx`
      UPDATE uais_users
      SET password_hash = ${passwordHash}, updated_at = now()
      WHERE id = ${owner.id}
    `;

    // The lockout is keyed on the identifier the caller SUBMITTED, not on the
    // resolved account (src/lib/server/uais-app-login-failure-store.ts), so a
    // student's account and each of their addresses carry SEPARATE counters.
    // Clearing only the account would leave a student who locked themselves out
    // with their email still locked out with their email, holding a brand-new
    // password that appears not to work - the exact failure this script exists
    // to end. So every key that resolves to this row is cleared.
    const identifiers = await tx`
      SELECT identifier FROM uais_user_login_identifiers WHERE user_id = ${owner.id}
    `;
    const lockoutKeys = new Set([
      owner.account,
      identifier,
      ...identifiers.map((row) => row.identifier),
    ]);
    for (const accountKey of lockoutKeys) {
      const cleared = await tx`
        DELETE FROM uais_app_login_failures
        WHERE account_key = ${accountKey}
        RETURNING account_key
      `;
      lockoutRowsCleared += cleared.length;
    }
  });
} finally {
  // Reporting happens after the connection is released, not inside the try:
  // `exit()` in a try block skips the awaited close in the finally, which leaks
  // the connection on exactly the paths an operator retries.
  await sql.end({ timeout: 5 });
}

if (!resolvedAccount) {
  stdout.write(JSON.stringify(createSummary({ status: "account-not-found" }), null, 2) + "\n");
  stderr.write("Blocked: no UAIS account matched the identifier. Nothing was changed.\n");
  exit(1);
}

// After the row, never before it. A file written first and a failed update
// afterwards would hand the operator a slip with a password that does not work;
// this order can only lose a password that IS set, and re-running the reset -
// which issues a fresh one - fixes that.
if (outPath) {
  await writeInitialPasswordFile(outPath, [{ account: resolvedAccount, password }]);
}

stdout.write(JSON.stringify(createSummary({ status: "applied" }), null, 2) + "\n");

function createSummary({ status }) {
  return {
    target: "uais-account-password-reset",
    status,
    // WHICH account was reset is deliberately absent. It is a student identifier,
    // this summary is written for release notes and CI logs, and the operator
    // already knows it - they typed it twice. The --out file is where the
    // account appears, under 0600.
    identifierKind,
    accountResolved: Boolean(resolvedAccount),
    passwordSource,
    passwordWritten: Boolean(outPath) && status === "applied",
    // Non-zero means the account really was locked out and now is not.
    lockoutRowsCleared,
    minimumPasswordLength: minimumAccountPasswordLength,
    // Presence only, and never which NAME carried it: this is how an operator
    // confirms that --env-file pointed at the deployment they meant.
    coreDatabase: databaseUrl ? "configured" : "missing",
    ...(readAccountStatusWarnings().length > 0
      ? { warnings: readAccountStatusWarnings() }
      : {}),
    valueRedacted: true,
  };
}

// A password on a row that is not `active` still cannot sign in: the login
// lookup is scoped to `status = 'active'`. Resetting one is legitimate - an
// operator may be preparing an account before term - but it must not be reported
// as "the student can log in now", which is what an operator will otherwise read
// `applied` as.
function readAccountStatusWarnings() {
  return accountStatus && accountStatus !== "active"
    ? ["account-not-active-sign-in-still-blocked"]
    : [];
}

function classifyIdentifier(value) {
  if (isEmail(value)) {
    return "email";
  }
  return value.length <= accountMaxLength && accountPattern.test(value) ? "account" : undefined;
}
