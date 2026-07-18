import { randomUUID } from "node:crypto";
import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import {
  createRedaction,
  isRecord,
  normalizeAuditRequestSource,
  optionalTrimmedString,
  requireSafeId,
  requireTrimmedString,
} from "./teaching-course-management-guards";
import { normalizeAuthSessionSummary } from "./teaching-course-management-record-normalizers";
import type {
  TeachingClassDraftInput,
  TeachingCourseDraftInput,
  TeachingCourseManagementAction,
  TeachingCourseManagementAuditEvent,
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementAuthSessionSummary,
  TeachingCourseManagementDatabase,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementStorageDescriptor,
  TeachingCourseSettingsAppliedField,
  TeachingCourseSettingsPatchInput,
} from "@/lib/server/teaching-course-management-types";

// Draft normalizers, receipt/audit/invite builders, runtime predicates, and
// membership counters for the teaching-course-management store (Phase 3
// decomposition). Cycle-free: runtime deps are the extracted guards + error +
// record-normalizer modules; store types are a type-only import.

type NormalizedTeachingCourseSettingsPatch = TeachingCourseSettingsPatchInput & {
  appliedFields: TeachingCourseSettingsAppliedField[];
};

type NormalizedTeachingCourseDraft = Required<Omit<TeachingCourseDraftInput, "courseId">> & {
  courseId?: string;
};

export function isTeachingCourseManagementProductionRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

export function isTeachingCourseManagementOptimisticSnapshotConflict(error: unknown) {
  return error instanceof TeachingCourseManagementStoreError && error.status === 409;
}

export function normalizeCourseDraft(input: TeachingCourseDraftInput): NormalizedTeachingCourseDraft {
  return {
    ...(input.courseId ? { courseId: requireSafeId(input.courseId, "course id") } : {}),
    name: requireTrimmedString(input.name, "course name", 200),
    instructor: requireTrimmedString(input.instructor, "instructor", 120),
    unit: requireTrimmedString(input.unit, "unit", 160),
    department: requireTrimmedString(input.department, "department", 160),
    semester: requireTrimmedString(input.semester, "semester", 120),
    description: optionalTrimmedString(input.description, 600) ?? "",
    coverAssetId: input.coverAssetId ? requireSafeId(input.coverAssetId, "cover asset id") : "",
  };
}

export function normalizeCourseSettingsPatch(
  input: unknown,
): NormalizedTeachingCourseSettingsPatch {
  if (!isRecord(input)) {
    return { appliedFields: [] };
  }

  const appliedFields: TeachingCourseSettingsAppliedField[] = [];
  const patch: TeachingCourseSettingsPatchInput = {};
  const stringFields = [
    ["courseName", "course name", 200],
    ["instructor", "instructor", 120],
    ["unit", "unit", 160],
    ["department", "department", 160],
    ["semester", "semester", 120],
  ] as const;

  for (const [field, label, maxLength] of stringFields) {
    if (Object.hasOwn(input, field)) {
      patch[field] = requireTrimmedString(input[field], label, maxLength);
      appliedFields.push(field);
    }
  }
  if (Object.hasOwn(input, "description")) {
    if (typeof input.description !== "string") {
      throw new TeachingCourseManagementStoreError(400, "Invalid description.");
    }
    patch.description = input.description.trim().slice(0, 600);
    appliedFields.push("description");
  }

  return {
    ...patch,
    appliedFields,
  };
}

export function normalizeClassDraft(input: TeachingClassDraftInput): TeachingClassDraftInput {
  return {
    className: requireTrimmedString(input.className, "class name", 160),
    ...(input.semester ? { semester: requireTrimmedString(input.semester, "semester", 120) } : {}),
  };
}

export function normalizeClassUniqueValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function countApprovedMembershipsForClass(
  database: TeachingCourseManagementDatabase,
  classId: string,
) {
  return database.memberships.filter(
    (membership) => membership.classId === classId && membership.membershipStatus === "approved",
  ).length;
}

export function countApprovedStudentsForCourse(
  database: TeachingCourseManagementDatabase,
  courseId: string,
) {
  const classIds = new Set(
    database.classes.filter((classItem) => classItem.courseId === courseId).map((item) => item.classId),
  );
  return new Set(
    database.memberships
      .filter(
        (membership) =>
          membership.membershipStatus === "approved" && classIds.has(membership.classId),
      )
      .map((membership) => membership.studentId),
  ).size;
}

export function createReceipt(input: {
  action: TeachingCourseManagementAction;
  actorId: string;
  courseId: string;
  classId?: string;
  traceId?: string;
  createdAt: string;
  authSession?: TeachingCourseManagementAuthSessionSummary;
  storage: TeachingCourseManagementStorageDescriptor;
}): TeachingCourseManagementReceipt {
  return {
    receiptId: `${input.action}-${input.courseId}-${formatTimestampId(new Date(input.createdAt))}`,
    action: input.action,
    actorId: input.actorId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    traceId: input.traceId ?? `trace-${randomUUID()}`,
    status: "persisted",
    ...(input.authSession ? { authSession: normalizeAuthSessionSummary(input.authSession) } : {}),
    storagePolicy: input.storage.recordStoragePolicy,
    storageWritePolicy: input.storage.storageWritePolicy,
    responsibleSession: "S12",
    createdAt: input.createdAt,
    redaction: createRedaction(),
  };
}

export function createAuditEvent(input: {
  action: TeachingCourseManagementAction;
  actorId: string;
  courseId: string;
  classId?: string;
  traceId: string;
  actorRole?: "teacher" | "student";
  authMode?: "signed-teacher-session" | "app-student-session";
  authSession?: TeachingCourseManagementAuthSessionSummary;
  createdAt: string;
  requestSource?: TeachingCourseManagementAuditRequestSource;
  storage: TeachingCourseManagementStorageDescriptor;
}): TeachingCourseManagementAuditEvent {
  return {
    auditId: `audit-${input.action}-${formatTimestampId(new Date(input.createdAt))}`,
    action: input.action,
    actorId: input.actorId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    traceId: input.traceId,
    actorRole: input.actorRole ?? "teacher",
    authMode: input.authMode ?? "signed-teacher-session",
    ...(input.authSession ? { authSession: normalizeAuthSessionSummary(input.authSession) } : {}),
    createdAt: input.createdAt,
    requestSource: normalizeAuditRequestSource(input.requestSource),
    storagePolicy: input.storage.auditStoragePolicy,
    redaction: createRedaction(),
  };
}

export function createClassInvitationCode(database: TeachingCourseManagementDatabase) {
  const usedInviteCodes = new Set<string>();
  for (const classItem of database.classes) {
    usedInviteCodes.add(classItem.invitationCode);
  }
  for (const inviteCodeDraft of database.inviteCodeDrafts ?? []) {
    usedInviteCodes.add(inviteCodeDraft.inviteCode);
  }
  for (const membership of database.memberships) {
    usedInviteCodes.add(membership.invitationCode);
  }

  for (let code = 55395057; code <= 99999999; code += 1) {
    const invitationCode = String(code).padStart(8, "0");
    if (!usedInviteCodes.has(invitationCode)) {
      return invitationCode;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching class invite code capacity is exhausted.",
  );
}

export function formatTimestampId(now: Date) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
}
