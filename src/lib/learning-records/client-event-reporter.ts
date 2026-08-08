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
    if (response.status >= 500) {
      // Server-side failure: allow a later interaction to retry. Client and
      // 424 (LRS unconfigured) responses stay deduplicated to avoid hammering.
      reportedEventKeys.delete(clientKey);
    }
  } catch {
    reportedEventKeys.delete(clientKey);
  }
}

export function resetReportedLearningEventsForTesting() {
  reportedEventKeys.clear();
}

function createUniqueKeySuffix() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
