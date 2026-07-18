// HTTP-status-carrying error for the external-storage route service. Extracted to
// its own zero-dependency module (Phase 3 decomposition) so the service's guard,
// normalizer, and handler clusters can throw/catch it without importing the
// ~4.1k-line service — and so those clusters can split out without an import cycle.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
