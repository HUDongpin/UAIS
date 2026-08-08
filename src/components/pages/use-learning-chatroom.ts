"use client";

// Headless controller for the human-AI group chatroom (S04, Phase 3 Step 1).
//
// Everything that is not JSX lives here: room resolution (course -> group),
// prior-transcript restore, visibility-aware polling with 429 back-off,
// room-switch tokens, the agent round, mention/handle maps, the message
// tokenizer the bubbles render as chips, and the collaboration.contributed
// learning-record emission. `learning-page-chatroom.tsx` consumes this hook and
// owns presentation only.
//
// Backend contract this builds on (Phase 2, do not change):
// - GET /api/learning/chatroom?courseId=&classId=&groupId= replays one room. For
//   group rooms it adds `groupId`, `groupName`, `members[{displayName,isSelf}]`
//   and stamps every message with `authorName?` and a SERVER-computed `isSelf`.
//   Legacy (no groupId) responses carry neither, and every stored student row in
//   such a room belongs to the caller.
// - GET is rate limited (30/min per actor). A 429 must never blank the thread.
// - POST accepts an optional `groupId`; its response shape is unchanged.
// - Group discovery rides GET /api/teaching/courses (`learningGroups`).

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { useSessionUser } from "@/components/providers/session-user";
import { localizedText } from "@/components/ui/localized-text";
import { aiAgents, chatMessages, type ChatMessage } from "@/data/uais";
import { copy, type Locale } from "@/i18n/copy";
import {
  createLearningChatroomExportUrl,
  requestLearningChatroomShareLink,
} from "@/lib/chat-actions";
import {
  createUniqueLearningEventKey,
  reportLearningEvent,
} from "@/lib/learning-records/client-event-reporter";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import { publishedLearningPptCourseId } from "./learning-page-content";

// Legacy cohort id, still the last-resort learning-record cohort for a room with
// neither a group nor a class. Phase 5 removed its other use: export and share
// now address the real room, so this no longer stands in for a share-link slug.
const chatroomGroupId = "research-method-group";

// Mirrors the server-side per-message limit: a longer last student message
// would be rejected by POST /api/learning/chatroom with 400.
export const chatroomMessageMaxLength = 4000;

// D6: 5s while the room is visible. The tab-hidden pause and the 429 back-off
// below are what keep a group of members inside the 30/min GET budget.
export const chatroomPollIntervalMs = 5000;

// The static demo transcript from src/data/uais.ts, keyed by its actual ids.
// Seeds are demo-only display fixtures: they render in demo-course context but
// are never part of the live POST /api/learning/chatroom history.
const seedMessageIds = new Set(chatMessages.map((message) => message.id));

export type ChatroomRoomMember = {
  displayName: string;
  isSelf: boolean;
};

// One usable chatroom course, joined from the student membership/course/class
// projections or taken from a teacher-owned course record.
export type ChatroomCourseOption = {
  courseId: string;
  classId?: string;
  courseName: string;
  className?: string;
  semester?: string;
};

// One assigned group the caller may enter, normalized from the student
// (`{displayName,isSelf}`) or teacher (`{studentId,studentDisplayName}`)
// projection of GET /api/teaching/courses.
export type ChatroomGroupOption = {
  groupId: string;
  courseId: string;
  classId?: string;
  groupName: string;
  members: ChatroomRoomMember[];
};

export type ActiveChatroomCourse = {
  courseId: string;
  classId?: string;
  courseName?: string;
  className?: string;
  semester?: string;
  isDemo: boolean;
  // Why the demo course is standing in for a real one: "no-courses" when the
  // signed-in fetch returned nothing usable, "load-failed" when the fetch
  // itself failed. Absent for a genuine demo context (signed out, demo hint).
  fallbackReason?: "no-courses" | "load-failed";
};

export type ChatroomCourseResolution =
  | { status: "pending" }
  | { status: "select"; options: ChatroomCourseOption[] }
  | { status: "ready"; course: ActiveChatroomCourse };

export type ChatroomAgentStatus = "idle" | "thinking" | "replied";

const demoFallbackCourse: ActiveChatroomCourse = {
  courseId: publishedLearningPptCourseId,
  isDemo: true,
};

export type LearningChatroomController = {
  locale: Locale;
  t: (typeof copy)[Locale];
  sessionUser: UaisAppSessionUser | null;

  resolution: ChatroomCourseResolution;
  activeCourse: ActiveChatroomCourse | null;
  activeCourseLabel: string | null;
  courseOptions: ChatroomCourseOption[];
  courseSwitchAvailable: boolean;
  openCoursePicker: () => void;
  selectCourse: (option: ChatroomCourseOption) => void;

  /** Groups the caller may enter inside the resolved course. */
  groupOptions: ChatroomGroupOption[];
  activeGroup: ChatroomGroupOption | null;
  /** More than one group in the resolved course and none picked yet. */
  needsGroupChoice: boolean;
  selectGroup: (groupId: string) => void;
  /** Groups exist for this caller, but not in the room they landed in. */
  showNoGroupNotice: boolean;

  /** Teacher reading a group room: read-only, no composer. */
  isObserver: boolean;
  roomTitle: string;
  roomMembers: ChatroomRoomMember[];
  agentStatusById: Record<string, ChatroomAgentStatus>;

  displayMessages: ChatMessage[];
  draft: string;
  setDraft: (value: string) => void;
  notice: string;
  error: string;
  roomAccessNotice: string | null;
  fallbackNotice: string | null;
  agentsPending: boolean;
  composerDisabled: boolean;

  mentionAgent: (handle: string) => void;
  handleSend: (event: FormEvent<HTMLFormElement>) => void;
  handleExport: () => void;
  handleShare: () => Promise<void>;
};

export function useLearningChatroom(): LearningChatroomController {
  const { locale } = useAppPreferences();
  const sessionUser = useSessionUser();
  const learnerAccount =
    sessionUser?.role === "student" ? sessionUser.account : undefined;
  const t = copy[locale];

  // The room's own transcript: restored history plus this session's messages.
  // The demo seed transcript is concatenated at render time instead, so it can
  // never leak into the request history or into storage.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [agentsPending, setAgentsPending] = useState(false);
  const [pendingAgentIds, setPendingAgentIds] = useState<string[]>([]);
  // Course resolution produced by the signed-in fetch (or the picker); the
  // signed-out value is derived below without touching this state.
  const [fetchedResolution, setFetchedResolution] =
    useState<ChatroomCourseResolution>({ status: "pending" });
  // Kept past the initial resolution so a learner in several courses can reopen
  // the picker from the active-course chip and switch rooms.
  const [courseOptions, setCourseOptions] = useState<ChatroomCourseOption[]>([]);
  const [groups, setGroups] = useState<ChatroomGroupOption[]>([]);
  // Explicit group choice (deep link or picker), scoped to the course key it was
  // made in so a course switch cannot carry it into another course's room.
  const [groupSelection, setGroupSelection] = useState<
    { courseKey: string; groupId: string } | null
  >(null);
  // A deep link named a group this caller cannot see; drives the "no group yet"
  // notice even when the resolved course has no groups at all.
  const [deepLinkGroupMissing, setDeepLinkGroupMissing] = useState(false);
  // The deployment answered `feature-not-enabled`: fall back to the legacy
  // per-student room silently, exactly as if no group existed.
  const [groupsDisabled, setGroupsDisabled] = useState(false);
  // Roster echoed by GET for the active room; authoritative over the discovery
  // projection because it is computed against the room the server actually
  // opened.
  const [serverRoom, setServerRoom] = useState<
    { groupId: string; groupName?: string; members: ChatroomRoomMember[] } | null
  >(null);
  const [roomAccessNotice, setRoomAccessNotice] = useState<string | null>(null);
  // Room key whose polling loop is stopped because the server denied the read;
  // re-polling a denial would only burn the shared GET budget.
  const [haltedRoomKey, setHaltedRoomKey] = useState<string | null>(null);
  const [documentVisible, setDocumentVisible] = useState(true);

  // A signed-out chatroom stays fully offline (sends fail fast below), so the
  // course fetch is skipped and resolution settles on the demo course.
  const resolution: ChatroomCourseResolution = sessionUser
    ? fetchedResolution
    : { status: "ready", course: demoFallbackCourse };

  useEffect(() => {
    if (!sessionUser) {
      return;
    }

    let cancelled = false;
    // Parsed from window.location inside the mount effect (not useSearchParams)
    // so this client component adds no Suspense/CSR-bailout build constraint.
    const params = new URLSearchParams(window.location.search);
    const urlCourseId = params.get("courseId");
    const urlClassId = params.get("classId");
    const urlGroupId = params.get("groupId");

    void (async () => {
      const result = await fetchUsableChatroomCourses(sessionUser.role);
      if (cancelled) {
        return;
      }

      const options = result.ok ? result.options : [];
      const fetchedGroups = result.ok ? result.groups : [];
      setCourseOptions(options);
      setGroups(fetchedGroups);

      // A `?groupId=` deep link is the strongest hint there is: the group record
      // carries its own courseId/classId, so the room resolves without the link
      // having to repeat them.
      const deepLinkGroup = urlGroupId
        ? fetchedGroups.find((group) => group.groupId === urlGroupId)
        : undefined;
      if (deepLinkGroup) {
        const course = options.find(
          (option) => option.courseId === deepLinkGroup.courseId,
        );
        const resolvedCourse: ActiveChatroomCourse = {
          courseId: deepLinkGroup.courseId,
          ...(deepLinkGroup.classId ?? course?.classId
            ? { classId: deepLinkGroup.classId ?? course?.classId }
            : {}),
          ...(course?.courseName ? { courseName: course.courseName } : {}),
          ...(course?.className ? { className: course.className } : {}),
          ...(course?.semester ? { semester: course.semester } : {}),
          isDemo: false,
        };
        setGroupSelection({
          courseKey: createCourseKey(resolvedCourse),
          groupId: deepLinkGroup.groupId,
        });
        setFetchedResolution({ status: "ready", course: resolvedCourse });
        return;
      }

      setDeepLinkGroupMissing(Boolean(urlGroupId));
      setFetchedResolution(
        resolveChatroomCourse(result, { urlCourseId, urlClassId }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionUser]);

  // No send may run against a pre-resolution course: until the fetch settles
  // (or the picker resolves), the room has no active course at all.
  const activeCourse: ActiveChatroomCourse | null =
    resolution.status === "ready" ? resolution.course : null;
  const activeCourseKey = activeCourse ? createCourseKey(activeCourse) : null;

  // Groups usable inside the resolved course. A group without a classId is
  // course-wide; one with a classId only matches the caller's own class.
  const groupOptions = useMemo(() => {
    if (!activeCourse || groupsDisabled) {
      return [];
    }
    return groups.filter(
      (group) =>
        group.courseId === activeCourse.courseId &&
        (!group.classId ||
          !activeCourse.classId ||
          group.classId === activeCourse.classId),
    );
  }, [activeCourse, groups, groupsDisabled]);

  const selectedGroup =
    groupSelection && groupSelection.courseKey === activeCourseKey
      ? groupOptions.find((group) => group.groupId === groupSelection.groupId)
      : undefined;

  // Students auto-enter their only group; a teacher enters a group room only
  // through an explicit `?groupId=` deep link (Phase 4 generates those), so
  // opening the chatroom never silently drops a teacher into observation.
  const autoGroup =
    !groupSelection && sessionUser?.role === "student" && groupOptions.length === 1
      ? groupOptions[0]
      : undefined;
  const activeGroup = selectedGroup ?? autoGroup ?? null;
  const needsGroupChoice =
    !activeGroup && sessionUser?.role === "student" && groupOptions.length > 1;

  // Groups are live for this caller (they hold at least one) but not in the room
  // they landed in — or a deep link named a group they cannot see. With no group
  // anywhere the feature is simply not in play, so the room stays quiet.
  const showNoGroupNotice =
    !groupsDisabled &&
    !activeGroup &&
    !needsGroupChoice &&
    (deepLinkGroupMissing || (groups.length > 0 && groupOptions.length === 0));

  const isObserver = Boolean(activeGroup) && sessionUser?.role === "teacher";

  const fallbackReason = activeCourse?.fallbackReason;
  // The demo fallback is a read-only preview for a learner: without an approved
  // membership the route can only answer 403. A teacher keeps a live composer
  // because the route's demo carve-out authorizes demo teacher accounts.
  // On "load-failed" the demo course is standing in for a course the teacher may
  // not own, so the composer closes for every role.
  const demoPreviewOnly =
    fallbackReason !== undefined &&
    !(fallbackReason === "no-courses" && sessionUser?.role === "teacher");
  // A room the server has refused to read (membership revoked, group deleted,
  // agent access denied) must not accept a send either: polling has already
  // halted and `roomAccessNotice` is on screen, so gate the composer on it too
  // rather than let an optimistic message pile up in a room that only answers
  // 403. It clears on the next successful read or a room change.
  const composerDisabled =
    resolution.status !== "ready" ||
    demoPreviewOnly ||
    isObserver ||
    needsGroupChoice ||
    roomAccessNotice !== null;
  const fallbackNotice =
    fallbackReason === "load-failed"
      ? t.learning.chatroomCourseLoadFailed
      : fallbackReason === "no-courses"
        ? t.learning.chatroomJoinCoursePrompt
        : null;

  // Contract: the mock seed transcript renders only in confirmed demo-course
  // context; a real course starts from the empty-chat placeholder.
  const showSeedTranscript = activeCourse?.isDemo === true;
  const displayMessages = useMemo(
    () => (showSeedTranscript ? [...chatMessages, ...messages] : messages),
    [showSeedTranscript, messages],
  );

  const activeGroupId = activeGroup?.groupId;
  const roomKey = activeCourseKey ? `${activeCourseKey}::${activeGroupId ?? ""}` : null;
  const resolvedRoomKeyRef = useRef<string | null>(null);
  // How many times the resolved room has actually changed. Paired with the room
  // key it identifies the room a round was started in, so a reply is still
  // discarded when the learner switches away and back mid-round.
  const roomChangeCountRef = useRef(0);
  // Read at request start and again at every resolution point of an in-flight
  // round; a mismatch means the learner has left that room.
  const currentRoomToken = useCallback(
    () => `${roomChangeCountRef.current}::${resolvedRoomKeyRef.current ?? ""}`,
    [],
  );

  // A resolved room change (auto-select, picker choice, group switch, URL) opens
  // a different transcript: the live messages must not carry one room's history
  // into another room's request or learning record, and an in-flight round from
  // the previous room must not leave this one stuck "thinking". The draft is
  // preserved.
  useEffect(() => {
    if (!roomKey) {
      return;
    }

    const previousKey = resolvedRoomKeyRef.current;
    resolvedRoomKeyRef.current = roomKey;
    if (previousKey === null || previousKey === roomKey) {
      return;
    }

    roomChangeCountRef.current += 1;
    setMessages([]);
    setNotice("");
    setError("");
    setAgentsPending(false);
    setPendingAgentIds([]);
    setServerRoom(null);
    setRoomAccessNotice(null);
    setHaltedRoomKey(null);
  }, [roomKey]);

  // Polling is paused whenever the tab is hidden and resumes with an immediate
  // read, so a member coming back to the tab sees the room as it is now.
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const update = () => setDocumentVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const activeCourseId = activeCourse?.courseId;
  const activeClassId = activeCourse?.classId;

  // Restore the room's stored transcript once its room resolves, then keep it
  // fresh: other members' messages and agent replies only ever reach this client
  // through this read. The read-only demo preview is skipped, because that
  // reader has no membership and the endpoint could only answer 403.
  useEffect(() => {
    if (!sessionUser || !activeCourseId || !roomKey || demoPreviewOnly) {
      return;
    }
    if (needsGroupChoice || !documentVisible || haltedRoomKey === roomKey) {
      return;
    }

    let cancelled = false;
    const roomToken = currentRoomToken();
    // Wall-clock rather than a tick counter: a 429 must hold the room off the
    // endpoint for at least as long as the server asked, however the interval
    // happens to line up with it.
    let backoffUntilMs = 0;

    const readRoom = async () => {
      if (cancelled || Date.now() < backoffUntilMs) {
        return;
      }

      const result = await fetchChatroomHistory({
        courseId: activeCourseId,
        classId: activeClassId,
        groupId: activeGroupId,
        locale,
        otherMemberFallbackName: t.learning.groupMemberUnknown,
      });
      if (cancelled || currentRoomToken() !== roomToken) {
        return;
      }

      if (result.status === "throttled") {
        // Never blank the thread on a 429: the last good transcript stays on
        // screen and the room simply reads less often for a while.
        backoffUntilMs =
          Date.now() +
          Math.max(
            (result.retryAfterSeconds ?? 0) * 1000,
            chatroomPollIntervalMs * 2,
          );
        return;
      }
      if (result.status === "groups-disabled") {
        setGroupsDisabled(true);
        return;
      }
      if (result.status === "denied") {
        setHaltedRoomKey(roomKey);
        setRoomAccessNotice(
          result.reasonCode === "student-group-membership-required" ||
            result.reasonCode === "teacher-group-observer-required"
            ? t.learning.groupNoGroup
            : t.learning.agentAccessDenied,
        );
        return;
      }
      if (result.status !== "loaded") {
        // A failed or malformed read is not something the learner can act on and
        // must not cost them the transcript they can already see.
        return;
      }

      setRoomAccessNotice(null);
      if (result.groupId) {
        setServerRoom({
          groupId: result.groupId,
          ...(result.groupName ? { groupName: result.groupName } : {}),
          members: result.members ?? [],
        });
      }
      setMessages((current) => mergeRoomTranscript(current, result.messages));
    };

    void readRoom();
    const timer = setInterval(() => {
      void readRoom();
    }, chatroomPollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    sessionUser,
    activeCourseId,
    activeClassId,
    activeGroupId,
    roomKey,
    demoPreviewOnly,
    needsGroupChoice,
    documentVisible,
    haltedRoomKey,
    locale,
    currentRoomToken,
    t.learning.groupMemberUnknown,
    t.learning.groupNoGroup,
    t.learning.agentAccessDenied,
  ]);

  const activeCourseLabel =
    activeCourse === null
      ? null
      : activeCourse.isDemo
        ? t.learning.chatroomDemoCourseLabel
        : `${t.learning.chatroomActiveCourseLabel}${locale === "zh-CN" ? "：" : ": "}${[
            activeCourse.courseName ?? activeCourse.courseId,
            activeCourse.className,
            activeCourse.semester,
          ]
            .filter(Boolean)
            .join(" · ")}`;

  // The server roster wins when it is for the room actually open; otherwise the
  // discovery projection stands in until the first read lands. A legacy room has
  // exactly one member: the caller.
  const roomMembers = useMemo<ChatroomRoomMember[]>(() => {
    if (activeGroup) {
      if (serverRoom && serverRoom.groupId === activeGroup.groupId) {
        return serverRoom.members;
      }
      return activeGroup.members;
    }
    if (!sessionUser) {
      return [];
    }
    return [{ displayName: sessionUser.displayName, isSelf: true }];
  }, [activeGroup, serverRoom, sessionUser]);

  const roomTitle =
    (activeGroup
      ? serverRoom?.groupId === activeGroup.groupId
        ? serverRoom.groupName
        : undefined
      : undefined) ??
    activeGroup?.groupName ??
    t.learning.chatTitle;

  // Roster/dock status for the current round: an agent this round mentioned is
  // "thinking" until the round settles, and any agent with a turn in the room —
  // including one a poll just delivered from another member's round — is
  // "replied".
  const agentStatusById = useMemo(() => {
    const repliedIds = new Set(
      displayMessages.flatMap((message) => {
        if (message.kind !== "agent" || !message.agentHandle) {
          return [];
        }
        const agentId = agentIdByHandle[message.agentHandle];
        return agentId ? [agentId] : [];
      }),
    );
    const statuses: Record<string, ChatroomAgentStatus> = {};
    for (const agent of aiAgents) {
      statuses[agent.id] =
        agentsPending && pendingAgentIds.includes(agent.id)
          ? "thinking"
          : repliedIds.has(agent.id)
            ? "replied"
            : "idle";
    }
    return statuses;
  }, [displayMessages, agentsPending, pendingAgentIds]);

  const openCoursePicker = useCallback(() => {
    setFetchedResolution({ status: "select", options: courseOptions });
  }, [courseOptions]);

  const selectCourse = useCallback((option: ChatroomCourseOption) => {
    setGroupSelection(null);
    setDeepLinkGroupMissing(false);
    setFetchedResolution({ status: "ready", course: { ...option, isDemo: false } });
  }, []);

  const selectGroup = useCallback(
    (groupId: string) => {
      if (!activeCourseKey) {
        return;
      }
      setDeepLinkGroupMissing(false);
      setGroupSelection({ courseKey: activeCourseKey, groupId });
    },
    [activeCourseKey],
  );

  const mentionAgent = useCallback((handle: string) => {
    setDraft((current) => `${current.trimEnd()}${current.trim() ? " " : ""}${handle} `);
    setError("");
  }, []);

  async function requestAgentTurns(
    course: ActiveChatroomCourse,
    groupId: string | undefined,
    history: ChatMessage[],
  ) {
    // A round belongs to the room it was started in. The learner stays free to
    // leave a slow room (the chip/picker are never disabled while pending), so
    // a round that outlives its room is discarded whole: no turns appended, no
    // error/notice written, and no pending flag cleared in the new room — the
    // room-change effect already cleared it there.
    const roundRoomToken = currentRoomToken();
    const isCurrentRound = () => currentRoomToken() === roundRoomToken;

    setAgentsPending(true);

    try {
      const response = await fetch("/api/learning/chatroom", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locale,
          courseId: course.courseId,
          // Scopes the stored transcript: two classes of the same course are
          // two rooms.
          ...(course.classId ? { classId: course.classId } : {}),
          // Present only for a group room; the server derives the effective
          // classId from the group record either way.
          ...(groupId ? { groupId } : {}),
          // Seed fixtures are display-only and stay out of the live history in
          // every course context (the state never holds them; this is a guard).
          messages: history
            .filter((message) => !seedMessageIds.has(message.id))
            .map((message) => toChatroomRequestMessage(message, locale)),
        }),
      });

      if (!isCurrentRound()) {
        return;
      }

      if (!response.ok) {
        setError(resolveAgentErrorCopy(response.status, t));
        return;
      }

      // The server accepted the post: record the contribution now, once, keyed
      // by a unique suffix so every accepted send is its own record. Emitting
      // here (not optimistically in `handleSend`) means a refused send — 401,
      // 403, 400, or a network failure — records nothing the server rejected.
      if (learnerAccount) {
        // The group is the collaboration cohort when there is one; a legacy room
        // falls back to the class, then to the historic chatroom cohort id.
        const cohortId = groupId ?? course.classId ?? chatroomGroupId;
        void reportLearningEvent({
          actorId: learnerAccount,
          event: {
            type: "collaboration.contributed",
            object: {
              id: `${course.courseId}/chatrooms/${cohortId}`,
              name: "Human-AI group chatroom",
            },
            context: {
              courseId: course.courseId,
              classId: course.classId,
              cohortId,
              locale,
            },
          },
          // One learning record per accepted message, so the key must be unique.
          idempotencyKey: createUniqueLearningEventKey(
            learnerAccount,
            "collaboration.contributed",
            course.courseId,
            cohortId,
          ),
        });
      }

      const body = (await response.json()) as ChatroomApiResponse;
      if (!isCurrentRound()) {
        return;
      }

      const turns = Array.isArray(body.turns) ? body.turns : [];
      if (turns.length === 0) {
        // A `cue-user` round can legitimately end without a new agent turn.
        return;
      }

      const stamp = Date.now();
      setMessages((current) => {
        // The 5s poll can merge a server-minted turn (by its stored messageId)
        // before this POST resolves; appending it again would collide React
        // keys and double the reply. Mirror the id discipline in
        // `mergeRoomTranscript`: only append turns the room does not already
        // hold.
        const knownIds = new Set(current.map((message) => message.id));
        const appended = turns
          .map((turn, index) => toAgentChatMessage(turn, index, stamp, locale))
          .filter((message) => !knownIds.has(message.id));
        if (appended.length === 0) {
          return current;
        }
        return [...current, ...appended];
      });
    } catch {
      if (!isCurrentRound()) {
        return;
      }
      setError(t.learning.agentUnavailable);
    } finally {
      if (isCurrentRound()) {
        setAgentsPending(false);
      }
    }
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The input stays typable while agents answer; only re-submitting is blocked.
    if (agentsPending) {
      return;
    }
    // A course must resolve before the room accepts messages; the demo fallback
    // stays read-only for anyone the route would answer 403, and a teacher
    // observing a group room has no write path at all.
    if (!activeCourse || composerDisabled) {
      return;
    }

    const trimmedDraft = draft.trim();
    if (!trimmedDraft) {
      setError(t.learning.error);
      return;
    }

    if (trimmedDraft.length > chatroomMessageMaxLength) {
      // The endpoint rejects an over-limit last student message with 400, so
      // the draft is kept for editing instead of being appended and sent.
      setError(t.learning.agentMessageTooLong);
      return;
    }

    // Built eagerly (not inside the functional updater) so the live request can
    // send exactly the history the UI just rendered instead of stale state.
    const selfName = sessionUser?.displayName;
    const nextMessages: ChatMessage[] = [
      ...messages,
      {
        id: createLocalChatMessageId(),
        kind: "student",
        author:
          activeGroup && selfName
            ? { "zh-CN": selfName, "en-US": selfName }
            : { "zh-CN": "我", "en-US": "Me" },
        text: {
          "zh-CN": trimmedDraft,
          "en-US": trimmedDraft,
        },
        time: locale === "zh-CN" ? "刚刚" : "Now",
        self: true,
      },
    ];

    setMessages(nextMessages);
    setDraft("");
    setError("");
    setNotice("");
    setPendingAgentIds(readMentionedAgentIds(trimmedDraft));

    // The collaboration.contributed learning record is emitted from
    // `requestAgentTurns` only after the server accepts the post, so a send the
    // route refuses (401/403/400) never records a contribution the server did
    // not store.

    if (!sessionUser) {
      // The route would answer 401 anyway, so fail fast and keep the UX crisp.
      // The student message above is already rendered and is never rolled back.
      setError(t.learning.agentSignInRequired);
      return;
    }

    void requestAgentTurns(activeCourse, activeGroup?.groupId, nextMessages);
  }

  // Export opens the real print view for THIS room (Phase 5). It is a route, not
  // a download: the browser's print dialog is the PDF generator, so there is no
  // service, no credential and no server render to wait for.
  function handleExport() {
    // The print view enforces the same room access the chatroom does, so a
    // reader the route could only refuse is told here instead of being sent to a
    // page that refuses them. Every export/share outcome - success or not - is
    // written to `notice`, because that is the line the room header renders next
    // to these two buttons; `error` belongs to the composer, which an observing
    // teacher does not have.
    if (!sessionUser) {
      setNotice(t.learning.exportSignInRequired);
      return;
    }
    if (!activeCourse || demoPreviewOnly) {
      setNotice(t.learning.exportAccessDenied);
      return;
    }

    const url = createLearningChatroomExportUrl({
      courseId: activeCourse.courseId,
      ...(activeCourse.classId ? { classId: activeCourse.classId } : {}),
      ...(activeGroup ? { groupId: activeGroup.groupId } : {}),
    });
    // Fire-and-forget: `window.open(..., "noopener")` returns null even on a
    // successful open, so its return value cannot be used as a success signal.
    // The print view is a first-party route, so treat the open as done and
    // report success; a pop-up blocker is surfaced by the browser itself.
    window.open(url, "_blank", "noopener");
    setNotice(t.learning.exported);
    setError("");
  }

  // Share mints a real, revocable share record for this room and copies the
  // absolute link. The clipboard fallback is preserved: a browser that refuses
  // the write still shows the link, because the link already exists server-side
  // by then.
  async function handleShare() {
    if (!sessionUser) {
      setNotice(t.learning.shareSignInRequired);
      return;
    }
    if (!activeCourse || demoPreviewOnly) {
      setNotice(t.learning.exportAccessDenied);
      return;
    }

    const result = await requestLearningChatroomShareLink(
      {
        courseId: activeCourse.courseId,
        ...(activeCourse.classId ? { classId: activeCourse.classId } : {}),
        ...(activeGroup ? { groupId: activeGroup.groupId } : {}),
      },
      { origin: window.location.origin },
    );
    if (result.status === "failed") {
      setNotice(t.learning.shareFailed);
      return;
    }

    // An insecure context (or a browser without the Clipboard API) exposes no
    // `navigator.clipboard`: nothing is copied, so report the fallback and let
    // the learner copy the link the notice already shows, rather than claiming a
    // copy that never happened.
    if (!navigator.clipboard) {
      setNotice(`${t.learning.copiedFallback} ${result.url}`);
      setError("");
      return;
    }

    try {
      await navigator.clipboard.writeText(result.url);
      setNotice(`${t.learning.copied} ${result.url}`);
    } catch {
      setNotice(`${t.learning.copiedFallback} ${result.url}`);
    }
    setError("");
  }

  return {
    locale,
    t,
    sessionUser,
    resolution,
    activeCourse,
    activeCourseLabel,
    courseOptions,
    courseSwitchAvailable: courseOptions.length > 1,
    openCoursePicker,
    selectCourse,
    groupOptions,
    activeGroup,
    needsGroupChoice,
    selectGroup,
    showNoGroupNotice,
    isObserver,
    roomTitle,
    roomMembers,
    agentStatusById,
    displayMessages,
    draft,
    setDraft,
    notice,
    error,
    roomAccessNotice,
    fallbackNotice,
    agentsPending,
    composerDisabled,
    mentionAgent,
    handleSend,
    handleExport,
    handleShare,
  };
}

function createCourseKey(course: {
  courseId: string;
  classId?: string;
}) {
  return `${course.courseId}::${course.classId ?? ""}`;
}

// The server transcript is authoritative and ordered; anything this client is
// still holding past the newest row the server knows about (an optimistic
// message, a turn from a round that has not been persisted yet) is kept at the
// end. Rows older than that are replaced wholesale, so an eviction from the
// rolling window cannot resurrect as a trailing message.
export function mergeRoomTranscript(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  if (incoming.length === 0) {
    return current;
  }

  const incomingIds = new Set(incoming.map((message) => message.id));
  let lastKnownIndex = -1;
  for (let index = current.length - 1; index >= 0; index -= 1) {
    if (incomingIds.has(current[index].id)) {
      lastKnownIndex = index;
      break;
    }
  }

  const tail = current
    .slice(lastKnownIndex + 1)
    .filter((message) => !incomingIds.has(message.id));
  const merged = tail.length > 0 ? [...incoming, ...tail] : incoming;
  // Identity is preserved when nothing moved, so a poll that returns the same
  // room does not re-render the thread every five seconds.
  if (
    merged.length === current.length &&
    merged.every((message, index) => message.id === current[index].id)
  ) {
    return current;
  }
  return merged;
}

export function getLocalizedAgentHandle(
  agentId: string,
  fallbackHandle: string,
  locale: Locale,
) {
  if (locale === "zh-CN") {
    return fallbackHandle;
  }

  return englishAgentHandlesById[agentId] ?? fallbackHandle;
}

export const englishAgentHandlesById: Record<string, string> = {
  "research-assistant": "@ResearchTA",
  "methods-consultant": "@MethodsAdvisor",
  "math-tutor": "@MathTA",
  "writing-helper": "@WritingHelper",
};

// Both handle spellings resolve to the same roster id, so a transcript recorded
// in one locale still round-trips through the live endpoint in the other.
const agentIdByHandle: Record<string, string> = Object.fromEntries(
  aiAgents.flatMap((agent) => {
    const englishHandle = englishAgentHandlesById[agent.id];
    const pairs: [string, string][] = [[agent.handle, agent.id]];
    if (englishHandle) {
      pairs.push([englishHandle, agent.id]);
    }
    return pairs;
  }),
);

// Longest first, so `@MathTA` can never be matched inside a longer handle.
const mentionHandlePattern = new RegExp(
  Object.keys(agentIdByHandle)
    .sort((left, right) => right.length - left.length)
    .map((handle) => handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g",
);

export type ChatMessageToken =
  | { type: "text"; value: string }
  | { type: "mention"; value: string; agentId: string };

// Replaces the old plain-text `replaceAll` localization: the bubble renders
// mention runs as chips, and the handle is spelled in the reading locale
// whichever spelling the transcript stored.
export function tokenizeChatMessageText(
  message: ChatMessage,
  locale: Locale,
): ChatMessageToken[] {
  return tokenizeMentionText(localizedText(message.text, locale), locale);
}

export function tokenizeMentionText(
  text: string,
  locale: Locale,
): ChatMessageToken[] {
  const tokens: ChatMessageToken[] = [];
  let cursor = 0;

  mentionHandlePattern.lastIndex = 0;
  let match = mentionHandlePattern.exec(text);
  while (match) {
    const agentId = agentIdByHandle[match[0]];
    if (agentId) {
      if (match.index > cursor) {
        tokens.push({ type: "text", value: text.slice(cursor, match.index) });
      }
      const agent = aiAgents.find((candidate) => candidate.id === agentId);
      tokens.push({
        type: "mention",
        value: agent
          ? getLocalizedAgentHandle(agent.id, agent.handle, locale)
          : match[0],
        agentId,
      });
      cursor = match.index + match[0].length;
    }
    match = mentionHandlePattern.exec(text);
  }

  if (cursor < text.length) {
    tokens.push({ type: "text", value: text.slice(cursor) });
  }
  return tokens;
}

function readMentionedAgentIds(text: string): string[] {
  const ids = new Set<string>();
  mentionHandlePattern.lastIndex = 0;
  let match = mentionHandlePattern.exec(text);
  while (match) {
    const agentId = agentIdByHandle[match[0]];
    if (agentId) {
      ids.add(agentId);
    }
    match = mentionHandlePattern.exec(text);
  }
  return [...ids];
}

// POST /api/learning/chatroom response contract.
type ChatroomTurn = {
  // The id the room stored this turn under. Reused as the rendered message id so
  // the next round re-posts it and the server append stays idempotent.
  messageId?: string;
  agentId?: string;
  content?: string;
};

type ChatroomApiResponse = {
  status?: "cue-user" | "end" | "max-turns";
  turns?: ChatroomTurn[];
  // Per-agent mid-round failures; the matching fallback turns already carry
  // server-localized copy, so the UI renders nothing extra for these.
  turnErrors?: Array<{ agentId?: string; kind?: "timeout" | "provider" }>;
  error?: string;
};

type ChatroomRequestMessage = {
  id: string;
  role: "student" | "agent";
  content: string;
  agentId?: string;
};

function toChatroomRequestMessage(
  message: ChatMessage,
  locale: Locale,
): ChatroomRequestMessage {
  const content = localizedText(message.text, locale);
  if (message.kind !== "agent") {
    return { id: message.id, role: "student", content };
  }

  const agentId = message.agentHandle
    ? agentIdByHandle[message.agentHandle]
    : undefined;

  return {
    id: message.id,
    role: "agent",
    content,
    // Omitted rather than guessed when the handle is off the roster.
    ...(agentId ? { agentId } : {}),
  };
}

function toAgentChatMessage(
  turn: ChatroomTurn,
  index: number,
  stamp: number,
  locale: Locale,
): ChatMessage {
  const agent = aiAgents.find((candidate) => candidate.id === turn.agentId);
  const content = typeof turn.content === "string" ? turn.content : "";

  return {
    id: turn.messageId ?? `agent-${stamp}-${index}`,
    kind: "agent",
    // Off-roster agent ids still render, under a generic AI label.
    author: agent?.name ?? {
      "zh-CN": "智能体",
      "en-US": "AI Agent",
    },
    agentHandle: agent?.handle,
    text: {
      "zh-CN": content,
      "en-US": content,
    },
    time: locale === "zh-CN" ? "刚刚" : "Now",
  };
}

// Ids have to stay unique across sessions, because the server keys transcript
// appends by message id: a counter that restarted at 1 after a reload would make
// a fresh message look like one the room had already stored, and it would be
// silently dropped.
let localChatMessageSequence = 0;

function createLocalChatMessageId() {
  localChatMessageSequence += 1;
  const unique =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `local-${unique}-${localChatMessageSequence}`;
}

// GET /api/learning/chatroom response contract: the room's stored transcript,
// plus the group roster for a group room.
type ChatroomHistoryMessage = {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  agentId?: unknown;
  authorName?: unknown;
  isSelf?: unknown;
  createdAt?: unknown;
};

type ChatroomHistoryResponse = {
  groupId?: unknown;
  groupName?: unknown;
  members?: unknown;
  messages?: unknown;
};

type ChatroomHistoryResult =
  | {
      status: "loaded";
      messages: ChatMessage[];
      groupId?: string;
      groupName?: string;
      members?: ChatroomRoomMember[];
    }
  // 403 `feature-not-enabled`: this deployment has not turned group rooms on, so
  // the client drops the group and keeps the legacy per-student room silently.
  | { status: "groups-disabled" }
  | { status: "denied"; reasonCode?: string }
  | { status: "throttled"; retryAfterSeconds?: number }
  | { status: "failed" };

// Never throws and never reports "no history" for a transport problem: the
// caller keeps whatever the room already shows, which is what makes a 429 or a
// blip harmless while polling.
async function fetchChatroomHistory(input: {
  courseId: string;
  classId?: string;
  groupId?: string;
  locale: Locale;
  otherMemberFallbackName: string;
}): Promise<ChatroomHistoryResult> {
  const query = new URLSearchParams({ courseId: input.courseId });
  if (input.classId) {
    query.set("classId", input.classId);
  }
  if (input.groupId) {
    query.set("groupId", input.groupId);
  }

  try {
    const response = await fetch(`/api/learning/chatroom?${query.toString()}`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 429) {
      return {
        status: "throttled",
        ...readRetryAfterSeconds(response),
      };
    }
    if (response.status === 403) {
      const reasonCode = await readAccessReasonCode(response);
      if (reasonCode === "feature-not-enabled") {
        return { status: "groups-disabled" };
      }
      return { status: "denied", ...(reasonCode ? { reasonCode } : {}) };
    }
    if (!response.ok) {
      return { status: "failed" };
    }

    const body = (await response.json()) as ChatroomHistoryResponse;
    if (!Array.isArray(body?.messages)) {
      return { status: "failed" };
    }

    const groupId = readString(body.groupId);
    const isGroupRoom = Boolean(groupId);
    return {
      status: "loaded",
      messages: body.messages.flatMap((message) => {
        const restored = toStoredChatMessage(
          message as ChatroomHistoryMessage,
          input.locale,
          { isGroupRoom, otherMemberFallbackName: input.otherMemberFallbackName },
        );
        return restored ? [restored] : [];
      }),
      ...(groupId ? { groupId } : {}),
      ...(readString(body.groupName) ? { groupName: readString(body.groupName) } : {}),
      ...(Array.isArray(body.members)
        ? { members: readRoomMembers(body.members) }
        : {}),
    };
  } catch {
    return { status: "failed" };
  }
}

function readRetryAfterSeconds(response: Response) {
  const header = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  return Number.isFinite(header) && header > 0 ? { retryAfterSeconds: header } : {};
}

async function readAccessReasonCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { access?: { reasonCode?: unknown } };
    return readString(body?.access?.reasonCode);
  } catch {
    return undefined;
  }
}

function readRoomMembers(value: unknown[]): ChatroomRoomMember[] {
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const displayName = readString(record.displayName);
    if (!displayName) {
      return [];
    }
    return [{ displayName, isSelf: record.isSelf === true }];
  });
}

function toStoredChatMessage(
  message: ChatroomHistoryMessage,
  locale: Locale,
  room: { isGroupRoom: boolean; otherMemberFallbackName: string },
): ChatMessage | undefined {
  const id = readString(message.id);
  const content = readString(message.content);
  if (!id || !content || (message.role !== "student" && message.role !== "agent")) {
    return undefined;
  }

  const time = formatStoredChatMessageTime(message.createdAt, locale);
  if (message.role === "student") {
    // Group rooms have several writers, so "is this mine?" is decided by the
    // server-computed `isSelf` and never by the row simply being a student row.
    // A legacy room is scoped to one account, so every stored student message
    // there is the current viewer's own.
    if (!room.isGroupRoom) {
      return {
        id,
        kind: "student",
        author: { "zh-CN": "我", "en-US": "Me" },
        text: { "zh-CN": content, "en-US": content },
        time,
        self: true,
      };
    }

    const isSelf = message.isSelf === true;
    // Absent on pre-v2 rows, so an older group transcript still renders with a
    // neutral label instead of being attributed to whoever is reading.
    const authorName = readString(message.authorName);
    return {
      id,
      kind: "student",
      author: isSelf
        ? { "zh-CN": "我", "en-US": "Me" }
        : {
            "zh-CN": authorName ?? room.otherMemberFallbackName,
            "en-US": authorName ?? room.otherMemberFallbackName,
          },
      text: { "zh-CN": content, "en-US": content },
      time,
      self: isSelf,
    };
  }

  const agent = aiAgents.find((candidate) => candidate.id === message.agentId);
  return {
    id,
    kind: "agent",
    // Off-roster agent ids still render, under a generic AI label.
    author: agent?.name ?? { "zh-CN": "智能体", "en-US": "AI Agent" },
    agentHandle: agent?.handle,
    text: { "zh-CN": content, "en-US": content },
    time,
  };
}

function formatStoredChatMessageTime(createdAt: unknown, locale: Locale) {
  const storedAt = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
  if (Number.isNaN(storedAt)) {
    return locale === "zh-CN" ? "早前" : "Earlier";
  }
  return new Date(storedAt).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function resolveAgentErrorCopy(status: number, t: (typeof copy)[Locale]): string {
  if (status === 400) {
    return t.learning.agentRequestInvalid;
  }
  if (status === 401) {
    return t.learning.agentSignInRequired;
  }
  if (status === 403) {
    return t.learning.agentAccessDenied;
  }
  return t.learning.agentUnavailable;
}

// GET /api/teaching/courses is parsed tolerantly: unknown fields are ignored.
// A non-OK/malformed/network answer is reported as a failure rather than as an
// empty roster, so the UI never claims the learner has no courses.
type TeachingCoursesResponseBody = {
  courses?: unknown;
  classes?: unknown;
  memberships?: unknown;
  learningGroups?: unknown;
};

type ChatroomCourseFetchResult =
  | { ok: true; options: ChatroomCourseOption[]; groups: ChatroomGroupOption[] }
  | { ok: false };

async function fetchUsableChatroomCourses(
  role: string,
): Promise<ChatroomCourseFetchResult> {
  try {
    const response = await fetch("/api/teaching/courses", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { ok: false };
    }
    const body = (await response.json()) as TeachingCoursesResponseBody;
    // A 200 whose body parses but carries the wrong shape is a failed load, not
    // an empty roster: reporting it as "no courses" would tell an enrolled
    // learner to go join a course. A well-formed empty array stays genuine.
    if (role === "student") {
      if (!Array.isArray(body?.memberships)) {
        return { ok: false };
      }
      return {
        ok: true,
        options: readStudentCourseOptions(body),
        groups: readChatroomGroups(body.learningGroups),
      };
    }
    if (!Array.isArray(body?.courses)) {
      return { ok: false };
    }
    return {
      ok: true,
      options: readTeacherCourseOptions(body),
      groups: readChatroomGroups(body.learningGroups),
    };
  } catch {
    return { ok: false };
  }
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null,
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

// Students receive `{displayName,isSelf}` co-member rows for their own groups;
// teachers receive the full records (`{studentId,studentDisplayName}`) for the
// courses they own. Both normalize to the same roster shape, and neither is ever
// asked for an account id.
function readChatroomGroups(value: unknown): ChatroomGroupOption[] {
  return asRecordArray(value).flatMap((group) => {
    const groupId = readString(group.groupId);
    const courseId = readString(group.courseId);
    const groupName = readString(group.groupName);
    if (!groupId || !courseId || !groupName) {
      return [];
    }
    const members = asRecordArray(group.members).flatMap((member) => {
      const displayName =
        readString(member.displayName) ?? readString(member.studentDisplayName);
      if (!displayName) {
        return [];
      }
      return [{ displayName, isSelf: member.isSelf === true }];
    });
    const classId = readString(group.classId);
    return [
      {
        groupId,
        courseId,
        ...(classId ? { classId } : {}),
        groupName,
        members,
      },
    ];
  });
}

// Student view: usable courses are approved memberships joined to the
// student-visible course/class projections for display names.
function readStudentCourseOptions(
  body: TeachingCoursesResponseBody,
): ChatroomCourseOption[] {
  const courses = asRecordArray(body.courses);
  const classes = asRecordArray(body.classes);
  const options: ChatroomCourseOption[] = [];
  for (const membership of asRecordArray(body.memberships)) {
    if (membership.membershipStatus !== "approved") {
      continue;
    }
    const courseId = readString(membership.courseId);
    if (!courseId) {
      continue;
    }
    const classId = readString(membership.classId);
    const course = courses.find((entry) => entry.courseId === courseId);
    const classItem = classes.find(
      (entry) => entry.classId === classId && entry.courseId === courseId,
    );
    options.push({
      courseId,
      classId,
      courseName: readString(course?.courseName) ?? courseId,
      className: readString(classItem?.className),
      semester: readString(classItem?.semester) ?? readString(course?.semester),
    });
  }
  return dedupeCourseOptions(options);
}

// Teacher view: usable courses are all owned course records.
function readTeacherCourseOptions(
  body: TeachingCoursesResponseBody,
): ChatroomCourseOption[] {
  const options = asRecordArray(body.courses).flatMap((course) => {
    const courseId = readString(course.courseId);
    const courseName = readString(course.courseName);
    if (!courseId || !courseName) {
      return [];
    }
    return [{ courseId, courseName, semester: readString(course.semester) }];
  });
  return dedupeCourseOptions(options);
}

function dedupeCourseOptions(
  options: ChatroomCourseOption[],
): ChatroomCourseOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.courseId}::${option.classId ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Resolution priority: URL hint → single usable course → picker for multiple →
// demo fallback (announced with the reason it stood in). A `?groupId=` deep link
// is resolved before this runs, because the group record already names its own
// course.
function resolveChatroomCourse(
  result: ChatroomCourseFetchResult,
  hints: {
    urlCourseId: string | null;
    urlClassId: string | null;
  },
): ChatroomCourseResolution {
  if (!result.ok) {
    return {
      status: "ready",
      course: { ...demoFallbackCourse, fallbackReason: "load-failed" },
    };
  }

  const options = result.options;
  const matchHint = (courseId: string | null, classId: string | null) => {
    if (!courseId) {
      return undefined;
    }
    const sameCourse = options.filter((option) => option.courseId === courseId);
    if (!classId) {
      return sameCourse[0];
    }
    return (
      sameCourse.find((option) => option.classId === classId) ??
      // Teacher options carry no classId, so a class-scoped deep link must
      // still resolve to the course instead of being discarded.
      sameCourse.find((option) => !option.classId)
    );
  };

  const hinted = matchHint(hints.urlCourseId, hints.urlClassId);
  if (hinted) {
    return { status: "ready", course: { ...hinted, isDemo: false } };
  }
  if (options.length === 1) {
    return { status: "ready", course: { ...options[0], isDemo: false } };
  }
  if (options.length > 1) {
    return { status: "select", options };
  }
  return {
    status: "ready",
    course: { ...demoFallbackCourse, fallbackReason: "no-courses" },
  };
}
