"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import {
  classifyUaisStagingInpJourney,
  parseUaisStagingInpPayload,
  type UaisStagingInpViewportClass,
} from "@/lib/observability/uais-staging-inp";

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];

export function UaisStagingInpReporter({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  // RootLayout survives App Router transitions. Capture the hard-load bucket
  // once so a later route cannot relabel an earlier interaction. The callback
  // also checks the current bucket before sending and discards cross-journey
  // samples instead of mixing two journeys into one INP value.
  const initialJourney = useRef(
    typeof window === "undefined"
      ? null
      : classifyUaisStagingInpJourney(window.location.pathname),
  );
  const initialViewportClass = useRef<UaisStagingInpViewportClass>(
    readInitialViewportClass(),
  );
  const lifecycleTainted = useRef(false);

  useEffect(() => {
    const hardLoadJourney = initialJourney.current;
    if (
      lifecycleTainted.current ||
      !hardLoadJourney ||
      !pathname ||
      classifyUaisStagingInpJourney(pathname) !== hardLoadJourney
    ) {
      // This flag is intentionally monotonic. Web Vitals can publish the final
      // INP after the user returns to the hard-load route, but that value may
      // include an interaction from the intervening journey. It is no longer a
      // valid sample for either journey and must stay ineligible.
      lifecycleTainted.current = true;
    }
  }, [pathname]);

  const report = useCallback<ReportWebVitalsCallback>(
    (metric) => {
      const hardLoadJourney = initialJourney.current;
      if (
        !enabled ||
        lifecycleTainted.current ||
        metric.name !== "INP" ||
        !hardLoadJourney ||
        typeof window === "undefined" ||
        classifyUaisStagingInpJourney(window.location.pathname) !== hardLoadJourney
      ) {
        return;
      }

      // Parse the locally constructed body through the same exact-key contract
      // as the server. No URL, account, DOM entry/target, or arbitrary metric
      // field can cross this boundary.
      const payload = parseUaisStagingInpPayload({
        id: metric.id,
        journey: hardLoadJourney,
        viewportClass: initialViewportClass.current,
        navigationType: metric.navigationType,
        valueMs: Math.round(metric.value),
      });
      if (!payload) return;

      void fetch("/api/observability/staging-inp", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => undefined);
    },
    [enabled],
  );

  useReportWebVitals(report);
  return null;
}

function readInitialViewportClass(): UaisStagingInpViewportClass {
  if (typeof window === "undefined") return "wide";
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(max-width: 767px)").matches ? "compact" : "wide";
  }
  return window.innerWidth <= 767 ? "compact" : "wide";
}
