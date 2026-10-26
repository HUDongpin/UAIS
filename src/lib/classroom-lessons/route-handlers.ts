import {
  authorizeLearningLoopTeacherCourse,
  authorizeLearningLoopStudentDashboard,
} from "@/lib/server/learning-loop-access";
import {
  ClassroomLessonError,
  lessonPackageFromUnitDraft,
  studentLessonContent,
} from "./domain";
import { createClassroomLessonStore } from "./store";
import { draftRequestByteLimit } from "@/lib/teaching/unit-draft-media";
import { LearningLoopValidationError } from "@/lib/learning-loop/domain";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import { readTeachingUnitDraft } from "@/lib/server/teaching-unit-draft-store";
import { resolveTeachingCourseManagementDataDir } from "@/lib/server/teaching-course-management-store";
import { ClassroomRecordRetentionError } from "@/lib/server/classroom-record-retention-store";
import { isSameOriginClassroomRequest } from "@/lib/server/classroom-request-origin";

type Context = { params: Promise<{ courseId: string; lessonKey?: string }> };
type Dependencies = {
  env?: Record<string, string | undefined>;
  teacherAccess?: typeof authorizeLearningLoopTeacherCourse;
  studentAccess?: typeof authorizeLearningLoopStudentDashboard;
  store?: typeof createClassroomLessonStore;
};
function json(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
function failure(error: unknown) {
  if (
    error instanceof ClassroomLessonError ||
    error instanceof ClassroomRecordRetentionError
  )
    return json(error.status, { reasonCode: error.reasonCode });
  if (error instanceof LearningLoopValidationError)
    return json(400, { reasonCode: error.code });
  return json(503, { reasonCode: "classroom-lesson-unavailable" });
}
function safeKey(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9_.-]{1,160}$/.test(value))
    throw new ClassroomLessonError(400, "lesson-key-invalid");
  return value;
}
async function body(request: Request) {
  if (!isSameOriginClassroomRequest(request))
    throw new ClassroomLessonError(403, "same-origin-required");
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ClassroomLessonError(415, "json-required");
  const value = await request.text();
  if (Buffer.byteLength(value) > draftRequestByteLimit)
    throw new ClassroomLessonError(413, "lesson-package-too-large");
  try {
    const input = JSON.parse(value);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw Error();
    return input as Record<string, unknown>;
  } catch {
    throw new ClassroomLessonError(400, "lesson-request-invalid");
  }
}
function strings(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new ClassroomLessonError(400, "lesson-selection-invalid");
  return value as string[];
}
function requestKey(request: Request) {
  return request.headers.get("idempotency-key")?.trim() ?? "";
}

export function createTeacherLessonsHandler(
  action: "list" | "import" | "read" | "save" | "publish",
  deps: Dependencies = {},
) {
  return async (request: Request, context: Context) => {
    try {
      const { courseId, lessonKey } = await context.params;
      safeKey(courseId);
      const env = deps.env ?? process.env;
      const access = await (
        deps.teacherAccess ?? authorizeLearningLoopTeacherCourse
      )({ request, env, courseId });
      if (access.status !== "authorized")
        return json(access.reasonCode.includes("session") ? 401 : 403, {
          reasonCode: access.reasonCode,
        });
      const owner = { teacherAccount: access.teacherAccount, courseId };
      if (action === "publish") {
        const input = await body(request);
        const targetClassIds = strings(input.targetClassIds);
        const taskIds = strings(input.taskIds);
        if (
          targetClassIds.some(
            (id) => !access.classes.some((item) => item.externalId === id),
          )
        )
          throw new ClassroomLessonError(403, "teacher-target-class-required");
        const receipt = await (deps.store ?? createClassroomLessonStore)({
          env,
        }).publish({
          ...owner,
          lessonKey: safeKey(lessonKey),
          expectedRevision: Number(input.expectedRevision),
          targetClasses: access.classes.filter((item) =>
            targetClassIds.includes(item.externalId),
          ),
          taskIds,
          idempotencyKey: requestKey(request),
        });
        return json(200, { receipt });
      }
      const store = (deps.store ?? createClassroomLessonStore)({ env });
      if (action === "list")
        return json(200, {
          lessons: await store.listTeacher(owner),
          classes: access.classes,
        });
      if (action === "read") {
        const lesson = await store.readTeacher({
          ...owner,
          lessonKey: safeKey(lessonKey),
        });
        return json(
          200,
          new URL(request.url).searchParams.get("preview") === "true"
            ? { content: studentLessonContent(lesson.package) }
            : { lesson },
        );
      }
      const input = await body(request);
      if (action === "save")
        return json(
          200,
          await store.saveDraft({
            ...owner,
            lessonKey: safeKey(lessonKey),
            package: input.package,
            expectedRevision: Number(input.expectedRevision),
          }),
        );
      let imported = input.package;
      if (input.source === "blank") {
        imported = {
          schemaVersion: 1,
          primaryLocale: input.locale === "en-US" ? "en-US" : "zh-CN",
          studentContent: {
            title: "",
            objectives: [],
            body: "",
            questions: [],
          },
          teacherGuide: { notes: "", answers: [] },
          tasks: [],
        };
      }
      if (input.source === "saved-unit-draft") {
        const source = await readTeachingUnitDraft({
          dataDir: resolveTeachingCourseManagementDataDir(
            env.UAIS_TEACHING_COURSES_DATA_DIR,
          ),
          repository: createUaisTeachingCourseManagementRepository({ env }),
          actorId: owner.teacherAccount,
          courseId,
        });
        if (!source?.content)
          throw new ClassroomLessonError(404, "lesson-source-draft-incomplete");
        imported = lessonPackageFromUnitDraft(
          source.content,
          input.locale === "en-US" ? "en-US" : "zh-CN",
        );
      }
      return json(
        201,
        await store.importPackage({
          ...owner,
          courseTitle: access.course.title,
          package: imported,
          idempotencyKey: requestKey(request),
          ...(input.source === "blank" ? { allowIncomplete: true } : {}),
        }),
      );
    } catch (error) {
      return failure(error);
    }
  };
}

export function createStudentLessonsHandler(
  action: "list" | "read",
  deps: Dependencies = {},
) {
  return async (request: Request, context: Context) => {
    try {
      const { courseId, lessonKey } = await context.params;
      safeKey(courseId);
      const env = deps.env ?? process.env;
      const access = await (
        deps.studentAccess ?? authorizeLearningLoopStudentDashboard
      )({ request, env });
      if (access.status !== "authorized")
        return json(
          access.reasonCode === "student-session-required" ? 401 : 403,
          { reasonCode: access.reasonCode },
        );
      const query = new URL(request.url).searchParams;
      const requestedClass = query.get("classId");
      const scope = access.scopes.find(
        (item) =>
          item.courseId === courseId &&
          (!requestedClass || item.classId === requestedClass),
      );
      if (!scope)
        throw new ClassroomLessonError(
          403,
          "student-course-membership-required",
        );
      const store = (deps.store ?? createClassroomLessonStore)({ env });
      if (action === "list")
        return json(200, {
          classId: scope.classId,
          lessons: await store.listStudent({
            courseId,
            classId: scope.classId,
          }),
        });
      const activityId = query.get("activityId") ?? undefined;
      if (
        activityId &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          activityId,
        )
      )
        throw new ClassroomLessonError(400, "activity-id-invalid");
      const lesson = await store.readStudent({
        courseId,
        classId: scope.classId,
        lessonKey: safeKey(lessonKey),
        studentAccount: access.studentAccount,
        activityId,
      });
      return lesson
        ? json(200, { lesson })
        : json(404, { reasonCode: "published-classroom-lesson-required" });
    } catch (error) {
      return failure(error);
    }
  };
}
