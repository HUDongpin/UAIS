import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const routeFiles = [
  "src/app/api/learning-records/events/route.ts",
  "src/app/api/learning-records/outbox/dispatch/route.ts",
  "src/app/api/learning-records/outbox/replay/route.ts",
  "src/app/api/learning/activities/[activityId]/formative-attempt/route.ts",
  "src/app/api/learning/activities/[activityId]/submission/route.ts",
  "src/app/api/learning/activities/[activityId]/submission/submit/route.ts",
  "src/app/api/learning/courses/[courseId]/units/[lessonKey]/route.ts",
  "src/app/api/learning/dashboard/route.ts",
  "src/app/api/learning/ppt-playback/[courseId]/route.ts",
  "src/app/api/teaching/activities/[activityId]/route.ts",
  "src/app/api/teaching/activities/[activityId]/submissions/route.ts",
  "src/app/api/teaching/courses/[courseId]/activities/route.ts",
  "src/app/api/teaching/courses/[courseId]/learning-insights/route.ts",
  "src/app/api/teaching/submissions/[submissionId]/route.ts",
  "src/app/api/teaching/submissions/[submissionId]/feedback/route.ts",
  "src/app/api/teaching/submissions/[submissionId]/decision/route.ts",
  "src/app/api/teaching/submissions/[submissionId]/ai-feedback-draft/route.ts",
] as const;

const allowedExports = new Set([
  "dynamic",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

describe("P1 Next 16 route export contract", () => {
  for (const routeFile of routeFiles) {
    it(`${routeFile} exposes only supported route fields`, async () => {
      const source = await readFile(routeFile, "utf8");
      const names = Array.from(
        source.matchAll(/^export\s+(?:const|function|async function)\s+([A-Za-z0-9_]+)/gm),
        (match) => match[1],
      );
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((name) => !allowedExports.has(name))).toEqual([]);
      expect(source).not.toMatch(/^export\s+function\s+create/m);
      if (routeFile.includes("[")) {
        expect(source).toMatch(/params:\s*Promise</);
        expect(source).not.toContain("| Promise<");
      }
    });
  }
});
