import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UaisStagingInpReporter } from "@/components/observability/uais-staging-inp-reporter";

type Metric = {
  id: string;
  name: string;
  value: number;
  navigationType: string;
  entries: unknown[];
};

let reportMetric: ((metric: Metric) => void) | undefined;
let currentPathname = "/";

vi.mock("next/web-vitals", () => ({
  useReportWebVitals(callback: (metric: Metric) => void) {
    reportMetric = callback;
  },
}));

vi.mock("next/navigation", () => ({
  usePathname() {
    return currentPathname;
  },
}));

function emit(metric: Partial<Metric> = {}) {
  act(() => {
    reportMetric?.({
      id: "v4-1699999999999-1000000000000",
      name: "INP",
      value: 180.4,
      navigationType: "navigate",
      entries: [{ target: "private-dom-target" }],
      ...metric,
    });
  });
}

function stubViewport(compact: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: compact })),
  });
}

function createFetchMock() {
  return vi.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return new Response(null, { status: 202 });
  });
}

describe("staging INP client reporter", () => {
  beforeEach(() => {
    reportMetric = undefined;
    window.history.replaceState({}, "", "/learning/chatroom?courseId=private-course");
    currentPathname = "/learning/chatroom";
    stubViewport(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends only the five allowed INP scalars to the same-origin endpoint", () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    render(<UaisStagingInpReporter enabled />);

    emit();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/observability/staging-inp");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["id", "journey", "navigationType", "valueMs", "viewportClass"].sort(),
    );
    expect(body).toEqual({
      id: "v4-1699999999999-1000000000000",
      journey: "student-chatroom",
      viewportClass: "wide",
      navigationType: "navigate",
      valueMs: 180,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("private-dom-target");
    expect(serialized).not.toContain("private-course");
    expect(serialized).not.toContain("role");
    expect(serialized).not.toContain("url");
  });

  it("discards an INP sample after an SPA transition maps to another journey", () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<UaisStagingInpReporter enabled />);

    currentPathname = "/teaching/course-settings";
    window.history.pushState({}, "", "/teaching/course-settings?course=private-course");
    view.rerender(<UaisStagingInpReporter enabled />);
    emit();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["/teaching/course-settings", "/login"])(
    "permanently taints the hard-load lifecycle after visiting %s and returning",
    (awayPathname) => {
      const fetchMock = createFetchMock();
      vi.stubGlobal("fetch", fetchMock);
      const view = render(<UaisStagingInpReporter enabled />);

      currentPathname = awayPathname;
      window.history.pushState({}, "", awayPathname);
      view.rerender(<UaisStagingInpReporter enabled />);

      // The eventual Web Vitals INP may include an interaction that happened
      // while this preserved RootLayout was on the other journey. Returning to
      // the original URL must never make that page-lifetime metric admissible.
      currentPathname = "/learning/chatroom";
      window.history.pushState({}, "", "/learning/chatroom");
      view.rerender(<UaisStagingInpReporter enabled />);
      emit({ id: `v4-returned-from-${awayPathname === "/login" ? "unsupported" : "other"}` });

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("keeps the hard-load bucket and viewport across a same-journey path change", () => {
    window.history.replaceState({}, "", "/teaching/courses/course-a/activities");
    currentPathname = "/teaching/courses/course-a/activities";
    stubViewport(true);
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<UaisStagingInpReporter enabled />);

    currentPathname = "/teaching/courses/course-b/activities";
    window.history.pushState({}, "", "/teaching/courses/course-b/activities");
    stubViewport(false);
    view.rerender(<UaisStagingInpReporter enabled />);
    emit();

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      journey: string;
      viewportClass: string;
    };
    expect(body).toMatchObject({
      journey: "teacher-activities",
      viewportClass: "compact",
    });
  });

  it("does not send non-INP metrics, disabled reports, or unsupported paths", () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const first = render(<UaisStagingInpReporter enabled />);
    emit({ name: "LCP" });
    first.unmount();

    const second = render(<UaisStagingInpReporter enabled={false} />);
    emit();
    second.unmount();

    window.history.replaceState({}, "", "/login");
    currentPathname = "/login";
    render(<UaisStagingInpReporter enabled />);
    emit();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
