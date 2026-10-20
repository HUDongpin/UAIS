import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTeachingUnitDraftGetHandler,
  createTeachingUnitDraftPatchHandler,
} from "@/app/api/teaching/courses/[courseId]/unit-draft/handler";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import {
  createTeachingCourseRecord,
  saveTeachingCourseUnitDraftRecord,
} from "@/lib/server/teaching-course-management-store";

const now = new Date("2026-10-20T02:00:00.000Z");
const secret = "synthetic-unit-draft-api-session-secret";
const content = {
  title: "Evaluating evidence",
  objectives: ["Compare two claims using the evidence provided."],
  activities: [{
    title: "Compare the claims",
    durationMinutes: 15,
    instructions: "Read the two claims and explain which evidence supports each.",
  }],
  lectureScript: "A claim expresses a conclusion. Evidence gives us grounds to evaluate that conclusion.",
  questions: [{
    prompt: "What makes evidence relevant to a claim?",
    referenceAnswer: "It directly supports or challenges the claim being evaluated.",
  }],
};

let dataDir: string;
let courseId: string;
let env: Record<string, string | undefined>;

function teacherCookie(actorId = "teacher-owner") {
  return createUaisTeacherAuthSessionCookieHeader({
    secret,
    claims: {
      actorId,
      role: "teacher",
      sessionId: `unit-draft-${actorId}`,
      authenticatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    },
  });
}

function request(method = "GET", body?: unknown, cookie = teacherCookie()) {
  return new Request(`http://localhost/api/teaching/courses/${courseId}/unit-draft`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function context() {
  return { params: Promise.resolve({ courseId }) };
}

async function seedDraft() {
  return saveTeachingCourseUnitDraftRecord({
    dataDir,
    actorId: "teacher-owner",
    courseId,
    operationRecordId: "synthetic-unit-draft-operation",
    generateContent: async () => content,
    now,
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "uais-unit-draft-api-"));
  env = {
    NODE_ENV: "test",
    UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
    UAIS_TEACHER_AI_OWNERSHIP_DIR: join(dataDir, "synthetic-ownership"),
    UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: secret,
    UAIS_APP_SESSION_SIGNING_SECRET: secret,
  };
  const result = await createTeachingCourseRecord({
    dataDir,
    actorId: "teacher-owner",
    draft: {
      name: "Evidence evaluation",
      instructor: "Synthetic teacher",
      unit: "Evidence",
      department: "Education",
      semester: "Synthetic semester",
    },
    now,
  });
  courseId = result.course.courseId;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("teaching unit draft API", () => {
  it("returns persisted teaching content for its authenticated course owner", async () => {
    await seedDraft();
    const get = createTeachingUnitDraftGetHandler({ env, now });
    const response = await get(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      unitDraft: { courseId, content, revision: 1, draftStatus: "generated" },
    });
  });

  it("returns 404 for a course without a generated draft", async () => {
    const get = createTeachingUnitDraftGetHandler({ env, now });
    const response = await get(request(), context());
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("unitDraft");
  });

  it.each(["GET", "PATCH"])("requires a signed teacher session for %s", async (method) => {
    const handler = method === "GET"
      ? createTeachingUnitDraftGetHandler({ env, now })
      : createTeachingUnitDraftPatchHandler({ env, now });
    const response = await handler(request(method, method === "PATCH" ? {} : undefined, ""), context());
    expect(response.status).toBe(401);
  });

  it.each(["student", "admin"] as const)("rejects an active %s app role even with a teacher cookie", async (role) => {
    const cookie = `${teacherCookie()}; ${createUaisAppSessionCookie({
      account: "teacher-owner",
      department: "Synthetic",
      displayName: "Synthetic account",
      role,
    }, { secret, now })}`;
    const get = createTeachingUnitDraftGetHandler({ env, now });
    const response = await get(request("GET", undefined, cookie), context());
    expect(response.status).toBe(403);
  });

  it.each(["GET", "PATCH"])("denies another teacher's %s access before reading content", async (method) => {
    await seedDraft();
    const handler = method === "GET"
      ? createTeachingUnitDraftGetHandler({ env, now })
      : createTeachingUnitDraftPatchHandler({ env, now });
    const response = await handler(request(
      method,
      method === "PATCH" ? { content, expectedRevision: 1 } : undefined,
      teacherCookie("teacher-other"),
    ), context());
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("unitDraft");
  });

  it("saves editable content and returns a conflict for stale revisions", async () => {
    await seedDraft();
    const patch = createTeachingUnitDraftPatchHandler({ env, now });
    const updatedContent = { ...content, lectureScript: "Teacher-edited teaching explanation." };
    const response = await patch(request("PATCH", { content: updatedContent, expectedRevision: 1 }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      unitDraft: { content: updatedContent, revision: 2 },
    });
    const staleResponse = await patch(request("PATCH", { content, expectedRevision: 1 }), context());
    expect(staleResponse.status, await staleResponse.clone().text()).toBe(409);
    expect(await staleResponse.json()).toMatchObject({ reasonCode: "unit-draft-revision-conflict" });
    const readback = await createTeachingUnitDraftGetHandler({ env, now })(request(), context());
    expect(await readback.json()).toMatchObject({ unitDraft: { content: updatedContent, revision: 2 } });
  });

  it.each([
    { content, expectedRevision: -1 },
    { content, expectedRevision: "1" },
    { content: { ...content, objectives: [] }, expectedRevision: 1 },
    { content: { ...content, lectureScript: "" }, expectedRevision: 1 },
  ])("rejects invalid edits without changing persisted content", async (body) => {
    await seedDraft();
    const response = await createTeachingUnitDraftPatchHandler({ env, now })(request("PATCH", body), context());
    expect(response.status).toBe(400);
    const readback = await createTeachingUnitDraftGetHandler({ env, now })(request(), context());
    expect(await readback.json()).toMatchObject({ unitDraft: { content, revision: 1 } });
  });

  it("authorizes the exact delegated content capability for read and edit", async () => {
    await seedDraft();
    const readTeachingCourseCapability = vi.fn(async () => ({
      authorized: true as const,
      reasonCode: "collaborator-exact-scope" as const,
      capability: "course.content.write" as const,
      grantId: "00000000-0000-4000-8000-000000000121",
      revision: 3,
    }));
    const deps = { env, now, readTeachingCourseCapability };
    const cookie = teacherCookie("teacher-collaborator");
    const getResponse = await createTeachingUnitDraftGetHandler(deps)(request("GET", undefined, cookie), context());
    expect(getResponse.status).toBe(200);
    const patchResponse = await createTeachingUnitDraftPatchHandler(deps)(
      request("PATCH", { content: { ...content, title: "Collaborator edit" }, expectedRevision: 1 }, cookie),
      context(),
    );
    expect(patchResponse.status).toBe(200);
    expect(readTeachingCourseCapability).toHaveBeenCalledWith({
      principalAccount: "teacher-collaborator",
      courseId,
      capability: "course.content.write",
    });
  });

  it("rejects a collaborator without the content capability", async () => {
    const get = createTeachingUnitDraftGetHandler({
      env,
      now,
      readTeachingCourseCapability: async () => ({ authorized: false, reasonCode: "collaborator-scope-required" }),
    });
    const response = await get(request("GET", undefined, teacherCookie("teacher-collaborator")), context());
    expect(response.status).toBe(403);
  });

  it("rejects malformed and oversized JSON bodies", async () => {
    await seedDraft();
    const patch = createTeachingUnitDraftPatchHandler({ env, now });
    for (const [body, status] of [["{", 400], [" ".repeat(200_001), 413]] as const) {
      const response = await patch(new Request("http://localhost/api/unit-draft", {
        method: "PATCH",
        headers: { cookie: teacherCookie(), "content-type": "application/json" },
        body,
      }), context());
      expect(response.status).toBe(status);
    }
  });

  it("blocks production without ready teacher authentication and durable course storage", async () => {
    const productionEnv = { ...env, NODE_ENV: "production" };
    const authResponse = await createTeachingUnitDraftGetHandler({ env: productionEnv, now })(request(), context());
    expect(authResponse.status).toBe(503);
    const storageResponse = await createTeachingUnitDraftGetHandler({
      env: {
        ...productionEnv,
        UAIS_TEACHER_AUTH_PROVIDER: "trusted-cookie-issuer",
        UAIS_TEACHER_AUTH_ISSUER_SECRET: "synthetic-separate-teacher-issuer-secret",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "local-json",
      },
      now,
    })(request(), context());
    expect(storageResponse.status).toBe(503);
  });

  it("does not expose backend exception text", async () => {
    const response = await createTeachingUnitDraftGetHandler({
      env,
      now,
      readManagedCourseOwnership: async () => { throw new Error("private-backend-location-and-token"); },
    })(request(), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-backend-location-and-token");
  });
});
