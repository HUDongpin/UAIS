"use client";

import { useTeachingWorkspace } from "./use-teaching-workspace";
import {
} from "./teaching-page-workspace-config";
import { EnterpriseWorkspace } from "./teaching-page-enterprise-workspace";
import { AgentWorkspace } from "./teaching-page-agent-workspace";
import { CourseSettingsWorkspace } from "./teaching-page-course-settings-workspace";
import { dashboardIcons } from "./teaching-page-dashboard-icons";
import {
} from "./teaching-page-projection-verifiers";
import {
} from "./teaching-page-helpers";
import {
  ClassInvitationDialog,
  NewClassDialog,
  NewCourseDialog,
} from "./teaching-page-dialogs";
import {
} from "./teacher-ppt-narration-workflow-format";
import Link from "next/link";
import { SquaresFour } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import {
  getTeachingOperationHref,
} from "@/components/teaching/teaching-operation-data";
import { localizedText } from "@/components/ui/localized-text";
import { teacherSidebarItems } from "@/data/uais";
import {
} from "@/lib/ai/voice/ppt-narration";
import {
} from "@/lib/teaching/course-readback";
import {
  TEACHING_COURSE_LOAD_FAILED_MESSAGE,
} from "./teaching-page-messages";
import {
} from "./teaching-page-types";



export function TeachingPage() {
  const {
    locale,
    t,
    courseCards,
    activeWorkspaceItemId,
    selectedCourseAction,
    isNewCourseOpen,
    setIsNewCourseOpen,
    setNewClassCourseId,
    courseClasses,
    classMemberships,
    authenticatedTeacherActorId,
    persistedCourseLoadError,
    membershipApprovalStatuses,
    selectedClassInvitation,
    setSelectedClassInvitation,
    inviteWorkspaceCode,
    inviteWorkspaceJoinUrl,
    inviteWorkspaceStatus,
    inlineWorkspaceStatuses,
    inlineWorkspaceAuditStatuses,
    inlineWorkspaceAlertStatuses,
    inlineWorkspaceAlertNotificationStatuses,
    inlineWorkspaceRollbackStatuses,
    textReasoningProvider,
    multimodalProvider,
    voiceCloneJob,
    pptNarrationJob,
    createCourseFromDraft,
    createClassForCourse,
    approveClassMembership,
    newClassCourse,
    activeWorkspaceItem,
    selectedActionCourse,
    selectedCourseActionLabel,
    activeCourseSettingsCourse,
    activeCourseSettingsDraft,
    openWorkspaceItem,
    updateCourseSettingsDraft,
    runInlineWorkspaceAction,
    queueInlineWorkspaceAuditAlertNotifications,
    runInlineWorkspaceRollback,
    runInviteWorkspaceAction,
    copyInviteWorkspaceValue,  } = useTeachingWorkspace();
  function renderActiveWorkspacePanel() {
    if (activeWorkspaceItemId === "course-settings") {
      return (
        <CourseSettingsWorkspace
          locale={locale}
          t={t}
          activeWorkspaceItem={activeWorkspaceItem}
          activeCourseSettingsCourse={activeCourseSettingsCourse}
          activeCourseSettingsDraft={activeCourseSettingsDraft}
          courseCards={courseCards}
          courseClasses={courseClasses}
          classMemberships={classMemberships}
          membershipApprovalStatuses={membershipApprovalStatuses}
          inlineWorkspaceStatuses={inlineWorkspaceStatuses}
          inlineWorkspaceAuditStatuses={inlineWorkspaceAuditStatuses}
          inlineWorkspaceAlertStatuses={inlineWorkspaceAlertStatuses}
          inlineWorkspaceAlertNotificationStatuses={inlineWorkspaceAlertNotificationStatuses}
          inlineWorkspaceRollbackStatuses={inlineWorkspaceRollbackStatuses}
          selectedActionCourse={selectedActionCourse}
          selectedCourseActionLabel={selectedCourseActionLabel}
          selectedCourseAction={selectedCourseAction}
          setIsNewCourseOpen={setIsNewCourseOpen}
          setNewClassCourseId={setNewClassCourseId}
          setSelectedClassInvitation={setSelectedClassInvitation}
          approveClassMembership={approveClassMembership}
          updateCourseSettingsDraft={updateCourseSettingsDraft}
          queueInlineWorkspaceAuditAlertNotifications={queueInlineWorkspaceAuditAlertNotifications}
          runInlineWorkspaceAction={runInlineWorkspaceAction}
          runInlineWorkspaceRollback={runInlineWorkspaceRollback}
        />
      );
    }

    if (activeWorkspaceItemId === "agents") {
      return (
      <AgentWorkspace
        locale={locale}
        activeWorkspaceItem={activeWorkspaceItem}
        authenticatedTeacherActorId={authenticatedTeacherActorId}
        inlineWorkspaceStatuses={inlineWorkspaceStatuses}
        inlineWorkspaceAuditStatuses={inlineWorkspaceAuditStatuses}
        inlineWorkspaceAlertStatuses={inlineWorkspaceAlertStatuses}
        inlineWorkspaceAlertNotificationStatuses={inlineWorkspaceAlertNotificationStatuses}
        inlineWorkspaceRollbackStatuses={inlineWorkspaceRollbackStatuses}
        multimodalProvider={multimodalProvider}
        textReasoningProvider={textReasoningProvider}
        pptNarrationJob={pptNarrationJob}
        voiceCloneJob={voiceCloneJob}
        selectedActionCourse={selectedActionCourse}
        selectedCourseActionLabel={selectedCourseActionLabel}
        selectedCourseAction={selectedCourseAction}
        t={t}
        queueInlineWorkspaceAuditAlertNotifications={queueInlineWorkspaceAuditAlertNotifications}
        runInlineWorkspaceAction={runInlineWorkspaceAction}
        runInlineWorkspaceRollback={runInlineWorkspaceRollback}
      />
    );
    }

    return (
      <EnterpriseWorkspace
        locale={locale}
        activeWorkspaceItem={activeWorkspaceItem}
        activeWorkspaceItemId={activeWorkspaceItemId}
        inlineWorkspaceStatuses={inlineWorkspaceStatuses}
        inlineWorkspaceAuditStatuses={inlineWorkspaceAuditStatuses}
        inlineWorkspaceAlertStatuses={inlineWorkspaceAlertStatuses}
        inlineWorkspaceAlertNotificationStatuses={inlineWorkspaceAlertNotificationStatuses}
        inlineWorkspaceRollbackStatuses={inlineWorkspaceRollbackStatuses}
        inviteWorkspaceCode={inviteWorkspaceCode}
        inviteWorkspaceJoinUrl={inviteWorkspaceJoinUrl}
        inviteWorkspaceStatus={inviteWorkspaceStatus}
        selectedCourseAction={selectedCourseAction}
        selectedActionCourse={selectedActionCourse}
        selectedCourseActionLabel={selectedCourseActionLabel}
        copyInviteWorkspaceValue={copyInviteWorkspaceValue}
        queueInlineWorkspaceAuditAlertNotifications={queueInlineWorkspaceAuditAlertNotifications}
        runInlineWorkspaceAction={runInlineWorkspaceAction}
        runInlineWorkspaceRollback={runInlineWorkspaceRollback}
        runInviteWorkspaceAction={runInviteWorkspaceAction}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_48px_var(--shadow)] md:p-7">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
          {t.teaching.title}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
          {t.teaching.summary}
        </p>
      </section>

      {persistedCourseLoadError ? (
        <section
          role="alert"
          className="rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4 text-sm font-semibold leading-6 text-[var(--accent)]"
        >
          <p>{localizedText(TEACHING_COURSE_LOAD_FAILED_MESSAGE, locale)}</p>
          <p className="mt-1 text-[var(--foreground)]">{persistedCourseLoadError}</p>
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_18px_42px_var(--shadow)]">
          <h2 className="px-2 text-sm font-semibold text-[var(--muted)]">
            {t.teaching.operations}
          </h2>
          <div className="mt-3 space-y-2">
            {teacherSidebarItems.map((item) => {
              const Icon =
                dashboardIcons[item.id as keyof typeof dashboardIcons] ?? SquaresFour;
              const active = item.id === activeWorkspaceItemId;
              return (
                <Link
                  key={item.id}
                  href={getTeachingOperationHref(item.id)}
                  aria-controls="teacher-workspace-entry-panel"
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left outline-none transition active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                    active
                      ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                      : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-soft)]",
                  ].join(" ")}
                  onClick={(event) => {
                    event.preventDefault();
                    openWorkspaceItem(item.id);
                  }}
                >
                  <span
                    className={[
                      "flex size-9 shrink-0 items-center justify-center rounded-2xl",
                      active
                        ? "bg-[var(--surface)] text-[var(--accent)]"
                        : "bg-[var(--accent-soft)] text-[var(--foreground)]",
                    ].join(" ")}
                  >
                    <Icon size={18} weight="duotone" />
                  </span>
                  <span
                    className={[
                      "block text-base font-semibold",
                      active ? "text-[var(--accent)]" : "text-[var(--foreground)]",
                    ].join(" ")}
                  >
                    {localizedText(item.title, locale)}
                  </span>
                </Link>
              );
            })}
          </div>
        </aside>

        {renderActiveWorkspacePanel()}
      </section>

      {isNewCourseOpen ? (
        <NewCourseDialog
          locale={locale}
          teacherActorId={authenticatedTeacherActorId}
          onCancel={() => setIsNewCourseOpen(false)}
          onCreate={createCourseFromDraft}
        />
      ) : null}
      {newClassCourse ? (
        <NewClassDialog
          course={newClassCourse}
          locale={locale}
          onCancel={() => setNewClassCourseId(undefined)}
          onCreate={(className) => createClassForCourse(newClassCourse.id, className)}
        />
      ) : null}
      {selectedClassInvitation ? (
        <ClassInvitationDialog
          classItem={selectedClassInvitation}
          locale={locale}
          onClose={() => setSelectedClassInvitation(undefined)}
        />
      ) : null}
    </div>
  );
}

