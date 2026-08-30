import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import { assertTeachingCourseManagementLocalJsonRuntimeAllowed } from "@/lib/server/teaching-course-management-runtime-guard";
import {
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
} from "@/lib/server/teaching-course-management-io";
import type { TeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-types";
import { isPublishedDemoTeacherCourseAccess } from "@/lib/server/published-demo-course-access";

type LearningAiGuideCourseAccessReason =
  | "course-context-required"
  | "student-or-teacher-role-required"
  | "student-course-membership-required"
  | "student-course-membership-not-approved"
  | "teacher-course-ownership-required"
  // Group-room denials (plan D5). A student who is not on the group's member
  // list, or a group that does not belong to the requested course, both answer
  // `student-group-membership-required`: a learner must not be able to probe
  // which group ids exist by reading the denial apart.
  | "student-group-membership-required"
  | "teacher-group-not-found"
  // Publishing, not reading: the teacher participates in a group room but may
  // not mint its public share link. Raised by the share route, which keeps that
  // rule explicitly rather than deriving it from room access.
  | "teacher-group-share-member-only"
  | "feature-not-enabled";

type LearningAiGuideCourseAccessActor = {
  actorId: string;
  role: "student" | "teacher" | "admin";
};

type LearningAiGuideCourseAccessResource = {
  courseId: string;
  groupId?: string;
} | {
  resourceType: "learning-ai-guide-course-context";
};

// What a group room needs in order to render itself, already narrowed for the
// client: display names and a server-computed `isSelf`, never a student account
// id. The authorizer builds it because it is the only place that has both the
// loaded snapshot and the calling actor, so the route needs no second read.
export type LearningChatroomGroupProjection = {
  groupId: string;
  groupName: string;
  classId?: string;
  members: Array<{ displayName: string; isSelf: boolean }>;
};

export type LearningAiGuideCourseAccessDecision =
  | {
      status: "authorized";
      reasonCode:
        | "student-course-membership-approved"
        | "teacher-course-ownership-approved"
        | "teacher-demo-published-playback-approved"
        | "student-group-membership-approved"
        | "teacher-group-participant-approved";
      actor: LearningAiGuideCourseAccessActor;
      resource: LearningAiGuideCourseAccessResource;
      membershipId?: string;
      group?: LearningChatroomGroupProjection;
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
  // Present only for group chatroom rooms. When set, the course gate below runs
  // exactly as it always has and a second group gate is layered on top of the
  // SAME snapshot, so a group room costs no extra store read.
  groupId?: string;
  fetch?: typeof fetch;
  repository?: TeachingCourseManagementRepository;
  timingNow?: () => number;
  onTiming?: (span: {
    name: "backend" | "pool";
    durationMs: number;
  }) => void;
}): Promise<LearningAiGuideCourseAccessDecision> {
  const actor = {
    actorId: input.appSession.account,
    role: input.appSession.role,
  };
  const resource = {
    courseId: input.courseId,
    ...(input.groupId ? { groupId: input.groupId } : {}),
  };
  if (actor.role === "admin") {
    return createDeniedAccess("student-or-teacher-role-required", actor, resource);
  }

  if (
    // The demo shortcut answers without reading the store at all, so it cannot
    // resolve a group. A group request therefore always takes the full path:
    // there is no demo group room, and a shortcut here would authorize one.
    !input.groupId &&
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
      timingNow: input.timingNow,
      onTiming: input.onTiming,
    });

  if (!repository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }

  // Scoped to the requested course. This runs on every 2.5s chatroom poll, and
  // it used to pull the whole deployment's course management - every course,
  // class, membership, group and audit event - to answer a question about one
  // course. Since the per-course re-key it reads one row.
  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(
      input.env.UAIS_TEACHING_COURSES_DATA_DIR,
    ),
    repository,
    courseId: input.courseId,
  });

  // The group record is looked up once, off the snapshot the course gate already
  // loaded, and reused by both role branches below.
  const group = input.groupId
    ? database.learningGroups?.find(
        (item) => item.groupId === input.groupId && item.courseId === input.courseId,
      )
    : undefined;

  if (actor.role === "teacher") {
    const course = database.courses.find((item) => item.courseId === input.courseId);
    if (!course || course.ownerTeacherId !== actor.actorId) {
      return createDeniedAccess("teacher-course-ownership-required", actor, resource);
    }

    if (input.groupId) {
      if (!group) {
        return createDeniedAccess("teacher-group-not-found", actor, resource);
      }

      // The course-owning teacher is a full participant in their own course's
      // group rooms - they read and they speak (owner decision: teaching
      // presence). Their turns are attributed as the instructor by the route,
      // which stamps `authorRole` from the session rather than from the body.
      return {
        status: "authorized",
        reasonCode: "teacher-group-participant-approved",
        actor,
        resource,
        group: createLearningChatroomGroupProjection(group, actor.actorId),
        responsibleSession: "S12",
        redaction: createLearningAiGuideAccessRedaction(),
      };
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

  if (input.groupId) {
    // A student may belong to several groups in one course, so membership is
    // always resolved against the explicitly requested group and never against
    // "the student's group".
    if (!group?.members.some((member) => member.studentId === actor.actorId)) {
      return createDeniedAccess("student-group-membership-required", actor, resource);
    }

    return {
      status: "authorized",
      reasonCode: "student-group-membership-approved",
      actor,
      resource,
      membershipId: membership.membershipId,
      group: createLearningChatroomGroupProjection(group, actor.actorId),
      responsibleSession: "S12",
      redaction: createLearningAiGuideAccessRedaction(),
    };
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

// The feature flag is checked by the route (it costs no store read), but its
// denial is minted here so a disabled group request answers in exactly the same
// `access` envelope as every other chatroom denial.
export function createLearningChatroomGroupsDisabledAccessDecision(input: {
  appSession: {
    account: string;
    role: "teacher" | "student" | "admin";
  };
  courseId: string;
  groupId: string;
}): Extract<LearningAiGuideCourseAccessDecision, { status: "denied" }> {
  return createDeniedAccess(
    "feature-not-enabled",
    {
      actorId: input.appSession.account,
      role: input.appSession.role,
    },
    { courseId: input.courseId, groupId: input.groupId },
  );
}

function createLearningChatroomGroupProjection(
  group: {
    groupId: string;
    groupName: string;
    classId?: string;
    members: Array<{ studentId: string; studentDisplayName: string }>;
  },
  actorId: string,
): LearningChatroomGroupProjection {
  return {
    groupId: group.groupId,
    groupName: group.groupName,
    ...(group.classId ? { classId: group.classId } : {}),
    // Display names only. The student account ids stay on the server: they are
    // the room's authorization key, and a roster is not a reason to publish them.
    members: group.members.map((member) => ({
      displayName: member.studentDisplayName,
      isSelf: member.studentId === actorId,
    })),
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
  if (reasonCode === "student-group-membership-required") {
    return "UAIS learning chatroom requires assigned group membership.";
  }
  if (reasonCode === "teacher-group-not-found") {
    return "UAIS learning chatroom group was not found in this course.";
  }
  if (reasonCode === "teacher-group-share-member-only") {
    return "UAIS learning chatroom group share links are minted by group members.";
  }
  if (reasonCode === "feature-not-enabled") {
    return "UAIS learning chatroom group rooms are not enabled.";
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
