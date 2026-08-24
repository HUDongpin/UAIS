#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { computeUaisStagingCandidateContentSha } from "./p2-staging-candidate-content.mjs";
const runtimeImport = await import("../src/lib/server/uais-staging-inp-runtime.ts");
const storeImport = await import("../src/lib/server/uais-staging-inp-store.ts");
const contractImport = await import("../src/lib/observability/uais-staging-inp.ts");
const runtimeModule = runtimeImport.default ?? runtimeImport;
const storeModule = storeImport.default ?? storeImport;
const contractModule = contractImport.default ?? contractImport;
const {
  getUaisStagingInpBinding,
  getUaisStagingInpCleanupGuard,
  getUaisStagingInpGuard,
} = runtimeModule;
const { UaisStagingInpStoreError, createUaisStagingInpPostgresStore } = storeModule;
const { UAIS_STAGING_INP_MINIMUM_DISTINCT_OPERATORS } = contractModule;

const allowedActions = new Set([
  "setup",
  "readiness",
  "finalize",
  "purge",
  "readback",
  "purge-expired",
]);
const minimumSamplesPerGroup = 30;
const maximumP75Ms = 200;
const expectedGroups = new Set([
  "student\u0000student-learning\u0000compact",
  "student\u0000student-learning\u0000wide",
  "student\u0000student-chatroom\u0000compact",
  "student\u0000student-chatroom\u0000wide",
  "teacher\u0000teacher-home\u0000compact",
  "teacher\u0000teacher-home\u0000wide",
  "teacher\u0000teacher-course-settings\u0000compact",
  "teacher\u0000teacher-course-settings\u0000wide",
  "teacher\u0000teacher-activities\u0000compact",
  "teacher\u0000teacher-activities\u0000wide",
  "teacher\u0000teacher-submissions\u0000compact",
  "teacher\u0000teacher-submissions\u0000wide",
]);

export async function runP2StagingInpLifecycle(input = {}) {
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? process.env;
  const action = readOption(argv, "--action") ?? "";
  const verifiedContentSha =
    input.verifiedContentSha ?? computeUaisStagingCandidateContentSha(process.cwd());
  const binding = getUaisStagingInpBinding(env, verifiedContentSha);
  const blockedReasons = collectBlockedReasons({
    argv,
    env,
    action,
    binding,
    verifiedContentSha,
  });
  const baseReport = createBaseReport({ action, binding });
  if (blockedReasons.length > 0) {
    return {
      exitCode: 2,
      report: {
        ...baseReport,
        status: "BLOCKED_ENV",
        blockedReasons,
      },
    };
  }

  const createStore =
    input.createStore ?? ((storeEnv) => createUaisStagingInpPostgresStore({ env: storeEnv }));
  const store = createStore(env);
  try {
    if (action === "setup") {
      const setup = await store.setup(binding);
      return success(baseReport, { setup });
    }
    if (action === "readiness") {
      const receipt = await store.readiness(binding);
      const threshold = evaluateThreshold(receipt.groups);
      return {
        exitCode: threshold.ready ? 0 : 1,
        report: {
          ...baseReport,
          status: threshold.ready ? "PASS" : "NOT_READY",
          lifecycleState: receipt.state,
          groups: receipt.groups,
          threshold,
        },
      };
    }
    if (action === "finalize") {
      return await finalizeAndPurge({ baseReport, binding, store });
    }
    if (action === "purge") {
      const purge = await store.purge(binding);
      const readback = await store.readback(binding);
      const cleanup = cleanupSummary(purge, readback);
      return {
        exitCode: cleanup.rawSampleRowsZero ? 0 : 1,
        report: {
          ...baseReport,
          status: cleanup.rawSampleRowsZero ? "PASS" : "FAIL",
          cleanup,
        },
      };
    }
    if (action === "readback") {
      const readback = await store.readback(binding);
      return success(baseReport, {
        readback: {
          state: readback.state,
          rawSampleRowsRemaining: readback.rawSampleRowsRemaining,
          cohortTombstoneRetained: readback.cohortTombstoneRetained,
        },
      });
    }
    const expiry = await store.purgeExpired();
    return {
      exitCode: expiry.expiredRawSampleRowsZero ? 0 : 1,
      report: {
        ...baseReport,
        status: expiry.expiredRawSampleRowsZero ? "PASS" : "FAIL",
        expiry,
      },
    };
  } catch (error) {
    return {
      exitCode: 1,
      report: {
        ...baseReport,
        status: "FAIL",
        failureCode:
          error instanceof UaisStagingInpStoreError
            ? error.reasonCode
            : "staging-inp-lifecycle-execution-failed",
        errorMessageOmitted: true,
      },
    };
  }
}

async function finalizeAndPurge({ baseReport, binding, store }) {
  let aggregate;
  let executionFailure;
  let purge;
  let readback;
  try {
    aggregate = await store.aggregate(binding);
  } catch (error) {
    executionFailure = error;
  } finally {
    try {
      purge = await store.purge(binding);
    } catch (error) {
      executionFailure ??= error;
    } finally {
      try {
        readback = await store.readback(binding);
      } catch (error) {
        executionFailure ??= error;
      }
    }
  }

  const threshold = evaluateThreshold(aggregate?.groups ?? []);
  const cleanup = cleanupSummary(purge, readback);
  const passed = !executionFailure && threshold.ready && cleanup.rawSampleRowsZero;
  return {
    exitCode: passed ? 0 : 1,
    report: {
      ...baseReport,
      status: passed ? "PASS" : "FAIL",
      groups: aggregate?.groups ?? [],
      threshold,
      cleanup,
      ...(executionFailure
        ? {
            failureCode:
              executionFailure instanceof UaisStagingInpStoreError
                ? executionFailure.reasonCode
                : "staging-inp-finalize-or-cleanup-failed",
            errorMessageOmitted: true,
          }
        : {}),
    },
  };
}

function collectBlockedReasons({ argv, env, action, binding, verifiedContentSha }) {
  const reasons = [
    ...(action === "purge-expired"
      ? getUaisStagingInpCleanupGuard(env).reasons
      : getUaisStagingInpGuard(env, verifiedContentSha).reasons),
  ];
  if (!argv.includes("--live")) reasons.push("live-execution-flag-required");
  if (!argv.includes("--approved")) reasons.push("owner-approval-flag-required");
  if (!allowedActions.has(action)) reasons.push("supported-action-required");
  const cohort = readOption(argv, "--cohort") ?? env.UAIS_STAGING_INP_COHORT_ID ?? "";
  if (action !== "purge-expired") {
    if (binding && cohort !== binding.cohortId) reasons.push("cohort-binding-mismatch");
    if (!hasExactImmutableOrigin(env.P2_IMMUTABLE_DEPLOYMENT_URL, binding)) {
      reasons.push("immutable-deployment-url-mismatch");
    }
    if (!hasExactImmutableOrigin(env.UAIS_DEPLOYMENT_BASE_URL, binding)) {
      reasons.push("deployment-base-url-not-exact-immutable-origin");
    }
    if (
      action === "finalize" &&
      readOption(argv, "--confirm-close") !== binding?.cohortId
    ) {
      reasons.push("finalize-confirmation-mismatch");
    }
    if (
      action === "purge" &&
      readOption(argv, "--confirm-purge") !== binding?.cohortId
    ) {
      reasons.push("purge-confirmation-mismatch");
    }
  }
  return [...new Set(reasons)];
}

function hasExactImmutableOrigin(value, binding) {
  if (!value || !binding) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.hostname === binding.deploymentHost &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function evaluateThreshold(groups) {
  const byKey = new Map(
    groups.map((group) => [
      `${group.role}\u0000${group.journey}\u0000${group.viewportClass}`,
      group,
    ]),
  );
  const passingGroups = [...expectedGroups].filter((key) => {
    const group = byKey.get(key);
    return (
      group &&
      Number(group.n) >= minimumSamplesPerGroup &&
      Number(group.distinctOperatorCount) >=
        UAIS_STAGING_INP_MINIMUM_DISTINCT_OPERATORS &&
      Number(group.p75Ms) <= maximumP75Ms
    );
  }).length;
  return {
    requiredGroups: expectedGroups.size,
    observedGroups: groups.length,
    passingGroups,
    minimumSamplesPerGroup,
    minimumDistinctOperatorsPerGroup:
      UAIS_STAGING_INP_MINIMUM_DISTINCT_OPERATORS,
    maximumP75Ms,
    ready: groups.length === expectedGroups.size && passingGroups === expectedGroups.size,
  };
}

function cleanupSummary(purge, readback) {
  const rawSampleRowsRemaining = Number(
    readback?.rawSampleRowsRemaining ?? purge?.rawSampleRowsRemaining ?? -1,
  );
  const rawSampleRowsZero =
    purge?.state === "purged" &&
    purge?.rawSampleRowsZero === true &&
    readback?.state === "purged" &&
    readback?.cohortTombstoneRetained === true &&
    rawSampleRowsRemaining === 0;
  return {
    state: readback?.state ?? purge?.state ?? "unavailable",
    rawSampleRowsDeleted: Number(purge?.rawSampleRowsDeleted ?? 0),
    rawSampleRowsRemaining,
    rawSampleRowsZero,
    cohortTombstoneRetained:
      readback?.cohortTombstoneRetained === true &&
      purge?.cohortTombstoneRetained === true,
  };
}

function createBaseReport({ action, binding }) {
  return {
    target: "uais-staging-inp-lifecycle",
    action: action || "missing",
    evidenceClass:
      action === "purge-expired"
        ? "isolated-staging-expiry-cleanup"
        : "bounded-current-sha-isolated-staging-rum",
    candidateBinding: binding
      ? {
          cohortId: binding.cohortId,
          candidateGitSha: binding.candidateGitSha,
          candidateContentSha: binding.candidateContentSha,
          deploymentHost: binding.deploymentHost,
          collectorKeyVersion: binding.collectorKeyVersion,
          collectorKeyVersionBound: true,
          operatorAllowlistFingerprintBound: true,
        }
      : null,
    productionFieldInpProven: false,
    operatorAttestedOnly: true,
    clientSuppliedValues: true,
    routeServerAttested: true,
    documentContextCompared: true,
    valuesRedacted: true,
    databaseUrlOmitted: true,
    secretValuesOmitted: true,
  };
}

function success(baseReport, details) {
  return { exitCode: 0, report: { ...baseReport, status: "PASS", ...details } };
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const mainModule =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (mainModule) {
  const result = await runP2StagingInpLifecycle();
  process.stdout.write(`${JSON.stringify(result.report)}\n`);
  process.exitCode = result.exitCode;
}
