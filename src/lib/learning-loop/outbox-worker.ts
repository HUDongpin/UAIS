import { timingSafeEqual } from "node:crypto";
import {
  LrsWriteError,
  postXapiStatement,
  resolveLrsConfig,
} from "@/lib/learning-records/lrs-client";
import {
  createLearningEventStatement,
  type LearningRecordEventType,
} from "@/lib/learning-records/xapi-events";
import { getLearningOutboxRetryDelayMs } from "@/lib/learning-loop/outbox";

export type ClaimedLearningOutboxItem = {
  outboxId: string;
  learningEventId: string;
  statementId: string;
  attemptCount: number;
  actorId: string;
  actorRole: "student" | "teacher" | "admin";
  eventType: LearningRecordEventType;
  objectId: string;
  objectName: string;
  courseExternalId: string;
  classExternalId?: string;
  lessonKey?: string;
  context: Record<string, unknown>;
  occurredAt: string;
};

export type LearningOutboxDispatchStore = {
  claimBatch: (input: {
    workerId: string;
    limit: number;
    claimedAt: string;
  }) => Promise<ClaimedLearningOutboxItem[]>;
  markSent: (input: { outboxId: string; workerId: string; sentAt: string }) => Promise<void>;
  markFailed: (input: {
    outboxId: string;
    workerId: string;
    status: "failed" | "dead";
    attemptCount: number;
    errorCategory: string;
    nextAttemptAt: string;
  }) => Promise<void>;
  readOutboxBacklog?: (input: { now: string }) => Promise<{
    pendingCount: number;
    deadCount: number;
    maxAgeSeconds: number;
  }>;
};

export async function dispatchLearningOutboxBatch(input: {
  env: Record<string, string | undefined>;
  workerId: string;
  store: LearningOutboxDispatchStore;
  fetch?: typeof fetch;
  limit?: number;
  now?: () => Date;
}) {
  const lrs = resolveLrsConfig(input.env);
  if (lrs.status !== "ready") {
    return {
      target: "learning-xapi-outbox" as const,
      status: "blocked" as const,
      reasonCode: "lrs-not-configured" as const,
      valueRedacted: true as const,
    };
  }

  const now = input.now ?? (() => new Date());
  const claimedAt = now().toISOString();
  const items = await input.store.claimBatch({
    workerId: input.workerId,
    limit: Math.max(1, Math.min(100, Math.floor(input.limit ?? 25))),
    claimedAt,
  });
  let sent = 0;
  let failed = 0;
  let dead = 0;

  for (const item of items) {
    const deliveryTime = now();
    try {
      await postXapiStatement({
        config: lrs.config,
        fetch: input.fetch,
        statement: createRedactedOutboxStatement(item),
      });
      await input.store.markSent({
        outboxId: item.outboxId,
        workerId: input.workerId,
        sentAt: deliveryTime.toISOString(),
      });
      sent += 1;
    } catch (error) {
      const attemptCount = item.attemptCount + 1;
      const isDead = attemptCount >= 10;
      const nextAttemptAt = new Date(
        deliveryTime.getTime() + getLearningOutboxRetryDelayMs(attemptCount),
      ).toISOString();
      await input.store.markFailed({
        outboxId: item.outboxId,
        workerId: input.workerId,
        status: isDead ? "dead" : "failed",
        attemptCount,
        errorCategory: classifyLrsError(error),
        nextAttemptAt,
      });
      if (isDead) dead += 1;
      else failed += 1;
    }
  }

  const backlog = input.store.readOutboxBacklog
    ? await input.store.readOutboxBacklog({ now: now().toISOString() })
    : undefined;
  return {
    target: "learning-xapi-outbox" as const,
    status: "processed" as const,
    claimed: items.length,
    sent,
    failed,
    dead,
    ...(backlog
      ? {
          backlog,
          backlogStatus: classifyLearningOutboxBacklog(backlog),
        }
      : {}),
    valueRedacted: true as const,
  };
}

export function classifyLearningOutboxBacklog(input: {
  pendingCount: number;
  deadCount: number;
  maxAgeSeconds: number;
}) {
  if (input.deadCount > 0 || input.maxAgeSeconds > 60 * 60) return "critical" as const;
  if (input.pendingCount > 0 && input.maxAgeSeconds > 15 * 60) return "warning" as const;
  return "ok" as const;
}

export function isLearningOutboxSecretAuthorized(
  presented: string | undefined,
  configured: string | undefined,
) {
  if (!presented || !configured || configured.length < 32) return false;
  const presentedBytes = Buffer.from(presented);
  const configuredBytes = Buffer.from(configured);
  return (
    presentedBytes.byteLength === configuredBytes.byteLength &&
    timingSafeEqual(presentedBytes, configuredBytes)
  );
}

function createRedactedOutboxStatement(item: ClaimedLearningOutboxItem) {
  const rubricDimensionIds = Array.isArray(item.context.rubricDimensionIds)
    ? item.context.rubricDimensionIds.filter(
        (value): value is string =>
          typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value),
      )
    : [];
  const versionNo = readPositiveInteger(item.context.versionNo);
  return createLearningEventStatement({
    actor: {
      id: item.actorId,
      role:
        item.actorRole === "student"
          ? "learner"
          : item.actorRole === "teacher"
            ? "educator"
            : "admin",
    },
    event: {
      type: item.eventType,
      object: {
        id: item.objectId,
        name: item.objectName,
        type:
          item.eventType === "formative-check.attempted"
            ? "assessment-question"
            : "learning-activity",
      },
      ...(rubricDimensionIds.length > 0 || versionNo
        ? {
            result: {
              extensions: {
                ...(rubricDimensionIds.length > 0
                  ? {
                      "https://uais.top/xapi/extensions/rubric-dimension-ids":
                        rubricDimensionIds.join(","),
                    }
                  : {}),
                ...(versionNo
                  ? { "https://uais.top/xapi/extensions/submission-version": versionNo }
                  : {}),
              },
            },
          }
        : {}),
      context: {
        tenantId: "uais",
        courseId: item.courseExternalId,
        ...(item.classExternalId ? { classId: item.classExternalId } : {}),
        ...(item.lessonKey ? { lessonId: item.lessonKey } : {}),
      },
    },
    statementId: item.statementId,
    timestamp: item.occurredAt,
  });
}

function classifyLrsError(error: unknown) {
  if (error instanceof LrsWriteError) {
    return `lrs-http-${error.httpStatus}`;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "lrs-timeout";
  }
  return "lrs-delivery-failed";
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
