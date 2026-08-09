// Single reader for the learning-chatroom group feature flag (plan D9,
// `UAIS_LEARNING_CHATROOM_GROUPS_MODE`, active-production tier, default off).
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

const enabledValue = "on";
// A set-but-not-`on` value is the dangerous case: the deployment believes group
// rooms are live and every surface quietly serves the old behaviour. Unset is
// not warned about, because unset is the documented default.
const warnedValues = new Set<string>();

export function isLearningChatroomGroupsEnabled(env: Record<string, string | undefined>) {
  const raw = env.UAIS_LEARNING_CHATROOM_GROUPS_MODE;
  const normalized = raw?.trim().toLowerCase() ?? "";
  if (normalized === enabledValue) {
    return true;
  }

  if (normalized !== "") {
    warnMisconfiguredGroupsMode(normalized);
  }
  return false;
}

/**
 * Turns a silent misconfiguration into a visible one.
 *
 * The flag is read on nearly every request, so this logs once per distinct
 * value per process rather than per call: enough for the mistake to appear in
 * deployment logs the first time a learner opens the room, without turning a
 * warning into noise.
 */
function warnMisconfiguredGroupsMode(normalized: string) {
  if (warnedValues.has(normalized)) {
    return;
  }
  warnedValues.add(normalized);
  console.warn("[learning-chatroom]", {
    phase: "feature-flag",
    message:
      "UAIS_LEARNING_CHATROOM_GROUPS_MODE is set but is not the literal `on`; group rooms stay off.",
    // The value is a mode name rather than a secret, and seeing `true` in the
    // log is what makes the mistake obvious.
    configuredValue: normalized,
    expectedValue: enabledValue,
    responsibleSession: "S12",
  });
}

/** Test seam: the once-per-process warning is process state. */
export function resetLearningChatroomGroupsFlagWarningsForTesting() {
  warnedValues.clear();
}
