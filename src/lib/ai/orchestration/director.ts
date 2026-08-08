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

  const lastStudentMessage = [...messages].reverse().find((message) => message.role === "student");
  const mentionedAgents = lastStudentMessage
    ? findMentionedAgentsInOrder(agents, lastStudentMessage.content)
    : [];

  if (mentionedAgents.length > 0) {
    // Every mentioned agent answers once, in the order the learner mentioned
    // them. Control returns to the learner only after the last mention.
    const answeredAgentIds = new Set(previousTurns.map((turn) => turn.agentId));
    const nextMentionedAgent = mentionedAgents.find(
      (agent) => !answeredAgentIds.has(agent.id),
    );

    if (nextMentionedAgent) {
      return {
        type: "agent",
        agentId: nextMentionedAgent.id,
        reason: "explicit-mention",
      };
    }

    return { type: "cue-user", reason: "agent-answered" };
  }

  if (previousTurns.length > 0) {
    return { type: "cue-user", reason: "agent-answered" };
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

function findMentionedAgentsInOrder(agents: UaisAgentConfig[], content: string) {
  return agents
    .map((agent, rosterIndex) => ({
      agent,
      rosterIndex,
      mentionIndex: findFirstMentionIndex(agent, content),
    }))
    .filter((candidate) => candidate.mentionIndex >= 0)
    .sort((left, right) =>
      left.mentionIndex === right.mentionIndex
        ? left.rosterIndex - right.rosterIndex
        : left.mentionIndex - right.mentionIndex,
    )
    .map((candidate) => candidate.agent);
}

function findFirstMentionIndex(agent: UaisAgentConfig, content: string) {
  const mentionTokens = [agent.handle, ...(agent.aliases ?? [])].filter(
    (token): token is string => typeof token === "string" && token.length > 0,
  );

  let firstIndex = -1;
  for (const token of mentionTokens) {
    const index = content.indexOf(token);
    if (index < 0) {
      continue;
    }
    if (firstIndex < 0 || index < firstIndex) {
      firstIndex = index;
    }
  }

  return firstIndex;
}
