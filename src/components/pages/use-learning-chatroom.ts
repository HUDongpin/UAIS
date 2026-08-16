"use client";

// Headless controller for the human-AI group chatroom (S04, Phase 3 Step 1).
//
// Everything that is not JSX lives here: room resolution (course -> group),
// prior-transcript restore, visibility-aware polling with 429 back-off,
// room-switch tokens, the agent round, delivery receipts, mention/handle maps,
// the message tokenizer the bubbles render as chips, and the
// collaboration.contributed learning-record emission.
// `learning-page-chatroom.tsx` consumes this hook and owns presentation only;
// `use-learning-chatroom-transport.ts` owns the request/response shapes.
//
// Backend contract this builds on (Phase 2, do not change):
// - GET /api/learning/chatroom?courseId=&classId=&groupId= replays one room. For
//   group rooms it adds `groupId`, `groupName`, `members[{displayName,isSelf}]`
//   and stamps every message with `authorName?` and a SERVER-computed `isSelf`.
//   Legacy (no groupId) responses carry neither, and every stored student row in
//   such a room belongs to the caller.
// - GET is rate limited (30/min per actor). A 429 must never blank the thread.
// - POST accepts an optional `groupId`; its response shape is unchanged.
// - Both verbs report a `transcript` receipt. Persistence is best-effort by
//   design, so `unavailable` arrives inside a 200 and delivery must be read from
//   the receipt rather than from the status code.
// - Group discovery rides GET /api/teaching/courses (`learningGroups`).

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { useSessionUser } from "@/components/providers/session-user";
import { localizedText } from "@/components/ui/localized-text";
import { aiAgents, chatMessages, type ChatMessage } from "@/data/uais";
import { copy, type Locale } from "@/i18n/copy";
import { findMentionedAgentIds } from "@/lib/ai/orchestration/director";
import {
  createLearningChatroomExportUrl,
  requestLearningChatroomShareLink,
  revokeLearningChatroomShareLink,
} from "@/lib/chat-actions";
import type { UaisAgentConfig } from "@/lib/ai/orchestration/types";
import {
  createUniqueLearningEventKey,
  reportLearningEvent,
  type ReportLearningEventInput,
} from "@/lib/learning-records/client-event-reporter";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import {
  useLearningChatroomModeration,
  type LearningChatroomModerationController,
} from "./use-learning-chatroom-moderation";
import {
  createLocalChatMessageId,
  demoFallbackCourse,
  fetchChatroomHistory,
  fetchUsableChatroomCourses,
  isFrozenChatroomRefusal,
  isUnconfirmedTranscriptReceipt,
  readRetryAfterSeconds,
  resolveAgentErrorCopy,
  resolveChatroomCourse,
  toAgentChatMessage,
  type ActiveChatroomCourse,
  type ChatroomApiResponse,
  type ChatroomCourseOption,
  type ChatroomCourseResolution,
  type ChatroomGroupOption,
  type ChatroomRoomMember,
} from "./use-learning-chatroom-transport";

export type {
  ActiveChatroomCourse,
  ChatroomCourseOption,
  ChatroomCourseResolution,
  ChatroomGroupOption,
  ChatroomRoomMember,
} from "./use-learning-chatroom-transport";

// Legacy cohort id, still the last-resort learning-record cohort for a room with
// neither a group nor a class. Phase 5 removed its other use: export and share
// now address the real room, so this no longer stands in for a share-link slug.
const chatroomGroupId = "research-method-group";

// Mirrors the server-side per-message limit: a longer last student message
// would be rejected by POST /api/learning/chatroom with 400.
export const chatroomMessageMaxLength = 4000;

// How quickly a classmate's message appears. 5s was chosen when every message
// waited out a 10-50s agent round anyway, so the poll was never the bottleneck;
// with ordinary messages now persisted immediately, it is. 2.5s is what the GET
// budget affords: 24 reads a minute against a 30/min ceiling, leaving room for
// a manual refresh without tripping the limiter. Below that the back-off would
// become the normal case rather than the exception.
//
// The tab-hidden pause and the 429 back-off remain what keep a room of members
// inside that budget.
export const chatroomPollIntervalMs = 2500;

// The static demo transcript from src/data/uais.ts, keyed by its actual ids.
// Seeds are demo-only display fixtures: they render in demo-course context but
// are never part of the live POST /api/learning/chatroom history.
const seedMessageIds = new Set(chatMessages.map((message) => message.id));

export type ChatroomAgentStatus = "idle" | "thinking" | "replied";

// What the room shows next to the share button once a link exists: the copied
// URL and the moment it stops working. `expiresLabel` is formatted once here, in
// the reading locale and as an absolute date, because "in 14 days" is exactly
// the phrasing that leaves someone guessing which day that was.
export type LearningChatroomShareLinkState = {
  // The record the room may withdraw. Held so the revoke control addresses the
  // link this session actually minted, rather than needing a list of every share
  // the room has ever had.
  shareId: string;
  url: string;
  expiresLabel: string | null;
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

  /** The course teacher is in one of their own group rooms, as a participant. */
  isInstructor: boolean;
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
  /** The room's stored transcript could not be read on the last poll. */
  historyNotice: string | null;
  /** The room is holding a full rolling window, so older turns are leaving it. */
  windowNotice: string | null;
  /** The course teacher has frozen the room; shown to everyone who cannot post. */
  frozenNotice: string | null;
  /**
   * At least one agent was actually addressed by the message in flight, so the
   * room really is waiting on a provider round. A plain message waits on
   * nothing: the route persists it and answers, which is why this is no longer
   * simply "a request is open".
   */
  agentsPending: boolean;
  composerDisabled: boolean;
  /** Teacher-only hide/freeze controls for the open room. */
  moderation: LearningChatroomModerationController;
  /** The last minted share link, so the room can show its expiry beside it. */
  shareLink: LearningChatroomShareLinkState | null;
  /** The revoke control is armed and waiting for its confirm. */
  shareRevokeConfirming: boolean;
  /** A revoke request is in flight; the confirm stays disabled until it lands. */
  shareRevokePending: boolean;
  armShareRevoke: () => void;
  cancelShareRevoke: () => void;
  confirmShareRevoke: () => Promise<void>;

  /** Ids of messages whose append the room never confirmed. */
  undeliveredMessageIds: string[];
  /** Re-posts an undelivered message under the id it was minted with. */
  retryMessage: (messageId: string) => void;

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
  // Message ids the room's store never confirmed. The bubble stays on screen -
  // the round it belonged to really did happen - but it is marked undelivered
  // and offers a retry instead of looking exactly like a stored message. Before
  // this the receipt was ignored entirely, so a lost append rendered as
  // delivered and the sender learned about it from a classmate.
  const [undeliveredMessageIds, setUndeliveredMessageIds] = useState<string[]>([]);
  // The last read reached the endpoint but not the store, so the thread the
  // learner is looking at may be missing rows nobody can see yet.
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  // The room's stored transcript is at its rolling-window cap, so its oldest
  // turns are being dropped on every further message - and the export and share
  // link inherit the same cut. Nothing used to say so anywhere.
  const [windowAtCapacity, setWindowAtCapacity] = useState(false);
  // The course teacher has frozen the room. Set from the room state on every
  // read and from a refused send, so a member is told before they type as well
  // as after.
  const [roomFrozen, setRoomFrozen] = useState(false);
  const [shareLink, setShareLink] = useState<LearningChatroomShareLinkState | null>(
    null,
  );
  // Revoking is the one chatroom action that cannot be undone from the UI, so it
  // is armed first and confirmed second - the same two-step the teacher's group
  // delete uses, rather than a browser dialog the room has nowhere else.
  const [shareRevokeConfirming, setShareRevokeConfirming] = useState(false);
  const [shareRevokePending, setShareRevokePending] = useState(false);
  // The ids the previous server replay carried. A row that the room used to
  // replay and now does not has been moderated away (or evicted), so it must
  // leave this thread too - see `mergeRoomTranscript`, whose tail would
  // otherwise preserve a hidden message on the screen of every member who
  // happened to have it as their newest row.
  const previousServerMessageIdsRef = useRef<Set<string>>(new Set());
  // Contribution records held back because the room never confirmed the message
  // they belong to, keyed by that message id. Participation is credited for a
  // message the room HOLDS, not for one the endpoint merely accepted, so an
  // `unavailable` receipt parks the record here instead of emitting it; the poll
  // below releases it if the room later replays the row.
  const pendingContributionEventsRef = useRef<Map<string, ReportLearningEventInput>>(
    new Map(),
  );
  // Message ids whose contribution record has already been emitted. Deleting the
  // parked entry was not enough on its own: a record released by a poll replay
  // left an empty map, and a tap-to-retry on the same bubble then re-parked and
  // re-emitted it - two `collaboration.contributed` rows, each with its own
  // unique idempotency key, for one message. The learner's record counted a
  // single sentence twice. Release is now idempotent per message id, so the
  // parked entry is at most one emission whichever path confirms it first.
  const releasedContributionMessageIdsRef = useRef<Set<string>>(new Set());
  // Room key whose polling loop is stopped because the server denied the read;
  // re-polling a denial would only burn the shared GET budget.
  const [haltedRoomKey, setHaltedRoomKey] = useState<string | null>(null);
  const [documentVisible, setDocumentVisible] = useState(true);

  // A message is undelivered only while the room cannot show it. It clears on a
  // confirmed receipt, on a GET that replays it (an append the route abandoned
  // as "not confirmed within budget" may still have landed), and on a 429, which
  // takes the bubble out of the thread altogether.
  const markMessageDelivery = useCallback(
    (messageId: string, undelivered: boolean) => {
      setUndeliveredMessageIds((current) => {
        if (current.includes(messageId) === undelivered) {
          return current;
        }
        return undelivered
          ? [...current, messageId]
          : current.filter((id) => id !== messageId);
      });
    },
    [],
  );

  // Releases the contribution record parked for a message the room has now
  // confirmed. Idempotent per MESSAGE ID, not merely per parked entry: emptying
  // the map stopped a second release of the same entry, but nothing stopped the
  // same message being parked a second time by a later confirmed round (a
  // tap-to-retry resend on a bubble the poll had already released), which then
  // emitted a second record for one sentence. The released-id set is consulted
  // here and again before parking, so a message is credited exactly once for as
  // long as the room stays mounted.
  const emitConfirmedContribution = useCallback((messageId: string) => {
    const contribution = pendingContributionEventsRef.current.get(messageId);
    if (!contribution) {
      return;
    }
    pendingContributionEventsRef.current.delete(messageId);
    if (releasedContributionMessageIdsRef.current.has(messageId)) {
      return;
    }
    releasedContributionMessageIdsRef.current.add(messageId);
    void reportLearningEvent(contribution);
  }, []);

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

  // The course teacher is a full participant in their own course's group rooms
  // (owner decision: teaching presence). This flag no longer gates the
  // composer - it only tells the room to identify the viewer as the instructor.
  const isInstructor = Boolean(activeGroup) && sessionUser?.role === "teacher";

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
  // A frozen room refuses student writes and keeps taking the teacher's, so the
  // composer closes for exactly the accounts the route would refuse - the same
  // rule, spelled the same way, rather than a client guess about who is allowed
  // to speak into a quieted room.
  const frozenForViewer = roomFrozen && sessionUser?.role !== "teacher";
  const composerDisabled =
    resolution.status !== "ready" ||
    demoPreviewOnly ||
    needsGroupChoice ||
    roomAccessNotice !== null ||
    frozenForViewer;
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
    // Both delivery signals belong to the room that produced them: the messages
    // they describe are gone from the thread, so carrying them across would mark
    // another room's transcript.
    setUndeliveredMessageIds([]);
    setHistoryUnavailable(false);
    // Every one of these describes the room that produced it, not the room the
    // learner just walked into.
    setWindowAtCapacity(false);
    setRoomFrozen(false);
    setShareLink(null);
    previousServerMessageIdsRef.current = new Set();
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
            result.reasonCode === "teacher-group-not-found"
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
      // An unreadable store answers 200 with an empty `messages` array, which is
      // indistinguishable from a genuinely empty room. Without this the learner
      // sees a healthy, quiet classroom instead of a transcript that is simply
      // not being read; `mergeRoomTranscript` keeps whatever is already on
      // screen, so saying so costs the thread nothing.
      setHistoryUnavailable(result.transcriptUnavailable);
      // Both are room facts rather than request outcomes, so they follow the
      // room on every read: a teacher who thaws the room, or a window that
      // fills while the tab is open, reaches the member without a reload.
      setRoomFrozen(result.roomFrozen);
      setWindowAtCapacity(result.transcriptWindowAtCapacity);
      if (result.groupId) {
        setServerRoom({
          groupId: result.groupId,
          ...(result.groupName ? { groupName: result.groupName } : {}),
          members: result.members ?? [],
        });
      }
      const previousServerMessageIds = previousServerMessageIdsRef.current;
      previousServerMessageIdsRef.current = new Set(
        result.messages.map((message) => message.id),
      );
      setMessages((current) =>
        mergeRoomTranscript(current, result.messages, previousServerMessageIds),
      );
      // A message the room can now replay is delivered, whatever its POST
      // receipt said: `unavailable` means "not confirmed inside the budget", and
      // the append the route abandoned may still have landed.
      if (result.messages.length > 0) {
        const storedIds = new Set(result.messages.map((message) => message.id));
        // Same reasoning for the learning record the send parked: a row the room
        // can replay really is stored, so the contribution is honest to credit
        // now. Walked from the pending side because that map is empty in the
        // ordinary case, while the replay carries the whole window.
        for (const messageId of [...pendingContributionEventsRef.current.keys()]) {
          if (storedIds.has(messageId)) {
            emitConfirmedContribution(messageId);
          }
        }
        setUndeliveredMessageIds((current) => {
          if (current.length === 0) {
            return current;
          }
          const next = current.filter((id) => !storedIds.has(id));
          return next.length === current.length ? current : next;
        });
      }
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
    emitConfirmedContribution,
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
    // The learner's own message this round is carrying. Its id is what the
    // delivery receipt is applied to and what a retry re-posts; its text is what
    // goes back into the composer if the send is throttled away.
    sent: { messageId: string; text: string },
    // A resend is a DELIVERY retry, not a conversation: the route persists the
    // named row and skips the round entirely, so no agent answers twice and no
    // second completion is billed for a message that was already asked once.
    options: { resend?: boolean } = {},
  ) {
    // A round belongs to the room it was started in. The learner stays free to
    // leave a slow room (the chip/picker are never disabled while pending), so
    // a round that outlives its room is discarded whole: no turns appended, no
    // error/notice written, and no pending flag cleared in the new room — the
    // room-change effect already cleared it there.
    const roundRoomToken = currentRoomToken();
    const isCurrentRound = () => currentRoomToken() === roundRoomToken;

    // Does this send actually wait on an agent?
    //
    // It used to be assumed to, so "agents are thinking…" appeared for every
    // message - including "好的，3点图书馆见", which the route now persists and
    // answers immediately without touching a provider. The indicator was
    // therefore claiming work nobody had asked for and nobody was doing. It is
    // decided from the director's matcher on the same roster the route gates on,
    // so the room and the server cannot disagree about who was addressed.
    const mentionedAgentIds = options.resend ? [] : readMentionedAgentIds(sent.text);
    const agentRoundExpected = mentionedAgentIds.length > 0;
    setPendingAgentIds(mentionedAgentIds);
    if (agentRoundExpected) {
      setAgentsPending(true);
    }

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
          // The persist-only marker. Without it a retry is an ordinary send:
          // the same history is posted, the route's mention gate reads the same
          // last student message, and a message that had addressed an agent
          // buys a second round - the learner asked once and is answered (and
          // billed) twice. The marker names the row being resent, which the
          // route requires to be one of the student rows this request carries.
          ...(options.resend
            ? { intent: "resend" as const, messageId: sent.messageId }
            : {}),
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
        setError(
          resolveAgentErrorCopy(response.status, t, readRetryAfterSeconds(response).retryAfterSeconds),
        );
        // A frozen room refuses the write BEFORE the route has a room to
        // persist into, so - exactly like a throttle - the message reached no
        // store. It also tells the composer to close: this is the one refusal a
        // retry cannot get past, and it lasts as long as the teacher intends.
        const frozenRefusal = await isFrozenChatroomRefusal(response);
        // Reading the reason code is another await, so the room is re-checked:
        // a refusal belongs to the room that produced it, and freezing the room
        // the learner has since walked into would close a composer nobody
        // refused.
        if (!isCurrentRound()) {
          return;
        }
        if (frozenRefusal) {
          setRoomFrozen(true);
        }
        // A throttled message was never stored, so leaving its optimistic bubble
        // on screen tells the sender it was delivered when their classmates
        // will never see it. Every other failure leaves the bubble alone: the
        // route persists the learner's own row best-effort before answering
        // 4xx/5xx, so it really is in the room.
        if (response.status === 429 || frozenRefusal) {
          setMessages((current) =>
            current.filter((message) => message.id !== sent.messageId),
          );
          markMessageDelivery(sent.messageId, false);
          // The text goes back where it was typed. Dropping the bubble without
          // it left the message existing nowhere at all - not in the room, not
          // in the composer - so the learner had to retype what the room had
          // just shown them. A draft started while the round was in flight is
          // the newer text and wins.
          setDraft((current) => (current.trim() ? current : sent.text));
        }
        return;
      }

      const body = (await response.json()) as ChatroomApiResponse;
      if (!isCurrentRound()) {
        return;
      }

      // Persistence is best-effort by contract, so the route answers 200 for a
      // round it could not store: delivery is read from the receipt, never from
      // the status code. An `unavailable` receipt means this message is not in
      // the room and no classmate's poll will ever bring it back.
      const transcriptUnconfirmed = isUnconfirmedTranscriptReceipt(body.transcript);
      markMessageDelivery(sent.messageId, transcriptUnconfirmed);

      // The contribution is recorded for a message the ROOM HOLDS. It used to be
      // emitted on `response.ok` alone, one await earlier than the receipt is
      // read - so a round the route answered 200 for and could not store still
      // credited participation, and the learner's record claimed a message no
      // classmate would ever see. Emitting here (rather than optimistically in
      // `handleSend`) still keeps a refused send - 401, 403, 400, a network
      // failure - out of the record entirely.
      if (learnerAccount && !releasedContributionMessageIdsRef.current.has(sent.messageId)) {
        // The group is the collaboration cohort when there is one; a legacy room
        // falls back to the class, then to the historic chatroom cohort id.
        const cohortId = groupId ?? course.classId ?? chatroomGroupId;
        // Keyed by a unique suffix so every confirmed send is its own record.
        // Re-parking is skipped entirely once this message has been credited:
        // overwriting the map entry was enough for a resend that arrived while
        // the record was still parked, but not for one that arrived after a
        // poll replay had already released it, which used to buy a second
        // record for the same sentence.
        pendingContributionEventsRef.current.set(sent.messageId, {
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
          idempotencyKey: createUniqueLearningEventKey(
            learnerAccount,
            "collaboration.contributed",
            course.courseId,
            cohortId,
          ),
        });
        if (!transcriptUnconfirmed) {
          emitConfirmedContribution(sent.messageId);
        }
        // Otherwise it waits: `unavailable` means "not confirmed inside the
        // budget", and the append may still have landed - the poll releases the
        // record if the room replays the row.
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
      // Cleared only by the send that raised it: a plain message never set it,
      // and clearing a flag this call does not own would take the indicator away
      // from a round that is still running.
      if (agentRoundExpected && isCurrentRound()) {
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
    // A course must resolve before the room accepts messages, and the demo
    // fallback stays read-only for anyone the route would answer 403. The course
    // teacher is NOT gated here: they participate in their own group rooms.
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
    // Minted here rather than read back off the tail of `nextMessages`, because
    // the receipt handler and tap-to-retry both address this exact row.
    const sentMessageId = createLocalChatMessageId();
    const nextMessages: ChatMessage[] = [
      ...messages,
      {
        id: sentMessageId,
        kind: "student",
        author:
          activeGroup && selfName
            ? { "zh-CN": selfName, "en-US": selfName }
            : { "zh-CN": "我", "en-US": "Me" },
        text: {
          "zh-CN": trimmedDraft,
          "en-US": trimmedDraft,
        },
        // No `instructor` mark here: the optimistic row is the sender's own, and
        // a self row renders without the author header the badge lives in. The
        // badge exists for the OTHER members, who receive this message through a
        // GET carrying the server-stamped `authorRole`.
        time: locale === "zh-CN" ? "刚刚" : "Now",
        self: true,
      },
    ];

    setMessages(nextMessages);
    setDraft("");
    setError("");
    setNotice("");

    // The collaboration.contributed learning record is emitted from
    // `requestAgentTurns` only once the room's store CONFIRMS the message, so a
    // send the route refuses (401/403/400) and a round the route could not
    // persist both stay out of the learner's record.

    if (!sessionUser) {
      // The route would answer 401 anyway, so fail fast and keep the UX crisp.
      // The student message above is already rendered and is never rolled back.
      setError(t.learning.agentSignInRequired);
      return;
    }

    void requestAgentTurns(activeCourse, activeGroup?.groupId, nextMessages, {
      messageId: sentMessageId,
      text: trimmedDraft,
    });
  }

  // Tap-to-retry on an undelivered bubble. The message keeps the id it was
  // minted with, so the append the store may or may not have taken is idempotent
  // per message id and a retry cannot double-post it.
  //
  // It is sent as a RESEND, not as an ordinary send. A retry used to re-post the
  // whole visible transcript with no marker, so the route's mention gate read
  // the same last student message and ran the round again: a learner tapping
  // "not delivered" on a message that had addressed an agent bought a second
  // live completion and got a second answer to a question they asked once. The
  // resend intent asks for delivery only - the route persists the named row and
  // skips the round.
  //
  // The undelivered mark is NOT cleared optimistically: only a confirmed receipt
  // (or a GET that replays the row) may say a message is in the room, so a retry
  // that fails again leaves the bubble exactly as honest as it was.
  function retryMessage(messageId: string) {
    if (agentsPending || !activeCourse || composerDisabled) {
      return;
    }
    const message = messages.find((candidate) => candidate.id === messageId);
    if (!message) {
      return;
    }

    const text = localizedText(message.text, locale);
    setError("");
    setNotice("");
    void requestAgentTurns(
      activeCourse,
      activeGroup?.groupId,
      messages,
      { messageId, text },
      { resend: true },
    );
  }

  // Export opens the real print view for THIS room (Phase 5). It is a route, not
  // a download: the browser's print dialog is the PDF generator, so there is no
  // service, no credential and no server render to wait for.
  function handleExport() {
    // The print view enforces the same room access the chatroom does, so a
    // reader the route could only refuse is told here instead of being sent to a
    // page that refuses them. Every export/share outcome - success or not - is
    // written to `notice`, because that is the line the room header renders next
    // to these two buttons; `error` belongs to the composer and would put an
    // export failure under the wrong control.
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
      setShareLink(null);
      setNotice(t.learning.shareFailed);
      return;
    }

    // Every link ends on its own, so the room says when. Kept beside the copied
    // URL rather than folded into the one-line notice: the notice is transient
    // and the expiry is the thing whoever pastes this link needs to remember.
    setShareLink({
      shareId: result.shareId,
      url: result.url,
      expiresLabel: result.expiresAt
        ? formatShareExpiry(result.expiresAt, locale)
        : null,
    });
    // A fresh mint replaces whatever the previous link's revoke prompt was
    // asking about.
    setShareRevokeConfirming(false);

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

  function armShareRevoke() {
    setShareRevokeConfirming(true);
    setNotice("");
  }

  function cancelShareRevoke() {
    setShareRevokeConfirming(false);
  }

  // Withdraws the link this room is currently showing.
  //
  // Scope, on purpose: this is the share THIS session minted and has on screen,
  // not a management surface for every link the room has ever published. A
  // cross-session list needs an "index shares by room" read the share store does
  // not expose, plus its own access rules for a teacher revoking a student's
  // link - both are separate work, and neither is a reason to leave the one link
  // the learner is looking at un-revocable.
  async function confirmShareRevoke() {
    if (!shareLink || shareRevokePending) {
      return;
    }

    setShareRevokePending(true);
    const result = await revokeLearningChatroomShareLink(shareLink.shareId);
    setShareRevokePending(false);
    if (result.status === "failed") {
      // The link is still live, so the URL and its expiry stay exactly where
      // they were: clearing them would show a withdrawn link that still works.
      setNotice(t.learning.shareRevokeFailed);
      return;
    }

    setShareRevokeConfirming(false);
    setShareLink(null);
    setNotice(t.learning.shareRevoked);
    setError("");
  }

  // A hidden row stops being part of the room, so it leaves this thread too.
  // Every other member loses it on their next read - the store filters hidden
  // rows out of every replay path - and this is the moderator's own copy.
  const dropHiddenMessage = useCallback((messageId: string) => {
    setMessages((current) => current.filter((message) => message.id !== messageId));
  }, []);

  const moderationRoom = useMemo(
    () =>
      activeCourse
        ? {
            courseId: activeCourse.courseId,
            ...(activeCourse.classId ? { classId: activeCourse.classId } : {}),
            ...(activeGroup ? { groupId: activeGroup.groupId } : {}),
          }
        : null,
    [activeCourse, activeGroup],
  );
  const moderation = useLearningChatroomModeration({
    locale,
    // The controls appear for a teacher in a real group room and nowhere else:
    // the moderation route keys a per-student room by the learner's account id,
    // which this client is deliberately never given.
    canModerate: isInstructor && !demoPreviewOnly,
    room: moderationRoom,
    frozen: roomFrozen,
    onRoomFrozenChange: setRoomFrozen,
    onMessageHidden: dropHiddenMessage,
  });

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
    isInstructor,
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
    historyNotice: historyUnavailable ? t.learning.chatHistoryUnavailable : null,
    windowNotice: windowAtCapacity ? t.learning.chatroomWindowTrimmed : null,
    // The teacher already sees the room's state in the moderation panel, so
    // this line is for the members it actually stops.
    frozenNotice: frozenForViewer ? t.learning.chatroomFrozenNotice : null,
    agentsPending,
    composerDisabled,
    moderation,
    shareLink,
    shareRevokeConfirming,
    shareRevokePending,
    armShareRevoke,
    cancelShareRevoke,
    confirmShareRevoke,
    undeliveredMessageIds,
    retryMessage,
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
//
// `previouslyReplayedIds` is what keeps that tail from preserving a message the
// room has since REMOVED. A teacher-hidden row stops appearing in every replay
// path, but if it happened to be a member's newest row it sat in the tail and
// stayed on their screen indefinitely - the moderation decision reached the
// store, the export and the share page, and not the one place it was made for.
// A row the previous read carried and this one does not is gone on purpose, so
// it goes here too; a row the server has never replayed is still in flight and
// is kept exactly as before.
export function mergeRoomTranscript(
  current: ChatMessage[],
  incoming: ChatMessage[],
  previouslyReplayedIds: ReadonlySet<string> = new Set(),
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
    .filter(
      (message) =>
        !incomingIds.has(message.id) && !previouslyReplayedIds.has(message.id),
    );
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

// The roster the SERVER gates on, rebuilt from this client's own agent data:
// the same ids, the same `@handle` plus its English alias. Only the mention
// fields carry meaning here - the rest satisfy the shared config type - because
// this roster exists for exactly one question.
const mentionRoster: UaisAgentConfig[] = aiAgents.map((agent) => ({
  id: agent.id,
  handle: agent.handle,
  aliases: englishAgentHandlesById[agent.id]
    ? [englishAgentHandlesById[agent.id]]
    : [],
  name: agent.id,
  role: "assistant" as const,
  providerRole: "text-reasoning" as const,
  priority: 0,
  allowedActions: ["respond"],
}));

/**
 * Which agents this message actually addresses.
 *
 * The director's own matcher, not a second one. The room used to answer this
 * with a bare handle regex, which is looser than the gate the route applies: it
 * counted a pasted transcript line and an address like `peter@MathTA.example`
 * as summons. With the round now gated on the mention, a looser client answer is
 * not a cosmetic difference - it is the room promising a reply that will never
 * come, and marking agents "thinking" for a round the server declined to run.
 */
function readMentionedAgentIds(text: string): string[] {
  return findMentionedAgentIds(mentionRoster, text);
}

// Absolute, in the reading locale, and formatted once. "Expires in 14 days" is
// the phrasing that leaves whoever pasted the link guessing which day that was.
export function formatShareExpiry(expiresAt: string, locale: Locale): string | null {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return null;
  }
  return new Date(expiresAtMs).toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// The one request shape the controller still builds itself: mapping a rendered
// bubble back to a POST row needs the handle map above, which the transport
// module deliberately does not import.
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
