"use client";

// Inline-operation primary/secondary action buttons for the teacher workspace
// (Phase 3 decomposition of teaching-page.tsx). Extracted verbatim from
// renderInlineWorkspaceActionButtons; closed-over locale/state/handler are same-named props.

import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { localizedText } from "@/components/ui/localized-text";
import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type { Locale } from "@/i18n/copy";
import { TEACHING_OPERATION_SAVE_PENDING_MESSAGE } from "./teaching-page-messages";
import { createInlineWorkspaceActionConfig } from "./teaching-page-workspace-config";

type InlineWorkspaceActionButtonsProps = {
  operationId: TeachingOperationId;
  locale: Locale;
  inlineWorkspaceStatuses: Partial<Record<TeachingOperationId, string>>;
  runInlineWorkspaceAction: (
    operationId: TeachingOperationId,
    actionSlot: "primary" | "secondary",
  ) => void;
};

export function InlineWorkspaceActionButtons({
  operationId,
  locale,
  inlineWorkspaceStatuses,
  runInlineWorkspaceAction,
}: InlineWorkspaceActionButtonsProps) {
    const actionConfig = createInlineWorkspaceActionConfig(operationId, locale);
    const isSaving =
      inlineWorkspaceStatuses[operationId] ===
      localizedText(TEACHING_OPERATION_SAVE_PENDING_MESSAGE, locale);

    return (
      <div
        className="flex flex-wrap gap-2"
        data-uais-inline-workspace-actions={operationId}
      >
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--accent)] disabled:active:translate-y-0"
          disabled={isSaving}
          onClick={() => runInlineWorkspaceAction(operationId, "primary")}
        >
          <ClipboardText size={17} weight="bold" />
          {actionConfig.primaryAction}
        </button>
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--surface)] disabled:active:translate-y-0"
          disabled={isSaving}
          onClick={() => runInlineWorkspaceAction(operationId, "secondary")}
        >
          <ArrowRight size={16} weight="bold" />
          {actionConfig.secondaryAction}
        </button>
      </div>
    );
  }
