import { describe, expect, it, vi } from "vitest";
import { createStagingInpPostHandler } from "@/lib/server/uais-staging-inp-route-service";
import {
  UAIS_STAGING_INP_PROJECT_ID,
  type UaisStagingInpPayload,
} from "@/lib/observability/uais-staging-inp";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { createUaisStagingInpOperatorAccountHash } from "@/lib/server/uais-staging-inp-access";
import {
  UaisStagingInpStoreError,
  type UaisStagingInpStoredSample,
} from "@/lib/server/uais-staging-inp-store";

const now = new Date("2026-08-24T12:00:00.000Z");
const account = "adult-staging-teacher";
const appSecret = "app-session-secret-fixture-at-least-32";
const hmacSecret = "staging-inp-hmac-secret-fixture-strong";
const deploymentHost = "uais-staging-current-team.vercel.app";
const candidateGitSha = "a".repeat(40);
const candidateContentSha = "b".repeat(64);
const cohortId = `p2-inp-${candidateGitSha}-run1`;
const payload: UaisStagingInpPayload = {
  id: "v4-current-candidate-sample",
  journey: "teacher-home",
  viewportClass: "wide",
  navigationType: "navigate",
  valueMs: 183,
};

function readyEnv(overrides: Record<string, string | undefined> = {}) {
  const operatorHash = createUaisStagingInpOperatorAccountHash(account, hmacSecret);
  if (!operatorHash) throw new Error("operator test hash required");
  return {
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: UAIS_STAGING_INP_PROJECT_ID,
    VERCEL_GIT_COMMIT_SHA: candidateGitSha,
    VERCEL_URL: deploymentHost,
    UAIS_DEPLOYMENT_ENV: "staging",
    UAIS_STAGING_INP_RUM_ENABLED: "yes",
    UAIS_P2_STAGING_DATABASE_URL: "postgres://redacted.example.test/uais",
    P2_CANDIDATE_GIT_SHA: candidateGitSha,
    P2_CANDIDATE_CONTENT_SHA: candidateContentSha,
    UAIS_STAGING_INP_COHORT_ID: cohortId,
    UAIS_STAGING_INP_HMAC_SECRET: hmacSecret,
    UAIS_APP_SESSION_SIGNING_SECRET: appSecret,
    UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES: operatorHash,
    ...overrides,
  };
}

function signedCookie(role: "teacher" | "student" = "teacher", userAccount = account) {
  return createUaisAppSessionCookie(
    {
      account: userAccount,
      role,
      displayName: "Staging Adult Operator",
      department: "Release QA",
    },
    { secret: appSecret, now, sessionId: `inp-${role}-session` },
  );
}

function requestFor(
  body: unknown = payload,
  input: {
    cookie?: string;
    host?: string;
    origin?: string;
    contentType?: string;
  } = {},
) {
  const host = input.host ?? deploymentHost;
  return new Request(`https://${host}/api/observability/staging-inp`, {
    method: "POST",
    headers: {
      origin: input.origin ?? `https://${host}`,
      host,
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
      "content-type": input.contentType ?? "application/json",
      cookie: input.cookie ?? signedCookie(),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("isolated staging INP route", () => {
  it("accepts an approved signed operator and persists a release-bound sample", async () => {
    const samples: UaisStagingInpStoredSample[] = [];
    const post = createStagingInpPostHandler({
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      now: () => now,
      persist: async (sample) => {
        samples.push(sample);
        return { status: "stored" };
      },
    });

    const response = await post(requestFor());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      target: "uais-staging-inp",
      status: "accepted",
      valuesRedacted: true,
    });
    expect(samples).toEqual([
      expect.objectContaining({
        cohortId,
        candidateGitSha,
        candidateContentSha,
        deploymentHost,
        sampleKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        role: "teacher",
        journey: "teacher-home",
        viewportClass: "wide",
        navigationType: "navigate",
        valueMs: 183,
        receivedAt: "2026-08-24T12:00:00.000Z",
        expiresAt: "2026-08-26T12:00:00.000Z",
      }),
    ]);
  });

  it("rejects a self-asserted content SHA and binds accepted samples to the immutable host", async () => {
    const keys: string[] = [];
    const statuses: number[] = [];
    for (const env of [readyEnv(), readyEnv({ P2_CANDIDATE_CONTENT_SHA: "c".repeat(64) })]) {
      const post = createStagingInpPostHandler({
        env,
        verifiedContentSha: candidateContentSha,
        now: () => now,
        persist: async (sample) => {
          keys.push(sample.sampleKey);
          return { status: "stored" };
        },
      });
      const host = env.VERCEL_URL;
      statuses.push(
        (await post(requestFor(payload, { host, origin: `https://${host}` }))).status,
      );
    }
    expect(statuses).toEqual([202, 404]);
    expect(keys).toHaveLength(1);
  });

  it("rejects mutable/cross origins, missing sessions, wrong roles and unapproved accounts", async () => {
    const persist = vi.fn(async () => ({ status: "stored" as const }));
    const post = createStagingInpPostHandler({
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      now: () => now,
      persist,
    });

    expect(
      (await post(requestFor(payload, { host: "staging.uais.top" }))).status,
    ).toBe(403);
    expect((await post(requestFor(payload, { cookie: "" }))).status).toBe(401);
    expect(
      (
        await post(
          requestFor(payload, {
            cookie: signedCookie("teacher", "not-approved"),
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          requestFor(payload, {
            cookie: signedCookie("student"),
          }),
        )
      ).status,
    ).toBe(403);
    expect(persist).not.toHaveBeenCalled();
  });

  it("fails closed before persistence when the runtime binding is disabled", async () => {
    const persist = vi.fn(async () => ({ status: "stored" as const }));
    const post = createStagingInpPostHandler({
      env: readyEnv({ UAIS_STAGING_INP_RUM_ENABLED: undefined }),
      verifiedContentSha: candidateContentSha,
      now: () => now,
      persist,
    });

    const response = await post(requestFor());
    expect(response.status).toBe(404);
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects non-exact or oversized JSON and redacts storage failures", async () => {
    const post = createStagingInpPostHandler({
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      now: () => now,
      persist: async () => {
        throw new UaisStagingInpStoreError(503, "staging-inp-database-unavailable");
      },
    });

    expect(
      (await post(requestFor({ ...payload, pathname: "/private" }))).status,
    ).toBe(400);
    expect((await post(requestFor("x".repeat(513)))).status).toBe(413);
    expect(
      (await post(requestFor(payload, { contentType: "text/plain" }))).status,
    ).toBe(415);
    const unavailable = await post(requestFor());
    expect(unavailable.status).toBe(503);
    const text = await unavailable.text();
    expect(text).toContain("temporarily-unavailable");
    expect(text).not.toContain("database");
  });

  it("caps a streaming body before buffering an undeclared oversized payload", async () => {
    const persist = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        controller.enqueue(new Uint8Array(600));
        controller.close();
      },
    });
    const request = new Request(
      `https://${deploymentHost}/api/observability/staging-inp`,
      {
        method: "POST",
        headers: {
          origin: `https://${deploymentHost}`,
          host: deploymentHost,
          "x-forwarded-proto": "https",
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
          cookie: signedCookie(),
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );
    const post = createStagingInpPostHandler({
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      now: () => now,
      persist,
    });

    expect((await post(request)).status).toBe(413);
    expect(persist).not.toHaveBeenCalled();
  });
});
