import { findPublishedPlaybackByCourseId } from "@/lib/learning/ppt-playback-catalog";
import { resolveUaisAppAuthProviderContract } from "@/lib/server/uais-app-auth-provider";
import { isUaisAppDeployedRuntime } from "@/lib/server/uais-app-session";

export function isPublishedDemoTeacherCourseAccess(input: {
  actor: {
    actorId: string;
    role: "student" | "teacher" | "admin";
  };
  courseId: string;
  env: Record<string, string | undefined>;
}) {
  if (
    input.actor.role !== "teacher" ||
    input.actor.actorId !== "Phoebe" ||
    !findPublishedPlaybackByCourseId(input.courseId)
  ) {
    return false;
  }

  const authProviderContract = resolveUaisAppAuthProviderContract({ env: input.env });
  if (authProviderContract.providerKind !== "local-demo") {
    return false;
  }

  return (
    !isUaisAppDeployedRuntime(input.env) ||
    authProviderContract.demoProductionAccess?.enabled === true
  );
}
