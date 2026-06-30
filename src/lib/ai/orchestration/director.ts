import type {
  UaisAgentConfig,
  UaisAgentTurn,
  UaisChatMessage,
  UaisDirectorDecision,
} from "./types";

export type SelectNextAgentInput = {
  agents: UaisAgentConfig[];
  messages: UaisChatMessage[];
  previousTurns: UaisAgentTurn[];
};

export function selectNextAgent({
  agents,
  messages,
  previousTurns,
}: SelectNextAgentInput): UaisDirectorDecision {
  if (agents.length === 0) {
    return { type: "end", reason: "no-agents" };
  }

  if (previousTurns.length > 0) {
    return { type: "cue-user", reason: "agent-answered" };
  }

  const lastStudentMessage = [...messages].reverse().find((message) => message.role === "student");
  const mentionedAgent = lastStudentMessage
    ? agents.find((agent) => lastStudentMessage.content.includes(agent.handle))
    : undefined;

  if (mentionedAgent) {
    return {
      type: "agent",
      agentId: mentionedAgent.id,
      reason: "explicit-mention",
    };
  }

  if (agents.length === 1) {
    return {
      type: "agent",
      agentId: agents[0].id,
      reason: "single-agent",
    };
  }

  const [highestPriorityAgent] = [...agents].sort((a, b) => b.priority - a.priority);
  return {
    type: "agent",
    agentId: highestPriorityAgent.id,
    reason: "priority",
  };
}
