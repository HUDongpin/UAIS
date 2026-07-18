// HTTP-status-carrying error for the teaching-operations store. Extracted to its
// own zero-dependency module (Phase 3 decomposition) so guards, adapters, and
// cutover code can throw/catch it without importing the ~4.9k-line store — and so
// the store can later split its guard/normalizer clusters without an import cycle.
export class TeachingOperationStoreError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TeachingOperationStoreError";
    this.status = status;
  }
}
