import type { UaisAppRole, UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import { isUaisAppProductionRuntime } from "@/lib/server/uais-app-session";

export type UaisAppAuthProviderContract = {
  selector: string;
  providerKind: "local-demo" | "trusted-account-provider" | "unsupported";
  productionStatus: "ready" | "blocked";
  blockedReason?: "local-demo-not-production" | "trusted-provider-not-configured" | "unsupported-provider";
  providerBinding?: {
    endpoint: "configured" | "injected";
    credential: "configured" | "injected";
    valueRedacted: true;
  };
  responsibleSession: "S12/S19";
  redaction: {
    secrets: "omitted";
    passwords: "omitted";
  };
};

export type UaisTrustedAccountProviderAuthenticator = (input: {
  account: string;
  password: string;
}) => Promise<UaisAppSessionUser | null>;

type UaisTrustedAccountProviderConfig = {
  endpoint: string;
  accessToken: string;
};

type UaisLocalDemoAccount = UaisAppSessionUser & {
  password: string;
};

const localDemoAccounts: UaisLocalDemoAccount[] = [
  {
    account: "Phoebe",
    password: "12345",
    role: "teacher",
    displayName: "Phoebe",
    department: "教师账号",
  },
  {
    account: "Peter",
    password: "12345",
    role: "student",
    displayName: "Peter",
    department: "学生账号",
  },
];

export function resolveUaisAppAuthProviderContract(input: {
  env: Record<string, string | undefined>;
  hasTrustedAccountProvider?: boolean;
}): UaisAppAuthProviderContract {
  const selector = normalizeProviderSelector(input.env.UAIS_APP_AUTH_PROVIDER);

  if (selector === "local-demo") {
    const productionStatus = isUaisAppProductionRuntime(input.env)
      ? "blocked"
      : "ready";
    return {
      selector,
      providerKind: "local-demo",
      productionStatus,
      ...(productionStatus === "blocked"
        ? { blockedReason: "local-demo-not-production" as const }
        : {}),
      responsibleSession: "S12/S19",
      redaction: createRedaction(),
    };
  }

  if (selector === "trusted-account-provider") {
    const providerConfig = resolveUaisTrustedAccountProviderConfig(input.env);
    const ready = Boolean(input.hasTrustedAccountProvider) || Boolean(providerConfig);
    return {
      selector,
      providerKind: "trusted-account-provider",
      productionStatus: ready ? "ready" : "blocked",
      ...(ready ? {} : { blockedReason: "trusted-provider-not-configured" as const }),
      ...(ready
        ? {
            providerBinding: {
              endpoint: providerConfig ? "configured" : "injected",
              credential: providerConfig ? "configured" : "injected",
              valueRedacted: true,
            } as const,
          }
        : {}),
      responsibleSession: "S12/S19",
      redaction: createRedaction(),
    };
  }

  return {
    selector,
    providerKind: "unsupported",
    productionStatus: "blocked",
    blockedReason: "unsupported-provider",
    responsibleSession: "S12/S19",
    redaction: createRedaction(),
  };
}

export function createUaisTrustedAccountProviderAuthenticator(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): UaisTrustedAccountProviderAuthenticator | undefined {
  const providerConfig = resolveUaisTrustedAccountProviderConfig(input.env);
  if (!providerConfig) {
    return undefined;
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({ account, password }) => {
    const response = await fetchImpl(providerConfig.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${providerConfig.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ account, password }),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error("UAIS trusted account provider authentication failed.");
    }

    return normalizeTrustedAccountProviderUser(await response.json());
  };
}

export function authenticateUaisLocalDemoAccount(input: {
  account: string;
  password: string;
}): UaisAppSessionUser | null {
  const normalizedAccount = input.account.trim().toLowerCase();
  const account =
    localDemoAccounts.find((candidate) => {
      return (
        candidate.account.toLowerCase() === normalizedAccount &&
        candidate.password === input.password
      );
    }) ?? null;

  return account ? toSessionUser(account) : null;
}

export function isValidUaisAppRole(value: unknown): value is UaisAppRole {
  return value === "teacher" || value === "student" || value === "admin";
}

function normalizeProviderSelector(value: string | undefined) {
  return value?.trim().toLowerCase() || "local-demo";
}

function resolveUaisTrustedAccountProviderConfig(
  env: Record<string, string | undefined>,
): UaisTrustedAccountProviderConfig | undefined {
  const endpoint = env.UAIS_APP_AUTH_PROVIDER_URL?.trim();
  const accessToken = env.UAIS_APP_AUTH_PROVIDER_TOKEN?.trim();
  if (!endpoint || !accessToken || accessToken.length < 32) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    return undefined;
  }
  return {
    endpoint: url.toString(),
    accessToken,
  };
}

function normalizeTrustedAccountProviderUser(value: unknown): UaisAppSessionUser | null {
  const candidate =
    isRecord(value) && isRecord(value.user)
      ? value.user
      : isRecord(value)
        ? value
        : undefined;
  if (!candidate || !isValidUaisAppRole(candidate.role)) {
    return null;
  }
  const account = normalizeTrustedProviderText(candidate.account);
  const displayName = normalizeTrustedProviderText(candidate.displayName);
  const department = normalizeTrustedProviderText(candidate.department);
  if (!account || !displayName || !department) {
    return null;
  }
  return {
    account,
    role: candidate.role,
    displayName,
    department,
  };
}

function normalizeTrustedProviderText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().slice(0, 160);
  if (!normalized || /\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackHost(value: string) {
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function toSessionUser(account: UaisLocalDemoAccount): UaisAppSessionUser {
  return {
    account: account.account,
    department: account.department,
    displayName: account.displayName,
    role: account.role,
  };
}

function createRedaction(): UaisAppAuthProviderContract["redaction"] {
  return {
    secrets: "omitted",
    passwords: "omitted",
  };
}
