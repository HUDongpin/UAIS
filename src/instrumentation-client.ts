import * as Sentry from "@sentry/nextjs";
import { createUaisSentryInitOptions } from "@/lib/observability/sentry-options";

// Every entry below must be a STATIC `process.env.X` member access.
//
// The bundler replaces those expressions textually at build time; it cannot
// replace a whole `process.env` object passed by reference. The previous
// `createUaisSentryInitOptions(process.env, "client")` therefore compiled to a
// lookup on an effectively empty object in the browser, so client-side Sentry
// never booted - silently, and even on a deployment that had set
// NEXT_PUBLIC_SENTRY_DSN correctly. Server and edge keep passing `process.env`
// directly because a real `process.env` exists in those runtimes.
//
// The server-only names are listed on purpose. Next inlines only NEXT_PUBLIC_*
// and NODE_ENV into a client bundle, so the rest resolve to `undefined` here -
// which is the wanted outcome: the options builder falls back exactly as it
// does when they are unset, and no server-only value can be leaked into the
// browser by adding a name to this list.
const clientSentryEnv = {
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
  SENTRY_RELEASE: process.env.SENTRY_RELEASE,
  SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
  SENTRY_ENABLE_LOGS: process.env.SENTRY_ENABLE_LOGS,
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  NODE_ENV: process.env.NODE_ENV,
};

const sentryOptions = createUaisSentryInitOptions(clientSentryEnv, "client");

if (sentryOptions) {
  Sentry.init(sentryOptions);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
