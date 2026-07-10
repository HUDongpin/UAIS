import type { TeacherCourse } from "@/data/uais";
import { defaultLocale, type Locale, type LocalizedText } from "@/i18n/copy";

export type NewCourseDraft = {
  courseId?: string;
  name: string;
  instructor: string;
  unit: string;
  department: string;
  semester: string;
  description: string;
  coverAssetId?: string;
};

export type CourseSettingsDraft = {
  courseName: string;
  semester: string;
  description: string;
};

export type CourseSettingsPatchPayload = Partial<CourseSettingsDraft>;

export type TeacherClassItem = {
  id: string;
  courseId: string;
  name: string;
  students: number;
  semester: string;
  invitationCode: string;
};

export type TeacherClassMembershipItem = {
  id: string;
  courseId: string;
  classId: string;
  invitationCode: string;
  studentId: string;
  studentDisplayName: string;
  membershipStatus: "pending-teacher-review" | "approved";
  joinedAt?: string;
  approvedAt?: string;
};

export type TeachingCourseCreateResponse = {
  course?: {
    courseId?: string;
    courseName?: string;
    instructor?: string;
    unit?: string;
    department?: string;
    semester?: string;
    description?: string;
    students?: number;
  };
  receipt?: {
    action?: string;
    actorId?: string;
    courseId?: string;
    status?: string;
    traceId?: string;
    authSession?: {
      sessionId?: string;
      authenticatedAt?: string;
      expiresAt?: string;
    };
  };
  ownershipReceipt?: {
    teacherId?: string;
    courseIds?: string[];
    status?: string;
    storagePolicy?: string;
    storageWritePolicy?: string;
    responsibleSession?: string;
    updatedAt?: string;
  };
  error?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
};

export type TeachingClassCreateResponse = {
  classItem?: {
    classId?: string;
    courseId?: string;
    className?: string;
    students?: number;
    semester?: string;
    invitationCode?: string;
  };
  receipt?: {
    action?: string;
    actorId?: string;
    courseId?: string;
    classId?: string;
    status?: string;
    traceId?: string;
    authSession?: {
      sessionId?: string;
      authenticatedAt?: string;
      expiresAt?: string;
    };
  };
  error?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
};

export type TeachingCourseListResponse = {
  courses?: Array<{
    courseId?: string;
    courseName?: string;
    instructor?: string;
    unit?: string;
    department?: string;
    semester?: string;
    students?: number;
  }>;
  classes?: Array<{
    classId?: string;
    courseId?: string;
    className?: string;
    students?: number;
    semester?: string;
    invitationCode?: string;
  }>;
  memberships?: Array<{
    membershipId?: string;
    courseId?: string;
    classId?: string;
    invitationCode?: string;
    studentId?: string;
    studentDisplayName?: string;
    membershipStatus?: string;
    joinedAt?: string;
    approvedAt?: string;
  }>;
  receipt?: {
    action?: string;
    actorId?: string;
  };
  error?: string;
};

export type PersistedTeachingCourseReadback = {
  courses: TeacherCourse[];
  classesByCourse: Record<string, TeacherClassItem[]>;
  membershipsByClass: Record<string, TeacherClassMembershipItem[]>;
  authenticatedTeacherActorId?: string;
};

export type TeachingClassMembershipApproveResponse = {
  membership?: NonNullable<TeachingCourseListResponse["memberships"]>[number];
  classItem?: TeachingClassCreateResponse["classItem"];
  course?: TeachingCourseCreateResponse["course"];
  receipt?: {
    action?: string;
    actorId?: string;
    courseId?: string;
    classId?: string;
    status?: string;
    traceId?: string;
  };
  error?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
};

const DEFAULT_NEW_COURSE_DRAFT: NewCourseDraft = {
  name: "",
  instructor: "康霞",
  unit: "广州大学（404）",
  department: "实验教学中心",
  semester: "2025-2026第二学期",
  description: "",
};

const TEACHING_COURSE_LOAD_GENERIC_ERROR_MESSAGE: LocalizedText = {
  "zh-CN": "课程数据读回失败。",
  "en-US": "Course data readback failed.",
};

function readLocalizedText(text: LocalizedText, locale: Locale) {
  return text[locale] ?? text[defaultLocale];
}

export function createDefaultNewCourseDraft(locale: Locale): NewCourseDraft {
  if (locale === "en-US") {
    return {
      name: "",
      instructor: "Dr. Kang Xia",
      unit: "Guangzhou University (404)",
      department: "Faculty of Teacher Education",
      semester: "Spring 2026",
      description: "",
    };
  }

  return DEFAULT_NEW_COURSE_DRAFT;
}

export function extractCourseSemester(course: TeacherCourse, locale: Locale) {
  const status = readLocalizedText(course.status, locale).trim();
  const explicitSemester = status.match(/20\d{2}-20\d{2}第[一二三四]学期/)?.[0];
  if (explicitSemester) {
    return explicitSemester;
  }

  const persistedSemester = status.split(" / ")[0]?.trim();
  return persistedSemester && persistedSemester !== status
    ? persistedSemester
    : createDefaultNewCourseDraft(locale).semester;
}

export function createCourseSettingsDraft(
  course: TeacherCourse,
  locale: Locale,
): CourseSettingsDraft {
  return {
    courseName: readLocalizedText(course.title, locale),
    semester: extractCourseSemester(course, locale),
    description: "",
  };
}

export function applyCourseSettingsPatchToTeacherCourse(
  course: TeacherCourse,
  patch: CourseSettingsPatchPayload,
): TeacherCourse {
  const courseName = patch.courseName?.trim();
  const semester = patch.semester?.trim();
  const description = patch.description?.trim();

  return {
    ...course,
    title: courseName
      ? {
          "zh-CN": courseName,
          "en-US": courseName,
        }
      : course.title,
    status: semester
      ? {
          "zh-CN": `${semester} / 已保存课程`,
          "en-US": `${semester} / Saved course`,
        }
      : course.status,
    currentFocus: description
      ? {
          "zh-CN": description,
          "en-US": description,
        }
      : course.currentFocus,
  };
}

export function shouldLoadPersistedTeachingCourses() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.location.pathname === "/teaching" || window.location.pathname === "/teaching/";
}

export function normalizeTeachingActorId(actorId: unknown) {
  if (typeof actorId !== "string") {
    return undefined;
  }

  const normalized = actorId.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function readTeachingCourseListTeacherActorId(
  receipt: TeachingCourseListResponse["receipt"],
) {
  if (receipt?.action !== "list-courses") {
    return undefined;
  }

  return normalizeTeachingActorId(receipt.actorId);
}

export function createPersistedCourseLoadErrorMessage(error: unknown, locale: Locale) {
  const fallback = readLocalizedText(TEACHING_COURSE_LOAD_GENERIC_ERROR_MESSAGE, locale);
  if (typeof error !== "string") {
    return fallback;
  }

  const normalized = error.trim().slice(0, 180);
  if (!normalized) {
    return fallback;
  }
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return fallback;
  }
  return normalized;
}

export function createTeacherCourseFromPersistedCourse(
  course: NonNullable<TeachingCourseListResponse["courses"]>[number],
): TeacherCourse | undefined {
  const courseId = course.courseId?.trim();
  const courseName = course.courseName?.trim();
  if (!courseId || !courseName) {
    return undefined;
  }

  const semester = course.semester?.trim() || "Server course";
  const instructor = course.instructor?.trim() || "Teacher";
  const department = course.department?.trim() || "Department";
  const unit = course.unit?.trim() || "Unit";

  return {
    id: courseId,
    title: {
      "zh-CN": courseName,
      "en-US": courseName,
    },
    status: {
      "zh-CN": `${semester} / 已保存课程`,
      "en-US": `${semester} / Saved course`,
    },
    students: course.students ?? 0,
    currentFocus: {
      "zh-CN": `${instructor} · ${department} · ${unit}`,
      "en-US": `${instructor} · ${department} · ${unit}`,
    },
  };
}

export function createTeacherClassesByCourseFromPersistedClasses(
  classes: NonNullable<TeachingCourseListResponse["classes"]>,
) {
  return classes.reduce<Record<string, TeacherClassItem[]>>((classesByCourse, classItem) => {
    const nextClass = createTeacherClassFromPersistedClass(classItem);
    if (!nextClass) {
      return classesByCourse;
    }

    return {
      ...classesByCourse,
      [nextClass.courseId]: [...(classesByCourse[nextClass.courseId] ?? []), nextClass],
    };
  }, {});
}

export function createTeacherClassFromPersistedClass(
  classItem: NonNullable<TeachingCourseListResponse["classes"]>[number],
): TeacherClassItem | undefined {
  const classId = classItem.classId?.trim();
  const courseId = classItem.courseId?.trim();
  const className = classItem.className?.trim();
  const invitationCode = classItem.invitationCode?.trim();
  if (!classId || !courseId || !className || !invitationCode) {
    return undefined;
  }

  return {
    id: classId,
    courseId,
    name: className,
    students: classItem.students ?? 0,
    semester: classItem.semester?.trim() || "",
    invitationCode,
  };
}

export function createTeacherMembershipsByClassFromPersistedMemberships(
  memberships: NonNullable<TeachingCourseListResponse["memberships"]>,
) {
  return memberships.reduce<Record<string, TeacherClassMembershipItem[]>>(
    (membershipsByClass, membership) => {
      const nextMembership = createTeacherMembershipFromPersistedMembership(membership);
      if (!nextMembership) {
        return membershipsByClass;
      }

      return {
        ...membershipsByClass,
        [nextMembership.classId]: [
          ...(membershipsByClass[nextMembership.classId] ?? []),
          nextMembership,
        ],
      };
    },
    {},
  );
}

export function createTeacherMembershipFromPersistedMembership(
  membership: NonNullable<TeachingCourseListResponse["memberships"]>[number],
): TeacherClassMembershipItem | undefined {
  const membershipId = membership.membershipId?.trim();
  const courseId = membership.courseId?.trim();
  const classId = membership.classId?.trim();
  const invitationCode = membership.invitationCode?.trim();
  const studentId = membership.studentId?.trim();
  const studentDisplayName = membership.studentDisplayName?.trim();
  const membershipStatus =
    membership.membershipStatus === "approved" ? "approved" : "pending-teacher-review";
  if (!membershipId || !courseId || !classId || !invitationCode || !studentId || !studentDisplayName) {
    return undefined;
  }

  return {
    id: membershipId,
    courseId,
    classId,
    invitationCode,
    studentId,
    studentDisplayName,
    membershipStatus,
    ...(typeof membership.joinedAt === "string" ? { joinedAt: membership.joinedAt } : {}),
    ...(typeof membership.approvedAt === "string" ? { approvedAt: membership.approvedAt } : {}),
  };
}

export function mergeTeacherCoursesById(
  persistedCourses: TeacherCourse[],
  currentCourses: TeacherCourse[],
) {
  const persistedCourseIds = new Set(persistedCourses.map((course) => course.id));
  return [
    ...persistedCourses,
    ...currentCourses.filter((course) => !persistedCourseIds.has(course.id)),
  ];
}

export function mergeTeacherClassesByCourseId(
  persistedClasses: Record<string, TeacherClassItem[]>,
  currentClasses: Record<string, TeacherClassItem[]>,
) {
  return Object.entries(persistedClasses).reduce<Record<string, TeacherClassItem[]>>(
    (classesByCourse, [courseId, classes]) => {
      const persistedClassIds = new Set(classes.map((classItem) => classItem.id));
      return {
        ...classesByCourse,
        [courseId]: [
          ...classes,
          ...(classesByCourse[courseId] ?? []).filter(
            (classItem) => !persistedClassIds.has(classItem.id),
          ),
        ],
      };
    },
    { ...currentClasses },
  );
}

export function mergeTeacherMembershipsByClassId(
  persistedMemberships: Record<string, TeacherClassMembershipItem[]>,
  currentMemberships: Record<string, TeacherClassMembershipItem[]>,
) {
  return Object.entries(persistedMemberships).reduce<Record<string, TeacherClassMembershipItem[]>>(
    (membershipsByClass, [classId, memberships]) => {
      const persistedMembershipIds = new Set(memberships.map((membership) => membership.id));
      return {
        ...membershipsByClass,
        [classId]: [
          ...memberships,
          ...(membershipsByClass[classId] ?? []).filter(
            (membership) => !persistedMembershipIds.has(membership.id),
          ),
        ],
      };
    },
    { ...currentMemberships },
  );
}

export function isMatchingMembershipApprovalResult(input: {
  approvedMembership: TeacherClassMembershipItem;
  requestedMembership: TeacherClassMembershipItem;
  requestedClass: TeacherClassItem;
}) {
  return (
    input.approvedMembership.id === input.requestedMembership.id &&
    input.approvedMembership.classId === input.requestedClass.id &&
    input.approvedMembership.courseId === input.requestedClass.courseId &&
    input.approvedMembership.invitationCode === input.requestedClass.invitationCode &&
    input.approvedMembership.membershipStatus === "approved"
  );
}

export function isPersistedMembershipApprovalReceipt(
  receipt: TeachingClassMembershipApproveResponse["receipt"] | undefined,
  requestedClass: TeacherClassItem,
) {
  return (
    receipt?.action === "approve-class-membership" &&
    receipt.status === "persisted" &&
    typeof receipt.actorId === "string" &&
    receipt.actorId.trim().length > 0 &&
    receipt.courseId === requestedClass.courseId &&
    receipt.classId === requestedClass.id
  );
}
