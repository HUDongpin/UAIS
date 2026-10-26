import { createHash } from "node:crypto";
import sharp from "sharp";
import { LearningLoopStoreError } from "./postgres-store";
import { submissionImageByteLimit, submissionImagePixelLimit } from "./submission-image-policy";
export { createSubmissionEvidenceHash } from "./submission-evidence";

export async function validateSubmissionImage(input: Uint8Array, mime: string) {
  if (mime !== "image/png" && mime !== "image/jpeg") {
    throw new LearningLoopStoreError(400, "submission-image-format");
  }
  if (!input.byteLength || input.byteLength > submissionImageByteLimit) {
    throw new LearningLoopStoreError(413, "submission-image-too-large");
  }
  try {
    const image = sharp(input, { failOn: "warning", limitInputPixels: submissionImagePixelLimit });
    const metadata = await image.metadata();
    if (metadata.format !== (mime === "image/png" ? "png" : "jpeg") ||
      !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
      throw new Error("invalid-image");
    }
    // Re-encoding fully decodes every pixel and omits EXIF/GPS metadata.
    const pipeline = image.rotate();
    const { data, info } = await (mime === "image/png" ? pipeline.png() : pipeline.jpeg({ quality: 90 }))
      .toBuffer({ resolveWithObject: true });
    if (data.length > submissionImageByteLimit) {
      throw new LearningLoopStoreError(413, "submission-image-too-large");
    }
    return { bytes: data, mime, width: info.width, height: info.height,
      sha256: createHash("sha256").update(data).digest("hex") };
  } catch (error) {
    if (error instanceof LearningLoopStoreError) throw error;
    throw new LearningLoopStoreError(400, "submission-image-invalid");
  }
}
