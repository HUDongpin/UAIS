// HTTP-status-carrying error for the teaching-course-management store. Extracted to
// its own zero-dependency module (Phase 3 decomposition) so guards, normalizers,
// and adapters can throw/catch it without importing the ~6.7k-line store — and so
// the store can split its guard/normalizer clusters without an import cycle.
export class TeachingCourseManagementStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly diagnostics?: Record<string, unknown>,
  ) {
    super(message);
  }
}
