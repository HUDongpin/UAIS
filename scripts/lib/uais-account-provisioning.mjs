// Shared provisioning primitives for the first-party UAIS account scripts.
//
// `scripts/seed-uais-accounts.mjs` creates accounts, `scripts/reset-uais-account-password.mjs`
// repairs one. They have to agree on the password encoding, the account charset,
// the minimum password length, the database URL source and the mode of the file
// that carries a credential off the machine. A second copy of any of those is a
// silent drift waiting to happen - a hash written with different scrypt
// parameters verifies as a WRONG PASSWORD, with no error anywhere and no way for
// the student to tell the difference from a typo.
//
// Node builtins plus `postgres`, the driver the app already ships. No new
// dependency: adding one is an owner stop-condition in this repo.
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, writeFile } from "node:fs/promises";

// Same order and names as scripts/apply-core-migrations.mjs and
// scripts/app-auth-provider-readiness.mjs, so "which URL did it use" has one
// answer across the chain.
export const databaseUrlEnvNames = ["UAIS_CORE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"];

// The account is the stable internal principal id: the teaching actorId and the
// chatroom author id, which eight route validators independently require to be
// free of '@'. Matches uaisAccountPattern in src/lib/server/uais-app-account-store.ts.
export const accountPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export const accountMaxLength = 120;

// The floor a seeded or reset password must clear.
//
// Not a strength policy - no character classes, no dictionary - because the
// passwords these scripts write are ISSUED, not chosen: they are read off a
// printed slip and changed later. The floor exists to catch the roster column
// that holds a placeholder ("1", "x", a student number fragment), which used to
// seed verbatim and hand out an account anyone could open. Twelve unambiguous
// characters is what `generateInitialPassword` produces, so a generated password
// clears this by a wide margin.
export const minimumAccountPasswordLength = 8;

// Must match src/lib/server/uais-app-password-hash.ts. Still not IMPORTED from
// there - these are plain .mjs operator scripts and that module is TypeScript -
// but there is now exactly one copy on this side of the line, and the encoding
// is self-describing, so a drift shows up as a failed verify in a test rather
// than as a silent mismatch.
const scryptParameters = { cost: 16384, blockSize: 8, parallelization: 1 };
const scryptKeyLength = 32;
const saltLength = 16;
const scryptMaxMemoryBytes = 128 * 1024 * 1024;

export function hashAccountPassword(plaintext) {
  const salt = randomBytes(saltLength);
  return new Promise((resolve, reject) => {
    scryptCallback(
      // Normalizing to NFC means a password typed with a decomposed accent on
      // macOS still verifies against one enrolled with a precomposed accent.
      plaintext.normalize("NFC"),
      salt,
      scryptKeyLength,
      {
        N: scryptParameters.cost,
        r: scryptParameters.blockSize,
        p: scryptParameters.parallelization,
        maxmem: scryptMaxMemoryBytes,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(
          [
            "scrypt",
            scryptParameters.cost,
            scryptParameters.blockSize,
            scryptParameters.parallelization,
            salt.toString("base64"),
            derivedKey.toString("base64"),
          ].join("$"),
        );
      },
    );
  });
}

// Base32-ish over an unambiguous alphabet: no 0/O/1/l/I, because these are read
// off a printed slip and typed by a student on a phone.
export function generateInitialPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

// Matches src/lib/server/uais-app-account-store.ts. Permissive within one hard
// rule - exactly one '@', a dotted domain, no whitespace - because a stricter
// grammar rejects valid institutional addresses and locks a real student out.
export function isEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

export function readOption(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/**
 * The first named option that was typed with no value after it.
 *
 * `readOption` returns the NEXT token, so an option typed as the final argument
 * reads back as `undefined` - indistinguishable from not having been passed at
 * all. `--env-file` was the expensive case: an operator ending the command with
 * it silently ran against whatever their shell happened to export, which for a
 * script that resets passwords or seeds a roster means the wrong deployment,
 * reported as a clean success. Every value-taking option is checked, so the
 * failure is one loud line at the top instead of a per-flag guard each script
 * has to remember to add.
 *
 * Returns the option name, or `undefined` when they all carry a value.
 */
export function findOptionMissingValue(argv, names) {
  return names.find((name) => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] === undefined;
  });
}

/**
 * Reads `KEY=VALUE` lines into a plain object.
 *
 * Same shape as the one in scripts/app-auth-provider-readiness.mjs: `#` comments
 * and blank lines are skipped, the first `=` splits the pair, and one matching
 * pair of surrounding quotes is stripped. Deliberately NOT `dotenv` and
 * deliberately NOT `node --env-file`: the first is a new dependency and the
 * second cannot be reached once the script is already running, which is exactly
 * when an operator discovers the flag they were told exists does nothing.
 */
export function readEnvFile(path) {
  const entries = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (key) {
      entries[key] = stripOptionalQuotes(trimmed.slice(separator + 1).trim());
    }
  }
  return entries;
}

// The env file wins over the ambient environment, matching
// scripts/app-auth-provider-readiness.mjs: an operator who names a file is
// pointing at the deployment they mean, and an unrelated exported DATABASE_URL
// on their laptop must not quietly outrank it.
export function resolveScriptEnv({ argv, env, envFile }) {
  const path = envFile ?? readOption(argv, "--env-file");
  return path ? { ...env, ...readEnvFile(path) } : { ...env };
}

export function readDatabaseUrl(env) {
  for (const name of databaseUrlEnvNames) {
    const value = env[name]?.trim();
    if (value) return { name, value };
  }
  return undefined;
}

// One connection, no prepared statements: these scripts run once against a
// pooled managed Postgres, where a prepared statement cache is a liability
// rather than a saving.
export async function openCoreDatabase(databaseUrl) {
  const { default: postgres } = await import("postgres");
  return postgres(databaseUrl, { max: 1, prepare: false });
}

// The ONLY channel a password is allowed to leave these scripts through: a file
// the owner alone can read. stdout is a CI log and a shared terminal.
export async function writeInitialPasswordFile(path, rows) {
  await writeFile(
    path,
    ["account,initialPassword", ...rows.map((row) => `${row.account},${row.password}`)].join("\n") +
      "\n",
    { mode: 0o600 },
  );
  // `mode` applies at CREATION only. Writing over a path that already exists -
  // an operator re-running a reset into the same credential file, or a file the
  // shell created with `> credentials.csv` under a 022 umask - kept whatever
  // mode that file already had, which is how a world-readable 0644 file ends up
  // holding a live password. Restated explicitly on every write, so the mode is
  // a property of the file rather than of how it happened to come into being.
  await chmod(path, 0o600);
}

function stripOptionalQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
