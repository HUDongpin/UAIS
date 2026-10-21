import { createHash } from "node:crypto";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import type { UaisLangGraphActor } from "@/lib/ai/langgraph-runtime/runtime";

export function createLearningGuideActor(
  appSession: Pick<UaisAppSessionUser, "account" | "role">,
): UaisLangGraphActor {
  const role = appSession.role === "teacher"
    ? "educator"
    : appSession.role === "student" ? "learner" : "admin";
  // Accounts are case-insensitive principals. Hash their complete identity:
  // replacing punctuation or truncating a long account merges distinct users.
  const identity = createHash("sha256")
    .update(JSON.stringify([appSession.role, appSession.account.trim().toLowerCase()]))
    .digest("hex");
  return { actorId: `app-session-v2-${role}-${identity}`, role };
}
