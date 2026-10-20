import { describe, expect, it } from "vitest";
import { isDraftMediaSlides, isDraftMediaFile, draftWavDuration, draftMediaFileLimit } from "@/lib/teaching/unit-draft-media";

function wav() {
  const bytes = Buffer.alloc(16044);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(16000, 40); return bytes;
}
describe("private draft media validation", () => {
  it("accepts real PCM audio and derives its sample duration", () => {
    const audio = { mime: "audio/wav", base64: wav().toString("base64") };
    expect(draftWavDuration(wav())).toBe(1);
    expect(isDraftMediaSlides([{ id: "qa", title: "QA", notes: "", audio }])).toBe(true);
  });
  it("rejects truncated or invalid WAV chunks, external URLs and disguised non-media", () => {
    const broken = wav(); broken.writeUInt32LE(999999, 40);
    for (const bytes of [broken, wav().subarray(0, 50), Buffer.from("<script>alert(1)</script>")]) {
      expect(isDraftMediaFile({ mime: "audio/wav", base64: bytes.toString("base64") }, "audio")).toBe(false);
    }
    expect(isDraftMediaFile({ mime: "image/svg+xml", base64: btoa("<svg/>") }, "image")).toBe(false);
    expect(isDraftMediaFile({ mime: "image/png", base64: "https://example.com/private" }, "image")).toBe(false);
  });
  it("enforces file size, aggregate size, unique IDs and metadata keys", () => {
    expect(isDraftMediaFile({ mime: "audio/wav", base64: Buffer.alloc(draftMediaFileLimit + 1).toString("base64") }, "audio")).toBe(false);
    const bytes = wav(); const audio = { mime: "audio/wav", base64: bytes.toString("base64") };
    const slide = { id: "qa", title: "QA", notes: "", audio };
    expect(isDraftMediaSlides([slide, slide])).toBe(false);
    expect(isDraftMediaSlides([{ ...slide, publicUrl: "https://example.com" }])).toBe(false);
    expect(isDraftMediaSlides(Array.from({ length: 13 }, (_, i) => ({ ...slide, id: String(i) })))).toBe(false);
    const large = Buffer.alloc(800044); bytes.copy(large, 0, 0, 44); large.writeUInt32LE(large.length - 8, 4); large.writeUInt32LE(800000, 40);
    expect(isDraftMediaSlides(Array.from({ length: 3 }, (_, i) => ({ ...slide, id: String(i), audio: { ...audio, base64: large.toString("base64") } })))).toBe(false);
  });
});
