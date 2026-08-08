import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import {
  createRedaction,
  isRecord,
  requireSafeId,
  requireTrimmedString,
} from "./teaching-course-management-guards";
import {
  createAuditEvent,
  createReceipt,
  formatTimestampId,
  isTeachingCourseManagementOptimisticSnapshotConflict,
} from "./teaching-course-management-helpers";
import {
  localTeachingCourseManagementStorage,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  writeTeachingCourseManagementSnapshot,
} from "./teaching-course-management-io";
import type {
  TeachingCourseManagementAuditRequestSource,
  TeachingCourseManagementAuthSessionSummary,
  TeachingCourseManagementDatabase,
  TeachingCourseManagementReceipt,
  TeachingCourseManagementRepository,
  TeachingCourseManagementStorageDescriptor,
  TeachingLearningGroupDraftInput,
  TeachingLearningGroupMember,
  TeachingLearningGroupMemberInput,
  TeachingLearningGroupRecord,
} from "@/lib/server/teaching-course-management-types";

// Learning-group handler family for the teaching-course-management store
// (chatroom groups, Phase 1 / plan D1): create, replace members, rename, delete.
// Each handler reads the snapshot, validates teacher course ownership AND that
// every member holds an approved membership in the course (and class when the
// group is class-scoped), mutates, appends exactly one audit event, and writes
// atomically with the same optimistic-retry loop the sibling handler families use.
// Cycle-free: runtime deps are the extracted io/helpers/guards/error modules;
// store types are a type-only import.

export const teachingLearningGroupMinMembers = 2;
export const teachingLearningGroupMaxMembers = 12;

const teachingLearningGroupNameMaxLength = 120;

export type TeachingLearningGroupValidationReasonCode =
  | "group-name-required"
  | "group-members-required"
  | "group-members-below-minimum"
  | "group-members-above-maximum"
  | "group-member-duplicate"
  | "group-member-invalid"
  | "group-member-not-approved";

export type TeachingLearningGroupValidation = {
  target: "teaching-learning-group";
  status: "invalid";
  reasonCode: TeachingLearningGroupValidationReasonCode;
  field: "groupName" | "members";
  minMembers?: number;
  maxMembers?: number;
  memberIndex?: number;
  responsibleSession: "S12";
  redaction: ReturnType<typeof createRedaction>;
};

type LearningGroupMutationAudit = {
  requestSource?: TeachingCourseManagementAuditRequestSource;
  authSession?: TeachingCourseManagementAuthSessionSummary;
};

export function createTeachingLearningGroupId(groupName: string, now: Date) {
  const slug = createLearningGroupSlug(groupName) || "learning";
  return `group-${slug}-${formatTimestampId(now)}`;
}

export async function createTeachingLearningGroupRecord(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  draft: TeachingLearningGroupDraftInput;
  traceId?: string;
  now?: Date;
  audit?: LearningGroupMutationAudit;
}): Promise<{
  group: TeachingLearningGroupRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const groupName = requireLearningGroupName(input.draft.groupName);
  const classId = input.draft.classId
    ? requireSafeId(input.draft.classId, "class id")
    : undefined;
  const memberIds = requireLearningGroupMemberIds(input.draft.members);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const groupId = createTeachingLearningGroupId(groupName, now);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    requireOwnedCourse(database, courseId, actorId);
    if (classId) {
      requireOwnedClass(database, courseId, classId, actorId);
    }

    const learningGroups = database.learningGroups ?? [];
    if (learningGroups.some((item) => item.groupId === groupId)) {
      throw new TeachingCourseManagementStoreError(
        409,
        "Teaching learning group already exists.",
      );
    }

    const group: TeachingLearningGroupRecord = {
      groupId,
      courseId,
      ...(classId ? { classId } : {}),
      ownerTeacherId: actorId,
      groupName,
      members: resolveApprovedLearningGroupMembers({
        database,
        courseId,
        classId,
        memberIds,
        addedAt: createdAt,
      }),
      createdAt,
      updatedAt: createdAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      responsibleSession: "S12",
      redaction: createRedaction(),
    };
    database.learningGroups = [...learningGroups, group];

    const receipt = appendLearningGroupMutation({
      database,
      action: "create-learning-group",
      actorId,
      courseId,
      classId,
      traceId: input.traceId,
      createdAt,
      audit: input.audit,
      storage,
    });

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return { group, receipt };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function updateTeachingLearningGroupMembers(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  groupId: string;
  members: TeachingLearningGroupMemberInput[];
  traceId?: string;
  now?: Date;
  audit?: LearningGroupMutationAudit;
}): Promise<{
  group: TeachingLearningGroupRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const groupId = requireSafeId(input.groupId, "learning group id");
  const memberIds = requireLearningGroupMemberIds(input.members);
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    requireOwnedCourse(database, courseId, actorId);
    const { learningGroups, groupIndex, group } = requireOwnedLearningGroup(
      database,
      courseId,
      groupId,
      actorId,
    );

    const nextGroup: TeachingLearningGroupRecord = {
      ...group,
      members: resolveApprovedLearningGroupMembers({
        database,
        courseId,
        classId: group.classId,
        memberIds,
        addedAt: updatedAt,
        // Members who survive a replace keep their original assignment stamp; only
        // newly added members are stamped with this mutation's timestamp.
        previousMembers: group.members,
      }),
      updatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.learningGroups = learningGroups.map((item, index) =>
      index === groupIndex ? nextGroup : item,
    );

    const receipt = appendLearningGroupMutation({
      database,
      action: "update-learning-group-members",
      actorId,
      courseId,
      classId: group.classId,
      traceId: input.traceId,
      createdAt: updatedAt,
      audit: input.audit,
      storage,
    });

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return { group: nextGroup, receipt };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function renameTeachingLearningGroup(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  groupId: string;
  groupName: string;
  traceId?: string;
  now?: Date;
  audit?: LearningGroupMutationAudit;
}): Promise<{
  group: TeachingLearningGroupRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const groupId = requireSafeId(input.groupId, "learning group id");
  const groupName = requireLearningGroupName(input.groupName);
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    requireOwnedCourse(database, courseId, actorId);
    const { learningGroups, groupIndex, group } = requireOwnedLearningGroup(
      database,
      courseId,
      groupId,
      actorId,
    );

    const nextGroup: TeachingLearningGroupRecord = {
      ...group,
      groupName,
      updatedAt,
      storagePolicy: storage.recordStoragePolicy,
      storageWritePolicy: storage.storageWritePolicy,
      redaction: createRedaction(),
    };
    database.learningGroups = learningGroups.map((item, index) =>
      index === groupIndex ? nextGroup : item,
    );

    const receipt = appendLearningGroupMutation({
      database,
      action: "rename-learning-group",
      actorId,
      courseId,
      classId: group.classId,
      traceId: input.traceId,
      createdAt: updatedAt,
      audit: input.audit,
      storage,
    });

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return { group: nextGroup, receipt };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export async function deleteTeachingLearningGroup(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
  groupId: string;
  traceId?: string;
  now?: Date;
  audit?: LearningGroupMutationAudit;
}): Promise<{
  group: TeachingLearningGroupRecord;
  receipt: TeachingCourseManagementReceipt;
}> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const groupId = requireSafeId(input.groupId, "learning group id");
  const now = input.now ?? new Date();
  const deletedAt = now.toISOString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir,
      repository: input.repository,
    });
    const database = snapshot.database;
    requireOwnedCourse(database, courseId, actorId);
    const { learningGroups, group } = requireOwnedLearningGroup(
      database,
      courseId,
      groupId,
      actorId,
    );

    // The group's chatroom transcript is deliberately NOT deleted here: it is
    // retained server-side and simply orphaned, because the room's authorization
    // gate reads the group record and fails closed once the group is gone.
    database.learningGroups = learningGroups.filter((item) => item.groupId !== groupId);

    const receipt = appendLearningGroupMutation({
      database,
      action: "delete-learning-group",
      actorId,
      courseId,
      classId: group.classId,
      traceId: input.traceId,
      createdAt: deletedAt,
      audit: input.audit,
      storage,
    });

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir,
        repository: input.repository,
        database,
        expectedRevision: snapshot.revision,
      });
      return { group, receipt };
    } catch (error) {
      if (
        input.repository &&
        attempt === 0 &&
        isTeachingCourseManagementOptimisticSnapshotConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
  );
}

export function readTeachingLearningGroupValidation(
  error: unknown,
): TeachingLearningGroupValidation | undefined {
  if (!(error instanceof TeachingCourseManagementStoreError)) {
    return undefined;
  }
  const validation = error.diagnostics?.validation;
  if (
    !isRecord(validation) ||
    validation.target !== "teaching-learning-group" ||
    validation.status !== "invalid" ||
    typeof validation.reasonCode !== "string" ||
    typeof validation.field !== "string"
  ) {
    return undefined;
  }
  return validation as TeachingLearningGroupValidation;
}

function appendLearningGroupMutation(input: {
  database: TeachingCourseManagementDatabase;
  action:
    | "create-learning-group"
    | "update-learning-group-members"
    | "rename-learning-group"
    | "delete-learning-group";
  actorId: string;
  courseId: string;
  classId?: string;
  traceId?: string;
  createdAt: string;
  audit?: LearningGroupMutationAudit;
  storage: TeachingCourseManagementStorageDescriptor;
}) {
  const receipt = createReceipt({
    action: input.action,
    actorId: input.actorId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    traceId: input.traceId,
    createdAt: input.createdAt,
    authSession: input.audit?.authSession,
    storage: input.storage,
  });
  const auditEvent = createAuditEvent({
    action: input.action,
    actorId: input.actorId,
    courseId: input.courseId,
    ...(input.classId ? { classId: input.classId } : {}),
    traceId: receipt.traceId,
    createdAt: input.createdAt,
    requestSource: input.audit?.requestSource,
    authSession: input.audit?.authSession,
    storage: input.storage,
  });
  input.database.auditEvents.push(auditEvent);
  input.database.updatedAt = input.createdAt;
  return receipt;
}

function requireOwnedCourse(
  database: TeachingCourseManagementDatabase,
  courseId: string,
  actorId: string,
) {
  const course = database.courses.find((item) => item.courseId === courseId);
  if (!course) {
    throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
  }
  if (course.ownerTeacherId !== actorId) {
    throw new TeachingCourseManagementStoreError(403, "Teaching course ownership is required.");
  }
  return course;
}

function requireOwnedClass(
  database: TeachingCourseManagementDatabase,
  courseId: string,
  classId: string,
  actorId: string,
) {
  const classItem = database.classes.find(
    (item) => item.classId === classId && item.courseId === courseId,
  );
  if (!classItem) {
    throw new TeachingCourseManagementStoreError(404, "Teaching class was not found.");
  }
  if (classItem.ownerTeacherId !== actorId) {
    throw new TeachingCourseManagementStoreError(403, "Teaching class ownership is required.");
  }
  return classItem;
}

function requireOwnedLearningGroup(
  database: TeachingCourseManagementDatabase,
  courseId: string,
  groupId: string,
  actorId: string,
) {
  const learningGroups = database.learningGroups ?? [];
  const groupIndex = learningGroups.findIndex(
    (item) => item.groupId === groupId && item.courseId === courseId,
  );
  if (groupIndex < 0) {
    throw new TeachingCourseManagementStoreError(404, "Teaching learning group was not found.");
  }
  const group = learningGroups[groupIndex];
  if (group.ownerTeacherId !== actorId) {
    throw new TeachingCourseManagementStoreError(
      403,
      "Teaching learning group ownership is required.",
    );
  }
  return { learningGroups, groupIndex, group };
}

function resolveApprovedLearningGroupMembers(input: {
  database: TeachingCourseManagementDatabase;
  courseId: string;
  classId?: string;
  memberIds: string[];
  addedAt: string;
  previousMembers?: TeachingLearningGroupMember[];
}): TeachingLearningGroupMember[] {
  return input.memberIds.map((studentId, memberIndex) => {
    // The display name is snapshotted from the approved membership row, never
    // from the request body: this list is projected to co-members of the group.
    const membership = input.database.memberships.find(
      (item) =>
        item.studentId === studentId &&
        item.courseId === input.courseId &&
        item.membershipStatus === "approved" &&
        (input.classId ? item.classId === input.classId : true),
    );
    if (!membership) {
      throw createLearningGroupValidationError(
        "Teaching learning group member must hold an approved course membership.",
        "group-member-not-approved",
        "members",
        { memberIndex },
      );
    }
    const previousMember = input.previousMembers?.find(
      (item) => item.studentId === studentId,
    );
    return {
      studentId,
      studentDisplayName: requireTrimmedString(
        membership.studentDisplayName,
        "student display name",
        teachingLearningGroupNameMaxLength,
      ),
      addedAt: previousMember?.addedAt ?? input.addedAt,
    };
  });
}

function requireLearningGroupName(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw createLearningGroupValidationError(
      "Teaching learning group name is required.",
      "group-name-required",
      "groupName",
    );
  }
  return requireTrimmedString(value, "learning group name", teachingLearningGroupNameMaxLength);
}

function requireLearningGroupMemberIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw createLearningGroupValidationError(
      "Teaching learning group members are required.",
      "group-members-required",
      "members",
    );
  }
  if (value.length < teachingLearningGroupMinMembers) {
    throw createLearningGroupValidationError(
      `Teaching learning group requires at least ${teachingLearningGroupMinMembers} members.`,
      "group-members-below-minimum",
      "members",
      { minMembers: teachingLearningGroupMinMembers },
    );
  }
  if (value.length > teachingLearningGroupMaxMembers) {
    throw createLearningGroupValidationError(
      `Teaching learning group allows at most ${teachingLearningGroupMaxMembers} members.`,
      "group-members-above-maximum",
      "members",
      { maxMembers: teachingLearningGroupMaxMembers },
    );
  }

  const memberIds: string[] = [];
  const seenMemberIds = new Set<string>();
  value.forEach((member, memberIndex) => {
    const studentId = readLearningGroupMemberId(member, memberIndex);
    if (seenMemberIds.has(studentId)) {
      throw createLearningGroupValidationError(
        "Teaching learning group members must be unique.",
        "group-member-duplicate",
        "members",
        { memberIndex },
      );
    }
    seenMemberIds.add(studentId);
    memberIds.push(studentId);
  });
  return memberIds;
}

function readLearningGroupMemberId(value: unknown, memberIndex: number) {
  const rawStudentId = isRecord(value) ? value.studentId : value;
  if (typeof rawStudentId !== "string" || !rawStudentId.trim()) {
    throw createLearningGroupValidationError(
      "Teaching learning group member id is invalid.",
      "group-member-invalid",
      "members",
      { memberIndex },
    );
  }
  try {
    return requireSafeId(rawStudentId.trim(), "student id");
  } catch {
    throw createLearningGroupValidationError(
      "Teaching learning group member id is invalid.",
      "group-member-invalid",
      "members",
      { memberIndex },
    );
  }
}

function createLearningGroupValidationError(
  message: string,
  reasonCode: TeachingLearningGroupValidationReasonCode,
  field: TeachingLearningGroupValidation["field"],
  options: { minMembers?: number; maxMembers?: number; memberIndex?: number } = {},
) {
  const validation: TeachingLearningGroupValidation = {
    target: "teaching-learning-group",
    status: "invalid",
    reasonCode,
    field,
    ...(options.minMembers === undefined ? {} : { minMembers: options.minMembers }),
    ...(options.maxMembers === undefined ? {} : { maxMembers: options.maxMembers }),
    ...(options.memberIndex === undefined ? {} : { memberIndex: options.memberIndex }),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
  return new TeachingCourseManagementStoreError(400, message, { validation });
}

function createLearningGroupSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
