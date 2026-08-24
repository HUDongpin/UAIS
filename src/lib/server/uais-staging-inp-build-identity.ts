/**
 * Next replaces this direct reference with the digest computed by next.config
 * from the deployable source allowlist. Runtime environment values cannot
 * silently relabel a different uploaded artifact after the build completes.
 */
export const UAIS_COMPILED_STAGING_CONTENT_SHA =
  process.env.UAIS_STAGING_BUILD_CONTENT_SHA ?? "";
