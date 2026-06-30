import { randomUUID } from "node:crypto";
import {
  getUaisHomeHrefForRole,
  isUaisRouteAllowedForRole,
  type UaisAppSessionUser,
} from "@/lib/auth/uais-app-session";
import {
  authenticateUaisLocalDemoAccount,
  createUaisTrustedAccountProviderAuthenticator,
  resolveUaisAppAuthProviderContract,
} from "@/lib/server/uais-app-auth-provider";
import {
  createUaisAppSessionClaims,
  createUaisAppSessionSetCookieHeaders,
  isUaisAppProductionRuntime,
  resolveUaisAppSessionSigningSecret,
} from "@/lib/server/uais-app-session";

export const dynamic = "force-dynamic";

type UaisAppSessionLoginBody = {
  account?: string;
  password?: string;
  from?: string;
};

type UaisAppSessionPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  createSessionId?: () => string;
  authenticateAccount?: (input: {
    account: string;
    password: string;
  }) => Promise<UaisAppSessionUser | null> | UaisAppSessionUser | null;
};

export const POST = createUaisAppSessionPostHandler();
export const DELETE = createUaisAppSessionDeleteHandler();

export function createUaisAppSessionPostHandler(
  deps: UaisAppSessionPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const createSessionId = deps.createSessionId ?? randomUUID;
  const authenticateTrustedAccount =
    deps.authenticateAccount ??
    createUaisTrustedAccountProviderAuthenticator({
      env,
    });

  return async function POST(request: Request) {
    const authProviderContract = resolveUaisAppAuthProviderContract({
      env,
      hasTrustedAccountProvider: Boolean(authenticateTrustedAccount),
    });
    if (authProviderContract.productionStatus !== "ready") {
      return Response.json(
        {
          error: "UAIS app auth provider is not production-ready.",
          authProviderContract,
          redaction: createRedaction(),
        },
        { status: 503 },
      );
    }

    const signingSecret = resolveUaisAppSessionSigningSecret(env);
    if (!signingSecret) {
      return Response.json(
        {
          error: "UAIS app session signing secret is not configured.",
          authProviderContract,
          redaction: createRedaction(),
        },
        { status: 503 },
      );
    }

    const body = parseLoginBody(await request.json());
    if (!body.account || !body.password) {
      return Response.json(
        {
          error: "Enter an account and password.",
          authProviderContract,
          redaction: createRedaction(),
        },
        { status: 400 },
      );
    }

    const authenticatedUser =
      authProviderContract.providerKind === "trusted-account-provider"
        ? await authenticateTrustedAccount?.({
            account: body.account,
            password: body.password,
          })
        : authenticateUaisLocalDemoAccount({
            account: body.account,
            password: body.password,
          });

    if (!authenticatedUser) {
      return Response.json(
        {
          error: "The account or password does not match an authorized UAIS account.",
          authProviderContract,
          redaction: createRedaction(),
        },
        { status: 401 },
      );
    }

    const ttlSeconds = 8 * 60 * 60;
    const isProductionRuntime = isUaisAppProductionRuntime(env);
    const claims = createUaisAppSessionClaims({
      user: authenticatedUser,
      sessionId: createSessionId(),
      now: deps.now,
      ttlSeconds,
    });
    const setCookieHeaders = createUaisAppSessionSetCookieHeaders({
      claims,
      secret: signingSecret,
      maxAgeSeconds: ttlSeconds,
      secure: isProductionRuntime,
    });
    const redirectTarget =
      body.from && isUaisRouteAllowedForRole(body.from, authenticatedUser.role)
        ? body.from
        : getUaisHomeHrefForRole(authenticatedUser.role);
    const headers = new Headers({ "content-type": "application/json" });
    for (const setCookieHeader of setCookieHeaders) {
      headers.append("set-cookie", setCookieHeader);
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        redirectTarget,
        appSession: {
          responsibleSession: "S12",
          authProvider: authProviderContract.providerKind,
          authSessionRef: "server-side-app-session",
          actor: {
            account: authenticatedUser.account,
            role: authenticatedUser.role,
          },
          authenticatedAt: claims.authenticatedAt,
          expiresAt: claims.expiresAt,
          cookieNames: ["uais_app_session", "uais_app_session_signature"],
          cookieSecurity: {
            httpOnly: true,
            sameSite: "Lax",
            secure: isProductionRuntime,
            path: "/",
            priority: "High",
            maxAgeSeconds: ttlSeconds,
          },
          redaction: createRedaction(),
        },
        authProviderContract,
        redaction: createRedaction(),
      }),
      { status: 200, headers },
    );
  };
}

export function createUaisAppSessionDeleteHandler(
  deps: { env?: Record<string, string | undefined> } = {},
) {
  const env = deps.env ?? process.env;
  return function DELETE() {
    const isProductionRuntime = isUaisAppProductionRuntime(env);
    const attributes = [
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      "Priority=High",
      ...(isProductionRuntime ? ["Secure"] : []),
    ];
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", ["uais_app_session=", ...attributes].join("; "));
    headers.append(
      "set-cookie",
      ["uais_app_session_signature=", ...attributes].join("; "),
    );
    return new Response(JSON.stringify({ status: "signed-out" }), {
      status: 200,
      headers,
    });
  };
}

function parseLoginBody(value: unknown): UaisAppSessionLoginBody {
  if (!isRecord(value)) {
    return {};
  }

  return {
    account: readString(value.account),
    password: typeof value.password === "string" ? value.password : "",
    from: normalizeReturnPath(value.from),
  };
}

function normalizeReturnPath(value: unknown) {
  const from = readString(value);
  if (!from.startsWith("/") || from.startsWith("//")) {
    return undefined;
  }
  return from;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createRedaction() {
  return {
    secrets: "omitted",
    passwords: "omitted",
    cookies: "headers-only",
    sessionIds: "omitted",
  };
}
