import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function retentionModule() {
  expect(
    existsSync(resolve("src/lib/server/classroom-record-retention-store.ts")),
    "classroom retention behavior is implemented",
  ).toBe(true);
  const modulePath = "../src/lib/server/classroom-record-retention-store.ts";
  return import(modulePath);
}

describe("classroom record retention", () => {
  it("limits audit cleanup to classroom activity while preserving course publication provenance", async () => {
    const retention = await retentionModule();
    expect(retention.isClassroomSnapshotRecord).toBeTypeOf("function");
    expect(
      retention.isClassroomSnapshotRecord(
        "auditEvents",
        { action: "join-class-by-invite" },
        "course",
      ),
    ).toBe(true);
    expect(
      retention.isClassroomSnapshotRecord(
        "auditEvents",
        { action: "publish-course-content" },
        "course",
      ),
    ).toBe(false);
    expect(
      retention.isClassroomSnapshotRecord(
        "auditEvents",
        { action: "update-course-unit-draft" },
        "course",
      ),
    ).toBe(false);
    expect(
      retention.isClassroomSnapshotRecord(
        "records",
        { operationId: "grading" },
        "operations",
      ),
    ).toBe(true);
    expect(
      retention.isClassroomSnapshotRecord(
        "records",
        { operationId: "content" },
        "operations",
      ),
    ).toBe(false);
    expect(
      retention.isClassroomSnapshotRecord(
        "auditEvents",
        { operationId: "knowledge-base" },
        "operations",
      ),
    ).toBe(false);
    expect(
      retention.isClassroomSnapshotRecord(
        "domainProjections",
        { objectType: "course-content" },
        "operations",
      ),
    ).toBe(false);
    expect(
      retention.isClassroomSnapshotRecord(
        "domainProjections",
        { objectType: "gradebook-update" },
        "operations",
      ),
    ).toBe(true);
  });
  it("retains a closed course for exactly 180 days", async () => {
    const { classroomRecordPurgeAfter } = await retentionModule();
    expect(classroomRecordPurgeAfter("2026-01-01T12:30:00.000Z")).toBe(
      "2026-06-30T12:30:00.000Z",
    );
  });

  it("takes a shared course lock before checking for closure, including absent rows", async () => {
    const { assertClassroomRecordWriteAllowed } = await retentionModule();
    const queries: string[] = [];
    const sql = async (strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return [];
    };
    await assertClassroomRecordWriteAllowed(sql, "math-course");
    expect(queries[0]).toContain("pg_advisory_xact_lock_shared");
    expect(queries[1]).toContain("uais_course_record_retention");
  });

  it("stops student writes after closure while allowing teacher review until purge", async () => {
    const { assertClassroomRecordWriteAllowed } = await retentionModule();
    const sql = async (strings: TemplateStringsArray) =>
      strings.join("").includes("SELECT closed_at")
        ? [{ closed_at: "2026-01-01T00:00:00Z", purged_at: null }]
        : [];
    await expect(
      assertClassroomRecordWriteAllowed(sql, "math-course"),
    ).rejects.toMatchObject({
      status: 423,
      reasonCode: "course-records-closed",
    });
    await expect(
      assertClassroomRecordWriteAllowed(sql, "math-course", {
        allowClosed: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("never permits deleted records to be recreated by a delayed teacher or student request", async () => {
    const { assertClassroomRecordWriteAllowed } = await retentionModule();
    const sql = async (strings: TemplateStringsArray) =>
      strings.join("").includes("SELECT closed_at")
        ? [
            {
              closed_at: "2026-01-01T00:00:00Z",
              purged_at: "2026-07-01T00:00:00Z",
            },
          ]
        : [];
    await expect(
      assertClassroomRecordWriteAllowed(sql, "math-course", {
        allowClosed: true,
      }),
    ).rejects.toMatchObject({
      status: 423,
      reasonCode: "course-records-purged",
    });
  });

  it("refuses a late invite join after course closure but permits unchanged classroom membership", async () => {
    const retention = await retentionModule();
    expect(retention.assertClassroomSnapshotWriteAllowed).toBeTypeOf(
      "function",
    );
    const sql = async (strings: TemplateStringsArray) => {
      const query = strings.join("");
      if (query.includes("SELECT closed_at"))
        return [{ closed_at: "2026-01-01", purged_at: null }];
      if (query.includes("SELECT database"))
        return [{ database: { memberships: [] } }];
      return [];
    };
    await expect(
      retention.assertClassroomSnapshotWriteAllowed(sql, "course", {
        memberships: [{ studentId: "late-student" }],
      }),
    ).rejects.toMatchObject({ reasonCode: "course-records-closed" });
    await expect(
      retention.assertClassroomSnapshotWriteAllowed(sql, "course", {
        memberships: [],
        courses: [{ name: "Updated teaching material" }],
      }),
    ).resolves.toBeUndefined();
  });
});
