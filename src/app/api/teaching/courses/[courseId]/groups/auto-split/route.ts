import {
  autoSplitTeachingLearningGroups,
  readTeachingCourseManagementSnapshot,
  readTeachingLearningGroupValidation,
  teachingLearningGroupMaxMembers,
  teachingLearningGroupMinMembers,
  TeachingCourseManagementStoreError,
} from "@/lib/server/teaching-course-management-store";
import {
  createTeachingMembershipErrorResponse,
  createTeachingMembershipRedaction,
  openTeachingClassMembershipRequest,
  readTeachingMembershipSafeTraceId,
  requireSafeTeachingMembershipRouteId,
  teachingMembershipJsonResponse,
  type TeachingClassMembershipRouteTeacher,
} from "@/lib/server/teaching-class-membership-route-guards";

// Split every approved, ungrouped student of a course into groups of K.
//
// A static segment beside the `[groupId]` record route: Next resolves
// /groups/auto-split here rather than treating "auto-split" as a group id.
//
// The teacher-facing alternative is creating each group by hand, which at 200
// students is 30+ requests, 30+ writes of the same course row, and a real chance
// of putting one student in two groups by accident - which the create/update
// routes now refuse outright. See autoSplitTeachingLearningGroups for the
// remainder rule.
export const dynamic = "force-dynamic";

type TeachingLearningGroupAutoSplitRouteContext = {
  params: { courseId: string } | Promise<{ courseId: string }>;
};

type TeachingLearningGroupAutoSplitHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
};

const maxBodyBytes = 4_000;

export const POST = createTeachingLearningGroupAutoSplitPostHandler();

export function createTeachingLearningGroupAutoSplitPostHandler(
  deps: TeachingLearningGroupAutoSplitHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: TeachingLearningGroupAutoSplitRouteContext,
  ) {
    const traceId = readTeachingMembershipSafeTraceId(request);
    let authenticatedTeacher: TeachingClassMembershipRouteTeacher | undefined;
    let courseId: string | undefined;
    try {
      const gate = openTeachingClassMembershipRequest({
        request,
        env,
        traceId,
        now: deps.now,
        fetch: deps.fetch,
      });
      if (gate.status === "response") {
        return gate.response;
      }
      authenticatedTeacher = gate.authenticatedTeacher;

      const params = await context.params;
      courseId = requireSafeTeachingMembershipRouteId(params.courseId, "course id");
      // Course ownership is proven from the snapshot BEFORE the body is read, the
      // same order the sibling group routes use.
      const denied = await denyUnownedCourse({
        dataDir: gate.dataDir,
        repository: gate.repository,
        authenticatedTeacher: gate.authenticatedTeacher,
        courseId,
        traceId,
      });
      if (denied) {
        return denied;
      }

      const draft = parseAutoSplitDraft(await readJsonBody(request));
      const { groups, ungroupedStudentCount, receipt } = await autoSplitTeachingLearningGroups({
        dataDir: gate.dataDir,
        repository: gate.repository,
        actorId: gate.authenticatedTeacher.actorId,
        courseId,
        ...(draft.classId ? { classId: draft.classId } : {}),
        groupSize: draft.groupSize,
        traceId,
        now: deps.now,
        audit: gate.audit,
      });

      return teachingMembershipJsonResponse(201, {
        groups,
        groupCount: groups.length,
        ungroupedStudentCount,
        receipt,
        traceId,
        redaction: createTeachingMembershipRedaction(),
      }, traceId);
    } catch (error) {
      return createAutoSplitErrorResponse({
        error,
        traceId,
        ...(authenticatedTeacher ? { authenticatedTeacher } : {}),
        ...(courseId ? { resource: { courseId } } : {}),
      });
    }
  };
}

async function denyUnownedCourse(input: {
  dataDir: string;
  repository?: Parameters<typeof autoSplitTeachingLearningGroups>[0]["repository"];
  authenticatedTeacher: TeachingClassMembershipRouteTeacher;
  courseId: string;
  traceId: string;
}) {
  const snapshot = await readTeachingCourseManagementSnapshot({
    dataDir: input.dataDir,
    repository: input.repository,
    courseId: input.courseId,
  });
  const course = snapshot.database.courses.find((item) => item.courseId === input.courseId);
  if (!course) {
    throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
  }
  if (course.ownerTeacherId === input.authenticatedTeacher.actorId) {
    return undefined;
  }
  return teachingMembershipJsonResponse(403, {
    error: "UAIS teaching learning group course ownership is required.",
    traceId: input.traceId,
    access: {
      status: "denied" as const,
      reasonCode: "teacher-course-ownership-required" as const,
      responsibleSession: "S12" as const,
      actor: {
        actorId: input.authenticatedTeacher.actorId,
        role: input.authenticatedTeacher.role,
      },
      resource: { courseId: input.courseId },
      redaction: createTeachingMembershipRedaction(),
    },
    redaction: createTeachingMembershipRedaction(),
  }, input.traceId);
}

function createAutoSplitErrorResponse(input: {
  error: unknown;
  traceId: string;
  authenticatedTeacher?: TeachingClassMembershipRouteTeacher;
  resource?: Record<string, string>;
}) {
  const validation = readTeachingLearningGroupValidation(input.error);
  if (!validation || !(input.error instanceof TeachingCourseManagementStoreError)) {
    return createTeachingMembershipErrorResponse({
      ...input,
      failureMessage: "Teaching learning group auto-split request failed.",
    });
  }
  return teachingMembershipJsonResponse(input.error.status, {
    error: input.error.message,
    traceId: input.traceId,
    validation,
    redaction: createTeachingMembershipRedaction(),
  }, input.traceId);
}

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new TeachingCourseManagementStoreError(
      413,
      "Teaching learning group auto-split request body is too large.",
    );
  }
  if (!text.trim()) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Teaching learning group auto-split request body is required.",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TeachingCourseManagementStoreError(
      400,
      "Teaching learning group auto-split request body must be JSON.",
    );
  }
}

function parseAutoSplitDraft(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Teaching learning group auto-split request body must be an object.",
    );
  }
  const draft = value as { groupSize?: unknown; classId?: unknown };
  if (typeof draft.groupSize !== "number" || !Number.isSafeInteger(draft.groupSize)) {
    throw new TeachingCourseManagementStoreError(
      400,
      `Teaching learning group auto-split size must be an integer between ${teachingLearningGroupMinMembers} and ${teachingLearningGroupMaxMembers}.`,
    );
  }
  return {
    groupSize: draft.groupSize,
    ...(draft.classId === undefined
      ? {}
      : { classId: requireSafeTeachingMembershipRouteId(draft.classId, "class id") }),
  };
}
