import { describe, expect, it } from "vitest";
import {
  formatUtcForHongKongDateTimeInput,
  parseHongKongDateTimeInput,
} from "@/lib/learning-loop/hong-kong-time";

describe("P1 UTC storage and Hong Kong display time", () => {
  it("round-trips a Hong Kong deadline without depending on the browser timezone", () => {
    expect(formatUtcForHongKongDateTimeInput("2026-09-10T12:00:00.000Z")).toBe(
      "2026-09-10T20:00",
    );
    expect(parseHongKongDateTimeInput("2026-09-10T20:00")).toBe(
      "2026-09-10T12:00:00.000Z",
    );
  });

  it("rejects normalized-over invalid dates instead of silently changing the deadline", () => {
    expect(() => parseHongKongDateTimeInput("2026-02-30T09:00")).toThrowError(
      /hong-kong-local-time-invalid/,
    );
    expect(() => formatUtcForHongKongDateTimeInput("not-a-time")).toThrowError(
      /utc-timestamp-invalid/,
    );
  });
});
