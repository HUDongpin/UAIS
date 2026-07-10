import { describe, expect, it } from "vitest";
import { createUaisHealthGetHandler } from "@/app/healthz/route";

describe("UAIS app health endpoint", () => {
  it("returns a redacted no-store liveness response for uptime checks", async () => {
    const getHealth = createUaisHealthGetHandler({
      now: () => new Date("2026-07-08T12:00:00.000Z"),
    });

    const response = getHealth();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "ok",
      service: "uais",
      checkedAt: "2026-07-08T12:00:00.000Z",
      checks: {
        app: "ok",
      },
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
      },
    });
    expect(JSON.stringify(body)).not.toContain("/Users/");
  });
});
