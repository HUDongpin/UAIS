import {
  resolveAiRequestRateLimitCount,
  resolveAiRequestRateLimitMode,
} from "./ai-request-rate-limit";

// A foreground room polls 24 times/minute. Ten thousand reads permit several
// classes in one day while retaining the independent 30/minute storage guard.
// Provider-spend limits deliberately do not share this configuration.
export function readLearningChatroomHistoryRateLimitConfig(
  env: Record<string, string | undefined>,
) {
  return {
    mode: resolveAiRequestRateLimitMode(
      env.UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_MODE,
    ),
    windows: [
      {
        id: "per-minute",
        limit: resolveAiRequestRateLimitCount(
          env.UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_MINUTE,
          30,
        ),
        windowMs: 60_000,
      },
      {
        id: "per-day",
        limit: resolveAiRequestRateLimitCount(
          env.UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_DAY,
          10_000,
        ),
        windowMs: 86_400_000,
      },
    ],
  };
}
