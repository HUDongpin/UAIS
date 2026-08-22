import { createUaisLearningLoopPostgresReadStore } from "@/lib/learning-loop/postgres-read-store";
import {
  authorizeLearningLoopStudentDashboard,
  type LearningLoopStudentDashboardScope,
} from "@/lib/server/learning-loop-access";
import {
  createLearningLoopAccessDeniedResponse,
  createLearningLoopErrorResponse,
  createLearningLoopJsonResponse,
  readLearningLoopTraceId,
} from "@/lib/server/learning-loop-route-http";

export const dynamic = "force-dynamic";

type DashboardAccess = Awaited<
  ReturnType<typeof authorizeLearningLoopStudentDashboard>
>;

type GetDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  authorize?: (input: {
    request: Request;
    env: Record<string, string | undefined>;
    now?: Date;
    fetch?: typeof fetch;
  }) => Promise<DashboardAccess>;
  readStudentDashboard?: (input: {
    studentAccount: string;
    scopes: LearningLoopStudentDashboardScope[];
  }) => Promise<Record<string, unknown>>;
};

export const GET = Object.assign(createLearningDashboardGetHandler(), {
  createForTesting: createLearningDashboardGetHandler,
});

function createLearningDashboardGetHandler(deps: GetDeps = {}) {
  const env = deps.env ?? process.env;
  return async function GET(request: Request) {
    const traceId = readLearningLoopTraceId(request);
    try {
      const access = await (deps.authorize ?? authorizeLearningLoopStudentDashboard)({
        request,
        env,
        now: deps.now,
        fetch: deps.fetch,
      });
      if (access.status === "denied") {
        return createLearningLoopAccessDeniedResponse(access.reasonCode, traceId);
      }
      const store = deps.readStudentDashboard
        ? undefined
        : createUaisLearningLoopPostgresReadStore({ env });
      const result = await (
        deps.readStudentDashboard ?? store!.readStudentDashboard
      )({
        studentAccount: access.studentAccount,
        scopes: access.scopes,
      });
      return createLearningLoopJsonResponse(200, traceId, { ...result, traceId });
    } catch (error) {
      return createLearningLoopErrorResponse(
        error,
        traceId,
        "learning-dashboard-read-failed",
      );
    }
  };
}
