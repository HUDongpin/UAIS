import { expect, it, vi } from "vitest";
import { createTeachingCourseManagementWriteRetry, teachingClassroomJoinMaxWriteAttempts } from "@/lib/server/teaching-course-management-write-retry";
import { TeachingCourseManagementStoreError } from "@/lib/server/teaching-course-management-error";

it("gives a classroom join enough bounded retries for an observed thirty-student burst", async () => {
  vi.useFakeTimers();
  try {
    expect(teachingClassroomJoinMaxWriteAttempts).toBe(12);
    const retry = createTeachingCourseManagementWriteRetry({ maxAttempts: teachingClassroomJoinMaxWriteAttempts });
    const conflict = new TeachingCourseManagementStoreError(409, "Teaching course management snapshot changed; retry required.");
    const sixth = retry.shouldRetry({ attempt: 5, error: conflict });
    await vi.runAllTimersAsync();
    expect(await sixth).toBe(true);
    expect(await retry.shouldRetry({ attempt: 11, error: conflict })).toBe(false);
    expect(await retry.shouldRetry({ attempt: 0, error: new Error("not a conflict") })).toBe(false);
    expect(createTeachingCourseManagementWriteRetry().maxAttempts).toBe(5);
  } finally { vi.useRealTimers(); }
});
