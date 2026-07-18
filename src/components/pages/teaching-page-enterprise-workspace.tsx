"use client";

// Generic (enterprise) teacher workspace panel (Phase 3 decomposition of
// teaching-page.tsx). Extracted verbatim from renderEnterpriseWorkspace; every
// closed-over value/handler is a same-named prop, so the render body is unchanged.



import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { SquaresFour } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { teacherSidebarItems } from "@/data/uais";
import type { TeacherCourse } from "@/data/uais";
import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type { Locale, LocalizedText } from "@/i18n/copy";
import { dashboardIcons } from "./teaching-page-dashboard-icons";
import { InlineWorkspaceActionButtons } from "./teaching-page-inline-workspace-action-buttons";
import { InlineWorkspaceStatus } from "./teaching-page-inline-workspace-status";
import { InviteCodeWorkspaceTools } from "./teaching-page-invite-code-workspace-tools";
import { WorkspaceContext } from "./teaching-page-workspace-context";
import { createEnterpriseWorkspaceConfig } from "./teaching-page-workspace-config";
import type {
  InlineWorkspaceAlertNotificationStatus,
  InlineWorkspaceAlertStatus,
  InlineWorkspaceAuditStatus,
  InlineWorkspaceRollbackStatus,
  TeacherCourseAction,
} from "./teaching-page-types";

type EnterpriseWorkspaceProps = {
  locale: Locale;
  activeWorkspaceItem: (typeof teacherSidebarItems)[number];
  activeWorkspaceItemId: TeachingOperationId;
  inlineWorkspaceStatuses: Partial<Record<TeachingOperationId, string>>;
  inlineWorkspaceAuditStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceAuditStatus>>;
  inlineWorkspaceAlertStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceAlertStatus>>;
  inlineWorkspaceAlertNotificationStatuses: Partial<
    Record<TeachingOperationId, InlineWorkspaceAlertNotificationStatus>
  >;
  inlineWorkspaceRollbackStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceRollbackStatus>>;
  inviteWorkspaceCode: string;
  inviteWorkspaceJoinUrl: string;
  inviteWorkspaceStatus: LocalizedText;
  selectedCourseAction: { courseId: string; action: TeacherCourseAction } | undefined;
  selectedActionCourse: TeacherCourse | undefined;
  selectedCourseActionLabel: string | undefined;
  copyInviteWorkspaceValue: (value: string, successMessage: LocalizedText) => void;
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
  runInviteWorkspaceAction: (actionSlot: "primary" | "secondary") => void;
};

export function EnterpriseWorkspace({
  locale,
  activeWorkspaceItem,
  activeWorkspaceItemId,
  inlineWorkspaceStatuses,
  inlineWorkspaceAuditStatuses,
  inlineWorkspaceAlertStatuses,
  inlineWorkspaceAlertNotificationStatuses,
  inlineWorkspaceRollbackStatuses,
  inviteWorkspaceCode,
  inviteWorkspaceJoinUrl,
  inviteWorkspaceStatus,
  selectedCourseAction,
  selectedActionCourse,
  selectedCourseActionLabel,
  copyInviteWorkspaceValue,
  queueInlineWorkspaceAuditAlertNotifications,
  runInlineWorkspaceAction,
  runInlineWorkspaceRollback,
  runInviteWorkspaceAction,
}: EnterpriseWorkspaceProps) {
    const config = createEnterpriseWorkspaceConfig(
      activeWorkspaceItemId as TeachingOperationId,
      locale,
    );
    const Icon = dashboardIcons[config.id as keyof typeof dashboardIcons] ?? SquaresFour;

    return (
      <div
        className="space-y-5"
        data-uais-active-teaching-workspace={config.id}
        data-uais-teaching-workspace-panel
      >
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <Icon size={23} weight="duotone" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--accent)]">{config.subtitle}</p>
                <h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
                  {config.title}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                  {config.description}
                </p>
              </div>
            </div>
            {config.id === "invite-code" ? (
              <span className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 text-sm font-semibold text-[var(--accent)]">
                <QrCode size={17} weight="duotone" />
                {locale === "zh-CN" ? "当前页可操作" : "Operable here"}
              </span>
            ) : (
              <InlineWorkspaceActionButtons
                operationId={config.id}
                locale={locale}
                inlineWorkspaceStatuses={inlineWorkspaceStatuses}
                runInlineWorkspaceAction={runInlineWorkspaceAction}
              />
            )}
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
          {config.id === "invite-code" ? null : <InlineWorkspaceStatus
              operationId={config.id}
              locale={locale}
              inlineWorkspaceStatuses={inlineWorkspaceStatuses}
              inlineWorkspaceAuditStatuses={inlineWorkspaceAuditStatuses}
              inlineWorkspaceAlertStatuses={inlineWorkspaceAlertStatuses}
              inlineWorkspaceAlertNotificationStatuses={inlineWorkspaceAlertNotificationStatuses}
              inlineWorkspaceRollbackStatuses={inlineWorkspaceRollbackStatuses}
              runInlineWorkspaceRollback={runInlineWorkspaceRollback}
              queueInlineWorkspaceAuditAlertNotifications={queueInlineWorkspaceAuditAlertNotifications}
            />}

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {config.metrics.map((metric) => (
              <article
                key={metric.label}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
              >
                <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                  {metric.value}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{metric.note}</p>
              </article>
            ))}
          </div>

          {config.id === "invite-code" ? <InviteCodeWorkspaceTools
              locale={locale}
              inviteWorkspaceCode={inviteWorkspaceCode}
              inviteWorkspaceJoinUrl={inviteWorkspaceJoinUrl}
              inviteWorkspaceStatus={inviteWorkspaceStatus}
              copyInviteWorkspaceValue={copyInviteWorkspaceValue}
              runInviteWorkspaceAction={runInviteWorkspaceAction}
            /> : null}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
            <h3 className="text-lg font-semibold text-[var(--foreground)]">
              {locale === "zh-CN" ? "业务流程" : "Workflow"}
            </h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {config.lanes.map((lane) => (
                <article
                  key={lane.title}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
                >
                  <h4 className="font-semibold text-[var(--foreground)]">{lane.title}</h4>
                  <div className="mt-3 space-y-2">
                    {lane.items.map((item) => (
                      <p
                        key={item}
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--muted)]"
                      >
                        {item}
                      </p>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
            <h3 className="text-lg font-semibold text-[var(--foreground)]">
              {locale === "zh-CN" ? "最近记录" : "Recent Records"}
            </h3>
            <div className="mt-4 space-y-3">
              {config.records.map((record) => (
                <p
                  key={record}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-3 text-sm leading-6 text-[var(--muted)]"
                >
                  {record}
                </p>
              ))}
            </div>
          </aside>
        </section>
      </div>
    );
  }
