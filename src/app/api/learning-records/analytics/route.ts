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
import {
  createClassActivityId,
  createCourseActivityId,
} from "@/lib/learning-records/xapi-events";
import {
  assertUaisAiAdminAccess,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
} from "@/lib/server/teaching-course-management-store";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

export const dynamic = "force-dynamic";

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
};

export const GET = createLearningRecordAnalyticsGetHandler();

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
    const result = await statementReader({
      env,
      fetch: deps.fetch,
      query,
    });
    const summary =
      scope === "learner-profile"
        ? createLearnerProfileFromXapiStatements({
            statements: result.statements,
            ...(courseId ? { courseId } : {}),
          })
        : scope === "learner-timeline"
          ? summarizeLearnerTimeline(result.statements)
          : summarizeTeacherClassInsights(result.statements);

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
      item.ownerTeacherId === user.account &&
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
    return {
      agent: {
        role: "learner",
        id: input.actorId,
      },
      ...(input.classId ? { activity: createClassActivityId(input.classId) } : {}),
      relatedActivities: Boolean(input.classId),
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
