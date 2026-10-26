import { createHash } from "node:crypto";

export function createSubmissionEvidenceHash(
  text: string,
  attachments: Array<{ id: string; position: number; sha256: string }>,
) {
  return createHash("sha256").update(JSON.stringify({
    text,
    images: [...attachments].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map(({ id, sha256 }) => ({ id, sha256 })),
  })).digest("hex");
}
