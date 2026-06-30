import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

export const DEFAULT_XAPI_VERSION = "1.0.3";

export type UaisLrsEnvName =
  | "UAIS_LRS_ENDPOINT"
  | "UAIS_LRS_USERNAME"
  | "UAIS_LRS_PASSWORD"
  | "UAIS_LRS_XAPI_VERSION";

export type UaisLrsBlockedReason =
  | "missing-UAIS_LRS_ENDPOINT"
  | "missing-UAIS_LRS_USERNAME"
  | "missing-UAIS_LRS_PASSWORD"
  | "invalid-UAIS_LRS_ENDPOINT";

export type UaisLrsConfig = {
  endpoint: string;
  username: string;
  password: string;
  xapiVersion: string;
};

export type UaisLrsReadiness = {
  target: "learning-record-store";
  status: "ready" | "blocked";
  responsibleSession: "S19/S12";
  endpoint:
    | {
        status: "present";
        fingerprint: string;
        valueRedacted: true;
      }
    | {
        status: "missing";
        valueRedacted: true;
      }
    | {
        status: "invalid";
        valueRedacted: true;
      };
  credentials: {
    username: "present" | "missing";
    password: "present" | "missing";
    valuesRedacted: true;
  };
  xapiVersion: {
    status: "present" | "defaulted";
    value: string;
  };
  blockedReasons: UaisLrsBlockedReason[];
  safety: {
    serverOnly: true;
    valuesRedacted: true;
    liveWriteRequiresApproval: true;
  };
};

export type UaisLrsConfigResult =
  | {
      status: "ready";
      config: UaisLrsConfig;
      readiness: UaisLrsReadiness;
    }
  | {
      status: "blocked";
      blockedReasons: UaisLrsBlockedReason[];
      readiness: UaisLrsReadiness;
    };

export type XapiStatement = {
  id: string;
  actor: {
    objectType: "Agent";
    name?: string;
    mbox?: string;
    account?: {
      homePage: string;
      name: string;
    };
  };
  verb: {
    id: string;
    display: {
      "en-US": string;
    };
  };
  object: {
    id: string;
    objectType: "Activity";
    definition: {
      name: {
        "en-US": string;
      };
      description?: {
        "en-US": string;
      };
      type: string;
      interactionType?: string;
    };
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
  context?: {
    platform: string;
    language: string;
    registration?: string;
    contextActivities?: {
      parent?: Array<{ id: string }>;
      grouping?: Array<{ id: string }>;
      category?: Array<{ id: string }>;
    };
    extensions?: Record<string, string | number | boolean>;
  };
  timestamp: string;
};

export type LrsPostResult = {
  target: "learning-record-store";
  status: "passed";
  httpStatus: number;
  responseShape: "statement-ids-array" | "json-object" | "empty" | "text";
  statementId:
    | {
        status: "present";
        fingerprint: string;
        valueRedacted: true;
      }
    | {
        status: "missing";
        valueRedacted: true;
      };
  safety: {
    endpointRedacted: true;
    credentialsRedacted: true;
    responseBodyOmitted: true;
  };
};

export function getRedactedLrsReadiness(
  env: Record<string, string | undefined>,
): UaisLrsReadiness {
  const endpoint = normalizeOptionalValue(env.UAIS_LRS_ENDPOINT);
  const username = normalizeOptionalValue(env.UAIS_LRS_USERNAME);
  const password = normalizeOptionalValue(env.UAIS_LRS_PASSWORD);
  const xapiVersion = normalizeOptionalValue(env.UAIS_LRS_XAPI_VERSION);
  const endpointStatus = getEndpointStatus(endpoint);
  const blockedReasons = readBlockedReasons({ endpointStatus, username, password });

  return {
    target: "learning-record-store",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    responsibleSession: "S19/S12",
    endpoint: createRedactedEndpointStatus(endpoint, endpointStatus),
    credentials: {
      username: username ? "present" : "missing",
      password: password ? "present" : "missing",
      valuesRedacted: true,
    },
    xapiVersion: {
      status: xapiVersion ? "present" : "defaulted",
      value: xapiVersion || DEFAULT_XAPI_VERSION,
    },
    blockedReasons,
    safety: {
      serverOnly: true,
      valuesRedacted: true,
      liveWriteRequiresApproval: true,
    },
  };
}

export function resolveLrsConfig(
  env: Record<string, string | undefined>,
): UaisLrsConfigResult {
  const readiness = getRedactedLrsReadiness(env);
  if (readiness.status === "blocked") {
    return {
      status: "blocked",
      blockedReasons: readiness.blockedReasons,
      readiness,
    };
  }

  return {
    status: "ready",
    config: {
      endpoint: normalizeOptionalValue(env.UAIS_LRS_ENDPOINT) ?? "",
      username: normalizeOptionalValue(env.UAIS_LRS_USERNAME) ?? "",
      password: normalizeOptionalValue(env.UAIS_LRS_PASSWORD) ?? "",
      xapiVersion: normalizeOptionalValue(env.UAIS_LRS_XAPI_VERSION) || DEFAULT_XAPI_VERSION,
    },
    readiness,
  };
}

export function createUaisLrsSmokeStatement(input: {
  runId?: string;
  timestamp?: string;
}): XapiStatement {
  return {
    id: input.runId ?? randomUUID(),
    actor: {
      objectType: "Agent",
      account: {
        homePage: "https://uais.top",
        name: "uais-local-smoke",
      },
    },
    verb: {
      id: "http://adlnet.gov/expapi/verbs/experienced",
      display: {
        "en-US": "experienced",
      },
    },
    object: {
      id: "https://uais.top/xapi/activities/local-lrs-smoke",
      objectType: "Activity",
      definition: {
        name: {
          "en-US": "UAIS local LRS smoke",
        },
        description: {
          "en-US": "A safe UAIS local connectivity statement for LRS readiness checks.",
        },
        type: "http://adlnet.gov/expapi/activities/course",
      },
    },
    result: {
      success: true,
      completion: true,
      response: "UAIS local project connected to LRS.",
    },
    context: {
      platform: "UAIS local project",
      language: "zh-CN",
      extensions: {
        "https://uais.top/xapi/extensions/source": "local-lrs-smoke",
      },
    },
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export async function postXapiStatement(input: {
  config: UaisLrsConfig;
  statement: XapiStatement;
  fetch?: typeof fetch;
}): Promise<LrsPostResult> {
  const fetchImpl = input.fetch ?? fetch;
  const response = await fetchImpl(createStatementsUrl(input.config.endpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Experience-API-Version": input.config.xapiVersion,
      Authorization: createBasicAuthorization(
        input.config.username,
        input.config.password,
      ),
    },
    body: JSON.stringify(input.statement),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`LRS statement write failed with HTTP ${response.status}.`);
  }

  const parsed = parseJsonResponse(responseText);
  const statementId = Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : undefined;

  return {
    target: "learning-record-store",
    status: "passed",
    httpStatus: response.status,
    responseShape: classifyResponseShape(responseText, parsed),
    statementId: statementId
      ? {
          status: "present",
          fingerprint: createFingerprint(statementId),
          valueRedacted: true,
        }
      : {
          status: "missing",
          valueRedacted: true,
        },
    safety: {
      endpointRedacted: true,
      credentialsRedacted: true,
      responseBodyOmitted: true,
    },
  };
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function getEndpointStatus(endpoint: string | undefined): "present" | "missing" | "invalid" {
  if (!endpoint) {
    return "missing";
  }

  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" || url.protocol === "http:" ? "present" : "invalid";
  } catch {
    return "invalid";
  }
}

function createRedactedEndpointStatus(
  endpoint: string | undefined,
  status: "present" | "missing" | "invalid",
): UaisLrsReadiness["endpoint"] {
  if (status === "present" && endpoint) {
    return {
      status,
      fingerprint: createFingerprint(new URL(endpoint).origin.toLowerCase()),
      valueRedacted: true,
    };
  }

  if (status === "missing") {
    return {
      status: "missing",
      valueRedacted: true,
    };
  }

  return {
    status: "invalid",
    valueRedacted: true,
  };
}

function readBlockedReasons(input: {
  endpointStatus: "present" | "missing" | "invalid";
  username: string | undefined;
  password: string | undefined;
}): UaisLrsBlockedReason[] {
  const reasons: UaisLrsBlockedReason[] = [];
  if (input.endpointStatus === "missing") {
    reasons.push("missing-UAIS_LRS_ENDPOINT");
  }
  if (input.endpointStatus === "invalid") {
    reasons.push("invalid-UAIS_LRS_ENDPOINT");
  }
  if (!input.username) {
    reasons.push("missing-UAIS_LRS_USERNAME");
  }
  if (!input.password) {
    reasons.push("missing-UAIS_LRS_PASSWORD");
  }
  return reasons;
}

function createStatementsUrl(endpoint: string): string {
  const url = new URL(endpoint);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (normalizedPath.endsWith("/statements")) {
    url.pathname = normalizedPath;
  } else {
    url.pathname = `${normalizedPath}/statements`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createBasicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function parseJsonResponse(responseText: string): unknown {
  if (!responseText.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return undefined;
  }
}

function classifyResponseShape(
  responseText: string,
  parsed: unknown,
): LrsPostResult["responseShape"] {
  if (!responseText.trim()) {
    return "empty";
  }
  if (Array.isArray(parsed)) {
    return "statement-ids-array";
  }
  if (parsed && typeof parsed === "object") {
    return "json-object";
  }
  return "text";
}

function createFingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}
