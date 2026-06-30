import { NextResponse, type NextRequest } from "next/server";
import {
  getUaisHomeHrefForRole,
  isUaisRouteAllowedForRole,
  type UaisAppRole,
} from "@/lib/auth/uais-app-session";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

const protectedRoutePrefixes = ["/courses", "/learning", "/teaching", "/student-dashboard"];
const trustedTeacherSessionCookieNames = [
  "uais_teacher_auth_claims",
  "uais_teacher_auth_signature",
] as const;

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
  const trustedTeacherSession = hasTrustedTeacherSessionPair(request);
  const role: UaisAppRole | undefined =
    appSessionUser?.role ?? (trustedTeacherSession ? "teacher" : undefined);
  const authenticated = Boolean(appSessionUser) || trustedTeacherSession;

  if (isLoginRoute && authenticated) {
    return NextResponse.redirect(new URL(getUaisHomeHrefForRole(role ?? "teacher"), request.url));
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

function hasTrustedTeacherSessionPair(request: NextRequest) {
  return trustedTeacherSessionCookieNames.every((name) => Boolean(request.cookies.get(name)?.value));
}
