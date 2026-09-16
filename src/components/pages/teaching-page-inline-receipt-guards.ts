// Pure inline teaching-operation receipt/auth-session guards (Phase 3 decomposition of
// teaching-page.tsx). Verify that an inline-operation backend receipt carries a signed,
// complete teacher-session audit before the UI treats the operation as durably applied.



import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type {
  InlineTeachingOperationAuditAuthSession,
  InlineTeachingOperationBackendReceipt,
} from "./teaching-page-types";

export function isPersistedInlineTeachingOperationReceipt(
  receipt: InlineTeachingOperationBackendReceipt | undefined,
) {
  return Boolean(receipt?.receiptId && receipt.status === "persisted");
}

export function hasSignedInlineTeachingOperationReceiptAudit(
  receipt: InlineTeachingOperationBackendReceipt | undefined,
) {
  return (
    receipt?.audit?.authMode === "signed-teacher-session" &&
    hasCompleteInlineTeachingAuthSession(receipt.audit.authSession)
  );
}

export function hasCompleteInlineTeachingAuthSession(
  authSession: InlineTeachingOperationAuditAuthSession | undefined,
): authSession is InlineTeachingOperationAuditAuthSession & {
  sessionId: string;
  authenticatedAt: string;
  expiresAt: string;
} {
  return (
    typeof authSession?.sessionId === "string" &&
    authSession.sessionId.trim().length > 0 &&
    typeof authSession.authenticatedAt === "string" &&
    authSession.authenticatedAt.trim().length > 0 &&
    typeof authSession.expiresAt === "string" &&
    authSession.expiresAt.trim().length > 0
  );
}

export function resolveVerifiedInlineAuditAuthSession(
  eventSession: InlineTeachingOperationAuditAuthSession | undefined,
  alreadyVerifiedReceiptSession?: InlineTeachingOperationAuditAuthSession,
) {
  if (hasCompleteInlineTeachingAuthSession(eventSession)) {
    return eventSession;
  }
  if (hasCompleteInlineTeachingAuthSession(alreadyVerifiedReceiptSession)) {
    return alreadyVerifiedReceiptSession;
  }
  return undefined;
}

export function isMismatchedInlineTeachingOperationReceipt(
  receipt: InlineTeachingOperationBackendReceipt | undefined,
  expected: {
    operationId: TeachingOperationId;
    actionSlot: "primary" | "secondary";
  },
) {
  if (!receipt) {
    return false;
  }
  if (receipt.operationId && receipt.operationId !== expected.operationId) {
    return true;
  }
  if (receipt.actionSlot && receipt.actionSlot !== expected.actionSlot) {
    return true;
  }
  return false;
}

export function isMismatchedOrIncompleteInlineTeachingOperationReceipt(
  receipt: InlineTeachingOperationBackendReceipt | undefined,
  expected: {
    operationId: TeachingOperationId;
    actionSlot: "primary" | "secondary";
  },
) {
  return (
    !receipt?.operationId ||
    !receipt.actionSlot ||
    isMismatchedInlineTeachingOperationReceipt(receipt, expected)
  );
}

export function isCourseSettingsPrimarySave(
  operationId: string | undefined,
  actionSlot: "primary" | "secondary" | undefined,
) {
  return operationId === "course-settings" && actionSlot === "primary";
}

