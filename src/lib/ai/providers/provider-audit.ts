import { LIVE_APPROVAL_HEADER } from "@/lib/ai/providers/live-approval";
import type { UaisProviderRole } from "@/lib/ai/orchestration/types";

export type LiveProviderAuditAction =
  | "chat-completion"
  | "voice-clone-submit"
  | "voice-clone-status"
  | "voice-clone-revoke"
  | "ppt-narration-submit";

export type LiveProviderAuditEvent = {
  type: "live-provider-call";
  provider: "deepseek" | "qwen";
  providerRole: UaisProviderRole;
  action: LiveProviderAuditAction;
  approval: {
    mode: "server-token";
    header: typeof LIVE_APPROVAL_HEADER;
  };
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "ids-only";
  };
  subject?: Record<string, string>;
};

export function createLiveProviderAuditEvent(input: {
  provider: LiveProviderAuditEvent["provider"];
  providerRole: UaisProviderRole;
  action: LiveProviderAuditAction;
  subject?: Record<string, string | undefined>;
}): LiveProviderAuditEvent {
  const subject = compactSubject(input.subject);

  return {
    type: "live-provider-call",
    provider: input.provider,
    providerRole: input.providerRole,
    action: input.action,
    approval: {
      mode: "server-token",
      header: LIVE_APPROVAL_HEADER,
    },
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "ids-only",
    },
    ...(subject ? { subject } : {}),
  };
}

function compactSubject(subject: Record<string, string | undefined> | undefined) {
  if (!subject) {
    return undefined;
  }

  const entries = Object.entries(subject).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
