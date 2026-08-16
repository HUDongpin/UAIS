import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createLearningChatroomShareMintPostHandler } from "@/app/api/learning/chatroom/share/route";
import { createLearningChatroomShareRevokeDeleteHandler } from "@/app/api/learning/chatroom/share/[shareId]/route";
import { ChatroomTranscriptDocument } from "@/app/learning/chatroom/export/chatroom-transcript-document";
import {
  createLearningChatroomExportUrl,
  requestLearningChatroomShareLink,
} from "@/lib/chat-actions";
import {
  createEmptyLearningChatroomShareDatabase,
  createLearningChatroomShare,
  createLearningChatroomShareId,
  isLearningChatroomShareActive,
  learningChatroomShareSchemaVersion,
  normalizeLearningChatroomShareDatabase,
  readLearningChatroomShare,
  readLearningChatroomShareDatabase,
  revokeLearningChatroomShare,
} from "@/lib/server/learning-chatroom-share-store";
import {
  loadLearningChatroomExportDocument,
  loadLearningChatroomShareDocument,
} from "@/lib/server/learning-chatroom-share-view";
import { createAiRequestRateLimiter } from "@/lib/server/ai-request-rate-limit";
import {
  createLearningChatroomShareReadRateLimiter,
  learningChatroomShareViewerUnknownKey,
  resolveLearningChatroomShareViewerKey,
} from "@/lib/server/learning-chatroom-share-rate-limit";
import type { LearningChatroomShareRepository } from "@/lib/server/learning-chatroom-share-store";
import {
  appendLearningChatroomTranscriptMessages,
  learningChatroomGroupTranscriptMaxMessages,
  setLearningChatroomTranscriptMessageModeration,
} from "@/lib/server/learning-chatroom-transcript-store";
import { normalizeTeachingCourseManagementDatabase } from "@/lib/server/teaching-course-management-store";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import type { TeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-store";

// Phase 5 (S24/S12/S04) export + share. Everything runs through the real handler
// factories and the real store with the house harness: injected env (never
// `process.env`), signed test cookies, mkdtemp fixtures, injected clock and id
// minter, no sleeps and no network.
//
// The invariant every assertion here circles back to: a share link publishes a
// room to whoever holds it, so nothing on the API or the page may carry a
// student account id - only display names.

const appSessionSigningSecret = "test-app-session-signing-secret-32ch";
const stableFutureIssueTime = new Date("2099-01-01T00:00:00.000Z");

// Accounts are safe ids; display names are the CJK strings a roster renders, so
// an assertion can never confuse "who they are" with "what is shown".
const groupMemberOne = { account: "PeterChen", displayName: "陈可" };
const groupMemberTwo = { account: "LinRuochen", displayName: "林若晨" };
const otherGroupMember = { account: "ZhaoMing", displayName: "赵铭" };
const courseOnlyStudent = { account: "SunLei", displayName: "孙磊" };
const owningTeacher = { account: "teacher-kang", displayName: "康霞" };
const foreignTeacher = { account: "teacher-lin", displayName: "林老师" };

const shareFixtureDirs: string[] = [];

// The share loader throttles per viewer against a MODULE-LEVEL limiter on the
// wall clock when no limiter is injected. Left alone, every loader call in this
// file would share one process-wide bucket, so the suite would carry hidden
// cross-test state and fail as a cliff once it accumulated enough calls in one
// minute (or was run with --repeat, or shared a worker with another importer).
// Every test therefore gets a fresh limiter, and `loadShareDocument` is the only
// way this file reaches the loader without naming one explicitly.
let shareViewRateLimiter = createLearningChatroomShareReadRateLimiter();

// The moment every clock-free assertion in this file is judged at: half an hour
// after the fixture mints, and well inside the 14-day default life of a link.
// Pinned rather than left to `Date.now()` because the loader now reads the same
// clock twice - the throttle window AND whether the share has expired - so an
// unpinned suite would start failing on a calendar date rather than on a change.
const shareViewNowMs = Date.parse("2026-08-08T14:30:00.000Z");

function loadShareDocument(
  input: Parameters<typeof loadLearningChatroomShareDocument>[0],
) {
  return loadLearningChatroomShareDocument({
    rateLimiter: shareViewRateLimiter,
    nowMs: shareViewNowMs,
    ...input,
  });
}

beforeEach(() => {
  shareViewRateLimiter = createLearningChatroomShareReadRateLimiter();
});

afterAll(async () => {
  await Promise.all(
    shareFixtureDirs.map((dataDir) => rm(dataDir, { recursive: true, force: true })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function expectNoAccountIds(value: unknown) {
  const serialized = JSON.stringify(value) ?? "";
  [
    groupMemberOne,
    groupMemberTwo,
    otherGroupMember,
    courseOnlyStudent,
    owningTeacher,
    foreignTeacher,
  ].forEach((user) => {
    expect(serialized).not.toContain(user.account);
  });
  expect(serialized).not.toContain(appSessionSigningSecret);
  expect(serialized).not.toContain("/Users/");
}

async function createShareFixture(input: { groupsMode?: string } = {}) {
  const courseId = "elementary-math-research";
  const classId = `${courseId}-class-1`;
  const dataDir = await mkdtemp(join(tmpdir(), "uais-learning-chatroom-share-"));
  shareFixtureDirs.push(dataDir);

  await writeFile(
    join(dataDir, "teaching-course-management.json"),
    JSON.stringify(createShareCourseDatabase({ courseId, classId })),
  );

  return {
    courseId,
    classId,
    groupId: "group-three",
    groupName: "第三小组",
    otherGroupId: "group-four",
    dataDir,
    env: {
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
      // Shares and transcripts both ride the course data dir, so one injected
      // variable covers all three stores in the fixture.
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      ...(input.groupsMode === undefined
        ? {}
        : { UAIS_LEARNING_CHATROOM_GROUPS_MODE: input.groupsMode }),
    } as Record<string, string | undefined>,
    cookieFor: (
      user: { account: string; displayName: string },
      role: UaisAppSessionUser["role"] = "student",
    ) =>
      createUaisAppSessionCookie(
        {
          account: user.account,
          displayName: user.displayName,
          department: role === "student" ? "学生账号" : "教师账号",
          role,
        },
        {
          secret: appSessionSigningSecret,
          now: stableFutureIssueTime,
          sessionId: `chatroom-share-session-${user.account}`,
        },
      ),
  };
}

function createShareCourseDatabase(input: { courseId: string; classId: string }) {
  const now = "2026-08-08T12:00:00.000Z";
  const redaction = {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
  const envelope = {
    storagePolicy: "local-json-teaching-course-management",
    storageWritePolicy: "atomic-json-file-replace",
    responsibleSession: "S12",
    redaction,
  };
  const students = [groupMemberOne, groupMemberTwo, otherGroupMember, courseOnlyStudent];

  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: now,
    courses: [
      {
        courseId: input.courseId,
        ownerTeacherId: owningTeacher.account,
        courseName: "初等数学研究",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2026 春季",
        status: "draft",
        students: students.length,
        createdAt: now,
        updatedAt: now,
        ...envelope,
      },
    ],
    classes: [
      {
        classId: input.classId,
        courseId: input.courseId,
        ownerTeacherId: owningTeacher.account,
        className: "初等数学研究一班",
        students: students.length,
        semester: "2026 春季",
        invitationCode: "55395057",
        joinUrl: "/courses?invite=55395057",
        createdAt: now,
        updatedAt: now,
        ...envelope,
      },
    ],
    memberships: students.map((student) => ({
      membershipId: `membership-${input.classId}-${student.account}`,
      courseId: input.courseId,
      classId: input.classId,
      invitationCode: "55395057",
      studentId: student.account,
      studentDisplayName: student.displayName,
      membershipStatus: "approved",
      approvedAt: now,
      approvedByTeacherId: owningTeacher.account,
      joinedAt: now,
      ...envelope,
    })),
    learningGroups: [
      {
        groupId: "group-three",
        courseId: input.courseId,
        classId: input.classId,
        ownerTeacherId: owningTeacher.account,
        groupName: "第三小组",
        members: [groupMemberOne, groupMemberTwo].map((student) => ({
          studentId: student.account,
          studentDisplayName: student.displayName,
          addedAt: now,
        })),
        createdAt: now,
        updatedAt: now,
        ...envelope,
      },
      {
        groupId: "group-four",
        courseId: input.courseId,
        classId: input.classId,
        ownerTeacherId: owningTeacher.account,
        groupName: "第四小组",
        members: [otherGroupMember, courseOnlyStudent].map((student) => ({
          studentId: student.account,
          studentDisplayName: student.displayName,
          addedAt: now,
        })),
        createdAt: now,
        updatedAt: now,
        ...envelope,
      },
    ],
    auditEvents: [],
  };
}

// Seeds a room the way a real round would have left it: student rows attributed
// to their author, agent rows unattributed.
async function seedGroupRoomTranscript(fixture: {
  dataDir: string;
  courseId: string;
  classId: string;
  groupId: string;
}) {
  await appendLearningChatroomTranscriptMessages({
    dataDir: fixture.dataDir,
    courseId: fixture.courseId,
    classId: fixture.classId,
    groupId: fixture.groupId,
    studentId: groupMemberOne.account,
    now: "2026-08-08T13:00:00.000Z",
    messages: [
      {
        messageId: "room-1",
        role: "student",
        content: "@研究助教 我们的变量怎么定？",
        authorId: groupMemberOne.account,
        authorName: groupMemberOne.displayName,
        createdAt: "2026-08-08T13:00:00.000Z",
      },
      {
        messageId: "room-2",
        role: "agent",
        agentId: "research-assistant",
        content: "先把自变量和因变量写清楚。",
        createdAt: "2026-08-08T13:01:00.000Z",
      },
      {
        messageId: "room-3",
        role: "student",
        content: "我来整理一下数据来源。",
        authorId: groupMemberTwo.account,
        authorName: groupMemberTwo.displayName,
        createdAt: "2026-08-08T13:02:00.000Z",
      },
    ],
  });
}

function createShareHandlers(
  fixture: { env: Record<string, string | undefined> },
  options: { nowMs?: number; shareIds?: string[] } = {},
) {
  const nowMs = options.nowMs ?? Date.parse("2026-08-08T14:00:00.000Z");
  const shareIds = [...(options.shareIds ?? [])];
  return {
    mintShare: createLearningChatroomShareMintPostHandler({
      env: fixture.env,
      now: () => nowMs,
      ...(shareIds.length > 0
        ? { createShareId: () => shareIds.shift() ?? createLearningChatroomShareId() }
        : {}),
    }),
    revokeShare: createLearningChatroomShareRevokeDeleteHandler({
      env: fixture.env,
      now: () => nowMs + 60000,
    }),
  };
}

function createMintRequest(
  body: { courseId?: string; classId?: string; groupId?: string },
  cookie?: string,
) {
  return new Request("http://localhost/api/learning/chatroom/share", {
    method: "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createRevokeRequest(shareId: string, cookie?: string) {
  return {
    request: new Request(`http://localhost/api/learning/chatroom/share/${shareId}`, {
      method: "DELETE",
      ...(cookie ? { headers: { cookie } } : {}),
    }),
    context: { params: Promise.resolve({ shareId }) },
  };
}

// A read-only teaching-course repository so course authorization uses the
// repository path instead of local JSON. This isolates the production-503 test:
// the assertion is that the SHARE store is the one that refuses production local
// JSON, not that authorization tripped the teaching store's own identical guard
// first (both read the same VERCEL_ENV/NODE_ENV/UAIS_DEPLOYMENT_ENV markers).
function createCourseRepositoryDouble(database: unknown): TeachingCourseManagementRepository {
  return {
    storage: {
      recordStoragePolicy: "external-redacted-teaching-course-management-snapshot",
      auditStoragePolicy: "external-redacted-teaching-course-management-audit-log",
      storageWritePolicy: "external-optimistic-snapshot-replace",
    },
    read: async () => ({
      database: normalizeTeachingCourseManagementDatabase(database),
      revision: "rev-course-1",
    }),
    write: async () => {
      throw new Error("read-only course repository double");
    },
  };
}

async function mintGroupShare(fixture: Awaited<ReturnType<typeof createShareFixture>>) {
  const { mintShare } = createShareHandlers(fixture);
  const response = await mintShare(
    createMintRequest(
      { courseId: fixture.courseId, groupId: fixture.groupId },
      fixture.cookieFor(groupMemberOne),
    ),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { share: { shareId: string } };
  return body.share.shareId;
}

describe("UAIS learning chatroom share records", () => {
  it("round-trips a share through the local store and stops resolving once revoked", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });

    const { record, receipt } = await createLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId: "share-roundtrip0000000000000000001",
      courseId: fixture.courseId,
      classId: fixture.classId,
      groupId: fixture.groupId,
      createdBy: groupMemberOne.account,
      now: "2026-08-08T14:00:00.000Z",
    });

    expect(receipt).toEqual(
      expect.objectContaining({
        status: "created",
        shareId: record.shareId,
        storagePolicy: "local-json-learning-chatroom-shares",
        storageWritePolicy: "atomic-json-file-replace",
        concurrencyControl: "atomic-json-file-replace",
        responsibleSession: "S12",
      }),
    );

    const stored = await readLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId: record.shareId,
    });
    expect(stored).toEqual(record);
    expect(isLearningChatroomShareActive(stored, { nowMs: shareViewNowMs })).toBe(true);

    const database = await readLearningChatroomShareDatabase({ dataDir: fixture.dataDir });
    expect(database.schemaVersion).toBe(learningChatroomShareSchemaVersion);
    expect(database.shares).toHaveLength(1);

    const revocation = await revokeLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId: record.shareId,
      now: "2026-08-08T15:00:00.000Z",
    });
    expect(revocation.status).toBe("revoked");

    const revoked = await readLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId: record.shareId,
    });
    expect(revoked?.revokedAt).toBe("2026-08-08T15:00:00.000Z");
    expect(isLearningChatroomShareActive(revoked, { nowMs: shareViewNowMs })).toBe(false);

    // Revoking twice keeps the first revocation: the moment a link died is not
    // rewritten by a second attempt.
    const again = await revokeLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId: record.shareId,
      now: "2026-08-08T16:00:00.000Z",
    });
    expect(again.status).toBe("not-found");
    const stillRevoked = await readLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId: record.shareId,
    });
    expect(stillRevoked?.revokedAt).toBe("2026-08-08T15:00:00.000Z");
  });

  it("mints unguessable ids and normalizes a stored database tolerantly", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createLearningChatroomShareId()));
    expect(ids.size).toBe(50);
    ids.forEach((shareId) => {
      expect(shareId).toMatch(/^share-[0-9a-f]{32}$/);
    });

    const normalized = normalizeLearningChatroomShareDatabase({
      schemaVersion: learningChatroomShareSchemaVersion,
      updatedAt: "2026-08-08T14:00:00.000Z",
      shares: [
        {
          shareId: "share-tolerant000000000000000001",
          courseId: "  elementary-math-research  ",
          createdBy: "PeterChen",
          createdAt: "2026-08-08T14:00:00.000Z",
          // Unknown keys are dropped rather than carried into the record.
          unexpectedField: "ignored",
        },
      ],
    });
    expect(normalized.shares[0]).toEqual({
      shareId: "share-tolerant000000000000000001",
      courseId: "elementary-math-research",
      createdBy: "PeterChen",
      createdAt: "2026-08-08T14:00:00.000Z",
      // The record carries no `expiresAt` - it predates share expiry - and is
      // read as ending 14 days after it was minted. Normalizing on read rather
      // than through a migration is what makes the rule reach a database this
      // build has never written, including one an external backend still holds.
      expiresAt: "2026-08-22T14:00:00.000Z",
      storagePolicy: "local-json-learning-chatroom-shares",
      storageWritePolicy: "atomic-json-file-replace",
      responsibleSession: "S12",
      redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
    });

    expect(createEmptyLearningChatroomShareDatabase().shares).toEqual([]);
    // A database written by some other product is never silently adopted.
    expect(() =>
      normalizeLearningChatroomShareDatabase({
        schemaVersion: "uais-learning-chatroom-shares-v99",
        shares: [],
      }),
    ).toThrow(/invalid/i);
  });
});

describe("POST /api/learning/chatroom/share", () => {
  it("lets a group member mint a link scoped to the room, with no account ids in the answer", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    const { mintShare } = createShareHandlers(fixture, {
      shareIds: ["share-minted00000000000000000001"],
    });

    const response = await mintShare(
      createMintRequest(
        // `classId` deliberately omitted: the group record decides the class
        // scope, exactly as the chatroom handlers do.
        { courseId: fixture.courseId, groupId: fixture.groupId },
        fixture.cookieFor(groupMemberOne),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.share).toEqual({
      shareId: "share-minted00000000000000000001",
      courseId: fixture.courseId,
      classId: fixture.classId,
      groupId: fixture.groupId,
      createdAt: "2026-08-08T14:00:00.000Z",
      // Every link ends. Returned so the room can tell whoever copied it when it
      // stops working, instead of the link simply going dead one day.
      expiresAt: "2026-08-22T14:00:00.000Z",
    });
    expect(body.sharePath).toBe("/share/share-minted00000000000000000001");
    expect(body.shareUrl).toBe(
      "http://localhost/share/share-minted00000000000000000001",
    );
    expect(body.receipt.status).toBe("created");
    expectNoAccountIds(body);

    // The record itself keeps the creator, because revocation needs it - it just
    // never leaves the server.
    const stored = await readLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId: "share-minted00000000000000000001",
    });
    expect(stored?.createdBy).toBe(groupMemberOne.account);
  });

  it("lets a course member mint a link for their own legacy room", async () => {
    const fixture = await createShareFixture();
    const { mintShare } = createShareHandlers(fixture, {
      shareIds: ["share-legacy00000000000000000001"],
    });

    const response = await mintShare(
      createMintRequest(
        { courseId: fixture.courseId, classId: fixture.classId },
        fixture.cookieFor(courseOnlyStudent),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.share).toEqual({
      shareId: "share-legacy00000000000000000001",
      courseId: fixture.courseId,
      classId: fixture.classId,
      createdAt: "2026-08-08T14:00:00.000Z",
      expiresAt: "2026-08-22T14:00:00.000Z",
    });
    expect(body.share.groupId).toBeUndefined();
    expectNoAccountIds(body);
  });

  it("refuses a caller who is not in the group", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    const { mintShare } = createShareHandlers(fixture);

    const response = await mintShare(
      createMintRequest(
        { courseId: fixture.courseId, groupId: fixture.groupId },
        fixture.cookieFor(otherGroupMember),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.reasonCode).toBe("share-membership-required");
    expect(body.access.reasonCode).toBe("student-group-membership-required");
    const database = await readLearningChatroomShareDatabase({ dataDir: fixture.dataDir });
    expect(database.shares).toHaveLength(0);
  });

  it("keeps group minting member-only even though the teacher speaks in the room", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    const { mintShare } = createShareHandlers(fixture);

    // Teaching presence let the teacher POST into the room, but publishing it is
    // a different exposure: `/share/[shareId]` renders members' display names and
    // messages to signed-out visitors, and a member cannot revoke a link they did
    // not create. So minting stays member-only, pinned here explicitly so a later
    // change to room access cannot quietly grant it.
    const response = await mintShare(
      createMintRequest(
        { courseId: fixture.courseId, groupId: fixture.groupId },
        fixture.cookieFor(owningTeacher, "teacher"),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.reasonCode).toBe("share-membership-required");
    expect(body.access.reasonCode).toBe("teacher-group-share-member-only");
    const database = await readLearningChatroomShareDatabase({ dataDir: fixture.dataDir });
    expect(database.shares).toHaveLength(0);
  });

  it("refuses a group link while the feature flag is off", async () => {
    const fixture = await createShareFixture();
    const { mintShare } = createShareHandlers(fixture);

    const response = await mintShare(
      createMintRequest(
        { courseId: fixture.courseId, groupId: fixture.groupId },
        fixture.cookieFor(groupMemberOne),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access.reasonCode).toBe("feature-not-enabled");
    const database = await readLearningChatroomShareDatabase({ dataDir: fixture.dataDir });
    expect(database.shares).toHaveLength(0);
  });

  it("requires a session and a course", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    const { mintShare } = createShareHandlers(fixture);

    const anonymous = await mintShare(
      createMintRequest({ courseId: fixture.courseId, groupId: fixture.groupId }),
    );
    expect(anonymous.status).toBe(401);

    const withoutCourse = await mintShare(
      createMintRequest({}, fixture.cookieFor(groupMemberOne)),
    );
    expect(withoutCourse.status).toBe(400);
  });

  it("refuses production local-JSON minting with the designed 503, not a 500 or 201", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    // Course authorization runs through a repository double, so the only store
    // still on local JSON is the SHARE store. That is what must surface the 503.
    const courseRepository = createCourseRepositoryDouble(
      createShareCourseDatabase({ courseId: fixture.courseId, classId: fixture.classId }),
    );
    const mintShare = createLearningChatroomShareMintPostHandler({
      // The same env markers the share store checks (mirrors the transcript store).
      env: { ...fixture.env, UAIS_DEPLOYMENT_ENV: "production" },
      now: () => Date.parse("2026-08-08T14:00:00.000Z"),
      courseRepository,
    });

    const response = await mintShare(
      createMintRequest(
        { courseId: fixture.courseId, groupId: fixture.groupId },
        fixture.cookieFor(groupMemberOne),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe(
      "Production learning chatroom share persistence requires external storage.",
    );
    // Nothing was written to the local store.
    const database = await readLearningChatroomShareDatabase({ dataDir: fixture.dataDir });
    expect(database.shares).toHaveLength(0);
    expectNoAccountIds(body);
  });

  it("pins the mint rate limiter at 10 links per minute per actor, then recovers", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    let nowMs = Date.parse("2026-08-08T14:00:00.000Z");
    const mintShare = createLearningChatroomShareMintPostHandler({
      env: fixture.env,
      now: () => nowMs,
    });
    const cookie = fixture.cookieFor(groupMemberOne);
    const mint = () =>
      mintShare(
        createMintRequest({ courseId: fixture.courseId, groupId: fixture.groupId }, cookie),
      );

    // Ten links at one fixed instant exactly fill the per-minute window.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const ok = await mint();
      expect(ok.status).toBe(201);
    }

    const throttled = await mint();
    const throttledBody = await throttled.json();
    expect(throttled.status).toBe(429);
    expect(throttledBody.error).toBe(
      "Learning chatroom share rate limit exceeded. Please wait before creating another link.",
    );
    const retryAfter = throttled.headers.get("retry-after");
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expectNoAccountIds(throttledBody);

    // Past the per-minute window the same actor mints again (the per-day ceiling
    // of 200 is nowhere near exhausted).
    nowMs += 61000;
    const recovered = await mint();
    expect(recovered.status).toBe(201);
  });
});

describe("DELETE /api/learning/chatroom/share/[shareId]", () => {
  it("lets the creating member revoke, after which the public lookup is a 404", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);
    const shareId = await mintGroupShare(fixture);
    const { revokeShare } = createShareHandlers(fixture);

    const before = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
    });
    expect(before.status).toBe("ready");

    const { request, context } = createRevokeRequest(
      shareId,
      fixture.cookieFor(groupMemberOne),
    );
    const response = await revokeShare(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.share.shareId).toBe(shareId);
    expect(body.share.revokedAt).toBe("2026-08-08T14:01:00.000Z");
    expect(body.receipt.status).toBe("revoked");
    expectNoAccountIds(body);

    const after = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
    });
    expect(after.status).toBe("not-found");
  });

  it("throttles a looping revoker before it reaches the shares snapshot", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    const shareId = await mintGroupShare(fixture);

    // The limiter is injected and its single unit of budget is spent up front,
    // so the handler's very first call is the throttled one. Pairing that with a
    // repository that throws on any access proves the guard runs BEFORE the
    // snapshot read rather than merely changing the status afterwards.
    const revokeNowMs = Date.parse("2026-08-08T14:01:00.000Z");
    const rateLimiter = createAiRequestRateLimiter({
      config: { mode: "enforce", windows: [{ id: "per-minute", limit: 1, windowMs: 60000 }] },
    });
    rateLimiter.check({ key: groupMemberOne.account, nowMs: revokeNowMs });

    const revokeShare = createLearningChatroomShareRevokeDeleteHandler({
      env: fixture.env,
      now: () => revokeNowMs,
      rateLimiter,
      shareRepository: createThrowingShareRepository(),
    });

    const { request, context } = createRevokeRequest(
      shareId,
      fixture.cookieFor(groupMemberOne),
    );
    const response = await revokeShare(request, context);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(body.error).toContain("rate limit exceeded");
    expectNoAccountIds(body);

    // A different actor keeps their own budget: the limiter keys per account.
    const other = createRevokeRequest(shareId, fixture.cookieFor(owningTeacher, "teacher"));
    const allowed = await revokeShare(other.request, other.context);
    expect(allowed.status).not.toBe(429);
  });

  it("lets the course-owning teacher revoke a link a student minted", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    const shareId = await mintGroupShare(fixture);
    const { revokeShare } = createShareHandlers(fixture);

    const { request, context } = createRevokeRequest(
      shareId,
      fixture.cookieFor(owningTeacher, "teacher"),
    );
    const response = await revokeShare(request, context);

    expect(response.status).toBe(200);
    const stored = await readLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId,
    });
    expect(isLearningChatroomShareActive(stored, { nowMs: shareViewNowMs })).toBe(false);
  });

  it("refuses another group member, a foreign teacher, and an unknown id", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    const shareId = await mintGroupShare(fixture);
    const { revokeShare } = createShareHandlers(fixture);

    const byCoMember = await revokeShare(
      ...toRevokeArgs(createRevokeRequest(shareId, fixture.cookieFor(groupMemberTwo))),
    );
    const coMemberBody = await byCoMember.json();
    expect(byCoMember.status).toBe(403);
    expect(coMemberBody.reasonCode).toBe("share-revocation-denied");

    const byForeignTeacher = await revokeShare(
      ...toRevokeArgs(
        createRevokeRequest(shareId, fixture.cookieFor(foreignTeacher, "teacher")),
      ),
    );
    expect(byForeignTeacher.status).toBe(403);

    const unknown = await revokeShare(
      ...toRevokeArgs(
        createRevokeRequest(
          "share-unknown0000000000000000001",
          fixture.cookieFor(groupMemberOne),
        ),
      ),
    );
    const unknownBody = await unknown.json();
    expect(unknown.status).toBe(404);
    expect(unknownBody.reasonCode).toBe("share-not-found");

    // Denials must not have touched the record.
    const stored = await readLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId,
    });
    expect(isLearningChatroomShareActive(stored, { nowMs: shareViewNowMs })).toBe(true);

    const anonymous = await revokeShare(...toRevokeArgs(createRevokeRequest(shareId)));
    expect(anonymous.status).toBe(401);
  });
});

describe("public share page document", () => {
  it("renders the live room with display names only", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);
    const shareId = await mintGroupShare(fixture);

    const result = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      return;
    }

    expect(result.document).toEqual(
      expect.objectContaining({
        locale: "zh-CN",
        courseName: "初等数学研究",
        groupName: fixture.groupName,
        memberNames: [groupMemberOne.displayName, groupMemberTwo.displayName],
        messageCount: 3,
        transcriptStatus: "loaded",
        dateRange: {
          startLabel: "2026-08-08 13:00 UTC",
          endLabel: "2026-08-08 13:02 UTC",
        },
      }),
    );
    expect(result.document.messages.map((message) => message.authorLabel)).toEqual([
      groupMemberOne.displayName,
      // The agent turn is labelled with its localized agent name.
      "研究助教",
      groupMemberTwo.displayName,
    ]);
    expectNoAccountIds(result.document);

    // The rendered page itself is the contract that matters: display names in,
    // account ids out.
    const markup = renderToStaticMarkup(
      createElement(ChatroomTranscriptDocument, {
        document: result.document,
        tone: "screen" as const,
        title: "小组协作记录",
      }),
    );
    expect(markup).toContain(groupMemberOne.displayName);
    expect(markup).toContain(groupMemberTwo.displayName);
    expect(markup).toContain("研究助教");
    expectNoAccountIds(markup);
  });

  it("keeps a live room current instead of freezing it at mint time", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);
    const shareId = await mintGroupShare(fixture);

    await appendLearningChatroomTranscriptMessages({
      dataDir: fixture.dataDir,
      courseId: fixture.courseId,
      classId: fixture.classId,
      groupId: fixture.groupId,
      studentId: groupMemberTwo.account,
      now: "2026-08-08T15:00:00.000Z",
      messages: [
        {
          messageId: "room-4",
          role: "student",
          content: "补充一条：我们下周汇报。",
          authorId: groupMemberTwo.account,
          authorName: groupMemberTwo.displayName,
          createdAt: "2026-08-08T15:00:00.000Z",
        },
      ],
    });

    const result = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
    });
    expect(result.status === "ready" && result.document.messageCount).toBe(4);
  });

  it("answers not-found for an unknown id, a revoked link, and a deleted group", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);

    const unknown = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId: "share-nothinghere000000000000001",
    });
    expect(unknown.status).toBe("not-found");

    // An id that could never have been stored is the same answer, not an error.
    const malformed = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId: "../../etc/passwd",
    });
    expect(malformed.status).toBe("not-found");

    const shareId = await mintGroupShare(fixture);
    await revokeLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId,
      now: "2026-08-08T16:00:00.000Z",
    });
    const revoked = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
    });
    expect(revoked.status).toBe("not-found");

    // A share whose group has been deleted points at an orphaned room, so the
    // link dies with the group.
    const orphaned = await createLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId: "share-orphaned000000000000000001",
      courseId: fixture.courseId,
      classId: fixture.classId,
      groupId: "group-deleted",
      createdBy: groupMemberOne.account,
      now: "2026-08-08T14:00:00.000Z",
    });
    const orphanedResult = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId: orphaned.record.shareId,
    });
    expect(orphanedResult.status).toBe("not-found");
  });

  it("labels a legacy room's turns with the creator's display name", async () => {
    const fixture = await createShareFixture();
    await appendLearningChatroomTranscriptMessages({
      dataDir: fixture.dataDir,
      courseId: fixture.courseId,
      classId: fixture.classId,
      studentId: courseOnlyStudent.account,
      now: "2026-08-08T13:00:00.000Z",
      messages: [
        {
          messageId: "legacy-1",
          role: "student",
          content: "这是我自己的房间。",
          createdAt: "2026-08-08T13:00:00.000Z",
        },
      ],
    });
    const { mintShare } = createShareHandlers(fixture, {
      shareIds: ["share-legacyview00000000000000001"],
    });
    const minted = await mintShare(
      createMintRequest(
        { courseId: fixture.courseId, classId: fixture.classId },
        fixture.cookieFor(courseOnlyStudent),
      ),
    );
    expect(minted.status).toBe(201);

    const result = await loadShareDocument({
      env: fixture.env,
      locale: "en-US",
      shareId: "share-legacyview00000000000000001",
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      return;
    }
    expect(result.document.groupName).toBeUndefined();
    expect(result.document.memberNames).toEqual([courseOnlyStudent.displayName]);
    expect(result.document.messages[0].authorLabel).toBe(courseOnlyStudent.displayName);
    expectNoAccountIds(result.document);
  });

  it("resolves a group share to not-found when the groups flag is off, but keeps a legacy share readable", async () => {
    // Both links are minted with groups on, then read back with the flag off:
    // the D9 kill switch (the documented incident rollback) must stop the group
    // room disclosure even though the record still exists, while a legacy
    // per-student share is unaffected.
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);
    const groupShareId = await mintGroupShare(fixture);

    // A legacy (no-groupId) share for a per-student room.
    await appendLearningChatroomTranscriptMessages({
      dataDir: fixture.dataDir,
      courseId: fixture.courseId,
      classId: fixture.classId,
      studentId: courseOnlyStudent.account,
      now: "2026-08-08T13:00:00.000Z",
      messages: [
        {
          messageId: "legacy-1",
          role: "student",
          content: "这是我自己的房间。",
          createdAt: "2026-08-08T13:00:00.000Z",
        },
      ],
    });
    const { mintShare } = createShareHandlers(fixture, {
      shareIds: ["share-legacyflag00000000000000001"],
    });
    const legacyMint = await mintShare(
      createMintRequest(
        { courseId: fixture.courseId, classId: fixture.classId },
        fixture.cookieFor(courseOnlyStudent),
      ),
    );
    expect(legacyMint.status).toBe(201);

    const flagOffEnv = { ...fixture.env, UAIS_LEARNING_CHATROOM_GROUPS_MODE: "off" };

    const groupOff = await loadShareDocument({
      env: flagOffEnv,
      locale: "zh-CN",
      shareId: groupShareId,
    });
    expect(groupOff.status).toBe("not-found");

    const legacyOff = await loadShareDocument({
      env: flagOffEnv,
      locale: "zh-CN",
      shareId: "share-legacyflag00000000000000001",
    });
    expect(legacyOff.status).toBe("ready");

    // Turning groups back on makes the same group share resolve again, proving
    // the record was never revoked - only gated.
    const groupOn = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId: groupShareId,
    });
    expect(groupOn.status).toBe("ready");
  });
});

// A share repository whose read always throws. The loader catches a failed
// share read as `unavailable`, so a result of `rate-limited` (never
// `unavailable`) proves the throttle short-circuited before any storage read.
function createThrowingShareRepository(): LearningChatroomShareRepository {
  return {
    storage: {
      shareStoragePolicy: "external-redacted-learning-chatroom-shares",
      storageWritePolicy: "external-optimistic-snapshot-replace",
    },
    read: async () => {
      throw new Error("share repository must not be read while throttled");
    },
    write: async () => {
      throw new Error("read-only share repository double");
    },
  };
}

describe("public share page rate limiting", () => {
  it("bounds one viewer at 60 reads a minute, then recovers past the window", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);
    const shareId = await mintGroupShare(fixture);

    // A fresh limiter and a fixed clock, injected exactly like the route-handler
    // rate-limit tests, so these counts never touch the module singleton.
    const rateLimiter = createLearningChatroomShareReadRateLimiter();
    let nowMs = Date.parse("2026-08-08T14:00:00.000Z");
    const clientKey = "share-viewer-ip-203.0.113.5";
    const load = () =>
      loadLearningChatroomShareDocument({
        env: fixture.env,
        locale: "zh-CN",
        shareId,
        clientKey,
        rateLimiter,
        nowMs,
      });

    // Sixty reads at one fixed instant exactly fill the per-minute window.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const ok = await load();
      expect(ok.status).toBe("ready");
    }

    const throttled = await load();
    expect(throttled.status).toBe("rate-limited");
    if (throttled.status === "rate-limited") {
      expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
      expect(throttled.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
    // The throttle answer carries a retry hint and nothing else - never an
    // account id, exactly like every other share surface.
    expectNoAccountIds(throttled);

    // Past the per-minute window the same viewer reads again (the per-day
    // ceiling of 5000 is nowhere near exhausted).
    nowMs += 61000;
    const recovered = await load();
    expect(recovered.status).toBe("ready");
  });

  it("skips every storage read while throttled", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    const rateLimiter = createLearningChatroomShareReadRateLimiter();
    const nowMs = Date.parse("2026-08-08T14:00:00.000Z");
    const clientKey = "share-viewer-ip-198.51.100.9";
    const shareId = "share-throttle00000000000000000001";

    // Control: a viewer with budget left reads the (throwing) repository and the
    // loader reports `unavailable`. This proves the read is genuinely attempted.
    const allowed = await loadLearningChatroomShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
      clientKey,
      rateLimiter,
      nowMs,
      shareRepository: createThrowingShareRepository(),
    });
    expect(allowed.status).toBe("unavailable");

    // Exhaust the per-minute window for this key with raw checks (rejected
    // checks consume nothing, so sixty allowed checks fill it exactly).
    for (let attempt = 0; attempt < 59; attempt += 1) {
      expect(rateLimiter.check({ key: clientKey, nowMs }).allowed).toBe(true);
    }

    // Now the loader's own check is the sixty-first: it must reject before the
    // repository is touched. A throwing repository that is never read is the
    // proof - the answer is `rate-limited`, not `unavailable`.
    const throttled = await loadLearningChatroomShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
      clientKey,
      rateLimiter,
      nowMs,
      shareRepository: createThrowingShareRepository(),
    });
    expect(throttled.status).toBe("rate-limited");
  });

  it("gives each viewer an independent budget", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);
    const shareId = await mintGroupShare(fixture);
    const rateLimiter = createLearningChatroomShareReadRateLimiter();
    const nowMs = Date.parse("2026-08-08T14:00:00.000Z");
    const noisyViewer = "share-viewer-ip-203.0.113.5";
    const quietViewer = "share-viewer-ip-203.0.113.9";

    // Fill the noisy viewer's per-minute window with raw checks.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect(rateLimiter.check({ key: noisyViewer, nowMs }).allowed).toBe(true);
    }

    const noisy = await loadLearningChatroomShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
      clientKey: noisyViewer,
      rateLimiter,
      nowMs,
    });
    expect(noisy.status).toBe("rate-limited");

    // A different IP at the very same instant is unaffected: the throttle is
    // per viewer, so one abuser cannot deny the link to everyone else.
    const quiet = await loadLearningChatroomShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
      clientKey: quietViewer,
      rateLimiter,
      nowMs,
    });
    expect(quiet.status).toBe("ready");
  });

  it("keys the throttle on the viewer's client IP, header-first and validated", () => {
    // `x-real-ip` (the single value the platform sets) wins over the forwarded
    // list.
    expect(
      resolveLearningChatroomShareViewerKey((name) =>
        ({
          "x-real-ip": "203.0.113.7",
          "x-forwarded-for": "198.51.100.2, 10.0.0.1",
        })[name],
      ),
    ).toBe("share-viewer-ip4-203.0.113.7");

    // Without `x-real-ip`, the client-most (leading) forwarded hop is used, not
    // the trailing proxy hops.
    expect(
      resolveLearningChatroomShareViewerKey((name) =>
        ({ "x-forwarded-for": "198.51.100.2, 10.0.0.1, 10.0.0.2" })[name],
      ),
    ).toBe("share-viewer-ip4-198.51.100.2");

    // A header value that is not an IP is REJECTED, not scrubbed into one. This
    // is the property that bounds the key space: if junk were sanitized into a
    // key, every distinct junk value would mint its own budget.
    expect(
      resolveLearningChatroomShareViewerKey((name) =>
        ({ "x-real-ip": "  203.0.113.7 (proxy)  " })[name],
      ),
    ).toBe(learningChatroomShareViewerUnknownKey);
    expect(
      resolveLearningChatroomShareViewerKey((name) =>
        ({ "x-real-ip": "not-an-ip-at-all" })[name],
      ),
    ).toBe(learningChatroomShareViewerUnknownKey);

    // An IPv6 viewer is folded to its /64 network, so the whole address space a
    // single subscriber allocation can emit shares one budget.
    expect(
      resolveLearningChatroomShareViewerKey((name) =>
        ({ "x-real-ip": "2001:db8::1" })[name],
      ),
    ).toBe("share-viewer-ip6-2001:db8:0:0");
    // Case and leading zeros are presentation, not identity.
    expect(
      resolveLearningChatroomShareViewerKey((name) =>
        ({ "x-real-ip": "2001:0DB8:0000:0000:ABCD::9" })[name],
      ),
    ).toBe("share-viewer-ip6-2001:db8:0:0");
    // A zone id is not part of the routable address.
    expect(
      resolveLearningChatroomShareViewerKey((name) =>
        ({ "x-real-ip": "fe80::1%eth0" })[name],
      ),
    ).toBe("share-viewer-ip6-fe80:0:0:0");

    // No usable header at all collapses to a single shared bucket that still
    // throttles, rather than a per-request bypass.
    expect(resolveLearningChatroomShareViewerKey(() => null)).toBe(
      learningChatroomShareViewerUnknownKey,
    );
    expect(resolveLearningChatroomShareViewerKey(() => "")).toBe(
      learningChatroomShareViewerUnknownKey,
    );
  });

  // The threat this guard exists for. Before validation was added, a caller who
  // varied the header got a brand-new bucket per request - 100% pass-through -
  // AND pushed the limiter's key map over its cap on every call. Both halves are
  // pinned here, because a limiter that a rotating key walks straight through is
  // worse than none: it costs CPU and buys nothing.
  it("does not hand a rotating header value a fresh budget", () => {
    const rotatingKeys = Array.from({ length: 500 }, (_unused, index) =>
      resolveLearningChatroomShareViewerKey((name) =>
        // Junk that a strip-based sanitizer would have turned into 500 distinct
        // keys ("zz1" -> "1", "zz2" -> "2", ...).
        ({ "x-real-ip": `zz${index}` })[name],
      ),
    );
    expect(new Set(rotatingKeys).size).toBe(1);
    expect(rotatingKeys[0]).toBe(learningChatroomShareViewerUnknownKey);

    // Same for an attacker walking one IPv6 allocation: 500 genuine, unspoofed
    // addresses inside one /64 collapse to a single budget.
    const ipv6Keys = Array.from({ length: 500 }, (_unused, index) =>
      resolveLearningChatroomShareViewerKey((name) =>
        ({ "x-real-ip": `2001:db8::${index.toString(16)}` })[name],
      ),
    );
    expect(new Set(ipv6Keys).size).toBe(1);

    // Different /64s remain genuinely different viewers.
    expect(
      resolveLearningChatroomShareViewerKey((name) =>
        ({ "x-real-ip": "2001:db8:0:1::1" })[name],
      ),
    ).not.toBe(ipv6Keys[0]);
  });

  // Guards the eviction fix in the shared limiter. Trimming back to exactly the
  // cap made the map oscillate across the limit, so the O(n log n) fallback
  // sweep ran on EVERY later request. That only became reachable when a limiter
  // started keying on client-influenced input, which is this page.
  it("evicts to a low-water mark so a flood of distinct keys cannot re-sweep every request", () => {
    const maxTrackedKeys = 100;
    const limiter = createAiRequestRateLimiter({
      config: {
        mode: "enforce",
        windows: [{ id: "per-day", limit: 5000, windowMs: 86400000 }],
      },
      maxTrackedKeys,
    });

    // Every key is distinct and fresh, so nothing is ever "stale": this is
    // exactly the case where the old code sorted the whole map per request.
    const nowMs = Date.parse("2026-08-08T14:00:00.000Z");
    for (let index = 0; index < maxTrackedKeys * 5; index += 1) {
      expect(limiter.check({ key: `flood-${index}`, nowMs }).allowed).toBe(true);
    }

    // A genuine viewer arriving after the flood is still served, and still
    // counted, rather than starved by the eviction churn.
    const survivor = limiter.check({ key: "share-viewer-ip4-203.0.113.5", nowMs });
    expect(survivor.allowed).toBe(true);
  });
});

describe("chatroom export print view", () => {
  it("gives a group member the room, and refuses a foreign student", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);

    const member = await loadLearningChatroomExportDocument({
      env: fixture.env,
      locale: "zh-CN",
      appSession: { ...groupMemberTwo, role: "student" },
      courseId: fixture.courseId,
      groupId: fixture.groupId,
    });
    expect(member.status).toBe("ready");
    if (member.status !== "ready") {
      return;
    }
    expect(member.document.groupName).toBe(fixture.groupName);
    expect(member.document.messageCount).toBe(3);
    expectNoAccountIds(member.document);

    const stranger = await loadLearningChatroomExportDocument({
      env: fixture.env,
      locale: "zh-CN",
      appSession: { ...otherGroupMember, role: "student" },
      courseId: fixture.courseId,
      groupId: fixture.groupId,
    });
    expect(stranger).toEqual({
      status: "denied",
      reasonCode: "student-group-membership-required",
    });
  });

  it("lets the course-owning teacher print a group room as observer", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);

    const observer = await loadLearningChatroomExportDocument({
      env: fixture.env,
      locale: "zh-CN",
      appSession: { ...owningTeacher, role: "teacher" },
      courseId: fixture.courseId,
      groupId: fixture.groupId,
    });
    expect(observer.status).toBe("ready");
    if (observer.status !== "ready") {
      return;
    }
    expect(observer.document.messageCount).toBe(3);

    const foreign = await loadLearningChatroomExportDocument({
      env: fixture.env,
      locale: "zh-CN",
      appSession: { ...foreignTeacher, role: "teacher" },
      courseId: fixture.courseId,
      groupId: fixture.groupId,
    });
    expect(foreign.status).toBe("denied");
  });

  it("requires a session, a course, and the feature flag for a group room", async () => {
    const fixture = await createShareFixture();

    expect(
      await loadLearningChatroomExportDocument({
        env: fixture.env,
        locale: "zh-CN",
        appSession: null,
        courseId: fixture.courseId,
      }),
    ).toEqual({ status: "sign-in-required" });

    expect(
      await loadLearningChatroomExportDocument({
        env: fixture.env,
        locale: "zh-CN",
        appSession: { ...groupMemberOne, role: "student" },
      }),
    ).toEqual({ status: "denied", reasonCode: "course-context-required" });

    expect(
      await loadLearningChatroomExportDocument({
        env: fixture.env,
        locale: "zh-CN",
        appSession: { ...groupMemberOne, role: "student" },
        courseId: fixture.courseId,
        groupId: fixture.groupId,
      }),
    ).toEqual({ status: "denied", reasonCode: "feature-not-enabled" });
  });

  it("renders the printable document with agent turns labelled", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);

    const result = await loadLearningChatroomExportDocument({
      env: fixture.env,
      locale: "zh-CN",
      appSession: { ...groupMemberOne, role: "student" },
      courseId: fixture.courseId,
      groupId: fixture.groupId,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      return;
    }

    const markup = renderToStaticMarkup(
      createElement(ChatroomTranscriptDocument, {
        document: result.document,
        tone: "print" as const,
        title: "聊天记录导出",
      }),
    );
    expect(markup).toContain("聊天记录导出");
    expect(markup).toContain("初等数学研究");
    expect(markup).toContain(fixture.groupName);
    // Agent rows are tagged, and every turn is kept off a page break.
    expect(markup).toContain("智能体");
    expect(markup).toContain("print:break-inside-avoid");
    expectNoAccountIds(markup);
  });
});

// A chatroom room is a rolling window, not an archive: it keeps the newest 200
// turns (500 for a group) and drops the rest on append. Nothing disclosed that
// anywhere - not the room, not this document, not the PDF, not the public share
// page - so an export could silently begin mid-discussion and a share link could
// publish a conversation whose opening had already been dropped. Both surfaces
// render the same line, from the same document field, for exactly that reason.
describe("chatroom transcript rolling-window disclosure", () => {
  const trimmedCopy =
    "较早的消息已滚动归档，导出与分享同样不含";

  it("discloses the window on both the print view and the share page", () => {
    for (const tone of ["print", "screen"] as const) {
      const markup = renderToStaticMarkup(
        createElement(ChatroomTranscriptDocument, {
          document: createTrimmedDocumentFixture({ windowAtCapacity: true }),
          tone,
          title: "聊天记录导出",
        }),
      );
      expect(markup, tone).toContain(trimmedCopy);
      expect(markup, tone).toContain('data-uais-chatroom-window-trimmed="true"');
    }
  });

  it("says nothing when the room still has room", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatroomTranscriptDocument, {
        document: createTrimmedDocumentFixture({ windowAtCapacity: false }),
        tone: "print" as const,
        title: "聊天记录导出",
      }),
    );
    expect(markup).not.toContain(trimmedCopy);
  });

  it("reports a room that is not at its cap as untrimmed, end to end", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);

    const result = await loadLearningChatroomExportDocument({
      env: fixture.env,
      locale: "zh-CN",
      appSession: { ...groupMemberOne, role: "student" },
      courseId: fixture.courseId,
      groupId: fixture.groupId,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      return;
    }
    // Three stored turns against a 500-turn group window: the disclosure would
    // be a lie here, and a document that always warned would teach every reader
    // to ignore the one time it matters.
    expect(result.document.windowAtCapacity).toBe(false);
  });

  it("reports a full window from the room's own stored count", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await appendLearningChatroomTranscriptMessages({
      dataDir: fixture.dataDir,
      courseId: fixture.courseId,
      classId: fixture.classId,
      groupId: fixture.groupId,
      studentId: groupMemberOne.account,
      now: "2026-08-08T13:00:00.000Z",
      messages: Array.from({ length: learningChatroomGroupTranscriptMaxMessages }, (_, index) => ({
        messageId: `room-full-${index}`,
        role: "student" as const,
        content: `第 ${index + 1} 条。`,
        authorId: groupMemberOne.account,
        authorName: groupMemberOne.displayName,
        createdAt: "2026-08-08T13:00:00.000Z",
      })),
    });

    const result = await loadLearningChatroomExportDocument({
      env: fixture.env,
      locale: "zh-CN",
      appSession: { ...groupMemberOne, role: "student" },
      courseId: fixture.courseId,
      groupId: fixture.groupId,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      return;
    }
    // The window is full, so the next message the room takes evicts one - and
    // this export already carries whatever the cap has cut.
    expect(result.document.windowAtCapacity).toBe(true);
  });
});

function createTrimmedDocumentFixture(overrides: { windowAtCapacity: boolean }) {
  return {
    locale: "zh-CN" as const,
    courseName: "初等数学研究",
    groupName: "第三小组",
    memberNames: [groupMemberOne.displayName, groupMemberTwo.displayName],
    messageCount: 1,
    transcriptStatus: "loaded" as const,
    messages: [
      {
        id: "room-1",
        role: "student" as const,
        content: "窗口已经满了。",
        authorLabel: groupMemberOne.displayName,
        createdAt: "2026-08-08T13:00:00.000Z",
        timeLabel: "2026-08-08 13:00 UTC",
      },
    ],
    ...overrides,
  };
}

describe("chatroom share/export button wiring", () => {
  it("mints through the real route and returns the caller's own absolute link", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    const { mintShare } = createShareHandlers(fixture, {
      shareIds: ["share-wired000000000000000000001"],
    });
    const cookie = fixture.cookieFor(groupMemberOne);

    const result = await requestLearningChatroomShareLink(
      { courseId: fixture.courseId, groupId: fixture.groupId },
      {
        origin: "https://uais.top",
        // The room's own fetch, pointed at the real handler: the helper's body
        // shape has to be one the route actually accepts.
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) =>
          mintShare(
            new Request(`http://localhost${String(input)}`, {
              ...init,
              headers: { ...(init?.headers as Record<string, string>), cookie },
            }),
          )) as unknown as typeof fetch,
      },
    );

    expect(result).toEqual({
      status: "created",
      shareId: "share-wired000000000000000000001",
      // The browser's origin wins over the server echo, so a preview deployment
      // or a custom domain copies its own host.
      url: "https://uais.top/share/share-wired000000000000000000001",
      // Carried back so the room can tell whoever copies this link when it
      // stops working. A link that simply goes dead one day is the thing this
      // field exists to prevent.
      expiresAt: "2026-08-22T14:00:00.000Z",
    });
  });

  it("reports failure instead of copying a broken link", async () => {
    const denied = await requestLearningChatroomShareLink(
      { courseId: "elementary-math-research" },
      {
        origin: "https://uais.top",
        fetchImpl: (async () =>
          Response.json({ error: "denied" }, { status: 403 })) as unknown as typeof fetch,
      },
    );
    expect(denied).toEqual({ status: "failed" });

    const malformed = await requestLearningChatroomShareLink(
      { courseId: "elementary-math-research" },
      {
        origin: "https://uais.top",
        fetchImpl: (async () => Response.json({}, { status: 201 })) as unknown as typeof fetch,
      },
    );
    expect(malformed).toEqual({ status: "failed" });

    const offline = await requestLearningChatroomShareLink(
      { courseId: "elementary-math-research" },
      {
        origin: "https://uais.top",
        fetchImpl: (async () => {
          throw new Error("network down");
        }) as unknown as typeof fetch,
      },
    );
    expect(offline).toEqual({ status: "failed" });
  });

  it("addresses the print view at the room the chatroom is showing", () => {
    expect(
      createLearningChatroomExportUrl({
        courseId: "elementary-math-research",
        classId: "elementary-math-research-class-1",
        groupId: "group-three",
      }),
    ).toBe(
      "/learning/chatroom/export?courseId=elementary-math-research&classId=elementary-math-research-class-1&groupId=group-three",
    );
  });
});

function toRevokeArgs(input: ReturnType<typeof createRevokeRequest>) {
  return [input.request, input.context] as const;
}

// Two ways a published room stops being published, and one way it stops being
// complete.
//
// Expiry is the one that did not exist: a share record carried `createdAt` and
// `revokedAt` and nothing else, so a link nobody remembered to revoke kept
// serving a live classroom transcript to whoever still had the URL - for the
// rest of the degree. Every link now ends on its own.
describe("learning chatroom share expiry", () => {
  const mintNowMs = Date.parse("2026-08-08T14:00:00.000Z");
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

  it("defaults to 14 days, and an expired link is the same 404 as a revoked one", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);
    const shareId = await mintGroupShare(fixture);

    const stored = await readLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId,
    });
    expect(stored?.expiresAt).toBe("2026-08-22T14:00:00.000Z");

    // One minute before the end: still a live room.
    const alive = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
      nowMs: mintNowMs + fourteenDaysMs - 60_000,
    });
    expect(alive.status).toBe("ready");

    // One minute after: indistinguishable from an id that never existed, which
    // is the point - a viewer must not be able to tell a wrong link from a
    // withdrawn one, nor either from one that simply ran out.
    const expired = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
      nowMs: mintNowMs + fourteenDaysMs + 60_000,
    });
    expect(expired.status).toBe("not-found");
  });

  it("honours an explicit expiresAt and refuses one that is past or beyond the ceiling", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    const { mintShare } = createShareHandlers(fixture, {
      shareIds: ["share-explicit0000000000000000001"],
    });

    const response = await mintShare(
      createMintRequest(
        {
          courseId: fixture.courseId,
          groupId: fixture.groupId,
          expiresAt: "2026-08-11T14:00:00.000Z",
        },
        fixture.cookieFor(groupMemberOne),
      ),
    );
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body.share.expiresAt).toBe("2026-08-11T14:00:00.000Z");

    // Refused rather than clamped: a minter who asked for a link lasting a year
    // should be told no, not handed one that quietly lasts three months.
    for (const expiresAt of [
      "2026-08-08T13:00:00.000Z",
      "2027-08-08T14:00:00.000Z",
      "not-a-timestamp",
    ]) {
      const refused = await mintShare(
        createMintRequest(
          { courseId: fixture.courseId, groupId: fixture.groupId, expiresAt },
          fixture.cookieFor(groupMemberOne),
        ),
      );
      expect(refused.status, expiresAt).toBe(400);
      expect((await refused.json()).error).toContain("expiresAt");
    }
  });

  it("reads a legacy record with no expiresAt as ending 14 days after it was minted", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);

    // A share database exactly as an earlier build wrote it: no expiry field at
    // all. Written straight to disk rather than through the store, because the
    // store can no longer produce one.
    await writeFile(
      join(fixture.dataDir, "learning-chatroom-shares.json"),
      JSON.stringify({
        schemaVersion: learningChatroomShareSchemaVersion,
        updatedAt: "2026-08-08T14:00:00.000Z",
        shares: [
          {
            shareId: "share-legacyttl000000000000000001",
            courseId: fixture.courseId,
            classId: fixture.classId,
            groupId: fixture.groupId,
            createdBy: groupMemberOne.account,
            createdAt: "2026-08-08T14:00:00.000Z",
            storagePolicy: "local-json-learning-chatroom-shares",
            storageWritePolicy: "atomic-json-file-replace",
            responsibleSession: "S12",
            redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
          },
        ],
      }),
    );

    const normalized = await readLearningChatroomShare({
      dataDir: fixture.dataDir,
      shareId: "share-legacyttl000000000000000001",
    });
    expect(normalized?.expiresAt).toBe("2026-08-22T14:00:00.000Z");

    const expired = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId: "share-legacyttl000000000000000001",
      nowMs: mintNowMs + fourteenDaysMs + 60_000,
    });
    expect(expired.status).toBe("not-found");
  });
});

describe("learning chatroom moderation on the published room", () => {
  it("keeps a teacher-hidden message out of the share page and the export document", async () => {
    const fixture = await createShareFixture({ groupsMode: "on" });
    await seedGroupRoomTranscript(fixture);
    const shareId = await mintGroupShare(fixture);

    await setLearningChatroomTranscriptMessageModeration({
      dataDir: fixture.dataDir,
      courseId: fixture.courseId,
      classId: fixture.classId,
      groupId: fixture.groupId,
      studentId: groupMemberOne.account,
      messageId: "room-3",
      status: "hidden",
      actorId: owningTeacher.account,
      now: "2026-08-08T13:30:00.000Z",
    });

    const shared = await loadShareDocument({
      env: fixture.env,
      locale: "zh-CN",
      shareId,
    });
    expect(shared.status).toBe("ready");
    if (shared.status !== "ready") {
      return;
    }
    expect(shared.document.messageCount).toBe(2);
    expect(shared.document.messages.map((message) => message.id)).toEqual([
      "room-1",
      "room-2",
    ]);
    expect(JSON.stringify(shared.document)).not.toContain("我来整理一下数据来源");

    // The same loader feeds the print view and the server-rendered PDF, so one
    // moderation decision reaches all three surfaces rather than three.
    const exported = await loadLearningChatroomExportDocument({
      env: fixture.env,
      locale: "zh-CN",
      appSession: { ...groupMemberTwo, role: "student" },
      courseId: fixture.courseId,
      groupId: fixture.groupId,
    });
    expect(exported.status).toBe("ready");
    if (exported.status !== "ready") {
      return;
    }
    expect(exported.document.messageCount).toBe(2);
    expect(JSON.stringify(exported.document)).not.toContain("我来整理一下数据来源");
  });
});

describe("public share page crawl policy", () => {
  it("disallows /share/ in robots.txt", async () => {
    // A share link is a capability handed to particular people. Indexed, it
    // publishes a classroom conversation to anyone who searches a phrase from
    // it - and revoking the link cannot take a search result back, so the
    // exclusion has to exist before the first crawl.
    const { default: robots } = await import("@/app/robots");
    const rules = robots().rules;
    expect(Array.isArray(rules)).toBe(false);
    if (Array.isArray(rules)) {
      return;
    }
    expect(rules.userAgent).toBe("*");
    expect(rules.allow).toBe("/");
    expect(rules.disallow).toEqual(expect.arrayContaining(["/share/"]));
  });

  it("marks the share page noindex in its own metadata", async () => {
    // The half that reaches a crawler which ignores robots.txt but honours the
    // meta tag, and the half that survives a crawler arriving by some other path.
    const source = await readFile(
      join(process.cwd(), "src", "app", "share", "[shareId]", "page.tsx"),
      "utf8",
    );
    expect(source).toContain("index: false");
    expect(source).toContain("follow: false");
    expect(source).toContain("robots: shareRobotsMetadata");
  });
});
