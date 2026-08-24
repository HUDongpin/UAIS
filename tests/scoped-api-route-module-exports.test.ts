import { describe, expect, it } from "vitest";

type ScopedRouteModule = {
  name: string;
  load: () => Promise<Record<string, unknown>>;
  expectedExports: string[];
};

const scopedRouteModules: ScopedRouteModule[] = [
  {
    name: "AI chat",
    load: () => import("@/app/api/ai/chat/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "PPT narration",
    load: () => import("@/app/api/ai/ppt-narration/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "PPT narration audio",
    load: () => import("@/app/api/ai/ppt-narration/audio/[manifestId]/[audioId]/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "PPT narration export",
    load: () => import("@/app/api/ai/ppt-narration/export/[manifestId]/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "AI readiness",
    load: () => import("@/app/api/ai/readiness/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "AI session",
    load: () => import("@/app/api/ai/session/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "AI smoke plan",
    load: () => import("@/app/api/ai/smoke-plan/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "teacher auth issue",
    load: () => import("@/app/api/ai/teacher-auth/issue/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "teacher AI ownership",
    load: () => import("@/app/api/ai/teacher-ownership/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "teacher PPT workflow",
    load: () => import("@/app/api/ai/teacher-ppt-workflow/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "voice asset retention readiness",
    load: () => import("@/app/api/ai/voice-assets/retention-readiness/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "voice lifecycle audit",
    load: () => import("@/app/api/ai/voice-clone/lifecycle-audit/route"),
    expectedExports: ["GET", "dynamic"],
  },
  {
    name: "voice clone preflight",
    load: () => import("@/app/api/ai/voice-clone/preflight/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "voice clone revoke",
    load: () => import("@/app/api/ai/voice-clone/revoke/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "voice clone status",
    load: () => import("@/app/api/ai/voice-clone/status/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "voice sample",
    load: () => import("@/app/api/ai/voice-sample/route"),
    expectedExports: ["POST", "dynamic"],
  },
  {
    name: "app session",
    load: () => import("@/app/api/auth/app-session/route"),
    expectedExports: ["DELETE", "POST", "dynamic"],
  },
];

describe("Next route-module export contracts for the scoped API package", () => {
  it.each(scopedRouteModules)(
    "$name exposes only supported route exports",
    async ({ load, expectedExports }) => {
      const routeModule = await load();

      expect(Object.keys(routeModule).sort()).toEqual([...expectedExports].sort());
    },
  );
});
