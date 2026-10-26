// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeSubmissionContent } from "@/lib/learning-loop/domain";
import {
  validateSubmissionImage,
  createSubmissionEvidenceHash,
} from "@/lib/learning-loop/submission-image-validation";

describe("classroom submission images", () => {
  it("permits an empty draft for image-only work, but retains strict text validation by default", () => {
    expect(() => normalizeSubmissionContent("", { allowEmpty: true })).not.toThrow();
    expect(() => normalizeSubmissionContent("")).toThrow();
    expect(() => normalizeSubmissionContent("<script>alert(1)</script>", { allowEmpty: true })).toThrow();
  });

  it("fully decodes a real photo and strips its metadata", async () => {
    const input = await sharp({ create: { width: 24, height: 16, channels: 3, background: "white" } })
      .withMetadata({ exif: { IFD0: { Artist: "Private student metadata" } } }).jpeg().toBuffer();
    const result = await validateSubmissionImage(input, "image/jpeg");
    expect(result).toMatchObject({ mime: "image/jpeg", width: 24, height: 16 });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
  });

  it("rejects false MIME, truncated images, non-images and oversize bytes", async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).png().toBuffer();
    await expect(validateSubmissionImage(png, "image/jpeg")).rejects.toThrow("submission-image-invalid");
    await expect(validateSubmissionImage(png.subarray(0, 30), "image/png")).rejects.toThrow("submission-image-invalid");
    await expect(validateSubmissionImage(Buffer.from("<svg/>"), "image/svg+xml")).rejects.toThrow("submission-image-format");
    await expect(validateSubmissionImage(Buffer.alloc(1024 * 1024 + 1), "image/png")).rejects.toThrow("submission-image-too-large");
  });

  it("seals the ordered images together with the text, without changing the text-only hash contract", () => {
    const first = { id: "one", position: 1, sha256: "a".repeat(64) };
    const second = { id: "two", position: 2, sha256: "b".repeat(64) };
    const hash = createSubmissionEvidenceHash("proof", [first, second]);
    expect(createSubmissionEvidenceHash("proof", [second, first])).toBe(hash);
    expect(createSubmissionEvidenceHash("proof changed", [first, second])).not.toBe(hash);
    expect(createSubmissionEvidenceHash("proof", [{ ...first, sha256: "c".repeat(64) }, second])).not.toBe(hash);
    expect(createSubmissionEvidenceHash("proof", [{ ...first, position: 2 }, { ...second, position: 1 }])).not.toBe(hash);
  });
});
