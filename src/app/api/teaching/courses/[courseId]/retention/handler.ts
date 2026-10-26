import { authorizeLearningLoopTeacherCourse } from "@/lib/server/learning-loop-access";
import { selectUaisDurableSnapshotBackend } from "@/lib/server/uais-durable-snapshot-backend";
import { isSameOriginClassroomRequest } from "@/lib/server/classroom-request-origin";
import {
  createLearningLoopAccessDeniedResponse,
  createLearningLoopErrorResponse,
  createLearningLoopJsonResponse,
  readLearningLoopJsonBody,
  readLearningLoopRecord,
  readLearningLoopTraceId,
} from "@/lib/server/learning-loop-route-http";
import {
  ClassroomRecordRetentionError,
  createClassroomRecordRetentionStore,
} from "@/lib/server/classroom-record-retention-store";

type Context = { params: Promise<{ courseId: string }> };
type Store = ReturnType<typeof createClassroomRecordRetentionStore>;
export function createCourseRetentionHandlers(
  deps: {
    env?: Record<string, string | undefined>;
    now?: Date;
    authorize?: typeof authorizeLearningLoopTeacherCourse;
    store?: Store;
  } = {},
) {
  const env = deps.env ?? process.env;
  const handler =
    (method: "GET" | "POST") => async (request: Request, context: Context) => {
      const traceId = readLearningLoopTraceId(request);
      try {
        if (method === "POST" && !isSameOriginClassroomRequest(request)) {
          throw new ClassroomRecordRetentionError(403, "same-origin-required");
        }
        const { courseId } = await context.params;
        const access = await (
          deps.authorize ?? authorizeLearningLoopTeacherCourse
        )({ request, env, now: deps.now, courseId });
        if (access.status === "denied")
          return createLearningLoopAccessDeniedResponse(
            access.reasonCode,
            traceId,
          );
        if (selectUaisDurableSnapshotBackend(env) !== "postgres") {
          throw new ClassroomRecordRetentionError(
            503,
            "course-retention-postgres-required",
          );
        }
        const store =
          deps.store ?? createClassroomRecordRetentionStore({ env });
        const input = { courseId, teacherAccount: access.teacherAccount };
        if (method === "GET")
          return createLearningLoopJsonResponse(200, traceId, {
            retention: await store.read(input),
          });
        const body = readLearningLoopRecord(
          await readLearningLoopJsonBody(request, 2_000),
        );
        if (body.confirm !== true)
          throw new ClassroomRecordRetentionError(
            400,
            "course-retention-confirmation-required",
          );
        if (body.action === "close")
          return createLearningLoopJsonResponse(200, traceId, {
            retention: await store.close(input),
          });
        if (
          body.action === "purge" &&
          typeof body.confirmationDigest === "string" &&
          /^[a-f0-9]{64}$/.test(body.confirmationDigest)
        ) {
          return createLearningLoopJsonResponse(200, traceId, {
            retention: await store.purge({
              ...input,
              confirmationDigest: body.confirmationDigest,
            }),
          });
        }
        throw new ClassroomRecordRetentionError(
          400,
          "course-retention-operation-invalid",
        );
      } catch (error) {
        return createLearningLoopErrorResponse(
          error,
          traceId,
          "course-retention-operation-failed",
        );
      }
    };
  return { GET: handler("GET"), POST: handler("POST") };
}
