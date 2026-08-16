import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  // Next's tracer follows imports, not `process.cwd()`-relative reads, so every
  // route that opens a file from `public/` at request time has to name it here
  // or the deployed function 500s / 404s on a missing file while every local
  // run passes - `next start` serves the real repository directory, Vercel
  // serves only what was traced.
  outputFileTracingIncludes: {
    // The transcript PDF route embeds a CJK font read from disk. Only the font
    // is included - the licence and provenance files beside it are for the
    // repository, not the runtime.
    "/learning/chatroom/export/pdf": ["./public/fonts/NotoSansSC-GB2312-Regular.ttf"],
    // Narration audio is streamed by `readFile(join(process.cwd(), "public",
    // ...))` in the playback audio route, which is the same failure mode the
    // font entry above already documents. Without this every slide's audio
    // 404s on Vercel even though `next start` passes locally. Slide images are
    // NOT listed: they are requested by the browser straight from `public/` and
    // are served as static assets, never read inside a function.
    "/api/learning/ppt-playback/audio/[manifestId]/[audioId]": [
      "./public/learning/ppt-playback/audio/**/*",
      // The audio route resolves the deck through the same catalog as the
      // manifest route, so it needs the published deck files too.
      "./data/learning-ppt-playback/**/*.json",
    ],
    // Published deck manifests are read with `readdirSync`/`readFileSync` from a
    // cwd-relative directory, which the tracer cannot follow any more than it
    // could follow the font or the narration audio.
    "/api/learning/ppt-playback/[courseId]": ["./data/learning-ppt-playback/**/*.json"],
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
