import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
} from "@/lib/ai/progress/responsible-progress";
import {
  readLocalUaisVoiceAssetRetentionReport,
  type UaisVoiceAssetRetentionReport,
} from "@/lib/ai/voice/asset-retention-report";
import {
  assertUaisAiAdminAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";

export const dynamic = "force-dynamic";

type VoiceAssetRetentionReadinessGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  readRetentionReport?: () => Promise<UaisVoiceAssetRetentionReport>;
};

export const GET = createVoiceAssetRetentionReadinessGetHandler();

export function createVoiceAssetRetentionReadinessGetHandler(
  deps: VoiceAssetRetentionReadinessGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const readRetentionReport =
    deps.readRetentionReport ??
    (() =>
      readLocalUaisVoiceAssetRetentionReport({
        teacherVoiceSampleBaseDir: env.UAIS_TEACHER_VOICE_SAMPLE_DIR,
        clonedVoiceRegistryBaseDir: env.UAIS_QWEN_CLONED_VOICE_REGISTRY_DIR,
        pptAudioBaseDir: env.UAIS_PPT_NARRATION_AUDIO_DIR,
      }));

  return async function GET(
    request = new Request("http://localhost/api/ai/voice-assets/retention-readiness"),
  ) {
    try {
      assertUaisAiAdminAccess({
        request,
        env,
        action: "voice-asset-retention-read",
        requireSignedSession: true,
      });

      const retentionReport = await readRetentionReport();
      return Response.json({
        retentionReport,
        progress: createVoiceAssetRetentionProgress(retentionReport),
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
              : "UAIS voice asset retention readiness request failed.",
        },
        { status: 400 },
      );
    }
  };
}

function createVoiceAssetRetentionProgress(report: UaisVoiceAssetRetentionReport) {
  const totalRecords =
    report.recordCounts.teacherVoiceSamples +
    report.recordCounts.clonedVoiceRefs +
    report.recordCounts.pptAudioManifests;
  const actionRequiredCount = report.items.filter((item) => item.status !== "active").length;

  return assertResponsibleProgressIsDisplaySafe([
    createResponsibleProgressItem({
      index: 0,
      type: "s12-retention-readiness-admin-access",
      status: "authorized",
      responsibleSession: "S12",
      providerRole: "voice-clone",
      progressText:
        "S12 Backend/API Platform authorized the admin-only voice asset retention readiness request.",
    }),
    createResponsibleProgressItem({
      index: 1,
      type: "s24-retention-readiness-report",
      status: report.status,
      responsibleSession: "S24",
      providerRole: "ppt-narration",
      progressText: `S24 Asset and Export Quality returned ${totalRecords} redacted voice/PPT asset retention record${totalRecords === 1 ? "" : "s"} with ${actionRequiredCount} item${actionRequiredCount === 1 ? "" : "s"} requiring review.`,
    }),
  ]);
}
