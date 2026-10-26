import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pendingImageKey,
  selectPendingImages,
  savePendingImage,
  readSealIntent,
  writeSealIntent,
  sealIntentKey,
} from "@/lib/learning-loop/client-submission-recovery";
const scope = {
  learnerAccount: "student-a",
  courseId: "course",
  classId: "class",
  activityId: "activity",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("submission recovery boundaries", () => {
  it("selects only the same learner/course/class/activity and expires images after seven days", () => {
    const now = Date.now();
    const good = {
      scope: { ...scope, submissionVersionId: "v1" },
      clientAttachmentId: "image-a",
      blob: new Blob(["image"], { type: "image/png" }),
      name: "photo.png",
      updatedAt: now,
    };
    const all = [
      good,
      { ...good, scope: { ...good.scope, learnerAccount: "student-b" } },
      { ...good, updatedAt: now - 8 * 24 * 60 * 60 * 1000 },
    ];
    expect(selectPendingImages(all, scope, now)).toEqual([good]);
    expect(pendingImageKey(good)).not.toEqual(
      pendingImageKey({
        ...good,
        scope: { ...good.scope, submissionVersionId: "v2" },
      }),
    );
  });
  it("reports unavailable IndexedDB without claiming the blob was saved", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(
      await savePendingImage({
        scope: { ...scope, submissionVersionId: "v1" },
        clientAttachmentId: "photo",
        blob: new Blob(["x"]),
        name: "photo",
        updatedAt: Date.now(),
      }),
    ).toBe(false);
  });
  it("keeps the same seal key in its exact learner and version scope", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const intent = {
      scope,
      submissionVersionId: "v1",
      draftRevision: 2,
      idempotencyKey: "stable-key",
      updatedAt: Date.now(),
    };
    expect(writeSealIntent(storage, intent)).toBe(true);
    expect(readSealIntent(storage, scope)).toEqual(intent);
    expect(
      readSealIntent(storage, { ...scope, learnerAccount: "b" }),
    ).toBeUndefined();
    expect(sealIntentKey(scope)).not.toBe(
      sealIntentKey({ ...scope, classId: "other" }),
    );
  });
  it("catches denied local storage reads/writes", () => {
    const storage = {
      getItem: () => {
        throw Error("denied");
      },
      setItem: () => {
        throw Error("denied");
      },
      removeItem: () => {
        throw Error("denied");
      },
    };
    expect(readSealIntent(storage, scope)).toBeUndefined();
    expect(
      writeSealIntent(storage, {
        scope,
        submissionVersionId: "v1",
        draftRevision: 1,
        idempotencyKey: "key",
        updatedAt: Date.now(),
      }),
    ).toBe(false);
  });
});
