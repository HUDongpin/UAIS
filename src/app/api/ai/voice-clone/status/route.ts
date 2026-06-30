import {
  createVoiceCloneTaskStatus,
  type QwenVoiceCloneProviderStatus,
} from "@/lib/ai/voice/clone-task";
import {
  storeQwenClonedVoiceReference,
  type PublicQwenClonedVoiceReference,
  type StoreQwenClonedVoiceReferenceInput,
} from "@/lib/ai/voice/cloned-voice-registry";
import {
  createQwenVoiceClient,
  type QwenVoiceCloneTaskStatusResult,
} from "@/lib/ai/providers/qwen-client";
import { assertLiveProviderApproval } from "@/lib/ai/providers/live-approval";
import { createLiveProviderAuditEvent } from "@/lib/ai/providers/provider-audit";
import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
} from "@/lib/ai/progress/responsible-progress";
import {
  assertUaisAiAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";

export const dynamic = "force-dynamic";

type VoiceCloneStatusRouteBody = {
  executionMode: "contract" | "live";
  liveProviderApproved?: boolean;
  providerTaskId: string;
  teacherId?: string;
  sampleAssetId?: string;
  providerStatus?: QwenVoiceCloneProviderStatus;
  clonedVoiceId?: string;
};

type QwenVoiceCloneStatusClient = {
  getVoiceCloneTaskStatus(taskId: string): Promise<QwenVoiceCloneTaskStatusResult>;
};

type VoiceCloneStatusPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  createQwenVoiceClient?: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => QwenVoiceCloneStatusClient;
  storeQwenClonedVoiceReference?: (
    input: StoreQwenClonedVoiceReferenceInput,
  ) => Promise<PublicQwenClonedVoiceReference>;
};

export const POST = createVoiceCloneStatusPostHandler();

export function createVoiceCloneStatusPostHandler(
  deps: VoiceCloneStatusPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const qwenVoiceClientFactory = deps.createQwenVoiceClient ?? createQwenVoiceClient;
  const storeClonedVoiceReference =
    deps.storeQwenClonedVoiceReference ?? storeQwenClonedVoiceReference;

  return async function POST(request: Request) {
    try {
      authorizeVoiceCloneStatusRequestBeforeBodyRead({
        request,
        env,
      });
      const rawBody = await request.json();
      authorizeVoiceCloneStatusRequestBeforeValidation({
        request,
        value: rawBody,
        env,
      });
      const body = parseVoiceCloneStatusBody(rawBody);

      if (body.executionMode === "live") {
        assertLiveProviderApproval({
          request,
          env,
          liveProviderApproved: body.liveProviderApproved,
        });
        const teacherId = requireString(
          body.teacherId,
          "teacherId is required for live Qwen voice clone polling.",
        );
        const sampleAssetId = requireString(
          body.sampleAssetId,
          "sampleAssetId is required for live Qwen voice clone polling.",
        );
        assertUaisAiAccess({
          request,
          env,
          action: "voice-clone-status",
          resource: {
            teacherId,
            sampleAssetId,
            providerTaskId: body.providerTaskId,
          },
          requireSignedSession: true,
        });

        const apiKey = env.DASHSCOPE_API_KEY;
        if (!apiKey) {
          throw new Error("DASHSCOPE_API_KEY is required for live Qwen voice clone polling.");
        }

        const client = qwenVoiceClientFactory({
          apiKey,
          baseUrl: env.DASHSCOPE_BASE_URL,
        });
        const providerStatus = await client.getVoiceCloneTaskStatus(body.providerTaskId);
        const voiceClone = createVoiceCloneTaskStatus(providerStatus);
        const voiceCloneReference =
          voiceClone.status === "ready"
            ? await storeClonedVoiceReference({
                teacherId,
                sampleAssetId,
                providerTaskId: voiceClone.providerTaskId,
                clonedVoiceId: voiceClone.clonedVoiceId,
              })
            : undefined;

        return Response.json({
          voiceClone: redactLiveVoiceCloneStatus(voiceClone),
          ...(voiceCloneReference ? { voiceCloneReference } : {}),
          providerRequestId: providerStatus.requestId,
          progress: createVoiceCloneStatusProgress(voiceClone),
          auditEvent: createLiveProviderAuditEvent({
            provider: "qwen",
            providerRole: "voice-clone",
            action: "voice-clone-status",
            subject: {
              providerTaskId: body.providerTaskId,
            },
          }),
        });
      }

      const teacherId = requireString(
        body.teacherId,
        "teacherId is required for Qwen voice clone polling.",
      );
      const sampleAssetId = requireString(
        body.sampleAssetId,
        "sampleAssetId is required for Qwen voice clone polling.",
      );
      assertUaisAiAccess({
        request,
        env,
        action: "voice-clone-status",
        resource: {
          teacherId,
          sampleAssetId,
          providerTaskId: body.providerTaskId,
        },
        requireSignedSession: true,
      });

      const voiceClone = createVoiceCloneTaskStatus({
        providerTaskId: body.providerTaskId,
        providerStatus: body.providerStatus ?? "RUNNING",
        clonedVoiceId: body.clonedVoiceId,
      });

      return Response.json({
        voiceClone,
        progress: createVoiceCloneStatusProgress(voiceClone),
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid voice clone task status request.",
        },
        { status: 400 },
      );
    }
  };
}

function authorizeVoiceCloneStatusRequestBeforeBodyRead(input: {
  request: Request;
  env: Record<string, string | undefined>;
}) {
  assertUaisAiAccess({
    request: input.request,
    env: input.env,
    action: "voice-clone-status",
    requireSignedSession: true,
  });
}

function authorizeVoiceCloneStatusRequestBeforeValidation(input: {
  request: Request;
  value: unknown;
  env: Record<string, string | undefined>;
}) {
  if (isRecord(input.value) && input.value.executionMode === "live") {
    return;
  }

  assertUaisAiAccess({
    request: input.request,
    env: input.env,
    action: "voice-clone-status",
    resource: {
      teacherId: isRecord(input.value) && typeof input.value.teacherId === "string"
        ? input.value.teacherId
        : undefined,
      sampleAssetId:
        isRecord(input.value) && typeof input.value.sampleAssetId === "string"
          ? input.value.sampleAssetId
          : undefined,
      providerTaskId:
        isRecord(input.value) && typeof input.value.providerTaskId === "string"
          ? input.value.providerTaskId
          : undefined,
    },
    requireSignedSession: true,
  });
}

function redactLiveVoiceCloneStatus(
  voiceClone: ReturnType<typeof createVoiceCloneTaskStatus>,
) {
  if (voiceClone.status !== "ready") {
    return voiceClone;
  }

  return {
    provider: voiceClone.provider,
    providerRole: voiceClone.providerRole,
    providerTaskId: voiceClone.providerTaskId,
    status: voiceClone.status,
    voiceRef: "server-side-cloned-qwen-voice",
    nextAction: voiceClone.nextAction,
  };
}

function createVoiceCloneStatusProgress(
  voiceClone: ReturnType<typeof createVoiceCloneTaskStatus>,
) {
  return assertResponsibleProgressIsDisplaySafe([
    createResponsibleProgressItem({
      index: 0,
      type: "qwen-voice-clone-status",
      status: voiceClone.status,
      responsibleSession: "S07",
      providerRole: "voice-clone",
      progressText:
        voiceClone.status === "ready"
          ? "S07 AI Agent Model confirmed the Qwen voice clone is ready for PPT narration."
          : `S07 AI Agent Model checked the Qwen voice clone status: ${voiceClone.status}.`,
    }),
  ]);
}

function parseVoiceCloneStatusBody(value: unknown): VoiceCloneStatusRouteBody {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const executionMode =
    value.executionMode === "live" || value.executionMode === "contract"
      ? value.executionMode
      : "contract";

  const providerTaskId = requireString(value.providerTaskId, "providerTaskId is required.");

  if (executionMode === "live") {
    return {
      executionMode,
      liveProviderApproved: value.liveProviderApproved === true,
      providerTaskId,
      teacherId: typeof value.teacherId === "string" ? value.teacherId : undefined,
      sampleAssetId: typeof value.sampleAssetId === "string" ? value.sampleAssetId : undefined,
    };
  }

  return {
    executionMode,
    liveProviderApproved: value.liveProviderApproved === true,
    providerTaskId,
    teacherId: typeof value.teacherId === "string" ? value.teacherId : undefined,
    sampleAssetId: typeof value.sampleAssetId === "string" ? value.sampleAssetId : undefined,
    providerStatus: parseProviderStatus(value.providerStatus),
    clonedVoiceId: typeof value.clonedVoiceId === "string" ? value.clonedVoiceId : undefined,
  };
}

function parseProviderStatus(value: unknown): QwenVoiceCloneProviderStatus {
  if (
    value === "PENDING" ||
    value === "RUNNING" ||
    value === "SUCCEEDED" ||
    value === "FAILED" ||
    value === "CANCELED"
  ) {
    return value;
  }

  throw new Error("providerStatus is invalid.");
}

function requireString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
