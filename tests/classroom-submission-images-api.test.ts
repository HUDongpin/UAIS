// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createSubmissionImagePostHandler, createSubmissionImageGetHandler, readSubmissionImageMultipart } from "@/lib/server/submission-image-handlers";
import { createSubmissionImageStore } from "@/lib/learning-loop/submission-image-store";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
const env = { UAIS_APP_SESSION_SIGNING_SECRET: "private-image-test-".repeat(3), UAIS_CORE_DATABASE_URL: "postgres://test:test@127.0.0.1:1/never" };
const activityId = randomUUID(), versionId = randomUUID(), attachmentId = randomUUID();
const context = { params: Promise.resolve({ activityId }) };
const authorized = async () => ({ access: { status: "authorized" as const, reasonCode: "student-course-membership-approved" as const, studentAccount: "s1", courseId: "c1", classId: "cl1" }, scope: { courseId: "c1", classId: "cl1", lessonKey: "l1" } });
function multipart(overrides: Record<string, string> = {}) {
  const form = new FormData(); form.set("image", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "proof.png");
  form.set("expectedSubmissionVersionId", versionId); form.set("expectedDraftRevision", "1"); form.set("clientAttachmentId", randomUUID());
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}
function request(form: FormData) { return new Request("http://localhost/api/learning/activities/a/images", { method: "POST", body: form }); }
function store() { return { upload: vi.fn(), remove: vi.fn(), list: vi.fn(), read: vi.fn() }; }
describe("private image API boundaries", () => {
  it("refuses unauthenticated upload before consuming the body", async () => {
    const req = request(multipart()), readBody = vi.spyOn(req.body!, "getReader"), repository = store();
    const response = await createSubmissionImagePostHandler({ env, store: repository, authorizeActivity: async () => ({ access: { status: "denied", reasonCode: "student-session-required" }, scope: { courseId: "c1", classId: "cl1", lessonKey: "l1" } }) })(req, context);
    expect(response.status).toBe(401); expect(readBody).not.toHaveBeenCalled(); expect(repository.upload).not.toHaveBeenCalled();
  });
  it("refuses cross-class upload before consuming image data", async () => {
    const req = request(multipart()), readBody = vi.spyOn(req.body!, "getReader"), repository = store();
    const response = await createSubmissionImagePostHandler({ env, store: repository, authorizeActivity: async () => ({ access: { status: "denied", reasonCode: "student-activity-membership-required" }, scope: { courseId: "c1", classId: "cl2", lessonKey: "l1" } }) })(req, context);
    expect(response.status).toBe(403); expect(readBody).not.toHaveBeenCalled();
  });
  it("bounds actual streamed bytes without trusting Content-Length", async () => {
    const cancel = vi.fn(); let reads = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new Uint8Array(65536)); }, cancel });
    const req = new Request("http://localhost/upload", { method: "POST", body: stream, headers: { "content-type": "multipart/form-data; boundary=test", "content-length": "10" }, duplex: "half" } as RequestInit);
    await expect(readSubmissionImageMultipart(req)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce(); expect(reads).toBeLessThanOrEqual(19);
  });
  it("rejects duplicate fields, extra fields and malformed multipart before store invocation", async () => {
    const repository = store(), handler = createSubmissionImagePostHandler({ env, store: repository, authorizeActivity: authorized });
    const duplicate = multipart(); duplicate.append("expectedDraftRevision", "2");
    expect((await handler(request(duplicate), context)).status).toBe(400);
    expect((await handler(request(multipart({ actorAccount: "someone-else" })), context)).status).toBe(400);
    const malformed = new Request("http://localhost/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=wrong" }, body: "not-multipart" });
    expect((await handler(malformed, context)).status).toBe(400); expect(repository.upload).not.toHaveBeenCalled();
  });
  it.each(["0", "-1", "1.5", "NaN"])("rejects invalid draft revision %s before storage", async revision => {
    const repository = store();
    const response = await createSubmissionImagePostHandler({ env, store: repository, authorizeActivity: authorized })(request(multipart({ expectedDraftRevision: revision })), context);
    expect(response.status).toBe(400); expect(repository.upload).not.toHaveBeenCalled();
  });
  it("rejects malformed UUIDs without opening a database connection", async () => {
    const createDatabase = vi.fn(); const repository = createSubmissionImageStore({ env, createDatabase });
    await expect(repository.read({ attachmentId: "not-uuid", actorAccount: "s1", role: "student" })).rejects.toMatchObject({ status: 400 });
    await expect(repository.upload({ studentAccount: "s1", activityId, classExternalId: "cl1", submissionVersionId: "wrong", expectedDraftRevision: 1, clientAttachmentId: randomUUID(), bytes: new Uint8Array([1]), mime: "image/png" })).rejects.toMatchObject({ status: 400 });
    expect(createDatabase).not.toHaveBeenCalled();
  });
  it("returns no private bytes to unauthenticated or removed-class students", async () => {
    const repository = store();
    const handler = createSubmissionImageGetHandler({ env, store: repository, authorizeStudentCourse: async () => ({ status: "denied", reasonCode: "student-activity-membership-required" }) });
    expect((await handler(new Request("http://localhost/image"), { params: Promise.resolve({ attachmentId }) })).status).toBe(401);
    expect(repository.read).not.toHaveBeenCalled();
    repository.read.mockResolvedValue({ courseId: "c1", classId: "cl1", bytes: Buffer.from("private-image-bytes"), attachment: { id: attachmentId, mime: "image/png" } });
    const cookie = createUaisAppSessionCookie({ account: "s1", role: "student", displayName: "S", department: "UAIS" }, { env });
    const denied = await handler(new Request("http://localhost/image", { headers: { cookie } }), { params: Promise.resolve({ attachmentId }) });
    expect(denied.status).toBe(403); expect(await denied.text()).not.toContain("private-image-bytes");
  });
});
