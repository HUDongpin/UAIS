// In-process fixed-window rate limiter for the routes that spend real provider
// money. Every allowed request costs a live completion, so an unthrottled route
// is an open wallet: one authenticated actor can drive unbounded provider spend.
//
// Fixed window rather than a token bucket because the state is trivially
// serializable per key, `Retry-After` falls straight out of the window reset,
// and the whole thing stays testable through an injected clock.
//
// Scope and limits: this is per process. A serverless deployment runs several
// instances, so the effective ceiling is `limit x instances`. That is enough to
// turn "unbounded" into "bounded and small"; a hard global cap needs shared
// storage (Redis/Postgres) and is a separate S12 decision.

export type AiRequestRateLimitMode = "enforce" | "off";

export type AiRequestRateLimitWindowConfig = {
  // Stable id reported on throttle events so operators can tell which window
  // rejected the request (for example "per-minute" against "per-day").
  id: string;
  limit: number;
  windowMs: number;
};

export type AiRequestRateLimitConfig = {
  mode: AiRequestRateLimitMode;
  windows: AiRequestRateLimitWindowConfig[];
};

export type AiRequestRateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      windowId: string;
      limit: number;
      retryAfterSeconds: number;
    };

export type AiRequestRateLimiter = {
  // Consumes one request against `key` when it is allowed. A rejected request
  // consumes nothing, so a client hammering the short window cannot burn the
  // long-window budget without ever getting an answer.
  check(input: { key: string; nowMs: number }): AiRequestRateLimitDecision;
};

// Bounds the in-process key map. Each entry is a handful of numbers, so this
// cap is about refusing unbounded growth, not about saving meaningful memory.
const defaultMaxTrackedKeys = 10000;
// When the cap is reached, evict down to this fraction of it rather than to the
// cap itself. Trimming to exactly the cap makes the map oscillate across the
// limit, so the O(n log n) fallback sweep below would run on EVERY subsequent
// request; trimming to a low-water mark amortizes it over the keys it freed.
// This matters because at least one caller keys on a value the client
// influences (the public share page's viewer IP), where a stream of distinct
// keys is a realistic input rather than a hypothetical one.
const evictionLowWaterMarkRatio = 0.9;

type AiRequestRateLimitBucket = {
  lastSeenMs: number;
  windows: Array<{ startMs: number; count: number }>;
};

export function createAiRequestRateLimiter(input: {
  config: AiRequestRateLimitConfig;
  maxTrackedKeys?: number;
}): AiRequestRateLimiter {
  const windows = input.config.windows.filter(
    (window) => window.limit > 0 && window.windowMs > 0,
  );
  const maxTrackedKeys = input.maxTrackedKeys ?? defaultMaxTrackedKeys;
  const staleAfterMs = windows.reduce((longest, window) => Math.max(longest, window.windowMs), 0);
  const buckets = new Map<string, AiRequestRateLimitBucket>();
  const enforcing = input.config.mode === "enforce" && windows.length > 0;

  return {
    check({ key, nowMs }) {
      if (!enforcing) {
        return { allowed: true };
      }

      evictStaleBuckets(buckets, { nowMs, staleAfterMs, maxTrackedKeys });

      const bucket = buckets.get(key) ?? createBucket(windows.length, nowMs);
      buckets.set(key, bucket);
      bucket.lastSeenMs = nowMs;

      windows.forEach((window, index) => {
        const state = bucket.windows[index];
        if (nowMs - state.startMs >= window.windowMs) {
          state.startMs = nowMs;
          state.count = 0;
        }
      });

      // When several windows are already full the caller must wait for the one
      // that resets last, otherwise `Retry-After` promises a retry that is still
      // rejected.
      let rejection: { windowId: string; limit: number; resetAtMs: number } | undefined;
      for (const [index, window] of windows.entries()) {
        const state = bucket.windows[index];
        if (state.count < window.limit) {
          continue;
        }
        const resetAtMs = state.startMs + window.windowMs;
        if (!rejection || resetAtMs > rejection.resetAtMs) {
          rejection = { windowId: window.id, limit: window.limit, resetAtMs };
        }
      }

      if (rejection) {
        return {
          allowed: false,
          windowId: rejection.windowId,
          limit: rejection.limit,
          // `Retry-After` is whole seconds and must never be 0: a 0 tells the
          // client to retry immediately into the same rejection.
          retryAfterSeconds: Math.max(1, Math.ceil((rejection.resetAtMs - nowMs) / 1000)),
        };
      }

      bucket.windows.forEach((state) => {
        state.count += 1;
      });
      return { allowed: true };
    },
  };
}

// `enforce` unless the operator explicitly turns the limiter off, so a typo in
// the env value fails closed onto the protective default.
export function resolveAiRequestRateLimitMode(
  value: string | undefined,
): AiRequestRateLimitMode {
  return value?.trim().toLowerCase() === "off" ? "off" : "enforce";
}

// Falls back to the safe default for anything that is not a positive integer,
// including `0`: the only supported kill switch is the mode variable, so a
// malformed limit can never silently disable protection.
export function resolveAiRequestRateLimitCount(
  value: string | undefined,
  fallbackLimit: number,
): number {
  const parsed = Number(value?.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallbackLimit;
  }
  return parsed;
}

function createBucket(windowCount: number, nowMs: number): AiRequestRateLimitBucket {
  return {
    lastSeenMs: nowMs,
    windows: Array.from({ length: windowCount }, () => ({ startMs: nowMs, count: 0 })),
  };
}

// Sweeping only once the map is over its cap keeps the common request path O(1);
// the sweep itself is O(n) but runs rarely and on a map bounded by the cap.
function evictStaleBuckets(
  buckets: Map<string, AiRequestRateLimitBucket>,
  input: { nowMs: number; staleAfterMs: number; maxTrackedKeys: number },
) {
  if (buckets.size <= input.maxTrackedKeys) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (input.nowMs - bucket.lastSeenMs >= input.staleAfterMs) {
      buckets.delete(key);
    }
  }

  if (buckets.size <= input.maxTrackedKeys) {
    return;
  }

  // Still over the cap with every tracked key active: drop the least recently
  // seen keys. Those actors lose their accumulated counts, which is the safe
  // direction to fail - it never rejects a request that should be allowed.
  //
  // Trim to the low-water mark, not back to the cap: freeing a single key would
  // put the map one request away from overflowing again, so this sweep would
  // repeat on every call and its cost would dominate the whole process.
  const targetSize = Math.floor(input.maxTrackedKeys * evictionLowWaterMarkRatio);
  const evictionCount = buckets.size - targetSize;
  if (evictionCount <= 0) {
    return;
  }
  const byOldestFirst = [...buckets.entries()].sort(
    ([, left], [, right]) => left.lastSeenMs - right.lastSeenMs,
  );
  for (const [key] of byOldestFirst.slice(0, evictionCount)) {
    buckets.delete(key);
  }
}
