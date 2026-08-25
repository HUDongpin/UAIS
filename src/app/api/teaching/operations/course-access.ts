import { getUaisCoreDatabaseReadiness } from "@/lib/db/core-database";
import type { TeachingCourseCapabilityDecision } from "@/lib/server/teaching-course-collaborator-access";
import { createTeachingCourseCollaboratorPostgresStore } from "@/lib/server/teaching-course-collaborator-postgres-store";
import {
  createTeachingCourseManagementDelegatedAuthorization,
} from "@/lib/server/teaching-course-management-authorization";
import { resolveTeachingOperationCollaboratorCapability } from "@/lib/server/teaching-operation-collaborator-policy";
import {
  createUaisTeacherAiOwnershipAdapter,
  type UaisTeacherAiOwnershipPostgresClientFactory,
} from "@/lib/server/teacher-ai-ownership-store";
import { TeachingOperationStoreError } from "@/lib/server/teaching-operations-store";
import {
  createRedaction,
  isTeachingOperationProductionRuntime,
  type TeachingOperationAuthenticatedTeacher,
} from "./route-utils";

export type TeachingOperationAccessDeniedReason =
  | "auth-adapter-not-configured"
  | "authenticated-session-required"
  | "teacher-auth-provider-not-production-ready"
  | "teacher-role-required"
  | "course-id-required"
  | "course-id-invalid"
  | "teacher-course-ownership-required"
  | "teacher-course-ownership-check-failed"
  | "teacher-course-capability-check-failed"
  | "course-scope-denied"
  | TeachingCourseCapabilityDeniedReason;

type TeachingOperationCourseOwnership = {
  teacherId: string;
  courseIds?: string[];
};

export type GetTeachingOperationCourseOwnership = (input: {
  request: Request;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
}) => Promise<TeachingOperationCourseOwnership | undefined>;

export type ReadTeachingCourseCapability = (input: {
  principalAccount: string;
  courseId: string;
  capability: unknown;
}) => Promise<TeachingCourseCapabilityDecision>;

type TeachingCourseCapabilityDeniedReason = Extract<
  TeachingCourseCapabilityDecision,
  { authorized: false }
>["reasonCode"];

export function createTeachingOperationCourseOwnershipAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  createDatabase?: UaisTeacherAiOwnershipPostgresClientFactory;
}): GetTeachingOperationCourseOwnership | undefined {
  const readOwnership = createUaisTeacherAiOwnershipAdapter({
    env: input.env,
    fetch: input.fetch,
    createDatabase: input.createDatabase,
  });
  if (!readOwnership) {
    return undefined;
  }

  return async ({ request, authenticatedTeacher }) =>
    readOwnership({
      request,
      authenticatedSession: authenticatedTeacher,
    });
}

export function createTeachingCourseCapabilityAdapter(input: {
  env: Record<string, string | undefined>;
  now?: Date;
}): ReadTeachingCourseCapability | undefined {
  if (getUaisCoreDatabaseReadiness(input.env).status !== "ready") {
    return undefined;
  }
  const fixedNow = input.now;
  const store = createTeachingCourseCollaboratorPostgresStore({
    env: input.env,
    ...(fixedNow ? { now: () => fixedNow } : {}),
  });
  return async (request) => store.readCapability(request);
}

export function assertProductionTeachingOperationCourseOwnershipAccessConfigured(input: {
  env: Record<string, string | undefined>;
  courseId?: string;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
}) {
  if (
    !isTeachingOperationProductionRuntime(input.env) ||
    !input.courseId ||
    !isSafeTeachingOperationId(input.courseId)
  ) {
    return;
  }

  if (input.getTeachingOperationCourseOwnership) {
    return;
  }

  throw new TeachingOperationStoreError(
    503,
    "Production teaching operation course ownership access requires a durable backend, not local JSON storage.",
  );
}

export async function authorizeTeachingOperationCourseAccess(input: {
  request: Request;
  authenticatedTeacher: TeachingOperationAuthenticatedTeacher;
  courseId?: string;
  operationId: unknown;
  actionSlot: unknown;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
  readTeachingCourseCapability?: ReadTeachingCourseCapability;
}) {
  const actor = {
    actorId: input.authenticatedTeacher.actorId,
    role: input.authenticatedTeacher.role,
  };
  if (!input.courseId) {
    return createDeniedAccess("course-id-required", actor);
  }
  if (!isSafeTeachingOperationId(input.courseId)) {
    return createDeniedAccess("course-id-invalid", actor);
  }
  const resource = { courseId: input.courseId };
  let ownerDeniedReason: Extract<
    TeachingOperationAccessDeniedReason,
    | "teacher-course-ownership-required"
    | "teacher-course-ownership-check-failed"
    | "course-scope-denied"
  > = "teacher-course-ownership-required";

  if (input.getTeachingOperationCourseOwnership) {
    try {
      const ownership = await input.getTeachingOperationCourseOwnership({
        request: input.request,
        authenticatedTeacher: input.authenticatedTeacher,
      });
      if (
        ownership?.teacherId === input.authenticatedTeacher.actorId &&
        new Set(ownership.courseIds ?? []).has(input.courseId)
      ) {
        return {
          status: "authorized" as const,
          reasonCode: "course-owner-implicit" as const,
          responsibleSession: "S12" as const,
          actor,
          resource,
          redaction: createRedaction(),
        };
      }
      ownerDeniedReason =
        ownership?.teacherId === input.authenticatedTeacher.actorId
          ? "course-scope-denied"
          : "teacher-course-ownership-required";
    } catch {
      ownerDeniedReason = "teacher-course-ownership-check-failed";
    }
  }

  const capability = resolveTeachingOperationCollaboratorCapability({
    operationId: input.operationId,
    actionSlot: input.actionSlot,
  });
  if (!capability || !input.readTeachingCourseCapability) {
    return createDeniedAccess(ownerDeniedReason, actor, resource);
  }

  let capabilityDecision: TeachingCourseCapabilityDecision;
  try {
    capabilityDecision = await input.readTeachingCourseCapability({
      principalAccount: input.authenticatedTeacher.actorId,
      courseId: input.courseId,
      capability,
    });
  } catch {
    return createDeniedAccess(
      "teacher-course-capability-check-failed",
      actor,
      resource,
    );
  }
  if (!capabilityDecision.authorized) {
    return createDeniedAccess(capabilityDecision.reasonCode, actor, resource);
  }

  return {
    status: "authorized" as const,
    reasonCode: capabilityDecision.reasonCode,
    capability: capabilityDecision.capability,
    ...(capabilityDecision.reasonCode === "collaborator-exact-scope"
      ? {
          grantId: capabilityDecision.grantId,
          grantRevision: capabilityDecision.revision,
          delegatedAuthorization:
            createTeachingCourseManagementDelegatedAuthorization({
              actorId: input.authenticatedTeacher.actorId,
              courseId: input.courseId,
              decision: capabilityDecision,
            }),
        }
      : {}),
    responsibleSession: "S12" as const,
    actor,
    resource,
    redaction: createRedaction(),
  };
}

export function getTeachingOperationAccessDeniedStatus(
  reasonCode: TeachingOperationAccessDeniedReason,
) {
  if (reasonCode === "course-id-required" || reasonCode === "course-id-invalid") {
    return 400;
  }
  if (
    reasonCode === "teacher-course-ownership-check-failed" ||
    reasonCode === "teacher-course-capability-check-failed"
  ) {
    return 503;
  }
  return 403;
}

export function getTeachingOperationAccessDeniedError(
  reasonCode: TeachingOperationAccessDeniedReason,
) {
  if (reasonCode === "course-id-invalid") {
    return "UAIS teaching operation course id is invalid.";
  }
  if (reasonCode === "teacher-course-ownership-check-failed") {
    return "UAIS teaching operation course ownership check failed.";
  }
  if (reasonCode === "teacher-course-capability-check-failed") {
    return "UAIS teaching operation course capability check failed.";
  }
  if (isTeachingCourseCapabilityDeniedReason(reasonCode)) {
    return "UAIS teaching operation course capability is required.";
  }
  return "UAIS teaching operation course ownership is required.";
}

export function createDeniedAccess(
  reasonCode: TeachingOperationAccessDeniedReason,
  actor?: { actorId: string; role: "teacher" },
  resource?: { courseId: string },
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(actor ? { actor } : {}),
    ...(resource ? { resource } : {}),
    redaction: createRedaction(),
  };
}

function isTeachingCourseCapabilityDeniedReason(
  reasonCode: TeachingOperationAccessDeniedReason,
): reasonCode is TeachingCourseCapabilityDeniedReason {
  return (
    reasonCode === "active-teacher-principal-required" ||
    reasonCode === "canonical-course-required" ||
    reasonCode === "capability-not-delegatable" ||
    reasonCode.startsWith("collaborator-")
  );
}

function isSafeTeachingOperationId(value: string) {
  return (
    value.length >= 1 &&
    value.length <= 120 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  );
}
