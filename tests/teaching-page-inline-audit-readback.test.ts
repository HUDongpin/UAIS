import { describe, expect, it } from "vitest";
import {
  createTeachingOperationAuditReadbackRequestInit,
  isMissingSavedTeachingOperationAuditRecord,
  isMissingSavedTeachingOperationAuditTrace,
} from "@/components/pages/teaching-page-inline-audit-readback";
import {
  isCourseSettingsPrimarySave,
  resolveVerifiedInlineAuditAuthSession,
} from "@/components/pages/teaching-page-inline-receipt-guards";

const signedSession = {
  sessionId: "teacher-inline-session",
  authenticatedAt: "2026-06-22T10:40:00.000Z",
  expiresAt: "2026-06-22T11:40:00.000Z",
};

describe("inline teaching operation audit readback helpers", () => {
  it("reuses the signed POST receipt session when the audit list redacts authSession", () => {
    expect(
      resolveVerifiedInlineAuditAuthSession(undefined, signedSession),
    ).toEqual(signedSession);
    expect(
      resolveVerifiedInlineAuditAuthSession({ sessionId: "weak-only" }, signedSession),
    ).toEqual(signedSession);
  });

  it("still requires a complete session when neither the list event nor the receipt has one", () => {
    expect(resolveVerifiedInlineAuditAuthSession(undefined, undefined)).toBeUndefined();
    expect(
      resolveVerifiedInlineAuditAuthSession({ sessionId: "weak-only" }, undefined),
    ).toBeUndefined();
  });

  it("detects a missing just-written trace or record in an unscoped audit list", () => {
    expect(
      isMissingSavedTeachingOperationAuditTrace(
        { auditEvents: [] },
        {
          traceId: "trace-owned-course-settings-save",
          courseId: "teacher-course-uais-qa-test-owned-20260915-140423",
        },
      ),
    ).toBe(true);
    expect(
      isMissingSavedTeachingOperationAuditRecord(
        { records: [{ recordId: "other-record" }] },
        "operation-record-course-settings-primary",
      ),
    ).toBe(true);
    expect(
      isMissingSavedTeachingOperationAuditTrace(
        {
          auditEvents: [
            {
              traceId: "trace-owned-course-settings-save",
              courseId: "teacher-course-uais-qa-test-owned-20260915-140423",
            },
          ],
        },
        {
          traceId: "trace-owned-course-settings-save",
          courseId: "teacher-course-uais-qa-test-owned-20260915-140423",
        },
      ),
    ).toBe(false);
  });

  it("sends the save trace id on audit GET so readback can be correlated", () => {
    expect(createTeachingOperationAuditReadbackRequestInit("trace-owned-course-settings-save")).toEqual({
      method: "GET",
      headers: {
        accept: "application/json",
        "x-uais-trace-id": "trace-owned-course-settings-save",
      },
    });
  });

  it("scopes audit GET to the owned course being saved", () => {
    expect(
      createTeachingOperationAuditReadbackRequestInit(
        "trace-owned-course-settings-save",
        "teacher-course-uais-qa-test-owned-20260915-140423",
      ),
    ).toEqual({
      method: "GET",
      headers: {
        accept: "application/json",
        "x-uais-trace-id": "trace-owned-course-settings-save",
        "x-uais-course-id": "teacher-course-uais-qa-test-owned-20260915-140423",
      },
    });
  });

  it("treats course-settings primary saves as persist-confirmed without requiring audit GET", () => {
    expect(isCourseSettingsPrimarySave("course-settings", "primary")).toBe(true);
    expect(isCourseSettingsPrimarySave("course-settings", "secondary")).toBe(false);
    expect(isCourseSettingsPrimarySave("invite-code", "primary")).toBe(false);
  });
});
