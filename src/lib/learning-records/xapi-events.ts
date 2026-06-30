import { createHash, randomUUID } from "node:crypto";
import type { XapiStatement } from "@/lib/learning-records/lrs-client";

const uaisXapiBase = "https://uais.top/xapi";
const adlVerbBase = "http://adlnet.gov/expapi/verbs";
const adlActivityBase = "http://adlnet.gov/expapi/activities";

export const learningEventCatalog = {
  "course.viewed": {
    verb: "viewed",
    defaultActivityType: "course",
  },
  "lesson.viewed": {
    verb: "viewed",
    defaultActivityType: "lesson",
  },
  "activity.attempted": {
    verb: "attempted",
    defaultActivityType: "learning-activity",
  },
  "question.answered": {
    verb: "answered",
    defaultActivityType: "assessment-question",
  },
  "course.completed": {
    verb: "completed",
    defaultActivityType: "course",
  },
  "competency.mastered": {
    verb: "mastered",
    defaultActivityType: "competency",
  },
  "ai.feedback.requested": {
    verb: "requested",
    defaultActivityType: "ai-feedback",
  },
  "collaboration.contributed": {
    verb: "interacted",
    defaultActivityType: "collaboration",
  },
} as const;

export type LearningRecordEventType = keyof typeof learningEventCatalog;

export type LearningRecordActor = {
  id: string;
  role: "learner" | "educator" | "admin";
  displayName?: string;
};

export type LearningRecordActivityType =
  | "course"
  | "lesson"
  | "learning-activity"
  | "assessment-question"
  | "competency"
  | "ai-feedback"
  | "collaboration";

export type LearningRecordEventInput = {
  type: LearningRecordEventType;
  object: {
    id: string;
    name: string;
    description?: string;
    type?: LearningRecordActivityType;
    interactionType?: string;
  };
  result?: {
    success?: boolean;
    completion?: boolean;
    response?: string;
    duration?: string;
    score?: {
      scaled?: number;
      raw?: number;
      min?: number;
      max?: number;
    };
    extensions?: Record<string, string | number | boolean>;
  };
  context: {
    tenantId?: string;
    courseId: string;
    classId?: string;
    lessonId?: string;
    competencyIds?: string[];
    cohortId?: string;
    interventionId?: string;
    locale?: string;
    registration?: string;
  };
};

export function createLearningEventStatement(input: {
  actor: LearningRecordActor;
  event: LearningRecordEventInput;
  statementId?: string;
  timestamp?: string;
}): XapiStatement {
  const catalogEntry = learningEventCatalog[input.event.type];
  if (!catalogEntry) {
    throw new Error(`Unknown UAIS learning event type: ${String(input.event.type)}`);
  }

  const activityType = input.event.object.type ?? catalogEntry.defaultActivityType;
  const language = input.event.context.locale ?? "zh-CN";

  return {
    id: input.statementId ?? randomUUID(),
    actor: {
      objectType: "Agent",
      account: {
        homePage: `${uaisXapiBase}/actors`,
        name: `${input.actor.role}:${safePathSegment(input.actor.id)}`,
      },
    },
    verb: {
      id: `${adlVerbBase}/${catalogEntry.verb}`,
      display: {
        "en-US": catalogEntry.verb,
      },
    },
    object: {
      id: createActivityId(input.event.object.id),
      objectType: "Activity",
      definition: {
        name: {
          "en-US": input.event.object.name,
        },
        ...(input.event.object.description
          ? {
              description: {
                "en-US": input.event.object.description,
              },
            }
          : {}),
        type: createActivityTypeUri(activityType),
        ...(input.event.object.interactionType
          ? { interactionType: input.event.object.interactionType }
          : {}),
      },
    },
    ...(input.event.result ? { result: input.event.result } : {}),
    context: {
      platform: "UAIS",
      language,
      ...(input.event.context.registration
        ? { registration: input.event.context.registration }
        : {}),
      contextActivities: createContextActivities(input.event.context),
      extensions: {
        [`${uaisXapiBase}/extensions/event-type`]: input.event.type,
        ...(input.event.context.tenantId
          ? { [`${uaisXapiBase}/extensions/tenant-id`]: input.event.context.tenantId }
          : {}),
        [`${uaisXapiBase}/extensions/course-id`]: input.event.context.courseId,
        ...(input.event.context.lessonId
          ? { [`${uaisXapiBase}/extensions/lesson-id`]: input.event.context.lessonId }
          : {}),
      },
    },
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export function createIdempotentStatementId(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function createActorAccount(input: {
  role: LearningRecordActor["role"];
  id: string;
}) {
  return {
    objectType: "Agent" as const,
    account: {
      homePage: `${uaisXapiBase}/actors`,
      name: `${input.role}:${safePathSegment(input.id)}`,
    },
  };
}

export function resolveLearningEventVerb(value: LearningRecordEventType | string) {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  const catalogEntry = learningEventCatalog[value as LearningRecordEventType];
  if (!catalogEntry) {
    throw new Error(`Unknown UAIS learning event type: ${String(value)}`);
  }
  return `${adlVerbBase}/${catalogEntry.verb}`;
}

export function createActivityId(value: string) {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  const normalized = value
    .split("/")
    .map((segment) => safePathSegment(segment))
    .filter(Boolean)
    .join("/");
  return `${uaisXapiBase}/activities/${normalized}`;
}

export function createClassActivityId(classId: string) {
  return `${uaisXapiBase}/activities/classes/${safePathSegment(classId)}`;
}

export function createCourseActivityId(courseId: string) {
  return `${uaisXapiBase}/activities/courses/${safePathSegment(courseId)}`;
}

function createContextActivities(
  context: LearningRecordEventInput["context"],
): NonNullable<NonNullable<XapiStatement["context"]>["contextActivities"]> {
  return {
    ...(context.classId
      ? {
          parent: [
            {
              id: createClassActivityId(context.classId),
            },
          ],
        }
      : {}),
    grouping: [
      {
        id: createCourseActivityId(context.courseId),
      },
      ...(context.cohortId
        ? [{ id: `${uaisXapiBase}/activities/cohorts/${safePathSegment(context.cohortId)}` }]
        : []),
      ...(context.interventionId
        ? [
            {
              id: `${uaisXapiBase}/activities/interventions/${safePathSegment(
                context.interventionId,
              )}`,
            },
          ]
        : []),
    ],
    ...(context.competencyIds?.length
      ? {
          category: context.competencyIds.map((competencyId) => ({
            id: `${uaisXapiBase}/activities/competencies/${safePathSegment(competencyId)}`,
          })),
        }
      : {}),
  };
}

function createActivityTypeUri(activityType: LearningRecordActivityType) {
  if (activityType === "course") {
    return `${adlActivityBase}/course`;
  }
  if (activityType === "assessment-question") {
    return `${adlActivityBase}/cmi.interaction`;
  }
  return `${uaisXapiBase}/activity-types/${safePathSegment(activityType)}`;
}

function safePathSegment(value: string) {
  return encodeURIComponent(value.trim().replace(/\s+/g, "-")).replace(/%2F/gi, "/");
}
