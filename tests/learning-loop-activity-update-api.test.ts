import { describe, expect, it, vi } from "vitest";
import { createTeachingActivityPatchHandler } from "./helpers/learning-loop-route-factories";
import { LearningLoopStoreError } from "@/lib/learning-loop/postgres-store";

const access = {
  status: "authorized" as const,
  reasonCode: "teacher-dual-session-course-owner" as const,
  teacherAccount: "teacher-1",
  course: { externalId: "course-1", title: "Course one" },
  classes: [{ externalId: "class-1", name: "Class one" }],
  lesson: {
    key: "lesson-1",
    position: 1,
    title: { "zh-CN": "第一讲", "en-US": "Lesson one" },
    manifestRef: "manifest-1",
  },
};

describe("P1 teacher activity update API", () => {
  it("authorizes the stored scope, publishes with optimistic revision, and reads back", async () => {
    const updateActivity = vi.fn(async () => ({
      status: "persisted" as const,
      resourceId: "activity-1",
      state: "published",
      revision: 3,
      traceId: "trace-publish-1",
      persistedAt: "2026-08-20T18:20:00.000Z",
    }));
    const readActivity = vi.fn(async () => ({
      courseId: "course-1",
      activity: { id: "activity-1", status: "published", editRevision: 3 },
    }));
    const authorize = vi.fn(async () => access);
    const handler = createTeachingActivityPatchHandler({
      env: {},
      readActivityScope: async () => ({
        courseId: "course-1",
        classId: "class-1",
        lessonKey: "lesson-1",
      }),
      authorize,
      updateActivity,
      readActivity,
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/activities/activity-1", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "publish-activity-1",
          "x-uais-trace-id": "trace-publish-1",
        },
        body: JSON.stringify({ operation: "publish", expectedEditRevision: 2 }),
      }),
      { params: Promise.resolve({ activityId: "activity-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "persisted",
      receipt: { state: "published", revision: 3 },
      activity: { id: "activity-1", status: "published", editRevision: 3 },
    });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "course-1", lessonKey: "lesson-1" }),
    );
    expect(updateActivity).toHaveBeenCalledWith({
      teacherAccount: "teacher-1",
      activityId: "activity-1",
      expectedEditRevision: 2,
      operation: "publish",
      idempotencyKey: "publish-activity-1",
      traceId: "trace-publish-1",
    });
    expect(readActivity).toHaveBeenCalledWith({
      teacherAccount: "teacher-1",
      activityId: "activity-1",
    });
  });

  it("does not write when the target class is not owned in the authorized snapshot", async () => {
    const updateActivity = vi.fn();
    const handler = createTeachingActivityPatchHandler({
      env: {},
      readActivityScope: async () => ({
        courseId: "course-1",
        classId: "class-other",
        lessonKey: "lesson-1",
      }),
      authorize: async () => access,
      updateActivity,
      readActivity: vi.fn(),
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/activities/activity-1", {
        method: "PATCH",
        headers: { "idempotency-key": "publish-activity-2" },
        body: JSON.stringify({ operation: "publish", expectedEditRevision: 2 }),
      }),
      { params: { activityId: "activity-1" } },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      status: "denied",
      reasonCode: "teacher-target-class-required",
    });
    expect(updateActivity).not.toHaveBeenCalled();
  });

  it("returns a recoverable stale activity conflict without claiming success", async () => {
    const handler = createTeachingActivityPatchHandler({
      env: {},
      readActivityScope: async () => ({
        courseId: "course-1",
        classId: "class-1",
        lessonKey: "lesson-1",
      }),
      authorize: async () => access,
      updateActivity: async () => {
        throw new LearningLoopStoreError(409, "stale-activity-revision", {
          latestRevision: 4,
          recoveryAction: "reload-activity",
        });
      },
      readActivity: vi.fn(),
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/activities/activity-1", {
        method: "PATCH",
        headers: { "idempotency-key": "publish-activity-3" },
        body: JSON.stringify({ operation: "publish", expectedEditRevision: 2 }),
      }),
      { params: { activityId: "activity-1" } },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: "conflict",
      reasonCode: "stale-activity-revision",
      latestRevision: 4,
      recoveryAction: "reload-activity",
    });
  });
});
