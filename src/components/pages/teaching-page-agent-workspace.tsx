"use client";

// AI-agents teacher workspace panel (Phase 3 decomposition of teaching-page.tsx).
// Extracted verbatim from renderAgentWorkspace; closed-over values/handlers are
// same-named props, so the render body is unchanged.



import { teacherSidebarItems } from "@/data/uais";
import type { TeacherCourse } from "@/data/uais";
import { copy } from "@/i18n/copy";
import type { Locale } from "@/i18n/copy";
import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import { getProviderForRole } from "@/lib/ai/providers/registry";
import { createPptNarrationJob, createTeacherVoiceCloneJob } from "@/lib/ai/voice/ppt-narration";
import {
  AiOpsWorkbench,
  TeacherPptNarrationWorkflow,
} from "./teacher-ppt-narration-workflow";
import {
  agentEnglishName,
  formatWorkflowStatus,
} from "./teacher-ppt-narration-workflow-format";
import { InlineWorkspaceActionButtons } from "./teaching-page-inline-workspace-action-buttons";
import { InlineWorkspaceStatus } from "./teaching-page-inline-workspace-status";
import { WorkspaceContext } from "./teaching-page-workspace-context";
import type {
  InlineWorkspaceAlertNotificationStatus,
  InlineWorkspaceAlertStatus,
  InlineWorkspaceAuditStatus,
  InlineWorkspaceRollbackStatus,
  TeacherCourseAction,
} from "./teaching-page-types";

type AgentWorkspaceProps = {
  locale: Locale;
  activeWorkspaceItem: (typeof teacherSidebarItems)[number];
  authenticatedTeacherActorId: string | undefined;
  inlineWorkspaceStatuses: Partial<Record<TeachingOperationId, string>>;
  inlineWorkspaceAuditStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceAuditStatus>>;
  inlineWorkspaceAlertStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceAlertStatus>>;
  inlineWorkspaceAlertNotificationStatuses: Partial<
    Record<TeachingOperationId, InlineWorkspaceAlertNotificationStatus>
  >;
  inlineWorkspaceRollbackStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceRollbackStatus>>;
  multimodalProvider: ReturnType<typeof getProviderForRole>;
  textReasoningProvider: ReturnType<typeof getProviderForRole>;
  pptNarrationJob: ReturnType<typeof createPptNarrationJob>;
  voiceCloneJob: ReturnType<typeof createTeacherVoiceCloneJob>;
  selectedActionCourse: TeacherCourse | undefined;
  selectedCourseActionLabel: string | undefined;
  selectedCourseAction: { courseId: string; action: TeacherCourseAction } | undefined;
  t: (typeof copy)[Locale];
  queueInlineWorkspaceAuditAlertNotifications: (
    operationId: TeachingOperationId,
    notificationRoute?: string,
  ) => void;
  runInlineWorkspaceAction: (
    operationId: TeachingOperationId,
    actionSlot: "primary" | "secondary",
  ) => void;
  runInlineWorkspaceRollback: (input: {
    operationId: TeachingOperationId;
    recordId: string;
    courseId?: string;
  }) => void;
};

export function AgentWorkspace({
  locale,
  activeWorkspaceItem,
  authenticatedTeacherActorId,
  inlineWorkspaceStatuses,
  inlineWorkspaceAuditStatuses,
  inlineWorkspaceAlertStatuses,
  inlineWorkspaceAlertNotificationStatuses,
  inlineWorkspaceRollbackStatuses,
  multimodalProvider,
  textReasoningProvider,
  pptNarrationJob,
  voiceCloneJob,
  selectedActionCourse,
  selectedCourseActionLabel,
  selectedCourseAction,
  t,
  queueInlineWorkspaceAuditAlertNotifications,
  runInlineWorkspaceAction,
  runInlineWorkspaceRollback,
}: AgentWorkspaceProps) {
    return (
      <div
        className="space-y-5"
        data-uais-active-teaching-workspace="agents"
        data-uais-teaching-workspace-panel
      >
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "智能体配置工作台" : "Agent Setup Workspace"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "集中配置课程智能体、服务端权限、教师声音样本和课件配音工作流。"
                  : "Configure course agents, server permissions, teacher voice samples, and PPT narration workflows."}
              </p>
            </div>
            {<InlineWorkspaceActionButtons
              operationId={"agents"}
              locale={locale}
              inlineWorkspaceStatuses={inlineWorkspaceStatuses}
              runInlineWorkspaceAction={runInlineWorkspaceAction}
            />}
          </div>

          <div className="mt-5">
            {<WorkspaceContext
            locale={locale}
            activeWorkspaceItem={activeWorkspaceItem}
            selectedCourseAction={selectedCourseAction}
            selectedActionCourse={selectedActionCourse}
            selectedCourseActionLabel={selectedCourseActionLabel}
          />}
          </div>
          {<InlineWorkspaceStatus
            operationId="agents"
            locale={locale}
            inlineWorkspaceStatuses={inlineWorkspaceStatuses}
            inlineWorkspaceAuditStatuses={inlineWorkspaceAuditStatuses}
            inlineWorkspaceAlertStatuses={inlineWorkspaceAlertStatuses}
            inlineWorkspaceAlertNotificationStatuses={inlineWorkspaceAlertNotificationStatuses}
            inlineWorkspaceRollbackStatuses={inlineWorkspaceRollbackStatuses}
            runInlineWorkspaceRollback={runInlineWorkspaceRollback}
            queueInlineWorkspaceAuditAlertNotifications={queueInlineWorkspaceAuditAlertNotifications}
          />}

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {["研究助教", "方法顾问", "数学助教", "写作助手"].map((name) => (
              <div
                key={name}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
              >
                <p className="font-semibold text-[var(--foreground)]">
                  {locale === "zh-CN" ? name : agentEnglishName(name)}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {t.common.templateReady}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "企业级智能编排" : "Enterprise AI Orchestration"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "采用开放课堂智能系统风格的导演式智能体循环，按能力隔离模型与凭据。"
                  : "Uses an OpenMAIC-style director-agent loop with model and credential boundaries by capability."}
              </p>
            </div>
            <span className="inline-flex h-9 items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-sm font-semibold text-[var(--accent)]">
              {locale === "zh-CN" ? "服务端密钥边界" : "Server-side key boundary"}
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm font-medium text-[var(--foreground)]">
            {locale === "zh-CN" ? "配置检查接口已就绪" : "Readiness API contract is ready"}
          </div>

          <TeacherPptNarrationWorkflow
            locale={locale}
            teacherActorId={authenticatedTeacherActorId}
          />

          <AiOpsWorkbench locale={locale} teacherActorId={authenticatedTeacherActorId} />

          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                {locale === "zh-CN" ? "文字推理" : "Text reasoning"}
              </p>
              <h3 className="mt-2 text-base font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "深度求索" : "DeepSeek"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN" ? "文本推理模型" : textReasoningProvider.defaultModel}
              </p>
            </article>

            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                {locale === "zh-CN" ? "多模态生成" : "Multimodal generation"}
              </p>
              <h3 className="mt-2 text-base font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "阿里千问 / 百炼" : "Alibaba Qwen / Model Studio"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN" ? "多模态生成模型" : multimodalProvider.defaultModel}
              </p>
            </article>

            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                {locale === "zh-CN" ? "课件语音" : "Courseware voice"}
              </p>
              <h3 className="mt-2 text-base font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "10 秒教师声音复刻" : "10-second teacher voice clone"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN" ? "课件配音合同已就绪" : "PPT narration contract ready"}
              </p>
            </article>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]">
              <span className="font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "声音任务" : "Voice job"}
              </span>
              <span className="ml-2">
                {locale === "zh-CN"
                  ? formatWorkflowStatus(voiceCloneJob.status, locale)
                  : voiceCloneJob.status}
              </span>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]">
              <span className="font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "课件配音" : "PPT narration"}
              </span>
              <span className="ml-2">
                {pptNarrationJob.slideCount}
                {locale === "zh-CN" ? " 页脚本" : " slide script"}
              </span>
            </div>
          </div>
        </section>
      </div>
    );
  }
