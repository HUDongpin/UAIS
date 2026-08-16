import {
  LrsWriteError,
  postXapiStatement,
  resolveLrsConfig,
  type XapiStatement,
} from "@/lib/learning-records/lrs-client";
import {
  createActorAccount,
  createActivityId,
  createIdempotentStatementId,
  createLearningEventStatement,
  isUaisProducedStatement,
  resolveLearningEventVerb,
  uaisLrsTenantId,
  type LearningRecordActor,
  type LearningRecordEventInput,
  type LearningRecordEventType,
} from "@/lib/learning-records/xapi-events";

export type LearningRecordRedaction = {
  endpoint: "fingerprinted";
  credentials: "omitted";
  rawStatement: "omitted";
};

export type LearningRecordQueueItem = {
  actor: LearningRecordActor;
  event: LearningRecordEventInput;
  idempotencyKey: string;
};

export type LearningRecordQueueResult =
  | {
      target: "learning-record-store";
      status: "queued";
      idempotencyKey: string;
      writeMode: "async-queued";
      redaction: LearningRecordRedaction;
    }
  | {
      target: "learning-record-store";
      status: "deduplicated";
      idempotencyKey: string;
      writeMode: "async-queued";
      redaction: LearningRecordRedaction;
    }
  | {
      target: "learning-record-store";
      status: "blocked";
      blockedReasons: string[];
      writeMode: "async-queued";
      redaction: LearningRecordRedaction;
    };

export type LearningRecordFlushResult = {
  target: "learning-record-store";
  status: "flushed";
  attempted: number;
  written: number;
  failed: number;
  deduplicated: number;
  redaction: LearningRecordRedaction;
};

export type XapiStatementsQuery = {
  agent?: {
    role: LearningRecordActor["role"];
    id: string;
  };
  verb?: LearningRecordEventType | string;
  activity?: string;
  relatedActivities?: boolean;
  relatedAgents?: boolean;
  since?: string;
  until?: string;
  limit?: number;
};

export type XapiStatementsResult = {
  statements: XapiStatement[];
  more: string;
  redaction: {
    endpoint: "fingerprinted";
    credentials: "omitted";
    rawStatements: "summarized";
  };
};

// What an operator can see about statements this process gave up on.
//
// The events route answers 202 "queued" and flushes after the response, so a
// write that exhausts `postWithRetry` used to disappear with no counter, no log
// and no dead letter: the learner's record was simply gone and nothing in the
// deployment could say how often that happened. This is the minimum that makes
// the loss countable - a process-wide tally plus the last redacted reason - and
// it is deliberately NOT a queue redesign: durable retry, a dead-letter store
// and cross-instance aggregation remain out of scope (they need a backing store
// this route does not have).
export type LearningRecordFlushFailureSnapshot = {
  target: "learning-record-store";
  // Statements this process attempted and could not write, since it started.
  failedWrites: number;
  lastFailure:
    | { status: "none" }
    | {
        status: "recorded";
        // Redacted to the same shape the smoke route reports: an LRS HTTP status
        // when the client produced one, and a generic string otherwise, so a
        // network error carrying the endpoint host never reaches a response.
        reason: string;
        httpStatus?: number;
      };
  redaction: LearningRecordRedaction;
};

const redaction: LearningRecordRedaction = {
  endpoint: "fingerprinted",
  credentials: "omitted",
  rawStatement: "omitted",
};

let flushFailureCount = 0;
let lastFlushFailure: LearningRecordFlushFailureSnapshot["lastFailure"] = {
  status: "none",
};

export function recordLearningRecordFlushFailure(error: unknown) {
  flushFailureCount += 1;
  lastFlushFailure = {
    status: "recorded",
    reason: redactLearningRecordFlushError(error),
    ...(error instanceof LrsWriteError ? { httpStatus: error.httpStatus } : {}),
  };
}

export function getLearningRecordFlushFailures(): LearningRecordFlushFailureSnapshot {
  return {
    target: "learning-record-store",
    failedWrites: flushFailureCount,
    lastFailure: lastFlushFailure,
    redaction,
  };
}

export function resetLearningRecordFlushFailuresForTesting() {
  flushFailureCount = 0;
  lastFlushFailure = { status: "none" };
}

// Mirrors the smoke route's redaction: only the client's own fixed message shape
// is passed through, because a transport error message can carry the endpoint
// host and this string is served to an admin over HTTP.
export function redactLearningRecordFlushError(error: unknown): string {
  if (
    error instanceof Error &&
    /^LRS statement write failed with HTTP \d+\.$/.test(error.message)
  ) {
    return error.message;
  }
  return "LRS statement write failed.";
}

export function createLearningRecordQueue(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => string;
  maxAttempts?: number;
}) {
  const pending: LearningRecordQueueItem[] = [];
  const seen = new Set<string>();
  let deduplicated = 0;

  return {
    enqueue(item: LearningRecordQueueItem): LearningRecordQueueResult {
      const config = resolveLrsConfig(input.env);
      if (config.status === "blocked") {
        return {
          target: "learning-record-store",
          status: "blocked",
          blockedReasons: config.blockedReasons,
          writeMode: "async-queued",
          redaction,
        };
      }

      if (seen.has(item.idempotencyKey)) {
        deduplicated += 1;
        return {
          target: "learning-record-store",
          status: "deduplicated",
          idempotencyKey: item.idempotencyKey,
          writeMode: "async-queued",
          redaction,
        };
      }

      seen.add(item.idempotencyKey);
      pending.push(item);
      return {
        target: "learning-record-store",
        status: "queued",
        idempotencyKey: item.idempotencyKey,
        writeMode: "async-queued",
        redaction,
      };
    },

    async flush(): Promise<LearningRecordFlushResult> {
      const attempted = pending.length;
      let written = 0;
      let failed = 0;
      const config = resolveLrsConfig(input.env);
      if (config.status === "blocked") {
        return {
          target: "learning-record-store",
          status: "flushed",
          attempted,
          written,
          failed: attempted,
          deduplicated,
          redaction,
        };
      }

      while (pending.length > 0) {
        const item = pending.shift();
        if (!item) continue;
        const statement = createLearningEventStatement({
          actor: item.actor,
          // Every statement leaving this queue carries the UAIS tenant marker
          // so a shared or future dedicated LRS store can attribute it.
          event: {
            ...item.event,
            context: {
              ...item.event.context,
              tenantId: item.event.context.tenantId ?? uaisLrsTenantId,
            },
          },
          statementId: createIdempotentStatementId(item.idempotencyKey),
          timestamp: input.now?.(),
        });
        const attempt = await postWithRetry({
          config: config.config,
          statement,
          fetch: input.fetch,
          maxAttempts: input.maxAttempts ?? 3,
        });
        if (attempt.status === "written") {
          written += 1;
        } else {
          failed += 1;
          // Counted here rather than by the caller: this is the exact point the
          // statement stops existing anywhere, and `flush()` is awaited by a
          // scheduler that used to swallow its result whole.
          recordLearningRecordFlushFailure(attempt.error);
        }
      }

      return {
        target: "learning-record-store",
        status: "flushed",
        attempted,
        written,
        failed,
        deduplicated,
        redaction,
      };
    },
  };
}

export function getXapiStatements(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  query: XapiStatementsQuery;
}): Promise<XapiStatementsResult> {
  assertTargetedQuery(input.query);
  const config = resolveLrsConfig(input.env);
  if (config.status === "blocked") {
    throw new Error(`LRS query blocked: ${config.blockedReasons.join(", ")}`);
  }

  const fetchImpl = input.fetch ?? fetch;
  return fetchImpl(createStatementsQueryUrl(config.config.endpoint, input.query), {
    method: "GET",
    headers: {
      accept: "application/json",
      "X-Experience-API-Version": config.config.xapiVersion,
      Authorization: createBasicAuthorization(
        config.config.username,
        config.config.password,
      ),
    },
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`LRS statement query failed with HTTP ${response.status}.`);
    }
    const body = (await response.json().catch(() => ({}))) as {
      statements?: XapiStatement[];
      more?: string;
    };
    return {
      // Tenant guard: the LRS store may be shared with other applications, and
      // activity/related_activities filters can match foreign statements.
      statements: (Array.isArray(body.statements) ? body.statements : []).filter(
        isUaisProducedStatement,
      ),
      more: typeof body.more === "string" ? body.more : "",
      redaction: {
        endpoint: "fingerprinted",
        credentials: "omitted",
        rawStatements: "summarized",
      },
    };
  });
}

export function createTargetedQueryFilters(query: XapiStatementsQuery) {
  return [
    ...(query.agent ? ["agent"] : []),
    ...(query.verb ? ["verb"] : []),
    ...(query.activity ? ["activity"] : []),
    ...(query.relatedActivities ? ["related_activities"] : []),
    ...(query.relatedAgents ? ["related_agents"] : []),
  ];
}

async function postWithRetry(input: {
  config: Parameters<typeof postXapiStatement>[0]["config"];
  statement: XapiStatement;
  fetch?: typeof fetch;
  maxAttempts: number;
}): Promise<{ status: "written" } | { status: "failed"; error: unknown }> {
  // The reason the LAST attempt gave up, carried out so the give-up is
  // countable with a cause instead of a bare boolean.
  let lastError: unknown;
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    try {
      await postXapiStatement({
        config: input.config,
        statement: input.statement,
        fetch: input.fetch,
      });
      return { status: "written" };
    } catch (error) {
      lastError = error;
      // A same-id conflict means this deterministic statement id is already
      // stored (idempotent re-emission, possibly with an older body shape);
      // the record exists, so treat it as written instead of retrying.
      if (error instanceof LrsWriteError && error.httpStatus === 409) {
        return { status: "written" };
      }
      if (attempt === input.maxAttempts) {
        return { status: "failed", error };
      }
    }
  }
  return { status: "failed", error: lastError };
}

function assertTargetedQuery(query: XapiStatementsQuery) {
  if (!query.agent && !query.verb && !query.activity) {
    throw new Error(
      "LRS statements queries require at least one targeted filter: agent, verb, or activity.",
    );
  }
}

function createStatementsQueryUrl(endpoint: string, query: XapiStatementsQuery) {
  const url = new URL(endpoint);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath.endsWith("/statements")
    ? normalizedPath
    : `${normalizedPath}/statements`;
  url.search = "";
  url.hash = "";

  if (query.agent) {
    url.searchParams.set("agent", JSON.stringify(createActorAccount(query.agent)));
  }
  if (query.verb) {
    url.searchParams.set("verb", resolveLearningEventVerb(query.verb));
  }
  if (query.activity) {
    url.searchParams.set("activity", createActivityId(query.activity));
  }
  if (query.relatedActivities) {
    url.searchParams.set("related_activities", "true");
  }
  if (query.relatedAgents) {
    url.searchParams.set("related_agents", "true");
  }
  if (query.since) {
    url.searchParams.set("since", query.since);
  }
  if (query.until) {
    url.searchParams.set("until", query.until);
  }
  if (query.limit) {
    url.searchParams.set("limit", String(Math.min(Math.max(query.limit, 1), 200)));
  }

  return url.toString();
}

function createBasicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}
