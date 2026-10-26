export const submissionImageByteLimit = 1024 * 1024;
export const submissionImageCountLimit = 3;
export const submissionImagePixelLimit = 40_000_000;

export type SubmissionImage = {
  id: string;
  clientAttachmentId: string;
  submissionVersionId: string;
  position: number;
  mime: "image/png" | "image/jpeg";
  byteLength: number;
  width: number;
  height: number;
  sha256: string;
  url: string;
};

export function submissionImageUrl(id: string) {
  return `/api/learning/submission-images/${encodeURIComponent(id)}`;
}
