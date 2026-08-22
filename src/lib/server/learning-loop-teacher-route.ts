import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import {
  authorizeLearningLoopTeacherCourse,
  type LearningLoopTeacherCourseAccess,
} from "@/lib/server/learning-loop-access";

export type LearningLoopTeacherActivityScope = {
  courseId: string;
  classId: string;
  lessonKey: string;
};

export type LearningLoopTeacherSubmissionScope = LearningLoopTeacherActivityScope & {
  activityId: string;
  currentVersionId: string;
};

type TeacherAuthorize = (input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  courseId: string;
  lessonKey?: string;
}) => Promise<LearningLoopTeacherCourseAccess>;

export async function authorizeLearningLoopTeacherActivity(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  activityId: string;
  readActivityScope?: (input: {
    activityId: string;
  }) => Promise<LearningLoopTeacherActivityScope>;
  authorize?: TeacherAuthorize;
}) {
  const store = input.readActivityScope
    ? undefined
    : createUaisLearningLoopPostgresReadStore({ env: input.env });
  const scope = await (input.readActivityScope ?? store!.readActivityScope)({
    activityId: input.activityId,
  });
  return authorizeTeacherScope({ ...input, scope });
}

export async function authorizeLearningLoopTeacherSubmission(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  submissionId: string;
  readSubmissionScope?: (input: {
    submissionId: string;
  }) => Promise<LearningLoopTeacherSubmissionScope>;
  authorize?: TeacherAuthorize;
}) {
  const store = input.readSubmissionScope
    ? undefined
    : createUaisLearningLoopPostgresReadStore({ env: input.env });
  const scope = await (input.readSubmissionScope ?? store!.readSubmissionScope)({
    submissionId: input.submissionId,
  });
  return authorizeTeacherScope({ ...input, scope });
}

async function authorizeTeacherScope<Scope extends LearningLoopTeacherActivityScope>(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  scope: Scope;
  authorize?: TeacherAuthorize;
}) {
  const access = await (input.authorize ?? authorizeLearningLoopTeacherCourse)({
    request: input.request,
    env: input.env,
    now: input.now,
    fetch: input.fetch,
    courseId: input.scope.courseId,
    lessonKey: input.scope.lessonKey,
  });
  if (access.status === "denied") return { access, scope: input.scope };
  if (!access.classes.some((item) => item.externalId === input.scope.classId)) {
    return {
      access: {
        status: "denied" as const,
        reasonCode: "teacher-target-class-required" as const,
      },
      scope: input.scope,
    };
  }
  return { access, scope: input.scope };
}
