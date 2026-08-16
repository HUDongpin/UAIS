import type { LearningRecordEventInput } from "@/lib/learning-records/xapi-events";

// Browser-side fire-and-forget reporter for POST /api/learning-records/events.
// Type-only import above keeps `node:crypto` (used by xapi-events at runtime)
// out of the client bundle.

export type ReportLearningEventInput = {
  actorId: string;
  event: LearningRecordEventInput;
  idempotencyKey?: string;
};

const reportedEventKeys = new Set<string>();

export function createLearningEventClientKey(input: ReportLearningEventInput) {
  return (
    input.idempotencyKey ??
    [
      input.actorId,
      input.event.type,
      input.event.context.courseId,
      input.event.object.id,
    ].join(":")
  );
}

export function createUniqueLearningEventKey(...parts: string[]) {
  return [...parts, createUniqueKeySuffix()].join(":");
}

export async function reportLearningEvent(
  input: ReportLearningEventInput,
): Promise<void> {
  const clientKey = createLearningEventClientKey(input);
  if (reportedEventKeys.has(clientKey)) {
    return;
  }
  reportedEventKeys.add(clientKey);

  try {
    const response = await fetch("/api/learning-records/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      // The event may be emitted right before a navigation (e.g. narration
      // finishing as the learner leaves); keepalive lets the write complete.
      keepalive: true,
      body: JSON.stringify({
        actorId: input.actorId,
        event: input.event,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      }),
    });
    if (response.status >= 500 || isRecoverableSessionDenial(response.status)) {
      // Server-side failure, or a refusal the learner can clear: allow a later
      // interaction to retry. Every other client response - including 424 (LRS
      // unconfigured) - stays deduplicated to avoid hammering.
      reportedEventKeys.delete(clientKey);
    }
  } catch {
    reportedEventKeys.delete(clientKey);
  }
}

export function resetReportedLearningEventsForTesting() {
  reportedEventKeys.clear();
}

// 401 and 403 are the two refusals the learner can clear without the event
// changing at all: the app session expired mid-page, or it had not been
// established yet when the event fired. The dedupe key used to survive them for
// the whole page session, so an expired cookie swallowed that event key
// permanently - including after the learner signed back in in another tab, when
// the very next attempt would have been accepted. 424 (the LRS is not
// configured) and the remaining 4xx keep their key on purpose: nothing the
// learner does changes those answers, and retrying would only hammer the route.
function isRecoverableSessionDenial(status: number) {
  return status === 401 || status === 403;
}

function createUniqueKeySuffix() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
