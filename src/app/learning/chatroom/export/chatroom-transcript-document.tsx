import { copy } from "@/i18n/copy";
import type { ChatroomTranscriptDocument } from "@/lib/server/learning-chatroom-share-view";

// The one read-only rendering of a chatroom room, used by both Phase 5 surfaces:
// the signed-in print view (`/learning/chatroom/export`) and the public share
// page (`/share/[shareId]`). It lives under the export route because that is the
// route that owns the print stylesheet; the share page imports it as a plain
// module (nothing about a non-`page` file inside `app/` is route-special).
//
// Two tones, one tree. `print` is deliberately light-only and ink-cheap - a
// printed page has no dark mode and no theme toggle, and the plan pins
// light-theme print - while `screen` is fully tokenized so the share page follows
// the viewer's theme. Everything else (structure, labels, page-break behaviour)
// is shared, so the two surfaces cannot drift apart.
//
// Server component on purpose: it renders display names that the loaders already
// projected, and it holds no state, no handlers and no account ids.

export type ChatroomTranscriptDocumentTone = "print" | "screen";

const tones = {
  print: {
    page: "bg-white text-slate-900",
    panel: "border border-slate-300 bg-white",
    heading: "text-slate-900",
    muted: "text-slate-600",
    metaLabel: "text-slate-500",
    studentBubble: "border border-slate-300 bg-white",
    agentBubble: "border border-slate-400 bg-slate-50",
    tag: "border border-slate-400 text-slate-700",
    divider: "border-slate-200",
  },
  screen: {
    page: "bg-[var(--background)] text-[var(--foreground)]",
    panel: "border border-[var(--border)] bg-[var(--surface)]",
    heading: "text-[var(--foreground)]",
    muted: "text-[var(--muted)]",
    metaLabel: "text-[var(--muted)]",
    studentBubble: "border border-[var(--border)] bg-[var(--surface-elevated)]",
    agentBubble: "border border-[var(--accent-border)] bg-[var(--accent-soft)]",
    tag: "border border-[var(--accent-border)] text-[var(--accent)]",
    divider: "border-[var(--border)]",
  },
} as const;

export function ChatroomTranscriptDocument({
  document,
  tone,
  title,
  notice,
  actions,
}: {
  document: ChatroomTranscriptDocument;
  tone: ChatroomTranscriptDocumentTone;
  title: string;
  notice?: string;
  actions?: React.ReactNode;
}) {
  const t = copy[document.locale];
  const style = tones[tone];

  return (
    <article
      data-uais-chatroom-document={tone}
      className={`mx-auto w-full max-w-3xl rounded-2xl p-6 ${style.page} ${style.panel}`}
    >
      <header className={`border-b pb-4 ${style.divider}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-xs font-semibold uppercase tracking-wide ${style.metaLabel}`}>
              {`${t.brand.name} · ${t.brand.headerSubtitle}`}
            </p>
            <h1 className={`mt-1 text-xl font-semibold ${style.heading}`}>{title}</h1>
            <p className={`mt-1 text-sm ${style.muted}`}>{t.learning.chatTitle}</p>
          </div>
          {actions ? <div className="print:hidden">{actions}</div> : null}
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {document.courseName ? (
            <DocumentMeta
              label={t.learning.exportCourseLabel}
              value={document.courseName}
              style={style}
            />
          ) : null}
          {document.groupName ? (
            <DocumentMeta
              label={t.learning.exportGroupLabel}
              value={document.groupName}
              style={style}
            />
          ) : null}
          {document.memberNames.length > 0 ? (
            <DocumentMeta
              label={t.learning.groupMembers}
              value={document.memberNames.join(" · ")}
              style={style}
            />
          ) : null}
          {document.dateRange ? (
            <DocumentMeta
              label={t.learning.exportDateRangeLabel}
              value={
                document.dateRange.startLabel === document.dateRange.endLabel
                  ? document.dateRange.startLabel
                  : `${document.dateRange.startLabel} — ${document.dateRange.endLabel}`
              }
              style={style}
            />
          ) : null}
          <DocumentMeta
            label={t.learning.exportMessageCountLabel}
            value={String(document.messageCount)}
            style={style}
          />
        </dl>

        {notice ? <p className={`mt-3 text-xs leading-5 ${style.muted}`}>{notice}</p> : null}
      </header>

      <div className="mt-4 space-y-3">
        {document.transcriptStatus === "unavailable" ? (
          <p className={`text-sm ${style.muted}`}>{t.learning.exportTranscriptUnavailable}</p>
        ) : null}
        {document.messages.length === 0 ? (
          <p className={`text-sm ${style.muted}`}>{t.learning.emptyChat}</p>
        ) : (
          document.messages.map((message) => (
            <section
              key={message.id}
              // `break-inside-avoid` keeps one turn on one sheet: a transcript
              // split mid-sentence across a page break is what makes printed
              // chat logs unreadable.
              className={`rounded-2xl px-4 py-3 print:break-inside-avoid ${
                message.role === "agent" ? style.agentBubble : style.studentBubble
              }`}
            >
              <p className="flex flex-wrap items-baseline gap-2">
                <span className={`text-sm font-semibold ${style.heading}`}>
                  {message.authorLabel}
                </span>
                {message.role === "agent" ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.tag}`}
                  >
                    {t.learning.exportAgentTag}
                  </span>
                ) : null}
                <span className={`text-xs ${style.metaLabel}`}>{message.timeLabel}</span>
              </p>
              <p className={`mt-1 whitespace-pre-wrap text-sm leading-6 ${style.heading}`}>
                {message.content}
              </p>
            </section>
          ))
        )}
      </div>
    </article>
  );
}

function DocumentMeta({
  label,
  value,
  style,
}: {
  label: string;
  value: string;
  style: (typeof tones)[ChatroomTranscriptDocumentTone];
}) {
  return (
    <div className="min-w-0">
      <dt className={`text-xs font-semibold ${style.metaLabel}`}>{label}</dt>
      <dd className={`mt-0.5 break-words text-sm ${style.heading}`}>{value}</dd>
    </div>
  );
}
