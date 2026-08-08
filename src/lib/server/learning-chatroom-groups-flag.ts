// Single reader for the learning-chatroom group feature flag (plan D9,
// `UAIS_LEARNING_CHATROOM_GROUPS_MODE`, optional-live-ai tier, default off).
//
// Group rooms ship dark. Only an explicit `on` enables them, so an unset value,
// an empty value, a `true`/`1`/`yes` guess or a typo all keep the per-student
// behaviour the flag replaces. The value is trimmed and compared
// case-insensitively so `On`, `ON` and ` on ` from a deployment console all mean
// the same thing.
//
// Every surface that has to agree about whether groups are live reads the flag
// here: the chatroom route denies `groupId` requests when off, and the teaching
// courses route withholds the student group projection and reports the feature
// state to the client. Duplicating the comparison would let the API and the UI
// disagree after a single typo.
export function isLearningChatroomGroupsEnabled(env: Record<string, string | undefined>) {
  return env.UAIS_LEARNING_CHATROOM_GROUPS_MODE?.trim().toLowerCase() === "on";
}
