export function createTeachingCourseId(courseName: string, now: Date) {
  const slug = createTeachingCourseSlug(courseName) || "course";
  return `teacher-course-${slug}-${formatTeachingCourseTimestampId(now)}`;
}

export function createProvisionalTeachingCourseId(input: {
  actorId: string;
  courseName: string;
  now: Date;
}) {
  const actorSegment = createSafeTeachingCourseIdSegment(input.actorId) ?? "teacher";
  const courseSegment = createTeachingCourseSlug(input.courseName) || "course";
  return `teacher-draft-course-${actorSegment}-${courseSegment}-${formatTeachingCourseTimestampId(
    input.now,
  )}`;
}

export function isProvisionalTeachingCourseIdForActor(courseId: string, actorId: string) {
  const actorSegment = createSafeTeachingCourseIdSegment(actorId);
  if (!actorSegment || !isSafeTeachingCourseId(courseId)) {
    return false;
  }

  return courseId.startsWith(`teacher-draft-course-${actorSegment}-`);
}

export function createSafeTeachingCourseIdSegment(value: string) {
  const segment = value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return segment.length > 0 && isSafeTeachingCourseId(segment) ? segment : undefined;
}

function createTeachingCourseSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function formatTeachingCourseTimestampId(now: Date) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
}

function isSafeTeachingCourseId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value);
}
