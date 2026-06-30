import {
  buildDeploymentReadinessGate,
  buildDeploymentRouteSmokeGate,
} from "@/lib/ai/providers/smoke-plan";
import { getRedactedProviderReadiness } from "@/lib/ai/providers/registry";
import {
  assertUaisAiAdminAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";

export const dynamic = "force-dynamic";

type ReadinessGetHandlerDeps = {
  env?: Record<string, string | undefined>;
};

export const GET = createReadinessGetHandler();

export function createReadinessGetHandler(deps: ReadinessGetHandlerDeps = {}) {
  const env = deps.env ?? process.env;

  return async function GET(request = new Request("http://localhost/api/ai/readiness")) {
    try {
      assertUaisAiAdminAccess({
        request,
        env,
        action: "provider-readiness",
        requireSignedSession: true,
      });

      return Response.json({
        target: isReadinessProductionRuntime(env) ? "production" : "local",
        readiness: getRedactedProviderReadiness(env),
        deploymentGate: buildDeploymentReadinessGate({ env }),
        deploymentRouteSmokeGate: buildDeploymentRouteSmokeGate({ env }),
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json({ error: "Provider readiness request failed." }, { status: 400 });
    }
  };
}

function isReadinessProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}
