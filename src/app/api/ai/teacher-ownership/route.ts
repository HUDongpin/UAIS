import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
} from "@/lib/ai/progress/responsible-progress";
import type { UaisAiAccessDecision } from "@/lib/server/ai-access-control";
import {
  createUaisTeacherAiOwnershipAdapter,
  createUaisTeacherAiOwnershipConsistencyReport,
} from "@/lib/server/teacher-ai-ownership-store";
import {
  readUaisAuthenticatedTeacherSessionFromSignedCookies,
} from "@/lib/server/teacher-auth-session";
import type { UaisTeacherAiResourceOwnership } from "@/lib/server/ai-resource-grants";
import type { UaisAuthenticatedTeacherPrincipal } from "@/app/api/ai/session/route";

export const dynamic = "force-dynamic";

type TeacherAiOwnershipGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  getAuthenticatedTeacherSession?: (
    request: Request,
  ) => Promise<UaisAuthenticatedTeacherPrincipal | undefined>;
  readTeacherAiOwnership?: (input: {
    teacherId: string;
    request: Request;
    authenticatedSession: UaisAuthenticatedTeacherPrincipal;
  }) => Promise<UaisTeacherAiResourceOwnership | undefined>;
  fetch?: typeof fetch;
};

type TeacherAiOwnershipSummary = UaisTeacherAiResourceOwnership & {
  storagePolicy: "server-side-redacted-teacher-ai-ownership-summary";
  responsibleSession: "S12";
  redaction: UaisAiAccessDecision["redaction"];
};

export const GET = createTeacherAiOwnershipGetHandler();

export function createTeacherAiOwnershipGetHandler(
  deps: TeacherAiOwnershipGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const getAuthenticatedTeacherSession =
    deps.getAuthenticatedTeacherSession ??
    createSignedCookieTeacherSessionAdapter({
      env,
      now: deps.now,
    });
  const readTeacherAiOwnership =
    deps.readTeacherAiOwnership ??
    createUaisTeacherAiOwnershipAdapter({
      env,
      fetch: deps.fetch,
    });

  return async function GET(
    request = new Request("http://localhost/api/ai/teacher-ownership"),
  ) {
    try {
      if (!getAuthenticatedTeacherSession) {
        return Response.json(
          {
            error: "UAIS teacher ownership reader is not configured.",
            access: denied("auth-adapter-not-configured"),
            progress: createTeacherAiOwnershipProgress("not-configured"),
          },
          { status: 501 },
        );
      }
      const ownershipReader = readTeacherAiOwnership;
      if (!ownershipReader) {
        return Response.json(
          {
            error: "UAIS teacher ownership reader is not configured.",
            access: denied("auth-adapter-not-configured"),
            progress: createTeacherAiOwnershipProgress("not-configured"),
          },
          { status: 501 },
        );
      }

      const authenticatedSession = await getAuthenticatedTeacherSession(request);
      if (!authenticatedSession) {
        return Response.json(
          {
            error: "UAIS teacher authentication is required.",
            access: denied("authenticated-session-required"),
            progress: createTeacherAiOwnershipProgress("auth-required"),
          },
          { status: 401 },
        );
      }

      const ownership = await ownershipReader({
        teacherId: authenticatedSession.actorId,
        request,
        authenticatedSession,
      });
      const summary = createTeacherAiOwnershipSummary({
        teacherId: authenticatedSession.actorId,
        ownership,
      });
      const consistency = createUaisTeacherAiOwnershipConsistencyReport(summary);

      return Response.json({
        ownership: summary,
        consistency,
        progress: createTeacherAiOwnershipProgress("ready", summary),
      });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid UAIS teacher ownership request.",
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

function createTeacherAiOwnershipSummary(input: {
  teacherId: string;
  ownership: UaisTeacherAiResourceOwnership | undefined;
}): TeacherAiOwnershipSummary {
  return {
    teacherId: input.teacherId,
    courseIds: input.ownership?.courseIds ?? [],
    sampleAssets: input.ownership?.sampleAssets ?? [],
    pptAssets: input.ownership?.pptAssets ?? [],
    clonedVoiceRefs: input.ownership?.clonedVoiceRefs ?? [],
    audioManifests: input.ownership?.audioManifests ?? [],
    storagePolicy: "server-side-redacted-teacher-ai-ownership-summary",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function createTeacherAiOwnershipProgress(
  status: "ready" | "auth-required" | "not-configured",
  summary?: TeacherAiOwnershipSummary,
) {
  return assertResponsibleProgressIsDisplaySafe([
    createResponsibleProgressItem({
      index: 0,
      type: "s12-teacher-ownership-auth-boundary",
      status,
      responsibleSession: "S12",
      providerRole: "ppt-narration",
      progressText:
        status === "ready"
          ? "S12 Backend/API Platform verified the signed teacher auth cookie before reading the server-side ownership registry."
          : "S12 Backend/API Platform kept the teacher ownership summary closed until signed teacher auth is available.",
    }),
    createResponsibleProgressItem({
      index: 1,
      type: "s24-teacher-ai-asset-summary",
      status: status === "ready" ? "summarized" : "blocked",
      responsibleSession: "S24",
      providerRole: "ppt-narration",
      progressText:
        status === "ready"
          ? `S24 Asset and Export Quality summarized ${summary?.clonedVoiceRefs?.length ?? 0} public Qwen voice reference${(summary?.clonedVoiceRefs?.length ?? 0) === 1 ? "" : "s"} and ${summary?.audioManifests?.length ?? 0} PPT audio manifest${(summary?.audioManifests?.length ?? 0) === 1 ? "" : "s"}.`
          : "S24 Asset and Export Quality waited for S12 auth before exposing redacted asset ownership metadata.",
    }),
  ]);
}

function denied(
  reasonCode: "auth-adapter-not-configured" | "authenticated-session-required",
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
