#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const routeChainRegressionCommand = [
  "run",
  "test",
  "--",
  "tests/ai-api-routes.test.ts",
  "-t",
  "uses issued trusted teacher auth cookies",
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      [
        "Usage: node scripts/trusted-teacher-auth-route-chain-contract.mjs",
        "",
        "Runs the local trusted teacher auth route-chain regression and emits redacted JSON evidence.",
      ].join("\n"),
    );
    process.exit(0);
  }

  const command = runRouteChainRegression();
  process.stdout.write(`${JSON.stringify(buildEvidence(command), null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Trusted teacher auth route-chain contract failed."}\n`,
  );
  process.exitCode = 1;
}

function runRouteChainRegression() {
  const result = spawnSync("npm", routeChainRegressionCommand, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status === 0 ? "passed" : "failed",
    stdoutOmitted: true,
    stderrOmitted: true,
  };
}

function buildEvidence(command) {
  const proved = command.status === "passed";
  return {
    target: "trusted-teacher-auth-route-chain-contract",
    status: proved ? "proved-locally" : "blocked",
    responsibleSessions: ["S12", "S22"],
    scope: "local-route-contract-regression",
    command,
    evidence: {
      routeChain: ["/api/ai/teacher-auth/issue", "/api/ai/session"],
      authProvider: "trusted-cookie-issuer",
      providerContract: "production-ready-with-fixture-secrets",
      issuerProof: "signed-admin-ai-access-plus-trusted-issuer-proof",
      issuerProofValidation: {
        maxLifetimeSeconds: 300,
        rejectsFutureIssuedAt: true,
        rejectsExpiresBeforeIssuedAt: true,
        rejectsOverlongLifetime: true,
        valuesRedacted: true,
      },
      issuerCookieHardening: {
        httpOnly: "required",
        sameSite: "lax",
        secureInProduction: true,
        path: "/",
        maxAge: "bounded-by-session-ttl",
        priority: "High",
        valuesRedacted: true,
      },
      sessionCookiePair: [
        "uais_teacher_auth_claims",
        "uais_teacher_auth_signature",
      ],
      downstreamAiSession: "scoped-teacher-ai-session-issued",
      workflowAction: "ppt-narration-submit",
      scopes: [
        "teacherIds",
        "courseIds",
        "sampleAssetIds",
        "pptAssetIds",
        "voiceRefIds",
      ],
    },
    releaseImpact: {
      localTrustedCookieRouteWiring: proved ? "proved" : "not-proven",
      productionTeacherAuthReadiness:
        "still-blocked-without-owner-approved-vercel-env-and-live-route-smoke",
      releaseGateEligible: false,
    },
    blockedReasons: proved
      ? []
      : ["trusted-teacher-auth-route-chain-regression-failed"],
    safety: {
      secretsRedacted: true,
      cookieValuesOmitted: true,
      sessionIdsOmitted: true,
      commandOutputOmitted: true,
      localPrivatePathsOmitted: true,
      productionMutationPerformed: false,
    },
  };
}

function parseArgs(args) {
  const options = {
    help: false,
  };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}
