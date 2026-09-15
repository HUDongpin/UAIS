import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type { CourseSettingsPatchPayload } from "@/lib/teaching/course-readback";
import { resolveVerifiedInlineAuditAuthSession } from "./teaching-page-inline-receipt-guards";
import {
  doesInlineCourseSettingsProjectionMatchPatch,
  doesInlineDomainReadbackMatchBusinessSemantics,
  findMatchingInlineDomainProjection,
  findMatchingInlineDomainProjections,
} from "./teaching-page-projection-verifiers";
import type {
  InlineTeachingOperationAuditAuthSession,
  InlineTeachingOperationAuditEvent,
  InlineTeachingOperationAuditReadbackResponse,
  InlineTeachingOperationDomainProjection,
  InlineTeachingOperationRecord,
} from "./teaching-page-types";

export const TEACHING_OPERATION_AUDIT_READBACK_MAX_ATTEMPTS = 3;
export const TEACHING_OPERATION_AUDIT_READBACK_RETRY_DELAY_MS = 50;

export function createTeachingOperationAuditReadbackRequestInit(
  traceId: string,
  courseId?: string,
): RequestInit {
  const trimmedCourseId = courseId?.trim();
  return {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-uais-trace-id": traceId,
      ...(trimmedCourseId ? { "x-uais-course-id": trimmedCourseId } : {}),
    },
  };
}

export function isMissingSavedTeachingOperationAuditTrace(
  audit:
    | {
        auditEvents?: Array<{
          traceId?: string;
          courseId?: string;
        }>;
      }
    | undefined,
  expected: {
    traceId: string;
    courseId?: string;
  },
) {
  return !audit?.auditEvents?.some((event) => {
    if (event.traceId !== expected.traceId) {
      return false;
    }
    return expected.courseId ? event.courseId === expected.courseId : true;
  });
}

export function isMissingSavedTeachingOperationAuditRecord(
  audit:
    | {
        records?: Array<{
          recordId?: string;
        }>;
      }
    | undefined,
  recordId: string,
) {
  return !audit?.records?.some((record) => record.recordId === recordId);
}

export async function waitForTeachingOperationAuditReadbackRetry() {
  await new Promise((resolve) =>
    setTimeout(resolve, TEACHING_OPERATION_AUDIT_READBACK_RETRY_DELAY_MS),
  );
}

export async function fetchTeachingOperationAuditReadbackWithRetry<
  T extends {
    auditEvents?: Array<{
      traceId?: string;
      courseId?: string;
    }>;
    records?: Array<{
      recordId?: string;
    }>;
  },
>(input: {
  traceId: string;
  courseId?: string;
  recordId?: string;
  isCurrentAttempt?: () => boolean;
}): Promise<T | undefined> {
  let payload: T | undefined;
  for (
    let readbackAttempt = 1;
    readbackAttempt <= TEACHING_OPERATION_AUDIT_READBACK_MAX_ATTEMPTS;
    readbackAttempt += 1
  ) {
    const response = await fetch(
      "/api/teaching/operations/audit",
      createTeachingOperationAuditReadbackRequestInit(input.traceId, input.courseId),
    );
    if (!response.ok) {
      throw new Error("Teaching operation audit readback failed.");
    }
    payload = (await response.json()) as T;
    if (input.isCurrentAttempt && !input.isCurrentAttempt()) {
      return undefined;
    }
    const missingSavedTrace = isMissingSavedTeachingOperationAuditTrace(payload, {
      traceId: input.traceId,
      courseId: input.courseId,
    });
    const missingSavedRecord =
      Boolean(input.recordId) &&
      isMissingSavedTeachingOperationAuditRecord(payload, input.recordId as string);
    if (!missingSavedTrace && !missingSavedRecord) {
      return payload;
    }
    if (readbackAttempt === TEACHING_OPERATION_AUDIT_READBACK_MAX_ATTEMPTS) {
      return payload;
    }
    await waitForTeachingOperationAuditReadbackRetry();
  }
  return payload;
}

export function isInlineAuditRecordForAction(
  record: InlineTeachingOperationRecord,
  input: {
    courseId?: string;
    operationId: TeachingOperationId;
    actionSlot: "primary" | "secondary";
  },
) {
  if (input.courseId && record.courseId !== input.courseId) {
    return false;
  }
  if (record.operationId && record.operationId !== input.operationId) {
    return false;
  }
  if (record.actionSlot && record.actionSlot !== input.actionSlot) {
    return false;
  }
  return true;
}

export type InlineTeachingOperationAuditMatchReason =
  | "missing-event"
  | "missing-record"
  | "missing-projection"
  | "patch-mismatch"
  | "semantic-mismatch"
  | "missing-session";

export type InlineTeachingOperationAuditMatch =
  | {
      status: "matched";
      matchingAuditEvent: InlineTeachingOperationAuditEvent;
      matchingRecord?: InlineTeachingOperationRecord;
      matchingDomainProjection: InlineTeachingOperationDomainProjection;
      matchingDomainProjections: InlineTeachingOperationDomainProjection[];
      verifiedAuthSession: InlineTeachingOperationAuditAuthSession & {
        sessionId: string;
        authenticatedAt: string;
        expiresAt: string;
      };
    }
  | {
      status: "incomplete";
      reason: InlineTeachingOperationAuditMatchReason;
    };

export function resolveInlineTeachingOperationAuditMatch(input: {
  audit: InlineTeachingOperationAuditReadbackResponse;
  traceId: string;
  courseId?: string;
  recordId: string;
  operationId: TeachingOperationId;
  actionSlot: "primary" | "secondary";
  courseSettingsPatch?: CourseSettingsPatchPayload;
  verifiedReceiptAuthSession?: InlineTeachingOperationAuditAuthSession;
}): InlineTeachingOperationAuditMatch {
  const matchingAuditEvent = input.audit.auditEvents?.find((event) => {
    if (event.traceId !== input.traceId) {
      return false;
    }
    return input.courseId ? event.courseId === input.courseId : true;
  });
  const matchingRecord = input.recordId
    ? input.audit.records?.find((record) => {
        if (record.recordId !== input.recordId) {
          return false;
        }
        return isInlineAuditRecordForAction(record, {
          courseId: input.courseId,
          operationId: input.operationId,
          actionSlot: input.actionSlot,
        });
      })
    : undefined;
  if (!matchingAuditEvent) {
    return { status: "incomplete", reason: "missing-event" };
  }
  if (input.recordId && !matchingRecord) {
    return { status: "incomplete", reason: "missing-record" };
  }
  const matchingDomainProjection = findMatchingInlineDomainProjection(
    input.audit.domainProjections,
    {
      courseId: input.courseId,
      operationId: input.operationId,
      actionSlot: input.actionSlot,
      recordId: input.recordId,
    },
  );
  if (!matchingDomainProjection?.objectId || !matchingDomainProjection.objectType) {
    return { status: "incomplete", reason: "missing-projection" };
  }
  const matchingDomainProjections = findMatchingInlineDomainProjections(
    input.audit.domainProjections,
    {
      courseId: input.courseId,
      operationId: input.operationId,
      actionSlot: input.actionSlot,
      recordId: input.recordId,
    },
  );
  if (
    !doesInlineCourseSettingsProjectionMatchPatch(
      matchingDomainProjection,
      input.courseSettingsPatch,
    )
  ) {
    return { status: "incomplete", reason: "patch-mismatch" };
  }
  if (
    !doesInlineDomainReadbackMatchBusinessSemantics(matchingDomainProjections, {
      operationId: input.operationId,
      actionSlot: input.actionSlot,
    })
  ) {
    return { status: "incomplete", reason: "semantic-mismatch" };
  }
  const verifiedAuthSession = resolveVerifiedInlineAuditAuthSession(
    matchingAuditEvent.authSession,
    input.verifiedReceiptAuthSession,
  );
  if (!verifiedAuthSession) {
    return { status: "incomplete", reason: "missing-session" };
  }
  return {
    status: "matched",
    matchingAuditEvent,
    matchingRecord,
    matchingDomainProjection,
    matchingDomainProjections,
    verifiedAuthSession,
  };
}
