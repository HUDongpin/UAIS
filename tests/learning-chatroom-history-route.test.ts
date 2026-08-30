import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { createLearningChatroomHistoryGetHandler as createLegacyHistoryHandler } from "@/app/api/learning/chatroom/handler";
import { GET as legacyRouteGet } from "@/app/api/learning/chatroom/route";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import {
  createEmptyLearningChatroomTranscriptDatabase,
  createLearningChatroomTranscriptId,
  type LearningChatroomTranscriptRepository,
} from "@/lib/server/learning-chatroom-transcript-store";
import type {
  TeachingCourseManagementDatabase,
  TeachingCourseManagementRepository,
} from "@/lib/server/teaching-course-management-types";

const projectRoot = process.cwd();
const historyRoutePath = join(
  projectRoot,
  "src/app/api/learning/chatroom/history/route.ts",
);
const historyHandlerPath = join(
  projectRoot,
  "src/app/api/learning/chatroom/history/handler.ts",
);
const fixtureDirs: string[] = [];
const appSessionSecret = "history-route-test-session-secret";
const futureIssueTime = new Date("2099-01-01T00:00:00.000Z");

afterAll(async () => {
  await Promise.all(
    fixtureDirs.map((path) => rm(path, { force: true, recursive: true })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dedicated learning chatroom history route", () => {
  it("owns a force-dynamic GET-only route with the existing serverless wall", () => {
    expect(existsSync(historyRoutePath), historyRoutePath).toBe(true);
    if (!existsSync(historyRoutePath)) return;

    const source = readFileSync(historyRoutePath, "utf8");
    expect(source).toMatch(
      /import\s*\{\s*createLearningChatroomHistoryGetHandler\s*\}\s*from\s*["']\.\/handler["']/,
    );
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain("export const maxDuration = 60");
    expect(source).toContain(
      "export const GET = createLearningChatroomHistoryGetHandler()",
    );
    expect(source).not.toMatch(/export\s+(?:const|function)\s+POST\b/);
  });

  it("keeps the history success-path runtime graph free of AI providers and handler barrels", () => {
    expect(existsSync(historyHandlerPath), historyHandlerPath).toBe(true);
    if (!existsSync(historyHandlerPath)) return;

    const closure = collectRuntimeClosure(historyRoutePath);
    const projectModules = [...closure.files]
      .filter((item) => item.startsWith(projectRoot))
      .map((item) => item.slice(projectRoot.length + 1))
      .sort();
    const sourceCorpus = projectModules
      .map((item) => readFileSync(join(projectRoot, item), "utf8"))
      .join("\n");

    expect(projectModules).toContain(
      "src/app/api/learning/chatroom/history/handler.ts",
    );
    expect(projectModules).not.toContain("src/app/api/learning/chatroom/handler.ts");
    expect(projectModules).not.toContain(
      "src/lib/server/teaching-course-management-store.ts",
    );
    expect(
      projectModules.filter((item) => item.startsWith("src/lib/ai/")),
    ).toEqual(["src/lib/ai/storage-backend-contract.ts"]);
    expect(
      [...closure.externalSpecifiers].filter(
        (item) => item.startsWith("@sentry/") || item.startsWith("@langchain/"),
      ),
    ).toEqual([]);
    expect(sourceCorpus).not.toMatch(/@sentry\/nextjs/);
    expect(sourceCorpus).not.toMatch(/@langchain\/langgraph(?:-checkpoint-postgres)?/);
    expect(sourceCorpus).not.toMatch(
      /(?:deepseek-client|qwen-multimodal-client|agent-loop|orchestration\/director|learning-chatroom-agent-providers)/,
    );
  });

  it("uses direct teaching-store modules on every history authorization edge", () => {
    const directImportFiles = [
      "src/lib/server/learning-ai-guide-access.ts",
      "src/lib/server/teaching-course-management-external-store.ts",
      "src/lib/server/teaching-course-management-postgres-store.ts",
    ];

    for (const path of directImportFiles) {
      const source = readFileSync(join(projectRoot, path), "utf8");
      expect(source, path).not.toMatch(
        /from\s+["']@\/lib\/server\/teaching-course-management-store["']/,
      );
    }
  });

  it("migrates the legacy GET to the dedicated limiter without a second store read", async () => {
    const response = await legacyRouteGet(
      new Request(
        "https://staging.uais.top/api/learning/chatroom?courseId=history-course&groupId=history-group",
        { headers: { "x-uais-trace-id": "trace-legacy-migration" } },
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "/api/learning/chatroom/history?courseId=history-course&groupId=history-group",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-uais-trace-id")).toBe(
      "trace-legacy-migration",
    );
  });

  it("stamps a safe trace on legacy redirects with missing or malformed input", async () => {
    for (const supplied of [undefined, "../../unsafe?cookie=secret", "x".repeat(121)]) {
      const response = await legacyRouteGet(
        new Request(
          "https://staging.uais.top/api/learning/chatroom?courseId=history-course",
          {
            headers: supplied ? { "x-uais-trace-id": supplied } : undefined,
          },
        ),
      );
      const traceId = response.headers.get("x-uais-trace-id");

      expect(response.status).toBe(307);
      expect(traceId).toMatch(/^trace-learning-chatroom-[0-9a-f-]{36}$/);
      expect(traceId).not.toBe(supplied);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("matches the legacy GET authorization contract across student, teacher, and group states", async () => {
    const createDedicatedHistoryHandler = await loadDedicatedHistoryHandler();
    const fixture = await createHistoryAuthorizationFixture();
    const scenarios = [
      {
        name: "unauthenticated",
        env: fixture.env,
        request: createHistoryRequest(fixture.courseId),
      },
      {
        name: "missing-course-context",
        env: fixture.env,
        request: createHistoryRequest(undefined, fixture.cookies.approved),
      },
      {
        name: "approved-student",
        env: fixture.env,
        request: createHistoryRequest(fixture.courseId, fixture.cookies.approved),
      },
      {
        name: "pending-student",
        env: fixture.env,
        request: createHistoryRequest(fixture.courseId, fixture.cookies.pending),
      },
      {
        name: "non-member-student",
        env: fixture.env,
        request: createHistoryRequest(fixture.courseId, fixture.cookies.nonMember),
      },
      {
        name: "owning-teacher",
        env: fixture.env,
        request: createHistoryRequest(fixture.courseId, fixture.cookies.teacher),
        expectedStatus: 200,
      },
      {
        name: "foreign-teacher",
        env: fixture.env,
        request: createHistoryRequest(
          fixture.courseId,
          fixture.cookies.foreignTeacher,
        ),
        expectedStatus: 403,
        expectedReasonCode: "teacher-course-ownership-required",
      },
      {
        name: "admin",
        env: fixture.env,
        request: createHistoryRequest(fixture.courseId, fixture.cookies.admin),
        expectedStatus: 403,
        expectedReasonCode: "student-or-teacher-role-required",
      },
      {
        name: "group-member",
        env: fixture.env,
        request: createHistoryRequest(
          fixture.courseId,
          fixture.cookies.approved,
          fixture.groupId,
        ),
      },
      {
        name: "group-non-member",
        env: fixture.env,
        request: createHistoryRequest(
          fixture.courseId,
          fixture.cookies.approvedNoGroup,
          fixture.groupId,
        ),
      },
      {
        name: "group-feature-disabled",
        env: { ...fixture.env, UAIS_LEARNING_CHATROOM_GROUPS_MODE: "off" },
        request: createHistoryRequest(
          fixture.courseId,
          fixture.cookies.approved,
          fixture.groupId,
        ),
        expectedStatus: 403,
        expectedReasonCode: "feature-not-enabled",
      },
      {
        name: "teacher-group-not-found",
        env: fixture.env,
        request: createHistoryRequest(
          fixture.courseId,
          fixture.cookies.teacher,
          "missing-group",
        ),
        expectedStatus: 403,
        expectedReasonCode: "teacher-group-not-found",
      },
    ];

    const expectations = new Map([
      ["unauthenticated", { status: 401, reasonCode: undefined }],
      ["missing-course-context", { status: 403, reasonCode: "course-context-required" }],
      ["approved-student", { status: 200, reasonCode: undefined }],
      ["pending-student", { status: 403, reasonCode: "student-course-membership-not-approved" }],
      ["non-member-student", { status: 403, reasonCode: "student-course-membership-required" }],
      ["owning-teacher", { status: 200, reasonCode: undefined }],
      ["foreign-teacher", { status: 403, reasonCode: "teacher-course-ownership-required" }],
      ["admin", { status: 403, reasonCode: "student-or-teacher-role-required" }],
      ["group-member", { status: 200, reasonCode: undefined }],
      ["group-non-member", { status: 403, reasonCode: "student-group-membership-required" }],
      ["group-feature-disabled", { status: 403, reasonCode: "feature-not-enabled" }],
      ["teacher-group-not-found", { status: 403, reasonCode: "teacher-group-not-found" }],
    ]);

    for (const scenario of scenarios) {
      const repository = createHistoryRepository();
      const legacy = createLegacyHistoryHandler({
        env: scenario.env,
        transcriptRepository: repository,
      });
      const dedicated = createDedicatedHistoryHandler({
        env: scenario.env,
        transcriptRepository: repository,
      });

      const legacyProjection = await projectResponse(legacy(scenario.request.clone()));
      const dedicatedProjection = await projectResponse(
        dedicated(scenario.request.clone()),
      );

      expect(dedicatedProjection, scenario.name).toEqual(legacyProjection);
      const expected = expectations.get(scenario.name);
      expect(dedicatedProjection.status, scenario.name).toBe(expected?.status);
      expect(
        (dedicatedProjection.body as { access?: { reasonCode?: string } }).access
          ?.reasonCode,
        scenario.name,
      ).toBe(expected?.reasonCode);
    }
  });

  it("matches loaded, frozen, and unavailable transcript projections", async () => {
    const createDedicatedHistoryHandler = await loadDedicatedHistoryHandler();
    const fixture = await createHistoryAuthorizationFixture();
    const request = createHistoryRequest(fixture.courseId, fixture.cookies.approved);
    const cases = [
      {
        name: "loaded",
        repository: createHistoryRepository(),
        expectedTranscriptStatus: "loaded",
        expectedModerationStatus: "open",
      },
      {
        name: "frozen",
        repository: createHistoryRepository({ moderationStatus: "frozen" }),
        expectedTranscriptStatus: "loaded",
        expectedModerationStatus: "frozen",
      },
      {
        name: "unavailable",
        repository: createHistoryRepository({ failRead: true }),
        expectedTranscriptStatus: "unavailable",
        expectedModerationStatus: "open",
      },
    ];

    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const testCase of cases) {
      const legacy = createLegacyHistoryHandler({
        env: fixture.env,
        transcriptRepository: testCase.repository,
      });
      const dedicated = createDedicatedHistoryHandler({
        env: fixture.env,
        transcriptRepository: testCase.repository,
      });

      const dedicatedProjection = await projectResponse(dedicated(request.clone()));
      expect(dedicatedProjection, testCase.name).toEqual(
        await projectResponse(legacy(request.clone())),
      );
      const body = dedicatedProjection.body as {
        messages: unknown[];
        transcript: { status: string };
        moderation: { status: string };
      };
      expect(dedicatedProjection.status, testCase.name).toBe(200);
      expect(body.messages, testCase.name).toEqual([]);
      expect(body.transcript.status, testCase.name).toBe(
        testCase.expectedTranscriptStatus,
      );
      expect(body.moderation.status, testCase.name).toBe(
        testCase.expectedModerationStatus,
      );
    }
  });

  it("preserves the strict history rate-limit response and retry-after contract", async () => {
    const createDedicatedHistoryHandler = await loadDedicatedHistoryHandler();
    const fixture = await createHistoryAuthorizationFixture();
    const env = {
      ...fixture.env,
      UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_MINUTE: "1",
    };
    const request = createHistoryRequest(fixture.courseId, fixture.cookies.approved);
    let nowMs = 1_000_000;
    const now = () => nowMs;
    const legacy = createLegacyHistoryHandler({
      env,
      now,
      transcriptRepository: createHistoryRepository(),
    });
    const dedicated = createDedicatedHistoryHandler({
      env,
      now,
      transcriptRepository: createHistoryRepository(),
    });

    expect((await legacy(request.clone())).status).toBe(200);
    expect((await dedicated(request.clone())).status).toBe(200);
    nowMs += 20_000;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const legacyLimited = await projectResponse(legacy(request.clone()));
    const dedicatedLimited = await projectResponse(dedicated(request.clone()));

    expect(dedicatedLimited).toEqual(legacyLimited);
    expect(dedicatedLimited.status).toBe(429);
    expect(dedicatedLimited.retryAfter).toBe("40");
    expect(warn).toHaveBeenCalled();
  });

  it("emits a bounded redacted Server-Timing allowlist on an authorized read", async () => {
    const createDedicatedHistoryHandler = await loadDedicatedHistoryHandler();
    const fixture = await createHistoryAuthorizationFixture();
    let tick = 100;
    const handler = createDedicatedHistoryHandler({
      env: fixture.env,
      transcriptRepository: createHistoryRepository(),
      timingNow: () => ++tick,
    });

    const response = await handler(
      createHistoryRequest(fixture.courseId, fixture.cookies.approved),
    );
    const timing = response.headers.get("server-timing") ?? "";
    const entries = timing.split(", ");
    const names = entries.map((entry) => entry.split(";")[0]);
    const expectedNames = [
      "entry",
      "session",
      "rate",
      "backend",
      "pool",
      "authorization",
      "transcript",
      "projection",
      "total",
    ];

    expect(response.status).toBe(200);
    expect(names).toEqual(expectedNames);
    for (const span of expectedNames) {
      expect(timing, span).toMatch(new RegExp(`(?:^|, )${span};dur=\\d+(?:\\.\\d{1,2})?`));
    }
    expect(entries.every((entry) => /^[a-z]+;dur=\d+(?:\.\d{1,2})?$/.test(entry))).toBe(
      true,
    );
    expect(timing).not.toContain(fixture.courseId);
    expect(timing).not.toContain("student-approved");
    expect(timing).not.toContain(appSessionSecret);
    expect(timing.length).toBeLessThan(512);
  });

  it("measures controlled transcript latency in both the transcript and total spans", async () => {
    const createDedicatedHistoryHandler = await loadDedicatedHistoryHandler();
    const fixture = await createHistoryAuthorizationFixture();
    let clock = 0;
    const handler = createDedicatedHistoryHandler({
      env: fixture.env,
      timingNow: () => clock,
      transcriptRepository: createHistoryRepository({
        onRead: () => {
          clock += 17;
        },
      }),
    });

    const response = await handler(
      createHistoryRequest(fixture.courseId, fixture.cookies.approved),
    );
    const spans = parseServerTiming(response.headers.get("server-timing") ?? "");

    expect(spans.transcript).toBe(17);
    expect(spans.total).toBe(17);
    expect(spans.total).toBeGreaterThanOrEqual(spans.transcript);
  });

  it("keeps the same redacted timing contract on controlled cold and warm reads", async () => {
    const createDedicatedHistoryHandler = await loadDedicatedHistoryHandler();
    const fixture = await createHistoryAuthorizationFixture();
    let clock = 0;
    let reads = 0;
    const handler = createDedicatedHistoryHandler({
      env: fixture.env,
      timingNow: () => clock,
      transcriptRepository: createHistoryRepository({
        onRead: () => {
          reads += 1;
          clock += reads === 1 ? 37 : 5;
        },
      }),
    });
    const cold = await handler(
      createHistoryRequest(
        fixture.courseId,
        fixture.cookies.approved,
        undefined,
        "trace-history-cold",
      ),
    );
    const warm = await handler(
      createHistoryRequest(
        fixture.courseId,
        fixture.cookies.approved,
        undefined,
        "trace-history-warm",
      ),
    );
    const coldHeader = cold.headers.get("server-timing") ?? "";
    const warmHeader = warm.headers.get("server-timing") ?? "";
    const coldTiming = parseServerTiming(coldHeader);
    const warmTiming = parseServerTiming(warmHeader);

    expect(cold.status).toBe(200);
    expect(warm.status).toBe(200);
    expect(Object.keys(coldTiming)).toEqual(Object.keys(warmTiming));
    expect(coldTiming.transcript).toBe(37);
    expect(warmTiming.transcript).toBe(5);
    expect(coldTiming.total).toBeGreaterThanOrEqual(coldTiming.transcript);
    expect(warmTiming.total).toBeGreaterThanOrEqual(warmTiming.transcript);
    expect(cold.headers.get("x-uais-trace-id")).toBe("trace-history-cold");
    expect(warm.headers.get("x-uais-trace-id")).toBe("trace-history-warm");
    for (const timing of [coldHeader, warmHeader]) {
      expect(timing).not.toContain(fixture.courseId);
      expect(timing).not.toContain("student-approved");
      expect(timing).not.toContain(appSessionSecret);
      expect(timing).not.toMatch(/Bearer|postgres(?:ql)?:\/\//i);
    }
  });

  it("single-flights only concurrent group transcript reads after independent authorization", async () => {
    const createDedicatedHistoryHandler = await loadDedicatedHistoryHandler();
    const fixture = await createHistoryAuthorizationFixture();
    const transcriptGate = createDeferred<void>();
    let teachingReads = 0;
    let transcriptReads = 0;
    const teachingRepository: TeachingCourseManagementRepository = {
      storage: {
        recordStoragePolicy: "external-redacted-teaching-course-management-snapshot",
        auditStoragePolicy: "external-redacted-teaching-course-management-audit-log",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      },
      read: async () => {
        teachingReads += 1;
        return { database: fixture.database, revision: "rev-history" };
      },
      write: async () => {
        throw new Error("History GET must not write course-management state.");
      },
    };
    const transcriptRepository = createHistoryRepository({
      onRead: async () => {
        transcriptReads += 1;
        if (transcriptReads === 1) await transcriptGate.promise;
      },
    });
    const handler = createDedicatedHistoryHandler({
      env: fixture.env,
      teachingRepository,
      transcriptRepository,
    });
    const concurrent = fixture.cookies.groupMembers.map((cookie) =>
      handler(createHistoryRequest(fixture.courseId, cookie, fixture.groupId)),
    );
    await vi.waitFor(() => expect(teachingReads).toBe(5));
    await vi.waitFor(() => expect(transcriptReads).toBe(1));
    transcriptGate.resolve();
    const responses = await Promise.all(concurrent);
    const projections = await Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        body: (await response.json()) as {
          members: Array<{ displayName: string; isSelf: boolean }>;
        },
      })),
    );

    expect(projections.map((projection) => projection.status)).toEqual([
      200,
      200,
      200,
      200,
      200,
    ]);
    projections.forEach((projection, index) => {
      expect(projection.body.members.filter((member) => member.isSelf)).toEqual([
        {
          displayName: fixture.groupStudentIds[index],
          isSelf: true,
        },
      ]);
    });
    expect(teachingReads).toBe(5);
    expect(transcriptReads).toBe(1);

    const request = createHistoryRequest(
      fixture.courseId,
      fixture.cookies.approved,
      fixture.groupId,
    );
    expect((await handler(request.clone())).status).toBe(200);
    expect(teachingReads).toBe(6);
    expect(transcriptReads).toBe(2);

    const membership = fixture.database.memberships.find(
      (item) => item.studentId === "student-approved",
    );
    expect(membership).toBeDefined();
    if (membership) membership.membershipStatus = "pending-teacher-review";
    const revoked = await handler(request.clone());

    expect(revoked.status).toBe(403);
    expect(teachingReads).toBe(7);
    expect(transcriptReads).toBe(2);
  });

  it("correlates a shared unavailable read to every waiter and retries after settlement", async () => {
    const createDedicatedHistoryHandler = await loadDedicatedHistoryHandler();
    const fixture = await createHistoryAuthorizationFixture();
    const readGate = createDeferred<void>();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let reads = 0;
    let unavailable = true;
    const database = createEmptyLearningChatroomTranscriptDatabase();
    const transcriptRepository: LearningChatroomTranscriptRepository = {
      storage: {
        transcriptStoragePolicy: "external-redacted-learning-chatroom-transcripts",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      },
      read: async () => {
        reads += 1;
        if (reads === 1) await readGate.promise;
        if (unavailable) throw new Error("Synthetic shared transcript outage.");
        return { database, revision: "rev-history" };
      },
      write: async () => {
        throw new Error("History GET must not write transcript state.");
      },
    };
    const handler = createDedicatedHistoryHandler({
      env: fixture.env,
      transcriptRepository,
    });
    const traceIds = fixture.groupStudentIds.map(
      (_, index) => `trace-shared-history-${index + 1}`,
    );
    const concurrent = fixture.cookies.groupMembers.map((cookie, index) =>
      handler(
        createHistoryRequest(
          fixture.courseId,
          cookie,
          fixture.groupId,
          traceIds[index],
        ),
      ),
    );

    await vi.waitFor(() => expect(reads).toBe(1));
    readGate.resolve();
    const responses = await Promise.all(concurrent);
    const bodies = await Promise.all(
      responses.map((response) => response.json() as Promise<{
        transcript: { status: string };
      }>),
    );

    expect(responses.map((response) => response.status)).toEqual([
      200,
      200,
      200,
      200,
      200,
    ]);
    expect(bodies.map((body) => body.transcript.status)).toEqual([
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
    ]);
    expect(reads).toBe(1);
    const loggedTraces = errors.mock.calls
      .filter(([label]) => label === "[learning-chatroom-history]")
      .map(([, details]) => (details as { traceId?: string }).traceId)
      .filter((traceId): traceId is string => Boolean(traceId));
    expect(loggedTraces.sort()).toEqual([...traceIds].sort());

    unavailable = false;
    const recovered = await handler(
      createHistoryRequest(
        fixture.courseId,
        fixture.cookies.approved,
        fixture.groupId,
        "trace-shared-history-recovered",
      ),
    );

    expect(recovered.status).toBe(200);
    expect((await recovered.json()).transcript.status).toBe("loaded");
    expect(reads).toBe(2);
  });

  it("never coalesces different students' personal transcript rooms", async () => {
    const createDedicatedHistoryHandler = await loadDedicatedHistoryHandler();
    const fixture = await createHistoryAuthorizationFixture();
    const readGate = createDeferred<void>();
    let reads = 0;
    const transcriptRepository = createHistoryRepository({
      onRead: async () => {
        reads += 1;
        if (reads <= 2) await readGate.promise;
      },
    });
    const handler = createDedicatedHistoryHandler({
      env: fixture.env,
      transcriptRepository,
    });
    const requests = [
      createHistoryRequest(
        fixture.courseId,
        fixture.cookies.groupMembers[0],
        undefined,
        "trace-personal-room-one",
      ),
      createHistoryRequest(
        fixture.courseId,
        fixture.cookies.groupMembers[1],
        undefined,
        "trace-personal-room-two",
      ),
    ];
    const responses = requests.map((request) => handler(request));

    await vi.waitFor(() => expect(reads).toBe(2));
    readGate.resolve();

    expect((await Promise.all(responses)).map((response) => response.status)).toEqual([
      200,
      200,
    ]);
    expect(reads).toBe(2);
  });

  it("replaces missing and malformed trace ids with one safe correlated error trace", async () => {
    const createDedicatedHistoryHandler = await loadDedicatedHistoryHandler();
    const handler = createDedicatedHistoryHandler({
      env: { UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret },
    });

    for (const supplied of [undefined, "../../unsafe?cookie=secret", "x".repeat(121)]) {
      const response = await handler(
        new Request(
          "https://staging.uais.top/api/learning/chatroom/history?courseId=history-course",
          {
            headers: supplied ? { "x-uais-trace-id": supplied } : undefined,
          },
        ),
      );
      const body = (await response.json()) as { traceId?: string };
      const headerTraceId = response.headers.get("x-uais-trace-id");

      expect(response.status).toBe(401);
      expect(headerTraceId).toMatch(/^trace-learning-chatroom-[0-9a-f-]{36}$/);
      expect(body.traceId).toBe(headerTraceId);
      expect(headerTraceId).not.toBe(supplied);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});

type HistoryHandlerDeps = NonNullable<
  Parameters<typeof createLegacyHistoryHandler>[0]
> & { timingNow?: () => number };
type HistoryHandlerFactory = (
  deps?: HistoryHandlerDeps,
) => ReturnType<typeof createLegacyHistoryHandler>;

async function loadDedicatedHistoryHandler(): Promise<HistoryHandlerFactory> {
  expect(existsSync(historyHandlerPath), historyHandlerPath).toBe(true);
  const moduleUrl = pathToFileURL(historyHandlerPath).href;
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as {
    createLearningChatroomHistoryGetHandler?: HistoryHandlerFactory;
  };
  expect(loaded.createLearningChatroomHistoryGetHandler).toBeTypeOf("function");
  return loaded.createLearningChatroomHistoryGetHandler as HistoryHandlerFactory;
}

async function createHistoryAuthorizationFixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-history-route-"));
  fixtureDirs.push(dataDir);
  const courseId = "history-course";
  const classId = "history-class";
  const groupId = "history-group";
  const groupStudentIds = [
    "student-approved",
    "student-peer-two",
    "student-peer-three",
    "student-peer-four",
    "student-peer-five",
  ];
  const now = "2026-08-30T00:00:00.000Z";
  const redaction = { secrets: "omitted", localFiles: "omitted", assets: "ids-only" };
  const storagePolicy = "local-json-teaching-course-management";
  const storageWritePolicy = "atomic-json-file-replace";

  const database: TeachingCourseManagementDatabase = {
      schemaVersion: "uais-teaching-course-management-v1",
      updatedAt: now,
      courses: [
        {
          courseId,
          ownerTeacherId: "teacher-owner",
          courseName: "History course",
          instructor: "Teacher Owner",
          unit: "UAIS",
          department: "Teaching",
          semester: "2026",
          status: "draft",
          students: 2,
          createdAt: now,
          updatedAt: now,
          storagePolicy,
          storageWritePolicy,
          responsibleSession: "S12",
          redaction,
        },
      ],
      classes: [
        {
          classId,
          courseId,
          ownerTeacherId: "teacher-owner",
          className: "History class",
          students: 2,
          semester: "2026",
          invitationCode: "12345678",
          joinUrl: "/courses?invite=12345678",
          createdAt: now,
          updatedAt: now,
          storagePolicy,
          storageWritePolicy,
          responsibleSession: "S12",
          redaction,
        },
      ],
      memberships: [
        createMembership("student-approved", "approved"),
        ...groupStudentIds
          .slice(1)
          .map((studentId) => createMembership(studentId, "approved")),
        createMembership("student-approved-no-group", "approved"),
        createMembership("student-pending", "pending-teacher-review"),
      ],
      learningGroups: [
        {
          groupId,
          courseId,
          classId,
          ownerTeacherId: "teacher-owner",
          groupName: "History group",
          members: groupStudentIds.map((studentId) => ({
            studentId,
            studentDisplayName: studentId,
            addedAt: now,
          })),
          createdAt: now,
          updatedAt: now,
          storagePolicy,
          storageWritePolicy,
          responsibleSession: "S12",
          redaction,
        },
      ],
      auditEvents: [],
    };

  await writeFile(
    join(dataDir, "teaching-course-management.json"),
    JSON.stringify(database),
  );

  return {
    courseId,
    groupId,
    groupStudentIds,
    database,
    env: {
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSecret,
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
    },
    cookies: {
      approved: createCookie("student-approved", "student"),
      groupMembers: groupStudentIds.map((studentId) =>
        createCookie(studentId, "student"),
      ),
      pending: createCookie("student-pending", "student"),
      nonMember: createCookie("student-other", "student"),
      approvedNoGroup: createCookie("student-approved-no-group", "student"),
      teacher: createCookie("teacher-owner", "teacher"),
      foreignTeacher: createCookie("teacher-other", "teacher"),
      admin: createCookie("admin-owner", "admin"),
    },
  };

  function createMembership(
    studentId: string,
    membershipStatus: "approved" | "pending-teacher-review",
  ) {
    return {
      membershipId: `membership-${studentId}`,
      courseId,
      classId,
      invitationCode: "12345678",
      studentId,
      studentDisplayName: studentId,
      membershipStatus,
      ...(membershipStatus === "approved"
        ? { approvedAt: now, approvedByTeacherId: "teacher-owner" }
        : {}),
      joinedAt: now,
      storagePolicy,
      storageWritePolicy,
      responsibleSession: "S12",
      redaction,
    };
  }
}

function createCookie(account: string, role: UaisAppSessionUser["role"]) {
  return createUaisAppSessionCookie(
    {
      account,
      department: role === "teacher" ? "教师账号" : "学生账号",
      displayName: account,
      role,
    },
    {
      secret: appSessionSecret,
      now: futureIssueTime,
      sessionId: `history-session-${account}`,
    },
  );
}

function createHistoryRequest(
  courseId?: string,
  cookie?: string,
  groupId?: string,
  traceId = "trace-history-route",
) {
  const params = new URLSearchParams();
  if (courseId) params.set("courseId", courseId);
  if (groupId) params.set("groupId", groupId);
  return new Request(`https://staging.uais.top/api/learning/chatroom/history?${params}`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      "x-uais-trace-id": traceId,
    },
  });
}

function createHistoryRepository(
  options: {
    moderationStatus?: "frozen" | "open";
    failRead?: boolean;
    onRead?: () => void | Promise<void>;
  } = {},
): LearningChatroomTranscriptRepository {
  const database = createEmptyLearningChatroomTranscriptDatabase();
  const revision = options.moderationStatus ? "rev-history" : "rev-empty";
  if (options.moderationStatus) {
    const courseId = "history-course";
    const studentId = "student-approved";
    database.transcripts.push({
      transcriptId: createLearningChatroomTranscriptId({ courseId, studentId }),
      courseId,
      studentId,
      messages: [],
      moderation: {
        status: options.moderationStatus,
        actorId: "teacher-owner",
        actedAt: "2026-08-30T00:00:00.000Z",
      },
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
      storagePolicy: "external-redacted-learning-chatroom-transcripts",
      storageWritePolicy: "external-optimistic-snapshot-replace",
      responsibleSession: "S12",
      redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
    });
  }
  return {
    storage: {
      transcriptStoragePolicy: "external-redacted-learning-chatroom-transcripts",
      storageWritePolicy: "external-optimistic-snapshot-replace",
    },
    read: async () => {
      await options.onRead?.();
      if (options.failRead) throw new Error("Synthetic transcript read failure.");
      return { database, revision };
    },
    write: async () => {
      throw new Error("History GET must not write transcript state.");
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function parseServerTiming(header: string) {
  return Object.fromEntries(
    header.split(", ").map((entry) => {
      const [name, duration] = entry.split(";dur=");
      return [name, Number(duration)];
    }),
  ) as Record<string, number>;
}

async function projectResponse(responsePromise: Promise<Response>) {
  const response = await responsePromise;
  return {
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("cache-control"),
    traceId: response.headers.get("x-uais-trace-id"),
    retryAfter: response.headers.get("retry-after"),
  };
}

function collectRuntimeClosure(entryPath: string) {
  const visited = new Set<string>();
  const externalSpecifiers = new Set<string>();
  const pending = [entryPath];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current) || !existsSync(current)) continue;
    visited.add(current);

    const source = readFileSync(current, "utf8");
    for (const specifier of readRuntimeImportSpecifiers(source)) {
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) {
        externalSpecifiers.add(specifier);
      }
      const resolved = resolveProjectModule(current, specifier);
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }

  return { files: visited, externalSpecifiers };
}

function readRuntimeImportSpecifiers(source: string) {
  const file = ts.createSourceFile(
    "runtime-closure.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const specifiers: string[] = [];

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const namedBindings = clause?.namedBindings;
      const namedElements =
        namedBindings && ts.isNamedImports(namedBindings)
          ? namedBindings.elements
          : undefined;
      const isTypeOnly =
        clause?.isTypeOnly === true ||
        (namedElements !== undefined &&
          namedElements.length > 0 &&
          namedElements.every((item) => item.isTypeOnly));
      if (!isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const elements =
        statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements
          : undefined;
      if (!elements || elements.some((item) => !item.isTypeOnly)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    }
  }

  return specifiers;
}

function resolveProjectModule(importer: string, specifier: string) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return undefined;
  const base = specifier.startsWith("@/")
    ? join(projectRoot, "src", specifier.slice(2))
    : resolve(dirname(importer), specifier);

  const candidates = extname(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.mjs`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ];

  const resolved = candidates.find((candidate) => existsSync(candidate));
  return resolved ? normalize(resolved) : undefined;
}
