"use client";

// Teacher moderation controls for one open chatroom room (S04 client half of
// the E10 moderation contract).
//
// The room had no moderation surface at all: an AI-assisted group chat replayed
// a live transcript to every member and, through `/share`, to whoever held a
// link, and the only remedy a teacher had for a message that should not be
// there was to delete the group. The backend now exposes exactly two actions -
// hide/restore one message, freeze/unfreeze the room - and this hook is the
// smallest client that drives them honestly.
//
// Three rules it is built around:
//
// 1. Nothing is reported optimistically. Moderation is the one chatroom write
//    that is NOT best-effort: a teacher told "hidden" about a message their
//    class can still read has been told the opposite of the truth, so the
//    receipt is written only after the route accepts the call.
// 2. The controls are separated from the room's own state. `frozen` comes from
//    the room (the GET's moderation projection, or a refused send), and an
//    accepted toggle only asks the room to reflect it; this hook never becomes
//    a second source of truth about whether a room is frozen.
// 3. One action at a time. A moderator double-tapping "freeze" must not fire
//    two writes at a snapshot store; the controls disable while a call is in
//    flight rather than queueing.
//
// It lives outside `use-learning-chatroom.ts` because that file is already the
// room's whole behaviour and is near the source-file cap - and because
// moderation is a genuinely separate capability, available to one role, that
// the room only has to render.

import { useCallback, useRef, useState } from "react";
import { copy, type Locale } from "@/i18n/copy";
import { requestLearningChatroomModeration } from "./use-learning-chatroom-transport";

export type LearningChatroomModerationRoom = {
  courseId: string;
  classId?: string;
  groupId?: string;
};

export type LearningChatroomModerationController = {
  /**
   * The viewer may moderate the room they are looking at.
   *
   * Deliberately narrow: teacher role, a resolved real course, and a GROUP
   * room. A per-student room is keyed by the learner whose room it is, and the
   * moderation route needs that account id - which the chatroom client is never
   * given, because account ids are the room's authorization key and stay
   * server-side. So the controls appear exactly where they can actually work.
   */
  canModerate: boolean;
  /** The room refuses student posts right now. Owned by the room, not by this. */
  frozen: boolean;
  /** A moderation write is in flight; every control disables until it settles. */
  pending: boolean;
  /** Which message a hide is currently being requested for, if any. */
  pendingMessageId: string | null;
  /** Short outcome line for the last action. Replaced by the next action. */
  receipt: string;
  hideMessage: (messageId: string) => void;
  toggleFreeze: () => void;
};

export function useLearningChatroomModeration(input: {
  locale: Locale;
  canModerate: boolean;
  room: LearningChatroomModerationRoom | null;
  frozen: boolean;
  /**
   * Applied only after the route accepts a freeze/unfreeze, so the composer and
   * the room notice follow the moderator's own action without waiting out a
   * poll - and never follow one the server refused.
   */
  onRoomFrozenChange: (frozen: boolean) => void;
  /**
   * A hidden message stops being part of the room. The room drops the row so
   * the moderator sees the result of their own action immediately; every other
   * member loses it on their next read, because the store filters hidden rows
   * out of every replay path.
   */
  onMessageHidden: (messageId: string) => void;
}): LearningChatroomModerationController {
  const t = copy[input.locale];
  const [receipt, setReceipt] = useState("");
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [freezePending, setFreezePending] = useState(false);
  // A ref rather than the two state flags: the guard has to hold for the call
  // that is being started right now, and a state read inside the handler would
  // still be the pre-click value.
  const inFlightRef = useRef(false);

  const { canModerate, room, frozen, onRoomFrozenChange, onMessageHidden } = input;

  const hideMessage = useCallback(
    (messageId: string) => {
      if (!canModerate || !room || !messageId || inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      setPendingMessageId(messageId);
      setReceipt("");
      void (async () => {
        const result = await requestLearningChatroomModeration({
          action: "hide-message",
          courseId: room.courseId,
          ...(room.classId ? { classId: room.classId } : {}),
          ...(room.groupId ? { groupId: room.groupId } : {}),
          messageId,
        });
        inFlightRef.current = false;
        setPendingMessageId(null);
        if (result.status === "failed") {
          setReceipt(t.learning.chatroomModerationFailed);
          return;
        }
        onMessageHidden(messageId);
        setReceipt(t.learning.chatroomModerationHidden);
      })();
    },
    [
      canModerate,
      room,
      onMessageHidden,
      t.learning.chatroomModerationFailed,
      t.learning.chatroomModerationHidden,
    ],
  );

  const toggleFreeze = useCallback(() => {
    if (!canModerate || !room || inFlightRef.current) {
      return;
    }
    const nextFrozen = !frozen;
    inFlightRef.current = true;
    setFreezePending(true);
    setReceipt("");
    void (async () => {
      const result = await requestLearningChatroomModeration({
        action: nextFrozen ? "freeze-room" : "unfreeze-room",
        courseId: room.courseId,
        ...(room.classId ? { classId: room.classId } : {}),
        ...(room.groupId ? { groupId: room.groupId } : {}),
      });
      inFlightRef.current = false;
      setFreezePending(false);
      if (result.status === "failed") {
        setReceipt(t.learning.chatroomModerationFailed);
        return;
      }
      onRoomFrozenChange(nextFrozen);
      setReceipt(
        nextFrozen
          ? t.learning.chatroomModerationFrozen
          : t.learning.chatroomModerationUnfrozen,
      );
    })();
  }, [
    canModerate,
    room,
    frozen,
    onRoomFrozenChange,
    t.learning.chatroomModerationFailed,
    t.learning.chatroomModerationFrozen,
    t.learning.chatroomModerationUnfrozen,
  ]);

  return {
    canModerate,
    frozen,
    pending: freezePending || pendingMessageId !== null,
    pendingMessageId,
    receipt,
    hideMessage,
    toggleFreeze,
  };
}
