import {
  isTeachingOperationId,
  type TeachingOperationId,
} from "@/components/teaching/teaching-operation-data";
import type { TeachingCourseDelegatableCapability } from "@/lib/server/teaching-course-collaborator-types";
import type { TeachingOperationActionSlot } from "@/lib/server/teaching-operations-types";

type TeachingOperationCollaboratorCapabilityMap = Record<
  TeachingOperationId,
  Record<TeachingOperationActionSlot, TeachingCourseDelegatableCapability | undefined>
>;

const collaboratorCapabilityByAction = {
  "course-settings": {
    primary: "course.settings.manage",
    secondary: "course.read",
  },
  agents: {
    primary: "course.settings.manage",
    secondary: "course.settings.manage",
  },
  "knowledge-base": {
    primary: "course.content.write",
    secondary: "course.content.write",
  },
  content: {
    primary: "course.content.write",
    secondary: "course.content.write",
  },
  // ACL administration stays exclusively with the canonical course owner.
  // A collaborator grant must never authorize creating or expanding another
  // collaborator grant.
  admins: {
    primary: undefined,
    secondary: undefined,
  },
  students: {
    primary: "course.students.manage",
    secondary: "course.students.manage",
  },
  "data-export": {
    primary: "course.export",
    secondary: "course.export",
  },
  dashboard: {
    primary: "course.read",
    secondary: "course.settings.manage",
  },
  "quiz-board": {
    primary: "course.read",
    secondary: "course.grading.manage",
  },
  grading: {
    primary: "course.grading.manage",
    secondary: "course.grading.manage",
  },
  "invite-code": {
    primary: "course.students.manage",
    secondary: "course.students.manage",
  },
} as const satisfies TeachingOperationCollaboratorCapabilityMap;

export function resolveTeachingOperationCollaboratorCapability(input: {
  operationId: unknown;
  actionSlot: unknown;
}): TeachingCourseDelegatableCapability | undefined {
  if (
    typeof input.operationId !== "string" ||
    !isTeachingOperationId(input.operationId) ||
    (input.actionSlot !== "primary" && input.actionSlot !== "secondary")
  ) {
    return undefined;
  }

  return collaboratorCapabilityByAction[input.operationId][input.actionSlot];
}
