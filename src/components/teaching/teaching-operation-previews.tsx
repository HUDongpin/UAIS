"use client";

// OpenMAIC operation preview panels for the teacher operation page (Phase 3
// decomposition): the OperationSpecificPreview switch plus the data-export, agent,
// and content preview panels, the invite QR, and their scene/label helpers.
//
// The invite panel renders the shared `InvitationQrCode`. It used to draw its own
// 15x15 grid seeded from the invite code's char codes — a picture of a QR code
// that encoded nothing, published to assistive technology as "QR code for invite
// code X". The scannable component replaced that pattern in the invitation dialog
// and the inline workspace; this copy was missed, so the standalone
// /teaching/invite-code page kept shipping the unscannable one.
// Presentational — driven by props and the extracted catalog data.



import { useState } from "react";
import { ChartBar } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { Export as ExportIcon } from "@phosphor-icons/react/dist/ssr/Export";
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { Lightning } from "@phosphor-icons/react/dist/ssr/Lightning";
import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
import { SquaresFour } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { createInviteJoinUrl } from "@/components/pages/teaching-page-helpers";
import { InvitationQrCode } from "@/components/teaching/invitation-qr-code";
import { localizedText } from "@/components/ui/localized-text";
import type { Locale } from "@/i18n/copy";
import {
  localText,
  openMaicAgentPlans,
  openMaicCourseScenes,
  openMaicExportPackages,
  openMaicManifestChecklist,
  type ExportManifestState,
  type OpenMaicScenePlan,
  type OperationConfig,
} from "@/components/teaching/teaching-operation-page-data";

export function OperationSpecificPreview({
  config,
  exportManifest,
  inviteCode,
  locale,
  manifestReady,
}: {
  config: OperationConfig;
  exportManifest: ExportManifestState;
  inviteCode: string;
  locale: Locale;
  manifestReady: boolean;
}) {
  if (config.id === "data-export") {
    return (
      <OpenMaicDataExportPreview
        exportManifest={exportManifest}
        locale={locale}
        manifestReady={manifestReady}
      />
    );
  }

  if (config.id === "agents") {
    return <OpenMaicAgentPreview locale={locale} />;
  }

  if (config.id === "content") {
    return <OpenMaicContentPreview locale={locale} />;
  }

  if (config.id === "invite-code") {
    return (
      <div className="mt-5 grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <InvitationQrCode
            invitationCode={inviteCode}
            joinUrl={createInviteJoinUrl(inviteCode)}
            locale={locale}
            variant="inline"
          />
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <div className="flex items-center gap-3">
            <QrCode size={23} weight="duotone" className="text-[var(--accent)]" />
            <p className="text-sm font-semibold text-[var(--muted)]">
              {locale === "zh-CN" ? "当前班级邀请码" : "Current class invite code"}
            </p>
          </div>
          <p className="mt-3 text-4xl font-semibold tracking-normal text-[var(--foreground)]">
            {inviteCode}
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            {locale === "zh-CN"
              ? "该邀请码保留教师确认发布步骤，避免误发到真实班级。"
              : "The code keeps a teacher publish step to avoid accidental release."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <GearSix size={22} weight="duotone" className="text-[var(--accent)]" />
        <h3 className="mt-3 text-base font-semibold text-[var(--foreground)]">
          {locale === "zh-CN" ? "工作区草稿" : "Workspace Draft"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {locale === "zh-CN"
            ? "按钮会调用后端合同，只有服务端确认后才显示保存成功。"
            : "Buttons call the S12 backend contract and only show saved state after server confirmation."}
        </p>
      </div>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <ChartBar size={22} weight="duotone" className="text-[var(--accent)]" />
        <h3 className="mt-3 text-base font-semibold text-[var(--foreground)]">
          {locale === "zh-CN" ? "质量门禁" : "Quality Gate"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {locale === "zh-CN"
            ? "页面保留审计、预检和教师确认状态，适合后续企业级接入。"
            : "The page keeps audit, preflight, and teacher confirmation states for enterprise hookup."}
        </p>
      </div>
    </div>
  );
}

function OpenMaicDataExportPreview({
  exportManifest,
  locale,
  manifestReady,
}: {
  exportManifest: ExportManifestState;
  locale: Locale;
  manifestReady: boolean;
}) {
  return (
    <div className="mt-5 space-y-4" data-uais-openmaic-page="data-export">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <ExportIcon size={23} weight="duotone" className="mt-1 text-[var(--accent)]" />
            <div>
              <h3 className="text-base font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "开放课堂智能系统导出包" : "OpenMAIC-style export packages"}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "同一页面提供演示文稿、资源包、课堂包与清单预览，方便后续接入真实打包服务。"
                  : "One page exposes PPTX, Resource Pack ZIP, Classroom ZIP, and manifest preview for future packaging services."}
              </p>
            </div>
          </div>
          <span className="inline-flex h-8 items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]">
            {locale === "zh-CN" ? "演示文稿 + 压缩包 + 清单" : "PPTX + ZIP + manifest"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {openMaicExportPackages.map((item) => (
            <article
              key={localizedText(item.title, locale)}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-[var(--foreground)]">
                  {localizedText(item.title, locale)}
                </h4>
                <span className="rounded-full bg-[var(--surface-soft)] px-2 py-1 text-xs font-semibold text-[var(--muted)]">
                  {localizedText(item.format, locale)}
                </span>
              </div>
              <p className="mt-2 text-xs font-semibold text-[var(--accent)]">
                {localizedText(item.status, locale)}
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
                {item.includes.map((include) => (
                  <li key={localizedText(include, locale)} className="flex gap-2">
                    <CheckCircle size={16} weight="duotone" className="mt-1 shrink-0 text-[var(--accent)]" />
                    <span>{localizedText(include, locale)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                {localizedText(item.note, locale)}
              </p>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <div className="flex items-center gap-3">
            <ClipboardText size={22} weight="duotone" className="text-[var(--accent)]" />
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              {locale === "zh-CN" ? "清单与打包范围" : "Manifest and packaging scope"}
            </h3>
          </div>
          <div className="mt-4 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--foreground)]">
            {manifestReady ? (
              exportManifest.downloadUrl ? (
                <a
                  href={exportManifest.downloadUrl}
                  className="underline decoration-[var(--accent)] decoration-2 underline-offset-4"
                >
                  {locale === "zh-CN" ? "导出清单已生成" : exportManifest.manifestId}
                </a>
              ) : (
                locale === "zh-CN" ? "导出清单已生成" : exportManifest.manifestId
              )
            ) : locale === "zh-CN" ? (
              "等待生成导出清单"
            ) : (
              "Waiting for export manifest"
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              [locale === "zh-CN" ? "场景文件" : "scenes.json", locale === "zh-CN" ? "课堂场景" : "Class scenes"],
              [locale === "zh-CN" ? "媒体目录" : "media/", locale === "zh-CN" ? "媒体素材" : "Media assets"],
              [locale === "zh-CN" ? "智能体文件" : "agents.json", locale === "zh-CN" ? "智能体配置" : "Agent configs"],
            ].map(([name, description]) => (
              <div
                key={name}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
              >
                <p className="text-sm font-semibold text-[var(--foreground)]">{name}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <div className="flex items-center gap-3">
            <ShieldCheck size={22} weight="duotone" className="text-[var(--accent)]" />
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              {locale === "zh-CN" ? "脱敏检查" : "Redaction checks"}
            </h3>
          </div>
          <div className="mt-4 space-y-3">
            {openMaicManifestChecklist.map((item) => (
              <p
                key={localizedText(item, locale)}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-sm leading-6 text-[var(--muted)]"
              >
                {localizedText(item, locale)}
              </p>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function OpenMaicAgentPreview({ locale }: { locale: Locale }) {
  const [mode, setMode] = useState<"preset" | "auto">("preset");
  const visibleAgents = openMaicAgentPlans.filter((agent) => agent.mode === mode);

  return (
    <div className="mt-5 space-y-4" data-uais-openmaic-page="agents">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <Robot size={24} weight="duotone" className="mt-1 text-[var(--accent)]" />
            <div>
              <h3 className="text-base font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "预设 / 自动智能体配置" : "Preset / Auto agent setup"}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "参考开放课堂智能系统的智能体栏：教师先选择预设或自动，再确认人格、动作权限、语音和课程绑定。"
                  : "Inspired by the OpenMAIC agent bar: teachers choose preset or auto, then confirm persona, permissions, voice, and course binding."}
              </p>
            </div>
          </div>
          <div
            className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-1"
            aria-label={locale === "zh-CN" ? "智能体模式" : "Agent mode"}
          >
            {(["preset", "auto"] as const).map((item) => {
              const active = item === mode;
              return (
                <button
                  key={item}
                  type="button"
                  className={[
                    "h-9 rounded-full px-4 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                    active
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--muted)] hover:bg-[var(--surface-soft)]",
                  ].join(" ")}
                  onClick={() => setMode(item)}
                >
                  {item === "preset"
                    ? locale === "zh-CN"
                      ? "预设智能体"
                      : "Preset agents"
                    : locale === "zh-CN"
                      ? "自动生成"
                      : "Auto generation"}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {visibleAgents.map((agent) => (
            <article
              key={localizedText(agent.name, locale)}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-semibold text-[var(--foreground)]">
                      {localizedText(agent.name, locale)}
                    </h4>
                    <span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold uppercase text-[var(--accent)]">
                      {locale === "zh-CN"
                        ? agent.mode === "preset"
                          ? "预设"
                          : "自动"
                        : agent.mode}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    {localizedText(agent.persona, locale)}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--muted)] md:min-w-52">
                  <p className="font-semibold text-[var(--foreground)]">
                    {locale === "zh-CN" ? "语音" : "Voice"}
                  </p>
                  <p className="mt-1">{localizedText(agent.voice, locale)}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="flex flex-wrap gap-2">
                  {agent.permissions.map((permission) => (
                    <span
                      key={localizedText(permission, locale)}
                      className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)]"
                    >
                      {localizedText(permission, locale)}
                    </span>
                  ))}
                </div>
                <div className="text-sm leading-6 text-[var(--muted)]">
                  <p>
                    <span className="font-semibold text-[var(--foreground)]">
                      {locale === "zh-CN" ? "课程绑定：" : "Course binding: "}
                    </span>
                    {localizedText(agent.binding, locale)}
                  </p>
                  <p>
                    <span className="font-semibold text-[var(--foreground)]">
                      {locale === "zh-CN" ? "状态：" : "Status: "}
                    </span>
                    {localizedText(agent.status, locale)}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          localText("角色和人格已和课程目标绑定", "Role/persona is bound to course goals"),
          localText("动作权限需通过学生端预检", "Action permissions require student-side preflight"),
          localText("语音选择保留教师确认", "Voice selection keeps teacher confirmation"),
        ].map((item) => (
          <div
            key={localizedText(item, locale)}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
          >
            <ShieldCheck size={21} weight="duotone" className="text-[var(--accent)]" />
            <p className="mt-3 text-sm font-semibold leading-6 text-[var(--foreground)]">
              {localizedText(item, locale)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpenMaicContentPreview({ locale }: { locale: Locale }) {
  return (
    <div className="mt-5 space-y-4" data-uais-openmaic-page="content">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <div className="flex items-start gap-3">
          <FileText size={23} weight="duotone" className="mt-1 text-[var(--accent)]" />
          <div>
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              {locale === "zh-CN" ? "开放课堂智能系统场景内容结构" : "OpenMAIC scene content structure"}
            </h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
              {locale === "zh-CN"
                ? "课程内容页按场景管理课堂材料，并把演示页、测验、互动任务、问题式学习与播放、专业编辑、续生成放到同一工作流。"
                : "The content page manages classroom materials by scene, linking slide, quiz, interactive, and PBL with playback, Pro editing, and continuation."}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
          <div className="grid grid-cols-[88px_112px_minmax(0,1fr)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold uppercase text-[var(--muted)] md:grid-cols-[88px_120px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <span>{locale === "zh-CN" ? "场景" : "Scene"}</span>
            <span>{locale === "zh-CN" ? "类型" : "Type"}</span>
            <span>{locale === "zh-CN" ? "标题" : "Title"}</span>
            <span className="hidden md:block">{locale === "zh-CN" ? "课堂播放" : "Playback"}</span>
            <span className="hidden md:block">{locale === "zh-CN" ? "专业编辑" : "Pro edit"}</span>
            <span className="hidden md:block">{locale === "zh-CN" ? "续生成" : "Continuation"}</span>
          </div>
          {openMaicCourseScenes.map((scene) => (
            <div
              key={scene.scene}
              className="grid grid-cols-[88px_112px_minmax(0,1fr)] border-t border-[var(--border)] px-3 py-3 text-sm md:grid-cols-[88px_120px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
            >
              <span className="font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? getSceneLabel(scene.scene) : scene.scene}
              </span>
              <span className="font-semibold text-[var(--accent)]">
                {locale === "zh-CN" ? getSceneTypeLabel(scene.type) : scene.type}
              </span>
              <span className="min-w-0 font-semibold text-[var(--foreground)]">
                {localizedText(scene.title, locale)}
              </span>
              <span className="mt-2 text-[var(--muted)] md:mt-0 md:block">
                {localizedText(scene.playback, locale)}
              </span>
              <span className="mt-2 text-[var(--muted)] md:mt-0 md:block">
                {localizedText(scene.proEdit, locale)}
              </span>
              <span className="mt-2 text-[var(--muted)] md:mt-0 md:block">
                {localizedText(scene.continuation, locale)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            icon: SquaresFour,
            title: localText("课堂播放", "Classroom playback"),
            body: localText(
              "每个场景都保留播放状态，便于教师从课堂模式直接检查。",
              "Every scene keeps playback state so teachers can review directly from classroom mode.",
            ),
          },
          {
            icon: GearSix,
            title: localText("专业编辑", "Pro editing"),
            body: localText(
              "标题、讲稿、选项、评分量规和互动提示进入可编辑状态。",
              "Titles, narration, options, rubrics, and interaction prompts become editable.",
            ),
          },
          {
            icon: Lightning,
            title: localText("场景续生成", "Scene continuation"),
            body: localText(
              "续生成只创建教师草稿，不直接发布到学生端。",
              "Continuation only creates teacher drafts, never direct student release.",
            ),
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <article
              key={localizedText(item.title, locale)}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
            >
              <Icon size={22} weight="duotone" className="text-[var(--accent)]" />
              <h4 className="mt-3 text-base font-semibold text-[var(--foreground)]">
                {localizedText(item.title, locale)}
              </h4>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {localizedText(item.body, locale)}
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function formatCourseAction(action: string, locale: Locale) {
  if (action === "manage") {
    return locale === "zh-CN" ? "管理课程" : "Manage course";
  }

  if (action === "continue") {
    return locale === "zh-CN" ? "继续编辑" : "Continue editing";
  }

  // The two class actions `createTeachingClassActionHref` emits. Without these
  // the fallback returned the raw slug, so a zh-CN page headed 课程操作 displayed
  // the literal English `enter-class` / `activity-list`.
  if (action === "enter-class") {
    return locale === "zh-CN" ? "进入班级" : "Enter class";
  }

  if (action === "activity-list") {
    return locale === "zh-CN" ? "活动列表" : "Activity list";
  }

  return action;
}

function getSceneTypeLabel(type: OpenMaicScenePlan["type"]) {
  const labels: Record<OpenMaicScenePlan["type"], string> = {
    PBL: "问题式学习",
    interactive: "互动任务",
    quiz: "测验",
    slide: "演示页",
  };

  return labels[type];
}

function getSceneLabel(sceneId: string) {
  const sceneNumber = Number(sceneId.replace(/\D/g, ""));
  return Number.isFinite(sceneNumber) && sceneNumber > 0
    ? `第 ${sceneNumber} 场景`
    : "场景";
}

