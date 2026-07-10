import * as Sentry from "@sentry/nextjs";
import { createUaisSentryInitOptions } from "@/lib/observability/sentry-options";

const sentryOptions = createUaisSentryInitOptions(process.env, "client");

if (sentryOptions) {
  Sentry.init(sentryOptions);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
