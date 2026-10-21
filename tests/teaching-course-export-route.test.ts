import { describe, expect, it, vi } from "vitest";
import { randomFillSync } from "node:crypto";
import JSZip from "jszip";
import { createTeachingCourseExportGetHandler } from "@/app/api/teaching/courses/[courseId]/export/[format]/handler";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { TeachingCourseExportSourceError } from "@/lib/server/teaching-course-export-source";
import { authorizeTeachingCourseCapability } from "@/lib/server/teaching-course-collaborator-access";
import type { TeachingCourseCollaboratorGrant } from "@/lib/server/teaching-course-collaborator-types";
import type { TeachingCourseExportSource } from "@/lib/server/teaching-course-export-package";
import { teachingUnitDraftContent } from "./fixtures/teaching-unit-draft-content";

const now = new Date("2026-10-20T05:00:00.000Z");
const courseId = "course-export-test";
const teacherId = "teacher-export";
const teacherSecret = "synthetic-export-route-test-secret-0001";
const appSecret = "synthetic-export-app-test-secret-000001";
const cookie = createUaisTeacherAuthSessionCookieHeader({
  secret: teacherSecret,
  claims: {
    sessionId: "test-course-export", actorId: teacherId, role: "teacher",
    authenticatedAt: "2026-10-20T04:00:00.000Z", expiresAt: "2026-10-20T06:00:00.000Z",
  },
});
const source: TeachingCourseExportSource = {
  courseId, title: "Exported lesson", sourceKind: "unit-draft",
  unitDraft: teachingUnitDraftContent,
  slides: [{ id: "slide-01", title: "Actual content", notes: "Saved teaching notes." }],
  agents: [],
};

function fixture(overrides: Partial<Parameters<typeof createTeachingCourseExportGetHandler>[0]> = {}) {
  const readSource = vi.fn(async () => source);
  const handler = createTeachingCourseExportGetHandler({
    env: {
      UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherSecret,
      UAIS_APP_SESSION_SIGNING_SECRET: appSecret,
    }, now, readSource,
    getTeachingOperationCourseOwnership: async () => ({ teacherId, courseIds: [courseId] }),
    ...overrides,
  });
  return {
    readSource,
    download: (format = "pptx", options: { course?: string; cookie?: string; locale?: string } = {}) => handler(
      new Request(`https://uais.test/api/teaching/courses/${options.course ?? courseId}/export/${format}?locale=${options.locale ?? "en-US"}`, {
        headers: options.cookie === "" ? {} : { cookie: options.cookie ?? cookie },
      }),
      { params: Promise.resolve({ courseId: options.course ?? courseId, format }) },
    ),
  };
}

describe("native teaching course file download", () => {
  it.each([
    ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
    ["resource-zip", "application/zip", ".zip"],
    ["classroom-zip", "application/zip", ".zip"],
  ])("returns actual %s archive bytes without an export provider", async (format, mime, extension) => {
    const { download, readSource } = fixture();
    const response = await download(format);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(mime);
    expect(response.headers.get("content-disposition")).toContain(extension);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(readSource).toHaveBeenCalledWith(expect.objectContaining({ courseId, locale: "en-US" }));
  });

  it("streams a real package above 4.5 MiB in chunks no larger than 64 KiB", async () => {
    const audio = randomFillSync(Buffer.alloc(6 * 1024 * 1024));
    audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8);
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(24000, 24); audio.writeUInt32LE(48000, 28);
    audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write("data", 36);
    audio.writeUInt32LE(audio.length - 44, 40);
    const { download } = fixture({
      readSource: async () => ({
        ...source, sourceKind: "published-playback", unitDraft: undefined,
        slides: [{ ...source.slides[0], audio: { bytes: audio, extension: "wav" }, durationSeconds: 131 }],
      }),
    });
    const response = await download("resource-zip");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBeNull();
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      expect(value.byteLength).toBeLessThanOrEqual(64 * 1024);
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    expect(chunks.length).toBeGreaterThan(1);
    expect(bytes.byteLength).toBeGreaterThan(4.5 * 1024 * 1024);
    const zip = await JSZip.loadAsync(bytes);
    const wav = zip.filter((name) => name.endsWith(".wav"));
    expect(wav).toHaveLength(1);
    expect((await wav[0].async("nodebuffer")).equals(audio)).toBe(true);
  });

  it("rejects unauthenticated requests before loading course content", async () => {
    const { download, readSource } = fixture();
    expect((await download("pptx", { cookie: "" })).status).toBe(401);
    expect(readSource).not.toHaveBeenCalled();
  });

  it("rejects a student cookie even when a teacher cookie is also present", async () => {
    const studentCookie = createUaisAppSessionCookie(
      { account: "Student", department: "Education", displayName: "Student", role: "student" },
      { secret: appSecret, sessionId: "student-export", now },
    );
    const { download, readSource } = fixture();
    const response = await download("pptx", { cookie: `${studentCookie}; ${cookie}` });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ access: { reasonCode: "teacher-role-required" } });
    expect(readSource).not.toHaveBeenCalled();
  });

  it("cannot download another course with the owner's signed cookie", async () => {
    const { download, readSource } = fixture();
    expect((await download("resource-zip", { course: "someone-elses-course" })).status).toBe(403);
    expect(readSource).not.toHaveBeenCalled();
  });

  it("rechecks exact collaborator course.export permission for every download", async () => {
    const principalId = "22222222-2222-4222-8222-222222222222";
    const ownerId = "11111111-1111-4111-8111-111111111111";
    let grant: TeachingCourseCollaboratorGrant = {
      grantId: "33333333-3333-4333-8333-333333333333", courseId,
      recipientUserId: principalId, grantedByUserId: ownerId,
      role: "co-instructor", scopes: ["course.read", "course.export"], status: "active",
      revision: 1, grantedAt: "2026-10-19T10:00:00.000Z",
    };
    const readTeachingCourseCapability = vi.fn(async (input) => authorizeTeachingCourseCapability({
      principal: { userId: principalId, account: teacherId, role: "teacher", status: "active" },
      course: { courseId: input.courseId, ownerUserId: ownerId },
      capability: input.capability, grant, now,
    }));
    const { download, readSource } = fixture({
      getTeachingOperationCourseOwnership: async () => ({ teacherId, courseIds: [] }),
      readTeachingCourseCapability,
    });
    expect((await download()).status).toBe(200);
    expect(readTeachingCourseCapability).toHaveBeenCalledWith({ principalAccount: teacherId, courseId, capability: "course.export" });
    grant = { ...grant, status: "revoked", revision: 2 };
    expect((await download()).status).toBe(403);
    expect(readSource).toHaveBeenCalledTimes(1);
  });

  it("accepts a canonical managed owner without consulting collaborator grants", async () => {
    const readTeachingCourseCapability = vi.fn();
    const { download } = fixture({
      getTeachingOperationCourseOwnership: async () => ({ teacherId, courseIds: [] }),
      readManagedCourseOwnership: async () => true,
      readTeachingCourseCapability,
    });
    expect((await download()).status).toBe(200);
    expect(readTeachingCourseCapability).not.toHaveBeenCalled();
  });

  it("fails closed when the ownership store is unavailable", async () => {
    const { download, readSource } = fixture({
      readManagedCourseOwnership: async () => { throw new Error("private-store-address"); },
    });
    const response = await download();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-store-address");
    expect(readSource).not.toHaveBeenCalled();
  });

  it.each(["pdf", "../pptx", "json"])("rejects unsupported format %s", async (format) => {
    const { download, readSource } = fixture();
    expect((await download(format)).status).toBe(400);
    expect(readSource).not.toHaveBeenCalled();
  });

  it("rejects a course ID longer than the shared 120-character access contract before source loading", async () => {
    const { download, readSource } = fixture();
    expect((await download("pptx", { course: "c".repeat(121) })).status).toBe(400);
    expect(readSource).not.toHaveBeenCalled();
  });

  it("returns an actionable missing-content error rather than a placeholder file", async () => {
    const { download } = fixture({
      readSource: async () => { throw new TeachingCourseExportSourceError(422, "export-content-unavailable", "No saved content."); },
    });
    const response = await download();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ reasonCode: "export-content-unavailable" });
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("retains the production authentication readiness gate", async () => {
    const { download, readSource } = fixture({
      env: { NODE_ENV: "production", UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherSecret },
    });
    expect((await download()).status).toBe(503);
    expect(readSource).not.toHaveBeenCalled();
  });
});
