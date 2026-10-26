import { describe, expect, it } from "vitest";
import { isSameOriginClassroomRequest } from "@/lib/server/classroom-request-origin";

describe("classroom mutation origin", () => {
  it("uses the routed Host when Next constructs an internal request URL", () => {
    expect(isSameOriginClassroomRequest(new Request("http://localhost:49391/api/lesson", {
      headers: { host: "127.0.0.1:49391", origin: "http://127.0.0.1:49391" },
    }))).toBe(true);
  });
  it("does not let an untrusted Origin or forwarded host select the allowed site", () => {
    for (const origin of ["https://evil.example", "null", "http://www.uais.top", "https://www.uais.top:444", "https://www.uais.top/path"]) {
      expect(isSameOriginClassroomRequest(new Request("https://www.uais.top/api/lesson", {
        headers: { host: "www.uais.top", origin, "x-forwarded-host": "evil.example" },
      }))).toBe(false);
    }
  });
  it("accepts same-origin HTTPS and non-browser authenticated clients without an Origin", () => {
    expect(isSameOriginClassroomRequest(new Request("https://www.uais.top/api/lesson", {
      headers: { host: "www.uais.top", origin: "https://www.uais.top" },
    }))).toBe(true);
    expect(isSameOriginClassroomRequest(new Request("http://localhost/api/lesson"))).toBe(true);
    expect(isSameOriginClassroomRequest(new Request("http://localhost/api/lesson", { headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
  });
});
