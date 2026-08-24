import { LIVE_APPROVAL_HEADER } from "@/lib/ai/providers/live-approval";
import {
  createTeacherVoiceClonePreflight,
  type VoiceClonePreflightCheck,
  type TeacherVoiceClonePreflightRequest,
} from "@/lib/ai/voice/live-preflight";
import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
} from "@/lib/ai/progress/responsible-progress";
import type {
  TeacherVoiceConsentScope,
  TeacherVoiceSampleSourceKind,
} from "@/lib/ai/voice/sample-intake";
import type { Locale } from "@/i18n/copy";
import {
  assertUaisAiAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";

type VoiceClonePreflightPostHandlerDeps = {
  env?: Record<string, string | undefined>;
};

export function createVoiceClonePreflightPostHandler(
  deps: VoiceClonePreflightPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(request: Request) {
    try {
      authorizeVoiceClonePreflightRequestBeforeBodyRead({
        request,
        env,
      });
      const rawBody = await request.json();
      authorizeVoiceClonePreflightRequestBeforeValidation({
        request,
        value: rawBody,
        env,
      });
      const body = parseVoiceClonePreflightBody(rawBody);
      assertUaisAiAccess({
        request,
        env,
        action: "voice-clone-preflight",
        resource: {
          teacherId: body.teacherId,
          sampleAssetId: body.sampleAssetId,
        },
        requireSignedSession: true,
      });
      const preflight = createTeacherVoiceClonePreflight({
        request: body,
        env,
        approvalHeader: request.headers.get(LIVE_APPROVAL_HEADER),
      });

      return Response.json({
        preflight,
        progress: createVoiceClonePreflightProgress(preflight.checks),
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Invalid voice clone preflight request.",
        },
        { status: 400 },
      );
    }
  };
}

function authorizeVoiceClonePreflightRequestBeforeBodyRead(input: {
  request: Request;
  env: Record<string, string | undefined>;
}) {
  assertUaisAiAccess({
    request: input.request,
    env: input.env,
    action: "voice-clone-preflight",
    requireSignedSession: true,
  });
}

function authorizeVoiceClonePreflightRequestBeforeValidation(input: {
  request: Request;
  value: unknown;
  env: Record<string, string | undefined>;
}) {
  assertUaisAiAccess({
    request: input.request,
    env: input.env,
    action: "voice-clone-preflight",
    resource: {
      teacherId: isRecord(input.value) && typeof input.value.teacherId === "string"
        ? input.value.teacherId
        : undefined,
      sampleAssetId:
        isRecord(input.value) && typeof input.value.sampleAssetId === "string"
          ? input.value.sampleAssetId
          : undefined,
    },
    requireSignedSession: true,
  });
}

function createVoiceClonePreflightProgress(checks: VoiceClonePreflightCheck[]) {
  return assertResponsibleProgressIsDisplaySafe(
    checks.map((check, index) => {
      return createResponsibleProgressItem({
        index,
        type: check.id,
        status: check.status,
        responsibleSession: check.responsibleSession,
        providerRole: "voice-clone",
        progressText: getPreflightProgressText(check.id, check.status),
      });
    }),
  );
}

function getPreflightProgressText(
  id: VoiceClonePreflightCheck["id"],
  status: VoiceClonePreflightCheck["status"],
) {
  const blockedSuffix = status === "blocked" ? " Blocked before live submission." : "";
  const textById: Record<VoiceClonePreflightCheck["id"], string> = {
    "s07-qwen-provider": "S07 AI Agent Model verified Qwen is the voice-clone provider.",
    "s24-teacher-voice-sample":
      "S24 Asset and Export Quality verified the teacher voice sample for Qwen clone preflight.",
    "s24-target-voice-label":
      "S24 Asset and Export Quality verified the target cloned-voice label.",
    "s19-dashscope-env": "S19 API Configuration verified the Qwen provider environment.",
    "s19-live-approval-token":
      "S19 API Configuration verified the live approval token is configured.",
    "s12-live-approval":
      "S12 Backend/API Platform verified the live approval request boundary.",
  };

  return `${textById[id]}${blockedSuffix}`;
}

function parseVoiceClonePreflightBody(value: unknown): TeacherVoiceClonePreflightRequest {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    liveProviderApproved: value.liveProviderApproved === true,
    teacherId: getString(value.teacherId),
    consentConfirmed: value.consentConfirmed === true,
    consentScope: getConsentScope(value.consentScope),
    sampleAssetId: getString(value.sampleAssetId),
    sampleDurationSeconds: getNumber(value.sampleDurationSeconds),
    mimeType: getString(value.mimeType),
    sourceKind: getSourceKind(value.sourceKind),
    language: getLocale(value.language),
    targetVoiceLabel: getString(value.targetVoiceLabel),
  };
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getNumber(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function getConsentScope(value: unknown): TeacherVoiceConsentScope {
  return value === "ppt-narration" ? value : "ppt-narration";
}

function getSourceKind(value: unknown): TeacherVoiceSampleSourceKind {
  return value === "upload" ? value : "owner-provided";
}

function getLocale(value: unknown): Locale | undefined {
  if (value === "zh-CN" || value === "en-US") {
    return value;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
