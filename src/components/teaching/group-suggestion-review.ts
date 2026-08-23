export const teacherGroupSuggestionReviewPolicy =
  "teacher-review-before-group-assignment" as const;

export type TeacherGroupSuggestionDraft = {
  receiptId: string;
  courseId: string;
  reviewPolicy: typeof teacherGroupSuggestionReviewPolicy;
  ungroupedStudentCount: number;
  suggestedGroups: Array<{
    suggestionKey: string;
    groupName: string;
    members: Array<{
      studentId: string;
      studentDisplayName: string;
    }>;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// Converts an untrusted operation payload into the only suggestion shape the UI
// may offer for teacher review. A partial or semantically different artifact is
// rejected as a whole: silently dropping a malformed or duplicate member could
// make the draft differ from the partition whose audit record was verified.
export function createTeacherGroupSuggestionDraft(input: {
  receiptId: string;
  courseId: string;
  suggestionReceipt: unknown;
}): TeacherGroupSuggestionDraft | undefined {
  if (!isRecord(input.suggestionReceipt)) {
    return undefined;
  }
  if (
    input.suggestionReceipt.action !== "generate-student-group-suggestions" ||
    input.suggestionReceipt.status !== "persisted" ||
    input.suggestionReceipt.reviewPolicy !== teacherGroupSuggestionReviewPolicy ||
    !Number.isSafeInteger(input.suggestionReceipt.ungroupedStudentCount) ||
    Number(input.suggestionReceipt.ungroupedStudentCount) < 0 ||
    !Array.isArray(input.suggestionReceipt.suggestedGroups) ||
    input.suggestionReceipt.suggestedGroups.length === 0
  ) {
    return undefined;
  }

  const seenStudentIds = new Set<string>();
  const suggestedGroups: TeacherGroupSuggestionDraft["suggestedGroups"] = [];

  for (const [index, rawGroup] of input.suggestionReceipt.suggestedGroups.entries()) {
    if (!isRecord(rawGroup) || !Array.isArray(rawGroup.members)) {
      return undefined;
    }
    const groupName = readNonEmptyString(rawGroup.groupName);
    if (!groupName || rawGroup.members.length === 0) {
      return undefined;
    }

    const members: TeacherGroupSuggestionDraft["suggestedGroups"][number]["members"] = [];
    for (const rawMember of rawGroup.members) {
      if (!isRecord(rawMember)) {
        return undefined;
      }
      const studentId = readNonEmptyString(rawMember.studentId);
      const studentDisplayName = readNonEmptyString(rawMember.studentDisplayName);
      if (!studentId || !studentDisplayName || seenStudentIds.has(studentId)) {
        return undefined;
      }
      seenStudentIds.add(studentId);
      members.push({ studentId, studentDisplayName });
    }

    suggestedGroups.push({
      suggestionKey: `${input.receiptId}:${index}`,
      groupName,
      members,
    });
  }

  return {
    receiptId: input.receiptId,
    courseId: input.courseId,
    reviewPolicy: teacherGroupSuggestionReviewPolicy,
    ungroupedStudentCount: Number(input.suggestionReceipt.ungroupedStudentCount),
    suggestedGroups,
  };
}
