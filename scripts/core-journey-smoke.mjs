#!/usr/bin/env node
// Phase 4 core-journey E2E smoke.
//
// Automates the real user journeys end-to-end over HTTP against a running UAIS
// instance (local dev, preview, staging, or production): the auth gate, login +
// session issuance, authenticated access to the core routes, forged-cookie
// rejection (the Phase 2 proxy hardening), and sign-out. This is the runnable
// counterpart to a manual browser walkthrough and is the intended gate for the
// staging -> production promotion lane.
//
// Usage:
//   node scripts/core-journey-smoke.mjs --base-url http://localhost:3000
//   UAIS_SMOKE_BASE_URL=https://staging.uais.top \
//     UAIS_SMOKE_ACCOUNT=... UAIS_SMOKE_PASSWORD=... node scripts/core-journey-smoke.mjs
//
// The demo account (Phoebe) only authenticates outside production; against a
// deployed target pass a real test account via UAIS_SMOKE_ACCOUNT/PASSWORD.
// Secrets are never printed — only journey names, statuses, and redirect paths.

const SESSION_COOKIE = "uais_app_session";
const SIGNATURE_COOKIE = "uais_app_session_signature";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
      args[key] = value;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = (
  args["base-url"] ??
  process.env.UAIS_SMOKE_BASE_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");
const account = process.env.UAIS_SMOKE_ACCOUNT ?? "Phoebe";
const password = process.env.UAIS_SMOKE_PASSWORD ?? "12345";

// Forged-cookie rejection only applies where the proxy is configured to verify
// signatures (UAIS_APP_SESSION_SIGNING_SECRET set — every deployed target). On a
// local target without it, the proxy intentionally uses the optimistic cookie-
// pair fallback (see app-proxy-auth.test.ts), so the check is skipped there.
// Default: on for remote hosts, off for localhost; override with --signed-gate.
let smokeHost = "";
try {
  smokeHost = new URL(baseUrl).hostname;
} catch {
  smokeHost = "";
}
const isLocalTarget = ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(smokeHost);
const signedGate =
  args["signed-gate"] !== undefined
    ? args["signed-gate"] === "true"
    : process.env.UAIS_SMOKE_SIGNED_GATE !== undefined
      ? process.env.UAIS_SMOKE_SIGNED_GATE === "1"
      : !isLocalTarget;

const results = [];
function record(name, ok, detail, options = {}) {
  results.push({ name, ok, detail, skipped: Boolean(options.skipped) });
  const mark = options.skipped ? "SKIP" : ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function isRedirectToLogin(response) {
  if (response.status < 300 || response.status >= 400) return false;
  const location = response.headers.get("location") ?? "";
  return location.includes("/login");
}

function extractSessionCookies(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  const pairs = {};
  for (const cookie of setCookies) {
    const [nameValue] = cookie.split(";");
    const eq = nameValue.indexOf("=");
    if (eq <= 0) continue;
    const name = nameValue.slice(0, eq).trim();
    const value = nameValue.slice(eq + 1).trim();
    if (name === SESSION_COOKIE || name === SIGNATURE_COOKIE) {
      pairs[name] = value;
    }
  }
  return pairs;
}

async function run() {
  console.log(`UAIS core-journey smoke → ${baseUrl}`);

  // Journey 1: auth gate — unauthenticated protected route redirects to /login.
  try {
    const gate = await fetch(`${baseUrl}/teaching`, { redirect: "manual" });
    record(
      "auth-gate: unauthenticated /teaching redirects to /login",
      isRedirectToLogin(gate),
      `status ${gate.status} -> ${gate.headers.get("location") ?? "(no location)"}`,
    );
  } catch (error) {
    record("auth-gate: unauthenticated /teaching redirects to /login", false, String(error));
  }

  // Journey 2: login issues a signed session cookie pair (and reports the role).
  let cookieHeader = "";
  let loggedInRole = "";
  try {
    const login = await fetch(`${baseUrl}/api/auth/app-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account, password }),
      redirect: "manual",
    });
    const cookies = extractSessionCookies(login);
    const body = await login.json().catch(() => ({}));
    loggedInRole = body?.appSession?.actor?.role ?? "";
    const ok =
      login.status === 200 &&
      Boolean(cookies[SESSION_COOKIE]) &&
      Boolean(cookies[SIGNATURE_COOKIE]);
    if (ok) {
      cookieHeader = `${SESSION_COOKIE}=${cookies[SESSION_COOKIE]}; ${SIGNATURE_COOKIE}=${cookies[SIGNATURE_COOKIE]}`;
    }
    record(
      "login: POST /api/auth/app-session issues session cookies",
      ok,
      `status ${login.status}${ok ? ` + signed cookie pair (role ${loggedInRole || "?"})` : ""}`,
    );
  } catch (error) {
    record("login: POST /api/auth/app-session issues session cookies", false, String(error));
  }

  // Journey 3: authenticated access to the role-appropriate core routes.
  const isStudent = loggedInRole === "student";
  const ownRoleRoute = isStudent ? "/student-dashboard" : "/teaching";
  const crossRoleRoute = isStudent ? "/teaching" : "/student-dashboard";
  if (cookieHeader) {
    for (const path of ["/courses", "/learning", ownRoleRoute]) {
      try {
        const res = await fetch(`${baseUrl}${path}`, {
          headers: { cookie: cookieHeader },
          redirect: "manual",
        });
        record(`authenticated GET ${path} -> 200`, res.status === 200, `status ${res.status}`);
      } catch (error) {
        record(`authenticated GET ${path} -> 200`, false, String(error));
      }
    }

    // Journey 3b: role isolation — the session must NOT reach the other role's
    // route; the proxy redirects it away (never 200). Ties the Phase 2 auth
    // hardening into the promotion gate.
    try {
      const crossRole = await fetch(`${baseUrl}${crossRoleRoute}`, {
        headers: { cookie: cookieHeader },
        redirect: "manual",
      });
      const location = crossRole.headers.get("location") ?? "";
      const denied =
        crossRole.status >= 300 && crossRole.status < 400 && !location.includes(crossRoleRoute);
      record(
        `role isolation: ${loggedInRole || "session"} is denied ${crossRoleRoute}`,
        denied,
        `status ${crossRole.status} -> ${location || "(no location)"}`,
      );
    } catch (error) {
      record(`role isolation: session is denied ${crossRoleRoute}`, false, String(error));
    }
  } else {
    record("authenticated core-route access", false, "skipped — no session cookie");
  }

  // Journey 4: forged-cookie rejection (Phase 2 proxy hardening). A cookie pair
  // with a valid name but an invalid signature must NOT be treated as logged in
  // on any target that verifies signatures (every deployed environment).
  if (!signedGate) {
    record(
      "forged-cookie rejection: invalid signature redirects to /login",
      true,
      "skipped — local target has no signing secret; optimistic fallback is intentional here",
      { skipped: true },
    );
  } else {
    try {
      const forgedClaims = Buffer.from(
        JSON.stringify({
          account: "attacker",
          role: "teacher",
          displayName: "attacker",
          department: "x",
          sessionId: "forged",
          authenticatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
        "utf8",
      ).toString("base64url");
      const forged = await fetch(`${baseUrl}/teaching`, {
        headers: { cookie: `${SESSION_COOKIE}=${forgedClaims}; ${SIGNATURE_COOKIE}=invalidsignature` },
        redirect: "manual",
      });
      record(
        "forged-cookie rejection: invalid signature redirects to /login",
        isRedirectToLogin(forged),
        `status ${forged.status} -> ${forged.headers.get("location") ?? "(no location)"}`,
      );
    } catch (error) {
      record("forged-cookie rejection: invalid signature redirects to /login", false, String(error));
    }
  }

  // Journey 5: sign-out clears the session.
  try {
    const signOut = await fetch(`${baseUrl}/api/auth/app-session`, {
      method: "DELETE",
      redirect: "manual",
    });
    record("sign-out: DELETE /api/auth/app-session -> 200", signOut.status === 200, `status ${signOut.status}`);
  } catch (error) {
    record("sign-out: DELETE /api/auth/app-session -> 200", false, String(error));
  }

  const failures = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const passed = results.filter((r) => r.ok && !r.skipped);
  console.log(
    `\n${passed.length} passed, ${failures.length} failed, ${skipped.length} skipped ` +
      `(of ${results.length}).` +
      (failures.length ? "" : " All required journeys green."),
  );
  process.exit(failures.length ? 1 : 0);
}

run().catch((error) => {
  console.error("core-journey smoke crashed:", error);
  process.exit(1);
});
