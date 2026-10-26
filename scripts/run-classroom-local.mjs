#!/usr/bin/env node
// A self-contained, loopback-only classroom rehearsal. It never consumes a
// runtime database URL or a provider credential from the host or .env files.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { hashAccountPassword } from "./lib/uais-account-provisioning.mjs";

export function createClassroomLocalEnv({ baseEnv, fileEnvNames, databaseUrl, appSecret, teacherSecret, fixturePath }) {
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SHELL"].flatMap(key => baseEnv[key] ? [[key, baseEnv[key]]] : []));
  // Existing empty values prevent Next's dotenv loader from filling them with
  // the owner's real deployment values. Only names are extracted from files.
  for (const key of fileEnvNames) env[key] = "";
  return Object.assign(env, {
    NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    SENTRY_AUTH_TOKEN: "", SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "",
    VERCEL_ENV: "", VERCEL_PROJECT_ID: "", VERCEL_URL: "", UAIS_DEPLOYMENT_ENV: "local",
    UAIS_CORE_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl, POSTGRES_URL: databaseUrl,
    UAIS_APP_AUTH_PROVIDER: "database-accounts", UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH: "",
    UAIS_APP_SESSION_SIGNING_SECRET: appSecret,
    UAIS_TEACHER_AUTH_PROVIDER: "database-account-cookie", UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherSecret,
    UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "postgres", UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
    UAIS_TEACHER_AI_OWNERSHIP_BACKEND: "postgres",
    UAIS_CLASSROOM_FIXTURE_PATH: fixturePath,
  });
}

async function unusedPort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const port = server.address().port;
  await new Promise((ok, fail) => server.close(error => error ? fail(error) : ok()));
  return port;
}
function run(command, args, options = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", fail);
    child.once("exit", code => code === 0 ? ok() : fail(new Error(`${command} exited ${code}`)));
  });
}

async function main() {
  const dev = process.argv.includes("--dev"), serve = process.argv.includes("--serve");
  const soakIndex = process.argv.indexOf("--soak-minutes");
  const soakMinutes = soakIndex < 0 ? 0 : Number(process.argv[soakIndex + 1]);
  if (![0, 90].includes(soakMinutes)) throw new Error("Use --soak-minutes 0 or 90.");
  for (const command of ["initdb", "pg_ctl", "createdb"]) {
    if (spawnSync(command, ["--version"], { stdio: "ignore" }).status !== 0) throw new Error(`Local PostgreSQL ${command} is required.`);
  }
  const root = process.cwd(), runtime = await mkdtemp(join(tmpdir(), "uais-classroom-pilot-"));
  const pgPort = await unusedPort(), appPort = await unusedPort();
  const dataDir = join(runtime, "pg"), fixturePath = join(runtime, "fixture.json");
  const databaseUrl = `postgres://uais_classroom_pilot@127.0.0.1:${pgPort}/uais_classroom_pilot`;
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const teacher = { account: "classroom-pilot-teacher", password: randomBytes(24).toString("base64url") };
  const studentPassword = randomBytes(24).toString("base64url");
  const names = new Set();
  for (const name of (await readdir(root)).filter(name => /^\.env(?:\.|$)/.test(name))) {
    for (const match of (await readFile(join(root, name), "utf8")).matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) names.add(match[1]);
  }
  const env = createClassroomLocalEnv({ baseEnv: process.env, fileEnvNames: [...names], databaseUrl,
    appSecret: randomBytes(32).toString("hex"), teacherSecret: randomBytes(32).toString("hex"), fixturePath });
  env.UAIS_CLASSROOM_BASE_URL = baseUrl;
  if (dev) env.NODE_ENV = "development";
  let app;
  let postgresStarted = false;
  let stop;
  const stopped = new Promise(resolveStopped => { stop = resolveStopped; });
  const onSignal = () => stop();
  process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal);
  try {
    await run("initdb", ["-D", dataDir, "--auth=trust", "--username=uais_classroom_pilot"], { stdio: "ignore" });
    await run("pg_ctl", ["-D", dataDir, "-l", join(runtime, "postgres.log"), "-o", `-h 127.0.0.1 -p ${pgPort} -k ${runtime}`, "start"], { stdio: "ignore" });
    postgresStarted = true;
    await run("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "uais_classroom_pilot", "uais_classroom_pilot"], { stdio: "ignore" });
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`CREATE TABLE uais_environment_guard(environment text PRIMARY KEY,enabled boolean NOT NULL)`;
      await sql`INSERT INTO uais_environment_guard VALUES ('isolated-uais-db-test',true),('isolated-classroom-pilot',true)`;
      await sql`CREATE TABLE uais_schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`;
      for (const file of (await readdir(join(root, "migrations"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
        const source = await readFile(join(root, "migrations", file), "utf8");
        await sql.begin(async tx => { await tx.unsafe(source); await tx`INSERT INTO uais_schema_migrations(version,checksum) VALUES (${file.slice(0, -4)},${createHash("sha256").update(source).digest("hex")})`; });
      }
      await sql`INSERT INTO uais_users(account,password_hash,role,display_name,department,status) VALUES (${teacher.account},${await hashAccountPassword(teacher.password)},'teacher','课堂试用教师','UAIS isolated test','active')`;
    } finally { await sql.end(); }
    await writeFile(fixturePath, JSON.stringify({ baseUrl, databaseUrl, teacher, studentPassword, soakMinutes }), { mode: 0o600 });
    await mkdir(join(root, ".scratch"), { recursive: true });
    await writeFile(join(root, ".scratch", "classroom-active.json"), JSON.stringify({ baseUrl, fixturePath, runtime, localOnly: true }), { mode: 0o600 });
    if (!dev) await run("npm", ["run", "build"], { env });
    console.log(`Classroom isolated runtime: ${baseUrl}; synthetic accounts only; provider credentials disabled.`);
    app = spawn("npm", dev ? ["run", "dev", "--", "--webpack", "--hostname", "127.0.0.1", "--port", String(appPort)] : ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(appPort)], { env, stdio: "inherit", detached: true });
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch { /* Starting. */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 500));
    }
    if (!ready) throw new Error("Isolated classroom server did not become healthy.");
    if (serve) await stopped;
    else await run("npx", ["playwright", "test", "--config=playwright.classroom.config.ts"], { env });
  } finally {
    if (app?.pid) { try { process.kill(-app.pid, "SIGTERM"); } catch { /* Already stopped. */ } }
    if (postgresStarted) await run("pg_ctl", ["-D", dataDir, "-m", "fast", "stop"], { stdio: "ignore" }).catch(() => {});
    process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
    console.log("Classroom test processes stopped; local evidence retained. No remote service was used.");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
