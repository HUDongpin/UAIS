// HTTP-status-carrying error for the teaching-course-assets store. Extracted to
// its own zero-dependency module for the same reason the course-management one
// was: the write-retry policy has to throw and recognise it, and importing the
// store from the policy module - which the store itself imports - would be a
// cycle.
//
// `TeachingCourseAssetsStoreError` is still re-exported from the store, so every
// existing importer and every `instanceof` check is unchanged.
export class TeachingCourseAssetsStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // Stable, machine-readable classification, surfaced verbatim by the route
    // error bodies and matching the course-management/teaching-operations
    // contract. Only set where a client is expected to branch on the reason
    // rather than show the message - snapshot contention today - so an absent
    // code means "the message is the whole answer".
    readonly reasonCode?: string,
  ) {
    super(message);
  }
}

export function isTeachingCourseAssetsOptimisticSnapshotConflict(error: unknown) {
  return error instanceof TeachingCourseAssetsStoreError && error.status === 409;
}
