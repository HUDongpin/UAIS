import { TeachingCourseManagementStoreError } from "@/lib/server/teaching-course-management-store";
import { isRecord } from "./route-utils";

// External-provider configuration + provider-ID readers for the teaching-operations
// route (Phase 3 decomposition): env-driven provider config, URL/host validation, and
// provider response-ID extraction. Self-contained except for the shared isRecord guard.

export function readStudentRosterSyncProviderConfig(
  env: Record<string, string | undefined>,
) {
  if (env.UAIS_STUDENT_ROSTER_SYNC_PROVIDER?.trim() !== "external") {
    return undefined;
  }
  const rawUrl = env.UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL?.trim();
  const token = env.UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN?.trim();
  if (!rawUrl || !token || token.length < 32) {
    throw new TeachingCourseManagementStoreError(
      503,
      "Student roster sync provider is not configured.",
    );
  }
  const url = readExternalTeachingProviderUrl(
    rawUrl,
    "Student roster sync provider URL is invalid.",
    env,
  );
  return {
    url,
    token,
  };
}

export function readKnowledgeIndexSyncProviderConfig(
  env: Record<string, string | undefined>,
) {
  if (env.UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER?.trim() !== "external") {
    return undefined;
  }
  const rawUrl = env.UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL?.trim();
  const token = env.UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN?.trim();
  if (!rawUrl || !token || token.length < 32) {
    throw new TeachingCourseManagementStoreError(
      503,
      "Knowledge index sync provider is not configured.",
    );
  }
  const url = readExternalTeachingProviderUrl(
    rawUrl,
    "Knowledge index sync provider URL is invalid.",
    env,
  );
  return {
    url,
    token,
  };
}

export function readCollaborationInviteEmailProviderConfig(
  env: Record<string, string | undefined>,
) {
  if (env.UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER?.trim() !== "external") {
    return undefined;
  }
  const rawUrl = env.UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL?.trim();
  const token = env.UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN?.trim();
  if (!rawUrl || !token || token.length < 32) {
    throw new TeachingCourseManagementStoreError(
      503,
      "Collaboration invite email provider is not configured.",
    );
  }
  const url = readExternalTeachingProviderUrl(
    rawUrl,
    "Collaboration invite email provider URL is invalid.",
    env,
  );
  return {
    url,
    token,
  };
}

export function readCourseContentPublishProviderConfig(
  env: Record<string, string | undefined>,
) {
  if (env.UAIS_COURSE_CONTENT_PUBLISH_PROVIDER?.trim() !== "external") {
    return undefined;
  }
  const rawUrl = env.UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL?.trim();
  const token = env.UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN?.trim();
  if (!rawUrl || !token || token.length < 32) {
    throw new TeachingCourseManagementStoreError(
      503,
      "Course content publish provider is not configured.",
    );
  }
  const url = readExternalTeachingProviderUrl(
    rawUrl,
    "Course content publish provider URL is invalid.",
    env,
  );
  return {
    url,
    token,
  };
}

export function readCourseExportProviderConfig(env: Record<string, string | undefined>) {
  if (env.UAIS_COURSE_EXPORT_PROVIDER?.trim() !== "external") {
    return undefined;
  }
  const rawUrl = env.UAIS_COURSE_EXPORT_PROVIDER_URL?.trim();
  const token = env.UAIS_COURSE_EXPORT_PROVIDER_TOKEN?.trim();
  if (!rawUrl || !token || token.length < 32) {
    throw new TeachingCourseManagementStoreError(
      503,
      "Course export provider is not configured.",
    );
  }
  const url = readExternalTeachingProviderUrl(
    rawUrl,
    "Course export provider URL is invalid.",
    env,
  );
  return {
    url,
    token,
  };
}

export function readGradingFeedbackProviderConfig(env: Record<string, string | undefined>) {
  if (env.UAIS_GRADING_FEEDBACK_PROVIDER?.trim() !== "external") {
    return undefined;
  }
  const rawUrl = env.UAIS_GRADING_FEEDBACK_PROVIDER_URL?.trim();
  const token = env.UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN?.trim();
  if (!rawUrl || !token || token.length < 32) {
    throw new TeachingCourseManagementStoreError(
      503,
      "Grading feedback provider is not configured.",
    );
  }
  const url = readExternalTeachingProviderUrl(
    rawUrl,
    "Grading feedback provider URL is invalid.",
    env,
  );
  return {
    url,
    token,
  };
}

export function readExternalTeachingProviderUrl(
  rawUrl: string,
  invalidMessage: string,
  env: Record<string, string | undefined>,
) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TeachingCourseManagementStoreError(503, invalidMessage);
  }
  const allowLocalProductionFixtureUrl =
    env.UAIS_DEPLOYMENT_ENV === "local-production" &&
    env.UAIS_LOCAL_PRODUCTION_E2E_ALLOW_INSECURE_TEACHING_PROVIDER_FIXTURE === "1" &&
    url.protocol === "http:" &&
    !Boolean(url.username || url.password) &&
    isDisallowedExternalTeachingProviderHost(url.hostname);
  if (
    !allowLocalProductionFixtureUrl &&
    (url.protocol !== "https:" ||
      Boolean(url.username || url.password) ||
      isDisallowedExternalTeachingProviderHost(url.hostname))
  ) {
    throw new TeachingCourseManagementStoreError(503, invalidMessage);
  }
  return url.toString();
}

export function isDisallowedExternalTeachingProviderHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  const octets = host.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    !octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return false;
  }

  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function readProviderDeliveryId(value: unknown) {
  if (!isRecord(value) || value.status !== "delivered") {
    throw new TeachingCourseManagementStoreError(
      502,
      "Collaboration invite email provider delivery was not accepted.",
    );
  }
  const deliveryId = typeof value.deliveryId === "string" ? value.deliveryId.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(deliveryId)) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Collaboration invite email provider delivery id is invalid.",
    );
  }
  return deliveryId;
}

export function readProviderPublishId(value: unknown) {
  if (!isRecord(value) || value.status !== "published") {
    throw new TeachingCourseManagementStoreError(
      502,
      "Course content publish provider did not accept the content.",
    );
  }
  const publishId = typeof value.publishId === "string" ? value.publishId.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(publishId)) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Course content publish provider id is invalid.",
    );
  }
  return publishId;
}

export function readProviderExportId(value: unknown) {
  if (!isRecord(value) || value.status !== "exported") {
    throw new TeachingCourseManagementStoreError(
      502,
      "Course export provider did not accept the export.",
    );
  }
  const exportId = typeof value.exportId === "string" ? value.exportId.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(exportId)) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Course export provider id is invalid.",
    );
  }
  return exportId;
}

export function readProviderFeedbackId(value: unknown) {
  if (!isRecord(value) || value.status !== "generated") {
    throw new TeachingCourseManagementStoreError(
      502,
      "Grading feedback provider did not generate feedback.",
    );
  }
  const feedbackId = typeof value.feedbackId === "string" ? value.feedbackId.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(feedbackId)) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Grading feedback provider id is invalid.",
    );
  }
  return feedbackId;
}

export function readProviderSyncId(value: unknown) {
  if (!isRecord(value) || value.status !== "synced") {
    throw new TeachingCourseManagementStoreError(
      502,
      "Student roster sync provider did not accept the roster.",
    );
  }
  const syncId = typeof value.syncId === "string" ? value.syncId.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(syncId)) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Student roster sync provider id is invalid.",
    );
  }
  return syncId;
}

export function readKnowledgeProviderSyncId(value: unknown) {
  if (!isRecord(value) || value.status !== "synced") {
    throw new TeachingCourseManagementStoreError(
      502,
      "Knowledge index sync provider did not accept the index.",
    );
  }
  const syncId = typeof value.syncId === "string" ? value.syncId.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(syncId)) {
    throw new TeachingCourseManagementStoreError(
      502,
      "Knowledge index sync provider id is invalid.",
    );
  }
  return syncId;
}
