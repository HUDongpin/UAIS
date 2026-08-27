"use client";

// Inline-operation status panel for the teacher workspace (Phase 3 decomposition of
// teaching-page.tsx). Extracted verbatim from the TeachingPage renderInlineWorkspaceStatus
// helper; the previously closed-over state maps, locale, and rollback/notification
// handlers are now props (same identifiers), so the render body is unchanged.

import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BellRinging } from "@phosphor-icons/react/dist/ssr/BellRinging";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type { Locale } from "@/i18n/copy";
import { localizedText } from "@/components/ui/localized-text";
import { createInlineWorkspaceActionConfig } from "./teaching-page-workspace-config";
import {
  TEACHING_OPERATION_ALERT_FAILED_MESSAGE,
  TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE,
  TEACHING_OPERATION_ALERT_NOTIFICATION_PENDING_MESSAGE,
  TEACHING_OPERATION_ALERT_PENDING_MESSAGE,
  TEACHING_OPERATION_AUDIT_FAILED_MESSAGE,
  TEACHING_OPERATION_AUDIT_PENDING_MESSAGE,
  TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE,
  TEACHING_OPERATION_ROLLBACK_PENDING_MESSAGE,
} from "./teaching-page-messages";
import type {
  InlineWorkspaceAlertNotificationStatus,
  InlineWorkspaceAlertStatus,
  InlineWorkspaceAuditStatus,
  InlineWorkspaceRollbackStatus,
} from "./teaching-page-types";

type InlineWorkspaceStatusProps = {
  operationId: TeachingOperationId;
  locale: Locale;
  inlineWorkspaceStatuses: Partial<Record<TeachingOperationId, string>>;
  inlineWorkspaceAuditStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceAuditStatus>>;
  inlineWorkspaceAlertStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceAlertStatus>>;
  inlineWorkspaceAlertNotificationStatuses: Partial<
    Record<TeachingOperationId, InlineWorkspaceAlertNotificationStatus>
  >;
  inlineWorkspaceRollbackStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceRollbackStatus>>;
  runInlineWorkspaceRollback: (input: {
    operationId: TeachingOperationId;
    recordId: string;
    courseId?: string;
  }) => void;
  queueInlineWorkspaceAuditAlertNotifications: (
    operationId: TeachingOperationId,
    notificationRoute?: string,
  ) => void;
};

export function InlineWorkspaceStatus({
  operationId,
  locale,
  inlineWorkspaceStatuses,
  inlineWorkspaceAuditStatuses,
  inlineWorkspaceAlertStatuses,
  inlineWorkspaceAlertNotificationStatuses,
  inlineWorkspaceRollbackStatuses,
  runInlineWorkspaceRollback,
  queueInlineWorkspaceAuditAlertNotifications,
}: InlineWorkspaceStatusProps) {
    const actionConfig = createInlineWorkspaceActionConfig(operationId, locale);
    const message = inlineWorkspaceStatuses[operationId] ?? actionConfig.readyMessage;
    const auditStatus = inlineWorkspaceAuditStatuses[operationId];
    const alertStatus = inlineWorkspaceAlertStatuses[operationId];
    const alertNotificationStatus = inlineWorkspaceAlertNotificationStatuses[operationId];
    const rollbackStatus = inlineWorkspaceRollbackStatuses[operationId];
    const firstAlert = alertStatus?.alerts?.[0];

    return (
      <div className="mt-4 space-y-2">
        <p
          aria-live="polite"
          data-uais-inline-workspace-status={operationId}
          className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--accent)]"
        >
          {message}
        </p>
        {auditStatus ? (
          <div
            aria-live="polite"
            data-uais-inline-workspace-audit-status={operationId}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]"
          >
            {auditStatus.status === "verified" ? (
              <>
                <p className="font-semibold text-[var(--foreground)]">
                  {locale === "zh-CN" ? "审计读回已验证" : "Audit readback verified"}：
                  {auditStatus.traceId}
                </p>
                <p className="mt-1">
                  {locale === "zh-CN" ? "操作者" : "Actor"}：
                  {auditStatus.actorId ?? "unknown"} ·{" "}
                  {locale === "zh-CN" ? "审计事件" : "Audit events"}：
                  {auditStatus.auditEventCount ?? 0}
                </p>
                {auditStatus.authSession?.sessionId ? (
                  <p className="mt-1">
                    {locale === "zh-CN"
                      ? "签名会话已验证"
                      : "Signed session verified"}
                    ：{auditStatus.authSession.sessionId}
                  </p>
                ) : null}
                {auditStatus.domainObjectId && auditStatus.domainObjectType ? (
                  <p className="mt-1">
                    {locale === "zh-CN"
                      ? "领域对象已验证"
                      : "Domain object verified"}
                    ：{auditStatus.domainObjectType} / {auditStatus.domainObjectId}
                  </p>
                ) : null}
                {auditStatus.recordId ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--accent)] outline-none transition hover:bg-[var(--accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={rollbackStatus?.status === "pending" || rollbackStatus?.status === "rolled-back"}
                      onClick={() =>
                        runInlineWorkspaceRollback({
                          operationId,
                          recordId: auditStatus.recordId as string,
                          courseId: auditStatus.courseId,
                        })
                      }
                    >
                      <ArrowRight size={14} weight="bold" />
                      {locale === "zh-CN" ? "撤回本次操作" : "Roll Back This Operation"}
                    </button>
                    {rollbackStatus ? (
                      <span className="text-xs font-semibold text-[var(--muted)]">
                        {rollbackStatus.status === "rolled-back"
                          ? `${locale === "zh-CN" ? "已撤回" : "Rolled back"}：${rollbackStatus.targetRecordId}`
                          : rollbackStatus.status === "pending"
                            ? localizedText(TEACHING_OPERATION_ROLLBACK_PENDING_MESSAGE, locale)
                            : (rollbackStatus.message ??
                              localizedText(TEACHING_OPERATION_ROLLBACK_FAILED_MESSAGE, locale))}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="font-semibold">
                {auditStatus.status === "pending"
                  ? localizedText(TEACHING_OPERATION_AUDIT_PENDING_MESSAGE, locale)
                  : localizedText(TEACHING_OPERATION_AUDIT_FAILED_MESSAGE, locale)}
              </p>
            )}
          </div>
        ) : null}
        {alertStatus ? (
          <div
            aria-live="polite"
            data-uais-inline-workspace-alert-status={operationId}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]"
          >
            {alertStatus.status === "pending" ? (
              <p className="font-semibold">
                {localizedText(TEACHING_OPERATION_ALERT_PENDING_MESSAGE, locale)}
              </p>
            ) : alertStatus.status === "failed" ? (
              <p className="font-semibold text-[var(--foreground)]">
                {localizedText(TEACHING_OPERATION_ALERT_FAILED_MESSAGE, locale)}
              </p>
            ) : (
              <>
                <p className="flex items-center gap-2 font-semibold text-[var(--foreground)]">
                  <WarningCircle size={16} weight="bold" className="text-[var(--accent)]" />
                  {locale === "zh-CN" ? "教学操作告警" : "Teaching Operation Alerts"}：
                  {alertStatus.alertCount ?? 0}
                </p>
                {alertStatus.status === "attention-required" && firstAlert ? (
                  <p className="mt-1">
                    {firstAlert.reason === "missing-course-context"
                      ? locale === "zh-CN"
                        ? "缺少课程上下文"
                        : "Missing course context"
                      : locale === "zh-CN"
                        ? "告警"
                        : "Alert"}
                    ：{firstAlert.traceId ?? firstAlert.alertId ?? "unknown"}
                  </p>
                ) : null}
                {alertStatus.status === "attention-required" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--accent)] outline-none transition hover:bg-[var(--accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={alertNotificationStatus?.status === "pending"}
                      onClick={() =>
                        queueInlineWorkspaceAuditAlertNotifications(
                          operationId,
                          alertStatus.notificationRoute,
                        )
                      }
                    >
                      <BellRinging size={14} weight="bold" />
                      {locale === "zh-CN" ? "通知管理员" : "Notify Admin"}
                    </button>
                    {alertNotificationStatus ? (
                      <span className="text-xs font-semibold text-[var(--muted)]">
                        {alertNotificationStatus.status === "queued"
                          ? `${locale === "zh-CN" ? "告警通知已入队" : "Alert notification queued"}：${alertNotificationStatus.notificationCount ?? 0}`
                          : alertNotificationStatus.status === "verified"
                            ? `${locale === "zh-CN" ? "告警通知读回已验证" : "Alert notification readback verified"}：${alertNotificationStatus.notificationCount ?? 0}`
                          : alertNotificationStatus.status === "pending"
                            ? localizedText(
                                TEACHING_OPERATION_ALERT_NOTIFICATION_PENDING_MESSAGE,
                                locale,
                              )
                            : alertNotificationStatus.status === "clear"
                              ? `${locale === "zh-CN" ? "告警通知已入队" : "Alert notification queued"}：0`
                              : (alertNotificationStatus.message ??
                                localizedText(
                                  TEACHING_OPERATION_ALERT_NOTIFICATION_FAILED_MESSAGE,
                                  locale,
                                ))}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }
