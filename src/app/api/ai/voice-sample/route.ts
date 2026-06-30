import {
  createTeacherVoiceSampleIntake,
  type TeacherVoiceConsentScope,
  type TeacherVoiceSampleSourceKind,
  type TeacherVoiceSampleIntakeRequest,
} from "@/lib/ai/voice/sample-intake";
import {
  storeTeacherVoiceSampleAsset,
  type StoreTeacherVoiceSampleAssetInput,
  type StoredTeacherVoiceSampleAsset,
} from "@/lib/ai/voice/sample-assets";
import {
  storeQwenClonedVoiceReference,
  type PublicQwenClonedVoiceReference,
  type StoreQwenClonedVoiceReferenceInput,
} from "@/lib/ai/voice/cloned-voice-registry";
import {
  createQwenVoiceClient,
  type QwenTaskSubmitResult,
} from "@/lib/ai/providers/qwen-client";
import { assertLiveProviderApproval } from "@/lib/ai/providers/live-approval";
import { createLiveProviderAuditEvent } from "@/lib/ai/providers/provider-audit";
import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
} from "@/lib/ai/progress/responsible-progress";
import type { Locale } from "@/i18n/copy";
import {
  assertUaisAiAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";
import {
  createUaisTeacherAiOwnershipMergeAdapter,
  type UaisTeacherAiOwnershipMergeInput,
  type UaisTeacherAiOwnershipMergeResult,
} from "@/lib/server/teacher-ai-ownership-store";

export const dynamic = "force-dynamic";

type VoiceSampleRouteBody = TeacherVoiceSampleIntakeRequest & {
  executionMode: "contract" | "live";
  liveProviderApproved?: boolean;
  targetVoiceLabel?: string;
  preferredVoiceName?: string;
  sampleAudioDataUrl?: string;
  sampleAudioBase64?: string;
  sampleText?: string;
  languageHint?: string;
};

type QwenVoiceSampleClient = {
  submitVoiceClone(input: {
    teacherId: string;
    sampleAssetId: string;
    sampleDurationSeconds: number;
    targetVoiceLabel: string;
    preferredVoiceName?: string;
    sampleAudioDataUrl?: string;
    sampleText?: string;
    languageHint?: string;
  }): Promise<QwenTaskSubmitResult>;
};

type VoiceSamplePostHandlerDeps = {
  env?: Record<string, string | undefined>;
  createQwenVoiceClient?: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => QwenVoiceSampleClient;
  storeTeacherVoiceSampleAsset?: (
    input: StoreTeacherVoiceSampleAssetInput,
  ) => Promise<StoredTeacherVoiceSampleAsset>;
  storeQwenClonedVoiceReference?: (
    input: StoreQwenClonedVoiceReferenceInput,
  ) => Promise<PublicQwenClonedVoiceReference>;
  mergeTeacherAiOwnershipRecord?: (
    input: UaisTeacherAiOwnershipMergeInput,
  ) => Promise<UaisTeacherAiOwnershipMergeResult>;
};

export const POST = createVoiceSamplePostHandler();

export function createVoiceSamplePostHandler(deps: VoiceSamplePostHandlerDeps = {}) {
  const env = deps.env ?? process.env;
  const qwenVoiceClientFactory = deps.createQwenVoiceClient ?? createQwenVoiceClient;
  const storeVoiceSampleAsset = deps.storeTeacherVoiceSampleAsset ?? storeTeacherVoiceSampleAsset;
  const storeClonedVoiceReference =
    deps.storeQwenClonedVoiceReference ?? storeQwenClonedVoiceReference;
  const mergeTeacherAiOwnershipRecord =
    deps.mergeTeacherAiOwnershipRecord ??
    createUaisTeacherAiOwnershipMergeAdapter({ env }) ??
    (async () => {
      throw new Error("UAIS teacher AI ownership merge backend is not ready.");
    });

  return async function POST(request: Request) {
    try {
      authorizeVoiceSampleRequestBeforeBodyRead({
        request,
        env,
      });
      const rawBody = await request.json();
      authorizeContractVoiceSampleRequestBeforeValidation({
        request,
        value: rawBody,
        env,
      });
      const body = parseVoiceSampleBody(rawBody);
      if (body.executionMode === "live") {
        assertLiveProviderApproval({
          request,
          env,
          liveProviderApproved: body.liveProviderApproved,
        });
      }
      assertUaisAiAccess({
        request,
        action: "voice-sample-submit",
        resource: {
          teacherId: body.teacherId,
          sampleAssetId: body.sampleAssetId,
        },
        env,
        requireSignedSession: true,
      });
      assertUploadedWavSampleDuration(body);

      const sample = createTeacherVoiceSampleIntake(body);
      const sampleAsset = body.sampleAudioBase64
        ? await storeVoiceSampleAsset({
            teacherId: body.teacherId,
            sampleAssetId: body.sampleAssetId,
            sampleDurationSeconds: body.sampleDurationSeconds,
            consentScope: body.consentScope,
            sourceKind: body.sourceKind,
            mimeType: body.mimeType,
            audioBase64: body.sampleAudioBase64,
          })
        : undefined;

      if (body.executionMode === "live") {
        const apiKey = env.DASHSCOPE_API_KEY;
        if (!apiKey) {
          throw new Error("DASHSCOPE_API_KEY is required for live Qwen voice clone submission.");
        }

        const targetVoiceLabel = requireString(
          body.targetVoiceLabel,
          "targetVoiceLabel is required for live Qwen voice clone submission.",
        );
        const client = qwenVoiceClientFactory({
          apiKey,
          baseUrl: env.DASHSCOPE_BASE_URL,
        });

        const voiceCloneSubmission = await client.submitVoiceClone({
          teacherId: body.teacherId,
          sampleAssetId: body.sampleAssetId,
          sampleDurationSeconds: body.sampleDurationSeconds,
          targetVoiceLabel,
          preferredVoiceName: body.preferredVoiceName,
          sampleAudioDataUrl:
            body.sampleAudioDataUrl ??
            (body.sampleAudioBase64
              ? `data:${body.mimeType};base64,${body.sampleAudioBase64}`
              : undefined),
          sampleText: body.sampleText,
          languageHint: body.languageHint,
        });
        const voiceCloneReference = voiceCloneSubmission.clonedVoiceId
          ? await storeClonedVoiceReference({
              teacherId: body.teacherId,
              sampleAssetId: body.sampleAssetId,
              providerTaskId: voiceCloneSubmission.taskId,
              clonedVoiceId: voiceCloneSubmission.clonedVoiceId,
              targetModel: voiceCloneSubmission.targetModel,
            })
          : undefined;
        const ownershipRecord = await mergeTeacherAiOwnershipRecord({
          ownership: {
            teacherId: body.teacherId,
            sampleAssets: [{ sampleAssetId: body.sampleAssetId }],
            clonedVoiceRefs: voiceCloneReference
              ? [
                  {
                    voiceRefId: voiceCloneReference.voiceRefId,
                    sampleAssetId: body.sampleAssetId,
                  },
                ]
              : [],
          },
        });

        return Response.json({
          sample,
          ...(sampleAsset ? { sampleAsset } : {}),
          nextAction: "poll-qwen-voice-clone-task",
          progress: createVoiceSampleProgress({
            voiceCloneSubmission,
            hasVoiceCloneReference: Boolean(voiceCloneReference),
            ownershipUpdated: Boolean(ownershipRecord),
          }),
          voiceCloneSubmission: redactVoiceCloneSubmission(voiceCloneSubmission),
          ...(voiceCloneReference ? { voiceCloneReference } : {}),
          auditEvent: createLiveProviderAuditEvent({
            provider: "qwen",
            providerRole: "voice-clone",
            action: "voice-clone-submit",
            subject: {
              teacherId: body.teacherId,
              sampleAssetId: body.sampleAssetId,
            },
          }),
        });
      }

      return Response.json({
        sample,
        ...(sampleAsset ? { sampleAsset } : {}),
        nextAction: "submit-qwen-voice-clone",
        progress: createVoiceSampleProgress(),
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Invalid teacher voice sample request.",
        },
        { status: 400 },
      );
    }
  };
}

function authorizeVoiceSampleRequestBeforeBodyRead(input: {
  request: Request;
  env: Record<string, string | undefined>;
}) {
  assertUaisAiAccess({
    request: input.request,
    action: "voice-sample-submit",
    env: input.env,
    requireSignedSession: true,
  });
}

function authorizeContractVoiceSampleRequestBeforeValidation(input: {
  request: Request;
  value: unknown;
  env: Record<string, string | undefined>;
}) {
  const executionMode = isRecord(input.value) ? input.value.executionMode : undefined;
  if (executionMode === "live") {
    return;
  }

  assertUaisAiAccess({
    request: input.request,
    action: "voice-sample-submit",
    resource: {
      teacherId: isRecord(input.value) && typeof input.value.teacherId === "string"
        ? input.value.teacherId
        : undefined,
      sampleAssetId:
        isRecord(input.value) && typeof input.value.sampleAssetId === "string"
          ? input.value.sampleAssetId
          : undefined,
    },
    env: input.env,
    requireSignedSession: true,
  });
}

function createVoiceSampleProgress(input?: {
  voiceCloneSubmission?: QwenTaskSubmitResult;
  hasVoiceCloneReference?: boolean;
  ownershipUpdated?: boolean;
}) {
  const voiceCloneSubmitted = input?.voiceCloneSubmission !== undefined;
  const progress = [
    createResponsibleProgressItem({
      index: 0,
      type: "teacher-voice-sample",
      status: "ready-for-clone",
      responsibleSession: "S24",
      providerRole: "voice-clone",
      progressText:
        "S24 Asset and Export Quality verified the 10-second teacher voice sample for Qwen voice cloning.",
    }),
    createResponsibleProgressItem({
      index: 1,
      type: "qwen-voice-clone-submit",
      status: voiceCloneSubmitted ? "submitted" : "ready-to-submit",
      responsibleSession: "S07",
      providerRole: "voice-clone",
      progressText: voiceCloneSubmitted
        ? "S07 AI Agent Model submitted the 10-second teacher voice sample to Qwen voice clone."
        : "S07 AI Agent Model prepared the Qwen voice-clone submission for PPT narration.",
    }),
  ];

  if (input?.hasVoiceCloneReference) {
    progress.push(
      createResponsibleProgressItem({
        index: 2,
        type: "server-side-voice-reference",
        status: "ready",
        responsibleSession: "S12",
        providerRole: "voice-clone",
        progressText:
          "S12 Backend/API Platform stored the Qwen cloned voice id behind a server-side voice reference.",
      }),
    );
  }

  if (input?.ownershipUpdated) {
    progress.push(
      createResponsibleProgressItem({
        index: progress.length,
        type: "s12-teacher-ai-ownership-registry",
        status: "updated",
        responsibleSession: "S12",
        providerRole: "voice-clone",
        progressText:
          "S12 Backend/API Platform updated the server-side teacher AI ownership registry for the sample and public voiceRef.",
      }),
    );
  }

  return assertResponsibleProgressIsDisplaySafe(progress);
}

function redactVoiceCloneSubmission(value: QwenTaskSubmitResult) {
  return {
    provider: value.provider,
    taskId: value.taskId,
    requestId: value.requestId,
    status: value.status,
    targetModel: value.targetModel,
    voiceRef: value.clonedVoiceId ? "server-side-cloned-qwen-voice" : undefined,
  };
}

function parseVoiceSampleBody(value: unknown): VoiceSampleRouteBody {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const executionMode =
    value.executionMode === "live" || value.executionMode === "contract"
      ? value.executionMode
      : "contract";

  return {
    executionMode,
    liveProviderApproved: value.liveProviderApproved === true,
    teacherId: requireString(value.teacherId, "teacherId is required."),
    consentConfirmed: value.consentConfirmed === true,
    consentScope: parseConsentScope(value.consentScope),
    sampleAssetId: requireString(value.sampleAssetId, "sampleAssetId is required."),
    sampleDurationSeconds:
      typeof value.sampleDurationSeconds === "number" ? value.sampleDurationSeconds : 0,
    mimeType: requireString(value.mimeType, "mimeType is required."),
    sourceKind: parseSourceKind(value.sourceKind),
    language: parseOptionalLocale(value.language),
    targetVoiceLabel:
      typeof value.targetVoiceLabel === "string" ? value.targetVoiceLabel : undefined,
    preferredVoiceName:
      typeof value.preferredVoiceName === "string" ? value.preferredVoiceName : undefined,
    sampleAudioDataUrl:
      typeof value.sampleAudioDataUrl === "string" ? value.sampleAudioDataUrl : undefined,
    sampleAudioBase64:
      typeof value.sampleAudioBase64 === "string" ? value.sampleAudioBase64 : undefined,
    sampleText: typeof value.sampleText === "string" ? value.sampleText : undefined,
    languageHint: typeof value.languageHint === "string" ? value.languageHint : undefined,
  };
}

function assertUploadedWavSampleDuration(body: VoiceSampleRouteBody) {
  if (!body.sampleAudioBase64 || !isWavMimeType(body.mimeType)) {
    return;
  }

  const durationSeconds = readWavPcmDurationSeconds(body.sampleAudioBase64);
  if (durationSeconds === undefined) {
    throw new Error("Teacher voice sample WAV payload is invalid.");
  }
  if (durationSeconds < 10) {
    throw new Error("Teacher voice sample must be at least 10 seconds long.");
  }
}

function isWavMimeType(mimeType: string) {
  return ["audio/wav", "audio/wave", "audio/x-wav"].includes(mimeType);
}

function readWavPcmDurationSeconds(audioBase64: string) {
  const bytes = Buffer.from(audioBase64, "base64");
  if (
    bytes.byteLength < 44 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    return undefined;
  }

  let byteRate: number | undefined;
  let dataSize: number | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = bytes.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const nextOffset = chunkStart + chunkSize + (chunkSize % 2);
    if (chunkStart + chunkSize > bytes.byteLength) {
      return undefined;
    }

    if (chunkId === "fmt " && chunkSize >= 16) {
      byteRate = bytes.readUInt32LE(chunkStart + 8);
    }
    if (chunkId === "data") {
      dataSize = chunkSize;
    }

    offset = nextOffset;
  }

  if (!byteRate || dataSize === undefined) {
    return undefined;
  }
  return dataSize / byteRate;
}

function parseConsentScope(value: unknown): TeacherVoiceConsentScope {
  if (value === "ppt-narration") {
    return value;
  }

  throw new Error("consentScope must be ppt-narration.");
}

function parseSourceKind(value: unknown): TeacherVoiceSampleSourceKind {
  if (value === "owner-provided" || value === "upload") {
    return value;
  }

  throw new Error("sourceKind must be owner-provided or upload.");
}

function parseOptionalLocale(value: unknown): Locale | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "zh-CN" || value === "en-US") {
    return value;
  }

  throw new Error("language must be zh-CN or en-US.");
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
