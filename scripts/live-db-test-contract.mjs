export const LEGACY_LIVE_DB_TEST_FILES = Object.freeze([
  "tests/teaching-course-management-postgres-integration.test.ts",
  "tests/teacher-ai-ownership-postgres-integration.test.ts",
  "tests/learning-chatroom-postgres-integration.test.ts",
  "tests/uais-app-account-postgres-integration.test.ts",
  "tests/teaching-course-management-cutover-integration.test.ts",
  "tests/teaching-operations-cutover-integration.test.ts",
  "tests/learning-loop-postgres-integration.test.ts",
  "tests/teaching-course-collaborator-postgres-integration.test.ts",
]);

export const STAGING_INP_LIVE_DB_TEST_FILE =
  "tests/staging-inp-rum-postgres-integration.test.ts";

export const P1_LOAD_LIVE_DB_TEST_FILE =
  "tests/learning-loop-postgres-load.integration.test.ts";

export const LIVE_DB_TEST_FILES = Object.freeze([
  ...LEGACY_LIVE_DB_TEST_FILES,
  STAGING_INP_LIVE_DB_TEST_FILE,
  P1_LOAD_LIVE_DB_TEST_FILE,
]);

export const LIVE_DB_TEST_FILES_BY_LANE = Object.freeze({
  legacy: LEGACY_LIVE_DB_TEST_FILES,
  "staging-inp": Object.freeze([STAGING_INP_LIVE_DB_TEST_FILE]),
  "p1-load": Object.freeze([P1_LOAD_LIVE_DB_TEST_FILE]),
});

// These tests accept only disposable loopback classroom databases, never a
// managed deployment URL. Keep them out of the deterministic lane even when a
// developer has an explicit local-test variable in their shell.
export const LOCAL_CLASSROOM_DB_TEST_FILES = Object.freeze([
  "tests/classroom-roster-postgres-integration.test.ts",
  "tests/classroom-lessons-local-postgres.test.ts",
  "tests/classroom-chat-archive.integration.test.ts",
  "tests/classroom-retention-postgres.integration.test.ts",
  "tests/classroom-share-retention.integration.test.ts",
  "tests/classroom-submission-images.integration.test.ts",
  "tests/classroom-submission-concurrency.integration.test.ts",
  "tests/classroom-submission-queue-counts.integration.test.ts",
]);

export const LIVE_DB_TEST_CAPABILITY_ENV = Object.freeze({
  file: "UAIS_LIVE_DB_TEST_CAPABILITY_FILE",
  token: "UAIS_LIVE_DB_TEST_CAPABILITY_TOKEN",
  lane: "UAIS_LIVE_DB_TEST_CAPABILITY_LANE",
});
