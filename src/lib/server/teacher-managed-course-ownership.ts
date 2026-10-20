import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
} from "@/lib/server/teaching-course-management-store";
import { teachingActorOwnsCourse } from "@/lib/server/teaching-actor-id";

export type ReadManagedTeachingCourseOwnership = (input: {
  actorId: string;
  courseId: string;
}) => Promise<boolean>;

export async function expandOwnedCourseIdsWithManagedOwnership(input: {
  actorId: string;
  ownedCourseIds: Iterable<string>;
  candidateCourseIds: Iterable<string>;
  readManagedCourseOwnership?: ReadManagedTeachingCourseOwnership;
}): Promise<string[]> {
  const ownedCourseIds = new Set(
    [...input.ownedCourseIds].filter((courseId) => courseId.trim().length > 0),
  );
  if (!input.readManagedCourseOwnership) {
    return [...ownedCourseIds].sort();
  }

  const candidates = [...new Set(input.candidateCourseIds)]
    .filter((courseId) => courseId.trim().length > 0 && !ownedCourseIds.has(courseId))
    .sort();
  for (const courseId of candidates) {
    if (
      await input.readManagedCourseOwnership({
        actorId: input.actorId,
        courseId,
      })
    ) {
      ownedCourseIds.add(courseId);
    }
  }
  return [...ownedCourseIds].sort();
}

// Canonical course ACL: the teaching-course-management snapshot's
// `ownerTeacherId`, the same source GET /api/teaching/courses uses to list a
// teacher's workbench. Teaching-operation AI-ownership rows are a derived
// resource grant and must not be the only way a snapshot owner is authorized.
export function createTeachingManagedCourseOwnershipAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): ReadManagedTeachingCourseOwnership {
  return async ({ actorId, courseId }) => {
    const repository = createUaisTeachingCourseManagementRepository({
      env: input.env,
      fetch: input.fetch,
    });
    if (!repository) {
      assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
    }
    const { database } = await readTeachingCourseManagementSnapshot({
      dataDir: resolveTeachingCourseManagementDataDir(
        input.env.UAIS_TEACHING_COURSES_DATA_DIR,
      ),
      repository,
      courseId,
    });
    return database.courses.some((course) =>
      teachingActorOwnsCourse({
        ownerTeacherId: course.ownerTeacherId,
        actorId,
        courseId,
        candidateCourseId: course.courseId,
      }),
    );
  };
}
