import type { UaisProviderRole } from "@/lib/ai/orchestration/types";
import { QWEN_REALTIME_VOICE_CLONE_MODEL } from "@/lib/ai/providers/qwen-models";

export type UaisProviderId = "deepseek" | "qwen";

export type UaisProviderRoleConfig = {
  role: UaisProviderRole;
  provider: UaisProviderId;
  requiredEnv: "DEEPSEEK_API_KEY" | "DASHSCOPE_API_KEY";
  optionalEnv: string[];
  defaultModel: string;
};

export type RedactedProviderReadiness = {
  provider: UaisProviderId;
  requiredEnv: UaisProviderRoleConfig["requiredEnv"];
  status: "present" | "missing";
};

const providerRoles: Record<UaisProviderRole, UaisProviderRoleConfig> = {
  "text-reasoning": {
    role: "text-reasoning",
    provider: "deepseek",
    requiredEnv: "DEEPSEEK_API_KEY",
    optionalEnv: ["DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"],
    defaultModel: "deepseek-v4-flash",
  },
  multimodal: {
    role: "multimodal",
    provider: "qwen",
    requiredEnv: "DASHSCOPE_API_KEY",
    optionalEnv: ["DASHSCOPE_BASE_URL", "QWEN_MULTIMODAL_MODEL"],
    defaultModel: "qwen3.5-omni-plus",
  },
  "image-generation": {
    role: "image-generation",
    provider: "qwen",
    requiredEnv: "DASHSCOPE_API_KEY",
    optionalEnv: ["DASHSCOPE_BASE_URL", "QWEN_IMAGE_MODEL"],
    defaultModel: "qwen-image-2.0",
  },
  "voice-clone": {
    role: "voice-clone",
    provider: "qwen",
    requiredEnv: "DASHSCOPE_API_KEY",
    optionalEnv: ["DASHSCOPE_BASE_URL", "QWEN_TTS_MODEL"],
    defaultModel: QWEN_REALTIME_VOICE_CLONE_MODEL,
  },
  "ppt-narration": {
    role: "ppt-narration",
    provider: "qwen",
    requiredEnv: "DASHSCOPE_API_KEY",
    optionalEnv: ["DASHSCOPE_BASE_URL", "QWEN_TTS_MODEL"],
    defaultModel: QWEN_REALTIME_VOICE_CLONE_MODEL,
  },
};

export function getProviderForRole(role: UaisProviderRole): UaisProviderRoleConfig {
  return providerRoles[role];
}

export function listProviderRoleConfigs(): UaisProviderRoleConfig[] {
  return Object.values(providerRoles);
}

export function getRedactedProviderReadiness(
  env: Record<string, string | undefined>,
): RedactedProviderReadiness[] {
  const uniqueProviders = new Map<UaisProviderId, UaisProviderRoleConfig>();

  for (const config of listProviderRoleConfigs()) {
    if (!uniqueProviders.has(config.provider)) {
      uniqueProviders.set(config.provider, config);
    }
  }

  return Array.from(uniqueProviders.values()).map((config) => ({
    provider: config.provider,
    requiredEnv: config.requiredEnv,
    status: env[config.requiredEnv] ? "present" : "missing",
  }));
}
