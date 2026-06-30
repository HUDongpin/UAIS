import { LIVE_APPROVAL_ENV } from "@/lib/ai/providers/live-approval";
import { getProviderForRole } from "@/lib/ai/providers/registry";
import {
  createTeacherVoiceSampleIntake,
  type TeacherVoiceSampleIntakeRequest,
} from "@/lib/ai/voice/sample-intake";

export type TeacherVoiceClonePreflightRequest = TeacherVoiceSampleIntakeRequest & {
  liveProviderApproved?: boolean;
  targetVoiceLabel?: string;
};

type VoiceClonePreflightResponsibleSession = "S07" | "S12" | "S19" | "S24";

type VoiceClonePreflightCheckId =
  | "s07-qwen-provider"
  | "s24-teacher-voice-sample"
  | "s24-target-voice-label"
  | "s19-dashscope-env"
  | "s19-live-approval-token"
  | "s12-live-approval";

export type VoiceClonePreflightCheck = {
  id: VoiceClonePreflightCheckId;
  responsibleSession: VoiceClonePreflightResponsibleSession;
  status: "ready" | "blocked";
  message: string;
};

export type TeacherVoiceClonePreflight = {
  provider: "qwen";
  providerRole: "voice-clone";
  status: "ready" | "blocked";
  nextAction: "submit-qwen-voice-clone" | "resolve-preflight-blockers";
  checks: VoiceClonePreflightCheck[];
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "ids-only";
  };
};

export function createTeacherVoiceClonePreflight(input: {
  request: TeacherVoiceClonePreflightRequest;
  env?: Record<string, string | undefined>;
  approvalHeader?: string | null;
}): TeacherVoiceClonePreflight {
  const env = input.env ?? {};
  const checks: VoiceClonePreflightCheck[] = [
    createProviderCheck(),
    createVoiceSampleCheck(input.request),
    createTargetVoiceLabelCheck(input.request.targetVoiceLabel),
    createDashScopeEnvCheck(env),
    createLiveApprovalTokenCheck(env),
    createLiveApprovalCheck({
      env,
      approvalHeader: input.approvalHeader,
      liveProviderApproved: input.request.liveProviderApproved,
    }),
  ];
  const status = checks.every((check) => check.status === "ready") ? "ready" : "blocked";

  return {
    provider: "qwen",
    providerRole: "voice-clone",
    status,
    nextAction: status === "ready" ? "submit-qwen-voice-clone" : "resolve-preflight-blockers",
    checks,
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "ids-only",
    },
  };
}

function createProviderCheck(): VoiceClonePreflightCheck {
  const provider = getProviderForRole("voice-clone");
  const ready = provider.provider === "qwen";

  return {
    id: "s07-qwen-provider",
    responsibleSession: "S07",
    status: ready ? "ready" : "blocked",
    message: ready
      ? "Voice cloning is assigned to Qwen."
      : "Voice cloning must be assigned to Qwen before live submission.",
  };
}

function createVoiceSampleCheck(
  request: TeacherVoiceClonePreflightRequest,
): VoiceClonePreflightCheck {
  try {
    createTeacherVoiceSampleIntake(request);
    return {
      id: "s24-teacher-voice-sample",
      responsibleSession: "S24",
      status: "ready",
      message: "Consented teacher audio metadata is ready for clone intake.",
    };
  } catch (error) {
    return {
      id: "s24-teacher-voice-sample",
      responsibleSession: "S24",
      status: "blocked",
      message: error instanceof Error ? error.message : "Teacher voice sample is not ready.",
    };
  }
}

function createTargetVoiceLabelCheck(targetVoiceLabel: string | undefined): VoiceClonePreflightCheck {
  const ready = typeof targetVoiceLabel === "string" && targetVoiceLabel.trim() !== "";

  return {
    id: "s24-target-voice-label",
    responsibleSession: "S24",
    status: ready ? "ready" : "blocked",
    message: ready
      ? "Target cloned voice label is present."
      : "Target cloned voice label is required before live submission.",
  };
}

function createDashScopeEnvCheck(env: Record<string, string | undefined>): VoiceClonePreflightCheck {
  const ready = hasValue(env.DASHSCOPE_API_KEY);

  return {
    id: "s19-dashscope-env",
    responsibleSession: "S19",
    status: ready ? "ready" : "blocked",
    message: ready
      ? "Qwen provider credential is configured."
      : "Qwen provider credential must be configured by S19 before live submission.",
  };
}

function createLiveApprovalTokenCheck(env: Record<string, string | undefined>): VoiceClonePreflightCheck {
  const ready = hasValue(env[LIVE_APPROVAL_ENV]);

  return {
    id: "s19-live-approval-token",
    responsibleSession: "S19",
    status: ready ? "ready" : "blocked",
    message: ready
      ? "Live approval token is configured."
      : "Live approval token must be configured by S19 before live submission.",
  };
}

function createLiveApprovalCheck(input: {
  env: Record<string, string | undefined>;
  approvalHeader?: string | null;
  liveProviderApproved?: boolean;
}): VoiceClonePreflightCheck {
  const expectedToken = input.env[LIVE_APPROVAL_ENV];
  const approvalHeader = input.approvalHeader;
  let message = "Live approval flag and server header are present.";
  let ready = true;

  if (input.liveProviderApproved !== true) {
    ready = false;
    message = "liveProviderApproved must be true before live submission.";
  } else if (!hasValue(expectedToken)) {
    ready = false;
    message = "Server approval token is not configured.";
  } else if (!hasValue(approvalHeader)) {
    ready = false;
    message = "Live approval header is missing.";
  } else if (approvalHeader !== expectedToken) {
    ready = false;
    message = "Live approval header does not match the configured server token.";
  }

  return {
    id: "s12-live-approval",
    responsibleSession: "S12",
    status: ready ? "ready" : "blocked",
    message,
  };
}

function hasValue(value: string | undefined | null) {
  return typeof value === "string" && value.trim() !== "";
}
