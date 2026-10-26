import { createHmac, timingSafeEqual } from "node:crypto";
import { isUaisRouteAllowedForRole } from "@/lib/auth/uais-app-session";
export const PASSWORD_SETUP_COOKIE = "uais_password_setup";
const ttlSeconds = 15 * 60;
type PasswordSetupClaims = { purpose: "classroom-first-password"; account: string; credentialVersion: number; issuedAt: number; expiresAt: number; from?: string };
export function createPasswordSetupToken(input: { account: string; credentialVersion: number; secret: string; now?: Date; from?: string }): string {
  const now = (input.now ?? new Date()).getTime();
  const claims: PasswordSetupClaims = { purpose: "classroom-first-password", account: input.account, credentialVersion: input.credentialVersion, issuedAt: now, expiresAt: now + ttlSeconds * 1000, ...(safeFrom(input.from) ? { from: input.from } : {}) };
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encoded}.${signature(encoded, input.secret)}`;
}
export function readPasswordSetupToken(token: string | undefined, input: { secret: string; now?: Date }): PasswordSetupClaims | null {
  if (!token || token.length > 4096) return null;
  const parts = token.split("."); if (parts.length !== 2) return null;
  const expected = Buffer.from(signature(parts[0], input.secret)); const supplied = Buffer.from(parts[1]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const now = (input.now ?? new Date()).getTime();
    if (claims.purpose !== "classroom-first-password" || typeof claims.account !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(claims.account) || !Number.isInteger(claims.credentialVersion) || claims.credentialVersion < 1 || !Number.isFinite(claims.issuedAt) || !Number.isFinite(claims.expiresAt) || claims.issuedAt > now || claims.expiresAt <= now || claims.expiresAt - claims.issuedAt > ttlSeconds * 1000 || (claims.from !== undefined && !safeFrom(claims.from))) return null;
    return claims;
  } catch { return null; }
}
export function passwordSetupSetCookie(token: string, secure: boolean) {
  return `${PASSWORD_SETUP_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? ttlSeconds : 0}${secure ? "; Secure" : ""}`;
}
export function passwordSetupCookieFromRequest(request: Request) {
  return request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith(`${PASSWORD_SETUP_COOKIE}=`))?.slice(PASSWORD_SETUP_COOKIE.length + 1);
}
function signature(value: string, secret: string) { return createHmac("sha256", secret).update(`classroom-first-password:${value}`).digest("base64url"); }
function safeFrom(from: unknown): from is string { return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") && !from.includes("\\") && isUaisRouteAllowedForRole(from, "student"); }
