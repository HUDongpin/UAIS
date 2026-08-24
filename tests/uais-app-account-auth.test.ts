import { describe, expect, it } from "vitest";
import { createUaisAppSessionPostHandler } from "@/app/api/auth/app-session/handler";
import { UAIS_CORE_DATABASE_MIGRATION_VERSIONS } from "@/lib/db/migrations";
import {
  createUaisAppAccountAuthenticator,
  normalizeUaisLoginIdentifier,
} from "@/lib/server/uais-app-account-store";
import { createUaisAppLoginFailureGuard } from "@/lib/server/uais-app-login-failure-store";
import {
  hashUaisAccountPassword,
  verifyUaisAccountPassword,
} from "@/lib/server/uais-app-password-hash";
import { resolveUaisAppAuthProviderContract } from "@/lib/server/uais-app-auth-provider";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";

// First-party UAIS accounts: the provider that makes a real cohort able to sign
// in, and the production teacher session that makes a real teacher able to
// write. Before this, the entire account universe was two demo logins whose
// password is public in this repository, and production 503'd before it ever
// looked at a credential.
//
// The assertion this file exists for is `rejects the public demo credentials`.
// Everything else is supporting evidence.

const coreDatabase = { UAIS_CORE_DATABASE_URL: "postgres://user:pass@db.example.test/uais" };
const signingSecret = { UAIS_APP_SESSION_SIGNING_SECRET: "a".repeat(48) };
const teacherSigningSecret = { UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "b".repeat(48) };
const production = { UAIS_DEPLOYMENT_ENV: "production" };
const databaseAccounts = { UAIS_APP_AUTH_PROVIDER: "database-accounts" };

type AccountRow = {
  account: string;
  password_hash: string;
  role: string;
  display_name: string;
  department: string | null;
};

// Records every statement and replays queued rows, like the chatroom Postgres
// store suite: proves the real query is issued, not merely that the code type
// checks.
function createRecordingClient(options: { rows?: unknown[][] } = {}) {
  const queries: { text: string; values: unknown[] }[] = [];
  const rowQueue = [...(options.rows ?? [])];
  let ended = 0;

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(rowQueue.shift() ?? []);
  }) as never as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    end: (options?: { timeout?: number }) => Promise<void>;
  };
  sql.end = async () => {
    ended += 1;
  };

  return {
    factory: () => ({ sql }),
    queries,
    get ended() {
      return ended;
    },
  };
}

async function createAccountRow(input: {
  account: string;
  password: string;
  role?: string;
  displayName?: string;
  department?: string | null;
}): Promise<AccountRow> {
  return {
    account: input.account,
    password_hash: await hashUaisAccountPassword(input.password),
    role: input.role ?? "student",
    display_name: input.displayName ?? "Roster Name",
    department: input.department === undefined ? "Mathematics Education" : input.department,
  };
}

// Every handler built here gets one, so no test can construct the real
// Postgres-backed guard and dial `db.example.test`. The route's own deadline
// covers that in production; in a suite it would just be a slow, flaky test.
const inertLoginFailureGuard = {
  isLockedOut: async () => false,
  recordFailure: async () => undefined,
  clearFailures: async () => undefined,
};

function readSetCookieNames(response: Response) {
  return response.headers
    .getSetCookie()
    .map((header) => header.split("=")[0])
    .sort();
}

describe("UAIS account password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const encoded = await hashUaisAccountPassword("correct horse battery");

    expect(encoded.startsWith("scrypt$")).toBe(true);
    // The uais_users CHECK requires length >= 20.
    expect(encoded.length).toBeGreaterThanOrEqual(20);
    expect(await verifyUaisAccountPassword({ plaintext: "correct horse battery", encoded })).toBe(
      true,
    );
    expect(await verifyUaisAccountPassword({ plaintext: "wrong", encoded })).toBe(false);
  });

  it("salts every hash so two identical passwords never share an encoding", async () => {
    const [first, second] = await Promise.all([
      hashUaisAccountPassword("same-password"),
      hashUaisAccountPassword("same-password"),
    ]);

    expect(first).not.toBe(second);
  });

  it("verifies a hash written by the operator scripts", async () => {
    // The provisioning scripts are plain .mjs and cannot import the TypeScript
    // hasher, so they carry their own copy of the scrypt parameters and the
    // encoding. A drift between the two is silent in the worst possible way: the
    // seeded or reset password verifies as a WRONG password, and the student
    // cannot tell it from a typo. This is the assertion that makes the drift
    // loud.
    const { hashAccountPassword } = await import(
      "../scripts/lib/uais-account-provisioning.mjs"
    );

    const encoded = await hashAccountPassword("issued-initial-password");

    expect(
      await verifyUaisAccountPassword({ plaintext: "issued-initial-password", encoded }),
    ).toBe(true);
    expect(await verifyUaisAccountPassword({ plaintext: "wrong", encoded })).toBe(false);
  });

  it("returns false rather than throwing on a malformed or corrupt stored hash", async () => {
    for (const encoded of [
      "",
      "not-a-hash",
      "scrypt$16384$8$1$only-four-parts",
      // A non-power-of-two cost would make scrypt throw, turning one bad row
      // into a 500 for every login attempt.
      "scrypt$12345$8$1$c2FsdA==$aGFzaA==",
      "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
    ]) {
      expect(await verifyUaisAccountPassword({ plaintext: "anything", encoded })).toBe(false);
    }
  });
});

describe("UAIS database account authenticator", () => {
  it("authenticates an active account and returns its session user", async () => {
    const row = await createAccountRow({
      account: "s2026001",
      password: "initial-pass",
      role: "student",
      displayName: "Zhang Wei",
    });
    const client = createRecordingClient({ rows: [[row]] });
    const authenticate = createUaisAppAccountAuthenticator({
      env: coreDatabase,
      createDatabase: client.factory,
    });

    const user = await authenticate?.({ account: "S2026001", password: "initial-pass" });

    expect(user).toEqual({
      account: "s2026001",
      role: "student",
      displayName: "Zhang Wei",
      department: "Mathematics Education",
    });
    // Case-folded to the stored key so the unique index serves the lookup, and
    // scoped to rows that can actually sign in. Bound twice: once against
    // `uais_users.account`, once against the login-identifier table.
    expect(client.queries[0].values).toEqual(["s2026001", "s2026001"]);
    expect(client.queries[0].text).toContain("status = 'active'");
    expect(client.queries[0].text).toContain("password_hash IS NOT NULL");
    expect(client.ended).toBe(1);
  });

  it("rejects a wrong password for a real account", async () => {
    const row = await createAccountRow({ account: "s2026001", password: "initial-pass" });
    const client = createRecordingClient({ rows: [[row]] });
    const authenticate = createUaisAppAccountAuthenticator({
      env: coreDatabase,
      createDatabase: client.factory,
    });

    expect(await authenticate?.({ account: "s2026001", password: "guess" })).toBeNull();
  });

  it("signs a student in with an email address", async () => {
    // The cohort signs in with email. The stored ACCOUNT stays free of '@' -
    // it is the teaching actorId, which eight route validators reject '@' in -
    // and the address resolves to it through uais_user_login_identifiers.
    const row = await createAccountRow({
      account: "s2026001",
      password: "initial-pass",
      displayName: "张伟",
    });
    const client = createRecordingClient({ rows: [[row]] });
    const authenticate = createUaisAppAccountAuthenticator({
      env: coreDatabase,
      createDatabase: client.factory,
    });

    const user = await authenticate?.({
      account: "Zhang.Wei@stu.gzhu.edu.cn",
      password: "initial-pass",
    });

    expect(user?.account).toBe("s2026001");
    // Case-folded, and matched against BOTH the account and the identifier
    // table in one statement.
    expect(client.queries[0].values).toEqual([
      "zhang.wei@stu.gzhu.edu.cn",
      "zhang.wei@stu.gzhu.edu.cn",
    ]);
    expect(client.queries[0].text).toContain("uais_user_login_identifiers");
  });

  it("resolves either of a student's addresses to the same account", async () => {
    // The reason the address cannot BE the account: a student typing their
    // personal address must not become a different actor - a different
    // chatroom room, a different membership record - than the same student
    // typing their official one.
    const row = await createAccountRow({ account: "s2026001", password: "initial-pass" });
    const authenticateWith = (identifier: string) => {
      const client = createRecordingClient({ rows: [[row]] });
      return createUaisAppAccountAuthenticator({
        env: coreDatabase,
        createDatabase: client.factory,
      })?.({ account: identifier, password: "initial-pass" });
    };

    const official = await authenticateWith("zhang.wei@stu.gzhu.edu.cn");
    const personal = await authenticateWith("zhangwei1998@qq.com");

    expect(official?.account).toBe("s2026001");
    expect(personal).toEqual(official);
  });

  it("rejects a malformed identifier before it reaches the database", async () => {
    const client = createRecordingClient({ rows: [[]] });
    const authenticate = createUaisAppAccountAuthenticator({
      env: coreDatabase,
      createDatabase: client.factory,
    });

    for (const identifier of [
      "not an email",
      "two@@at.example.com",
      "no-domain@localhost",
      `${"a".repeat(250)}@example.com`,
      "",
    ]) {
      expect(await authenticate?.({ account: identifier, password: "x" })).toBeNull();
    }
    expect(client.queries).toHaveLength(0);
  });

  it("accepts the address shapes a real university roster contains", () => {
    for (const identifier of [
      "zhang.wei@stu.gzhu.edu.cn",
      "hu.dongpin+uais@gzhu.edu.cn",
      "zhangwei1998@qq.com",
      "s2026001",
    ]) {
      expect(normalizeUaisLoginIdentifier(identifier)).toBe(identifier.toLowerCase());
    }
  });

  it("signs in an account whose department column is null", async () => {
    // department is nullable in the schema but required on the session user,
    // and the claims parser rejects a non-string - so a null must not produce
    // an unmintable session.
    const row = await createAccountRow({
      account: "s2026002",
      password: "initial-pass",
      department: null,
    });
    const client = createRecordingClient({ rows: [[row]] });
    const authenticate = createUaisAppAccountAuthenticator({
      env: coreDatabase,
      createDatabase: client.factory,
    });

    const user = await authenticate?.({ account: "s2026002", password: "initial-pass" });

    expect(user?.department).toBe("UAIS");
  });

  // THE SECOND REGRESSION THIS FILE EXISTS FOR.
  //
  // Every text column on the row used to run through a credential-shaped
  // rejection (/\/Users\/|secret|api[_-]?key|token/i), and a rejected value made
  // the whole row read as NONEXISTENT. A teacher whose title is "Secretary"
  // therefore got a permanent 401 on a correct password, with no server-side
  // trace and nothing in the response to distinguish it from a wrong one - the
  // least diagnosable failure in the entire login path.
  it("signs in the teacher displayed as Secretary instead of vanishing the account", async () => {
    const row = await createAccountRow({
      account: "hu.dongpin",
      password: "teacher-pass",
      role: "teacher",
      displayName: "Secretary, Teaching Committee",
      department: "Secretariat",
    });
    const client = createRecordingClient({ rows: [[row]] });
    const authenticate = createUaisAppAccountAuthenticator({
      env: coreDatabase,
      createDatabase: client.factory,
    });

    const user = await authenticate?.({ account: "hu.dongpin", password: "teacher-pass" });

    // The session is minted, the role survives, and the labels degrade: the
    // display name falls back to the account, the department to the neutral
    // label a null department already used. A wrong-looking name in the room is
    // a bug someone can see and fix; a 401 is not.
    expect(user).toEqual({
      account: "hu.dongpin",
      role: "teacher",
      displayName: "hu.dongpin",
      department: "UAIS",
    });
  });

  it("keeps an account whose own id contains a credential-shaped word", async () => {
    // `secretary`, `tokenizer` and a surname romanised as `token` are all legal
    // accounts under the roster's charset, and the seed script creates them
    // happily. Filtering the account was never a defence - the claims are
    // base64url JSON - and could only ever delete a real student.
    const row = await createAccountRow({
      account: "secretary",
      password: "initial-pass",
      displayName: "Li Na",
    });
    const client = createRecordingClient({ rows: [[row]] });
    const authenticate = createUaisAppAccountAuthenticator({
      env: coreDatabase,
      createDatabase: client.factory,
    });

    expect(
      await authenticate?.({ account: "secretary", password: "initial-pass" }),
    ).toMatchObject({ account: "secretary", displayName: "Li Na" });
  });

  it("still treats a row that cannot produce a session as no row", async () => {
    // The degradation above is for LABELS only. An account, a hash or a role
    // that is unusable is not a cosmetic problem, and one malformed record must
    // still not take the login route down for everyone.
    const usable = await createAccountRow({ account: "s2026001", password: "initial-pass" });
    for (const row of [
      { ...usable, account: "   " },
      { ...usable, account: "a".repeat(121) },
      { ...usable, password_hash: null as unknown as string },
      { ...usable, role: "registrar" },
    ]) {
      const client = createRecordingClient({ rows: [[row]] });
      const authenticate = createUaisAppAccountAuthenticator({
        env: coreDatabase,
        createDatabase: client.factory,
      });

      expect(await authenticate?.({ account: "s2026001", password: "initial-pass" })).toBeNull();
    }
  });

  it("is unavailable when no core database is configured", () => {
    expect(createUaisAppAccountAuthenticator({ env: {} })).toBeUndefined();
  });
});

describe("UAIS app auth provider contract", () => {
  it("reports the database provider production-ready once the core database is configured", () => {
    expect(
      resolveUaisAppAuthProviderContract({ env: { ...production, ...databaseAccounts, ...coreDatabase } }),
    ).toMatchObject({
      providerKind: "database-accounts",
      productionStatus: "ready",
      databaseAccountBinding: { source: "uais-core-database", accountTable: "uais_users" },
    });
  });

  it("blocks the database provider when the core database is missing", () => {
    expect(
      resolveUaisAppAuthProviderContract({ env: { ...production, ...databaseAccounts } }),
    ).toMatchObject({
      providerKind: "database-accounts",
      productionStatus: "blocked",
      blockedReason: "database-accounts-not-configured",
    });
  });

  it("never puts the database URL in the contract", () => {
    const contract = resolveUaisAppAuthProviderContract({
      env: { ...production, ...databaseAccounts, ...coreDatabase },
    });

    expect(JSON.stringify(contract)).not.toContain("db.example.test");
    expect(JSON.stringify(contract)).not.toContain("user:pass@");
  });
});

describe("production login on the database account provider", () => {
  const env = { ...production, ...databaseAccounts, ...coreDatabase, ...signingSecret };

  it("signs a real student in and issues the app session cookies", async () => {
    const row = await createAccountRow({
      account: "s2026001",
      password: "initial-pass",
      displayName: "Zhang Wei",
    });
    const client = createRecordingClient({ rows: [[row]] });
    const post = createUaisAppSessionPostHandler({
      env,
      now: new Date("2026-09-01T01:00:00.000Z"),
      createSessionId: () => "account-login-session",
      authenticateDatabaseAccount: createUaisAppAccountAuthenticator({
        env: coreDatabase,
        createDatabase: client.factory,
      }),
      loginFailureGuard: inertLoginFailureGuard,
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: "s2026001", password: "initial-pass" }),
      }),
    );
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.appSession.actor).toEqual({ account: "s2026001", role: "student" });
    expect(body.authProviderContract.providerKind).toBe("database-accounts");
    expect(readSetCookieNames(response)).toEqual([
      "uais_app_session",
      "uais_app_session_signature",
    ]);
    expect(JSON.stringify(body)).not.toContain("initial-pass");
    expect(JSON.stringify(body)).not.toContain("db.example.test");
  });

  // THE REGRESSION THIS FILE EXISTS FOR.
  //
  // The dispatch in the login route used to be a two-way ternary whose ELSE arm
  // was the hardcoded demo table. Any provider kind that was not the trusted
  // one - including this one - authenticated against Phoebe/12345 and
  // Peter/12345, credentials that are public in this repository. If that ever
  // regresses, production accepts them again.
  it("rejects the public demo credentials", async () => {
    const client = createRecordingClient({ rows: [[], []] });
    const post = createUaisAppSessionPostHandler({
      env,
      createSessionId: () => "demo-attempt-session",
      authenticateDatabaseAccount: createUaisAppAccountAuthenticator({
        env: coreDatabase,
        createDatabase: client.factory,
      }),
      loginFailureGuard: inertLoginFailureGuard,
    });

    for (const account of ["Peter", "Phoebe"]) {
      const response = await post(
        new Request("https://www.uais.top/api/auth/app-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account, password: "12345" }),
        }),
      );

      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("still refuses an unknown provider selector with a 503", async () => {
    const post = createUaisAppSessionPostHandler({
      env: { ...production, ...coreDatabase, ...signingSecret, UAIS_APP_AUTH_PROVIDER: "ldap" },
      loginFailureGuard: inertLoginFailureGuard,
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: "s2026001", password: "initial-pass" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.authProviderContract).toMatchObject({
      providerKind: "unsupported",
      blockedReason: "unsupported-provider",
    });
  });
});

describe("login failure lockout", () => {
  it("refuses a correct password while the account is locked out, with no oracle in the response", async () => {
    const row = await createAccountRow({ account: "s2026001", password: "initial-pass" });
    const client = createRecordingClient({ rows: [[row]] });
    const recorded: string[] = [];
    const post = createUaisAppSessionPostHandler({
      env: { ...production, ...databaseAccounts, ...coreDatabase, ...signingSecret },
      authenticateDatabaseAccount: createUaisAppAccountAuthenticator({
        env: coreDatabase,
        createDatabase: client.factory,
      }),
      loginFailureGuard: {
        isLockedOut: async () => true,
        recordFailure: async ({ accountKey }) => {
          recorded.push(accountKey);
        },
        clearFailures: async () => undefined,
      },
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: "s2026001", password: "initial-pass" }),
      }),
    );
    const body = await response.json();

    // 401, not 429, and no Retry-After: a distinct answer would tell an
    // attacker which of 200 university names exist and which are under attack.
    expect(response.status).toBe(401);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(body.error).toBe(
      "The account or password does not match an authorized UAIS account.",
    );
    // The provider is never consulted while locked out, so a lockout also stops
    // the scrypt work an attacker would otherwise keep buying.
    expect(client.queries).toHaveLength(0);
    // A failure inside a lockout must not extend it, or a retrying client would
    // hold itself locked out forever.
    expect(recorded).toEqual([]);
  });

  it("degrades open when the failure store is unreachable", async () => {
    const row = await createAccountRow({ account: "s2026001", password: "initial-pass" });
    const client = createRecordingClient({ rows: [[row]] });
    const post = createUaisAppSessionPostHandler({
      env: { ...production, ...databaseAccounts, ...coreDatabase, ...signingSecret },
      createSessionId: () => "degraded-session",
      authenticateDatabaseAccount: createUaisAppAccountAuthenticator({
        env: coreDatabase,
        createDatabase: client.factory,
      }),
      loginFailureGuard: {
        isLockedOut: async () => {
          throw new Error("neon unreachable");
        },
        recordFailure: async () => {
          throw new Error("neon unreachable");
        },
        clearFailures: async () => {
          throw new Error("neon unreachable");
        },
      },
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: "s2026001", password: "initial-pass" }),
      }),
    );

    // A database blip must not lock 200 students out of class: the counter is a
    // brake on guessing, not an authorization gate.
    expect(response.status).toBe(200);
  });

  it("locks an account out after the threshold and issues one statement per failure", async () => {
    const client = createRecordingClient();
    const guard = createUaisAppLoginFailureGuard({
      env: coreDatabase,
      createDatabase: client.factory,
    });

    await guard?.recordFailure({ accountKey: "s2026001", nowMs: Date.parse("2026-09-01T01:00:00Z") });

    const [statement] = client.queries;
    expect(statement.text).toContain("INSERT INTO uais_app_login_failures");
    expect(statement.text).toContain("ON CONFLICT (account_key) DO UPDATE");
    // One statement, so two concurrent attempts cannot interleave into a lost
    // increment, and no row is held under a lock across a round trip.
    expect(client.queries).toHaveLength(1);
    // Nothing about the attempt beyond the account key is persisted.
    expect(JSON.stringify(statement.values)).not.toContain("password");
  });

  it("reports a live lockout window and ignores an expired one", async () => {
    const nowMs = Date.parse("2026-09-01T01:00:00Z");
    const live = createRecordingClient({
      rows: [[{ locked_until: new Date(nowMs + 60_000).toISOString() }]],
    });
    const expired = createRecordingClient({
      rows: [[{ locked_until: new Date(nowMs - 60_000).toISOString() }]],
    });

    expect(
      await createUaisAppLoginFailureGuard({
        env: coreDatabase,
        createDatabase: live.factory,
      })?.isLockedOut({ accountKey: "s2026001", nowMs }),
    ).toBe(true);
    expect(
      await createUaisAppLoginFailureGuard({
        env: coreDatabase,
        createDatabase: expired.factory,
      })?.isLockedOut({ accountKey: "s2026001", nowMs }),
    ).toBe(false);
  });
});

describe("production teacher write authority", () => {
  const teacherEnv = {
    ...production,
    ...databaseAccounts,
    ...coreDatabase,
    ...signingSecret,
    ...teacherSigningSecret,
    UAIS_TEACHER_AUTH_PROVIDER: "database-account-cookie",
  };

  async function signInTeacher(env: Record<string, string | undefined>) {
    const row = await createAccountRow({
      account: "hu.dongpin",
      password: "teacher-pass",
      role: "teacher",
      displayName: "Peter Hu",
    });
    const client = createRecordingClient({ rows: [[row]] });
    const post = createUaisAppSessionPostHandler({
      env,
      now: new Date("2026-09-01T01:00:00.000Z"),
      createSessionId: () => "teacher-login-session",
      authenticateDatabaseAccount: createUaisAppAccountAuthenticator({
        env: coreDatabase,
        createDatabase: client.factory,
      }),
      loginFailureGuard: inertLoginFailureGuard,
    });
    return post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: "hu.dongpin", password: "teacher-pass" }),
      }),
    );
  }

  it("reports the database-account teacher provider production-ready", () => {
    expect(resolveUaisTeacherAuthProviderContract({ env: teacherEnv })).toMatchObject({
      providerKind: "database-account-cookie",
      adapterStatus: "implemented",
      productionStatus: "ready",
    });
  });

  it("blocks the teacher provider when the signing secret is weak or absent", () => {
    expect(
      resolveUaisTeacherAuthProviderContract({
        env: { ...teacherEnv, UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "short" },
      }),
    ).toMatchObject({
      productionStatus: "blocked",
      blockedReason: "weak-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    });
    expect(
      resolveUaisTeacherAuthProviderContract({
        env: { ...teacherEnv, UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: undefined },
      }),
    ).toMatchObject({
      productionStatus: "blocked",
      blockedReason: "missing-UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    });
  });

  it("mints the teacher session a production teacher needs to write", async () => {
    const response = await signInTeacher(teacherEnv);
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(readSetCookieNames(response)).toEqual([
      "uais_app_session",
      "uais_app_session_signature",
      "uais_teacher_auth_claims",
      "uais_teacher_auth_signature",
    ]);
    expect(body.verifiedTeacherAuthBridge.status).toBe("issued");
    // The teacher credential must not outlive the session that authorized it.
    expect(
      response.headers
        .getSetCookie()
        .filter((header) => header.startsWith("uais_teacher_auth"))
        .every((header) => header.includes("Secure") && header.includes("HttpOnly")),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain("teacher-pass");
    expect(JSON.stringify(body)).not.toContain("b".repeat(48));
  });

  it("issues no teacher session when the teacher-auth provider is not production-ready", async () => {
    const response = await signInTeacher({
      ...teacherEnv,
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: undefined,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(readSetCookieNames(response)).toEqual([
      "uais_app_session",
      "uais_app_session_signature",
    ]);
    expect(body.verifiedTeacherAuthBridge.status).toBe(
      "skipped-teacher-auth-provider-not-ready",
    );
  });

  it("issues no teacher session for a student on the same production deployment", async () => {
    const row = await createAccountRow({
      account: "s2026001",
      password: "initial-pass",
      role: "student",
    });
    const client = createRecordingClient({ rows: [[row]] });
    const post = createUaisAppSessionPostHandler({
      env: teacherEnv,
      createSessionId: () => "student-session",
      authenticateDatabaseAccount: createUaisAppAccountAuthenticator({
        env: coreDatabase,
        createDatabase: client.factory,
      }),
      loginFailureGuard: inertLoginFailureGuard,
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: "s2026001", password: "initial-pass" }),
      }),
    );

    expect(readSetCookieNames(response)).toEqual([
      "uais_app_session",
      "uais_app_session_signature",
    ]);
  });

  it("clears a stale teacher credential when the new sign-in mints none", async () => {
    // A student signing in on a browser that still holds a teacher's cookie
    // must lose it - otherwise that write credential stays live for the full
    // 8-hour TTL under a student's session.
    const row = await createAccountRow({
      account: "s2026001",
      password: "initial-pass",
      role: "student",
    });
    const client = createRecordingClient({ rows: [[row]] });
    const post = createUaisAppSessionPostHandler({
      env: teacherEnv,
      createSessionId: () => "student-after-teacher-session",
      authenticateDatabaseAccount: createUaisAppAccountAuthenticator({
        env: coreDatabase,
        createDatabase: client.factory,
      }),
      loginFailureGuard: inertLoginFailureGuard,
    });

    const response = await post(
      new Request("https://www.uais.top/api/auth/app-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "uais_teacher_auth_claims=stale; uais_teacher_auth_signature=stale",
        },
        body: JSON.stringify({ account: "s2026001", password: "initial-pass" }),
      }),
    );

    const cleared = response.headers
      .getSetCookie()
      .filter((header) => header.startsWith("uais_teacher_auth"));
    expect(cleared).toHaveLength(2);
    expect(cleared.every((header) => header.includes("Max-Age=0"))).toBe(true);
  });
});

describe("account login migration", () => {
  it("ships the failure table idempotently and registers it to run at deploy", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile("migrations/0004_app_account_login.sql", "utf8");

    // IF NOT EXISTS matters: the runner re-applies on every deploy.
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS uais_app_login_failures");
    expect(sql).toContain("account_key text PRIMARY KEY");
    // A migration that exists but is not registered never runs. The runner
    // derives its work list from migrations/*.sql and this inventory is pinned
    // to that same directory (tests/core-database-foundation.test.ts), so a
    // version named here is a version the deploy applies.
    expect(UAIS_CORE_DATABASE_MIGRATION_VERSIONS).toContain("0004_app_account_login");
    // The table must not become a log of who tried to sign in from where. The
    // check is on the column list alone, not the file: the comments discuss
    // exactly these names in order to explain their absence.
    const columns = sql.slice(sql.indexOf("uais_app_login_failures ("), sql.indexOf(");"));
    expect(columns).not.toMatch(/ip_address|user_agent|password/i);
  });
});

describe("login identifier migration", () => {
  it("maps many addresses onto one account, idempotently and registered to run", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile("migrations/0005_user_login_identifiers.sql", "utf8");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS uais_user_login_identifiers");
    // The address is the PRIMARY KEY, which is what stops one address from ever
    // pointing at two accounts.
    expect(sql).toContain("identifier text PRIMARY KEY");
    expect(sql).toContain("REFERENCES uais_users(id) ON DELETE CASCADE");
    // Stored lower-cased and compared exactly, so the primary key serves the
    // lookup rather than an unindexable lower(...) expression.
    expect(sql).toContain("identifier = lower(identifier)");
    // A migration that exists but is not registered never runs. The runner
    // derives its work list from migrations/*.sql and this inventory is pinned
    // to that same directory (tests/core-database-foundation.test.ts), so a
    // version named here is a version the deploy applies.
    expect(UAIS_CORE_DATABASE_MIGRATION_VERSIONS).toContain("0005_user_login_identifiers");
  });
});

describe("roster import with email identifiers", () => {
  async function importRoster(csv: string, options: { envFileLines?: string[] } = {}) {
    const { execFile } = await import("node:child_process");
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { promisify } = await import("node:util");

    const dir = await mkdtemp(join(tmpdir(), "uais-roster-"));
    const rosterPath = join(dir, "roster.csv");
    await writeFile(rosterPath, csv);
    const envFilePath = join(dir, "env.txt");
    if (options.envFileLines) {
      await writeFile(envFilePath, `${options.envFileLines.join("\n")}\n`);
    }
    try {
      // The script exits non-zero when NO row passed validation, and still
      // prints the summary - that is the case several of these tests assert on.
      const stdout = await promisify(execFile)(
        process.execPath,
        [
          "scripts/seed-uais-accounts.mjs",
          "--roster",
          rosterPath,
          "--dry-run",
          ...(options.envFileLines ? ["--env-file", envFilePath] : []),
        ],
        // Hermetic: an operator's exported DATABASE_URL - or CI's - must not be
        // what makes `coreDatabase` read as configured below.
        { env: { PATH: process.env.PATH } },
      )
        .then((result) => result.stdout)
        .catch((error: { stdout?: string }) => error.stdout ?? "");
      return JSON.parse(stdout);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("accepts a roster of official and personal addresses", async () => {
    const summary = await importRoster(
      [
        "email,personalEmail,displayName,role,department",
        "zhang.wei@stu.gzhu.edu.cn,zhangwei1998@qq.com,张伟,student,数学教育",
        "hu.dongpin@gzhu.edu.cn,,Peter Hu,teacher,实验教学中心",
      ].join("\n"),
    );

    expect(summary).toMatchObject({
      accepted: 2,
      rejected: 0,
      // Three addresses across two accounts: both of the student's, one of the
      // teacher's.
      loginIdentifiers: 3,
      accountsDerivedFromEmail: 2,
    });
  });

  it("refuses to guess an account when two addresses would derive the same one", async () => {
    // Two students at different domains sharing a local part. Deriving would
    // silently merge them into one identity - one chatroom room, one set of
    // memberships - so both lines are rejected with the fix named.
    const summary = await importRoster(
      [
        "email,displayName",
        "zhang.wei@stu.gzhu.edu.cn,张伟",
        "zhang.wei@other.edu.cn,伟张",
      ].join("\n"),
    );

    expect(summary.accepted).toBe(0);
    expect(summary.rejectedLines).toEqual([
      { line: 2, reason: "account-collision-add-explicit-account" },
      { line: 3, reason: "account-collision-add-explicit-account" },
    ]);
  });

  it("accepts those same students once explicit accounts are supplied", async () => {
    const summary = await importRoster(
      [
        "account,email,displayName",
        "s2026001,zhang.wei@stu.gzhu.edu.cn,张伟",
        "s2026002,zhang.wei@other.edu.cn,伟张",
      ].join("\n"),
    );

    expect(summary).toMatchObject({ accepted: 2, rejected: 0, accountsDerivedFromEmail: 0 });
  });

  it("rejects a malformed address and a duplicate claim, naming lines not values", async () => {
    const summary = await importRoster(
      [
        "email,personalEmail,displayName",
        "not-an-email,,Bad Address",
        "shared@stu.gzhu.edu.cn,,First Claim",
        "shared@stu.gzhu.edu.cn,,Second Claim",
      ].join("\n"),
    );

    expect(summary.rejectedLines).toEqual([
      { line: 2, reason: "unsupported-email" },
      { line: 4, reason: "duplicate-email-in-roster" },
    ]);
    // Reason codes and line numbers only: a rejected line holds a real name and
    // a real address.
    expect(JSON.stringify(summary)).not.toContain("Bad Address");
    expect(JSON.stringify(summary)).not.toContain("shared@");
  });

  it("refuses a roster password below the minimum instead of seeding it", async () => {
    // A one-character password used to seed verbatim and hand out an account
    // anyone could open - and `ON CONFLICT (account) DO NOTHING` then made a
    // second run unable to correct it. Rejection is the only reversible answer.
    const summary = await importRoster(
      [
        "email,displayName,password",
        "zhang.wei@stu.gzhu.edu.cn,张伟,1",
        "li.na@stu.gzhu.edu.cn,李娜,short7c",
        "hu.dongpin@gzhu.edu.cn,Peter Hu,long-enough-password",
      ].join("\n"),
    );

    expect(summary.accepted).toBe(1);
    expect(summary.minimumPasswordLength).toBe(8);
    expect(summary.rejectedLines).toEqual([
      { line: 2, reason: "password-shorter-than-minimum" },
      { line: 3, reason: "password-shorter-than-minimum" },
    ]);
    // The rejected value is a real credential for some other system as often as
    // not, so it never reaches the summary.
    expect(JSON.stringify(summary)).not.toContain("short7c");
  });

  it("loads the database URL from --env-file without connecting or echoing it", async () => {
    // The flag was advertised in `--help` and never implemented: the script read
    // the DSN straight from the ambient environment, so an operator following
    // the help text ran against whatever their shell happened to export.
    const roster = "email,displayName\nzhang.wei@stu.gzhu.edu.cn,张伟";

    expect(await importRoster(roster)).toMatchObject({ coreDatabase: "missing" });
    const configured = await importRoster(roster, {
      envFileLines: [
        "# comment lines and blanks are skipped",
        'UAIS_CORE_DATABASE_URL="postgres://user:pass@db.example.test/uais"',
      ],
    });

    expect(configured).toMatchObject({ coreDatabase: "configured", status: "dry-run" });
    expect(JSON.stringify(configured)).not.toContain("db.example.test");
    expect(JSON.stringify(configured)).not.toContain("user:pass@");
  });
});
