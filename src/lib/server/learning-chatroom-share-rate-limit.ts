import { isIP } from "node:net";
import {
  createAiRequestRateLimiter,
  type AiRequestRateLimiter,
} from "@/lib/server/ai-request-rate-limit";

// Per-viewer throttle for the SIGNED-OUT public `/share/[shareId]` read path
// (plan D8/D6; the Phase 6 hardening follow-up the CTO deferred as a minor).
//
// Why this exists: the public share page is signed-out viewable and renders the
// room LIVE at request time, so every view drives several whole-snapshot storage
// reads - the shares database, the course-management snapshot, and the room
// transcript. With no throttle, anyone holding (or guessing at) share URLs can
// drive those reads in a loop. This bounds them per viewer.
//
// Three decisions, each mirroring an existing sibling rather than inventing a
// new convention:
//
// 1. Reuse `createAiRequestRateLimiter` - the same fixed-window, per-process
//    machinery the chatroom GET/POST and the share MINT route already use. Its
//    documented caveats carry over unchanged: the effective ceiling is per
//    process (`limit x serverless instances`), and a hard global cap needs
//    shared storage (Redis/Postgres) and is a separate S12 decision.
//
// 2. Key on the viewer's client IP, not an account: this path has no session, so
//    the IP is the only per-viewer signal there is. A shared campus NAT
//    therefore shares one budget, which is why the per-minute ceiling is
//    deliberately generous - a lecture opening one shared link must not throttle
//    itself.
//
//    WHAT THIS DOES AND DOES NOT STOP. The key space must be bounded, or the
//    guard is worse than useless: a caller who can vary the key gets a fresh
//    budget per request (100% pass-through) AND forces the limiter's bucket map
//    over its cap on every request. So the header value is VALIDATED as an IP
//    (`node:net` `isIP`) rather than sanitized into "some string", and an IPv6
//    address is folded to its /64 - the smallest block routinely delegated to a
//    single subscriber - because keying the full 128 bits would hand one
//    ordinary allocation 2^64 distinct budgets with no spoofing at all.
//    Anything that is not an IP falls to the shared unknown bucket rather than
//    minting a bucket of its own.
//
//    This bounds casual abuse and accidental hammering, which is the threat this
//    page actually has. It is NOT a DDoS defense and must not be described as
//    one: a distributed caller with many real source networks still gets one
//    budget per network, and no per-process, per-IP limiter can change that.
//    Bounding that case needs edge/CDN rate limiting or a shared-storage global
//    cap, both outside this module.
//
//    Header trust: `x-forwarded-for` is client-authored on any deployment whose
//    edge does not overwrite it, so a caller who controls it can both widen
//    their own budget and fill a chosen victim's. The platform this ships on
//    (Vercel) overwrites both headers, which is what makes them usable here; a
//    self-hosted edge MUST do the same or this key is attacker-chosen.
//
// 3. Fixed, NOT env-tunable, exactly like the share MINT limiter. The release
//    env catalog is closed for this feature - its `active-production` tier is
//    saturated, so a new name is an owner/S19 decision - and a generous read
//    ceiling needs no per-deployment knob. Widening it is a code change.

// Polling-friendly and NAT-tolerant: 60 views a minute per IP is one a second,
// comfortably above a classroom opening a shared link, while still turning
// "unbounded" into "bounded and small". The per-day window is the same ceiling
// stated over a whole day of continuous access from a single IP.
const learningChatroomShareReadRateLimitPerMinute = 60;
const learningChatroomShareReadRateLimitPerDay = 5000;

// The bucket a viewer with no resolvable client IP shares. Deliberately a single
// constant so an absent or stripped forwarded header fails toward MORE
// throttling (one shared budget) rather than a per-request bypass.
export const learningChatroomShareViewerUnknownKey = "share-viewer-unknown";

// Longest possible IPv6 textual form. Applied before validation purely so a
// megabyte-long header is rejected without being parsed.
const learningChatroomShareViewerIpMaxLength = 45;
// IPv6 is folded to this many leading 16-bit groups: 4 x 16 = /64.
const learningChatroomShareViewerIpv6PrefixGroups = 4;

export function createLearningChatroomShareReadRateLimiter(): AiRequestRateLimiter {
  return createAiRequestRateLimiter({
    config: {
      mode: "enforce",
      windows: [
        {
          id: "per-minute",
          limit: learningChatroomShareReadRateLimitPerMinute,
          windowMs: 60000,
        },
        {
          id: "per-day",
          limit: learningChatroomShareReadRateLimitPerDay,
          windowMs: 86400000,
        },
      ],
    },
  });
}

// Derives the per-viewer key from request headers. `x-real-ip` is preferred
// because the deployment platform (Vercel) sets it to the true client IP as a
// single value; `x-forwarded-for` is a client-most-first list whose leading hop
// is the fallback. Both are sanitized and bounded; neither is trusted verbatim.
// A header getter is injected rather than `next/headers` so this stays a pure,
// unit-testable function with no request-runtime dependency.
export function resolveLearningChatroomShareViewerKey(
  getHeader: (name: string) => string | null | undefined,
): string {
  const realIp = resolveViewerIpKey(getHeader("x-real-ip"));
  if (realIp) {
    return realIp;
  }

  const forwarded = getHeader("x-forwarded-for");
  const firstHop = typeof forwarded === "string" ? forwarded.split(",")[0] : undefined;
  const forwardedIp = resolveViewerIpKey(firstHop);
  if (forwardedIp) {
    return forwardedIp;
  }

  return learningChatroomShareViewerUnknownKey;
}

// Reports whether a key is the shared fallback bucket rather than a real
// per-viewer one. Used for throttle telemetry: a deployment whose edge sets
// neither header collapses every viewer into one budget, and that is a
// misconfiguration an operator must be able to see.
export function isLearningChatroomShareUnknownViewerKey(key: string) {
  return key === learningChatroomShareViewerUnknownKey;
}

// Returns a bounded, validated key, or "" when the value is not an IP at all.
// Validation (not sanitization) is what bounds the key space: junk collapses to
// the shared unknown bucket instead of minting a bucket per distinct junk value.
function resolveViewerIpKey(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  const candidate = value.trim().slice(0, learningChatroomShareViewerIpMaxLength);
  // A link-local zone id ("fe80::1%eth0") is not part of the routable address.
  const address = candidate.split("%")[0];

  const version = isIP(address);
  if (version === 4) {
    return `share-viewer-ip4-${address}`;
  }
  if (version === 6) {
    return `share-viewer-ip6-${toIpv6NetworkPrefix(address)}`;
  }
  return "";
}

// Folds a validated IPv6 address to its /64 network prefix, so every address a
// single subscriber allocation can emit shares one budget. Input is already
// known to be a valid IPv6 address, so this expands structure rather than
// re-validating it.
function toIpv6NetworkPrefix(address: string): string {
  const [head, tail] = address.split("::");
  const leading = expandIpv6Groups(head);
  const trailing = tail === undefined ? [] : expandIpv6Groups(tail);
  const groups =
    tail === undefined
      ? leading
      : [
          ...leading,
          ...Array<string>(Math.max(0, 8 - leading.length - trailing.length)).fill("0"),
          ...trailing,
        ];

  return Array.from(
    { length: learningChatroomShareViewerIpv6PrefixGroups },
    (_unused, index) => normalizeIpv6Group(groups[index]),
  ).join(":");
}

// An IPv6 address may carry a dotted-quad tail ("::ffff:192.0.2.1"), which
// occupies two 16-bit groups rather than one.
function expandIpv6Groups(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value.split(":").flatMap((group) => {
    if (!group.includes(".")) {
      return [group];
    }
    const octets = group.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
      return [group];
    }
    return [
      (((octets[0] << 8) | octets[1]) >>> 0).toString(16),
      (((octets[2] << 8) | octets[3]) >>> 0).toString(16),
    ];
  });
}

// Case and leading zeros are presentation, not identity: "2001:0DB8" and
// "2001:db8" must land in the same bucket or the fold is trivially defeated.
function normalizeIpv6Group(group: string | undefined) {
  if (!group) {
    return "0";
  }
  return group.toLowerCase().replace(/^0+(?=.)/, "");
}
