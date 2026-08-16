"use client";

// Class roster lifecycle handlers for the teacher workspace (plan E9): single
// approval, bulk approval, rejection, and removal.
//
// A sibling module rather than more of `use-teaching-workspace.tsx`, which sits
// at the 1500-code-line source cap. Every handler here follows the
// same contract that chain established - mutate, verify the persisted receipt
// names this action for this class, re-read GET /api/teaching/courses, verify the
// readback actually carries the change, and only then reconcile local state - so
// a roster row never reports a result the server has not confirmed.
//
// The routes are E8's: POST .../memberships/approve for the whole waiting list in
// one write, and PATCH .../memberships/[membershipId] for the two terminal
// statuses. Removal also frees the student's learning-group seats server-side, so
// the group panel is refreshed from the same readback.

import { useCallback, useState } from "react";
import { createMembershipApprovalFailureStatus } from "@/components/pages/teaching-page-helpers";
import {
  MEMBERSHIP_APPROVAL_FAILED_MESSAGE,
  MEMBERSHIP_APPROVAL_PENDING_MESSAGE,
  MEMBERSHIP_APPROVAL_READBACK_MISMATCH_MESSAGE,
  MEMBERSHIP_APPROVAL_READBACK_MISSING_MESSAGE,
  MEMBERSHIP_APPROVAL_RECEIPT_MISSING_MESSAGE,
} from "@/components/pages/teaching-page-messages";
import { localizedText } from "@/components/ui/localized-text";
import type { Locale, LocalizedText } from "@/i18n/copy";
import {
  createTeacherMembershipFromPersistedMembership,
  isMatchingMembershipApprovalResult,
  isPersistedMembershipApprovalReceipt,
} from "@/lib/teaching/course-readback";
import type {
  PersistedTeachingCourseReadback,
  TeacherClassItem,
  TeacherClassMembershipItem,
  TeachingClassMembershipApproveResponse,
  TeachingClassMembershipBulkApproveResponse,
  TeachingClassMembershipStatusResponse,
} from "@/lib/teaching/course-readback";

export type TeachingClassMembershipTerminalStatus = "rejected" | "removed";

const ROSTER_PENDING_MESSAGE: LocalizedText = {
  "zh-CN": "正在提交名单操作，请稍候。",
  "en-US": "Submitting the roster change. Please wait.",
};

const ROSTER_FAILED_MESSAGE: LocalizedText = {
  "zh-CN": "名单操作失败，请稍后再试。",
  "en-US": "The roster change failed. Please try again later.",
};

const ROSTER_RECEIPT_MISSING_MESSAGE: LocalizedText = {
  "zh-CN": "名单操作回执缺失，请稍后刷新确认。",
  "en-US": "The roster receipt was missing. Refresh and confirm shortly.",
};

const ROSTER_READBACK_MISMATCH_MESSAGE: LocalizedText = {
  "zh-CN": "名单读回未匹配本次操作，请稍后刷新。",
  "en-US": "The roster readback did not match this change. Refresh and try again.",
};

export function useTeachingClassMembershipLifecycle(input: {
  locale: Locale;
  readPersistedTeachingCourseState: () => Promise<PersistedTeachingCourseReadback>;
  applyPersistedTeachingCourseReadback: (readback: PersistedTeachingCourseReadback) => void;
}) {
  const { locale, readPersistedTeachingCourseState, applyPersistedTeachingCourseReadback } = input;
  // Keyed by class id: a bulk approval answers for the whole waiting list, not
  // for any one row.
  const [classRosterStatuses, setClassRosterStatuses] = useState<Record<string, string>>({});
  // Keyed by membership id, for the per-row reject/remove controls.
  const [membershipLifecycleStatuses, setMembershipLifecycleStatuses] = useState<
    Record<string, string>
  >({});
  // Rows with a request in flight, so a second click cannot open a second write
  // against the same course row.
  const [pendingMembershipIds, setPendingMembershipIds] = useState<string[]>([]);
  const [pendingBulkApprovalClassIds, setPendingBulkApprovalClassIds] = useState<string[]>([]);
  // The single-row approval, moved here from the workspace hook so the whole
  // membership story - approve one, approve all, reject, remove - reads in one
  // place and shares one status map.
  const [membershipApprovalStatuses, setMembershipApprovalStatuses] = useState<
    Record<string, string>
  >({});

  const approveClassMembership = useCallback(
    async (classItem: TeacherClassItem, membership: TeacherClassMembershipItem) => {
    setMembershipApprovalStatuses((currentStatuses) => ({
      ...currentStatuses,
      [membership.id]: localizedText(MEMBERSHIP_APPROVAL_PENDING_MESSAGE, locale),
    }));

    try {
      const response = await fetch(
        `/api/teaching/classes/${encodeURIComponent(classItem.id)}/memberships/${encodeURIComponent(
          membership.id,
        )}/approve`,
        {
          method: "POST",
          headers: { accept: "application/json" },
        },
      );
      const body = (await response.json().catch(() => null)) as
        | TeachingClassMembershipApproveResponse
        | null;
      if (!response.ok) {
        setMembershipApprovalStatuses((currentStatuses) => ({
          ...currentStatuses,
          [membership.id]: createMembershipApprovalFailureStatus(body, locale),
        }));
        return;
      }
      if (!body?.membership) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_FAILED_MESSAGE, locale));
      }

      const approvedMembership = createTeacherMembershipFromPersistedMembership(body.membership);
      if (!approvedMembership) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_FAILED_MESSAGE, locale));
      }
      if (
        !isMatchingMembershipApprovalResult({
          approvedMembership,
          requestedMembership: membership,
          requestedClass: classItem,
        })
      ) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_FAILED_MESSAGE, locale));
      }
      if (!isPersistedMembershipApprovalReceipt(body.receipt, classItem)) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_RECEIPT_MISSING_MESSAGE, locale));
      }

      const readback = await readPersistedTeachingCourseState();
      const readbackMembership = (readback.membershipsByClass[classItem.id] ?? []).find(
        (persistedMembership) => persistedMembership.id === approvedMembership.id,
      );
      if (!readbackMembership) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_READBACK_MISSING_MESSAGE, locale));
      }
      if (
        !isMatchingMembershipApprovalResult({
          approvedMembership: readbackMembership,
          requestedMembership: membership,
          requestedClass: classItem,
        })
      ) {
        throw new Error(localizedText(MEMBERSHIP_APPROVAL_READBACK_MISMATCH_MESSAGE, locale));
      }

      applyPersistedTeachingCourseReadback(readback);
      setMembershipApprovalStatuses((currentStatuses) => ({
        ...currentStatuses,
        [membership.id]:
          locale === "zh-CN"
            ? `${readbackMembership.studentDisplayName} 已加入${classItem.name}。`
            : `${readbackMembership.studentDisplayName} joined ${classItem.name}.`,
      }));
    } catch (error) {
      setMembershipApprovalStatuses((currentStatuses) => ({
        ...currentStatuses,
        [membership.id]:
          error instanceof Error && error.message
            ? error.message
            : localizedText(MEMBERSHIP_APPROVAL_FAILED_MESSAGE, locale),
      }));
    }
    },
    [applyPersistedTeachingCourseReadback, locale, readPersistedTeachingCourseState],
  );


  const approveAllPendingMemberships = useCallback(
    async (classItem: TeacherClassItem, pendingMemberships: TeacherClassMembershipItem[]) => {
      const expectedMembershipIds = pendingMemberships.map((membership) => membership.id);
      if (expectedMembershipIds.length === 0) {
        return;
      }

      setPendingBulkApprovalClassIds((currentClassIds) =>
        currentClassIds.includes(classItem.id) ? currentClassIds : [...currentClassIds, classItem.id],
      );
      setClassRosterStatuses((currentStatuses) => ({
        ...currentStatuses,
        [classItem.id]: localizedText(ROSTER_PENDING_MESSAGE, locale),
      }));

      try {
        const response = await fetch(
          `/api/teaching/classes/${encodeURIComponent(classItem.id)}/memberships/approve`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            // The ids the teacher was actually shown, never an empty body: the
            // list on screen is a snapshot, and "approve everyone waiting" would
            // also sweep in requests that arrived after they read it.
            body: JSON.stringify({ membershipIds: expectedMembershipIds }),
          },
        );
        const body = (await response.json().catch(() => null)) as
          | TeachingClassMembershipBulkApproveResponse
          | null;
        if (!response.ok) {
          setClassRosterStatuses((currentStatuses) => ({
            ...currentStatuses,
            [classItem.id]: createRosterFailureMessage(body, locale),
          }));
          return;
        }
        if (!isPersistedBulkApprovalReceipt(body?.receipt, classItem)) {
          throw new Error(localizedText(ROSTER_RECEIPT_MISSING_MESSAGE, locale));
        }

        const readback = await readPersistedTeachingCourseState();
        const readbackMemberships = readback.membershipsByClass[classItem.id] ?? [];
        const approvedMembershipIds = body?.approvedMembershipIds ?? [];
        const unconfirmed = approvedMembershipIds.filter(
          (membershipId) =>
            !readbackMemberships.some(
              (membership) =>
                membership.id === membershipId && membership.membershipStatus === "approved",
            ),
        );
        if (unconfirmed.length > 0) {
          throw new Error(localizedText(ROSTER_READBACK_MISMATCH_MESSAGE, locale));
        }

        applyPersistedTeachingCourseReadback(readback);
        setClassRosterStatuses((currentStatuses) => ({
          ...currentStatuses,
          [classItem.id]: createBulkApprovalSummary(body, classItem, locale),
        }));
      } catch (error) {
        setClassRosterStatuses((currentStatuses) => ({
          ...currentStatuses,
          [classItem.id]:
            error instanceof Error && error.message
              ? error.message
              : localizedText(ROSTER_FAILED_MESSAGE, locale),
        }));
      } finally {
        setPendingBulkApprovalClassIds((currentClassIds) =>
          currentClassIds.filter((classId) => classId !== classItem.id),
        );
      }
    },
    [applyPersistedTeachingCourseReadback, locale, readPersistedTeachingCourseState],
  );

  const setMembershipStatus = useCallback(
    async (
      classItem: TeacherClassItem,
      membership: TeacherClassMembershipItem,
      membershipStatus: TeachingClassMembershipTerminalStatus,
    ) => {
      setPendingMembershipIds((currentIds) =>
        currentIds.includes(membership.id) ? currentIds : [...currentIds, membership.id],
      );
      setMembershipLifecycleStatuses((currentStatuses) => ({
        ...currentStatuses,
        [membership.id]: localizedText(ROSTER_PENDING_MESSAGE, locale),
      }));

      try {
        const response = await fetch(
          `/api/teaching/classes/${encodeURIComponent(classItem.id)}/memberships/${encodeURIComponent(
            membership.id,
          )}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ membershipStatus }),
          },
        );
        const body = (await response.json().catch(() => null)) as
          | TeachingClassMembershipStatusResponse
          | null;
        if (!response.ok) {
          setMembershipLifecycleStatuses((currentStatuses) => ({
            ...currentStatuses,
            [membership.id]: createRosterFailureMessage(body, locale),
          }));
          return;
        }
        if (!isPersistedMembershipStatusReceipt(body?.receipt, classItem, membershipStatus)) {
          throw new Error(localizedText(ROSTER_RECEIPT_MISSING_MESSAGE, locale));
        }

        const readback = await readPersistedTeachingCourseState();
        const readbackMembership = (readback.membershipsByClass[classItem.id] ?? []).find(
          (persistedMembership) => persistedMembership.id === membership.id,
        );
        if (readbackMembership?.membershipStatus !== membershipStatus) {
          throw new Error(localizedText(ROSTER_READBACK_MISMATCH_MESSAGE, locale));
        }

        applyPersistedTeachingCourseReadback(readback);
        setMembershipLifecycleStatuses((currentStatuses) => ({
          ...currentStatuses,
          [membership.id]: createMembershipStatusSummary(
            membership,
            classItem,
            membershipStatus,
            body?.releasedGroupIds ?? [],
            locale,
          ),
        }));
      } catch (error) {
        setMembershipLifecycleStatuses((currentStatuses) => ({
          ...currentStatuses,
          [membership.id]:
            error instanceof Error && error.message
              ? error.message
              : localizedText(ROSTER_FAILED_MESSAGE, locale),
        }));
      } finally {
        setPendingMembershipIds((currentIds) =>
          currentIds.filter((membershipId) => membershipId !== membership.id),
        );
      }
    },
    [applyPersistedTeachingCourseReadback, locale, readPersistedTeachingCourseState],
  );

  return {
    membershipApprovalStatuses,
    approveClassMembership,
    classRosterStatuses,
    membershipLifecycleStatuses,
    pendingBulkApprovalClassIds,
    pendingMembershipIds,
    approveAllPendingMemberships,
    rejectMembership: useCallback(
      (classItem: TeacherClassItem, membership: TeacherClassMembershipItem) =>
        setMembershipStatus(classItem, membership, "rejected"),
      [setMembershipStatus],
    ),
    removeMembership: useCallback(
      (classItem: TeacherClassItem, membership: TeacherClassMembershipItem) =>
        setMembershipStatus(classItem, membership, "removed"),
      [setMembershipStatus],
    ),
  };
}

function isPersistedBulkApprovalReceipt(
  receipt: TeachingClassMembershipBulkApproveResponse["receipt"] | undefined,
  classItem: TeacherClassItem,
) {
  return (
    receipt?.action === "approve-class-memberships" &&
    receipt.status === "persisted" &&
    typeof receipt.actorId === "string" &&
    receipt.actorId.trim().length > 0 &&
    receipt.courseId === classItem.courseId &&
    receipt.classId === classItem.id
  );
}

function isPersistedMembershipStatusReceipt(
  receipt: TeachingClassMembershipStatusResponse["receipt"] | undefined,
  classItem: TeacherClassItem,
  membershipStatus: TeachingClassMembershipTerminalStatus,
) {
  const expectedAction =
    membershipStatus === "rejected" ? "reject-class-membership" : "remove-class-membership";
  return (
    receipt?.action === expectedAction &&
    receipt.status === "persisted" &&
    typeof receipt.actorId === "string" &&
    receipt.actorId.trim().length > 0 &&
    receipt.courseId === classItem.courseId &&
    receipt.classId === classItem.id
  );
}

// The count the server actually moved, plus the two buckets it refused to move.
// "Approved 200" when 3 rows were already closed would be the same dishonesty the
// hardcoded invite metadata was.
function createBulkApprovalSummary(
  body: TeachingClassMembershipBulkApproveResponse | null,
  classItem: TeacherClassItem,
  locale: Locale,
) {
  const approvedCount = body?.approvedCount ?? body?.approvedMembershipIds?.length ?? 0;
  const alreadyApprovedCount = body?.alreadyApprovedMembershipIds?.length ?? 0;
  const ineligibleCount = body?.ineligibleMembershipIds?.length ?? 0;
  const base =
    locale === "zh-CN"
      ? `已批准 ${approvedCount} 人加入${classItem.name}。`
      : `Approved ${approvedCount} join ${approvedCount === 1 ? "request" : "requests"} for ${classItem.name}.`;
  const notes: string[] = [];
  if (alreadyApprovedCount > 0) {
    notes.push(
      locale === "zh-CN"
        ? `${alreadyApprovedCount} 人此前已批准。`
        : `${alreadyApprovedCount} were already approved.`,
    );
  }
  if (ineligibleCount > 0) {
    notes.push(
      locale === "zh-CN"
        ? `${ineligibleCount} 条申请已关闭，需要学生重新加入。`
        : `${ineligibleCount} were already closed and need the student to re-join.`,
    );
  }
  return [base, ...notes].join(locale === "zh-CN" ? "" : " ");
}

function createMembershipStatusSummary(
  membership: TeacherClassMembershipItem,
  classItem: TeacherClassItem,
  membershipStatus: TeachingClassMembershipTerminalStatus,
  releasedGroupIds: string[],
  locale: Locale,
) {
  const base =
    membershipStatus === "rejected"
      ? locale === "zh-CN"
        ? `已拒绝 ${membership.studentDisplayName} 的加入申请。`
        : `Rejected the join request from ${membership.studentDisplayName}.`
      : locale === "zh-CN"
        ? `已将 ${membership.studentDisplayName} 移出${classItem.name}。`
        : `Removed ${membership.studentDisplayName} from ${classItem.name}.`;
  if (releasedGroupIds.length === 0) {
    return base;
  }
  const released =
    locale === "zh-CN"
      ? `同时退出了 ${releasedGroupIds.length} 个小组。`
      : `${releasedGroupIds.length} group ${releasedGroupIds.length === 1 ? "seat was" : "seats were"} freed.`;
  return locale === "zh-CN" ? `${base}${released}` : `${base} ${released}`;
}

function createRosterFailureMessage(
  body:
    | TeachingClassMembershipBulkApproveResponse
    | TeachingClassMembershipStatusResponse
    | null,
  locale: Locale,
) {
  const base = body?.error?.trim() || localizedText(ROSTER_FAILED_MESSAGE, locale);
  if (!body?.traceId) {
    return base;
  }
  return locale === "zh-CN"
    ? `${base}追踪编号：${body.traceId}`
    : `${base} Trace ID: ${body.traceId}`;
}
