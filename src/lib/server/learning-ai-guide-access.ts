import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  type TeachingCourseManagementRepository,
} from "@/lib/server/teaching-course-management-store";
import { isPublishedDemoTeacherCourseAccess } from "@/lib/server/published-demo-course-access";

type LearningAiGuideCourseAccessReason =
  | "course-context-required"
  | "student-or-teacher-role-required"
  | "student-course-membership-required"
  | "student-course-membership-not-approved"
  | "teacher-course-ownership-required";

type LearningAiGuideCourseAccessActor = {
  actorId: string;
  role: "student" | "teacher" | "admin";
};

type LearningAiGuideCourseAccessResource = {
  courseId: string;
} | {
  resourceType: "learning-ai-guide-course-context";
};

export type LearningAiGuideCourseAccessDecision =
  | {
      status: "authorized";
      reasonCode:
        | "student-course-membership-approved"
        | "teacher-course-ownership-approved"
        | "teacher-demo-published-playback-approved";
      actor: LearningAiGuideCourseAccessActor;
      resource: LearningAiGuideCourseAccessResource;
      membershipId?: string;
      responsibleSession: "S12";
      redaction: ReturnType<typeof createLearningAiGuideAccessRedaction>;
    }
  | {
      status: "denied";
      reasonCode: LearningAiGuideCourseAccessReason;
      actor: LearningAiGuideCourseAccessActor;
      resource: LearningAiGuideCourseAccessResource;
      responsibleSession: "S12";
      redaction: ReturnType<typeof createLearningAiGuideAccessRedaction>;
    };

export async function authorizeLearningAiGuideCourseAccess(input: {
  appSession: {
    account: string;
    role: "teacher" | "student" | "admin";
  };
  env: Record<string, string | undefined>;
  courseId: string;
  fetch?: typeof fetch;
  repository?: TeachingCourseManagementRepository;
}): Promise<LearningAiGuideCourseAccessDecision> {
  const actor = {
    actorId: input.appSession.account,
    role: input.appSession.role,
  };
  const resource = { courseId: input.courseId };
  if (actor.role === "admin") {
    return createDeniedAccess("student-or-teacher-role-required", actor, resource);
  }

  if (
    isPublishedDemoTeacherCourseAccess({
      actor,
      courseId: input.courseId,
      env: input.env,
    })
  ) {
    return {
      status: "authorized",
      reasonCode: "teacher-demo-published-playback-approved",
      actor,
      resource,
      responsibleSession: "S12",
      redaction: createLearningAiGuideAccessRedaction(),
    };
  }

  const repository =
    input.repository ??
    createUaisTeachingCourseManagementRepository({
      env: input.env,
      fetch: input.fetch,
    });

  if (!repository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(input.env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository,
  });

  if (actor.role === "teacher") {
    const course = database.courses.find((item) => item.courseId === input.courseId);
    if (!course || course.ownerTeacherId !== actor.actorId) {
      return createDeniedAccess("teacher-course-ownership-required", actor, resource);
    }

    return {
      status: "authorized",
      reasonCode: "teacher-course-ownership-approved",
      actor,
      resource,
      responsibleSession: "S12",
      redaction: createLearningAiGuideAccessRedaction(),
    };
  }

  const membership = database.memberships.find(
    (item) => item.studentId === actor.actorId && item.courseId === input.courseId,
  );
  if (!membership) {
    return createDeniedAccess("student-course-membership-required", actor, resource);
  }
  if (membership.membershipStatus !== "approved") {
    return createDeniedAccess("student-course-membership-not-approved", actor, resource);
  }

  return {
    status: "authorized",
    reasonCode: "student-course-membership-approved",
    actor,
    resource,
    membershipId: membership.membershipId,
    responsibleSession: "S12",
    redaction: createLearningAiGuideAccessRedaction(),
  };
}

export function createLearningAiGuideAccessDeniedResponse(input: {
  access: Extract<LearningAiGuideCourseAccessDecision, { status: "denied" }>;
  traceId?: string;
}) {
  return Response.json(
    {
      error: createLearningAiGuideAccessDeniedMessage(input.access.reasonCode),
      ...(input.traceId ? { traceId: input.traceId } : {}),
      access: input.access,
      redaction: createLearningAiGuideAccessRedaction(),
    },
    {
      status: 403,
      headers: {
        "cache-control": "no-store",
        ...(input.traceId ? { "x-uais-trace-id": input.traceId } : {}),
      },
    },
  );
}

export function createLearningAiGuideAccessDeniedMessage(
  reasonCode: LearningAiGuideCourseAccessReason,
) {
  if (reasonCode === "course-context-required") {
    return "UAIS learning AI guide requires course context.";
  }
  if (reasonCode === "teacher-course-ownership-required") {
    return "UAIS learning AI guide requires teaching course ownership.";
  }
  if (reasonCode === "student-or-teacher-role-required") {
    return "UAIS learning AI guide requires a learner or teacher role.";
  }
  return "UAIS learning AI guide requires approved course membership.";
}

export function createLearningAiGuideCourseContextRequiredAccessDecision(input: {
  appSession: {
    account: string;
    role: "teacher" | "student" | "admin";
  };
}): Extract<LearningAiGuideCourseAccessDecision, { status: "denied" }> {
  return createDeniedAccess(
    "course-context-required",
    {
      actorId: input.appSession.account,
      role: input.appSession.role,
    },
    { resourceType: "learning-ai-guide-course-context" },
  );
}

export function createLearningAiGuideAccessRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function createDeniedAccess(
  reasonCode: LearningAiGuideCourseAccessReason,
  actor: LearningAiGuideCourseAccessActor,
  resource: LearningAiGuideCourseAccessResource,
): Extract<LearningAiGuideCourseAccessDecision, { status: "denied" }> {
  return {
    status: "denied",
    reasonCode,
    actor,
    resource,
    responsibleSession: "S12",
    redaction: createLearningAiGuideAccessRedaction(),
  };
}
