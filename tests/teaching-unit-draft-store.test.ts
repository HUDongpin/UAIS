import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTeachingCourseRecord,
  readTeachingCourseManagementDatabase,
  saveTeachingCourseSettingsRecord,
  saveTeachingCourseUnitDraftRecord,
} from "@/lib/server/teaching-course-management-store";
import { normalizeCourseUnitDraftRecord } from "@/lib/server/teaching-course-management-record-normalizers";
import {
  readTeachingCourseManagementSnapshot,
  writeTeachingCourseManagementSnapshot,
} from "@/lib/server/teaching-course-management-io";

const directories: string[] = [];
const now = new Date("2026-10-20T00:00:00.000Z");
const content = {
  title: "Evidence and research questions",
  objectives: ["Distinguish a research question from a topic."],
  activities: [{
    title: "Compare two questions",
    durationMinutes: 15,
    instructions: "In pairs, identify the variables and explain which question can be investigated.",
  }],
  lectureScript: "A research question specifies what you want to find out. Compare a broad topic such as learning with a question about how feedback changes a learner's next attempt.",
  questions: [{
    prompt: "How can a broad topic become an investigable research question?",
    referenceAnswer: "Specify a population, observable variables, and the relationship to investigate.",
  }],
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-unit-draft-"));
  directories.push(dataDir);
  const { course } = await createTeachingCourseRecord({
    dataDir, actorId: "teacher-a", now,
    draft: {
      name: "Research methods", instructor: "Fixture teacher", unit: "Fixture",
      department: "Fixture", semester: "2026", description: "Research questions and evidence.",
    },
  });
  return { dataDir, courseId: course.courseId, actorId: "teacher-a", now };
}

describe("teaching unit draft content persistence", () => {
  it("generates and reloads complete editable teaching content, not only a status record", async () => {
    const input = await fixture();
    const generateContent = vi.fn(async () => content);
    const result = await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent,
    });
    expect(generateContent).toHaveBeenCalledOnce();
    expect(result.unitDraft).toMatchObject({ content, draftStatus: "generated", revision: 1 });
    const database = await readTeachingCourseManagementDatabase(input);
    expect(database.courseUnitDrafts?.[0]).toMatchObject({ content, revision: 1 });
  });

  it("does not write a success record when content generation is unavailable", async () => {
    const input = await fixture();
    await expect(saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1",
    })).rejects.toMatchObject({ status: 503 });
    expect((await readTeachingCourseManagementDatabase(input)).courseUnitDrafts ?? []).toHaveLength(0);
  });

  it("keeps invalid provider content and provider errors from modifying the saved draft", async () => {
    const input = await fixture();
    await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent: async () => content,
    });
    const before = await readTeachingCourseManagementDatabase(input);
    await expect(saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-2",
      generateContent: async () => ({ ...content, lectureScript: " " }),
    })).rejects.toMatchObject({ status: 502 });
    await expect(saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-2",
      generateContent: async () => { throw new Error("Provider unavailable"); },
    })).rejects.toThrow("Provider unavailable");
    expect(await readTeachingCourseManagementDatabase(input)).toEqual(before);
  });

  it("classifies legacy metadata-only drafts as incomplete and regenerates the same operation", async () => {
    const input = await fixture();
    const { unitDraft } = await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent: async () => content,
    });
    const legacy = { ...unitDraft, content: undefined, revision: undefined };
    expect(normalizeCourseUnitDraftRecord(legacy)).toMatchObject({ draftStatus: "incomplete", revision: 0 });
    const snapshot = await readTeachingCourseManagementSnapshot(input);
    snapshot.database.courseUnitDrafts = [normalizeCourseUnitDraftRecord(legacy)];
    await writeTeachingCourseManagementSnapshot({ ...input, database: snapshot.database, expectedRevision: snapshot.revision });
    const generateContent = vi.fn(async () => content);
    const regenerated = await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent,
    });
    expect(generateContent).toHaveBeenCalledOnce();
    expect(regenerated.unitDraft).toMatchObject({ content, draftStatus: "generated", revision: 1 });
  });

  it("retries an unrelated snapshot conflict without repeating provider generation", async () => {
    const input = await fixture();
    const generateContent = vi.fn(async () => {
      await saveTeachingCourseSettingsRecord({
        ...input, operationRecordId: "settings-1", settingsPatch: { semester: "2027" },
      });
      return content;
    });
    await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent,
    });
    expect(generateContent).toHaveBeenCalledOnce();
    const database = await readTeachingCourseManagementDatabase(input);
    expect(database.courses[0].semester).toBe("2027");
    expect(database.courseUnitDrafts?.[0].content).toEqual(content);
  });

  it("authorizes before calling the provider", async () => {
    const input = await fixture();
    const generateContent = vi.fn(async () => content);
    await expect(saveTeachingCourseUnitDraftRecord({
      ...input, actorId: "teacher-other", operationRecordId: "generate-unit-1", generateContent,
    })).rejects.toMatchObject({ status: 403 });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("persists edits and preserves them on a retried generation operation", async () => {
    const { readTeachingUnitDraft, updateTeachingUnitDraft } = await import("@/lib/server/teaching-unit-draft-store");
    const input = await fixture();
    const original = await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent: async () => content,
    });
    const editedContent = { ...content, lectureScript: "Teacher-edited lecture with a local example and a discussion question." };
    const edited = await updateTeachingUnitDraft({
      ...input, content: editedContent, expectedRevision: original.unitDraft.revision,
      now: new Date("2026-10-20T01:00:00.000Z"),
    });
    expect(edited).toMatchObject({ content: editedContent, revision: 2, updatedAt: "2026-10-20T01:00:00.000Z" });
    expect(await readTeachingUnitDraft(input)).toEqual(edited);
    const generateContent = vi.fn(async () => content);
    const retried = await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent,
    });
    expect(retried.unitDraft).toEqual(edited);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("rejects a stale edit without replacing a newer teacher edit", async () => {
    const { readTeachingUnitDraft, updateTeachingUnitDraft } = await import("@/lib/server/teaching-unit-draft-store");
    const input = await fixture();
    await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent: async () => content,
    });
    const editedContent = { ...content, title: "Teacher's updated title" };
    await updateTeachingUnitDraft({ ...input, content: editedContent, expectedRevision: 1 });
    await expect(updateTeachingUnitDraft({
      ...input, content, expectedRevision: 1,
    })).rejects.toMatchObject({ status: 409, reasonCode: "unit-draft-revision-conflict" });
    expect((await readTeachingUnitDraft(input))?.content).toEqual(editedContent);
  });

  it("does not overwrite an edit that completes while generation is in flight", async () => {
    const { readTeachingUnitDraft, updateTeachingUnitDraft } = await import("@/lib/server/teaching-unit-draft-store");
    const input = await fixture();
    await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent: async () => content,
    });
    const editedContent = { ...content, title: "Teacher's concurrent edit" };
    const generateContent = vi.fn(async () => {
      await updateTeachingUnitDraft({ ...input, content: editedContent, expectedRevision: 1 });
      return content;
    });
    await expect(saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-2", generateContent,
    })).rejects.toMatchObject({ status: 409, reasonCode: "unit-draft-revision-conflict" });
    expect(generateContent).toHaveBeenCalledOnce();
    expect((await readTeachingUnitDraft(input))?.content).toEqual(editedContent);
  });

  it("requires content.write access for reads and edits and rejects incomplete edit bodies", async () => {
    const { readTeachingUnitDraft, updateTeachingUnitDraft } = await import("@/lib/server/teaching-unit-draft-store");
    const input = await fixture();
    expect(await readTeachingUnitDraft(input)).toBeUndefined();
    await expect(updateTeachingUnitDraft({ ...input, content, expectedRevision: 0 })).rejects.toMatchObject({ status: 404 });
    await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent: async () => content,
    });
    await expect(readTeachingUnitDraft({ ...input, actorId: "teacher-other" })).rejects.toMatchObject({ status: 403 });
    await expect(updateTeachingUnitDraft({
      ...input, actorId: "teacher-other", content, expectedRevision: 1,
    })).rejects.toMatchObject({ status: 403 });
    await expect(updateTeachingUnitDraft({
      ...input, content: { ...content, questions: [] }, expectedRevision: 1,
    })).rejects.toMatchObject({ status: 400 });
    await expect(updateTeachingUnitDraft({
      ...input, content, expectedRevision: -1,
    })).rejects.toMatchObject({ status: 400 });
  });

  it("accepts only one of two edits based on the same revision", async () => {
    const { readTeachingUnitDraft, updateTeachingUnitDraft } = await import("@/lib/server/teaching-unit-draft-store");
    const input = await fixture();
    await saveTeachingCourseUnitDraftRecord({
      ...input, operationRecordId: "generate-unit-1", generateContent: async () => content,
    });
    const results = await Promise.allSettled(["First edit", "Second edit"].map((title) => (
      updateTeachingUnitDraft({ ...input, content: { ...content, title }, expectedRevision: 1 })
    )));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ status: 409 });
    expect((await readTeachingUnitDraft(input))?.revision).toBe(2);
  });
});
