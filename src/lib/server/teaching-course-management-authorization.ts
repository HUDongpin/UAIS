import { AsyncLocalStorage } from "node:async_hooks";
import type { TeachingCourseCapabilityDecision } from "@/lib/server/teaching-course-collaborator-access";
import {
  isTeachingCourseCollaboratorPublicId,
  isTeachingCourseCollaboratorUuid,
  type TeachingCourseDelegatableCapability,
} from "@/lib/server/teaching-course-collaborator-types";

export type TeachingCourseManagementDelegatedAuthorization = Readonly<{
  authorizationClass: "server-verified-course-collaborator-capability";
  actorId: string;
  courseId: string;
  capability: TeachingCourseDelegatableCapability;
  grantId: string;
  grantRevision: number;
}>;

const issuedDelegatedAuthorizations = new WeakSet<object>();
const activeDelegatedAuthorization =
  new AsyncLocalStorage<TeachingCourseManagementDelegatedAuthorization>();

export function createTeachingCourseManagementDelegatedAuthorization(input: {
  actorId: string;
  courseId: string;
  decision: TeachingCourseCapabilityDecision;
}): TeachingCourseManagementDelegatedAuthorization {
  if (
    !input.decision.authorized ||
    input.decision.reasonCode !== "collaborator-exact-scope"
  ) {
    throw new Error("collaborator-exact-scope-required");
  }
  if (
    !isTeachingCourseCollaboratorPublicId(input.actorId) ||
    !isTeachingCourseCollaboratorPublicId(input.courseId) ||
    !isTeachingCourseCollaboratorUuid(input.decision.grantId) ||
    !Number.isSafeInteger(input.decision.revision) ||
    input.decision.revision <= 0
  ) {
    throw new Error("collaborator-authorization-invalid");
  }

  const authorization: TeachingCourseManagementDelegatedAuthorization =
    Object.freeze({
      authorizationClass: "server-verified-course-collaborator-capability",
      actorId: input.actorId,
      courseId: input.courseId,
      capability: input.decision.capability,
      grantId: input.decision.grantId,
      grantRevision: input.decision.revision,
    });
  issuedDelegatedAuthorizations.add(authorization);
  return authorization;
}

export function isTeachingCourseManagementActorAuthorized(input: {
  ownerTeacherId: string;
  actorId: string;
  courseId: string;
  requiredCapability: TeachingCourseDelegatableCapability;
  authorization?: unknown;
}) {
  if (input.ownerTeacherId === input.actorId) {
    return true;
  }
  const activeAuthorization =
    input.authorization ?? activeDelegatedAuthorization.getStore();
  if (
    !activeAuthorization ||
    typeof activeAuthorization !== "object" ||
    !issuedDelegatedAuthorizations.has(activeAuthorization)
  ) {
    return false;
  }

  const authorization =
    activeAuthorization as TeachingCourseManagementDelegatedAuthorization;
  return (
    authorization.authorizationClass ===
      "server-verified-course-collaborator-capability" &&
    authorization.actorId === input.actorId &&
    authorization.courseId === input.courseId &&
    authorization.capability === input.requiredCapability
  );
}

export function runWithTeachingCourseManagementDelegatedAuthorization<T>(
  authorization: TeachingCourseManagementDelegatedAuthorization,
  operation: () => T,
): T {
  if (!issuedDelegatedAuthorizations.has(authorization)) {
    throw new Error("collaborator-authorization-not-issued");
  }
  return activeDelegatedAuthorization.run(authorization, operation);
}
