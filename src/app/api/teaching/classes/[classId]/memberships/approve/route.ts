import {
  approveTeachingClassMemberships,
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

// Approve a whole class's pending memberships in one request.
//
// The per-membership route is still there and still correct, but it is one
// course-row write per student: a 200-student class opening on the first day of
// term is 200 optimistic writes racing each other over the same row, and the
// teacher clicking 200 times. This is one read, one write, one audit event
// carrying the count.
//
// The body is optional. Sent empty, it approves every membership of the class
// that is waiting for review; sent with `membershipIds`, it approves exactly
// those, which is what the workspace does when the teacher has ticked a subset.
export const dynamic = "force-dynamic";

type TeachingClassMembershipBulkApproveRouteContext = {
  params: { classId: string } | Promise<{ classId: string }>;
};

type TeachingClassMembershipBulkApproveHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
};

// A class-sized list, not a corpus-sized one: the whole point of the empty body
// is that a teacher approving everyone does not have to send ids at all.
const maxMembershipIds = 500;
const maxBodyBytes = 40_000;

export const POST = createTeachingClassMembershipBulkApprovePostHandler();

export function createTeachingClassMembershipBulkApprovePostHandler(
  deps: TeachingClassMembershipBulkApproveHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: TeachingClassMembershipBulkApproveRouteContext,
  ) {
    const traceId = readTeachingMembershipSafeTraceId(request);
    let authenticatedTeacher: TeachingClassMembershipRouteTeacher | undefined;
    let classId: string | undefined;
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
      classId = requireSafeTeachingMembershipRouteId(params.classId, "class id");
      const membershipIds = readMembershipIds(await readOptionalJsonBody(request));

      const result = await approveTeachingClassMemberships({
        dataDir: gate.dataDir,
        repository: gate.repository,
        actorId: gate.authenticatedTeacher.actorId,
        classId,
        ...(membershipIds ? { membershipIds } : {}),
        traceId,
        now: deps.now,
        audit: gate.audit,
      });

      return teachingMembershipJsonResponse(200, {
        memberships: result.memberships,
        approvedMembershipIds: result.approvedMembershipIds,
        alreadyApprovedMembershipIds: result.alreadyApprovedMembershipIds,
        ineligibleMembershipIds: result.ineligibleMembershipIds,
        approvedCount: result.approvedCount,
        classItem: result.classItem,
        course: result.course,
        receipt: result.receipt,
        traceId,
        redaction: createTeachingMembershipRedaction(),
      }, traceId);
    } catch (error) {
      return createTeachingMembershipErrorResponse({
        error,
        traceId,
        failureMessage: "Teaching membership bulk approval request failed.",
        ...(authenticatedTeacher ? { authenticatedTeacher } : {}),
        ...(classId ? { resource: { classId } } : {}),
      });
    }
  };
}

// An absent body, an empty body and `{}` all mean "approve everyone waiting".
// Only an explicit `membershipIds` array narrows the request.
async function readOptionalJsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new TeachingCourseManagementStoreError(
      413,
      "Teaching membership bulk approval request body is too large.",
    );
  }
  if (!text.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TeachingCourseManagementStoreError(
      400,
      "Teaching membership bulk approval request body must be JSON.",
    );
  }
}

function readMembershipIds(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Teaching membership bulk approval request body must be an object.",
    );
  }
  const membershipIds = (value as { membershipIds?: unknown }).membershipIds;
  if (membershipIds === undefined) {
    return undefined;
  }
  if (!Array.isArray(membershipIds) || membershipIds.length === 0) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Teaching membership bulk approval membership ids must be a non-empty array.",
    );
  }
  if (membershipIds.length > maxMembershipIds) {
    throw new TeachingCourseManagementStoreError(
      400,
      `Teaching membership bulk approval accepts at most ${maxMembershipIds} membership ids.`,
    );
  }
  return membershipIds.map((membershipId) =>
    requireSafeTeachingMembershipRouteId(membershipId, "membership id"),
  );
}
