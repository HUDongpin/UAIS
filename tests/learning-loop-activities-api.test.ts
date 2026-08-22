import { describe, expect, it, vi } from "vitest";
import {
  createTeachingActivitiesGetHandler,
  createTeachingActivitiesPostHandler,
} from "./helpers/learning-loop-route-factories";

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

function draft() {
  return {
    lessonKey: "lesson-1",
    targetClassId: "class-1",
    title: { "zh-CN": "任务", "en-US": "Activity" },
    instructions: { "zh-CN": "说明", "en-US": "Instructions" },
    checkpoint: {
      kind: "short-answer",
      prompt: { "zh-CN": "解释", "en-US": "Explain" },
      explanation: { "zh-CN": "参考", "en-US": "Reference" },
    },
    rubric: [
      { id: "a", label: { "zh-CN": "甲", "en-US": "A" } },
      { id: "b", label: { "zh-CN": "乙", "en-US": "B" } },
      { id: "c", label: { "zh-CN": "丙", "en-US": "C" } },
    ],
    aiPolicy: "teacher-requested-draft",
    revisionPolicy: "teacher-requested",
  };
}

describe("P1 teacher activities API", () => {
  it("creates against trusted course/class/lesson metadata and returns database readback", async () => {
    const createActivity = vi.fn(async () => ({
      status: "persisted" as const,
      resourceId: "activity-1",
      state: "draft",
      revision: 1,
      traceId: "trace-activity-1",
      persistedAt: "2026-08-20T18:10:00.000Z",
    }));
    const readActivity = vi.fn(async () => ({
      courseId: "course-1",
      activity: { id: "activity-1", status: "draft", version: 1 },
    }));
    const handler = createTeachingActivitiesPostHandler({
      env: {},
      authorize: async () => access,
      createActivity,
      readActivity,
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/courses/course-1/activities", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "create-activity-1",
          "x-uais-trace-id": "trace-activity-1",
        },
        body: JSON.stringify(draft()),
      }),
      { params: Promise.resolve({ courseId: "course-1" }) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: "persisted",
      receipt: { resourceId: "activity-1" },
      activity: { id: "activity-1", status: "draft" },
    });
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        teacherAccount: "teacher-1",
        course: access.course,
        class: access.classes[0],
        lesson: access.lesson,
        idempotencyKey: "create-activity-1",
      }),
    );
    expect(readActivity).toHaveBeenCalledWith({
      teacherAccount: "teacher-1",
      activityId: "activity-1",
    });
  });

  it("lists only after course authorization and never invents demo rows", async () => {
    const listActivities = vi.fn(async () => ({
      courseId: "course-1",
      activities: [],
      dataFreshAt: "2026-08-20T18:10:00.000Z",
    }));
    const handler = createTeachingActivitiesGetHandler({
      env: {},
      authorize: async () => access,
      listActivities,
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/courses/course-1/activities"),
      { params: { courseId: "course-1" } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ activities: [] });
  });

  it("rejects invalid bilingual publication-shaped input before any write", async () => {
    const createActivity = vi.fn();
    const invalid = draft();
    invalid.title["en-US"] = "";
    const handler = createTeachingActivitiesPostHandler({
      env: {},
      authorize: async () => access,
      createActivity,
      readActivity: vi.fn(),
    });
    const response = await handler(
      new Request("http://localhost/api/teaching/courses/course-1/activities", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "invalid-1" },
        body: JSON.stringify(invalid),
      }),
      { params: { courseId: "course-1" } },
    );
    expect(response.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });
});
