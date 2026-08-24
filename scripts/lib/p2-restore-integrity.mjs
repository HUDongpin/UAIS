import { createHash } from "node:crypto";

const membershipStatuses = new Set([
  "pending-teacher-review",
  "approved",
  "rejected",
  "removed",
]);
const requiredRecordSetNames = Object.freeze([
  "users",
  "courses",
  "classes",
  "enrollments",
  "learningEvents",
  "learnerProfiles",
  "courseSnapshots",
  "inviteClaims",
  "transcriptSnapshots",
]);

export function assessP2RestoreIntegrity({
  sourceCourseSnapshots,
  restoredCourseSnapshots,
  sourceTranscriptSnapshots,
  restoredTranscriptSnapshots,
} = {}) {
  const sourceCourse = normalizeCourseTopology(sourceCourseSnapshots);
  const restoredCourse = normalizeCourseTopology(restoredCourseSnapshots);
  const sourceTranscript = normalizeTranscriptTopology(sourceTranscriptSnapshots);
  const restoredTranscript = normalizeTranscriptTopology(restoredTranscriptSnapshots);

  const sourceCourseSerialized = JSON.stringify(sourceCourse.topology);
  const restoredCourseSerialized = JSON.stringify(restoredCourse.topology);
  const sourceTranscriptSerialized = JSON.stringify(sourceTranscript.topology);
  const restoredTranscriptSerialized = JSON.stringify(restoredTranscript.topology);
  const checks = {
    sourceCourseTopologyValid: sourceCourse.valid,
    restoredCourseTopologyValid: restoredCourse.valid,
    groupMembershipsExact: sourceCourseSerialized === restoredCourseSerialized,
    sourceTranscriptTopologyValid: sourceTranscript.valid,
    restoredTranscriptTopologyValid: restoredTranscript.valid,
    transcriptOwnershipExact:
      sourceTranscriptSerialized === restoredTranscriptSerialized,
    sourceMessageOwnershipValid: validateMessageOwnership(
      sourceCourse,
      sourceTranscript,
    ),
    restoredMessageOwnershipValid: validateMessageOwnership(
      restoredCourse,
      restoredTranscript,
    ),
  };
  const mismatchCodes = [
    ["sourceCourseTopologyValid", "source-course-topology-invalid"],
    ["restoredCourseTopologyValid", "restored-course-topology-invalid"],
    ["groupMembershipsExact", "group-membership-mismatch"],
    ["sourceTranscriptTopologyValid", "source-transcript-topology-invalid"],
    ["restoredTranscriptTopologyValid", "restored-transcript-topology-invalid"],
    ["transcriptOwnershipExact", "transcript-ownership-mismatch"],
    ["sourceMessageOwnershipValid", "source-message-ownership-invalid"],
    ["restoredMessageOwnershipValid", "restored-message-ownership-invalid"],
  ].flatMap(([check, code]) => (checks[check] ? [] : [code]));

  return {
    status: mismatchCodes.length === 0 ? "PASS" : "FAIL",
    checks,
    counts: {
      source: {
        ...sourceCourse.counts,
        ...sourceTranscript.counts,
      },
      restored: {
        ...restoredCourse.counts,
        ...restoredTranscript.counts,
      },
    },
    checksums: {
      groupMemberships: {
        source: createTopologyChecksum(
          "p2-restore-group-memberships:v2",
          sourceCourseSerialized,
        ),
        restored: createTopologyChecksum(
          "p2-restore-group-memberships:v2",
          restoredCourseSerialized,
        ),
      },
      transcriptOwnership: {
        source: createTopologyChecksum(
          "p2-restore-transcript-ownership:v2",
          sourceTranscriptSerialized,
        ),
        restored: createTopologyChecksum(
          "p2-restore-transcript-ownership:v2",
          restoredTranscriptSerialized,
        ),
      },
    },
    mismatchCodes,
    safety: {
      valuesRedacted: true,
      messageContentOmitted: true,
      identifiersOmitted: true,
      privateFieldsOmitted: true,
    },
  };
}

export function assessP2RestoreRecordIntegrity({
  sourceRecordSets,
  restoredRecordSets,
} = {}) {
  const sourceValid = hasRequiredRecordSets(sourceRecordSets);
  const restoredValid = hasRequiredRecordSets(restoredRecordSets);
  const checksums = Object.fromEntries(
    requiredRecordSetNames.map((name) => [
      name,
      {
        source: createRecordSetChecksum(
          name,
          Array.isArray(sourceRecordSets?.[name])
            ? sourceRecordSets[name]
            : [],
        ),
        restored: createRecordSetChecksum(
          name,
          Array.isArray(restoredRecordSets?.[name])
            ? restoredRecordSets[name]
            : [],
        ),
      },
    ]),
  );
  const mismatchCodes = [
    ...(sourceValid ? [] : ["source-record-sets-invalid"]),
    ...(restoredValid ? [] : ["restored-record-sets-invalid"]),
    ...requiredRecordSetNames.flatMap((name) =>
      checksums[name].source === checksums[name].restored
        ? []
        : [`${name}-record-mismatch`],
    ),
  ];

  return {
    status: mismatchCodes.length === 0 ? "PASS" : "FAIL",
    counts: Object.fromEntries(
      requiredRecordSetNames.map((name) => [
        name,
        {
          source: Array.isArray(sourceRecordSets?.[name])
            ? sourceRecordSets[name].length
            : 0,
          restored: Array.isArray(restoredRecordSets?.[name])
            ? restoredRecordSets[name].length
            : 0,
        },
      ]),
    ),
    checksums,
    mismatchCodes,
    safety: {
      valuesRedacted: true,
      identifiersOmitted: true,
      privateFieldsOmitted: true,
      rowValuesComparedByDigest: true,
    },
  };
}

function normalizeCourseTopology(snapshotRows) {
  const snapshots = readSnapshotDatabases(snapshotRows);
  const groups = [];
  const memberships = [];
  const groupIds = new Set();
  const membershipIds = new Set();
  const allMemberIds = new Set();
  const approvedMembershipsByScope = new Set();
  let valid = snapshots.valid && snapshots.entries.length > 0;
  let groupMembers = 0;

  for (const { snapshotKey, database } of snapshots.entries) {
    const membershipCandidates = Array.isArray(database.memberships)
      ? database.memberships
      : [];
    const groupCandidates = Array.isArray(database.learningGroups)
      ? database.learningGroups
      : [];
    if (
      !Array.isArray(database.memberships) ||
      !Array.isArray(database.learningGroups) ||
      groupCandidates.length === 0
    ) {
      valid = false;
    }

    for (const candidate of membershipCandidates) {
      const membershipId = readIdentifier(candidate?.membershipId);
      const courseId = readIdentifier(candidate?.courseId);
      const classId = readIdentifier(candidate?.classId);
      const invitationCode = readIdentifier(candidate?.invitationCode);
      const studentId = readIdentifier(candidate?.studentId);
      const membershipStatus = candidate?.membershipStatus;
      const approvedByTeacherId = readOptionalIdentifier(
        candidate?.approvedByTeacherId,
      );
      const statusChangedByTeacherId = readOptionalIdentifier(
        candidate?.statusChangedByTeacherId,
      );
      if (
        !isRecord(candidate) ||
        !membershipId ||
        !courseId ||
        !classId ||
        !invitationCode ||
        !studentId ||
        !membershipStatuses.has(membershipStatus) ||
        approvedByTeacherId === undefined ||
        statusChangedByTeacherId === undefined ||
        snapshotKey !== courseId ||
        membershipIds.has(membershipId) ||
        (membershipStatus === "approved" && !approvedByTeacherId)
      ) {
        valid = false;
      }
      membershipIds.add(membershipId);
      if (membershipStatus === "approved") {
        approvedMembershipsByScope.add(
          createMembershipScope(courseId, classId, studentId),
        );
      }
      memberships.push({
        snapshotKey,
        membershipId,
        courseId,
        classId,
        invitationCodeDigest: createPrivateValueDigest(
          "p2-membership-invitation-code:v1",
          invitationCode,
        ),
        studentId,
        membershipStatus: membershipStatuses.has(membershipStatus)
          ? membershipStatus
          : null,
        approvedByTeacherId: approvedByTeacherId ?? null,
        statusChangedByTeacherId: statusChangedByTeacherId ?? null,
        recordDigest: createPrivateValueDigest(
          "p2-membership-record:v1",
          canonicalSerialize(candidate),
        ),
      });
    }

    for (const candidate of groupCandidates) {
      const members = Array.isArray(candidate?.members) ? candidate.members : [];
      const memberIds = members.map((member) => readIdentifier(member?.studentId));
      const groupId = readIdentifier(candidate?.groupId);
      const courseId = readIdentifier(candidate?.courseId);
      const classId = readOptionalIdentifier(candidate?.classId);
      const ownerTeacherId = readIdentifier(candidate?.ownerTeacherId);
      groupMembers += members.length;

      if (
        !isRecord(candidate) ||
        !groupId ||
        !courseId ||
        classId === undefined ||
        !ownerTeacherId ||
        snapshotKey !== courseId ||
        !Array.isArray(candidate.members) ||
        members.length === 0 ||
        memberIds.some((memberId) => !memberId) ||
        new Set(memberIds).size !== memberIds.length ||
        groupIds.has(groupId) ||
        memberIds.some((memberId) => allMemberIds.has(memberId)) ||
        memberIds.some(
          (memberId) =>
            !approvedMembershipsByScope.has(
              createMembershipScope(courseId, classId, memberId),
            ),
        )
      ) {
        valid = false;
      }

      groupIds.add(groupId);
      for (const memberId of memberIds) allMemberIds.add(memberId);
      groups.push({
        snapshotKey,
        groupId,
        courseId,
        classId: classId ?? null,
        ownerTeacherId,
        memberIds: memberIds.sort(compareText),
      });
    }
  }

  groups.sort(compareCanonicalObjects);
  memberships.sort(compareCanonicalObjects);
  return {
    valid,
    topology: {
      snapshotCount: snapshots.count,
      snapshotKeys: snapshots.entries
        .map((entry) => entry.snapshotKey)
        .sort(compareText),
      groups,
      memberships,
    },
    counts: {
      courseSnapshots: snapshots.count,
      groups: groups.length,
      groupMembers,
      memberships: memberships.length,
    },
    groupsById: new Map(
      groups.map((group) => [
        group.groupId,
        {
          courseId: group.courseId,
          classId: group.classId,
          ownerTeacherId: group.ownerTeacherId,
          memberIds: new Set(group.memberIds),
        },
      ]),
    ),
  };
}

function normalizeTranscriptTopology(snapshotRows) {
  const snapshots = readSnapshotDatabases(snapshotRows);
  const rooms = [];
  const roomIds = new Set();
  const groupIds = new Set();
  const messageIds = new Set();
  let valid = snapshots.valid && snapshots.entries.length > 0;
  let messages = 0;

  for (const { snapshotKey, database } of snapshots.entries) {
    const candidates = Array.isArray(database.transcripts)
      ? database.transcripts
      : [];
    if (!Array.isArray(database.transcripts) || candidates.length !== 1) {
      valid = false;
    }
    for (const candidate of candidates) {
      const transcriptId = readIdentifier(candidate?.transcriptId);
      const courseId = readIdentifier(candidate?.courseId);
      const classId = readOptionalIdentifier(candidate?.classId);
      const groupId = readIdentifier(candidate?.groupId);
      const creatorId = readIdentifier(candidate?.studentId);
      const messageCandidates = Array.isArray(candidate?.messages)
        ? candidate.messages
        : [];
      const normalizedMessages = [];
      messages += messageCandidates.length;

      if (
        !isRecord(candidate) ||
        !transcriptId ||
        snapshotKey !== transcriptId ||
        !courseId ||
        classId === undefined ||
        !groupId ||
        !creatorId ||
        !Array.isArray(candidate.messages) ||
        messageCandidates.length === 0 ||
        roomIds.has(transcriptId) ||
        groupIds.has(groupId)
      ) {
        valid = false;
      }
      roomIds.add(transcriptId);
      groupIds.add(groupId);

      for (const message of messageCandidates) {
        const messageId = readIdentifier(message?.messageId);
        const role = message?.role;
        const authorId = readOptionalIdentifier(message?.authorId);
        const authorRole = message?.authorRole;
        const agentId = readOptionalIdentifier(message?.agentId);
        const studentMessageValid =
          role === "student" &&
          Boolean(authorId) &&
          (authorRole === "student" || authorRole === "teacher") &&
          agentId === null;
        const agentMessageValid =
          role === "agent" &&
          Boolean(agentId) &&
          authorId === null &&
          authorRole === undefined;
        if (
          !isRecord(message) ||
          !messageId ||
          messageIds.has(messageId) ||
          authorId === undefined ||
          agentId === undefined ||
          (!studentMessageValid && !agentMessageValid)
        ) {
          valid = false;
        }
        messageIds.add(messageId);
        // Array order is intentional: chat order is application semantics, not
        // a set. The record digest binds content and all other persisted fields
        // without emitting any of them in the receipt.
        normalizedMessages.push({
          messageId,
          role: role === "agent" ? "agent" : "student",
          authorId: authorId ?? null,
          authorRole:
            authorRole === "student" || authorRole === "teacher"
              ? authorRole
              : null,
          agentId: agentId ?? null,
          recordDigest: createPrivateValueDigest(
            "p2-transcript-message-record:v1",
            canonicalSerialize(message),
          ),
        });
      }

      rooms.push({
        snapshotKey,
        transcriptId,
        courseId,
        classId: classId ?? null,
        groupId,
        creatorId,
        messages: normalizedMessages,
      });
    }
  }

  rooms.sort(compareCanonicalObjects);
  return {
    valid,
    topology: {
      snapshotCount: snapshots.count,
      snapshotKeys: snapshots.entries
        .map((entry) => entry.snapshotKey)
        .sort(compareText),
      rooms,
    },
    counts: {
      transcriptSnapshots: snapshots.count,
      rooms: rooms.length,
      messages,
    },
    rooms,
  };
}

function validateMessageOwnership(course, transcript) {
  if (!course.valid || !transcript.valid) return false;
  return transcript.rooms.every((room) => {
    const group = course.groupsById.get(room.groupId);
    if (
      !group ||
      group.courseId !== room.courseId ||
      group.classId !== room.classId ||
      !group.memberIds.has(room.creatorId)
    ) {
      return false;
    }
    return room.messages.every((message) => {
      if (message.role === "agent") return Boolean(message.agentId);
      if (message.authorRole === "teacher") {
        return message.authorId === group.ownerTeacherId;
      }
      return (
        message.authorRole === "student" &&
        Boolean(message.authorId) &&
        group.memberIds.has(message.authorId)
      );
    });
  });
}

function readSnapshotDatabases(snapshotRows) {
  if (!Array.isArray(snapshotRows)) {
    return { valid: false, count: 0, entries: [] };
  }
  let valid = snapshotRows.length > 0;
  const snapshotKeys = new Set();
  const entries = snapshotRows.flatMap((row) => {
    const snapshotKey = readIdentifier(row?.snapshot_key);
    const database = row?.database;
    if (
      !isRecord(row) ||
      !snapshotKey ||
      snapshotKeys.has(snapshotKey) ||
      !isRecord(database)
    ) {
      valid = false;
      return [];
    }
    snapshotKeys.add(snapshotKey);
    return [{ snapshotKey, database }];
  });
  if (entries.length !== snapshotRows.length) valid = false;
  return { valid, count: snapshotRows.length, entries };
}

function createMembershipScope(courseId, classId, studentId) {
  return `${courseId}\0${classId ?? ""}\0${studentId}`;
}

function readIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim()
    ? value
    : "";
}

function readOptionalIdentifier(value) {
  if (value === undefined || value === null || value === "") return null;
  return readIdentifier(value) || undefined;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCanonicalObjects(left, right) {
  return compareText(JSON.stringify(left), JSON.stringify(right));
}

function canonicalSerialize(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareText)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function hasRequiredRecordSets(value) {
  return (
    isRecord(value) &&
    requiredRecordSetNames.every((name) => Array.isArray(value[name]))
  );
}

function createRecordSetChecksum(name, rows) {
  const records = rows.map(canonicalSerialize).sort(compareText);
  return createPrivateValueDigest(
    `p2-restore-record-set:${name}:v1`,
    JSON.stringify(records),
  );
}

function createPrivateValueDigest(namespace, value) {
  return createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(String(Buffer.byteLength(value)))
    .update("\0")
    .update(value)
    .digest("hex");
}

function createTopologyChecksum(namespace, serializedTopology) {
  return createPrivateValueDigest(namespace, serializedTopology);
}
