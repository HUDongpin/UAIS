// Workflow domain types, defaults, and pure voice/agent/server-workflow formatting
// helpers for the teacher PPT-narration + AI-ops surface (Phase 3 decomposition).
// No JSX or React state — the components in teacher-ppt-narration-workflow.tsx import
// these. Kept separate so each file stays within the max-lines guardrail.

import type { Locale } from "@/i18n/copy";
import { normalizeTeachingActorId } from "@/lib/teaching/course-readback";

export type TeacherWorkflowSample = {
  status: string;
  sampleAssetId: string;
  sampleDurationSeconds: number;
};

export type TeacherWorkflowPreflight = {
  status: string;
  checks: Array<{ responsibleSession?: string; status?: string }>;
};

export type TeacherWorkflowVoiceRef = {
  voiceRefId: string;
  status: string;
  voiceRef: string;
};

export type TeacherWorkflowPptAsset = {
  slideId: string;
  audioId: string;
  downloadUrl: string;
};

export type TeacherWorkflowNarration = {
  status: string;
  slideCount: number;
  audioManifestId: string;
  assets: TeacherWorkflowPptAsset[];
};

export type TeacherServerWorkflowStep = {
  id: "voice-sample" | "voice-clone" | "ppt-material" | "ppt-narration";
  status: string;
  sampleAssetId?: string;
  voiceRefId?: string;
  pptAssetId?: string;
  audioManifestId?: string;
};

export type TeacherServerWorkflow = {
  teacherId?: string;
  courseId?: string;
  pptAssetId?: string;
  status: string;
  nextAction: string;
  steps?: TeacherServerWorkflowStep[];
  downloads?: {
    audioManifestId: string;
    exportDownloadUrl: string;
    audioDownloadPattern: string;
  };
};

export type TeacherServerWorkflowHandoffPlan = {
  nextAgent?: {
    responsibleSession?: string;
    action?: string;
  };
};

export type TeacherServerWorkflowProgressItem = {
  id: string;
  type?: string;
  status: string;
  responsibleSession?: string;
  responsibleAgent?: {
    name?: string;
    providerRole?: string;
  };
  progressText?: string;
};

export type SelectedTeacherVoiceSample = {
  fileName: string;
  sampleAssetId: string;
  sourceKind: "owner-provided" | "upload";
  file?: File;
  mimeType?: string;
};

export type SelectedVoiceSampleDurationStatus =
  | {
      status: "owner-provided";
      durationSeconds: 10;
    }
  | {
      status: "checking";
    }
  | {
      status: "ready" | "blocked";
      durationSeconds: number;
    }
  | {
      status: "unchecked";
    };

export type TeacherWorkflowSessionAction =
  | "live-chat"
  | "teacher-ppt-workflow-read"
  | "voice-sample-submit"
  | "voice-clone-preflight"
  | "voice-clone-status"
  | "ppt-narration-submit";

export type TeacherWorkflowSessionReadiness = {
  status: "checking" | "ready" | "blocked";
  action: TeacherWorkflowSessionAction;
};

export type TeacherWorkflowSessionResource = {
  teacherId: string;
  courseId?: string;
  sampleAssetId?: string;
  pptAssetId?: string;
  voiceRefId?: string;
  providerTaskId?: string;
};

export const DEFAULT_SAMPLE_ASSET_ID = "teacher-kang-10s-sample";
export const PENDING_TEACHER_UPLOAD_SAMPLE_ACTOR_ID = "pending-teacher-session";
export const DEFAULT_COURSE_ID = "research-methods";
export const DEFAULT_PPT_ASSET_ID = "kang-xia-ppt-19";
export const SERVER_SIDE_VOICE_REF = "server-side-cloned-qwen-voice";

export function pickSignedAiAccessHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const claims = headers?.["x-uais-access-claims"];
  const signature = headers?.["x-uais-access-signature"];
  if (!claims || !signature) {
    return {};
  }

  return {
    "x-uais-access-claims": claims,
    "x-uais-access-signature": signature,
  };
}

export function hasSignedAiAccessHeaders(headers: Record<string, string>) {
  return Boolean(headers["x-uais-access-claims"] && headers["x-uais-access-signature"]);
}

export async function readSelectedVoiceSampleAudio(
  sample: SelectedTeacherVoiceSample | undefined,
): Promise<{ mimeType?: string; sampleAudioBase64?: string }> {
  if (sample?.sourceKind !== "upload" || !sample.file) {
    return {};
  }

  return {
    mimeType: sample.file.type || sample.mimeType || "audio/wav",
    sampleAudioBase64: arrayBufferToBase64(await sample.file.arrayBuffer()),
  };
}

export function formatSelectedVoiceDurationStatus(
  status: SelectedVoiceSampleDurationStatus,
  locale: Locale,
) {
  if (status.status === "owner-provided") {
    return locale === "zh-CN"
      ? "康霞 10 秒声音已选择。"
      : "Kang Xia 10-second voice selected.";
  }
  if (status.status === "checking") {
    return locale === "zh-CN" ? "正在读取音频时长。" : "Reading audio duration.";
  }
  if (status.status === "unchecked") {
    return locale === "zh-CN"
      ? "提交时将由服务端校验音频时长。"
      : "The server will verify audio duration on submit.";
  }

  const durationText = status.durationSeconds.toFixed(1);
  if (status.status === "blocked") {
    return locale === "zh-CN"
      ? `已选择音频 ${durationText} 秒，至少需要 10 秒。`
      : `Selected audio is ${durationText} seconds; at least 10 seconds is required.`;
  }

  return locale === "zh-CN"
    ? `已选择音频 ${durationText} 秒，可以登记。`
    : `Selected audio is ${durationText} seconds and can be registered.`;
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index]);
    }
  }

  return btoa(binary);
}

export function createTeacherWorkflowAuthErrorMessage(locale: Locale) {
  return locale === "zh-CN"
    ? "教师登录会话缺失，无法签发智能访问权限。"
    : "Teacher login session is missing, so AI access cannot be issued.";
}

export function readTeacherWorkflowActorId(input: {
  teacherActorId?: string;
  serverWorkflowTeacherId?: string;
}) {
  return (
    normalizeTeachingActorId(input.teacherActorId) ??
    normalizeTeachingActorId(input.serverWorkflowTeacherId)
  );
}

export function requireTeacherWorkflowActorId(input: {
  locale: Locale;
  teacherActorId?: string;
  serverWorkflowTeacherId?: string;
}) {
  const actorId = readTeacherWorkflowActorId(input);
  if (!actorId) {
    throw new Error(createTeacherWorkflowAuthErrorMessage(input.locale));
  }
  return actorId;
}

export function formatTeacherWorkflowSessionReadiness(
  readiness: TeacherWorkflowSessionReadiness | undefined,
  locale: Locale,
) {
  if (!readiness) {
    return locale === "zh-CN"
      ? "先检查教师登录会话，再运行受保护的声音与课件操作。"
      : "Check the teacher login session before protected voice and PPT actions.";
  }

  if (readiness.status === "checking") {
    return locale === "zh-CN"
      ? "正在检查签名智能访问会话。"
      : "Checking signed AI access session.";
  }

  if (readiness.status === "blocked") {
    return locale === "zh-CN"
      ? `签名智能访问会话受阻：${formatTeacherWorkflowAction(readiness.action, locale)}`
      : `Signed AI access session blocked: ${readiness.action}`;
  }

  return locale === "zh-CN"
    ? `签名智能访问会话就绪：${formatTeacherWorkflowAction(readiness.action, locale)}`
    : `Signed AI access session ready: ${readiness.action}`;
}

export function formatTeacherWorkflowAction(action: string, locale: Locale) {
  if (locale !== "zh-CN") {
    return action;
  }

  return formatWorkflowAction(action, locale);
}

export function formatTeacherVoiceRefDisplay(locale: Locale) {
  return locale === "zh-CN"
    ? "声音引用已在服务端保存，教师端不显示原始值。"
    : "voiceRef: saved server-side; raw value is not shown in the teacher UI";
}

export function formatWorkflowStatus(status: string | undefined, locale: Locale) {
  const value = status ?? "pending";
  if (locale !== "zh-CN") {
    return value;
  }

  const statusLabels: Record<string, string> = {
    authorized: "已授权",
    blocked: "受阻",
    disabled: "关闭",
    missing: "缺失",
    pending: "待处理",
    present: "已配置",
    queued: "已排队",
    ready: "就绪",
    "ready-for-clone": "可用于复刻",
    "ready-for-downloads": "可下载",
    "ready-for-teacher-review": "待教师复核",
    "waiting-for-storage": "等待存储",
  };

  return statusLabels[value] ?? "待处理";
}

export function formatSmokeMode(mode: string, locale: Locale) {
  if (locale !== "zh-CN") {
    return mode;
  }

  if (mode === "dry-run") {
    return "试运行";
  }

  return "检查";
}

export function formatWorkflowAction(action: string | undefined, locale: Locale) {
  const value = action ?? "pending";
  if (locale !== "zh-CN") {
    return value;
  }

  const actionLabels: Record<string, string> = {
    "create-ppt-narration": "创建课件配音",
    pending: "待处理",
    "ppt-narration-submit": "课件配音提交",
    "resolve-preflight-blockers": "处理预检阻塞项",
    "review-and-download-ppt-narration": "复核并下载课件配音",
    "submit-qwen-voice-clone": "提交声音克隆",
    "voice-clone-preflight": "声音克隆预检",
    "voice-clone-status": "声音克隆状态",
    "voice-sample-submit": "声音样本提交",
    "wait-for-external-storage": "等待外部存储",
  };

  if (actionLabels[value]) {
    return actionLabels[value];
  }

  if (value.includes("voice")) {
    return "声音操作";
  }

  if (value.includes("ppt") || value.includes("narration")) {
    return "课件配音操作";
  }

  return "受保护操作";
}

export function formatServerWorkflowStatusLine(workflow: TeacherServerWorkflow, locale: Locale) {
  if (locale !== "zh-CN") {
    return `Server workflow ${workflow.status}: ${workflow.nextAction}`;
  }

  return `服务端工作流${formatWorkflowStatus(workflow.status, locale)}：${formatWorkflowAction(
    workflow.nextAction,
    locale,
  )}`;
}

export function formatServerWorkflowNextAction(
  handoffPlan: TeacherServerWorkflowHandoffPlan,
  workflow: TeacherServerWorkflow,
  locale: Locale,
) {
  const action = handoffPlan.nextAgent?.action ?? workflow.nextAction;
  if (locale !== "zh-CN") {
    return `Next ${handoffPlan.nextAgent?.responsibleSession ?? "S24"} / ${action}`;
  }

  return `下一步：${formatWorkflowAction(action, locale)}`;
}

export function formatTeacherWorkflowSample(sample: TeacherWorkflowSample, locale: Locale) {
  if (locale !== "zh-CN") {
    return `Voice sample ${sample.status}: ${sample.sampleAssetId} / ${sample.sampleDurationSeconds} seconds`;
  }

  return `声音样本${formatWorkflowStatus(sample.status, locale)}：${sample.sampleDurationSeconds} 秒`;
}

export function formatTeacherWorkflowNarration(narration: TeacherWorkflowNarration, locale: Locale) {
  if (locale !== "zh-CN") {
    return `PPT narration ${narration.status}: ${narration.slideCount} slides / ${narration.audioManifestId}`;
  }

  return `课件配音${formatWorkflowStatus(narration.status, locale)}：${narration.slideCount} 页音频`;
}

export function formatPptAudioDownloadLabel(
  asset: TeacherWorkflowPptAsset,
  locale: Locale,
  source: "local" | "server",
) {
  if (locale !== "zh-CN") {
    return source === "server"
      ? `Download server ${asset.slideId} WAV`
      : `Download ${asset.slideId} WAV`;
  }

  const slideNumber = Number.parseInt(asset.slideId.replace(/\D/g, ""), 10);
  const slideLabel = Number.isFinite(slideNumber) ? `第 ${slideNumber} 页` : "单页";
  return source === "server" ? `下载服务器${slideLabel}音频` : `下载${slideLabel}音频`;
}

export function formatAgentSessionName(session: string | undefined, locale: Locale) {
  const value = session ?? "";
  if (locale !== "zh-CN") {
    return value || "Owner";
  }

  const sessionLabels: Record<string, string> = {
    S07: "智能体定义",
    S12: "后端接口",
    S19: "环境配置",
    S22: "构建质量",
    S24: "导出质检",
  };

  return sessionLabels[value] ?? "责任分工";
}

export function localizeAgentContractResult(result: string, locale: Locale) {
  if (locale !== "zh-CN") {
    return result;
  }

  if (result.includes("multi-agent") || result.includes("contract")) {
    return "方法顾问已通过多智能体合同响应。";
  }

  return result;
}

export function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

export function providerLabel(provider: string, locale: Locale) {
  if (provider === "deepseek") {
    return locale === "zh-CN" ? "深度求索" : "DeepSeek";
  }

  if (provider === "qwen") {
    return locale === "zh-CN" ? "阿里千问" : "Qwen";
  }

  return locale === "zh-CN" ? "服务商" : provider;
}

export function summarizePreflightChecks(
  checks: Array<{ responsibleSession?: string; status?: string }>,
  locale: Locale,
) {
  const sessionOrder = ["S07", "S12", "S19", "S24"];
  const summaries = sessionOrder.map((session) => {
    const check = checks.find((candidate) => candidate.responsibleSession === session);
    return locale === "zh-CN"
      ? `${formatAgentSessionName(session, locale)}${formatWorkflowStatus(check?.status ?? "blocked", locale)}`
      : `${session} ${check?.status ?? "blocked"}`;
  });

  return summaries.join(locale === "zh-CN" ? "，" : ", ");
}

export function formatServerWorkflowStep(step: TeacherServerWorkflowStep, locale: Locale) {
  if (locale === "zh-CN") {
    const stepLabels: Record<TeacherServerWorkflowStep["id"], string> = {
      "ppt-material": "课件材料",
      "ppt-narration": "课件配音",
      "voice-clone": "声音克隆",
      "voice-sample": "声音样本",
    };

    return `${stepLabels[step.id]}${formatWorkflowStatus(step.status, locale)}`;
  }

  return `${step.id} ${step.status}: ${
    step.sampleAssetId ??
    step.voiceRefId ??
    step.pptAssetId ??
    step.audioManifestId ??
    "pending"
  }`;
}

export function formatServerWorkflowProgressOwner(
  item: TeacherServerWorkflowProgressItem,
  locale: Locale,
) {
  if (locale === "zh-CN") {
    return `${formatAgentSessionName(item.responsibleSession, locale)} / ${formatWorkflowStatus(
      item.status,
      locale,
    )}`;
  }

  return `${item.responsibleAgent?.name ?? item.responsibleSession ?? item.id} / ${item.status}`;
}

export function formatServerWorkflowProgressText(
  item: TeacherServerWorkflowProgressItem,
  locale: Locale,
) {
  if (locale !== "zh-CN") {
    return item.progressText ?? "";
  }

  if (item.type?.includes("auth-boundary")) {
    return "已确认签名教师会话可用于组装课件配音工作流。";
  }

  if (item.type?.includes("provider-env")) {
    return "已确认配音服务环境配置状态，未暴露凭据。";
  }

  if (item.type?.includes("route-smoke")) {
    return "发布前仍需完成部署路由冒烟检查。";
  }

  if (item.responsibleSession === "S22") {
    return "正在等待生产存储冒烟证据。";
  }

  return "进度状态已同步。";
}

export function createServerWorkflowDownloadAssets(input: {
  locale: Locale;
  audioDownloadPattern: string;
}): TeacherWorkflowPptAsset[] {
  return createKangXiaPptSlideScripts(input.locale).map((script) => {
    const audioId = `audio-${script.slideId}`;
    return {
      slideId: script.slideId,
      audioId,
      downloadUrl: input.audioDownloadPattern.replace("{audioId}", audioId),
    };
  });
}

export function buildPublicVoiceRefId(teacherId: string, sampleAssetId: string) {
  return `qwen-voice-ref-${teacherId}-${sampleAssetId}`;
}

export function resolveSelectedTeacherVoiceSampleAssetId(input: {
  actorId: string;
  selectedVoiceSample: SelectedTeacherVoiceSample | undefined;
}) {
  if (input.selectedVoiceSample?.sourceKind === "upload") {
    return buildUploadSampleAssetId(input.actorId, input.selectedVoiceSample.fileName);
  }
  return input.selectedVoiceSample?.sampleAssetId ?? DEFAULT_SAMPLE_ASSET_ID;
}

export function buildUploadSampleAssetId(teacherId: string, fileName: string) {
  return `${teacherId}-upload-${slugifyPublicId(fileName)}`;
}

export function slugifyPublicId(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "selected-voice";
}


export function createKangXiaPptSlideScripts(locale: Locale) {
  const zhTopics = [
    "课程目标与学习路径",
    "核心概念导入",
    "研究问题定位",
    "变量与情境关系",
    "案例观察任务",
    "学生小组讨论",
    "智能助教提示边界",
    "证据收集方式",
    "课堂即时反馈",
    "方法选择理由",
    "数据解释规范",
    "常见误区澄清",
    "学习过程记录",
    "同伴互评安排",
    "教师总结提示",
    "作业衔接说明",
    "后续阅读建议",
    "课堂产出检查",
    "结束与下一步",
  ];
  const enTopics = [
    "course goals and learning path",
    "core concept opening",
    "research question framing",
    "variables and context",
    "case observation task",
    "student group discussion",
    "AI tutor boundary",
    "evidence collection",
    "classroom feedback",
    "method selection rationale",
    "data interpretation norms",
    "common misconception check",
    "learning process record",
    "peer review plan",
    "teacher summary cue",
    "assignment handoff",
    "further reading",
    "class output check",
    "closing and next step",
  ];

  return zhTopics.map((topic, index) => {
    const slideNumber = index + 1;
    const slideId = `slide-${String(slideNumber).padStart(2, "0")}`;
    return {
      slideId,
      narrationText:
        locale === "zh-CN"
          ? `康霞课件第 ${slideNumber} 页：${topic}。`
          : `Kang Xia PPT slide ${slideNumber}: ${enTopics[index]}.`,
    };
  });
}

export function agentEnglishName(name: string) {
  const names: Record<string, string> = {
    研究助教: "Research TA",
    方法顾问: "Methods Advisor",
    数学助教: "Math TA",
    写作助手: "Writing Helper",
  };
  return names[name] ?? name;
}
