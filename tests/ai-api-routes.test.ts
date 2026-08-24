import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { POST as postChat, createChatPostHandler } from "@/app/api/ai/chat/route";
import {
  POST as postPptNarration,
  createPptNarrationPostHandler,
} from "@/app/api/ai/ppt-narration/route";
import {
  createPptNarrationAudioGetHandler,
} from "@/app/api/ai/ppt-narration/audio/[manifestId]/[audioId]/route";
import {
  createPptNarrationExportGetHandler,
} from "@/app/api/ai/ppt-narration/export/[manifestId]/route";
import { createReadinessGetHandler } from "@/app/api/ai/readiness/route";
import { createSmokePlanGetHandler } from "@/app/api/ai/smoke-plan/route";
import {
  createTeacherAiSessionPostHandler,
} from "@/app/api/ai/session/route";
import {
  createTeacherAuthSessionIssuePostHandler,
} from "@/app/api/ai/teacher-auth/issue/route";
import {
  createTeacherAiOwnershipGetHandler,
} from "@/app/api/ai/teacher-ownership/route";
import {
  createTeacherPptWorkflowGetHandler,
} from "@/app/api/ai/teacher-ppt-workflow/route";
import {
  POST as postVoiceCloneStatus,
  createVoiceCloneStatusPostHandler,
} from "@/app/api/ai/voice-clone/status/route";
import {
  createVoiceCloneRevokePostHandler,
} from "@/app/api/ai/voice-clone/revoke/route";
import {
  createVoiceLifecycleAuditGetHandler,
} from "@/app/api/ai/voice-clone/lifecycle-audit/route";
import {
  createVoiceAssetRetentionReadinessGetHandler,
} from "@/app/api/ai/voice-assets/retention-readiness/route";
import {
  createVoiceClonePreflightPostHandler,
} from "@/app/api/ai/voice-clone/preflight/route";
import {
  POST as postVoiceSample,
  createVoiceSamplePostHandler,
} from "@/app/api/ai/voice-sample/route";
import {
  createLearningAiGuidePostHandler,
} from "@/app/api/learning/ai-guide/route";
import {
  createLearningAiGuideHitlPostHandler,
} from "@/app/api/learning/ai-guide/hitl/route";
import { storeTeacherVoiceSampleAsset } from "@/lib/ai/voice/sample-assets";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import {
  listQwenClonedVoiceLifecycleAuditRecords,
  revokeAndDeleteQwenClonedVoiceReference,
  storeQwenClonedVoiceReference,
} from "@/lib/ai/voice/cloned-voice-registry";
import {
  authorizeUaisAiAccess,
  createUaisAiAccessSessionForTrustedActor,
} from "@/lib/server/ai-access-control";
import {
  readUaisTeacherAiOwnershipRecord,
  storeUaisTeacherAiOwnershipRecord,
} from "@/lib/server/teacher-ai-ownership-store";
import {
  createUaisTeacherAuthSessionCookieHeader,
  readUaisAuthenticatedTeacherSessionFromSignedCookies,
  UAIS_TEACHER_AUTH_CLAIMS_COOKIE,
  UAIS_TEACHER_AUTH_SIGNATURE_COOKIE,
} from "@/lib/server/teacher-auth-session";
import {
  createUaisTrustedTeacherAuthIssuerHeaders,
  UAIS_TEACHER_AUTH_ISSUER_CLAIMS_HEADER,
  UAIS_TEACHER_AUTH_ISSUER_SIGNATURE_HEADER,
} from "@/lib/server/teacher-auth-issuer-proof";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const liveApprovalToken = "test-live-approval-token";
const aiAccessSigningSecret = "test-ai-access-signing-secret";
const appSessionSigningSecret = "test-app-session-signing-secret-32ch";
const teacherAuthSessionSigningSecret = "test-teacher-auth-session-signing-secret";
const teacherAuthIssuerSecret = "test-teacher-auth-issuer-secret-strong";
const stableFutureIssueTime = new Date("2099-01-01T00:00:00.000Z");
const activeRetentionFixtureCreatedAt = "2099-01-01T00:00:00.000Z";
const liveApprovalHeaders = { "x-uais-live-ai-approval": liveApprovalToken };
const teacherAiAccessHeaders = {
  ...liveApprovalHeaders,
  "x-uais-actor-id": "teacher-kang",
  "x-uais-actor-role": "teacher",
  "x-uais-teacher-ids": "teacher-kang",
  "x-uais-course-ids": "research-methods",
  "x-uais-sample-asset-ids": "asset-voice-10s,teacher-kang-10s-sample",
  "x-uais-ppt-asset-ids": "research-methods-unit-3",
  "x-uais-voice-ref-ids": "qwen-voice-ref-teacher-kang-asset-voice-10s",
  "x-uais-audio-manifest-ids": "audio-manifest-research-methods-unit-3",
};
const signedAdminAiAccessHeaders = createUaisAiAccessSessionForTrustedActor({
  secret: aiAccessSigningSecret,
  now: stableFutureIssueTime,
  ttlSeconds: 3600,
  actor: {
    actorId: "admin-ai-ops",
    role: "admin",
  },
  actions: [
    "live-chat",
    "voice-sample-submit",
    "voice-clone-preflight",
    "voice-clone-status",
    "voice-clone-revoke",
    "voice-lifecycle-audit-read",
    "voice-asset-retention-read",
    "ppt-narration-submit",
    "ppt-narration-audio-download",
    "ppt-narration-export-download",
    "teacher-auth-session-issue",
    "teacher-ppt-workflow-read",
    "provider-readiness",
    "provider-smoke-plan",
    "lrs-readiness",
    "lrs-live-smoke",
    "lrs-analytics-read",
  ],
}).headers;
const signedTeacherAiAccessHeaders = createUaisAiAccessSessionForTrustedActor({
  secret: aiAccessSigningSecret,
  now: stableFutureIssueTime,
  ttlSeconds: 3600,
  actor: {
    actorId: "teacher-kang",
    role: "teacher",
  },
  actions: [
    "live-chat",
    "voice-sample-submit",
    "voice-clone-preflight",
    "voice-clone-status",
    "voice-clone-revoke",
    "teacher-ppt-workflow-read",
    "ppt-narration-submit",
    "ppt-narration-audio-download",
    "ppt-narration-export-download",
    "teacher-auth-session-issue",
    "provider-smoke-plan",
    "voice-lifecycle-audit-read",
    "voice-asset-retention-read",
  ],
  scopes: {
    teacherIds: ["teacher-kang"],
    courseIds: ["research-methods", "elementary-math-research"],
    sampleAssetIds: [
      "asset-voice-10s",
      "asset-short",
      "asset-short-wav",
      "teacher-kang-10s-sample",
    ],
    pptAssetIds: ["research-methods-unit-3", "kang-xia-ppt-19"],
    voiceRefIds: [
      "qwen-voice-ref-teacher-kang-asset-voice-10s",
      "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
    ],
    audioManifestIds: [
      "audio-manifest-research-methods-unit-3",
      "audio-manifest-kang-xia-ppt-19",
    ],
  },
}).headers;
const studentAppSessionUser: UaisAppSessionUser = {
  account: "Peter",
  department: "学生账号",
  displayName: "Peter",
  role: "student",
};
const productionDatabaseAdapterEvidence = {
  status: "ready",
  providerClass: "managed-database",
  migrationStatus: "up-to-date",
  backupPolicy: "point-in-time-restore",
  concurrencyControl: "transactional",
  valueRedacted: true,
};
const previousAiAccessSigningSecret = process.env.UAIS_AI_ACCESS_SIGNING_SECRET;
const learningAiGuideAccessFixtureDirs: string[] = [];

beforeAll(() => {
  process.env.UAIS_AI_ACCESS_SIGNING_SECRET = aiAccessSigningSecret;
});

afterAll(async () => {
  if (previousAiAccessSigningSecret === undefined) {
    delete process.env.UAIS_AI_ACCESS_SIGNING_SECRET;
  } else {
    process.env.UAIS_AI_ACCESS_SIGNING_SECRET = previousAiAccessSigningSecret;
  }
  await Promise.all(
    learningAiGuideAccessFixtureDirs.map((dataDir) =>
      rm(dataDir, { recursive: true, force: true }),
    ),
  );
});

function expectNoCredentialValues(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("secret-qwen");
  expect(serialized).not.toContain("secret-deepseek");
  expect(serialized).not.toContain(appSessionSigningSecret);
  expect(serialized).not.toContain("test-external-storage-token-strong-fixture");
  expect(serialized).not.toContain(aiAccessSigningSecret);
  expect(serialized).not.toContain(teacherAuthSessionSigningSecret);
  expect(serialized).not.toContain(teacherAuthIssuerSecret);
  expect(serialized).not.toContain(liveApprovalToken);
  expect(serialized).not.toContain("/Users/");
}

function readSetCookieHeaders(response: Response) {
  const headersWithSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headersWithSetCookie.getSetCookie?.();
  if (setCookies?.length) {
    return setCookies;
  }

  const combined = response.headers.get("set-cookie");
  return combined
    ? combined.split(/,\s*(?=uais_teacher_auth_(?:claims|signature)=)/)
    : [];
}

function createCookieHeaderFromSetCookies(setCookies: string[]) {
  return setCookies
    .map((setCookie) => setCookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function createStudentAppSessionCookie(secret?: string) {
  return createUaisAppSessionCookie(studentAppSessionUser, {
    ...(secret ? { secret } : {}),
    now: stableFutureIssueTime,
    sessionId: "student-app-session-cookie-id",
  });
}

async function createLearningAiGuideCourseAccessFixture(input: {
  courseId: string;
  studentId?: string;
  membershipStatus?: "approved" | "pending-teacher-review";
}) {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-learning-ai-guide-access-"));
  learningAiGuideAccessFixtureDirs.push(dataDir);

  await writeFile(
    join(dataDir, "teaching-course-management.json"),
    JSON.stringify(createLearningAiGuideCourseAccessDatabase(input)),
  );

  return {
    dataDir,
    env: {
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
    },
    cookie: createStudentAppSessionCookie(appSessionSigningSecret),
  };
}

function createLearningAiGuideCourseAccessDatabase(
  input: {
    courseId: string;
    studentId?: string;
    membershipStatus?: "approved" | "pending-teacher-review";
  },
  storage: {
    recordStoragePolicy:
      | "local-json-teaching-course-management"
      | "external-redacted-teaching-course-management-snapshot";
    storageWritePolicy:
      | "atomic-json-file-replace"
      | "external-optimistic-snapshot-replace";
  } = {
    recordStoragePolicy: "local-json-teaching-course-management",
    storageWritePolicy: "atomic-json-file-replace",
  },
) {
  const now = "2026-06-22T12:00:00.000Z";
  const studentId = input.studentId ?? studentAppSessionUser.account;
  const classId = `${input.courseId}-class-1`;
  const redaction = {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };

  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: now,
    courses: [
      {
        courseId: input.courseId,
        ownerTeacherId: "teacher-kang",
        courseName: "初等数学研究",
        instructor: "康霞",
        unit: "广州大学（404）",
        department: "实验教学中心",
        semester: "2026 春季",
        status: "draft",
        students: input.membershipStatus === "approved" ? 1 : 0,
        createdAt: now,
        updatedAt: now,
        storagePolicy: storage.recordStoragePolicy,
        storageWritePolicy: storage.storageWritePolicy,
        responsibleSession: "S12",
        redaction,
      },
    ],
    classes: [
      {
        classId,
        courseId: input.courseId,
        ownerTeacherId: "teacher-kang",
        className: "初等数学研究一班",
        students: input.membershipStatus === "approved" ? 1 : 0,
        semester: "2026 春季",
        invitationCode: "55395057",
        joinUrl: "/courses?invite=55395057",
        createdAt: now,
        updatedAt: now,
        storagePolicy: storage.recordStoragePolicy,
        storageWritePolicy: storage.storageWritePolicy,
        responsibleSession: "S12",
        redaction,
      },
    ],
    memberships:
      input.membershipStatus
        ? [
            {
              membershipId: `membership-${classId}-${studentId}`,
              courseId: input.courseId,
              classId,
              invitationCode: "55395057",
              studentId,
              studentDisplayName: studentId,
              membershipStatus: input.membershipStatus,
              ...(input.membershipStatus === "approved"
                ? {
                    approvedAt: now,
                    approvedByTeacherId: "teacher-kang",
                  }
                : {}),
              joinedAt: now,
              storagePolicy: storage.recordStoragePolicy,
              storageWritePolicy: storage.storageWritePolicy,
              responsibleSession: "S12",
              redaction,
            },
          ]
        : [],
    auditEvents: [],
  };
}

function createExternalLangGraphPersistenceFetch(input: {
  teachingCourseManagementDatabase?: ReturnType<
    typeof createLearningAiGuideCourseAccessDatabase
  >;
} = {}) {
  const persistedSnapshots = new Map<string, unknown>();
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url);
    const method = init?.method ?? "GET";
    if (
      method === "GET" &&
      requestUrl === "https://storage.example.test/teaching-course-management/database" &&
      input.teachingCourseManagementDatabase
    ) {
      return Response.json({
        database: input.teachingCourseManagementDatabase,
        productionDatabaseAdapter: productionDatabaseAdapterEvidence,
        revision: "teaching-course-management-revision-001",
      });
    }
    if (method === "GET") {
      if (!persistedSnapshots.has(requestUrl)) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      return Response.json(persistedSnapshots.get(requestUrl));
    }
    if (method === "PUT") {
      persistedSnapshots.set(requestUrl, JSON.parse(String(init?.body)));
      return Response.json({
        status: "persisted",
        storagePolicy: "external-redacted-langgraph-persistence",
        storageWritePolicy: "external-atomic-langgraph-snapshot",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
    }
    return Response.json({ error: "unsupported" }, { status: 405 });
  });
}

function createTestRs256Jwt(input: {
  privateKey: KeyObject;
  kid: string;
  claims: Record<string, unknown>;
}) {
  const header = base64UrlJson({
    alg: "RS256",
    typ: "JWT",
    kid: input.kid,
  });
  const payload = base64UrlJson(input.claims);
  const signedPart = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signedPart)
    .sign(input.privateKey)
    .toString("base64url");

  return `${signedPart}.${signature}`;
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createTrustedTeacherAuthIssuerHeadersForTest(input: {
  secret: string;
  teacherId: string;
  issuedAt: string;
  expiresAt: string;
}) {
  const encodedClaims = base64UrlJson({
    issuerId: "trusted-cookie-issuer",
    teacherId: input.teacherId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  });
  return {
    [UAIS_TEACHER_AUTH_ISSUER_CLAIMS_HEADER]: encodedClaims,
    [UAIS_TEACHER_AUTH_ISSUER_SIGNATURE_HEADER]: createHmac("sha256", input.secret)
      .update(encodedClaims)
      .digest()
      .toString("base64url"),
  };
}

function expectRedactedAuditEvent(
  value: unknown,
  expected: {
    provider: "deepseek" | "qwen";
    providerRole: string;
    action: string;
  },
) {
  expect(value).toEqual(
    expect.objectContaining({
      type: "live-provider-call",
      provider: expected.provider,
      providerRole: expected.providerRole,
      action: expected.action,
      approval: {
        mode: "server-token",
        header: "x-uais-live-ai-approval",
      },
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    }),
  );
  expectNoCredentialValues(value);
}

async function expectSignedSessionRequired(
  response: Response,
  expected: {
    action: string;
    resource?: Record<string, string>;
  },
) {
  const body = await response.json();

  expect(response.status).toBe(403);
  expect(body.access).toEqual(
    expect.objectContaining({
      status: "denied",
      reasonCode: "signed-session-required",
      responsibleSession: "S12",
      action: expected.action,
      ...(expected.resource ? { resource: expected.resource } : {}),
    }),
  );
  expectNoCredentialValues(body);
}

describe("UAIS AI API route contracts", () => {
  it("returns provider readiness without leaking secret values", async () => {
    const getReadiness = createReadinessGetHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    const response = await getReadiness(
      new Request("http://localhost/api/ai/readiness", {
        headers: signedAdminAiAccessHeaders,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.readiness).toEqual([
      { provider: "deepseek", requiredEnv: "DEEPSEEK_API_KEY", status: "present" },
      { provider: "qwen", requiredEnv: "DASHSCOPE_API_KEY", status: "present" },
    ]);
    expectNoCredentialValues(body);
  });

  it("treats deployment production markers as production in provider readiness reports", async () => {
    const deploymentProductionEnvs = [
      { VERCEL_ENV: "production" },
      { UAIS_DEPLOYMENT_ENV: "production" },
    ] satisfies Array<Record<string, string>>;

    for (const env of deploymentProductionEnvs) {
      const getReadiness = createReadinessGetHandler({
        env: {
          NODE_ENV: "development",
          ...env,
          UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
          DEEPSEEK_API_KEY: "secret-deepseek",
          DASHSCOPE_API_KEY: "secret-qwen",
        },
      });

      const response = await getReadiness(
        new Request("http://localhost/api/ai/readiness", {
          headers: signedAdminAiAccessHeaders,
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.target).toBe("production");
      expectNoCredentialValues(body);
    }
  });

  it("routes learning advisor text questions through DeepSeek without leaking secrets", async () => {
    const fixture = await createLearningAiGuideCourseAccessFixture({
      courseId: "elementary-math-research",
      membershipStatus: "approved",
    });
    const deepSeekRequests: Array<{
      model?: string;
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    }> = [];
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        ...fixture.env,
        DEEPSEEK_API_KEY: "secret-deepseek",
        DEEPSEEK_MODEL: "deepseek-v4-flash",
      },
      createDeepSeekTextClient: ({ apiKey }) => {
        expect(apiKey).toBe("secret-deepseek");
        return {
          complete: async (input) => {
            deepSeekRequests.push(input);
            return {
              provider: "deepseek",
              model: input.model ?? "deepseek-v4-flash",
              content: "DeepSeek 学习顾问响应",
            };
          },
        };
      },
    });

    const response = await postLearningAiGuide(
      new Request("http://localhost/api/learning/ai-guide", {
        method: "POST",
        headers: { cookie: fixture.cookie },
        body: JSON.stringify({
          agentId: "learning-advisor",
          locale: "zh-CN",
          question: "这页怎么学习？",
          course: {
            courseId: "elementary-math-research",
            courseTitle: "初等数学研究",
          },
          slide: {
            slideNumber: 1,
            slideTitle: "自然数的序数理论",
            narrationText: "今天我们进入自然数的序数理论。",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message.text).toBe("DeepSeek 学习顾问响应");
    expect(body.provider).toEqual({
      provider: "deepseek",
      role: "text-reasoning",
      model: "deepseek-v4-flash",
    });
    expect(deepSeekRequests[0].messages[1].content).toContain("初等数学研究");
    expect(deepSeekRequests[0].messages[1].content).toContain("自然数的序数理论");
    expectNoCredentialValues(body);
  });

  it("responds 504 when the learning AI guide DeepSeek call times out", async () => {
    const fixture = await createLearningAiGuideCourseAccessFixture({
      courseId: "elementary-math-research",
      membershipStatus: "approved",
    });
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        ...fixture.env,
        DEEPSEEK_API_KEY: "secret-deepseek",
      },
      createDeepSeekTextClient: () => ({
        complete: async () => {
          throw new Error("DeepSeek request timed out.");
        },
      }),
    });

    const response = await postLearningAiGuide(
      new Request("http://localhost/api/learning/ai-guide", {
        method: "POST",
        headers: { cookie: fixture.cookie },
        body: JSON.stringify({
          agentId: "learning-advisor",
          locale: "zh-CN",
          question: "这页怎么学习？",
          course: {
            courseId: "elementary-math-research",
            courseTitle: "初等数学研究",
          },
        }),
      }),
    );
    const body = await response.json();

    // A provider timeout is an upstream failure, not a malformed request.
    expect(response.status).toBe(504);
    expect(body.error).toBe("DeepSeek request timed out.");
    expectNoCredentialValues(body);
  });

  it("routes concept explanation requests through Qwen multimodal without leaking secrets", async () => {
    const fixture = await createLearningAiGuideCourseAccessFixture({
      courseId: "elementary-math-research",
      membershipStatus: "approved",
    });
    const qwenRequests: Array<{
      model?: string;
      messages: Array<{
        role: "system" | "user" | "assistant";
        content:
          | string
          | Array<
              | { type: "text"; text: string }
              | { type: "image_url"; image_url: { url: string } }
            >;
      }>;
    }> = [];
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        ...fixture.env,
        DASHSCOPE_API_KEY: "secret-qwen",
        QWEN_MULTIMODAL_MODEL: "qwen3.5-omni-plus",
      },
      createQwenMultimodalClient: ({ apiKey }) => {
        expect(apiKey).toBe("secret-qwen");
        return {
          complete: async (input) => {
            qwenRequests.push(input);
            return {
              provider: "qwen",
              providerRole: "multimodal",
              model: input.model ?? "qwen3.5-omni-plus",
              content: "Qwen 概念解读响应",
            };
          },
        };
      },
    });

    const response = await postLearningAiGuide(
      new Request("http://localhost/api/learning/ai-guide", {
        method: "POST",
        headers: { cookie: fixture.cookie },
        body: JSON.stringify({
          agentId: "concept-explainer",
          locale: "zh-CN",
          question: "解释这张图的概念。",
          course: {
            courseId: "elementary-math-research",
            courseTitle: "初等数学研究",
          },
          slide: {
            slideNumber: 2,
            slideTitle: "学习线索",
            narrationText: "这节课有三个核心线索。",
            imageUrl: "https://www.uais.top/learning/slide-02.jpg",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message.text).toBe("Qwen 概念解读响应");
    expect(body.provider).toEqual({
      provider: "qwen",
      role: "multimodal",
      model: "qwen3.5-omni-plus",
    });
    expect(qwenRequests[0].messages[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: expect.stringContaining("学习线索") }),
        expect.objectContaining({
          type: "image_url",
          image_url: { url: "https://www.uais.top/learning/slide-02.jpg" },
        }),
      ]),
    );
    expectNoCredentialValues(body);
  });

  it("rejects learning AI guide requests without a UAIS app session", async () => {
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
      },
    });

    const response = await postLearningAiGuide(
      new Request("http://localhost/api/learning/ai-guide", {
        method: "POST",
        body: JSON.stringify({
          agentId: "learning-advisor",
          question: "这页怎么学习？",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("UAIS app session is required for learning AI guide.");
    expectNoCredentialValues(body);
  });

  it("rejects learning AI guide requests without course context before provider calls", async () => {
    let providerFactories = 0;
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
        DEEPSEEK_API_KEY: "secret-deepseek",
      },
      createDeepSeekTextClient: () => {
        providerFactories += 1;
        throw new Error("Missing-course learning AI guide requests must not call DeepSeek.");
      },
    });

    const response = await postLearningAiGuide(
      new Request("http://localhost/api/learning/ai-guide", {
        method: "POST",
        headers: { cookie: createStudentAppSessionCookie(appSessionSigningSecret) },
        body: JSON.stringify({
          agentId: "learning-advisor",
          locale: "zh-CN",
          question: "这页怎么学习？",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(providerFactories).toBe(0);
    expect(body).toEqual(
      expect.objectContaining({
        error: "UAIS learning AI guide requires course context.",
        access: expect.objectContaining({
          status: "denied",
          reasonCode: "course-context-required",
          actor: {
            actorId: "Peter",
            role: "student",
          },
          resource: {
            resourceType: "learning-ai-guide-course-context",
          },
          responsibleSession: "S12",
        }),
      }),
    );
    expectNoCredentialValues(body);
  });

  it("rejects multi-agent learning AI guide requests without course context before provider clients", async () => {
    let providerFactories = 0;
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      createDeepSeekTextClient: () => {
        providerFactories += 1;
        throw new Error("Missing-course multi-agent requests must not create DeepSeek.");
      },
      createQwenMultimodalClient: () => {
        providerFactories += 1;
        throw new Error("Missing-course multi-agent requests must not create Qwen.");
      },
    });

    const response = await postLearningAiGuide(
      new Request("http://localhost/api/learning/ai-guide", {
        method: "POST",
        headers: { cookie: createStudentAppSessionCookie(appSessionSigningSecret) },
        body: JSON.stringify({
          agentId: "learning-advisor",
          mode: "multi-agent",
          locale: "zh-CN",
          question: "把这页整理成 3 个学习要点",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(providerFactories).toBe(0);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "course-context-required",
        responsibleSession: "S12",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("rejects course-scoped learning AI guide requests without approved student membership before provider calls", async () => {
    const fixture = await createLearningAiGuideCourseAccessFixture({
      courseId: "restricted-ai-guide-course",
      studentId: "AnotherStudent",
      membershipStatus: "approved",
    });
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        ...fixture.env,
        DEEPSEEK_API_KEY: "secret-deepseek",
      },
      createDeepSeekTextClient: () => ({
        complete: async () => {
          throw new Error("Unauthorized learning AI guide requests must not call DeepSeek.");
        },
      }),
    });

    try {
      const response = await postLearningAiGuide(
        new Request("http://localhost/api/learning/ai-guide", {
          method: "POST",
          headers: { cookie: fixture.cookie },
          body: JSON.stringify({
            agentId: "learning-advisor",
            locale: "zh-CN",
            question: "请解释这个课程内容。",
            course: {
              courseId: "restricted-ai-guide-course",
              courseTitle: "受限课程",
            },
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS learning AI guide requires approved course membership.",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "student-course-membership-required",
            actor: {
              actorId: "Peter",
              role: "student",
            },
            resource: {
              courseId: "restricted-ai-guide-course",
            },
            responsibleSession: "S12",
          }),
        }),
      );
      expectNoCredentialValues(body);
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it("rejects course-scoped learning AI guide requests from teachers who do not own the course", async () => {
    const fixture = await createLearningAiGuideCourseAccessFixture({
      courseId: "teacher-owned-ai-guide-course",
    });
    const teacherCookie = createUaisAppSessionCookie(
      {
        account: "teacher-other",
        department: "教师账号",
        displayName: "Other Teacher",
        role: "teacher",
      },
      {
        secret: appSessionSigningSecret,
        now: stableFutureIssueTime,
        sessionId: "other-teacher-learning-ai-guide-session",
      },
    );
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        ...fixture.env,
        DEEPSEEK_API_KEY: "secret-deepseek",
      },
      createDeepSeekTextClient: () => ({
        complete: async () => {
          throw new Error("Unauthorized teacher learning AI guide requests must not call DeepSeek.");
        },
      }),
    });

    const response = await postLearningAiGuide(
      new Request("http://localhost/api/learning/ai-guide", {
        method: "POST",
        headers: { cookie: teacherCookie },
        body: JSON.stringify({
          agentId: "learning-advisor",
          locale: "zh-CN",
          question: "请解释这个课程内容。",
          course: {
            courseId: "teacher-owned-ai-guide-course",
            courseTitle: "教师归属课程",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual(
      expect.objectContaining({
        error: "UAIS learning AI guide requires teaching course ownership.",
        access: expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-course-ownership-required",
          actor: {
            actorId: "teacher-other",
            role: "teacher",
          },
          resource: {
            courseId: "teacher-owned-ai-guide-course",
          },
          responsibleSession: "S12",
        }),
      }),
    );
    expectNoCredentialValues(body);
  });

  it("runs the published AI guide for the explicitly opted-in Production demo teacher without reading the ordinary course database", async () => {
    const fetchImpl = createExternalLangGraphPersistenceFetch();
    const deepSeekRequests: Array<unknown> = [];
    const qwenRequests: Array<unknown> = [];
    const teacherCookie = createUaisAppSessionCookie(
      {
        account: "Phoebe",
        department: "教师账号",
        displayName: "Phoebe",
        role: "teacher",
      },
      {
        secret: appSessionSigningSecret,
        now: stableFutureIssueTime,
        sessionId: "production-demo-learning-ai-guide-session",
      },
    );
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH: "true",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_LANGGRAPH_PERSISTENCE_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "test-external-storage-token-strong-fixture",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      fetch: fetchImpl,
      createDeepSeekTextClient: () => ({
        complete: async (input) => {
          deepSeekRequests.push(input);
          return {
            provider: "deepseek",
            model: input.model ?? "deepseek-live-node",
            content: `DeepSeek Production demo response ${deepSeekRequests.length}`,
          };
        },
      }),
      createQwenMultimodalClient: () => ({
        complete: async (input) => {
          qwenRequests.push(input);
          return {
            provider: "qwen",
            providerRole: "multimodal",
            model: input.model ?? "qwen-live-node",
            content: "Qwen Production demo response",
          };
        },
      }),
    });

    vi.stubGlobal("fetch", fetchImpl);
    try {
      const response = await postLearningAiGuide(
        new Request("https://www.uais.top/api/learning/ai-guide", {
          method: "POST",
          headers: { cookie: teacherCookie },
          body: JSON.stringify({
            agentId: "learning-advisor",
            mode: "multi-agent",
            locale: "zh-CN",
            question: "请基于自然数的序数理论给我一个 10 分钟学习路径",
            course: {
              courseId: "elementary-math-research",
              courseTitle: "初等数学研究",
            },
            slide: {
              slideNumber: 1,
              slideTitle: "自然数的序数理论",
            },
          }),
        }),
      );
      const body = await response.json();

      expect(
        response.status,
        JSON.stringify({
          body,
          deepSeekRequestCount: deepSeekRequests.length,
          qwenRequestCount: qwenRequests.length,
          persistenceRequestPaths: fetchImpl.mock.calls.map(
            ([url]) => new URL(String(url)).pathname,
          ),
        }),
      ).toBe(200);
      expect(deepSeekRequests).toHaveLength(2);
      expect(qwenRequests).toHaveLength(1);
      expect(deepSeekRequests).toEqual([
        expect.objectContaining({
          maxTokens: 256,
          thinking: { type: "disabled" },
        }),
        expect.objectContaining({
          maxTokens: 256,
          thinking: { type: "disabled" },
        }),
      ]);
      expect(qwenRequests).toEqual([
        expect.objectContaining({
          maxTokens: 256,
          enableThinking: false,
        }),
      ]);
      expect(fetchImpl.mock.calls.map(([url]) => String(url))).not.toContain(
        "https://storage.example.test/teaching-course-management/database",
      );
      expect(body.message?.text).toContain("LangGraph 多智能体导学已完成");
      expectNoCredentialValues(body);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("runs the learning AI guide manual prompt through LangGraph live provider nodes", async () => {
    const fixture = await createLearningAiGuideCourseAccessFixture({
      courseId: "elementary-math-research",
      membershipStatus: "approved",
    });
    const deepSeekRequests: Array<{
      model?: string;
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    }> = [];
    const qwenRequests: Array<{
      model?: string;
      messages: Array<{
        role: "system" | "user" | "assistant";
        content:
          | string
          | Array<
              | { type: "text"; text: string }
              | { type: "image_url"; image_url: { url: string } }
            >;
      }>;
    }> = [];
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        ...fixture.env,
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
        DEEPSEEK_MODEL: "deepseek-live-node",
        QWEN_MULTIMODAL_MODEL: "qwen-live-node",
      },
      createDeepSeekTextClient: ({ apiKey }) => {
        expect(apiKey).toBe("secret-deepseek");
        return {
          complete: async (input) => {
            deepSeekRequests.push(input);
            return {
              provider: "deepseek",
              model: input.model ?? "deepseek-live-node",
              content:
                deepSeekRequests.length === 1
                  ? "DeepSeek 学习顾问 live node"
                  : "DeepSeek 代码助手 live node",
            };
          },
        };
      },
      createQwenMultimodalClient: ({ apiKey }) => {
        expect(apiKey).toBe("secret-qwen");
        return {
          complete: async (input) => {
            qwenRequests.push(input);
            return {
              provider: "qwen",
              providerRole: "multimodal",
              model: input.model ?? "qwen-live-node",
              content: "Qwen 概念解读 live node",
            };
          },
        };
      },
    });

    const response = await postLearningAiGuide(
      new Request("http://localhost/api/learning/ai-guide", {
        method: "POST",
        headers: { cookie: fixture.cookie },
        body: JSON.stringify({
          agentId: "concept-explainer",
          mode: "multi-agent",
          locale: "zh-CN",
          question: "把这页整理成 3 个学习要点",
          course: {
            courseId: "elementary-math-research",
            courseTitle: "初等数学研究",
          },
          slide: {
            slideNumber: 1,
            slideTitle: "自然数的序数理论",
            narrationText: "今天我们进入自然数的序数理论。",
            imageUrl: "https://www.uais.top/learning/slide-01.jpg",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toMatchObject({
      id: "learning-ai-langgraph-multi-agent",
      kind: "assistant",
      agentId: "multi-agent",
    });
    expect(body.message.text).toContain("LangGraph 多智能体导学已完成");
    expect(body.message.text).toContain("DeepSeek 学习顾问 live node");
    expect(body.message.text).toContain("Qwen 概念解读 live node");
    expect(deepSeekRequests).toHaveLength(2);
    expect(qwenRequests).toHaveLength(1);
    expect(qwenRequests[0].messages[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: expect.stringContaining("自然数的序数理论") }),
        expect.objectContaining({
          type: "image_url",
          image_url: { url: "https://www.uais.top/learning/slide-01.jpg" },
        }),
      ]),
    );
    expect(body.orchestration.graph).toEqual({
      runtime: "langgraph",
      graphId: "learning-ai-guide",
      topologicalOrder: ["learning-advisor", "concept-explainer", "code-assistant"],
    });
    expect(body.orchestration.turns).toEqual([
      expect.objectContaining({
        agentId: "learning-advisor",
        provider: {
          provider: "deepseek",
          role: "text-reasoning",
          model: "deepseek-live-node",
        },
      }),
      expect.objectContaining({
        agentId: "concept-explainer",
        provider: {
          provider: "qwen",
          role: "multimodal",
          model: "qwen-live-node",
        },
      }),
      expect.objectContaining({
        agentId: "code-assistant",
        provider: {
          provider: "deepseek",
          role: "text-reasoning",
          model: "deepseek-live-node",
        },
      }),
    ]);
    expect(body.orchestration.runtimeEvents[0].actor).toEqual({
      actorId: "app-session-learner-Peter",
      role: "learner",
    });
    expect(body.progress[0].responsibleAgent.name).toBe("学习顾问");
    expect(JSON.stringify(body.progress)).not.toContain("contract mode");
    expectNoCredentialValues(body);
  });

  it("rejects multi-agent learning AI guide requests instead of falling back to contract mode when live providers are missing", async () => {
    const fixture = await createLearningAiGuideCourseAccessFixture({
      courseId: "elementary-math-research",
      membershipStatus: "approved",
    });
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        ...fixture.env,
        DEEPSEEK_API_KEY: "secret-deepseek",
      },
    });

    const response = await postLearningAiGuide(
      new Request("http://localhost/api/learning/ai-guide", {
        method: "POST",
        headers: { cookie: fixture.cookie },
        body: JSON.stringify({
          agentId: "learning-advisor",
          mode: "multi-agent",
          locale: "zh-CN",
          question: "把这页整理成 3 个学习要点",
          course: {
            courseId: "elementary-math-research",
            courseTitle: "初等数学研究",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("DASHSCOPE_API_KEY is required for learning multi-agent AI guide.");
    expectNoCredentialValues(body);
  });

  it("interrupts and resumes a learning AI guide human review through LangGraph runtime", async () => {
    const postLearningAiGuideHitl = createLearningAiGuideHitlPostHandler();
    const cookie = createStudentAppSessionCookie();

    const interruptedResponse = await postLearningAiGuideHitl(
      new Request("http://localhost/api/learning/ai-guide/hitl", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({
          action: "start-review",
          graphId: "learning-ai-guide",
          threadId: "learning-guide-thread-001",
          messageText: "LangGraph 多智能体导学已完成：需要人工复核。",
        }),
      }),
    );
    const interruptedBody = await interruptedResponse.json();

    expect(interruptedResponse.status).toBe(200);
    expect(interruptedBody.status).toBe("interrupted");
    expect(interruptedBody.humanInTheLoop).toEqual(
      expect.objectContaining({
        status: "waiting-human",
        threadId: "learning-guide-thread-001",
      }),
    );
    expect(interruptedBody.humanInTheLoop.interrupt.value).toEqual(
      expect.objectContaining({
        kind: "learning-guide-human-review",
      }),
    );
    expect(interruptedBody.runtime).toEqual(
      expect.objectContaining({
        engine: "uais-langgraph-production-runtime",
        graphId: "learning-ai-guide-hitl",
        status: "interrupted",
        threadId: "learning-guide-thread-001",
      }),
    );
    expect(interruptedBody.runtimeEvents.map((event: { type: string }) => event.type)).toContain(
      "interrupt",
    );

    const resumedResponse = await postLearningAiGuideHitl(
      new Request("http://localhost/api/learning/ai-guide/hitl", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({
          action: "resume-review",
          threadId: "learning-guide-thread-001",
          decision: "approved",
          note: "学习者确认继续。",
        }),
      }),
    );
    const resumedBody = await resumedResponse.json();

    expect(resumedResponse.status).toBe(200);
    expect(resumedBody.status).toBe("completed");
    expect(resumedBody.message.text).toContain("人工复核已完成");
    expect(resumedBody.humanInTheLoop).toEqual(
      expect.objectContaining({
        status: "resumed",
        threadId: "learning-guide-thread-001",
        decision: "approved",
      }),
    );
    expect(resumedBody.runtimeEvents.map((event: { nodeId?: string }) => event.nodeId)).toEqual([
      "human-review",
      "resume-learning-guide",
    ]);
    expectNoCredentialValues(interruptedBody);
    expectNoCredentialValues(resumedBody);
  });

  it("rejects production multi-agent learning AI guide requests when external LangGraph persistence is not configured", async () => {
    const teachingCourseManagementDatabase = createLearningAiGuideCourseAccessDatabase(
      {
        courseId: "elementary-math-research",
        membershipStatus: "approved",
      },
      {
        recordStoragePolicy: "external-redacted-teaching-course-management-snapshot",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      },
    );
    const fetchImpl = createExternalLangGraphPersistenceFetch({
      teachingCourseManagementDatabase,
    });
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        NODE_ENV: "production",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "test-external-storage-token-strong-fixture",
      },
      fetch: fetchImpl,
      createDeepSeekTextClient: () => ({
        complete: async () => {
          throw new Error("Provider should not be called before persistence is ready.");
        },
      }),
      createQwenMultimodalClient: () => ({
        complete: async () => {
          throw new Error("Provider should not be called before persistence is ready.");
        },
      }),
    });

    const response = await postLearningAiGuide(
      new Request("http://localhost/api/learning/ai-guide", {
        method: "POST",
        headers: { cookie: createStudentAppSessionCookie(appSessionSigningSecret) },
        body: JSON.stringify({
          agentId: "learning-advisor",
          mode: "multi-agent",
          locale: "zh-CN",
          question: "把这页整理成 3 个学习要点",
          course: {
            courseId: "elementary-math-research",
            courseTitle: "初等数学研究",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe(
      "UAIS LangGraph production runtime requires external persistence; configure a GCS-backed checkpointer/store or an external LangGraph runtime persistence adapter.",
    );
    expectNoCredentialValues(body);
  });

  it("runs production multi-agent learning AI guide requests with external LangGraph persistence", async () => {
    const teachingCourseManagementDatabase = createLearningAiGuideCourseAccessDatabase(
      {
        courseId: "elementary-math-research",
        membershipStatus: "approved",
      },
      {
        recordStoragePolicy: "external-redacted-teaching-course-management-snapshot",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      },
    );
    const fetchImpl = createExternalLangGraphPersistenceFetch({
      teachingCourseManagementDatabase,
    });
    vi.stubGlobal("fetch", fetchImpl);
    const postLearningAiGuide = createLearningAiGuidePostHandler({
      env: {
        NODE_ENV: "production",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_LANGGRAPH_PERSISTENCE_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "test-external-storage-token-strong-fixture",
      },
      fetch: fetchImpl,
      createDeepSeekTextClient: () => ({
        complete: async (input) => ({
          provider: "deepseek",
          model: input.model ?? "deepseek-live-node",
          content: "DeepSeek production external persistence fixture",
        }),
      }),
      createQwenMultimodalClient: () => ({
        complete: async (input) => ({
          provider: "qwen",
          providerRole: "multimodal",
          model: input.model ?? "qwen-live-node",
          content: "Qwen production external persistence fixture",
        }),
      }),
    });

    try {
      const response = await postLearningAiGuide(
        new Request("http://localhost/api/learning/ai-guide", {
          method: "POST",
          headers: { cookie: createStudentAppSessionCookie(appSessionSigningSecret) },
          body: JSON.stringify({
            agentId: "learning-advisor",
            mode: "multi-agent",
            locale: "zh-CN",
            question: "把这页整理成 3 个学习要点",
            course: {
              courseId: "elementary-math-research",
              courseTitle: "初等数学研究",
            },
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.orchestration.trace.memory).toEqual(
        expect.objectContaining({
          mode: "external-checkpoint",
          store: "external-storage-langgraph-store",
        }),
      );
      expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(
        expect.arrayContaining([
          "https://storage.example.test/langgraph/checkpoints/uais-langgraph-production-runtime",
        ]),
      );
      expectNoCredentialValues(body);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns a redacted dry-run provider smoke plan without live network calls", async () => {
    const getSmokePlan = createSmokePlanGetHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: undefined,
      },
    });

    const response = await getSmokePlan(
      new Request("http://localhost/api/ai/smoke-plan", {
        headers: signedAdminAiAccessHeaders,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe("dry-run");
    expect(body.network).toBe("disabled");
    expect(body.checks).toEqual([
      expect.objectContaining({
        provider: "deepseek",
        requiredEnv: "DEEPSEEK_API_KEY",
        status: "present",
      }),
      expect.objectContaining({
        provider: "qwen",
        requiredEnv: "DASHSCOPE_API_KEY",
        status: "missing",
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("secret-deepseek");
  });

  it("rejects local provider readiness without signed admin session claims", async () => {
    const getReadiness = createReadinessGetHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DEEPSEEK_API_KEY: "secret-deepseek",
      },
    });

    const response = await getReadiness(
      new Request("http://localhost/api/ai/readiness"),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        action: "provider-readiness",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("rejects local provider smoke plan without signed admin session claims", async () => {
    const getSmokePlan = createSmokePlanGetHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DEEPSEEK_API_KEY: "secret-deepseek",
      },
    });

    const response = await getSmokePlan(
      new Request("http://localhost/api/ai/smoke-plan"),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        action: "provider-smoke-plan",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("rejects production provider readiness without signed session claims", async () => {
    const getProductionReadiness = createReadinessGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    const response = await getProductionReadiness(
      new Request("http://localhost/api/ai/readiness"),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        action: "provider-readiness",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("rejects production provider smoke plan for non-admin actors", async () => {
    const getProductionSmokePlan = createSmokePlanGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    const response = await getProductionSmokePlan(
      new Request("http://localhost/api/ai/smoke-plan", {
        headers: signedTeacherAiAccessHeaders,
      }),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "admin-role-required",
        responsibleSession: "S12",
        action: "provider-smoke-plan",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("issues a signed teacher AI session from server-side auth and ownership adapters", async () => {
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      now: stableFutureIssueTime,
      getAuthenticatedTeacherSession: async () => ({
        sessionId: "session-teacher-kang-real-store",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      }),
      getTeacherAiResourceOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["research-methods"],
        sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
        pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
        clonedVoiceRefs: [
          {
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            sampleAssetId: "asset-voice-10s",
          },
        ],
      }),
    });

    const response = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        body: JSON.stringify({
          action: "ppt-narration-submit",
          ttlSeconds: 600,
          resource: {
            teacherId: "teacher-kang",
            courseId: "research-methods",
            sampleAssetId: "asset-voice-10s",
            pptAssetId: "research-methods-unit-3",
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accessSession).toEqual(
      expect.objectContaining({
        responsibleSession: "S12",
        authSource: "uais-authenticated-session",
        authSessionRef: "server-side-auth-session",
        claims: expect.objectContaining({
          actor: {
            actorId: "teacher-kang",
            role: "teacher",
          },
          expiresAt: "2099-01-01T00:10:00.000Z",
          scopes: {
            teacherIds: ["teacher-kang"],
            courseIds: ["research-methods"],
            sampleAssetIds: ["asset-voice-10s"],
            pptAssetIds: ["research-methods-unit-3"],
            voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
          },
        }),
        headers: expect.objectContaining({
          "x-uais-access-claims": expect.any(String),
          "x-uais-access-signature": expect.any(String),
        }),
      }),
    );
    expect(body.accessPlan).toEqual({
      responsibleSession: "S12",
      action: "ppt-narration-submit",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
        sampleAssetId: "asset-voice-10s",
        pptAssetId: "research-methods-unit-3",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
      },
      requestedScopes: {
        teacherIds: ["teacher-kang"],
        courseIds: ["research-methods"],
        sampleAssetIds: ["asset-voice-10s"],
        pptAssetIds: ["research-methods-unit-3"],
        voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
      },
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    });
    expect(body.accessPlan).not.toHaveProperty("grants");
    expect(body.progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          responsibleSession: "S12",
          progressText: expect.stringContaining("S12 Backend/API Platform"),
        }),
        expect.objectContaining({
          responsibleSession: "S19",
          progressText: expect.stringContaining("S19 API Configuration"),
        }),
      ]),
    );
    expectNoCredentialValues(body);
    expect(JSON.stringify(body)).not.toContain("session-teacher-kang-real-store");

    const downstreamDecision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/ppt-narration", {
        headers: body.accessSession.headers,
      }),
      action: "ppt-narration-submit",
      resource: body.accessPlan.resource,
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      now: stableFutureIssueTime,
    });
    expect(downstreamDecision.reasonCode).toBe("authorized");
  });

  it("issues a signed teacher AI session for teacher PPT workflow readback", async () => {
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      now: stableFutureIssueTime,
      getAuthenticatedTeacherSession: async () => ({
        sessionId: "session-teacher-kang-workflow-read",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      }),
      getTeacherAiResourceOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["research-methods"],
        pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
      }),
    });

    const response = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        body: JSON.stringify({
          action: "teacher-ppt-workflow-read",
          ttlSeconds: 300,
          resource: {
            teacherId: "teacher-kang",
            courseId: "research-methods",
            pptAssetId: "research-methods-unit-3",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accessPlan).toEqual(
      expect.objectContaining({
        action: "teacher-ppt-workflow-read",
        resource: {
          teacherId: "teacher-kang",
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
        },
      }),
    );

    const downstreamDecision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/teacher-ppt-workflow", {
        headers: body.accessSession.headers,
      }),
      action: "teacher-ppt-workflow-read",
      resource: body.accessPlan.resource,
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      now: stableFutureIssueTime,
    });
    expect(downstreamDecision.reasonCode).toBe("authorized");

    const replayDecision = authorizeUaisAiAccess({
      request: new Request("http://localhost/api/ai/chat", {
        headers: body.accessSession.headers,
      }),
      action: "live-chat",
      resource: {
        teacherId: "teacher-kang",
        courseId: "research-methods",
      },
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      now: stableFutureIssueTime,
    });
    expect(replayDecision).toEqual(
      expect.objectContaining({
        status: "denied",
        action: "live-chat",
        reasonCode: "action-scope-denied",
      }),
    );
    expect(JSON.stringify(body)).not.toContain("session-teacher-kang-workflow-read");
    expectNoCredentialValues(body);
  });

  it("requires teacher authentication before parsing malformed teacher AI session request bodies", async () => {
    let ownershipReads = 0;
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      getAuthenticatedTeacherSession: async () => undefined,
      getTeacherAiResourceOwnership: async () => {
        ownershipReads += 1;
        return {
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
        };
      },
    });

    const response = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        body: "{",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("UAIS teacher authentication is required.");
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "authenticated-session-required",
        responsibleSession: "S12",
      }),
    );
    expect(JSON.stringify(body)).not.toContain("JSON");
    expect(ownershipReads).toBe(0);
    expectNoCredentialValues(body);
  });

  it("issues a signed teacher AI session from a server-signed teacher auth cookie", async () => {
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
      },
      now: stableFutureIssueTime,
      getTeacherAiResourceOwnership: async ({ authenticatedSession }) => ({
        teacherId: authenticatedSession.actorId,
        courseIds: ["research-methods"],
        sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
        pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
        clonedVoiceRefs: [
          {
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            sampleAssetId: "asset-voice-10s",
          },
        ],
      }),
    });
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    const response = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({
          action: "ppt-narration-submit",
          ttlSeconds: 600,
          resource: {
            teacherId: "teacher-kang",
            courseId: "research-methods",
            sampleAssetId: "asset-voice-10s",
            pptAssetId: "research-methods-unit-3",
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accessSession.claims.actor).toEqual({
      actorId: "teacher-kang",
      role: "teacher",
    });
    expect(body.accessSession.claims.expiresAt).toBe("2099-01-01T00:10:00.000Z");
    expect(JSON.stringify(body)).not.toContain(teacherAuthSessionSigningSecret);
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
    expectNoCredentialValues(body);
  });

  it("falls back to the server ownership summary route when external ownership lookup is empty", async () => {
    const externalRequests: string[] = [];
    const summaryRequests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang") {
        externalRequests.push(url);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer secret-external-storage-token-strong-fixture",
        );
        return new Response(null, { status: 404 });
      }
      if (url === "http://localhost/api/ai/teacher-ownership") {
        summaryRequests.push(url);
        expect(new Headers(init?.headers).get("cookie")).toContain(UAIS_TEACHER_AUTH_CLAIMS_COOKIE);
        return Response.json({
          ownership: {
            teacherId: "teacher-kang",
            courseIds: ["elementary-math-research"],
            sampleAssets: [
              {
                sampleAssetId: "teacher-kang-10s-sample",
                courseId: "elementary-math-research",
              },
            ],
            pptAssets: [
              {
                pptAssetId: "kang-xia-ppt-19",
                courseId: "elementary-math-research",
              },
            ],
            clonedVoiceRefs: [
              {
                voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
                sampleAssetId: "teacher-kang-10s-sample",
              },
            ],
            audioManifests: [
              {
                audioManifestId: "audio-manifest-kang-xia-ppt-19",
                courseId: "elementary-math-research",
                pptAssetId: "kang-xia-ppt-19",
                voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
              },
            ],
          },
        });
      }
      return new Response(null, { status: 500 });
    }) as typeof fetch;

    try {
      const postTeacherAiSession = createTeacherAiSessionPostHandler({
        env: {
          UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
          UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
          UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
        },
        now: stableFutureIssueTime,
      });
      const cookie = createUaisTeacherAuthSessionCookieHeader({
        secret: teacherAuthSessionSigningSecret,
        claims: {
          sessionId: "teacher-auth-session-cookie-id",
          actorId: "teacher-kang",
          role: "teacher",
          authenticatedAt: "2098-12-31T23:55:00.000Z",
          expiresAt: "2099-01-01T00:20:00.000Z",
        },
      });

      const response = await postTeacherAiSession(
        new Request("http://localhost/api/ai/session", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({
            action: "ppt-narration-submit",
            ttlSeconds: 600,
            resource: {
              teacherId: "teacher-kang",
              courseId: "elementary-math-research",
              sampleAssetId: "teacher-kang-10s-sample",
              pptAssetId: "kang-xia-ppt-19",
              voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
              audioManifestId: "audio-manifest-kang-xia-ppt-19",
            },
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(externalRequests).toEqual([
        "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang",
      ]);
      expect(summaryRequests).toEqual(["http://localhost/api/ai/teacher-ownership"]);
      expect(body.accessSession.claims.scopes).toEqual({
        teacherIds: ["teacher-kang"],
        courseIds: ["elementary-math-research"],
        sampleAssetIds: ["teacher-kang-10s-sample"],
        pptAssetIds: ["kang-xia-ppt-19"],
        voiceRefIds: ["qwen-voice-ref-teacher-kang-teacher-kang-10s-sample"],
        audioManifestIds: ["audio-manifest-kang-xia-ppt-19"],
      });
      expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
      expect(JSON.stringify(body)).not.toContain("secret-external-storage-token");
      expectNoCredentialValues(body);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns redacted production teacher auth provider proof when issuing a teacher AI session", async () => {
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
      },
      now: stableFutureIssueTime,
      getTeacherAiResourceOwnership: async ({ authenticatedSession }) => ({
        teacherId: authenticatedSession.actorId,
        courseIds: ["research-methods"],
        sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
        pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
        clonedVoiceRefs: [
          {
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            sampleAssetId: "asset-voice-10s",
          },
        ],
      }),
    });
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    const response = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({
          action: "ppt-narration-submit",
          ttlSeconds: 600,
          resource: {
            teacherId: "teacher-kang",
            courseId: "research-methods",
            sampleAssetId: "asset-voice-10s",
            pptAssetId: "research-methods-unit-3",
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authProviderContract).toEqual(
      expect.objectContaining({
        selector: "trusted-cookie-issuer",
        providerKind: "trusted-cookie-issuer",
        adapterStatus: "implemented",
        productionStatus: "ready",
        responsibleSession: "S12",
        redaction: {
          values: "omitted",
          cookies: "omitted",
        },
        secretStrength: {
          minimumLength: 32,
          valuesRedacted: true,
          checks: [
            {
              name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
              status: "sufficient",
              valueRedacted: true,
            },
            {
              name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
              status: "sufficient",
              valueRedacted: true,
            },
          ],
        },
      }),
    );
    expect(JSON.stringify(body)).not.toContain(teacherAuthSessionSigningSecret);
    expect(JSON.stringify(body)).not.toContain(teacherAuthIssuerSecret);
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
    expectNoCredentialValues(body);
  });

  it("blocks production teacher AI session issuance without a production-ready auth provider", async () => {
    let ownershipLookups = 0;
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    for (const scenario of [
      {
        env: {},
        selector: "missing",
        providerKind: "missing",
        blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
      },
      {
        env: { UAIS_TEACHER_AUTH_PROVIDER: "local-signed-cookie" },
        selector: "local-signed-cookie",
        providerKind: "local-signed-cookie",
        blockedReason: "non-production-UAIS_TEACHER_AUTH_PROVIDER",
      },
    ] as const) {
      const postTeacherAiSession = createTeacherAiSessionPostHandler({
        env: {
          NODE_ENV: "production",
          UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
          ...scenario.env,
        },
        now: stableFutureIssueTime,
        getTeacherAiResourceOwnership: async () => {
          ownershipLookups += 1;
          return {
            teacherId: "teacher-kang",
            courseIds: ["research-methods"],
          };
        },
      });

      const response = await postTeacherAiSession(
        new Request("http://localhost/api/ai/session", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({
            action: "live-chat",
            resource: {
              teacherId: "teacher-kang",
              courseId: "research-methods",
            },
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.access).toEqual(
        expect.objectContaining({
          responsibleSession: "S12",
          status: "denied",
          reasonCode: "teacher-auth-provider-not-production-ready",
        }),
      );
      expect(body.authProviderContract).toEqual(
        expect.objectContaining({
          selector: scenario.selector,
          providerKind: scenario.providerKind,
          productionStatus: "blocked",
          blockedReason: scenario.blockedReason,
          redaction: {
            values: "omitted",
            cookies: "omitted",
          },
        }),
      );
      expect(body).not.toHaveProperty("accessSession");
      expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
      expectNoCredentialValues(body);
    }
    expect(ownershipLookups).toBe(0);
  });

  it("treats deployment production markers as production before teacher AI session issuance", async () => {
    for (const scenario of [
      {
        name: "UAIS_DEPLOYMENT_ENV",
        env: {
          NODE_ENV: "development",
          UAIS_DEPLOYMENT_ENV: "production",
        },
      },
      {
        name: "VERCEL_ENV",
        env: {
          NODE_ENV: "development",
          VERCEL_ENV: "production",
        },
      },
    ] as const) {
      let authenticatedSessionReads = 0;
      let ownershipLookups = 0;
      const postTeacherAiSession = createTeacherAiSessionPostHandler({
        env: {
          UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
          ...scenario.env,
        },
        now: stableFutureIssueTime,
        getAuthenticatedTeacherSession: async () => {
          authenticatedSessionReads += 1;
          return {
            sessionId: `teacher-auth-session-${scenario.name}`,
            actorId: "teacher-kang",
            role: "teacher",
            authenticatedAt: "2098-12-31T23:55:00.000Z",
            expiresAt: "2099-01-01T00:20:00.000Z",
          };
        },
        getTeacherAiResourceOwnership: async () => {
          ownershipLookups += 1;
          return {
            teacherId: "teacher-kang",
            courseIds: ["research-methods"],
          };
        },
      });

      const response = await postTeacherAiSession(
        new Request("http://localhost/api/ai/session", {
          method: "POST",
          body: "{",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe("UAIS teacher auth provider is not production-ready.");
      expect(body.access).toEqual(
        expect.objectContaining({
          responsibleSession: "S12",
          status: "denied",
          reasonCode: "teacher-auth-provider-not-production-ready",
        }),
      );
      expect(body.authProviderContract).toEqual(
        expect.objectContaining({
          selector: "missing",
          providerKind: "missing",
          productionStatus: "blocked",
          blockedReason: "missing-UAIS_TEACHER_AUTH_PROVIDER",
        }),
      );
      expect(body).not.toHaveProperty("accessSession");
      expect(JSON.stringify(body)).not.toContain("teacher-auth-session-");
      expect(JSON.stringify(body)).not.toContain("JSON");
      expectNoCredentialValues(body);
      expect(authenticatedSessionReads).toBe(0);
      expect(ownershipLookups).toBe(0);
    }
  });

  it("issues a trusted teacher auth session cookie from signed admin access", async () => {
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
      },
      now: stableFutureIssueTime,
      createSessionId: () => "teacher-auth-session-issuer-cookie-id",
    });
    const trustedIssuerHeaders = createUaisTrustedTeacherAuthIssuerHeaders({
      secret: teacherAuthIssuerSecret,
      teacherId: "teacher-kang",
      now: stableFutureIssueTime,
      ttlSeconds: 300,
    }).headers;

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: {
          ...signedAdminAiAccessHeaders,
          ...trustedIssuerHeaders,
        },
        body: JSON.stringify({
          teacherId: "teacher-kang",
          ttlSeconds: 900,
        }),
      }),
    );
    const body = await response.json();
    const setCookieHeaders = readSetCookieHeaders(response);

    expect(response.status).toBe(200);
    expect(body.teacherAuthSession).toEqual(
      expect.objectContaining({
        responsibleSession: "S12",
        authProvider: "trusted-cookie-issuer",
        authSource: "trusted-cookie-issuer",
        authSessionRef: "server-side-auth-session",
        authenticatedAt: "2099-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:05:00.000Z",
        actor: {
          actorId: "teacher-kang",
          role: "teacher",
        },
        cookieNames: [
          UAIS_TEACHER_AUTH_CLAIMS_COOKIE,
          UAIS_TEACHER_AUTH_SIGNATURE_COOKIE,
        ],
        cookieSecurity: {
          httpOnly: true,
          sameSite: "Lax",
          secure: true,
          path: "/",
          priority: "High",
          maxAgeSeconds: 300,
        },
        redaction: {
          secrets: "omitted",
          cookies: "headers-only",
          sessionIds: "omitted",
        },
      }),
    );
    expect(body.trustedIssuer).toEqual(
      expect.objectContaining({
        status: "authorized",
        reasonCode: "authorized",
        responsibleSession: "S12",
        issuer: expect.objectContaining({
          issuerId: "trusted-cookie-issuer",
          teacherId: "teacher-kang",
          expiresAt: "2099-01-01T00:05:00.000Z",
        }),
      }),
    );
    expect(body.authProviderContract).toEqual(
      expect.objectContaining({
        selector: "trusted-cookie-issuer",
        providerKind: "trusted-cookie-issuer",
        productionStatus: "ready",
      }),
    );
    expect(setCookieHeaders).toHaveLength(2);
    for (const setCookieHeader of setCookieHeaders) {
      expect(setCookieHeader).toContain("Path=/");
      expect(setCookieHeader).toContain("HttpOnly");
      expect(setCookieHeader).toContain("SameSite=Lax");
      expect(setCookieHeader).toContain("Max-Age=300");
      expect(setCookieHeader).toContain("Secure");
      expect(setCookieHeader).toContain("Priority=High");
    }
    expect(setCookieHeaders[0]).toContain(`${UAIS_TEACHER_AUTH_CLAIMS_COOKIE}=`);
    expect(setCookieHeaders[1]).toContain(`${UAIS_TEACHER_AUTH_SIGNATURE_COOKIE}=`);
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-issuer-cookie-id");
    expectNoCredentialValues(body);

    const authenticatedTeacher = readUaisAuthenticatedTeacherSessionFromSignedCookies({
      request: new Request("http://localhost/api/ai/session", {
        headers: {
          cookie: createCookieHeaderFromSetCookies(setCookieHeaders),
        },
      }),
      secret: teacherAuthSessionSigningSecret,
      now: stableFutureIssueTime,
    });
    expect(authenticatedTeacher).toEqual({
      sessionId: "teacher-auth-session-issuer-cookie-id",
      actorId: "teacher-kang",
      role: "teacher",
      authenticatedAt: "2099-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:05:00.000Z",
    });
  });

  it("marks trusted teacher auth cookies secure when deployment markers indicate production", async () => {
    for (const scenario of [
      {
        name: "UAIS_DEPLOYMENT_ENV",
        env: {
          NODE_ENV: "development",
          UAIS_DEPLOYMENT_ENV: "production",
        },
      },
      {
        name: "VERCEL_ENV",
        env: {
          NODE_ENV: "development",
          VERCEL_ENV: "production",
        },
      },
    ] as const) {
      const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
        env: {
          ...scenario.env,
          UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
          UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
          UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
        },
        now: stableFutureIssueTime,
        createSessionId: () => `teacher-auth-session-${scenario.name}`,
      });
      const trustedIssuerHeaders = createUaisTrustedTeacherAuthIssuerHeaders({
        secret: teacherAuthIssuerSecret,
        teacherId: "teacher-kang",
        now: stableFutureIssueTime,
        ttlSeconds: 300,
      }).headers;

      const response = await postTeacherAuthSessionIssue(
        new Request("http://localhost/api/ai/teacher-auth/issue", {
          method: "POST",
          headers: {
            ...signedAdminAiAccessHeaders,
            ...trustedIssuerHeaders,
          },
          body: JSON.stringify({
            teacherId: "teacher-kang",
            ttlSeconds: 900,
          }),
        }),
      );
      const body = await response.json();
      const setCookieHeaders = readSetCookieHeaders(response);

      expect(response.status, scenario.name).toBe(200);
      expect(body.teacherAuthSession.cookieSecurity).toEqual(
        expect.objectContaining({
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
          path: "/",
          priority: "High",
          maxAgeSeconds: 300,
        }),
      );
      expect(setCookieHeaders).toHaveLength(2);
      for (const setCookieHeader of setCookieHeaders) {
        expect(setCookieHeader).toContain("Secure");
        expect(setCookieHeader).toContain("HttpOnly");
        expect(setCookieHeader).toContain("SameSite=Lax");
      }
      expect(JSON.stringify(body)).not.toContain("teacher-auth-session-");
      expectNoCredentialValues(body);
    }
  });

  it("blocks legacy admin scoped headers from issuing trusted teacher auth cookies", async () => {
    const createSessionId = vi.fn(() => "teacher-auth-session-legacy-admin-id");
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
      },
      now: stableFutureIssueTime,
      createSessionId,
    });
    const trustedIssuerHeaders = createUaisTrustedTeacherAuthIssuerHeaders({
      secret: teacherAuthIssuerSecret,
      teacherId: "teacher-kang",
      now: stableFutureIssueTime,
      ttlSeconds: 300,
    }).headers;

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: {
          "x-uais-actor-id": "admin-ai-ops",
          "x-uais-actor-role": "admin",
          ...trustedIssuerHeaders,
        },
        body: JSON.stringify({
          teacherId: "teacher-kang",
          ttlSeconds: 900,
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "teacher-auth-session-issue",
    });
    expect(readSetCookieHeaders(response)).toHaveLength(0);
    expect(createSessionId).not.toHaveBeenCalled();
  });

  it("blocks unsigned trusted teacher auth cookie issuance before parsing malformed bodies", async () => {
    const createSessionId = vi.fn(() => "teacher-auth-session-unsigned-malformed-id");
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
      },
      now: stableFutureIssueTime,
      createSessionId,
    });

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        body: "{",
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "teacher-auth-session-issue",
    });
    expect(readSetCookieHeaders(response)).toHaveLength(0);
    expect(createSessionId).not.toHaveBeenCalled();
  });

  it("uses issued trusted teacher auth cookies to mint a scoped teacher AI session", async () => {
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
      },
      now: stableFutureIssueTime,
      createSessionId: () => "teacher-auth-session-route-chain-id",
    });
    const trustedIssuerHeaders = createUaisTrustedTeacherAuthIssuerHeaders({
      secret: teacherAuthIssuerSecret,
      teacherId: "teacher-kang",
      now: stableFutureIssueTime,
      ttlSeconds: 300,
    }).headers;

    const authResponse = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: {
          ...signedAdminAiAccessHeaders,
          ...trustedIssuerHeaders,
        },
        body: JSON.stringify({
          teacherId: "teacher-kang",
          ttlSeconds: 900,
        }),
      }),
    );
    const authBody = await authResponse.json();
    const issuedCookieHeader = createCookieHeaderFromSetCookies(
      readSetCookieHeaders(authResponse),
    );
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
      },
      now: stableFutureIssueTime,
      getTeacherAiResourceOwnership: async ({ authenticatedSession }) => ({
        teacherId: authenticatedSession.actorId,
        courseIds: ["research-methods"],
        sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
        pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
        clonedVoiceRefs: [
          {
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            sampleAssetId: "asset-voice-10s",
          },
        ],
      }),
    });

    const aiSessionResponse = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: {
          cookie: issuedCookieHeader,
        },
        body: JSON.stringify({
          action: "ppt-narration-submit",
          ttlSeconds: 600,
          resource: {
            teacherId: "teacher-kang",
            courseId: "research-methods",
            sampleAssetId: "asset-voice-10s",
            pptAssetId: "research-methods-unit-3",
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          },
        }),
      }),
    );
    const aiSessionBody = await aiSessionResponse.json();

    expect(authResponse.status).toBe(200);
    expect(authBody.teacherAuthSession).toEqual(
      expect.objectContaining({
        authProvider: "trusted-cookie-issuer",
        authSessionRef: "server-side-auth-session",
      }),
    );
    expect(aiSessionResponse.status).toBe(200);
    expect(aiSessionBody.accessSession.claims.actor).toEqual({
      actorId: "teacher-kang",
      role: "teacher",
    });
    expect(aiSessionBody.accessSession.claims.scopes).toEqual({
      teacherIds: ["teacher-kang"],
      courseIds: ["research-methods"],
      sampleAssetIds: ["asset-voice-10s"],
      pptAssetIds: ["research-methods-unit-3"],
      voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
    });
    expect(aiSessionBody.authProviderContract).toEqual(
      expect.objectContaining({
        selector: "trusted-cookie-issuer",
        providerKind: "trusted-cookie-issuer",
        productionStatus: "ready",
      }),
    );
    expect(JSON.stringify(authBody)).not.toContain("teacher-auth-session-route-chain-id");
    expect(JSON.stringify(aiSessionBody)).not.toContain("teacher-auth-session-route-chain-id");
    expectNoCredentialValues(authBody);
    expectNoCredentialValues(aiSessionBody);
  });

  it("caps trusted teacher auth cookie lifetime to the signed issuer proof expiry", async () => {
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
      },
      now: stableFutureIssueTime,
      createSessionId: () => "teacher-auth-session-issuer-cookie-id",
    });
    const trustedIssuerHeaders = createUaisTrustedTeacherAuthIssuerHeaders({
      secret: teacherAuthIssuerSecret,
      teacherId: "teacher-kang",
      now: stableFutureIssueTime,
      ttlSeconds: 60,
    }).headers;

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: {
          ...signedAdminAiAccessHeaders,
          ...trustedIssuerHeaders,
        },
        body: JSON.stringify({
          teacherId: "teacher-kang",
          ttlSeconds: 900,
        }),
      }),
    );
    const body = await response.json();
    const setCookieHeaders = readSetCookieHeaders(response);

    expect(response.status).toBe(200);
    expect(body.teacherAuthSession).toEqual(
      expect.objectContaining({
        expiresAt: "2099-01-01T00:01:00.000Z",
        cookieSecurity: expect.objectContaining({
          maxAgeSeconds: 60,
        }),
      }),
    );
    expect(body.trustedIssuer).toEqual(
      expect.objectContaining({
        status: "authorized",
        issuer: expect.objectContaining({
          issuerId: "trusted-cookie-issuer",
          teacherId: "teacher-kang",
          expiresAt: "2099-01-01T00:01:00.000Z",
        }),
      }),
    );
    expect(setCookieHeaders).toHaveLength(2);
    for (const setCookieHeader of setCookieHeaders) {
      expect(setCookieHeader).toContain("Max-Age=60");
      expect(setCookieHeader).toContain("HttpOnly");
      expect(setCookieHeader).toContain("SameSite=Lax");
      expect(setCookieHeader).toContain("Secure");
    }

    const authenticatedTeacher = readUaisAuthenticatedTeacherSessionFromSignedCookies({
      request: new Request("http://localhost/api/ai/session", {
        headers: {
          cookie: createCookieHeaderFromSetCookies(setCookieHeaders),
        },
      }),
      secret: teacherAuthSessionSigningSecret,
      now: stableFutureIssueTime,
    });
    expect(authenticatedTeacher).toEqual(
      expect.objectContaining({
        sessionId: "teacher-auth-session-issuer-cookie-id",
        actorId: "teacher-kang",
        expiresAt: "2099-01-01T00:01:00.000Z",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("rejects trusted teacher auth cookie issuance when issuer proof would mint a zero-second session lifetime", async () => {
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
      },
      now: stableFutureIssueTime,
      createSessionId: () => "teacher-auth-zero-ttl-session-id",
    });
    const trustedIssuerHeaders = createTrustedTeacherAuthIssuerHeadersForTest({
      secret: teacherAuthIssuerSecret,
      teacherId: "teacher-kang",
      issuedAt: stableFutureIssueTime.toISOString(),
      expiresAt: "2099-01-01T00:00:00.500Z",
    });

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: {
          ...signedAdminAiAccessHeaders,
          ...trustedIssuerHeaders,
        },
        body: JSON.stringify({
          teacherId: "teacher-kang",
          ttlSeconds: 900,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe(
      "UAIS trusted teacher auth issuer proof cannot mint a positive session lifetime.",
    );
    expect(body.trustedIssuer).toEqual(
      expect.objectContaining({
        status: "authorized",
        reasonCode: "authorized",
        issuer: expect.objectContaining({
          issuerId: "trusted-cookie-issuer",
          teacherId: "teacher-kang",
          expiresAt: "2099-01-01T00:00:00.500Z",
        }),
      }),
    );
    expect(body.progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          responsibleSession: "S12",
          status: "issuer-proof-expiring",
        }),
      ]),
    );
    expect(readSetCookieHeaders(response)).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("teacher-auth-zero-ttl-session-id");
    expectNoCredentialValues(body);
  });

  it("issues a teacher auth session cookie from a verified OIDC JWKS bearer token", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const jwk = publicKey.export({ format: "jwk" });
    const oidcToken = createTestRs256Jwt({
      privateKey,
      kid: "uais-test-oidc-key",
      claims: {
        iss: "https://identity.example.test",
        aud: "uais-teacher-workflow",
        sub: "teacher-kang-subject",
        email: "teacher-kang@example.test",
        iat: 4070908500,
        nbf: 4070908500,
        exp: 4070909520,
      },
    });
    let jwksReads = 0;
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_TEACHER_AUTH_PROVIDER: "oidc-jwks",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_OIDC_ISSUER: "https://identity.example.test",
        UAIS_TEACHER_AUTH_OIDC_AUDIENCE: "uais-teacher-workflow",
        UAIS_TEACHER_AUTH_OIDC_JWKS_URL:
          "https://identity.example.test/.well-known/jwks.json",
        UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM: "email",
      },
      now: stableFutureIssueTime,
      createSessionId: () => "teacher-auth-session-oidc-cookie-id",
      fetchJwks: async (url: string) => {
        jwksReads += 1;
        expect(url).toBe("https://identity.example.test/.well-known/jwks.json");
        return {
          keys: [
            {
              ...jwk,
              kid: "uais-test-oidc-key",
              alg: "RS256",
              use: "sig",
            },
          ],
        };
      },
    });

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: {
          authorization: `Bearer ${oidcToken}`,
        },
        body: JSON.stringify({
          teacherId: "teacher-kang@example.test",
          ttlSeconds: 900,
        }),
      }),
    );
    const body = await response.json();
    const setCookieHeaders = readSetCookieHeaders(response);

    expect(response.status).toBe(200);
    expect(jwksReads).toBe(1);
    expect(body.teacherAuthSession).toEqual(
      expect.objectContaining({
        responsibleSession: "S12",
        authProvider: "oidc-jwks",
        authSource: "oidc-jwks",
        authSessionRef: "server-side-auth-session",
        authenticatedAt: "2099-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:12:00.000Z",
        actor: {
          actorId: "teacher-kang@example.test",
          role: "teacher",
        },
        cookieSecurity: expect.objectContaining({
          httpOnly: true,
          sameSite: "Lax",
          secure: true,
          path: "/",
          priority: "High",
          maxAgeSeconds: 720,
        }),
      }),
    );
    expect(body.oidcIdentity).toEqual(
      expect.objectContaining({
        status: "authorized",
        reasonCode: "authorized",
        responsibleSession: "S12",
        providerKind: "oidc-jwks",
        teacherId: "teacher-kang@example.test",
        teacherIdClaim: "email",
        tokenExpiry: "2099-01-01T00:12:00.000Z",
        redaction: {
          tokens: "omitted",
          jwks: "omitted",
          providerValues: "omitted",
        },
      }),
    );
    expect(setCookieHeaders).toHaveLength(2);
    for (const setCookieHeader of setCookieHeaders) {
      expect(setCookieHeader).toContain("Path=/");
      expect(setCookieHeader).toContain("HttpOnly");
      expect(setCookieHeader).toContain("SameSite=Lax");
      expect(setCookieHeader).toContain("Max-Age=720");
      expect(setCookieHeader).toContain("Secure");
      expect(setCookieHeader).toContain("Priority=High");
    }

    const authenticatedTeacher = readUaisAuthenticatedTeacherSessionFromSignedCookies({
      request: new Request("http://localhost/api/ai/session", {
        headers: {
          cookie: createCookieHeaderFromSetCookies(setCookieHeaders),
        },
      }),
      secret: teacherAuthSessionSigningSecret,
      now: stableFutureIssueTime,
    });
    expect(authenticatedTeacher).toEqual({
      sessionId: "teacher-auth-session-oidc-cookie-id",
      actorId: "teacher-kang@example.test",
      role: "teacher",
      authenticatedAt: "2099-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:12:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain(oidcToken);
    expect(JSON.stringify(body)).not.toContain("identity.example.test");
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-oidc-cookie-id");
    expectNoCredentialValues(body);
  });

  it("requires OIDC bearer auth before parsing malformed teacher auth issue bodies", async () => {
    const createSessionId = vi.fn(() => "teacher-auth-oidc-malformed-body-session-id");
    let jwksReads = 0;
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_TEACHER_AUTH_PROVIDER: "oidc-jwks",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_OIDC_ISSUER: "https://identity.example.test",
        UAIS_TEACHER_AUTH_OIDC_AUDIENCE: "uais-teacher-workflow",
        UAIS_TEACHER_AUTH_OIDC_JWKS_URL:
          "https://identity.example.test/.well-known/jwks.json",
        UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM: "email",
      },
      now: stableFutureIssueTime,
      createSessionId,
      fetchJwks: async () => {
        jwksReads += 1;
        throw new Error("Unauthenticated OIDC requests must not fetch JWKS.");
      },
    });

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        body: "{",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("UAIS OIDC teacher auth bearer token is required.");
    expect(body.oidcIdentity).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "oidc-bearer-token-required",
        responsibleSession: "S12",
        providerKind: "oidc-jwks",
      }),
    );
    expect(JSON.stringify(body)).not.toContain("JSON");
    expect(readSetCookieHeaders(response)).toHaveLength(0);
    expect(createSessionId).not.toHaveBeenCalled();
    expect(jwksReads).toBe(0);
    expectNoCredentialValues(body);
  });

  it("rejects OIDC teacher auth cookie issuance when token expiry would mint a zero-second session lifetime", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const jwk = publicKey.export({ format: "jwk" });
    const nearExpiryIssueTime = new Date("2099-01-01T00:00:00.900Z");
    const oidcToken = createTestRs256Jwt({
      privateKey,
      kid: "uais-test-oidc-key",
      claims: {
        iss: "https://identity.example.test",
        aud: "uais-teacher-workflow",
        sub: "teacher-kang-subject",
        email: "teacher-kang@example.test",
        iat: 4070908500,
        nbf: 4070908500,
        exp: 4070908801,
      },
    });
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_TEACHER_AUTH_PROVIDER: "oidc-jwks",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_OIDC_ISSUER: "https://identity.example.test",
        UAIS_TEACHER_AUTH_OIDC_AUDIENCE: "uais-teacher-workflow",
        UAIS_TEACHER_AUTH_OIDC_JWKS_URL:
          "https://identity.example.test/.well-known/jwks.json",
        UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM: "email",
      },
      now: nearExpiryIssueTime,
      createSessionId: () => "teacher-auth-oidc-zero-ttl-session-id",
      fetchJwks: async () => ({
        keys: [
          {
            ...jwk,
            kid: "uais-test-oidc-key",
            alg: "RS256",
            use: "sig",
          },
        ],
      }),
    });

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: {
          authorization: `Bearer ${oidcToken}`,
        },
        body: JSON.stringify({
          teacherId: "teacher-kang@example.test",
          ttlSeconds: 900,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe(
      "UAIS OIDC teacher auth token cannot mint a positive session lifetime.",
    );
    expect(body.oidcIdentity).toEqual(
      expect.objectContaining({
        status: "authorized",
        reasonCode: "authorized",
        providerKind: "oidc-jwks",
        teacherId: "teacher-kang@example.test",
        tokenExpiry: "2099-01-01T00:00:01.000Z",
      }),
    );
    expect(body.progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          responsibleSession: "S12",
          status: "oidc-token-expiring",
        }),
      ]),
    );
    expect(readSetCookieHeaders(response)).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain(oidcToken);
    expect(JSON.stringify(body)).not.toContain("identity.example.test");
    expect(JSON.stringify(body)).not.toContain("teacher-auth-oidc-zero-ttl-session-id");
    expectNoCredentialValues(body);
  });

  it("rejects OIDC JWKS keys that are not marked for signature verification", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const jwk = publicKey.export({ format: "jwk" });
    const oidcToken = createTestRs256Jwt({
      privateKey,
      kid: "uais-test-oidc-key",
      claims: {
        iss: "https://identity.example.test",
        aud: "uais-teacher-workflow",
        email: "teacher-kang@example.test",
        iat: 4070908500,
        nbf: 4070908500,
        exp: 4070909520,
      },
    });
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_TEACHER_AUTH_PROVIDER: "oidc-jwks",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_OIDC_ISSUER: "https://identity.example.test",
        UAIS_TEACHER_AUTH_OIDC_AUDIENCE: "uais-teacher-workflow",
        UAIS_TEACHER_AUTH_OIDC_JWKS_URL:
          "https://identity.example.test/.well-known/jwks.json",
        UAIS_TEACHER_AUTH_OIDC_TEACHER_ID_CLAIM: "email",
      },
      now: stableFutureIssueTime,
      createSessionId: () => "teacher-auth-session-oidc-cookie-id",
      fetchJwks: async () => ({
        keys: [
          {
            ...jwk,
            kid: "uais-test-oidc-key",
            alg: "RS256",
            use: "enc",
          },
          {
            ...jwk,
            kid: "uais-test-oidc-key",
            alg: "RS256",
            key_ops: ["encrypt"],
          },
        ],
      }),
    });

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: {
          authorization: `Bearer ${oidcToken}`,
        },
        body: JSON.stringify({
          teacherId: "teacher-kang@example.test",
          ttlSeconds: 900,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.oidcIdentity).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "oidc-jwks-key-missing",
        responsibleSession: "S12",
        providerKind: "oidc-jwks",
      }),
    );
    expect(readSetCookieHeaders(response)).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain(oidcToken);
    expect(JSON.stringify(body)).not.toContain("identity.example.test");
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-oidc-cookie-id");
    expectNoCredentialValues(body);
  });

  it("blocks trusted teacher auth cookie issuance without a trusted issuer secret", async () => {
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
      },
      now: stableFutureIssueTime,
      createSessionId: () => "teacher-auth-session-issuer-cookie-id",
    });

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: signedAdminAiAccessHeaders,
        body: JSON.stringify({
          teacherId: "teacher-kang",
          ttlSeconds: 900,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.authProviderContract).toEqual(
      expect.objectContaining({
        selector: "trusted-cookie-issuer",
        providerKind: "trusted-cookie-issuer",
        productionStatus: "blocked",
        blockedReason: "missing-UAIS_TEACHER_AUTH_ISSUER_SECRET",
      }),
    );
    expect(readSetCookieHeaders(response)).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-issuer-cookie-id");
    expect(JSON.stringify(body)).not.toContain(teacherAuthSessionSigningSecret);
    expectNoCredentialValues(body);
  });

  it("rejects trusted teacher auth cookie issuance without signed issuer proof", async () => {
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
      },
      now: stableFutureIssueTime,
      createSessionId: () => "teacher-auth-session-issuer-cookie-id",
    });

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: signedAdminAiAccessHeaders,
        body: JSON.stringify({
          teacherId: "teacher-kang",
          ttlSeconds: 900,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.trustedIssuer).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "trusted-issuer-signature-required",
        responsibleSession: "S12",
      }),
    );
    expect(readSetCookieHeaders(response)).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-issuer-cookie-id");
    expect(JSON.stringify(body)).not.toContain(teacherAuthIssuerSecret);
    expectNoCredentialValues(body);
  });

  it("rejects signed teacher access before issuing trusted teacher auth cookies", async () => {
    const postTeacherAuthSessionIssue = createTeacherAuthSessionIssuePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
      },
      now: stableFutureIssueTime,
      createSessionId: () => "teacher-auth-session-issuer-cookie-id",
    });

    const response = await postTeacherAuthSessionIssue(
      new Request("http://localhost/api/ai/teacher-auth/issue", {
        method: "POST",
        headers: signedTeacherAiAccessHeaders,
        body: JSON.stringify({
          teacherId: "teacher-kang",
          ttlSeconds: 900,
        }),
      }),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "admin-role-required",
        action: "teacher-auth-session-issue",
        responsibleSession: "S12",
      }),
    );
    expect(readSetCookieHeaders(response)).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-issuer-cookie-id");
    expectNoCredentialValues(body);
  });

  it("issues a signed teacher AI session from a server-side ownership registry record", async () => {
    const ownershipBaseDir = await mkdtemp(join(tmpdir(), "uais-teacher-ownership-"));
    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipBaseDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
          sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
          pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
          clonedVoiceRefs: [
            {
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
              sampleAssetId: "asset-voice-10s",
            },
          ],
          audioManifests: [
            {
              audioManifestId: "audio-manifest-research-methods-unit-3",
              courseId: "research-methods",
              pptAssetId: "research-methods-unit-3",
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            },
          ],
        },
      });
      const postTeacherAiSession = createTeacherAiSessionPostHandler({
        env: {
          UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipBaseDir,
        },
        now: stableFutureIssueTime,
      });
      const cookie = createUaisTeacherAuthSessionCookieHeader({
        secret: teacherAuthSessionSigningSecret,
        claims: {
          sessionId: "teacher-auth-session-cookie-id",
          actorId: "teacher-kang",
          role: "teacher",
          authenticatedAt: "2098-12-31T23:55:00.000Z",
          expiresAt: "2099-01-01T00:20:00.000Z",
        },
      });

      const response = await postTeacherAiSession(
        new Request("http://localhost/api/ai/session", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({
            action: "ppt-narration-submit",
            ttlSeconds: 600,
            resource: {
              teacherId: "teacher-kang",
              courseId: "research-methods",
              sampleAssetId: "asset-voice-10s",
              pptAssetId: "research-methods-unit-3",
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            },
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.accessSession.claims.scopes).toEqual({
        teacherIds: ["teacher-kang"],
        courseIds: ["research-methods"],
        sampleAssetIds: ["asset-voice-10s"],
        pptAssetIds: ["research-methods-unit-3"],
        voiceRefIds: ["qwen-voice-ref-teacher-kang-asset-voice-10s"],
      });
      expect(body.accessPlan).not.toHaveProperty("grants");
      expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
      expectNoCredentialValues(body);
      expect(JSON.stringify(body)).not.toContain(ownershipBaseDir);
    } finally {
      await rm(ownershipBaseDir, { recursive: true, force: true });
    }
  });

  it("rejects tampered or expired server-signed teacher auth cookies before ownership lookup", async () => {
    let ownershipLookups = 0;
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
      },
      now: stableFutureIssueTime,
      getTeacherAiResourceOwnership: async () => {
        ownershipLookups += 1;
        return { teacherId: "teacher-kang" };
      },
    });
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    const tamperedResponse = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { cookie: cookie.replace(/.$/, "x") },
        body: JSON.stringify({
          action: "voice-clone-revoke",
          resource: {
            teacherId: "teacher-kang",
            voiceRefId: "qwen-voice-ref-owned",
          },
        }),
      }),
    );
    const tamperedBody = await tamperedResponse.json();
    expect(tamperedResponse.status).toBe(401);
    expect(tamperedBody.access.reasonCode).toBe("authenticated-session-required");

    const expiredCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2098-12-31T23:59:00.000Z",
      },
    });
    const expiredResponse = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { cookie: expiredCookie },
        body: JSON.stringify({
          action: "voice-clone-revoke",
          resource: {
            teacherId: "teacher-kang",
            voiceRefId: "qwen-voice-ref-owned",
          },
        }),
      }),
    );
    const expiredBody = await expiredResponse.json();
    expect(expiredResponse.status).toBe(401);
    expect(expiredBody.access.reasonCode).toBe("authenticated-session-required");
    expect(ownershipLookups).toBe(0);
  });

  it("rejects unsafe signed teacher auth actor ids before ownership lookup", async () => {
    let ownershipLookups = 0;
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
      },
      now: stableFutureIssueTime,
      getTeacherAiResourceOwnership: async ({ authenticatedSession }) => {
        ownershipLookups += 1;
        return {
          teacherId: authenticatedSession.actorId,
          clonedVoiceRefs: [{ voiceRefId: "qwen-voice-ref-owned" }],
        };
      },
    });
    const unsafeActorCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "/Users/example/teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    const response = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { cookie: unsafeActorCookie },
        body: JSON.stringify({
          action: "voice-clone-revoke",
          resource: {
            teacherId: "/Users/example/teacher-kang",
            voiceRefId: "qwen-voice-ref-owned",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.access.reasonCode).toBe("authenticated-session-required");
    expect(ownershipLookups).toBe(0);
    expect(JSON.stringify(body)).not.toContain("/Users/example/teacher-kang");
  });

  it("rejects unsafe signed teacher auth session ids before ownership lookup", async () => {
    let ownershipLookups = 0;
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
      },
      now: stableFutureIssueTime,
      getTeacherAiResourceOwnership: async ({ authenticatedSession }) => {
        ownershipLookups += 1;
        return {
          teacherId: authenticatedSession.actorId,
          clonedVoiceRefs: [{ voiceRefId: "qwen-voice-ref-owned" }],
        };
      },
    });
    const unsafeSessionCookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "/Users/example/teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    const response = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        headers: { cookie: unsafeSessionCookie },
        body: JSON.stringify({
          action: "voice-clone-revoke",
          resource: {
            teacherId: "teacher-kang",
            voiceRefId: "qwen-voice-ref-owned",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.access.reasonCode).toBe("authenticated-session-required");
    expect(ownershipLookups).toBe(0);
    expect(JSON.stringify(body)).not.toContain("/Users/example/teacher-auth-session-cookie-id");
  });

  it("rejects signed teacher AI session issuance for unowned workflow resources", async () => {
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      now: stableFutureIssueTime,
      getAuthenticatedTeacherSession: async () => ({
        sessionId: "session-teacher-kang-real-store",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      }),
      getTeacherAiResourceOwnership: async () => ({
        teacherId: "teacher-kang",
        courseIds: ["research-methods"],
        sampleAssets: [{ sampleAssetId: "asset-voice-10s" }],
        clonedVoiceRefs: [{ voiceRefId: "qwen-voice-ref-owned", sampleAssetId: "asset-voice-10s" }],
      }),
    });

    const response = await postTeacherAiSession(
      new Request("http://localhost/api/ai/session", {
        method: "POST",
        body: JSON.stringify({
          action: "voice-clone-revoke",
          resource: {
            teacherId: "teacher-kang",
            sampleAssetId: "asset-voice-10s",
            voiceRefId: "qwen-voice-ref-other",
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("UAIS teacher AI session request is not authorized.");
    expect(body.access).toEqual(
      expect.objectContaining({
        responsibleSession: "S12",
        status: "denied",
        reasonCode: "teacher-resource-not-granted",
      }),
    );
    expect(body).not.toHaveProperty("accessSession");
    expectNoCredentialValues(body);
  });

  it("does not trust client-supplied ownership when no server ownership record exists", async () => {
    const ownershipBaseDir = await mkdtemp(join(tmpdir(), "uais-empty-teacher-ownership-"));
    const postTeacherAiSession = createTeacherAiSessionPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipBaseDir,
      },
      now: stableFutureIssueTime,
    });
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    try {
      const response = await postTeacherAiSession(
        new Request("http://localhost/api/ai/session", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({
            action: "voice-clone-revoke",
            authenticatedSession: {
              sessionId: "client-supplied-session",
              actorId: "teacher-kang",
            },
            ownership: {
              teacherId: "teacher-kang",
              clonedVoiceRefs: [{ voiceRefId: "client-supplied-voice-ref" }],
            },
            resource: {
              teacherId: "teacher-kang",
              voiceRefId: "client-supplied-voice-ref",
            },
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe("UAIS teacher AI ownership record is required.");
      expect(body.access).toEqual(
        expect.objectContaining({
          responsibleSession: "S12",
          status: "denied",
          reasonCode: "teacher-ownership-required",
        }),
      );
      expect(JSON.stringify(body)).not.toContain("client-supplied-session");
      expect(JSON.stringify(body)).not.toContain("client-supplied-voice-ref");
      expect(JSON.stringify(body)).not.toContain(ownershipBaseDir);
      expect(body).not.toHaveProperty("accessSession");
      expectNoCredentialValues(body);
    } finally {
      await rm(ownershipBaseDir, { recursive: true, force: true });
    }
  });

  it("returns a redacted teacher AI ownership summary from the signed teacher auth cookie", async () => {
    const ownershipBaseDir = await mkdtemp(join(tmpdir(), "uais-teacher-ownership-summary-"));
    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipBaseDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
          sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
          pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
          clonedVoiceRefs: [
            {
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
              sampleAssetId: "asset-voice-10s",
            },
          ],
          audioManifests: [
            {
              audioManifestId: "audio-manifest-research-methods-unit-3",
              courseId: "research-methods",
              pptAssetId: "research-methods-unit-3",
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            },
          ],
        },
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipBaseDir,
        ownership: {
          teacherId: "teacher-other",
          courseIds: ["private-other-course"],
        },
      });
      const getOwnership = createTeacherAiOwnershipGetHandler({
        env: {
          UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipBaseDir,
        },
        now: stableFutureIssueTime,
      });
      const cookie = createUaisTeacherAuthSessionCookieHeader({
        secret: teacherAuthSessionSigningSecret,
        claims: {
          sessionId: "teacher-auth-session-cookie-id",
          actorId: "teacher-kang",
          role: "teacher",
          authenticatedAt: "2098-12-31T23:55:00.000Z",
          expiresAt: "2099-01-01T00:20:00.000Z",
        },
      });

      const response = await getOwnership(
        new Request("http://localhost/api/ai/teacher-ownership?teacherId=teacher-other", {
          headers: { cookie },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ownership).toEqual({
        teacherId: "teacher-kang",
        courseIds: ["research-methods"],
        sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
        pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
        clonedVoiceRefs: [
          {
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            sampleAssetId: "asset-voice-10s",
          },
        ],
        audioManifests: [
          {
            audioManifestId: "audio-manifest-research-methods-unit-3",
            courseId: "research-methods",
            pptAssetId: "research-methods-unit-3",
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          },
        ],
        storagePolicy: "server-side-redacted-teacher-ai-ownership-summary",
        responsibleSession: "S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(body.consistency).toEqual({
        responsibleSession: "S12/S24",
        status: "ready",
        recordCounts: {
          courseIds: 1,
          sampleAssets: 1,
          pptAssets: 1,
          clonedVoiceRefs: 1,
          audioManifests: 1,
        },
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: "audio-manifests-voice-links",
            status: "ready",
            missingReferences: [],
          }),
        ]),
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(body.progress).toEqual([
        expect.objectContaining({
          responsibleSession: "S12",
          progressText: expect.stringContaining("S12 Backend/API Platform"),
        }),
        expect.objectContaining({
          responsibleSession: "S24",
          progressText: expect.stringContaining("S24 Asset and Export Quality"),
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
      expect(JSON.stringify(body)).not.toContain("private-other-course");
      expect(JSON.stringify(body)).not.toContain(ownershipBaseDir);
      expectNoCredentialValues(body);
    } finally {
      await rm(ownershipBaseDir, { recursive: true, force: true });
    }
  });

  it("returns a redacted teacher AI ownership summary from the external durable storage backend", async () => {
    const externalRequests: Array<{ url: string; authorization?: string | null }> = [];
    const getOwnership = createTeacherAiOwnershipGetHandler({
      env: {
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
      },
      now: stableFutureIssueTime,
      fetch: async (input, init) => {
        externalRequests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
          sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
          pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
          clonedVoiceRefs: [
            {
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
              sampleAssetId: "asset-voice-10s",
            },
          ],
          audioManifests: [
            {
              audioManifestId: "audio-manifest-research-methods-unit-3",
              courseId: "research-methods",
              pptAssetId: "research-methods-unit-3",
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            },
          ],
        });
      },
    });
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    const response = await getOwnership(
      new Request("http://localhost/api/ai/teacher-ownership?teacherId=teacher-other", {
        headers: { cookie },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(externalRequests).toEqual([
      {
        url: "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang",
        authorization: "Bearer secret-external-storage-token-strong-fixture",
      },
    ]);
    expect(body.ownership).toEqual(
      expect.objectContaining({
        teacherId: "teacher-kang",
        courseIds: ["research-methods"],
        storagePolicy: "server-side-redacted-teacher-ai-ownership-summary",
        responsibleSession: "S12",
      }),
    );
    expect(body.consistency).toEqual(
      expect.objectContaining({
        responsibleSession: "S12/S24",
        status: "ready",
      }),
    );
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
    expect(JSON.stringify(body)).not.toContain("teacher-other");
    expect(JSON.stringify(body)).not.toContain("storage.example.test");
    expect(JSON.stringify(body)).not.toContain("secret-external-storage-token");
    expectNoCredentialValues(body);
  });

  it("rejects teacher AI ownership reads without valid signed teacher auth before reading records", async () => {
    let ownershipReads = 0;
    const getOwnership = createTeacherAiOwnershipGetHandler({
      env: {
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
      },
      now: stableFutureIssueTime,
      readTeacherAiOwnership: async () => {
        ownershipReads += 1;
        return { teacherId: "teacher-kang" };
      },
    });

    const response = await getOwnership(
      new Request("http://localhost/api/ai/teacher-ownership"),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.access).toEqual(
      expect.objectContaining({
        responsibleSession: "S12",
        status: "denied",
        reasonCode: "authenticated-session-required",
      }),
    );
    expect(ownershipReads).toBe(0);
    expectNoCredentialValues(body);
  });

  it("returns a redacted teacher PPT narration workflow from signed teacher auth and ownership", async () => {
    const ownershipBaseDir = await mkdtemp(join(tmpdir(), "uais-teacher-ppt-workflow-"));
    try {
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipBaseDir,
        ownership: {
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
          sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
          pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
          clonedVoiceRefs: [
            {
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
              sampleAssetId: "asset-voice-10s",
            },
          ],
          audioManifests: [
            {
              audioManifestId: "audio-manifest-research-methods-unit-3",
              courseId: "research-methods",
              pptAssetId: "research-methods-unit-3",
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            },
          ],
        },
      });
      await storeUaisTeacherAiOwnershipRecord({
        baseDir: ownershipBaseDir,
        ownership: {
          teacherId: "teacher-other",
          courseIds: ["private-other-course"],
          clonedVoiceRefs: [{ voiceRefId: "private-other-voice-ref" }],
        },
      });
      const getWorkflow = createTeacherPptWorkflowGetHandler({
        env: {
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipBaseDir,
          DASHSCOPE_API_KEY: "secret-qwen",
        },
        now: stableFutureIssueTime,
      });
      const cookie = createUaisTeacherAuthSessionCookieHeader({
        secret: teacherAuthSessionSigningSecret,
        claims: {
          sessionId: "teacher-auth-session-cookie-id",
          actorId: "teacher-kang",
          role: "teacher",
          authenticatedAt: "2098-12-31T23:55:00.000Z",
          expiresAt: "2099-01-01T00:20:00.000Z",
        },
      });

      const response = await getWorkflow(
        new Request(
          "http://localhost/api/ai/teacher-ppt-workflow?teacherId=teacher-other&courseId=research-methods&pptAssetId=research-methods-unit-3",
          { headers: { cookie, ...signedTeacherAiAccessHeaders } },
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.workflow).toEqual(
        expect.objectContaining({
          teacherId: "teacher-kang",
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          status: "ready-for-downloads",
          nextAction: "review-and-download-ppt-narration",
          storagePolicy: "server-side-redacted-teacher-ppt-workflow-status",
          responsibleSession: "S12/S24",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(body.workflow.steps).toEqual([
        expect.objectContaining({
          id: "voice-sample",
          status: "ready",
          responsibleSession: "S24",
          sampleAssetId: "asset-voice-10s",
        }),
        expect.objectContaining({
          id: "voice-clone",
          status: "ready",
          responsibleSession: "S07",
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        }),
        expect.objectContaining({
          id: "ppt-material",
          status: "ready",
          responsibleSession: "S24",
          pptAssetId: "research-methods-unit-3",
        }),
        expect.objectContaining({
          id: "ppt-narration",
          status: "ready",
          responsibleSession: "S24",
          audioManifestId: "audio-manifest-research-methods-unit-3",
        }),
      ]);
      expect(body.workflow.downloads).toEqual({
        audioManifestId: "audio-manifest-research-methods-unit-3",
        exportDownloadUrl: "/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
        audioDownloadPattern:
          "/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/{audioId}",
      });
      expect(body.agentHandoffPlan).toEqual(
        expect.objectContaining({
          framework: "openmaic-style-teacher-ppt-narration",
          status: "ready-for-teacher-review",
          responsibleSession: "S07/S12/S19/S24/S22",
          graphValidation: expect.objectContaining({
            graphId: "teacher-ppt-narration",
            status: "valid",
            responsibleSession: "S07",
            nodeCount: 7,
            edgeCount: 8,
            topologicalOrder: [
              "s12-auth-ownership-agent",
              "s24-voice-sample-agent",
              "s07-qwen-voice-clone-agent",
              "s24-ppt-material-agent",
              "s19-qwen-provider-agent",
              "s24-ppt-narration-agent",
              "s22-release-smoke-agent",
            ],
          }),
          nextAgent: expect.objectContaining({
            agentId: "s24-export-quality-agent",
            responsibleSession: "S24",
            action: "review-and-download-ppt-narration",
          }),
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        }),
      );
      expect(body.agentHandoffPlan.handoffs).toEqual([
        expect.objectContaining({
          index: 0,
          agentId: "s12-auth-ownership-agent",
          responsibleSession: "S12",
          status: "completed",
          action: "verify-signed-teacher-auth-and-ownership",
          dependsOn: [],
        }),
        expect.objectContaining({
          index: 1,
          agentId: "s24-voice-sample-agent",
          responsibleSession: "S24",
          status: "completed",
          action: "verify-consented-voice-sample",
          dependsOn: ["s12-auth-ownership-agent"],
        }),
        expect.objectContaining({
          index: 2,
          agentId: "s07-qwen-voice-clone-agent",
          responsibleSession: "S07",
          status: "completed",
          action: "verify-qwen-voice-reference",
          dependsOn: ["s24-voice-sample-agent"],
        }),
        expect.objectContaining({
          index: 3,
          agentId: "s24-ppt-material-agent",
          responsibleSession: "S24",
          status: "completed",
          action: "verify-ppt-material",
          dependsOn: ["s12-auth-ownership-agent"],
        }),
        expect.objectContaining({
          index: 4,
          agentId: "s19-qwen-provider-agent",
          responsibleSession: "S19",
          status: "completed",
          action: "verify-qwen-provider-env",
          dependsOn: ["s12-auth-ownership-agent"],
        }),
        expect.objectContaining({
          index: 5,
          agentId: "s24-ppt-narration-agent",
          responsibleSession: "S24",
          status: "completed",
          action: "verify-ppt-narration-assets",
          dependsOn: [
            "s07-qwen-voice-clone-agent",
            "s24-ppt-material-agent",
            "s19-qwen-provider-agent",
          ],
        }),
        expect.objectContaining({
          index: 6,
          agentId: "s22-release-smoke-agent",
          responsibleSession: "S22",
          status: "pending",
          action: "verify-deployed-teacher-workflow-route",
          dependsOn: ["s24-ppt-narration-agent"],
        }),
      ]);
      expect(body.progress).toEqual([
        expect.objectContaining({
          responsibleSession: "S12",
          progressText: expect.stringContaining("S12 Backend/API Platform"),
        }),
        expect.objectContaining({
          responsibleSession: "S24",
          progressText: expect.stringContaining("S24 Asset and Export Quality"),
        }),
        expect.objectContaining({
          responsibleSession: "S07",
          progressText: expect.stringContaining("S07 AI Agent Model"),
        }),
        expect.objectContaining({
          responsibleSession: "S19",
          progressText: expect.stringContaining("S19 API Configuration"),
        }),
        expect.objectContaining({
          responsibleSession: "S22",
          progressText: expect.stringContaining("S22 Build Quality"),
        }),
      ]);
      expect(JSON.stringify(body.agentHandoffPlan)).not.toContain("secret-qwen");
      expect(JSON.stringify(body.agentHandoffPlan)).not.toContain(ownershipBaseDir);
      expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
      expect(JSON.stringify(body)).not.toContain("private-other-course");
      expect(JSON.stringify(body)).not.toContain("private-other-voice-ref");
      expect(JSON.stringify(body)).not.toContain(ownershipBaseDir);
      expectNoCredentialValues(body);
    } finally {
      await rm(ownershipBaseDir, { recursive: true, force: true });
    }
  });

  it("returns teacher PPT workflow downloads from the external durable storage ownership backend", async () => {
    const externalRequests: Array<{ url: string; authorization?: string | null }> = [];
    const workflowDeps = {
      env: {
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      now: stableFutureIssueTime,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        externalRequests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["research-methods"],
          sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
          pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
          clonedVoiceRefs: [
            {
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
              sampleAssetId: "asset-voice-10s",
            },
          ],
          audioManifests: [
            {
              audioManifestId: "audio-manifest-research-methods-unit-3",
              courseId: "research-methods",
              pptAssetId: "research-methods-unit-3",
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            },
          ],
        });
      },
    };
    const getWorkflow = createTeacherPptWorkflowGetHandler(workflowDeps);
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    const response = await getWorkflow(
      new Request(
        "http://localhost/api/ai/teacher-ppt-workflow?teacherId=teacher-other&courseId=research-methods&pptAssetId=research-methods-unit-3",
        { headers: { cookie, ...signedTeacherAiAccessHeaders } },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(externalRequests).toEqual([
      {
        url: "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang",
        authorization: "Bearer secret-external-storage-token-strong-fixture",
      },
    ]);
    expect(body.workflow).toEqual(
      expect.objectContaining({
        teacherId: "teacher-kang",
        courseId: "research-methods",
        pptAssetId: "research-methods-unit-3",
        status: "ready-for-downloads",
        nextAction: "review-and-download-ppt-narration",
      }),
    );
    expect(body.workflow.downloads).toEqual({
      audioManifestId: "audio-manifest-research-methods-unit-3",
      exportDownloadUrl: "/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
      audioDownloadPattern:
        "/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/{audioId}",
    });
    expect(body.agentHandoffPlan).toEqual(
      expect.objectContaining({
        framework: "openmaic-style-teacher-ppt-narration",
        status: "ready-for-teacher-review",
        nextAgent: expect.objectContaining({
          agentId: "s24-export-quality-agent",
          action: "review-and-download-ppt-narration",
        }),
      }),
    );
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
    expect(JSON.stringify(body)).not.toContain("teacher-other");
    expect(JSON.stringify(body)).not.toContain("storage.example.test");
    expect(JSON.stringify(body)).not.toContain("secret-external-storage-token");
    expectNoCredentialValues(body);
  });

  it("selects a complete teacher PPT workflow chain when partial external ownership records come first", async () => {
    const externalRequests: Array<{ url: string; authorization?: string | null }> = [];
    const getWorkflow = createTeacherPptWorkflowGetHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test/uais",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "secret-external-storage-token-strong-fixture",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      now: stableFutureIssueTime,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        externalRequests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({
          teacherId: "teacher-kang",
          courseIds: ["partial-course", "elementary-math-research"],
          sampleAssets: [
            { sampleAssetId: "partial-sample", courseId: "partial-course" },
            {
              sampleAssetId: "teacher-kang-10s-sample",
              courseId: "elementary-math-research",
            },
          ],
          pptAssets: [
            { pptAssetId: "partial-ppt", courseId: "partial-course" },
            { pptAssetId: "kang-xia-ppt-19", courseId: "elementary-math-research" },
          ],
          clonedVoiceRefs: [
            {
              voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
              sampleAssetId: "teacher-kang-10s-sample",
            },
          ],
          audioManifests: [
            {
              audioManifestId: "audio-manifest-kang-xia-ppt-19",
              courseId: "elementary-math-research",
              pptAssetId: "kang-xia-ppt-19",
              voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
            },
          ],
        });
      },
    });
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    const response = await getWorkflow(
      new Request("http://localhost/api/ai/teacher-ppt-workflow", {
        headers: { cookie, ...signedTeacherAiAccessHeaders },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(externalRequests).toEqual([
      {
        url: "https://storage.example.test/uais/teacher-ai-ownership/teacher-kang",
        authorization: "Bearer secret-external-storage-token-strong-fixture",
      },
    ]);
    expect(body.workflow).toEqual(
      expect.objectContaining({
        teacherId: "teacher-kang",
        courseId: "elementary-math-research",
        pptAssetId: "kang-xia-ppt-19",
        status: "ready-for-downloads",
        nextAction: "review-and-download-ppt-narration",
      }),
    );
    expect(body.workflow.steps).toEqual([
      expect.objectContaining({
        id: "voice-sample",
        status: "ready",
        sampleAssetId: "teacher-kang-10s-sample",
      }),
      expect.objectContaining({
        id: "voice-clone",
        status: "ready",
        voiceRefId: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
      }),
      expect.objectContaining({
        id: "ppt-material",
        status: "ready",
        pptAssetId: "kang-xia-ppt-19",
      }),
      expect.objectContaining({
        id: "ppt-narration",
        status: "ready",
        audioManifestId: "audio-manifest-kang-xia-ppt-19",
      }),
    ]);
    expect(body.workflow.downloads).toEqual({
      audioManifestId: "audio-manifest-kang-xia-ppt-19",
      exportDownloadUrl: "/api/ai/ppt-narration/export/audio-manifest-kang-xia-ppt-19",
      audioDownloadPattern:
        "/api/ai/ppt-narration/audio/audio-manifest-kang-xia-ppt-19/{audioId}",
    });
    expect(JSON.stringify(body)).not.toContain("partial-course");
    expect(JSON.stringify(body)).not.toContain("partial-sample");
    expect(JSON.stringify(body)).not.toContain("partial-ppt");
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
    expectNoCredentialValues(body);
  });

  it("keeps teacher PPT workflow closed without signed teacher auth before reading ownership", async () => {
    let ownershipReads = 0;
    const getWorkflow = createTeacherPptWorkflowGetHandler({
      env: {
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
      },
      now: stableFutureIssueTime,
      readTeacherAiOwnership: async () => {
        ownershipReads += 1;
        return { teacherId: "teacher-kang" };
      },
    });

    const response = await getWorkflow(
      new Request("http://localhost/api/ai/teacher-ppt-workflow"),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(ownershipReads).toBe(0);
    expect(body.access).toEqual(
      expect.objectContaining({
        responsibleSession: "S12",
        status: "denied",
        reasonCode: "authenticated-session-required",
      }),
    );
    expect(body.progress).toEqual([
      expect.objectContaining({
        responsibleSession: "S12",
        progressText: expect.stringContaining("S12 Backend/API Platform"),
      }),
      expect.objectContaining({
        responsibleSession: "S24",
        progressText: expect.stringContaining("S24 Asset and Export Quality"),
      }),
    ]);
    expectNoCredentialValues(body);
  });

  it("keeps teacher PPT workflow closed without a signed AI access session before reading ownership", async () => {
    let ownershipReads = 0;
    const getWorkflow = createTeacherPptWorkflowGetHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
      },
      now: stableFutureIssueTime,
      readTeacherAiOwnership: async () => {
        ownershipReads += 1;
        return { teacherId: "teacher-kang" };
      },
    });
    const cookie = createUaisTeacherAuthSessionCookieHeader({
      secret: teacherAuthSessionSigningSecret,
      claims: {
        sessionId: "teacher-auth-session-cookie-id",
        actorId: "teacher-kang",
        role: "teacher",
        authenticatedAt: "2098-12-31T23:55:00.000Z",
        expiresAt: "2099-01-01T00:20:00.000Z",
      },
    });

    const response = await getWorkflow(
      new Request("http://localhost/api/ai/teacher-ppt-workflow", {
        headers: { cookie },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(ownershipReads).toBe(0);
    expect(body.access).toEqual(
      expect.objectContaining({
        responsibleSession: "S12",
        status: "denied",
        action: "teacher-ppt-workflow-read",
        reasonCode: "signed-session-required",
      }),
    );
    expect(JSON.stringify(body)).not.toContain("teacher-auth-session-cookie-id");
    expectNoCredentialValues(body);
  });

  it("allows production provider smoke plan for admin actors without leaking secrets", async () => {
    const getProductionSmokePlan = createSmokePlanGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    const response = await getProductionSmokePlan(
      new Request("http://localhost/api/ai/smoke-plan", {
        headers: signedAdminAiAccessHeaders,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe("dry-run");
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "deepseek", status: "present" }),
        expect.objectContaining({ provider: "qwen", status: "present" }),
      ]),
    );
    expectNoCredentialValues(body);
  });

  it("returns a production live-AI deployment gate for admin readiness checks", async () => {
    const getProductionReadiness = createReadinessGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherAuthSessionSigningSecret,
        UAIS_TEACHER_AUTH_ISSUER_SECRET: teacherAuthIssuerSecret,
        UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "durable",
        UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND: "durable",
        DEEPSEEK_API_KEY: "secret-deepseek",
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    const response = await getProductionReadiness(
      new Request("http://localhost/api/ai/readiness", {
        headers: signedAdminAiAccessHeaders,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deploymentGate).toEqual(
      expect.objectContaining({
        target: "vercel",
        status: "blocked",
        responsibleSession: "S19",
        blockedReasons: [
          "unsupported-UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
          "unsupported-UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
        ],
      }),
    );
    expect(body.deploymentGate.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s19-live-approval-token",
          responsibleSession: "S19",
          status: "ready",
        }),
        expect.objectContaining({
          id: "s19-ai-access-signing-secret",
          responsibleSession: "S19",
          status: "ready",
        }),
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          responsibleSession: "S12",
          status: "ready",
          authProviderContract: expect.objectContaining({
            selector: "trusted-cookie-issuer",
            providerKind: "trusted-cookie-issuer",
            productionStatus: "ready",
          }),
        }),
        expect.objectContaining({
          id: "s19-teacher-auth-session-signing-secret",
          responsibleSession: "S19",
          status: "ready",
        }),
        expect.objectContaining({
          id: "s19-deepseek-env",
          responsibleSession: "S19",
          status: "ready",
        }),
        expect.objectContaining({
          id: "s19-qwen-env",
          responsibleSession: "S19",
          status: "ready",
        }),
        expect.objectContaining({
          id: "s12-teacher-ownership-backend",
          responsibleSession: "S12",
          status: "blocked",
          backendContract: expect.objectContaining({
            selector: "durable",
            durability: "unknown",
            adapterStatus: "unsupported",
            productionStatus: "blocked",
          }),
        }),
        expect.objectContaining({
          id: "s24-voice-lifecycle-audit-backend",
          responsibleSession: "S24",
          status: "blocked",
          backendContract: expect.objectContaining({
            selector: "durable",
            durability: "unknown",
            adapterStatus: "unsupported",
            productionStatus: "blocked",
          }),
        }),
      ]),
    );
    expect(body.deploymentRouteSmokeGate).toEqual(
      expect.objectContaining({
        target: "deployment-route-smoke",
        status: "blocked",
        responsibleSession: "S22",
        blockedReasons: ["missing-UAIS_DEPLOYMENT_BASE_URL"],
      }),
    );
    expect(body.deploymentRouteSmokeGate.prerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-deployment-base-url",
          responsibleSession: "S22",
          requiredEnv: "UAIS_DEPLOYMENT_BASE_URL",
          status: "missing",
        }),
        expect.objectContaining({
          id: "s19-ai-access-signing-secret",
          responsibleSession: "S19",
          requiredEnv: "UAIS_AI_ACCESS_SIGNING_SECRET",
          status: "present",
        }),
        expect.objectContaining({
          id: "s12-teacher-auth-provider",
          responsibleSession: "S12",
          requiredEnv: "UAIS_TEACHER_AUTH_PROVIDER",
          status: "present",
        }),
        expect.objectContaining({
          id: "s19-teacher-auth-session-signing-secret",
          responsibleSession: "S19",
          requiredEnv: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          status: "present",
        }),
      ]),
    );
    expect(body.deploymentRouteSmokeGate.routeChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s22-teacher-ppt-workflow-route",
          route: "/api/ai/teacher-ppt-workflow",
          responsibleSessions: ["S22", "S12", "S24", "S19"],
          responseShapeChecks: [
            "workflow",
            "workflowReadyForDownloads",
            "workflowDownloadContract",
            "workflowAudioDownloadPattern",
            "workflowExportDownloadUrl",
            "agentHandoffPlan",
            "agentHandoffPlanFramework",
            "s22ReleaseSmokeAgent",
          ],
        }),
      ]),
    );
    expectNoCredentialValues(body);
  });

  it("returns the redacted Qwen voice lifecycle audit index only for signed admin access", async () => {
    const getLifecycleAudit = createVoiceLifecycleAuditGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      listVoiceLifecycleAuditEvents: async () => ({
        provider: "qwen",
        providerRole: "voice-clone",
        eventType: "qwen-voice-lifecycle",
        storagePolicy: "append-only-redacted-lifecycle-audit",
        recordCount: 1,
        events: [
          {
            eventId: "qwen-voice-lifecycle-qwen-voice-ref-teacher-kang-asset-voice-10s-20260617",
            eventType: "qwen-voice-lifecycle",
            provider: "qwen",
            providerRole: "voice-clone",
            action: "voice-clone-revoke",
            status: "recorded",
            occurredAt: "2026-06-17T00:00:00.000Z",
            actor: {
              actorId: "teacher-kang",
              role: "teacher",
            },
            resource: {
              teacherId: "teacher-kang",
              sampleAssetId: "asset-voice-10s",
              voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            },
            deletionReason: "owner-request",
            providerRevocation: {
              status: "revoked",
              requestId: "request-revoke-live",
            },
            localReference: {
              status: "deleted",
            },
            localAuditRecord: {
              auditId: "qwen-cloned-voice-revocation-qwen-voice-ref-teacher-kang-asset-voice-10s",
              storagePolicy: "local-redacted-lifecycle-audit",
            },
            storagePolicy: "append-only-redacted-lifecycle-audit",
            responsibleSession: "S12/S24",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          },
        ],
        responsibleSession: "S12/S24",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });

    const response = await getLifecycleAudit(
      new Request("http://localhost/api/ai/voice-clone/lifecycle-audit", {
        headers: signedAdminAiAccessHeaders,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.lifecycleAudit).toEqual(
      expect.objectContaining({
        provider: "qwen",
        providerRole: "voice-clone",
        eventType: "qwen-voice-lifecycle",
        recordCount: 1,
        responsibleSession: "S12/S24",
      }),
    );
    expect(body.progress).toEqual([
      expect.objectContaining({
        responsibleSession: "S12",
        progressText: expect.stringContaining("S12 Backend/API Platform"),
      }),
      expect.objectContaining({
        responsibleSession: "S24",
        progressText: expect.stringContaining("S24 Asset and Export Quality"),
      }),
    ]);
    expectNoCredentialValues(body);
    expect(JSON.stringify(body)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(body)).not.toContain("data:audio");
  });

  it("blocks teacher access to the Qwen voice lifecycle audit index in production", async () => {
    let listCalls = 0;
    const getLifecycleAudit = createVoiceLifecycleAuditGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      listVoiceLifecycleAuditEvents: async () => {
        listCalls += 1;
        throw new Error("must not read audit records for non-admin access");
      },
    });

    const response = await getLifecycleAudit(
      new Request("http://localhost/api/ai/voice-clone/lifecycle-audit", {
        headers: signedTeacherAiAccessHeaders,
      }),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "admin-role-required",
        responsibleSession: "S12",
        action: "voice-lifecycle-audit-read",
      }),
    );
    expect(listCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("rejects direct legacy-header access to sensitive AI admin audit routes before reading records", async () => {
    let listCalls = 0;
    const getLifecycleAudit = createVoiceLifecycleAuditGetHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      listVoiceLifecycleAuditEvents: async () => {
        listCalls += 1;
        throw new Error("must not read audit records for legacy header access");
      },
    });

    const response = await getLifecycleAudit(
      new Request("http://localhost/api/ai/voice-clone/lifecycle-audit", {
        headers: {
          "x-uais-actor-id": "admin-ai-ops",
          "x-uais-actor-role": "admin",
        },
      }),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        action: "voice-lifecycle-audit-read",
      }),
    );
    expect(listCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("returns the redacted voice asset retention readiness report only for signed admin access", async () => {
    const getRetentionReadiness = createVoiceAssetRetentionReadinessGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      readRetentionReport: async () => ({
        provider: "qwen",
        scope: "teacher-voice-and-ppt-narration-assets",
        status: "action-required",
        recordCounts: {
          teacherVoiceSamples: 1,
          clonedVoiceRefs: 1,
          pptAudioManifests: 1,
        },
        items: [
          {
            assetKind: "teacher-voice-sample",
            assetId: "asset-voice-10s",
            teacherId: "teacher-kang",
            action: "delete-source-sample",
            status: "due",
            dueAt: "2026-07-16T00:00:00.000Z",
            daysUntilDue: -4,
            responsibleSession: "S24",
          },
          {
            assetKind: "qwen-cloned-voice-reference",
            assetId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            teacherId: "teacher-kang",
            sampleAssetId: "asset-voice-10s",
            action: "review-or-revoke-provider-voice",
            status: "due",
            dueAt: "2026-07-16T00:00:00.000Z",
            daysUntilDue: -4,
            responsibleSession: "S24",
          },
          {
            assetKind: "ppt-narration-audio-manifest",
            assetId: "audio-manifest-research-methods-unit-3",
            courseId: "research-methods",
            pptAssetId: "research-methods-unit-3",
            action: "retain-derived-audio",
            status: "active",
            dueAt: "2027-06-16T00:00:00.000Z",
            daysUntilDue: 331,
            responsibleSession: "S24",
          },
        ],
        responsibleSession: "S24/S12",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });

    const response = await getRetentionReadiness(
      new Request("http://localhost/api/ai/voice-assets/retention-readiness", {
        headers: signedAdminAiAccessHeaders,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.retentionReport).toEqual(
      expect.objectContaining({
        provider: "qwen",
        scope: "teacher-voice-and-ppt-narration-assets",
        status: "action-required",
        responsibleSession: "S24/S12",
      }),
    );
    expect(body.progress).toEqual([
      expect.objectContaining({
        responsibleSession: "S12",
        progressText: expect.stringContaining("S12 Backend/API Platform"),
      }),
      expect.objectContaining({
        responsibleSession: "S24",
        progressText: expect.stringContaining("S24 Asset and Export Quality"),
      }),
    ]);
    expectNoCredentialValues(body);
    expect(JSON.stringify(body)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(body)).not.toContain("data:audio");
  });

  it("blocks teacher access to the voice asset retention readiness report in production", async () => {
    let readCalls = 0;
    const getRetentionReadiness = createVoiceAssetRetentionReadinessGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      readRetentionReport: async () => {
        readCalls += 1;
        throw new Error("must not read retention report for non-admin access");
      },
    });

    const response = await getRetentionReadiness(
      new Request("http://localhost/api/ai/voice-assets/retention-readiness", {
        headers: signedTeacherAiAccessHeaders,
      }),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "admin-role-required",
        responsibleSession: "S12",
        action: "voice-asset-retention-read",
      }),
    );
    expect(readCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("rejects direct legacy-header access to voice asset retention readiness before reading records", async () => {
    let readCalls = 0;
    const getRetentionReadiness = createVoiceAssetRetentionReadinessGetHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
      readRetentionReport: async () => {
        readCalls += 1;
        throw new Error("must not read retention report for legacy header access");
      },
    });

    const response = await getRetentionReadiness(
      new Request("http://localhost/api/ai/voice-assets/retention-readiness", {
        headers: {
          "x-uais-actor-id": "admin-ai-ops",
          "x-uais-actor-role": "admin",
        },
      }),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        action: "voice-asset-retention-read",
      }),
    );
    expect(readCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("reads voice asset retention readiness from env-configured local asset dirs", async () => {
    const retentionBaseDir = await mkdtemp(join(tmpdir(), "uais-retention-env-dirs-"));
    const teacherVoiceSampleDir = join(retentionBaseDir, "teacher-voice-samples");
    const clonedVoiceRegistryDir = join(retentionBaseDir, "qwen-cloned-voices");
    const pptNarrationAudioDir = join(retentionBaseDir, "ppt-narration");
    try {
      await Promise.all([
        mkdir(teacherVoiceSampleDir, { recursive: true }),
        mkdir(clonedVoiceRegistryDir, { recursive: true }),
        mkdir(pptNarrationAudioDir, { recursive: true }),
      ]);
      await storeTeacherVoiceSampleAsset({
        baseDir: teacherVoiceSampleDir,
        teacherId: "teacher-env-retention",
        sampleAssetId: "asset-env-voice-10s",
        sampleDurationSeconds: 10,
        consentScope: "ppt-narration",
        sourceKind: "owner-provided",
        mimeType: "audio/wav",
        audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
        createdAt: activeRetentionFixtureCreatedAt,
      });
      const getRetentionReadiness = createVoiceAssetRetentionReadinessGetHandler({
        env: {
          NODE_ENV: "production",
          UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
          UAIS_TEACHER_VOICE_SAMPLE_DIR: teacherVoiceSampleDir,
          UAIS_QWEN_CLONED_VOICE_REGISTRY_DIR: clonedVoiceRegistryDir,
          UAIS_PPT_NARRATION_AUDIO_DIR: pptNarrationAudioDir,
        },
      });

      const response = await getRetentionReadiness(
        new Request("http://localhost/api/ai/voice-assets/retention-readiness", {
          headers: signedAdminAiAccessHeaders,
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.retentionReport).toEqual(
        expect.objectContaining({
          status: "ready",
          recordCounts: {
            teacherVoiceSamples: 1,
            clonedVoiceRefs: 0,
            pptAudioManifests: 0,
          },
        }),
      );
      expect(body.retentionReport.items).toEqual([
        expect.objectContaining({
          assetKind: "teacher-voice-sample",
          assetId: "asset-env-voice-10s",
          teacherId: "teacher-env-retention",
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain(retentionBaseDir);
      expectNoCredentialValues(body);
    } finally {
      await rm(retentionBaseDir, { recursive: true, force: true });
    }
  });

  it("registers teacher voice sample metadata without exposing local files or secrets", async () => {
    const request = new Request("http://localhost/api/ai/voice-sample", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
      }),
    });

    const response = await postVoiceSample(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sample.status).toBe("ready-for-clone");
    expect(body.sample.provider).toBe("qwen");
    expect(body.nextAction).toBe("submit-qwen-voice-clone");
    expect(body.progress).toEqual([
      {
        id: "progress-1",
        type: "teacher-voice-sample",
        status: "ready-for-clone",
        responsibleSession: "S24",
        responsibleAgent: {
          id: "s24-asset-export-quality",
          name: "S24 Asset and Export Quality",
          providerRole: "voice-clone",
        },
        progressText:
          "S24 Asset and Export Quality verified the 10-second teacher voice sample for Qwen voice cloning.",
      },
      {
        id: "progress-2",
        type: "qwen-voice-clone-submit",
        status: "ready-to-submit",
        responsibleSession: "S07",
        responsibleAgent: {
          id: "s07-ai-agent-model",
          name: "S07 AI Agent Model",
          providerRole: "voice-clone",
        },
        progressText:
          "S07 AI Agent Model prepared the Qwen voice-clone submission for PPT narration.",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("/Users/");
    expect(JSON.stringify(body)).not.toContain("API_KEY");
  });

  it("blocks production voice sample contract direct calls without a signed AI access session", async () => {
    const postProductionVoiceSample = createVoiceSamplePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
    });
    const request = new Request("http://localhost/api/ai/voice-sample", {
      method: "POST",
      body: JSON.stringify({
        executionMode: "contract",
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
      }),
    });

    const response = await postProductionVoiceSample(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        action: "voice-sample-submit",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("blocks local voice sample contract direct calls without a signed AI access session", async () => {
    const response = await postVoiceSample(
      new Request("http://localhost/api/ai/voice-sample", {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          teacherId: "teacher-kang",
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId: "asset-voice-10s",
          sampleDurationSeconds: 10,
          mimeType: "audio/wav",
          sourceKind: "owner-provided",
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-sample-submit",
    });
  });

  it("blocks unsigned voice sample contract direct calls before body validation details leak", async () => {
    const response = await postVoiceSample(
      new Request("http://localhost/api/ai/voice-sample", {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          teacherId: "teacher-kang",
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId: "asset-voice-10s",
          sampleDurationSeconds: 10,
          sourceKind: "owner-provided",
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-sample-submit",
    });
  });

  it("blocks unsigned voice sample direct calls before parsing malformed request bodies", async () => {
    const response = await postVoiceSample(
      new Request("http://localhost/api/ai/voice-sample", {
        method: "POST",
        body: "{",
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-sample-submit",
    });
  });

  it("rejects teacher voice sample metadata shorter than 10 seconds", async () => {
    const request = new Request("http://localhost/api/ai/voice-sample", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-short",
        sampleDurationSeconds: 9.5,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
      }),
    });

    const response = await postVoiceSample(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("at least 10 seconds");
  });

  it("rejects an uploaded WAV teacher voice sample when the payload is shorter than 10 seconds", async () => {
    let storeCalls = 0;
    const postWithStoreSpy = createVoiceSamplePostHandler({
      storeTeacherVoiceSampleAsset: async () => {
        storeCalls += 1;
        throw new Error("short sample should not be stored");
      },
    });
    const request = new Request("http://localhost/api/ai/voice-sample", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-short-wav",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "upload",
        sampleAudioBase64: createSilentPcmWavBase64({ durationSeconds: 1 }),
      }),
    });

    const response = await postWithStoreSpy(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("at least 10 seconds");
    expect(storeCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("blocks local voice clone preflight direct calls without a signed AI access session", async () => {
    const postPreflight = createVoiceClonePreflightPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
    });
    const request = new Request("http://localhost/api/ai/voice-clone/preflight", {
      method: "POST",
      headers: teacherAiAccessHeaders,
      body: JSON.stringify({
        liveProviderApproved: true,
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
        targetVoiceLabel: "Kang teacher PPT voice",
      }),
    });

    const response = await postPreflight(request);

    await expectSignedSessionRequired(response, {
      action: "voice-clone-preflight",
    });
  });

  it("blocks production voice clone preflight direct calls without a signed AI access session", async () => {
    const postPreflight = createVoiceClonePreflightPostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
    });
    const request = new Request("https://www.uais.top/api/ai/voice-clone/preflight", {
      method: "POST",
      headers: teacherAiAccessHeaders,
      body: JSON.stringify({
        liveProviderApproved: true,
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
        targetVoiceLabel: "Kang teacher PPT voice",
      }),
    });

    const response = await postPreflight(request);

    await expectSignedSessionRequired(response, {
      action: "voice-clone-preflight",
    });
  });

  it("blocks unsigned voice clone preflight direct calls before body validation details leak", async () => {
    const postPreflight = createVoiceClonePreflightPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    const response = await postPreflight(
      new Request("http://localhost/api/ai/voice-clone/preflight", {
        method: "POST",
        body: JSON.stringify(null),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-clone-preflight",
    });
  });

  it("blocks unsigned voice clone preflight direct calls before parsing malformed request bodies", async () => {
    const postPreflight = createVoiceClonePreflightPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
      },
    });

    const response = await postPreflight(
      new Request("http://localhost/api/ai/voice-clone/preflight", {
        method: "POST",
        body: "{",
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-clone-preflight",
    });
  });

  it("returns a redacted live Qwen voice clone preflight before provider submission", async () => {
    const postPreflight = createVoiceClonePreflightPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
    });
    const request = new Request("http://localhost/api/ai/voice-clone/preflight", {
      method: "POST",
      headers: {
        ...signedTeacherAiAccessHeaders,
        ...liveApprovalHeaders,
      },
      body: JSON.stringify({
        liveProviderApproved: true,
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
        targetVoiceLabel: "Kang teacher PPT voice",
      }),
    });

    const response = await postPreflight(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preflight.status).toBe("ready");
    expect(body.preflight.nextAction).toBe("submit-qwen-voice-clone");
    expect(body.preflight.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ responsibleSession: "S07", status: "ready" }),
        expect.objectContaining({ responsibleSession: "S12", status: "ready" }),
        expect.objectContaining({ responsibleSession: "S19", status: "ready" }),
        expect.objectContaining({ responsibleSession: "S24", status: "ready" }),
      ]),
    );
    expect(body.progress).toEqual([
      {
        id: "progress-1",
        type: "s07-qwen-provider",
        status: "ready",
        responsibleSession: "S07",
        responsibleAgent: {
          id: "s07-ai-agent-model",
          name: "S07 AI Agent Model",
          providerRole: "voice-clone",
        },
        progressText: "S07 AI Agent Model verified Qwen is the voice-clone provider.",
      },
      {
        id: "progress-2",
        type: "s24-teacher-voice-sample",
        status: "ready",
        responsibleSession: "S24",
        responsibleAgent: {
          id: "s24-asset-export-quality",
          name: "S24 Asset and Export Quality",
          providerRole: "voice-clone",
        },
        progressText:
          "S24 Asset and Export Quality verified the teacher voice sample for Qwen clone preflight.",
      },
      {
        id: "progress-3",
        type: "s24-target-voice-label",
        status: "ready",
        responsibleSession: "S24",
        responsibleAgent: {
          id: "s24-asset-export-quality",
          name: "S24 Asset and Export Quality",
          providerRole: "voice-clone",
        },
        progressText:
          "S24 Asset and Export Quality verified the target cloned-voice label.",
      },
      {
        id: "progress-4",
        type: "s19-dashscope-env",
        status: "ready",
        responsibleSession: "S19",
        responsibleAgent: {
          id: "s19-api-configuration",
          name: "S19 API Configuration",
          providerRole: "voice-clone",
        },
        progressText: "S19 API Configuration verified the Qwen provider environment.",
      },
      {
        id: "progress-5",
        type: "s19-live-approval-token",
        status: "ready",
        responsibleSession: "S19",
        responsibleAgent: {
          id: "s19-api-configuration",
          name: "S19 API Configuration",
          providerRole: "voice-clone",
        },
        progressText: "S19 API Configuration verified the live approval token is configured.",
      },
      {
        id: "progress-6",
        type: "s12-live-approval",
        status: "ready",
        responsibleSession: "S12",
        responsibleAgent: {
          id: "s12-backend-api-platform",
          name: "S12 Backend/API Platform",
          providerRole: "voice-clone",
        },
        progressText: "S12 Backend/API Platform verified the live approval request boundary.",
      },
    ]);
    expectNoCredentialValues(body);
  });

  it("keeps live Qwen voice clone preflight blocked without env, approval header, or 10-second sample", async () => {
    const postPreflight = createVoiceClonePreflightPostHandler({
      env: {},
    });
    const request = new Request("http://localhost/api/ai/voice-clone/preflight", {
      method: "POST",
      headers: {
        ...signedTeacherAiAccessHeaders,
        ...liveApprovalHeaders,
      },
      body: JSON.stringify({
        liveProviderApproved: true,
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-short",
        sampleDurationSeconds: 9.5,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
        targetVoiceLabel: "",
      }),
    });

    const response = await postPreflight(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preflight.status).toBe("blocked");
    expect(body.preflight.nextAction).toBe("resolve-preflight-blockers");
    expect(body.preflight.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "s24-teacher-voice-sample", status: "blocked" }),
        expect.objectContaining({ id: "s24-target-voice-label", status: "blocked" }),
        expect.objectContaining({ id: "s19-dashscope-env", status: "blocked" }),
        expect.objectContaining({ id: "s19-live-approval-token", status: "blocked" }),
        expect.objectContaining({ id: "s12-live-approval", status: "blocked" }),
      ]),
    );
    expect(body.progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "s24-teacher-voice-sample",
          status: "blocked",
          responsibleSession: "S24",
        }),
        expect.objectContaining({
          type: "s24-target-voice-label",
          status: "blocked",
          responsibleSession: "S24",
        }),
        expect.objectContaining({
          type: "s19-dashscope-env",
          status: "blocked",
          responsibleSession: "S19",
        }),
        expect.objectContaining({
          type: "s12-live-approval",
          status: "blocked",
          responsibleSession: "S12",
        }),
      ]),
    );
    expect(JSON.stringify(body.progress)).not.toContain("secret-qwen");
    expect(JSON.stringify(body.progress)).not.toContain(liveApprovalToken);
    expectNoCredentialValues(body);
  });

  it("rejects live Qwen voice clone submission from voice sample without explicit approval", async () => {
    let providerCalls = 0;
    const postWithFakeQwen = createVoiceSamplePostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            taskId: "task-voice-live",
            status: "submitted",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/voice-sample", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        executionMode: "live",
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
        targetVoiceLabel: "Kang teacher PPT voice",
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("liveProviderApproved");
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("rejects live Qwen voice clone submission when the server approval header is missing", async () => {
    let providerCalls = 0;
    const postWithFakeQwen = createVoiceSamplePostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            taskId: "task-voice-live",
            status: "submitted",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/voice-sample", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
        targetVoiceLabel: "Kang teacher PPT voice",
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("x-uais-live-ai-approval");
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
    expect(JSON.stringify(body)).not.toContain(liveApprovalToken);
  });

  it("rejects live Qwen voice clone submission without actor context before provider submission", async () => {
    let providerCalls = 0;
    const postWithFakeQwen = createVoiceSamplePostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            taskId: "task-voice-live",
            status: "submitted",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/voice-sample", {
      method: "POST",
      headers: liveApprovalHeaders,
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        teacherId: "teacher-kang",
        consentConfirmed: true,
        consentScope: "ppt-narration",
        sampleAssetId: "asset-voice-10s",
        sampleDurationSeconds: 10,
        mimeType: "audio/wav",
        sourceKind: "owner-provided",
        targetVoiceLabel: "Kang teacher PPT voice",
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
      }),
    );
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("can submit a consented 10-second teacher sample to Qwen voice clone in live mode", async () => {
    let receivedAudioDataUrl = "";
    const privateClonedVoiceId = "voice-qwen-private";
    const baseDir = await mkdtemp(join(tmpdir(), "uais-route-cloned-voice-"));
    const ownershipBaseDir = await mkdtemp(join(tmpdir(), "uais-route-ownership-"));
    const postWithFakeQwen = createVoiceSamplePostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipBaseDir,
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async (input) => {
          receivedAudioDataUrl = input.sampleAudioDataUrl ?? "";
          return {
            provider: "qwen",
            taskId: "task-voice-live",
            requestId: "request-voice-live",
            status: "submitted",
            clonedVoiceId: privateClonedVoiceId,
            targetModel: "qwen3-tts-vc-realtime-2026-01-15",
          };
        },
      }),
      storeQwenClonedVoiceReference: (input) =>
        storeQwenClonedVoiceReference({
          ...input,
          baseDir,
        }),
    });
    try {
      const request = new Request("http://localhost/api/ai/voice-sample", {
        method: "POST",
        headers: {
          ...liveApprovalHeaders,
          ...signedTeacherAiAccessHeaders,
        },
        body: JSON.stringify({
          executionMode: "live",
          liveProviderApproved: true,
          teacherId: "teacher-kang",
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId: "asset-voice-10s",
          sampleDurationSeconds: 10,
          mimeType: "audio/wav",
          sourceKind: "owner-provided",
          targetVoiceLabel: "Kang teacher PPT voice",
          preferredVoiceName: "kangxia_ppt_0616",
          sampleAudioDataUrl: "data:audio/mp4;base64,ZmFrZS1hdWRpbw==",
          sampleText: "康霞博士授权阿里千问克隆本段教师声音。",
          languageHint: "zh",
        }),
      });

      const response = await postWithFakeQwen(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.sample.status).toBe("ready-for-clone");
      expect(body.voiceCloneSubmission.clonedVoiceId).toBeUndefined();
      expect(body.voiceCloneReference).toEqual(
        expect.objectContaining({
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          voiceRef: "server-side-cloned-qwen-voice",
          storagePolicy: "local-private-cloned-voice-reference",
          responsibleSession: "S07/S12/S24",
        }),
      );
      expect(body.nextAction).toBe("poll-qwen-voice-clone-task");
      expect(body.progress).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "progress-2",
            type: "qwen-voice-clone-submit",
            status: "submitted",
            responsibleSession: "S07",
            responsibleAgent: {
              id: "s07-ai-agent-model",
              name: "S07 AI Agent Model",
              providerRole: "voice-clone",
            },
            progressText:
              "S07 AI Agent Model submitted the 10-second teacher voice sample to Qwen voice clone.",
          }),
          expect.objectContaining({
            id: "progress-3",
            type: "server-side-voice-reference",
            status: "ready",
            responsibleSession: "S12",
            responsibleAgent: {
              id: "s12-backend-api-platform",
              name: "S12 Backend/API Platform",
              providerRole: "voice-clone",
            },
            progressText:
              "S12 Backend/API Platform stored the Qwen cloned voice id behind a server-side voice reference.",
          }),
        ]),
      );
      expect(receivedAudioDataUrl).toBe("data:audio/mp4;base64,ZmFrZS1hdWRpbw==");
      expect(JSON.stringify(body.progress)).not.toContain(privateClonedVoiceId);
      expect(JSON.stringify(body.progress)).not.toContain("ZmFrZS1hdWRpbw==");
      expect(JSON.stringify(body)).not.toContain(privateClonedVoiceId);
      expectRedactedAuditEvent(body.auditEvent, {
        provider: "qwen",
        providerRole: "voice-clone",
        action: "voice-clone-submit",
      });
      await expect(
        readUaisTeacherAiOwnershipRecord({
          baseDir: ownershipBaseDir,
          teacherId: "teacher-kang",
        }),
      ).resolves.toEqual({
        teacherId: "teacher-kang",
        courseIds: [],
        sampleAssets: [{ sampleAssetId: "asset-voice-10s" }],
        pptAssets: [],
        clonedVoiceRefs: [
          {
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            sampleAssetId: "asset-voice-10s",
          },
        ],
        audioManifests: [],
      });
      expectNoCredentialValues(body);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
      await rm(ownershipBaseDir, { recursive: true, force: true });
    }
  });

  it("stores uploaded teacher sample audio before live Qwen voice clone submission", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-route-teacher-sample-"));
    let receivedAudioDataUrl = "";
    try {
      const postWithFakeQwen = createVoiceSamplePostHandler({
        env: {
          DASHSCOPE_API_KEY: "secret-qwen",
          UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
        },
        createQwenVoiceClient: () => ({
          submitVoiceClone: async (input) => {
            receivedAudioDataUrl = input.sampleAudioDataUrl ?? "";
            return {
              provider: "qwen",
              taskId: "task-voice-live",
              requestId: "request-voice-live",
              status: "submitted",
            };
          },
        }),
        storeTeacherVoiceSampleAsset: (input) =>
          storeTeacherVoiceSampleAsset({
            ...input,
            baseDir,
          }),
      });
      const request = new Request("http://localhost/api/ai/voice-sample", {
        method: "POST",
        headers: {
          ...liveApprovalHeaders,
          ...signedTeacherAiAccessHeaders,
        },
        body: JSON.stringify({
          executionMode: "live",
          liveProviderApproved: true,
          teacherId: "teacher-kang",
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId: "asset-voice-10s",
          sampleDurationSeconds: 11.2,
          mimeType: "audio/mp4",
          sourceKind: "owner-provided",
          targetVoiceLabel: "Kang teacher PPT voice",
          preferredVoiceName: "kangxia_ppt_0616",
          sampleAudioBase64: Buffer.from("fake-audio").toString("base64"),
          sampleText: "康霞博士授权阿里千问克隆本段教师声音。",
          languageHint: "zh",
        }),
      });

      const response = await postWithFakeQwen(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.sampleAsset).toEqual(
        expect.objectContaining({
          assetId: "asset-voice-10s",
          teacherId: "teacher-kang",
          storagePolicy: "local-private-audio-asset",
          dataUrlRef: "server-side-only",
          responsibleSession: "S24/S12",
        }),
      );
      expect(receivedAudioDataUrl).toBe("data:audio/mp4;base64,ZmFrZS1hdWRpbw==");
      expect(JSON.stringify(body)).not.toContain("ZmFrZS1hdWRpbw==");
      expect(JSON.stringify(body)).not.toContain(baseDir);
      expectNoCredentialValues(body);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("normalizes a ready Qwen voice clone task for PPT narration", async () => {
    const request = new Request("http://localhost/api/ai/voice-clone/status", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        providerTaskId: "task-voice-1",
        providerStatus: "SUCCEEDED",
        clonedVoiceId: "voice-qwen-redacted",
      }),
    });

    const response = await postVoiceCloneStatus(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.voiceClone.status).toBe("ready");
    expect(body.voiceClone.nextAction).toBe("create-ppt-narration");
    expect(body.voiceClone.clonedVoiceId).toBe("voice-qwen-redacted");
    expect(body.progress).toEqual([
      {
        id: "progress-1",
        type: "qwen-voice-clone-status",
        status: "ready",
        responsibleSession: "S07",
        responsibleAgent: {
          id: "s07-ai-agent-model",
          name: "S07 AI Agent Model",
          providerRole: "voice-clone",
        },
        progressText:
          "S07 AI Agent Model confirmed the Qwen voice clone is ready for PPT narration.",
      },
    ]);
    expect(JSON.stringify(body.progress)).not.toContain("voice-qwen-redacted");
    expect(JSON.stringify(body)).not.toContain("API_KEY");
  });

  it("rejects succeeded Qwen voice clone task status without a cloned voice id", async () => {
    const request = new Request("http://localhost/api/ai/voice-clone/status", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        providerTaskId: "task-voice-1",
        providerStatus: "SUCCEEDED",
      }),
    });

    const response = await postVoiceCloneStatus(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("cloned voice id");
  });

  it("blocks production voice clone status contract direct calls without a signed AI access session", async () => {
    const postProductionVoiceCloneStatus = createVoiceCloneStatusPostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
    });
    const request = new Request("http://localhost/api/ai/voice-clone/status", {
      method: "POST",
      body: JSON.stringify({
        executionMode: "contract",
        providerTaskId: "task-voice-live",
        providerStatus: "RUNNING",
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
      }),
    });

    const response = await postProductionVoiceCloneStatus(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        action: "voice-clone-status",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("blocks local voice clone status contract direct calls without a signed AI access session", async () => {
    const response = await postVoiceCloneStatus(
      new Request("http://localhost/api/ai/voice-clone/status", {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          providerTaskId: "task-voice-live",
          providerStatus: "RUNNING",
          teacherId: "teacher-kang",
          sampleAssetId: "asset-voice-10s",
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-clone-status",
    });
  });

  it("blocks unsigned voice clone status contract direct calls before body validation details leak", async () => {
    const response = await postVoiceCloneStatus(
      new Request("http://localhost/api/ai/voice-clone/status", {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          teacherId: "teacher-kang",
          sampleAssetId: "asset-voice-10s",
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-clone-status",
    });
  });

  it("blocks unsigned voice clone status direct calls before parsing malformed request bodies", async () => {
    const response = await postVoiceCloneStatus(
      new Request("http://localhost/api/ai/voice-clone/status", {
        method: "POST",
        body: "{",
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-clone-status",
    });
  });

  it("rejects live Qwen voice clone polling without explicit provider approval", async () => {
    let providerCalls = 0;
    const postWithFakeQwen = createVoiceCloneStatusPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      createQwenVoiceClient: () => ({
        getVoiceCloneTaskStatus: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            providerTaskId: "task-voice-live",
            providerStatus: "RUNNING",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/voice-clone/status", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        executionMode: "live",
        providerTaskId: "task-voice-live",
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("liveProviderApproved");
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("rejects live Qwen voice clone polling when the server approval header is missing", async () => {
    let providerCalls = 0;
    const postWithFakeQwen = createVoiceCloneStatusPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createQwenVoiceClient: () => ({
        getVoiceCloneTaskStatus: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            providerTaskId: "task-voice-live",
            providerStatus: "RUNNING",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/voice-clone/status", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        providerTaskId: "task-voice-live",
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("x-uais-live-ai-approval");
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
    expect(JSON.stringify(body)).not.toContain(liveApprovalToken);
  });

  it("blocks live Qwen voice clone polling legacy scoped headers without a signed AI access session", async () => {
    let providerCalls = 0;
    const postWithFakeQwen = createVoiceCloneStatusPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createQwenVoiceClient: () => ({
        getVoiceCloneTaskStatus: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            providerTaskId: "task-voice-live",
            providerStatus: "RUNNING",
          };
        },
      }),
    });
    const response = await postWithFakeQwen(
      new Request("http://localhost/api/ai/voice-clone/status", {
        method: "POST",
        headers: teacherAiAccessHeaders,
        body: JSON.stringify({
          executionMode: "live",
          liveProviderApproved: true,
          providerTaskId: "task-voice-live",
          teacherId: "teacher-kang",
          sampleAssetId: "asset-voice-10s",
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-clone-status",
    });
    expect(providerCalls).toBe(0);
  });

  it("can poll Qwen voice clone task status through an injected live client", async () => {
    let storedVoiceReferenceInput:
      | {
          teacherId: string;
          sampleAssetId: string;
          providerTaskId: string;
          clonedVoiceId: string;
        }
      | undefined;
    const postWithFakeQwen = createVoiceCloneStatusPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createQwenVoiceClient: () => ({
        getVoiceCloneTaskStatus: async () => ({
          provider: "qwen",
          providerTaskId: "task-voice-live",
          providerStatus: "SUCCEEDED",
          clonedVoiceId: "voice-qwen-private",
          requestId: "request-status-live",
        }),
      }),
      storeQwenClonedVoiceReference: async (input) => {
        storedVoiceReferenceInput = input;
        return {
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          teacherId: input.teacherId,
          sampleAssetId: input.sampleAssetId,
          provider: "qwen",
          providerRole: "voice-clone",
          status: "ready",
          providerTaskId: input.providerTaskId,
          targetModel: input.targetModel,
          voiceRef: "server-side-cloned-qwen-voice",
          storagePolicy: "local-private-cloned-voice-reference",
          responsibleSession: "S07/S12/S24",
        };
      },
    });
    const request = new Request("http://localhost/api/ai/voice-clone/status", {
      method: "POST",
      headers: {
        ...signedTeacherAiAccessHeaders,
        ...liveApprovalHeaders,
      },
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        providerTaskId: "task-voice-live",
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.voiceClone.status).toBe("ready");
    expect(body.voiceClone.nextAction).toBe("create-ppt-narration");
    expect(body.voiceClone.clonedVoiceId).toBeUndefined();
    expect(body.voiceClone.voiceRef).toBe("server-side-cloned-qwen-voice");
    expect(body.voiceCloneReference).toEqual(
      expect.objectContaining({
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        voiceRef: "server-side-cloned-qwen-voice",
        storagePolicy: "local-private-cloned-voice-reference",
      }),
    );
    expect(storedVoiceReferenceInput).toEqual({
      teacherId: "teacher-kang",
      sampleAssetId: "asset-voice-10s",
      providerTaskId: "task-voice-live",
      clonedVoiceId: "voice-qwen-private",
    });
    expect(body.providerRequestId).toBe("request-status-live");
    expect(body.progress).toEqual([
      {
        id: "progress-1",
        type: "qwen-voice-clone-status",
        status: "ready",
        responsibleSession: "S07",
        responsibleAgent: {
          id: "s07-ai-agent-model",
          name: "S07 AI Agent Model",
          providerRole: "voice-clone",
        },
        progressText:
          "S07 AI Agent Model confirmed the Qwen voice clone is ready for PPT narration.",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("voice-qwen-private");
    expectRedactedAuditEvent(body.auditEvent, {
      provider: "qwen",
      providerRole: "voice-clone",
      action: "voice-clone-status",
    });
    expectNoCredentialValues(body);
  });

  it("revokes a Qwen cloned voice in production through signed scoped access without exposing the private voice id", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "uais-route-cloned-voice-revoke-"));
    try {
      const stored = await storeQwenClonedVoiceReference({
        baseDir,
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        providerTaskId: "task-voice-live",
        clonedVoiceId: "voice-qwen-private",
        targetModel: "qwen3-tts-vc-realtime-2026-01-15",
        createdAt: "2026-06-16T00:00:00.000Z",
      });
      const signedRevokeHeaders = createUaisAiAccessSessionForTrustedActor({
        secret: aiAccessSigningSecret,
        now: stableFutureIssueTime,
        ttlSeconds: 3600,
        actor: {
          actorId: "teacher-kang",
          role: "teacher",
        },
        actions: ["voice-clone-revoke"],
        scopes: {
          teacherIds: ["teacher-kang"],
          sampleAssetIds: ["asset-voice-10s"],
          voiceRefIds: [stored.voiceRefId],
        },
      }).headers;
      const revokedProviderVoiceIds: string[] = [];
      const recordedLifecycleAuditEvents: unknown[] = [];
      const postWithFakeQwen = createVoiceCloneRevokePostHandler({
        env: {
          NODE_ENV: "production",
          DASHSCOPE_API_KEY: "secret-qwen",
          UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
          UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        },
        createQwenVoiceClient: () => ({
          revokeClonedVoice: async (clonedVoiceId) => {
            revokedProviderVoiceIds.push(clonedVoiceId);
            return {
              provider: "qwen",
              providerRole: "voice-clone",
              status: "revoked",
              requestId: "request-revoke-live",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            };
          },
        }),
        revokeAndDeleteQwenClonedVoiceReference: (input) =>
          revokeAndDeleteQwenClonedVoiceReference({
            ...input,
            baseDir,
          }),
        recordVoiceLifecycleAuditEvent: async (event) => {
          recordedLifecycleAuditEvents.push(event);
          return {
            eventId: event.eventId,
            provider: "qwen",
            providerRole: "voice-clone",
            action: "voice-clone-revoke",
            status: "recorded",
            storagePolicy: "append-only-redacted-lifecycle-audit",
            responsibleSession: "S12/S24",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          };
        },
      });

      const response = await postWithFakeQwen(
        new Request("http://localhost/api/ai/voice-clone/revoke", {
          method: "POST",
          headers: {
            ...liveApprovalHeaders,
            ...signedRevokeHeaders,
          },
          body: JSON.stringify({
            executionMode: "live",
            liveProviderApproved: true,
            teacherId: "teacher-kang",
            sampleAssetId: "asset-voice-10s",
            voiceRefId: stored.voiceRefId,
            deletionReason: "owner-request",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(revokedProviderVoiceIds).toEqual(["voice-qwen-private"]);
      expect(body.revoke).toEqual(
        expect.objectContaining({
          voiceRefId: stored.voiceRefId,
          provider: "qwen",
          providerRole: "voice-clone",
          status: "revoked-and-deleted",
          responsibleSession: "S24/S12",
        }),
      );
      expect(body.providerRevocation).toEqual({
        provider: "qwen",
        providerRole: "voice-clone",
        status: "revoked",
        requestId: "request-revoke-live",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(body.lifecycleAuditEvent).toEqual({
        eventId: expect.stringContaining(stored.voiceRefId),
        provider: "qwen",
        providerRole: "voice-clone",
        action: "voice-clone-revoke",
        status: "recorded",
        storagePolicy: "append-only-redacted-lifecycle-audit",
        responsibleSession: "S12/S24",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      });
      expect(recordedLifecycleAuditEvents).toEqual([
        expect.objectContaining({
          provider: "qwen",
          providerRole: "voice-clone",
          action: "voice-clone-revoke",
          actor: {
            actorId: "teacher-kang",
            role: "teacher",
          },
          resource: {
            teacherId: "teacher-kang",
            sampleAssetId: "asset-voice-10s",
            voiceRefId: stored.voiceRefId,
          },
          deletionReason: "owner-request",
          providerRevocation: {
            status: "revoked",
            requestId: "request-revoke-live",
          },
          localReference: {
            status: "deleted",
          },
          localAuditRecord: {
            auditId: `qwen-cloned-voice-revocation-${stored.voiceRefId}`,
            storagePolicy: "local-redacted-lifecycle-audit",
          },
          responsibleSession: "S12/S24",
        }),
      ]);
      expect(body.progress).toEqual([
        expect.objectContaining({
          type: "s12-revoke-access-boundary",
          status: "authorized",
          responsibleSession: "S12",
          progressText:
            "S12 Backend/API Platform authorized the signed teacher request to revoke the server-side Qwen voice reference.",
        }),
        expect.objectContaining({
          type: "s07-qwen-voice-revoke",
          status: "revoked",
          responsibleSession: "S07",
          progressText:
            "S07 AI Agent Model revoked the cloned Qwen voice through the provider adapter.",
        }),
        expect.objectContaining({
          type: "s24-local-voice-reference-delete",
          status: "deleted",
          responsibleSession: "S24",
          progressText:
            "S24 Asset and Export Quality deleted the local private voice reference and kept a redacted lifecycle audit record.",
        }),
      ]);
      expectRedactedAuditEvent(body.auditEvent, {
        provider: "qwen",
        providerRole: "voice-clone",
        action: "voice-clone-revoke",
      });
      const auditIndex = await listQwenClonedVoiceLifecycleAuditRecords({ baseDir });
      expect(auditIndex.recordCount).toBe(1);
      expect(JSON.stringify(recordedLifecycleAuditEvents)).not.toContain("voice-qwen-private");
      expect(JSON.stringify(recordedLifecycleAuditEvents)).not.toContain(baseDir);
      expect(JSON.stringify(body)).not.toContain("voice-qwen-private");
      expect(JSON.stringify(body)).not.toContain(baseDir);
      expectNoCredentialValues(body);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("blocks production voice clone revoke contract direct calls without a signed AI access session", async () => {
    const postProductionVoiceCloneRevoke = createVoiceCloneRevokePostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
    });
    const request = new Request("http://localhost/api/ai/voice-clone/revoke", {
      method: "POST",
      body: JSON.stringify({
        executionMode: "contract",
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
        voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        deletionReason: "owner-request",
      }),
    });

    const response = await postProductionVoiceCloneRevoke(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        action: "voice-clone-revoke",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("blocks local voice clone revoke contract direct calls without a signed AI access session", async () => {
    const response = await createVoiceCloneRevokePostHandler()(
      new Request("http://localhost/api/ai/voice-clone/revoke", {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          teacherId: "teacher-kang",
          sampleAssetId: "asset-voice-10s",
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          deletionReason: "owner-request",
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-clone-revoke",
    });
  });

  it("blocks unsigned voice clone revoke direct calls before parsing malformed request bodies", async () => {
    const response = await createVoiceCloneRevokePostHandler()(
      new Request("http://localhost/api/ai/voice-clone/revoke", {
        method: "POST",
        body: "{",
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-clone-revoke",
    });
  });

  it("rejects live Qwen voice clone polling outside the teacher sample scope", async () => {
    let providerCalls = 0;
    const postWithFakeQwen = createVoiceCloneStatusPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createQwenVoiceClient: () => ({
        getVoiceCloneTaskStatus: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            providerTaskId: "task-voice-live",
            providerStatus: "RUNNING",
          };
        },
      }),
    });
    const mismatchedSampleAccessHeaders = createUaisAiAccessSessionForTrustedActor({
      secret: aiAccessSigningSecret,
      now: stableFutureIssueTime,
      ttlSeconds: 3600,
      actor: {
        actorId: "teacher-kang",
        role: "teacher",
      },
      actions: ["voice-clone-status"],
      scopes: {
        teacherIds: ["teacher-kang"],
        sampleAssetIds: ["asset-other"],
      },
    }).headers;
    const request = new Request("http://localhost/api/ai/voice-clone/status", {
      method: "POST",
      headers: {
        ...mismatchedSampleAccessHeaders,
        ...liveApprovalHeaders,
      },
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        providerTaskId: "task-voice-live",
        teacherId: "teacher-kang",
        sampleAssetId: "asset-voice-10s",
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "sample-asset-scope-denied",
        responsibleSession: "S12",
        resource: expect.objectContaining({
          teacherId: "teacher-kang",
          sampleAssetId: "asset-voice-10s",
        }),
      }),
    );
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("runs the multi-agent chat contract without live provider calls", async () => {
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        courseId: "research-methods",
        agents: [
          {
            id: "teacher",
            handle: "@教师",
            name: "教师",
            role: "teacher",
            providerRole: "text-reasoning",
            priority: 10,
            allowedActions: ["respond"],
          },
          {
            id: "methods",
            handle: "@方法顾问",
            name: "方法顾问",
            role: "assistant",
            providerRole: "text-reasoning",
            priority: 7,
            allowedActions: ["respond"],
          },
        ],
        messages: [{ id: "m1", role: "student", content: "变量怎么定？@方法顾问" }],
        maxAgentTurns: 2,
      }),
    });

    const response = await postChat(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("cue-user");
    expect(body.turns[0].agentId).toBe("methods");
    expect(body.turns[0].provider.provider).toBe("deepseek");
    expect(body.progress).toEqual([
      {
        id: "progress-1",
        type: "agent-start",
        responsibleSession: "S07",
        responsibleAgent: {
          id: "methods",
          handle: "@方法顾问",
          name: "方法顾问",
          providerRole: "text-reasoning",
        },
        progressText: "S07 multi-agent director assigned @方法顾问 方法顾问 for text-reasoning.",
      },
      {
        id: "progress-2",
        type: "agent-end",
        responsibleSession: "S07",
        responsibleAgent: {
          id: "methods",
          handle: "@方法顾问",
          name: "方法顾问",
          providerRole: "text-reasoning",
        },
        progressText: "S07 multi-agent director completed @方法顾问 方法顾问 for text-reasoning.",
      },
      {
        id: "progress-3",
        type: "cue-user",
        responsibleSession: "S07",
        responsibleAgent: {
          id: "methods",
          handle: "@方法顾问",
          name: "方法顾问",
          providerRole: "text-reasoning",
        },
        progressText:
          "S07 multi-agent director returned control to the learner after @方法顾问 方法顾问.",
      },
    ]);
    expect(JSON.stringify(body.progress)).not.toContain("已通过 UAIS multi-agent contract 响应");
    expect(JSON.stringify(body.progress)).not.toContain("actions");
    expect(JSON.stringify(body)).not.toContain("API_KEY");
  });

  it("blocks production chat contract direct calls without a signed AI access session", async () => {
    const postProductionChat = createChatPostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
    });
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        executionMode: "contract",
        courseId: "research-methods",
        agents: [
          {
            id: "methods",
            handle: "@方法顾问",
            name: "方法顾问",
            role: "assistant",
            providerRole: "text-reasoning",
            priority: 7,
            allowedActions: ["respond"],
          },
        ],
        messages: [{ id: "m1", role: "student", content: "变量怎么定？@方法顾问" }],
        maxAgentTurns: 1,
      }),
    });

    const response = await postProductionChat(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        action: "live-chat",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("blocks local chat contract direct calls without a signed AI access session", async () => {
    const response = await postChat(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          courseId: "research-methods",
          agents: [
            {
              id: "methods",
              handle: "@方法顾问",
              name: "方法顾问",
              role: "assistant",
              providerRole: "text-reasoning",
              priority: 7,
              allowedActions: ["respond"],
            },
          ],
          messages: [{ id: "m1", role: "student", content: "变量怎么定？@方法顾问" }],
          maxAgentTurns: 1,
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "live-chat",
    });
  });

  it("blocks unsigned chat contract direct calls before roster validation details leak", async () => {
    const response = await postChat(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          courseId: "research-methods",
          agents: [
            {
              id: "methods",
              handle: "@方法顾问",
              name: "方法顾问",
              role: "assistant",
              providerRole: "text-reasoning",
              priority: 7,
              allowedActions: ["respond"],
            },
            {
              id: "methods",
              handle: "@数学顾问",
              name: "数学顾问",
              role: "assistant",
              providerRole: "text-reasoning",
              priority: 6,
              allowedActions: ["respond"],
            },
          ],
          messages: [{ id: "m1", role: "student", content: "变量怎么定？@数学顾问" }],
          maxAgentTurns: 2,
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "live-chat",
    });
  });

  it("blocks live chat legacy scoped headers without a signed AI access session", async () => {
    let providerCalls = 0;
    const postLiveChat = createChatPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
        DEEPSEEK_API_KEY: "secret-deepseek",
      },
      createDeepSeekTextClient: () => ({
        complete: async () => {
          providerCalls += 1;
          return {
            model: "deepseek-live-fixture",
            content: "live response should not be called",
          };
        },
      }),
    });

    const response = await postLiveChat(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        headers: teacherAiAccessHeaders,
        body: JSON.stringify({
          executionMode: "live",
          liveProviderApproved: true,
          courseId: "research-methods",
          agents: [
            {
              id: "methods",
              handle: "@方法顾问",
              name: "方法顾问",
              role: "assistant",
              providerRole: "text-reasoning",
              priority: 7,
              allowedActions: ["respond"],
            },
          ],
          messages: [{ id: "m1", role: "student", content: "变量怎么定？@方法顾问" }],
          maxAgentTurns: 1,
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "live-chat",
    });
    expect(providerCalls).toBe(0);
  });

  it("blocks live voice sample legacy scoped headers without a signed AI access session", async () => {
    let providerCalls = 0;
    const postVoiceSampleLive = createVoiceSamplePostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            taskId: "task-voice-live",
            status: "submitted",
          };
        },
      }),
    });

    const response = await postVoiceSampleLive(
      new Request("http://localhost/api/ai/voice-sample", {
        method: "POST",
        headers: teacherAiAccessHeaders,
        body: JSON.stringify({
          executionMode: "live",
          liveProviderApproved: true,
          teacherId: "teacher-kang",
          consentConfirmed: true,
          consentScope: "ppt-narration",
          sampleAssetId: "asset-voice-10s",
          sampleDurationSeconds: 10,
          mimeType: "audio/wav",
          sourceKind: "owner-provided",
          targetVoiceLabel: "Kang teacher PPT voice",
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-sample-submit",
    });
    expect(providerCalls).toBe(0);
  });

  it("blocks live PPT narration legacy scoped headers before reading voice refs", async () => {
    let voiceReferenceReads = 0;
    const postPptNarrationLive = createPptNarrationPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      readQwenClonedVoiceReference: async () => {
        voiceReferenceReads += 1;
        throw new Error("Legacy scoped headers must not read private voice refs.");
      },
    });

    const response = await postPptNarrationLive(
      new Request("http://localhost/api/ai/ppt-narration", {
        method: "POST",
        headers: teacherAiAccessHeaders,
        body: JSON.stringify({
          executionMode: "live",
          liveProviderApproved: true,
          voiceClone: {
            teacherId: "teacher-kang",
            consentConfirmed: true,
            sampleAssetId: "asset-voice-10s",
            sampleDurationSeconds: 10,
            language: "zh-CN",
            targetVoiceLabel: "Kang teacher PPT voice",
          },
          pptNarration: {
            courseId: "research-methods",
            pptAssetId: "research-methods-unit-3",
            clonedVoiceRef: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            language: "zh-CN",
            slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
          },
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "ppt-narration-submit",
    });
    expect(voiceReferenceReads).toBe(0);
  });

  it("blocks live voice revoke legacy scoped headers before provider or local deletion", async () => {
    let providerCalls = 0;
    let localDeletes = 0;
    const postVoiceRevokeLive = createVoiceCloneRevokePostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      createQwenVoiceClient: () => ({
        revokeClonedVoice: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            providerRole: "voice-clone",
            status: "revoked",
            requestId: "request-revoke-live",
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "ids-only",
            },
          };
        },
      }),
      revokeAndDeleteQwenClonedVoiceReference: async () => {
        localDeletes += 1;
        throw new Error("Legacy scoped headers must not delete local voice refs.");
      },
      recordVoiceLifecycleAuditEvent: async () => ({
        eventId: "event-not-called",
        provider: "qwen",
        providerRole: "voice-clone",
        action: "voice-clone-revoke",
        status: "recorded",
        storagePolicy: "append-only-redacted-lifecycle-audit",
        responsibleSession: "S12/S24",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    });

    const response = await postVoiceRevokeLive(
      new Request("http://localhost/api/ai/voice-clone/revoke", {
        method: "POST",
        headers: teacherAiAccessHeaders,
        body: JSON.stringify({
          executionMode: "live",
          liveProviderApproved: true,
          teacherId: "teacher-kang",
          sampleAssetId: "asset-voice-10s",
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          deletionReason: "owner-request",
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "voice-clone-revoke",
    });
    expect(providerCalls).toBe(0);
    expect(localDeletes).toBe(0);
  });

  it("rejects multi-agent chat progress that would expose non-display-safe agent metadata", async () => {
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        courseId: "research-methods",
        agents: [
          {
            id: "unsafe-agent",
            handle: "@data:audio/mp4;base64,ZmFrZS1hdWRpbw==",
            name: "voice-qwen-private",
            role: "assistant",
            providerRole: "text-reasoning",
            priority: 10,
            allowedActions: ["respond"],
          },
        ],
        messages: [
          {
            id: "m1",
            role: "student",
            content: "@data:audio/mp4;base64,ZmFrZS1hdWRpbw==",
          },
        ],
        maxAgentTurns: 2,
      }),
    });

    const response = await postChat(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Progress item contains non-display-safe data.");
    expect(JSON.stringify(body)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(body)).not.toContain("ZmFrZS1hdWRpbw==");
  });

  it("rejects ambiguous multi-agent chat rosters before execution", async () => {
    const duplicateIdRequest = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        agents: [
          {
            id: "methods",
            handle: "@方法顾问",
            name: "方法顾问",
            role: "assistant",
            providerRole: "text-reasoning",
            priority: 7,
            allowedActions: ["respond"],
          },
          {
            id: "methods",
            handle: "@数学顾问",
            name: "数学顾问",
            role: "assistant",
            providerRole: "text-reasoning",
            priority: 6,
            allowedActions: ["respond"],
          },
        ],
        messages: [{ id: "m1", role: "student", content: "变量怎么定？@数学顾问" }],
        maxAgentTurns: 2,
      }),
    });
    const duplicateIdResponse = await postChat(duplicateIdRequest);
    const duplicateIdBody = await duplicateIdResponse.json();

    expect(duplicateIdResponse.status).toBe(400);
    expect(duplicateIdBody.error).toBe("UAIS multi-agent roster has duplicate agent ids.");

    const duplicateHandleRequest = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        agents: [
          {
            id: "methods",
            handle: "@方法顾问",
            name: "方法顾问",
            role: "assistant",
            providerRole: "text-reasoning",
            priority: 7,
            allowedActions: ["respond"],
          },
          {
            id: "math",
            handle: "@方法顾问",
            name: "数学顾问",
            role: "assistant",
            providerRole: "text-reasoning",
            priority: 6,
            allowedActions: ["respond"],
          },
        ],
        messages: [{ id: "m1", role: "student", content: "变量怎么定？@方法顾问" }],
        maxAgentTurns: 2,
      }),
    });
    const duplicateHandleResponse = await postChat(duplicateHandleRequest);
    const duplicateHandleBody = await duplicateHandleResponse.json();

    expect(duplicateHandleResponse.status).toBe(400);
    expect(duplicateHandleBody.error).toBe(
      "UAIS multi-agent roster has duplicate agent handles.",
    );
    expect(JSON.stringify(duplicateHandleBody)).not.toContain("数学顾问 response");
  });

  it("blocks unsigned multi-agent chat direct calls before parsing malformed request bodies", async () => {
    const response = await postChat(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: "{",
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "live-chat",
    });
  });

  it("rejects live DeepSeek chat without explicit provider approval", async () => {
    let providerCalls = 0;
    const postWithFakeDeepSeek = createChatPostHandler({
      env: { DEEPSEEK_API_KEY: "secret-deepseek" },
      createDeepSeekTextClient: () => ({
        complete: async () => {
          providerCalls += 1;
          return {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            content: "Live DeepSeek answer",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        executionMode: "live",
        agents: [
          {
            id: "teacher",
            handle: "@教师",
            name: "教师",
            role: "teacher",
            providerRole: "text-reasoning",
            priority: 10,
            allowedActions: ["respond"],
          },
        ],
        messages: [{ id: "m1", role: "student", content: "请帮我规划研究设计" }],
      }),
    });

    const response = await postWithFakeDeepSeek(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("liveProviderApproved");
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("rejects live DeepSeek chat when the server approval header is missing", async () => {
    let providerCalls = 0;
    const postWithFakeDeepSeek = createChatPostHandler({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createDeepSeekTextClient: () => ({
        complete: async () => {
          providerCalls += 1;
          return {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            content: "Live DeepSeek answer",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        agents: [
          {
            id: "teacher",
            handle: "@教师",
            name: "教师",
            role: "teacher",
            providerRole: "text-reasoning",
            priority: 10,
            allowedActions: ["respond"],
          },
        ],
        messages: [{ id: "m1", role: "student", content: "请帮我规划研究设计" }],
      }),
    });

    const response = await postWithFakeDeepSeek(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("x-uais-live-ai-approval");
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
    expect(JSON.stringify(body)).not.toContain(liveApprovalToken);
  });

  it("rejects live DeepSeek chat without actor context before calling the provider", async () => {
    let providerCalls = 0;
    const postWithFakeDeepSeek = createChatPostHandler({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createDeepSeekTextClient: () => ({
        complete: async () => {
          providerCalls += 1;
          return {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            content: "Live DeepSeek answer",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: liveApprovalHeaders,
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        courseId: "research-methods",
        agents: [
          {
            id: "teacher",
            handle: "@教师",
            name: "教师",
            role: "teacher",
            providerRole: "text-reasoning",
            priority: 10,
            allowedActions: ["respond"],
          },
        ],
        messages: [{ id: "m1", role: "student", content: "请帮我规划研究设计" }],
      }),
    });

    const response = await postWithFakeDeepSeek(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
      }),
    );
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("can route chat responses through an injected DeepSeek client in live mode", async () => {
    const postWithFakeDeepSeek = createChatPostHandler({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createDeepSeekTextClient: () => ({
        complete: async () => ({
          provider: "deepseek",
          model: "deepseek-v4-flash",
          content: "Live DeepSeek answer",
          usage: { totalTokens: 3 },
        }),
      }),
    });
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: {
        ...liveApprovalHeaders,
        ...signedTeacherAiAccessHeaders,
      },
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        courseId: "research-methods",
        agents: [
          {
            id: "teacher",
            handle: "@教师",
            name: "教师",
            role: "teacher",
            providerRole: "text-reasoning",
            priority: 10,
            allowedActions: ["respond"],
          },
        ],
        messages: [{ id: "m1", role: "student", content: "请帮我规划研究设计" }],
      }),
    });

    const response = await postWithFakeDeepSeek(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.turns[0].content).toBe("Live DeepSeek answer");
    expect(body.turns[0].provider.provider).toBe("deepseek");
    expectRedactedAuditEvent(body.auditEvent, {
      provider: "deepseek",
      providerRole: "text-reasoning",
      action: "chat-completion",
    });
    expectNoCredentialValues(body);
  });

  it("responds 504 when live DeepSeek chat times out", async () => {
    const postWithTimingOutDeepSeek = createChatPostHandler({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createDeepSeekTextClient: () => ({
        complete: async () => {
          throw new Error("DeepSeek request timed out.");
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: {
        ...liveApprovalHeaders,
        ...signedTeacherAiAccessHeaders,
      },
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        courseId: "research-methods",
        agents: [
          {
            id: "teacher",
            handle: "@教师",
            name: "教师",
            role: "teacher",
            providerRole: "text-reasoning",
            priority: 10,
            allowedActions: ["respond"],
          },
        ],
        messages: [{ id: "m1", role: "student", content: "请帮我规划研究设计" }],
      }),
    });

    const response = await postWithTimingOutDeepSeek(request);
    const body = await response.json();

    // A provider timeout is an upstream failure, not a malformed request.
    expect(response.status).toBe(504);
    expect(body.error).toBe("DeepSeek request timed out.");
    expectNoCredentialValues(body);
  });

  it("sends a role system prompt, capped tokens, and disabled thinking to live DeepSeek chat", async () => {
    const deepSeekRequests: Array<{
      model?: string;
      maxTokens?: number;
      thinking?: { type: "enabled" | "disabled" };
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    }> = [];
    const postWithFakeDeepSeek = createChatPostHandler({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createDeepSeekTextClient: () => ({
        complete: async (input) => {
          deepSeekRequests.push(input);
          return {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            content: "Live DeepSeek answer",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: {
        ...liveApprovalHeaders,
        ...signedTeacherAiAccessHeaders,
      },
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        courseId: "research-methods",
        agents: [
          {
            id: "methods",
            handle: "@方法顾问",
            aliases: ["@MethodsAdvisor"],
            name: "方法顾问",
            role: "assistant",
            providerRole: "text-reasoning",
            priority: 10,
            allowedActions: ["respond"],
          },
        ],
        messages: [{ id: "m1", role: "student", content: "请帮我规划研究设计" }],
      }),
    });

    const response = await postWithFakeDeepSeek(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.turns[0].content).toBe("Live DeepSeek answer");
    expect(deepSeekRequests).toHaveLength(1);
    expect(deepSeekRequests[0].maxTokens).toBe(1024);
    expect(deepSeekRequests[0].thinking).toEqual({ type: "disabled" });
    expect(deepSeekRequests[0].messages[0]).toEqual({
      role: "system",
      content:
        "You are 方法顾问 (@方法顾问), the assistant agent in a UAIS university course chatroom. Answer concisely in the learner's language.",
    });
    expect(deepSeekRequests[0].messages[1]).toEqual({
      role: "user",
      content: "请帮我规划研究设计",
    });
    expectNoCredentialValues(body);
  });

  it("honors a custom agent systemPrompt in live DeepSeek chat", async () => {
    const deepSeekRequests: Array<{
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    }> = [];
    const postWithFakeDeepSeek = createChatPostHandler({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createDeepSeekTextClient: () => ({
        complete: async (input) => {
          deepSeekRequests.push(input);
          return {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            content: "Live DeepSeek answer",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: {
        ...liveApprovalHeaders,
        ...signedTeacherAiAccessHeaders,
      },
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        courseId: "research-methods",
        agents: [
          {
            id: "methods",
            handle: "@方法顾问",
            name: "方法顾问",
            role: "assistant",
            providerRole: "text-reasoning",
            priority: 10,
            allowedActions: ["respond"],
            systemPrompt: "你是 UAIS 方法顾问，只讨论研究设计与证据质量。",
          },
        ],
        messages: [{ id: "m1", role: "student", content: "请帮我规划研究设计" }],
      }),
    });

    const response = await postWithFakeDeepSeek(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(deepSeekRequests[0].messages[0]).toEqual({
      role: "system",
      content: "你是 UAIS 方法顾问，只讨论研究设计与证据质量。",
    });
    expectNoCredentialValues(body);
  });

  it("rejects oversized agent system prompts before calling the provider", async () => {
    let providerCalls = 0;
    const postWithFakeDeepSeek = createChatPostHandler({
      env: {
        DEEPSEEK_API_KEY: "secret-deepseek",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createDeepSeekTextClient: () => ({
        complete: async () => {
          providerCalls += 1;
          return {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            content: "Live DeepSeek answer",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: {
        ...liveApprovalHeaders,
        ...signedTeacherAiAccessHeaders,
      },
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        courseId: "research-methods",
        agents: [
          {
            id: "methods",
            handle: "@方法顾问",
            name: "方法顾问",
            role: "assistant",
            providerRole: "text-reasoning",
            priority: 10,
            allowedActions: ["respond"],
            systemPrompt: "x".repeat(2001),
          },
        ],
        messages: [{ id: "m1", role: "student", content: "请帮我规划研究设计" }],
      }),
    });

    const response = await postWithFakeDeepSeek(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Agent systemPrompt must be at most 2000 characters.");
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("creates redacted voice clone and PPT narration jobs", async () => {
    const request = new Request("http://localhost/api/ai/ppt-narration", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        voiceClone: {
          teacherId: "teacher-kang",
          consentConfirmed: true,
          sampleAssetId: "teacher-kang-10s-sample",
          sampleDurationSeconds: 10,
          language: "zh-CN",
          targetVoiceLabel: "Kang teacher PPT voice",
        },
        pptNarration: {
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          clonedVoiceId: "voice-qwen-private",
          language: "zh-CN",
          slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
        },
      }),
    });

    const response = await postPptNarration(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.voiceCloneJob.provider).toBe("qwen");
    expect(body.pptNarrationJob.provider).toBe("qwen");
    expect(body.progress).toEqual([
      {
        id: "progress-1",
        type: "teacher-voice-sample",
        status: "ready-for-clone",
        responsibleSession: "S24",
        responsibleAgent: {
          id: "s24-asset-export-quality",
          name: "S24 Asset and Export Quality",
          providerRole: "voice-clone",
        },
        progressText:
          "S24 Asset and Export Quality verified the 10-second teacher voice sample for Qwen PPT narration.",
      },
      {
        id: "progress-2",
        type: "qwen-voice-clone",
        status: "queued",
        responsibleSession: "S07",
        responsibleAgent: {
          id: "s07-ai-agent-model",
          name: "S07 AI Agent Model",
          providerRole: "voice-clone",
        },
        progressText:
          "S07 AI Agent Model prepared the Qwen voice-clone job using a server-side voice reference.",
      },
      {
        id: "progress-3",
        type: "qwen-ppt-narration",
        status: "queued",
        responsibleSession: "S07",
        responsibleAgent: {
          id: "s07-ai-agent-model",
          name: "S07 AI Agent Model",
          providerRole: "ppt-narration",
        },
        progressText:
          "S07 AI Agent Model prepared Qwen PPT narration for 1 slide in research-methods.",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(body.progress)).not.toContain("voice-qwen-private");
    expectNoCredentialValues(body);
  });

  it("blocks production PPT narration contract direct calls without a signed AI access session", async () => {
    const postProductionPptNarration = createPptNarrationPostHandler({
      env: {
        NODE_ENV: "production",
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      },
    });
    const request = new Request("http://localhost/api/ai/ppt-narration", {
      method: "POST",
      body: JSON.stringify({
        executionMode: "contract",
        voiceClone: {
          teacherId: "teacher-kang",
          consentConfirmed: true,
          sampleAssetId: "teacher-kang-10s-sample",
          sampleDurationSeconds: 10,
          language: "zh-CN",
          targetVoiceLabel: "Kang teacher PPT voice",
        },
        pptNarration: {
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          clonedVoiceId: "voice-qwen-private",
          language: "zh-CN",
          slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
        },
      }),
    });

    const response = await postProductionPptNarration(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
        action: "ppt-narration-submit",
      }),
    );
    expectNoCredentialValues(body);
  });

  it("blocks local PPT narration contract direct calls without a signed AI access session", async () => {
    const response = await postPptNarration(
      new Request("http://localhost/api/ai/ppt-narration", {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          voiceClone: {
            teacherId: "teacher-kang",
            consentConfirmed: true,
            sampleAssetId: "teacher-kang-10s-sample",
            sampleDurationSeconds: 10,
            language: "zh-CN",
            targetVoiceLabel: "Kang teacher PPT voice",
          },
          pptNarration: {
            courseId: "research-methods",
            pptAssetId: "research-methods-unit-3",
            clonedVoiceRef: "qwen-voice-ref-teacher-kang-teacher-kang-10s-sample",
            language: "zh-CN",
            slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
          },
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "ppt-narration-submit",
    });
  });

  it("blocks unsigned PPT narration contract direct calls before body validation details leak", async () => {
    const response = await postPptNarration(
      new Request("http://localhost/api/ai/ppt-narration", {
        method: "POST",
        body: JSON.stringify({
          executionMode: "contract",
          pptNarration: {
            courseId: "research-methods",
            pptAssetId: "research-methods-unit-3",
          },
        }),
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "ppt-narration-submit",
    });
  });

  it("blocks unsigned PPT narration direct calls before parsing malformed request bodies", async () => {
    const response = await postPptNarration(
      new Request("http://localhost/api/ai/ppt-narration", {
        method: "POST",
        body: "{",
      }),
    );

    await expectSignedSessionRequired(response, {
      action: "ppt-narration-submit",
    });
  });

  it("rejects live Qwen PPT narration without explicit provider approval", async () => {
    let providerCalls = 0;
    const postWithFakeQwen = createPptNarrationPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            taskId: "task-voice-live",
            status: "submitted",
          };
        },
        submitPptNarration: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            taskId: "task-ppt-live",
            status: "submitted",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/ppt-narration", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        executionMode: "live",
        voiceClone: {
          teacherId: "teacher-kang",
          consentConfirmed: true,
          sampleAssetId: "teacher-kang-10s-sample",
          sampleDurationSeconds: 10,
          language: "zh-CN",
          targetVoiceLabel: "Kang teacher PPT voice",
        },
        pptNarration: {
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          clonedVoiceId: "voice-qwen-private",
          language: "zh-CN",
          slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
        },
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("liveProviderApproved");
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
  });

  it("rejects live Qwen PPT narration when the server approval header is missing", async () => {
    let providerCalls = 0;
    const postWithFakeQwen = createPptNarrationPostHandler({
      env: {
        UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            taskId: "task-voice-live",
            status: "submitted",
          };
        },
        submitPptNarration: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            taskId: "task-ppt-live",
            status: "submitted",
          };
        },
      }),
    });
    const request = new Request("http://localhost/api/ai/ppt-narration", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        voiceClone: {
          teacherId: "teacher-kang",
          consentConfirmed: true,
          sampleAssetId: "teacher-kang-10s-sample",
          sampleDurationSeconds: 10,
          language: "zh-CN",
          targetVoiceLabel: "Kang teacher PPT voice",
        },
        pptNarration: {
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          clonedVoiceId: "voice-qwen-redacted",
          language: "zh-CN",
          slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
        },
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("x-uais-live-ai-approval");
    expect(providerCalls).toBe(0);
    expectNoCredentialValues(body);
    expect(JSON.stringify(body)).not.toContain(liveApprovalToken);
  });

  it("rejects live Qwen PPT narration without actor context before reading voice refs or calling Qwen", async () => {
    let providerCalls = 0;
    let voiceReferenceReads = 0;
    const postWithFakeQwen = createPptNarrationPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            taskId: "task-voice-live",
            status: "submitted",
          };
        },
        submitPptNarration: async () => {
          providerCalls += 1;
          return {
            provider: "qwen",
            taskId: "task-ppt-live",
            status: "submitted",
          };
        },
      }),
      readQwenClonedVoiceReference: async () => {
        voiceReferenceReads += 1;
        throw new Error("Unauthorized requests must not read private voice references.");
      },
    });
    const request = new Request("http://localhost/api/ai/ppt-narration", {
      method: "POST",
      headers: liveApprovalHeaders,
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        voiceClone: {
          teacherId: "teacher-kang",
          consentConfirmed: true,
          sampleAssetId: "teacher-kang-10s-sample",
          sampleDurationSeconds: 10,
          language: "zh-CN",
          targetVoiceLabel: "Kang teacher PPT voice",
        },
        pptNarration: {
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          clonedVoiceRef: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          language: "zh-CN",
          slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
        },
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
      }),
    );
    expect(providerCalls).toBe(0);
    expect(voiceReferenceReads).toBe(0);
    expectNoCredentialValues(body);
  });

  it("can submit PPT narration through an injected Qwen client in live mode", async () => {
    let voiceCloneCalls = 0;
    let pptNarrationCalls = 0;
    let receivedClonedVoiceId = "";
    const privateClonedVoiceId = "voice-qwen-private";
    const ownershipBaseDir = await mkdtemp(join(tmpdir(), "uais-ppt-ownership-"));
    const postWithFakeQwen = createPptNarrationPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
        UAIS_TEACHER_AI_OWNERSHIP_DIR: ownershipBaseDir,
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async () => {
          voiceCloneCalls += 1;
          throw new Error("PPT narration must reuse the existing cloned voice id.");
        },
        submitPptNarration: async (input) => {
          pptNarrationCalls += 1;
          receivedClonedVoiceId = input.clonedVoiceId;
          return {
            provider: "qwen",
            taskId: "audio-manifest-research-methods-unit-3",
            status: "submitted",
            targetModel: "qwen3-tts-vc-realtime-2026-01-15",
            audioManifest: {
              id: "audio-manifest-research-methods-unit-3",
              provider: "qwen",
              providerRole: "ppt-narration",
              targetModel: "qwen3-tts-vc-realtime-2026-01-15",
              voiceRef: "server-side-cloned-qwen-voice",
              courseId: "research-methods",
              pptAssetId: "research-methods-unit-3",
              language: "zh-CN",
              sourcePattern: "openmaic-register-once-speech-action-tts",
              segments: [
                {
                  id: "tts-s1",
                  slideId: "s1",
                  audioId: "tts_research-methods-unit-3_s1",
                  narrationText: "今天我们学习研究问题。",
                  format: "pcm",
                  sampleRateHz: 24000,
                  status: "queued",
                  responsibleSession: "S07/S12/S24",
                },
              ],
            },
            audioSegments: [
              {
                slideId: "s1",
                audioId: "tts_research-methods-unit-3_s1",
                audioBase64: "ZmFrZS1wY20=",
                byteLength: 8,
                format: "pcm",
                sampleRateHz: 24000,
              },
            ],
          };
        },
      }),
      readQwenClonedVoiceReference: async () => ({
        clonedVoiceId: privateClonedVoiceId,
        publicReference: {
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          teacherId: "teacher-kang",
          sampleAssetId: "asset-voice-10s",
          provider: "qwen",
          providerRole: "voice-clone",
          status: "ready",
          providerTaskId: "task-voice-live",
          targetModel: "qwen3-tts-vc-realtime-2026-01-15",
          voiceRef: "server-side-cloned-qwen-voice",
          storagePolicy: "local-private-cloned-voice-reference",
          responsibleSession: "S07/S12/S24",
        },
      }),
      storePptNarrationAudioAssets: async ({ audioSegments }) => {
        expect(audioSegments).toHaveLength(1);
        return {
          id: "audio-manifest-research-methods-unit-3",
          provider: "qwen",
          providerRole: "ppt-narration",
          targetModel: "qwen3-tts-vc-realtime-2026-01-15",
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          language: "zh-CN",
          voiceRef: "server-side-cloned-qwen-voice",
          sourcePattern: "openmaic-audio-id-download-assets",
          assets: [
            {
              slideId: "s1",
              audioId: "tts_research-methods-unit-3_s1",
              format: "wav",
              sampleRateHz: 24000,
              byteLength: 52,
              downloadUrl:
                "/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/tts_research-methods-unit-3_s1",
            },
          ],
        };
      },
    });
    const request = new Request("http://localhost/api/ai/ppt-narration", {
      method: "POST",
      headers: {
        ...liveApprovalHeaders,
        ...signedTeacherAiAccessHeaders,
      },
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        voiceClone: {
          teacherId: "teacher-kang",
          consentConfirmed: true,
          sampleAssetId: "asset-voice-10s",
          sampleDurationSeconds: 10,
          language: "zh-CN",
          targetVoiceLabel: "Kang teacher PPT voice",
        },
        pptNarration: {
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          clonedVoiceRef: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          language: "zh-CN",
          slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
        },
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(voiceCloneCalls).toBe(0);
    expect(pptNarrationCalls).toBe(1);
    expect(receivedClonedVoiceId).toBe(privateClonedVoiceId);
    expect(body.voiceCloneSubmission).toBeUndefined();
    expect(body.pptNarrationSubmission.taskId).toBe("audio-manifest-research-methods-unit-3");
    expect(body.pptNarrationSubmission.audioManifest.voiceRef).toBe("server-side-cloned-qwen-voice");
    expect(body.pptNarrationSubmission.audioSegments).toBeUndefined();
    expect(body.pptNarrationAssets.assets[0].downloadUrl).toBe(
      "/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/tts_research-methods-unit-3_s1",
    );
    expect(new Set(body.progress.map((item: { responsibleSession: string }) => item.responsibleSession))).toEqual(
      new Set(["S07", "S12", "S19", "S24"]),
    );
    expect(body.progress.map((item: { progressText: string }) => item.progressText)).toEqual(
      expect.arrayContaining([
        "S19 API Configuration verified the approved Qwen live provider environment for PPT narration.",
        "S12 Backend/API Platform verified the actor, course, sample, PPT, and voiceRef access boundary for live PPT narration.",
      ]),
    );
    expect(body.progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "progress-6",
          type: "qwen-ppt-audio-assets",
          status: "stored",
          responsibleSession: "S24",
          responsibleAgent: {
            id: "s24-asset-export-quality",
            name: "S24 Asset and Export Quality",
            providerRole: "ppt-narration",
          },
          progressText:
            "S24 Asset and Export Quality stored 1 Qwen WAV audio asset for secure download.",
        }),
      ]),
    );
    expect(JSON.stringify(body)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(body)).not.toContain("ZmFrZS1wY20=");
    expect(JSON.stringify(body.progress)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(body.progress)).not.toContain("ZmFrZS1wY20=");
    expectRedactedAuditEvent(body.auditEvents[0], {
      provider: "qwen",
      providerRole: "ppt-narration",
      action: "ppt-narration-submit",
    });
    await expect(
      readUaisTeacherAiOwnershipRecord({
        baseDir: ownershipBaseDir,
        teacherId: "teacher-kang",
      }),
    ).resolves.toEqual({
      teacherId: "teacher-kang",
      courseIds: ["research-methods"],
      sampleAssets: [{ sampleAssetId: "asset-voice-10s", courseId: "research-methods" }],
      pptAssets: [{ pptAssetId: "research-methods-unit-3", courseId: "research-methods" }],
      clonedVoiceRefs: [
        {
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          sampleAssetId: "asset-voice-10s",
        },
      ],
      audioManifests: [
        {
          audioManifestId: "audio-manifest-research-methods-unit-3",
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        },
      ],
    });
    expectNoCredentialValues(body);
    expect(JSON.stringify(body)).not.toContain(ownershipBaseDir);
    await rm(ownershipBaseDir, { recursive: true, force: true });
  });

  it("rejects live Qwen PPT narration outside the teacher voice reference scope", async () => {
    let providerCalls = 0;
    let voiceReferenceReads = 0;
    const postWithFakeQwen = createPptNarrationPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async () => {
          providerCalls += 1;
          throw new Error("Unauthorized requests must not call Qwen.");
        },
        submitPptNarration: async () => {
          providerCalls += 1;
          throw new Error("Unauthorized requests must not call Qwen.");
        },
      }),
      readQwenClonedVoiceReference: async () => {
        voiceReferenceReads += 1;
        throw new Error("Unauthorized requests must not read private voice references.");
      },
    });
    const request = new Request("http://localhost/api/ai/ppt-narration", {
      method: "POST",
      headers: {
        ...liveApprovalHeaders,
        ...createUaisAiAccessSessionForTrustedActor({
          secret: aiAccessSigningSecret,
          now: stableFutureIssueTime,
          ttlSeconds: 3600,
          actor: {
            actorId: "teacher-kang",
            role: "teacher",
          },
          actions: ["ppt-narration-submit"],
          scopes: {
            teacherIds: ["teacher-kang"],
            courseIds: ["research-methods"],
            sampleAssetIds: ["teacher-kang-10s-sample"],
            pptAssetIds: ["research-methods-unit-3"],
            voiceRefIds: ["qwen-voice-ref-other-teacher"],
          },
        }).headers,
      },
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        voiceClone: {
          teacherId: "teacher-kang",
          consentConfirmed: true,
          sampleAssetId: "teacher-kang-10s-sample",
          sampleDurationSeconds: 10,
          language: "zh-CN",
          targetVoiceLabel: "Kang teacher PPT voice",
        },
        pptNarration: {
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          clonedVoiceRef: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          language: "zh-CN",
          slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
        },
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "voice-ref-scope-denied",
        responsibleSession: "S12",
        resource: expect.objectContaining({
          voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
        }),
      }),
    );
    expect(providerCalls).toBe(0);
    expect(voiceReferenceReads).toBe(0);
    expectNoCredentialValues(body);
  });

  it("rejects live Qwen PPT narration when the stored voice reference belongs to another teacher sample", async () => {
    let providerCalls = 0;
    let voiceReferenceReads = 0;
    const privateClonedVoiceId = "voice-qwen-private";
    const postWithFakeQwen = createPptNarrationPostHandler({
      env: {
        DASHSCOPE_API_KEY: "secret-qwen",
        UAIS_LIVE_AI_APPROVAL_TOKEN: liveApprovalToken,
      },
      createQwenVoiceClient: () => ({
        submitVoiceClone: async () => {
          providerCalls += 1;
          throw new Error("Mismatched voice references must not call Qwen.");
        },
        submitPptNarration: async () => {
          providerCalls += 1;
          throw new Error("Mismatched voice references must not call Qwen.");
        },
      }),
      readQwenClonedVoiceReference: async () => {
        voiceReferenceReads += 1;
        return {
          clonedVoiceId: privateClonedVoiceId,
          publicReference: {
            voiceRefId: "qwen-voice-ref-teacher-kang-asset-voice-10s",
            teacherId: "teacher-other",
            sampleAssetId: "asset-other",
            provider: "qwen",
            providerRole: "voice-clone",
            status: "ready",
            providerTaskId: "task-voice-live",
            targetModel: "qwen3-tts-vc-realtime-2026-01-15",
            voiceRef: "server-side-cloned-qwen-voice",
            storagePolicy: "local-private-cloned-voice-reference",
            responsibleSession: "S07/S12/S24",
          },
        };
      },
    });
    const request = new Request("http://localhost/api/ai/ppt-narration", {
      method: "POST",
      headers: {
        ...liveApprovalHeaders,
        ...signedTeacherAiAccessHeaders,
      },
      body: JSON.stringify({
        executionMode: "live",
        liveProviderApproved: true,
        voiceClone: {
          teacherId: "teacher-kang",
          consentConfirmed: true,
          sampleAssetId: "teacher-kang-10s-sample",
          sampleDurationSeconds: 10,
          language: "zh-CN",
          targetVoiceLabel: "Kang teacher PPT voice",
        },
        pptNarration: {
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          clonedVoiceRef: "qwen-voice-ref-teacher-kang-asset-voice-10s",
          language: "zh-CN",
          slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
        },
      }),
    });

    const response = await postWithFakeQwen(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Stored Qwen voice reference does not match");
    expect(providerCalls).toBe(0);
    expect(voiceReferenceReads).toBe(1);
    expect(JSON.stringify(body)).not.toContain(privateClonedVoiceId);
    expectNoCredentialValues(body);
  });

  it("rejects PPT narration requests with voice samples shorter than 10 seconds", async () => {
    const request = new Request("http://localhost/api/ai/ppt-narration", {
      method: "POST",
      headers: signedTeacherAiAccessHeaders,
      body: JSON.stringify({
        voiceClone: {
          teacherId: "teacher-kang",
          consentConfirmed: true,
          sampleAssetId: "teacher-kang-10s-sample",
          sampleDurationSeconds: 9,
          language: "zh-CN",
          targetVoiceLabel: "short sample",
        },
        pptNarration: {
          courseId: "research-methods",
          pptAssetId: "research-methods-unit-3",
          clonedVoiceId: "voice-qwen-redacted",
          language: "zh-CN",
          slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
        },
      }),
    });

    const response = await postPptNarration(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("at least 10 seconds");
  });

  it("serves generated PPT narration audio downloads by manifest and audio id", async () => {
    const getAudio = createPptNarrationAudioGetHandler({
      readPptNarrationAudioAsset: async ({ manifestId, audioId }) => {
        expect(manifestId).toBe("audio-manifest-research-methods-unit-3");
        expect(audioId).toBe("tts_research-methods-unit-3_s1");
        return {
          bytes: Buffer.from("RIFFfakeWAVE"),
          contentType: "audio/wav",
          filename: "tts_research-methods-unit-3_s1.wav",
          byteLength: 12,
        };
      },
    });

    const response = await getAudio(
      new Request(
        "http://localhost/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/tts_research-methods-unit-3_s1",
        { headers: signedTeacherAiAccessHeaders },
      ),
      {
        params: {
          manifestId: "audio-manifest-research-methods-unit-3",
          audioId: "tts_research-methods-unit-3_s1",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("content-disposition")).toContain(
      'filename="tts_research-methods-unit-3_s1.wav"',
    );
    expect(Buffer.from(await response.arrayBuffer()).toString("ascii")).toBe("RIFFfakeWAVE");
  });

  it("blocks local PPT narration audio download direct calls without a signed AI access session", async () => {
    let assetReads = 0;
    const getAudio = createPptNarrationAudioGetHandler({
      readPptNarrationAudioAsset: async () => {
        assetReads += 1;
        return {
          bytes: Buffer.from("RIFFfakeWAVE"),
          contentType: "audio/wav",
          filename: "tts_research-methods-unit-3_s1.wav",
          byteLength: 12,
        };
      },
    });

    const response = await getAudio(
      new Request(
        "http://localhost/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/tts_research-methods-unit-3_s1",
        { headers: teacherAiAccessHeaders },
      ),
      {
        params: {
          manifestId: "audio-manifest-research-methods-unit-3",
          audioId: "tts_research-methods-unit-3_s1",
        },
      },
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        authMode: "scoped-headers",
        responsibleSession: "S12",
      }),
    );
    expect(assetReads).toBe(0);
    expectNoCredentialValues(body);
  });

  it("blocks production PPT narration audio download direct calls before reading the asset", async () => {
    let assetReads = 0;
    const getAudio = createPptNarrationAudioGetHandler({
      readPptNarrationAudioAsset: async () => {
        assetReads += 1;
        return {
          bytes: Buffer.from("RIFFfakeWAVE"),
          contentType: "audio/wav",
          filename: "tts_research-methods-unit-3_s1.wav",
          byteLength: 12,
        };
      },
    });

    const response = await getAudio(
      new Request(
        "https://www.uais.top/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/tts_research-methods-unit-3_s1",
        { headers: teacherAiAccessHeaders },
      ),
      {
        params: {
          manifestId: "audio-manifest-research-methods-unit-3",
          audioId: "tts_research-methods-unit-3_s1",
        },
      },
    );

    await expectSignedSessionRequired(response, {
      action: "ppt-narration-audio-download",
      resource: {
        audioManifestId: "audio-manifest-research-methods-unit-3",
        audioId: "tts_research-methods-unit-3_s1",
      },
    });
    expect(assetReads).toBe(0);
  });

  it("rejects PPT narration audio downloads without actor ownership before reading the asset", async () => {
    let assetReads = 0;
    const getAudio = createPptNarrationAudioGetHandler({
      readPptNarrationAudioAsset: async () => {
        assetReads += 1;
        return {
          bytes: Buffer.from("RIFFfakeWAVE"),
          contentType: "audio/wav",
          filename: "tts_research-methods-unit-3_s1.wav",
          byteLength: 12,
        };
      },
    });

    const response = await getAudio(
      new Request(
        "http://localhost/api/ai/ppt-narration/audio/audio-manifest-research-methods-unit-3/tts_research-methods-unit-3_s1",
      ),
      {
        params: {
          manifestId: "audio-manifest-research-methods-unit-3",
          audioId: "tts_research-methods-unit-3_s1",
        },
      },
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
      }),
    );
    expect(assetReads).toBe(0);
    expectNoCredentialValues(body);
  });

  it("serves guarded PPT narration ZIP export packages by manifest id", async () => {
    const getExport = createPptNarrationExportGetHandler({
      createPptNarrationExportPackage: async ({ manifestId }) => {
        expect(manifestId).toBe("audio-manifest-research-methods-unit-3");
        return {
          bytes: Buffer.from("PK\u0003\u0004fakezip", "latin1"),
          contentType: "application/zip",
          filename: "audio-manifest-research-methods-unit-3-ppt-narration.zip",
          manifestId,
          assetCount: 1,
          byteLength: 11,
          responsibleSession: "S24",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    const response = await getExport(
      new Request(
        "http://localhost/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
        { headers: signedTeacherAiAccessHeaders },
      ),
      { params: { manifestId: "audio-manifest-research-methods-unit-3" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain(
      'filename="audio-manifest-research-methods-unit-3-ppt-narration.zip"',
    );
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString("latin1")).toBe(
      "PK\u0003\u0004",
    );
  });

  it("blocks local PPT narration ZIP export direct calls without a signed AI access session", async () => {
    let packageCreates = 0;
    const getExport = createPptNarrationExportGetHandler({
      createPptNarrationExportPackage: async () => {
        packageCreates += 1;
        return {
          bytes: Buffer.from("PK\u0003\u0004fakezip", "latin1"),
          contentType: "application/zip",
          filename: "audio-manifest-research-methods-unit-3-ppt-narration.zip",
          manifestId: "audio-manifest-research-methods-unit-3",
          assetCount: 1,
          byteLength: 11,
          responsibleSession: "S24",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    const response = await getExport(
      new Request(
        "http://localhost/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
        { headers: teacherAiAccessHeaders },
      ),
      { params: { manifestId: "audio-manifest-research-methods-unit-3" } },
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        authMode: "scoped-headers",
        responsibleSession: "S12",
      }),
    );
    expect(packageCreates).toBe(0);
    expectNoCredentialValues(body);
  });

  it("blocks production PPT narration ZIP export direct calls before creating the package", async () => {
    let packageCreates = 0;
    const getExport = createPptNarrationExportGetHandler({
      createPptNarrationExportPackage: async () => {
        packageCreates += 1;
        return {
          bytes: Buffer.from("PK\u0003\u0004fakezip", "latin1"),
          contentType: "application/zip",
          filename: "audio-manifest-research-methods-unit-3-ppt-narration.zip",
          manifestId: "audio-manifest-research-methods-unit-3",
          assetCount: 1,
          byteLength: 11,
          responsibleSession: "S24",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    const response = await getExport(
      new Request(
        "https://www.uais.top/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
        { headers: teacherAiAccessHeaders },
      ),
      { params: { manifestId: "audio-manifest-research-methods-unit-3" } },
    );

    await expectSignedSessionRequired(response, {
      action: "ppt-narration-export-download",
      resource: {
        audioManifestId: "audio-manifest-research-methods-unit-3",
      },
    });
    expect(packageCreates).toBe(0);
  });

  it("rejects PPT narration ZIP exports without actor ownership before creating the package", async () => {
    let packageCreates = 0;
    const getExport = createPptNarrationExportGetHandler({
      createPptNarrationExportPackage: async () => {
        packageCreates += 1;
        return {
          bytes: Buffer.from("PK\u0003\u0004fakezip", "latin1"),
          contentType: "application/zip",
          filename: "audio-manifest-research-methods-unit-3-ppt-narration.zip",
          manifestId: "audio-manifest-research-methods-unit-3",
          assetCount: 1,
          byteLength: 11,
          responsibleSession: "S24",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        };
      },
    });

    const response = await getExport(
      new Request(
        "http://localhost/api/ai/ppt-narration/export/audio-manifest-research-methods-unit-3",
      ),
      { params: { manifestId: "audio-manifest-research-methods-unit-3" } },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        responsibleSession: "S12",
      }),
    );
    expect(packageCreates).toBe(0);
    expectNoCredentialValues(body);
  });
});

function createSilentPcmWavBase64(input: { durationSeconds: number }) {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = Math.floor(input.durationSeconds * sampleRate * channels * bytesPerSample);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  return buffer.toString("base64");
}
