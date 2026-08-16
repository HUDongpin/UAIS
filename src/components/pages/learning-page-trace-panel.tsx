"use client";

// LangGraph orchestration trace panel for the learner AI-guide (Phase 3 decomposition
// of learning-page.tsx): renders multi-agent run stages and human-in-the-loop review
// state. Presentational, driven by orchestration props; not the group chatroom surface.



import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import type { Locale } from "@/i18n/copy";
import type {
  AiGuideHumanReviewState,
  LearningAiGuideOrchestration,
} from "./learning-page";

export function LangGraphTracePanel({
  locale,
  orchestration,
  humanReview,
  onHumanReviewAction,
}: {
  locale: Locale;
  orchestration: LearningAiGuideOrchestration;
  humanReview?: AiGuideHumanReviewState;
  onHumanReviewAction?: (action: "start-review" | "resume-review") => void;
}) {
  const graphId = orchestration.graph?.graphId ?? "langgraph";
  const supervisorNodeId =
    orchestration.graph?.supervisorNodeId ??
    orchestration.trace?.handoffs?.find((handoff) =>
      handoff.fromNodeId?.includes("supervisor"),
    )?.fromNodeId;
  const runtime = orchestration.runtime;
  const memory = orchestration.trace?.memory;
  const humanInTheLoop = orchestration.trace?.humanInTheLoop;
  const turns = orchestration.turns ?? [];
  const handoffs = orchestration.trace?.handoffs ?? [];
  const traceTitle = locale === "zh-CN" ? "LangGraph 执行追踪" : "LangGraph trace";
  const runtimeLabel = locale === "zh-CN" ? "运行状态" : "Runtime";
  const memoryLabel = locale === "zh-CN" ? "记忆检查点" : "Memory checkpoint";
  const supervisorLabel = locale === "zh-CN" ? "监督节点" : "Supervisor";
  const handoffLabel = locale === "zh-CN" ? "移交" : "Handoff";
  const currentHumanReview =
    humanReview ??
    (humanInTheLoop
      ? {
          status: "ready" as const,
        }
      : undefined);
  const humanReviewText = formatHumanReviewText(locale, currentHumanReview);
  const humanReviewAction = getHumanReviewAction(currentHumanReview);

  return (
    <div
      data-uais-langgraph-trace={graphId}
      className="mt-3 border-t border-[var(--border)] pt-3 text-xs leading-5 text-[var(--muted)]"
    >
      <div className="flex items-center gap-2 font-semibold text-[var(--foreground)]">
        <Sparkle size={14} weight="fill" className="text-[var(--accent)]" />
        <span>{traceTitle}</span>
      </div>
      <div className="mt-2 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]/70 p-2">
        <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
          <span className="text-[var(--muted)]">Graph</span>
          <span className="break-words font-semibold text-[var(--foreground)]">{graphId}</span>
        </div>
        {supervisorNodeId ? (
          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
            <span className="text-[var(--muted)]">{supervisorLabel}</span>
            <span className="break-words font-semibold text-[var(--foreground)]">
              {supervisorNodeId}
            </span>
          </div>
        ) : null}
        {runtime ? (
          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
            <span className="text-[var(--muted)]">{runtimeLabel}</span>
            <span className="break-words text-[var(--foreground)]">
              {runtime.status ?? "completed"}
              {typeof runtime.eventCount === "number"
                ? ` · ${runtime.eventCount} events`
                : ""}
            </span>
          </div>
        ) : null}
        {memory ? (
          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
            <span className="text-[var(--muted)]">{memoryLabel}</span>
            <span className="break-words text-[var(--foreground)]">
              {memory.mode ?? "thread-checkpoint"}
              {memory.threadId ? ` · ${memory.threadId}` : ""}
              {memory.store ? ` · ${memory.store}` : ""}
            </span>
          </div>
        ) : null}
        {humanInTheLoop ? (
          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
            <span className="text-[var(--muted)]">HITL</span>
            <span className="break-words text-[var(--foreground)]">
              Human-in-the-loop · {humanInTheLoop.status ?? "ready"}
              {humanInTheLoop.resumeMode ? ` · ${humanInTheLoop.resumeMode}` : ""}
            </span>
          </div>
        ) : null}
        {currentHumanReview ? (
          <div className="grid gap-2 border-t border-[var(--border)] pt-2">
            <div className="break-words text-[var(--foreground)]">{humanReviewText}</div>
            {humanReviewAction && onHumanReviewAction ? (
              <button
                type="button"
                disabled={currentHumanReview.busy}
                onClick={() => onHumanReviewAction(humanReviewAction)}
                className="w-fit rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)] outline-none transition hover:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {getHumanReviewActionLabel(locale, humanReviewAction, currentHumanReview.busy)}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {turns.length > 0 ? (
        <div className="mt-2 grid gap-1">
          {turns.map((turn, index) => (
            <div
              key={`${turn.agentId ?? "agent"}-${index}`}
              className="rounded-md bg-[var(--surface)]/60 px-2 py-1"
            >
              <span className="font-semibold text-[var(--foreground)]">
                {turn.label ?? turn.agentId ?? "Agent"} · {turn.providerRole ?? "agent"}
              </span>
              {turn.content ? (
                <span className="ml-1 text-[var(--muted)]">{turn.content}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {handoffs.length > 0 ? (
        <div className="mt-2 grid gap-1">
          {handoffs.slice(0, 3).map((handoff, index) => (
            <div
              key={`${handoff.fromNodeId ?? "from"}-${handoff.toNodeId ?? "to"}-${index}`}
              className="break-words rounded-md bg-[var(--surface-elevated)] px-2 py-1 text-[var(--muted)]"
            >
              {handoffLabel}: {handoff.fromNodeId ?? "node"} →{" "}
              {handoff.toNodeId ?? "node"}
              {handoff.reason ? ` · ${handoff.reason}` : ""}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getHumanReviewAction(review: AiGuideHumanReviewState | undefined) {
  if (!review || review.busy) {
    return undefined;
  }
  if (review.status === "ready" || review.status === "failed") {
    return "start-review" as const;
  }
  if (review.status === "waiting-human") {
    return "resume-review" as const;
  }
  return undefined;
}

function getHumanReviewActionLabel(
  locale: Locale,
  action: "start-review" | "resume-review",
  busy: boolean | undefined,
) {
  if (busy) {
    return locale === "zh-CN" ? "处理中" : "Working";
  }
  if (action === "resume-review") {
    return locale === "zh-CN" ? "确认复核并恢复" : "Approve and resume";
  }
  return locale === "zh-CN" ? "发起人工复核" : "Start human review";
}

function formatHumanReviewText(
  locale: Locale,
  review: AiGuideHumanReviewState | undefined,
) {
  if (!review) {
    return "";
  }
  if (review.busy) {
    return locale === "zh-CN" ? "正在处理人工复核..." : "Processing human review...";
  }
  if (review.status === "waiting-human") {
    return review.prompt
      ? `${locale === "zh-CN" ? "等待人工复核" : "Waiting for human review"} · ${review.prompt}`
      : locale === "zh-CN"
        ? "等待人工复核"
        : "Waiting for human review";
  }
  if (review.status === "resumed") {
    return review.text
      ? review.text
      : locale === "zh-CN"
        ? "人工复核已完成，线程已恢复。"
        : "Human review completed and the thread resumed.";
  }
  if (review.status === "failed") {
    return review.text
      ? review.text
      : locale === "zh-CN"
        ? "人工复核暂时失败，请稍后重试。"
        : "Human review failed. Please try again.";
  }
  return locale === "zh-CN"
    ? "人工复核已准备好，可发起复核。"
    : "Human review is ready.";
}
