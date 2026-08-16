// Thread auto-scroll policy for the group chatroom (E12/PKG-7).
//
// The room used to force `scrollTop = scrollHeight` on every change of message
// count or agent-pending state, which fires on every 2.5s poll delivery: a
// member scrolled up reading an earlier turn was yanked back to the bottom by a
// classmate's message. Pure functions so the decision can be tested without a
// layout engine — jsdom reports every scroll metric as 0.

/** How close to the end still counts as "reading the newest turn". */
export const threadNearBottomThresholdPx = 96;

export function isThreadNearBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  thresholdPx = threadNearBottomThresholdPx,
) {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= thresholdPx
  );
}

export type ThreadAutoScrollDecision = {
  /** Pin the thread to the newest turn. */
  scrollToBottom: boolean;
  /** Offer the "jump to latest" affordance instead of moving the reader. */
  revealJumpToLatest: boolean;
};

export function resolveThreadAutoScroll({
  nearBottom,
  latestMessageIsSelf,
  hasNewMessages,
}: {
  nearBottom: boolean;
  latestMessageIsSelf: boolean;
  hasNewMessages: boolean;
}): ThreadAutoScrollDecision {
  // Your own message always wins: pressing send and not seeing the message you
  // just wrote reads as a failed send.
  if (nearBottom || latestMessageIsSelf) {
    return { scrollToBottom: true, revealJumpToLatest: false };
  }

  return { scrollToBottom: false, revealJumpToLatest: hasNewMessages };
}
