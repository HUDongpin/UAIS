// Teaching actor ids are the stable account string stored on course snapshots
// as `ownerTeacherId` and on signed teacher sessions as `actorId`. Login is
// already case-insensitive (`normalizeUaisLoginIdentifier`); these helpers keep
// listing and write authorization on the same comparison so a teacher who can
// see a course is not refused by a `Phoebe` / `phoebe` mismatch.

export function isSameTeachingActorId(left: string, right: string) {
  const first = left.trim();
  const second = right.trim();
  return first.length > 0 && second.length > 0 && first.toLowerCase() === second.toLowerCase();
}

export function teachingActorOwnsCourse(input: {
  ownerTeacherId: string;
  actorId: string;
  courseId: string;
  candidateCourseId: string;
}) {
  return (
    input.candidateCourseId === input.courseId &&
    isSameTeachingActorId(input.ownerTeacherId, input.actorId)
  );
}
