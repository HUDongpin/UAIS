export const UAIS_STAGING_INP_PROJECT_ID = "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL";
export const UAIS_PRODUCTION_PROJECT_ID = "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA";
export const UAIS_STAGING_INP_TTL_HOURS = 48;
export const UAIS_STAGING_INP_COHORT_CAP = 4_000;
export const UAIS_STAGING_INP_HOURLY_ID_CAP = 120;

export const uaisStagingInpJourneys = [
  "student-learning",
  "student-chatroom",
  "teacher-home",
  "teacher-course-settings",
  "teacher-activities",
  "teacher-submissions",
] as const;

export type UaisStagingInpJourney = (typeof uaisStagingInpJourneys)[number];
export type UaisStagingInpViewportClass = "compact" | "wide";
export type UaisStagingInpNavigationType =
  | "navigate"
  | "reload"
  | "back-forward"
  | "back-forward-cache"
  | "prerender"
  | "restore";

export type UaisStagingInpBinding = {
  cohortId: string;
  candidateGitSha: string;
  candidateContentSha: string;
  deploymentHost: string;
};

export type UaisStagingInpPayload = {
  id: string;
  journey: UaisStagingInpJourney;
  viewportClass: UaisStagingInpViewportClass;
  navigationType: UaisStagingInpNavigationType;
  valueMs: number;
};

const digestPattern = /^[0-9a-f]{64}$/;
const cohortPattern = /^p2-inp-([0-9a-f]{40})-[a-z0-9][a-z0-9-]{0,15}$/;
const immutableDeploymentHostPattern = /^uais-staging-[a-z0-9-]+\.vercel\.app$/;
const metricIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const journeySet = new Set<UaisStagingInpJourney>(uaisStagingInpJourneys);
const navigationTypes = new Set<UaisStagingInpNavigationType>([
  "navigate",
  "reload",
  "back-forward",
  "back-forward-cache",
  "prerender",
  "restore",
]);
const payloadKeys = ["id", "journey", "navigationType", "valueMs", "viewportClass"].sort();

export function isUaisStagingInpImmutableDeploymentHost(value: string) {
  return immutableDeploymentHostPattern.test(value);
}

export function isUaisStagingInpCohortId(value: string) {
  return cohortPattern.test(value);
}

export function isUaisStagingInpCohortIdForCandidate(
  value: string,
  candidateGitSha: string,
) {
  return cohortPattern.exec(value)?.[1] === candidateGitSha;
}

export function parseOperatorAccountHashes(value: string | undefined) {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => digestPattern.test(item)),
    ),
  ];
}

/** Maps a hard-load pathname to a fixed, identifier-free product bucket. */
export function classifyUaisStagingInpJourney(
  pathname: string,
): UaisStagingInpJourney | null {
  if (!pathname.startsWith("/") || pathname.includes("?") || pathname.includes("#")) {
    return null;
  }
  if (pathname === "/learning") return "student-learning";
  if (pathname === "/learning/chatroom") return "student-chatroom";
  if (pathname === "/teaching") return "teacher-home";
  if (pathname === "/teaching/course-settings") return "teacher-course-settings";
  if (/^\/teaching\/courses\/[^/]+\/activities$/.test(pathname)) {
    return "teacher-activities";
  }
  if (/^\/teaching\/activities\/[^/]+\/submissions$/.test(pathname)) {
    return "teacher-submissions";
  }
  if (/^\/teaching\/submissions\/[^/]+$/.test(pathname)) {
    return "teacher-submissions";
  }
  return null;
}

export function parseUaisStagingInpPayload(value: unknown): UaisStagingInpPayload | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== payloadKeys.length ||
    keys.some((key, index) => key !== payloadKeys[index])
  ) {
    return null;
  }
  const { id, journey, viewportClass, navigationType, valueMs } = value;
  if (typeof id !== "string" || !metricIdPattern.test(id)) return null;
  if (typeof journey !== "string" || !journeySet.has(journey as UaisStagingInpJourney)) {
    return null;
  }
  if (viewportClass !== "compact" && viewportClass !== "wide") return null;
  if (
    typeof navigationType !== "string" ||
    !navigationTypes.has(navigationType as UaisStagingInpNavigationType)
  ) {
    return null;
  }
  if (
    typeof valueMs !== "number" ||
    !Number.isInteger(valueMs) ||
    valueMs < 0 ||
    valueMs > 60_000
  ) {
    return null;
  }
  return {
    id,
    journey: journey as UaisStagingInpJourney,
    viewportClass,
    navigationType: navigationType as UaisStagingInpNavigationType,
    valueMs,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
