import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

export const UAIS_CORE_DATABASE_ENV_NAMES = [
  "UAIS_CORE_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
] as const;

export type UaisCoreDatabaseEnvName = (typeof UAIS_CORE_DATABASE_ENV_NAMES)[number];

export type UaisCoreDatabaseReadiness =
  | {
      target: "uais-core-database";
      status: "ready";
      providerClass: "managed-postgres";
      selectedEnvName: UaisCoreDatabaseEnvName;
      migrations: ["0001_core_poc"];
      valueRedacted: true;
    }
  | {
      target: "uais-core-database";
      status: "blocked";
      blockedReason: "missing-managed-postgres-url";
      acceptedEnvNames: readonly UaisCoreDatabaseEnvName[];
      valueRedacted: true;
    };

export function getUaisCoreDatabaseReadiness(
  env: Record<string, string | undefined>,
): UaisCoreDatabaseReadiness {
  const selectedEnvName = readSelectedDatabaseEnvName(env);
  if (!selectedEnvName) {
    return {
      target: "uais-core-database",
      status: "blocked",
      blockedReason: "missing-managed-postgres-url",
      acceptedEnvNames: UAIS_CORE_DATABASE_ENV_NAMES,
      valueRedacted: true,
    };
  }

  return {
    target: "uais-core-database",
    status: "ready",
    providerClass: "managed-postgres",
    selectedEnvName,
    migrations: ["0001_core_poc"],
    valueRedacted: true,
  };
}

export function createUaisCoreDatabase(input: {
  env: Record<string, string | undefined>;
  prepare?: boolean;
  max?: number;
}) {
  const databaseUrl = readSelectedDatabaseUrl(input.env);
  if (!databaseUrl) {
    throw new Error("UAIS core database URL is required for the Postgres adapter.");
  }

  const sql = postgres(databaseUrl, {
    max: input.max ?? 5,
    prepare: input.prepare ?? false,
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    readiness: getUaisCoreDatabaseReadiness(input.env),
    redaction: {
      databaseUrl: "omitted" as const,
      credentials: "omitted" as const,
    },
  };
}

export function readUaisCoreDatabaseUrl(env: Record<string, string | undefined>) {
  return readSelectedDatabaseUrl(env);
}

function readSelectedDatabaseEnvName(
  env: Record<string, string | undefined>,
): UaisCoreDatabaseEnvName | undefined {
  return UAIS_CORE_DATABASE_ENV_NAMES.find((name) => hasValue(env[name]));
}

function readSelectedDatabaseUrl(env: Record<string, string | undefined>) {
  const selectedEnvName = readSelectedDatabaseEnvName(env);
  return selectedEnvName ? env[selectedEnvName]?.trim() : undefined;
}

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim() !== "";
}
