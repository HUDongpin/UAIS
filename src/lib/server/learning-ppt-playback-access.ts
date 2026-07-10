import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  TeachingCourseManagementStoreError,
} from "@/lib/server/teaching-course-management-store";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

type LearningPptPlaybackAccessReason =
  | "student-session-required"
  | "student-or-teacher-role-required"
  | "student-course-membership-required"
  | "student-course-membership-not-approved"
  | "teacher-course-ownership-required";

type LearningPptPlaybackActor = {
  actorId: string;
  role: "student" | "teacher" | "admin";
};

type LearningPptPlaybackAccessResource = {
  courseId: string;
};

export type LearningPptPlaybackAccessDecision =
  | {
      status: "authorized";
      reasonCode: "student-course-membership-approved";
      actor: LearningPptPlaybackActor;
      resource: LearningPptPlaybackAccessResource;
      membershipId: string;
      classId: string;
      responsibleSession: "S12";
      redaction: ReturnType<typeof createRedaction>;
    }
  | {
      status: "authorized";
      reasonCode: "teacher-course-ownership-approved";
      actor: LearningPptPlaybackActor;
      resource: LearningPptPlaybackAccessResource;
      responsibleSession: "S12";
      redaction: ReturnType<typeof createRedaction>;
    }
  | {
      status: "denied";
      reasonCode: LearningPptPlaybackAccessReason;
      actor?: LearningPptPlaybackActor;
      resource: LearningPptPlaybackAccessResource;
      responsibleSession: "S12";
      redaction: ReturnType<typeof createRedaction>;
    };

export async function authorizeLearningPptPlaybackAccess(input: {
  request: Request;
  env: Record<string, string | undefined>;
  courseId: string;
  now?: Date;
  fetch?: typeof fetch;
}): Promise<LearningPptPlaybackAccessDecision> {
  const resource = { courseId: input.courseId };
  const user = getUaisAppSessionUserFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  if (!user) {
    return createDeniedAccess("student-session-required", resource);
  }

  const actor = {
    actorId: user.account,
    role: user.role,
  };
  if (actor.role === "admin") {
    return createDeniedAccess("student-or-teacher-role-required", resource, actor);
  }

  const repository = createUaisTeachingCourseManagementRepository({
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
      return createDeniedAccess("teacher-course-ownership-required", resource, actor);
    }

    return {
      status: "authorized",
      reasonCode: "teacher-course-ownership-approved",
      actor,
      resource,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
  }

  const membership = database.memberships.find(
    (item) => item.studentId === user.account && item.courseId === input.courseId,
  );
  if (!membership) {
    return createDeniedAccess("student-course-membership-required", resource, actor);
  }
  if (membership.membershipStatus !== "approved") {
    return createDeniedAccess("student-course-membership-not-approved", resource, actor);
  }

  return {
    status: "authorized",
    reasonCode: "student-course-membership-approved",
    actor,
    resource,
    membershipId: membership.membershipId,
    classId: membership.classId,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

export function createLearningPptPlaybackAccessDeniedResponse(input: {
  access: Extract<LearningPptPlaybackAccessDecision, { status: "denied" }>;
  traceId: string;
}) {
  return createLearningPptPlaybackJsonResponse(
    input.access.reasonCode === "student-session-required" ? 401 : 403,
    {
      error: createAccessDeniedMessage(input.access.reasonCode),
      traceId: input.traceId,
      access: input.access,
      redaction: createRedaction(),
    },
    input.traceId,
  );
}

export function createLearningPptPlaybackStoreErrorResponse(input: {
  error: unknown;
  traceId: string;
}) {
  if (!(input.error instanceof TeachingCourseManagementStoreError)) {
    return undefined;
  }

  return createLearningPptPlaybackJsonResponse(
    input.error.status,
    {
      error: input.error.message,
      traceId: input.traceId,
      redaction: createRedaction(),
    },
    input.traceId,
  );
}

export function createLearningPptPlaybackJsonResponse(
  status: number,
  body: unknown,
  traceId: string,
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
    },
  });
}

export function readSafeLearningPptPlaybackTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-learning-ppt-playback-${crypto.randomUUID()}`;
}

function createDeniedAccess(
  reasonCode: LearningPptPlaybackAccessReason,
  resource: LearningPptPlaybackAccessResource,
  actor?: LearningPptPlaybackActor,
): Extract<LearningPptPlaybackAccessDecision, { status: "denied" }> {
  return {
    status: "denied",
    reasonCode,
    ...(actor ? { actor } : {}),
    resource,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function createAccessDeniedMessage(reasonCode: LearningPptPlaybackAccessReason) {
  if (reasonCode === "student-session-required") {
    return "UAIS learning PPT playback app session is required.";
  }
  if (reasonCode === "student-course-membership-not-approved") {
    return "UAIS learning PPT playback requires approved course membership.";
  }
  if (reasonCode === "teacher-course-ownership-required") {
    return "UAIS learning PPT playback requires teaching course ownership.";
  }
  if (reasonCode === "student-or-teacher-role-required") {
    return "UAIS learning PPT playback requires a learner or teacher role.";
  }
  return "UAIS learning PPT playback course membership is required.";
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "published-learning-ids-only",
  };
}
