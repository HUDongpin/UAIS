export const UAIS_APP_SESSION_COOKIE = "uais_app_session";
export const UAIS_APP_SESSION_SIGNATURE_COOKIE = "uais_app_session_signature";

export type UaisAppRole = "teacher" | "student";

export type UaisAppSessionUser = {
  account: string;
  role: UaisAppRole;
  displayName: string;
  department: string;
};

export function getUaisHomeHrefForRole(role: UaisAppRole) {
  return role === "teacher" ? "/teaching" : "/student-dashboard";
}

export function isUaisRouteAllowedForRole(pathname: string, role: UaisAppRole) {
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

  if (role === "teacher") {
    return pathname === "/teaching" || pathname.startsWith("/teaching/");
  }

  return pathname === "/student-dashboard" || pathname.startsWith("/student-dashboard/");
}
