import { NextResponse, type NextRequest } from "next/server";
import {
  getUaisHomeHrefForRole,
  isUaisRouteAllowedForRole,
  UAIS_APP_SESSION_COOKIE,
  UAIS_APP_SESSION_SIGNATURE_COOKIE,
  type UaisAppRole,
} from "@/lib/auth/uais-app-session";
import { classifyUaisStagingInpJourney } from "@/lib/observability/uais-staging-inp";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { isApprovedUaisStagingInpOperator } from "@/lib/server/uais-staging-inp-access";
import {
  UAIS_STAGING_INP_ROUTE_ATTESTATION_COOKIE,
  UAIS_STAGING_INP_ROUTE_ATTESTATION_TTL_SECONDS,
  createUaisStagingInpRouteAttestation,
} from "@/lib/server/uais-staging-inp-route-attestation";
import {
  getUaisStagingInpBinding,
  getUaisStagingInpGuard,
} from "@/lib/server/uais-staging-inp-runtime";

const protectedRoutePrefixes = ["/courses", "/learning", "/teaching", "/student-dashboard"];

export function proxy(request: NextRequest) {
  // Next.js invokes the proxy as `(request, event: NextFetchEvent)` — the second
  // argument is NOT `process.env`. Read `process.env` explicitly here: accepting the
  // env positionally (as this function used to) let Next's event object shadow it,
  // so `UAIS_APP_SESSION_SIGNING_SECRET` read as undefined at runtime, the
  // signature check silently degraded to the optimistic fallback, and forged cookie
  // pairs passed the navigation gate. The pure gate logic lives in evaluateUaisProxy
  // so tests can inject a controlled env.
  return evaluateUaisProxy(request, process.env);
}

export function evaluateUaisProxy(
  request: NextRequest,
  env: Record<string, string | undefined>,
  options: { now?: Date; verifiedContentSha?: string } = {},
) {
  const pathname = request.nextUrl.pathname;
  const isLoginRoute = pathname === "/login";
  const observedAt = options.now ?? new Date();
  const appSessionClaims = getUaisAppSessionClaimsFromCookieString(
    request.headers.get("cookie"),
    { env, now: observedAt },
  );
  const appSessionCookiePair = hasUaisAppSessionCookiePair(request);
  const trustedTeacherSession = hasVerifiedTrustedTeacherSession(request, env);
  const role: UaisAppRole | undefined =
    appSessionClaims?.role ?? (trustedTeacherSession ? "teacher" : undefined);
  // The unverified app-session cookie pair is only an *optimistic* fallback for
  // the case where this proxy cannot verify a signature at all — i.e. no signing
  // secret is configured in its runtime. Whenever a signing secret IS configured
  // (every production deployment), require a verified signed session so a forged
  // cookie pair cannot pass the navigation gate. Data-bearing routes verify the
  // signature server-side regardless; this closes the gate-bypass while keeping
  // legit users signed in (they always resolve via `appSessionUser`).
  const appSessionSecretConfigured = Boolean(
    env.UAIS_APP_SESSION_SIGNING_SECRET?.trim(),
  );
  const authenticated =
    Boolean(appSessionClaims) ||
    trustedTeacherSession ||
    (appSessionCookiePair && !appSessionSecretConfigured);

  if (isLoginRoute && role) {
    return NextResponse.redirect(new URL(getUaisHomeHrefForRole(role), request.url));
  }

  if (!authenticated && isProtectedAppRoute(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "from",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  if (
    authenticated &&
    role &&
    isProtectedAppRoute(pathname) &&
    !isUaisRouteAllowedForRole(pathname, role)
  ) {
    return NextResponse.redirect(new URL(getUaisHomeHrefForRole(role), request.url));
  }

  const response = NextResponse.next();
  return applyStagingInpRouteAttestation({
    request,
    response,
    env,
    appSessionClaims,
    observedAt,
    verifiedContentSha: options.verifiedContentSha,
  });
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/courses/:path*",
    "/learning/:path*",
    "/teaching/:path*",
    "/student-dashboard/:path*",
  ],
};

function isProtectedAppRoute(pathname: string) {
  return pathname === "/" || protectedRoutePrefixes.some((prefix) => {
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

function hasVerifiedTrustedTeacherSession(
  request: NextRequest,
  env: Record<string, string | undefined>,
) {
  const secret = env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  if (!secret) {
    return false;
  }
  return Boolean(
    readUaisAuthenticatedTeacherSessionFromSignedCookies({ request, secret }),
  );
}

function hasUaisAppSessionCookiePair(request: NextRequest) {
  return [UAIS_APP_SESSION_COOKIE, UAIS_APP_SESSION_SIGNATURE_COOKIE].every((name) =>
    Boolean(request.cookies.get(name)?.value),
  );
}

function applyStagingInpRouteAttestation(input: {
  request: NextRequest;
  response: NextResponse;
  env: Record<string, string | undefined>;
  appSessionClaims: ReturnType<typeof getUaisAppSessionClaimsFromCookieString>;
  observedAt: Date;
  verifiedContentSha?: string;
}) {
  const { request, response, env, appSessionClaims, observedAt } = input;
  const guard = getUaisStagingInpGuard(env, input.verifiedContentSha);
  if (!guard.enabled) return response;
  const binding = getUaisStagingInpBinding(env, input.verifiedContentSha);
  const journey = classifyUaisStagingInpJourney(request.nextUrl.pathname);
  const documentNavigation =
    request.method === "GET" &&
    request.headers.get("sec-fetch-dest") === "document" &&
    request.headers.get("sec-fetch-mode") === "navigate" &&
    request.headers.get("next-router-prefetch") !== "1" &&
    request.headers.get("purpose")?.toLowerCase() !== "prefetch";
  const exactDeployment =
    binding !== null &&
    request.nextUrl.protocol === "https:" &&
    request.nextUrl.hostname === binding.deploymentHost &&
    request.nextUrl.port === "";
  const stagingRole =
    appSessionClaims?.role === "student" || appSessionClaims?.role === "teacher"
      ? appSessionClaims.role
      : null;
  const roleOwnsJourney =
    stagingRole !== null &&
    journey !== null &&
    (stagingRole === "student"
      ? journey.startsWith("student-")
      : journey.startsWith("teacher-"));
  const approved =
    appSessionClaims !== null &&
    isApprovedUaisStagingInpOperator(appSessionClaims.account, env);

  if (
    !binding ||
    !documentNavigation ||
    !exactDeployment ||
    !appSessionClaims ||
    !stagingRole ||
    !journey ||
    !roleOwnsJourney ||
    !approved
  ) {
    if (documentNavigation) clearStagingInpRouteAttestation(response);
    return response;
  }

  const token = createUaisStagingInpRouteAttestation({
    binding,
    account: appSessionClaims.account,
    sessionId: appSessionClaims.sessionId,
    role: stagingRole,
    journey,
    secret: env.UAIS_STAGING_INP_HMAC_SECRET ?? "",
    now: observedAt,
    sessionExpiresAt: appSessionClaims.expiresAt,
  });
  if (!token) {
    clearStagingInpRouteAttestation(response);
    return response;
  }
  response.cookies.set({
    name: UAIS_STAGING_INP_ROUTE_ATTESTATION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: UAIS_STAGING_INP_ROUTE_ATTESTATION_TTL_SECONDS,
  });
  return response;
}

function clearStagingInpRouteAttestation(response: NextResponse) {
  response.cookies.set({
    name: UAIS_STAGING_INP_ROUTE_ATTESTATION_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
