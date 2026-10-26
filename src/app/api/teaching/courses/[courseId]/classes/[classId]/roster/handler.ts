import { createClassroomRosterStore, ClassroomAccountError } from "@/lib/server/classroom-roster-store";
import { openTeachingClassMembershipRequest, requireSafeTeachingMembershipRouteId } from "@/lib/server/teaching-class-membership-route-guards";
import { getUaisCoreDatabaseReadiness } from "@/lib/db/core-database";
import { ClassroomRecordRetentionError } from "@/lib/server/classroom-record-retention-store";
import { isSameOriginClassroomRequest } from "@/lib/server/classroom-request-origin";
type Context = { params: Promise<{ courseId: string; classId: string }> };
export function createClassroomRosterHandler(deps: { env?: Record<string, string | undefined>; now?: Date; store?: ReturnType<typeof createClassroomRosterStore> } = {}) {
  return async function handle(request: Request, context: Context) {
    const env = deps.env ?? process.env;
    const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    try {
      if (request.method !== "GET" && !isSameOriginClassroomRequest(request)) return json(403, { reasonCode: "same-origin-required" });
      const gate = openTeachingClassMembershipRequest({ request, env, traceId: "classroom-roster", now: deps.now });
      if (gate.status === "response") return gate.response;
      const params = await context.params;
      const scope = { actorId: gate.authenticatedTeacher.actorId, courseId: requireSafeTeachingMembershipRouteId(params.courseId, "course id"), classId: requireSafeTeachingMembershipRouteId(params.classId, "class id") };
      if (!deps.store && getUaisCoreDatabaseReadiness(env).status !== "ready") return json(503, { reasonCode: "classroom-database-required" });
      // Account import must serve the provider the login screen actually uses.
      if (env.UAIS_APP_AUTH_PROVIDER !== "database-accounts") return json(503, { reasonCode: "database-accounts-provider-required" });
      const store = deps.store ?? createClassroomRosterStore({ env });
      if (request.method === "GET") return json(200, { accounts: await store.list(scope) });
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > 120_000) return json(413, { reasonCode: "roster-too-large" });
      let body: { action?: unknown; csv?: unknown; account?: unknown };
      try { body = JSON.parse(text); } catch { return json(400, { reasonCode: "roster-body-invalid" }); }
      if (!body || typeof body !== "object") return json(400, { reasonCode: "roster-body-invalid" });
      if (body.action === "reissue" && typeof body.account === "string") return json(200, { credentials: [await store.reissue({ ...scope, account: body.account })] });
      if (typeof body.csv !== "string") return json(400, { reasonCode: "roster-csv-required" });
      if (body.action === "preview") return json(200, { rows: await store.preview({ ...scope, csv: body.csv }) });
      if (body.action === "import") return json(200, await store.import({ ...scope, csv: body.csv }));
      return json(400, { reasonCode: "roster-action-invalid" });
    } catch (error) {
      if (error instanceof ClassroomRecordRetentionError) return json(error.status, { reasonCode: error.reasonCode });
      if (error instanceof ClassroomAccountError) return json(error.status, { reasonCode: error.code });
      if (error instanceof Error && /CSV/.test(error.message)) return json(400, { reasonCode: "roster-csv-invalid" });
      return json(503, { reasonCode: "roster-unavailable" });
    }
  };
}
