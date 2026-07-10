import { createHash } from "node:crypto";
import { Annotation, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import {
  createUaisLangGraphRuntime,
  type UaisLangGraphActor,
  type UaisLangGraphRuntimeEvent,
  type UaisLangGraphRunResult,
} from "@/lib/ai/langgraph-runtime/runtime";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

export const dynamic = "force-dynamic";

type LearningGuideHitlRequestBody =
  | {
      action: "start-review";
      graphId?: string;
      threadId: string;
      messageText?: string;
    }
  | {
      action: "resume-review";
      threadId: string;
      decision?: string;
      note?: string;
    };

type LearningGuideHitlState = {
  messageText: string;
  events: string[];
  approvals: string[];
  notes: string[];
};

type LearningGuideHitlSession = {
  runtime: ReturnType<typeof createUaisLangGraphRuntime>;
  graph: ReturnType<typeof createLearningGuideHitlGraph>;
};

type LearningGuideHitlPostHandlerDeps = {
  env?: Record<string, string | undefined>;
};

const learningGuideHitlGraphId = "learning-ai-guide-hitl" as const;

const LearningGuideHitlStateAnnotation = Annotation.Root({
  messageText: Annotation<string>(),
  events: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  approvals: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  notes: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

export const POST = createLearningAiGuideHitlPostHandler();

export function createLearningAiGuideHitlPostHandler(
  deps: LearningGuideHitlPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  let session: LearningGuideHitlSession | undefined;

  return async function POST(request: Request) {
    try {
      const appSession = getUaisAppSessionUserFromCookieString(
        request.headers.get("cookie"),
        { env },
      );
      if (!appSession) {
        throw new PublicLearningGuideHitlError(
          "UAIS app session is required for learning AI guide human review.",
          401,
        );
      }

      session ??= createLearningGuideHitlSession(env);
      const body = parseLearningGuideHitlRequest(await request.json());
      const actor = createLearningGuideHitlActor(appSession);
      // Bind the runtime thread to the authenticated actor so one learner cannot
      // resume or collide with another learner's review thread by reusing a
      // client-chosen threadId. The client keeps using its own threadId; the
      // server scopes it deterministically per actor.
      const scopedThreadId = createScopedHitlThreadId(actor.actorId, body.threadId);

      if (body.action === "start-review") {
        const result = await session.runtime.run<LearningGuideHitlState, LearningGuideHitlState>({
          graph: session.graph,
          graphId: learningGuideHitlGraphId,
          threadId: scopedThreadId,
          actor,
          input: {
            messageText: body.messageText ?? "",
            events: [],
            approvals: [],
            notes: [],
          },
        });

        if (result.status !== "interrupted") {
          throw new PublicLearningGuideHitlError(
            "Learning AI guide human review did not pause for human input.",
            500,
          );
        }

        return Response.json({
          status: "interrupted",
          humanInTheLoop: {
            status: "waiting-human",
            threadId: body.threadId,
            resumeMode: "teacher-or-learner-review",
            interrupt: result.interrupts[0],
          },
          runtime: createHitlRuntimeMetadata({
            status: "interrupted",
            threadId: body.threadId,
            events: result.events,
          }),
          runtimeEvents: result.events,
          redaction: createLearningGuideHitlRedaction(),
        });
      }

      const resumed = await session.runtime.resume<LearningGuideHitlState>({
        graph: session.graph,
        graphId: learningGuideHitlGraphId,
        threadId: scopedThreadId,
        actor,
        resume: {
          decision: body.decision ?? "approved",
          note: body.note ?? "",
        },
      });
      const output = requireCompletedLearningGuideHitlRuntime(resumed);
      const decision = output.approvals.at(-1) ?? body.decision ?? "approved";

      return Response.json({
        status: "completed",
        message: {
          text:
            decision === "rejected"
              ? "人工复核已完成，LangGraph 导学线程已恢复，当前结果标记为需修改。"
              : "人工复核已完成，LangGraph 导学线程已恢复。",
        },
        humanInTheLoop: {
          status: "resumed",
          threadId: body.threadId,
          decision,
          resumeMode: "teacher-or-learner-review",
        },
        runtime: createHitlRuntimeMetadata({
          status: "completed",
          threadId: body.threadId,
          events: resumed.events,
        }),
        runtimeEvents: resumed.events,
        redaction: createLearningGuideHitlRedaction(),
      });
    } catch (error) {
      const publicError = createPublicLearningGuideHitlError(error);
      return Response.json(
        {
          error: publicError.message,
          redaction: createLearningGuideHitlRedaction(),
        },
        { status: publicError.status },
      );
    }
  };
}

function createLearningGuideHitlSession(
  env: Record<string, string | undefined>,
): LearningGuideHitlSession {
  const runtime = createUaisLangGraphRuntime({
    env,
  });

  return {
    runtime,
    graph: createLearningGuideHitlGraph(runtime),
  };
}

function createLearningGuideHitlGraph(
  runtime: ReturnType<typeof createUaisLangGraphRuntime>,
) {
  return new StateGraph(LearningGuideHitlStateAnnotation)
    .addNode("human-review", (state) => {
      const review = readHumanReviewResume(
        interrupt({
          kind: "learning-guide-human-review",
          prompt: "请教师或学习者复核 LangGraph 导学结果。",
          resumeMode: "teacher-or-learner-review",
          messagePreview: state.messageText.slice(0, 180),
        }),
      );

      return {
        approvals: [review.decision],
        notes: review.note ? [review.note] : [],
        events: [`human-review:${review.decision}`],
      };
    })
    .addNode("resume-learning-guide", (state) => ({
      events: [`resume-learning-guide:${state.approvals.at(-1) ?? "approved"}`],
    }))
    .addEdge(START, "human-review")
    .addEdge("human-review", "resume-learning-guide")
    .addEdge("resume-learning-guide", END)
    .compile(runtime.createCompileOptions());
}

function readHumanReviewResume(value: unknown) {
  if (!isRecord(value)) {
    return {
      decision: String(value || "approved"),
      note: "",
    };
  }

  const decision = readString(value.decision);
  return {
    decision: decision === "rejected" ? "rejected" : "approved",
    note: readString(value.note),
  };
}

function parseLearningGuideHitlRequest(value: unknown): LearningGuideHitlRequestBody {
  if (!isRecord(value)) {
    throw new PublicLearningGuideHitlError("Request body must be an object.", 400);
  }

  const action = readString(value.action);
  if (action === "start-review") {
    return {
      action,
      graphId: readString(value.graphId) || undefined,
      threadId: requireSafeId(value.threadId, "threadId"),
      messageText: readString(value.messageText).slice(0, 2000),
    };
  }

  if (action === "resume-review") {
    return {
      action,
      threadId: requireSafeId(value.threadId, "threadId"),
      decision: readString(value.decision) === "rejected" ? "rejected" : "approved",
      note: readString(value.note).slice(0, 1000),
    };
  }

  throw new PublicLearningGuideHitlError("Learning AI guide HITL action is invalid.", 400);
}

export function createScopedHitlThreadId(actorId: string, clientThreadId: string) {
  const digest = createHash("sha256")
    .update(`${actorId}\n${clientThreadId}`)
    .digest("hex")
    .slice(0, 48);
  return `hitl-${digest}`;
}

function createLearningGuideHitlActor(appSession: {
  account: string;
  role: "teacher" | "student" | "admin";
}): UaisLangGraphActor {
  let role: UaisLangGraphActor["role"];
  if (appSession.role === "teacher") {
    role = "educator";
  } else if (appSession.role === "student") {
    role = "learner";
  } else {
    role = "admin";
  }
  return {
    actorId: `app-session-${role}-${toSafeActorIdSegment(appSession.account)}`,
    role,
  };
}

function createHitlRuntimeMetadata(input: {
  status: "interrupted" | "completed";
  threadId: string;
  events: UaisLangGraphRuntimeEvent[];
}) {
  return {
    engine: "uais-langgraph-production-runtime",
    graphId: learningGuideHitlGraphId,
    status: input.status,
    threadId: input.threadId,
    eventCount: input.events.length,
    redaction: createLearningGuideHitlRedaction(),
  };
}

function requireCompletedLearningGuideHitlRuntime(
  result: UaisLangGraphRunResult<LearningGuideHitlState>,
) {
  if (result.status !== "completed") {
    throw new PublicLearningGuideHitlError(
      "Learning AI guide human review resume did not complete.",
      500,
    );
  }
  return result.output;
}

function createPublicLearningGuideHitlError(error: unknown) {
  if (error instanceof PublicLearningGuideHitlError) {
    return error;
  }
  if (
    error instanceof Error &&
    (error.message ===
      "UAIS LangGraph production runtime requires external persistence; configure a GCS-backed checkpointer/store or an external LangGraph runtime persistence adapter." ||
      error.message ===
        "UAIS LangGraph external persistence requires injected checkpointer and store adapters.")
  ) {
    return new PublicLearningGuideHitlError(error.message, 503);
  }
  if (error instanceof Error) {
    return new PublicLearningGuideHitlError(error.message, 400);
  }
  return new PublicLearningGuideHitlError("Learning AI guide human review failed.", 400);
}

function createLearningGuideHitlRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function requireSafeId(value: unknown, label: string) {
  const id = readString(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
    throw new PublicLearningGuideHitlError(`Learning AI guide ${label} is invalid.`, 400);
  }
  return id;
}

function toSafeActorIdSegment(value: string) {
  const safeSegment = value.trim().replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 72);
  return safeSegment || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

class PublicLearningGuideHitlError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PublicLearningGuideHitlError";
    this.status = status;
  }
}
