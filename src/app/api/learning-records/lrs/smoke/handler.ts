import { randomUUID } from "node:crypto";
import {
  createUaisLrsSmokeStatement,
  getRedactedLrsReadiness,
  postXapiStatement,
  resolveLrsConfig,
} from "@/lib/learning-records/lrs-client";
import { getLearningRecordFlushFailures } from "@/lib/learning-records/lrs-recorder";
import {
  assertUaisAiAdminAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
  type UaisAiAdminAccessAction,
} from "@/lib/server/ai-access-control";

type LrsSmokeRouteDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  createRunId?: () => string;
  now?: () => string;
};

export function createLrsSmokeGetHandler(deps: LrsSmokeRouteDeps = {}) {
  const env = deps.env ?? process.env;

  return async function GET(
    request = new Request("http://localhost/api/learning-records/lrs/smoke"),
  ) {
    try {
      assertSignedAdminAccess({ request, env, action: "lrs-readiness" });

      return Response.json({
        target: "learning-record-store-smoke",
        mode: "readiness",
        readiness: getRedactedLrsReadiness(env),
        // Readiness used to answer only "are the credentials set", which stays
        // green while every statement is being dropped after the 202. The
        // recorder's tally of statements this process gave up on rides along, so
        // the one endpoint an admin already polls can show the loss.
        flushFailures: getLearningRecordFlushFailures(),
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json({ error: "LRS readiness request failed." }, { status: 400 });
    }
  };
}

export function createLrsSmokePostHandler(deps: LrsSmokeRouteDeps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const createRunId = deps.createRunId ?? randomUUID;
  const now = deps.now ?? (() => new Date().toISOString());

  return async function POST(
    request = new Request("http://localhost/api/learning-records/lrs/smoke", {
      method: "POST",
    }),
  ) {
    try {
      assertSignedAdminAccess({ request, env, action: "lrs-live-smoke" });

      if (!hasLiveSmokeApproval(request)) {
        return Response.json(
          {
            error: "LRS live smoke requires explicit approval.",
            requiredQuery: "approved=true",
            safety: {
              writesTestStatementOnly: true,
              valuesRedacted: true,
            },
          },
          { status: 428 },
        );
      }

      const config = resolveLrsConfig(env);
      if (config.status === "blocked") {
        return Response.json(
          {
            target: "learning-record-store-smoke",
            status: "blocked",
            readiness: config.readiness,
          },
          { status: 424 },
        );
      }

      const result = await postXapiStatement({
        config: config.config,
        statement: createUaisLrsSmokeStatement({
          runId: createRunId(),
          timestamp: now(),
        }),
        fetch: fetchImpl,
      });

      return Response.json({
        target: "learning-record-store-smoke",
        status: "passed",
        readiness: config.readiness,
        result,
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json(
        {
          target: "learning-record-store-smoke",
          status: "failed",
          error: createRedactedLrsSmokeError(error),
          safety: {
            valuesRedacted: true,
            responseBodyOmitted: true,
          },
        },
        { status: 502 },
      );
    }
  };
}

function hasLiveSmokeApproval(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.searchParams.get("approved") === "true" ||
    request.headers.get("x-uais-lrs-smoke-approved") === "true"
  );
}

function assertSignedAdminAccess(input: {
  request: Request;
  env: Record<string, string | undefined>;
  action: UaisAiAdminAccessAction;
}) {
  assertUaisAiAdminAccess({
    ...input,
    requireSignedSession: true,
  });
}

function createRedactedLrsSmokeError(error: unknown): string {
  if (
    error instanceof Error &&
    /^LRS statement write failed with HTTP \d+\.$/.test(error.message)
  ) {
    return error.message;
  }

  return "LRS smoke failed.";
}
