#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const localAppPort = 3110;
const localStoragePort = 3111;
const localBaseUrl = `http://127.0.0.1:${localAppPort}`;
const localStorageBaseUrl = `http://127.0.0.1:${localStoragePort}`;
const scratchDir = resolve(process.cwd(), ".tmp", "p2-performance");
const productionHostnames = new Set(["uais.top", "www.uais.top", "uais.vercel.app"]);
const allPages = ["/login", "/courses", "/learning", "/learning/chatroom", "/teaching"];
const budgets = {
  lighthousePerformanceMinimum: 85,
  largestContentfulPaintMillisecondsMaximum: 2_500,
  cumulativeLayoutShiftMaximum: 0.1,
  totalBlockingTimeMillisecondsMaximum: 200,
};
const options = parseArgs(process.argv.slice(2));
const pages = options.page ? [options.page] : allPages;
const target = resolveTarget(process.env);

if (target.productionRejected) {
  emit({
    status: "FAIL",
    mode: options.dryRun ? "dry-run" : "execute",
    networkUsed: false,
    blockedReasons: ["production-hostname-rejected"],
  }, 1);
} else if (target.blockedReasons.length > 0) {
  emit({
    status: "BLOCKED_ENV",
    mode: options.dryRun ? "dry-run" : "execute",
    networkUsed: false,
    blockedReasons: target.blockedReasons,
  }, 2);
} else if (options.dryRun) {
  emit({
    status: "NOT_RUN",
    mode: "dry-run",
    networkUsed: false,
    blockedReasons: [],
  }, 0);
} else {
  const executionBlockers = target.kind === "local"
    ? existsSync(resolve(process.cwd(), ".next", "BUILD_ID"))
      ? []
      : ["production-build-required"]
    : [
        ...(process.env.P2_PERFORMANCE_STUDENT_COOKIE?.trim()
          ? []
          : ["missing-P2_PERFORMANCE_STUDENT_COOKIE"]),
        ...(process.env.P2_PERFORMANCE_TEACHER_COOKIE?.trim()
          ? []
          : ["missing-P2_PERFORMANCE_TEACHER_COOKIE"]),
      ];

  if (executionBlockers.length > 0) {
    emit({
      status: "BLOCKED_ENV",
      mode: "execute",
      networkUsed: false,
      blockedReasons: executionBlockers,
    }, 2);
  } else {
    await executePerformanceRun().catch((error) => {
      emit({
        status: "FAIL",
        mode: "execute",
        networkUsed: false,
        blockedReasons: [safeFailureCode(error)],
      }, 1);
    });
  }
}

async function executePerformanceRun() {
  await rm(scratchDir, { recursive: true, force: true });
  await mkdir(scratchDir, { recursive: true });

  let localRuntime;
  try {
    if (target.kind === "local") {
      localRuntime = await startLocalProductionRuntime();
    }
    const cookieHeaders = target.kind === "local"
      ? createLocalFixtureCookieHeaders()
      : {
          student: process.env.P2_PERFORMANCE_STUDENT_COOKIE.trim(),
          teacher: process.env.P2_PERFORMANCE_TEACHER_COOKIE.trim(),
        };
    const headerFiles = await createHeaderFiles(cookieHeaders);
    const results = [];

    for (const page of pages) {
      const identity = page === "/login" ? "public" : page === "/teaching" ? "teacher" : "student";
      results.push(
        await runLighthouseAudit({
          page,
          identity,
          headerPath: identity === "public" ? undefined : headerFiles[identity],
        }),
      );
    }

    const passed = results.every((result) => result.status === "PASS");
    emit({
      status: passed ? "PASS" : "FAIL",
      mode: "execute",
      networkUsed: true,
      blockedReasons: [],
      results,
    }, passed ? 0 : 1);
  } finally {
    await stopLocalProductionRuntime(localRuntime);
    await rm(scratchDir, { recursive: true, force: true });
  }
}

async function runLighthouseAudit({ page, identity, headerPath }) {
  const reportName = page === "/" ? "root" : page.slice(1).replaceAll("/", "-");
  const reportPath = join(scratchDir, `${reportName}.json`);
  const args = [
    "node_modules/lighthouse/cli/index.js",
    new URL(page, target.baseUrl).toString(),
    "--only-categories=performance",
    "--preset=desktop",
    "--output=json",
    `--output-path=${reportPath}`,
    "--quiet",
    "--disable-full-page-screenshot",
    "--max-wait-for-load=45000",
    "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage",
    ...(headerPath ? [`--extra-headers=${headerPath}`] : []),
  ];
  await runChild({
    display: `Lighthouse ${page}`,
    executable: process.execPath,
    args,
    env: {
      ...process.env,
      CHROME_PATH: chromium.executablePath(),
      LIGHTHOUSE_SKIP_ERROR_REPORTING: "1",
    },
    timeoutMs: 120_000,
  });

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const metrics = {
    lighthousePerformance: Math.round((report.categories?.performance?.score ?? 0) * 100),
    largestContentfulPaintMilliseconds: readNumericAudit(report, "largest-contentful-paint"),
    cumulativeLayoutShift: readNumericAudit(report, "cumulative-layout-shift"),
    totalBlockingTimeMilliseconds: readNumericAudit(report, "total-blocking-time"),
  };
  const failures = [
    ...(metrics.lighthousePerformance >= budgets.lighthousePerformanceMinimum
      ? []
      : ["lighthouse-performance-below-budget"]),
    ...(metrics.largestContentfulPaintMilliseconds <= budgets.largestContentfulPaintMillisecondsMaximum
      ? []
      : ["largest-contentful-paint-above-budget"]),
    ...(metrics.cumulativeLayoutShift <= budgets.cumulativeLayoutShiftMaximum
      ? []
      : ["cumulative-layout-shift-above-budget"]),
    ...(metrics.totalBlockingTimeMilliseconds <= budgets.totalBlockingTimeMillisecondsMaximum
      ? []
      : ["total-blocking-time-above-budget"]),
  ];

  return {
    page,
    identity,
    status: failures.length === 0 ? "PASS" : "FAIL",
    metrics,
    failures,
    inpP75: {
      status: "NOT_RUN",
      reason: "field-or-repeated-interaction-evidence-required",
    },
  };
}

async function startLocalProductionRuntime() {
  const { createP2TeachingFixtureDatabase } = await import(
    "../tests/p2/browser/fixture-data.ts"
  );
  const externalStorageDataDir = join(scratchDir, "external-storage");
  const databasePath = join(
    externalStorageDataDir,
    "teaching-course-management",
    "database.json",
  );
  await mkdir(dirname(databasePath), { recursive: true });
  await writeFile(
    databasePath,
    `${JSON.stringify(createP2TeachingFixtureDatabase(), null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );

  const externalStorageAccessToken =
    "p2-local-performance-external-storage-token-fixture";
  const databaseAdapterEnv = {
    UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS: "managed-database",
    UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS: "up-to-date",
    UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY: "point-in-time-restore",
    UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL: "transactional",
  };
  const storage = spawn(process.execPath, [
    "scripts/external-storage-service.mjs",
    "--host",
    "127.0.0.1",
    "--port",
    String(localStoragePort),
    "--data-dir",
    externalStorageDataDir,
    "--service-mode",
    "production",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...databaseAdapterEnv,
      UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
    },
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
  });
  const runtime = { storage, app: undefined };

  try {
    await waitForUrl(`${localStorageBaseUrl}/healthz`, 20_000);
    runtime.app = spawn("npm", [
      "run",
      "start",
      "--",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(localAppPort),
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UAIS_DEPLOYMENT_ENV: "local-production",
        UAIS_APP_SESSION_SIGNING_SECRET:
          "p2-fixture-only-app-session-signing-secret",
        UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET:
          "p2-fixture-only-teacher-signing-secret",
        UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: localStorageBaseUrl,
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: externalStorageAccessToken,
        UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
      },
      stdio: ["ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
    });
    await waitForUrl(`${localBaseUrl}/login`, 30_000);
    return runtime;
  } catch (error) {
    await stopLocalProductionRuntime(runtime);
    throw error;
  }
}

async function stopLocalProductionRuntime(runtime) {
  if (!runtime) return;
  await Promise.all([
    terminate(runtime.app),
    terminate(runtime.storage),
  ]);
}

async function createHeaderFiles(cookieHeaders) {
  const student = join(scratchDir, "headers-student.json");
  const teacher = join(scratchDir, "headers-teacher.json");
  await Promise.all([
    writeFile(student, JSON.stringify({ Cookie: cookieHeaders.student }), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }),
    writeFile(teacher, JSON.stringify({ Cookie: cookieHeaders.teacher }), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }),
  ]);
  return { student, teacher };
}

function createLocalFixtureCookieHeaders() {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
  const authenticatedAt = now.toISOString();
  const appSecret = "p2-fixture-only-app-session-signing-secret";
  const teacherSecret = "p2-fixture-only-teacher-signing-secret";
  const studentClaims = encodeClaims({
    account: "p2-student-a",
    role: "student",
    displayName: "P2 Student A",
    department: "P2 Students",
    sessionId: "p2-performance-student",
    authenticatedAt,
    expiresAt,
  });
  const teacherClaims = encodeClaims({
    account: "p2-teacher-a",
    role: "teacher",
    displayName: "P2 Teacher A",
    department: "P2 Teachers",
    sessionId: "p2-performance-teacher",
    authenticatedAt,
    expiresAt,
  });
  const teacherAuthClaims = encodeClaims({
    sessionId: "p2-performance-teacher",
    actorId: "p2-teacher-a",
    role: "teacher",
    authenticatedAt,
    expiresAt,
  });
  return {
    student: [
      `uais_app_session=${studentClaims}`,
      `uais_app_session_signature=${signClaims(studentClaims, appSecret)}`,
    ].join("; "),
    teacher: [
      `uais_app_session=${teacherClaims}`,
      `uais_app_session_signature=${signClaims(teacherClaims, appSecret)}`,
      `uais_teacher_auth_claims=${teacherAuthClaims}`,
      `uais_teacher_auth_signature=${signClaims(teacherAuthClaims, teacherSecret)}`,
    ].join("; "),
  };
}

function resolveTarget(env) {
  const configured = env.P2_PERFORMANCE_BASE_URL?.trim();
  if (!configured) {
    return {
      kind: "local",
      baseUrl: localBaseUrl,
      hostname: "127.0.0.1",
      productionRejected: false,
      blockedReasons: [],
    };
  }

  let url;
  try {
    url = new URL(configured);
  } catch {
    return {
      kind: "staging",
      baseUrl: configured,
      hostname: "invalid",
      productionRejected: false,
      blockedReasons: ["invalid-P2_PERFORMANCE_BASE_URL"],
    };
  }
  const hostname = url.hostname.toLowerCase();
  const productionRejected = isProductionHostname(hostname);
  const allowlist = new Set(
    (env.P2_PERFORMANCE_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const blockedReasons = [
    ...(url.protocol === "https:" ? [] : ["staging-target-must-use-https"]),
    ...(env.P2_PERFORMANCE_CONFIRM === "staging"
      ? []
      : ["missing-P2_PERFORMANCE_CONFIRM"]),
    ...(allowlist.size > 0 ? [] : ["missing-P2_PERFORMANCE_ALLOWLIST"]),
    ...(allowlist.has(hostname) ? [] : ["hostname-not-allowlisted"]),
  ];
  return {
    kind: "staging",
    baseUrl: url.toString(),
    hostname,
    productionRejected,
    blockedReasons,
  };
}

function emit(payload, exitCode) {
  const report = {
    target: "p2-performance",
    status: payload.status,
    mode: payload.mode,
    targetKind: target.kind,
    targetHostname: target.kind === "local" ? "loopback" : "allowlisted-staging-host",
    networkUsed: payload.networkUsed,
    pages,
    budgets,
    inpP75Gate: "field-or-repeated-interaction-evidence-required",
    blockedReasons: payload.blockedReasons,
    ...(payload.results ? { results: payload.results } : {}),
    safety: {
      productionTargetsRejected: true,
      stagingConfirmationRequired: true,
      credentialValuesOmitted: true,
      temporaryHeaderFilesMode0600: true,
      rawReportsRemovedAfterSummary: true,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCode;
}

function parseArgs(args) {
  const options = { dryRun: false, page: undefined };
  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--page=")) {
      const page = arg.slice("--page=".length);
      if (!allPages.includes(page)) {
        throw new Error("P2 performance page must be one of the fixed core paths.");
      }
      options.page = page;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: node scripts/p2-performance-test.mjs [--dry-run] [--page=/login]. Set P2_PERFORMANCE_BASE_URL, P2_PERFORMANCE_ALLOWLIST, and P2_PERFORMANCE_CONFIRM=staging only for isolated staging.\n",
      );
      process.exit(0);
    } else {
      throw new Error("Unknown P2 performance option; value omitted.");
    }
  }
  return options;
}

function readNumericAudit(report, id) {
  const value = report.audits?.[id]?.numericValue;
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function encodeClaims(claims) {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

function signClaims(claims, secret) {
  return createHmac("sha256", secret).update(claims).digest("base64url");
}

function isProductionHostname(hostname) {
  return productionHostnames.has(hostname) ||
    (hostname.endsWith(".uais.top") && hostname !== "staging.uais.top");
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "unreachable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      lastStatus = String(response.status);
      if (response.status < 500) return;
    } catch (error) {
      lastStatus = error instanceof Error ? error.name : "request-failed";
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`runtime-readiness-timeout-${lastStatus}`);
}

function runChild({ display, executable, args, env, timeoutMs }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
      detached: process.platform !== "win32",
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000);
    });
    const timer = setTimeout(() => {
      void terminate(child);
      rejectPromise(new Error(`${display}-timeout`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${display}-exit-${code ?? "unknown"}-${safeText(stderr)}`));
    });
  });
}

function terminate(child) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, 3_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  });
}

function safeFailureCode(error) {
  const text = error instanceof Error ? error.message : "p2-performance-run-failed";
  return safeText(text).slice(0, 240) || "p2-performance-run-failed";
}

function safeText(value) {
  return String(value)
    .replaceAll(/https?:\/\/\S+/g, "<url>")
    .replaceAll(/(?:cookie|authorization|token|secret|password)[^\s]*/gi, "<redacted>")
    .replaceAll(/[\r\n]+/g, "-")
    .replaceAll(/[^a-zA-Z0-9_.<>-]+/g, "-");
}
