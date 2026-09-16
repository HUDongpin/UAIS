import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTeachingOperationAuditDomainProjectionValues } from "@/lib/server/teaching-operations-receipt-normalizers";
import {
  confirmAndOpenCourseSettingsStudentPreview,
  isCourseSettingsStudentPreview,
  openTeachingStudentPreviewUrl,
  readFallbackTeachingStudentPreviewUrl,
  readGeneratedStudentPreviewSession,
  resolveCourseSettingsPersistConfirmation,
} from "@/components/pages/teaching-student-preview";

describe("teaching student preview session", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("only treats course-settings secondary as the student preview action", () => {
    expect(isCourseSettingsStudentPreview("course-settings", "secondary")).toBe(true);
    expect(isCourseSettingsStudentPreview("course-settings", "primary")).toBe(false);
    expect(isCourseSettingsStudentPreview("students", "secondary")).toBe(false);
  });

  it("reads a generated session from the widened course-management receipt", () => {
    expect(
      readGeneratedStudentPreviewSession({
        operationId: "course-settings",
        actionSlot: "secondary",
        studentPreviewSessionReceipt: {
          objectType: "student-preview-session",
          previewStatus: "generated",
          previewUrl: "/learning?teacherPreview=1&course=teacher-course-owned",
          previewId: "student-preview-20260916",
          previewScope: "teacher-course-preview",
          previewPolicy: "teacher-visible-preview-only",
          previewedBy: "phoebe",
          generatedAt: "2026-09-16T00:00:00.000Z",
        },
      }),
    ).toEqual({
      objectType: "student-preview-session",
      previewStatus: "generated",
      previewUrl: "/learning?teacherPreview=1&course=teacher-course-owned",
      previewId: "student-preview-20260916",
      previewScope: "teacher-course-preview",
      previewPolicy: "teacher-visible-preview-only",
      previewedBy: "phoebe",
      generatedAt: "2026-09-16T00:00:00.000Z",
    });
  });

  it("reads previewUrl from the operations student-preview artifact when the receipt is bare", () => {
    expect(
      readGeneratedStudentPreviewSession({
        operationId: "course-settings",
        actionSlot: "secondary",
        artifacts: [
          {
            kind: "student-preview",
            previewId: "student-preview-20260916",
            previewUrl: "/learning?teacherPreview=1&course=teacher-course-owned",
          },
        ],
        studentPreviewSessionReceipt: {},
      }),
    ).toEqual(
      expect.objectContaining({
        objectType: "student-preview-session",
        previewStatus: "generated",
        previewUrl: "/learning?teacherPreview=1&course=teacher-course-owned",
        previewId: "student-preview-20260916",
      }),
    );
  });

  it("does not invent a generated session for a primary save receipt", () => {
    expect(
      readGeneratedStudentPreviewSession({
        operationId: "course-settings",
        actionSlot: "primary",
        artifacts: [
          {
            kind: "student-preview",
            previewUrl: "/learning?teacherPreview=1&course=teacher-course-owned",
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("confirms secondary persist from domain persistence even when the receipt is bare", () => {
    expect(
      resolveCourseSettingsPersistConfirmation({
        operationId: "course-settings",
        actionSlot: "secondary",
        courseId: "teacher-course-uais-qa-test-owned-20260915-140423",
        domainPersistenceSummary: {
          status: "persisted",
          persistedObjectTypes: ["student-preview-session"],
        },
      }),
    ).toEqual({
      generatedPreview: undefined,
      persistConfirmed: true,
      previewUrl:
        "/learning?teacherPreview=1&course=teacher-course-uais-qa-test-owned-20260915-140423",
    });
  });

  it("does not confirm secondary persist from a courseId fallback alone", () => {
    expect(
      resolveCourseSettingsPersistConfirmation({
        operationId: "course-settings",
        actionSlot: "secondary",
        courseId: "teacher-course-owned",
      }),
    ).toEqual({
      generatedPreview: undefined,
      persistConfirmed: false,
      previewUrl: undefined,
    });
  });

  it("keeps primary save persistConfirmed without a generated preview", () => {
    expect(
      resolveCourseSettingsPersistConfirmation({
        operationId: "course-settings",
        actionSlot: "primary",
        courseId: "teacher-course-owned",
        domainPersistenceSummary: {
          status: "persisted",
          persistedObjectTypes: ["course-settings"],
        },
      }),
    ).toEqual({
      generatedPreview: undefined,
      persistConfirmed: true,
      previewUrl: undefined,
    });
  });

  it("opens the fallback previewUrl for a domain-persisted secondary without artifact or url", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });

    const confirmation = confirmAndOpenCourseSettingsStudentPreview({
      operationId: "course-settings",
      actionSlot: "secondary",
      courseId: "teacher-course-owned",
      domainPersistenceSummary: {
        status: "persisted",
        persistedObjectTypes: ["student-preview-session"],
      },
    });

    expect(confirmation.persistConfirmed).toBe(true);
    expect(confirmation.generatedPreview).toBeUndefined();
    expect(assign).toHaveBeenCalledWith("/learning?teacherPreview=1&course=teacher-course-owned");
  });

  it("builds a safe fallback previewUrl from a known courseId", () => {
    expect(readFallbackTeachingStudentPreviewUrl("teacher-course-owned")).toBe(
      "/learning?teacherPreview=1&course=teacher-course-owned",
    );
    expect(readFallbackTeachingStudentPreviewUrl("")).toBeUndefined();
  });

  it("opens a safe previewUrl and ignores local-path leakage", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });

    openTeachingStudentPreviewUrl("/learning?teacherPreview=1&course=owned-course");
    expect(assign).toHaveBeenCalledWith("/learning?teacherPreview=1&course=owned-course");

    assign.mockClear();
    openTeachingStudentPreviewUrl("/Users/dongpinhu/secret");
    expect(assign).not.toHaveBeenCalled();
  });

  it("hydrates audit domain projections from nested operation records", () => {
    expect(
      collectTeachingOperationAuditDomainProjectionValues({
        domainProjections: [],
        records: [
          {
            recordId: "operation-record-student-preview",
            domainProjections: [
              {
                objectId: "student-preview-session-owned-course",
                objectType: "student-preview-session",
                operationRecordId: "operation-record-student-preview",
                previewStatus: "generated",
                previewUrl: "/learning?teacherPreview=1&course=owned-course",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        objectType: "student-preview-session",
        previewStatus: "generated",
        previewUrl: "/learning?teacherPreview=1&course=owned-course",
      }),
    ]);
  });
});
