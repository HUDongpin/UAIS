import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";

// Kept in a deliberately narrow module so read-only authorization paths do not
// load the course-management handler barrel merely to enforce one runtime
// invariant. This predicate mirrors the historical store contract exactly.
export function assertTeachingCourseManagementLocalJsonRuntimeAllowed(
  env: Record<string, string | undefined>,
) {
  if (!isTeachingCourseManagementProductionRuntime(env)) return;

  throw new TeachingCourseManagementStoreError(
    503,
    "Production teaching course management persistence requires external storage.",
  );
}

function isTeachingCourseManagementProductionRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}
