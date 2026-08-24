import { randomUUID } from "node:crypto";
import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
} from "@/lib/ai/progress/responsible-progress";
import {
  assertUaisAiAdminAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";
import { authorizeUaisOidcTeacherAuthRequest } from "@/lib/server/teacher-auth-oidc";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { authorizeUaisTrustedTeacherAuthIssuerRequest } from "@/lib/server/teacher-auth-issuer-proof";
import {
  createUaisTeacherAuthSessionSetCookieHeaders,
  UAIS_TEACHER_AUTH_CLAIMS_COOKIE,
  UAIS_TEACHER_AUTH_SIGNATURE_COOKIE,
  type UaisTeacherAuthSessionClaims,
} from "@/lib/server/teacher-auth-session";

type TeacherAuthSessionIssueBody = {
  teacherId?: string;
  ttlSeconds?: number;
};

type TeacherAuthSessionIssuePostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  createSessionId?: () => string;
  fetchJwks?: (url: string) => Promise<unknown>;
};

export function createTeacherAuthSessionIssuePostHandler(
  deps: TeacherAuthSessionIssuePostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const createSessionId = deps.createSessionId ?? randomUUID;

  return async function POST(request: Request) {
    try {
      const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
      if (authProviderContract.productionStatus !== "ready") {
        return Response.json(
          {
            error: "UAIS trusted teacher auth issuer is not production-ready.",
            authProviderContract,
            progress: createTeacherAuthSessionIssueProgress("auth-provider-not-ready"),
          },
          { status: 503 },
        );
      }

      const signingSecret = env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
      if (!signingSecret) {
        return Response.json(
          {
            error: "UAIS teacher auth session signing secret is not configured.",
            authProviderContract,
            progress: createTeacherAuthSessionIssueProgress("signing-secret-missing"),
          },
          { status: 503 },
        );
      }

      const issuedAt = deps.now ?? new Date();

      if (authProviderContract.providerKind === "trusted-cookie-issuer") {
        assertUaisAiAdminAccess({
          request,
          env,
          now: deps.now,
          action: "teacher-auth-session-issue",
          requireSignedSession: true,
        });

        const body = parseTeacherAuthSessionIssueBody(await request.json());
        const teacherId = readRequiredTeacherId(body);
        const trustedIssuer = authorizeUaisTrustedTeacherAuthIssuerRequest({
          request,
          secret: env.UAIS_TEACHER_AUTH_ISSUER_SECRET,
          teacherId,
          now: deps.now,
        });
        if (trustedIssuer.status === "denied") {
          return Response.json(
            {
              error: "UAIS trusted teacher auth issuer proof is required.",
              trustedIssuer,
              authProviderContract,
              progress: createTeacherAuthSessionIssueProgress("issuer-proof-required"),
            },
            { status: 403 },
          );
        }
        const issuer = trustedIssuer.issuer;
        if (!issuer) {
          return Response.json(
            {
              error: "UAIS trusted teacher auth issuer proof is required.",
              trustedIssuer,
              authProviderContract,
              progress: createTeacherAuthSessionIssueProgress("issuer-proof-required"),
            },
            { status: 403 },
          );
        }

        const ttlSeconds = capTeacherAuthSessionTtlToExpiry({
          requestedTtlSeconds: clampTeacherAuthSessionTtlSeconds(body.ttlSeconds),
          expiresAt: issuer.expiresAt,
          now: issuedAt,
          invalidMessage: "Trusted teacher auth issuer expiry is invalid.",
        });
        if (ttlSeconds < 1) {
          return Response.json(
            {
              error:
                "UAIS trusted teacher auth issuer proof cannot mint a positive session lifetime.",
              trustedIssuer,
              authProviderContract,
              progress: createTeacherAuthSessionIssueProgress("issuer-proof-expiring"),
            },
            { status: 403 },
          );
        }
        const claims = createTeacherAuthSessionClaims({
          actorId: teacherId,
          issuedAt,
          ttlSeconds,
          createSessionId,
        });

        return createTeacherAuthSessionIssueResponse({
          claims,
          signingSecret,
          secure: isTeacherAuthSessionIssueProductionRuntime(env),
          maxAgeSeconds: ttlSeconds,
          authProvider: "trusted-cookie-issuer",
          authSource: "trusted-cookie-issuer",
          authProviderContract,
          extraBody: { trustedIssuer },
        });
      }

      if (authProviderContract.providerKind === "oidc-jwks") {
        const oidcIdentity = await authorizeUaisOidcTeacherAuthRequest({
          request,
          env,
          now: deps.now,
          fetchJwks: deps.fetchJwks,
        });
        if (oidcIdentity.status === "denied") {
          return Response.json(
            {
              error: "UAIS OIDC teacher auth bearer token is required.",
              oidcIdentity,
              authProviderContract,
              progress: createTeacherAuthSessionIssueProgress("oidc-token-required"),
            },
            { status: 403 },
          );
        }

        const body = parseTeacherAuthSessionIssueBody(await request.json());
        if (body.teacherId && body.teacherId !== oidcIdentity.teacherId) {
          return Response.json(
            {
              error: "UAIS OIDC teacher auth bearer token is required.",
              oidcIdentity: createDeniedOidcTeacherAuthDecision("oidc-teacher-mismatch"),
              authProviderContract,
              progress: createTeacherAuthSessionIssueProgress("oidc-token-required"),
            },
            { status: 403 },
          );
        }

        const ttlSeconds = capTeacherAuthSessionTtlToExpiry({
          requestedTtlSeconds: clampTeacherAuthSessionTtlSeconds(body.ttlSeconds),
          expiresAt: oidcIdentity.tokenExpiry,
          now: issuedAt,
          invalidMessage: "UAIS OIDC teacher auth token expiry is invalid.",
        });
        if (ttlSeconds < 1) {
          return Response.json(
            {
              error:
                "UAIS OIDC teacher auth token cannot mint a positive session lifetime.",
              oidcIdentity,
              authProviderContract,
              progress: createTeacherAuthSessionIssueProgress("oidc-token-expiring"),
            },
            { status: 403 },
          );
        }
        const claims = createTeacherAuthSessionClaims({
          actorId: oidcIdentity.teacherId,
          issuedAt,
          ttlSeconds,
          createSessionId,
        });

        return createTeacherAuthSessionIssueResponse({
          claims,
          signingSecret,
          secure: isTeacherAuthSessionIssueProductionRuntime(env),
          maxAgeSeconds: ttlSeconds,
          authProvider: "oidc-jwks",
          authSource: "oidc-jwks",
          authProviderContract,
          extraBody: { oidcIdentity },
        });
      }

      return Response.json(
        {
          error: "UAIS teacher auth provider is unsupported.",
          authProviderContract,
          progress: createTeacherAuthSessionIssueProgress("auth-provider-not-ready"),
        },
        { status: 503 },
      );
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }

      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid UAIS teacher auth session issue request.",
        },
        { status: 400 },
      );
    }
  };
}

function createDeniedOidcTeacherAuthDecision(reasonCode: "oidc-teacher-mismatch") {
  return {
    status: "denied",
    responsibleSession: "S12",
    providerKind: "oidc-jwks",
    reasonCode,
    redaction: {
      tokens: "omitted",
      jwks: "omitted",
      providerValues: "omitted",
    },
  } as const;
}

function parseTeacherAuthSessionIssueBody(value: unknown): TeacherAuthSessionIssueBody {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const teacherId = typeof value.teacherId === "string" ? value.teacherId.trim() : "";

  return {
    ...(teacherId ? { teacherId } : {}),
    ...(typeof value.ttlSeconds === "number" ? { ttlSeconds: value.ttlSeconds } : {}),
  };
}

function readRequiredTeacherId(body: TeacherAuthSessionIssueBody) {
  if (!body.teacherId) {
    throw new Error("A teacherId is required.");
  }

  return body.teacherId;
}

function clampTeacherAuthSessionTtlSeconds(value: number | undefined) {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error("ttlSeconds must be a positive number.");
  }

  return Math.min(Math.floor(value ?? 900), 3600);
}

function capTeacherAuthSessionTtlToExpiry(input: {
  requestedTtlSeconds: number;
  expiresAt: string;
  now: Date;
  invalidMessage: string;
}) {
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    throw new Error(input.invalidMessage);
  }

  const remainingSeconds = Math.max(
    0,
    Math.floor((expiresAt - input.now.getTime()) / 1000),
  );
  return Math.min(input.requestedTtlSeconds, remainingSeconds);
}

function createTeacherAuthSessionClaims(input: {
  actorId: string;
  issuedAt: Date;
  ttlSeconds: number;
  createSessionId: () => string;
}): UaisTeacherAuthSessionClaims {
  return {
    sessionId: input.createSessionId(),
    actorId: input.actorId,
    role: "teacher",
    authenticatedAt: input.issuedAt.toISOString(),
    expiresAt: new Date(input.issuedAt.getTime() + input.ttlSeconds * 1000).toISOString(),
  };
}

function createTeacherAuthSessionIssueResponse(input: {
  claims: UaisTeacherAuthSessionClaims;
  signingSecret: string;
  secure: boolean;
  maxAgeSeconds: number;
  authProvider: "trusted-cookie-issuer" | "oidc-jwks";
  authSource: "trusted-cookie-issuer" | "oidc-jwks";
  authProviderContract: ReturnType<typeof resolveUaisTeacherAuthProviderContract>;
  extraBody: Record<string, unknown>;
}) {
  const setCookieHeaders = createUaisTeacherAuthSessionSetCookieHeaders({
    claims: input.claims,
    secret: input.signingSecret,
    maxAgeSeconds: input.maxAgeSeconds,
    secure: input.secure,
  });

  const responseBody = {
    teacherAuthSession: {
      responsibleSession: "S12",
      authProvider: input.authProvider,
      authSource: input.authSource,
      authSessionRef: "server-side-auth-session",
      actor: {
        actorId: input.claims.actorId,
        role: input.claims.role,
      },
      authenticatedAt: input.claims.authenticatedAt,
      expiresAt: input.claims.expiresAt,
      cookieNames: [
        UAIS_TEACHER_AUTH_CLAIMS_COOKIE,
        UAIS_TEACHER_AUTH_SIGNATURE_COOKIE,
      ],
      cookieSecurity: {
        httpOnly: true,
        sameSite: "Lax",
        secure: input.secure,
        path: "/",
        priority: "High",
        maxAgeSeconds: input.maxAgeSeconds,
      },
      redaction: {
        secrets: "omitted",
        cookies: "headers-only",
        sessionIds: "omitted",
      },
    },
    ...input.extraBody,
    authProviderContract: input.authProviderContract,
    progress: createTeacherAuthSessionIssueProgress("issued"),
  };
  const headers = new Headers({ "content-type": "application/json" });
  for (const setCookieHeader of setCookieHeaders) {
    headers.append("set-cookie", setCookieHeader);
  }

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers,
  });
}

function isTeacherAuthSessionIssueProductionRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function createTeacherAuthSessionIssueProgress(
  status:
    | "auth-provider-not-ready"
    | "signing-secret-missing"
    | "issuer-proof-required"
    | "issuer-proof-expiring"
    | "oidc-token-required"
    | "oidc-token-expiring"
    | "issued",
) {
  return assertResponsibleProgressIsDisplaySafe([
    createResponsibleProgressItem({
      index: 0,
      type: "s12-trusted-teacher-auth-issuer",
      status,
      responsibleSession: "S12",
      providerRole: "text-reasoning",
      progressText:
        status === "issued"
          ? "S12 Backend/API Platform issued a hardened signed teacher-auth cookie pair from trusted admin access."
          : status === "issuer-proof-expiring"
            ? "S12 Backend/API Platform blocked teacher-auth issuance because the trusted issuer proof cannot mint a positive session lifetime."
          : status === "oidc-token-expiring"
            ? "S12 Backend/API Platform blocked teacher-auth issuance because the OIDC token cannot mint a positive session lifetime."
          : status === "issuer-proof-required"
            ? "S12 Backend/API Platform blocked teacher-auth issuance until the trusted issuer proof is signed."
          : "S12 Backend/API Platform blocked trusted teacher-auth issuance until the production auth provider contract is ready.",
    }),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
