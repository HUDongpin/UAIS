import { NextResponse, type NextRequest } from "next/server";
import {
  getUaisHomeHrefForRole,
  isUaisRouteAllowedForRole,
  UAIS_APP_SESSION_COOKIE,
  UAIS_APP_SESSION_SIGNATURE_COOKIE,
  type UaisAppRole,
} from "@/lib/auth/uais-app-session";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";

const protectedRoutePrefixes = ["/courses", "/learning", "/teaching", "/student-dashboard"];

export function proxy(
  request: NextRequest,
  env: Record<string, string | undefined> = process.env,
) {
  const pathname = request.nextUrl.pathname;
  const isLoginRoute = pathname === "/login";
  const appSessionUser = getUaisAppSessionUserFromCookieString(
    request.headers.get("cookie"),
    { env },
  );
  const appSessionCookiePair = hasUaisAppSessionCookiePair(request);
  const trustedTeacherSession = hasVerifiedTrustedTeacherSession(request, env);
  const role: UaisAppRole | undefined =
    appSessionUser?.role ?? (trustedTeacherSession ? "teacher" : undefined);
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
    Boolean(appSessionUser) ||
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

  return NextResponse.next();
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
