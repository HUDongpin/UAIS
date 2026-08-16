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

/**
 * True when the message names at least one agent on this roster.
 *
 * Exported so a caller can decide whether to start a round AT ALL, using the
 * exact matcher the director will use once the round starts. A second,
 * independent implementation at the call site would eventually disagree with
 * this one, and the disagreement would show up as an agent that answers a
 * message nobody addressed - or worse, one that stays silent when addressed.
 *
 * Note this deliberately answers a different question from `selectNextAgent`:
 * that function's job is "who speaks next in a round", and with no mention it
 * still nominates an agent by priority. Whether a round should happen is the
 * caller's decision, not the director's.
 */
export function hasMentionedAgent(agents: UaisAgentConfig[], content: string) {
  return findMentionedAgentsInOrder(agents, content).length > 0;
}

/**
 * The ids this message addresses, in the order it addresses them.
 *
 * Same matcher, same roster, one more shape. The chatroom UI needs the ids and
 * not just the boolean - it marks exactly the agents a send is waiting on - and
 * a second client-side implementation is precisely the drift this module exists
 * to prevent: the browser would show "thinking" for an agent the server never
 * dispatched, or stay silent for one it did.
 */
export function findMentionedAgentIds(agents: UaisAgentConfig[], content: string) {
  return findMentionedAgentsInOrder(agents, content).map((agent) => agent.id);
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
    const index = findFirstAddressedTokenIndex(content, token);
    if (index < 0) {
      continue;
    }
    if (firstIndex < 0 || index < firstIndex) {
      firstIndex = index;
    }
  }

  return firstIndex;
}

/**
 * Index of the first occurrence of `token` that is actually ADDRESSED to the
 * agent, or -1.
 *
 * A bare `indexOf` treated every appearance of a handle as a summons, and a
 * chatroom round costs real money: pasting a classmate's earlier line, quoting
 * the room's own transcript, or typing an address like `peter@MathTA.example`
 * each bought a live completion nobody asked for. So a match counts only when
 * the handle is written as a mention:
 *
 * - The `@` must be there. Rosters spell their handles with it, but a roster that
 *   ever carries a bare handle still needs the `@` immediately before it, so
 *   quoted prose naming an agent without addressing it stays silent.
 * - The `@` must not continue an ASCII word, which is what rules out email-like
 *   text. Only ASCII, deliberately: `请@研究助教帮忙` is how a mention is
 *   ordinarily typed in Chinese, and a CJK character before the `@` is a normal
 *   sentence, not a local-part.
 * - An ASCII handle must not continue into another word character, so `@MathTA`
 *   does not fire inside `@MathTAlk`. A CJK handle needs no trailing rule at all
 *   - every following character is already a boundary - which is exactly why
 *   this cannot be written as `\b`.
 */
function findFirstAddressedTokenIndex(content: string, token: string) {
  const prefixed = token.startsWith("@");
  let searchFrom = 0;
  for (;;) {
    const index = content.indexOf(token, searchFrom);
    if (index < 0) {
      return -1;
    }
    const mentionIndex = prefixed ? index : index - 1;
    if (
      mentionIndex >= 0 &&
      content.charAt(mentionIndex) === "@" &&
      isMentionStartBoundary(content.charAt(mentionIndex - 1)) &&
      isMentionEndBoundary(token, content.charAt(index + token.length))
    ) {
      return mentionIndex;
    }
    searchFrom = index + 1;
  }
}

function isMentionStartBoundary(previousCharacter: string) {
  return previousCharacter === "" || !isAsciiWordCharacter(previousCharacter);
}

function isMentionEndBoundary(token: string, nextCharacter: string) {
  if (!isAsciiWordCharacter(token.charAt(token.length - 1))) {
    return true;
  }
  return nextCharacter === "" || !isAsciiWordCharacter(nextCharacter);
}

function isAsciiWordCharacter(character: string) {
  return /^[A-Za-z0-9_]$/.test(character);
}
