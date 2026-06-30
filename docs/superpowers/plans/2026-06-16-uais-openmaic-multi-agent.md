# UAIS OpenMAIC-Style Multi-Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first UAIS-native OpenMAIC-style multi-agent framework, provider routing, and Qwen voice/PPT narration contracts.

**Architecture:** Add a small domain layer under `src/lib/ai/` that mirrors OpenMAIC's director-and-agent-loop pattern without copying its large UI/editor stack. Provider responsibilities stay typed and server-safe: DeepSeek for text reasoning, Alibaba Qwen/Model Studio for multimodal, image, voice cloning, and PPT narration.

**Tech Stack:** Next.js App Router, TypeScript strict mode, Vitest, existing UAIS data model, future server-only route handlers.

---

## File Structure

- Create `src/lib/ai/orchestration/types.ts`: shared agent, message, decision, event, and loop types.
- Create `src/lib/ai/orchestration/director.ts`: deterministic director helper that handles mentions, single-agent dispatch, user cue, and end decisions.
- Create `src/lib/ai/orchestration/agent-loop.ts`: bounded loop runner with injectable agent responder for tests and future provider calls.
- Create `src/lib/ai/providers/registry.ts`: typed provider-role registry and redacted readiness helpers.
- Create `src/lib/ai/voice/ppt-narration.ts`: voice clone and PPT narration job validation/contracts.
- Create `tests/ai-orchestration.test.ts`: director and loop coverage.
- Create `tests/ai-providers-and-voice.test.ts`: provider role and Qwen voice/PPT contract coverage.

## Task 1: Orchestration Contracts

**Files:**
- Create: `tests/ai-orchestration.test.ts`
- Create: `src/lib/ai/orchestration/types.ts`
- Create: `src/lib/ai/orchestration/director.ts`
- Create: `src/lib/ai/orchestration/agent-loop.ts`

- [ ] **Step 1: Write failing orchestration tests**

```ts
import { describe, expect, it } from "vitest";
import { runAgentLoop, selectNextAgent } from "@/lib/ai/orchestration/agent-loop";
import type { UaisAgentConfig, UaisChatMessage } from "@/lib/ai/orchestration/types";

const agents: UaisAgentConfig[] = [
  { id: "teacher", handle: "@教师", name: "教师", role: "teacher", providerRole: "text-reasoning", priority: 10, allowedActions: ["respond"] },
  { id: "methods", handle: "@方法顾问", name: "方法顾问", role: "assistant", providerRole: "text-reasoning", priority: 7, allowedActions: ["respond"] },
];

describe("UAIS multi-agent orchestration", () => {
  it("routes an explicit mention to the matching agent", () => {
    const messages: UaisChatMessage[] = [{ id: "m1", role: "student", content: "变量怎么定？@方法顾问" }];
    expect(selectNextAgent({ agents, messages, previousTurns: [] })).toEqual({
      type: "agent",
      agentId: "methods",
      reason: "explicit-mention",
    });
  });

  it("runs a bounded director-agent loop until the user is cued", async () => {
    const result = await runAgentLoop({
      agents,
      messages: [{ id: "m1", role: "student", content: "请帮我规划研究设计" }],
      maxAgentTurns: 2,
      respond: async (agent) => ({
        agentId: agent.id,
        content: `${agent.name} response`,
        actions: [],
      }),
    });

    expect(result.status).toBe("cue-user");
    expect(result.turns).toHaveLength(1);
    expect(result.events.map((event) => event.type)).toEqual(["agent-start", "agent-end", "cue-user"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/ai-orchestration.test.ts`

Expected: FAIL because `@/lib/ai/orchestration/agent-loop` does not exist.

- [ ] **Step 3: Implement orchestration contracts**

Create the files listed above with typed decisions, a mention-aware `selectNextAgent`, and a bounded `runAgentLoop`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/ai-orchestration.test.ts`

Expected: PASS.

- [ ] **Step 5: Git checkpoint**

Do not commit in this UAIS worktree unless the owner explicitly authorizes Git commits. Record changed files in the final handoff instead.

## Task 2: Provider Registry And Voice/PPT Contracts

**Files:**
- Create: `tests/ai-providers-and-voice.test.ts`
- Create: `src/lib/ai/providers/registry.ts`
- Create: `src/lib/ai/voice/ppt-narration.ts`

- [ ] **Step 1: Write failing provider and voice tests**

```ts
import { describe, expect, it } from "vitest";
import { getProviderForRole, getRedactedProviderReadiness } from "@/lib/ai/providers/registry";
import { createPptNarrationJob, createTeacherVoiceCloneJob } from "@/lib/ai/voice/ppt-narration";

describe("UAIS AI provider registry", () => {
  it("maps text reasoning to DeepSeek and multimodal work to Qwen", () => {
    expect(getProviderForRole("text-reasoning").provider).toBe("deepseek");
    expect(getProviderForRole("multimodal").provider).toBe("qwen");
    expect(getProviderForRole("voice-clone").provider).toBe("qwen");
    expect(getProviderForRole("ppt-narration").provider).toBe("qwen");
  });

  it("reports readiness without exposing secret values", () => {
    const readiness = getRedactedProviderReadiness({
      DEEPSEEK_API_KEY: "secret-deepseek",
      DASHSCOPE_API_KEY: "secret-qwen",
    });

    expect(readiness).toEqual([
      { provider: "deepseek", requiredEnv: "DEEPSEEK_API_KEY", status: "present" },
      { provider: "qwen", requiredEnv: "DASHSCOPE_API_KEY", status: "present" },
    ]);
  });
});

describe("UAIS Qwen voice and PPT narration contracts", () => {
  it("accepts a consented 10-second teacher sample for voice cloning", () => {
    const job = createTeacherVoiceCloneJob({
      teacherId: "teacher-kang",
      consentConfirmed: true,
      sampleAssetId: "asset-voice-10s",
      sampleDurationSeconds: 10,
      language: "zh-CN",
      targetVoiceLabel: "Kang teacher PPT voice",
    });

    expect(job.provider).toBe("qwen");
    expect(job.status).toBe("queued");
  });

  it("rejects voice cloning samples shorter than 10 seconds", () => {
    expect(() =>
      createTeacherVoiceCloneJob({
        teacherId: "teacher-kang",
        consentConfirmed: true,
        sampleAssetId: "asset-short",
        sampleDurationSeconds: 9.9,
        language: "zh-CN",
        targetVoiceLabel: "short sample",
      }),
    ).toThrow("at least 10 seconds");
  });

  it("creates a PPT narration job only after a cloned voice is available", () => {
    const job = createPptNarrationJob({
      courseId: "research-methods",
      pptAssetId: "ppt-unit-3",
      clonedVoiceId: "voice-qwen-redacted",
      language: "zh-CN",
      slideScripts: [
        { slideId: "s1", narrationText: "今天我们学习研究问题。" },
        { slideId: "s2", narrationText: "请观察变量之间的关系。" },
      ],
    });

    expect(job.provider).toBe("qwen");
    expect(job.slideCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/ai-providers-and-voice.test.ts`

Expected: FAIL because provider and voice modules do not exist.

- [ ] **Step 3: Implement provider registry and job contracts**

Create the files listed above. Return redacted present/missing status only. Do not read `All API Keys.docx`, `.env.local`, or real provider consoles.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/ai-providers-and-voice.test.ts`

Expected: PASS.

- [ ] **Step 5: Run project checks**

Run: `npm run test` and `npm run lint`.

Expected: PASS or documented failures unrelated to these changes.

## Self-Review

- Spec coverage: The plan covers OpenMAIC-style multi-agent orchestration, provider role separation, Qwen voice cloning, PPT narration contracts, and secret-safe readiness reporting.
- Placeholder scan: No placeholder steps remain.
- Type consistency: Provider role names are consistent across test and implementation tasks.
