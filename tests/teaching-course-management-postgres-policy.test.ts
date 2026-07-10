import { describe, expect, it } from "vitest";
import { normalizeTeachingCourseManagementDatabase } from "@/lib/server/teaching-course-management-store";

describe("teaching course management postgres storage-policy fidelity", () => {
  it("preserves postgres storage policies on records and audit events through normalization", () => {
    const normalized = normalizeTeachingCourseManagementDatabase({
      schemaVersion: "uais-teaching-course-management-v1",
      updatedAt: "2026-07-09T00:00:00.000Z",
      courses: [
        {
          courseId: "course-postgres-1",
          ownerTeacherId: "teacher-1",
          courseName: "Research Methods",
          instructor: "Kang Xia",
          unit: "GZHU",
          department: "Teacher Education",
          semester: "Spring 2026",
          students: 0,
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z",
          storagePolicy: "postgres-teaching-course-management-snapshot",
          storageWritePolicy: "postgres-transactional-snapshot-replace",
        },
      ],
      classes: [],
      memberships: [],
      auditEvents: [
        {
          auditId: "audit-create-course-1",
          action: "create-course",
          actorId: "teacher-1",
          courseId: "course-postgres-1",
          traceId: "trace-1",
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          createdAt: "2026-07-09T00:00:00.000Z",
          requestSource: { userAgent: "test", ipAddress: "redacted" },
          storagePolicy: "postgres-teaching-course-management-audit-log",
        },
      ],
    });

    expect(normalized.courses[0].storagePolicy).toBe(
      "postgres-teaching-course-management-snapshot",
    );
    expect(normalized.courses[0].storageWritePolicy).toBe(
      "postgres-transactional-snapshot-replace",
    );
    expect(normalized.auditEvents[0].storagePolicy).toBe(
      "postgres-teaching-course-management-audit-log",
    );
  });

  it("still preserves external policies and defaults unknown policies to local-json", () => {
    const normalized = normalizeTeachingCourseManagementDatabase({
      schemaVersion: "uais-teaching-course-management-v1",
      updatedAt: "2026-07-09T00:00:00.000Z",
      courses: [
        {
          courseId: "course-external-1",
          ownerTeacherId: "teacher-1",
          courseName: "Research Methods",
          instructor: "Kang Xia",
          unit: "GZHU",
          department: "Teacher Education",
          semester: "Spring 2026",
          students: 0,
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z",
          storagePolicy: "external-redacted-teaching-course-management-snapshot",
          storageWritePolicy: "external-optimistic-snapshot-replace",
        },
        {
          courseId: "course-unknown-1",
          ownerTeacherId: "teacher-1",
          courseName: "Research Methods",
          instructor: "Kang Xia",
          unit: "GZHU",
          department: "Teacher Education",
          semester: "Spring 2026",
          students: 0,
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z",
          storagePolicy: "bogus-policy",
          storageWritePolicy: "bogus-write-policy",
        },
      ],
      classes: [],
      memberships: [],
      auditEvents: [],
    });

    expect(normalized.courses[0].storagePolicy).toBe(
      "external-redacted-teaching-course-management-snapshot",
    );
    expect(normalized.courses[0].storageWritePolicy).toBe(
      "external-optimistic-snapshot-replace",
    );
    expect(normalized.courses[1].storagePolicy).toBe("local-json-teaching-course-management");
    expect(normalized.courses[1].storageWritePolicy).toBe("atomic-json-file-replace");
  });
});
