export type LiveProviderApprovalInput = {
  request: Request;
  env: Record<string, string | undefined>;
  liveProviderApproved: boolean | undefined;
};

export const LIVE_APPROVAL_HEADER = "x-uais-live-ai-approval";
export const LIVE_APPROVAL_ENV = "UAIS_LIVE_AI_APPROVAL_TOKEN";

export function assertLiveProviderApproval(input: LiveProviderApprovalInput) {
  if (input.liveProviderApproved !== true) {
    throw new Error("liveProviderApproved=true is required for live provider calls.");
  }

  const expectedToken = input.env[LIVE_APPROVAL_ENV];
  if (!expectedToken) {
    throw new Error(`${LIVE_APPROVAL_ENV} is required for live provider calls.`);
  }

  if (input.request.headers.get(LIVE_APPROVAL_HEADER) !== expectedToken) {
    throw new Error(`A valid ${LIVE_APPROVAL_HEADER} header is required for live provider calls.`);
  }
}
