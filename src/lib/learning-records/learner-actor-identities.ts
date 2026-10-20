import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";

export type LearningRecordIdentityClientFactory = (input: {
  env: Record<string, string | undefined>;
  max?: number;
}) => {
  pooled?: boolean;
  sql: {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    end: (options?: { timeout?: number }) => Promise<void> | void;
  };
};

// Call only after authorizing the account. Historical statements used the
// account, while the durable outbox uses the private database UUID. Login
// status does not change which identity owns historical learning evidence.
export async function resolveLearningRecordLearnerActorIds(input: {
  account: string;
  env: Record<string, string | undefined>;
  createDatabase?: LearningRecordIdentityClientFactory;
}): Promise<string[]> {
  if (getUaisCoreDatabaseReadiness(input.env).status !== "ready") {
    return [input.account];
  }
  const client = (input.createDatabase ?? getUaisCoreDatabasePool)({ env: input.env, max: 1 });
  try {
    const rows = await client.sql`
      SELECT id::text AS id, account
      FROM uais_users
      WHERE lower(account) = lower(${input.account})
        OR id::text = ${input.account.toLowerCase()}
      LIMIT 3
    `;
    const identities = rows.map((value) => {
      const row = value as { id?: unknown; account?: unknown };
      if (typeof row.id !== "string" || typeof row.account !== "string") {
        throw new Error("Learning record identity is unavailable.");
      }
      return { id: row.id, account: row.account };
    });
    const matching = identities.filter(
      (row) => row.account.toLowerCase() === input.account.toLowerCase(),
    );
    if (matching.length > 1) {
      throw new Error("Learning record identity is ambiguous.");
    }
    const durableId = matching[0]?.id;
    // Account syntax also accepts UUIDs. Do not let a historical account query
    // accidentally retrieve a different user's durable outbox statements.
    const legacyCollision = identities.some(
      (row) => row.id === input.account.toLowerCase() && row.id !== durableId,
    );
    return [...new Set([
      ...(durableId ? [durableId] : []),
      ...(!legacyCollision ? [input.account] : []),
    ])];
  } finally {
    await closeUaisCoreDatabaseClient(client);
  }
}
