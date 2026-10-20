import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTeachingOperationActionPostHandler } from "@/app/api/teaching/operations/handler";
import {
  createTeachingCourseRecord,
  readTeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-store";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";

import { teachingUnitDraftContent } from "./fixtures/teaching-unit-draft-content";

const now = new Date("2026-10-20T08:00:00.000Z");
const content = teachingUnitDraftContent;
const paths: string[] = [];

async function setup(providerBody: unknown = { choices: [{ message: { content: JSON.stringify(content) } }] }) {
  const root = await mkdtemp(join(tmpdir(), "uais-unit-draft-route-"));
  paths.push(root);
  const dataDir = join(root, "courses");
  const { course } = await createTeachingCourseRecord({
    dataDir, actorId: "teacher-draft", now,
    draft: { name: "Research Methods", instructor: "Teacher", unit: "University", department: "Education", semester: "2026" },
  });
  const env = {
    UAIS_TEACHING_OPERATIONS_DATA_DIR: join(root, "operations"),
    UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
    UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: "unit-draft-test-session-secret-32-chars",
    DEEPSEEK_API_KEY: "unit-draft-test-provider-key",
  };
  const cookie = createUaisTeacherAuthSessionCookieHeader({
    secret: env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET,
    claims: { sessionId: "unit-draft-route-session", actorId: "teacher-draft", role: "teacher", authenticatedAt: "2026-10-20T07:00:00.000Z", expiresAt: "2026-10-20T09:00:00.000Z" },
  });
  const fetchProvider = vi.fn<typeof fetch>().mockResolvedValue(Response.json(providerBody));
  const deps = {
    env, now, fetch: fetchProvider,
    getTeachingOperationCourseOwnership: async () => ({ teacherId: "teacher-draft", courseIds: [course.courseId] }),
  };
  const request = (key = "unit-draft-generation-request") => new Request("http://localhost/api/teaching/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ operationId: "content", actionSlot: "secondary", courseId: course.courseId, idempotencyKey: key, locale: "en-US" }),
  });
  return { dataDir, course, deps, request, fetchProvider };
}

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("generated teaching unit body through the operation route", () => {
  it("persists provider content and rereads it on an idempotent retry without another provider call", async () => {
    const fixture = await setup();
    const post = createTeachingOperationActionPostHandler(fixture.deps);
    const response = await post(fixture.request());
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    const database = await readTeachingCourseManagementDatabase({ dataDir: fixture.dataDir });
    expect(database.courseUnitDrafts?.[0]).toMatchObject({
      courseId: fixture.course.courseId,
      operationRecordId: body.receipt.receiptId,
      draftStatus: "generated",
      content,
    });
    const retry = await post(fixture.request());
    expect(retry.status).toBe(200);
    expect(fixture.fetchProvider).toHaveBeenCalledTimes(1);
    const providerRequest = JSON.parse(String(fixture.fetchProvider.mock.calls[0][1]?.body));
    expect(JSON.stringify(providerRequest.messages)).toContain("Research Methods");
    expect(JSON.stringify(providerRequest.messages)).toContain("en-US");
  });

  it("fails without a provider instead of reporting a metadata-only generation", async () => {
    const fixture = await setup();
    const post = createTeachingOperationActionPostHandler({
      ...fixture.deps, env: { ...fixture.deps.env, DEEPSEEK_API_KEY: "" },
    });
    const response = await post(fixture.request());
    expect(response.status).toBe(503);
    expect(fixture.fetchProvider).not.toHaveBeenCalled();
    const database = await readTeachingCourseManagementDatabase({ dataDir: fixture.dataDir });
    expect(database.courseUnitDrafts ?? []).toHaveLength(0);
  });

  it("rejects incomplete provider output without replacing a valid saved draft", async () => {
    const fixture = await setup();
    const post = createTeachingOperationActionPostHandler(fixture.deps);
    expect((await post(fixture.request())).status).toBe(200);
    fixture.fetchProvider.mockResolvedValueOnce(Response.json({
      choices: [{ message: { content: JSON.stringify({ title: "An empty outline" }) } }],
    }));
    const failure = await post(fixture.request("unit-draft-invalid-regeneration"));
    expect(failure.status).toBe(502);
    const database = await readTeachingCourseManagementDatabase({ dataDir: fixture.dataDir });
    expect(database.courseUnitDrafts?.[0]).toMatchObject({ content });
  });

  it("rejects unauthorized generation before calling the provider", async () => {
    const fixture = await setup();
    const post = createTeachingOperationActionPostHandler({
      ...fixture.deps,
      getTeachingOperationCourseOwnership: async () => ({ teacherId: "teacher-draft", courseIds: [] }),
    });
    expect((await post(fixture.request())).status).toBe(403);
    expect(fixture.fetchProvider).not.toHaveBeenCalled();
  });
});
