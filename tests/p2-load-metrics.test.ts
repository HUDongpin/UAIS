import { describe, expect, it } from "vitest";
import {
  p2LogicalRequestMetricsPass,
  summarizeP2LogicalRequestMetrics,
} from "../scripts/lib/p2-load-metrics.mjs";

const thresholds = {
  minimumSuccessRate: 0.99,
  maximumServerErrorRate: 0.005,
  maximumP95Milliseconds: 2_000,
};

describe("P2 sustained-load logical request metrics", () => {
  it("does not let a final 2xx hide a transient 429, 5xx, timeout, or network error", () => {
    const metrics = summarizeP2LogicalRequestMetrics([
      {
        ok: true,
        status: 200,
        attempts: 5,
        attemptErrors: ["http-429", "http-5xx", "timeout", "network-error"],
        latencyMs: 50,
      },
    ]);

    expect(metrics).toMatchObject({
      requestCount: 1,
      successCount: 1,
      retryCount: 4,
      blockingAttemptErrorCount: 4,
      attemptErrorCounts: {
        "http-429": 1,
        "http-5xx": 1,
        timeout: 1,
        "network-error": 1,
      },
      affectedRequestCounts: {
        "http-429": 1,
        "http-5xx": 1,
        timeout: 1,
        "network-error": 1,
      },
    });
    expect(p2LogicalRequestMetricsPass(metrics, thresholds)).toBe(false);
  });

  it("counts repeated attempts separately while counting each affected request once", () => {
    const metrics = summarizeP2LogicalRequestMetrics([
      {
        ok: true,
        status: 201,
        attempts: 3,
        attemptErrors: ["http-429", "http-429"],
        latencyMs: 20,
      },
      {
        ok: true,
        status: 201,
        attempts: 2,
        attemptErrors: ["http-429"],
        latencyMs: 30,
      },
    ]);

    expect(metrics.attemptErrorCounts).toEqual({ "http-429": 3 });
    expect(metrics.affectedRequestCounts).toEqual({ "http-429": 2 });
    expect(metrics.blockingAttemptErrorCount).toBe(3);
  });

  it("passes a clean bounded set and still enforces latency and server-error thresholds", () => {
    const clean = summarizeP2LogicalRequestMetrics([
      { ok: true, status: 200, attempts: 1, attemptErrors: [], latencyMs: 10 },
      { ok: true, status: 200, attempts: 1, attemptErrors: [], latencyMs: 20 },
    ]);
    expect(p2LogicalRequestMetricsPass(clean, thresholds)).toBe(true);

    expect(
      p2LogicalRequestMetricsPass(
        { ...clean, p95Milliseconds: 2_001 },
        thresholds,
      ),
    ).toBe(false);
    expect(
      p2LogicalRequestMetricsPass(
        { ...clean, serverErrorRate: 0.006 },
        thresholds,
      ),
    ).toBe(false);
  });

  it("fails malformed results closed without reflecting raw error values", () => {
    const metrics = summarizeP2LogicalRequestMetrics([
      {
        ok: true,
        status: 200,
        attempts: 2,
        attemptErrors: ["secret-provider-body"],
        latencyMs: 10,
      },
    ]);

    expect(metrics.attemptErrorCounts).toEqual({
      "invalid-operation-result": 1,
    });
    expect(JSON.stringify(metrics)).not.toContain("secret-provider-body");
    expect(p2LogicalRequestMetricsPass(metrics, thresholds)).toBe(false);
  });

  it("rejects an internally inconsistent success flag on a non-2xx response", () => {
    const metrics = summarizeP2LogicalRequestMetrics([
      {
        ok: true,
        status: 404,
        attempts: 1,
        attemptErrors: [],
        latencyMs: 10,
      },
    ]);

    expect(metrics).toMatchObject({
      successCount: 0,
      failureCount: 1,
      blockingAttemptErrorCount: 1,
      attemptErrorCounts: { "invalid-operation-result": 1 },
      affectedRequestCounts: { "invalid-operation-result": 1 },
    });
    expect(p2LogicalRequestMetricsPass(metrics, thresholds)).toBe(false);
  });
});
