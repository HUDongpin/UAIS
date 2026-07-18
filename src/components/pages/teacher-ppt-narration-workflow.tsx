"use client";

// Teacher PPT-narration + AI-ops workspace surface, extracted from teaching-page.tsx
// (Phase 3 decomposition). Self-contained: the TeacherPptNarrationWorkflow and
// AiOpsWorkbench components, the AiOpsButton primitive, their workflow domain types,
// and all voice/agent/server-workflow formatting helpers. The page renders the two
// exported components; everything else here is private to this surface.



import { useEffect, useState } from "react";
import { ChartBar } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { Export as ExportIcon } from "@phosphor-icons/react/dist/ssr/Export";
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { UserGear } from "@phosphor-icons/react/dist/ssr/UserGear";
import type { Locale } from "@/i18n/copy";


import {
  DEFAULT_COURSE_ID,
  DEFAULT_PPT_ASSET_ID,
  DEFAULT_SAMPLE_ASSET_ID,
  PENDING_TEACHER_UPLOAD_SAMPLE_ACTOR_ID,
  SERVER_SIDE_VOICE_REF,
  buildPublicVoiceRefId,
  buildUploadSampleAssetId,
  createKangXiaPptSlideScripts,
  createServerWorkflowDownloadAssets,
  createTeacherWorkflowAuthErrorMessage,
  formatPptAudioDownloadLabel,
  formatSelectedVoiceDurationStatus,
  formatServerWorkflowNextAction,
  formatServerWorkflowProgressOwner,
  formatServerWorkflowProgressText,
  formatServerWorkflowStatusLine,
  formatServerWorkflowStep,
  formatSmokeMode,
  formatTeacherVoiceRefDisplay,
  formatTeacherWorkflowNarration,
  formatTeacherWorkflowSample,
  formatTeacherWorkflowSessionReadiness,
  formatWorkflowAction,
  formatWorkflowStatus,
  hasSignedAiAccessHeaders,
  headersToRecord,
  localizeAgentContractResult,
  pickSignedAiAccessHeaders,
  providerLabel,
  readTeacherWorkflowActorId,
  requireTeacherWorkflowActorId,
  resolveSelectedTeacherVoiceSampleAssetId,
  summarizePreflightChecks,
  type SelectedTeacherVoiceSample,
  type SelectedVoiceSampleDurationStatus,
  type TeacherServerWorkflow,
  type TeacherServerWorkflowHandoffPlan,
  type TeacherServerWorkflowProgressItem,
  type TeacherWorkflowNarration,
  type TeacherWorkflowPptAsset,
  type TeacherWorkflowPreflight,
  type TeacherWorkflowSample,
  type TeacherWorkflowSessionAction,
  type TeacherWorkflowSessionReadiness,
  type TeacherWorkflowSessionResource,
  type TeacherWorkflowVoiceRef,
  readSelectedVoiceSampleAudio,
} from "./teacher-ppt-narration-workflow-format";

export function TeacherPptNarrationWorkflow({
  locale,
  teacherActorId,
}: {
  locale: Locale;
  teacherActorId?: string;
}) {
  const defaultVoiceSampleLabel =
    locale === "zh-CN" ? "康霞 10 秒声音" : "Kang Xia 10-second voice";
  const [selectedVoiceFileName, setSelectedVoiceFileName] = useState(
    defaultVoiceSampleLabel,
  );
  const [selectedVoiceSample, setSelectedVoiceSample] = useState<SelectedTeacherVoiceSample>({
    fileName: defaultVoiceSampleLabel,
    sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
    sourceKind: "owner-provided",
  });
  const [selectedVoiceAudioUrl, setSelectedVoiceAudioUrl] = useState<string>();
  const [selectedVoiceDurationStatus, setSelectedVoiceDurationStatus] =
    useState<SelectedVoiceSampleDurationStatus>({
      status: "owner-provided",
      durationSeconds: 10,
    });
  const [sample, setSample] = useState<TeacherWorkflowSample>();
  const [preflight, setPreflight] = useState<TeacherWorkflowPreflight>();
  const [voiceRef, setVoiceRef] = useState<TeacherWorkflowVoiceRef>();
  const [narration, setNarration] = useState<TeacherWorkflowNarration>();
  const [serverWorkflow, setServerWorkflow] = useState<TeacherServerWorkflow>();
  const [serverHandoffPlan, setServerHandoffPlan] =
    useState<TeacherServerWorkflowHandoffPlan>();
  const [serverWorkflowProgress, setServerWorkflowProgress] = useState<
    TeacherServerWorkflowProgressItem[]
  >([]);
  const [sessionReadiness, setSessionReadiness] =
    useState<TeacherWorkflowSessionReadiness>();
  const [workflowError, setWorkflowError] = useState<string>();

  useEffect(() => {
    return () => {
      if (selectedVoiceAudioUrl && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(selectedVoiceAudioUrl);
      }
    };
  }, [selectedVoiceAudioUrl]);

  async function refreshServerWorkflow() {
    setWorkflowError(undefined);
    try {
      const actorId = requireTeacherWorkflowActorId({
        locale,
        teacherActorId,
        serverWorkflowTeacherId: serverWorkflow?.teacherId,
      });
      const body = await readJson<{
        workflow?: TeacherServerWorkflow;
        agentHandoffPlan?: TeacherServerWorkflowHandoffPlan;
        progress?: TeacherServerWorkflowProgressItem[];
      }>(
        "/api/ai/teacher-ppt-workflow",
        {
          credentials: "same-origin",
          headers: await requestTeacherAiSessionHeaders({
            action: "teacher-ppt-workflow-read",
            resource: {
              teacherId: actorId,
              courseId: DEFAULT_COURSE_ID,
              pptAssetId: DEFAULT_PPT_ASSET_ID,
            },
            locale,
          }),
        },
      );
      setServerWorkflow(body.workflow);
      setServerHandoffPlan(body.agentHandoffPlan);
      setServerWorkflowProgress(body.progress ?? []);
    } catch {
      setServerWorkflowProgress([]);
      throw new Error(
        locale === "zh-CN"
          ? "教师登录会话缺失，无法读取服务端工作流。"
          : "Teacher login session is missing, so the server workflow cannot be read.",
      );
    }
  }

  async function checkTeacherAiSessionReadiness() {
    const action: TeacherWorkflowSessionAction = "voice-sample-submit";
    setWorkflowError(undefined);
    setSessionReadiness({ status: "checking", action });

    try {
      const actorId = requireTeacherWorkflowActorId({
        locale,
        teacherActorId,
        serverWorkflowTeacherId: serverWorkflow?.teacherId,
      });
      await requestTeacherAiSessionHeaders({
        action,
        resource: {
          teacherId: actorId,
          courseId: DEFAULT_COURSE_ID,
          sampleAssetId: resolveSelectedTeacherVoiceSampleAssetId({
            actorId,
            selectedVoiceSample,
          }),
        },
        locale,
      });
      setSessionReadiness({ status: "ready", action });
    } catch (error) {
      setSessionReadiness({ status: "blocked", action });
      setWorkflowError(
        error instanceof Error ? error.message : createTeacherWorkflowAuthErrorMessage(locale),
      );
    }
  }

  async function registerTeacherVoice() {
    setWorkflowError(undefined);
    const actorId = requireTeacherWorkflowActorId({
      locale,
      teacherActorId,
      serverWorkflowTeacherId: serverWorkflow?.teacherId,
    });
    const sampleAssetId = resolveSelectedTeacherVoiceSampleAssetId({
      actorId,
      selectedVoiceSample,
    });
    const uploadedAudio = await readSelectedVoiceSampleAudio(selectedVoiceSample);
    const body = await readProtectedTeacherWorkflowJson<{
      sample?: { status?: string; assetId?: string; sampleDurationSeconds?: number };
      sampleAsset?: { sampleAssetId?: string; assetId?: string };
    }>({
      url: "/api/ai/voice-sample",
      locale,
      action: "voice-sample-submit",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          teacherId: actorId,
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId,
          sampleDurationSeconds: 10,
          mimeType: uploadedAudio.mimeType ?? "audio/wav",
          sourceKind: selectedVoiceSample?.sourceKind ?? "owner-provided",
          ...(selectedVoiceSample?.sourceKind === "upload"
            ? {
                selectedFileName: selectedVoiceSample.fileName,
                ...(uploadedAudio.sampleAudioBase64
                  ? { sampleAudioBase64: uploadedAudio.sampleAudioBase64 }
                  : {}),
              }
            : {}),
          language: locale,
          targetVoiceLabel: "Kang teacher PPT voice",
        }),
      },
    });

    setSample({
      status: body.sample?.status ?? "ready-for-clone",
      sampleAssetId:
        body.sampleAsset?.sampleAssetId ??
        body.sampleAsset?.assetId ??
        body.sample?.assetId ??
        DEFAULT_SAMPLE_ASSET_ID,
      sampleDurationSeconds: body.sample?.sampleDurationSeconds ?? 10,
    });
  }

  async function runWorkflowPreflight() {
    setWorkflowError(undefined);
    const actorId = requireTeacherWorkflowActorId({
      locale,
      teacherActorId,
      serverWorkflowTeacherId: serverWorkflow?.teacherId,
    });
    const sampleAssetId =
      sample?.sampleAssetId ??
      resolveSelectedTeacherVoiceSampleAssetId({
        actorId,
        selectedVoiceSample,
      });
    const body = await readProtectedTeacherWorkflowJson<{
      preflight?: {
        status?: string;
        checks?: Array<{ responsibleSession?: string; status?: string }>;
      };
    }>({
      url: "/api/ai/voice-clone/preflight",
      locale,
      action: "voice-clone-preflight",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          liveProviderApproved: true,
          teacherId: actorId,
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId,
          sampleDurationSeconds: sample?.sampleDurationSeconds ?? 10,
          mimeType: "audio/wav",
          sourceKind: selectedVoiceSample?.sourceKind ?? "owner-provided",
          language: locale,
          targetVoiceLabel: "Kang teacher PPT voice",
        }),
      },
    });

    setPreflight({
      status: body.preflight?.status ?? "blocked",
      checks: body.preflight?.checks ?? [],
    });
  }

  async function saveVoiceRef() {
    setWorkflowError(undefined);
    const actorId = requireTeacherWorkflowActorId({
      locale,
      teacherActorId,
      serverWorkflowTeacherId: serverWorkflow?.teacherId,
    });
    const sampleAssetId =
      sample?.sampleAssetId ??
      resolveSelectedTeacherVoiceSampleAssetId({
        actorId,
        selectedVoiceSample,
      });
    const body = await readProtectedTeacherWorkflowJson<{
      voiceClone?: { status?: string; voiceRef?: string; nextAction?: string };
      voiceCloneReference?: {
        voiceRefId?: string;
        status?: string;
        voiceRef?: string;
      };
    }>({
      url: "/api/ai/voice-clone/status",
      locale,
      action: "voice-clone-status",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId,
        providerTaskId: "task-voice-redacted",
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          teacherId: actorId,
          sampleAssetId,
          providerTaskId: "task-voice-redacted",
          providerStatus: "SUCCEEDED",
          clonedVoiceId: "voice-qwen-redacted",
        }),
      },
    });

    setVoiceRef({
      voiceRefId:
        body.voiceCloneReference?.voiceRefId ??
        buildPublicVoiceRefId(actorId, sampleAssetId),
      status: body.voiceCloneReference?.status ?? body.voiceClone?.status ?? "ready",
      voiceRef:
        body.voiceCloneReference?.voiceRef ??
        body.voiceClone?.voiceRef ??
        SERVER_SIDE_VOICE_REF,
    });
  }

  async function generatePptNarration() {
    setWorkflowError(undefined);
    const actorId = requireTeacherWorkflowActorId({
      locale,
      teacherActorId,
      serverWorkflowTeacherId: serverWorkflow?.teacherId,
    });
    const sampleAssetId =
      sample?.sampleAssetId ??
      resolveSelectedTeacherVoiceSampleAssetId({
        actorId,
        selectedVoiceSample,
      });
    const activeVoiceRefId =
      voiceRef?.voiceRefId ??
      buildPublicVoiceRefId(actorId, sampleAssetId);
    const slideScripts = createKangXiaPptSlideScripts(locale);
    const body = await readProtectedTeacherWorkflowJson<{
      pptNarrationJob?: {
        status?: string;
        slideCount?: number;
        audioManifestId?: string;
      };
      pptNarrationAssets?: {
        id?: string;
        assets?: TeacherWorkflowPptAsset[];
      };
    }>({
      url: "/api/ai/ppt-narration",
      locale,
      action: "ppt-narration-submit",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId,
        pptAssetId: DEFAULT_PPT_ASSET_ID,
        voiceRefId: activeVoiceRefId,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          voiceClone: {
            teacherId: actorId,
            consentConfirmed: true,
            sampleAssetId,
            sampleDurationSeconds: sample?.sampleDurationSeconds ?? 10,
            language: locale,
            targetVoiceLabel: "Kang teacher PPT voice",
          },
          pptNarration: {
            courseId: DEFAULT_COURSE_ID,
            pptAssetId: DEFAULT_PPT_ASSET_ID,
            clonedVoiceRef: activeVoiceRefId,
            language: locale,
            slideScripts,
          },
        }),
      },
    });

    setNarration({
      status: body.pptNarrationJob?.status ?? "queued",
      slideCount: body.pptNarrationJob?.slideCount ?? body.pptNarrationAssets?.assets?.length ?? 0,
      audioManifestId:
        body.pptNarrationAssets?.id ??
        body.pptNarrationJob?.audioManifestId ??
        `audio-manifest-${DEFAULT_COURSE_ID}-${DEFAULT_PPT_ASSET_ID}`,
      assets: body.pptNarrationAssets?.assets ?? [],
    });
  }

  async function runWorkflowAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setWorkflowError(
        error instanceof Error
          ? error.message
          : locale === "zh-CN"
            ? "教师课件配音工作流请求失败。"
            : "Teacher PPT narration workflow request failed.",
      );
    }
  }

  function selectOwnerProvidedVoiceSample() {
    setWorkflowError(undefined);
    setSelectedVoiceFileName(defaultVoiceSampleLabel);
    setSelectedVoiceSample({
      fileName: defaultVoiceSampleLabel,
      sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
      sourceKind: "owner-provided",
    });
    setSelectedVoiceAudioUrl(undefined);
    setSelectedVoiceDurationStatus({
      status: "owner-provided",
      durationSeconds: 10,
    });
    setSample(undefined);
    setPreflight(undefined);
    setVoiceRef(undefined);
    setNarration(undefined);
  }

  const canRunPreflight = Boolean(sample);
  const canSaveVoiceRef = preflight?.status === "ready";
  const canGenerateNarration = Boolean(voiceRef?.voiceRefId);
  const canRegisterTeacherVoice =
    selectedVoiceDurationStatus.status !== "checking" &&
    selectedVoiceDurationStatus.status !== "blocked";
  const serverWorkflowSteps = serverWorkflow?.steps ?? [];

  return (
    <div
      className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
      data-uais-voice-sample-select="file-input"
      data-uais-uploaded-sample-audio-payload="sampleAudioBase64"
      data-uais-voice-sample-duration-gate="browser-metadata"
      data-uais-selected-sample-identity="sampleAssetId voiceRefId"
      data-uais-signed-session-bootstrap="/api/ai/session"
      data-uais-session-readiness={
        sessionReadiness?.status === "ready"
          ? "signed-ai-access-ready"
          : sessionReadiness?.status === "blocked"
            ? "signed-ai-access-blocked"
            : "not-checked"
      }
      data-uais-server-workflow-status="/api/ai/teacher-ppt-workflow"
      data-uais-workflow-session-actions="teacher-ppt-workflow-read voice-sample-submit voice-clone-preflight voice-clone-status ppt-narration-submit"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            {locale === "zh-CN" ? "教师课件配音工作流" : "Teacher PPT Narration Workflow"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {locale === "zh-CN"
              ? "上传或选择 10 秒教师声音，完成分工预检后生成逐页音频。"
              : "Upload or select a 10-second teacher voice, pass S07/S12/S19/S24 preflight, then generate per-slide WAV files."}
          </p>
        </div>
        <span className="inline-flex h-8 items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--muted)]">
          {locale === "zh-CN" ? "分工预检" : "S07 / S12 / S19 / S24"}
        </span>
        <span className="inline-flex h-8 items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]">
          {locale === "zh-CN" ? "康霞课件 19 页" : "Kang Xia PPT 19 slides"}
        </span>
      </div>

      <div
        className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"
        data-uais-server-workflow-progress="auth-provider-storage-route"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--muted)]">
              {locale === "zh-CN" ? "服务端工作流" : "Server workflow"}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {locale === "zh-CN"
                ? "从签名教师会话读取服务端归属、下载入口和下一步交接。"
                : "Read server-side ownership, download entry points, and next handoff from the signed teacher session."}
            </p>
          </div>
          <AiOpsButton
            icon={<ClipboardText size={16} weight="bold" />}
            onClick={() => void runWorkflowAction(refreshServerWorkflow)}
          >
            {locale === "zh-CN" ? "刷新服务端工作流" : "Refresh server workflow"}
          </AiOpsButton>
          <AiOpsButton
            icon={<UserGear size={16} weight="bold" />}
            onClick={() => void checkTeacherAiSessionReadiness()}
          >
            {locale === "zh-CN" ? "检查教师登录会话" : "Check teacher login session"}
          </AiOpsButton>
        </div>

        <p
          className={[
            "mt-3 rounded-xl border px-3 py-2 text-xs font-semibold",
            sessionReadiness?.status === "ready"
              ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
          ].join(" ")}
          aria-live="polite"
        >
          {formatTeacherWorkflowSessionReadiness(sessionReadiness, locale)}
        </p>

        {serverWorkflow ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm font-medium text-[var(--foreground)]">
              {locale === "zh-CN"
                ? formatServerWorkflowStatusLine(serverWorkflow, locale)
                : `Server workflow ${serverWorkflow.status}: ${serverWorkflow.nextAction}`}
            </p>
            {serverHandoffPlan?.nextAgent ? (
              <p className="text-sm font-medium text-[var(--foreground)]">
                {locale === "zh-CN"
                  ? formatServerWorkflowNextAction(serverHandoffPlan, serverWorkflow, locale)
                  : `Next ${serverHandoffPlan.nextAgent.responsibleSession ?? "S24"} / ${
                      serverHandoffPlan.nextAgent.action ?? serverWorkflow.nextAction
                  }`}
              </p>
            ) : null}
            {serverWorkflowProgress.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                  {locale === "zh-CN"
                    ? "教师工作流就绪度"
                    : "Teacher workflow readiness"}
                </p>
                <div className="grid gap-2 lg:grid-cols-3">
                  {serverWorkflowProgress.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                    >
                      <p className="text-xs font-semibold text-[var(--foreground)]">
                        {formatServerWorkflowProgressOwner(item, locale)}
                      </p>
                      {item.progressText ? (
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                          {formatServerWorkflowProgressText(item, locale)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {serverWorkflowSteps.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {serverWorkflowSteps.map((step) => (
                  <p
                    key={step.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--foreground)]"
                  >
                    {formatServerWorkflowStep(step, locale)}
                  </p>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "服务端步骤尚未返回。"
                  : "Server workflow steps have not returned yet."}
              </p>
            )}
            {serverWorkflow.downloads ? (
              <div className="space-y-2">
                <a
                  href={serverWorkflow.downloads.exportDownloadUrl}
                  className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]"
                >
                  <ExportIcon size={14} weight="bold" />
                  {locale === "zh-CN"
                    ? "下载完整课件配音包"
                    : "Download full PPT narration package"}
                </a>
                <div className="flex flex-wrap gap-2">
                  {createServerWorkflowDownloadAssets({
                    locale,
                    audioDownloadPattern: serverWorkflow.downloads.audioDownloadPattern,
                  }).map((asset) => (
                    <a
                      key={asset.audioId}
                      href={asset.downloadUrl}
                      download={`${asset.audioId}.wav`}
                      className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]"
                    >
                      <ExportIcon size={14} weight="bold" />
                      {locale === "zh-CN"
                        ? formatPptAudioDownloadLabel(asset, locale, "server")
                        : `Download server ${asset.slideId} WAV`}
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "服务端下载入口尚未生成。"
                  : "Server download entry points are not generated yet."}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            {locale === "zh-CN"
              ? "等待刷新服务端工作流。"
              : "Waiting to refresh the server workflow."}
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">
            {locale === "zh-CN" ? "1 声音样本" : "1 Voice Sample"}
          </p>
          <AiOpsButton
            icon={<UserGear size={16} weight="bold" />}
            onClick={selectOwnerProvidedVoiceSample}
          >
            {locale === "zh-CN"
              ? "使用康霞 10 秒声音"
              : "Use Kang Xia 10-second voice"}
          </AiOpsButton>
          <label
            htmlFor="teacher-voice-sample"
            className="mt-3 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)]"
          >
            <FileText size={16} weight="bold" />
            {locale === "zh-CN"
              ? "上传/选择 10 秒教师声音"
              : "Upload/select 10-second teacher voice"}
          </label>
          <input
            id="teacher-voice-sample"
            aria-label={
              locale === "zh-CN"
                ? "上传/选择 10 秒教师声音"
                : "Upload/select 10-second teacher voice"
            }
            type="file"
            accept="audio/*"
            className="sr-only"
            onChange={(event) => {
              setWorkflowError(undefined);
              const file = event.currentTarget.files?.[0];
              const fileName = file?.name;
              setSelectedVoiceFileName(
                fileName ?? (locale === "zh-CN" ? "未选择文件" : "No file selected"),
              );
              const audioUrl =
                file && typeof URL.createObjectURL === "function"
                  ? URL.createObjectURL(file)
                  : undefined;
              setSelectedVoiceAudioUrl(audioUrl);
              setSelectedVoiceDurationStatus(
                fileName
                  ? audioUrl
                    ? { status: "checking" }
                    : { status: "unchecked" }
                  : {
                      status: "owner-provided",
                      durationSeconds: 10,
                    },
              );
              setSelectedVoiceSample(
                fileName
                  ? {
                      fileName,
                      sampleAssetId: buildUploadSampleAssetId(
                        readTeacherWorkflowActorId({
                          teacherActorId,
                          serverWorkflowTeacherId: serverWorkflow?.teacherId,
                        }) ?? PENDING_TEACHER_UPLOAD_SAMPLE_ACTOR_ID,
                        fileName,
                      ),
                      sourceKind: "upload",
                      file,
                      mimeType: file.type || "audio/wav",
                    }
                  : {
                      fileName: defaultVoiceSampleLabel,
                      sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
                      sourceKind: "owner-provided",
                    },
              );
              setSample(undefined);
              setPreflight(undefined);
              setVoiceRef(undefined);
              setNarration(undefined);
            }}
          />
          {selectedVoiceAudioUrl ? (
            <audio
              data-uais-selected-audio-probe="metadata"
              aria-hidden="true"
              className="sr-only"
              preload="metadata"
              src={selectedVoiceAudioUrl}
              onLoadedMetadata={(event) => {
                const durationSeconds = event.currentTarget.duration;
                setSelectedVoiceDurationStatus(
                  Number.isFinite(durationSeconds) && durationSeconds >= 10
                    ? { status: "ready", durationSeconds }
                    : {
                        status: "blocked",
                        durationSeconds: Number.isFinite(durationSeconds)
                          ? durationSeconds
                          : 0,
                      },
                );
              }}
              onError={() => {
                setSelectedVoiceDurationStatus({ status: "unchecked" });
              }}
            />
          ) : null}
          <p className="mt-2 break-words text-xs text-[var(--muted)]">
            {selectedVoiceFileName}
          </p>
          <p className="mt-2 text-xs font-medium text-[var(--muted)]">
            {formatSelectedVoiceDurationStatus(selectedVoiceDurationStatus, locale)}
          </p>
          <AiOpsButton
            icon={<FileText size={16} weight="bold" />}
            onClick={() => void runWorkflowAction(registerTeacherVoice)}
            disabled={!canRegisterTeacherVoice}
          >
            {locale === "zh-CN" ? "登记教师声音" : "Register teacher voice"}
          </AiOpsButton>
          {sample ? (
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {locale === "zh-CN"
                ? formatTeacherWorkflowSample(sample, locale)
                : `Voice sample ${sample.status}: ${sample.sampleAssetId} / ${sample.sampleDurationSeconds} seconds`}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">
            {locale === "zh-CN" ? "2 实时预检" : "2 Live Preflight"}
          </p>
          <AiOpsButton
            icon={<ChartBar size={16} weight="bold" />}
            onClick={() => void runWorkflowAction(runWorkflowPreflight)}
            disabled={!canRunPreflight}
          >
            {locale === "zh-CN" ? "运行工作流预检" : "Run workflow preflight"}
          </AiOpsButton>
          {preflight ? (
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {locale === "zh-CN"
                ? `预检${formatWorkflowStatus(preflight.status, locale)}：${summarizePreflightChecks(preflight.checks, locale)}`
                : `Preflight ${preflight.status}: ${summarizePreflightChecks(preflight.checks, locale)}`}
            </p>
          ) : !canRunPreflight ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {locale === "zh-CN"
                ? "先登记 10 秒教师声音样本。"
                : "Register a 10-second teacher voice sample first."}
            </p>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {locale === "zh-CN"
                ? "等待分工检查。"
                : "Waiting for S07/S12/S19/S24 checks."}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">
            {locale === "zh-CN" ? "3 声音引用" : "3 VoiceRef"}
          </p>
          <AiOpsButton
            icon={<Robot size={16} weight="bold" />}
            onClick={() => void runWorkflowAction(saveVoiceRef)}
            disabled={!canSaveVoiceRef}
          >
            {locale === "zh-CN" ? "保存声音引用" : "Save voiceRef"}
          </AiOpsButton>
          {voiceRef ? (
            <div className="mt-3 space-y-1 text-sm font-medium text-[var(--foreground)]">
              <p className="break-words">
                {locale === "zh-CN"
                  ? `声音引用${formatWorkflowStatus(voiceRef.status, locale)}`
                  : `voiceRefId: ${voiceRef.voiceRefId}`}
              </p>
              <p>{formatTeacherVoiceRefDisplay(locale)}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {locale === "zh-CN"
                ? "预检就绪后保存声音引用。"
                : "Save the voiceRef after preflight is ready."}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">
            {locale === "zh-CN" ? "4 课件音频" : "4 PPT WAV"}
          </p>
          <AiOpsButton
            icon={<ExportIcon size={16} weight="bold" />}
            onClick={() => void runWorkflowAction(generatePptNarration)}
            disabled={!canGenerateNarration}
          >
            {locale === "zh-CN" ? "生成课件配音" : "Generate PPT narration"}
          </AiOpsButton>
          {narration ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {locale === "zh-CN"
                  ? formatTeacherWorkflowNarration(narration, locale)
                  : `PPT narration ${narration.status}: ${narration.slideCount} slides / ${narration.audioManifestId}`}
              </p>
              <div className="flex flex-wrap gap-2">
                {narration.assets.map((asset) => (
                  <a
                    key={asset.audioId}
                    href={asset.downloadUrl}
                    download={`${asset.audioId}.wav`}
                    className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]"
                  >
                    <ExportIcon size={14} weight="bold" />
                    {locale === "zh-CN"
                      ? formatPptAudioDownloadLabel(asset, locale, "local")
                      : `Download ${asset.slideId} WAV`}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 space-y-1 text-sm text-[var(--muted)]">
              <span className="block">
                {locale === "zh-CN"
                  ? "保存声音引用后生成逐页音频。"
                  : "Generate per-slide WAV after saving the voiceRef."}
              </span>
              <span className="block">
                {locale === "zh-CN"
                  ? "生成后显示每页音频下载。"
                  : "Per-slide WAV downloads appear after generation."}
              </span>
            </p>
          )}
        </div>
      </div>

      {workflowError ? (
        <p className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-medium text-[var(--foreground)]">
          {workflowError}
        </p>
      ) : null}
    </div>
  );
}

export function AiOpsWorkbench({
  locale,
  teacherActorId,
}: {
  locale: Locale;
  teacherActorId?: string;
}) {
  const [results, setResults] = useState<string[]>([]);

  async function runReadiness() {
    const body = await readJson<{ readiness: Array<{ provider: string; status: string }> }>(
      "/api/ai/readiness",
    );
    setResults(
      body.readiness.map((item) =>
        locale === "zh-CN"
          ? `${providerLabel(item.provider, locale)}：${formatWorkflowStatus(item.status, locale)}`
          : `${providerLabel(item.provider, locale)}: ${item.status}`,
      ),
    );
  }

  async function runSmokePlan() {
    const body = await readJson<{ mode: string; network: string }>("/api/ai/smoke-plan");
    appendResult(
      locale === "zh-CN"
        ? `试运行：${formatSmokeMode(body.mode, locale)} / 网络${formatWorkflowStatus(body.network, locale)}`
        : `Smoke: ${body.mode} / network ${body.network}`,
    );
  }

  async function runAgentContract() {
    const actorId = requireTeacherWorkflowActorId({ locale, teacherActorId });
    const body = await readProtectedTeacherWorkflowJson<{ turns?: Array<{ content: string }> }>({
      url: "/api/ai/chat",
      locale,
      action: "live-chat",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          courseId: DEFAULT_COURSE_ID,
          agents: [
            {
              id: "teacher",
              handle: "@教师",
              name: "教师",
              role: "teacher",
              providerRole: "text-reasoning",
              priority: 10,
              allowedActions: ["respond"],
            },
            {
              id: "methods",
              handle: "@方法顾问",
              name: "方法顾问",
              role: "assistant",
              providerRole: "text-reasoning",
              priority: 7,
              allowedActions: ["respond"],
            },
          ],
          messages: [{ id: "m1", role: "student", content: "变量怎么定？@方法顾问" }],
          maxAgentTurns: 2,
        }),
      },
    });
    appendResult(
      locale === "zh-CN"
        ? localizeAgentContractResult(
            body.turns?.[0]?.content ?? "Multi-agent contract ready",
            locale,
          )
        : body.turns?.[0]?.content ?? "Multi-agent contract ready",
    );
  }

  async function runVoiceSampleContract() {
    const actorId = requireTeacherWorkflowActorId({ locale, teacherActorId });
    const body = await readProtectedTeacherWorkflowJson<{
      sample?: { status?: string; sampleDurationSeconds?: number };
    }>({
      url: "/api/ai/voice-sample",
      locale,
      action: "voice-sample-submit",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          teacherId: actorId,
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
          sampleDurationSeconds: 10,
          mimeType: "audio/wav",
          sourceKind: "owner-provided",
          language: locale,
        }),
      },
    });
    appendResult(
      locale === "zh-CN"
        ? `声音样本合同${formatWorkflowStatus(body.sample?.status ?? "ready-for-clone", locale)}：${
            body.sample?.sampleDurationSeconds ?? 10
          } 秒`
        : `Voice sample contract ${body.sample?.status ?? "ready-for-clone"}: ${
            body.sample?.sampleDurationSeconds ?? 10
          } seconds`,
    );
  }

  async function runVoiceClonePreflight() {
    const actorId = requireTeacherWorkflowActorId({ locale, teacherActorId });
    const body = await readProtectedTeacherWorkflowJson<{
      preflight?: {
        status?: string;
        checks?: Array<{ responsibleSession?: string; status?: string }>;
      };
    }>({
      url: "/api/ai/voice-clone/preflight",
      locale,
      action: "voice-clone-preflight",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          liveProviderApproved: true,
          teacherId: actorId,
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
          sampleDurationSeconds: 10,
          mimeType: "audio/wav",
          sourceKind: "owner-provided",
          language: locale,
          targetVoiceLabel: "Kang teacher PPT voice",
        }),
      },
    });
    const checkSummary = summarizePreflightChecks(body.preflight?.checks ?? [], locale);
    appendResult(
      locale === "zh-CN"
        ? `声音克隆预检${formatWorkflowStatus(body.preflight?.status ?? "blocked", locale)}：${checkSummary}`
        : `Voice clone preflight ${body.preflight?.status ?? "blocked"}: ${checkSummary}`,
    );
  }

  async function runVoiceCloneStatusContract() {
    const actorId = requireTeacherWorkflowActorId({ locale, teacherActorId });
    const body = await readProtectedTeacherWorkflowJson<{
      voiceClone?: { status?: string; clonedVoiceId?: string; nextAction?: string };
    }>({
      url: "/api/ai/voice-clone/status",
      locale,
      action: "voice-clone-status",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
        providerTaskId: "task-voice-redacted",
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          teacherId: actorId,
          sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
          providerTaskId: "task-voice-redacted",
          providerStatus: "SUCCEEDED",
          clonedVoiceId: "voice-qwen-redacted",
        }),
      },
    });
    appendResult(
      locale === "zh-CN"
        ? `声音克隆${formatWorkflowStatus(body.voiceClone?.status ?? "ready", locale)}：${
            formatWorkflowAction(body.voiceClone?.nextAction ?? "pending", locale)
          }`
        : `Voice clone ${body.voiceClone?.status ?? "ready"}: ${
            body.voiceClone?.clonedVoiceId ?? body.voiceClone?.nextAction ?? "pending"
          }`,
    );
  }

  async function runPptNarrationContract() {
    const actorId = requireTeacherWorkflowActorId({ locale, teacherActorId });
    const slideScripts = createKangXiaPptSlideScripts(locale);
    const body = await readProtectedTeacherWorkflowJson<{
      pptNarrationJob?: { slideCount?: number; status?: string };
    }>({
      url: "/api/ai/ppt-narration",
      locale,
      action: "ppt-narration-submit",
      resource: {
        teacherId: actorId,
        courseId: DEFAULT_COURSE_ID,
        sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
        pptAssetId: DEFAULT_PPT_ASSET_ID,
        voiceRefId: buildPublicVoiceRefId(actorId, DEFAULT_SAMPLE_ASSET_ID),
      },
      init: {
        method: "POST",
        body: JSON.stringify({
          voiceClone: {
            teacherId: actorId,
            consentConfirmed: true,
            sampleAssetId: DEFAULT_SAMPLE_ASSET_ID,
            sampleDurationSeconds: 10,
            language: locale,
            targetVoiceLabel: "Kang teacher PPT voice",
          },
          pptNarration: {
            courseId: DEFAULT_COURSE_ID,
            pptAssetId: DEFAULT_PPT_ASSET_ID,
            clonedVoiceRef: buildPublicVoiceRefId(actorId, DEFAULT_SAMPLE_ASSET_ID),
            language: locale,
            slideScripts,
          },
        }),
      },
    });
    appendResult(
      locale === "zh-CN"
        ? `课件配音合同${formatWorkflowStatus(body.pptNarrationJob?.status ?? "queued", locale)}：${
            body.pptNarrationJob?.slideCount ?? 0
          } 页`
        : `PPT narration contract ${body.pptNarrationJob?.status ?? "queued"}: ${
            body.pptNarrationJob?.slideCount ?? 0
          } slide`,
    );
  }

  function appendResult(result: string) {
    setResults((current) => [...current, result]);
  }

  async function runAiOpsAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      appendResult(
        error instanceof Error ? error.message : createTeacherWorkflowAuthErrorMessage(locale),
      );
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
      <div className="flex flex-wrap gap-2">
        <AiOpsButton
          icon={<ChartBar size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runReadiness)}
        >
          {locale === "zh-CN" ? "刷新配置检查" : "Refresh readiness"}
        </AiOpsButton>
        <AiOpsButton
          icon={<ChartBar size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runSmokePlan)}
        >
          {locale === "zh-CN" ? "运行试测" : "Run dry-run smoke"}
        </AiOpsButton>
        <AiOpsButton
          icon={<Robot size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runAgentContract)}
        >
          {locale === "zh-CN" ? "试跑智能体合同" : "Run agent contract"}
        </AiOpsButton>
        <AiOpsButton
          icon={<FileText size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runVoiceSampleContract)}
        >
          {locale === "zh-CN" ? "登记声音样本合同" : "Register voice sample contract"}
        </AiOpsButton>
        <AiOpsButton
          icon={<FileText size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runVoiceClonePreflight)}
        >
          {locale === "zh-CN" ? "声音克隆实时预检" : "Voice clone live preflight"}
        </AiOpsButton>
        <AiOpsButton
          icon={<FileText size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runVoiceCloneStatusContract)}
        >
          {locale === "zh-CN" ? "检查声音克隆状态" : "Check voice clone status"}
        </AiOpsButton>
        <AiOpsButton
          icon={<FileText size={16} weight="bold" />}
          onClick={() => void runAiOpsAction(runPptNarrationContract)}
        >
          {locale === "zh-CN" ? "生成课件配音合同" : "Create PPT narration contract"}
        </AiOpsButton>
      </div>

      <div className="mt-3 space-y-2" aria-live="polite">
        {results.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {locale === "zh-CN"
              ? "等待教师发起合同模式检查。"
              : "Waiting for contract-mode checks."}
          </p>
        ) : (
          results.map((result) => (
            <p
              key={result}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-medium text-[var(--foreground)]"
            >
              {result}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function AiOpsButton({
  children,
  disabled = false,
  icon,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-[var(--surface)] disabled:active:translate-y-0"
    >
      {icon}
      {children}
    </button>
  );
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: init?.credentials ?? "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${url}`);
  }

  return (await response.json()) as T;
}

async function readProtectedTeacherWorkflowJson<T>(input: {
  url: string;
  locale: Locale;
  action: TeacherWorkflowSessionAction;
  resource: TeacherWorkflowSessionResource;
  init: RequestInit;
}): Promise<T> {
  const accessHeaders = await requestTeacherAiSessionHeaders({
    action: input.action,
    resource: input.resource,
    locale: input.locale,
  });

  return await readJson<T>(input.url, {
    ...input.init,
    credentials: "same-origin",
    headers: {
      ...headersToRecord(input.init.headers),
      ...accessHeaders,
    },
  });
}

async function requestTeacherAiSessionHeaders(input: {
  action: TeacherWorkflowSessionAction;
  resource: TeacherWorkflowSessionResource;
  locale: Locale;
}): Promise<Record<string, string>> {
  try {
    const body = await readJson<{
      accessSession?: {
        headers?: Record<string, string>;
      };
    }>("/api/ai/session", {
      method: "POST",
      body: JSON.stringify({
        action: input.action,
        ttlSeconds: 300,
        resource: input.resource,
      }),
    });
    const headers = pickSignedAiAccessHeaders(body.accessSession?.headers);
    if (!hasSignedAiAccessHeaders(headers)) {
      throw new Error(createTeacherWorkflowAuthErrorMessage(input.locale));
    }
    return headers;
  } catch {
    throw new Error(createTeacherWorkflowAuthErrorMessage(input.locale));
  }
}

