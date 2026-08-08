"use client";

// Human-AI group chatroom for the learner workspace (S04, Phase 3 Step 2).
//
// Presentation only: every piece of behaviour lives in `use-learning-chatroom.ts`.
// The room is a full-bleed three-zone workspace — group roster on the left, the
// identity-rich thread in the middle, the agent dock on the right — escaping the
// `max-w-7xl` app-shell container with the tokenized version of the
// `learning-page.tsx` recipe so both themes stay correct.
//
// Identity rules the design depends on: humans render as circular
// initial-avatars, agents as rounded squares; "is this mine?" comes from the
// server-computed `isSelf` in a group room and from the room being private in a
// legacy room; other members get a deterministic hue from the small map below
// (`AiAgent` has no colour field, and `src/app/globals.css` is not this
// session's to extend).

import Link from "next/link";
import { useEffect, useRef, type FormEvent } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ChatsCircle } from "@phosphor-icons/react/dist/ssr/ChatsCircle";
import { Eye } from "@phosphor-icons/react/dist/ssr/Eye";
import { FilePdf } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { GraduationCap } from "@phosphor-icons/react/dist/ssr/GraduationCap";
import { LinkSimple } from "@phosphor-icons/react/dist/ssr/LinkSimple";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { localizedText } from "@/components/ui/localized-text";
import { aiAgents, type ChatMessage } from "@/data/uais";
import type { Locale } from "@/i18n/copy";
import {
  chatroomMessageMaxLength,
  getLocalizedAgentHandle,
  tokenizeChatMessageText,
  tokenizeMentionText,
  useLearningChatroom,
  type ChatroomAgentStatus,
  type ChatroomRoomMember,
  type LearningChatroomController,
} from "./use-learning-chatroom";

export function LearningChatroomPage() {
  return <HumanAiChatroom />;
}

// Retained as a named export because `learning-page.tsx` re-exports it; the old
// `variant="embedded"` shape is gone (it had no caller) and this is now the one
// full-page chatroom component.
type HumanAiChatroomProps = {
  summary?: string;
};

// Agent hues per the approved design: research violet, methods teal, math amber,
// writing rose. Component-level because the roster type carries no colour.
const agentToneById: Record<string, string> = {
  "research-assistant":
    "border-violet-400/50 bg-violet-500/10 text-violet-700 dark:border-violet-300/40 dark:text-violet-200",
  "methods-consultant":
    "border-teal-400/50 bg-teal-500/10 text-teal-700 dark:border-teal-300/40 dark:text-teal-200",
  "math-tutor":
    "border-amber-400/50 bg-amber-500/10 text-amber-700 dark:border-amber-300/40 dark:text-amber-200",
  "writing-helper":
    "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:border-rose-300/40 dark:text-rose-200",
};

const fallbackAgentTone =
  "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]";

// Deterministic per-member hue: the same classmate keeps the same colour across
// reloads and across every member's screen, without any stored preference.
const memberTones = [
  "border-sky-400/50 bg-sky-500/10 text-sky-700 dark:border-sky-300/40 dark:text-sky-200",
  "border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:border-emerald-300/40 dark:text-emerald-200",
  "border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-700 dark:border-fuchsia-300/40 dark:text-fuchsia-200",
  "border-orange-400/50 bg-orange-500/10 text-orange-700 dark:border-orange-300/40 dark:text-orange-200",
  "border-indigo-400/50 bg-indigo-500/10 text-indigo-700 dark:border-indigo-300/40 dark:text-indigo-200",
  "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:border-cyan-300/40 dark:text-cyan-200",
];

function memberTone(displayName: string) {
  let hash = 0;
  for (let index = 0; index < displayName.length; index += 1) {
    hash = (hash * 31 + displayName.charCodeAt(index)) % 100000;
  }
  return memberTones[hash % memberTones.length];
}

function initialOf(displayName: string) {
  // Grapheme-aware enough for the names this product renders: one CJK character
  // or one Latin letter.
  return [...displayName.trim()][0] ?? "?";
}

const panelClassName =
  "rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_10px_28px_var(--shadow)]";

export function HumanAiChatroom({ summary }: HumanAiChatroomProps) {
  const room = useLearningChatroom();
  const { locale, t } = room;
  // Scrolling is presentation, so the element ref stays in the view: keeping it
  // out of the controller is also what lets the controller be passed whole into
  // the zone components below.
  const threadRef = useRef<HTMLDivElement>(null);
  const threadLength = room.displayMessages.length;
  const { agentsPending } = room;

  // Keep the newest message (or the "agents thinking" bubble) in view on mount,
  // after every send, and when a poll delivers another member's message.
  useEffect(() => {
    const list = threadRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [threadLength, agentsPending]);

  return (
    <div className="relative left-1/2 -my-6 w-screen -translate-x-1/2 bg-[var(--background)] px-3 py-4 text-[var(--foreground)] sm:px-4 lg:px-5">
      <RoomHeader room={room} summary={summary} />

      {room.resolution.status === "select" ? (
        <CoursePicker room={room} options={room.resolution.options} />
      ) : null}
      {room.needsGroupChoice ? <GroupPicker room={room} /> : null}

      <div className="mt-3 grid items-start gap-3 xl:grid-cols-[244px_minmax(0,1fr)_284px]">
        <RosterPanel room={room} />

        <section
          data-uais-chatroom-zone="thread"
          className={`flex h-[calc(100dvh-19rem)] min-h-[420px] flex-col overflow-hidden ${panelClassName}`}
        >
          <div
            ref={threadRef}
            role="log"
            aria-live="polite"
            aria-label={t.learning.chatTitle}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--surface-elevated)] p-4"
          >
            {room.roomAccessNotice ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
                {room.roomAccessNotice}
              </p>
            ) : null}
            {room.displayMessages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
                {t.learning.emptyChat}
              </div>
            ) : (
              room.displayMessages.map((message) => (
                <MessageRow key={message.id} message={message} locale={locale} />
              ))
            )}
            {room.agentsPending ? (
              <div className="flex justify-start">
                <article className="flex min-w-0 max-w-[78%] items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3">
                  <Robot
                    size={16}
                    weight="duotone"
                    className="text-[var(--accent)]"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold text-[var(--accent)]">
                    {t.learning.agentThinking}
                  </span>
                  <span className="flex items-center gap-1" aria-hidden="true">
                    <span className="size-1.5 animate-pulse rounded-full bg-[var(--accent)] motion-reduce:animate-none" />
                    <span className="size-1.5 animate-pulse rounded-full bg-[var(--accent)] [animation-delay:160ms] motion-reduce:animate-none" />
                    <span className="size-1.5 animate-pulse rounded-full bg-[var(--accent)] [animation-delay:320ms] motion-reduce:animate-none" />
                  </span>
                </article>
              </div>
            ) : null}
          </div>

          {room.isObserver ? (
            <div className="border-t border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="flex items-center gap-2 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-sm font-medium text-[var(--muted)]">
                <Eye
                  size={17}
                  weight="duotone"
                  className="shrink-0 text-[var(--accent)]"
                  aria-hidden="true"
                />
                {t.learning.groupObserverNotice}
              </p>
            </div>
          ) : (
            <Composer room={room} />
          )}
        </section>

        <AgentDock room={room} />
      </div>
    </div>
  );
}

function RoomHeader({
  room,
  summary,
}: {
  room: LearningChatroomController;
  summary?: string;
}) {
  const { t } = room;
  const courseChipClassName =
    "inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-medium text-[var(--muted)]";
  const courseChipContent = (
    <>
      <GraduationCap
        size={14}
        weight="duotone"
        className="text-[var(--accent)]"
        aria-hidden="true"
      />
      {room.activeCourseLabel}
    </>
  );

  return (
    <header
      data-uais-chatroom-zone="room-header"
      className={`flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between ${panelClassName}`}
    >
      <div className="min-w-0">
        <Link
          href="/learning"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-xs font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <ArrowLeft size={15} weight="bold" aria-hidden="true" />
          {t.learning.backToLearning}
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <ChatsCircle size={20} weight="duotone" aria-hidden="true" />
          </span>
          <h1 className="truncate text-lg font-semibold text-[var(--foreground)]">
            {room.roomTitle}
          </h1>
          {room.isObserver ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent)]">
              <Eye size={13} weight="duotone" aria-hidden="true" />
              {t.learning.groupObserver}
            </span>
          ) : null}
          {room.roomMembers.length > 0 ? (
            <MemberFacepile members={room.roomMembers} groupYou={t.learning.groupYou} />
          ) : null}
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          {summary ?? t.learning.fullChatSummary}
        </p>
        {room.activeCourseLabel ? (
          <p className="mt-2">
            {room.courseSwitchAvailable ? (
              <button
                type="button"
                onClick={room.openCoursePicker}
                className={`${courseChipClassName} outline-none transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]`}
              >
                {courseChipContent}
              </button>
            ) : (
              <span className={courseChipClassName}>{courseChipContent}</span>
            )}
          </p>
        ) : null}
        {room.fallbackNotice ? (
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            {room.fallbackNotice}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-start gap-1.5 lg:items-end">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={room.handleExport}
            title={t.learning.exportPrintHint}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <FilePdf size={17} weight="duotone" aria-hidden="true" />
            {t.learning.exportPdf}
          </button>
          <button
            type="button"
            onClick={() => {
              void room.handleShare();
            }}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
          >
            <LinkSimple size={17} weight="bold" aria-hidden="true" />
            {t.learning.shareLink}
          </button>
        </div>
        <p className="text-xs leading-5 text-[var(--muted)]">
          {t.learning.exportPrintHint}
        </p>
        {room.notice ? (
          <p
            className="text-xs font-medium text-[var(--accent)] lg:text-right"
            aria-live="polite"
          >
            {room.notice}
          </p>
        ) : null}
      </div>
    </header>
  );
}

function MemberFacepile({
  members,
  groupYou,
}: {
  members: ChatroomRoomMember[];
  groupYou: string;
}) {
  const shown = members.slice(0, 5);
  return (
    <span className="flex items-center -space-x-1.5" aria-hidden="true">
      {shown.map((member, index) => (
        <span
          // The roster carries display names only by privacy design, so two
          // members can share a name; the array index keeps the key unique
          // (the roster is an order-stable server snapshot).
          key={`${member.displayName}-${member.isSelf}-${index}`}
          title={member.isSelf ? `${member.displayName} (${groupYou})` : member.displayName}
          className={[
            "flex size-7 items-center justify-center rounded-full border text-[11px] font-semibold",
            member.isSelf
              ? "border-[var(--accent)] bg-[var(--accent)] text-white"
              : memberTone(member.displayName),
          ].join(" ")}
        >
          {initialOf(member.displayName)}
        </span>
      ))}
      {members.length > shown.length ? (
        <span className="flex size-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[11px] font-semibold text-[var(--muted)]">
          {`+${members.length - shown.length}`}
        </span>
      ) : null}
    </span>
  );
}

function CoursePicker({
  room,
  options,
}: {
  room: LearningChatroomController;
  options: LearningChatroomController["courseOptions"];
}) {
  const { t } = room;
  return (
    <section className={`mt-3 p-4 ${panelClassName}`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
        <GraduationCap
          size={17}
          weight="duotone"
          className="text-[var(--accent)]"
          aria-hidden="true"
        />
        {t.learning.chatroomCoursePickerLabel}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((option) => (
          <button
            key={`${option.courseId}::${option.classId ?? ""}`}
            type="button"
            onClick={() => room.selectCourse(option)}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-left outline-none transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <span className="block text-sm font-semibold text-[var(--foreground)]">
              {option.courseName}
            </span>
            {option.className || option.semester ? (
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                {[option.className, option.semester].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function GroupPicker({ room }: { room: LearningChatroomController }) {
  const { t } = room;
  return (
    <section className={`mt-3 p-4 ${panelClassName}`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
        <UsersThree
          size={17}
          weight="duotone"
          className="text-[var(--accent)]"
          aria-hidden="true"
        />
        {t.learning.groupPickerLabel}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {room.groupOptions.map((group) => (
          <button
            key={group.groupId}
            type="button"
            onClick={() => room.selectGroup(group.groupId)}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-left outline-none transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <span className="block text-sm font-semibold text-[var(--foreground)]">
              {group.groupName}
            </span>
            <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
              {group.members.map((member) => member.displayName).join(" · ")}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RosterPanel({ room }: { room: LearningChatroomController }) {
  const { t, locale } = room;
  return (
    <section
      data-uais-chatroom-zone="roster"
      aria-label={t.learning.groupMembers}
      className={`p-4 ${panelClassName}`}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
        <UsersThree
          size={16}
          weight="duotone"
          className="text-[var(--accent)]"
          aria-hidden="true"
        />
        {t.learning.groupMembers}
        <span className="ml-auto rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
          {room.roomMembers.length}
        </span>
      </h2>

      {room.showNoGroupNotice ? (
        <p className="mt-3 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-xs leading-5 text-[var(--muted)]">
          {t.learning.groupNoGroup}
        </p>
      ) : null}

      <ul className="mt-3 grid gap-1.5">
        {room.roomMembers.map((member, index) => (
          <li
            // Display-name-only rosters can repeat a name; the index disambiguates
            // the key (order-stable server snapshot).
            key={`${member.displayName}-${member.isSelf}-${index}`}
            className={[
              "flex items-center gap-2 rounded-xl border px-2.5 py-2",
              member.isSelf
                ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                : "border-transparent bg-[var(--surface-elevated)]",
            ].join(" ")}
          >
            <span
              aria-hidden="true"
              className={[
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                member.isSelf
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : memberTone(member.displayName),
              ].join(" ")}
            >
              {initialOf(member.displayName)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--foreground)]">
              {member.displayName}
            </span>
            {member.isSelf ? (
              <span className="shrink-0 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {t.learning.groupYou}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <h3 className="mt-4 flex items-center gap-2 border-t border-[var(--border)] pt-3 text-sm font-semibold text-[var(--foreground)]">
        <Robot
          size={16}
          weight="duotone"
          className="text-[var(--accent)]"
          aria-hidden="true"
        />
        {t.learning.groupAgents}
      </h3>
      <ul className="mt-2 grid gap-1.5">
        {aiAgents.map((agent) => (
          <li
            key={agent.id}
            className="flex items-center gap-2 rounded-xl bg-[var(--surface-elevated)] px-2.5 py-2"
          >
            <span
              aria-hidden="true"
              className={[
                "flex size-7 shrink-0 items-center justify-center rounded-lg border",
                agentToneById[agent.id] ?? fallbackAgentTone,
              ].join(" ")}
            >
              <Robot size={14} weight="duotone" />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--foreground)]">
              {getLocalizedAgentHandle(agent.id, agent.handle, locale)}
            </span>
            <AgentStatusChip status={room.agentStatusById[agent.id]} room={room} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AgentStatusChip({
  status,
  room,
}: {
  status: ChatroomAgentStatus | undefined;
  room: LearningChatroomController;
}) {
  const { t } = room;
  const label =
    status === "thinking"
      ? t.learning.groupAgentStatusThinking
      : status === "replied"
        ? t.learning.groupAgentStatusReplied
        : t.learning.groupAgentStatusIdle;
  return (
    <span
      className={[
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        status === "thinking"
          ? "bg-[var(--accent)] text-white"
          : status === "replied"
            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
            : "bg-[var(--surface-soft)] text-[var(--muted)]",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function AgentDock({ room }: { room: LearningChatroomController }) {
  const { t, locale } = room;
  return (
    <section
      data-uais-chatroom-zone="agent-dock"
      aria-label={t.learning.groupAgents}
      className={`p-4 ${panelClassName}`}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
        <Robot
          size={16}
          weight="duotone"
          className="text-[var(--accent)]"
          aria-hidden="true"
        />
        {t.learning.groupAgents}
      </h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {aiAgents.map((agent) => {
          const handle = getLocalizedAgentHandle(agent.id, agent.handle, locale);
          return (
            <button
              key={agent.id}
              type="button"
              disabled={room.isObserver}
              onClick={() => room.mentionAgent(handle)}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-left outline-none transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-[var(--border)] disabled:hover:bg-[var(--surface-elevated)]"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={[
                    "flex size-7 shrink-0 items-center justify-center rounded-lg border",
                    agentToneById[agent.id] ?? fallbackAgentTone,
                  ].join(" ")}
                >
                  <Robot size={14} weight="duotone" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground)]">
                  {handle}
                </span>
                <AgentStatusChip status={room.agentStatusById[agent.id]} room={room} />
              </span>
              <span className="mt-1.5 block text-xs leading-5 text-[var(--muted)]">
                {localizedText(agent.specialty, locale)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Composer({ room }: { room: LearningChatroomController }) {
  const { t, locale } = room;
  // Who this draft will ping, shown as chips under the label so the composer
  // reads the same way the sent bubble will.
  const draftMentions = tokenizeMentionText(room.draft, locale).filter(
    (token) => token.type === "mention",
  );

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => room.handleSend(event)}
      className="border-t border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <label
          htmlFor="group-message"
          className="text-sm font-semibold text-[var(--foreground)]"
        >
          {t.learning.inputLabel}
        </label>
        <span className="ml-auto text-xs font-medium tabular-nums text-[var(--muted)]">
          {`${room.draft.length}/${chatroomMessageMaxLength}`}
        </span>
      </div>
      {draftMentions.length > 0 ? (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {draftMentions.map((token) => (
            <span
              key={token.type === "mention" ? token.agentId : token.value}
              className={[
                "rounded-full border px-2 py-0.5 text-xs font-semibold",
                token.type === "mention"
                  ? (agentToneById[token.agentId] ?? fallbackAgentTone)
                  : fallbackAgentTone,
              ].join(" ")}
            >
              {token.value}
            </span>
          ))}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="group-message"
          value={room.draft}
          onChange={(event) => room.setDraft(event.target.value)}
          placeholder={t.learning.inputPlaceholder}
          maxLength={chatroomMessageMaxLength}
          disabled={room.composerDisabled}
          className="min-h-11 flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={room.agentsPending || room.composerDisabled}
          aria-busy={room.agentsPending}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--accent)]"
        >
          <PaperPlaneTilt size={17} weight="bold" aria-hidden="true" />
          {t.learning.send}
        </button>
      </div>
      {room.error ? (
        <p className="mt-2 text-sm font-medium text-[var(--danger)]">{room.error}</p>
      ) : null}
    </form>
  );
}

function MessageRow({ message, locale }: { message: ChatMessage; locale: Locale }) {
  const isSelf = message.self === true;
  const isAgent = message.kind === "agent";
  const authorName = localizedText(message.author, locale);
  const agentId = isAgent
    ? aiAgents.find((candidate) => candidate.handle === message.agentHandle)?.id
    : undefined;
  const tone = isAgent
    ? (agentId ? agentToneById[agentId] : undefined) ?? fallbackAgentTone
    : memberTone(authorName);

  return (
    <div className={["flex gap-2", isSelf ? "justify-end" : "justify-start"].join(" ")}>
      {isSelf ? null : (
        <span
          aria-hidden="true"
          className={[
            "mt-0.5 flex size-8 shrink-0 items-center justify-center border text-xs font-semibold",
            // Humans are circles, agents are rounded squares: the shape carries
            // the human/AI distinction even before the name is read.
            isAgent ? "rounded-lg" : "rounded-full",
            tone,
          ].join(" ")}
        >
          {isAgent ? <Robot size={15} weight="duotone" /> : initialOf(authorName)}
        </span>
      )}
      <article
        className={[
          "min-w-0 max-w-[78%] rounded-2xl px-4 py-3",
          isSelf
            ? "rounded-br-md bg-[var(--accent)] text-white"
            : isAgent
              ? "rounded-bl-md border border-[var(--accent-border)] bg-[var(--accent-soft)]"
              : "rounded-bl-md border border-[var(--border)] bg-[var(--surface)]",
        ].join(" ")}
      >
        {isSelf ? null : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className={[
                "text-sm font-semibold",
                isAgent ? "text-[var(--accent)]" : "text-[var(--foreground)]",
              ].join(" ")}
            >
              {authorName}
            </p>
            <span className="text-xs font-medium text-[var(--muted)]">
              {message.time}
            </span>
          </div>
        )}
        <p
          className={[
            "text-sm leading-6 break-words",
            isSelf ? "text-white" : "mt-2 text-[var(--muted)]",
          ].join(" ")}
        >
          {/* Plain runs stay raw strings so they remain direct text children of
              this paragraph: a message with no mention still matches a whole-text
              query exactly as it did before chips existed. */}
          {tokenizeChatMessageText(message, locale).map((token, index) =>
            token.type === "mention" ? (
              <span
                key={`${token.agentId}-${index}`}
                data-uais-chatroom-mention={token.agentId}
                className={[
                  "mx-0.5 inline-flex items-baseline rounded-full border px-1.5 py-0.5 text-xs font-semibold",
                  isSelf
                    ? "border-white/40 bg-white/15 text-white"
                    : (agentToneById[token.agentId] ?? fallbackAgentTone),
                ].join(" ")}
              >
                {token.value}
              </span>
            ) : (
              token.value
            ),
          )}
        </p>
        {isSelf ? (
          <span className="mt-1 block text-right text-xs font-medium text-white/70">
            {message.time}
          </span>
        ) : null}
      </article>
    </div>
  );
}
