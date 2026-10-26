"use client";

import { useState } from "react";
import { copy, type Locale } from "@/i18n/copy";
import type { ChatMessage } from "@/data/uais";
import { fetchChatroomHistory } from "./use-learning-chatroom-transport";

export function ChatroomArchivePanel({
  courseId,
  classId,
  groupId,
  locale,
}: {
  courseId: string;
  classId?: string;
  groupId?: string;
  locale: Locale;
}) {
  const t = copy[locale].learning;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const button =
    "rounded-full border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-50";
  async function load(before?: string) {
    if (busy) return;
    setOpen(true);
    setBusy(true);
    setError(false);
    const result = await fetchChatroomHistory({
      courseId,
      classId,
      groupId,
      locale,
      otherMemberFallbackName: t.groupMemberUnknown,
      archive: true,
      before,
    });
    if (result.status === "loaded" && !result.transcriptUnavailable) {
      setMessages(result.messages);
      setNextCursor(result.archiveNextCursor);
    } else {
      setError(true);
    }
    setBusy(false);
  }
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <button
        type="button"
        className={button}
        aria-expanded={open}
        disabled={busy}
        onClick={() => (open ? setOpen(false) : void load())}
      >
        {open ? t.chatArchiveClose : t.chatArchiveOpen}
      </button>
      {open ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-5 text-[var(--muted)]">
            {t.chatArchiveBoundary}
          </p>
          {busy ? (
            <p role="status" className="text-sm">
              {t.chatArchiveLoading}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {t.chatHistoryUnavailable}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={busy || !nextCursor}
              onClick={() => void load(nextCursor)}
            >
              {t.chatArchiveEarlier}
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => void load()}
            >
              {t.chatArchiveLatest}
            </button>
          </div>
          <ol
            className="max-h-80 space-y-3 overflow-y-auto"
            aria-label={t.chatArchiveOpen}
          >
            {messages.map((message) => (
              <li
                key={message.id}
                className="rounded-lg border border-[var(--border)] p-3 text-sm"
              >
                <p className="text-xs text-[var(--muted)]">
                  {message.author[locale]} · {message.time}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {message.text[locale]}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
