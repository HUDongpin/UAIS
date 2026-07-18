import { requireIsoDate, requireSafeId } from "./teaching-operations-guards";
import type {
  TeachingGradebookReleaseProviderReceipt,
  TeachingGradebookReleaseRollbackProviderReceipt,
} from "./teaching-operations-store";

// Provider-receipt normalizers for teaching gradebook release/rollback (Phase 3
// decomposition). Depend only on the guards module at runtime; store types are a
// type-only import (no runtime cycle). Behavior is identical to the previous
// inline definitions.

export function normalizeTeachingGradebookReleaseProviderReceipt(
  input: TeachingGradebookReleaseProviderReceipt,
): TeachingGradebookReleaseProviderReceipt {
  return {
    providerStatus: "gradebook-provider-released",
    providerReleaseId: requireSafeId(input.providerReleaseId, "provider release id"),
    providerReleasedAt: requireIsoDate(input.providerReleasedAt, "providerReleasedAt"),
  };
}

export function normalizeTeachingGradebookReleaseRollbackProviderReceipt(
  input: TeachingGradebookReleaseRollbackProviderReceipt,
): TeachingGradebookReleaseRollbackProviderReceipt {
  return {
    providerRollbackStatus: "gradebook-provider-release-rolled-back",
    providerRollbackId: requireSafeId(input.providerRollbackId, "provider rollback id"),
    providerRolledBackAt: requireIsoDate(input.providerRolledBackAt, "providerRolledBackAt"),
  };
}
