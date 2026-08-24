import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { evaluateUaisProxy } from "@/proxy";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { createUaisStagingInpOperatorAccountHash } from "@/lib/server/uais-staging-inp-access";
import { getUaisStagingInpBinding } from "@/lib/server/uais-staging-inp-runtime";
import {
  UAIS_STAGING_INP_ROUTE_ATTESTATION_COOKIE,
  createUaisStagingInpRouteAttestation,
  readUaisStagingInpRouteAttestationFromCookieString,
  verifyUaisStagingInpRouteAttestation,
} from "@/lib/server/uais-staging-inp-route-attestation";

const secret = "staging-inp-attestation-secret-fixture-strong";
const now = new Date("2026-08-24T00:00:00.000Z");
const binding = {
  cohortId: `p2-inp-${"a".repeat(40)}-run1`,
  candidateGitSha: "a".repeat(40),
  candidateContentSha: "b".repeat(64),
  deploymentHost: "uais-staging-current-team.vercel.app",
  collectorKeyVersion: "v1",
  operatorAllowlistFingerprint: "d".repeat(64),
};

describe("staging INP route attestation", () => {
  it("binds a short-lived token to the actual route, signed session, role and release", () => {
    const token = createUaisStagingInpRouteAttestation({
      binding,
      account: "operator@example.test",
      sessionId: "signed-session-1",
      role: "student",
      journey: "student-learning",
      secret,
      now,
    });

    expect(token).toBeTruthy();
    expect(token).not.toContain("signed-session-1");
    expect(
      verifyUaisStagingInpRouteAttestation({
        token,
        binding,
        account: "operator@example.test",
        sessionId: "signed-session-1",
        role: "student",
        journey: "student-learning",
        secret,
        now: new Date(now.getTime() + 29 * 60 * 1_000),
      }),
    ).toBe(true);
    expect(
      verifyUaisStagingInpRouteAttestation({
        token,
        binding,
        account: "operator@example.test",
        sessionId: "signed-session-1",
        role: "student",
        journey: "student-chatroom",
        secret,
        now,
      }),
    ).toBe(false);
    expect(
      verifyUaisStagingInpRouteAttestation({
        token,
        binding,
        account: "operator@example.test",
        sessionId: "different-session",
        role: "student",
        journey: "student-learning",
        secret,
        now,
      }),
    ).toBe(false);
    expect(
      verifyUaisStagingInpRouteAttestation({
        token,
        binding: { ...binding, operatorAllowlistFingerprint: "e".repeat(64) },
        account: "operator@example.test",
        sessionId: "signed-session-1",
        role: "student",
        journey: "student-learning",
        secret,
        now,
      }),
    ).toBe(false);
    expect(
      verifyUaisStagingInpRouteAttestation({
        token,
        binding,
        account: "operator@example.test",
        sessionId: "signed-session-1",
        role: "student",
        journey: "student-learning",
        secret,
        now: new Date(now.getTime() + 30 * 60 * 1_000 + 1),
      }),
    ).toBe(false);
  });

  it("rejects tampering and reads only the exact HttpOnly cookie name", () => {
    const token = createUaisStagingInpRouteAttestation({
      binding,
      account: "operator@example.test",
      sessionId: "signed-session-1",
      role: "teacher",
      journey: "teacher-home",
      secret,
      now,
    });
    expect(token).toBeTruthy();
    const cookie = `unrelated=value; ${UAIS_STAGING_INP_ROUTE_ATTESTATION_COOKIE}=${token}`;

    expect(readUaisStagingInpRouteAttestationFromCookieString(cookie)).toBe(token);
    expect(
      verifyUaisStagingInpRouteAttestation({
        token: `${token}x`,
        binding,
        account: "operator@example.test",
        sessionId: "signed-session-1",
        role: "teacher",
        journey: "teacher-home",
        secret,
        now,
      }),
    ).toBe(false);
  });

  it("rejects a signed but non-catalog journey even when its prefix matches the role", () => {
    expect(
      createUaisStagingInpRouteAttestation({
        binding,
        account: "operator@example.test",
        sessionId: "signed-session-1",
        role: "student",
        journey: "student-private-path" as never,
        secret,
        now,
      }),
    ).toBeNull();
  });

  it("is issued by the proxy only after an exact document navigation is observed", () => {
    const candidateGitSha = "a".repeat(40);
    const candidateContentSha = "b".repeat(64);
    const account = "operator@example.test";
    const sessionId = "signed-session-1";
    const operatorHash = createUaisStagingInpOperatorAccountHash(account, secret);
    const env = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
      VERCEL_GIT_COMMIT_SHA: candidateGitSha,
      VERCEL_URL: "uais-staging-current-team.vercel.app",
      UAIS_DEPLOYMENT_ENV: "staging",
      UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
      UAIS_P2_STAGING_DATABASE_URL: "postgres://redacted.example.test/uais",
      NEON_PROJECT_ID: "neon-staging-project-fixture",
      UAIS_STAGING_INP_RUM_ENABLED: "yes",
      P2_CANDIDATE_GIT_SHA: candidateGitSha,
      P2_CANDIDATE_CONTENT_SHA: candidateContentSha,
      UAIS_STAGING_INP_COHORT_ID: `p2-inp-${candidateGitSha}-run1`,
      UAIS_STAGING_INP_HMAC_SECRET: secret,
      UAIS_STAGING_INP_HMAC_KEY_VERSION: "v1",
      UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES: [
        operatorHash ?? "",
        "d".repeat(64),
        "e".repeat(64),
      ].join(","),
      UAIS_APP_SESSION_SIGNING_SECRET: "app-session-secret-fixture-at-least-32",
      CRON_SECRET: "staging-expiry-cron-secret-fixture-at-least-32",
      P2_VERCEL_PROTECTION_BYPASS_SECRET:
        "staging-protection-bypass-fixture-at-least-32",
    };
    const sessionCookie = createUaisAppSessionCookie(
      {
        account,
        displayName: "Operator",
        department: "QA",
        role: "student",
      },
      {
        secret: env.UAIS_APP_SESSION_SIGNING_SECRET,
        sessionId,
        now,
        ttlSeconds: 3_600,
      },
    );
    const request = new NextRequest(
      "https://uais-staging-current-team.vercel.app/learning",
      {
        headers: {
          cookie: sessionCookie,
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        },
      },
    );

    const response = evaluateUaisProxy(request, env, {
      now,
      verifiedContentSha: candidateContentSha,
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    const token = readUaisStagingInpRouteAttestationFromCookieString(setCookie);
    const runtimeBinding = getUaisStagingInpBinding(env, candidateContentSha);

    expect(setCookie).toContain(`${UAIS_STAGING_INP_ROUTE_ATTESTATION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=1800");
    expect(runtimeBinding).not.toBeNull();
    expect(
      verifyUaisStagingInpRouteAttestation({
        token,
        binding: runtimeBinding!,
        account,
        sessionId,
        role: "student",
        journey: "student-learning",
        secret,
        now,
      }),
    ).toBe(true);

    const encodedClaims = token?.split(".", 1)[0] ?? "";
    const decodedClaims = Buffer.from(encodedClaims, "base64url").toString("utf8");
    expect(decodedClaims).not.toContain(account);
    expect(decodedClaims).not.toContain(sessionId);
    expect(decodedClaims).not.toContain("/learning");

    const ineligibleRequests = [
      new NextRequest("https://uais-staging-current-team.vercel.app/learning", {
        headers: { cookie: sessionCookie, rsc: "1" },
      }),
      new NextRequest("https://uais-staging-current-team.vercel.app/learning", {
        headers: {
          cookie: sessionCookie,
          purpose: "prefetch",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        },
      }),
      new NextRequest("https://other-staging.vercel.app/learning", {
        headers: {
          cookie: sessionCookie,
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        },
      }),
      new NextRequest("https://uais-staging-current-team.vercel.app/courses", {
        headers: {
          cookie: sessionCookie,
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        },
      }),
      new NextRequest("https://uais-staging-current-team.vercel.app/teaching", {
        headers: {
          cookie: sessionCookie,
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        },
      }),
    ];
    for (const candidateRequest of ineligibleRequests) {
      const candidateResponse = evaluateUaisProxy(candidateRequest, env, {
        now,
        verifiedContentSha: candidateContentSha,
      });
      expect(
        readUaisStagingInpRouteAttestationFromCookieString(
          candidateResponse.headers.get("set-cookie"),
        ),
      ).toBeNull();
    }

    const disabledResponse = evaluateUaisProxy(request, {
      ...env,
      UAIS_STAGING_INP_RUM_ENABLED: undefined,
    }, {
      now,
      verifiedContentSha: candidateContentSha,
    });
    expect(
      readUaisStagingInpRouteAttestationFromCookieString(
        disabledResponse.headers.get("set-cookie"),
      ),
    ).toBeNull();

    const unapprovedCookie = createUaisAppSessionCookie(
      {
        account: "unapproved@example.test",
        displayName: "Unapproved",
        department: "QA",
        role: "student",
      },
      {
        secret: env.UAIS_APP_SESSION_SIGNING_SECRET,
        sessionId: "unapproved-session",
        now,
        ttlSeconds: 3_600,
      },
    );
    const unapprovedResponse = evaluateUaisProxy(
      new NextRequest("https://uais-staging-current-team.vercel.app/learning", {
        headers: {
          cookie: unapprovedCookie,
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        },
      }),
      env,
      { now, verifiedContentSha: candidateContentSha },
    );
    expect(
      readUaisStagingInpRouteAttestationFromCookieString(
        unapprovedResponse.headers.get("set-cookie"),
      ),
    ).toBeNull();
  });
});
