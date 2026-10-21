// Isolated synthetic worker for the cross-process filesystem regressions.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { claimGradebookProviderOperation } from "@/lib/server/teaching-gradebook-provider-operations";
import { executeTeachingOperationAction, rollbackTeachingGradebookRelease } from "@/lib/server/teaching-operations-store";

async function main() {
  const [mode, dataDir] = process.argv.slice(2);
  const input = JSON.parse(await readFile(join(dataDir, "worker-input.json"), "utf8"));
  if (mode === "claim") {
    const operation = await claimGradebookProviderOperation({ ...input, now: new Date(input.now) });
    process.send?.({ status: "claimed", operationId: operation.operationId });
  } else if (mode === "write") {
    await executeTeachingOperationAction({
      dataDir, operationId: "invite-code", actionSlot: "primary", courseId: "course-b", actorId: "teacher-a",
      allocateInviteCode: () => new Promise((done) => {
        process.once("message", () => done("58291463")); process.send?.({ status: "locked" });
      }),
    });
    process.send?.({ status: "written" });
  } else {
    process.send?.({ status: "attempting-completion" });
    await rollbackTeachingGradebookRelease({ dataDir, objectId: input.gradebookUpdate.objectId,
      actorId: input.actorId, audit: input.audit, expectedGeneration: input.generation,
    });
    process.send?.({ status: "completed" });
  }
}
main().then(() => process.exit(0), (error) => { process.send?.({ status: "error", code: error.status, message: error.message }); process.exit(0); });
