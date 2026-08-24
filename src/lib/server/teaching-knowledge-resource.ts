import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { TeachingOperationStoreError } from "./teaching-operations-error";
import { isRecord } from "./teaching-operations-guards";

export type TeachingKnowledgeResourceRightsBasis =
  | "owner-created"
  | "licensed"
  | "open-access"
  | "permission-granted";

export type TeachingKnowledgeResourceRegistration = {
  title: string;
  sourceUrl: string;
  sourceFingerprint: string;
  rightsBasis: TeachingKnowledgeResourceRightsBasis;
  visibility: "course-only";
};

const allowedRightsBases = new Set<TeachingKnowledgeResourceRightsBasis>([
  "owner-created",
  "licensed",
  "open-access",
  "permission-granted",
]);

export function readTeachingKnowledgeResourceRegistration(
  value: unknown,
): TeachingKnowledgeResourceRegistration {
  if (!isRecord(value)) {
    throw invalidKnowledgeResource();
  }

  const title = typeof value.title === "string" ? value.title.trim().replace(/\s+/g, " ") : "";
  if (
    title.length < 1 ||
    title.length > 160 ||
    /\/Users\/|[A-Za-z]:\\Users\\|(?:api[_ -]?key|secret|token)\s*[:=]|bearer\s+[A-Za-z0-9._-]{8,}/i.test(
      title,
    )
  ) {
    throw invalidKnowledgeResource();
  }

  if (typeof value.sourceUrl !== "string" || value.sourceUrl.length > 2_048) {
    throw invalidKnowledgeResource();
  }

  let source: URL;
  try {
    source = new URL(value.sourceUrl.trim());
  } catch {
    throw invalidKnowledgeResource();
  }
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    !isPublicKnowledgeResourceHostname(source.hostname)
  ) {
    throw invalidKnowledgeResource();
  }

  const rightsBasis = value.rightsBasis;
  if (
    typeof rightsBasis !== "string" ||
    !allowedRightsBases.has(rightsBasis as TeachingKnowledgeResourceRightsBasis) ||
    value.visibility !== "course-only"
  ) {
    throw invalidKnowledgeResource();
  }

  const sourceUrl = source.toString();
  return {
    title,
    sourceUrl,
    sourceFingerprint: createSourceFingerprint(sourceUrl),
    rightsBasis: rightsBasis as TeachingKnowledgeResourceRightsBasis,
    visibility: "course-only",
  };
}

export function createTeachingResourceReviewItemId(input: {
  courseId: string;
  sourceUrl: string;
}) {
  return `resource-review-item-${createHash("sha256")
    .update(`${input.courseId}\0${input.sourceUrl}`, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function createSourceFingerprint(sourceUrl: string) {
  return `sha256:${createHash("sha256").update(sourceUrl, "utf8").digest("hex")}`;
}

function isPublicKnowledgeResourceHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost")) {
    return false;
  }

  if (isIP(normalized) !== 0) {
    return false;
  }

  return normalized.includes(".");
}

function invalidKnowledgeResource() {
  return new TeachingOperationStoreError(
    400,
    "Knowledge resource registration requires a public HTTPS URL, a title, a rights basis, and course-only visibility.",
  );
}
