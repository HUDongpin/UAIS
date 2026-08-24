import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assessP2RestoreIntegrity,
  assessP2RestoreRecordIntegrity,
} from "../scripts/lib/p2-restore-integrity.mjs";

describe("P2 restore topology integrity", () => {
  it("passes reordered snapshot rows, groups and members when ordered messages still match", () => {
    const source = createRestoreFixture();
    const restored = structuredClone(source);
    restored.courseSnapshots[0].database.learningGroups.reverse();
    for (const group of restored.courseSnapshots[0].database.learningGroups) {
      group.members.reverse();
    }
    restored.courseSnapshots[0].database.memberships.reverse();
    restored.transcriptSnapshots.reverse();
    for (const row of restored.transcriptSnapshots) {
      row.database.transcripts.reverse();
    }

    const receipt = assess(source, restored);

    expect(receipt).toEqual({
      status: "PASS",
      checks: {
        sourceCourseTopologyValid: true,
        restoredCourseTopologyValid: true,
        groupMembershipsExact: true,
        sourceTranscriptTopologyValid: true,
        restoredTranscriptTopologyValid: true,
        transcriptOwnershipExact: true,
        sourceMessageOwnershipValid: true,
        restoredMessageOwnershipValid: true,
      },
      counts: {
        source: {
          courseSnapshots: 1,
          groups: 2,
          groupMembers: 4,
          memberships: 4,
          transcriptSnapshots: 2,
          rooms: 2,
          messages: 5,
        },
        restored: {
          courseSnapshots: 1,
          groups: 2,
          groupMembers: 4,
          memberships: 4,
          transcriptSnapshots: 2,
          rooms: 2,
          messages: 5,
        },
      },
      checksums: {
        groupMemberships: {
          source: expect.stringMatching(/^[0-9a-f]{64}$/),
          restored: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        transcriptOwnership: {
          source: expect.stringMatching(/^[0-9a-f]{64}$/),
          restored: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      },
      mismatchCodes: [],
      safety: {
        valuesRedacted: true,
        messageContentOmitted: true,
        identifiersOmitted: true,
        privateFieldsOmitted: true,
      },
    });
    expect(receipt.checksums.groupMemberships.source).toBe(
      receipt.checksums.groupMemberships.restored,
    );
    expect(receipt.checksums.transcriptOwnership.source).toBe(
      receipt.checksums.transcriptOwnership.restored,
    );
  });

  it("fails when equal message counts hide messages moved across groups", () => {
    const source = createRestoreFixture();
    const restored = structuredClone(source);
    const alpha = restored.transcriptSnapshots[0].database.transcripts[0];
    const beta = restored.transcriptSnapshots[1].database.transcripts[0];
    [alpha.messages[0], beta.messages[0]] = [beta.messages[0], alpha.messages[0]];

    const receipt = assess(source, restored);

    expect(receipt.counts.restored.messages).toBe(receipt.counts.source.messages);
    expect(receipt.status).toBe("FAIL");
    expect(receipt.checks.transcriptOwnershipExact).toBe(false);
    expect(receipt.mismatchCodes).toContain("transcript-ownership-mismatch");
  });

  it("fails when an author is swapped to another valid member of the same group", () => {
    const source = createRestoreFixture();
    const restored = structuredClone(source);
    restored.transcriptSnapshots[0].database.transcripts[0].messages[0].authorId =
      "student-beta";

    const receipt = assess(source, restored);

    expect(receipt.counts.restored).toEqual(receipt.counts.source);
    expect(receipt.checks.restoredMessageOwnershipValid).toBe(true);
    expect(receipt.checks.transcriptOwnershipExact).toBe(false);
    expect(receipt.status).toBe("FAIL");
    expect(receipt.mismatchCodes).toEqual(["transcript-ownership-mismatch"]);
  });

  it("fails when chat message order changes even though the same messages remain", () => {
    const source = createRestoreFixture();
    const restored = structuredClone(source);
    restored.transcriptSnapshots[0].database.transcripts[0].messages.reverse();

    const receipt = assess(source, restored);

    expect(receipt.counts.restored).toEqual(receipt.counts.source);
    expect(receipt.checks.restoredTranscriptTopologyValid).toBe(true);
    expect(receipt.checks.transcriptOwnershipExact).toBe(false);
    expect(receipt.status).toBe("FAIL");
    expect(receipt.mismatchCodes).toContain("transcript-ownership-mismatch");
  });

  it("binds group owner, membership state and both snapshot keys", () => {
    const mutations: Array<(fixture: RestoreFixture) => void> = [
      (fixture) => {
        fixture.courseSnapshots[0].database.learningGroups[0].ownerTeacherId =
          "teacher-other";
      },
      (fixture) => {
        fixture.courseSnapshots[0].database.memberships[0].membershipStatus =
          "removed";
      },
      (fixture) => {
        fixture.courseSnapshots[0].snapshot_key = "course-other";
      },
      (fixture) => {
        fixture.transcriptSnapshots[0].snapshot_key = "room-other";
      },
    ];

    for (const mutate of mutations) {
      const source = createRestoreFixture();
      const restored = structuredClone(source);
      mutate(restored);
      expect(assess(source, restored).status).toBe("FAIL");
    }
  });

  it("fails when equal member counts hide students assigned to the wrong group", () => {
    const source = createRestoreFixture();
    const restored = structuredClone(source);
    const alphaMembers = restored.courseSnapshots[0].database.learningGroups[0].members;
    const betaMembers = restored.courseSnapshots[0].database.learningGroups[1].members;
    [alphaMembers[1].studentId, betaMembers[0].studentId] = [
      betaMembers[0].studentId,
      alphaMembers[1].studentId,
    ];

    const receipt = assess(source, restored);

    expect(receipt.counts.restored.groupMembers).toBe(
      receipt.counts.source.groupMembers,
    );
    expect(receipt.checks.groupMembershipsExact).toBe(false);
    expect(receipt.checks.restoredMessageOwnershipValid).toBe(false);
    expect(receipt.status).toBe("FAIL");
    expect(receipt.mismatchCodes).toEqual(
      expect.arrayContaining([
        "group-membership-mismatch",
        "restored-message-ownership-invalid",
      ]),
    );
  });

  it("fails closed on duplicate members and missing group-message authors even when both sides match", () => {
    const source = createRestoreFixture();
    source.courseSnapshots[0].database.learningGroups[0].members[1].studentId =
      "student-alpha";
    delete source.transcriptSnapshots[0].database.transcripts[0].messages[0].authorId;
    const restored = structuredClone(source);

    const receipt = assess(source, restored);

    expect(receipt.checks.groupMembershipsExact).toBe(true);
    expect(receipt.checks.transcriptOwnershipExact).toBe(true);
    expect(receipt.checks.sourceCourseTopologyValid).toBe(false);
    expect(receipt.checks.restoredCourseTopologyValid).toBe(false);
    expect(receipt.checks.sourceTranscriptTopologyValid).toBe(false);
    expect(receipt.checks.restoredTranscriptTopologyValid).toBe(false);
    expect(receipt.status).toBe("FAIL");
    expect(receipt.mismatchCodes).toEqual(
      expect.arrayContaining([
        "source-course-topology-invalid",
        "restored-course-topology-invalid",
        "source-transcript-topology-invalid",
        "restored-transcript-topology-invalid",
      ]),
    );
  });

  it("never returns message bodies, names, raw identifiers or unrelated private fields", () => {
    const source = createRestoreFixture();
    const restored = structuredClone(source);
    restored.transcriptSnapshots[1].database.transcripts[0].messages[0].authorId =
      "student-wrong-private-id";

    const serialized = JSON.stringify(assess(source, restored));

    for (const privateValue of [
      "secret-source-message-body",
      "private-student-name",
      "private-password-hash",
      "student-wrong-private-id",
      "student-alpha",
      "group-alpha",
      "message-alpha-student",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("fails every load-bearing record set when a count-preserving field changes", () => {
    const recordSetNames = [
      "users",
      "courses",
      "classes",
      "enrollments",
      "learningEvents",
      "learnerProfiles",
      "courseSnapshots",
      "inviteClaims",
      "transcriptSnapshots",
    ];
    const sourceRecordSets = Object.fromEntries(
      recordSetNames.map((name) => [
        name,
        [
          {
            id: `${name}-private-id`,
            state: "source-private-state",
            nested: { ordinal: 1 },
          },
        ],
      ]),
    );

    for (const name of recordSetNames) {
      const restoredRecordSets = structuredClone(sourceRecordSets);
      restoredRecordSets[name][0].nested.ordinal = 2;
      const receipt = assessP2RestoreRecordIntegrity({
        sourceRecordSets,
        restoredRecordSets,
      });
      expect(receipt.status).toBe("FAIL");
      expect(receipt.mismatchCodes).toEqual([`${name}-record-mismatch`]);
      expect(JSON.stringify(receipt)).not.toContain(`${name}-private-id`);
      expect(JSON.stringify(receipt)).not.toContain("source-private-state");
    }
  });

  it("fails closed when a required restored record set is absent", () => {
    const sourceRecordSets = createEmptyRestoreRecordSets();
    const restoredRecordSets = createEmptyRestoreRecordSets();
    delete restoredRecordSets.classes;

    const receipt = assessP2RestoreRecordIntegrity({
      sourceRecordSets,
      restoredRecordSets,
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.mismatchCodes).toContain("restored-record-sets-invalid");
  });

  it("wires exact topology evidence into the live restore result before PASS labels", () => {
    const source = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");
    expect(source).toContain('from "./lib/p2-restore-integrity.mjs";');
    expect(source).toContain("assessP2RestoreRecordIntegrity");
    expect(source).toContain("const restoreIntegrity = assessP2RestoreIntegrity({");
    expect(source).toContain(
      "const recordIntegrity = createDeterministicChecksum({",
    );
    expect(source).toContain("restoreTopology: restoreIntegrity.status === \"PASS\"");
    expect(source).toContain(
      "fieldChecksums: checksumsMatch",
    );
    expect(source).toContain("topologyIntegrity: restored.restoreIntegrity");
    expect(source).toContain("SELECT snapshot_key, database, revision, updated_at");
    expect(source).toContain("classes: classRows.length");
    expect(source).toContain("enrollments: enrollmentRows.length");
    expect(source).toContain("counts.learningEvents");
    expect(source).toContain("counts.learnerProfiles");
    expect(source).not.toContain('relationships: "PASS"');
    expect(source).not.toContain('groupIsolation: "PASS"');
  });

  it("preserves the class external key through capture, restore and readback", () => {
    const source = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");
    const compactSource = source.replace(/\s+/g, " ");

    expect(compactSource).toContain(
      "SELECT id, course_id, teacher_id, external_key, name, status, created_at, updated_at FROM uais_classes",
    );
    expect(compactSource).toContain(
      "INSERT INTO uais_classes ( id, course_id, teacher_id, external_key, name, status, created_at, updated_at )",
    );
    expect(compactSource).toContain(
      "${row.id}, ${row.course_id}, ${row.teacher_id}, ${row.external_key}, ${row.name},",
    );
    expect(compactSource).toContain(
      "SELECT cl.id, cl.course_id, cl.teacher_id, cl.external_key, cl.name, cl.status,",
    );
  });

  it("keeps run, fixture, course and Vercel request identifiers out of receipts", () => {
    const source = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");

    expect(source).toContain(
      'runFingerprint: sha256Fingerprint(`p2-staging-run:${runId}`)',
    );
    expect(source).toContain("manualAccountCount: 2");
    expect(source).toContain('manualCourseReference: "omitted"');
    expect(source).toContain("requestIdPresent: Boolean(");
    expect(source).not.toContain("\n  runId,\n");
    expect(source).not.toContain("manualAccounts: {");
    expect(source).not.toContain("\n    manualCourseId,\n");
    expect(source).not.toContain(
      'requestId: response.headers.get("x-vercel-id")',
    );
  });
});

function assess(source: RestoreFixture, restored: RestoreFixture) {
  return assessP2RestoreIntegrity({
    sourceCourseSnapshots: source.courseSnapshots,
    restoredCourseSnapshots: restored.courseSnapshots,
    sourceTranscriptSnapshots: source.transcriptSnapshots,
    restoredTranscriptSnapshots: restored.transcriptSnapshots,
  });
}

function createRestoreFixture() {
  const learningGroups = [
    {
      groupId: "group-alpha",
      courseId: "course-private",
      classId: "class-private",
      ownerTeacherId: "teacher-private",
      groupName: "private-group-name",
      members: [
        {
          studentId: "student-alpha",
          studentDisplayName: "private-student-name",
          addedAt: "2026-08-25T00:00:00.000Z",
        },
        {
          studentId: "student-beta",
          studentDisplayName: "private-second-name",
          addedAt: "2026-08-25T00:00:00.000Z",
        },
      ],
    },
    {
      groupId: "group-beta",
      courseId: "course-private",
      classId: "class-private",
      ownerTeacherId: "teacher-private",
      groupName: "private-other-group-name",
      members: [
        {
          studentId: "student-gamma",
          studentDisplayName: "private-third-name",
          addedAt: "2026-08-25T00:00:00.000Z",
        },
        {
          studentId: "student-delta",
          studentDisplayName: "private-fourth-name",
          addedAt: "2026-08-25T00:00:00.000Z",
        },
      ],
    },
  ];
  const memberships = [
    ["student-alpha", "class-private"],
    ["student-beta", "class-private"],
    ["student-gamma", "class-private"],
    ["student-delta", "class-private"],
  ].map(([studentId, classId]) => ({
    membershipId: `membership-${studentId}`,
    courseId: "course-private",
    classId,
    invitationCode: "private-invite-code",
    studentId,
    studentDisplayName: `private-name-${studentId}`,
    membershipStatus: "approved",
    approvedByTeacherId: "teacher-private",
    joinedAt: "2026-08-25T00:00:00.000Z",
  }));
  const transcriptSnapshots = [
    createTranscriptSnapshot({
      snapshotKey: "room-alpha",
      transcriptId: "room-alpha",
      groupId: "group-alpha",
      creatorId: "student-alpha",
      messages: [
        {
          messageId: "message-alpha-student",
          role: "student",
          authorId: "student-alpha",
          authorRole: "student",
          authorName: "private-student-name",
          content: "secret-source-message-body",
        },
        {
          messageId: "message-alpha-teacher",
          role: "student",
          authorId: "teacher-private",
          authorRole: "teacher",
          authorName: "private-teacher-name",
          content: "secret-teacher-message-body",
        },
        {
          messageId: "message-alpha-agent",
          role: "agent",
          agentId: "research-agent-private",
          content: "secret-agent-message-body",
        },
      ],
    }),
    createTranscriptSnapshot({
      snapshotKey: "room-beta",
      transcriptId: "room-beta",
      groupId: "group-beta",
      creatorId: "student-gamma",
      messages: [
        {
          messageId: "message-beta-student-one",
          role: "student",
          authorId: "student-gamma",
          authorRole: "student",
          authorName: "private-third-name",
          content: "secret-beta-message-body",
        },
        {
          messageId: "message-beta-student-two",
          role: "student",
          authorId: "student-delta",
          authorRole: "student",
          authorName: "private-fourth-name",
          content: "secret-beta-second-body",
        },
      ],
    }),
  ];

  return {
    courseSnapshots: [
      {
        snapshot_key: "course-private",
        database: {
          schemaVersion: "uais-teaching-course-management-v1",
          updatedAt: "2026-08-25T00:00:00.000Z",
          learningGroups,
          memberships,
          auditEvents: [],
          privatePasswordHash: "private-password-hash",
        },
      },
    ],
    transcriptSnapshots,
  };
}

function createTranscriptSnapshot(input: {
  snapshotKey: string;
  transcriptId: string;
  groupId: string;
  creatorId: string;
  messages: Array<{
    messageId: string;
    role: string;
    authorId?: string;
    authorRole?: string;
    authorName?: string;
    agentId?: string;
    content: string;
  }>;
}) {
  return {
    snapshot_key: input.snapshotKey,
    database: {
      schemaVersion: "uais-learning-chatroom-transcripts-v2",
      updatedAt: "2026-08-25T00:00:00.000Z",
      transcripts: [
        {
          transcriptId: input.transcriptId,
          courseId: "course-private",
          classId: "class-private",
          groupId: input.groupId,
          studentId: input.creatorId,
          messages: input.messages.map((message) => ({
            ...message,
            createdAt: "2026-08-25T00:00:00.000Z",
          })),
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
        },
      ],
    },
  };
}

type RestoreFixture = ReturnType<typeof createRestoreFixture>;

function createEmptyRestoreRecordSets() {
  return {
    users: [],
    courses: [],
    classes: [],
    enrollments: [],
    learningEvents: [],
    learnerProfiles: [],
    courseSnapshots: [],
    inviteClaims: [],
    transcriptSnapshots: [],
  };
}
