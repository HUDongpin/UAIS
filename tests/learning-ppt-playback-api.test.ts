import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLearningPptPlaybackAudioGetHandler,
} from "@/app/api/learning/ppt-playback/audio/[manifestId]/[audioId]/route";
import { GET as learningPptPlaybackGet } from "@/app/api/learning/ppt-playback/[courseId]/route";
import {
  createLearningPptPlaybackManifestForCourse,
  createPublishedLearningPptPlaybackManifestForCourse,
} from "@/lib/learning/ppt-playback";
import { authorizeLearningPptPlaybackAccess } from "@/lib/server/learning-ppt-playback-access";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const createLearningPptPlaybackManifestGetHandler =
  learningPptPlaybackGet.createForTesting;
const kangXiaManifestId =
  "audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1";
const appSessionSigningSecret = "test-learning-ppt-playback-app-session-secret";
const learningPptCourseId = "elementary-math-research";
const learningPptStudentId = "Peter";
const learningPptTeacherId = "teacher-kang";

function createStudentCookie(account = learningPptStudentId) {
  return createUaisAppSessionCookie(
    {
      account,
      department: "学生账号",
      displayName: account,
      role: "student",
    },
    {
      secret: appSessionSigningSecret,
      sessionId: `${account}-learning-ppt-session`,
      now: new Date("2026-06-22T12:00:00.000Z"),
      ttlSeconds: 365 * 24 * 60 * 60,
    },
  );
}

function createTeacherCookie(account = learningPptTeacherId) {
  return createUaisAppSessionCookie(
    {
      account,
      department: "教师账号",
      displayName: account,
      role: "teacher",
    },
    {
      secret: appSessionSigningSecret,
      sessionId: `${account}-learning-ppt-session`,
      now: new Date("2026-06-22T12:00:00.000Z"),
      ttlSeconds: 365 * 24 * 60 * 60,
    },
  );
}

async function createApprovedLearningPptPlaybackFixture(
  account = learningPptStudentId,
  options: {
    classCourseId?: string;
    classOwnerTeacherId?: string;
  } = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-learning-ppt-playback-access-"));
  await mkdir(dataDir, { recursive: true });
  const now = "2026-06-22T12:00:00.000Z";
  const classId = `${learningPptCourseId}-class-1`;
  const redaction = {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
  await writeFile(
    join(dataDir, "teaching-course-management.json"),
    JSON.stringify({
      schemaVersion: "uais-teaching-course-management-v1",
      updatedAt: now,
      courses: [
        {
          courseId: options.classCourseId ?? learningPptCourseId,
          ownerTeacherId: options.classOwnerTeacherId ?? "teacher-kang",
          courseName: "初等数学研究",
          instructor: "康霞",
          unit: "广州大学（404）",
          department: "实验教学中心",
          semester: "2026 春季",
          status: "draft",
          students: 1,
          createdAt: now,
          updatedAt: now,
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction,
        },
      ],
      classes: [
        {
          classId,
          courseId: learningPptCourseId,
          ownerTeacherId: "teacher-kang",
          className: "初等数学研究一班",
          students: 1,
          semester: "2026 春季",
          invitationCode: "55395057",
          joinUrl: "/courses?invite=55395057",
          createdAt: now,
          updatedAt: now,
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction,
        },
      ],
      memberships: [
        {
          membershipId: `membership-${classId}-${account}`,
          courseId: learningPptCourseId,
          classId,
          invitationCode: "55395057",
          studentId: account,
          studentDisplayName: account,
          membershipStatus: "approved",
          approvedAt: now,
          approvedByTeacherId: "teacher-kang",
          joinedAt: now,
          storagePolicy: "local-json-teaching-course-management",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          redaction,
        },
      ],
      auditEvents: [],
    }),
  );

  return {
    dataDir,
    cookie: createStudentCookie(account),
    env: {
      UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
      UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
    },
  };
}

function createStoredKangXiaManifest(assetCount = 2) {
  return {
    id: kangXiaManifestId,
    provider: "qwen" as const,
    providerRole: "ppt-narration" as const,
    targetModel: "qwen3-tts-vc-realtime-2026-01-15",
    courseId: "elementary-math-research",
    pptAssetId: "natural-number-ordinal-theory-ppt1",
    language: "zh-CN" as const,
    voiceRef: "server-side-cloned-qwen-voice" as const,
    sourcePattern: "openmaic-audio-id-download-assets" as const,
    retention: {
      classification: "course-ppt-narration-derived-audio" as const,
      policy: "retain-derived-audio-for-365-days-or-owner-request" as const,
      createdAt: "2026-06-16T14:19:41.044Z",
      deleteAfter: "2027-06-16T14:19:41.044Z",
      deleteAfterDays: 365 as const,
      responsibleSession: "S24" as const,
    },
    provenance: {
      provider: "qwen" as const,
      providerRole: "ppt-narration" as const,
      sourcePattern: "openmaic-audio-id-download-assets" as const,
      voiceRef: "server-side-cloned-qwen-voice" as const,
      generatedFrom: "qwen-realtime-tts" as const,
    },
    assets: Array.from({ length: assetCount }, (_, index) => {
      const slideNumber = String(index + 1).padStart(2, "0");
      return {
        slideId: `slide-${slideNumber}`,
        audioId: `tts_natural-number-ordinal-theory-ppt1_slide-${slideNumber}`,
        format: "wav" as const,
        sampleRateHz: 24000 as const,
        byteLength: 745004 - index * 1024,
        downloadUrl:
          `/api/ai/ppt-narration/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-${slideNumber}`,
      };
    }),
  };
}

describe("student PPT playback API", () => {
  it("validates the course, class, owner and approved membership relationship", async () => {
    const fixture = await createApprovedLearningPptPlaybackFixture();

    try {
      const access = await authorizeLearningPptPlaybackAccess({
        request: new Request(
          "http://localhost/api/learning-records/events",
          { headers: { cookie: fixture.cookie } },
        ),
        env: fixture.env,
        courseId: learningPptCourseId,
      });

      expect(access).toMatchObject({
        status: "authorized",
        reasonCode: "student-course-membership-approved",
        classId: `${learningPptCourseId}-class-1`,
      });
      expect(access).not.toHaveProperty("scopeProjection");
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["another course", { classCourseId: "another-course" }],
    ["another owner", { classOwnerTeacherId: "another-teacher" }],
  ])(
    "denies an approved membership whose class belongs to %s without an optional projection flag",
    async (_label, options) => {
      const fixture = await createApprovedLearningPptPlaybackFixture(
        learningPptStudentId,
        options,
      );

      try {
        const access = await authorizeLearningPptPlaybackAccess({
          request: new Request("http://localhost/api/learning/ppt-playback/course", {
            headers: { cookie: fixture.cookie },
          }),
          env: fixture.env,
          courseId: learningPptCourseId,
        });

        expect(access).toMatchObject({
          status: "denied",
          reasonCode: "student-course-membership-required",
        });
      } finally {
        await rm(fixture.dataDir, { recursive: true, force: true });
      }
    },
  );

  it("blocks the learning PPT playback manifest without an app session", async () => {
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: {
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
      },
    });

    const response = await handler(
      new Request("http://localhost/api/learning/ppt-playback/elementary-math-research"),
      { params: { courseId: "elementary-math-research" } },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual(
      expect.objectContaining({
        error: "UAIS learning PPT playback app session is required.",
        access: expect.objectContaining({
          status: "denied",
          reasonCode: "student-session-required",
          responsibleSession: "S12",
        }),
      }),
    );
    expect(body).not.toHaveProperty("playback");
  });

  it("blocks the learning PPT playback manifest for a signed student without course membership", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-learning-ppt-no-membership-"));
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: {
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/learning/ppt-playback/elementary-math-research", {
          headers: {
            cookie: createStudentCookie("StudentWithoutMembership"),
          },
        }),
        { params: { courseId: "elementary-math-research" } },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS learning PPT playback course membership is required.",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "student-course-membership-required",
            actor: {
              actorId: "StudentWithoutMembership",
              role: "student",
            },
            resource: {
              courseId: "elementary-math-research",
            },
          }),
        }),
      );
      expect(body).not.toHaveProperty("playback");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks learning PPT playback audio without an app session", async () => {
    const handler = createLearningPptPlaybackAudioGetHandler({
      env: {
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
      },
      readPptNarrationAudioAsset: async () => ({
        bytes: Buffer.from("RIFF----WAVEfmt data"),
        contentType: "audio/wav",
        filename: "tts_natural-number-ordinal-theory-ppt1_slide-01.wav",
        byteLength: 21,
      }),
    });

    const response = await handler(
      new Request(
        "http://localhost/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
      ),
      {
        params: {
          manifestId: kangXiaManifestId,
          audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual(
      expect.objectContaining({
        error: "UAIS learning PPT playback app session is required.",
        access: expect.objectContaining({
          status: "denied",
          reasonCode: "student-session-required",
          responsibleSession: "S12",
        }),
      }),
    );
  });

  it("creates the published Kang Xia playback manifest from catalog metadata", () => {
    const playback = createPublishedLearningPptPlaybackManifestForCourse(
      "elementary-math-research",
    );

    expect(playback?.slideCount).toBe(19);
    expect(playback?.slides.at(0)).toEqual(
      expect.objectContaining({
        slideId: "slide-01",
        audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
        imageUrl:
          "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg",
        audioUrl:
          "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
        durationSeconds: 15.52,
      }),
    );
    expect(playback?.slides.at(-1)).toEqual(
      expect.objectContaining({
        slideId: "slide-19",
        audioId: "tts_natural-number-ordinal-theory-ppt1_slide-19",
        imageUrl:
          "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-19.jpg",
        audioUrl:
          "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-19",
        durationSeconds: 15.68,
      }),
    );
    const serialized = JSON.stringify(playback);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("server-side-cloned-qwen-voice");
    expect(serialized).not.toContain("DASHSCOPE_API_KEY");
  });

  it("maps the full published Kang Xia natural-number deck to 19 student-playable slide audios", () => {
    const playback = createLearningPptPlaybackManifestForCourse({
      courseId: "elementary-math-research",
      storedManifest: createStoredKangXiaManifest(19),
    });

    expect(playback?.slideCount).toBe(19);
    expect(playback?.slides.at(0)).toEqual(
      expect.objectContaining({
        slideId: "slide-01",
        slideTitle: "自然数的序数理论",
        imageUrl:
          "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg",
        audioUrl:
          "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
      }),
    );
    expect(playback?.slides.at(-1)).toEqual(
      expect.objectContaining({
        slideId: "slide-19",
        slideTitle: "作业布置",
        imageUrl:
          "/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-19.jpg",
        audioUrl:
          "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-19",
      }),
    );
  });

  it("publishes Kang Xia cloned-voice PPT narration as a student-safe playback manifest", async () => {
    const fixture = await createApprovedLearningPptPlaybackFixture();
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: fixture.env,
      readStoredManifest: async () => createStoredKangXiaManifest(),
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/learning/ppt-playback/elementary-math-research", {
          headers: {
            cookie: fixture.cookie,
          },
        }),
        { params: { courseId: "elementary-math-research" } },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "authorized",
          reasonCode: "student-course-membership-approved",
          actor: {
            actorId: "Peter",
            role: "student",
          },
          resource: {
            courseId: "elementary-math-research",
          },
        }),
      );
      expect(body.playback).toEqual(
        expect.objectContaining({
          status: "ready",
          courseId: "elementary-math-research",
          audioManifestId: kangXiaManifestId,
          teacherName: "康霞博士",
          voiceLabel: "康霞博士克隆声音",
          slideCount: 2,
        }),
      );
      expect(body.playback.slides[0]).toEqual(
        expect.objectContaining({
          slideId: "slide-01",
          slideNumber: 1,
          audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
          audioUrl:
            "/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
          narrationText: expect.stringContaining("自然数的序数理论"),
        }),
      );

      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("/api/ai/ppt-narration/audio");
      expect(serialized).not.toContain("server-side-cloned-qwen-voice");
      expect(serialized).not.toContain("DASHSCOPE_API_KEY");
      expect(serialized).not.toContain("/Users/");
      expect(body.playback.redaction).toEqual({
        secrets: "omitted",
        localFiles: "omitted",
        assets: "published-learning-ids-only",
      });
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it("allows the owning teacher to preview the Kang Xia playback manifest", async () => {
    const fixture = await createApprovedLearningPptPlaybackFixture();
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: fixture.env,
      readStoredManifest: async () => createStoredKangXiaManifest(),
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/learning/ppt-playback/elementary-math-research", {
          headers: {
            cookie: createTeacherCookie(),
          },
        }),
        { params: { courseId: "elementary-math-research" } },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "authorized",
          reasonCode: "teacher-course-ownership-approved",
          actor: {
            actorId: "teacher-kang",
            role: "teacher",
          },
          resource: {
            courseId: "elementary-math-research",
          },
        }),
      );
      expect(body.access).not.toHaveProperty("membershipId");
      expect(body.access).not.toHaveProperty("classId");
      expect(body.playback).toEqual(
        expect.objectContaining({
          status: "ready",
          courseId: "elementary-math-research",
          teacherName: "康霞博士",
          slideCount: 2,
        }),
      );
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it("restores the published Kang Xia PPT for the local demo teacher without seeded course ownership", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-learning-ppt-local-demo-"));
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: {
        NODE_ENV: "development",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/learning/ppt-playback/elementary-math-research", {
          headers: { cookie: createTeacherCookie("Phoebe") },
        }),
        { params: { courseId: "elementary-math-research" } },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "authorized",
          reasonCode: "teacher-demo-published-playback-approved",
          actor: { actorId: "Phoebe", role: "teacher" },
        }),
      );
      expect(body.playback).toEqual(
        expect.objectContaining({
          courseId: "elementary-math-research",
          teacherName: "康霞博士",
          voiceLabel: "康霞博士克隆声音",
          slideCount: 19,
        }),
      );
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("restores the published Kang Xia PPT for the explicitly opted-in Production demo teacher", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-learning-ppt-production-demo-"));
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH: "true",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
    });

    try {
      const response = await handler(
        new Request("https://www.uais.top/api/learning/ppt-playback/elementary-math-research", {
          headers: { cookie: createTeacherCookie("Phoebe") },
        }),
        { params: { courseId: "elementary-math-research" } },
      );
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "authorized",
          reasonCode: "teacher-demo-published-playback-approved",
          actor: { actorId: "Phoebe", role: "teacher" },
        }),
      );
      expect(body.playback).toEqual(
        expect.objectContaining({
          courseId: "elementary-math-research",
          teacherName: "康霞博士",
          slideCount: 19,
        }),
      );
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("does not enable Production demo playback without the explicit opt-in", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-learning-ppt-production-blocked-"));
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: {
        NODE_ENV: "production",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
    });

    try {
      const response = await handler(
        new Request("https://www.uais.top/api/learning/ppt-playback/elementary-math-research", {
          headers: { cookie: createTeacherCookie("Phoebe") },
        }),
        { params: { courseId: "elementary-math-research" } },
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body).not.toHaveProperty("playback");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("does not enable demo playback on a deployed preview even when the Production opt-in name is present", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-learning-ppt-preview-blocked-"));
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: {
        NODE_ENV: "development",
        UAIS_DEPLOYMENT_ENV: "preview",
        UAIS_APP_AUTH_PROVIDER: "local-demo",
        UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH: "true",
        UAIS_APP_SESSION_SIGNING_SECRET: appSessionSigningSecret,
        UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
      },
    });

    try {
      const response = await handler(
        new Request("https://preview.uais.top/api/learning/ppt-playback/elementary-math-research", {
          headers: { cookie: createTeacherCookie("Phoebe") },
        }),
        { params: { courseId: "elementary-math-research" } },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.access).toEqual(
        expect.objectContaining({
          status: "denied",
          reasonCode: "teacher-course-ownership-required",
        }),
      );
      expect(body).not.toHaveProperty("playback");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("blocks a signed teacher who does not own the Kang Xia playback course", async () => {
    const fixture = await createApprovedLearningPptPlaybackFixture();
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: fixture.env,
      readStoredManifest: async () => createStoredKangXiaManifest(),
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/learning/ppt-playback/elementary-math-research", {
          headers: {
            cookie: createTeacherCookie("teacher-without-course"),
          },
        }),
        { params: { courseId: "elementary-math-research" } },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual(
        expect.objectContaining({
          error: "UAIS learning PPT playback requires teaching course ownership.",
          access: expect.objectContaining({
            status: "denied",
            reasonCode: "teacher-course-ownership-required",
            actor: {
              actorId: "teacher-without-course",
              role: "teacher",
            },
            resource: {
              courseId: "elementary-math-research",
            },
          }),
        }),
      );
      expect(body).not.toHaveProperty("playback");
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it("keeps manifest GET side-effect free so events can only use Postgres plus outbox", async () => {
    const fixture = await createApprovedLearningPptPlaybackFixture();
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: fixture.env,
      readStoredManifest: async () => createStoredKangXiaManifest(),
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/learning/ppt-playback/elementary-math-research", {
          headers: {
            cookie: fixture.cookie,
          },
        }),
        { params: { courseId: "elementary-math-research" } },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).not.toHaveProperty("learningEvent");
      expect(body).not.toHaveProperty("lrs");
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it("localizes the published PPT manifest for the English learning interface", async () => {
    const fixture = await createApprovedLearningPptPlaybackFixture();
    const handler = createLearningPptPlaybackManifestGetHandler({
      env: fixture.env,
      readStoredManifest: async () => createStoredKangXiaManifest(),
    });

    try {
      const response = await handler(
        new Request("http://localhost/api/learning/ppt-playback/elementary-math-research?locale=en-US", {
          headers: {
            cookie: fixture.cookie,
          },
        }),
        { params: { courseId: "elementary-math-research" } },
      );
      const body = await response.json();
      const localizedSurface = JSON.stringify({
        ...body.playback,
        learningUnit: {
          ...body.playback.learningUnit,
          title: body.playback.learningUnit.title["en-US"],
        },
      });

      expect(response.status).toBe(200);
      expect(body.playback).toEqual(
        expect.objectContaining({
          courseTitle: "Elementary Mathematics Research",
          teacherName: "Dr. Kang Xia",
          voiceLabel: "Dr. Kang Xia cloned voice",
        }),
      );
      expect(body.playback.slides[0]).toEqual(
        expect.objectContaining({
          slideTitle: "Ordinal theory of natural numbers",
          narrationText: expect.stringContaining("natural numbers"),
        }),
      );
      expect(body.playback.slides[1]).toEqual(
        expect.objectContaining({
          slideTitle: "Learning path",
          narrationText: expect.stringContaining("three core threads"),
        }),
      );
      expect(body.playback.learningUnit.title["zh-CN"]).toMatch(/\p{Script=Han}/u);
      expect(localizedSurface).not.toMatch(/\p{Script=Han}/u);
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it("serves only published learning audio without requiring teacher AI access headers", async () => {
    const fixture = await createApprovedLearningPptPlaybackFixture();
    const wavBytes = Buffer.from("RIFF----WAVEfmt data");
    const handler = createLearningPptPlaybackAudioGetHandler({
      env: fixture.env,
      readPptNarrationAudioAsset: async () => ({
        bytes: wavBytes,
        contentType: "audio/wav",
        filename: "tts_natural-number-ordinal-theory-ppt1_slide-01.wav",
        byteLength: wavBytes.byteLength,
      }),
    });

    try {
      const response = await handler(
        new Request(
          "http://localhost/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
          {
            headers: {
              cookie: fixture.cookie,
            },
          },
        ),
        {
          params: {
            manifestId: kangXiaManifestId,
            audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
          },
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/wav");
      expect(response.headers.get("content-disposition")).toContain(
        "tts_natural-number-ordinal-theory-ppt1_slide-01.wav",
      );
      expect(response.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
      expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe(
        "RIFF----WAVEfmt data",
      );
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it("serves published learning audio to the owning teacher preview", async () => {
    const fixture = await createApprovedLearningPptPlaybackFixture();
    const wavBytes = Buffer.from("RIFF----WAVEfmt data");
    const handler = createLearningPptPlaybackAudioGetHandler({
      env: fixture.env,
      readPptNarrationAudioAsset: async () => ({
        bytes: wavBytes,
        contentType: "audio/wav",
        filename: "tts_natural-number-ordinal-theory-ppt1_slide-01.wav",
        byteLength: wavBytes.byteLength,
      }),
    });

    try {
      const response = await handler(
        new Request(
          "http://localhost/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
          {
            headers: {
              cookie: createTeacherCookie(),
            },
          },
        ),
        {
          params: {
            manifestId: kangXiaManifestId,
            audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
          },
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/wav");
      expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe(
        "RIFF----WAVEfmt data",
      );
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it("supports browser byte-range requests so the learning audio slider can seek", async () => {
    const fixture = await createApprovedLearningPptPlaybackFixture();
    const wavBytes = Buffer.from("0123456789abcdef");
    const handler = createLearningPptPlaybackAudioGetHandler({
      env: fixture.env,
      readPptNarrationAudioAsset: async () => ({
        bytes: wavBytes,
        contentType: "audio/wav",
        filename: "tts_natural-number-ordinal-theory-ppt1_slide-01.wav",
        byteLength: wavBytes.byteLength,
      }),
    });

    try {
      const response = await handler(
        new Request(
          "http://localhost/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
          {
            headers: {
              cookie: fixture.cookie,
              range: "bytes=4-9",
            },
          },
        ),
        {
          params: {
            manifestId: kangXiaManifestId,
            audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
          },
        },
      );

      expect(response.status).toBe(206);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("content-range")).toBe("bytes 4-9/16");
      expect(response.headers.get("content-length")).toBe("6");
      expect(response.headers.get("content-type")).toBe("audio/wav");
      expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("456789");
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });

  it("serves the published public WAV asset with a release-gate-safe audio/wav header when local narration storage is absent", async () => {
    const fixture = await createApprovedLearningPptPlaybackFixture();
    const handler = createLearningPptPlaybackAudioGetHandler({
      env: fixture.env,
      readPptNarrationAudioAsset: async () => {
        throw new Error("local storage missing");
      },
    });

    try {
      const response = await handler(
        new Request(
          "https://www.uais.top/api/learning/ppt-playback/audio/audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1/tts_natural-number-ordinal-theory-ppt1_slide-01",
          {
            headers: {
              cookie: fixture.cookie,
            },
          },
        ),
        {
          params: {
            manifestId: kangXiaManifestId,
            audioId: "tts_natural-number-ordinal-theory-ppt1_slide-01",
          },
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/wav");
      expect(response.headers.get("content-disposition")).toContain(
        "tts_natural-number-ordinal-theory-ppt1_slide-01.wav",
      );
      expect(response.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(body.subarray(8, 12).toString("ascii")).toBe("WAVE");
    } finally {
      await rm(fixture.dataDir, { recursive: true, force: true });
    }
  });
});
