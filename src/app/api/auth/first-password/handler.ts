import { randomUUID } from "node:crypto";
import { isSameOriginClassroomRequest } from "@/lib/server/classroom-request-origin";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import { createClassroomRosterStore, ClassroomAccountError } from "@/lib/server/classroom-roster-store";
import { passwordSetupCookieFromRequest, passwordSetupSetCookie, readPasswordSetupToken } from "@/lib/server/classroom-password-setup-token";
import { createUaisAppSessionClaims, createUaisAppSessionSetCookieHeaders, isUaisAppProductionRuntime, resolveUaisAppSessionSigningSecret } from "@/lib/server/uais-app-session";

export function createFirstPasswordHandler(deps: { env?: Record<string, string | undefined>; now?: Date; setFirstPassword?: (input: { account: string; credentialVersion: number; password: string }) => Promise<UaisAppSessionUser> } = {}) {
  return async function POST(request: Request) {
    const env = deps.env ?? process.env;
    const respond = (status: number, reasonCode: string) => Response.json({ reasonCode }, { status, headers: { "cache-control": "no-store" } });
    if (!isSameOriginClassroomRequest(request)) return respond(403, "same-origin-required");
    const secret = resolveUaisAppSessionSigningSecret(env);
    if (!secret) return respond(503, "app-session-signing-secret-missing");
    const claims = readPasswordSetupToken(passwordSetupCookieFromRequest(request), { secret, now: deps.now });
    if (!claims) return respond(401, "password-setup-expired");
    try {
      const text = await request.text();
      if (text.length > 2048) return respond(413, "password-body-too-large");
      let body: { password?: unknown };
      try { body = JSON.parse(text); } catch { return respond(400, "password-body-invalid"); }
      if (!body || typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) return respond(400, "password-length-12-128");
      const setFirstPassword = deps.setFirstPassword ?? createClassroomRosterStore({ env }).setFirstPassword;
      const user = await setFirstPassword({ account: claims.account, credentialVersion: claims.credentialVersion, password: body.password });
      const secure = isUaisAppProductionRuntime(env), ttlSeconds = 8 * 60 * 60;
      const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
      for (const cookie of createUaisAppSessionSetCookieHeaders({ claims: createUaisAppSessionClaims({ user, sessionId: randomUUID(), now: deps.now, ttlSeconds }), secret, maxAgeSeconds: ttlSeconds, secure })) headers.append("set-cookie", cookie);
      headers.append("set-cookie", passwordSetupSetCookie("", secure));
      return new Response(JSON.stringify({ status: "ok", redirectTarget: claims.from ?? "/courses" }), { headers });
    } catch (error) {
      return respond(error instanceof ClassroomAccountError ? error.status : 503, error instanceof ClassroomAccountError ? error.code : "password-setup-unavailable");
    }
  };
}
