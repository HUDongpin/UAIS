export type UaisProductionDatabaseAdapterEvidence = {
  status: "ready";
  providerClass: "managed-database";
  migrationStatus: "up-to-date";
  backupPolicy: "point-in-time-restore";
  concurrencyControl: "transactional";
  valueRedacted: true;
};

export function isUaisProductionDatabaseAdapterEvidence(
  value: unknown,
): value is UaisProductionDatabaseAdapterEvidence {
  return (
    isRecord(value) &&
    value.status === "ready" &&
    value.providerClass === "managed-database" &&
    value.migrationStatus === "up-to-date" &&
    value.backupPolicy === "point-in-time-restore" &&
    value.concurrencyControl === "transactional" &&
    value.valueRedacted === true
  );
}

export function isUaisProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
