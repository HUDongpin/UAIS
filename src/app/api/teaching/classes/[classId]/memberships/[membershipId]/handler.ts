import {
  setTeachingClassMembershipStatus,
  type TeachingClassMembershipTerminalStatus,
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

// Reject a pending join request, or remove an approved student from a class.
//
// PATCH on the membership itself rather than two more `/reject` and `/remove`
// action routes: both are the same one-field state change, they share every line
// of validation, and the sibling learning-group record route already established
// PATCH-with-a-body as this tree's shape for "change this record". DELETE was
// the other candidate and is refused on purpose - the row is not deleted, it is
// closed and kept, because the audit trail and the student's ability to see what
// happened both depend on it still being there.
//
// Removing an approved student also frees their learning-group seats, inside the
// same write. See setTeachingClassMembershipStatus.
type TeachingClassMembershipRouteContext = {
  params: Promise<{ classId: string; membershipId: string }>;
};

type TeachingClassMembershipPatchHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
};

const maxBodyBytes = 4_000;

export function createTeachingClassMembershipPatchHandler(
  deps: TeachingClassMembershipPatchHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function PATCH(
    request: Request,
    context: TeachingClassMembershipRouteContext,
  ) {
    const traceId = readTeachingMembershipSafeTraceId(request);
    let authenticatedTeacher: TeachingClassMembershipRouteTeacher | undefined;
    let routeParams: { classId: string; membershipId: string } | undefined;
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
      routeParams = {
        classId: requireSafeTeachingMembershipRouteId(params.classId, "class id"),
        membershipId: requireSafeTeachingMembershipRouteId(
          params.membershipId,
          "membership id",
        ),
      };
      const membershipStatus = readTerminalMembershipStatus(await readJsonBody(request));

      const { membership, classItem, course, releasedGroupIds, receipt } =
        await setTeachingClassMembershipStatus({
          dataDir: gate.dataDir,
          repository: gate.repository,
          actorId: gate.authenticatedTeacher.actorId,
          classId: routeParams.classId,
          membershipId: routeParams.membershipId,
          membershipStatus,
          traceId,
          now: deps.now,
          audit: gate.audit,
        });

      return teachingMembershipJsonResponse(200, {
        membership,
        classItem,
        course,
        // Which groups lost a member, so the workspace can refresh exactly those
        // rather than re-reading the whole course.
        releasedGroupIds,
        receipt,
        traceId,
        redaction: createTeachingMembershipRedaction(),
      }, traceId);
    } catch (error) {
      return createTeachingMembershipErrorResponse({
        error,
        traceId,
        failureMessage: "Teaching membership status request failed.",
        ...(authenticatedTeacher ? { authenticatedTeacher } : {}),
        ...(routeParams ? { resource: routeParams } : {}),
      });
    }
  };
}

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new TeachingCourseManagementStoreError(
      413,
      "Teaching membership status request body is too large.",
    );
  }
  if (!text.trim()) {
    throw new TeachingCourseManagementStoreError(
      400,
      "Teaching membership status request body is required.",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TeachingCourseManagementStoreError(
      400,
      "Teaching membership status request body must be JSON.",
    );
  }
}

// Only the two terminal statuses are patchable. `approved` is deliberately not
// accepted here: approval has its own routes, its own audit action and its own
// roster recount, and accepting it in two places would mean two implementations
// of the same decision.
function readTerminalMembershipStatus(
  value: unknown,
): TeachingClassMembershipTerminalStatus {
  const membershipStatus =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { membershipStatus?: unknown }).membershipStatus
      : undefined;
  if (membershipStatus !== "rejected" && membershipStatus !== "removed") {
    throw new TeachingCourseManagementStoreError(
      400,
      'Teaching membership status must be "rejected" or "removed".',
    );
  }
  return membershipStatus;
}
