export type UaisProviderRole =
  | "text-reasoning"
  | "multimodal"
  | "image-generation"
  | "voice-clone"
  | "ppt-narration";

export type UaisAgentRole = "teacher" | "assistant" | "student" | "specialist";

export type UaisAgentConfig = {
  id: string;
  handle: string;
  /**
   * Optional extra mention handles for the same agent, e.g. an English handle
   * paired with a Simplified Chinese primary handle. The director treats an
   * alias exactly like `handle` when it resolves mentions.
   */
  aliases?: string[];
  name: string;
  role: UaisAgentRole;
  providerRole: UaisProviderRole;
  priority: number;
  allowedActions: string[];
};

export type UaisChatMessage = {
  id: string;
  role: "student" | "agent" | "system";
  content: string;
  agentId?: string;
};

export type UaisResponsibleAgent = {
  id: string;
  handle: string;
  name: string;
  providerRole: UaisProviderRole;
};

export type UaisDirectorDecision =
  | {
      type: "agent";
      agentId: string;
      reason: "explicit-mention" | "single-agent" | "priority";
    }
  | {
      type: "cue-user";
      reason: "agent-answered";
    }
  | {
      type: "end";
      reason: "no-agents" | "max-turns";
    };

export type UaisAgentTurn = {
  agentId: string;
  content: string;
  actions: string[];
};

type UaisOrchestrationEventAudit = {
  responsibleSession: "S07";
  progressText: string;
  responsibleAgent?: UaisResponsibleAgent;
};

export type UaisOrchestrationEvent = UaisOrchestrationEventAudit &
  (
    | {
      type: "agent-start";
      agentId: string;
    }
    | {
      type: "agent-end";
      agentId: string;
      content: string;
      actions: string[];
    }
    | {
      type: "cue-user";
      fromAgentId?: string;
    }
    | {
      type: "end";
      reason: string;
    }
  );

export type UaisAgentLoopStatus = "cue-user" | "end" | "max-turns";
