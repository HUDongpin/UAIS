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

// Every touched field records the locale it was typed under, so "did the teacher
// change this?" can always be answered against exactly the string the teacher saw
// in the input at edit time, regardless of later language toggles.
export type CourseSettingsDraftEntry = {
  value: string;
  locale: Locale;
};

// Sparse by design: a field is present only after the teacher edits it. Untouched
// fields stay absent so a locale switch mid-edit cannot turn a stale localized
// string into a phantom rename patch.
export type CourseSettingsDraft = {
  courseName?: CourseSettingsDraftEntry;
  semester?: CourseSettingsDraftEntry;
  description?: CourseSettingsDraftEntry;
};

// Raw field input from the form, before the current locale is stamped onto it.
export type CourseSettingsDraftFieldInput = Partial<Record<CourseSettingsField, string>>;

export type CourseSettingsDraftValues = {
  courseName: string;
  semester: string;
  description: string;
};

// Public save-payload shape: the backend contract stays plain optional strings.
export type CourseSettingsPatchPayload = {
  courseName?: string;
  semester?: string;
  description?: string;
};

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
  // Server-computed feature state (chatroom-groups plan D9).
  // `UAIS_LEARNING_CHATROOM_GROUPS_MODE` is a server-only name, so the decision
  // — never the value — rides the course list the workspace already reads. An
  // absent field is a deployment that predates the flag surface and reads as
  // off, which is the safe direction for a dark rollout.
  features?: {
    learningChatroomGroups?: boolean;
  };
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
  learningChatroomGroupsEnabled: boolean;
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

const courseSettingsFields: CourseSettingsField[] = ["courseName", "semester", "description"];

export type CourseSettingsField = "courseName" | "semester" | "description";

function readPersistedCourseSettingsValue(
  course: TeacherCourse,
  field: CourseSettingsField,
  locale: Locale,
) {
  if (field === "courseName") {
    return readLocalizedText(course.title, locale).trim();
  }
  if (field === "semester") {
    return extractCourseSemester(course, locale).trim();
  }
  // The description field has no persisted baseline: the form opens it empty in
  // every locale, so it carries no stale-localized-string failure mode.
  return "";
}

// Stamps the current locale onto each edited field so the draft records what the
// teacher saw while typing, not just what they typed.
export function createCourseSettingsDraftEntries(
  input: CourseSettingsDraftFieldInput,
  locale: Locale,
): CourseSettingsDraft {
  return courseSettingsFields.reduce<CourseSettingsDraft>((entries, field) => {
    const value = input[field];
    return value === undefined ? entries : { ...entries, [field]: { value, locale } };
  }, {});
}

// Single source of truth for "did the teacher actually edit this field?", shared by
// the form display and the save patch so the two cannot diverge.
//
// A touched field is effectively untouched once its trimmed value equals the
// persisted rendering at ITS OWN stamped locale — exactly the string that sat in the
// input when the teacher typed. That kills the touched-then-reverted phantom rename
// no matter how many times the language is toggled afterwards, and it stays correct
// when the baseline is a locale-specific default fallback, because it never compares
// a value against a rendering the teacher never saw.
export function isEffectivelyUntouchedCourseSettingsDraftEntry(
  course: TeacherCourse,
  field: CourseSettingsField,
  entry: CourseSettingsDraftEntry | undefined,
) {
  if (!entry) {
    return true;
  }

  const normalized = entry.value.trim();
  if (!normalized) {
    // A cleared field is an edit in progress, not an untouched field: keep the
    // input empty instead of snapping the persisted value back under the cursor.
    return false;
  }

  return readPersistedCourseSettingsValue(course, field, entry.locale) === normalized;
}

// Display values for the course-settings form: a field being edited under the locale
// now on screen shows exactly what the teacher typed. An absent field, or one stamped
// under a different locale and effectively untouched, falls back to the persisted value
// read at the current locale, so switching language re-renders it in that language
// instead of freezing the old locale's strings.
export function resolveCourseSettingsDraftValues(
  course: TeacherCourse,
  draft: CourseSettingsDraft | undefined,
  locale: Locale,
): CourseSettingsDraftValues {
  return {
    courseName: resolveCourseSettingsDraftValue(course, "courseName", draft?.courseName, locale),
    semester: resolveCourseSettingsDraftValue(course, "semester", draft?.semester, locale),
    description: resolveCourseSettingsDraftValue(course, "description", draft?.description, locale),
  };
}

function resolveCourseSettingsDraftValue(
  course: TeacherCourse,
  field: CourseSettingsField,
  entry: CourseSettingsDraftEntry | undefined,
  locale: Locale,
) {
  // An entry stamped with the locale currently on screen is the live edit buffer, so it
  // is echoed back byte for byte — no untouched check, no trimming. Running the untouched
  // rule here would compare a TRIMMED value against the persisted rendering, so a value
  // differing only by leading/trailing whitespace would read as untouched and snap the
  // controlled input back mid-keystroke, deleting the character just typed (type a
  // trailing space, then a letter, and the space is eaten).
  //
  // The untouched rule still governs the absent and cross-locale cases, where the
  // question is "should this stale string keep overriding the current locale's
  // rendering?" rather than "what is the teacher typing right now?".
  //
  // Whitespace is only a display concern: createCourseSettingsPatchFromDraft trims
  // independently, so a whitespace-only difference still never reaches the backend.
  if (entry && entry.locale === locale) {
    return entry.value;
  }

  return isEffectivelyUntouchedCourseSettingsDraftEntry(course, field, entry)
    ? readPersistedCourseSettingsValue(course, field, locale)
    : entry?.value ?? "";
}

// Only fields the teacher actually edited are candidates for the patch. The current
// locale is deliberately not a parameter: each entry is compared against the persisted
// rendering at its own stamped locale, so the decision is toggle-invariant and means
// exactly "the teacher changed this from what they saw".
export function createCourseSettingsPatchFromDraft(
  course: TeacherCourse,
  draft: CourseSettingsDraft | undefined,
): CourseSettingsPatchPayload | undefined {
  if (!draft) {
    return undefined;
  }

  const patch: CourseSettingsPatchPayload = courseSettingsFields.reduce<CourseSettingsPatchPayload>(
    (currentPatch, field) => {
      const entry = draft[field];
      const value = entry?.value.trim();
      if (!value || isEffectivelyUntouchedCourseSettingsDraftEntry(course, field, entry)) {
        return currentPatch;
      }
      return { ...currentPatch, [field]: value };
    },
    {},
  );

  return Object.keys(patch).length > 0 ? patch : undefined;
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
    // Compare against the requested membership's own recorded code, not the class code:
    // a membership permanently stores the invite code used at join time, while the class
    // invitation code is mutable (the teacher can republish a fresh code), so a republished
    // class code would otherwise fail this check for every already-pending membership.
    input.approvedMembership.invitationCode === input.requestedMembership.invitationCode &&
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
