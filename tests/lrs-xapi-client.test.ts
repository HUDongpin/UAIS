import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createUaisLrsSmokeStatement,
  getRedactedLrsReadiness,
  postXapiStatement,
  resolveLrsConfig,
} from "@/lib/learning-records/lrs-client";
import {
  createLrsSmokeGetHandler,
  createLrsSmokePostHandler,
} from "@/app/api/learning-records/lrs/smoke/route";
import { createUaisAiAccessSessionForTrustedActor } from "@/lib/server/ai-access-control";

const aiAccessSigningSecret = "test-ai-access-signing-secret";
const signedAdminAiAccessHeaders = createUaisAiAccessSessionForTrustedActor({
  secret: aiAccessSigningSecret,
  now: new Date("2099-01-01T00:00:00.000Z"),
  ttlSeconds: 3600,
  actor: {
    actorId: "admin-ai-ops",
    role: "admin",
  },
}).headers;

describe("UAIS Learning Record Store xAPI connection", () => {
  it("documents server-only LRS variables without exposing values", () => {
    const template = readFileSync(join(process.cwd(), ".env.local.example"), "utf8");

    for (const envName of [
      "UAIS_LRS_ENDPOINT",
      "UAIS_LRS_USERNAME",
      "UAIS_LRS_PASSWORD",
      "UAIS_LRS_XAPI_VERSION",
    ]) {
      expect(template).toMatch(new RegExp(`^${envName}=`, "m"));
    }

    expect(template).not.toMatch(/^NEXT_PUBLIC_.*LRS/m);
    expect(template).not.toMatch(/Basic\s+[A-Za-z0-9+/=]+/);
  });

  it("reports LRS readiness with redacted endpoint and credential values", () => {
    const readiness = getRedactedLrsReadiness({
      UAIS_LRS_ENDPOINT: "https://lrs.example.test/xapi/",
      UAIS_LRS_USERNAME: "lrs-user",
      UAIS_LRS_PASSWORD: "lrs-password",
      UAIS_LRS_XAPI_VERSION: "1.0.3",
    });
    const serialized = JSON.stringify(readiness);

    expect(readiness).toEqual({
      target: "learning-record-store",
      status: "ready",
      responsibleSession: "S19/S12",
      endpoint: {
        status: "present",
        fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
        valueRedacted: true,
      },
      credentials: {
        username: "present",
        password: "present",
        valuesRedacted: true,
      },
      xapiVersion: {
        status: "present",
        value: "1.0.3",
      },
      blockedReasons: [],
      safety: {
        serverOnly: true,
        valuesRedacted: true,
        liveWriteRequiresApproval: true,
      },
    });
    expect(serialized).not.toContain("https://lrs.example.test");
    expect(serialized).not.toContain("lrs-user");
    expect(serialized).not.toContain("lrs-password");
  });

  it("blocks LRS configuration when required server-only values are missing", () => {
    const result = resolveLrsConfig({
      UAIS_LRS_ENDPOINT: "https://lrs.example.test/xapi/",
      UAIS_LRS_USERNAME: "lrs-user",
    });

    expect(result).toEqual({
      status: "blocked",
      blockedReasons: ["missing-UAIS_LRS_PASSWORD"],
      readiness: expect.objectContaining({
        status: "blocked",
        credentials: {
          username: "present",
          password: "missing",
          valuesRedacted: true,
        },
      }),
    });
  });

  it("posts a UAIS smoke statement to the LRS statements resource using xAPI headers", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(["statement-id-from-lrs"], { status: 200 }),
    );
    const config = resolveLrsConfig({
      UAIS_LRS_ENDPOINT: "https://lrs.example.test/xapi/",
      UAIS_LRS_USERNAME: "lrs-user",
      UAIS_LRS_PASSWORD: "lrs-password",
      UAIS_LRS_XAPI_VERSION: "1.0.3",
    });
    if (config.status !== "ready") {
      throw new Error("Expected ready LRS config fixture.");
    }

    const statement = createUaisLrsSmokeStatement({
      runId: "uais-lrs-smoke-test",
      timestamp: "2026-06-19T00:00:00.000Z",
    });
    const result = await postXapiStatement({
      config: config.config,
      statement,
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://lrs.example.test/xapi/statements");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Experience-API-Version": "1.0.3",
        Authorization: "Basic bHJzLXVzZXI6bHJzLXBhc3N3b3Jk",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        id: "uais-lrs-smoke-test",
        actor: expect.objectContaining({
          objectType: "Agent",
          account: {
            homePage: "https://uais.top/xapi/actors",
            name: "uais-local-smoke",
          },
        }),
        verb: expect.objectContaining({
          id: "http://adlnet.gov/expapi/verbs/experienced",
        }),
        object: expect.objectContaining({
          id: "https://uais.top/xapi/activities/local-lrs-smoke",
          objectType: "Activity",
        }),
      }),
    );
    expect(result).toEqual({
      target: "learning-record-store",
      status: "passed",
      httpStatus: 200,
      responseShape: "statement-ids-array",
      statementId: {
        status: "present",
        fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
        valueRedacted: true,
      },
      safety: {
        endpointRedacted: true,
        credentialsRedacted: true,
        responseBodyOmitted: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("statement-id-from-lrs");
    expect(JSON.stringify(result)).not.toContain("lrs-password");
  });

  it("exposes a local LRS smoke route that requires explicit write approval", async () => {
    const env = {
      NODE_ENV: "development",
      UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      UAIS_LRS_ENDPOINT: "https://lrs.example.test/xapi/",
      UAIS_LRS_USERNAME: "lrs-user",
      UAIS_LRS_PASSWORD: "lrs-password",
    };
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const getHandler = createLrsSmokeGetHandler({ env });
    const postHandler = createLrsSmokePostHandler({
      env,
      fetch: fetchMock,
      createRunId: () => "uais-lrs-route-smoke",
      now: () => "2026-06-19T00:00:00.000Z",
    });

    const readinessResponse = await getHandler(
      new Request("http://localhost/api/learning-records/lrs/smoke", {
        headers: signedAdminAiAccessHeaders,
      }),
    );
    const readiness = await readinessResponse.json();
    expect(readinessResponse.status).toBe(200);
    expect(readiness.readiness).toEqual(expect.objectContaining({ status: "ready" }));

    const blockedResponse = await postHandler(
      new Request("http://localhost/api/learning-records/lrs/smoke", {
        method: "POST",
        headers: signedAdminAiAccessHeaders,
      }),
    );
    const blocked = await blockedResponse.json();
    expect(blockedResponse.status).toBe(428);
    expect(blocked).toEqual({
      error: "LRS live smoke requires explicit approval.",
      requiredQuery: "approved=true",
      safety: {
        writesTestStatementOnly: true,
        valuesRedacted: true,
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const liveResponse = await postHandler(
      new Request("http://localhost/api/learning-records/lrs/smoke?approved=true", {
        method: "POST",
        headers: signedAdminAiAccessHeaders,
      }),
    );
    const live = await liveResponse.json();

    expect(liveResponse.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(live).toEqual(
      expect.objectContaining({
        target: "learning-record-store-smoke",
        status: "passed",
        result: expect.objectContaining({
          status: "passed",
          httpStatus: 204,
        }),
      }),
    );
    expect(JSON.stringify(live)).not.toContain("https://lrs.example.test");
    expect(JSON.stringify(live)).not.toContain("lrs-user");
    expect(JSON.stringify(live)).not.toContain("lrs-password");
  });

  it("rejects local LRS smoke readiness and approved writes without signed admin session claims", async () => {
    const env = {
      NODE_ENV: "development",
      UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      UAIS_LRS_ENDPOINT: "https://lrs.example.test/xapi/",
      UAIS_LRS_USERNAME: "lrs-user",
      UAIS_LRS_PASSWORD: "lrs-password",
    };
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const getHandler = createLrsSmokeGetHandler({ env });
    const postHandler = createLrsSmokePostHandler({
      env,
      fetch: fetchMock,
      createRunId: () => "uais-lrs-route-smoke",
      now: () => "2026-06-19T00:00:00.000Z",
    });

    const readinessResponse = await getHandler(
      new Request("http://localhost/api/learning-records/lrs/smoke"),
    );
    const readiness = await readinessResponse.json();
    expect(readinessResponse.status).toBe(403);
    expect(readiness.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        action: "lrs-readiness",
        responsibleSession: "S12",
      }),
    );

    const liveResponse = await postHandler(
      new Request("http://localhost/api/learning-records/lrs/smoke?approved=true", {
        method: "POST",
      }),
    );
    const live = await liveResponse.json();
    expect(liveResponse.status).toBe(403);
    expect(live.access).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "signed-session-required",
        action: "lrs-live-smoke",
        responsibleSession: "S12",
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redacts LRS transport errors from the smoke route response", async () => {
    const env = {
      NODE_ENV: "development",
      UAIS_AI_ACCESS_SIGNING_SECRET: aiAccessSigningSecret,
      UAIS_LRS_ENDPOINT: "https://secret-lrs.example.test/xapi/",
      UAIS_LRS_USERNAME: "lrs-user",
      UAIS_LRS_PASSWORD: "lrs-password",
    };
    const postHandler = createLrsSmokePostHandler({
      env,
      fetch: vi.fn(async () => {
        throw new Error("connect ETIMEDOUT https://secret-lrs.example.test/xapi/statements");
      }),
    });

    const response = await postHandler(
      new Request("http://localhost/api/learning-records/lrs/smoke?approved=true", {
        method: "POST",
        headers: signedAdminAiAccessHeaders,
      }),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(502);
    expect(body).toEqual({
      target: "learning-record-store-smoke",
      status: "failed",
      error: "LRS smoke failed.",
      safety: {
        valuesRedacted: true,
        responseBodyOmitted: true,
      },
    });
    expect(serialized).not.toContain("secret-lrs.example.test");
    expect(serialized).not.toContain("lrs-user");
    expect(serialized).not.toContain("lrs-password");
  });
});
