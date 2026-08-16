import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

// The operator-side password reset. Until this script there was no password
// change path of ANY kind in the product - no route, no UI, and a seed script
// that is `ON CONFLICT (account) DO NOTHING` by design - so a student who forgot
// their initial password had no way back in.
//
// Exercised as a CLI, the way an operator runs it, because the refusals ARE the
// safety property: everything asserted here happens before the script opens a
// connection, which is also what lets this suite run without a database.

const runFile = promisify(execFile);
const scriptPath = "scripts/reset-uais-account-password.mjs";
const fixtureDirs: string[] = [];

afterAll(async () => {
  await Promise.all(fixtureDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createFixtureDir() {
  const dir = await mkdtemp(join(tmpdir(), "uais-password-reset-"));
  fixtureDirs.push(dir);
  return dir;
}

async function runReset(args: string[]) {
  try {
    const { stdout, stderr } = await runFile(process.execPath, [scriptPath, ...args], {
      // Hermetic: an exported DATABASE_URL on the operator's laptop - or in CI -
      // must not be what decides whether this script reaches a database.
      env: { PATH: process.env.PATH },
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe("UAIS account password reset CLI", () => {
  it("refuses to run without a --confirm that names the account", async () => {
    // A reset is not reversible: the previous hash is gone and the student's
    // current password stops working the moment it lands. Naming the account
    // twice is the cheapest guard against resetting the row above or below the
    // one intended.
    const missing = await runReset(["--account", "s2026001"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("--confirm");
    expect(missing.stdout).toBe("");

    const mismatched = await runReset([
      "--account",
      "s2026001",
      "--confirm",
      "s2026002",
      "--out",
      "/dev/null",
    ]);
    expect(mismatched.exitCode).toBe(1);
    expect(mismatched.stderr).toContain("Nothing was changed.");
    // Neither value is echoed back: the point of the guard is that they differ,
    // and both are student identifiers.
    expect(mismatched.stderr).not.toContain("s2026001");
    expect(mismatched.stderr).not.toContain("s2026002");
  });

  it("refuses a new password below the shared minimum", async () => {
    // A reset must not be able to install a credential the roster import would
    // have rejected.
    const { exitCode, stderr } = await runReset([
      "--account",
      "s2026001",
      "--confirm",
      "s2026001",
      "--password",
      "short7c",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("at least 8 characters");
    expect(stderr).not.toContain("short7c");

    // A trailing `--password` used to read as "no password supplied" and quietly
    // generate one, which is not what an operator who typed the flag is about to
    // hand the student.
    const empty = await runReset(["--account", "s2026001", "--confirm", "s2026001", "--password"]);
    expect(empty.exitCode).toBe(1);
    expect(empty.stderr).toContain("--password requires a value.");
  });

  it("refuses a generated password with nowhere to write it", async () => {
    // A generated password that is never written down cannot be given to the
    // student, and the reset would then lock them out more thoroughly than the
    // forgotten password did.
    const { exitCode, stderr } = await runReset([
      "--account",
      "s2026001",
      "--confirm",
      "s2026001",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--out");
  });

  it("refuses an identifier that is neither an account nor an address", async () => {
    for (const identifier of ["not an account", "two@@at.example.com", "-leading-dash"]) {
      const { exitCode, stderr } = await runReset([
        "--account",
        identifier,
        "--confirm",
        identifier,
      ]);

      expect(exitCode, identifier).toBe(1);
      expect(stderr, identifier).toContain("Blocked:");
    }
  });

  it("lower-cases the identifier and reports a redacted plan on a dry run", async () => {
    const dir = await createFixtureDir();
    const envFile = join(dir, "env.txt");
    await writeFile(
      envFile,
      ['# managed postgres', 'UAIS_CORE_DATABASE_URL="postgres://user:pass@db.example.test/uais"'].join(
        "\n",
      ) + "\n",
    );

    // Typed upper-case, confirmed lower-case: accounts are stored lower-cased
    // and compared exactly (the unique index serves the lookup), so a reset that
    // skipped the fold would miss the row.
    const { exitCode, stdout } = await runReset([
      "--account",
      "S2026001",
      "--confirm",
      "s2026001",
      "--dry-run",
      "--env-file",
      envFile,
    ]);
    const summary = JSON.parse(stdout);

    expect(exitCode).toBe(0);
    expect(summary).toMatchObject({
      target: "uais-account-password-reset",
      status: "dry-run",
      identifierKind: "account",
      accountResolved: false,
      passwordSource: "generated",
      // --env-file is the only reason this reads `configured`: the ambient
      // environment above is empty.
      coreDatabase: "configured",
      valueRedacted: true,
    });
    // WHICH account is deliberately absent from a summary written for release
    // notes, and the DSN never appears anywhere.
    expect(stdout).not.toContain("s2026001");
    expect(stdout).not.toContain("db.example.test");
    expect(stdout).not.toContain("user:pass@");
  });

  it("accepts an email address as the identifier", async () => {
    const { exitCode, stdout } = await runReset([
      "--account",
      "Zhang.Wei@stu.gzhu.edu.cn",
      "--confirm",
      "zhang.wei@stu.gzhu.edu.cn",
      "--dry-run",
    ]);

    // The cohort signs in with email, so an operator holding a student's address
    // should not have to look the account up by hand first.
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      identifierKind: "email",
      coreDatabase: "missing",
    });
  });

  it("names the lockout table it clears, so a reset unlocks immediately", async () => {
    // The lockout is keyed on the identifier the caller SUBMITTED, not on the
    // resolved account, so the account and each registered address carry
    // separate counters. Clearing only one of them would leave a student holding
    // a brand-new password that appears not to work.
    const source = await readFile(scriptPath, "utf8");

    expect(source).toContain("DELETE FROM uais_app_login_failures");
    expect(source).toContain("FROM uais_user_login_identifiers WHERE user_id");
    // password_hash only: a reset must never re-activate a disabled account or
    // change who signs in as this student.
    expect(source).toContain("SET password_hash =");
    expect(source).not.toMatch(/SET[^;]*status\s*=/);
  });

  it("writes a generated credential only to a 0600 file", async () => {
    const dir = await createFixtureDir();
    const outPath = join(dir, "credential.csv");

    // The database write cannot run here, so this asserts the other half of the
    // contract: the file the operator asked for is the only channel, and it is
    // created with an owner-only mode by the same helper the seed script uses.
    const { writeInitialPasswordFile } = await import(
      "../scripts/lib/uais-account-provisioning.mjs"
    );
    await writeInitialPasswordFile(outPath, [{ account: "s2026001", password: "GENERATED" }]);

    expect(await readFile(outPath, "utf8")).toBe("account,initialPassword\ns2026001,GENERATED\n");
    expect((await stat(outPath)).mode & 0o777).toBe(0o600);
  });

  it("re-tightens an existing --out file to 0600 instead of inheriting its mode", async () => {
    const dir = await createFixtureDir();
    const outPath = join(dir, "credential.csv");
    // `writeFile`'s `mode` applies at CREATION only, so writing over a file the
    // shell had already made (`> credentials.csv` under a 022 umask), or one an
    // earlier run left behind and someone chmod'd, kept whatever mode it had -
    // which is how a world-readable file ends up holding a live password.
    await writeFile(outPath, "stale\n", { mode: 0o644 });
    await chmod(outPath, 0o644);
    expect((await stat(outPath)).mode & 0o777).toBe(0o644);

    const { writeInitialPasswordFile } = await import(
      "../scripts/lib/uais-account-provisioning.mjs"
    );
    await writeInitialPasswordFile(outPath, [{ account: "s2026001", password: "GENERATED" }]);

    expect((await stat(outPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(outPath, "utf8")).toBe("account,initialPassword\ns2026001,GENERATED\n");
  });

  it("refuses an option typed as the final token instead of silently ignoring it", async () => {
    // `--env-file` last read back as "not passed", so the reset ran against
    // whatever the ambient environment named - the wrong deployment, reported as
    // a clean success. Every value-taking option is checked, so no per-flag
    // guard can be forgotten.
    for (const option of ["--account", "--confirm", "--password", "--out", "--env-file"]) {
      const result = await runReset([
        ...(option === "--account" ? [] : ["--account", "s2026001"]),
        ...(option === "--confirm" ? [] : ["--confirm", "s2026001"]),
        option,
      ]);

      expect(result.exitCode, option).toBe(1);
      expect(result.stderr).toContain(`${option} requires a value.`);
      expect(result.stdout).toBe("");
    }
  });

  it("generates initial passwords over an unambiguous alphabet", async () => {
    const { generateInitialPassword, minimumAccountPasswordLength } = await import(
      "../scripts/lib/uais-account-provisioning.mjs"
    );

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const password = generateInitialPassword();
      // Read off a printed slip and typed by a student on a phone: no 0/O/1/l/I.
      expect(password).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
      expect(password.length).toBeGreaterThanOrEqual(minimumAccountPasswordLength);
    }
  });
});
