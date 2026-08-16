import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Password hashing for first-party UAIS accounts.
//
// `node:crypto` scrypt, deliberately: bcrypt and argon2 are native addons, and
// a new dependency is an owner stop-condition in this repo. scrypt is memory-
// hard, is in the standard library, and needs no build step on Vercel. The repo
// already leans on node:crypto for randomUUID, createHash and timingSafeEqual.
//
// The encoded form carries its own parameters:
//
//   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
//
// so the cost can be raised later by hashing new passwords with new parameters
// while old hashes keep verifying against the ones they were made with. Without
// that, raising the cost would mean a data migration nobody can run - the
// plaintexts are gone.
//
// The shortest possible encoding is ~80 characters, comfortably above the
// `CHECK (password_hash IS NULL OR length(password_hash) >= 20)` constraint on
// uais_users.password_hash (migrations/0001_core_poc.sql).

type ScryptParameters = {
  cost: number;
  blockSize: number;
  parallelization: number;
};

// N=16384, r=8, p=1 is ~16MB and tens of milliseconds per verify - enough to
// make an offline attack on a leaked table expensive, cheap enough that 200
// students signing in at 09:00 do not each pay a visible delay. Raise `cost`
// (always a power of two) to strengthen; existing hashes are unaffected.
const defaultScryptParameters: ScryptParameters = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
};

const scryptKeyLength = 32;
const saltLength = 16;
// scrypt needs 128 * N * r bytes. Node's default maxmem is 32MB, which the
// default parameters fit; naming it explicitly means raising `cost` later does
// not fail at runtime with an opaque "memory limit exceeded".
const scryptMaxMemoryBytes = 128 * 1024 * 1024;

const encodedPrefix = "scrypt";

export function hashUaisAccountPassword(
  plaintext: string,
  parameters: ScryptParameters = defaultScryptParameters,
): Promise<string> {
  const salt = randomBytes(saltLength);
  return derive(plaintext, salt, parameters).then((hash) =>
    [
      encodedPrefix,
      parameters.cost,
      parameters.blockSize,
      parameters.parallelization,
      salt.toString("base64"),
      hash.toString("base64"),
    ].join("$"),
  );
}

export async function verifyUaisAccountPassword(input: {
  plaintext: string;
  encoded: string;
}): Promise<boolean> {
  const parsed = parseEncodedPassword(input.encoded);
  if (!parsed) {
    return false;
  }

  const candidate = await derive(input.plaintext, parsed.salt, parsed.parameters);
  // timingSafeEqual THROWS on a length mismatch rather than returning false, so
  // the length has to be compared first - the same ordering the app-session
  // signature check uses.
  if (candidate.length !== parsed.hash.length) {
    return false;
  }
  return timingSafeEqual(candidate, parsed.hash);
}

// Burns the same work as a real verify when no account matched.
//
// Without this, "no such account" returns in microseconds while "wrong
// password" takes tens of milliseconds, and that difference is a remotely
// measurable oracle for which of 200 university names are enrolled. The
// authenticator calls this on every miss.
let cachedDummyEncodedPassword: string | undefined;

export async function burnUaisAccountPasswordVerification(plaintext: string) {
  if (!cachedDummyEncodedPassword) {
    // A random password nobody holds. Generated once per process rather than
    // committed, so it is not a constant an attacker can precompute against.
    cachedDummyEncodedPassword = await hashUaisAccountPassword(
      randomBytes(32).toString("base64"),
    );
  }
  await verifyUaisAccountPassword({
    plaintext,
    encoded: cachedDummyEncodedPassword,
  });
}

function derive(plaintext: string, salt: Buffer, parameters: ScryptParameters) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      // Normalizing to NFC means a password typed with a decomposed accent on
      // macOS still verifies against one enrolled with a precomposed accent.
      plaintext.normalize("NFC"),
      salt,
      scryptKeyLength,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: scryptMaxMemoryBytes,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function parseEncodedPassword(encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== encodedPrefix) {
    return undefined;
  }

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  if (
    !isPositiveInteger(cost) ||
    !isPositiveInteger(blockSize) ||
    !isPositiveInteger(parallelization) ||
    // A stored cost that is not a power of two would make scrypt throw, turning
    // a corrupt row into a 500 instead of a failed login.
    (cost & (cost - 1)) !== 0
  ) {
    return undefined;
  }

  const salt = Buffer.from(parts[4], "base64");
  const hash = Buffer.from(parts[5], "base64");
  if (salt.length === 0 || hash.length === 0) {
    return undefined;
  }

  return {
    parameters: { cost, blockSize, parallelization },
    salt,
    hash,
  };
}

function isPositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}
