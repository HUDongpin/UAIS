import { describe, expect, it } from "vitest";

type ScopedRouteModule = {
  name: string;
  load: () => Promise<Record<string, unknown>>;
  expectedExports: string[];
};

const scopedRouteModules: ScopedRouteModule[] = [
  {
    name: "learning-record analytics",
    load: () => import("@/app/api/learning-records/analytics/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "LRS smoke",
    load: () => import("@/app/api/learning-records/lrs/smoke/route"),
    expectedExports: ["GET", "POST", "dynamic"],
  },
  {
    name: "learning AI guide",
    load: () => import("@/app/api/learning/ai-guide/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "learning AI guide HITL",
    load: () => import("@/app/api/learning/ai-guide/hitl/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "learning chatroom moderation",
    load: () => import("@/app/api/learning/chatroom/moderation/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "learning chatroom",
    load: () => import("@/app/api/learning/chatroom/route"),
    expectedExports: ["GET", "POST", "dynamic", "maxDuration"],
  },
  {
    name: "learning chatroom share mint",
    load: () => import("@/app/api/learning/chatroom/share/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "learning chatroom share revoke",
    load: () => import("@/app/api/learning/chatroom/share/[shareId]/route"),
    expectedExports: ["DELETE", "dynamic"],
  },
  {
    name: "learning PPT playback audio",
    load: () =>
      import("@/app/api/learning/ppt-playback/audio/[manifestId]/[audioId]/route"),
    expectedExports: ["GET", "dynamic", "runtime"],
  },
  {
    name: "learning chatroom PDF export",
    load: () => import("@/app/learning/chatroom/export/pdf/route"),
    expectedExports: ["GET", "dynamic", "runtime"],
  },
  {
    name: "external storage teacher AI ownership merge",
    load: () =>
      import(
        "@/app/api/external-storage/teacher-ai-ownership/[teacherId]/merge/route"
      ),
    expectedExports: ["POST", "dynamic", "runtime"],
  },
  {
    name: "external storage teacher AI ownership read",
    load: () =>
      import(
        "@/app/api/external-storage/teacher-ai-ownership/[teacherId]/route"
      ),
    expectedExports: ["GET", "dynamic", "runtime"],
  },
  {
    name: "external storage teaching course asset restore drill",
    load: () =>
      import(
        "@/app/api/external-storage/teaching-course-assets/backups/[backupId]/restore-drill/route"
      ),
    expectedExports: ["POST", "dynamic", "runtime"],
  },
  {
    name: "external storage teaching course management restore drill",
    load: () =>
      import(
        "@/app/api/external-storage/teaching-course-management/backups/[backupId]/restore-drill/route"
      ),
    expectedExports: ["POST", "dynamic", "runtime"],
  },
  {
    name: "external storage teaching operation append",
    load: () =>
      import(
        "@/app/api/external-storage/teaching-operations/[teacherId]/append/route"
      ),
    expectedExports: ["POST", "dynamic", "runtime"],
  },
  {
    name: "external storage teaching operation alert notifications",
    load: () =>
      import(
        "@/app/api/external-storage/teaching-operations/[teacherId]/audit/alerts/notifications/route"
      ),
    expectedExports: ["GET", "POST", "dynamic", "runtime"],
  },
  {
    name: "external storage teaching operation alerts",
    load: () =>
      import(
        "@/app/api/external-storage/teaching-operations/[teacherId]/audit/alerts/route"
      ),
    expectedExports: ["GET", "dynamic", "runtime"],
  },
  {
    name: "external storage teaching operation audit",
    load: () =>
      import(
        "@/app/api/external-storage/teaching-operations/[teacherId]/audit/route"
      ),
    expectedExports: ["GET", "dynamic", "runtime"],
  },
  {
    name: "external storage teaching operation backup restore drill",
    load: () =>
      import(
        "@/app/api/external-storage/teaching-operations/[teacherId]/backups/[backupId]/restore-drill/route"
      ),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "external storage teaching operation backup create",
    load: () =>
      import(
        "@/app/api/external-storage/teaching-operations/[teacherId]/backups/route"
      ),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "external storage teaching operation rollback",
    load: () =>
      import(
        "@/app/api/external-storage/teaching-operations/[teacherId]/records/[recordId]/rollback/route"
      ),
    expectedExports: ["POST", "dynamic"],
  },
];

describe("Next route-module export contracts for package B", () => {
  it.each(scopedRouteModules)(
    "$name exposes only supported route exports",
    async ({ load, expectedExports }) => {
      const routeModule = await load();

      expect(Object.keys(routeModule).sort()).toEqual([...expectedExports].sort());
    },
  );
});
