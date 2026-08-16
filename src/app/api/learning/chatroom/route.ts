import * as Sentry from "@sentry/nextjs";
import { runAgentLoop } from "@/lib/ai/orchestration/agent-loop";
import { hasMentionedAgent } from "@/lib/ai/orchestration/director";
import { assertResponsibleProgressIsDisplaySafe } from "@/lib/ai/progress/responsible-progress";
import { deepSeekTimeoutErrorMessage } from "@/lib/ai/providers/deepseek-client";
import {
  completeChatroomAgentTurn,
  createLearningChatroomCompleterPool,
  type ChatroomAgentProviderRole,
  type ChatroomProviderFactories,
} from "@/lib/server/learning-chatroom-agent-providers";
import {
  createAiRequestRateLimiter,
  resolveAiRequestRateLimitCount,
  resolveAiRequestRateLimitMode,
} from "@/lib/server/ai-request-rate-limit";
import {
  authorizeLearningAiGuideCourseAccess,
  createLearningAiGuideAccessDeniedResponse,
  createLearningAiGuideCourseContextRequiredAccessDecision,
  createLearningChatroomGroupsDisabledAccessDecision,
  type LearningChatroomGroupProjection,
} from "@/lib/server/learning-ai-guide-access";
import { isLearningChatroomGroupsEnabled } from "@/lib/server/learning-chatroom-groups-flag";
import {
  createLearningChatroomAgentSystemPrompt,
  wrapLearningChatroomUntrustedContent,
} from "@/lib/server/learning-chatroom-prompt-safety";
import {
  appendLearningChatroomHistory,
  createLearningChatroomAgentMessageId,
  readLearningChatroomHistory,
  type LearningChatroomHistoryResult,
  type LearningChatroomTranscriptRoomKey,
  type LearningChatroomTranscriptWriteResult,
} from "@/lib/server/learning-chatroom-transcript-runtime";
import { resolveLearningChatroomTranscriptMaxMessages } from "@/lib/server/learning-chatroom-transcript-store";
import { TeachingCourseManagementStoreError } from "@/lib/server/teaching-course-management-store";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";
import type { Locale } from "@/i18n/copy";
import type {
  LearningChatroomTranscriptMessage,
  LearningChatroomTranscriptRepository,
} from "@/lib/server/learning-chatroom-transcript-store";
import type {
  UaisAgentConfig,
  UaisAgentTurn,
  UaisChatMessage,
  UaisOrchestrationEvent,
} from "@/lib/ai/orchestration/types";
import type {
  DeepSeekCompleteInput,
  DeepSeekCompleteResult,
} from "@/lib/ai/providers/deepseek-client";

export const dynamic = "force-dynamic";
// The request's shared provider budget, the transcript append that follows it
// and response assembly must all fit inside the serverless budget: 50s of
// provider work measured from the top of the handler, then at most 3s more for
// the append to confirm, leaving ~7s of the 60s wall for response assembly.
export const maxDuration = 60;

type LearningChatroomAgentId =
  | "research-assistant"
  | "methods-consultant"
  | "math-tutor"
  | "writing-helper";

type LearningChatroomAgent = {
  id: LearningChatroomAgentId;
  handle: string;
  aliases: string[];
  priority: number;
  // Which provider role answers for this agent by default. The room falls over
  // to any other configured role when this one is missing or failing, so this is
  // a preference rather than a hard binding - see the completer pool.
  providerRole: ChatroomAgentProviderRole;
  name: Record<Locale, string>;
  systemPrompt: Record<Locale, string>;
};

type LearningChatroomMessage = {
  id: string;
  role: "student" | "agent";
  content: string;
  agentId?: string;
};

type LearningChatroomRequestBody = {
  locale: Locale;
  courseId: string;
  // Optional because a teacher-owned course carries no class projection; the
  // transcript room key still distinguishes two classes of the same course.
  classId?: string;
  // Optional: absent means the caller's own per-student room, present means the
  // shared room of that assigned group. Both are the same route because the
  // round, the budgets and the mention routing are identical - only the room key
  // and who may open it differ.
  groupId?: string;
  // Persist-only resend. A learner tapping an undelivered bubble is asking for
  // their line to reach the room, not for the agents to answer it a second time:
  // without this marker the retry re-posts the same history, the mention gate
  // reads the same last student message, and the round runs (and bills) again.
  // The marker names the row being resent so a client cannot use it to persist a
  // message it never showed anyone.
  intent?: "resend";
  messageId?: string;
  messages: LearningChatroomMessage[];
};

// What a round hands to the transcript store: the ids the client already renders,
// so re-posting the same visible history stays idempotent.
type LearningChatroomTranscriptWriteMessage = {
  messageId: string;
  role: "student" | "agent";
  content: string;
  agentId?: string;
  authorId?: string;
  authorName?: string;
  authorRole?: "student" | "teacher";
};

// Who the round's student rows are attributed to. Only group rooms carry it: a
// per-student room has exactly one possible author and gains nothing from
// storing the account name on every row.
type LearningChatroomMessageAuthor = {
  authorId: string;
  authorName?: string;
  authorRole: "student" | "teacher";
};

type LearningChatroomTurnError = {
  agentId: string;
  kind: "timeout" | "provider";
};

type DeepSeekTextClient = {
  complete(input: DeepSeekCompleteInput): Promise<DeepSeekCompleteResult>;
};

type LearningChatroomPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  createDeepSeekTextClient?: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => DeepSeekTextClient;
  // Lets a suite drive the failover path without a network: the pool builds a
  // Qwen completer whenever DASHSCOPE_API_KEY is present.
  createQwenMultimodalClient?: ChatroomProviderFactories["createQwenMultimodalClient"];
  fetch?: typeof fetch;
  now?: () => number;
  transcriptRepository?: LearningChatroomTranscriptRepository;
};

type LearningChatroomHistoryGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
  transcriptRepository?: LearningChatroomTranscriptRepository;
};

const learningChatroomMaxMessages = 50;
const learningChatroomMaxMessageLength = 4000;
// Matches the store's own author-name bound, so a long display name is trimmed
// once on the way in rather than differing between the round and the replay.
const learningChatroomMaxAuthorNameLength = 120;
const learningChatroomMaxAgentTurns = 4;
const learningChatroomMaxTokens = 512;
// Arithmetic behind the three budgets, all wall-clock and all inside
// `maxDuration` = 60s: provider work may run until 50s after the handler starts
// (`learningChatroomRequestBudgetMs`); the post-round transcript append may run
// for at most 3s beyond that (`learningChatroomPersistBudgetMs`, cutoff ~53s),
// which leaves ~7s for orchestration bookkeeping and response assembly.
// Pre-round work - the body read and the course authorization store read, itself
// bounded only by a 10s abort - is spent inside that 50s, so a slow
// authorization shortens the round instead of pushing it past the wall. On top
// of that, a round shares one 45s provider budget across every mentioned agent,
// so even a 4-mention all-timeout round answers inside `maxDuration`. The append
// is metered separately because the store's own bounds - a 10s abort per
// external call and one 409 retry of the whole read-modify-write - can exceed
// what is left of the wall on their own.
const learningChatroomRequestBudgetMs = 50000;
const learningChatroomRoundBudgetMs = 45000;
const learningChatroomRoundBudgetReserveMs = 2000;
const learningChatroomPersistBudgetMs = 3000;
// The pre-round room read - the one that carries the freeze state and the
// server-vouched history - is metered too, and for the same reason the append
// is: it happens on the critical path of a request that has a hard wall, and the
// store's own bounds (a 10s abort per external call) can outlast what is left of
// it. An unconfirmed read degrades rather than fails - see the call site - so a
// short budget costs the round its prior context, never the round itself.
const learningChatroomRoomReadBudgetMs = 5000;
const learningChatroomMinProviderTimeoutMs = 3000;
const learningChatroomMaxProviderTimeoutMs = 15000;
const learningChatroomEmptyContentMessage =
  "DeepSeek returned empty content for the chatroom agent.";
// Spend control. One allowed round costs up to `learningChatroomMaxAgentTurns`
// live completions, so the per-day default caps a single actor at roughly 480
// completions per process per day rather than "unbounded". Both defaults are
// well above ordinary classroom use: a learner sending a message every ten
// seconds for a whole minute still stays inside the per-minute window.
const learningChatroomDefaultRateLimitPerMinute = 6;
const learningChatroomDefaultRateLimitPerDay = 120;
const learningChatroomRateLimitMessage =
  "Learning chatroom rate limit exceeded. Please wait before sending another message.";
// The storage guard for messages that spend nothing. Once agent rounds became
// mention-gated, ordinary conversation stopped being measured against a budget
// sized for provider calls - so it needs its own, far looser ceiling that still
// bounds a client stuck in a send loop. Deliberately fixed constants and not env
// names: this is not a spend knob, and it must not be the thing an operator
// widens while chasing a spend problem. 60/minute is roughly one message per
// second sustained, which no human types and every runaway loop exceeds.
const learningChatroomPostDefaultRateLimitPerMinute = 60;
const learningChatroomPostDefaultRateLimitPerDay = 2000;
const learningChatroomPostRateLimitMessage =
  "Learning chatroom message rate limit exceeded. Please wait before sending another message.";
// A history read spends no provider money, so its budget is not about cost: it
// is the endpoint a room polls on a timer, and every call still costs a course
// authorization read plus a transcript read. The defaults are deliberately
// polling-friendly - a 5s poll interval is 12 reads a minute, so an open room
// plus a manual refresh or two stays well inside 30 - while still bounding a
// client stuck in a retry loop. The per-day window is the same ceiling stated
// over a whole day of continuous polling.
const learningChatroomHistoryDefaultRateLimitPerMinute = 30;
const learningChatroomHistoryDefaultRateLimitPerDay = 2000;
const learningChatroomHistoryRateLimitMessage =
  "Learning chatroom history rate limit exceeded. Please wait before reloading the transcript.";

// Ids must stay aligned with `aiAgents` in `src/data/uais.ts` so learner-facing
// chatroom cards and server orchestration name the same agent.
const learningChatroomAgents: LearningChatroomAgent[] = [
  {
    id: "research-assistant",
    handle: "@研究助教",
    aliases: ["@ResearchTA"],
    priority: 40,
    providerRole: "text-reasoning",
    name: {
      "zh-CN": "研究助教",
      "en-US": "Research TA",
    },
    systemPrompt: {
      "zh-CN":
        "你是 UAIS 大学课程群聊里的研究助教（@研究助教 / @ResearchTA）。你的专长是研究问题、文献线索和变量关系。这是大学课程群聊，请用简洁中文回答，聚焦课程语境，不要编造课程之外的事实、文献或数据。",
      "en-US":
        "You are the Research TA (@ResearchTA / @研究助教) in a UAIS university course group chatroom. Your specialty is research questions, literature leads, and variable relationships. Keep answers concise for a group chatroom, stay inside the course context, and do not invent facts, sources, or data outside it.",
    },
  },
  {
    id: "methods-consultant",
    handle: "@方法顾问",
    aliases: ["@MethodsAdvisor"],
    priority: 30,
    providerRole: "text-reasoning",
    name: {
      "zh-CN": "方法顾问",
      "en-US": "Methods Advisor",
    },
    systemPrompt: {
      "zh-CN":
        "你是 UAIS 大学课程群聊里的方法顾问（@方法顾问 / @MethodsAdvisor）。你的专长是研究设计、数据收集和证据质量。这是大学课程群聊，请用简洁中文回答，聚焦课程语境，不要编造课程之外的事实、数据或研究结论。",
      "en-US":
        "You are the Methods Advisor (@MethodsAdvisor / @方法顾问) in a UAIS university course group chatroom. Your specialty is study design, data collection, and evidence quality. Keep answers concise for a group chatroom, stay inside the course context, and do not invent facts, data, or findings outside it.",
    },
  },
  {
    id: "math-tutor",
    handle: "@数学助教",
    aliases: ["@MathTA"],
    priority: 20,
    providerRole: "text-reasoning",
    name: {
      "zh-CN": "数学助教",
      "en-US": "Math TA",
    },
    systemPrompt: {
      "zh-CN":
        "你是 UAIS 大学课程群聊里的数学助教（@数学助教 / @MathTA）。你的专长是例题设计、解法比较和概念误区。这是大学课程群聊，请用简洁中文回答，聚焦课程语境，不要编造课程之外的事实或结论。",
      "en-US":
        "You are the Math TA (@MathTA / @数学助教) in a UAIS university course group chatroom. Your specialty is example design, solution comparison, and common misconceptions. Keep answers concise for a group chatroom, stay inside the course context, and do not invent facts or results outside it.",
    },
  },
  {
    id: "writing-helper",
    handle: "@写作助手",
    aliases: ["@WritingHelper"],
    priority: 10,
    providerRole: "text-reasoning",
    name: {
      "zh-CN": "写作助手",
      "en-US": "Writing Helper",
    },
    systemPrompt: {
      "zh-CN":
        "你是 UAIS 大学课程群聊里的写作助手（@写作助手 / @WritingHelper）。你的专长是段落结构、学术表达和反馈整合。这是大学课程群聊，请用简洁中文回答，聚焦课程语境，不要编造课程之外的事实或引用。",
      "en-US":
        "You are the Writing Helper (@WritingHelper / @写作助手) in a UAIS university course group chatroom. Your specialty is paragraph structure, academic phrasing, and feedback synthesis. Keep answers concise for a group chatroom, stay inside the course context, and do not invent facts or citations outside it.",
    },
  },
];

export const GET = createLearningChatroomHistoryGetHandler();

// Prior transcript for one room, so a refresh or a navigation reopens the
// conversation instead of an empty chat. Same course authorization as POST: a
// transcript is course data, and only the account that wrote a room may read it.
export function createLearningChatroomHistoryGetHandler(
  deps: LearningChatroomHistoryGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  // One limiter per handler instance, on its own env names and its own counts:
  // POST guards provider spend, GET guards the store reads a polling room makes,
  // so one budget must never consume the other's.
  const rateLimiter = createAiRequestRateLimiter({
    config: readLearningChatroomHistoryRateLimitConfig(env),
  });

  return async function GET(request: Request) {
    const traceId = readSafeLearningChatroomTraceId(request);
    let courseId: string | undefined;
    try {
      const appSession = getUaisAppSessionUserFromCookieString(
        request.headers.get("cookie"),
        { env },
      );
      if (!appSession) {
        throw new PublicLearningChatroomError(
          "UAIS app session is required for the learning chatroom.",
          401,
        );
      }

      const room = parseLearningChatroomHistoryQuery(request);
      courseId = room.courseId;
      if (!room.courseId) {
        const access = createLearningAiGuideCourseContextRequiredAccessDecision({
          appSession,
        });
        return createLearningAiGuideAccessDeniedResponse({ access, traceId });
      }

      // Throttled before the course-authorization store read, so a throttled
      // poller costs no storage round trip. The key is the actor alone for the
      // same reason POST uses one: this check runs before membership is
      // verified, so a course-scoped key would hand any client a fresh budget
      // for every courseId it invents.
      const actor = createLearningChatroomGraphActor(appSession);
      const rateLimit = rateLimiter.check({ key: actor.actorId, nowMs: now() });
      if (!rateLimit.allowed) {
        logLearningChatroomThrottle({
          traceId,
          courseId: room.courseId,
          actorId: actor.actorId,
          windowId: rateLimit.windowId,
          limit: rateLimit.limit,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          message: learningChatroomHistoryRateLimitMessage,
        });
        throw new PublicLearningChatroomError(
          learningChatroomHistoryRateLimitMessage,
          429,
          { retryAfterSeconds: rateLimit.retryAfterSeconds },
        );
      }

      // Cheap, store-free and therefore placed before authorization: a
      // deployment that has not turned group rooms on must answer the same way
      // whether or not the caller would have been a member.
      if (room.groupId && !isLearningChatroomGroupsEnabled(env)) {
        return createLearningAiGuideAccessDeniedResponse({
          access: createLearningChatroomGroupsDisabledAccessDecision({
            appSession,
            courseId: room.courseId,
            groupId: room.groupId,
          }),
          traceId,
        });
      }

      const access = await authorizeLearningAiGuideCourseAccess({
        appSession,
        env,
        fetch: deps.fetch,
        courseId: room.courseId,
        ...(room.groupId ? { groupId: room.groupId } : {}),
      });
      if (access.status === "denied") {
        return createLearningAiGuideAccessDeniedResponse({ access, traceId });
      }

      const group = access.group;
      const transcriptRoom = createLearningChatroomTranscriptRoom({
        courseId: room.courseId,
        classId: room.classId,
        group,
        studentId: appSession.account,
      });

      const history = await readLearningChatroomHistory({
        env,
        fetch: deps.fetch,
        repository: deps.transcriptRepository,
        ...transcriptRoom,
        onError: createLearningChatroomTranscriptErrorLogger(traceId, room.courseId),
      });

      return learningChatroomJsonResponse(
        200,
        {
          courseId: room.courseId,
          ...(transcriptRoom.classId ? { classId: transcriptRoom.classId } : {}),
          ...(group
            ? {
                groupId: group.groupId,
                groupName: group.groupName,
                members: group.members,
              }
            : {}),
          messages: history.messages.map((message) =>
            createLearningChatroomHistoryMessage(message, {
              isGroupRoom: Boolean(group),
              account: appSession.account,
            }),
          ),
          transcript: {
            status: history.status,
            messageCount: history.messages.length,
            // The room is a rolling window, and until now nothing said so
            // anywhere: not the room, not the export, not the share page. A
            // client that knows the window is full can tell its members that
            // older turns are leaving - and that the export and share links
            // they hand out are missing them too.
            window: history.window,
            ...(history.storagePolicy ? { storagePolicy: history.storagePolicy } : {}),
          },
          moderation: createLearningChatroomModerationProjection(history),
          redaction: createLearningChatroomRedaction(),
        },
        traceId,
      );
    } catch (error) {
      return createLearningChatroomErrorResponse({ error, traceId, courseId });
    }
  };
}

export const POST = createLearningChatroomPostHandler();

export function createLearningChatroomPostHandler(
  deps: LearningChatroomPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  // One limiter per handler instance: the module-level `POST` is the single
  // production instance, and each test handler gets its own isolated counts.
  const rateLimiter = createAiRequestRateLimiter({
    config: readLearningChatroomRateLimitConfig(env),
  });
  const postRateLimiter = createAiRequestRateLimiter({
    config: {
      mode: "enforce",
      windows: [
        {
          id: "per-minute",
          limit: learningChatroomPostDefaultRateLimitPerMinute,
          windowMs: 60000,
        },
        {
          id: "per-day",
          limit: learningChatroomPostDefaultRateLimitPerDay,
          windowMs: 86400000,
        },
      ],
    },
  });

  return async function POST(request: Request) {
    // Anchored before the body read and the course authorization so that
    // pre-round time is subtracted from the provider budget rather than ignored.
    const requestDeadlineMs = now() + learningChatroomRequestBudgetMs;
    const traceId = readSafeLearningChatroomTraceId(request);
    let courseId: string | undefined;
    // Set once the round is authorized, so the error path can still persist the
    // learner's own message without ever persisting an unauthorized one.
    let transcriptRoom: LearningChatroomTranscriptRoomKey | undefined;
    let transcriptRequestMessages: LearningChatroomTranscriptWriteMessage[] = [];
    let transcriptWritten = false;
    try {
      const appSession = getUaisAppSessionUserFromCookieString(
        request.headers.get("cookie"),
        { env },
      );
      if (!appSession) {
        throw new PublicLearningChatroomError(
          "UAIS app session is required for the learning chatroom.",
          401,
        );
      }

      const body = parseLearningChatroomRequest(await readLearningChatroomJson(request));
      courseId = body.courseId;
      if (!body.courseId) {
        const access = createLearningAiGuideCourseContextRequiredAccessDecision({
          appSession,
        });
        return createLearningAiGuideAccessDeniedResponse({ access, traceId });
      }

      // Does this message actually address an agent?
      //
      // This is the difference between a chatroom and an AI demo. Before, every
      // line a student typed dispatched the highest-priority agent - so "好的,
      // 3点图书馆见" bought a live completion, and the sender waited out the
      // whole round before their classmates could see it. Forty group rooms
      // experienced that as a broken chat, at real provider cost, for messages
      // nobody addressed to an agent.
      //
      // Decided from the same matcher the director uses, on the same roster the
      // round would use, so the gate and the round can never disagree about who
      // was addressed.
      const roster = createLearningChatroomRoster(body.locale);
      const lastStudentMessage = [...body.messages]
        .reverse()
        .find((message) => message.role === "student");
      // A resend is persist-only by construction: the round is skipped before
      // the mention gate is even consulted, so a retry of a message that DID
      // address an agent still costs nothing and produces no second answer.
      const agentRoundRequested =
        body.intent !== "resend" &&
        (lastStudentMessage
          ? hasMentionedAgent(roster, lastStudentMessage.content)
          : false);

      // Two budgets, because the two costs are different by orders of
      // magnitude.
      //
      // The agent limiter is the spend guard: one allowed round is up to
      // `learningChatroomMaxAgentTurns` live completions, so it stays at the
      // operator-tunable 6/minute it always had - and now applies ONLY to the
      // messages that actually spend. Ordinary conversation is no longer
      // measured against a budget sized for provider calls, which is what made
      // the old limit break normal chat cadence.
      //
      // The post limiter still bounds a message that spends nothing but does
      // cost a store write, so removing the agent throttle from plain chat does
      // not leave the transcript writable without limit. Fixed constants rather
      // than env names: this is a storage guard, not a spend knob, and it must
      // never be the thing an operator widens while chasing a spend problem.
      //
      // Both run before the authorization store read, so a throttled actor
      // costs neither a completion nor a round trip. The key is the actor alone,
      // deliberately not the actor plus courseId: this runs before membership is
      // verified, so a course-scoped key would hand any client a fresh budget
      // for every courseId it invents.
      const actor = createLearningChatroomGraphActor(appSession);
      const postRateLimit = postRateLimiter.check({ key: actor.actorId, nowMs: now() });
      if (!postRateLimit.allowed) {
        logLearningChatroomThrottle({
          traceId,
          courseId: body.courseId,
          actorId: actor.actorId,
          windowId: postRateLimit.windowId,
          limit: postRateLimit.limit,
          retryAfterSeconds: postRateLimit.retryAfterSeconds,
          message: learningChatroomPostRateLimitMessage,
        });
        throw new PublicLearningChatroomError(learningChatroomPostRateLimitMessage, 429, {
          retryAfterSeconds: postRateLimit.retryAfterSeconds,
        });
      }

      if (agentRoundRequested) {
        const rateLimit = rateLimiter.check({ key: actor.actorId, nowMs: now() });
        if (!rateLimit.allowed) {
          logLearningChatroomThrottle({
            traceId,
            courseId: body.courseId,
            actorId: actor.actorId,
            windowId: rateLimit.windowId,
            limit: rateLimit.limit,
            retryAfterSeconds: rateLimit.retryAfterSeconds,
            message: learningChatroomRateLimitMessage,
          });
          throw new PublicLearningChatroomError(learningChatroomRateLimitMessage, 429, {
            retryAfterSeconds: rateLimit.retryAfterSeconds,
          });
        }
      }

      if (body.groupId && !isLearningChatroomGroupsEnabled(env)) {
        return createLearningAiGuideAccessDeniedResponse({
          access: createLearningChatroomGroupsDisabledAccessDecision({
            appSession,
            courseId: body.courseId,
            groupId: body.groupId,
          }),
          traceId,
        });
      }

      const access = await authorizeLearningAiGuideCourseAccess({
        appSession,
        env,
        fetch: deps.fetch,
        courseId: body.courseId,
        ...(body.groupId ? { groupId: body.groupId } : {}),
      });
      if (access.status === "denied") {
        return createLearningAiGuideAccessDeniedResponse({ access, traceId });
      }

      const group = access.group;
      const room = createLearningChatroomTranscriptRoom({
        courseId: body.courseId,
        classId: body.classId,
        group,
        studentId: appSession.account,
      });
      const logTranscriptError = createLearningChatroomTranscriptErrorLogger(
        traceId,
        body.courseId,
      );
      // One read, two jobs. It carries the room's moderation state, which the
      // freeze gate below needs on EVERY post; and it is the only history the
      // provider round is allowed to see, because it is the only history this
      // server wrote (see `createLearningChatroomProviderHistory`).
      //
      // Metered against the wall like the append is. A read that cannot confirm
      // in time degrades to "no stored history": the freeze gate then fails open
      // and the round runs on the client's own unstored student rows, which is a
      // round with less context - never a round that leaked forged agent turns,
      // because the fallback carries no agent rows at all.
      const roomHistory = await raceLearningChatroomBudget({
        budgetMs: Math.min(
          learningChatroomRoomReadBudgetMs,
          requestDeadlineMs - now(),
        ),
        timedOut: createUnavailableLearningChatroomHistory(room.groupId),
        run: () =>
          readLearningChatroomHistory({
            env,
            fetch: deps.fetch,
            repository: deps.transcriptRepository,
            ...room,
            onError: logTranscriptError,
          }),
      });

      // A frozen room refuses student writes and keeps taking the teacher's, so
      // an instructor can quiet a room and still speak into it. The check sits
      // before `transcriptRoom` is set, so the error path below cannot persist
      // the refused message as a consolation.
      //
      // Deliberately fail-open when the transcript could not be read at all: a
      // storage outage must not silently mute a whole class, and a message that
      // gets through will report its own `unavailable` receipt anyway.
      if (
        roomHistory.moderation?.status === "frozen" &&
        appSession.role !== "teacher"
      ) {
        throw new PublicLearningChatroomError(
          "UAIS learning chatroom room is frozen by the course teacher.",
          423,
          { reasonCode: "chatroom-room-frozen" },
        );
      }

      transcriptRoom = room;
      // Student rows are attributed to the sender at append time. Only rows the
      // room has never stored are actually written, and another member's message
      // can only ever reach this client through a GET - which means it was
      // already stored, with its own author - so re-posted history cannot be
      // re-attributed to whoever happens to be posting now.
      const author = group ? createLearningChatroomMessageAuthor(appSession) : undefined;
      // Only the learner's own rows are taken from the request body. A
      // client-supplied `role:"agent"` row is never persisted: agent turns are
      // always server-minted below (see `turns`) and idempotent by message id,
      // so a genuine agent reply is already stored and a re-post is a no-op -
      // while a forged `{ role:"agent", agentId, content }` row must never reach
      // a transcript that replays to every member's GET and to the signed-out
      // `/share` page rendered as a trusted AI TA. This filter is the single
      // guard for both append paths (success and error/catch), which each read
      // `transcriptRequestMessages`.
      transcriptRequestMessages = body.messages
        .filter((message) => message.role === "student")
        .map((message) => createLearningChatroomTranscriptMessage(message, author));

      // FAST PATH: nobody addressed an agent, so there is no round to wait for.
      //
      // The message is persisted here and the response returns immediately -
      // the difference between a classmate seeing "好的，3点图书馆见" in about a
      // second and seeing it after the ten-to-fifty seconds a provider round
      // takes. It also spends nothing: no completer pool is built, so a
      // deployment with no provider key configured can still carry a
      // human-to-human conversation instead of 503-ing on every line.
      //
      // The response keeps the same shape as a round that produced no turns,
      // which the client already handles as a cue-user round: `turns: []`
      // renders nothing and clears the thinking indicator.
      if (!agentRoundRequested) {
        const transcript = await persistLearningChatroomHistoryWithinBudget({
          budgetMs: requestDeadlineMs + learningChatroomPersistBudgetMs - now(),
          append: (retryBudgetMs) =>
            appendLearningChatroomHistory({
              env,
              fetch: deps.fetch,
              repository: deps.transcriptRepository,
              ...room,
              messages: transcriptRequestMessages,
              now: new Date(now()).toISOString(),
              retryBudgetMs,
              onError: logTranscriptError,
            }),
        });
        transcriptWritten = true;

        return learningChatroomJsonResponse(
          200,
          {
            status: "cue-user",
            turns: [],
            transcript: createLearningChatroomTranscriptReceipt(transcript),
            // Named so a reader of the response - or of a support ticket - can
            // tell "no agent answered because none was addressed" apart from
            // "no agent answered because the round failed", and both apart from
            // a resend, which is a delivery retry rather than a conversation.
            agentRound: {
              status: "skipped",
              reason:
                body.intent === "resend" ? "resend-intent" : "no-agent-mentioned",
            },
            redaction: createLearningChatroomRedaction(),
          },
          traceId,
        );
      }

      // One completer per configured provider role. A round needs at least one;
      // it does NOT need a particular one, which is what stops a single provider
      // outage from silencing all four agents.
      const completerPool = createLearningChatroomCompleterPool({
        env,
        factories: {
          ...(deps.createDeepSeekTextClient
            ? { createDeepSeekTextClient: deps.createDeepSeekTextClient }
            : {}),
          ...(deps.createQwenMultimodalClient
            ? { createQwenMultimodalClient: deps.createQwenMultimodalClient }
            : {}),
        },
      });
      if (completerPool.size === 0) {
        throw new PublicLearningChatroomError(
          "DEEPSEEK_API_KEY is required for the learning chatroom.",
          503,
        );
      }
      // Persona plus the injection preamble. Assembled here, once per round,
      // rather than baked into the roster above so the personas stay readable as
      // teaching instructions and the safety rules stay in one auditable place.
      const promptsByAgentId = new Map(
        learningChatroomAgents.map((agent) => [
          agent.id as string,
          createLearningChatroomAgentSystemPrompt({
            personaPrompt: agent.systemPrompt[body.locale],
            locale: body.locale,
          }),
        ]),
      );
      const providerRolesByAgentId = new Map<string, ChatroomAgentProviderRole>(
        learningChatroomAgents.map((agent) => [agent.id as string, agent.providerRole]),
      );
      const namesByAgentId = new Map(
        learningChatroomAgents.map((agent) => [agent.id as string, agent.name[body.locale]]),
      );
      const modelsByAgentId = new Map<string, string>();
      const providersByAgentId = new Map<string, "deepseek" | "qwen">();
      const rolesByAgentId = new Map<string, ChatroomAgentProviderRole>();
      const history = createLearningChatroomProviderHistory({
        storedMessages: roomHistory.messages,
        hiddenMessageIds: roomHistory.hiddenMessageIds,
        requestMessages: body.messages,
      });
      const turnErrors: LearningChatroomTurnError[] = [];
      const turnFailureMessages: string[] = [];
      // The round budget is whichever ends first: the round's own 45s window, or
      // what is left of the request budget once the body read and course
      // authorization have been paid for. Every later agent in the round then
      // sees a shorter remaining window.
      const roundDeadlineMs = Math.min(
        now() + learningChatroomRoundBudgetMs,
        requestDeadlineMs,
      );

      // A failed provider call must not sink the whole round: the agent
      // contributes a localized fallback notice instead, and the failure is
      // reported through the 200 response's `turnErrors` field.
      const recordFailedTurn = (input: {
        agentId: string;
        failureMessage: string;
        logMessage?: string;
        error: unknown;
      }): UaisAgentTurn => {
        turnErrors.push({
          agentId: input.agentId,
          kind:
            input.failureMessage === deepSeekTimeoutErrorMessage ? "timeout" : "provider",
        });
        turnFailureMessages.push(input.failureMessage);
        logLearningChatroomError({
          traceId,
          phase: "agent-turn",
          courseId: body.courseId,
          agentId: input.agentId,
          message: input.logMessage ?? input.failureMessage,
          error: input.error,
        });
        return {
          agentId: input.agentId,
          content: createLearningChatroomFallbackContent(input.agentId, body.locale),
          actions: [],
        };
      };

      const result = await runAgentLoop({
        agents: roster,
        messages: body.messages.map(createOrchestrationMessage),
        maxAgentTurns: learningChatroomMaxAgentTurns,
        actor,
        env,
        respond: async (agent, context) => {
          const systemPrompt = promptsByAgentId.get(agent.id);
          if (!systemPrompt) {
            throw new PublicLearningChatroomError(
              "UAIS learning chatroom agent is not configured.",
              400,
            );
          }

          // The request history ends at the student's message, so a
          // multi-mention round must append the turns already produced in this
          // round; otherwise later agents answer blind and repeat earlier ones.
          const sameRoundTurns = context.turns.map((turn) => ({
            role: "assistant" as const,
            content: `[${namesByAgentId.get(turn.agentId) ?? turn.agentId}] ${turn.content}`,
          }));

          const providerTimeoutMs = resolveLearningChatroomProviderTimeoutMs(
            roundDeadlineMs - now(),
          );
          if (providerTimeoutMs === undefined) {
            // Too little of the round budget is left to start another provider
            // call, so this agent times out immediately instead of pushing the
            // round past the serverless duration limit.
            const budgetMessage =
              "Learning chatroom round budget was exhausted before this agent turn.";
            return recordFailedTurn({
              agentId: agent.id,
              failureMessage: deepSeekTimeoutErrorMessage,
              logMessage: budgetMessage,
              error: new Error(budgetMessage),
            });
          }

          try {
            const completion = await completeChatroomAgentTurn({
              pool: completerPool,
              preferredRole:
                providerRolesByAgentId.get(agent.id) ?? "text-reasoning",
              maxTokens: learningChatroomMaxTokens,
              // Re-read per attempt: a failover spends the same round budget the
              // first attempt was already drawing on, never a fresh one.
              remainingMs: () => roundDeadlineMs - now(),
              resolveTimeoutMs: resolveLearningChatroomProviderTimeoutMs,
              onFailover: ({ role, nextRole, error }) => {
                logLearningChatroomError({
                  traceId,
                  phase: "agent-turn",
                  courseId: body.courseId,
                  agentId: agent.id,
                  message: `Learning chatroom agent provider ${role} failed; falling over to ${nextRole}.`,
                  error,
                });
              },
              messages: [
                { role: "system", content: systemPrompt },
                ...history,
                ...sameRoundTurns,
              ],
            });

            const content = stripLearningChatroomSelfPrefix(
              completion.content.trim(),
              agent.id,
            );
            if (!content) {
              throw new Error(learningChatroomEmptyContentMessage);
            }
            modelsByAgentId.set(agent.id, completion.model);
            providersByAgentId.set(agent.id, completion.provider);
            rolesByAgentId.set(agent.id, completion.role);

            return {
              agentId: agent.id,
              content,
              actions: [],
            };
          } catch (error) {
            return recordFailedTurn({
              agentId: agent.id,
              failureMessage:
                error instanceof Error ? error.message : "DeepSeek request failed.",
              error,
            });
          }
        },
      });

      if (result.turns.length > 0 && turnErrors.length === result.turns.length) {
        // Every agent in the round failed; a round of pure fallback notices is
        // not a usable 200. Timeout wins the status so the UI can distinguish.
        const hasTimeout = turnErrors.some((turnError) => turnError.kind === "timeout");
        throw new PublicLearningChatroomError(
          hasTimeout
            ? deepSeekTimeoutErrorMessage
            : turnFailureMessages[0] ?? "DeepSeek request failed.",
          hasTimeout ? 504 : 502,
        );
      }

      // Message ids are minted here and echoed back so the client renders the
      // turn under the id the room stored: the next round re-posts that id and
      // the append stays idempotent instead of duplicating the reply.
      const roundStampMs = now();
      const roundIdSuffix = crypto.randomUUID().slice(0, 8);
      const turns = result.turns.map((turn, index) => ({
        messageId: createLearningChatroomAgentMessageId({
          nowMs: roundStampMs,
          index,
          uniqueSuffix: roundIdSuffix,
        }),
        agentId: turn.agentId,
        content: turn.content,
        // Reports the provider that ACTUALLY answered, which after a failover
        // is not necessarily the agent's preferred one.
        provider: {
          provider: providersByAgentId.get(turn.agentId) ?? "deepseek",
          role: rolesByAgentId.get(turn.agentId) ?? "text-reasoning",
          model: modelsByAgentId.get(turn.agentId) ?? "unavailable",
        },
      }));

      // The round is already answered, so persistence reports its outcome
      // instead of throwing: a storage outage costs the room its history on the
      // next visit, never the conversation the learner is having now. The same
      // reasoning bounds how long it may take - see
      // `persistLearningChatroomHistoryWithinBudget`.
      const transcript = await persistLearningChatroomHistoryWithinBudget({
        budgetMs: requestDeadlineMs + learningChatroomPersistBudgetMs - now(),
        append: (retryBudgetMs) =>
          appendLearningChatroomHistory({
            env,
            fetch: deps.fetch,
            repository: deps.transcriptRepository,
            ...room,
            messages: [
              ...transcriptRequestMessages,
              ...turns.map((turn) => ({
                messageId: turn.messageId,
                role: "agent" as const,
                content: turn.content,
                ...(turn.agentId ? { agentId: turn.agentId } : {}),
              })),
            ],
            now: new Date(roundStampMs).toISOString(),
            retryBudgetMs,
            onError: logTranscriptError,
          }),
      });
      transcriptWritten = true;

      return learningChatroomJsonResponse(200, {
        status: result.status,
        turns,
        ...(turnErrors.length > 0 ? { turnErrors } : {}),
        transcript: createLearningChatroomTranscriptReceipt(transcript),
        progress: createLearningChatroomProgress(result.events),
        orchestration: {
          trace: result.trace,
          runtime: result.runtime,
          runtimeEvents: result.runtimeEvents,
        },
        redaction: createLearningChatroomRedaction(),
      }, traceId);
    } catch (error) {
      // The round is lost, but the learner's own message must still survive a
      // refresh, so an authorized request history is persisted best-effort
      // before the failure answer. Nothing runs for a request that never got
      // past validation, throttling or course authorization. This append is
      // deadline-bounded exactly like the success path's: a hung store must not
      // swallow the contractual 502/504/500 body the client is owed.
      if (transcriptRoom && !transcriptWritten && transcriptRequestMessages.length > 0) {
        const failedRoom = transcriptRoom;
        await persistLearningChatroomHistoryWithinBudget({
          budgetMs: requestDeadlineMs + learningChatroomPersistBudgetMs - now(),
          append: (retryBudgetMs) =>
            appendLearningChatroomHistory({
              env,
              fetch: deps.fetch,
              repository: deps.transcriptRepository,
              ...failedRoom,
              messages: transcriptRequestMessages,
              now: new Date(now()).toISOString(),
              retryBudgetMs,
              onError: createLearningChatroomTranscriptErrorLogger(
                traceId,
                failedRoom.courseId,
              ),
            }),
        });
      }
      return createLearningChatroomErrorResponse({ error, traceId, courseId });
    }
  };
}

// Persistence runs after the round is already paid for, so it is metered against
// what is left of the serverless wall rather than against the store's own
// bounds: an append that cannot confirm inside `budgetMs` is reported as
// `unavailable` and abandoned, which costs the room its history instead of
// letting the platform kill the function and cost the learner the answered round.
//
// Two consequences worth stating. The abandoned append keeps running detached
// and may still land, so `unavailable` here means "not confirmed within budget",
// not "not written" - safe only because appends are idempotent per message id
// (`appendLearningChatroomTranscriptMessages` skips ids the room already holds)
// and both write paths replace a whole snapshot rather than part of a record.
// And the store's 409 retry is not cancelled: this race stays the single
// deadline authority. The same budget is merely handed to the store as a retry
// allowance, so a group room - which retries up to four times against a snapshot
// several members are writing - stops starting attempts nobody is waiting for.
async function persistLearningChatroomHistoryWithinBudget(input: {
  budgetMs: number;
  append: (retryBudgetMs: number) => Promise<LearningChatroomTranscriptWriteResult>;
}): Promise<LearningChatroomTranscriptWriteResult> {
  return raceLearningChatroomBudget({
    budgetMs: input.budgetMs,
    timedOut: { status: "unavailable" },
    run: input.append,
  });
}

// The cutoff itself, shared by the append above and the pre-round room read.
// Both are store calls on a request with a hard wall, both degrade to a reported
// status rather than an error, and both must abandon rather than outlast the
// budget - so there is exactly one implementation of "wait this long, then take
// the fallback".
async function raceLearningChatroomBudget<T>(input: {
  budgetMs: number;
  timedOut: T;
  run: (budgetMs: number) => Promise<T>;
}): Promise<T> {
  if (input.budgetMs <= 0) {
    // No wall left at all, so the store is not even called: starting work that
    // cannot finish only spends someone else's budget.
    return input.timedOut;
  }

  let cutoffTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.run(input.budgetMs),
      new Promise<T>((resolveLate) => {
        cutoffTimer = setTimeout(() => resolveLate(input.timedOut), input.budgetMs);
        // Node keeps the process alive for a pending timer; jsdom has no
        // `unref` at all, hence the optional call.
        (cutoffTimer as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    // Not hygiene: without this a fast call leaves the cutoff timer pending for
    // the whole budget, which under jsdom (no `unref`) holds the test run.
    clearTimeout(cutoffTimer);
  }
}

function createUnavailableLearningChatroomHistory(
  groupId: string | undefined,
): LearningChatroomHistoryResult {
  return {
    status: "unavailable",
    messages: [],
    hiddenMessageCount: 0,
    // A read that timed out knows of no moderation decision, so it claims none.
    // The round it degrades into carries the client's own unstored student rows,
    // which is a round with less context - never one that smuggles agent turns.
    hiddenMessageIds: [],
    // A read that never confirmed knows nothing about the window either, so it
    // reports the cap it would have been trimmed to and claims no eviction.
    window: {
      maxMessages: resolveLearningChatroomTranscriptMaxMessages(groupId),
      atCapacity: false,
    },
  };
}

// Shared by both handlers: a public error keeps its status and message, anything
// else answers 500 and is logged (never returned) with the round's trace id.
function createLearningChatroomErrorResponse(input: {
  error: unknown;
  traceId: string;
  courseId?: string;
}) {
  const publicError = createPublicLearningChatroomError(input.error);
  const status = publicError?.status ?? 500;
  const message = publicError?.message ?? "Learning chatroom request failed.";
  if (status >= 500) {
    logLearningChatroomError({
      traceId: input.traceId,
      phase: "request",
      courseId: input.courseId,
      message: input.error instanceof Error ? input.error.message : message,
      error: input.error,
    });
  }
  return learningChatroomJsonResponse(
    status,
    {
      error: message,
      ...(publicError?.reasonCode ? { reasonCode: publicError.reasonCode } : {}),
      traceId: input.traceId,
      redaction: createLearningChatroomRedaction(),
    },
    input.traceId,
    publicError?.retryAfterSeconds === undefined
      ? undefined
      : { "retry-after": String(publicError.retryAfterSeconds) },
  );
}

// Every chatroom response carries the trace id so a failed round in the browser
// can be correlated with the server log line without reading the body.
function learningChatroomJsonResponse(
  status: number,
  body: unknown,
  traceId: string,
  extraHeaders?: Record<string, string>,
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
      ...extraHeaders,
    },
  });
}

// Reads the spend guard from env at handler construction. Every value has a
// protective default, so an unconfigured deployment is still rate limited.
function readLearningChatroomRateLimitConfig(env: Record<string, string | undefined>) {
  return createLearningChatroomRateLimitConfig({
    mode: env.UAIS_LEARNING_CHATROOM_RATE_LIMIT_MODE,
    perMinute: env.UAIS_LEARNING_CHATROOM_RATE_LIMIT_PER_MINUTE,
    perDay: env.UAIS_LEARNING_CHATROOM_RATE_LIMIT_PER_DAY,
    defaultPerMinute: learningChatroomDefaultRateLimitPerMinute,
    defaultPerDay: learningChatroomDefaultRateLimitPerDay,
  });
}

// The GET guard, on its own env names so an operator can widen polling without
// also widening provider spend.
function readLearningChatroomHistoryRateLimitConfig(
  env: Record<string, string | undefined>,
) {
  return createLearningChatroomRateLimitConfig({
    mode: env.UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_MODE,
    perMinute: env.UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_MINUTE,
    perDay: env.UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_DAY,
    defaultPerMinute: learningChatroomHistoryDefaultRateLimitPerMinute,
    defaultPerDay: learningChatroomHistoryDefaultRateLimitPerDay,
  });
}

// Both chatroom limiters use the same two windows and the same fail-closed
// parsing; only their env names and defaults differ. The variables are read at
// the call sites above as literal property accesses so the release env-surface
// catalog can still find every name by search.
function createLearningChatroomRateLimitConfig(input: {
  mode: string | undefined;
  perMinute: string | undefined;
  perDay: string | undefined;
  defaultPerMinute: number;
  defaultPerDay: number;
}) {
  return {
    mode: resolveAiRequestRateLimitMode(input.mode),
    windows: [
      {
        id: "per-minute",
        limit: resolveAiRequestRateLimitCount(input.perMinute, input.defaultPerMinute),
        windowMs: 60000,
      },
      {
        id: "per-day",
        limit: resolveAiRequestRateLimitCount(input.perDay, input.defaultPerDay),
        windowMs: 86400000,
      },
    ],
  };
}

// Returns the provider timeout for the next agent in the round, or `undefined`
// when too little budget remains to start another provider call at all.
function resolveLearningChatroomProviderTimeoutMs(remainingBudgetMs: number) {
  const availableMs = remainingBudgetMs - learningChatroomRoundBudgetReserveMs;
  if (availableMs < learningChatroomMinProviderTimeoutMs) {
    return undefined;
  }
  return Math.min(availableMs, learningChatroomMaxProviderTimeoutMs);
}

async function readLearningChatroomJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    // Malformed JSON is a client mistake, not an unexpected server error.
    throw new PublicLearningChatroomError("Request body must be an object.", 400);
  }
}

// Localized server-side so every chatroom client renders the same notice; the
// contract pins this exact wording, so keep it aligned with the frontend.
function createLearningChatroomFallbackContent(agentId: string, locale: Locale) {
  const agent = learningChatroomAgents.find((candidate) => candidate.id === agentId);
  if (locale === "zh-CN") {
    return `（${agent?.name["zh-CN"] ?? agentId} 暂时不可用，请稍后重试。）`;
  }
  return `(${agent?.name["en-US"] ?? agentId} is temporarily unavailable. Please try again.)`;
}

// Never log message content, cookies, or env values: traceId plus ids and the
// provider error message are enough to correlate a failed round.
function logLearningChatroomError(input: {
  traceId: string;
  phase: "agent-turn" | "request" | "transcript-read" | "transcript-write";
  courseId?: string;
  agentId?: string;
  message: string;
  error: unknown;
}) {
  logLearningChatroomEvent({ level: "error", ...input });
  try {
    Sentry.captureException(input.error, { tags: { route: "learning-chatroom" } });
  } catch {
    // Sentry reporting must never break the chatroom response path.
  }
}

// A throttle is an expected, healthy outcome, so it goes through the same
// structured line at warn level and deliberately skips `Sentry.captureException`:
// a throttled actor retrying in a loop must not flood the error budget. The
// actor id is the same sanitized segment the response already returns as the
// orchestration actor, so this adds no identifier that was not public already.
// Both handlers share the line; the message is what tells an operator whether a
// round or a history read was rejected.
function logLearningChatroomThrottle(input: {
  traceId: string;
  courseId?: string;
  actorId: string;
  windowId: string;
  limit: number;
  retryAfterSeconds: number;
  message: string;
}) {
  logLearningChatroomEvent({
    level: "warn",
    traceId: input.traceId,
    phase: "rate-limit",
    courseId: input.courseId,
    actorId: input.actorId,
    rateLimit: {
      windowId: input.windowId,
      limit: input.limit,
      retryAfterSeconds: input.retryAfterSeconds,
    },
    message: input.message,
  });
}

function logLearningChatroomEvent(input: {
  level: "error" | "warn";
  traceId: string;
  phase:
    | "agent-turn"
    | "request"
    | "rate-limit"
    | "transcript-read"
    | "transcript-write";
  courseId?: string;
  agentId?: string;
  actorId?: string;
  rateLimit?: { windowId: string; limit: number; retryAfterSeconds: number };
  message: string;
}) {
  const payload = {
    traceId: input.traceId,
    phase: input.phase,
    ...(input.courseId ? { courseId: input.courseId } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.rateLimit ? { rateLimit: input.rateLimit } : {}),
    message: input.message,
  };
  if (input.level === "warn") {
    console.warn("[learning-chatroom]", payload);
    return;
  }
  console.error("[learning-chatroom]", payload);
}

function createLearningChatroomRoster(locale: Locale): UaisAgentConfig[] {
  return learningChatroomAgents.map((agent) => ({
    id: agent.id,
    handle: agent.handle,
    aliases: [...agent.aliases],
    name: agent.name[locale],
    role: "assistant" as const,
    providerRole: "text-reasoning" as const,
    priority: agent.priority,
    allowedActions: ["respond"],
  }));
}

function createOrchestrationMessage(message: LearningChatroomMessage): UaisChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.agentId ? { agentId: message.agentId } : {}),
  };
}

/**
 * The provider's view of the conversation, rebuilt from what the SERVER stored.
 *
 * The round used to be assembled straight from the request body, which meant a
 * client could post `{ role: "agent", agentId, content }` rows and have them
 * mapped into `assistant` turns. Those rows were already refused persistence -
 * a forged agent reply must never reach a transcript that replays to every
 * member and to the signed-out `/share` page - but they still reached the
 * prompt, so a learner could seed "the AI TA already said X" into a round they
 * were about to be billed for, and every agent in that round would answer as if
 * it had.
 *
 * So agent turns come only from the stored transcript, which contains exactly
 * the turns this server minted. The one thing the store cannot supply is the
 * message being sent right now - it is not persisted until after the round - so
 * unstored STUDENT rows from the request are appended, and unstored agent rows
 * are dropped on the floor.
 *
 * Hidden rows never appear. The store filters them out of `storedMessages`
 * before this sees them - but that alone was not enough, and was the hole this
 * paragraph used to paper over. A row the teacher hides is absent from the
 * stored list, which is indistinguishable from "never stored", so a client still
 * holding the hidden bubble (its author's own tab, or any member whose poll had
 * not landed yet) re-posted it and it was appended as an unstored PENDING
 * student row. The transcript refused it - the append is idempotent by message
 * id and the hidden row is still there - so the room stayed clean while the
 * moderated text went into every subsequent billed prompt, which is precisely
 * the injection attempt a teacher hides a message to stop. So the hidden ids
 * travel with the read and are subtracted from the pending rows here.
 *
 * The combined history is capped at the same `learningChatroomMaxMessages` the
 * request was capped at. Without that cap a group room - which keeps a 500-turn
 * window - would suddenly send ten times the tokens the per-request slice was
 * sized for.
 */
function createLearningChatroomProviderHistory(input: {
  storedMessages: LearningChatroomTranscriptMessage[];
  hiddenMessageIds: string[];
  requestMessages: LearningChatroomMessage[];
}) {
  // Both halves of what the room has ALREADY taken a decision about: the rows it
  // replays, and the rows a teacher removed from that replay. A request row
  // matching either is not a new message and must not be appended as one.
  const settledIds = new Set([
    ...input.storedMessages.map((message) => message.messageId),
    ...input.hiddenMessageIds,
  ]);
  const pendingStudentMessages = input.requestMessages.filter(
    (message) => message.role === "student" && !settledIds.has(message.id),
  );

  return [
    ...input.storedMessages.map((message) =>
      createDeepSeekHistoryMessage(message.role, message.content),
    ),
    ...pendingStudentMessages.map((message) =>
      createDeepSeekHistoryMessage("student", message.content),
    ),
  ].slice(-learningChatroomMaxMessages);
}

// Student text is untrusted input, so it travels inside the delimiters the
// system prompt tells the model to treat as data. Agent turns are this server's
// own minted output and stay unwrapped - wrapping them would blur exactly the
// line the delimiters exist to draw.
function createDeepSeekHistoryMessage(role: "student" | "agent", content: string) {
  if (role === "agent") {
    return { role: "assistant" as const, content };
  }
  return {
    role: "user" as const,
    content: wrapLearningChatroomUntrustedContent(content),
  };
}

// Live completions sometimes mimic the same-round context convention and open
// with the agent's own bracketed name (observed: "[数学助教] @数学助教 已收到…").
// Strip one leading self-name prefix, and one self-handle immediately after it,
// but never other agents' names: those stay meaningful attribution.
function stripLearningChatroomSelfPrefix(content: string, agentId: string) {
  const agent = learningChatroomAgents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return content;
  }

  // Both locale names are checked, not just the request locale: a reply does not
  // always follow the locale it was asked in, and replayed history can carry the
  // other locale's attribution.
  const bracketedSelfName = Object.values(agent.name)
    .map((name) => `[${name}]`)
    .find((prefix) => content.startsWith(prefix));
  if (!bracketedSelfName) {
    return content;
  }

  let stripped = content.slice(bracketedSelfName.length).trimStart();
  const selfHandle = [agent.handle, ...agent.aliases].find((handle) => {
    if (!stripped.startsWith(handle)) {
      return false;
    }
    // Only an ASCII handle can hide inside a longer word ("@MathTA" in
    // "@MathTAlk"), so it must end at a non-word character; after a CJK handle
    // every character is already a boundary. Mention routing stays substring-
    // based in `findFirstMentionIndex` — only this deletion needs to be strict.
    return (
      !/[A-Za-z0-9_]$/.test(handle) ||
      !/[A-Za-z0-9_]/.test(stripped.charAt(handle.length))
    );
  });
  if (selfHandle) {
    stripped = stripped.slice(selfHandle.length).trimStart();
  }
  return stripped;
}

function createLearningChatroomProgress(events: UaisOrchestrationEvent[]) {
  return assertResponsibleProgressIsDisplaySafe([
    ...events.map((event, index) => ({
      id: `progress-${index + 1}`,
      type: event.type,
      responsibleSession: event.responsibleSession,
      ...(event.responsibleAgent ? { responsibleAgent: event.responsibleAgent } : {}),
      progressText: event.progressText,
    })),
    {
      id: `progress-${events.length + 1}`,
      type: "provider-credentials",
      responsibleSession: "S19" as const,
      progressText: "S19 provider credentials stayed server-side and redacted.",
    },
  ]);
}

function createLearningChatroomGraphActor(appSession: {
  account: string;
  role: "teacher" | "student" | "admin";
}) {
  let role: "admin" | "educator" | "learner";
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
  } as const;
}

// GET carries the room key in the query string. An absent courseId is answered
// with the same course-context-required denial POST uses, so both handlers say
// the same thing when the client has not resolved a course yet.
function parseLearningChatroomHistoryQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const courseId = readString(params.get("courseId"));
  if (courseId.length > 200) {
    throw new PublicLearningChatroomError(
      "Learning chatroom courseId must be 1-200 characters.",
      400,
    );
  }

  return {
    courseId,
    classId: readLearningChatroomClassId(params.get("classId")),
    groupId: readLearningChatroomGroupId(params.get("groupId")),
  };
}

function readLearningChatroomClassId(value: unknown) {
  const classId = readString(value);
  if (classId.length > 200) {
    throw new PublicLearningChatroomError(
      "Learning chatroom classId must be at most 200 characters.",
      400,
    );
  }
  return classId;
}

function readLearningChatroomGroupId(value: unknown) {
  const groupId = readString(value);
  if (groupId.length > 200) {
    throw new PublicLearningChatroomError(
      "Learning chatroom groupId must be at most 200 characters.",
      400,
    );
  }
  return groupId;
}

// One room key for both handlers. For a group room the class scope comes from
// the group record rather than the query string: otherwise a client that
// omitted `classId` would derive a second, empty copy of the same group's room.
function createLearningChatroomTranscriptRoom(input: {
  courseId: string;
  classId?: string;
  group?: LearningChatroomGroupProjection;
  studentId: string;
}): LearningChatroomTranscriptRoomKey {
  const classId = input.group ? input.group.classId : input.classId;
  return {
    courseId: input.courseId,
    ...(classId ? { classId } : {}),
    ...(input.group ? { groupId: input.group.groupId } : {}),
    studentId: input.studentId,
  };
}

// Attribution comes from the verified session, never from the request body: a
// member who posted `authorRole: "teacher"` would otherwise have their message
// rendered as instructor guidance to the whole room and to signed-out share
// viewers. The body's author fields are dropped on the way in for the same
// reason client-supplied agent rows are.
function createLearningChatroomMessageAuthor(appSession: {
  account: string;
  displayName: string;
  role: "teacher" | "student" | "admin";
}): LearningChatroomMessageAuthor {
  const authorName = readString(appSession.displayName).slice(
    0,
    learningChatroomMaxAuthorNameLength,
  );
  return {
    authorId: appSession.account,
    ...(authorName ? { authorName } : {}),
    // Admins never reach a room (the authorizer denies them), so anyone writing
    // here is either the course teacher or an assigned member.
    authorRole: appSession.role === "teacher" ? "teacher" : "student",
  };
}

function createLearningChatroomTranscriptMessage(
  message: LearningChatroomMessage,
  author?: LearningChatroomMessageAuthor,
): LearningChatroomTranscriptWriteMessage {
  return {
    messageId: message.id,
    role: message.role,
    content: message.content,
    ...(message.agentId ? { agentId: message.agentId } : {}),
    // Agent rows have no human author, so attribution is deliberately not
    // written for them rather than written as the requesting member.
    ...(author && message.role === "student"
      ? {
          authorId: author.authorId,
          ...(author.authorName ? { authorName: author.authorName } : {}),
          authorRole: author.authorRole,
        }
      : {}),
  };
}

// A per-student room answers exactly the shape it always has. A group room adds
// the two fields the roster needs - the author's display name and a
// server-computed `isSelf` - and never the raw `authorId` those are derived
// from: account ids are the room's authorization key and stay server-side.
function createLearningChatroomHistoryMessage(
  message: LearningChatroomTranscriptMessage,
  input: { isGroupRoom: boolean; account: string },
) {
  const replayed = {
    id: message.messageId,
    role: message.role,
    content: message.content,
    ...(message.agentId ? { agentId: message.agentId } : {}),
    createdAt: message.createdAt,
  };
  if (!input.isGroupRoom) {
    return replayed;
  }

  return {
    ...replayed,
    ...(message.authorName ? { authorName: message.authorName } : {}),
    // The room marks instructor turns; member turns carry no role so the
    // absence is the default rather than a value the client has to compare.
    ...(message.authorRole === "teacher" ? { authorRole: "teacher" as const } : {}),
    isSelf: message.role === "student" && message.authorId === input.account,
  };
}

// The room's moderation state, narrowed to the one thing a client may act on.
// `actorId` and `actedAt` stay server-side: which teacher acted, and when, is
// staff audit data, and a room that named its moderator to every member would
// turn a moderation action into a public accusation.
//
// Always a definite status, never an absent field: "never moderated" and
// "explicitly thawed" are the same thing to a composer, and a client should not
// have to infer `open` from a missing key.
function createLearningChatroomModerationProjection(
  history: LearningChatroomHistoryResult,
) {
  return { status: history.moderation?.status ?? "open" };
}

function createLearningChatroomTranscriptReceipt(
  result: LearningChatroomTranscriptWriteResult,
) {
  return {
    status: result.status,
    ...(result.appendedMessageCount === undefined
      ? {}
      : { appendedMessageCount: result.appendedMessageCount }),
    ...(result.messageCount === undefined ? {} : { messageCount: result.messageCount }),
    ...(result.storagePolicy ? { storagePolicy: result.storagePolicy } : {}),
  };
}

function createLearningChatroomTranscriptErrorLogger(traceId: string, courseId: string) {
  return (input: { phase: "transcript-read" | "transcript-write"; error: unknown }) => {
    logLearningChatroomError({
      traceId,
      phase: input.phase,
      courseId,
      message:
        input.error instanceof Error
          ? input.error.message
          : "Learning chatroom transcript storage failed.",
      error: input.error,
    });
  };
}

function parseLearningChatroomRequest(value: unknown): LearningChatroomRequestBody {
  if (!isRecord(value)) {
    throw new PublicLearningChatroomError("Request body must be an object.", 400);
  }

  if (value.locale !== "zh-CN" && value.locale !== "en-US") {
    throw new PublicLearningChatroomError(
      "Learning chatroom locale must be zh-CN or en-US.",
      400,
    );
  }

  const courseId = readString(value.courseId);
  if (!courseId || courseId.length > 200) {
    throw new PublicLearningChatroomError(
      "Learning chatroom courseId must be 1-200 characters.",
      400,
    );
  }

  if (!Array.isArray(value.messages) || value.messages.length === 0) {
    throw new PublicLearningChatroomError(
      "Learning chatroom messages must be a non-empty array.",
      400,
    );
  }

  // The learner UI posts the whole visible transcript, so an oversize history is
  // capped to the most recent turns instead of failing the round. Mention
  // routing only reads the last student message, so the tail is the safe slice.
  const rawMessages = value.messages.slice(-learningChatroomMaxMessages);
  const lastStudentIndex = rawMessages.findLastIndex(
    (message) => isRecord(message) && message.role === "student",
  );
  const messages = rawMessages.map((message, index) =>
    parseLearningChatroomMessage(message, {
      // History was already displayed and only feeds provider context, so an
      // oversize entry is truncated rather than failing the round. The last
      // student message drives this round and still rejects when oversize.
      truncateOversizeContent: index !== lastStudentIndex,
    }),
  );

  const classId = readLearningChatroomClassId(value.classId);
  const groupId = readLearningChatroomGroupId(value.groupId);
  const resend = readLearningChatroomResendIntent(value, messages);

  return {
    locale: value.locale,
    courseId,
    ...(classId ? { classId } : {}),
    ...(groupId ? { groupId } : {}),
    ...resend,
    messages,
  };
}

// `intent` is optional and the only value it may take is `"resend"`, so a body
// without it keeps the historic behaviour exactly. The named `messageId` must be
// one of the STUDENT rows this very request carries: a resend is a second
// attempt at a message the client already showed its sender, and requiring the
// row to be present here keeps the marker from becoming a way to persist
// something the room never rendered - or to silence an agent round by naming
// somebody else's id.
function readLearningChatroomResendIntent(
  value: Record<string, unknown>,
  messages: LearningChatroomMessage[],
) {
  if (value.intent === undefined || value.intent === null) {
    return {};
  }
  if (value.intent !== "resend") {
    throw new PublicLearningChatroomError(
      "Learning chatroom intent must be resend when present.",
      400,
    );
  }

  const messageId = readString(value.messageId);
  if (
    !messageId ||
    messageId.length > 200 ||
    !messages.some(
      (message) => message.id === messageId && message.role === "student",
    )
  ) {
    throw new PublicLearningChatroomError(
      "Learning chatroom resend requires the messageId of a student message in this request.",
      400,
    );
  }

  return { intent: "resend" as const, messageId };
}

function parseLearningChatroomMessage(
  value: unknown,
  options: { truncateOversizeContent: boolean },
): LearningChatroomMessage {
  if (!isRecord(value)) {
    throw new PublicLearningChatroomError("Learning chatroom message must be an object.", 400);
  }

  const id = readString(value.id);
  if (!id || id.length > 200) {
    throw new PublicLearningChatroomError(
      "Learning chatroom message id must be 1-200 characters.",
      400,
    );
  }

  if (value.role !== "student" && value.role !== "agent") {
    throw new PublicLearningChatroomError(
      "Learning chatroom message role must be student or agent.",
      400,
    );
  }

  let content = readString(value.content);
  if (content.length > learningChatroomMaxMessageLength && options.truncateOversizeContent) {
    content = content.slice(0, learningChatroomMaxMessageLength);
  }
  if (!content || content.length > learningChatroomMaxMessageLength) {
    throw new PublicLearningChatroomError(
      `Learning chatroom message content must be 1-${learningChatroomMaxMessageLength} characters.`,
      400,
    );
  }

  const agentId = readString(value.agentId);
  if (agentId.length > 200) {
    throw new PublicLearningChatroomError(
      "Learning chatroom message agentId must be at most 200 characters.",
      400,
    );
  }

  return {
    id,
    role: value.role,
    content,
    ...(agentId ? { agentId } : {}),
  };
}

function createPublicLearningChatroomError(error: unknown) {
  if (error instanceof PublicLearningChatroomError) {
    return error;
  }
  if (error instanceof TeachingCourseManagementStoreError) {
    return new PublicLearningChatroomError(error.message, error.status);
  }
  if (error instanceof Error && error.message === learningChatroomEmptyContentMessage) {
    return new PublicLearningChatroomError(error.message, 502);
  }
  if (
    error instanceof Error &&
    (error.message ===
      "UAIS LangGraph production runtime requires external persistence; configure a GCS-backed checkpointer/store or an external LangGraph runtime persistence adapter." ||
      error.message ===
        "UAIS LangGraph external persistence requires injected checkpointer and store adapters.")
  ) {
    return new PublicLearningChatroomError(error.message, 503);
  }
  return undefined;
}

function readSafeLearningChatroomTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-learning-chatroom-${crypto.randomUUID()}`;
}

function createLearningChatroomRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
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

class PublicLearningChatroomError extends Error {
  readonly status: number;
  // Only set for 429s, where the response must tell the client how long to wait.
  readonly retryAfterSeconds?: number;
  // Stable classification beside the prose, for the refusals a client has to act
  // on differently rather than merely display - today the frozen room, which the
  // composer must disable rather than offer a retry for.
  readonly reasonCode?: string;

  constructor(
    message: string,
    status: number,
    options?: { retryAfterSeconds?: number; reasonCode?: string },
  ) {
    super(message);
    this.name = "PublicLearningChatroomError";
    this.status = status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.reasonCode = options?.reasonCode;
  }
}
