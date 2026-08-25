import {
  getTeachingCourseCollaboratorGrantStatus,
  isTeachingCourseDelegatableCapability,
  normalizeTeachingCourseCollaboratorGrantPolicy,
  type TeachingCourseCollaboratorGrant,
  type TeachingCourseDelegatableCapability,
} from "@/lib/server/teaching-course-collaborator-types";

export type TeachingCourseCapabilityPrincipal = {
  userId: string;
  account: string;
  role: "student" | "teacher" | "admin";
  status: "active" | "disabled" | "invited";
};

export type TeachingCourseCapabilityDecision =
  | {
      authorized: true;
      reasonCode: "course-owner-implicit";
      capability: TeachingCourseDelegatableCapability;
    }
  | {
      authorized: true;
      reasonCode: "collaborator-exact-scope";
      capability: TeachingCourseDelegatableCapability;
      grantId: string;
      revision: number;
    }
  | {
      authorized: false;
      reasonCode:
        | "active-teacher-principal-required"
        | "canonical-course-required"
        | "capability-not-delegatable"
        | "collaborator-grant-required"
        | "collaborator-grant-mismatch"
        | "collaborator-grant-revoked"
        | "collaborator-grant-expired"
        | "collaborator-grant-invalid"
        | "collaborator-scope-required";
    };

export function authorizeTeachingCourseCapability(input: {
  principal: TeachingCourseCapabilityPrincipal | undefined;
  course: { courseId: string; ownerUserId: string };
  capability: unknown;
  grant?: TeachingCourseCollaboratorGrant;
  now?: Date;
}): TeachingCourseCapabilityDecision {
  const principal = input.principal;
  if (
    !principal ||
    principal.role !== "teacher" ||
    principal.status !== "active" ||
    !principal.userId.trim()
  ) {
    return {
      authorized: false,
      reasonCode: "active-teacher-principal-required",
    };
  }
  if (!isTeachingCourseDelegatableCapability(input.capability)) {
    // ACL administration is intentionally absent from the closed capability
    // union. Grant creation/revocation has its own canonical-owner guard.
    return {
      authorized: false,
      reasonCode: "capability-not-delegatable",
    };
  }
  if (!input.course.courseId.trim() || !input.course.ownerUserId.trim()) {
    return {
      authorized: false,
      reasonCode: "canonical-course-required",
    };
  }
  if (principal.userId === input.course.ownerUserId) {
    return {
      authorized: true,
      reasonCode: "course-owner-implicit",
      capability: input.capability,
    };
  }

  const grant = input.grant;
  if (!grant) {
    return {
      authorized: false,
      reasonCode: "collaborator-grant-required",
    };
  }
  if (
    grant.courseId !== input.course.courseId ||
    grant.recipientUserId !== principal.userId ||
    grant.grantedByUserId !== input.course.ownerUserId
  ) {
    return {
      authorized: false,
      reasonCode: "collaborator-grant-mismatch",
    };
  }
  if (
    !grant.grantId.trim() ||
    !grant.grantedByUserId.trim() ||
    !Number.isSafeInteger(grant.revision) ||
    grant.revision <= 0 ||
    Boolean(grant.revokedAt) !== Boolean(grant.revokedByUserId)
  ) {
    return {
      authorized: false,
      reasonCode: "collaborator-grant-invalid",
    };
  }
  const authorizationNow = input.now ?? new Date();
  const authorizationTimestamp = authorizationNow.getTime();
  if (!Number.isFinite(authorizationTimestamp)) {
    return {
      authorized: false,
      reasonCode: "collaborator-grant-invalid",
    };
  }
  let policy: ReturnType<
    typeof normalizeTeachingCourseCollaboratorGrantPolicy
  >;
  try {
    policy = normalizeTeachingCourseCollaboratorGrantPolicy({
      role: grant.role,
      scopes: grant.scopes,
      grantedAt: grant.grantedAt,
      expiresAt: grant.expiresAt,
    });
  } catch {
    return {
      authorized: false,
      reasonCode: "collaborator-grant-invalid",
    };
  }
  if (Date.parse(policy.grantedAt) > authorizationTimestamp) {
    return {
      authorized: false,
      reasonCode: "collaborator-grant-invalid",
    };
  }
  if (grant.revokedAt || grant.status === "revoked") {
    return {
      authorized: false,
      reasonCode: "collaborator-grant-revoked",
    };
  }
  const derivedStatus = getTeachingCourseCollaboratorGrantStatus(
    {
      grantedAt: policy.grantedAt,
      expiresAt: policy.expiresAt,
      revokedAt: grant.revokedAt,
    },
    authorizationNow,
  );
  if (grant.status === "expired" || derivedStatus === "expired") {
    return {
      authorized: false,
      reasonCode: "collaborator-grant-expired",
    };
  }
  if (grant.status !== "active" || derivedStatus !== "active") {
    return {
      authorized: false,
      reasonCode: "collaborator-grant-invalid",
    };
  }

  if (!policy.scopes.includes(input.capability)) {
    return {
      authorized: false,
      reasonCode: "collaborator-scope-required",
    };
  }

  return {
    authorized: true,
    reasonCode: "collaborator-exact-scope",
    capability: input.capability,
    grantId: grant.grantId,
    revision: grant.revision,
  };
}
