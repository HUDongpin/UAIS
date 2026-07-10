import { describe, expect, it } from "vitest";
import type { TeacherCourse } from "@/data/uais";
import {
  applyCourseSettingsPatchToTeacherCourse,
  createCourseSettingsDraft,
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

describe("B-14 teaching course readback helpers", () => {
  it("keeps course settings defaults and patches deterministic outside the page component", () => {
    expect(createDefaultNewCourseDraft("en-US")).toMatchObject({
      instructor: "Dr. Kang Xia",
      semester: "Spring 2026",
    });
    expect(extractCourseSemester(course, "en-US")).toBe("Spring 2026");

    const draft = createCourseSettingsDraft(course, "en-US");
    expect(draft).toEqual({
      courseName: "Local course",
      semester: "Spring 2026",
      description: "",
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
});
