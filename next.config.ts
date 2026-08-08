import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  // The transcript PDF route embeds a CJK font read from disk at request time.
  // Next's tracer follows imports, not `process.cwd()`-relative reads, so the
  // file has to be named here or the deployed function would 500 on a missing
  // font while every local run passed. Only the font is included - the licence
  // and provenance files beside it are for the repository, not the runtime.
  outputFileTracingIncludes: {
    "/learning/chatroom/export/pdf": ["./public/fonts/NotoSansSC-GB2312-Regular.ttf"],
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
