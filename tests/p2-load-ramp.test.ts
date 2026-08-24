import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runP2LoadRamp } from "../scripts/lib/p2-load-ramp.mjs";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createCapacityLimitedTransport(limit: number) {
  const firstWave = createDeferred();
  const waiters: Array<() => void> = [];
  let active = 0;
  let firstWaveArrivals = 0;

  async function acquire() {
    if (active < limit && waiters.length === 0) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  }

  function release() {
    const next = waiters.shift();
    if (next) {
      next();
      return;
    }
    active -= 1;
  }

  return {
    async execute<T>(run: () => Promise<T>) {
      await acquire();
      firstWaveArrivals += 1;
      if (firstWaveArrivals === limit) firstWave.resolve();

      try {
        await firstWave.promise;
        return await run();
      } finally {
        release();
      }
    },
  };
}

describe("P2 staged load ramp", () => {
  it("fails a declared 200-user stage when the fake transport reaches only 10 in flight", async () => {
    const actors = Array.from({ length: 200 }, (_unused, index) => ({
      actorId: `student-${index + 1}`,
    }));
    const transports = new Map<number, ReturnType<typeof createCapacityLimitedTransport>>();

    const receipt = await runP2LoadRamp({
      actors,
      rampTargets: [5, 20, 50, 100, 200],
      runActor: async ({ targetActiveUsers, trackOperation, trackTransport }) => {
        let transport = transports.get(targetActiveUsers);
        if (!transport) {
          transport = createCapacityLimitedTransport(
            targetActiveUsers === 200 ? 10 : targetActiveUsers,
          );
          transports.set(targetActiveUsers, transport);
        }
        for (const operation of [
          "read",
          "group-chat-write",
          "group-chat-readback",
        ] as const) {
          await trackOperation(operation, () =>
            transport.execute(() =>
              trackTransport(operation, async () => ({ ok: true, status: 200 })),
            ),
          );
        }
      },
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.stages).toHaveLength(5);
    expect(receipt.stages[4]).toMatchObject({
      status: "FAIL",
      targetActiveUsers: 200,
      scheduledActors: 200,
      observedDistinctActors: 200,
      maxInFlight: 10,
      started: 200,
      completed: 200,
      failed: 0,
    });
    expect(receipt.stages[4].failureCodes).toContain(
      "concurrency-threshold-not-met",
    );
  });

  it("rejects a partial or reordered ramp before dispatching workload", async () => {
    let workloadCalls = 0;
    const receipt = await runP2LoadRamp({
      actors: Array.from({ length: 200 }, (_unused, index) => ({
        actorId: `student-${index + 1}`,
      })),
      rampTargets: [5, 20, 200],
      runActor: async () => {
        workloadCalls += 1;
      },
    });

    expect(receipt).toEqual({
      status: "FAIL",
      rampTargets: [5, 20, 200],
      stages: [],
      failureCodes: ["load-ramp-targets-invalid"],
    });
    expect(workloadCalls).toBe(0);
  });

  it("passes only after every actor performs the full workload at each 5 to 200 stage", async () => {
    const actors = Array.from({ length: 200 }, (_unused, index) => ({
      actorId: `student-${index + 1}`,
    }));
    const firstReadGates = new Map<
      number,
      { arrivals: number; deferred: ReturnType<typeof createDeferred> }
    >();

    const receipt = await runP2LoadRamp({
      actors,
      rampTargets: [5, 20, 50, 100, 200],
      runActor: async ({ targetActiveUsers, trackOperation, trackTransport }) => {
        let gate = firstReadGates.get(targetActiveUsers);
        if (!gate) {
          gate = { arrivals: 0, deferred: createDeferred() };
          firstReadGates.set(targetActiveUsers, gate);
        }

        await trackOperation("read", () =>
          trackTransport("read", async () => {
            gate.arrivals += 1;
            if (gate.arrivals === targetActiveUsers) gate.deferred.resolve();
            await gate.deferred.promise;
            return { ok: true, status: 200 };
          }),
        );
        await trackOperation("group-chat-write", () =>
          trackTransport("group-chat-write", async () => ({
            ok: true,
            status: 200,
          })),
        );
        await trackOperation("group-chat-readback", () =>
          trackTransport("group-chat-readback", async () => ({
            ok: true,
            status: 200,
          })),
        );
      },
    });

    expect(receipt.status).toBe("PASS");
    expect(receipt.stages.map((stage) => stage.targetActiveUsers)).toEqual([
      5, 20, 50, 100, 200,
    ]);
    for (const stage of receipt.stages) {
      expect(stage).toMatchObject({
        status: "PASS",
        scheduledActors: stage.targetActiveUsers,
        observedDistinctActors: stage.targetActiveUsers,
        maxInFlight: stage.targetActiveUsers,
        maxTransportInFlightByOperation: {
          read: stage.targetActiveUsers,
          "group-chat-write": stage.targetActiveUsers,
          "group-chat-readback": stage.targetActiveUsers,
        },
        started: stage.targetActiveUsers,
        completed: stage.targetActiveUsers,
        failed: 0,
        errors: {},
        failureCodes: [],
      });
      expect(stage.p50Milliseconds).toBeGreaterThanOrEqual(0);
      expect(stage.p95Milliseconds).toBeGreaterThanOrEqual(
        stage.p50Milliseconds,
      );
      expect(stage.p99Milliseconds).toBeGreaterThanOrEqual(
        stage.p95Milliseconds,
      );
      expect(new Date(stage.startedAt).toISOString()).toBe(stage.startedAt);
      expect(new Date(stage.completedAt).toISOString()).toBe(stage.completedAt);
      expect(stage.durationMilliseconds).toBeGreaterThanOrEqual(0);
    }
  });

  it("rejects duplicate actors before dispatching any workload", async () => {
    let workloadCalls = 0;
    const receipt = await runP2LoadRamp({
      actors: [
        { actorId: "student-1" },
        { actorId: "student-1" },
        { actorId: "student-2" },
        { actorId: "student-3" },
        { actorId: "student-4" },
      ],
      rampTargets: [5, 20, 50, 100, 200],
      runActor: async () => {
        workloadCalls += 1;
      },
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.stages[0]).toMatchObject({
      status: "FAIL",
      targetActiveUsers: 5,
      scheduledActors: 0,
      observedDistinctActors: 0,
      maxInFlight: 0,
      started: 0,
      completed: 0,
      failed: 0,
      failureCodes: ["duplicate-actor"],
    });
    expect(workloadCalls).toBe(0);
  });

  it("fails closed and distributes 429, 5xx, and timeout errors by failed actor", async () => {
    const actors = Array.from({ length: 5 }, (_unused, index) => ({
      actorId: `student-${index + 1}`,
    }));
    const readBarrier = createDeferred();
    let readArrivals = 0;

    const receipt = await runP2LoadRamp({
      actors,
      rampTargets: [5, 20, 50, 100, 200],
      runActor: async ({ actorId, trackOperation, trackTransport }) => {
        await trackOperation("read", () =>
          trackTransport("read", async () => {
            readArrivals += 1;
            if (readArrivals === 5) readBarrier.resolve();
            await readBarrier.promise;
            return actorId === "student-3"
              ? { ok: false, status: 0, errorType: "timeout" }
              : { ok: true, status: 200 };
          }),
        );
        await trackOperation("group-chat-write", () =>
          trackTransport("group-chat-write", async () =>
            actorId === "student-1"
              ? { ok: false, status: 429 }
              : { ok: true, status: 200 },
          ),
        );
        await trackOperation("group-chat-readback", () =>
          trackTransport("group-chat-readback", async () =>
            actorId === "student-2"
              ? { ok: false, status: 503 }
              : { ok: true, status: 200 },
          ),
        );
      },
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.stages[0]).toMatchObject({
      status: "FAIL",
      targetActiveUsers: 5,
      scheduledActors: 5,
      observedDistinctActors: 5,
      maxInFlight: 5,
      started: 5,
      completed: 5,
      failed: 3,
      errors: {
        "http-429": 1,
        "http-5xx": 1,
        timeout: 1,
      },
    });
    expect(receipt.stages[0].failureCodes).toEqual(
      expect.arrayContaining([
        "actor-workload-failed",
        "http-429",
        "http-5xx",
        "timeout",
      ]),
    );
  });

  it("fails a stage when a retry hides a transient 429 behind a final 2xx", async () => {
    const actors = Array.from({ length: 200 }, (_unused, index) => ({
      actorId: `student-${index + 1}`,
    }));
    const gates = new Map<number, { arrivals: number; deferred: ReturnType<typeof createDeferred> }>();

    const receipt = await runP2LoadRamp({
      actors,
      rampTargets: [5, 20, 50, 100, 200],
      runActor: async ({ actorId, targetActiveUsers, trackOperation, trackTransport }) => {
        let gate = gates.get(targetActiveUsers);
        if (!gate) {
          gate = { arrivals: 0, deferred: createDeferred() };
          gates.set(targetActiveUsers, gate);
        }
        await trackOperation("read", () =>
          trackTransport("read", async () => {
            gate.arrivals += 1;
            if (gate.arrivals === targetActiveUsers) gate.deferred.resolve();
            await gate.deferred.promise;
            return { ok: true, status: 200 };
          }),
        );
        await trackOperation("group-chat-write", () =>
          trackTransport("group-chat-write", async () => ({
            ok: true,
            status: 200,
            attemptErrors:
              targetActiveUsers === 5 && actorId === "student-1"
                ? ["http-429"]
                : [],
          })),
        );
        await trackOperation("group-chat-readback", () =>
          trackTransport("group-chat-readback", async () => ({
            ok: true,
            status: 200,
          })),
        );
      },
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.stages).toHaveLength(1);
    expect(receipt.stages[0]).toMatchObject({
      status: "FAIL",
      failed: 1,
      errors: { "http-429": 1 },
    });
    expect(receipt.stages[0].failureCodes).toEqual(
      expect.arrayContaining(["actor-workload-failed", "http-429"]),
    );
  });

  it("counts attempt failures separately from affected requests and actors", async () => {
    const actors = Array.from({ length: 5 }, (_unused, index) => ({
      actorId: `student-${index + 1}`,
    }));

    const receipt = await runP2LoadRamp({
      actors,
      rampTargets: [5, 20, 50, 100, 200],
      runActor: async ({ actorId, trackOperation, trackTransport }) => {
        for (const operation of [
          "read",
          "group-chat-write",
          "group-chat-readback",
        ] as const) {
          await trackOperation(operation, () =>
            trackTransport(operation, async () => ({
              ok: true,
              status: 200,
              attemptErrors:
                actorId === "student-1" && operation !== "read"
                  ? ["http-429", "http-429"]
                  : [],
            })),
          );
        }
      },
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.stages[0]).toMatchObject({
      attemptErrorCounts: { "http-429": 4 },
      affectedRequestCounts: { "http-429": 2 },
      affectedActorCounts: { "http-429": 1 },
      errors: { "http-429": 1 },
    });
  });

  it("rejects duplicate operations and internally inconsistent success results", async () => {
    const actors = Array.from({ length: 5 }, (_unused, index) => ({
      actorId: `student-${index + 1}`,
    }));

    const receipt = await runP2LoadRamp({
      actors,
      rampTargets: [5, 20, 50, 100, 200],
      runActor: async ({ actorId, trackOperation, trackTransport }) => {
        const perform = (operation: "read" | "group-chat-write" | "group-chat-readback") =>
          trackOperation(operation, () =>
            trackTransport(operation, async () => ({
              ok: true,
              status:
                actorId === "student-2" && operation === "group-chat-readback"
                  ? 500
                  : 200,
            })),
          );
        await perform("read");
        await perform("group-chat-write");
        if (actorId === "student-1") await perform("group-chat-write");
        await perform("group-chat-readback");
      },
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.stages[0].failureCodes).toEqual(
      expect.arrayContaining([
        "actor-workload-failed",
        "duplicate-workload-operation",
        "invalid-operation-result",
      ]),
    );
  });

  it("fails when every response is 2xx but an operation p95 exceeds the ramp SLO", async () => {
    const actors = Array.from({ length: 5 }, (_unused, index) => ({
      actorId: `student-${index + 1}`,
    }));

    const receipt = await runP2LoadRamp({
      actors,
      rampTargets: [5, 20, 50, 100, 200],
      maximumP95Milliseconds: 1,
      runActor: async ({ trackOperation, trackTransport }) => {
        for (const operation of [
          "read",
          "group-chat-write",
          "group-chat-readback",
        ] as const) {
          await trackOperation(operation, () =>
            trackTransport(operation, async () => {
              await new Promise((resolve) => setTimeout(resolve, 5));
              return { ok: true, status: 200 };
            }),
          );
        }
      },
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.stages[0].failureCodes).toContain("p95-threshold-exceeded");
    expect(receipt.stages[0].operationMetrics.read.p95Milliseconds).toBeGreaterThan(1);
  });

  it("measures latency through body decoding and validation after response headers", async () => {
    const actors = Array.from({ length: 5 }, (_unused, index) => ({
      actorId: `student-${index + 1}`,
    }));

    const receipt = await runP2LoadRamp({
      actors,
      rampTargets: [5, 20, 50, 100, 200],
      maximumP95Milliseconds: 1,
      runActor: async ({ trackOperation, trackTransport }) => {
        for (const operation of [
          "read",
          "group-chat-write",
          "group-chat-readback",
        ] as const) {
          await trackOperation(operation, async () => {
            const response = await trackTransport(operation, async () => ({
              ok: true,
              status: 200,
            }));
            await new Promise((resolve) => setTimeout(resolve, 5));
            return response;
          });
        }
      },
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.stages[0]).toMatchObject({
      latencyMeasurement: "client-operation-through-body-validation",
      failureCodes: expect.arrayContaining(["p95-threshold-exceeded"]),
    });
    expect(receipt.stages[0].operationMetrics.read.p95Milliseconds).toBeGreaterThan(1);
  });

  it("requires an instrumented transport call for every required operation", async () => {
    const actors = Array.from({ length: 5 }, (_unused, index) => ({
      actorId: `student-${index + 1}`,
    }));

    const receipt = await runP2LoadRamp({
      actors,
      rampTargets: [5, 20, 50, 100, 200],
      runActor: async ({ trackOperation, trackTransport }) => {
        await trackOperation("read", async () => ({ ok: true, status: 200 }));
        await trackOperation("group-chat-write", () =>
          trackTransport("group-chat-write", async () => ({ ok: true, status: 200 })),
        );
        await trackOperation("group-chat-readback", () =>
          trackTransport("group-chat-readback", async () => ({ ok: true, status: 200 })),
        );
      },
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.stages[0].failureCodes).toContain(
      "required-transport-operation-missing",
    );
  });

  it("aborts and awaits every worker before returning a timed-out stage", async () => {
    const actors = Array.from({ length: 5 }, (_unused, index) => ({
      actorId: `student-${index + 1}`,
    }));
    let activeTransports = 0;
    let settledTransports = 0;

    const receipt = await runP2LoadRamp({
      actors,
      rampTargets: [5, 20, 50, 100, 200],
      stageTimeoutMilliseconds: 25,
      runActor: async ({ signal, trackOperation, trackTransport }) => {
        await trackOperation("read", () =>
          trackTransport(
            "read",
            () =>
              new Promise((resolve) => {
                activeTransports += 1;
                const settle = () => {
                  setTimeout(() => {
                    activeTransports -= 1;
                    settledTransports += 1;
                    resolve({ ok: false, status: 0, errorType: "timeout" });
                  }, 5);
                };
                if (signal.aborted) settle();
                else signal.addEventListener("abort", settle, { once: true });
              }),
          ),
        );
      },
    });

    expect(receipt.status).toBe("FAIL");
    expect(receipt.stages).toHaveLength(1);
    expect(receipt.stages[0]).toMatchObject({
      completed: 5,
      workersQuiesced: true,
      inFlightAtCompletion: 0,
      failureCodes: expect.arrayContaining(["stage-timeout"]),
    });
    expect(receipt.stages[0].failureCodes).not.toContain(
      "actor-completion-count-mismatch",
    );
    expect(activeTransports).toBe(0);
    expect(settledTransports).toBe(5);
  });

  it("wires the ramp core to the isolated staging chatroom read, write, and readback journey", () => {
    const source = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");

    expect(source).toContain(
      'import { runP2LoadRamp } from "./lib/p2-load-ramp.mjs";',
    );
    expect(source).toContain("await runP2LoadRamp({");
    expect(source).toContain("rampTargets: expectedUserRamp");
    expect(source).toContain('trackOperation("read"');
    expect(source).toContain('trackOperation("group-chat-write"');
    expect(source).toContain('trackOperation("group-chat-readback"');
    expect(source).toContain('trackTransport("read"');
    expect(source).toContain('trackTransport("group-chat-write"');
    expect(source).toContain('trackTransport("group-chat-readback"');
    expect(source).toContain("attemptErrors");
    expect(source).toContain("signal: stageSignal");
    expect(source).toContain("await delay(100 * attempt, signal)");
    expect(source).toContain("/api/learning/chatroom");
  });
});
