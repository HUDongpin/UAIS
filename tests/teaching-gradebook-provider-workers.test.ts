// @vitest-environment node
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { executeTeachingOperationAction, readTeachingGradebookUpdate, readTeachingOperationDatabase, releaseTeachingGradebookUpdate } from "@/lib/server/teaching-operations-store";
import { readGradebookProviderOperations } from "@/lib/server/teaching-gradebook-provider-operations";
import { gradebookProviderGeneration } from "@/lib/server/teaching-gradebook-provider-generation";

const directories: string[] = []; const workers: ChildProcess[] = [];
afterEach(async () => { for (const worker of workers.splice(0)) if (worker.exitCode === null) worker.kill(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
function worker(mode: string, dataDir: string) {
  const child = fork(resolve("tests/fixtures/gradebook-provider-worker.ts"), [mode, dataDir], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] }); workers.push(child);
  let error = ""; child.stderr?.on("data", (chunk) => { error += chunk; });
  const messages: Array<{ status: string; code?: number }> = [];
  const first = new Promise<{ status: string; code?: number }>((done, fail) => { child.once("message", done); child.once("error", fail); });
  child.on("message", (message) => messages.push(message as { status: string; code?: number }));
  const completed = new Promise<typeof messages>((done, fail) => { child.once("exit", (code) => code === 0 ? done(messages) : fail(new Error(error || `Worker exited ${code}`))); });
  return { child, first, completed };
}
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-provider-workers-")); directories.push(dataDir);
  const audit = { traceId: "trace-provider-worker", actorRole: "teacher", authMode: "signed-teacher-session", requestSource: { userAgent: "Synthetic worker", ipAddress: "redacted" } } as const;
  await executeTeachingOperationAction({ dataDir, operationId: "grading", actionSlot: "primary", courseId: "course-a", actorId: "teacher-a" });
  await releaseTeachingGradebookUpdate({ dataDir, objectId: "gradebook-update-course-a", actorId: "teacher-a", audit });
  const gradebookUpdate = (await readTeachingGradebookUpdate({ dataDir, objectId: "gradebook-update-course-a" }))!;
  const input = { env: { UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir }, action: "rollback", dispatchMode: "provider", gradebookUpdate, actorId: "teacher-a", traceId: audit.traceId, audit, now: new Date(), generation: gradebookProviderGeneration(gradebookUpdate) };
  await writeFile(join(dataDir, "worker-input.json"), JSON.stringify(input));
  return { dataDir, input };
}
it("arbitrates simultaneous claims in separate worker processes and blocks after process restart", async () => {
  const f = await fixture(); const first = worker("claim", f.dataDir); const second = worker("claim", f.dataDir);
  const messages = (await Promise.all([first.completed, second.completed])).flat();
  expect(messages.map((message) => message.status).sort()).toEqual(["claimed", "error"]);
  expect(messages.find((message) => message.status === "error")?.code).toBe(409);
  const restarted = worker("claim", f.dataDir); expect(await restarted.completed).toEqual([expect.objectContaining({ status: "error", code: 409 })]);
  expect(await readGradebookProviderOperations({ env: f.input.env })).toHaveLength(1);
});
it("keeps ordinary writer and generation-checked completion atomic across worker processes", async () => {
  const f = await fixture(); const writer = worker("write", f.dataDir); expect(await writer.first).toMatchObject({ status: "locked" });
  const completion = worker("complete", f.dataDir);
  expect(await completion.first).toEqual({ status: "attempting-completion" });
  // Let the second worker reach the shared lock while the first holds a snapshot.
  await new Promise((done) => setTimeout(done, 300)); writer.child.send("continue");
  expect(await writer.completed).toContainEqual({ status: "written" });
  expect(await completion.completed).toEqual([{ status: "attempting-completion" }, { status: "completed" }]);
  const database = await readTeachingOperationDatabase({ dataDir: f.dataDir });
  expect(database.inviteCodes).toContainEqual(expect.objectContaining({ courseId: "course-b" }));
  expect(await readTeachingGradebookUpdate({ dataDir: f.dataDir, objectId: "gradebook-update-course-a" })).toMatchObject({ updateStatus: "release-rolled-back" });
});
