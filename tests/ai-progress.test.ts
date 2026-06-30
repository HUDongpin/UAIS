import { describe, expect, it } from "vitest";
import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
  getResponsibleProgressAgent,
} from "@/lib/ai/progress/responsible-progress";

describe("UAIS responsible progress projection", () => {
  it("maps responsible sessions to stable progress agents", () => {
    expect(getResponsibleProgressAgent("S07", "voice-clone")).toEqual({
      id: "s07-ai-agent-model",
      name: "S07 AI Agent Model",
      providerRole: "voice-clone",
    });
    expect(getResponsibleProgressAgent("S12", "ppt-narration")).toEqual({
      id: "s12-backend-api-platform",
      name: "S12 Backend/API Platform",
      providerRole: "ppt-narration",
    });
    expect(getResponsibleProgressAgent("S19", "voice-clone")).toEqual({
      id: "s19-api-configuration",
      name: "S19 API Configuration",
      providerRole: "voice-clone",
    });
    expect(getResponsibleProgressAgent("S24", "ppt-narration")).toEqual({
      id: "s24-asset-export-quality",
      name: "S24 Asset and Export Quality",
      providerRole: "ppt-narration",
    });
    expect(getResponsibleProgressAgent("S22", "ppt-narration")).toEqual({
      id: "s22-build-quality",
      name: "S22 Build Quality",
      providerRole: "ppt-narration",
    });
  });

  it("builds display-safe progress items with deterministic ids", () => {
    expect(
      createResponsibleProgressItem({
        index: 2,
        type: "qwen-ppt-narration",
        status: "queued",
        responsibleSession: "S07",
        providerRole: "ppt-narration",
        progressText: "S07 AI Agent Model prepared Qwen PPT narration for 1 slide.",
      }),
    ).toEqual({
      id: "progress-3",
      type: "qwen-ppt-narration",
      status: "queued",
      responsibleSession: "S07",
      responsibleAgent: {
        id: "s07-ai-agent-model",
        name: "S07 AI Agent Model",
        providerRole: "ppt-narration",
      },
      progressText: "S07 AI Agent Model prepared Qwen PPT narration for 1 slide.",
    });
  });

  it("allows display-safe progress text", () => {
    expect(() =>
      assertResponsibleProgressIsDisplaySafe([
        createResponsibleProgressItem({
          index: 0,
          type: "qwen-voice-clone-submit",
          status: "submitted",
          responsibleSession: "S07",
          providerRole: "voice-clone",
          progressText:
            "S07 AI Agent Model submitted the 10-second teacher voice sample to Qwen voice clone.",
        }),
      ]),
    ).not.toThrow();
  });

  it("requires Codex-visible progress text to name the responsible agent", () => {
    expect(() =>
      assertResponsibleProgressIsDisplaySafe([
        createResponsibleProgressItem({
          index: 0,
          type: "qwen-voice-clone-submit",
          status: "submitted",
          responsibleSession: "S07",
          providerRole: "voice-clone",
          progressText: "Submitted the 10-second teacher voice sample to Qwen voice clone.",
        }),
      ]),
    ).toThrow("Progress item must name its responsible agent.");
  });

  it("rejects progress text or metadata that exposes secrets, local paths, or raw audio", () => {
    const unsafeProgress = [
      createResponsibleProgressItem({
        index: 0,
        type: "qwen-voice-clone-submit",
        status: "submitted",
        responsibleSession: "S07",
        providerRole: "voice-clone",
        progressText: "Leaked data: data:audio/mp4;base64,ZmFrZS1hdWRpbw==",
      }),
      {
        ...createResponsibleProgressItem({
          index: 1,
          type: "qwen-private-voice",
          status: "ready",
          responsibleSession: "S12",
          providerRole: "voice-clone",
          progressText: "Voice reference is ready.",
        }),
        type: "/Users/dongpinhu/Library/Containers/sample.m4a",
      },
      {
        ...createResponsibleProgressItem({
          index: 2,
          type: "approval-token",
          status: "ready",
          responsibleSession: "S19",
          providerRole: "voice-clone",
          progressText: "Approval is ready.",
        }),
        status: "UAIS_LIVE_AI_APPROVAL_TOKEN=secret-live-token",
      },
      {
        ...createResponsibleProgressItem({
          index: 3,
          type: "private-voice-id",
          status: "ready",
          responsibleSession: "S24",
          providerRole: "ppt-narration",
          progressText: "voice-qwen-private",
        }),
      },
    ];

    expect(() => assertResponsibleProgressIsDisplaySafe(unsafeProgress)).toThrow(
      "Progress item contains non-display-safe data.",
    );
  });
});
