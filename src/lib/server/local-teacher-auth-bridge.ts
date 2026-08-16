import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import {
  createUaisTeacherAuthSessionSetCookieHeaders,
  UAIS_TEACHER_AUTH_CLAIMS_COOKIE,
  UAIS_TEACHER_AUTH_SIGNATURE_COOKIE,
} from "@/lib/server/teacher-auth-session";
import { isUaisAppDeployedRuntime } from "@/lib/server/uais-app-session";

// Local-only bridge from the app-session login to a signed teacher session.
//
// Every teaching WRITE route reads the signed teacher cookie pair and nothing
// else, while `/login` issues only the app-session cookie. The single mint path,
// `POST /api/ai/teacher-auth/issue`, needs trusted-issuer proof or an OIDC
// bearer token and is deliberately unreachable from the UI. The result was that
// a teacher who signed in could list their courses and then failed 401 on every
// create, approve, operation and audit call - locally as much as in production.
//
// This bridge closes that gap for local development ONLY. Production keeps
// exactly one story: the trusted issuer (or OIDC) mints teacher sessions, and
// `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` stays a quarantined-legacy name
// that production is not expected to set.
//
// Two properties are load-bearing and must not be softened:
//
// 1. The gate is `isUaisAppDeployedRuntime`, not `isUaisAppProductionRuntime`.
//    A Vercel preview build is not "production" by the narrower predicate, and a
//    self-hosted staging box may set only `UAIS_DEPLOYMENT_ENV`. The deployed
//    predicate is the one that already gates the app-session dev signing secret,
//    so the bridge can never mint anywhere a deployment exists.
//
// 2. There is NO development fallback for the signing secret. The teacher claims
//    carry no issuer, audience or environment fingerprint, and verification is a
//    bare HMAC over the claims - so a committed fallback constant would be a
//    published forgery key for teacher writes on any host that happens to set
//    none of the three runtime markers. The developer sets the secret in
//    `.env.local`; without it the bridge mints nothing and says so by name.
export type LocalTeacherAuthBridgeStatus =
  | "issued"
  | "skipped-deployed-runtime"
  | "skipped-non-local-demo-provider"
  | "skipped-non-teacher-role"
  | "skipped-signing-secret-not-configured"
  | "skipped-actor-id-unsupported";

export type LocalTeacherAuthBridgeResult = {
  status: LocalTeacherAuthBridgeStatus;
  setCookieHeaders: string[];
};

// The narrowest shape every consumer of the cookie enforces: the teacher-auth
// module itself also accepts "@", but `isSafeTeachingCourseActorId` and
// `isSafeTeachingOperationId` do not. Minting an actor id that only the cookie
// module accepts would produce a structurally valid session that every write
// route silently discards - the same 401 this bridge exists to remove.
const localTeacherAuthBridgeActorIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const localTeacherAuthBridgeActorIdMaxLength = 120;

export function resolveLocalTeacherAuthBridge(input: {
  env: Record<string, string | undefined>;
  providerKind: string;
  role: "teacher" | "student" | "admin";
  actorId: string;
  sessionId: string;
  authenticatedAt: string;
  expiresAt: string;
  maxAgeSeconds: number;
  secure: boolean;
}): LocalTeacherAuthBridgeResult {
  if (isUaisAppDeployedRuntime(input.env)) {
    return { status: "skipped-deployed-runtime", setCookieHeaders: [] };
  }

  // A locally pointed trusted-account provider may assert any role it likes over
  // plain http on loopback, so the bridge stays with the hard-coded demo table
  // rather than becoming an unaudited teacher-minting oracle.
  if (input.providerKind !== "local-demo") {
    return { status: "skipped-non-local-demo-provider", setCookieHeaders: [] };
  }

  // The claims type hard-codes `role: "teacher"`, so admin does not bridge even
  // though it shares the teacher landing route.
  if (input.role !== "teacher") {
    return { status: "skipped-non-teacher-role", setCookieHeaders: [] };
  }

  const secret = input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  if (!secret) {
    return {
      status: "skipped-signing-secret-not-configured",
      setCookieHeaders: [],
    };
  }

  if (!isBridgeableActorId(input.actorId)) {
    return { status: "skipped-actor-id-unsupported", setCookieHeaders: [] };
  }

  // Both timestamps are the app session's own, verbatim: a teacher cookie that
  // outlives the session that authorized it would keep granting writes after
  // sign-out, and one that dies earlier would strand the teacher mid-workflow.
  return {
    status: "issued",
    setCookieHeaders: createUaisTeacherAuthSessionSetCookieHeaders({
      claims: {
        sessionId: input.sessionId,
        actorId: input.actorId,
        role: "teacher",
        authenticatedAt: input.authenticatedAt,
        expiresAt: input.expiresAt,
      },
      secret,
      maxAgeSeconds: input.maxAgeSeconds,
      secure: input.secure,
    }),
  };
}

// ---------------------------------------------------------------------------
// The production sibling.
//
// A separate exported function rather than a relaxed flag on the resolver
// above, because the two differ in the single most load-bearing guard: that one
// refuses every deployed runtime, and this one exists precisely to run in one.
// Keeping them apart means no edit to a production path can weaken the local
// bridge's refusal, and no reader has to work out which mode a boolean puts it
// in.
//
// The trust chain here is short and every link is server-side:
//
//   1. The app provider must be `database-accounts`. Never `!== "local-demo"`:
//      that inversion is what let the demo table authenticate every unknown
//      provider kind on the login route, and the same shape here would let a
//      locally-pointed trusted provider assert `role: "teacher"` over loopback
//      http and mint production write authority.
//   2. The role comes from the `uais_users` row the account provider verified,
//      never from anything the client sent.
//   3. The teacher-auth provider contract must itself report production-ready.
//      Reused, never re-derived: sixteen teaching routes 503 on that same
//      contract, so a bridge that minted on a different rule would hand out a
//      cookie every one of those routes then refuses.
//   4. The signing secret must be present and at least 32 characters, with NO
//      development fallback. The rationale at the top of this file applies
//      verbatim: teacher claims carry no issuer, audience or environment
//      fingerprint and verification is a bare HMAC, so a committed fallback
//      constant would be a published forgery key.
//   5. The actor id must satisfy the same charset every teaching write route
//      enforces, or the cookie would be structurally valid and universally
//      rejected.
//
// What this grants is not small: `src/proxy.ts` derives role "teacher" from
// this cookie alone, with no cross-check against the app session, and sessions
// are stateless with no revocation. That is why every guard above is a positive
// allowlist.
export type VerifiedTeacherAccountAuthBridgeStatus =
  | "issued"
  | "skipped-non-database-account-provider"
  | "skipped-non-teacher-role"
  | "skipped-teacher-auth-provider-not-ready"
  | "skipped-signing-secret-not-configured"
  | "skipped-actor-id-unsupported";

export type VerifiedTeacherAccountAuthBridgeResult = {
  status: VerifiedTeacherAccountAuthBridgeStatus;
  setCookieHeaders: string[];
};

const minimumTeacherAuthSigningSecretLength = 32;

export function resolveVerifiedTeacherAccountAuthBridge(input: {
  env: Record<string, string | undefined>;
  providerKind: string;
  role: "teacher" | "student" | "admin";
  actorId: string;
  sessionId: string;
  authenticatedAt: string;
  expiresAt: string;
  maxAgeSeconds: number;
  secure: boolean;
}): VerifiedTeacherAccountAuthBridgeResult {
  if (input.providerKind !== "database-accounts") {
    return { status: "skipped-non-database-account-provider", setCookieHeaders: [] };
  }

  if (input.role !== "teacher") {
    return { status: "skipped-non-teacher-role", setCookieHeaders: [] };
  }

  if (resolveUaisTeacherAuthProviderContract({ env: input.env }).productionStatus !== "ready") {
    return { status: "skipped-teacher-auth-provider-not-ready", setCookieHeaders: [] };
  }

  const secret = input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  // Re-checked here even though the contract above already enforces it: this
  // function must not be able to mint with a weak secret if the contract is
  // ever extended with a kind that does not check one.
  if (!secret || secret.length < minimumTeacherAuthSigningSecretLength) {
    return { status: "skipped-signing-secret-not-configured", setCookieHeaders: [] };
  }

  if (!isBridgeableActorId(input.actorId)) {
    return { status: "skipped-actor-id-unsupported", setCookieHeaders: [] };
  }

  return {
    status: "issued",
    setCookieHeaders: createUaisTeacherAuthSessionSetCookieHeaders({
      claims: {
        sessionId: input.sessionId,
        actorId: input.actorId,
        role: "teacher",
        authenticatedAt: input.authenticatedAt,
        expiresAt: input.expiresAt,
      },
      secret,
      maxAgeSeconds: input.maxAgeSeconds,
      secure: input.secure,
    }),
  };
}

// Sign-out and account switches must not leave a live write credential behind.
// Clearing a cookie that was never set is a no-op, so the delete path emits
// these unconditionally.
export function createTeacherAuthSessionClearSetCookieHeaders(input: {
  secure: boolean;
}) {
  const attributes = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Priority=High",
    ...(input.secure ? ["Secure"] : []),
  ];

  return [UAIS_TEACHER_AUTH_CLAIMS_COOKIE, UAIS_TEACHER_AUTH_SIGNATURE_COOKIE].map(
    (cookieName) => [`${cookieName}=`, ...attributes].join("; "),
  );
}

// Only true when the caller actually presents a teacher session. A login that
// carries no teacher cookie needs no clear, which keeps the issued cookie set
// for an ordinary sign-in exactly as small as it was before this bridge existed.
export function hasTeacherAuthSessionCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return false;
  }

  return cookieHeader
    .split(";")
    .some((entry) => entry.split("=")[0]?.trim() === UAIS_TEACHER_AUTH_CLAIMS_COOKIE);
}

function isBridgeableActorId(actorId: string) {
  return (
    actorId.length > 0 &&
    actorId.length <= localTeacherAuthBridgeActorIdMaxLength &&
    localTeacherAuthBridgeActorIdPattern.test(actorId)
  );
}
