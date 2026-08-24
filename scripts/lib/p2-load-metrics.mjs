const knownAttemptErrors = new Set([
  "http-429",
  "http-5xx",
  "http-4xx",
  "timeout",
  "network-error",
  "invalid-operation-result",
]);

export function summarizeP2LogicalRequestMetrics(results) {
  const safeResults = Array.isArray(results) ? results : [];
  const total = safeResults.length;
  const successfulResults = safeResults.map(isConsistentSuccessResult);
  const successCount = successfulResults.filter(Boolean).length;
  const normalizedAttempts = safeResults.map((result, index) => {
    const attemptErrors = Array.isArray(result?.attemptErrors)
      ? result.attemptErrors.map(normalizeAttemptError)
      : [];
    if (result?.ok === true && !successfulResults[index]) {
      attemptErrors.push("invalid-operation-result");
    }
    return attemptErrors;
  });
  const allAttemptErrors = normalizedAttempts.flat();
  const affectedRequestErrors = normalizedAttempts.flatMap((errors) => [
    ...new Set(errors),
  ]);
  const serverErrorAffectedRequests = safeResults.filter(
    (result, index) =>
      normalizedAttempts[index].includes("http-5xx") ||
      (result?.status >= 500 && result?.status <= 599),
  ).length;
  const latencies = safeResults.map((result) =>
    Number.isFinite(result?.latencyMs) && result.latencyMs >= 0
      ? result.latencyMs
      : Number.POSITIVE_INFINITY,
  );

  return {
    requestCount: total,
    successCount,
    failureCount: total - successCount,
    successRate: total ? roundRate(successCount / total) : 0,
    serverErrorCount: serverErrorAffectedRequests,
    serverErrorRate: total
      ? roundRate(serverErrorAffectedRequests / total)
      : 0,
    retryCount: safeResults.reduce(
      (totalRetries, result) =>
        totalRetries +
        (Number.isInteger(result?.attempts) && result.attempts > 0
          ? result.attempts - 1
          : 0),
      0,
    ),
    blockingAttemptErrorCount: allAttemptErrors.length,
    attemptErrorCounts: countValues(allAttemptErrors),
    affectedRequestCounts: countValues(affectedRequestErrors),
    p95Milliseconds: percentile(latencies, 0.95),
    maximumMilliseconds: latencies.length
      ? Math.round(Math.max(...latencies))
      : 0,
  };
}

function isConsistentSuccessResult(result) {
  return Boolean(
    result?.ok === true &&
      Number.isInteger(result?.status) &&
      result.status >= 200 &&
      result.status <= 299,
  );
}

export function p2LogicalRequestMetricsPass(metrics, thresholds) {
  return Boolean(
    metrics &&
      thresholds &&
      Number.isFinite(metrics.successRate) &&
      metrics.successRate >= thresholds.minimumSuccessRate &&
      Number.isFinite(metrics.serverErrorRate) &&
      metrics.serverErrorRate <= thresholds.maximumServerErrorRate &&
      Number.isFinite(metrics.p95Milliseconds) &&
      metrics.p95Milliseconds <= thresholds.maximumP95Milliseconds &&
      metrics.blockingAttemptErrorCount === 0,
  );
}

function normalizeAttemptError(value) {
  return knownAttemptErrors.has(value) ? value : "invalid-operation-result";
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

function roundRate(value) {
  return Number(value.toFixed(6));
}
