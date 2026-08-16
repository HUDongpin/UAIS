// HTTP-status-carrying error for the teaching-course-management store. Extracted to
// its own zero-dependency module (Phase 3 decomposition) so guards, normalizers,
// and adapters can throw/catch it without importing the ~6.7k-line store — and so
// the store can split its guard/normalizer clusters without an import cycle.
export class TeachingCourseManagementStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly diagnostics?: Record<string, unknown>,
    // Stable, machine-readable classification of the failure, surfaced verbatim
    // by the route error bodies. Only set where a client is expected to branch
    // on the reason rather than show the message - snapshot contention today -
    // so an absent code means "the message is the whole answer".
    readonly reasonCode?: string,
  ) {
    super(message);
  }
}
