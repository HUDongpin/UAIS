// HTTP-status-carrying error for the teaching-operations store. Extracted to its
// own zero-dependency module (Phase 3 decomposition) so guards, adapters, and
// cutover code can throw/catch it without importing the ~4.9k-line store — and so
// the store can later split its guard/normalizer clusters without an import cycle.
export class TeachingOperationStoreError extends Error {
  status: number;
  // Stable, machine-readable classification of the failure, surfaced verbatim by
  // the route error bodies. Only set where a client is expected to branch on the
  // reason rather than show the message - snapshot contention today - so an
  // absent code means "the message is the whole answer".
  readonly reasonCode?: string;

  constructor(status: number, message: string, reasonCode?: string) {
    super(message);
    this.name = "TeachingOperationStoreError";
    this.status = status;
    this.reasonCode = reasonCode;
  }
}
