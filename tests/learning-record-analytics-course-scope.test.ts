import { describe, expect, it, vi } from "vitest";
import { createLearningRecordAnalyticsGetHandler } from "@/app/api/learning-records/analytics/handler";
import {
  createActorAccount,
  createClassActivityId,
  createCourseActivityId,
  createLearningEventStatement,
} from "@/lib/learning-records/xapi-events";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const env = {
  UAIS_APP_SESSION_SIGNING_SECRET: "synthetic-records-review-secret",
  UAIS_LRS_ENDPOINT: "https://synthetic-lrs.example.test/xapi/",
  UAIS_LRS_USERNAME: "fixture-user",
  UAIS_LRS_PASSWORD: "fixture-password",
};

function learnerRequest(params: string) {
  const cookie = createUaisAppSessionCookie({
    account: "student-1",
    role: "student",
    displayName: "Synthetic student",
    department: "Test",
  }, { env });
  return new Request(`https://uais.test/api/learning-records/analytics?${params}`, {
    headers: { cookie },
  });
}

describe("learner analytics course scope", () => {
  it.each(["learner-profile", "learner-timeline"])(
    "filters %s before the LRS page limit hides requested-course evidence",
    async (scope) => {
      const statements = Array.from({ length: 101 }, (_, index) => {
        const courseId = index === 100 ? "requested-course" : "other-course";
        return createLearningEventStatement({
          actor: { id: "student-1", role: "learner" },
          event: {
            type: "lesson.viewed",
            object: { id: `${courseId}/lesson-1`, name: "Synthetic lesson", type: "lesson" },
            context: { courseId, lessonId: "lesson-1" },
          },
          statementId: `event-${index}`,
          timestamp: new Date(Date.UTC(2026, 8, 30, 10) - index * 1000).toISOString(),
        });
      });
      let requestedUrl: URL | undefined;
      const fakeFetch: typeof fetch = async (request) => {
        const url = new URL(String(request));
        requestedUrl = url;
        const activity = url.searchParams.get("activity");
        const matching = activity && url.searchParams.get("related_activities") === "true"
          ? statements.filter((statement) => statement.context?.contextActivities?.grouping?.some(
            (group) => group.id === activity,
          ))
          : statements;
        const limit = Number(url.searchParams.get("limit"));
        return Response.json({
          statements: matching.slice(0, limit),
          more: matching.length > limit ? "/xapi/statements?cursor=fixture" : "",
        });
      };
      const handler = createLearningRecordAnalyticsGetHandler({ env, fetch: fakeFetch });
      const response = await handler(learnerRequest(`scope=${scope}&courseId=requested-course`));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.summary).toMatchObject({ target: scope, eventCount: 1 });
      if (scope === "learner-profile") expect(body.summary.status).toBe("ready");
      expect(requestedUrl?.searchParams.get("activity")).toBe(createCourseActivityId("requested-course"));
      expect(JSON.parse(requestedUrl!.searchParams.get("agent")!)).toEqual(
        createActorAccount({ id: "student-1", role: "learner" }),
      );
    },
  );

  it.each(["learner-profile", "learner-timeline"])(
    "preserves the more specific class filter for %s",
    async (scope) => {
      const getStatements = vi.fn(async () => ({
        statements: [], more: "",
        redaction: { endpoint: "fingerprinted" as const, credentials: "omitted" as const, rawStatements: "summarized" as const },
      }));
      const handler = createLearningRecordAnalyticsGetHandler({ env, getStatements });
      const response = await handler(learnerRequest(`scope=${scope}&courseId=requested-course&classId=class-1`));

      expect(response.status).toBe(200);
      expect(getStatements).toHaveBeenCalledWith(expect.objectContaining({
        query: {
          agent: { id: "student-1", role: "learner" },
          activity: createClassActivityId("class-1"),
          relatedActivities: true,
          limit: 100,
        },
      }));
    },
  );

  it("retains the self-only query when neither course nor class is requested", async () => {
    const getStatements = vi.fn(async () => ({
      statements: [], more: "",
      redaction: { endpoint: "fingerprinted" as const, credentials: "omitted" as const, rawStatements: "summarized" as const },
    }));
    const handler = createLearningRecordAnalyticsGetHandler({ env, getStatements });
    const response = await handler(learnerRequest("scope=learner-profile"));

    expect(response.status).toBe(200);
    expect(getStatements).toHaveBeenCalledWith(expect.objectContaining({
      query: { agent: { id: "student-1", role: "learner" }, relatedActivities: false, limit: 100 },
    }));
  });

  it.each(["learner-profile", "learner-timeline"])(
    "denies %s for another learner before reading the requested course",
    async (scope) => {
      const getStatements = vi.fn();
      const handler = createLearningRecordAnalyticsGetHandler({ env, getStatements });
      const response = await handler(learnerRequest(`scope=${scope}&courseId=requested-course&actorId=another-student`));

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ access: { reasonCode: "learner-self-scope-required" } });
      expect(getStatements).not.toHaveBeenCalled();
    },
  );
});
