import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { UaisTeacherAiResourceOwnership } from "@/lib/server/ai-resource-grants";
import {
  mergeUaisTeacherAiOwnershipRecord,
  readUaisTeacherAiOwnershipRecord,
} from "@/lib/server/teacher-ai-ownership-store";

const fileHooks = vi.hoisted(() => ({
  beforeWrite: undefined as (() => Promise<void>) | undefined,
  onMkdir: undefined as (() => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mocked = {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      fileHooks.onMkdir?.();
      return actual.mkdir(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      await fileHooks.beforeWrite?.();
      return actual.writeFile(...args);
    },
  };
  return { ...mocked, default: mocked };
});

const fixtureDirs: string[] = [];
afterEach(async () => {
  fileHooks.beforeWrite = undefined;
  fileHooks.onMkdir = undefined;
  await Promise.all(fixtureDirs.splice(0).map((baseDir) => rm(baseDir, { recursive: true, force: true })));
});

async function directory() {
  const baseDir = await mkdtemp(join(tmpdir(), "uais-local-ownership-race-"));
  fixtureDirs.push(baseDir);
  return baseDir;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function ownership(suffix: string, teacherId = "synthetic-teacher"): UaisTeacherAiResourceOwnership {
  return {
    teacherId,
    courseIds: [`course-${suffix}`],
    sampleAssets: [{ sampleAssetId: `sample-${suffix}`, courseId: `course-${suffix}` }],
    pptAssets: [{ pptAssetId: `ppt-${suffix}`, courseId: `course-${suffix}` }],
    clonedVoiceRefs: [{ voiceRefId: `voice-${suffix}`, sampleAssetId: `sample-${suffix}` }],
    audioManifests: [{
      audioManifestId: `audio-${suffix}`, courseId: `course-${suffix}`,
      pptAssetId: `ppt-${suffix}`, voiceRefId: `voice-${suffix}`,
    }],
  };
}

function merge(baseDir: string, suffix: string, teacherId = "synthetic-teacher") {
  return mergeUaisTeacherAiOwnershipRecord({
    baseDir, ownership: ownership(suffix, teacherId), updatedAt: "2026-09-30T12:00:00.000Z",
  });
}

it.each([false, true])("preserves concurrent ownership contributions with existing record: %s", async (seedExisting) => {
  const baseDir = await directory();
  if (seedExisting) await merge(baseDir, "seed");
  const paused = deferred();
  const release = deferred();
  fileHooks.beforeWrite = async () => {
    fileHooks.beforeWrite = undefined;
    paused.resolve();
    await release.promise;
  };
  const first = merge(baseDir, "first");
  await paused.promise;
  const secondEntered = deferred();
  fileHooks.onMkdir = () => { fileHooks.onMkdir = undefined; secondEntered.resolve(); };
  const second = merge(baseDir, "second");
  const results = Promise.all([first, second]);
  await secondEntered.promise;
  release.resolve();
  await results;

  const stored = await readUaisTeacherAiOwnershipRecord({ baseDir, teacherId: "synthetic-teacher" });
  const expected = (seedExisting ? ["seed", "first", "second"] : ["first", "second"]).map((suffix) => ownership(suffix));
  expect(stored?.courseIds?.sort()).toEqual(expected.flatMap((entry) => entry.courseIds ?? []).sort());
  for (const field of ["sampleAssets", "pptAssets", "clonedVoiceRefs", "audioManifests"] as const) {
    expect(stored?.[field]).toHaveLength(expected.length);
    for (const entry of expected) expect(stored?.[field]).toEqual(expect.arrayContaining(entry[field] ?? []));
  }
  expect(await readdir(baseDir)).toEqual(["synthetic-teacher.json"]);
});

it("releases the teacher mutation lock after a failed write", async () => {
  const baseDir = await directory();
  fileHooks.beforeWrite = async () => {
    fileHooks.beforeWrite = undefined;
    throw new Error("synthetic ownership write failure");
  };
  await expect(merge(baseDir, "failed")).rejects.toThrow("synthetic ownership write failure");
  await merge(baseDir, "retry");
  expect(await readUaisTeacherAiOwnershipRecord({ baseDir, teacherId: "synthetic-teacher" })).toEqual(ownership("retry"));
  expect(await readdir(baseDir)).toEqual(["synthetic-teacher.json"]);
});

it("allows an independent teacher merge while another teacher write is pending", async () => {
  const baseDir = await directory();
  const paused = deferred();
  const release = deferred();
  fileHooks.beforeWrite = async () => {
    fileHooks.beforeWrite = undefined;
    paused.resolve();
    await release.promise;
  };
  const first = merge(baseDir, "first");
  await paused.promise;
  try {
    await merge(baseDir, "second", "second-teacher");
    expect(await readUaisTeacherAiOwnershipRecord({ baseDir, teacherId: "second-teacher" })).toEqual(ownership("second", "second-teacher"));
  } finally {
    release.resolve();
    await first;
  }
});
