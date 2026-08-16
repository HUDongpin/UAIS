// Roster import for first-party UAIS accounts.
//
//   node -- scripts/seed-uais-accounts.mjs --roster ./roster.csv [--out ./credentials.csv] [--dry-run]
//
// Reads a CSV roster and creates one `uais_users` row per student or teacher
// with a hashed initial password. Without this the `database-accounts` auth
// provider has an empty table and nobody can sign in - which is the state the
// deployment is in today.
//
// CSV columns (header row required, order free):
//   email          required  official address. A sign-in identifier.
//   personalEmail  optional  personal address. Also a sign-in identifier.
//   account        optional  the STABLE internal id. Derived from the official
//                            email's local part when absent.
//   displayName    required  the name the room and the transcript show.
//   role           optional  student | teacher | admin. Defaults to student.
//   department     optional  free text shown on the session.
//   password       optional  an initial password. Generated when absent. A
//                            supplied password shorter than 8 characters is
//                            REJECTED with `password-shorter-than-minimum`
//                            rather than seeded: a one-character placeholder in
//                            a roster column used to become a live account
//                            anyone could open.
//
// WHY account AND email are separate. Either of a student's addresses may be
// used to sign in, so the address cannot BE the account: two addresses would
// resolve to two accounts, and the same student would become two actors with
// two chatroom rooms and two membership records. The account is also the
// teaching actorId, which eight route validators require to be free of '@'.
// So addresses go in uais_user_login_identifiers and point at one stable
// account. Changing a student's personal address later is one row there and
// touches no course data.
//
// SAFETY PROPERTIES, all deliberate:
//
//   - Never prints an account's password to stdout. Generated passwords go to
//     the --out file (0600) or nowhere. The stdout summary is counts only, so
//     a CI log or a shared terminal cannot leak a credential.
//   - Never prints the database URL, and refuses to echo any row value in an
//     error message.
//   - INSERT ... ON CONFLICT (account) DO NOTHING, so re-running is safe and can
//     never reset a password a student has already changed. Existing accounts
//     are reported as skipped.
//   - Rejects an account that is not /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, and refuses
//     to GUESS one when derivation would collide: two students whose official
//     addresses share a local part across different domains get their lines
//     rejected with `account-collision-add-explicit-account` rather than being
//     silently merged into one identity or silently suffixed apart.
//   - Never reuses an address already registered to another account. That row
//     is skipped and counted, never reassigned.
//
// Resetting a password an account already has is deliberately NOT possible here.
// That is scripts/reset-uais-account-password.mjs, which names one account and
// requires an explicit --confirm.
import { readFile } from "node:fs/promises";
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

const validRoles = new Set(["student", "teacher", "admin"]);

if (argv.includes("--help") || argv.includes("-h")) {
  stdout.write(
    [
      "Usage: node -- scripts/seed-uais-accounts.mjs --roster <file.csv> [options]",
      "",
      "Options:",
      "  --roster <path>   CSV roster to import (required)",
      "  --out <path>      Write generated initial passwords here (mode 0600)",
      "  --dry-run         Validate and report without writing to the database",
      "  --env-file <path> Load environment variables from a file before running",
      "  --help            Show this message",
      "",
      "Reads the database URL from one of:",
      `  ${databaseUrlEnvNames.join(", ")}`,
      "",
      `A roster password shorter than ${minimumAccountPasswordLength} characters is rejected, never seeded.`,
      "Never prints passwords or the database URL to stdout.",
      "",
    ].join("\n"),
  );
  exit(0);
}

// Before anything is read: an option typed as the final token carries no value
// and used to read back as "not passed". For --env-file that meant importing a
// roster into whatever database the ambient environment pointed at, and
// reporting it as a success.
const optionMissingValue = findOptionMissingValue(argv, ["--roster", "--out", "--env-file"]);
if (optionMissingValue) {
  stderr.write(`Blocked: ${optionMissingValue} requires a value.\n`);
  exit(1);
}

const rosterPath = readOption(argv, "--roster");
if (!rosterPath) {
  stderr.write("Blocked: --roster <file.csv> is required.\n");
  exit(1);
}
const outPath = readOption(argv, "--out");
const dryRun = argv.includes("--dry-run");
// Resolved before any validation so a --dry-run can report whether the target
// deployment's URL is actually reachable from this invocation - which is the
// half of "--env-file works" an operator can check without a database.
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

let identifiersLinked = 0;
let identifiersTaken = 0;

const rows = parseRosterCsv(await readFile(rosterPath, "utf8"));
const accepted = [];
const rejected = [];
const seenAccounts = new Set();
const seenIdentifiers = new Set();

// Derivation is a two-pass affair. A local part is only safe to use as an
// account when it is unique across the WHOLE roster - otherwise two students at
// different domains (`wei.zhang@stu.example.edu` and `wei.zhang@gmail.com`)
// would derive the same account and silently become one identity. So the first
// pass collects the candidates and the second rejects the ones that clash,
// naming the fix.
//
// Counted by DISTINCT address, not by row. The same address appearing twice is
// a duplicate-row problem with its own reason code; folding it in here would
// report it as an account collision and send the operator to add explicit
// accounts, which does not fix a duplicated address.
const derivedEmails = new Map();
for (const row of rows) {
  if ((row.account ?? "").trim()) {
    continue;
  }
  const email = (row.email ?? "").trim().toLowerCase();
  const candidate = deriveAccountFromEmail(email);
  if (!candidate) {
    continue;
  }
  const emails = derivedEmails.get(candidate) ?? new Set();
  emails.add(email);
  derivedEmails.set(candidate, emails);
}

for (const [index, row] of rows.entries()) {
  const lineNumber = index + 2; // header occupies line 1
  const email = (row.email ?? "").trim().toLowerCase();
  const personalEmail = (row.personalemail ?? "").trim().toLowerCase();
  const explicitAccount = (row.account ?? "").trim().toLowerCase();
  const displayName = (row.displayname ?? "").trim();
  const role = (row.role ?? "student").trim().toLowerCase() || "student";
  const department = (row.department ?? "").trim();
  const password = (row.password ?? "").trim();

  // Report the LINE and a reason code, never the offending value: a rejected
  // roster line holds a real name, a real address, and possibly a real password.
  if (!email) {
    rejected.push({ line: lineNumber, reason: "missing-email" });
    continue;
  }
  if (!isEmail(email)) {
    rejected.push({ line: lineNumber, reason: "unsupported-email" });
    continue;
  }
  if (personalEmail && !isEmail(personalEmail)) {
    rejected.push({ line: lineNumber, reason: "unsupported-personal-email" });
    continue;
  }
  if (personalEmail && personalEmail === email) {
    rejected.push({ line: lineNumber, reason: "duplicate-email-on-row" });
    continue;
  }

  const identifiers = personalEmail ? [email, personalEmail] : [email];
  const clashing = identifiers.find((identifier) => seenIdentifiers.has(identifier));
  if (clashing) {
    // Two roster lines claiming the same address is an unresolvable identity
    // question; refusing both is safer than picking one.
    rejected.push({ line: lineNumber, reason: "duplicate-email-in-roster" });
    continue;
  }

  const account = explicitAccount || deriveAccountFromEmail(email);
  if (!account) {
    rejected.push({ line: lineNumber, reason: "cannot-derive-account-add-explicit-account" });
    continue;
  }
  if (account.length > accountMaxLength || !accountPattern.test(account)) {
    rejected.push({ line: lineNumber, reason: "unsupported-account-characters" });
    continue;
  }
  if (!explicitAccount && (derivedEmails.get(account)?.size ?? 0) > 1) {
    rejected.push({ line: lineNumber, reason: "account-collision-add-explicit-account" });
    continue;
  }
  if (seenAccounts.has(account)) {
    rejected.push({ line: lineNumber, reason: "duplicate-account-in-roster" });
    continue;
  }
  if (!displayName) {
    rejected.push({ line: lineNumber, reason: "missing-display-name" });
    continue;
  }
  if (!validRoles.has(role)) {
    rejected.push({ line: lineNumber, reason: "unsupported-role" });
    continue;
  }
  // A supplied password is REJECTED rather than seeded and reported, because
  // seeding it is the irreversible half: the row lands, the summary says
  // `seeded`, and ON CONFLICT DO NOTHING then makes a second run unable to
  // correct it. A roster column holding "1" or a student-number fragment is a
  // live account anyone can open, and this is the last point at which saying no
  // still costs nothing.
  if (password && password.length < minimumAccountPasswordLength) {
    rejected.push({ line: lineNumber, reason: "password-shorter-than-minimum" });
    continue;
  }

  seenAccounts.add(account);
  for (const identifier of identifiers) {
    seenIdentifiers.add(identifier);
  }
  accepted.push({
    account,
    accountWasDerived: !explicitAccount,
    identifiers,
    displayName,
    role,
    department: department || null,
    password: password || generateInitialPassword(),
    passwordWasGenerated: !password,
  });
}

if (rejected.length > 0 && accepted.length === 0) {
  stdout.write(JSON.stringify(createSummary({ seeded: 0, skipped: 0 }), null, 2) + "\n");
  stderr.write("Blocked: no roster row passed validation.\n");
  exit(1);
}

if (dryRun) {
  stdout.write(
    JSON.stringify(
      { ...createSummary({ seeded: 0, skipped: 0 }), status: "dry-run" },
      null,
      2,
    ) + "\n",
  );
  exit(0);
}

if (!databaseUrl) {
  stderr.write(
    `Blocked: set one of ${databaseUrlEnvNames.join(", ")} before seeding UAIS accounts.\n`,
  );
  exit(1);
}

const sql = await openCoreDatabase(databaseUrl.value);
let seeded = 0;
let skipped = 0;
try {
  for (const entry of accepted) {
    const passwordHash = await hashAccountPassword(entry.password);
    // One transaction per student: an account without its addresses cannot sign
    // in, and an address without its account points at nothing. Neither half is
    // useful alone, so neither half lands alone.
    await sql.begin(async (tx) => {
      // ON CONFLICT DO NOTHING, never DO UPDATE: re-running an import must not
      // be able to reset a password a student has already changed, nor
      // re-activate an account an operator disabled.
      const inserted = await tx`
        INSERT INTO uais_users (account, password_hash, role, display_name, department, status)
        VALUES (
          ${entry.account},
          ${passwordHash},
          ${entry.role},
          ${entry.displayName},
          ${entry.department},
          'active'
        )
        ON CONFLICT (account) DO NOTHING
        RETURNING id
      `;

      if (inserted.length > 0) {
        seeded += 1;
      } else {
        skipped += 1;
        entry.skipped = true;
      }

      // Resolved rather than assumed: on a re-run the account already exists, and
      // linking a newly-issued personal address to it is exactly what an operator
      // wants a second run to do.
      const owner = inserted[0] ?? (
        await tx`SELECT id FROM uais_users WHERE account = ${entry.account}`
      )[0];
      if (!owner) {
        return;
      }

      for (const identifier of entry.identifiers) {
        // DO NOTHING rather than DO UPDATE: an address already registered to
        // ANOTHER account is an identity conflict an import must never resolve
        // on its own - reassigning it would silently hand one student's sign-in
        // to another.
        const linked = await tx`
          INSERT INTO uais_user_login_identifiers (identifier, user_id, identifier_kind)
          VALUES (${identifier}, ${owner.id}, 'email')
          ON CONFLICT (identifier) DO NOTHING
          RETURNING identifier
        `;
        if (linked.length > 0) {
          identifiersLinked += 1;
        } else {
          identifiersTaken += 1;
        }
      }
    });
  }

  if (outPath) {
    await writeInitialPasswordFile(
      outPath,
      accepted.filter((entry) => !entry.skipped && entry.passwordWasGenerated),
    );
  }

  stdout.write(JSON.stringify(createSummary({ seeded, skipped }), null, 2) + "\n");
} finally {
  await sql.end({ timeout: 5 });
}

function createSummary({ seeded: seededCount, skipped: skippedCount }) {
  return {
    target: "uais-account-roster-seed",
    status: "applied",
    rosterRows: rows.length,
    accepted: accepted.length,
    seeded: seededCount,
    skippedExisting: skippedCount,
    accountsDerivedFromEmail: accepted.filter((entry) => entry.accountWasDerived).length,
    loginIdentifiers: accepted.reduce((total, entry) => total + entry.identifiers.length, 0),
    loginIdentifiersLinked: identifiersLinked,
    // Non-zero means an address already belonged to a different account. Worth
    // an operator's attention: that student cannot sign in with it.
    loginIdentifiersAlreadyTaken: identifiersTaken,
    rejected: rejected.length,
    // Line numbers and reason codes only - never the row content.
    rejectedLines: rejected.slice(0, 50),
    initialPasswordsWritten: Boolean(outPath),
    // Presence only, and never which NAME carried it: this is how an operator
    // confirms that --env-file pointed at the deployment they meant, in a
    // --dry-run that connects to nothing.
    coreDatabase: databaseUrl ? "configured" : "missing",
    minimumPasswordLength: minimumAccountPasswordLength,
    valueRedacted: true,
  };
}

// The local part of the official address, sanitised to the account charset.
// Returns undefined when nothing usable survives, so the operator is told to
// supply an explicit account rather than being given a guess.
function deriveAccountFromEmail(email) {
  const localPart = email.split("@")[0] ?? "";
  const sanitised = localPart.replace(/[^a-z0-9._-]/g, "");
  const trimmed = sanitised.replace(/^[^a-z0-9]+/, "");
  return trimmed && accountPattern.test(trimmed) && trimmed.length <= accountMaxLength
    ? trimmed
    : undefined;
}

// Minimal RFC4180-ish reader: handles quoted fields and embedded commas, which
// is all a university roster export needs. Returns lower-cased header keys so
// "displayName" and "displayname" both work.
function parseRosterCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return [];
  }
  const header = splitCsvLine(lines[0]).map((name) => name.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""]));
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current);
  return values;
}
