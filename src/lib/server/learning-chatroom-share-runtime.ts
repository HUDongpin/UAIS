import { createUaisLearningChatroomShareRepository } from "@/lib/server/learning-chatroom-share-external-store";
import { createUaisLearningChatroomSharePostgresRepository } from "@/lib/server/learning-chatroom-share-postgres-store";
import { resolveLearningChatroomDurableBackend } from "@/lib/server/learning-chatroom-durable-backend";
import {
  assertLearningChatroomShareLocalJsonRuntimeAllowed,
  resolveLearningChatroomShareDataDir,
  type LearningChatroomShareRepository,
} from "@/lib/server/learning-chatroom-share-store";

// One place that decides where share links live, so the three callers - mint,
// revoke, and the public page - cannot drift apart on it. This mirrors
// `resolveLearningChatroomTranscriptBackend`, deliberately: a share and the
// transcript it points at must be equally durable, or a link outlives the room
// it publishes (or vice versa).
//
// An injected repository always wins, which is how tests stay off the network.
// Otherwise the external adapter decides: it returns `undefined` for a
// local-JSON deployment, and only then does the local-file guard run - which
// throws in a production runtime rather than writing to a serverless
// filesystem that disappears between requests.
export function resolveLearningChatroomShareBackend(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  repository?: LearningChatroomShareRepository;
}) {
  const repository =
    input.repository ??
    resolveLearningChatroomDurableBackend({
      env: input.env,
      createPostgresRepository: () =>
        createUaisLearningChatroomSharePostgresRepository({ env: input.env }),
      createExternalRepository: () =>
        createUaisLearningChatroomShareRepository({
          env: input.env,
          ...(input.fetch ? { fetch: input.fetch } : {}),
        }),
    });
  if (!repository) {
    assertLearningChatroomShareLocalJsonRuntimeAllowed(input.env);
  }

  return {
    dataDir: resolveLearningChatroomShareDataDir(input.env),
    repository,
  };
}
