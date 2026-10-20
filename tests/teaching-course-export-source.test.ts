import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTeachingCourseExportSource } from "@/lib/server/teaching-course-export-source";
import { createTeachingCourseRecord, saveTeachingCourseUnitDraftRecord } from "@/lib/server/teaching-course-management-store";
import { teachingUnitDraftContent } from "./fixtures/teaching-unit-draft-content";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "uais-course-export-source-"));
  roots.push(rootDir);
  const env = {
    UAIS_TEACHING_COURSES_DATA_DIR: join(rootDir, "courses"),
    UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR: join(rootDir, "decks"),
  };
  await mkdir(env.UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR, { recursive: true });
  return { rootDir, env };
}

async function publishedFixture() {
  const fixtureData = await fixture();
  const { rootDir, env } = fixtureData;
  await writeFile(join(env.UAIS_LEARNING_PPT_PLAYBACK_DATA_DIR, "course.json"), JSON.stringify({
    courseId: "export-test-course", courseTitle: "真实课件", sourceDeckTitle: "真实课件.pptx",
    teacherName: "Test teacher", voiceLabel: "Published voice",
    pptAssetId: "test-deck", audioManifestId: "test-audio",
    slides: [{
      slideId: "slide-01", slideTitle: "课程正文", narrationText: "教师讲解。",
      audioId: "test_slide-01", durationSeconds: 1,
    }],
    localized: { "en-US": {
      courseTitle: "Real lesson", sourceDeckTitle: "Real lesson.pptx",
      teacherName: "Test teacher", voiceLabel: "Published voice",
      slides: [{ slideId: "slide-01", slideTitle: "Lesson body", narrationText: "Teacher narration." }],
    } },
  }));
  const imagePath = join(rootDir, "public/learning/ppt-playback/slides/test-deck/page-01.jpg");
  const audioPath = join(rootDir, "public/learning/ppt-playback/audio/test-audio/test_slide-01.wav");
  await mkdir(dirname(imagePath), { recursive: true });
  await mkdir(dirname(audioPath), { recursive: true });
  const jpeg = await readFile(join(process.cwd(), "public/learning/ppt-playback/slides/natural-number-ordinal-theory-ppt1/page-01.jpg"));
  const wav = Buffer.alloc(48);
  wav.write("RIFF", 0); wav.writeUInt32LE(40, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(4, 40);
  await writeFile(imagePath, jpeg);
  await writeFile(audioPath, wav);
  return { ...fixtureData, imagePath, audioPath, jpeg, wav };
}

describe("native teaching export sources", () => {
  it("reads the selected course's registered media bytes and localized narration", async () => {
    const { rootDir, env, jpeg, wav } = await publishedFixture();
    const source = await readTeachingCourseExportSource({ courseId: "export-test-course", locale: "en-US", env, rootDir });
    expect(source).toMatchObject({
      courseId: "export-test-course", title: "Real lesson", sourceKind: "published-playback",
      slides: [{ id: "slide-01", title: "Lesson body", notes: "Teacher narration.", durationSeconds: 1 }],
      agents: [],
    });
    expect(source.slides[0].image?.bytes.equals(jpeg)).toBe(true);
    expect(source.slides[0].audio?.bytes.equals(wav)).toBe(true);
    expect(source).not.toHaveProperty("teacherName");
  });

  it("fails closed if any declared media file is missing", async () => {
    const { rootDir, env, audioPath } = await publishedFixture();
    await rm(audioPath);
    await expect(readTeachingCourseExportSource({ courseId: "export-test-course", locale: "zh-CN", env, rootDir }))
      .rejects.toMatchObject({ status: 422, reasonCode: "export-media-unavailable" });
  });

  it("fails closed on an empty declared media file", async () => {
    const { rootDir, env, imagePath } = await publishedFixture();
    await writeFile(imagePath, "");
    await expect(readTeachingCourseExportSource({ courseId: "export-test-course", locale: "zh-CN", env, rootDir }))
      .rejects.toMatchObject({ status: 422, reasonCode: "export-media-unavailable" });
  });

  it("does not follow media symlinks outside the published asset directory", async () => {
    const { rootDir, env, imagePath, jpeg } = await publishedFixture();
    await rm(imagePath);
    const outsidePath = join(rootDir, "private.jpg");
    await writeFile(outsidePath, jpeg);
    await symlink(outsidePath, imagePath);
    await expect(readTeachingCourseExportSource({ courseId: "export-test-course", locale: "zh-CN", env, rootDir }))
      .rejects.toMatchObject({ status: 422, reasonCode: "export-media-unavailable" });
  });

  it("uses only a valid persisted unit draft for a course without published media", async () => {
    const { rootDir, env } = await fixture();
    const { course } = await createTeachingCourseRecord({
      dataDir: env.UAIS_TEACHING_COURSES_DATA_DIR, actorId: "export-teacher",
      draft: { name: "Stored course", instructor: "Teacher", unit: "Unit", department: "Education", semester: "2026", description: "Course description" },
    });
    await saveTeachingCourseUnitDraftRecord({
      dataDir: env.UAIS_TEACHING_COURSES_DATA_DIR, actorId: "export-teacher",
      courseId: course.courseId, operationRecordId: "draft-generation",
      generateContent: async () => teachingUnitDraftContent,
    });
    const source = await readTeachingCourseExportSource({ courseId: course.courseId, locale: "en-US", env, rootDir });
    expect(source.sourceKind).toBe("unit-draft");
    expect(source.unitDraft).toEqual(teachingUnitDraftContent);
    expect(source.slides.some((slide) => slide.notes.includes(teachingUnitDraftContent.lectureScript))).toBe(true);
    expect(source.slides.some((slide) => slide.notes.includes(teachingUnitDraftContent.questions[0].referenceAnswer))).toBe(true);
    expect(source.slides.every((slide) => !slide.image && !slide.audio)).toBe(true);
    expect(JSON.stringify(source)).not.toContain("export-teacher");
  });

  it.each(["course.v1", "c".repeat(120), "c".repeat(160)])(
    "loads a valid persisted draft whose course ID is %s",
    async (courseId) => {
      const { rootDir, env } = await fixture();
      const { course } = await createTeachingCourseRecord({
        dataDir: env.UAIS_TEACHING_COURSES_DATA_DIR, actorId: "export-teacher",
        draft: { name: "Stored course", instructor: "Teacher", unit: "Unit", department: "Education", semester: "2026" },
      });
      await saveTeachingCourseUnitDraftRecord({
        dataDir: env.UAIS_TEACHING_COURSES_DATA_DIR, actorId: "export-teacher",
        courseId: course.courseId, operationRecordId: "draft-generation",
        generateContent: async () => teachingUnitDraftContent,
      });
      // Seed an otherwise normal snapshot with a supported store-level course ID.
      const snapshotPath = join(env.UAIS_TEACHING_COURSES_DATA_DIR, "teaching-course-management.json");
      const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
      snapshot.courses[0].courseId = courseId;
      snapshot.courseUnitDrafts[0].courseId = courseId;
      await writeFile(snapshotPath, JSON.stringify(snapshot));
      const result = await readTeachingCourseExportSource({ courseId, locale: "en-US", env, rootDir });
      expect(result).toMatchObject({ courseId, sourceKind: "unit-draft", unitDraft: teachingUnitDraftContent });
      expect(result.slides[0].notes).toBe(teachingUnitDraftContent.lectureScript);
    },
  );

  it("refuses to manufacture content for an empty course", async () => {
    const { rootDir, env } = await fixture();
    await expect(readTeachingCourseExportSource({ courseId: "empty-course", locale: "zh-CN", env, rootDir }))
      .rejects.toMatchObject({ status: 422, reasonCode: "export-content-unavailable" });
  });

  it("does not borrow a published deck from another course", async () => {
    const { rootDir, env } = await publishedFixture();
    await expect(readTeachingCourseExportSource({ courseId: "another-course", locale: "zh-CN", env, rootDir }))
      .rejects.toMatchObject({ status: 422, reasonCode: "export-content-unavailable" });
  });

  it("refuses a local course snapshot in production", async () => {
    const { rootDir, env } = await fixture();
    await expect(readTeachingCourseExportSource({
      courseId: "empty-course", locale: "zh-CN", rootDir,
      env: { ...env, NODE_ENV: "production", UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "local-json" },
    })).rejects.toMatchObject({ status: 503 });
  });
});
