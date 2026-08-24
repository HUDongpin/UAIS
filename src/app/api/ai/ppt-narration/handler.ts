import {
  createPptNarrationJob,
  createTeacherVoiceCloneJob,
  type PptNarrationJob,
  type PptNarrationRequest,
  type TeacherVoiceCloneRequest,
} from "@/lib/ai/voice/ppt-narration";
import {
  createQwenVoiceClient,
  type QwenPptNarrationSubmitResult,
  type QwenTaskSubmitResult,
} from "@/lib/ai/providers/qwen-client";
import { assertLiveProviderApproval } from "@/lib/ai/providers/live-approval";
import { createLiveProviderAuditEvent } from "@/lib/ai/providers/provider-audit";
import {
  storePptNarrationAudioAssets,
  type StorePptNarrationAudioAssetsInput,
  type StoredPptNarrationAudioManifest,
} from "@/lib/ai/voice/ppt-narration-assets";
import {
  readQwenClonedVoiceReference,
  type PrivateQwenClonedVoiceReference,
} from "@/lib/ai/voice/cloned-voice-registry";
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

type PptNarrationRouteBody = {
  executionMode?: "contract" | "live";
  liveProviderApproved?: boolean;
  voiceClone: TeacherVoiceCloneRequest;
  pptNarration: PptNarrationRouteRequest;
};

type PptNarrationRouteRequest = Omit<PptNarrationRequest, "clonedVoiceId"> & {
  clonedVoiceId?: string;
  clonedVoiceRef?: string;
};

type QwenVoiceClient = {
  submitVoiceClone(input: {
    teacherId: string;
    sampleAssetId: string;
    sampleDurationSeconds: number;
    targetVoiceLabel: string;
  }): Promise<QwenTaskSubmitResult>;
  submitPptNarration(
    input: PptNarrationRequest,
  ): Promise<QwenTaskSubmitResult | QwenPptNarrationSubmitResult>;
};

type PptNarrationPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  createQwenVoiceClient?: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => QwenVoiceClient;
  storePptNarrationAudioAssets?: (
    input: StorePptNarrationAudioAssetsInput,
  ) => Promise<StoredPptNarrationAudioManifest>;
  readQwenClonedVoiceReference?: (input: {
    voiceRefId: string;
  }) => Promise<PrivateQwenClonedVoiceReference>;
  mergeTeacherAiOwnershipRecord?: (
    input: UaisTeacherAiOwnershipMergeInput,
  ) => Promise<UaisTeacherAiOwnershipMergeResult>;
};

export function createPptNarrationPostHandler(deps: PptNarrationPostHandlerDeps = {}) {
  const env = deps.env ?? process.env;
  const qwenVoiceClientFactory = deps.createQwenVoiceClient ?? createQwenVoiceClient;
  const storeAudioAssets = deps.storePptNarrationAudioAssets ?? storePptNarrationAudioAssets;
  const readClonedVoiceReference = deps.readQwenClonedVoiceReference ?? readQwenClonedVoiceReference;
  const mergeTeacherAiOwnershipRecord =
    deps.mergeTeacherAiOwnershipRecord ??
    createUaisTeacherAiOwnershipMergeAdapter({ env }) ??
    (async () => {
      throw new Error("UAIS teacher AI ownership merge backend is not ready.");
    });

  return async function POST(request: Request) {
    try {
      authorizePptNarrationRequestBeforeBodyRead({
        request,
        env,
      });
      const rawBody = await request.json();
      authorizePptNarrationRequestBeforeValidation({
        request,
        value: rawBody,
        env,
      });
      const body = parsePptNarrationBody(rawBody);
      if (body.executionMode === "live") {
        assertLiveProviderApproval({
          request,
          env,
          liveProviderApproved: body.liveProviderApproved,
        });
      }
      assertUaisAiAccess({
        request,
        action: "ppt-narration-submit",
        resource: {
          teacherId: body.voiceClone.teacherId,
          sampleAssetId: body.voiceClone.sampleAssetId,
          courseId: body.pptNarration.courseId,
          pptAssetId: body.pptNarration.pptAssetId,
          voiceRefId: body.pptNarration.clonedVoiceRef,
        },
        env,
        requireSignedSession: true,
      });

      const voiceCloneJob = createTeacherVoiceCloneJob(body.voiceClone);
      const pptNarrationRequest = await resolvePptNarrationRequest({
        voiceClone: body.voiceClone,
        request: body.pptNarration,
        executionMode: body.executionMode,
        readQwenClonedVoiceReference: readClonedVoiceReference,
      });
      const pptNarrationJob = createPptNarrationJob(pptNarrationRequest);

      if (body.executionMode === "live") {
        const apiKey = env.DASHSCOPE_API_KEY;
        if (!apiKey) {
          throw new Error("DASHSCOPE_API_KEY is required for live Qwen voice tasks.");
        }

        const client = qwenVoiceClientFactory({
          apiKey,
          baseUrl: env.DASHSCOPE_BASE_URL,
        });

        const pptNarrationSubmission = await client.submitPptNarration(pptNarrationRequest);
        const pptNarrationAssets = isQwenPptNarrationSubmitResult(pptNarrationSubmission)
          ? await storeAudioAssets({
              manifest: pptNarrationSubmission.audioManifest,
              audioSegments: pptNarrationSubmission.audioSegments,
            })
          : undefined;
        const ownershipRecord = pptNarrationAssets
          ? await mergeTeacherAiOwnershipRecord({
              ownership: {
                teacherId: body.voiceClone.teacherId,
                courseIds: [body.pptNarration.courseId],
                sampleAssets: [
                  {
                    sampleAssetId: body.voiceClone.sampleAssetId,
                    courseId: body.pptNarration.courseId,
                  },
                ],
                pptAssets: [
                  {
                    pptAssetId: body.pptNarration.pptAssetId,
                    courseId: body.pptNarration.courseId,
                  },
                ],
                clonedVoiceRefs: body.pptNarration.clonedVoiceRef
                  ? [
                      {
                        voiceRefId: body.pptNarration.clonedVoiceRef,
                        sampleAssetId: body.voiceClone.sampleAssetId,
                      },
                    ]
                  : [],
                audioManifests: [
                  {
                    audioManifestId: pptNarrationAssets.id,
                    courseId: pptNarrationAssets.courseId,
                    pptAssetId: pptNarrationAssets.pptAssetId,
                    voiceRefId: body.pptNarration.clonedVoiceRef,
                  },
                ],
              },
            })
          : undefined;

        return Response.json({
          voiceCloneJob,
          pptNarrationJob: redactPptNarrationJob(pptNarrationJob),
          progress: createPptNarrationProgress({
            voiceCloneJob,
            pptNarrationJob,
            pptNarrationAssets,
            ownershipUpdated: Boolean(ownershipRecord),
            includeLiveControls: true,
          }),
          pptNarrationSubmission: redactPptNarrationSubmission(pptNarrationSubmission),
          ...(pptNarrationAssets ? { pptNarrationAssets } : {}),
          auditEvents: [
            createLiveProviderAuditEvent({
              provider: "qwen",
              providerRole: "ppt-narration",
              action: "ppt-narration-submit",
              subject: {
                courseId: body.pptNarration.courseId,
                pptAssetId: body.pptNarration.pptAssetId,
              },
            }),
          ],
        });
      }

      return Response.json({
        voiceCloneJob,
        pptNarrationJob: redactPptNarrationJob(pptNarrationJob),
        progress: createPptNarrationProgress({ voiceCloneJob, pptNarrationJob }),
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Invalid PPT narration request.",
        },
        { status: 400 },
      );
    }
  };
}

function authorizePptNarrationRequestBeforeBodyRead(input: {
  request: Request;
  env: Record<string, string | undefined>;
}) {
  assertUaisAiAccess({
    request: input.request,
    action: "ppt-narration-submit",
    env: input.env,
    requireSignedSession: true,
  });
}

function authorizePptNarrationRequestBeforeValidation(input: {
  request: Request;
  value: unknown;
  env: Record<string, string | undefined>;
}) {
  if (isRecord(input.value) && input.value.executionMode === "live") {
    return;
  }

  const voiceClone = isRecord(input.value) ? input.value.voiceClone : undefined;
  const pptNarration = isRecord(input.value) ? input.value.pptNarration : undefined;
  assertUaisAiAccess({
    request: input.request,
    action: "ppt-narration-submit",
    resource: {
      teacherId: readRecordString(voiceClone, "teacherId"),
      sampleAssetId: readRecordString(voiceClone, "sampleAssetId"),
      courseId: readRecordString(pptNarration, "courseId"),
      pptAssetId: readRecordString(pptNarration, "pptAssetId"),
      voiceRefId: readRecordString(pptNarration, "clonedVoiceRef"),
    },
    env: input.env,
    requireSignedSession: true,
  });
}

function readRecordString(value: unknown, key: string) {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function isQwenPptNarrationSubmitResult(
  value: QwenTaskSubmitResult | QwenPptNarrationSubmitResult,
): value is QwenPptNarrationSubmitResult {
  return "audioManifest" in value && "audioSegments" in value;
}

function redactPptNarrationSubmission(
  value: QwenTaskSubmitResult | QwenPptNarrationSubmitResult,
) {
  if (!isQwenPptNarrationSubmitResult(value)) {
    return value;
  }

  return {
    provider: value.provider,
    taskId: value.taskId,
    status: value.status,
    targetModel: value.targetModel,
    audioManifest: value.audioManifest,
  };
}

function redactPptNarrationJob(job: PptNarrationJob) {
  return {
    id: job.id,
    provider: job.provider,
    providerRole: job.providerRole,
    status: job.status,
    courseId: job.courseId,
    pptAssetId: job.pptAssetId,
    voiceRef: "server-side-cloned-qwen-voice",
    language: job.language,
    slideCount: job.slideCount,
    audioManifestId: job.audioManifestId,
    targetModel: job.targetModel,
  };
}

function createPptNarrationProgress({
  voiceCloneJob,
  pptNarrationJob,
  pptNarrationAssets,
  ownershipUpdated,
  includeLiveControls = false,
}: {
  voiceCloneJob: ReturnType<typeof createTeacherVoiceCloneJob>;
  pptNarrationJob: PptNarrationJob;
  pptNarrationAssets?: StoredPptNarrationAudioManifest;
  ownershipUpdated?: boolean;
  includeLiveControls?: boolean;
}) {
  const progress = [
    createResponsibleProgressItem({
      index: 0,
      type: "teacher-voice-sample",
      status: "ready-for-clone",
      responsibleSession: "S24",
      providerRole: "voice-clone",
      progressText:
        "S24 Asset and Export Quality verified the 10-second teacher voice sample for Qwen PPT narration.",
    }),
    createResponsibleProgressItem({
      index: 1,
      type: "qwen-voice-clone",
      status: voiceCloneJob.status,
      responsibleSession: "S07",
      providerRole: "voice-clone",
      progressText:
        "S07 AI Agent Model prepared the Qwen voice-clone job using a server-side voice reference.",
    }),
    createResponsibleProgressItem({
      index: 2,
      type: "qwen-ppt-narration",
      status: pptNarrationJob.status,
      responsibleSession: "S07",
      providerRole: "ppt-narration",
      progressText: `S07 AI Agent Model prepared Qwen PPT narration for ${pptNarrationJob.slideCount} ${
        pptNarrationJob.slideCount === 1 ? "slide" : "slides"
      } in ${pptNarrationJob.courseId}.`,
    }),
  ];

  if (includeLiveControls) {
    progress.push(
      createResponsibleProgressItem({
        index: progress.length,
        type: "qwen-live-provider-environment",
        status: "verified",
        responsibleSession: "S19",
        providerRole: "ppt-narration",
        progressText:
          "S19 API Configuration verified the approved Qwen live provider environment for PPT narration.",
      }),
      createResponsibleProgressItem({
        index: progress.length + 1,
        type: "ppt-narration-access-boundary",
        status: "verified",
        responsibleSession: "S12",
        providerRole: "ppt-narration",
        progressText:
          "S12 Backend/API Platform verified the actor, course, sample, PPT, and voiceRef access boundary for live PPT narration.",
      }),
    );
  }

  if (pptNarrationAssets) {
    progress.push(
      createResponsibleProgressItem({
        index: progress.length,
        type: "qwen-ppt-audio-assets",
        status: "stored",
        responsibleSession: "S24",
        providerRole: "ppt-narration",
        progressText: `S24 Asset and Export Quality stored ${pptNarrationAssets.assets.length} Qwen WAV audio ${
          pptNarrationAssets.assets.length === 1 ? "asset" : "assets"
        } for secure download.`,
      }),
    );
  }

  if (ownershipUpdated) {
    progress.push(
      createResponsibleProgressItem({
        index: progress.length,
        type: "s12-teacher-ai-ownership-registry",
        status: "updated",
        responsibleSession: "S12",
        providerRole: "ppt-narration",
        progressText:
          "S12 Backend/API Platform updated the server-side teacher AI ownership registry for the PPT narration audio manifest.",
      }),
    );
  }

  return assertResponsibleProgressIsDisplaySafe(progress);
}

async function resolvePptNarrationRequest(input: {
  voiceClone: TeacherVoiceCloneRequest;
  request: PptNarrationRouteRequest;
  executionMode?: "contract" | "live";
  readQwenClonedVoiceReference: (request: {
    voiceRefId: string;
  }) => Promise<PrivateQwenClonedVoiceReference>;
}): Promise<PptNarrationRequest> {
  if (input.request.clonedVoiceId?.trim()) {
    return {
      ...input.request,
      clonedVoiceId: input.request.clonedVoiceId,
    };
  }

  if (!input.request.clonedVoiceRef?.trim()) {
    throw new Error("clonedVoiceId or clonedVoiceRef is required.");
  }

  if (input.executionMode === "live") {
    const reference = await input.readQwenClonedVoiceReference({
      voiceRefId: input.request.clonedVoiceRef,
    });
    assertVoiceReferenceMatchesRequest({
      reference,
      voiceClone: input.voiceClone,
      voiceRefId: input.request.clonedVoiceRef,
    });
    return {
      ...input.request,
      clonedVoiceId: reference.clonedVoiceId,
    };
  }

  return {
    ...input.request,
    clonedVoiceId: "server-side-cloned-qwen-voice",
  };
}

function assertVoiceReferenceMatchesRequest(input: {
  reference: PrivateQwenClonedVoiceReference;
  voiceClone: TeacherVoiceCloneRequest;
  voiceRefId: string;
}) {
  const publicReference = input.reference.publicReference;
  if (
    publicReference.voiceRefId !== input.voiceRefId ||
    publicReference.teacherId !== input.voiceClone.teacherId ||
    publicReference.sampleAssetId !== input.voiceClone.sampleAssetId
  ) {
    throw new Error(
      "Stored Qwen voice reference does not match the requested teacher voice sample.",
    );
  }
}

function parsePptNarrationBody(value: unknown): PptNarrationRouteBody {
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
    voiceClone: parseVoiceCloneRequest(value.voiceClone),
    pptNarration: parsePptNarrationRequest(value.pptNarration),
  };
}

function parseVoiceCloneRequest(value: unknown): TeacherVoiceCloneRequest {
  if (!isRecord(value)) {
    throw new Error("voiceClone must be an object.");
  }

  return {
    teacherId: requireString(value.teacherId, "teacherId is required."),
    consentConfirmed: value.consentConfirmed === true,
    sampleAssetId: requireString(value.sampleAssetId, "sampleAssetId is required."),
    sampleDurationSeconds:
      typeof value.sampleDurationSeconds === "number" ? value.sampleDurationSeconds : 0,
    language: parseLocale(value.language),
    targetVoiceLabel: requireString(value.targetVoiceLabel, "targetVoiceLabel is required."),
  };
}

function parsePptNarrationRequest(value: unknown): PptNarrationRouteRequest {
  if (!isRecord(value)) {
    throw new Error("pptNarration must be an object.");
  }

  const slideScripts = Array.isArray(value.slideScripts)
    ? value.slideScripts.map((script) => {
        if (!isRecord(script)) {
          throw new Error("slideScripts must contain objects.");
        }
        return {
          slideId: requireString(script.slideId, "slideId is required."),
          narrationText: requireString(script.narrationText, "narrationText is required."),
        };
      })
    : [];

  return {
    courseId: requireString(value.courseId, "courseId is required."),
    pptAssetId: requireString(value.pptAssetId, "pptAssetId is required."),
    clonedVoiceId:
      typeof value.clonedVoiceId === "string" && value.clonedVoiceId.trim()
        ? value.clonedVoiceId
        : undefined,
    clonedVoiceRef:
      typeof value.clonedVoiceRef === "string" && value.clonedVoiceRef.trim()
        ? value.clonedVoiceRef
        : undefined,
    language: parseLocale(value.language),
    slideScripts,
    targetModel: typeof value.targetModel === "string" && value.targetModel.trim()
      ? value.targetModel
      : undefined,
  };
}

function parseLocale(value: unknown): Locale {
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
