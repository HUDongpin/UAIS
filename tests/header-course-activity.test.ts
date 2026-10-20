import { expect, it, vi } from "vitest";
import {
  headerActivities,
  headerActivityId,
  headerCatalog,
  headerDashboard,
  headerStudent,
  headerTeacher,
} from "./helpers/header-course-activity-fixture";

const modules = import.meta.glob("../src/lib/header-course-activity.ts", { eager: true });
function implementation() {
  const found = Object.values(modules)[0];
  expect(found, "the header must read actual course activity").toBeDefined();
  return found as typeof import("../src/lib/header-course-activity");
}

function responses(map: Record<string, unknown>) {
  return vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const value = map[String(path)];
    if (value instanceof Response) return value.clone();
    if (value === undefined) throw new Error(`Unexpected request: ${String(path)}`);
    return Response.json(value);
  });
}

const studentHref = `/learning?courseId=course-a&classId=class-a&lessonKey=lesson-a&activityId=${headerActivityId}`;

it("shows the latest published teacher activity version without inventing dates", async () => {
  const { readHeaderCourseActivity } = implementation();
  const activities = headerActivities();
  activities.activities.push(
    { ...activities.activities[0], id: "22222222-2222-4222-8222-222222222222", version: 2, dueAt: "2026-10-22T08:00:00.000Z" },
    { ...activities.activities[0], id: "33333333-3333-4333-8333-333333333333", activityKey: "draft-family", status: "draft" },
  );
  const result = await readHeaderCourseActivity({
    user: headerTeacher, mode: "calendar", signal: new AbortController().signal,
    fetch: responses({ "/api/teaching/courses": headerCatalog(), "/api/teaching/courses/course-a/activities": activities }),
  });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    activityId: "22222222-2222-4222-8222-222222222222",
    dueAt: "2026-10-22T08:00:00.000Z",
    href: "/teaching/courses/course-a/activities",
    version: 2,
  });
});

it("keeps same-named activity families in different lessons and classes separate", async () => {
  const { readHeaderCourseActivity } = implementation();
  const catalog = headerCatalog();
  catalog.classes.push({ ...catalog.classes[0], classId: "class-b", className: "Class B" });
  const activities = headerActivities();
  activities.activities.push(
    { ...activities.activities[0], id: "22222222-2222-4222-8222-222222222222", lessonKey: "lesson-b" },
    { ...activities.activities[0], id: "33333333-3333-4333-8333-333333333333", targetClassId: "class-b" },
  );
  const result = await readHeaderCourseActivity({
    user: headerTeacher, mode: "calendar", signal: new AbortController().signal,
    fetch: responses({ "/api/teaching/courses": catalog, "/api/teaching/courses/course-a/activities": activities }),
  });
  expect(result.items).toHaveLength(3);
});

it("matches the current case-insensitive teacher ownership contract", async () => {
  const { readHeaderCourseActivity } = implementation();
  const catalog = headerCatalog();
  catalog.receipt.actorId = "Teacher-Header";
  catalog.courses[0].ownerTeacherId = "TEACHER-HEADER";
  catalog.classes[0].ownerTeacherId = " Teacher-Header ";
  const result = await readHeaderCourseActivity({
    user: headerTeacher, mode: "notifications", signal: new AbortController().signal,
    fetch: responses({ "/api/teaching/courses": catalog }),
  });
  expect(result.items[0]).toMatchObject({ kind: "pending-approval", count: 1 });
});

it("links each student deadline to its exact approved class, lesson and activity", async () => {
  const { readHeaderCourseActivity } = implementation();
  const result = await readHeaderCourseActivity({
    user: headerStudent, mode: "calendar", signal: new AbortController().signal,
    fetch: responses({ "/api/teaching/courses": headerCatalog("student"), "/api/learning/dashboard": headerDashboard() }),
  });
  expect(result.items).toMatchObject([{
    dueAt: "2026-10-21T08:00:00.000Z", courseName: "Real course", className: "Class A", href: studentHref,
  }]);
});

it("keeps student submission-bound deadlines instead of reading the latest teacher version", async () => {
  const { readHeaderCourseActivity } = implementation();
  const dashboard = headerDashboard();
  dashboard.courses[0].units[0].submission.state = "submitted";
  dashboard.courses[0].units[0].feedback.status = "awaiting-teacher";
  const fetcher = responses({ "/api/teaching/courses": headerCatalog("student"), "/api/learning/dashboard": dashboard });
  const result = await readHeaderCourseActivity({
    user: headerStudent, mode: "calendar", signal: new AbortController().signal, fetch: fetcher,
  });
  expect(result.items[0]).toMatchObject({ activityId: headerActivityId, dueAt: "2026-10-21T08:00:00.000Z", href: studentHref });
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(["/api/teaching/courses", "/api/learning/dashboard"]);
});

it("counts actual pending teacher approvals and links the selected class roster", async () => {
  const { readHeaderCourseActivity } = implementation();
  const catalog = headerCatalog();
  catalog.memberships.push(
    { ...catalog.memberships[0], membershipId: "member-b" },
    { ...catalog.memberships[0], membershipId: "member-c", membershipStatus: "approved" },
  );
  const fetcher = responses({ "/api/teaching/courses": catalog });
  const result = await readHeaderCourseActivity({
    user: headerTeacher, mode: "notifications", signal: new AbortController().signal, fetch: fetcher,
  });
  expect(result.items).toMatchObject([{ kind: "pending-approval", count: 2, href: "/teaching#uais-class-roster-class-a" }]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("shows membership decisions and released feedback without claiming unread state", async () => {
  const { readHeaderCourseActivity } = implementation();
  const catalog = headerCatalog("student");
  catalog.classes.push({ courseId: "course-a", classId: "class-b", className: "Class B" });
  catalog.memberships.push({ membershipId: "member-b", courseId: "course-a", classId: "class-b", membershipStatus: "removed" });
  const result = await readHeaderCourseActivity({
    user: headerStudent, mode: "notifications", signal: new AbortController().signal,
    fetch: responses({ "/api/teaching/courses": catalog, "/api/learning/dashboard": headerDashboard() }),
  });
  expect(result.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "membership-removed", href: "/student-dashboard" }),
    expect.objectContaining({ kind: "revision-required", href: studentHref }),
  ]));
  expect(result).not.toHaveProperty("unreadCount");
});

it("can show pending membership before a student has any approved learning scope", async () => {
  const { readHeaderCourseActivity } = implementation();
  const catalog = headerCatalog("student");
  catalog.memberships[0].membershipStatus = "pending-teacher-review";
  const fetcher = responses({ "/api/teaching/courses": catalog });
  const result = await readHeaderCourseActivity({
    user: headerStudent, mode: "notifications", signal: new AbortController().signal, fetch: fetcher,
  });
  expect(result.items).toMatchObject([{ kind: "membership-pending" }]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("distinguishes authentication, failed reads, invalid data and genuine empty results", async () => {
  const { readHeaderCourseActivity } = implementation();
  for (const [body, status] of [
    [new Response("{}", { status: 503 }), 503],
    [new Response("{}", { status: 401 }), 401],
    [{ ...headerCatalog(), receipt: { action: "list-courses", status: "read", actorId: "other-teacher" } }, 403],
    [{ ...headerCatalog(), classes: [] }, 502],
  ] as const) {
    await expect(readHeaderCourseActivity({
      user: headerTeacher, mode: "calendar", signal: new AbortController().signal,
      fetch: responses({ "/api/teaching/courses": body }),
    })).rejects.toMatchObject({ status });
  }
  const result = await readHeaderCourseActivity({
    user: headerTeacher, mode: "calendar", signal: new AbortController().signal,
    fetch: responses({ "/api/teaching/courses": { ...headerCatalog(), courses: [], classes: [], memberships: [] } }),
  });
  expect(result.items).toEqual([]);
});

it("rejects foreign class data, invalid deadlines and changed student authorization scope", async () => {
  const { readHeaderCourseActivity } = implementation();
  for (const patch of [{ targetClassId: "class-other" }, { dueAt: "not-a-time" }]) {
    const activities = headerActivities();
    Object.assign(activities.activities[0], patch);
    await expect(readHeaderCourseActivity({
      user: headerTeacher, mode: "calendar", signal: new AbortController().signal,
      fetch: responses({ "/api/teaching/courses": headerCatalog(), "/api/teaching/courses/course-a/activities": activities }),
    })).rejects.toThrow();
  }
  const dashboard = headerDashboard();
  dashboard.courses[0].classId = "class-other";
  await expect(readHeaderCourseActivity({
    user: headerStudent, mode: "calendar", signal: new AbortController().signal,
    fetch: responses({ "/api/teaching/courses": headerCatalog("student"), "/api/learning/dashboard": dashboard }),
  })).rejects.toMatchObject({ status: 409 });
});

it("uses uncached authenticated GET reads and never returns a partially failed calendar", async () => {
  const { readHeaderCourseActivity } = implementation();
  const fetcher = responses({ "/api/teaching/courses": headerCatalog(), "/api/teaching/courses/course-a/activities": headerActivities() });
  await readHeaderCourseActivity({
    user: headerTeacher, mode: "calendar", signal: new AbortController().signal, fetch: fetcher,
  });
  for (const [, init] of fetcher.mock.calls) {
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
  await expect(readHeaderCourseActivity({
    user: headerTeacher, mode: "calendar", signal: new AbortController().signal,
    fetch: responses({ "/api/teaching/courses": headerCatalog(), "/api/teaching/courses/course-a/activities": new Response("{}", { status: 503 }) }),
  })).rejects.toMatchObject({ status: 503 });
});

it("does not request or expose data after its owning view is canceled", async () => {
  const { readHeaderCourseActivity } = implementation();
  const controller = new AbortController();
  const fetcher = responses({ "/api/teaching/courses": headerCatalog() });
  controller.abort();
  await expect(readHeaderCourseActivity({
    user: headerTeacher, mode: "notifications", signal: controller.signal, fetch: fetcher,
  })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
