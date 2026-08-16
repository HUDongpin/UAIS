import {
  resolveUaisDurableSnapshotBackend,
  selectUaisDurableSnapshotBackend,
  type UaisDurableSnapshotBackendSelection,
} from "@/lib/server/uais-durable-snapshot-backend";

// Chatroom-facing names for the shared snapshot-backend selection.
//
// The logic moved to `uais-durable-snapshot-backend` once the course-management
// store had to resolve its backend the same way - see that module for why the
// two must never disagree. These re-exports stay so the chatroom call sites and
// their tests keep reading in chatroom terms, and so the move is not a rename
// rippling through unrelated files.

export type LearningChatroomDurableBackendSelection = UaisDurableSnapshotBackendSelection;

export function selectLearningChatroomDurableBackend(
  env: Record<string, string | undefined>,
): LearningChatroomDurableBackendSelection {
  return selectUaisDurableSnapshotBackend(env);
}

export function resolveLearningChatroomDurableBackend<TRepository>(input: {
  env: Record<string, string | undefined>;
  createPostgresRepository: () => TRepository;
  createExternalRepository: () => TRepository | undefined;
}): TRepository | undefined {
  return resolveUaisDurableSnapshotBackend(input);
}
