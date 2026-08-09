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

// Course context is the operation pages' authorization key: `POST
// /api/teaching/operations` denies any request without a courseId, so a
// navigation link that forgets the query silently turns every action on the
// destination page into a 400. Sidebar traversal between operation pages carries
// the course the teacher arrived with; the source action deliberately does not
// travel, because it describes the card that opened the first page, not the one
// the teacher moved to.
export function getTeachingOperationHrefWithCourse(operationId: string, courseId?: string) {
  const scopedCourseId = courseId?.trim();
  if (!scopedCourseId) {
    return getTeachingOperationHref(operationId);
  }
  const params = new URLSearchParams({ course: scopedCourseId });
  return `${getTeachingOperationHref(operationId)}?${params.toString()}`;
}
