const databaseUrl = process.env.UAIS_CORE_DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error(
    "BLOCKED_ENV: test:external requires an isolated UAIS_CORE_DATABASE_URL; no external test was started.",
  );
}

let databaseHost = "";
try {
  databaseHost = new URL(databaseUrl).hostname.toLowerCase();
} catch {
  throw new Error(
    "BLOCKED_ENV: UAIS_CORE_DATABASE_URL is invalid; its value was omitted.",
  );
}

const productionHosts = new Set(
  (process.env.P2_PRODUCTION_DATABASE_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

if (productionHosts.has(databaseHost)) {
  throw new Error(
    "BLOCKED_ENV: test:external rejected a production database hostname; its value was omitted.",
  );
}

if (process.env.P2_EXTERNAL_CONFIRM !== "isolated-database") {
  throw new Error(
    "BLOCKED_ENV: set P2_EXTERNAL_CONFIRM=isolated-database only after proving database isolation.",
  );
}
