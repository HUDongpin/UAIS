const requiredOperations = Object.freeze([
  "read",
  "group-chat-write",
  "group-chat-readback",
]);
const requiredRampTargets = Object.freeze([5, 20, 50, 100, 200]);
const defaultMaximumP95Milliseconds = 2_000;
const defaultStageTimeoutMilliseconds = 180_000;

export async function runP2LoadRamp({
  actors,
  rampTargets,
  runActor,
  maximumP95Milliseconds = defaultMaximumP95Milliseconds,
  stageTimeoutMilliseconds = defaultStageTimeoutMilliseconds,
}) {
  if (
    !Array.isArray(rampTargets) ||
    rampTargets.length !== requiredRampTargets.length ||
    rampTargets.some((target, index) => target !== requiredRampTargets[index])
  ) {
    return rejectedRamp(rampTargets, "load-ramp-targets-invalid");
  }
  if (!Array.isArray(actors) || typeof runActor !== "function") {
    return rejectedRamp(rampTargets, "load-ramp-runner-invalid");
  }
  if (
    !Number.isFinite(maximumP95Milliseconds) ||
    maximumP95Milliseconds <= 0 ||
    !Number.isInteger(stageTimeoutMilliseconds) ||
    stageTimeoutMilliseconds < 1
  ) {
    return rejectedRamp(rampTargets, "load-ramp-thresholds-invalid");
  }

  const stages = [];
  for (let stageIndex = 0; stageIndex < rampTargets.length; stageIndex += 1) {
    const targetActiveUsers = rampTargets[stageIndex];
    const stageActors = actors.slice(0, targetActiveUsers);
    const actorIds = stageActors.map(readActorId);
    if (actorIds.some((actorId) => !actorId)) {
      stages.push(createRejectedStage(targetActiveUsers, "invalid-actor-id"));
      break;
    }
    if (new Set(actorIds).size !== actorIds.length) {
      stages.push(createRejectedStage(targetActiveUsers, "duplicate-actor"));
      break;
    }
    const stage = await runStage({
      stageActors,
      stageIndex,
      targetActiveUsers,
      runActor,
      maximumP95Milliseconds,
      stageTimeoutMilliseconds,
    });
    stages.push(stage);
    if (stage.status !== "PASS") break;
  }

  const passed =
    stages.length === rampTargets.length &&
    stages.every((stage) => stage.status === "PASS");
  return {
    status: passed ? "PASS" : "FAIL",
    rampTargets: [...rampTargets],
    stages,
    failureCodes: passed ? [] : ["load-ramp-stage-failed"],
  };
}

function rejectedRamp(rampTargets, failureCode) {
  return {
    status: "FAIL",
    rampTargets: Array.isArray(rampTargets) ? [...rampTargets] : [],
    stages: [],
    failureCodes: [failureCode],
  };
}

function createRejectedStage(targetActiveUsers, failureCode) {
  const timestamp = new Date().toISOString();
  return {
    status: "FAIL",
    targetActiveUsers,
    scheduledActors: 0,
    observedDistinctActors: 0,
    maxInFlight: 0,
    concurrencyMeasurement: "client-fetch-until-response-headers",
    latencyMeasurement: "client-operation-through-body-validation",
    maxTransportInFlightByOperation: emptyOperationRecord(0),
    transportMetrics: emptyOperationMetrics(),
    started: 0,
    completed: 0,
    workersQuiesced: true,
    inFlightAtCompletion: 0,
    failed: 0,
    p50Milliseconds: 0,
    p95Milliseconds: 0,
    p99Milliseconds: 0,
    maximumP95Milliseconds: defaultMaximumP95Milliseconds,
    operationMetrics: emptyOperationMetrics(),
    attemptErrorCounts: {},
    affectedRequestCounts: {},
    affectedActorCounts: {},
    errors: {},
    startedAt: timestamp,
    completedAt: timestamp,
    durationMilliseconds: 0,
    failureCodes: [failureCode],
  };
}

async function runStage({
  stageActors,
  stageIndex,
  targetActiveUsers,
  runActor,
  maximumP95Milliseconds,
  stageTimeoutMilliseconds,
}) {
  const startedAt = new Date();
  const abortController = new AbortController();
  const readyGate = createReadyGate(stageActors.length, abortController.signal);
  const operationGates = new Map(
    requiredOperations.map((operation) => [
      operation,
      createReadyGate(stageActors.length, abortController.signal),
    ]),
  );
  const observedActors = new Set();
  const actorLatencies = [];
  const actorOutcomes = [];
  const transportInFlightByOperation = emptyOperationRecord(0);
  const maxTransportInFlightByOperation = emptyOperationRecord(0);
  const transportLatenciesByOperation = emptyOperationRecord(() => []);
  const operationLatenciesByOperation = emptyOperationRecord(() => []);
  let totalTransportInFlight = 0;
  let maxInFlight = 0;
  let started = 0;
  let completed = 0;

  const jobs = stageActors.map(async (actor) => {
    const actorId = readActorId(actor);
    const actorStartedAt = performance.now();
    const observedOperations = new Map();
    const transportCalls = emptyOperationRecord(0);
    const actorErrorCodes = [];
    const actorAttemptErrors = [];
    const actorAffectedRequests = [];
    let activeOperation = "";
    started += 1;

    const trackTransport = async (operation, run) => {
      if (
        !requiredOperations.includes(operation) ||
        activeOperation !== operation ||
        typeof run !== "function"
      ) {
        actorErrorCodes.push("invalid-transport-instrumentation");
        throw createCodedError("invalid-transport-instrumentation");
      }
      transportCalls[operation] += 1;
      transportInFlightByOperation[operation] += 1;
      maxTransportInFlightByOperation[operation] = Math.max(
        maxTransportInFlightByOperation[operation],
        transportInFlightByOperation[operation],
      );
      totalTransportInFlight += 1;
      maxInFlight = Math.max(maxInFlight, totalTransportInFlight);
      const transportStartedAt = performance.now();
      try {
        return await run();
      } finally {
        transportLatenciesByOperation[operation].push(
          performance.now() - transportStartedAt,
        );
        transportInFlightByOperation[operation] -= 1;
        totalTransportInFlight -= 1;
      }
    };

    const trackOperation = async (operation, run) => {
      observedActors.add(actorId);
      if (!requiredOperations.includes(operation) || typeof run !== "function") {
        actorErrorCodes.push("invalid-workload-operation");
        return { ok: false, status: 0 };
      }
      if (observedOperations.has(operation)) {
        actorErrorCodes.push("duplicate-workload-operation");
        return { ok: false, status: 0 };
      }
      observedOperations.set(operation, undefined);
      await operationGates.get(operation).arriveAndWait();
      const operationStartedAt = performance.now();
      activeOperation = operation;
      try {
        const result = await run();
        observedOperations.set(operation, result);
        const resultErrors = readOperationFailureCodes(result);
        actorAttemptErrors.push(...resultErrors.attemptErrors);
        actorAffectedRequests.push(...resultErrors.affectedRequestErrors);
        actorErrorCodes.push(...resultErrors.affectedRequestErrors);
        return result;
      } finally {
        activeOperation = "";
        operationLatenciesByOperation[operation].push(
          performance.now() - operationStartedAt,
        );
      }
    };

    try {
      await readyGate.arriveAndWait();
      await runActor({
        actor,
        actorId,
        stageIndex,
        targetActiveUsers,
        trackOperation,
        trackTransport,
        signal: abortController.signal,
      });
    } catch (error) {
      actorErrorCodes.push(classifyThrownError(error));
    } finally {
      completed += 1;
      actorLatencies.push(performance.now() - actorStartedAt);
    }

    const missingOperations = requiredOperations.filter(
      (operation) => !observedOperations.has(operation),
    );
    if (missingOperations.length > 0) {
      actorErrorCodes.push("required-workload-operation-missing");
    }
    if (requiredOperations.some((operation) => transportCalls[operation] === 0)) {
      actorErrorCodes.push("required-transport-operation-missing");
    }
    actorOutcomes.push({
      actorErrorCodes: [...new Set(actorErrorCodes)],
      attemptErrors: actorAttemptErrors,
      affectedRequestErrors: actorAffectedRequests,
    });
  });

  const allJobs = Promise.allSettled(jobs).then(() => "completed");
  let timeout;
  const deadline = new Promise((resolve) => {
    timeout = setTimeout(() => {
      abortController.abort();
      resolve("timeout");
    }, stageTimeoutMilliseconds);
  });
  const completion = await Promise.race([allJobs, deadline]);
  // A timed-out stage is not safe to hand to fixture cleanup while requests
  // are still running. Every production transport is bound to this abort
  // signal, so wait for all workers to observe it and settle before returning.
  // If a future transport ignores abort, this function deliberately remains
  // fail-closed instead of emitting a receipt while background writes race the
  // cleanup phase.
  if (completion === "timeout") await allJobs;
  clearTimeout(timeout);

  const failureCodes = [];
  if (completion === "timeout") failureCodes.push("stage-timeout");
  if (stageActors.length !== targetActiveUsers) {
    failureCodes.push("scheduled-actor-count-mismatch");
  }
  if (observedActors.size !== targetActiveUsers) {
    failureCodes.push("observed-distinct-actor-count-mismatch");
  }
  if (
    requiredOperations.some(
      (operation) => maxTransportInFlightByOperation[operation] < targetActiveUsers,
    )
  ) {
    failureCodes.push("concurrency-threshold-not-met");
  }
  if (started !== targetActiveUsers) failureCodes.push("actor-start-count-mismatch");
  if (completed !== targetActiveUsers) {
    failureCodes.push("actor-completion-count-mismatch");
  }

  const failedActorOutcomes = actorOutcomes.filter(
    (outcome) => outcome.actorErrorCodes.length > 0,
  );
  if (failedActorOutcomes.length > 0) failureCodes.push("actor-workload-failed");

  const actorErrorCodes = actorOutcomes.flatMap(
    (outcome) => outcome.actorErrorCodes,
  );
  for (const code of [...new Set(actorErrorCodes)]) failureCodes.push(code);

  const transportMetrics = Object.fromEntries(
    requiredOperations.map((operation) => {
      const latencies = transportLatenciesByOperation[operation];
      return [
        operation,
        {
          requestCount: latencies.length,
          maxInFlight: maxTransportInFlightByOperation[operation],
          p50Milliseconds: percentile(latencies, 0.5),
          p95Milliseconds: percentile(latencies, 0.95),
          p99Milliseconds: percentile(latencies, 0.99),
        },
      ];
    }),
  );
  const operationMetrics = Object.fromEntries(
    requiredOperations.map((operation) => {
      const latencies = operationLatenciesByOperation[operation];
      return [
        operation,
        {
          requestCount: latencies.length,
          p50Milliseconds: percentile(latencies, 0.5),
          p95Milliseconds: percentile(latencies, 0.95),
          p99Milliseconds: percentile(latencies, 0.99),
        },
      ];
    }),
  );
  if (
    Object.values(operationMetrics).some(
      (metrics) => metrics.p95Milliseconds > maximumP95Milliseconds,
    )
  ) {
    failureCodes.push("p95-threshold-exceeded");
  }
  const actorJourneyP95Milliseconds = percentile(actorLatencies, 0.95);
  if (actorJourneyP95Milliseconds > maximumP95Milliseconds) {
    failureCodes.push("actor-journey-p95-threshold-exceeded");
  }

  const attemptErrorCounts = countValues(
    actorOutcomes.flatMap((outcome) => outcome.attemptErrors),
  );
  const affectedRequestCounts = countValues(
    actorOutcomes.flatMap((outcome) => outcome.affectedRequestErrors),
  );
  const affectedActorCounts = countValues(
    actorOutcomes.flatMap((outcome) => [...new Set(outcome.actorErrorCodes)]),
  );
  const completedAt = new Date();
  const uniqueFailureCodes = [...new Set(failureCodes)];
  return {
    status: uniqueFailureCodes.length === 0 ? "PASS" : "FAIL",
    targetActiveUsers,
    scheduledActors: stageActors.length,
    observedDistinctActors: observedActors.size,
    maxInFlight,
    concurrencyMeasurement: "client-fetch-until-response-headers",
    latencyMeasurement: "client-operation-through-body-validation",
    maxTransportInFlightByOperation,
    transportMetrics,
    started,
    completed,
    workersQuiesced: true,
    inFlightAtCompletion: totalTransportInFlight,
    failed: failedActorOutcomes.length,
    p50Milliseconds: percentile(actorLatencies, 0.5),
    p95Milliseconds: actorJourneyP95Milliseconds,
    p99Milliseconds: percentile(actorLatencies, 0.99),
    maximumP95Milliseconds,
    operationMetrics,
    attemptErrorCounts,
    affectedRequestCounts,
    affectedActorCounts,
    // Backward-compatible alias with an explicit, non-attempt meaning.
    errors: affectedActorCounts,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMilliseconds: completedAt.getTime() - startedAt.getTime(),
    failureCodes: uniqueFailureCodes,
  };
}

function createReadyGate(target, signal) {
  let arrived = 0;
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  signal.addEventListener("abort", () => release(), { once: true });

  return {
    async arriveAndWait() {
      arrived += 1;
      if (arrived === target) release();
      await ready;
      if (signal.aborted) throw createCodedError("stage-timeout");
    },
  };
}

function createCodedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function readActorId(actor) {
  return typeof actor?.actorId === "string" ? actor.actorId : "";
}

function classifyThrownError(error) {
  if (error?.code === "stage-timeout") return "stage-timeout";
  if (error?.code === "invalid-transport-instrumentation") {
    return "invalid-transport-instrumentation";
  }
  if (error?.name === "TimeoutError" || error?.code === "ETIMEDOUT") {
    return "timeout";
  }
  return "unexpected-error";
}

function classifyOperationFailure(result) {
  if (!result || typeof result !== "object") return "invalid-operation-result";
  if (result.ok === true && result.status === 200 && !result.errorType) return undefined;
  if (result.ok === true) return "invalid-operation-result";
  if (result.errorType === "timeout") return "timeout";
  if (result.status === 429) return "http-429";
  if (result.status >= 500 && result.status <= 599) return "http-5xx";
  if (result.status >= 400 && result.status <= 499) return "http-4xx";
  if (result.status === 0) return "network-error";
  return "invalid-operation-result";
}

function readOperationFailureCodes(result) {
  const attemptErrors = Array.isArray(result?.attemptErrors)
    ? result.attemptErrors.map(normalizeAttemptError)
    : [];
  const finalError = classifyOperationFailure(result);
  return {
    attemptErrors,
    affectedRequestErrors: [
      ...new Set([...attemptErrors, ...(finalError ? [finalError] : [])]),
    ],
  };
}

function normalizeAttemptError(value) {
  return [
    "http-429",
    "http-5xx",
    "http-4xx",
    "timeout",
    "network-error",
    "invalid-operation-result",
  ].includes(value)
    ? value
    : "invalid-operation-result";
}

function emptyOperationRecord(initialValue) {
  return Object.fromEntries(
    requiredOperations.map((operation) => [
      operation,
      typeof initialValue === "function" ? initialValue() : initialValue,
    ]),
  );
}

function emptyOperationMetrics() {
  return Object.fromEntries(
    requiredOperations.map((operation) => [
      operation,
      {
        requestCount: 0,
        maxInFlight: 0,
        p50Milliseconds: 0,
        p95Milliseconds: 0,
        p99Milliseconds: 0,
      },
    ]),
  );
}

function countValues(values) {
  return Object.fromEntries(
    [...new Set(values)].sort().map((value) => [
      value,
      values.filter((candidate) => candidate === value).length,
    ]),
  );
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * quantile) - 1,
  );
  return Math.round(sorted[index]);
}
