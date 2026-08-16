export const UAIS_APP_SESSION_COOKIE = "uais_app_session";
export const UAIS_APP_SESSION_SIGNATURE_COOKIE = "uais_app_session_signature";

export type UaisAppRole = "teacher" | "student" | "admin";

export type UaisAppSessionUser = {
  account: string;
  role: UaisAppRole;
  displayName: string;
  department: string;
};

export function getUaisHomeHrefForRole(role: UaisAppRole) {
  return role === "student" ? "/student-dashboard" : "/teaching";
}

export function isUaisRouteAllowedForRole(target: string, role: UaisAppRole) {
  const pathname = readRoutePathname(target);
  if (pathname === "/") {
    return true;
  }

  const commonRoutePrefixes = ["/courses", "/learning"];
  if (
    commonRoutePrefixes.some((prefix) => {
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    })
  ) {
    return true;
  }

  if (role === "teacher" || role === "admin") {
    return pathname === "/teaching" || pathname.startsWith("/teaching/");
  }

  return pathname === "/student-dashboard" || pathname.startsWith("/student-dashboard/");
}

// Callers pass either a bare pathname (the proxy) or a whole return path with its
// query string (the post-login redirect target, e.g. `/courses?invite=CODE`).
// Matching the query as part of the path would refuse exactly the links this gate
// exists to let through, so the query and fragment are cut off first.
function readRoutePathname(target: string) {
  return target.split(/[?#]/, 1)[0];
}
