import { describe, expect, it } from "vitest";
import type { TeacherCourse } from "@/data/uais";
import type { Locale } from "@/i18n/copy";
import type { CourseSettingsDraftEntry } from "@/lib/teaching/course-readback";
import {
  applyCourseSettingsPatchToTeacherCourse,
  createCourseSettingsDraftEntries,
  createCourseSettingsPatchFromDraft,
  createDefaultNewCourseDraft,
  createPersistedCourseLoadErrorMessage,
  createTeacherClassesByCourseFromPersistedClasses,
  createTeacherCourseFromPersistedCourse,
  createTeacherMembershipFromPersistedMembership,
  createTeacherMembershipsByClassFromPersistedMemberships,
  extractCourseSemester,
  isMatchingMembershipApprovalResult,
  isPersistedMembershipApprovalReceipt,
  mergeTeacherClassesByCourseId,
  mergeTeacherCoursesById,
  mergeTeacherMembershipsByClassId,
  resolveCourseSettingsDraftValues,
} from "@/lib/teaching/course-readback";

const course: TeacherCourse = {
  id: "course-local",
  title: {
    "zh-CN": "本地课程",
    "en-US": "Local course",
  },
  status: {
    "zh-CN": "2025-2026第二学期 / 已保存课程",
    "en-US": "Spring 2026 / Saved course",
  },
  students: 12,
  currentFocus: {
    "zh-CN": "本地说明",
    "en-US": "Local focus",
  },
};

// Mirrors the shipped demo cards: the status carries no parseable semester, so the
// persisted semester rendering is the locale-specific default fallback.
const defaultSemesterCourse: TeacherCourse = {
  id: "teacher-research-methods",
  title: {
    "zh-CN": "大学研究方法",
    "en-US": "University Research Methods",
  },
  status: {
    "zh-CN": "春季学期进行中",
    "en-US": "Spring term in progress",
  },
  students: 36,
  currentFocus: {
    "zh-CN": "第 3 单元：研究设计",
    "en-US": "Unit 3: Research Design",
  },
};

// A draft field as stored after the teacher typed `value` while the UI was in `locale`.
function typedIn(value: string, locale: Locale): CourseSettingsDraftEntry {
  return { value, locale };
}

describe("B-14 teaching course readback helpers", () => {
  it("keeps course settings defaults and patches deterministic outside the page component", () => {
    expect(createDefaultNewCourseDraft("en-US")).toMatchObject({
      instructor: "Dr. Kang Xia",
      semester: "Spring 2026",
    });
    expect(extractCourseSemester(course, "en-US")).toBe("Spring 2026");

    expect(resolveCourseSettingsDraftValues(course, undefined, "en-US")).toEqual({
      courseName: "Local course",
      semester: "Spring 2026",
      description: "",
    });
    // Untouched fields follow the requested locale; only edited fields stick.
    expect(resolveCourseSettingsDraftValues(course, undefined, "zh-CN")).toEqual({
      courseName: "本地课程",
      semester: "2025-2026第二学期",
      description: "",
    });
    expect(
      resolveCourseSettingsDraftValues(
        course,
        { description: typedIn("Draft focus", "en-US") },
        "en-US",
      ),
    ).toEqual({
      courseName: "Local course",
      semester: "Spring 2026",
      description: "Draft focus",
    });

    expect(
      applyCourseSettingsPatchToTeacherCourse(course, {
        courseName: "Updated course",
        semester: "Autumn 2026",
        description: "Updated focus",
      }),
    ).toMatchObject({
      title: {
        "zh-CN": "Updated course",
        "en-US": "Updated course",
      },
      status: {
        "zh-CN": "Autumn 2026 / 已保存课程",
        "en-US": "Autumn 2026 / Saved course",
      },
      currentFocus: {
        "zh-CN": "Updated focus",
        "en-US": "Updated focus",
      },
    });
  });

  it("treats a draft entry equal to its own stamped locale's persisted value as untouched", () => {
    // Repro: in zh-CN the teacher types one character into a field and deletes it,
    // so the sparse draft keeps the zh-CN string it was seeded with. Switching to
    // en-US must not read that leftover as an edit.
    const revertedDraft = {
      courseName: typedIn("本地课程", "zh-CN"),
      semester: typedIn("2025-2026第二学期", "zh-CN"),
    };

    expect(resolveCourseSettingsDraftValues(course, revertedDraft, "en-US")).toEqual({
      courseName: "Local course",
      semester: "Spring 2026",
      description: "",
    });
    expect(resolveCourseSettingsDraftValues(course, revertedDraft, "zh-CN")).toEqual({
      courseName: "本地课程",
      semester: "2025-2026第二学期",
      description: "",
    });
    expect(createCourseSettingsPatchFromDraft(course, revertedDraft)).toBeUndefined();

    // The mirror case: a field touched and reverted while the UI was in en-US.
    expect(
      createCourseSettingsPatchFromDraft(course, {
        courseName: typedIn("Local course", "en-US"),
        semester: typedIn("Spring 2026", "en-US"),
      }),
    ).toBeUndefined();

    // A genuine edit differs from the persisted rendering at the locale it was typed
    // under, so it patches and the form keeps showing it after a locale switch.
    const editedDraft = {
      courseName: typedIn("企业级研究方法", "zh-CN"),
      semester: typedIn(" Autumn 2026 ", "zh-CN"),
    };
    expect(createCourseSettingsPatchFromDraft(course, editedDraft)).toEqual({
      courseName: "企业级研究方法",
      semester: "Autumn 2026",
    });
    expect(resolveCourseSettingsDraftValues(course, editedDraft, "en-US")).toEqual({
      courseName: "企业级研究方法",
      semester: " Autumn 2026 ",
      description: "",
    });

    // Description has no persisted baseline, so any non-empty value is an edit, and
    // a cleared field stays cleared instead of snapping back to the persisted value.
    expect(
      createCourseSettingsPatchFromDraft(course, {
        description: typedIn("Draft focus", "zh-CN"),
      }),
    ).toEqual({
      description: "Draft focus",
    });
    expect(
      createCourseSettingsPatchFromDraft(course, { courseName: typedIn("  ", "zh-CN") }),
    ).toBeUndefined();
    expect(
      resolveCourseSettingsDraftValues(course, { courseName: typedIn("", "zh-CN") }, "zh-CN"),
    ).toMatchObject({
      courseName: "",
    });
    expect(createCourseSettingsPatchFromDraft(course, undefined)).toBeUndefined();
  });

  it("keeps a value typed under one locale that matches the other locale's rendering", () => {
    // P1 repro: the demo cards have no parseable semester, so the persisted semester
    // is the locale default — "Spring 2026" in en-US, "2025-2026第二学期" in zh-CN.
    // A teacher in the en-US UI typing the Chinese semester string is renaming the
    // semester, not reverting it, so the typed text must survive display and save.
    const semesterDraft = { semester: typedIn("2025-2026第二学期", "en-US") };

    expect(resolveCourseSettingsDraftValues(defaultSemesterCourse, semesterDraft, "en-US")).toEqual({
      courseName: "University Research Methods",
      semester: "2025-2026第二学期",
      description: "",
    });
    expect(createCourseSettingsPatchFromDraft(defaultSemesterCourse, semesterDraft)).toEqual({
      semester: "2025-2026第二学期",
    });

    // Same rule for a rename to the other language's title: in the en-US UI the
    // teacher saw "University Research Methods", so typing "大学研究方法" is an edit.
    const renameDraft = { courseName: typedIn("大学研究方法", "en-US") };
    expect(resolveCourseSettingsDraftValues(defaultSemesterCourse, renameDraft, "en-US")).toMatchObject(
      {
        courseName: "大学研究方法",
      },
    );
    expect(createCourseSettingsPatchFromDraft(defaultSemesterCourse, renameDraft)).toEqual({
      courseName: "大学研究方法",
    });

    // Toggle-invariance: the same stored entry decides identically at the other locale.
    expect(createCourseSettingsPatchFromDraft(defaultSemesterCourse, semesterDraft)).toEqual({
      semester: "2025-2026第二学期",
    });
    expect(resolveCourseSettingsDraftValues(defaultSemesterCourse, semesterDraft, "zh-CN")).toMatchObject(
      {
        semester: "2025-2026第二学期",
      },
    );

    // The same string typed in the zh-CN UI is a no-op revert, not an edit.
    expect(
      createCourseSettingsPatchFromDraft(defaultSemesterCourse, {
        semester: typedIn("2025-2026第二学期", "zh-CN"),
      }),
    ).toBeUndefined();
  });

  it("echoes a draft entry stamped with the displayed locale verbatim, whitespace included", () => {
    // P1 repro: in the en-US UI the teacher appends a trailing space to the course
    // name. That value differs from the persisted rendering only by whitespace, so a
    // trimmed untouched check would call it untouched and snap the persisted string
    // back into the controlled input, eating the space before the next keystroke.
    const trailingSpaceDraft = { courseName: typedIn("University Research Methods ", "en-US") };
    expect(
      resolveCourseSettingsDraftValues(defaultSemesterCourse, trailingSpaceDraft, "en-US"),
    ).toMatchObject({
      courseName: "University Research Methods ",
    });

    // With the space preserved, the next character lands after it.
    const nextKeystrokeDraft = { courseName: typedIn("University Research Methods A", "en-US") };
    expect(
      resolveCourseSettingsDraftValues(defaultSemesterCourse, nextKeystrokeDraft, "en-US"),
    ).toMatchObject({
      courseName: "University Research Methods A",
    });

    // Verbatim display is a form concern only: the patch still trims, so a
    // whitespace-only difference is not a rename and never reaches the backend.
    expect(
      createCourseSettingsPatchFromDraft(defaultSemesterCourse, trailingSpaceDraft),
    ).toBeUndefined();
    expect(createCourseSettingsPatchFromDraft(defaultSemesterCourse, nextKeystrokeDraft)).toEqual({
      courseName: "University Research Methods A",
    });

    // A whitespace-only entry stamped under the OTHER locale is not a live edit buffer,
    // so it still follows the untouched predicate and yields to the current locale's
    // persisted rendering — while staying verbatim at the locale it was typed under.
    const crossLocaleWhitespaceDraft = { courseName: typedIn("大学研究方法 ", "zh-CN") };
    expect(
      resolveCourseSettingsDraftValues(defaultSemesterCourse, crossLocaleWhitespaceDraft, "en-US"),
    ).toMatchObject({
      courseName: "University Research Methods",
    });
    expect(
      resolveCourseSettingsDraftValues(defaultSemesterCourse, crossLocaleWhitespaceDraft, "zh-CN"),
    ).toMatchObject({
      courseName: "大学研究方法 ",
    });
    expect(
      createCourseSettingsPatchFromDraft(defaultSemesterCourse, crossLocaleWhitespaceDraft),
    ).toBeUndefined();
  });

  it("stamps the writing locale onto every edited course settings field", () => {
    expect(createCourseSettingsDraftEntries({ semester: "2025-2026第二学期" }, "en-US")).toEqual({
      semester: { value: "2025-2026第二学期", locale: "en-US" },
    });
    expect(createCourseSettingsDraftEntries({ courseName: "", description: "说明" }, "zh-CN")).toEqual(
      {
        courseName: { value: "", locale: "zh-CN" },
        description: { value: "说明", locale: "zh-CN" },
      },
    );
    // Untouched fields stay absent so the draft remains sparse.
    expect(createCourseSettingsDraftEntries({}, "zh-CN")).toEqual({});
  });

  it("normalizes persisted course, class, and membership readback records", () => {
    expect(
      createTeacherCourseFromPersistedCourse({
        courseId: " course-server ",
        courseName: " Server course ",
        instructor: " Teacher ",
        department: " Department ",
        unit: " Unit ",
        semester: " 2026 ",
        students: 24,
      }),
    ).toMatchObject({
      id: "course-server",
      students: 24,
      currentFocus: {
        "en-US": "Teacher · Department · Unit",
      },
    });

    expect(
      createTeacherClassesByCourseFromPersistedClasses([
        {
          classId: " class-1 ",
          courseId: " course-server ",
          className: " Cohort A ",
          invitationCode: " 55395057 ",
          students: 10,
        },
        {
          classId: "",
          courseId: "course-server",
          className: "Invalid",
          invitationCode: "x",
        },
      ]),
    ).toEqual({
      "course-server": [
        {
          id: "class-1",
          courseId: "course-server",
          name: "Cohort A",
          students: 10,
          semester: "",
          invitationCode: "55395057",
        },
      ],
    });

    expect(
      createTeacherMembershipsByClassFromPersistedMemberships([
        {
          membershipId: " membership-1 ",
          courseId: " course-server ",
          classId: " class-1 ",
          invitationCode: " 55395057 ",
          studentId: " student-1 ",
          studentDisplayName: " Student One ",
          membershipStatus: "approved",
          approvedAt: "2026-07-08T08:00:00.000Z",
        },
        {
          membershipId: "membership-invalid",
          courseId: "course-server",
          classId: "",
          invitationCode: "55395057",
          studentId: "student-2",
          studentDisplayName: "Student Two",
        },
      ]),
    ).toMatchObject({
      "class-1": [
        {
          id: "membership-1",
          classId: "class-1",
          membershipStatus: "approved",
          approvedAt: "2026-07-08T08:00:00.000Z",
        },
      ],
    });
  });

  it("merges persisted readback ahead of local demo state without duplicating ids", () => {
    const persistedCourse = {
      ...course,
      id: "course-persisted",
    };
    const duplicateClass = {
      id: "class-1",
      courseId: "course-persisted",
      name: "Server class",
      students: 8,
      semester: "",
      invitationCode: "55395057",
    };
    const localClass = {
      ...duplicateClass,
      name: "Local class",
    };
    const persistedMembership = {
      id: "membership-1",
      courseId: "course-persisted",
      classId: "class-1",
      invitationCode: "55395057",
      studentId: "student-1",
      studentDisplayName: "Student One",
      membershipStatus: "approved" as const,
    };

    expect(mergeTeacherCoursesById([persistedCourse], [course, persistedCourse])).toHaveLength(2);
    expect(
      mergeTeacherClassesByCourseId(
        { "course-persisted": [duplicateClass] },
        { "course-persisted": [localClass] },
      ),
    ).toEqual({ "course-persisted": [duplicateClass] });
    expect(
      mergeTeacherMembershipsByClassId(
        { "class-1": [persistedMembership] },
        { "class-1": [persistedMembership] },
      ),
    ).toEqual({ "class-1": [persistedMembership] });
  });

  it("validates membership approvals and redacts unsafe readback errors", () => {
    const requestedClass = {
      id: "class-1",
      courseId: "course-server",
      name: "Cohort A",
      students: 10,
      semester: "",
      invitationCode: "55395057",
    };
    const requestedMembership = createTeacherMembershipFromPersistedMembership({
      membershipId: "membership-1",
      courseId: "course-server",
      classId: "class-1",
      invitationCode: "55395057",
      studentId: "student-1",
      studentDisplayName: "Student One",
    });

    expect(requestedMembership).toBeDefined();
    expect(
      isMatchingMembershipApprovalResult({
        approvedMembership: {
          ...requestedMembership!,
          membershipStatus: "approved",
        },
        requestedMembership: requestedMembership!,
        requestedClass,
      }),
    ).toBe(true);
    expect(
      isPersistedMembershipApprovalReceipt(
        {
          action: "approve-class-membership",
          actorId: "teacher-kang",
          courseId: "course-server",
          classId: "class-1",
          status: "persisted",
        },
        requestedClass,
      ),
    ).toBe(true);
    expect(
      createPersistedCourseLoadErrorMessage(
        "Failed at /Users/example/project/.env.local with api_key token",
        "en-US",
      ),
    ).toBe("Course data readback failed.");
  });

  it("accepts membership approvals after the class invite code is republished", () => {
    // A membership stores the invite code used at join time; the class invitation code is
    // mutable and can be republished by the teacher afterwards.
    const republishedClass = {
      id: "class-1",
      courseId: "course-server",
      name: "Cohort A",
      students: 10,
      semester: "",
      invitationCode: "81640275",
    };
    const requestedMembership = createTeacherMembershipFromPersistedMembership({
      membershipId: "membership-1",
      courseId: "course-server",
      classId: "class-1",
      invitationCode: "55395057",
      studentId: "student-1",
      studentDisplayName: "Student One",
    });

    expect(requestedMembership).toBeDefined();
    expect(requestedMembership!.invitationCode).not.toBe(republishedClass.invitationCode);
    expect(
      isMatchingMembershipApprovalResult({
        approvedMembership: {
          ...requestedMembership!,
          membershipStatus: "approved",
        },
        requestedMembership: requestedMembership!,
        requestedClass: republishedClass,
      }),
    ).toBe(true);

    // A different membership row, or a code that does not echo the requested membership,
    // is still rejected.
    expect(
      isMatchingMembershipApprovalResult({
        approvedMembership: {
          ...requestedMembership!,
          id: "membership-2",
          membershipStatus: "approved",
        },
        requestedMembership: requestedMembership!,
        requestedClass: republishedClass,
      }),
    ).toBe(false);
    expect(
      isMatchingMembershipApprovalResult({
        approvedMembership: {
          ...requestedMembership!,
          invitationCode: republishedClass.invitationCode,
          membershipStatus: "approved",
        },
        requestedMembership: requestedMembership!,
        requestedClass: republishedClass,
      }),
    ).toBe(false);
    expect(
      isMatchingMembershipApprovalResult({
        approvedMembership: {
          ...requestedMembership!,
          membershipStatus: "pending-teacher-review",
        },
        requestedMembership: requestedMembership!,
        requestedClass: republishedClass,
      }),
    ).toBe(false);
  });
});
