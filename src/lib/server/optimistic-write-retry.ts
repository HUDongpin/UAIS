// Shared retry policy for every optimistic-snapshot write loop in the server
// layer. Each of those loops is the same shape - read a snapshot with its
// revision, rebuild it, write it back guarded by that revision, and start over
// when a concurrent writer got there first - so the waiting policy between
// attempts belongs in one place rather than being re-derived per store.
//
// Decorrelated jitter, the AWS backoff: the next wait is drawn from
// [base, previous * 3] and clamped to a small cap. Retrying instantly - which is
// what a bare `continue` does - guarantees that the writers who lost the race
// re-read the same snapshot in the same millisecond and collide again, so the
// whole attempt ladder is spent inside a few milliseconds and the write is
// dropped. Randomised waits spread the losers apart instead. The cap stays small
// because the caller is a person waiting on a request, not a batch job.
export const optimisticWriteRetryBaseDelayMs = 25;
export const optimisticWriteRetryMaxDelayMs = 250;

// The machine-readable half of an exhausted-contention answer. Clients localize
// on this code, never on the prose message, so the message stays free to change.
export const snapshotContentionReasonCode = "snapshot-contention";

export type OptimisticWriteRetry = {
  maxAttempts: number;
  // Answers "was that a lost race worth another attempt?", and sleeps before
  // saying yes. Returns false on the last attempt, and on any error that is not
  // a snapshot conflict, so the caller rethrows unchanged.
  shouldRetry: (input: { attempt: number; error: unknown }) => Promise<boolean>;
  // Whether an error is a lost race at all. A conflict that survives a `false`
  // from `shouldRetry` is by definition an exhausted ladder, which is how a
  // caller knows to answer with its own structured contention error instead of
  // passing the backend's raw revision-mismatch prose to the client.
  isConflict: (error: unknown) => boolean;
};

export function createOptimisticWriteRetry(input: {
  maxAttempts: number;
  isConflict: (error: unknown) => boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
  // Both injectable so a test can pin the ladder without waiting on it.
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}): OptimisticWriteRetry {
  const sleep = input.sleep ?? sleepOptimisticWriteRetry;
  let previousDelayMs = 0;

  return {
    maxAttempts: input.maxAttempts,
    isConflict: input.isConflict,
    shouldRetry: async ({ attempt, error }) => {
      if (attempt >= input.maxAttempts - 1 || !input.isConflict(error)) {
        return false;
      }
      previousDelayMs = nextOptimisticWriteRetryDelayMs({
        previousDelayMs,
        ...(input.baseDelayMs === undefined ? {} : { baseDelayMs: input.baseDelayMs }),
        ...(input.maxDelayMs === undefined ? {} : { maxDelayMs: input.maxDelayMs }),
        ...(input.random ? { random: input.random() } : {}),
      });
      await sleep(previousDelayMs);
      return true;
    },
  };
}

// Exported for its own coverage: the property that matters is a spread, and a
// spread is only observable across many draws, which is unpleasant to assert
// through a whole write. `random` is injectable for the same reason.
export function nextOptimisticWriteRetryDelayMs(input: {
  previousDelayMs: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: number;
}) {
  const baseDelayMs = input.baseDelayMs ?? optimisticWriteRetryBaseDelayMs;
  const maxDelayMs = input.maxDelayMs ?? optimisticWriteRetryMaxDelayMs;
  const previousDelayMs = Math.max(input.previousDelayMs, baseDelayMs);
  const ceilingMs = Math.min(previousDelayMs * 3, maxDelayMs);
  const random = input.random ?? Math.random();
  return Math.round(baseDelayMs + random * (ceilingMs - baseDelayMs));
}

export async function sleepOptimisticWriteRetry(delayMs: number) {
  if (delayMs <= 0) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
