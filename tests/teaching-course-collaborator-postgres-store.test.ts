import { describe, expect, it } from "vitest";
import {
  TeachingCourseCollaboratorStoreError,
  createTeachingCourseCollaboratorPostgresStore,
  type TeachingCourseCollaboratorPostgresClientFactory,
} from "@/lib/server/teaching-course-collaborator-postgres-store";

const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  recipient: "22222222-2222-4222-8222-222222222222",
  otherRecipient: "33333333-3333-4333-8333-333333333333",
  identifier: "44444444-4444-4444-8444-444444444444",
  grant: "55555555-5555-4555-8555-555555555555",
};
const now = new Date("2026-08-25T10:00:00.000Z");
const rawEmail = "Teacher.Lin@Example.Test";
const normalizedEmail = "teacher.lin@example.test";

type FakeQuery = {
  text: string;
  values: unknown[];
  inTransaction: boolean;
};

function createFakeDatabase(resolve: (query: FakeQuery) => unknown[]) {
  const queries: FakeQuery[] = [];
  const arrayCalls: Array<{ values: unknown[]; type?: number }> = [];
  let transactionDepth = 0;
  let beginCount = 0;
  let ended = 0;
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = {
      text: strings.join("?").replace(/\s+/g, " ").trim(),
      values,
      inTransaction: transactionDepth > 0,
    };
    queries.push(query);
    return resolve(query);
  }) as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    array: (values: readonly unknown[], type?: number) => unknown;
    begin: (run: (transaction: typeof sql) => Promise<void>) => Promise<void>;
    end: () => Promise<void>;
  };
  sql.array = (values, type) => {
    const call = {
      values: [...values],
      ...(type === undefined ? {} : { type }),
    };
    arrayCalls.push(call);
    return { kind: "postgres-array-parameter", ...call };
  };
  sql.begin = async (run) => {
    beginCount += 1;
    transactionDepth += 1;
    try {
      await run(sql);
    } finally {
      transactionDepth -= 1;
    }
  };
  sql.end = async () => {
    ended += 1;
  };
  return {
    factory: (() => ({ sql })) as unknown as TeachingCourseCollaboratorPostgresClientFactory,
    queries,
    arrayCalls,
    get beginCount() {
      return beginCount;
    },
    get ended() {
      return ended;
    },
  };
}

function ownerRow() {
  return {
    owner_user_id: ids.owner,
    owner_account: "teacher-kang",
  };
}

function recipientRow(
  override: Partial<{
    recipient_user_id: string;
    recipient_account: string;
    recipient_role: "student" | "teacher" | "admin";
    recipient_status: "active" | "disabled" | "invited";
    recipient_identifier_id: string | null;
  }> = {},
) {
  return {
    recipient_user_id: ids.recipient,
    recipient_account: "teacher-lin",
    recipient_role: "teacher" as const,
    recipient_status: "active" as const,
    recipient_identifier_id: ids.identifier,
    ...override,
  };
}

function grantRow(
  override: Partial<{
    id: string;
    course_id: string;
    recipient_user_id: string;
    recipient_identifier_id: string;
    granted_by_user_id: string;
    role: "observer" | "reviewer" | "teaching-assistant" | "co-instructor";
    scopes: string[];
    revision: number;
    granted_at: string;
    expires_at: string | null;
    revoked_at: string | null;
    revoked_by_user_id: string | null;
  }> = {},
) {
  return {
    id: ids.grant,
    course_id: "course-research-methods",
    recipient_user_id: ids.recipient,
    recipient_identifier_id: ids.identifier,
    granted_by_user_id: ids.owner,
    role: "reviewer" as const,
    scopes: ["course.grading.manage", "course.read"],
    revision: 1,
    granted_at: now.toISOString(),
    expires_at: "2026-09-25T10:00:00.000Z",
    revoked_at: null,
    revoked_by_user_id: null,
    ...override,
  };
}

function grantInput(
  override: Partial<Parameters<ReturnType<typeof createTeachingCourseCollaboratorPostgresStore>["grant"]>[0]> = {},
) {
  return {
    actorAccount: "teacher-kang",
    courseId: "course-research-methods",
    recipientEmail: rawEmail,
    role: "reviewer" as const,
    scopes: ["course.read", "course.grading.manage"] as const,
    expiresAt: "2026-09-25T10:00:00.000Z",
    idempotencyKey: "collaborator-grant-1",
    traceId: "trace-collaborator-grant-1",
    ...override,
  };
}

describe("teaching-course collaborator Postgres store", () => {
  it("persists grant, audit, idempotency receipt and pending outbox in one ordered transaction", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("AS recipient_identifier_id") && text.includes("i.identifier =")) {
        return [recipientRow()];
      }
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        return [];
      }
      if (text.startsWith("INSERT INTO uais_course_collaborator_grants")) {
        return [grantRow()];
      }
      if (
        text.startsWith("INSERT INTO uais_audit_log") ||
        text.startsWith("INSERT INTO uais_idempotency_records") ||
        text.startsWith("INSERT INTO uais_course_collaborator_notification_outbox")
      ) {
        return [];
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    const receipt = await store.grant(grantInput());

    expect(receipt).toEqual({
      status: "persisted",
      event: "grant-issued",
      grantId: ids.grant,
      courseId: "course-research-methods",
      recipientUserId: ids.recipient,
      role: "reviewer",
      scopes: ["course.grading.manage", "course.read"],
      grantStatus: "active",
      revision: 1,
      grantedAt: now.toISOString(),
      expiresAt: "2026-09-25T10:00:00.000Z",
      traceId: "trace-collaborator-grant-1",
      persistedAt: now.toISOString(),
    });
    expect(fake.beginCount).toBe(1);
    expect(fake.ended).toBe(1);
    expect(fake.queries.every((query) => query.inTransaction)).toBe(true);

    const fragments = [
      "AS owner_user_id",
      "AS recipient_identifier_id",
      "pg_advisory_xact_lock",
      "FROM uais_idempotency_records",
      "FROM uais_course_collaborator_grants",
      "INSERT INTO uais_course_collaborator_grants",
      "INSERT INTO uais_audit_log",
      "INSERT INTO uais_course_collaborator_notification_outbox",
      "INSERT INTO uais_idempotency_records",
    ];
    expect(
      fake.queries.map((query) =>
        fragments.find((fragment) => query.text.includes(fragment)),
      ),
    ).toEqual(fragments);
    const grantInsert = fake.queries[5];
    expect(grantInsert.text).toContain(
      "ON CONFLICT (course_id, recipient_user_id)",
    );
    expect(grantInsert.text).toContain("revision = uais_course_collaborator_grants.revision + 1");
    expect(fake.arrayCalls).toEqual([
      {
        values: ["course.grading.manage", "course.read"],
        type: 25,
      },
    ]);
    const mutationLocks = fake.queries[2];
    expect(mutationLocks.text).toContain(
      "pg_advisory_xact_lock(1430346060, hashtext(?))",
    );
    expect(mutationLocks.text).toContain(
      "pg_advisory_xact_lock(1430346061, hashtext(?))",
    );
    expect(mutationLocks.values).toEqual([
      "collaborator-grant-1",
      `course-research-methods:${ids.recipient}`,
    ]);
    const outboxInsert = fake.queries[7];
    expect(outboxInsert.text).toContain("'pending'");
    expect(outboxInsert.values).toContain("grant-issued");
    expect(outboxInsert.text).toContain("recipient_user_id");
    expect(outboxInsert.values).toContain(ids.recipient);
  });

  it("uses the submitted email only as a parameter of the identifier lookup", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("AS recipient_identifier_id") && text.includes("i.identifier =")) {
        return [recipientRow()];
      }
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        return [];
      }
      if (text.startsWith("INSERT INTO uais_course_collaborator_grants")) {
        return [grantRow()];
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    const receipt = await store.grant(grantInput());
    const emailQueries = fake.queries.filter((query) =>
      query.values.includes(normalizedEmail),
    );

    expect(emailQueries).toHaveLength(1);
    expect(emailQueries[0]?.text).toContain("FROM uais_user_login_identifiers i");
    expect(emailQueries[0]?.text).toContain("FOR SHARE OF i, recipient");
    for (const query of fake.queries) {
      expect(query.text.toLowerCase()).not.toContain(normalizedEmail);
      if (query !== emailQueries[0]) {
        expect(JSON.stringify(query.values).toLowerCase()).not.toContain(normalizedEmail);
      }
    }
    expect(JSON.stringify(receipt).toLowerCase()).not.toContain(normalizedEmail);
    expect(JSON.stringify(receipt)).not.toContain("@");
    expect(JSON.stringify(receipt)).not.toContain(ids.identifier);
  });

  it("checks canonical owner authority before looking up a recipient", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [];
      throw new Error("Recipient lookup must not run after an owner denial.");
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    await expect(store.grant(grantInput())).rejects.toMatchObject({
      status: 403,
      reasonCode: "course-owner-required",
    });
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0]?.text).toContain("ownerTeacherId");
    expect(fake.queries[0]?.text).toContain("FOR UPDATE OF snapshot");
    expect(fake.queries[0]?.text).toContain("FOR SHARE OF owner");
  });

  it("validates expiry against the post-lock grant timestamp", async () => {
    let clock = now;
    let grantWrites = 0;
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("FROM uais_user_login_identifiers i")) return [recipientRow()];
      if (text.includes("pg_advisory_xact_lock")) {
        clock = new Date("2026-08-25T12:00:00.000Z");
        return [];
      }
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        return [];
      }
      if (text.startsWith("INSERT INTO uais_course_collaborator_grants")) {
        grantWrites += 1;
        return [
          grantRow({
            expires_at: "2026-08-25T11:00:00.000Z",
          }),
        ];
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => clock,
    });

    await expect(
      store.grant(
        grantInput({
          expiresAt: "2026-08-25T11:00:00.000Z",
          idempotencyKey: "collaborator-grant-lock-expiry",
        }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      reasonCode: "expiry-must-follow-grant",
    });
    expect(grantWrites).toBe(0);
  });

  it.each([
    ["unknown", [], "recipient-unknown"],
    [
      "self",
      [recipientRow({ recipient_user_id: ids.owner, recipient_account: "teacher-kang" })],
      "recipient-self-denied",
    ],
    [
      "student",
      [recipientRow({ recipient_role: "student" })],
      "recipient-active-teacher-required",
    ],
    [
      "admin",
      [recipientRow({ recipient_role: "admin" })],
      "recipient-active-teacher-required",
    ],
    [
      "invited teacher",
      [recipientRow({ recipient_status: "invited" })],
      "recipient-active-teacher-required",
    ],
    [
      "disabled teacher",
      [recipientRow({ recipient_status: "disabled" })],
      "recipient-active-teacher-required",
    ],
  ] as const)("rejects an %s recipient without persisting", async (_label, rows, reasonCode) => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("FROM uais_user_login_identifiers i")) return [...rows];
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    await expect(store.grant(grantInput())).rejects.toMatchObject({
      status: reasonCode === "recipient-unknown" ? 404 : 409,
      reasonCode,
    });
    expect(
      fake.queries.some((query) =>
        query.text.startsWith("INSERT INTO uais_course_collaborator_grants"),
      ),
    ).toBe(false);
  });

  it("replays an exact idempotent request and conflicts on changed payload", async () => {
    let idempotency:
      | {
          actor_user_id: string;
          scope: string;
          request_hash: string;
          response_receipt: unknown;
        }
      | undefined;
    let grantWrites = 0;
    const fake = createFakeDatabase(({ text, values }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("FROM uais_user_login_identifiers i")) return [recipientRow()];
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) {
        return idempotency ? [idempotency] : [];
      }
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        return [];
      }
      if (text.startsWith("INSERT INTO uais_course_collaborator_grants")) {
        grantWrites += 1;
        return [grantRow()];
      }
      if (text.startsWith("INSERT INTO uais_idempotency_records")) {
        idempotency = {
          actor_user_id: String(values[1]),
          scope: String(values[2]),
          request_hash: String(values[3]),
          response_receipt: JSON.parse(String(values[5])),
        };
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    const created = await store.grant(grantInput());
    const replayed = await store.grant(grantInput());

    expect(replayed).toEqual(created);
    expect(grantWrites).toBe(1);
    await expect(
      store.grant(
        grantInput({ role: "observer", scopes: ["course.read"] }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      reasonCode: "idempotency-key-payload-mismatch",
    });
    expect(grantWrites).toBe(1);
  });

  it("replays an exact persisted request after its requested expiry", async () => {
    let clock = now;
    let idempotency:
      | {
          actor_user_id: string;
          scope: string;
          request_hash: string;
          response_receipt: unknown;
        }
      | undefined;
    let grantWrites = 0;
    const fake = createFakeDatabase(({ text, values }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("FROM uais_user_login_identifiers i")) return [recipientRow()];
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) {
        return idempotency ? [idempotency] : [];
      }
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        return [];
      }
      if (text.startsWith("INSERT INTO uais_course_collaborator_grants")) {
        grantWrites += 1;
        return [grantRow({ expires_at: "2026-08-25T11:00:00.000Z" })];
      }
      if (text.startsWith("INSERT INTO uais_idempotency_records")) {
        idempotency = {
          actor_user_id: String(values[1]),
          scope: String(values[2]),
          request_hash: String(values[3]),
          response_receipt: JSON.parse(String(values[5])),
        };
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => clock,
    });
    const request = grantInput({
      expiresAt: "2026-08-25T11:00:00.000Z",
      idempotencyKey: "collaborator-grant-expired-replay",
    });

    const created = await store.grant(request);
    clock = new Date("2026-08-25T12:00:00.000Z");

    await expect(store.grant(request)).resolves.toEqual(created);
    expect(grantWrites).toBe(1);
  });

  it("replays an exact persisted request after the recipient becomes disabled", async () => {
    let recipientStatus: "active" | "disabled" = "active";
    let idempotency:
      | {
          actor_user_id: string;
          scope: string;
          request_hash: string;
          response_receipt: unknown;
        }
      | undefined;
    let grantWrites = 0;
    const fake = createFakeDatabase(({ text, values }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("FROM uais_user_login_identifiers i")) {
        return [recipientRow({ recipient_status: recipientStatus })];
      }
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) {
        return idempotency ? [idempotency] : [];
      }
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        return [];
      }
      if (text.startsWith("INSERT INTO uais_course_collaborator_grants")) {
        grantWrites += 1;
        return [grantRow()];
      }
      if (text.startsWith("INSERT INTO uais_idempotency_records")) {
        idempotency = {
          actor_user_id: String(values[1]),
          scope: String(values[2]),
          request_hash: String(values[3]),
          response_receipt: JSON.parse(String(values[5])),
        };
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });
    const request = grantInput({
      idempotencyKey: "collaborator-grant-disabled-replay",
    });

    const created = await store.grant(request);
    recipientStatus = "disabled";

    await expect(store.grant(request)).resolves.toEqual(created);
    expect(grantWrites).toBe(1);
  });

  it("returns already-active for an identical new-key request without a second grant, audit or outbox", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("FROM uais_user_login_identifiers i")) return [recipientRow()];
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        return [grantRow()];
      }
      if (text.startsWith("INSERT INTO uais_idempotency_records")) return [];
      throw new Error(`Unexpected active-grant SQL: ${text}`);
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    const receipt = await store.grant(
      grantInput({ idempotencyKey: "collaborator-grant-new-key" }),
    );

    expect(receipt).toMatchObject({
      status: "already-active",
      grantId: ids.grant,
      grantStatus: "active",
      revision: 1,
    });
    expect(JSON.stringify(receipt)).not.toContain(ids.identifier);
    expect(
      fake.queries.filter((query) =>
        query.text.startsWith("INSERT INTO uais_idempotency_records"),
      ),
    ).toHaveLength(1);
    expect(
      fake.queries.some(
        (query) =>
          query.text.startsWith("INSERT INTO uais_course_collaborator_grants") ||
          query.text.startsWith("INSERT INTO uais_audit_log") ||
          query.text.startsWith("INSERT INTO uais_course_collaborator_notification_outbox"),
      ),
    ).toBe(false);
  });

  it("does not adopt a former owner's active grant as already-active", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("FROM uais_user_login_identifiers i")) return [recipientRow()];
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        return [grantRow({ granted_by_user_id: ids.otherRecipient })];
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    await expect(
      store.grant(
        grantInput({ idempotencyKey: "collaborator-grant-former-owner" }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      reasonCode: "active-grant-change-requires-revoke",
    });
    expect(
      fake.queries.some((query) =>
        query.text.startsWith("INSERT INTO uais_idempotency_records"),
      ),
    ).toBe(false);
  });

  it.each([
    [
      "role",
      grantInput({ role: "observer", scopes: ["course.read"], idempotencyKey: "active-role-change" }),
      recipientRow(),
    ],
    [
      "scopes",
      grantInput({ scopes: ["course.read"], idempotencyKey: "active-scope-change" }),
      recipientRow(),
    ],
    [
      "expiry",
      grantInput({ expiresAt: "2026-10-25T10:00:00.000Z", idempotencyKey: "active-expiry-change" }),
      recipientRow(),
    ],
    [
      "registered identifier alias",
      grantInput({ recipientEmail: "teacher.alias@example.test", idempotencyKey: "active-alias-change" }),
      recipientRow({
        recipient_identifier_id: "77777777-7777-4777-8777-777777777777",
      }),
    ],
  ])("conflicts instead of silently changing an active grant's %s", async (_label, request, recipient) => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("FROM uais_user_login_identifiers i")) return [recipient];
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        return [grantRow()];
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    await expect(store.grant(request)).rejects.toMatchObject({
      status: 409,
      reasonCode: "active-grant-change-requires-revoke",
    });
    expect(
      fake.queries.some(
        (query) =>
          query.text.startsWith("INSERT INTO uais_course_collaborator_grants") ||
          query.text.startsWith("INSERT INTO uais_audit_log") ||
          query.text.startsWith("INSERT INTO uais_course_collaborator_notification_outbox"),
      ),
    ).toBe(false);
  });

  it.each([
    {
      lifecycle: "revoked",
      previousRevision: 2,
      existing: grantRow({
        revision: 2,
        revoked_at: "2026-08-25T09:30:00.000Z",
        revoked_by_user_id: ids.owner,
      }),
    },
    {
      lifecycle: "expired",
      previousRevision: 7,
      existing: grantRow({
        revision: 7,
        granted_at: "2026-08-24T10:00:00.000Z",
        expires_at: "2026-08-25T09:59:59.999Z",
      }),
    },
  ])(
    "regrants a canonical $lifecycle row at revision N+1 with one issued side-effect set",
    async ({ lifecycle, previousRevision, existing }) => {
      const fake = createFakeDatabase(({ text }) => {
        if (text.includes("AS owner_user_id")) return [ownerRow()];
        if (text.includes("FROM uais_user_login_identifiers i")) {
          return [recipientRow()];
        }
        if (text.includes("pg_advisory_xact_lock")) return [];
        if (text.includes("FROM uais_idempotency_records")) return [];
        if (
          text.includes("FROM uais_course_collaborator_grants") &&
          text.includes("FOR UPDATE")
        ) {
          return [existing];
        }
        if (text.startsWith("INSERT INTO uais_course_collaborator_grants")) {
          return [
            grantRow({
              revision: previousRevision + 1,
              revoked_at: null,
              revoked_by_user_id: null,
            }),
          ];
        }
        return [];
      });
      const store = createTeachingCourseCollaboratorPostgresStore({
        env: {},
        createDatabase: fake.factory,
        now: () => now,
      });

      const receipt = await store.grant(
        grantInput({
          idempotencyKey: `collaborator-regrant-${lifecycle}`,
        }),
      );

      expect(receipt).toMatchObject({
        status: "persisted",
        event: "grant-issued",
        revision: previousRevision + 1,
        grantStatus: "active",
      });
      expect(receipt).not.toHaveProperty("revokedAt");
      const grantWrites = fake.queries.filter((query) =>
        query.text.startsWith("INSERT INTO uais_course_collaborator_grants"),
      );
      expect(grantWrites).toHaveLength(1);
      expect(grantWrites[0]?.text).toContain("revoked_at = NULL");
      expect(grantWrites[0]?.text).toContain("revoked_by_user_id = NULL");
      expect(
        fake.queries.filter((query) =>
          query.text.startsWith("INSERT INTO uais_audit_log"),
        ),
      ).toHaveLength(1);
      const outboxWrites = fake.queries.filter((query) =>
        query.text.startsWith(
          "INSERT INTO uais_course_collaborator_notification_outbox",
        ),
      );
      expect(outboxWrites).toHaveLength(1);
      expect(outboxWrites[0]?.values).toContain("grant-issued");
      expect(
        fake.queries.filter((query) =>
          query.text.startsWith("INSERT INTO uais_idempotency_records"),
        ),
      ).toHaveLength(1);
    },
  );

  it("reads and lists canonical rows while reporting expiry and revocation inactive", async () => {
    const expired = grantRow({
      recipient_identifier_id: null,
      granted_at: "2026-08-24T10:00:00.000Z",
      expires_at: "2026-08-25T09:59:59.999Z",
    });
    const revoked = grantRow({
      id: "66666666-6666-4666-8666-666666666666",
      recipient_user_id: ids.otherRecipient,
      revision: 2,
      revoked_at: "2026-08-25T09:30:00.000Z",
      revoked_by_user_id: ids.owner,
    });
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("recipient_user_id =") && text.includes("FROM uais_course_collaborator_grants")) {
        return [expired];
      }
      if (text.includes("ORDER BY") && text.includes("FROM uais_course_collaborator_grants")) {
        return [expired, revoked];
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    await expect(
      store.read({
        actorAccount: "teacher-kang",
        courseId: "course-research-methods",
        recipientUserId: ids.recipient,
      }),
    ).resolves.toMatchObject({ grantId: ids.grant, status: "expired" });
    await expect(
      store.list({
        actorAccount: "teacher-kang",
        courseId: "course-research-methods",
      }),
    ).resolves.toMatchObject([
      { grantId: ids.grant, status: "expired" },
      {
        grantId: "66666666-6666-4666-8666-666666666666",
        status: "revoked",
      },
    ]);
  });

  it("replays an exact same-key revoke receipt without repeating side effects", async () => {
    let row = grantRow();
    let idempotency:
      | {
          actor_user_id: string;
          scope: string;
          request_hash: string;
          response_receipt: unknown;
        }
      | undefined;
    const fake = createFakeDatabase(({ text, values }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) {
        return idempotency ? [idempotency] : [];
      }
      if (
        text.includes("FROM uais_course_collaborator_grants") &&
        text.includes("FOR UPDATE")
      ) {
        return [row];
      }
      if (text.startsWith("UPDATE uais_course_collaborator_grants")) {
        row = grantRow({
          revision: 2,
          revoked_at: now.toISOString(),
          revoked_by_user_id: ids.owner,
        });
        return [row];
      }
      if (text.startsWith("INSERT INTO uais_idempotency_records")) {
        idempotency = {
          actor_user_id: String(values[1]),
          scope: String(values[2]),
          request_hash: String(values[3]),
          response_receipt: JSON.parse(String(values[5])),
        };
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    const request = {
      actorAccount: "teacher-kang",
      courseId: "course-research-methods",
      grantId: ids.grant,
      idempotencyKey: "collaborator-revoke-1",
      traceId: "trace-collaborator-revoke-1",
    };

    const receipt = await store.revoke(request);
    const replayed = await store.revoke(request);

    expect(replayed).toEqual(receipt);
    expect(idempotency?.response_receipt).toEqual(receipt);
    expect(receipt).toMatchObject({
      event: "grant-revoked",
      grantStatus: "revoked",
      revision: 2,
      revokedAt: now.toISOString(),
    });
    expect(
      fake.queries.filter((query) =>
        query.text.startsWith("UPDATE uais_course_collaborator_grants"),
      ),
    ).toHaveLength(1);
    expect(
      fake.queries.filter((query) =>
        query.text.startsWith("INSERT INTO uais_audit_log"),
      ),
    ).toHaveLength(1);
    const outboxWrites = fake.queries.filter((query) =>
      query.text.startsWith(
        "INSERT INTO uais_course_collaborator_notification_outbox",
      ),
    );
    expect(outboxWrites).toHaveLength(1);
    expect(outboxWrites[0]?.values).toContain("grant-revoked");
    expect(
      fake.queries.filter((query) =>
        query.text.startsWith("INSERT INTO uais_idempotency_records"),
      ),
    ).toHaveLength(1);
  });

  it("rejects a different-key revoke after the canonical row is revoked", async () => {
    let row = grantRow();
    let updates = 0;
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (
        text.includes("FROM uais_course_collaborator_grants") &&
        text.includes("FOR UPDATE")
      ) {
        return [row];
      }
      if (text.startsWith("UPDATE uais_course_collaborator_grants")) {
        updates += 1;
        row = grantRow({
          revision: 2,
          revoked_at: now.toISOString(),
          revoked_by_user_id: ids.owner,
        });
        return [row];
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    await store.revoke({
      actorAccount: "teacher-kang",
      courseId: "course-research-methods",
      grantId: ids.grant,
      idempotencyKey: "collaborator-revoke-first-key",
      traceId: "trace-collaborator-revoke-first-key",
    });

    await expect(
      store.revoke({
        actorAccount: "teacher-kang",
        courseId: "course-research-methods",
        grantId: ids.grant,
        idempotencyKey: "collaborator-revoke-2",
        traceId: "trace-collaborator-revoke-2",
      }),
    ).rejects.toMatchObject({
      status: 409,
      reasonCode: "grant-already-revoked",
    });
    expect(updates).toBe(1);
  });

  it("can revoke safely after the selected login identifier is erased", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        return [grantRow({ recipient_identifier_id: null })];
      }
      if (text.startsWith("UPDATE uais_course_collaborator_grants")) {
        return [
          grantRow({
            recipient_identifier_id: null,
            revision: 2,
            revoked_at: now.toISOString(),
            revoked_by_user_id: ids.owner,
          }),
        ];
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    const receipt = await store.revoke({
      actorAccount: "teacher-kang",
      courseId: "course-research-methods",
      grantId: ids.grant,
      idempotencyKey: "collaborator-revoke-redacted-identifier",
      traceId: "trace-collaborator-revoke-redacted-identifier",
    });

    expect(receipt).toMatchObject({
      event: "grant-revoked",
      grantStatus: "revoked",
      revision: 2,
    });
    expect(JSON.stringify(receipt)).not.toContain(ids.identifier);
    const outbox = fake.queries.find((query) =>
      query.text.startsWith(
        "INSERT INTO uais_course_collaborator_notification_outbox",
      ),
    );
    expect(outbox?.values).toContain(null);
  });

  it("records revocation time only after acquiring the grant row lock", async () => {
    let clock = now;
    let writtenRevokedAt: string | undefined;
    const fake = createFakeDatabase(({ text, values }) => {
      if (text.includes("AS owner_user_id")) return [ownerRow()];
      if (text.includes("pg_advisory_xact_lock")) return [];
      if (text.includes("FROM uais_idempotency_records")) return [];
      if (text.includes("FROM uais_course_collaborator_grants") && text.includes("FOR UPDATE")) {
        clock = new Date("2026-08-25T12:00:00.000Z");
        return [
          grantRow({
            granted_at: "2026-08-25T11:00:00.000Z",
            expires_at: "2026-08-25T13:00:00.000Z",
          }),
        ];
      }
      if (text.startsWith("UPDATE uais_course_collaborator_grants")) {
        writtenRevokedAt = String(values[0]);
        return [
          grantRow({
            revision: 2,
            granted_at: "2026-08-25T11:00:00.000Z",
            expires_at: "2026-08-25T13:00:00.000Z",
            revoked_at: writtenRevokedAt,
            revoked_by_user_id: ids.owner,
          }),
        ];
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => clock,
    });

    const receipt = await store.revoke({
      actorAccount: "teacher-kang",
      courseId: "course-research-methods",
      grantId: ids.grant,
      idempotencyKey: "collaborator-revoke-post-lock-clock",
      traceId: "trace-collaborator-revoke-post-lock-clock",
    });

    expect(writtenRevokedAt).toBe("2026-08-25T12:00:00.000Z");
    expect(receipt.revokedAt).toBe("2026-08-25T12:00:00.000Z");
  });

  it("reads a safe capability context and applies exact-scope authorization", async () => {
    const fake = createFakeDatabase(({ text }) => {
      if (text.includes("AS principal_user_id") && text.includes("LEFT JOIN uais_course_collaborator_grants")) {
        return [
          {
            principal_user_id: ids.recipient,
            principal_account: "teacher-lin",
            principal_role: "teacher",
            principal_status: "active",
            owner_user_id: ids.owner,
            ...grantRow(),
          },
        ];
      }
      return [];
    });
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    await expect(
      store.readCapability({
        principalAccount: "teacher-lin",
        courseId: "course-research-methods",
        capability: "course.grading.manage",
      }),
    ).resolves.toMatchObject({
      authorized: true,
      reasonCode: "collaborator-exact-scope",
      grantId: ids.grant,
    });
    const query = fake.queries[0];
    expect(query.text).toContain("FROM uais_users principal");
    expect(query.text).toContain("uais_teaching_course_management_snapshots snapshot");
    expect(query.text).toContain("LEFT JOIN uais_course_collaborator_grants");
    expect(query.text).toContain("owner.role = 'teacher'");
    expect(query.text).toContain("owner.status = 'active'");
    expect(query.values).toEqual([
      "teacher-lin",
      "course-research-methods",
      "course-research-methods",
    ]);
  });

  it("denies capability readback when the canonical owner principal is missing", async () => {
    const fake = createFakeDatabase(({ text }) =>
      text.includes("AS principal_user_id")
        ? [
            {
              principal_user_id: ids.recipient,
              principal_account: "teacher-lin",
              principal_role: "teacher",
              principal_status: "active",
              owner_user_id: null,
              ...grantRow(),
            },
          ]
        : [],
    );
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    await expect(
      store.readCapability({
        principalAccount: "teacher-lin",
        courseId: "course-research-methods",
        capability: "course.grading.manage",
      }),
    ).resolves.toEqual({
      authorized: false,
      reasonCode: "canonical-course-required",
    });
  });

  it("denies a grant issued by a former canonical owner", async () => {
    const fake = createFakeDatabase(({ text }) =>
      text.includes("AS principal_user_id")
        ? [
            {
              principal_user_id: ids.recipient,
              principal_account: "teacher-lin",
              principal_role: "teacher",
              principal_status: "active",
              owner_user_id: ids.otherRecipient,
              ...grantRow(),
            },
          ]
        : [],
    );
    const store = createTeachingCourseCollaboratorPostgresStore({
      env: {},
      createDatabase: fake.factory,
      now: () => now,
    });

    await expect(
      store.readCapability({
        principalAccount: "teacher-lin",
        courseId: "course-research-methods",
        capability: "course.grading.manage",
      }),
    ).resolves.toEqual({
      authorized: false,
      reasonCode: "collaborator-grant-mismatch",
    });
  });

  it("requires managed Postgres only when no injected SQL client is supplied", () => {
    expect(() =>
      createTeachingCourseCollaboratorPostgresStore({ env: {} }),
    ).toThrowError(
      expect.objectContaining<TeachingCourseCollaboratorStoreError>({
        status: 503,
        reasonCode: "core-database-required",
      }),
    );
  });
});
