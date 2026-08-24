import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
} from "@/lib/ai/progress/responsible-progress";
import type { UaisAiAccessDecision, UaisAiResourceScope } from "@/lib/server/ai-access-control";
import {
  createUaisTeacherAiWorkflowAccessPlan,
  type UaisTeacherAiResourceOwnership,
  type UaisTeacherAiWorkflowAction,
} from "@/lib/server/ai-resource-grants";
import {
  createUaisAiAccessSessionFromAuthenticatedTeacher,
  type UaisAuthenticatedTeacherSession,
} from "@/lib/server/ai-session-issuer";
import { createUaisTeacherAiOwnershipAdapter } from "@/lib/server/teacher-ai-ownership-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";

type TeacherAiSessionRouteBody = {
  action: UaisTeacherAiWorkflowAction;
  resource: UaisAiResourceScope;
  ttlSeconds?: number;
};

export type UaisAuthenticatedTeacherPrincipal = Omit<
  UaisAuthenticatedTeacherSession,
  "grants"
>;

type TeacherAiSessionPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  getAuthenticatedTeacherSession?: (
    request: Request,
  ) => Promise<UaisAuthenticatedTeacherPrincipal | undefined>;
  getTeacherAiResourceOwnership?: (input: {
    request: Request;
    authenticatedSession: UaisAuthenticatedTeacherPrincipal;
  }) => Promise<UaisTeacherAiResourceOwnership | undefined>;
};

export function createTeacherAiSessionPostHandler(
  deps: TeacherAiSessionPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const getAuthenticatedTeacherSession =
    deps.getAuthenticatedTeacherSession ??
    createSignedCookieTeacherSessionAdapter({
      env,
      now: deps.now,
    });
  const getTeacherAiResourceOwnership =
    deps.getTeacherAiResourceOwnership ??
    createUaisTeacherAiOwnershipAdapter({
      env,
      fetch: deps.fetch,
    });
  const fetchImpl = deps.fetch ?? fetch;

  return async function POST(request: Request) {
    try {
      const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
      if (
        isTeacherAiSessionProductionRuntime(env) &&
        authProviderContract.productionStatus !== "ready"
      ) {
        return Response.json(
          {
            error: "UAIS teacher auth provider is not production-ready.",
            access: denied("teacher-auth-provider-not-production-ready"),
            authProviderContract,
            progress: createTeacherAiSessionProgress("auth-provider-not-ready"),
          },
          { status: 503 },
        );
      }

      if (!getAuthenticatedTeacherSession || !getTeacherAiResourceOwnership) {
        return Response.json(
          {
            error: "UAIS teacher AI session issuer is not configured.",
            access: denied("auth-adapter-not-configured"),
            progress: createTeacherAiSessionProgress("not-configured"),
          },
          { status: 501 },
        );
      }

      const signingSecret = env.UAIS_AI_ACCESS_SIGNING_SECRET?.trim();
      if (!signingSecret) {
        return Response.json(
          {
            error: "UAIS AI access signing secret is not configured.",
            access: denied("signing-secret-missing"),
            progress: createTeacherAiSessionProgress("signing-secret-missing"),
          },
          { status: 503 },
        );
      }

      const authenticatedSession = await getAuthenticatedTeacherSession(request);
      if (!authenticatedSession) {
        return Response.json(
          {
            error: "UAIS teacher authentication is required.",
            access: denied("authenticated-session-required"),
            progress: createTeacherAiSessionProgress("auth-required"),
          },
          { status: 401 },
        );
      }

      const body = parseTeacherAiSessionBody(await request.json());
      const ownership =
        (await getTeacherAiResourceOwnership({
          request,
          authenticatedSession,
        })) ??
        (await readTeacherAiOwnershipFromSummaryRoute({
          request,
          authenticatedSession,
          fetch: fetchImpl,
        }));
      if (!ownership) {
        return Response.json(
          {
            error: "UAIS teacher AI ownership record is required.",
            access: denied("teacher-ownership-required"),
            progress: createTeacherAiSessionProgress("ownership-required"),
          },
          { status: 403 },
        );
      }

      const accessPlan = createUaisTeacherAiWorkflowAccessPlan({
        ownership,
        action: body.action,
        resource: body.resource,
      });
      const accessSession = createUaisAiAccessSessionFromAuthenticatedTeacher({
        authenticatedSession: {
          ...authenticatedSession,
          grants: accessPlan.grants,
        },
        action: body.action,
        requestedScopes: accessPlan.requestedScopes,
        secret: signingSecret,
        now: deps.now,
        ttlSeconds: body.ttlSeconds,
      });

      return Response.json({
        accessSession,
        accessPlan: redactAccessPlan(accessPlan),
        authProviderContract,
        progress: createTeacherAiSessionProgress("issued"),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not granted")) {
        return Response.json(
          {
            error: "UAIS teacher AI session request is not authorized.",
            access: denied("teacher-resource-not-granted"),
            progress: createTeacherAiSessionProgress("denied"),
          },
          { status: 403 },
        );
      }

      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid UAIS teacher AI session request.",
        },
        { status: 400 },
      );
    }
  };
}

function createSignedCookieTeacherSessionAdapter(input: {
  env: Record<string, string | undefined>;
  now?: Date;
}) {
  const secret = input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  if (!secret) {
    return undefined;
  }

  return async (request: Request) =>
    readUaisAuthenticatedTeacherSessionFromSignedCookies({
      request,
      secret,
      now: input.now,
    });
}

function parseTeacherAiSessionBody(value: unknown): TeacherAiSessionRouteBody {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    action: parseWorkflowAction(value.action),
    resource: parseResource(value.resource),
    ...(typeof value.ttlSeconds === "number" ? { ttlSeconds: value.ttlSeconds } : {}),
  };
}

function parseWorkflowAction(value: unknown): UaisTeacherAiWorkflowAction {
  const allowed = new Set<UaisTeacherAiWorkflowAction>([
    "live-chat",
    "voice-sample-submit",
    "voice-clone-preflight",
    "voice-clone-status",
    "voice-clone-revoke",
    "teacher-ppt-workflow-read",
    "ppt-narration-submit",
    "ppt-narration-audio-download",
    "ppt-narration-export-download",
  ]);
  if (typeof value === "string" && allowed.has(value as UaisTeacherAiWorkflowAction)) {
    return value as UaisTeacherAiWorkflowAction;
  }
  throw new Error("A supported teacher AI workflow action is required.");
}

function parseResource(value: unknown): UaisAiResourceScope {
  if (!isRecord(value)) {
    throw new Error("Teacher AI session resource must be an object.");
  }

  return {
    teacherId: getString(value.teacherId),
    courseId: getString(value.courseId),
    pptAssetId: getString(value.pptAssetId),
    sampleAssetId: getString(value.sampleAssetId),
    voiceRefId: getString(value.voiceRefId),
    providerTaskId: getString(value.providerTaskId),
    audioManifestId: getString(value.audioManifestId),
    audioId: getString(value.audioId),
  };
}

function getString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function redactAccessPlan(
  plan: ReturnType<typeof createUaisTeacherAiWorkflowAccessPlan>,
) {
  return {
    responsibleSession: plan.responsibleSession,
    action: plan.action,
    resource: plan.resource,
    requestedScopes: plan.requestedScopes,
    redaction: plan.redaction,
  };
}

async function readTeacherAiOwnershipFromSummaryRoute(input: {
  request: Request;
  authenticatedSession: UaisAuthenticatedTeacherPrincipal;
  fetch: typeof fetch;
}): Promise<UaisTeacherAiResourceOwnership | undefined> {
  const cookieHeader = input.request.headers.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }

  const response = await input
    .fetch(new URL("/api/ai/teacher-ownership", input.request.url), {
      method: "GET",
      headers: {
        accept: "application/json",
        cookie: cookieHeader,
      },
      signal: AbortSignal.timeout(10_000),
    })
    .catch(() => undefined);
  if (!response?.ok) {
    return undefined;
  }

  const body = await response.json().catch(() => undefined);
  if (!isRecord(body) || !isRecord(body.ownership)) {
    return undefined;
  }

  const ownership = body.ownership as UaisTeacherAiResourceOwnership;
  if (ownership.teacherId !== input.authenticatedSession.actorId) {
    return undefined;
  }
  if (!hasOwnedTeacherAiResource(ownership)) {
    return undefined;
  }

  return ownership;
}

function hasOwnedTeacherAiResource(ownership: UaisTeacherAiResourceOwnership) {
  return [
    ownership.courseIds,
    ownership.sampleAssets,
    ownership.pptAssets,
    ownership.clonedVoiceRefs,
    ownership.audioManifests,
  ].some((items) => Array.isArray(items) && items.length > 0);
}

function isTeacherAiSessionProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function createTeacherAiSessionProgress(
  status:
    | "issued"
    | "denied"
    | "not-configured"
    | "auth-provider-not-ready"
    | "signing-secret-missing"
    | "auth-required"
    | "ownership-required",
) {
  return assertResponsibleProgressIsDisplaySafe([
    createResponsibleProgressItem({
      index: 0,
      type: "s12-teacher-ai-session-boundary",
      status,
      responsibleSession: "S12",
      providerRole: "text-reasoning",
      progressText:
        status === "issued"
          ? "S12 Backend/API Platform issued a short-lived signed AI access session from server-side teacher auth and ownership."
          : "S12 Backend/API Platform kept the teacher AI session boundary closed until server-side auth and ownership checks pass.",
    }),
    createResponsibleProgressItem({
      index: 1,
      type: "s19-signing-secret-readiness",
      status: status === "signing-secret-missing" ? "blocked" : "checked",
      responsibleSession: "S19",
      providerRole: "text-reasoning",
      progressText:
        status === "signing-secret-missing"
          ? "S19 API Configuration requires a server-only signing secret before signed AI sessions can be minted."
          : "S19 API Configuration kept signing-secret handling server-side and redacted from the response.",
    }),
  ]);
}

function denied(
  reasonCode:
    | "auth-adapter-not-configured"
    | "teacher-auth-provider-not-production-ready"
    | "signing-secret-missing"
    | "authenticated-session-required"
    | "teacher-ownership-required"
    | "teacher-resource-not-granted",
) {
  return {
    status: "denied",
    responsibleSession: "S12",
    reasonCode,
    redaction: createRedaction(),
  };
}

function createRedaction(): UaisAiAccessDecision["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
