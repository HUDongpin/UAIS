"use client";

import { useCallback, useState } from "react";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { copy } from "@/i18n/copy";
import type { Locale } from "@/i18n/copy";

// Teacher learning-group (chatroom group) state + mutation handlers for the
// course-settings workspace (Phase 4). Every mutation follows the same
// receipt-and-readback contract the sibling create-class / approve-membership
// handlers use: POST/PATCH/DELETE, verify the persisted receipt matches the
// requested action and course, re-read GET /api/teaching/courses, verify the
// readback actually carries the mutation, and only then reconcile local state.
// A rejected verification throws a localized message so the caller (dialog or
// panel) surfaces it instead of showing an unverified success.
//
// This module is a sibling of `use-teaching-workspace.tsx` (which re-exports it)
// only because that file sits at the 1500-code-line lint cap; the two hooks are
// deliberately independent so the group readback cannot disturb the course /
// class / membership readback verification chains.

export const learningGroupMinMembers = 2;
export const learningGroupMaxMembers = 12;

export type TeachingLearningGroupMemberItem = {
  studentId: string;
  studentDisplayName: string;
  addedAt?: string;
};

export type TeachingLearningGroupItem = {
  groupId: string;
  courseId: string;
  classId?: string;
  groupName: string;
  members: TeachingLearningGroupMemberItem[];
};

export type TeachingLearningGroupDraft = {
  groupName: string;
  classId?: string;
  memberIds: string[];
};

export type TeachingLearningGroupPatch = {
  groupName?: string;
  memberIds?: string[];
};

type PersistedLearningGroupRecord = {
  groupId?: string;
  courseId?: string;
  classId?: string;
  groupName?: string;
  members?: Array<{
    studentId?: string;
    studentDisplayName?: string;
    addedAt?: string;
  }>;
};

type TeachingLearningGroupListResponse = {
  learningGroups?: PersistedLearningGroupRecord[];
  error?: string;
};

type TeachingLearningGroupReceipt = {
  receiptId?: string;
  action?: string;
  actorId?: string;
  courseId?: string;
  classId?: string;
  status?: string;
  traceId?: string;
};

type TeachingLearningGroupValidationPayload = {
  target?: string;
  status?: string;
  reasonCode?: string;
  field?: string;
  minMembers?: number;
  maxMembers?: number;
  memberIndex?: number;
};

type TeachingLearningGroupMutationResponse = {
  group?: PersistedLearningGroupRecord;
  receipt?: TeachingLearningGroupReceipt;
  receipts?: TeachingLearningGroupReceipt[];
  validation?: TeachingLearningGroupValidationPayload;
  access?: { reasonCode?: string };
  error?: string;
  traceId?: string;
};

type LearningGroupMutationAction =
  | "create-learning-group"
  | "update-learning-group-members"
  | "rename-learning-group"
  | "delete-learning-group";

export function useTeachingLearningGroupsWorkspace() {
  const { locale } = useAppPreferences();
  const t = copy[locale].teaching;
  const [learningGroupsByCourse, setLearningGroupsByCourse] = useState<
    Record<string, TeachingLearningGroupItem[]>
  >({});
  const [learningGroupStatuses, setLearningGroupStatuses] = useState<
    Record<string, string>
  >({});
  const [openLearningGroupCourseIds, setOpenLearningGroupCourseIds] = useState<
    string[]
  >([]);
  const [hasLoadedLearningGroups, setHasLoadedLearningGroups] = useState(false);

  const setLearningGroupStatus = useCallback((courseId: string, message?: string) => {
    setLearningGroupStatuses((currentStatuses) => {
      if (!message) {
        const nextStatuses = { ...currentStatuses };
        delete nextStatuses[courseId];
        return nextStatuses;
      }
      return { ...currentStatuses, [courseId]: message };
    });
  }, []);

  // The group readback rides the same signed teacher course list the workspace
  // already trusts; teachers receive the full group records for owned courses.
  const readPersistedLearningGroups = useCallback(async () => {
    let response: Response;
    let body: TeachingLearningGroupListResponse | null;
    try {
      response = await fetch("/api/teaching/courses", {
        method: "GET",
        headers: { accept: "application/json" },
      });
      body = (await response.json().catch(() => null)) as
        | TeachingLearningGroupListResponse
        | null;
    } catch {
      throw new Error(t.groupLoadFailed);
    }
    if (!response.ok || !body) {
      throw new Error(t.groupLoadFailed);
    }
    return createLearningGroupsByCourse(body.learningGroups ?? []);
  }, [t.groupLoadFailed]);

  const loadLearningGroups = useCallback(
    async (courseId: string) => {
      setLearningGroupStatus(courseId, t.groupLoading);
      try {
        const groupsByCourse = await readPersistedLearningGroups();
        setLearningGroupsByCourse(groupsByCourse);
        setHasLoadedLearningGroups(true);
        setLearningGroupStatus(courseId, undefined);
      } catch (error) {
        setLearningGroupStatus(
          courseId,
          error instanceof Error && error.message ? error.message : t.groupLoadFailed,
        );
      }
    },
    [readPersistedLearningGroups, setLearningGroupStatus, t.groupLoading, t.groupLoadFailed],
  );

  const toggleLearningGroupPanel = useCallback(
    (courseId: string) => {
      let willOpen = false;
      setOpenLearningGroupCourseIds((currentCourseIds) => {
        if (currentCourseIds.includes(courseId)) {
          return currentCourseIds.filter((openCourseId) => openCourseId !== courseId);
        }
        willOpen = true;
        return [...currentCourseIds, courseId];
      });
      if (willOpen && !hasLoadedLearningGroups) {
        void loadLearningGroups(courseId);
      }
    },
    [hasLoadedLearningGroups, loadLearningGroups],
  );

  // Mutation -> receipt verification -> readback verification -> reconcile.
  // `verifyReadback` runs against the freshly re-read groups for this course and
  // returns an error message when the persisted state does not match the request.
  const runVerifiedLearningGroupMutation = useCallback(
    async (input: {
      courseId: string;
      request: () => Promise<Response>;
      expectedReceiptActions: LearningGroupMutationAction[];
      readGroupId: (body: TeachingLearningGroupMutationResponse) => string | undefined;
      verifyReadback: (
        groups: TeachingLearningGroupItem[],
        groupId: string,
      ) => string | undefined;
      successMessage: string;
    }) => {
      const response = await input.request();
      const body = (await response.json().catch(() => null)) as
        | TeachingLearningGroupMutationResponse
        | null;
      if (!response.ok) {
        throw new Error(createLearningGroupFailureMessage(body, locale));
      }
      const groupId = body ? input.readGroupId(body) : undefined;
      if (!groupId) {
        throw new Error(t.groupSaveFailed);
      }
      if (
        !hasPersistedLearningGroupReceipts(body, input.expectedReceiptActions, input.courseId)
      ) {
        throw new Error(t.groupReceiptMissing);
      }

      const groupsByCourse = await readPersistedLearningGroups();
      const readbackMismatchMessage = input.verifyReadback(
        groupsByCourse[input.courseId] ?? [],
        groupId,
      );
      if (readbackMismatchMessage) {
        throw new Error(readbackMismatchMessage);
      }

      setLearningGroupsByCourse(groupsByCourse);
      setHasLoadedLearningGroups(true);
      setLearningGroupStatus(input.courseId, input.successMessage);
    },
    [
      locale,
      readPersistedLearningGroups,
      setLearningGroupStatus,
      t.groupReceiptMissing,
      t.groupSaveFailed,
    ],
  );

  const createLearningGroup = useCallback(
    async (courseId: string, draft: TeachingLearningGroupDraft) => {
      const groupName = draft.groupName.trim();
      await runVerifiedLearningGroupMutation({
        courseId,
        expectedReceiptActions: ["create-learning-group"],
        successMessage: t.groupCreated,
        request: () =>
          fetch(`/api/teaching/courses/${encodeURIComponent(courseId)}/groups`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              groupName,
              ...(draft.classId ? { classId: draft.classId } : {}),
              members: draft.memberIds.map((studentId) => ({ studentId })),
            }),
          }),
        readGroupId: (body) => body.group?.groupId,
        verifyReadback: (groups, groupId) =>
          verifyPersistedLearningGroup(groups, groupId, {
            groupName,
            memberIds: draft.memberIds,
            locale,
          }),
      });
    },
    [locale, runVerifiedLearningGroupMutation, t.groupCreated],
  );

  const updateLearningGroup = useCallback(
    async (courseId: string, groupId: string, patch: TeachingLearningGroupPatch) => {
      const groupName = patch.groupName?.trim();
      const expectedReceiptActions: LearningGroupMutationAction[] = [
        ...(patch.memberIds ? (["update-learning-group-members"] as const) : []),
        ...(groupName === undefined ? [] : (["rename-learning-group"] as const)),
      ];
      await runVerifiedLearningGroupMutation({
        courseId,
        expectedReceiptActions,
        successMessage: t.groupUpdated,
        request: () =>
          fetch(
            `/api/teaching/courses/${encodeURIComponent(courseId)}/groups/${encodeURIComponent(
              groupId,
            )}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                ...(groupName === undefined ? {} : { groupName }),
                ...(patch.memberIds
                  ? { members: patch.memberIds.map((studentId) => ({ studentId })) }
                  : {}),
              }),
            },
          ),
        readGroupId: (body) => body.group?.groupId ?? groupId,
        verifyReadback: (groups) =>
          verifyPersistedLearningGroup(groups, groupId, {
            ...(groupName === undefined ? {} : { groupName }),
            ...(patch.memberIds ? { memberIds: patch.memberIds } : {}),
            locale,
          }),
      });
    },
    [locale, runVerifiedLearningGroupMutation, t.groupUpdated],
  );

  const deleteLearningGroup = useCallback(
    async (courseId: string, groupId: string) => {
      await runVerifiedLearningGroupMutation({
        courseId,
        expectedReceiptActions: ["delete-learning-group"],
        successMessage: t.groupDeleted,
        request: () =>
          fetch(
            `/api/teaching/courses/${encodeURIComponent(courseId)}/groups/${encodeURIComponent(
              groupId,
            )}`,
            {
              method: "DELETE",
              headers: { accept: "application/json" },
            },
          ),
        readGroupId: (body) => body.group?.groupId ?? groupId,
        // The transcript is retained server-side; only the group row disappears.
        verifyReadback: (groups) =>
          groups.some((group) => group.groupId === groupId)
            ? copy[locale].teaching.groupReadbackMismatch
            : undefined,
      });
    },
    [locale, runVerifiedLearningGroupMutation, t.groupDeleted],
  );

  return {
    learningGroupsByCourse,
    learningGroupStatuses,
    openLearningGroupCourseIds,
    hasLoadedLearningGroups,
    loadLearningGroups,
    toggleLearningGroupPanel,
    setLearningGroupStatus,
    createLearningGroup,
    updateLearningGroup,
    deleteLearningGroup,
  };
}

export function createLearningGroupsByCourse(
  records: PersistedLearningGroupRecord[],
): Record<string, TeachingLearningGroupItem[]> {
  return records.reduce<Record<string, TeachingLearningGroupItem[]>>((groups, record) => {
    const groupId = record.groupId?.trim();
    const courseId = record.courseId?.trim();
    const groupName = record.groupName?.trim();
    if (!groupId || !courseId || !groupName) {
      return groups;
    }
    const classId = record.classId?.trim();
    const members = (record.members ?? [])
      .map((member) => {
        const studentId = member.studentId?.trim();
        const studentDisplayName = member.studentDisplayName?.trim();
        if (!studentId || !studentDisplayName) {
          return undefined;
        }
        return {
          studentId,
          studentDisplayName,
          ...(member.addedAt ? { addedAt: member.addedAt } : {}),
        } satisfies TeachingLearningGroupMemberItem;
      })
      .filter((member): member is TeachingLearningGroupMemberItem => Boolean(member));

    return {
      ...groups,
      [courseId]: [
        ...(groups[courseId] ?? []),
        {
          groupId,
          courseId,
          ...(classId ? { classId } : {}),
          groupName,
          members,
        },
      ],
    };
  }, {});
}

// A receipt only counts as evidence when the backend marked it persisted AND it
// names the requested action for the requested course; a PATCH that ran both a
// member replace and a rename must produce both receipts.
function hasPersistedLearningGroupReceipts(
  body: TeachingLearningGroupMutationResponse | null,
  expectedActions: LearningGroupMutationAction[],
  courseId: string,
) {
  if (!body || expectedActions.length === 0) {
    return false;
  }
  const receipts = body.receipts ?? (body.receipt ? [body.receipt] : []);
  return expectedActions.every((action) =>
    receipts.some(
      (receipt) =>
        receipt?.action === action &&
        receipt?.status === "persisted" &&
        receipt?.courseId === courseId,
    ),
  );
}

function verifyPersistedLearningGroup(
  groups: TeachingLearningGroupItem[],
  groupId: string,
  expected: { groupName?: string; memberIds?: string[]; locale: Locale },
) {
  const t = copy[expected.locale].teaching;
  const persistedGroup = groups.find((group) => group.groupId === groupId);
  if (!persistedGroup) {
    return t.groupReadbackMissing;
  }
  if (expected.groupName !== undefined && persistedGroup.groupName !== expected.groupName) {
    return t.groupReadbackMismatch;
  }
  if (expected.memberIds) {
    const persistedMemberIds = persistedGroup.members.map((member) => member.studentId);
    if (
      persistedMemberIds.length !== expected.memberIds.length ||
      expected.memberIds.some((studentId) => !persistedMemberIds.includes(studentId))
    ) {
      return t.groupReadbackMismatch;
    }
  }
  return undefined;
}

// Server validation reason codes -> friendly bilingual guidance. The bounds
// mirrored client-side (2..12) come from the same contract, so a teacher sees
// the same rule before and after the request.
export function createLearningGroupFailureMessage(
  body: TeachingLearningGroupMutationResponse | null,
  locale: Locale,
) {
  const t = copy[locale].teaching;
  switch (body?.validation?.reasonCode) {
    case "group-name-required":
      return t.groupNameRequired;
    case "group-members-required":
      return t.groupMembersRequired;
    case "group-members-below-minimum":
      return t.groupMembersBelowMinimum;
    case "group-members-above-maximum":
      return t.groupMembersAboveMaximum;
    case "group-member-duplicate":
      return t.groupMemberDuplicate;
    case "group-member-invalid":
      return t.groupMemberInvalid;
    case "group-member-not-approved":
      return t.groupMemberNotApproved;
    default:
      break;
  }
  if (body?.access?.reasonCode === "teacher-course-ownership-required") {
    return t.groupOwnershipRequired;
  }
  return t.groupSaveFailed;
}
