import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SubmissionImageEditor,
  type SubmissionImageSnapshot,
} from "@/components/pages/submission-image-editor";
import { type PendingSubmissionImage } from "@/lib/learning-loop/client-submission-recovery";
import type { SubmissionImage } from "@/lib/learning-loop/submission-image-policy";

const saved = vi.hoisted(() => new Map<string, PendingSubmissionImage>());
vi.mock(
  "@/lib/learning-loop/client-submission-recovery",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/learning-loop/client-submission-recovery")
      >();
    return {
      ...actual,
      savePendingImage: vi.fn(async (value: PendingSubmissionImage) => {
        saved.set(actual.pendingImageKey(value), {
          ...value,
          scope: { ...value.scope },
        });
        return true;
      }),
      removePendingImage: vi.fn(async (value: PendingSubmissionImage) => {
        saved.delete(actual.pendingImageKey(value));
        return true;
      }),
      replacePendingImages: vi.fn(
        async (
          changes: Array<{
            previous: PendingSubmissionImage;
            next: PendingSubmissionImage;
          }>,
        ) => {
          for (const { previous, next } of changes) {
            saved.delete(actual.pendingImageKey(previous));
            saved.set(actual.pendingImageKey(next), {
              ...next,
              scope: { ...next.scope },
            });
          }
          return true;
        },
      ),
      readPendingImages: vi.fn(async (scope) => ({
        available: true,
        images: actual.selectPendingImages([...saved.values()], scope),
      })),
    };
  },
);
const scope = {
  learnerAccount: "batch-student",
  courseId: "course",
  classId: "class",
  activityId: "activity",
};
let server: SubmissionImageSnapshot;
let failuresLeft: number;
const uploaded: Array<{ name: string; clientId: string; revision: number }> =
  [];
const conflict = vi.fn();
function Harness() {
  const [snapshot, setSnapshot] = useState(server);
  const [busy, setBusy] = useState(false);
  return (
    <SubmissionImageEditor
      scope={scope}
      locale="zh-CN"
      versionId={snapshot.submissionVersionId}
      revision={snapshot.draftRevision}
      attachments={snapshot.attachments}
      editable
      disabled={busy}
      prepareDraft={async () => {
        if (!server.submissionVersionId)
          server = {
            ...server,
            submissionVersionId: "version-1",
            draftRevision: 1,
          };
        return structuredClone(server);
      }}
      readSnapshot={async () => structuredClone(server)}
      onUpdated={setSnapshot}
      onConflict={conflict}
      onAuthenticationRequired={vi.fn()}
      onBusyChange={setBusy}
      onPendingChange={vi.fn()}
      onRecoveryReady={vi.fn()}
    />
  );
}
beforeEach(() => {
  saved.clear();
  uploaded.length = 0;
  conflict.mockReset();
  failuresLeft = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const file = form.get("image") as File;
      const clientId = String(form.get("clientAttachmentId"));
      const revision = Number(form.get("expectedDraftRevision"));
      uploaded.push({ name: file.name, clientId, revision });
      if (file.name === "two.png" && failuresLeft-- > 0)
        throw new TypeError("offline");
      expect(String(form.get("expectedSubmissionVersionId"))).toBe(
        server.submissionVersionId,
      );
      expect(revision).toBe(server.draftRevision);
      const image: SubmissionImage = {
        id: `stored-${file.name}`,
        clientAttachmentId: clientId,
        submissionVersionId: server.submissionVersionId!,
        position: server.attachments.length + 1,
        mime: "image/png",
        byteLength: file.size,
        width: 1,
        height: 1,
        sha256: "a".repeat(64),
        url: `/api/learning/submission-images/${file.name}`,
      };
      server = {
        ...server,
        draftRevision: server.draftRevision + 1,
        attachments: [...server.attachments, image],
      };
      return Response.json({
        status: "persisted",
        attachment: image,
        revision: server.draftRevision,
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function selectThree() {
  fireEvent.change(screen.getByLabelText("上传作业图片"), {
    target: {
      files: ["one.png", "two.png", "three.png"].map(
        (name) => new File([name], name, { type: "image/png" }),
      ),
    },
  });
}
async function waitStopped() {
  await waitFor(() => {
    expect(
      screen.getAllByRole("button", { name: "重试图片上传" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "重试图片上传" })[0],
    ).toHaveProperty("disabled", false);
  });
}

describe("submission image batch recovery", () => {
  it.each([false, true])(
    "resumes a three-image batch after its second request fails (new draft: %s)",
    async (newDraft) => {
      server = {
        submissionVersionId: newDraft ? null : "version-1",
        draftRevision: newDraft ? 0 : 1,
        attachments: [],
        contentText: "",
        sealed: false,
      };
      render(<Harness />);
      await act(async () => {});
      selectThree();
      await waitStopped();
      fireEvent.click(
        screen.getAllByRole("button", { name: "重试图片上传" })[0],
      );
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: "重试图片上传" }),
        ).toHaveLength(1),
      );
      fireEvent.click(screen.getByRole("button", { name: "重试图片上传" }));
      await waitFor(() => expect(server.attachments).toHaveLength(3));
      expect(conflict).not.toHaveBeenCalled();
      expect(uploaded.map((item) => item.name)).toEqual([
        "one.png",
        "two.png",
        "two.png",
        "three.png",
      ]);
      expect(uploaded[1].clientId).toBe(uploaded[2].clientId);
      expect(
        new Set(server.attachments.map((item) => item.clientAttachmentId)).size,
      ).toBe(3);
      expect(saved.size).toBe(0);
    },
  );
  it("retains acknowledged queue progress across remounts and still rejects a real external revision", async () => {
    server = {
      submissionVersionId: null,
      draftRevision: 0,
      attachments: [],
      contentText: "",
      sealed: false,
    };
    let view = render(<Harness />);
    await act(async () => {});
    selectThree();
    await waitStopped();
    const records = [...saved.values()];
    expect(records).toHaveLength(2);
    expect(
      records.every(
        (record) =>
          record.scope.submissionVersionId === "version-1" &&
          record.draftRevision === 2,
      ),
    ).toBe(true);
    view.unmount();
    view = render(<Harness />);
    await waitStopped();
    fireEvent.click(screen.getAllByRole("button", { name: "重试图片上传" })[0]);
    await waitFor(() => expect(server.attachments).toHaveLength(2));
    await waitFor(() => expect(saved.size).toBe(1));
    expect([...saved.values()][0].draftRevision).toBe(3);
    view.unmount();
    view = render(<Harness />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "重试图片上传" }),
      ).toHaveProperty("disabled", false),
    );
    server = {
      ...server,
      draftRevision: 4,
      contentText: "Edited on another device",
    };
    fireEvent.click(screen.getByRole("button", { name: "重试图片上传" }));
    await waitFor(() => expect(conflict).toHaveBeenCalledOnce());
    expect(uploaded).toHaveLength(3);
    expect([...saved.values()][0].draftRevision).toBe(3);
    view.unmount();
  });
});
