"use client";

// Explicit invite-code class targeting for the teacher workspace (plan E9).
//
// A sibling module because `use-teaching-workspace.tsx` sits at the 1500-code-line
// source cap.
//
// The course comes from the workspace-wide course selector; what this owns is the
// class inside it and the policy the next publish will set. Both used to be
// guessed: the invite actions resolved their class as `courseClasses[courseId][0]`,
// so a teacher with two classes could publish a code for the one they had never
// looked at, and the receipt came back reading like a success. A course with
// exactly one class still targets it without asking - there is nothing to choose
// between - but the moment there are two, the choice has to be made out loud.
//
// Nothing here is reset by an effect. The class is stored per course and the
// policy draft per class, so switching course and back does not silently drop a
// selection or a half-typed expiry, and a class id can never leak across courses.

import { useCallback, useState } from "react";
import {
  createInviteCodePolicyDraft,
  readInviteCodePolicyDraftError,
  type InviteCodePolicyDraft,
} from "./invite-code-policy";
import type { Locale } from "@/i18n/copy";
import type { TeacherClassItem } from "@/lib/teaching/course-readback";

export function useTeachingInviteTargeting(input: {
  locale: Locale;
  courseClasses: Record<string, TeacherClassItem[]>;
  selectedInviteCourseId?: string;
}) {
  const { locale, courseClasses, selectedInviteCourseId } = input;
  const [selectedClassIdByCourseId, setSelectedClassIdByCourseId] = useState<
    Record<string, string>
  >({});
  const [invitePolicyDraftByClassId, setInvitePolicyDraftByClassId] = useState<
    Record<string, InviteCodePolicyDraft>
  >({});

  const inviteCourseClasses = selectedInviteCourseId
    ? (courseClasses[selectedInviteCourseId] ?? [])
    : [];
  const chosenClassId = selectedInviteCourseId
    ? selectedClassIdByCourseId[selectedInviteCourseId]
    : undefined;
  // A stored id only counts while it still names a class of the selected course.
  const selectedInviteClass =
    inviteCourseClasses.find((classItem) => classItem.id === chosenClassId) ??
    (inviteCourseClasses.length === 1 ? inviteCourseClasses[0] : undefined);
  const selectedInviteClassId = selectedInviteClass?.id;
  // The teacher's unsaved edits for this class when there are any, otherwise the
  // policy the record actually carries.
  const invitePolicyDraft =
    (selectedInviteClassId ? invitePolicyDraftByClassId[selectedInviteClassId] : undefined) ??
    createInviteCodePolicyDraft(selectedInviteClass);

  const selectInviteClass = useCallback(
    (classId: string) => {
      if (!selectedInviteCourseId) {
        return;
      }
      setSelectedClassIdByCourseId((currentSelection) => ({
        ...currentSelection,
        [selectedInviteCourseId]: classId,
      }));
    },
    [selectedInviteCourseId],
  );

  const updateInvitePolicyDraft = useCallback(
    (patch: Partial<InviteCodePolicyDraft>) => {
      if (!selectedInviteClassId) {
        return;
      }
      setInvitePolicyDraftByClassId((currentDrafts) => ({
        ...currentDrafts,
        [selectedInviteClassId]: {
          ...(currentDrafts[selectedInviteClassId] ??
            createInviteCodePolicyDraft(selectedInviteClass)),
          ...patch,
        },
      }));
    },
    [selectedInviteClass, selectedInviteClassId],
  );

  // Called after a publish reads back: drop the override so the form re-derives
  // from what was actually stored rather than from what was typed.
  const resyncInvitePolicyDraft = useCallback((classItem: TeacherClassItem | undefined) => {
    if (!classItem) {
      return;
    }
    setInvitePolicyDraftByClassId((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[classItem.id];
      return nextDrafts;
    });
  }, []);

  return {
    inviteCourseClasses,
    selectedInviteClass,
    selectedInviteClassId,
    invitePolicyDraft,
    invitePolicyDraftError: readInviteCodePolicyDraftError(invitePolicyDraft, locale),
    selectInviteClass,
    updateInvitePolicyDraft,
    resyncInvitePolicyDraft,
  };
}
