import type { UaisProviderRole } from "@/lib/ai/orchestration/types";

export type UaisResponsibleSession = "S07" | "S12" | "S19" | "S22" | "S24";

export type UaisResponsibleProgressAgent = {
  id: string;
  name: string;
  providerRole: UaisProviderRole;
};

export type UaisResponsibleProgressItem = {
  id: string;
  type: string;
  status: string;
  responsibleSession: UaisResponsibleSession;
  responsibleAgent: UaisResponsibleProgressAgent;
  progressText: string;
};

export function getResponsibleProgressAgent(
  session: UaisResponsibleSession,
  providerRole: UaisProviderRole,
): UaisResponsibleProgressAgent {
  const owner = RESPONSIBLE_PROGRESS_OWNERS[session];
  return {
    ...owner,
    providerRole,
  };
}

export function createResponsibleProgressItem(input: {
  index: number;
  type: string;
  status: string;
  responsibleSession: UaisResponsibleSession;
  providerRole: UaisProviderRole;
  progressText: string;
}): UaisResponsibleProgressItem {
  return {
    id: `progress-${input.index + 1}`,
    type: input.type,
    status: input.status,
    responsibleSession: input.responsibleSession,
    responsibleAgent: getResponsibleProgressAgent(
      input.responsibleSession,
      input.providerRole,
    ),
    progressText: input.progressText,
  };
}

export function assertResponsibleProgressIsDisplaySafe<T extends readonly unknown[]>(
  progress: T,
): T {
  const serialized = JSON.stringify(progress);
  if (UNSAFE_PROGRESS_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("Progress item contains non-display-safe data.");
  }

  for (const item of progress) {
    if (!isRecord(item) || typeof item.progressText !== "string") {
      continue;
    }

    const agent = item.responsibleAgent;
    if (!isRecord(agent) || typeof agent.name !== "string") {
      continue;
    }

    if (!item.progressText.includes(agent.name)) {
      throw new Error("Progress item must name its responsible agent.");
    }
  }

  return progress;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const RESPONSIBLE_PROGRESS_OWNERS: Record<UaisResponsibleSession, { id: string; name: string }> = {
  S07: {
    id: "s07-ai-agent-model",
    name: "S07 AI Agent Model",
  },
  S12: {
    id: "s12-backend-api-platform",
    name: "S12 Backend/API Platform",
  },
  S19: {
    id: "s19-api-configuration",
    name: "S19 API Configuration",
  },
  S22: {
    id: "s22-build-quality",
    name: "S22 Build Quality",
  },
  S24: {
    id: "s24-asset-export-quality",
    name: "S24 Asset and Export Quality",
  },
};

const UNSAFE_PROGRESS_PATTERNS = [
  /sk-[A-Za-z0-9]/,
  /(?:DASHSCOPE_API_KEY|DEEPSEEK_API_KEY|UAIS_LIVE_AI_APPROVAL_TOKEN|UAIS_AI_ACCESS_SIGNING_SECRET|UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET|UAIS_TEACHER_AUTH_ISSUER_SECRET)\s*=\s*[^"',}\]\s]+/,
  /voice-qwen-private/,
  /\/Users\/dongpinhu\/Library\/Containers/,
  /data:audio\/[^"',}\]\s]+base64/i,
  /audioBase64/i,
];
