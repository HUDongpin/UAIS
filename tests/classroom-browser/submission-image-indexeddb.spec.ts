import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";

// The pending-Blob store is exercised in an actual browser without contacting
// UAIS, creating accounts, or writing a server database.
test("pending image IndexedDB queue retains acknowledged progress across reloads", async ({
  page,
}) => {
  const source = await readFile(
    "src/lib/learning-loop/client-submission-recovery.ts",
    "utf8",
  );
  const javascript = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  const server = createServer((request, response) => {
    response.setHeader(
      "content-type",
      request.url === "/recovery.js" ? "text/javascript" : "text/html",
    );
    response.end(
      request.url === "/recovery.js"
        ? javascript
        : "<!doctype html><title>Isolated image recovery test</title>",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("loopback-listen-failed");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(origin);
    const initial = await page.evaluate(async () => {
      const modulePath = "/recovery.js";
      const recovery = (await import(
        modulePath
      )) as typeof import("@/lib/learning-loop/client-submission-recovery");
      const scope = {
        learnerAccount: "synthetic-a",
        courseId: "course",
        classId: "class",
        activityId: "activity",
      };
      const pending = ["one", "two", "three"].map((name) => ({
        scope: { ...scope, submissionVersionId: null },
        clientAttachmentId: name,
        blob: new Blob([name], { type: "image/png" }),
        name,
        updatedAt: Date.now(),
        draftRevision: 0,
      }));
      for (const record of pending)
        if (!(await recovery.savePendingImage(record)))
          throw Error("save-failed");
      const acknowledged = pending.map((record) => ({
        ...record,
        scope: { ...scope, submissionVersionId: "version-1" },
        draftRevision: 2,
      }));
      const persisted = await recovery.replacePendingImages(
        pending.map((previous, index) => ({
          previous,
          next: acknowledged[index],
        })),
      );
      await recovery.removePendingImage(acknowledged[0]);
      return persisted;
    });
    expect(initial).toBe(true);
    await page.reload();
    const afterReload = await page.evaluate(async () => {
      const modulePath = "/recovery.js";
      const recovery = (await import(
        modulePath
      )) as typeof import("@/lib/learning-loop/client-submission-recovery");
      const scope = {
        learnerAccount: "synthetic-a",
        courseId: "course",
        classId: "class",
        activityId: "activity",
      };
      const result = await recovery.readPendingImages(scope);
      const other = await recovery.readPendingImages({
        ...scope,
        learnerAccount: "synthetic-b",
      });
      const details = await Promise.all(
        result.images.map(async (record) => ({
          name: record.name,
          version: record.scope.submissionVersionId,
          revision: record.draftRevision,
          bytes: await record.blob.text(),
        })),
      );
      const rejected = await recovery.replacePendingImages(
        result.images.map((previous, index) => ({
          previous,
          next:
            index === 0
              ? { ...previous, draftRevision: 99 }
              : Object.assign(
                  { ...previous, draftRevision: 99 },
                  { notCloneable: () => {} },
                ),
        })),
      );
      const rolledBack = (await recovery.readPendingImages(scope)).images.every(
        (record) => record.draftRevision === 2,
      );
      const next = result.images.map((record) => ({
        ...record,
        draftRevision: 3,
      }));
      await recovery.replacePendingImages(
        result.images.map((previous, index) => ({
          previous,
          next: next[index],
        })),
      );
      await recovery.removePendingImage(
        next.find((record) => record.name === "two")!,
      );
      return {
        available: result.available,
        details,
        otherCount: other.images.length,
        atomicRollback: !rejected && rolledBack,
      };
    });
    expect(afterReload).toEqual({
      available: true,
      details: [
        { name: "three", version: "version-1", revision: 2, bytes: "three" },
        { name: "two", version: "version-1", revision: 2, bytes: "two" },
      ],
      otherCount: 0,
      atomicRollback: true,
    });
    await page.reload();
    const last = await page.evaluate(async () => {
      const modulePath = "/recovery.js";
      const recovery = (await import(
        modulePath
      )) as typeof import("@/lib/learning-loop/client-submission-recovery");
      const result = await recovery.readPendingImages({
        learnerAccount: "synthetic-a",
        courseId: "course",
        classId: "class",
        activityId: "activity",
      });
      return result.images.map((record) => ({
        name: record.name,
        revision: record.draftRevision,
      }));
    });
    expect(last).toEqual([{ name: "three", revision: 3 }]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
