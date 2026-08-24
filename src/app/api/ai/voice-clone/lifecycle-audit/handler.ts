import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
} from "@/lib/ai/progress/responsible-progress";
import {
  createQwenVoiceLifecycleAuditAdapter,
  type QwenVoiceLifecycleAuditIndex,
} from "@/lib/ai/voice/lifecycle-audit-store";
import {
  assertUaisAiAdminAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";

type VoiceLifecycleAuditGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  listVoiceLifecycleAuditEvents?: () => Promise<QwenVoiceLifecycleAuditIndex>;
};

export function createVoiceLifecycleAuditGetHandler(
  deps: VoiceLifecycleAuditGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const lifecycleAuditAdapter = createQwenVoiceLifecycleAuditAdapter({ env });
  const listVoiceLifecycleAuditEvents =
    deps.listVoiceLifecycleAuditEvents ?? lifecycleAuditAdapter?.listEvents;

  return async function GET(request: Request) {
    try {
      assertUaisAiAdminAccess({
        request,
        env,
        action: "voice-lifecycle-audit-read",
        requireSignedSession: true,
      });
      if (!listVoiceLifecycleAuditEvents) {
        return Response.json(
          {
            error: "UAIS voice lifecycle audit backend is not configured.",
          },
          { status: 501 },
        );
      }

      const lifecycleAudit = await listVoiceLifecycleAuditEvents();
      return Response.json({
        lifecycleAudit,
        progress: createVoiceLifecycleAuditProgress(lifecycleAudit.recordCount),
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Qwen voice lifecycle audit request failed.",
        },
        { status: 400 },
      );
    }
  };
}

function createVoiceLifecycleAuditProgress(recordCount: number) {
  return assertResponsibleProgressIsDisplaySafe([
    createResponsibleProgressItem({
      index: 0,
      type: "s12-lifecycle-audit-admin-access",
      status: "authorized",
      responsibleSession: "S12",
      providerRole: "voice-clone",
      progressText:
        "S12 Backend/API Platform authorized the admin-only Qwen voice lifecycle audit request.",
    }),
    createResponsibleProgressItem({
      index: 1,
      type: "s24-lifecycle-audit-index",
      status: "indexed",
      responsibleSession: "S24",
      providerRole: "voice-clone",
      progressText: `S24 Asset and Export Quality returned ${recordCount} redacted Qwen voice lifecycle audit record${recordCount === 1 ? "" : "s"}.`,
    }),
  ]);
}
