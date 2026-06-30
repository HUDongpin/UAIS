export type QwenVoiceCloneProviderStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

export type VoiceCloneTaskStatusInput = {
  providerTaskId: string;
  providerStatus: QwenVoiceCloneProviderStatus;
  clonedVoiceId?: string;
};

export type VoiceCloneTaskStatus =
  | {
      provider: "qwen";
      providerRole: "voice-clone";
      providerTaskId: string;
      status: "ready";
      clonedVoiceId: string;
      nextAction: "create-ppt-narration";
    }
  | {
      provider: "qwen";
      providerRole: "voice-clone";
      providerTaskId: string;
      status: "submitted" | "processing" | "failed";
      nextAction: "poll-qwen-voice-clone-task" | "review-provider-error";
    };

export function createVoiceCloneTaskStatus(
  input: VoiceCloneTaskStatusInput,
): VoiceCloneTaskStatus {
  if (!input.providerTaskId.trim()) {
    throw new Error("Qwen voice clone provider task id is required.");
  }

  if (input.providerStatus === "SUCCEEDED") {
    if (!input.clonedVoiceId?.trim()) {
      throw new Error("A cloned voice id is required when the Qwen voice clone task succeeds.");
    }

    return {
      provider: "qwen",
      providerRole: "voice-clone",
      providerTaskId: input.providerTaskId,
      status: "ready",
      clonedVoiceId: input.clonedVoiceId,
      nextAction: "create-ppt-narration",
    };
  }

  if (input.providerStatus === "FAILED" || input.providerStatus === "CANCELED") {
    return {
      provider: "qwen",
      providerRole: "voice-clone",
      providerTaskId: input.providerTaskId,
      status: "failed",
      nextAction: "review-provider-error",
    };
  }

  return {
    provider: "qwen",
    providerRole: "voice-clone",
    providerTaskId: input.providerTaskId,
    status: input.providerStatus === "PENDING" ? "submitted" : "processing",
    nextAction: "poll-qwen-voice-clone-task",
  };
}
