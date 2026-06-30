import {
  postXapiStatement,
  resolveLrsConfig,
  type XapiStatement,
} from "@/lib/learning-records/lrs-client";
import {
  createActorAccount,
  createActivityId,
  createIdempotentStatementId,
  createLearningEventStatement,
  resolveLearningEventVerb,
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

const redaction: LearningRecordRedaction = {
  endpoint: "fingerprinted",
  credentials: "omitted",
  rawStatement: "omitted",
};

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
          event: item.event,
          statementId: createIdempotentStatementId(item.idempotencyKey),
          timestamp: input.now?.(),
        });
        const success = await postWithRetry({
          config: config.config,
          statement,
          fetch: input.fetch,
          maxAttempts: input.maxAttempts ?? 3,
        });
        if (success) {
          written += 1;
        } else {
          failed += 1;
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
      statements: Array.isArray(body.statements) ? body.statements : [],
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
}) {
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    try {
      await postXapiStatement({
        config: input.config,
        statement: input.statement,
        fetch: input.fetch,
      });
      return true;
    } catch {
      if (attempt === input.maxAttempts) {
        return false;
      }
    }
  }
  return false;
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
