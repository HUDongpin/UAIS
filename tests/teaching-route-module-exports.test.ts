import { describe, expect, it } from "vitest";

type TeachingRouteModuleContract = {
  name: string;
  load: () => Promise<Record<string, unknown>>;
  expectedExports: string[];
};

const teachingRouteModuleContracts: TeachingRouteModuleContract[] = [
  {
    name: "single membership approval",
    load: () =>
      import(
        "@/app/api/teaching/classes/[classId]/memberships/[membershipId]/approve/route"
      ),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "membership update",
    load: () =>
      import("@/app/api/teaching/classes/[classId]/memberships/[membershipId]/route"),
    expectedExports: ["PATCH", "dynamic"],
  },
  {
    name: "bulk membership approval",
    load: () => import("@/app/api/teaching/classes/[classId]/memberships/approve/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "course cover",
    load: () => import("@/app/api/teaching/course-cover/route"),
    expectedExports: ["POST", "dynamic", "runtime"],
  },
  {
    name: "course class creation",
    load: () => import("@/app/api/teaching/courses/[courseId]/classes/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "learning group record",
    load: () => import("@/app/api/teaching/courses/[courseId]/groups/[groupId]/route"),
    expectedExports: ["DELETE", "PATCH", "dynamic"],
  },
  {
    name: "learning group auto split",
    load: () => import("@/app/api/teaching/courses/[courseId]/groups/auto-split/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "learning group creation",
    load: () => import("@/app/api/teaching/courses/[courseId]/groups/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "courses",
    load: () => import("@/app/api/teaching/courses/route"),
    expectedExports: ["GET", "POST", "dynamic"],
  },
  {
    name: "gradebook release",
    load: () => import("@/app/api/teaching/gradebook-updates/[objectId]/release/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "gradebook release rollback",
    load: () => import("@/app/api/teaching/gradebook-updates/[objectId]/rollback/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "invite-code join",
    load: () => import("@/app/api/teaching/invite-codes/[code]/join/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "audit alert notifications",
    load: () => import("@/app/api/teaching/operations/audit/alerts/notifications/route"),
    expectedExports: ["GET", "POST", "dynamic"],
  },
  {
    name: "audit alerts",
    load: () => import("@/app/api/teaching/operations/audit/alerts/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "operation audit",
    load: () => import("@/app/api/teaching/operations/audit/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "backup restore",
    load: () => import("@/app/api/teaching/operations/backups/[backupId]/restore/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "collaboration invite delivery callback",
    load: () => import("@/app/api/teaching/operations/collaboration-invite-deliveries/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "operation export",
    load: () => import("@/app/api/teaching/operations/export/[manifestId]/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "operation record rollback",
    load: () => import("@/app/api/teaching/operations/records/[recordId]/rollback/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "operation action",
    load: () => import("@/app/api/teaching/operations/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "health check",
    load: () => import("@/app/healthz/route"),
    expectedExports: ["GET", "dynamic", "runtime"],
  },
];

describe("Next 16 teaching and health route-module export contracts", () => {
  it.each(teachingRouteModuleContracts)(
    "$name exposes only supported route exports",
    async ({ load, expectedExports }) => {
      const routeModule = await load();

      expect(Object.keys(routeModule).sort()).toEqual([...expectedExports].sort());
    },
  );
});
