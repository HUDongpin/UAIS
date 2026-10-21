import {
  createTargetedQueryFilters,
  getXapiStatements,
  type XapiStatementsQuery,
  type XapiStatementsResult,
} from "@/lib/learning-records/lrs-recorder";
import {
  summarizeLearnerTimeline,
  summarizeTeacherClassInsights,
} from "@/lib/learning-records/lrs-analytics";
import { createLearnerProfileFromXapiStatements } from "@/lib/learning-records/learner-profile";
import { resolveLearningRecordLearnerActorIds } from "@/lib/learning-records/learner-actor-identities";
import type { XapiStatement } from "@/lib/learning-records/lrs-client";
import {
  createClassActivityId,
  createCourseActivityId,
} from "@/lib/learning-records/xapi-events";
import {
  assertUaisAiAdminAccess,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import { isSameTeachingActorId } from "@/lib/server/teaching-actor-id";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
} from "@/lib/server/teaching-course-management-store";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

type LearningRecordAnalyticsScope =
  | "learner-profile"
  | "learner-timeline"
  | "teacher-class-insights"
  | "admin-tenant-insights";

type LearningRecordAnalyticsAccess =
  | {
      status: "authorized";
      reasonCode:
        | "learner-self-scope-authorized"
        | "teacher-class-scope-authorized"
        | "admin-audited-scope-authorized";
      responsibleSession: "S12";
      audit?: {
        actorId: string;
        reason: string;
        valueRedacted: true;
      };
    }
  | {
      status: "denied";
      reasonCode:
        | "app-session-required"
        | "learner-self-scope-required"
        | "teacher-class-scope-required"
        | "admin-signed-access-required"
        | "admin-audit-reason-required"
        | "analytics-scope-invalid";
      responsibleSession: "S12";
    };

type LearningRecordAnalyticsGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  authorizeAnalyticsQuery?: (input: {
    request: Request;
    scope: LearningRecordAnalyticsScope;
    actorId?: string;
    courseId?: string;
    classId?: string;
    auditReason?: string;
  }) => Promise<LearningRecordAnalyticsAccess> | LearningRecordAnalyticsAccess;
  getStatements?: (input: {
    env: Record<string, string | undefined>;
    fetch?: typeof fetch;
    query: XapiStatementsQuery;
  }) => Promise<XapiStatementsResult>;
  resolveLearnerActorIds?: (input: {
    account: string;
    env: Record<string, string | undefined>;
  }) => Promise<string[]>;
};

export function createLearningRecordAnalyticsGetHandler(
  deps: LearningRecordAnalyticsGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(request: Request) {
    const url = new URL(request.url);
    const scope = readAnalyticsScope(url.searchParams.get("scope"));
    if (!scope) {
      return createAnalyticsJsonResponse(400, {
        target: "learning-record-analytics",
        status: "denied",
        access: createDeniedAccess("analytics-scope-invalid"),
        redaction: createRedaction(),
      });
    }

    const user =
      scope === "admin-tenant-insights"
        ? undefined
        : getUaisAppSessionUserFromCookieString(request.headers.get("cookie"), {
            env,
          });
    if (scope !== "admin-tenant-insights" && !user) {
      return createAnalyticsJsonResponse(401, {
        target: "learning-record-analytics",
        status: "denied",
        access: createDeniedAccess("app-session-required"),
        redaction: createRedaction(),
      });
    }

    const courseId = readOptionalParam(url, "courseId");
    const classId = readOptionalParam(url, "classId");
    const auditReason = readOptionalParam(url, "auditReason");
    const actorId = readOptionalParam(url, "actorId") ?? user?.account;
    const authorizeAnalyticsQuery =
      deps.authorizeAnalyticsQuery ??
      ((input: {
        request: Request;
        scope: LearningRecordAnalyticsScope;
        actorId?: string;
        courseId?: string;
        classId?: string;
        auditReason?: string;
      }) =>
        defaultAuthorizeAnalyticsQuery({
          ...input,
          env,
          fetch: deps.fetch,
        }));
    const access = await authorizeAnalyticsQuery({
      request,
      scope,
      actorId,
      courseId,
      classId,
      auditReason,
    });
    if (access.status === "denied") {
      return createAnalyticsJsonResponse(403, {
        target: "learning-record-analytics",
        status: "denied",
        access,
        redaction: createRedaction(),
      });
    }

    const query = createAnalyticsQuery({
      scope,
      actorId,
      courseId,
      classId,
    });
    const statementReader = deps.getStatements ?? getXapiStatements;
    let actorIds: string[] | undefined;
    if (query.agent) {
      try {
        actorIds = await (deps.resolveLearnerActorIds ?? resolveLearningRecordLearnerActorIds)({
          account: query.agent.id,
          env,
        });
      } catch {
        return createAnalyticsJsonResponse(503, {
          target: "learning-record-analytics",
          status: "unavailable",
          reasonCode: "learning-record-identity-unavailable",
          redaction: createRedaction(),
        });
      }
    }
    const queries = actorIds
      ? [...new Set(actorIds)].map((id) => ({ ...query, agent: { role: "learner" as const, id } }))
      : [query];
    const results = await Promise.all(queries.map((targetedQuery) => statementReader({
      env,
      fetch: deps.fetch,
      query: targetedQuery,
    })));
    const statements = mergeLearningRecordStatements(results, query.limit ?? 100);
    const summary =
      scope === "learner-profile"
        ? createLearnerProfileFromXapiStatements({
            statements,
            ...(courseId ? { courseId } : {}),
          })
        : scope === "learner-timeline"
          ? summarizeLearnerTimeline(statements)
          : summarizeTeacherClassInsights(statements);

    return createAnalyticsJsonResponse(200, {
      target: "learning-record-analytics",
      status: "summarized",
      scope,
      access,
      query: {
        targeted: true,
        filters: createTargetedQueryFilters(query),
      },
      summary,
      redaction: createRedaction(),
    });
  };
}

function mergeLearningRecordStatements(results: XapiStatementsResult[], limit: number) {
  const unique = new Map<string, XapiStatement>();
  for (const result of results) {
    for (const statement of result.statements) {
      if (!unique.has(statement.id)) unique.set(statement.id, statement);
    }
  }
  // LRS history can retain ISO timestamps with different offsets. Compare
  // instants before applying the shared page limit; invalid dates cannot
  // establish chronological evidence. Canonical timestamps also keep the
  // downstream profile/timeline summaries consistent with this ordering.
  return [...unique.values()]
    .map((statement) => ({ statement, timestamp: Date.parse(statement.timestamp) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp || left.statement.id.localeCompare(right.statement.id))
    .slice(0, limit)
    .map(({ statement, timestamp }) => ({ ...statement, timestamp: new Date(timestamp).toISOString() }));
}

async function defaultAuthorizeAnalyticsQuery(input: {
  request: Request;
  scope: LearningRecordAnalyticsScope;
  actorId?: string;
  courseId?: string;
  classId?: string;
  auditReason?: string;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): Promise<LearningRecordAnalyticsAccess> {
  if (input.scope === "admin-tenant-insights") {
    if (!input.auditReason) {
      return createDeniedAccess("admin-audit-reason-required");
    }
    try {
      const decision = assertUaisAiAdminAccess({
        request: input.request,
        env: input.env,
        action: "lrs-analytics-read",
        requireSignedSession: true,
      });
      return {
        status: "authorized",
        reasonCode: "admin-audited-scope-authorized",
        responsibleSession: "S12",
        audit: {
          actorId: decision.actor?.actorId ?? "unknown-admin",
          reason: input.auditReason,
          valueRedacted: true,
        },
      };
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createDeniedAccess("admin-signed-access-required");
      }
      throw error;
    }
  }

  const user = getUaisAppSessionUserFromCookieString(input.request.headers.get("cookie"), {
    env: input.env,
  });
  if (!user) {
    return createDeniedAccess("app-session-required");
  }
  if (input.scope === "learner-profile" || input.scope === "learner-timeline") {
    if (user.role === "student" && input.actorId === user.account) {
      return {
        status: "authorized",
        reasonCode: "learner-self-scope-authorized",
        responsibleSession: "S12",
      };
    }
    if (input.scope === "learner-timeline" || user.role !== "teacher") {
      return createDeniedAccess("learner-self-scope-required");
    }
    if (!input.classId || !input.actorId) {
      return createDeniedAccess("teacher-class-scope-required");
    }
  }

  if (user.role !== "teacher" || !input.classId) {
    return createDeniedAccess("teacher-class-scope-required");
  }

  const repository = createUaisTeachingCourseManagementRepository({
    env: input.env,
    fetch: input.fetch,
  });
  if (!repository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
  }
  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(
      input.env.UAIS_TEACHING_COURSES_DATA_DIR,
    ),
    repository,
  });
  const classRecord = database.classes.find(
    (item) =>
      item.classId === input.classId &&
      isSameTeachingActorId(item.ownerTeacherId, user.account) &&
      (!input.courseId || item.courseId === input.courseId),
  );
  if (!classRecord) {
    return createDeniedAccess("teacher-class-scope-required");
  }
  if (
    input.scope === "learner-profile" &&
    !database.memberships.some(
      (membership) =>
        membership.classId === input.classId &&
        membership.studentId === input.actorId &&
        membership.membershipStatus === "approved",
    )
  ) {
    return createDeniedAccess("teacher-class-scope-required");
  }
  return {
    status: "authorized",
    reasonCode: "teacher-class-scope-authorized",
    responsibleSession: "S12",
  };
}

function createAnalyticsQuery(input: {
  scope: LearningRecordAnalyticsScope;
  actorId?: string;
  courseId?: string;
  classId?: string;
}): XapiStatementsQuery {
  if (input.scope === "learner-profile" || input.scope === "learner-timeline") {
    if (!input.actorId) {
      throw new Error("Learner analytics require an actor id.");
    }
    const activity = input.classId
      ? createClassActivityId(input.classId)
      : input.courseId
        ? createCourseActivityId(input.courseId)
        : undefined;
    return {
      agent: {
        role: "learner",
        id: input.actorId,
      },
      ...(activity ? { activity } : {}),
      relatedActivities: Boolean(activity),
      limit: 100,
    };
  }

  return {
    activity: input.classId
      ? createClassActivityId(input.classId)
      : createCourseActivityId(input.courseId ?? "unknown-course"),
    relatedActivities: true,
    limit: 200,
  };
}

function readAnalyticsScope(value: string | null): LearningRecordAnalyticsScope | undefined {
  return value === "learner-profile" ||
    value === "learner-timeline" ||
    value === "teacher-class-insights" ||
    value === "admin-tenant-insights"
    ? value
    : undefined;
}

function readOptionalParam(url: URL, name: string) {
  const value = url.searchParams.get(name)?.trim();
  return value || undefined;
}

function createDeniedAccess(
  reasonCode: Extract<LearningRecordAnalyticsAccess, { status: "denied" }>["reasonCode"],
): Extract<LearningRecordAnalyticsAccess, { status: "denied" }> {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
  };
}

function createAnalyticsJsonResponse(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function createRedaction() {
  return {
    credentials: "omitted",
    rawStatements: "summarized",
    localFiles: "omitted",
  };
}
