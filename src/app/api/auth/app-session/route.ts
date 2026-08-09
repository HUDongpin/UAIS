import { randomUUID } from "node:crypto";
import {
  getUaisHomeHrefForRole,
  isUaisRouteAllowedForRole,
  type UaisAppSessionUser,
} from "@/lib/auth/uais-app-session";
import {
  createTeacherAuthSessionClearSetCookieHeaders,
  hasTeacherAuthSessionCookie,
  resolveLocalTeacherAuthBridge,
} from "@/lib/server/local-teacher-auth-bridge";
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

    const body = await readLoginBody(request);
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
    // Local development only: also mint the signed teacher session the teaching
    // write routes require, so a teacher who signs in through the UI can
    // actually create and operate courses. Deployed runtimes are untouched -
    // see src/lib/server/local-teacher-auth-bridge.ts for the two guards that
    // make that a property rather than a hope.
    const localTeacherAuthBridge = resolveLocalTeacherAuthBridge({
      env,
      providerKind: authProviderContract.providerKind,
      role: authenticatedUser.role,
      actorId: authenticatedUser.account,
      sessionId: claims.sessionId,
      authenticatedAt: claims.authenticatedAt,
      expiresAt: claims.expiresAt,
      maxAgeSeconds: ttlSeconds,
      secure: isProductionRuntime,
    });
    // Switching accounts without signing out would otherwise leave the previous
    // teacher's write credential in the browser alongside the new session. Only
    // emitted when the caller actually presents one, so an ordinary sign-in
    // still returns exactly the cookies it always did.
    const staleTeacherAuthClearHeaders =
      localTeacherAuthBridge.status !== "issued" && hasTeacherAuthSessionCookie(request)
        ? createTeacherAuthSessionClearSetCookieHeaders({ secure: isProductionRuntime })
        : [];
    const redirectTarget =
      body.from && isUaisRouteAllowedForRole(body.from, authenticatedUser.role)
        ? body.from
        : getUaisHomeHrefForRole(authenticatedUser.role);
    const headers = new Headers({ "content-type": "application/json" });
    for (const setCookieHeader of [
      ...setCookieHeaders,
      ...localTeacherAuthBridge.setCookieHeaders,
      ...staleTeacherAuthClearHeaders,
    ]) {
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
        // Names only, never values: this is how a developer finds out why
        // teaching writes still 401 locally (almost always the unset signing
        // secret) without anyone having to read the route source.
        localTeacherAuthBridge: {
          responsibleSession: "S12",
          status: localTeacherAuthBridge.status,
          cookieNames:
            localTeacherAuthBridge.status === "issued"
              ? ["uais_teacher_auth_claims", "uais_teacher_auth_signature"]
              : [],
          requiredEnvName: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
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
    // The teaching write routes read the teacher cookie alone, with no
    // cross-check against the app session, so leaving it behind would keep a
    // signed-out browser authorized to write for the rest of its lifetime - and
    // would keep the proxy treating that visitor as an authenticated teacher.
    // Unconditional: clearing a cookie that was never set costs nothing.
    for (const clearHeader of createTeacherAuthSessionClearSetCookieHeaders({
      secure: isProductionRuntime,
    })) {
      headers.append("set-cookie", clearHeader);
    }
    return new Response(JSON.stringify({ status: "signed-out" }), {
      status: 200,
      headers,
    });
  };
}

async function readLoginBody(request: Request): Promise<UaisAppSessionLoginBody> {
  try {
    return parseLoginBody(await request.json());
  } catch {
    return {};
  }
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
