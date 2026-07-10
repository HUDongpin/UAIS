import * as Sentry from "@sentry/nextjs";
import { createUaisSentryInitOptions } from "@/lib/observability/sentry-options";

const sentryOptions = createUaisSentryInitOptions(process.env, "edge");

if (sentryOptions) {
  Sentry.init(sentryOptions);
}
