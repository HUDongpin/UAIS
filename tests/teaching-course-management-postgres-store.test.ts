import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UAIS_CORE_DATABASE_MIGRATION_VERSIONS } from "@/lib/db/migrations";
import {
  backfillTeachingCourseManagementToPostgres,
  verifyTeachingCourseManagementParity,
} from "@/lib/server/teaching-course-management-cutover";
import { createUaisTeachingCourseManagementPostgresRepository } from "@/lib/server/teaching-course-management-postgres-store";
import {
  listTeachingCourseManagementCourseIds,
  mergeTeachingCourseManagementCourseDatabases,
  partitionTeachingCourseManagementDatabaseByCourse,
  selectTeachingClassInviteCodeClaims,
  selectTeachingCourseManagementCourseDatabase,
} from "@/lib/server/teaching-course-management-course-partition";
import { normalizeTeachingCourseManagementDatabase } from "@/lib/server/teaching-course-management-store";
import type {
  TeachingCourseManagementDatabase,
  TeachingCourseManagementRepository,
} from "@/lib/server/teaching-course-management-types";

// The per-course re-key is what takes course management off the single 'default'
// row that 0004 warns against, so it cannot be shipped as code that merely
// compiles. These assertions drive the real repository with an injected client
// that records every statement, which proves the parts a type-checker cannot:
// that a course's own row is addressed, that the snapshot is sent as text and
// cast server-side, that the revision guard takes FOR UPDATE before it decides,
// that two courses writing at the same moment neither lock nor conflict with
// each other, that the retired key is never named again - and that the one
// invariant a per-course row cannot hold, the deployment-wide invite-code
// namespace, is still enforced.
//
// What this does NOT prove is Postgres's own behaviour. That is exercised by
// `npm run db:migrate` at deploy time, by the first real write, and by
// tests/teaching-course-management-postgres-integration.test.ts when a database
// url is present.

const env = { UAIS_CORE_DATABASE_URL: "postgres://user:pass@db.example.com/uais" };

const courseOneId = "teacher-course-research-methods-20260816-090000";
const courseTwoId = "teacher-course-elementary-math-20260816-090000";

type RecordedQuery = { text: string; values: unknown[] };

function createRecordingClient(options: { rows?: unknown[][] } = {}) {
  const queries: RecordedQuery[] = [];
  const rowQueue = [...(options.rows ?? [])];
  let ended = 0;
  let transactions = 0;

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(rowQueue.shift() ?? []);
  }) as never as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    begin: (run: (sql: never) => Promise<void>) => Promise<void>;
    end: (options?: { timeout?: number }) => Promise<void>;
  };

  sql.begin = async (run) => {
    transactions += 1;
    await run(sql as never);
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
    get transactions() {
      return transactions;
    },
  };
}

// A keyed double that answers the statements the store issues against real
// tables of rows, including the ON CONFLICT ... WHERE guards on both the course
// row and the invite-code claim. A canned queue cannot express the thing under
// test here - that one course's row is untouched by another course's write -
// because that is a property of the KEY, not of the order the statements arrive
// in.
function createCourseAwareClient() {
  const rows = new Map<string, { database: unknown; revision: string }>();
  const claims = new Map<string, { courseId: string; classId: string }>();
  const queries: RecordedQuery[] = [];

  const execute = (strings: TemplateStringsArray, values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });

    if (text.startsWith("SELECT database, revision")) {
      const row = rows.get(String(values[0]));
      return row ? [{ database: row.database, revision: row.revision }] : [];
    }
    if (text.startsWith("SELECT database FROM")) {
      return [...rows.keys()].sort().map((key) => ({ database: rows.get(key)?.database }));
    }
    if (text.startsWith("SELECT revision")) {
      const row = rows.get(String(values[0]));
      return row ? [{ revision: row.revision }] : [];
    }
    if (text.startsWith("DELETE FROM uais_teaching_class_invite_code_claims")) {
      const [courseId, claimsJson] = values;
      const kept = new Set(
        (JSON.parse(String(claimsJson)) as Array<{ inviteCode: string }>).map(
          (claim) => claim.inviteCode,
        ),
      );
      for (const [inviteCode, claim] of [...claims]) {
        if (claim.courseId === String(courseId) && !kept.has(inviteCode)) {
          claims.delete(inviteCode);
        }
      }
      return [];
    }
    if (text.startsWith("INSERT INTO uais_teaching_class_invite_code_claims")) {
      const [courseId, claimsJson] = values;
      const applied: Array<{ invite_code: string }> = [];
      for (const claim of JSON.parse(String(claimsJson)) as Array<{
        inviteCode: string;
        classId: string;
      }>) {
        const existing = claims.get(claim.inviteCode);
        // `DO UPDATE ... WHERE claims.course_id = $courseId`: a code another
        // course already holds is skipped, and its absence from RETURNING is how
        // the store learns the namespace collided.
        if (existing && existing.courseId !== String(courseId)) {
          continue;
        }
        claims.set(claim.inviteCode, {
          courseId: String(courseId),
          classId: claim.classId,
        });
        applied.push({ invite_code: claim.inviteCode });
      }
      return applied;
    }
    if (text.startsWith("INSERT INTO uais_teaching_course_management_snapshots")) {
      const [key, database, revision, expectedRevision] = values;
      const existing = rows.get(String(key));
      // `DO UPDATE ... WHERE revision IS NOT DISTINCT FROM $4`: an existing row
      // is replaced only when its revision is the one the writer read, and a
      // writer that read nothing expects null.
      if (existing && existing.revision !== (expectedRevision ?? null)) {
        return [];
      }
      rows.set(String(key), {
        database: JSON.parse(String(database)),
        revision: String(revision),
      });
      return [{ snapshot_key: key }];
    }
    return [];
  };

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve(execute(strings, values))) as never as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    begin: (run: (sql: never) => Promise<void>) => Promise<void>;
    end: (options?: { timeout?: number }) => Promise<void>;
  };

  sql.begin = async (run) => {
    await run(sql as never);
  };
  sql.end = async () => {};

  return {
    factory: () => ({ sql }),
    queries,
    claims,
    rowKeys: () => [...rows.keys()].sort(),
    databaseFor: (key: string) =>
      rows.get(key)?.database as TeachingCourseManagementDatabase | undefined,
    statements: (prefix: string) =>
      queries.filter((query) => query.text.startsWith(prefix)),
  };
}

function createEmptyDatabaseFixture(): TeachingCourseManagementDatabase {
  return normalizeTeachingCourseManagementDatabase({
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    courses: [],
    classes: [],
    memberships: [],
    auditEvents: [],
  });
}

function createCourseFixture(input: {
  courseId: string;
  courseName: string;
  updatedAt: string;
  invitationCode?: string;
}): TeachingCourseManagementDatabase {
  return normalizeTeachingCourseManagementDatabase({
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: input.updatedAt,
    courses: [
      {
        courseId: input.courseId,
        ownerTeacherId: "teacher-kang",
        courseName: input.courseName,
        instructor: "Kang Xia",
        unit: "Guangzhou University 404",
        department: "Experimental Teaching Center",
        semester: "2026 Spring",
        status: "draft",
        students: 0,
        createdAt: input.updatedAt,
        updatedAt: input.updatedAt,
        storagePolicy: "postgres-teaching-course-management-snapshot",
        storageWritePolicy: "postgres-transactional-snapshot-replace",
      },
    ],
    classes: input.invitationCode
      ? [
          {
            classId: `${input.courseId}-class-1`,
            courseId: input.courseId,
            ownerTeacherId: "teacher-kang",
            className: "Class One",
            students: 0,
            semester: "2026 Spring",
            invitationCode: input.invitationCode,
            joinUrl: `/courses?invite=${input.invitationCode}`,
            createdAt: input.updatedAt,
            updatedAt: input.updatedAt,
            storagePolicy: "postgres-teaching-course-management-snapshot",
            storageWritePolicy: "postgres-transactional-snapshot-replace",
          },
        ]
      : [],
    memberships: [],
    auditEvents: [
      {
        auditId: `audit-create-course-${input.courseId}`,
        action: "create-course",
        actorId: "teacher-kang",
        courseId: input.courseId,
        traceId: `trace-${input.courseId}`,
        actorRole: "teacher",
        authMode: "signed-teacher-session",
        createdAt: input.updatedAt,
        requestSource: { userAgent: "test", ipAddress: "redacted" },
        storagePolicy: "postgres-teaching-course-management-audit-log",
      },
    ],
  });
}

// A whole-deployment corpus: two courses interleaved in one envelope, which is
// the shape the JSON file the cutover reads still has.
function createCorpusFixture(): TeachingCourseManagementDatabase {
  const one = createCourseFixture({
    courseId: courseOneId,
    courseName: "Research Methods",
    updatedAt: "2026-08-16T09:00:00.000Z",
    invitationCode: "55395057",
  });
  const two = createCourseFixture({
    courseId: courseTwoId,
    courseName: "Elementary Math",
    updatedAt: "2026-08-16T09:00:02.000Z",
    invitationCode: "55395058",
  });
  return normalizeTeachingCourseManagementDatabase({
    ...one,
    updatedAt: two.updatedAt,
    courses: [...one.courses, ...two.courses],
    classes: [...one.classes, ...two.classes],
    auditEvents: [...one.auditEvents, ...two.auditEvents],
  });
}

// The read-modify-write the handlers perform, reduced to what the store sees:
// read the course's row, add this course's records, write it back under the
// revision that read returned.
async function writeCourse(
  repository: TeachingCourseManagementRepository,
  database: TeachingCourseManagementDatabase,
  courseId: string,
) {
  const snapshot = await repository.read({ courseId });
  await repository.write({
    database: {
      ...database,
      courses: [...snapshot.database.courses, ...database.courses],
      classes: [...snapshot.database.classes, ...database.classes],
      auditEvents: [...snapshot.database.auditEvents, ...database.auditEvents],
    },
    courseId,
    ...(snapshot.revision ? { expectedRevision: snapshot.revision } : {}),
  });
}

describe("teaching course management postgres store", () => {
  it("returns an empty database when the course's row does not exist yet", async () => {
    const client = createRecordingClient({ rows: [[]] });
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    const snapshot = await repository.read({ courseId: courseOneId });

    expect(snapshot.database).toEqual(createEmptyDatabaseFixture());
    // No revision on an absent row: the first write must not be told it is
    // replacing something.
    expect(snapshot.revision).toBeUndefined();
    expect(client.queries[0].text).toContain("uais_teaching_course_management_snapshots");
    // The read fetches ONE course, by its own key.
    expect(client.queries[0].text).toContain("WHERE snapshot_key = ?");
    expect(client.queries[0].values).toEqual([courseOneId]);
    expect(client.ended).toBe(1);
  });

  it("normalizes a stored snapshot and carries its revision forward", async () => {
    const client = createRecordingClient({
      rows: [
        [
          {
            database: createCourseFixture({
              courseId: courseOneId,
              courseName: "Research Methods",
              updatedAt: "2026-08-16T10:00:00.000Z",
            }),
            revision: "  rev-abc  ",
          },
        ],
      ],
    });
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    const snapshot = await repository.read({ courseId: courseOneId });

    expect(snapshot.database.schemaVersion).toBe("uais-teaching-course-management-v1");
    expect(snapshot.database.courses[0]?.courseId).toBe(courseOneId);
    expect(snapshot.revision).toBe("rev-abc");
  });

  it("writes the course's row as text cast to jsonb, inside a transaction", async () => {
    const client = createRecordingClient({
      rows: [[], [{ snapshot_key: courseOneId }], [], []],
    });
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await repository.write({
      database: createEmptyDatabaseFixture(),
      courseId: courseOneId,
    });

    expect(client.transactions).toBe(1);
    const select = client.queries[0];
    const insert = client.queries[1];
    // The guard reads FOR UPDATE first so a concurrent writer cannot slip
    // between the check and the replace - and it locks this course's row only.
    expect(select.text).toContain("FOR UPDATE");
    expect(select.values).toEqual([courseOneId]);
    expect(insert.text).toContain("INSERT INTO uais_teaching_course_management_snapshots");
    expect(insert.text).toContain("ON CONFLICT");
    // The cast is the fix for postgres v3.4.9 sending an object parameter
    // unserialized inside a transaction; losing it breaks every write.
    expect(insert.text).toContain("::text::jsonb");
    expect(insert.values[0]).toBe(courseOneId);
    expect(typeof insert.values[1]).toBe("string");
    expect(client.ended).toBe(1);
  });

  it("refuses to replace a snapshot that moved under it", async () => {
    const client = createRecordingClient({ rows: [[{ revision: "rev-current" }]] });
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await expect(
      repository.write({
        database: createEmptyDatabaseFixture(),
        courseId: courseOneId,
        expectedRevision: "rev-stale",
      }),
    ).rejects.toThrow(/retry required/);

    // The conflict is detected before any write is issued, and the connection
    // is still closed.
    expect(client.queries.some((query) => query.text.includes("INSERT"))).toBe(false);
    expect(client.ended).toBe(1);
  });

  it("refuses to replace a course that appeared while it was reading", async () => {
    // The window FOR UPDATE cannot close: a lock on a row that does not exist
    // locks nothing, so two requests creating the same course both see nothing.
    // The conflict guard on the INSERT path is what makes the loser retry
    // instead of overwriting the winner's first record.
    const client = createRecordingClient({ rows: [[], []] });
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await expect(
      repository.write({
        database: createEmptyDatabaseFixture(),
        courseId: courseOneId,
      }),
    ).rejects.toThrow(/retry required/);
    expect(client.ended).toBe(1);
  });

  it("never names the retired 'default' row", async () => {
    const client = createCourseAwareClient();
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await repository.read({ courseId: courseOneId });
    await repository.write({
      database: createEmptyDatabaseFixture(),
      courseId: courseOneId,
    });
    await repository.read();

    expect(client.queries.length).toBeGreaterThan(0);
    for (const query of client.queries) {
      expect(query.values).not.toContain("default");
      expect(query.text).not.toContain("'default'");
    }
  });

  it("keeps two courses writing at the same time out of each other's way", async () => {
    const client = createCourseAwareClient();
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await Promise.all([
      writeCourse(
        repository,
        createCourseFixture({
          courseId: courseOneId,
          courseName: "Research Methods",
          updatedAt: "2026-08-16T09:00:00.000Z",
        }),
        courseOneId,
      ),
      writeCourse(
        repository,
        createCourseFixture({
          courseId: courseTwoId,
          courseName: "Elementary Math",
          updatedAt: "2026-08-16T09:00:02.000Z",
        }),
        courseTwoId,
      ),
    ]);

    // One row each, and exactly one snapshot INSERT each: neither write was made
    // to retry, which is the whole point of the re-key. Under the single
    // 'default' row these two writers shared a lock and a revision.
    expect(client.rowKeys()).toEqual([courseOneId, courseTwoId].sort());
    expect(
      client.statements("INSERT INTO uais_teaching_course_management_snapshots"),
    ).toHaveLength(2);
    // A course's row carries that course only - records AND audit events.
    expect(client.databaseFor(courseOneId)?.courses.map((course) => course.courseId)).toEqual([
      courseOneId,
    ]);
    expect(
      client.databaseFor(courseOneId)?.auditEvents.map((event) => event.courseId),
    ).toEqual([courseOneId]);
    expect(client.databaseFor(courseTwoId)?.courses.map((course) => course.courseId)).toEqual([
      courseTwoId,
    ]);
  });

  it("still answers a corpus-wide read by enumerating the courses", async () => {
    const client = createCourseAwareClient();
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });
    await writeCourse(
      repository,
      createCourseFixture({
        courseId: courseOneId,
        courseName: "Research Methods",
        updatedAt: "2026-08-16T09:00:00.000Z",
      }),
      courseOneId,
    );
    await writeCourse(
      repository,
      createCourseFixture({
        courseId: courseTwoId,
        courseName: "Elementary Math",
        updatedAt: "2026-08-16T09:00:02.000Z",
      }),
      courseTwoId,
    );

    const snapshot = await repository.read();

    expect(snapshot.database.courses.map((course) => course.courseId).sort()).toEqual(
      [courseOneId, courseTwoId].sort(),
    );
    expect(snapshot.database.auditEvents).toHaveLength(2);
    // No single row backs a corpus read, so it carries no revision for an
    // optimistic guard to be about.
    expect(snapshot.revision).toBeUndefined();
    expect(snapshot.database.updatedAt).toBe("2026-08-16T09:00:02.000Z");
  });

  it("refuses a corpus-wide write", async () => {
    const client = createCourseAwareClient();
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await expect(
      repository.write({ database: createEmptyDatabaseFixture() }),
    ).rejects.toThrow(/require a course id/);
    expect(client.statements("INSERT INTO uais_teaching_course_management_snapshots")).toHaveLength(
      0,
    );
  });

  it("requires a core database url", () => {
    expect(() => createUaisTeachingCourseManagementPostgresRepository({ env: {} })).toThrow(
      /UAIS_CORE_DATABASE_URL/,
    );
  });
});

// Invite codes are the one thing in this envelope that is NOT per course: a
// student joins with the bare 8 digits and no course context, so the per-course
// rows cannot hold the uniqueness rule on their own.
describe("teaching course management postgres invite-code claims", () => {
  it("claims a course's codes alongside its row", async () => {
    const client = createCourseAwareClient();
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await writeCourse(
      repository,
      createCourseFixture({
        courseId: courseOneId,
        courseName: "Research Methods",
        updatedAt: "2026-08-16T09:00:00.000Z",
        invitationCode: "55395057",
      }),
      courseOneId,
    );

    expect(client.claims.get("55395057")).toEqual({
      courseId: courseOneId,
      classId: `${courseOneId}-class-1`,
    });
  });

  it("refuses a code another course already holds, and leaves nothing claimed", async () => {
    const client = createCourseAwareClient();
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await writeCourse(
      repository,
      createCourseFixture({
        courseId: courseOneId,
        courseName: "Research Methods",
        updatedAt: "2026-08-16T09:00:00.000Z",
        invitationCode: "55395057",
      }),
      courseOneId,
    );

    // The second course allocated the same code from a corpus read that had not
    // yet seen the first course's write. Under the single 'default' row this was
    // impossible; the claims table is what keeps it impossible now.
    await expect(
      writeCourse(
        repository,
        createCourseFixture({
          courseId: courseTwoId,
          courseName: "Elementary Math",
          updatedAt: "2026-08-16T09:00:02.000Z",
          invitationCode: "55395057",
        }),
        courseTwoId,
      ),
    ).rejects.toThrow(/invite code already exists/);

    // The code still belongs to whoever won it, so the join route cannot be
    // pointed at the wrong course.
    expect(client.claims.get("55395057")?.courseId).toBe(courseOneId);
  });

  it("releases a code the course no longer holds", async () => {
    const client = createCourseAwareClient();
    const repository = createUaisTeachingCourseManagementPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await writeCourse(
      repository,
      createCourseFixture({
        courseId: courseOneId,
        courseName: "Research Methods",
        updatedAt: "2026-08-16T09:00:00.000Z",
        invitationCode: "55395057",
      }),
      courseOneId,
    );
    expect(client.claims.has("55395057")).toBe(true);

    // A rolled-back course creation writes an envelope with no classes left.
    const snapshot = await repository.read({ courseId: courseOneId });
    await repository.write({
      database: { ...snapshot.database, classes: [] },
      courseId: courseOneId,
      ...(snapshot.revision ? { expectedRevision: snapshot.revision } : {}),
    });

    expect(client.claims.has("55395057")).toBe(false);
  });
});

describe("teaching course management course partition", () => {
  it("keeps a course's own records and drops every other course's", () => {
    const merged = normalizeTeachingCourseManagementDatabase({
      ...createCourseFixture({
        courseId: courseOneId,
        courseName: "Research Methods",
        updatedAt: "2026-08-16T09:00:00.000Z",
        invitationCode: "55395057",
      }),
      courses: [
        ...createCourseFixture({
          courseId: courseOneId,
          courseName: "Research Methods",
          updatedAt: "2026-08-16T09:00:00.000Z",
        }).courses,
        ...createCourseFixture({
          courseId: courseTwoId,
          courseName: "Elementary Math",
          updatedAt: "2026-08-16T09:00:00.000Z",
        }).courses,
      ],
    });

    const partitioned = selectTeachingCourseManagementCourseDatabase(merged, courseOneId);

    expect(partitioned.courses.map((course) => course.courseId)).toEqual([courseOneId]);
    expect(partitioned.classes.map((item) => item.courseId)).toEqual([courseOneId]);
    expect(partitioned.auditEvents.map((event) => event.courseId)).toEqual([courseOneId]);
    // Scalars ride along unchanged, so no reader learns a new shape.
    expect(partitioned.schemaVersion).toBe("uais-teaching-course-management-v1");
    expect(partitioned.updatedAt).toBe(merged.updatedAt);
  });

  it("partitions an optional array it never names, so a new array cannot be dropped", () => {
    // Learning groups are one of ~25 optional arrays the partition does not
    // mention by name. It works over the envelope's own keys precisely so that
    // the next array to ship is partitioned the day it lands rather than the day
    // someone remembers to add it to a field list.
    const database = normalizeTeachingCourseManagementDatabase({
      ...createEmptyDatabaseFixture(),
      learningGroups: [
        {
          groupId: "group-one",
          courseId: courseOneId,
          ownerTeacherId: "teacher-kang",
          groupName: "第一组",
          members: [],
          createdAt: "2026-08-16T09:00:00.000Z",
          updatedAt: "2026-08-16T09:00:00.000Z",
          storagePolicy: "postgres-teaching-course-management-snapshot",
          storageWritePolicy: "postgres-transactional-snapshot-replace",
        },
        {
          groupId: "group-two",
          courseId: courseTwoId,
          ownerTeacherId: "teacher-kang",
          groupName: "第二组",
          members: [],
          createdAt: "2026-08-16T09:00:00.000Z",
          updatedAt: "2026-08-16T09:00:00.000Z",
          storagePolicy: "postgres-teaching-course-management-snapshot",
          storageWritePolicy: "postgres-transactional-snapshot-replace",
        },
      ],
    });

    const partitioned = selectTeachingCourseManagementCourseDatabase(database, courseOneId);

    expect(partitioned.learningGroups?.map((group) => group.groupId)).toEqual(["group-one"]);
  });

  it("refuses a record that carries no course id rather than partitioning it away", () => {
    const database = {
      ...createEmptyDatabaseFixture(),
      courses: [{ courseName: "Missing a course id" }],
    } as unknown as TeachingCourseManagementDatabase;

    // Two gates in series. The record normalizer refuses this one first, which
    // is why the message below is its own; the partition's `not
    // course-attributed` guard is the backstop for an array a FUTURE normalizer
    // lets through without a course, and is unreachable today by construction.
    // Either way the answer is a refusal: a deployment-wide list that reached
    // this envelope must be given a home of its own - the invite-code claims
    // table is what that looks like - never dropped into every course row's
    // blind spot.
    expect(() =>
      selectTeachingCourseManagementCourseDatabase(database, courseOneId),
    ).toThrow(/Invalid course id|not course-attributed/);
  });

  it("cuts a whole corpus into the rows the store keeps", () => {
    const partitions = partitionTeachingCourseManagementDatabaseByCourse(
      createCorpusFixture(),
    );

    // Sorted by course id, so the backfill's write order and the parity
    // comparison are deterministic rather than dependent on array order.
    expect(partitions.map((partition) => partition.courseId)).toEqual(
      [courseOneId, courseTwoId].sort(),
    );
    for (const partition of partitions) {
      expect(partition.database.courses.map((course) => course.courseId)).toEqual([
        partition.courseId,
      ]);
      expect(partition.database.auditEvents.map((event) => event.courseId)).toEqual([
        partition.courseId,
      ]);
    }
  });

  it("finds a course that only a non-course record mentions", () => {
    // A corpus can carry a class or an audit event whose course record has not
    // been written yet. Enumerating `courses` alone would leave that row
    // homeless, so the id list is built over every array.
    const database = normalizeTeachingCourseManagementDatabase({
      ...createEmptyDatabaseFixture(),
      auditEvents: createCourseFixture({
        courseId: courseTwoId,
        courseName: "Elementary Math",
        updatedAt: "2026-08-16T09:00:00.000Z",
      }).auditEvents,
    });

    expect(listTeachingCourseManagementCourseIds(database)).toEqual([courseTwoId]);
  });

  it("merges the rows back and takes the newest course write as the corpus stamp", () => {
    const merged = mergeTeachingCourseManagementCourseDatabases([
      {
        database: createCourseFixture({
          courseId: courseOneId,
          courseName: "Research Methods",
          updatedAt: "2026-08-16T09:00:00.000Z",
        }),
      },
      {
        database: createCourseFixture({
          courseId: courseTwoId,
          courseName: "Elementary Math",
          updatedAt: "2026-08-16T09:00:02.000Z",
        }),
      },
    ]);

    expect(merged.courses.map((course) => course.courseId)).toEqual([
      courseOneId,
      courseTwoId,
    ]);
    expect(merged.auditEvents).toHaveLength(2);
    expect(merged.updatedAt).toBe("2026-08-16T09:00:02.000Z");
  });

  it("counts a code once from the class, the draft and the membership that share it", () => {
    const database = normalizeTeachingCourseManagementDatabase({
      ...createCourseFixture({
        courseId: courseOneId,
        courseName: "Research Methods",
        updatedAt: "2026-08-16T09:00:00.000Z",
        invitationCode: "55395057",
      }),
      inviteCodeDrafts: [
        {
          inviteCodeDraftId: `invite-code-draft-${courseOneId}-55395058`,
          courseId: courseOneId,
          classId: `${courseOneId}-class-1`,
          ownerTeacherId: "teacher-kang",
          generatedBy: "teacher-kang",
          draftStatus: "generated",
          operationRecordId: "operation-1",
          inviteCode: "55395058",
          joinUrl: "/courses?invite=55395058",
          invitePolicy: "teacher-review-before-publication",
          generatedAt: "2026-08-16T09:00:00.000Z",
          storagePolicy: "postgres-teaching-course-management-snapshot",
          storageWritePolicy: "postgres-transactional-snapshot-replace",
        },
      ],
      memberships: [
        {
          membershipId: `membership-${courseOneId}-class-1-Peter`,
          courseId: courseOneId,
          classId: `${courseOneId}-class-1`,
          invitationCode: "55395057",
          studentId: "Peter",
          studentDisplayName: "Peter",
          membershipStatus: "approved",
          joinedAt: "2026-08-16T09:00:00.000Z",
          storagePolicy: "postgres-teaching-course-management-snapshot",
          storageWritePolicy: "postgres-transactional-snapshot-replace",
        },
      ],
    });

    expect(selectTeachingClassInviteCodeClaims(database)).toEqual([
      { inviteCode: "55395057", classId: `${courseOneId}-class-1` },
      { inviteCode: "55395058", classId: `${courseOneId}-class-1` },
    ]);
  });
});

describe("teaching course management snapshot migration", () => {
  it("splits the single course-management row per course and retires it", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(
      "migrations/0007_teaching_course_management_per_course.sql",
      "utf8",
    );

    // One row per course id the old row mentioned, built over the envelope's own
    // keys so an array added later cannot be silently dropped...
    expect(sql).toContain("jsonb_object_agg");
    expect(sql).toContain("record.value->>'courseId' = course_keys.course_id");
    // ...without ever rolling back a course the application has since written.
    expect(sql).toContain("ON CONFLICT (snapshot_key) DO NOTHING");
    // ...and the old row is archived and then removed, so it cannot be read.
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS uais_teaching_course_management_snapshots_retired",
    );
    expect(sql).toContain("DELETE FROM uais_teaching_course_management_snapshots");
    expect(sql).toContain("WHERE snapshot_key = 'default'");
    // The one invariant a per-course row cannot hold gets its own table, seeded
    // from the codes the retired row already held.
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS uais_teaching_class_invite_code_claims",
    );
    expect(sql).toContain("invite_code text PRIMARY KEY");
    expect(sql).toContain("ON CONFLICT (invite_code) DO NOTHING");
    // The chatroom tables keep whatever 0006 decided for them; this split may
    // name them in commentary but must not issue a statement against them.
    expect(sql).not.toMatch(
      /(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+uais_learning_chatroom_/,
    );
    // A migration that exists but is not registered never runs. The runner
    // derives its work list from migrations/*.sql and this inventory is pinned
    // to that same directory (tests/core-database-foundation.test.ts), so a
    // version named here is a version the deploy applies.
    expect(UAIS_CORE_DATABASE_MIGRATION_VERSIONS).toContain("0007_teaching_course_management_per_course");
  });
});

// The cutover tooling is the caller the per-course re-key broke: it copied the
// whole file corpus with one `write({ database })` and no course id, which the
// per-course store refuses outright (500), so the documented migration path
// stopped working the moment the re-key landed. It also compared the two sides
// with a raw JSON.stringify, which reports "mismatch" for a corpus that agrees
// record for record - the managed read merges the rows in snapshot_key order,
// which is not the order the file lists them in.
describe("teaching course management durable cutover", () => {
  async function seedJsonFile(
    dataDir: string,
    database: TeachingCourseManagementDatabase,
  ) {
    await writeFile(
      join(dataDir, "teaching-course-management.json"),
      JSON.stringify(database),
      "utf8",
    );
  }

  it("backfills a multi-course corpus row by row and reports parity", async () => {
    const client = createCourseAwareClient();
    const dataDir = await mkdtemp(join(tmpdir(), "uais-cm-cutover-unit-"));
    try {
      await seedJsonFile(dataDir, createCorpusFixture());

      const backfill = await backfillTeachingCourseManagementToPostgres({
        env,
        sourceDataDir: dataDir,
        createDatabase: client.factory,
      });

      expect(backfill.status).toBe("parity");
      expect(backfill.entityCounts.courses).toBe(2);
      expect(backfill.managedRevision).toBeTruthy();
      // One row per course, not one row holding the deployment.
      expect(client.rowKeys()).toEqual([courseOneId, courseTwoId].sort());
      expect(client.databaseFor(courseOneId)?.courses.map((course) => course.courseId)).toEqual(
        [courseOneId],
      );
      // The claims table is reconciled by the same writes, so the codes the
      // corpus held are still reachable after the migration.
      expect(client.claims.get("55395057")?.courseId).toBe(courseOneId);
      expect(client.claims.get("55395058")?.courseId).toBe(courseTwoId);
      // Redaction: counts only, never record contents.
      expect(JSON.stringify(backfill)).not.toContain("Research Methods");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("stays parity when run again over the rows it already wrote", async () => {
    // "Run it repeatedly until parity holds" is the documented migrate step, so
    // the second run replaces rows the first one created and has to name their
    // revisions. A backfill that presented itself as a first writer would be
    // refused by the store's own conflict guard.
    const client = createCourseAwareClient();
    const dataDir = await mkdtemp(join(tmpdir(), "uais-cm-cutover-rerun-"));
    try {
      await seedJsonFile(dataDir, createCorpusFixture());
      await backfillTeachingCourseManagementToPostgres({
        env,
        sourceDataDir: dataDir,
        createDatabase: client.factory,
      });

      const rerun = await backfillTeachingCourseManagementToPostgres({
        env,
        sourceDataDir: dataDir,
        createDatabase: client.factory,
      });

      expect(rerun.status).toBe("parity");
      expect(client.rowKeys()).toEqual([courseOneId, courseTwoId].sort());
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reports mismatch when the file corpus gains a course after the backfill", async () => {
    const client = createCourseAwareClient();
    const dataDir = await mkdtemp(join(tmpdir(), "uais-cm-cutover-drift-"));
    try {
      await seedJsonFile(dataDir, createCorpusFixture());
      await backfillTeachingCourseManagementToPostgres({
        env,
        sourceDataDir: dataDir,
        createDatabase: client.factory,
      });

      const corpus = createCorpusFixture();
      await seedJsonFile(
        dataDir,
        normalizeTeachingCourseManagementDatabase({
          ...corpus,
          courses: [
            ...corpus.courses,
            ...createCourseFixture({
              courseId: "teacher-course-drifted-20260816-090000",
              courseName: "Drifted Course",
              updatedAt: "2026-08-16T09:00:04.000Z",
            }).courses,
          ],
        }),
      );

      const drift = await verifyTeachingCourseManagementParity({
        env,
        sourceDataDir: dataDir,
        createDatabase: client.factory,
      });

      expect(drift.status).toBe("mismatch");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
