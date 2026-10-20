export const headerTeacher = {
  account: "teacher-header",
  role: "teacher",
  displayName: "Teacher",
  department: "QA",
} as const;

export const headerStudent = {
  account: "student-header",
  role: "student",
  displayName: "Student",
  department: "QA",
} as const;

export const headerActivityId = "11111111-1111-4111-8111-111111111111";

export function headerCatalog(role: "teacher" | "student" = "teacher") {
  return {
    receipt: {
      action: role === "teacher" ? "list-courses" : "list-student-courses",
      status: "read",
      actorId: role === "teacher" ? headerTeacher.account : headerStudent.account,
    },
    courses: [{
      courseId: "course-a",
      courseName: "Real course",
      ...(role === "teacher" ? { ownerTeacherId: headerTeacher.account } : {}),
    }],
    classes: [{
      courseId: "course-a",
      classId: "class-a",
      className: "Class A",
      ...(role === "teacher" ? { ownerTeacherId: headerTeacher.account } : {}),
    }],
    memberships: [{
      membershipId: "member-a",
      courseId: "course-a",
      classId: "class-a",
      membershipStatus: role === "teacher" ? "pending-teacher-review" : "approved",
    }],
  };
}

export function headerActivities() {
  return {
    courseId: "course-a",
    activities: [{
      id: headerActivityId,
      activityKey: "family-a",
      lessonKey: "lesson-a",
      version: 1,
      status: "published",
      targetClassId: "class-a",
      title: { "zh-CN": "真实任务", "en-US": "Real activity" },
      dueAt: "2026-10-21T08:00:00.000Z",
    }],
  };
}

export function headerDashboard() {
  return {
    courses: [{
      courseId: "course-a",
      courseTitle: "Real course",
      classId: "class-a",
      units: [{
        activityId: headerActivityId,
        lessonKey: "lesson-a",
        position: 1,
        submission: { state: "revision_requested" },
        feedback: { status: "revision-required" },
        dueAt: "2026-10-21T08:00:00.000Z",
      }],
    }],
  };
}
