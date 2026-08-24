import { buildProviderSmokePlan } from "@/lib/ai/providers/smoke-plan";
import {
  assertUaisAiAdminAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";

type SmokePlanGetHandlerDeps = {
  env?: Record<string, string | undefined>;
};

export function createSmokePlanGetHandler(deps: SmokePlanGetHandlerDeps = {}) {
  const env = deps.env ?? process.env;

  return async function GET(request: Request) {
    try {
      assertUaisAiAdminAccess({
        request,
        env,
        action: "provider-smoke-plan",
        requireSignedSession: true,
      });
      return Response.json(buildProviderSmokePlan({ env }));
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json({ error: "Provider smoke plan request failed." }, { status: 400 });
    }
  };
}
