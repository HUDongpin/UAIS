import { createPublishedLearningPptPlaybackManifestForCourse } from "@/lib/learning/ppt-playback";
import { authorizeLearningPptPlaybackAccess } from "@/lib/server/learning-ppt-playback-access";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
} from "@/lib/server/teaching-course-management-store";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

export type LearningLoopCourseScope = {
  course: { externalId: string; title: string };
  classes: Array<{ externalId: string; name: string; approvedStudentCount?: number }>;
  lesson?: {
    key: string;
    position: number;
    title: { "zh-CN": string; "en-US": string };
    manifestRef: string;
  };
};

export type LearningLoopTeacherCourseAccess =
  | ({
      status: "authorized";
      teacherAccount: string;
      reasonCode: "teacher-dual-session-course-owner";
    } & LearningLoopCourseScope)
  | {
      status: "denied";
      reasonCode:
        | "teacher-app-session-required"
        | "teacher-write-session-required"
        | "teacher-session-identity-mismatch"
        | "teacher-course-ownership-required"
        | "published-lesson-required";
    };

export async function authorizeLearningLoopTeacherCourse(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  courseId: string;
  lessonKey?: string;
  readCourseScope?: (input: {
    teacherAccount: string;
    courseId: string;
    lessonKey?: string;
  }) => Promise<LearningLoopCourseScope | undefined>;
}): Promise<LearningLoopTeacherCourseAccess> {
  const appClaims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  if (!appClaims || appClaims.role !== "teacher") {
    return { status: "denied", reasonCode: "teacher-app-session-required" };
  }
  const teacherSecret = input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  const teacherSession = teacherSecret
    ? readUaisAuthenticatedTeacherSessionFromSignedCookies({
        request: input.request,
        secret: teacherSecret,
        now: input.now,
      })
    : undefined;
  if (!teacherSession) {
    return { status: "denied", reasonCode: "teacher-write-session-required" };
  }
  if (teacherSession.actorId !== appClaims.account) {
    return { status: "denied", reasonCode: "teacher-session-identity-mismatch" };
  }

  const scope = input.readCourseScope
    ? await input.readCourseScope({
        teacherAccount: appClaims.account,
        courseId: input.courseId,
        ...(input.lessonKey ? { lessonKey: input.lessonKey } : {}),
      })
    : await readDefaultTeacherCourseScope({
        env: input.env,
        fetch: input.fetch,
        teacherAccount: appClaims.account,
        courseId: input.courseId,
        lessonKey: input.lessonKey,
      });
  if (!scope) {
    return { status: "denied", reasonCode: "teacher-course-ownership-required" };
  }
  if (input.lessonKey && scope.lesson?.key !== input.lessonKey) {
    return { status: "denied", reasonCode: "published-lesson-required" };
  }
  return {
    status: "authorized",
    reasonCode: "teacher-dual-session-course-owner",
    teacherAccount: appClaims.account,
    ...scope,
  };
}

export async function authorizeLearningLoopStudentCourse(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  courseId: string;
}) {
  const access = await authorizeLearningPptPlaybackAccess({
    request: input.request,
    env: input.env,
    now: input.now,
    fetch: input.fetch,
    courseId: input.courseId,
  });
  if (
    access.status === "authorized" &&
    access.reasonCode === "student-course-membership-approved"
  ) {
    return {
      status: "authorized" as const,
      reasonCode: "student-course-membership-approved" as const,
      studentAccount: access.actor.actorId,
      courseId: input.courseId,
      classId: access.classId,
    };
  }
  return {
    status: "denied" as const,
    reasonCode:
      access.status === "denied" ? access.reasonCode : "student-course-membership-required",
  };
}

export type LearningLoopStudentDashboardScope = {
  courseId: string;
  courseTitle: string;
  classId: string;
};

export async function authorizeLearningLoopStudentDashboard(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  readDashboardScopes?: (input: {
    studentAccount: string;
  }) => Promise<LearningLoopStudentDashboardScope[]>;
}) {
  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  if (!claims) {
    return { status: "denied" as const, reasonCode: "student-session-required" };
  }
  if (claims.role !== "student") {
    return { status: "denied" as const, reasonCode: "student-role-required" };
  }
  const scopes = input.readDashboardScopes
    ? await input.readDashboardScopes({ studentAccount: claims.account })
    : await readDefaultStudentDashboardScopes({
        env: input.env,
        fetch: input.fetch,
        studentAccount: claims.account,
      });
  return {
    status: "authorized" as const,
    reasonCode: "student-approved-memberships" as const,
    studentAccount: claims.account,
    scopes,
  };
}

async function readDefaultTeacherCourseScope(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  teacherAccount: string;
  courseId: string;
  lessonKey?: string;
}): Promise<LearningLoopCourseScope | undefined> {
  const repository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!repository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }
  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(
      input.env.UAIS_TEACHING_COURSES_DATA_DIR,
    ),
    repository,
    courseId: input.courseId,
  });
  const course = database.courses.find(
    (item) =>
      item.courseId === input.courseId && item.ownerTeacherId === input.teacherAccount,
  );
  if (!course) return undefined;
  const playback = createPublishedLearningPptPlaybackManifestForCourse(input.courseId);
  const lesson = playback
    ? {
        key: playback.learningUnit.lessonKey,
        position: playback.learningUnit.position,
        title: playback.learningUnit.title,
        manifestRef: playback.audioManifestId,
      }
    : undefined;
  if (input.lessonKey && lesson?.key !== input.lessonKey) return undefined;
  return {
    course: { externalId: course.courseId, title: course.courseName },
    classes: database.classes
      .filter(
        (item) =>
          item.courseId === course.courseId &&
          item.ownerTeacherId === input.teacherAccount,
      )
      .map((item) => ({
        externalId: item.classId,
        name: item.className,
        approvedStudentCount: new Set(
          database.memberships
            .filter(
              (membership) =>
                membership.courseId === course.courseId &&
                membership.classId === item.classId &&
                membership.membershipStatus === "approved",
            )
            .map((membership) => membership.studentId),
        ).size,
      })),
    ...(lesson ? { lesson } : {}),
  };
}

async function readDefaultStudentDashboardScopes(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  studentAccount: string;
}) {
  const repository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!repository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }
  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(
      input.env.UAIS_TEACHING_COURSES_DATA_DIR,
    ),
    repository,
  });
  const scopes = database.memberships
    .filter(
      (membership) =>
        membership.studentId === input.studentAccount &&
        membership.membershipStatus === "approved",
    )
    .flatMap((membership) => {
      const course = database.courses.find(
        (item) => item.courseId === membership.courseId,
      );
      const classItem = database.classes.find(
        (item) =>
          item.classId === membership.classId &&
          item.courseId === membership.courseId,
      );
      return course && classItem
        ? [
            {
              courseId: course.courseId,
              courseTitle: course.courseName,
              classId: classItem.classId,
            },
          ]
        : [];
    });
  return Array.from(
    new Map(scopes.map((scope) => [`${scope.courseId}:${scope.classId}`, scope])).values(),
  ).sort((a, b) =>
    `${a.courseId}:${a.classId}`.localeCompare(`${b.courseId}:${b.classId}`),
  );
}
