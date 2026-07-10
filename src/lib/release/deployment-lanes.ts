export type UaisDeploymentLane = "preview" | "staging" | "production";

export type UaisDeploymentLaneEvidence = {
  lane: UaisDeploymentLane;
  urlPresent: boolean;
  envApplied: boolean;
  healthzPassed: boolean;
  authSmokePassed: boolean;
  criticalFlowSmokePassed: boolean;
};

export type UaisDeploymentLaneReadiness = {
  target: "uais-deployment-lanes";
  status: "ready" | "blocked";
  promotionOrder: UaisDeploymentLane[];
  lanes: Array<
    UaisDeploymentLaneEvidence & {
      status: "ready" | "blocked";
      blockedReasons: string[];
    }
  >;
  blockedReasons: string[];
  redaction: {
    valuesRedacted: true;
    deploymentUrlsOmitted: true;
    secretValuesOmitted: true;
  };
};

const promotionOrder: UaisDeploymentLane[] = ["preview", "staging", "production"];

export function getUaisDeploymentLaneReadiness(
  evidence: UaisDeploymentLaneEvidence[],
): UaisDeploymentLaneReadiness {
  const evidenceByLane = new Map(evidence.map((item) => [item.lane, item]));
  const lanes = promotionOrder.map((lane) => {
    const item =
      evidenceByLane.get(lane) ??
      ({
        lane,
        urlPresent: false,
        envApplied: false,
        healthzPassed: false,
        authSmokePassed: false,
        criticalFlowSmokePassed: false,
      } satisfies UaisDeploymentLaneEvidence);
    const blockedReasons = getLaneBlockedReasons(item);
    const status: "ready" | "blocked" = blockedReasons.length === 0 ? "ready" : "blocked";
    return {
      ...item,
      status,
      blockedReasons,
    };
  });
  const readyLaneSet = new Set(
    lanes.filter((lane) => lane.status === "ready").map((lane) => lane.lane),
  );
  const blockedReasons = [
    ...lanes.flatMap((lane) =>
      lane.blockedReasons.map((reason) => `${lane.lane}:${reason}`),
    ),
    ...(readyLaneSet.has("production") &&
    (!readyLaneSet.has("preview") || !readyLaneSet.has("staging"))
      ? ["production:preview-and-staging-required-before-production"]
      : []),
  ];

  return {
    target: "uais-deployment-lanes",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    promotionOrder,
    lanes,
    blockedReasons,
    redaction: {
      valuesRedacted: true,
      deploymentUrlsOmitted: true,
      secretValuesOmitted: true,
    },
  };
}

function getLaneBlockedReasons(evidence: UaisDeploymentLaneEvidence) {
  return [
    ...(evidence.urlPresent ? [] : ["deployment-url-missing"]),
    ...(evidence.envApplied ? [] : ["environment-values-not-applied"]),
    ...(evidence.healthzPassed ? [] : ["healthz-smoke-missing"]),
    ...(evidence.authSmokePassed ? [] : ["auth-smoke-missing"]),
    ...(evidence.criticalFlowSmokePassed ? [] : ["critical-flow-smoke-missing"]),
  ];
}
