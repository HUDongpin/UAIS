import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTeachingOperationActionPostHandler } from "@/app/api/teaching/operations/handler";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import {
  createTeachingCourseRecord,
  readTeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-store";
import { readTeachingOperationDatabase } from "@/lib/server/teaching-operations-store";

describe("teaching operation route managed ownership", () => {
  it.each([
    { actorId: "teacher-owner", expectedStatus: 200 },
    { actorId: "teacher-other", expectedStatus: 403 },
  ])("checks the course snapshot for $actorId without a derived AI grant", async ({ actorId, expectedStatus }) => {
    const dataDir = await mkdtemp(join(tmpdir(), "uais-operation-owner-regression-"));
    const now = new Date("2026-09-30T01:00:00.000Z");
    const secret = "synthetic-operation-owner-session-secret";
    try {
      const { course } = await createTeachingCourseRecord({
        dataDir,
        actorId: "teacher-owner",
        draft: {
          name: "Synthetic owner regression",
          instructor: "Test teacher",
          unit: "Test unit",
          department: "Test department",
          semester: "Test semester",
        },
        now,
      });
      const post = createTeachingOperationActionPostHandler({
        env: {
          UAIS_TEACHING_COURSES_DATA_DIR: dataDir,
          UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir,
          UAIS_TEACHER_AI_OWNERSHIP_DIR: join(dataDir, "missing-ai-grants"),
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: secret,
        },
        now,
      });
      const response = await post(new Request("http://localhost/api/teaching/operations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: createUaisTeacherAuthSessionCookieHeader({
            secret,
            claims: {
              actorId,
              role: "teacher",
              sessionId: "synthetic-owner-session",
              authenticatedAt: "2026-09-30T00:00:00.000Z",
              expiresAt: "2026-09-30T02:00:00.000Z",
            },
          }),
        },
        body: JSON.stringify({
          courseId: course.courseId,
          operationId: "course-settings",
          actionSlot: "primary",
          courseSettingsPatch: { description: "Saved by the snapshot owner" },
        }),
      }));
      expect(response.status).toBe(expectedStatus);
      const database = await readTeachingCourseManagementDatabase({ dataDir });
      const operations = await readTeachingOperationDatabase({ dataDir });
      if (expectedStatus === 200) {
        expect(database.courses[0].description).toBe("Saved by the snapshot owner");
        expect(operations.records).toHaveLength(1);
      } else {
        expect(database.courses[0].description).toBeUndefined();
        expect(operations.records).toHaveLength(0);
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
