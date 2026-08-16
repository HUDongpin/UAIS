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
  resolveVerifiedTeacherAccountAuthBridge,
} from "@/lib/server/local-teacher-auth-bridge";
import {
  createUaisAppAccountAuthenticator,
  normalizeUaisLoginIdentifier,
} from "@/lib/server/uais-app-account-store";
import {
  createUaisAppLoginFailureGuard,
  type UaisAppLoginFailureGuard,
} from "@/lib/server/uais-app-login-failure-store";
import {
  authenticateUaisLocalDemoAccount,
  createUaisTrustedAccountProviderAuthenticator,
  resolveUaisAppAuthProviderContract,
  type UaisAppAuthProviderContract,
} from "@/lib/server/uais-app-auth-provider";
import {
  classifyUaisAppSessionSigningSecret,
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
  // The TRUSTED-provider authenticator. Kept under its historical name because
  // suites inject it as exactly that; the database provider has its own dep
  // below rather than overloading this one.
  authenticateAccount?: (input: {
    account: string;
    password: string;
  }) => Promise<UaisAppSessionUser | null> | UaisAppSessionUser | null;
  authenticateDatabaseAccount?: (input: {
    account: string;
    password: string;
  }) => Promise<UaisAppSessionUser | null>;
  loginFailureGuard?: UaisAppLoginFailureGuard;
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
  const authenticateDatabaseAccount =
    deps.authenticateDatabaseAccount ?? createUaisAppAccountAuthenticator({ env });
  const loginFailureGuard =
    deps.loginFailureGuard ?? createUaisAppLoginFailureGuard({ env });

  return async function POST(request: Request) {
    const authProviderContract = resolveUaisAppAuthProviderContract({
      env,
      hasTrustedAccountProvider: Boolean(authenticateTrustedAccount),
      hasDatabaseAccountProvider: Boolean(authenticateDatabaseAccount),
    });
    if (authProviderContract.productionStatus !== "ready") {
      return Response.json(
        {
          error: "UAIS app auth provider is not production-ready.",
          // Structured alongside the English sentence, never instead of it. The
          // sentence is written for an operator reading a trace; the code is what
          // lets the login form say the same thing in the reader's own language
          // rather than interpolating this string into a Chinese frame.
          reasonCode: "app-auth-provider-not-production-ready",
          authProviderContract,
          redaction: createRedaction(),
        },
        { status: 503 },
      );
    }

    // Reported as well as resolved: a deployed runtime now refuses a signing
    // secret shorter than the floor, and "not configured" would send the owner
    // looking for a variable that is plainly set.
    const appSessionSigningSecret = classifyUaisAppSessionSigningSecret(env);
    const signingSecret = resolveUaisAppSessionSigningSecret(env);
    if (!signingSecret) {
      return Response.json(
        {
          error:
            appSessionSigningSecret.status === "weak"
              ? `UAIS app session signing secret is shorter than ${appSessionSigningSecret.minimumLength} characters.`
              : "UAIS app session signing secret is not configured.",
          reasonCode:
            appSessionSigningSecret.status === "weak"
              ? "app-session-signing-secret-weak"
              : "app-session-signing-secret-missing",
          appSessionSigningSecret,
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
          reasonCode: "login-credentials-missing",
          authProviderContract,
          redaction: createRedaction(),
        },
        { status: 400 },
      );
    }

    // Normalized here so the lockout counter, the account lookup and the
    // clear-on-success all key on exactly the same string - the identifier the
    // caller SUBMITTED, which for this cohort is an email address. `undefined`
    // means it could never match a row anyway (shape/length), and the dispatch
    // below still runs so that outcome costs the same as a wrong password.
    const accountKey = normalizeUaisLoginIdentifier(body.account);
    const nowMs = (deps.now ?? new Date()).getTime();

    // Degrades OPEN, and does so QUICKLY. A Postgres blip must not lock 200
    // students out of class; the failure counter is a brake on guessing, not an
    // authorization gate, and the password check behind it is unaffected either
    // way. The deadline is the other half of that promise: without it an
    // unreachable database turns every login into a request that hangs until
    // the platform's function timeout, which is a worse outage than the one
    // failing open avoids.
    const lockedOut = accountKey
      ? await withLoginGuardDeadline(
          () => loginFailureGuard?.isLockedOut({ accountKey, nowMs }),
          false,
        )
      : false;

    // A closed dispatch, NOT a ternary with a default arm.
    //
    // This used to read `providerKind === "trusted-account-provider" ? remote :
    // authenticateUaisLocalDemoAccount(...)`, so every provider kind that was
    // not the trusted one - including any kind added later - authenticated
    // against the hardcoded demo table whose passwords are public in this
    // repository. The moment a new kind's contract reported `ready` in
    // production, www.uais.top would have accepted Phoebe/12345.
    //
    // TypeScript cannot catch that: `UaisAppAuthProviderContract` is a flat
    // object type with a string-literal `providerKind` field, not a
    // discriminated union, so there is no exhaustiveness check anywhere. The
    // protection has to be this shape - every kind named explicitly, unknown
    // kinds falling to `null` and therefore to the 401 below.
    //
    // A locked-out attempt skips the dispatch entirely, so a lockout also stops
    // the scrypt work an attacker would otherwise keep buying.
    const authenticatedUser = lockedOut
      ? null
      : await authenticateForProviderKind({
          providerKind: authProviderContract.providerKind,
          credentials: { account: body.account, password: body.password },
          authenticateTrustedAccount,
          authenticateDatabaseAccount,
        });

    if (!authenticatedUser) {
      // A failure inside a lockout does not extend it: otherwise a client that
      // keeps retrying would hold itself locked out forever, and the student
      // whose account was targeted would never get back in.
      if (accountKey && !lockedOut) {
        await withLoginGuardDeadline(
          () => loginFailureGuard?.recordFailure({ accountKey, nowMs }),
          undefined,
        );
      }
      // Deliberately the SAME body and the SAME 401 as a wrong password, with
      // no Retry-After. A distinct 429 would tell an attacker which of 200
      // university names exist and which are currently under attack.
      return Response.json(
        {
          error: "The account or password does not match an authorized UAIS account.",
          // Deliberately the same code for a wrong password, an unknown account
          // and a lockout - the body must not tell an attacker which it was.
          reasonCode: "login-credentials-invalid",
          authProviderContract,
          redaction: createRedaction(),
        },
        { status: 401 },
      );
    }

    if (accountKey) {
      await withLoginGuardDeadline(
        () => loginFailureGuard?.clearFailures({ accountKey }),
        undefined,
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
    // The production path: a teacher whose account the database provider just
    // verified, on a deployment whose teacher-auth contract is production-ready.
    // Complements rather than replaces the local bridge - the two are mutually
    // exclusive by their own guards (this one requires the `database-accounts`
    // provider, that one requires `local-demo`), so at most one ever issues.
    const verifiedTeacherAuthBridge = resolveVerifiedTeacherAccountAuthBridge({
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
    const teacherAuthSetCookieHeaders = [
      ...localTeacherAuthBridge.setCookieHeaders,
      ...verifiedTeacherAuthBridge.setCookieHeaders,
    ];
    // Switching accounts without signing out would otherwise leave the previous
    // teacher's write credential in the browser alongside the new session. Only
    // emitted when the caller actually presents one, so an ordinary sign-in
    // still returns exactly the cookies it always did.
    //
    // Keyed on NEITHER bridge having issued: a student signing in on a browser
    // that still holds a teacher's cookie must lose it, and adding a second
    // bridge without extending this condition would have left that credential
    // live for the full 8-hour TTL.
    const staleTeacherAuthClearHeaders =
      teacherAuthSetCookieHeaders.length === 0 && hasTeacherAuthSessionCookie(request)
        ? createTeacherAuthSessionClearSetCookieHeaders({ secure: isProductionRuntime })
        : [];
    const redirectTarget =
      body.from && isUaisRouteAllowedForRole(body.from, authenticatedUser.role)
        ? body.from
        : getUaisHomeHrefForRole(authenticatedUser.role);
    const headers = new Headers({ "content-type": "application/json" });
    for (const setCookieHeader of [
      ...setCookieHeaders,
      ...teacherAuthSetCookieHeaders,
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
          // Status and floor only, never the value. It is here so a deployed
          // runtime's release evidence records WHICH secret grade actually
          // signed the session, rather than only what the readiness script
          // graded the environment as before the deploy.
          signingSecret: appSessionSigningSecret,
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
        // Reported under its own key so the local bridge's block keeps exactly
        // the shape it always had. Names and statuses only, never cookie values.
        verifiedTeacherAuthBridge: {
          responsibleSession: "S12",
          status: verifiedTeacherAuthBridge.status,
          cookieNames:
            verifiedTeacherAuthBridge.status === "issued"
              ? ["uais_teacher_auth_claims", "uais_teacher_auth_signature"]
              : [],
          requiredEnvNames: [
            "UAIS_TEACHER_AUTH_PROVIDER",
            "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
          ],
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

// The failure counter is best-effort on BOTH axes: an error degrades open, and
// so does taking too long. Two seconds is far more than a keyed single-row
// UPSERT on a warm pool needs and far less than a student will wait at a login
// form. A timed-out call is left running rather than cancelled - it may still
// land, which is the harmless direction.
const loginFailureGuardDeadlineMs = 2000;

async function withLoginGuardDeadline<T>(
  run: () => Promise<T> | undefined,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = run();
    if (!pending) {
      return fallback;
    }
    return await Promise.race([
      pending,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), loginFailureGuardDeadlineMs);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function authenticateForProviderKind(input: {
  providerKind: UaisAppAuthProviderContract["providerKind"];
  credentials: { account: string; password: string };
  authenticateTrustedAccount?: (input: {
    account: string;
    password: string;
  }) => Promise<UaisAppSessionUser | null> | UaisAppSessionUser | null;
  authenticateDatabaseAccount?: (input: {
    account: string;
    password: string;
  }) => Promise<UaisAppSessionUser | null>;
}): Promise<UaisAppSessionUser | null> {
  switch (input.providerKind) {
    case "trusted-account-provider":
      return (await input.authenticateTrustedAccount?.(input.credentials)) ?? null;
    case "database-accounts":
      return (await input.authenticateDatabaseAccount?.(input.credentials)) ?? null;
    case "local-demo":
      return authenticateUaisLocalDemoAccount(input.credentials);
    case "unsupported":
      return null;
    default:
      // Unreachable today. It exists so that adding a kind to the contract
      // without adding an arm here fails CLOSED - at worst a 401 - instead of
      // silently falling through to the demo table.
      return null;
  }
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
