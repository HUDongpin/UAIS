import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
} from "@/lib/ai/progress/responsible-progress";
import { assertLiveProviderApproval } from "@/lib/ai/providers/live-approval";
import { createLiveProviderAuditEvent } from "@/lib/ai/providers/provider-audit";
import { createQwenVoiceClient, type QwenClonedVoiceRevokeResult } from "@/lib/ai/providers/qwen-client";
import {
  revokeAndDeleteQwenClonedVoiceReference as revokeAndDeleteQwenClonedVoiceReferenceDefault,
  type PublicQwenClonedVoiceReference,
  type QwenClonedVoiceDeletionReason,
  type RevokeAndDeleteQwenClonedVoiceReferenceInput,
  type RevokeAndDeleteQwenClonedVoiceReferenceResult,
} from "@/lib/ai/voice/cloned-voice-registry";
import {
  buildQwenVoiceLifecycleEventId,
  createQwenVoiceLifecycleAuditAdapter,
  createQwenVoiceLifecycleAuditEvent,
  type QwenVoiceLifecycleAuditEvent,
  type QwenVoiceLifecycleAuditReceipt,
} from "@/lib/ai/voice/lifecycle-audit-store";
import {
  assertUaisAiAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
  type UaisAiAccessDecision,
} from "@/lib/server/ai-access-control";

export const dynamic = "force-dynamic";

type VoiceCloneRevokeRouteBody = {
  executionMode: "contract" | "live";
  liveProviderApproved?: boolean;
  teacherId: string;
  sampleAssetId: string;
  voiceRefId: string;
  deletionReason: QwenClonedVoiceDeletionReason;
};

type QwenVoiceCloneRevokeClient = {
  revokeClonedVoice(clonedVoiceId: string): Promise<QwenClonedVoiceRevokeResult>;
};

type VoiceCloneRevokePostHandlerDeps = {
  env?: Record<string, string | undefined>;
  createQwenVoiceClient?: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => QwenVoiceCloneRevokeClient;
  revokeAndDeleteQwenClonedVoiceReference?: (
    input: RevokeAndDeleteQwenClonedVoiceReferenceInput,
  ) => Promise<RevokeAndDeleteQwenClonedVoiceReferenceResult>;
  recordVoiceLifecycleAuditEvent?: (
    event: QwenVoiceLifecycleAuditEvent,
  ) => Promise<QwenVoiceLifecycleAuditReceipt>;
};

export const POST = createVoiceCloneRevokePostHandler();

export function createVoiceCloneRevokePostHandler(
  deps: VoiceCloneRevokePostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const qwenVoiceClientFactory = deps.createQwenVoiceClient ?? createQwenVoiceClient;
  const revokeAndDeleteQwenClonedVoiceReference =
    deps.revokeAndDeleteQwenClonedVoiceReference ??
    revokeAndDeleteQwenClonedVoiceReferenceDefault;
  const lifecycleAuditAdapter = createQwenVoiceLifecycleAuditAdapter({ env });
  const recordVoiceLifecycleAuditEvent =
    deps.recordVoiceLifecycleAuditEvent ?? lifecycleAuditAdapter?.appendEvent;

  return async function POST(request: Request) {
    try {
      authorizeVoiceCloneRevokeRequestBeforeBodyRead({
        request,
        env,
      });
      const body = parseVoiceCloneRevokeBody(await request.json());
      const access = assertUaisAiAccess({
        request,
        env,
        action: "voice-clone-revoke",
        resource: {
          teacherId: body.teacherId,
          sampleAssetId: body.sampleAssetId,
          voiceRefId: body.voiceRefId,
        },
        requireSignedSession: true,
      });

      if (body.executionMode !== "live") {
        return Response.json({
          nextAction: "submit-qwen-voice-revoke",
          progress: createVoiceCloneRevokeProgress({
            accessStatus: "ready-to-authorize",
            providerStatus: "ready-to-revoke",
            localStatus: "pending",
          }),
        });
      }

      assertLiveProviderApproval({
        request,
        env,
        liveProviderApproved: body.liveProviderApproved,
      });
      if (!recordVoiceLifecycleAuditEvent) {
        return Response.json(
          {
            error: "UAIS voice lifecycle audit backend is not configured.",
          },
          { status: 501 },
        );
      }
      const apiKey = env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        throw new Error("DASHSCOPE_API_KEY is required for live Qwen voice clone revoke.");
      }

      const client = qwenVoiceClientFactory({
        apiKey,
        baseUrl: env.DASHSCOPE_BASE_URL,
      });
      let providerRevocation: QwenClonedVoiceRevokeResult | undefined;
      const revoke = await revokeAndDeleteQwenClonedVoiceReference({
        voiceRefId: body.voiceRefId,
        deletionReason: body.deletionReason,
        revokeProviderVoice: async ({ clonedVoiceId, publicReference }) => {
          assertStoredVoiceReferenceMatchesRequest(publicReference, body);
          providerRevocation = await client.revokeClonedVoice(clonedVoiceId);
          return { status: providerRevocation.status };
        },
      });

      if (!providerRevocation) {
        throw new Error("Qwen cloned voice revoke did not return provider status.");
      }
      const occurredAt = new Date().toISOString();
      const lifecycleAuditEvent = await recordVoiceLifecycleAuditEvent(
        createQwenVoiceLifecycleAuditEvent({
          eventId: buildQwenVoiceLifecycleEventId({
            voiceRefId: body.voiceRefId,
            occurredAt,
          }),
          occurredAt,
          actor: requireAccessActor(access),
          resource: {
            teacherId: body.teacherId,
            sampleAssetId: body.sampleAssetId,
            voiceRefId: body.voiceRefId,
          },
          deletionReason: body.deletionReason,
          providerRevocation: {
            status: providerRevocation.status,
            requestId: providerRevocation.requestId,
          },
          localReference: {
            status: revoke.localReference.status,
          },
          localAuditRecord: {
            auditId: revoke.auditRecord.auditId,
            storagePolicy: revoke.auditRecord.storagePolicy,
          },
        }),
      );

      return Response.json({
        revoke,
        providerRevocation,
        lifecycleAuditEvent,
        progress: createVoiceCloneRevokeProgress({
          accessStatus: "authorized",
          providerStatus: providerRevocation.status,
          localStatus: "deleted",
        }),
        auditEvent: createLiveProviderAuditEvent({
          provider: "qwen",
          providerRole: "voice-clone",
          action: "voice-clone-revoke",
          subject: {
            teacherId: body.teacherId,
            sampleAssetId: body.sampleAssetId,
            voiceRefId: body.voiceRefId,
          },
        }),
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid voice clone revoke request.",
        },
        { status: 400 },
      );
    }
  };
}

function requireAccessActor(
  access: UaisAiAccessDecision,
): QwenVoiceLifecycleAuditEvent["actor"] {
  if (!access.actor) {
    throw new Error("Authorized voice revoke request is missing actor context.");
  }
  return access.actor;
}

function createVoiceCloneRevokeProgress(input: {
  accessStatus: "ready-to-authorize" | "authorized";
  providerStatus: "ready-to-revoke" | "revoked";
  localStatus: "pending" | "deleted";
}) {
  return assertResponsibleProgressIsDisplaySafe([
    createResponsibleProgressItem({
      index: 0,
      type: "s12-revoke-access-boundary",
      status: input.accessStatus,
      responsibleSession: "S12",
      providerRole: "voice-clone",
      progressText:
        input.accessStatus === "authorized"
          ? "S12 Backend/API Platform authorized the signed teacher request to revoke the server-side Qwen voice reference."
          : "S12 Backend/API Platform prepared the signed teacher access boundary for Qwen voice revoke.",
    }),
    createResponsibleProgressItem({
      index: 1,
      type: "s07-qwen-voice-revoke",
      status: input.providerStatus,
      responsibleSession: "S07",
      providerRole: "voice-clone",
      progressText:
        input.providerStatus === "revoked"
          ? "S07 AI Agent Model revoked the cloned Qwen voice through the provider adapter."
          : "S07 AI Agent Model prepared the Qwen cloned-voice revoke adapter.",
    }),
    createResponsibleProgressItem({
      index: 2,
      type: "s24-local-voice-reference-delete",
      status: input.localStatus,
      responsibleSession: "S24",
      providerRole: "voice-clone",
      progressText:
        input.localStatus === "deleted"
          ? "S24 Asset and Export Quality deleted the local private voice reference and kept a redacted lifecycle audit record."
          : "S24 Asset and Export Quality is ready to delete the local private voice reference after provider revoke.",
    }),
  ]);
}

function assertStoredVoiceReferenceMatchesRequest(
  publicReference: PublicQwenClonedVoiceReference,
  body: VoiceCloneRevokeRouteBody,
) {
  if (
    publicReference.voiceRefId !== body.voiceRefId ||
    publicReference.teacherId !== body.teacherId ||
    publicReference.sampleAssetId !== body.sampleAssetId
  ) {
    throw new Error("Stored Qwen voice reference does not match the requested revoke target.");
  }
}

function authorizeVoiceCloneRevokeRequestBeforeBodyRead(input: {
  request: Request;
  env: Record<string, string | undefined>;
}) {
  assertUaisAiAccess({
    request: input.request,
    env: input.env,
    action: "voice-clone-revoke",
    requireSignedSession: true,
  });
}

function parseVoiceCloneRevokeBody(value: unknown): VoiceCloneRevokeRouteBody {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const executionMode =
    value.executionMode === "live" || value.executionMode === "contract"
      ? value.executionMode
      : "contract";
  const deletionReason =
    value.deletionReason === "source-sample-deletion"
      ? "source-sample-deletion"
      : value.deletionReason === "owner-request" || value.deletionReason === undefined
        ? "owner-request"
        : undefined;
  if (!deletionReason) {
    throw new Error("deletionReason is invalid.");
  }

  return {
    executionMode,
    liveProviderApproved: value.liveProviderApproved === true,
    teacherId: requireString(value.teacherId, "teacherId is required."),
    sampleAssetId: requireString(value.sampleAssetId, "sampleAssetId is required."),
    voiceRefId: requireString(value.voiceRefId, "voiceRefId is required."),
    deletionReason,
  };
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
