export const TEACHING_OPERATION_IDS = [
  "course-settings",
  "agents",
  "knowledge-base",
  "content",
  "admins",
  "students",
  "data-export",
  "dashboard",
  "quiz-board",
  "grading",
  "invite-code",
] as const;

export type TeachingOperationId = (typeof TEACHING_OPERATION_IDS)[number];

export type TeachingCourseAction = "manage" | "continue";

export function isTeachingOperationId(value: string): value is TeachingOperationId {
  return TEACHING_OPERATION_IDS.includes(value as TeachingOperationId);
}

export function getTeachingOperationHref(operationId: string) {
  return `/teaching/${operationId}`;
}

export function getTeachingCourseActionHref(
  operationId: TeachingOperationId,
  courseId: string,
  action: TeachingCourseAction,
) {
  const params = new URLSearchParams({ course: courseId, action });
  return `${getTeachingOperationHref(operationId)}?${params.toString()}`;
}
