export const TEACHING_OPERATION_AUDIT_READBACK_MAX_ATTEMPTS = 3;
export const TEACHING_OPERATION_AUDIT_READBACK_RETRY_DELAY_MS = 50;

export function createTeachingOperationAuditReadbackRequestInit(traceId: string): RequestInit {
  return {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-uais-trace-id": traceId,
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
      createTeachingOperationAuditReadbackRequestInit(input.traceId),
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
