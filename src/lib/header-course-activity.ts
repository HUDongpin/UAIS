import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import { createLearningReturnPath } from "@/lib/auth/login-return-path";
import { isSameTeachingActorId } from "@/lib/server/teaching-actor-id";
import { getClassRosterHref } from "@/lib/teaching/class-roster-navigation";
import type { Locale } from "@/i18n/copy";

export type HeaderActivityMode = "calendar" | "notifications";
type FeedbackKind = "revision-required" | "accepted" | "awaiting-teacher";
type MembershipKind = "membership-pending" | "membership-rejected" | "membership-removed";
export type HeaderActivityItem = {
  id: string;
  kind: "deadline" | "pending-approval" | MembershipKind | FeedbackKind;
  courseId: string;
  courseName: string;
  classId: string;
  className: string;
  href: string;
  title?: Record<Locale, string>;
  activityId?: string;
  version?: number;
  unitPosition?: number;
  dueAt?: string;
  count?: number;
};
export type HeaderActivityData = { items: HeaderActivityItem[]; observedAt: string };

export class HeaderActivityError extends Error {
  constructor(readonly status: number) {
    super("header-activity-unavailable");
  }
}

type RecordValue = Record<string, unknown>;
type Course = { id: string; name: string };
type ClassItem = { id: string; courseId: string; name: string };
type Membership = {
  id: string;
  courseId: string;
  classId: string;
  status: "pending-teacher-review" | "approved" | "rejected" | "removed";
};
type Catalog = { courses: Course[]; classes: ClassItem[]; memberships: Membership[] };

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HeaderActivityError(502);
  return value as RecordValue;
}

function array(value: unknown): RecordValue[] {
  if (!Array.isArray(value)) throw new HeaderActivityError(502);
  return value.map(record);
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new HeaderActivityError(502);
  return value;
}

function id(value: unknown): string {
  const result = text(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result)) throw new HeaderActivityError(502);
  return result;
}

function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new HeaderActivityError(502);
  return value;
}

function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw new HeaderActivityError(502);
}

function due(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new HeaderActivityError(502);
  }
  return new Date(value).toISOString();
}

async function readJson(path: string, parent: AbortSignal, fetcher: typeof fetch) {
  if (parent.aborted) throw new HeaderActivityError(499);
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const response = await fetcher(path, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new HeaderActivityError(response.status);
    return record(await response.json());
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
  }
}

function catalog(value: RecordValue, user: UaisAppSessionUser): Catalog {
  const receipt = record(value.receipt);
  const actorId = text(receipt.actorId);
  const actorMatches = user.role === "teacher"
    ? isSameTeachingActorId(actorId, user.account)
    : actorId === user.account;
  if (receipt.status !== "read" || !actorMatches || receipt.action !== (user.role === "teacher" ? "list-courses" : "list-student-courses")) {
    throw new HeaderActivityError(403);
  }
  const courses = array(value.courses).map(row => {
    if (user.role === "teacher" && !isSameTeachingActorId(text(row.ownerTeacherId), user.account)) throw new HeaderActivityError(403);
    return { id: id(row.courseId), name: text(row.courseName) };
  });
  unique(courses.map(row => row.id));
  const classes = array(value.classes).map(row => {
    if (user.role === "teacher" && !isSameTeachingActorId(text(row.ownerTeacherId), user.account)) throw new HeaderActivityError(403);
    const courseId = id(row.courseId);
    if (!courses.some(course => course.id === courseId)) throw new HeaderActivityError(502);
    return { id: id(row.classId), courseId, name: text(row.className) };
  });
  unique(classes.map(row => row.id));
  const memberships: Membership[] = array(value.memberships).map(row => {
    const courseId = id(row.courseId);
    const classId = id(row.classId);
    const status = row.membershipStatus;
    if (
      !classes.some(item => item.id === classId && item.courseId === courseId) ||
      (status !== "pending-teacher-review" && status !== "approved" && status !== "rejected" && status !== "removed")
    ) throw new HeaderActivityError(502);
    return { id: id(row.membershipId), courseId, classId, status };
  });
  unique(memberships.map(row => row.id));
  return { courses, classes, memberships };
}

function scope(data: Catalog, courseId: string, classId: string) {
  const course = data.courses.find(row => row.id === courseId);
  const classItem = data.classes.find(row => row.id === classId && row.courseId === courseId);
  if (!course || !classItem) throw new HeaderActivityError(502);
  return { courseId, courseName: course.name, classId, className: classItem.name };
}

function feedbackKind(unit: RecordValue): FeedbackKind | "none" {
  const feedback = record(unit.feedback).status;
  const state = record(unit.submission).state;
  const expected: Record<string, FeedbackKind | "none"> = {
    "not-started": "none",
    draft: "none",
    submitted: "awaiting-teacher",
    resubmitted: "awaiting-teacher",
    revision_requested: "revision-required",
    accepted: "accepted",
  };
  if (typeof state !== "string" || !Object.hasOwn(expected, state) || feedback !== expected[state]) throw new HeaderActivityError(502);
  return expected[state];
}

// Student submissions can remain attached to an earlier activity version.
// The dashboard supplies the version that the learner is actually working on.
function studentItems(value: RecordValue, data: Catalog, mode: HeaderActivityMode): HeaderActivityItem[] {
  const courses = array(value.courses);
  const scopes = courses.map(row => `${id(row.courseId)}:${id(row.classId)}`);
  unique(scopes);
  const approved = [...new Set(data.memberships
    .filter(row => row.status === "approved")
    .map(row => `${row.courseId}:${row.classId}`))].sort();
  if (JSON.stringify([...scopes].sort()) !== JSON.stringify(approved)) throw new HeaderActivityError(409);
  return courses.flatMap(row => {
    const current = scope(data, id(row.courseId), id(row.classId));
    if (row.courseTitle !== current.courseName) throw new HeaderActivityError(409);
    const units = array(row.units);
    unique(units.map(unit => id(unit.activityId)));
    return units.flatMap((unit): HeaderActivityItem[] => {
      const activityId = id(unit.activityId);
      const unitPosition = positive(unit.position);
      const dueAt = due(unit.dueAt);
      const feedback = feedbackKind(unit);
      const common = {
        ...current,
        activityId,
        unitPosition,
        href: createLearningReturnPath({
          courseId: current.courseId,
          classId: current.classId,
          lessonKey: id(unit.lessonKey),
          activityId,
        }),
      };
      if (mode === "calendar" && dueAt) return [{ ...common, id: `deadline:${current.classId}:${activityId}`, kind: "deadline", dueAt }];
      if (mode === "notifications" && feedback !== "none") return [{ ...common, id: `feedback:${current.classId}:${activityId}`, kind: feedback }];
      return [];
    });
  });
}

function membershipItems(data: Catalog, role: "teacher" | "student"): HeaderActivityItem[] {
  if (role === "teacher") {
    return data.classes.flatMap(classItem => {
      const count = data.memberships.filter(row =>
        row.classId === classItem.id && row.courseId === classItem.courseId && row.status === "pending-teacher-review",
      ).length;
      return count ? [{
        ...scope(data, classItem.courseId, classItem.id),
        id: `approvals:${classItem.id}`,
        kind: "pending-approval",
        count,
        href: getClassRosterHref(classItem.id),
      }] : [];
    });
  }
  const kinds: Record<Exclude<Membership["status"], "approved">, MembershipKind> = {
    "pending-teacher-review": "membership-pending",
    rejected: "membership-rejected",
    removed: "membership-removed",
  };
  return data.memberships.flatMap(row => row.status === "approved" ? [] : [{
    ...scope(data, row.courseId, row.classId),
    id: `membership:${row.id}`,
    kind: kinds[row.status],
    href: "/student-dashboard",
  }]);
}

function teacherDeadlines(value: RecordValue, data: Catalog, course: Course): HeaderActivityItem[] {
  if (value.courseId !== course.id) throw new HeaderActivityError(409);
  const activities = array(value.activities);
  unique(activities.map(row => id(row.id)));
  const selected = new Map<string, { row: RecordValue; version: number }>();
  for (const row of activities) {
    const classId = id(row.targetClassId);
    const version = positive(row.version);
    const activityKey = id(row.activityKey);
    const lessonKey = id(row.lessonKey);
    scope(data, course.id, classId);
    if (!["draft", "published", "archived"].includes(text(row.status))) throw new HeaderActivityError(502);
    due(row.dueAt);
    if (row.status !== "published") continue;
    const key = JSON.stringify([classId, lessonKey, activityKey]);
    const previous = selected.get(key);
    if (previous?.version === version) throw new HeaderActivityError(502);
    if (!previous || previous.version < version) selected.set(key, { row, version });
  }
  return [...selected.values()].flatMap(({ row, version }) => {
    const dueAt = due(row.dueAt);
    if (!dueAt) return [];
    const title = record(row.title);
    const activityId = id(row.id);
    return [{
      ...scope(data, course.id, id(row.targetClassId)),
      id: `deadline:${activityId}`,
      activityId,
      version,
      title: { "zh-CN": text(title["zh-CN"]), "en-US": text(title["en-US"]) },
      kind: "deadline",
      dueAt,
      href: `/teaching/courses/${encodeURIComponent(course.id)}/activities`,
    }];
  });
}

/** Fresh projections of existing authorized endpoints; this does not send notifications. */
export async function readHeaderCourseActivity(input: {
  user: UaisAppSessionUser;
  mode: HeaderActivityMode;
  signal: AbortSignal;
  fetch?: typeof fetch;
}): Promise<HeaderActivityData> {
  if (input.user.role !== "teacher" && input.user.role !== "student") throw new HeaderActivityError(403);
  const fetcher = input.fetch ?? fetch;
  const data = catalog(await readJson("/api/teaching/courses", input.signal, fetcher), input.user);
  let items: HeaderActivityItem[];
  if (input.user.role === "student") {
    const hasApprovedScope = data.memberships.some(row => row.status === "approved");
    const learningItems = hasApprovedScope
      ? studentItems(await readJson("/api/learning/dashboard", input.signal, fetcher), data, input.mode)
      : [];
    items = [...learningItems, ...(input.mode === "notifications" ? membershipItems(data, "student") : [])];
  } else if (input.mode === "notifications") {
    items = membershipItems(data, "teacher");
  } else {
    items = [];
    for (let index = 0; index < data.courses.length; index += 4) {
      const courses = data.courses.slice(index, index + 4);
      const results = await Promise.all(courses.map(async course =>
        teacherDeadlines(
          await readJson(`/api/teaching/courses/${encodeURIComponent(course.id)}/activities`, input.signal, fetcher),
          data,
          course,
        ),
      ));
      items.push(...results.flat());
    }
  }
  if (input.signal.aborted) throw new HeaderActivityError(499);
  unique(items.map(row => row.id));
  items.sort((a, b) =>
    (a.dueAt ?? "").localeCompare(b.dueAt ?? "") ||
    a.courseName.localeCompare(b.courseName) ||
    a.id.localeCompare(b.id),
  );
  return { items, observedAt: new Date().toISOString() };
}
