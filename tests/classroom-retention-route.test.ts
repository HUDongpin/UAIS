import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

async function routeModule() {
  expect(
    existsSync("src/app/api/teaching/courses/[courseId]/retention/handler.ts"),
    "retention is accessible through an authenticated teacher route",
  ).toBe(true);
  const path =
    "../src/app/api/teaching/courses/[courseId]/retention/handler.ts";
  return import(path);
}
const context = { params: Promise.resolve({ courseId: "course-one" }) };
const owner = {
  status: "authorized",
  teacherAccount: "teacher-one",
  reasonCode: "teacher-dual-session-course-owner",
  course: { externalId: "course-one", title: "Math" },
  classes: [],
};
describe("teacher course retention route", () => {
  it("rejects a cross-origin purge before authorizing or touching records", async () => {
    const { createCourseRetentionHandlers } = await routeModule();
    const authorize = vi.fn(async () => owner),
      purge = vi.fn();
    const handler = createCourseRetentionHandlers({
      env: { UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres" },
      authorize,
      store: { purge },
    });
    const response = await handler.POST(
      new Request("http://internal:3000/api/retention", {
        method: "POST",
        headers: {
          host: "uais.test",
          origin: "https://outside.test",
          "x-forwarded-proto": "https",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "purge",
          confirm: true,
          confirmationDigest: "a".repeat(64),
        }),
      }),
      context,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      reasonCode: "same-origin-required",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
  });
  it("accepts the browser's routed same-origin Host despite an internal request URL", async () => {
    const { createCourseRetentionHandlers } = await routeModule();
    const close = vi.fn(async () => ({ closedAt: "2026-10-26" }));
    const handler = createCourseRetentionHandlers({
      env: { UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres" },
      authorize: async () => owner,
      store: { close },
    });
    const response = await handler.POST(
      new Request("http://internal:3000/api/retention", {
        method: "POST",
        headers: {
          host: "uais.test",
          origin: "https://uais.test",
          "x-forwarded-proto": "https",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "close", confirm: true }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(close).toHaveBeenCalledWith({
      courseId: "course-one",
      teacherAccount: "teacher-one",
    });
  });
  it.each(["external", "local-json"])(
    "refuses incomplete retention on the %s backend",
    async (backend) => {
      const { createCourseRetentionHandlers } = await routeModule();
      const read = vi.fn();
      const handler = createCourseRetentionHandlers({
        env: { UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: backend },
        authorize: async () => owner,
        store: { read },
      });
      const response = await handler.GET(
        new Request("https://uais.test/api/retention"),
        context,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        reasonCode: "course-retention-postgres-required",
      });
      expect(read).not.toHaveBeenCalled();
    },
  );
  it("rejects an unauthorised teacher before any retention operation", async () => {
    const { createCourseRetentionHandlers } = await routeModule();
    const read = vi.fn();
    const handler = createCourseRetentionHandlers({
      authorize: async () => ({
        status: "denied",
        reasonCode: "teacher-course-ownership-required",
      }),
      store: { read },
    });
    expect(
      (
        await handler.GET(
          new Request("https://uais.test/api/retention"),
          context,
        )
      ).status,
    ).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });
  it("requires an explicit close confirmation", async () => {
    const { createCourseRetentionHandlers } = await routeModule();
    const close = vi.fn();
    const handler = createCourseRetentionHandlers({
      env: { UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres" },
      authorize: async () => owner,
      store: { close },
    });
    const response = await handler.POST(
      new Request("https://uais.test/api/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(close).not.toHaveBeenCalled();
  });
  it("binds a purge confirmation to the route course and authenticated teacher", async () => {
    const { createCourseRetentionHandlers } = await routeModule();
    const purge = vi.fn(async () => ({ purgedAt: "2026-07-01" }));
    const handler = createCourseRetentionHandlers({
      env: { UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres" },
      authorize: async () => owner,
      store: { purge },
    });
    const response = await handler.POST(
      new Request("https://uais.test/api/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "purge",
          confirm: true,
          confirmationDigest: "a".repeat(64),
          teacherAccount: "forged",
          courseId: "other",
        }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(purge).toHaveBeenCalledWith({
      courseId: "course-one",
      teacherAccount: "teacher-one",
      confirmationDigest: "a".repeat(64),
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
