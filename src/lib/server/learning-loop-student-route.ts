import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import { authorizeLearningLoopStudentCourse } from "@/lib/server/learning-loop-access";

export type LearningLoopStudentAccess = Awaited<
  ReturnType<typeof authorizeLearningLoopStudentCourse>
>;

export type LearningLoopActivityScope = {
  courseId: string;
  classId: string;
  lessonKey: string;
};

export async function authorizeLearningLoopStudentActivity(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  activityId: string;
  readActivityScope?: (input: {
    activityId: string;
  }) => Promise<LearningLoopActivityScope>;
  authorize?: (input: {
    request: Request;
    env: Record<string, string | undefined>;
    now?: Date;
    fetch?: typeof fetch;
    courseId: string;
  }) => Promise<LearningLoopStudentAccess>;
}) {
  const readStore = input.readActivityScope
    ? undefined
    : createUaisLearningLoopPostgresReadStore({ env: input.env });
  const scope = await (input.readActivityScope ?? readStore!.readActivityScope)({
    activityId: input.activityId,
  });
  const access = await (input.authorize ?? authorizeLearningLoopStudentCourse)({
    request: input.request,
    env: input.env,
    now: input.now,
    fetch: input.fetch,
    courseId: scope.courseId,
  });
  if (access.status === "denied") return { access, scope };
  if (access.courseId !== scope.courseId || access.classId !== scope.classId) {
    return {
      access: {
        status: "denied" as const,
        reasonCode: "student-activity-membership-required" as const,
      },
      scope,
    };
  }
  return { access, scope };
}
