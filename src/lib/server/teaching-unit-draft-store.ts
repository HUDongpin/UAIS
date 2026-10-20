import { randomUUID } from "node:crypto";
import { isTeachingUnitDraftContent } from "@/lib/teaching/unit-draft";
import { isTeachingCourseManagementActorAuthorized } from "./teaching-course-management-authorization";
import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import { requireSafeId } from "./teaching-course-management-guards";
import { createAuditEvent } from "./teaching-course-management-helpers";
import {
  localTeachingCourseManagementStorage,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  writeTeachingCourseManagementSnapshot,
} from "./teaching-course-management-io";
import type {
  TeachingCourseManagementRepository,
  TeachingCourseRecord,
  TeachingCourseUnitDraftRecord,
} from "./teaching-course-management-types";
import {
  createTeachingCourseManagementContentionError,
  createTeachingCourseManagementWriteRetry,
  teachingCourseManagementMaxWriteAttempts,
} from "./teaching-course-management-write-retry";

type UnitDraftAccessInput = {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  actorId: string;
  courseId: string;
};

function authorizeCourse(course: TeachingCourseRecord | undefined, actorId: string, courseId: string) {
  if (!course) {
    throw new TeachingCourseManagementStoreError(404, "Teaching course was not found.");
  }
  if (!isTeachingCourseManagementActorAuthorized({
    ownerTeacherId: course.ownerTeacherId,
    actorId,
    courseId,
    requiredCapability: "course.content.write",
  })) {
    throw new TeachingCourseManagementStoreError(403, "Teaching course ownership is required.");
  }
}

export async function readTeachingUnitDraft(
  input: UnitDraftAccessInput,
): Promise<TeachingCourseUnitDraftRecord | undefined> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir, repository: input.repository, courseId,
  });
  authorizeCourse(database.courses.find((course) => course.courseId === courseId), actorId, courseId);
  return database.courseUnitDrafts?.find((draft) => draft.courseId === courseId);
}

export async function updateTeachingUnitDraft(input: UnitDraftAccessInput & {
  content: unknown;
  expectedRevision: number;
  now?: Date;
}): Promise<TeachingCourseUnitDraftRecord> {
  if (!isTeachingUnitDraftContent(input.content)) {
    throw new TeachingCourseManagementStoreError(400, "Complete teaching unit draft content is required.");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new TeachingCourseManagementStoreError(400, "A valid teaching unit draft revision is required.");
  }
  const content = structuredClone(input.content);
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const actorId = requireSafeId(input.actorId, "actor id");
  const courseId = requireSafeId(input.courseId, "course id");
  const updatedAt = (input.now ?? new Date()).toISOString();
  const traceId = `trace-${randomUUID()}`;
  const storage = input.repository?.storage ?? localTeachingCourseManagementStorage;
  const writeRetry = createTeachingCourseManagementWriteRetry();
  for (let attempt = 0; attempt < teachingCourseManagementMaxWriteAttempts; attempt += 1) {
    const snapshot = await readTeachingCourseManagementSnapshot({
      dataDir, repository: input.repository, courseId,
    });
    const database = snapshot.database;
    const courseIndex = database.courses.findIndex((course) => course.courseId === courseId);
    authorizeCourse(database.courses[courseIndex], actorId, courseId);
    const drafts = database.courseUnitDrafts ?? [];
    const draftIndex = drafts.findIndex((draft) => draft.courseId === courseId);
    const previous = drafts[draftIndex];
    if (!previous) {
      throw new TeachingCourseManagementStoreError(404, "Teaching unit draft was not found.");
    }
    if (previous.revision !== input.expectedRevision) {
      throw new TeachingCourseManagementStoreError(
        409, "Teaching unit draft changed; reload before saving your edits.",
        undefined, "unit-draft-revision-conflict",
      );
    }
    const unitDraft: TeachingCourseUnitDraftRecord = {
      ...previous, content, draftStatus: "generated", revision: previous.revision + 1, updatedAt,
    };
    drafts[draftIndex] = unitDraft;
    database.courseUnitDrafts = drafts;
    database.courses[courseIndex] = { ...database.courses[courseIndex], updatedAt };
    database.updatedAt = updatedAt;
    database.auditEvents.push(createAuditEvent({
      action: "update-course-unit-draft", actorId, courseId, createdAt: updatedAt, storage, traceId,
    }));

    try {
      await writeTeachingCourseManagementSnapshot({
        dataDir, repository: input.repository, database,
        expectedRevision: snapshot.revision, courseId,
      });
      return unitDraft;
    } catch (error) {
      if (await writeRetry.shouldRetry({ attempt, error })) continue;
      throw writeRetry.isConflict(error) ? createTeachingCourseManagementContentionError() : error;
    }
  }
  throw createTeachingCourseManagementContentionError();
}
