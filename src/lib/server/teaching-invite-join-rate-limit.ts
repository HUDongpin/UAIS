import {
  createAiRequestRateLimiter,
  type AiRequestRateLimiter,
} from "@/lib/server/ai-request-rate-limit";

// Per-student throttle for POST /api/teaching/invite-codes/[code]/join.
//
// Why this exists: the invite code IS the credential. The route takes an 8-digit
// number and, if it matches any class in the deployment, writes a membership -
// so an authenticated student with a loop can walk the code space until they
// land inside somebody else's class. Codes are now drawn at random rather than
// counted upwards, which removes the "guess one, know the next" shortcut; this
// bounds what is left, which is brute force. Each rejected attempt also costs a
// corpus-wide snapshot read, so an unthrottled loop is a storage cost as well as
// a security one.
//
// Three decisions, each following an existing sibling:
//
// 1. Reuse `createAiRequestRateLimiter` - the same fixed-window, per-process
//    machinery the AI routes and the share paths use. Its caveat carries over:
//    the effective ceiling is `limit x serverless instances`, so this bounds
//    abuse rather than capping it globally. A hard global cap needs shared
//    storage and is a separate S12 decision; per-instance is the accepted
//    posture for September.
//
// 2. Key on the authenticated student account, never on a header. The route
//    already refuses unauthenticated callers, so there is a real per-actor
//    identity here and no reason to fall back to a client-authored IP - which
//    would let a caller mint a fresh budget per request.
//
// 3. Fixed, not env-tunable, exactly like the share limiters. A student joins a
//    handful of classes per term; there is no deployment for which a hundred
//    join attempts a day is a real ceiling to tune.

// Ten a minute absorbs a mistyped code, a retried tap and a browser resubmit
// without a legitimate student ever noticing. A hundred a day is the number that
// actually matters: it turns a 90-million-wide code space into roughly a
// million years of guessing per account.
const teachingInviteJoinRateLimitPerMinute = 10;
const teachingInviteJoinRateLimitPerDay = 100;

export function createTeachingInviteJoinRateLimiter(): AiRequestRateLimiter {
  return createAiRequestRateLimiter({
    config: {
      mode: "enforce",
      windows: [
        {
          id: "per-minute",
          limit: teachingInviteJoinRateLimitPerMinute,
          windowMs: 60000,
        },
        {
          id: "per-day",
          limit: teachingInviteJoinRateLimitPerDay,
          windowMs: 86400000,
        },
      ],
    },
  });
}

export function resolveTeachingInviteJoinRateLimitKey(studentId: string) {
  return `teaching-invite-join-${studentId}`;
}
