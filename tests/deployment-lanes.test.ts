import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getUaisDeploymentLaneReadiness } from "@/lib/release/deployment-lanes";

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("B-09 deployment lanes", () => {
  it("blocks production readiness when preview or staging evidence is missing", () => {
    const readiness = getUaisDeploymentLaneReadiness([
      {
        lane: "production",
        urlPresent: true,
        envApplied: true,
        healthzPassed: true,
        authSmokePassed: true,
        criticalFlowSmokePassed: true,
      },
    ]);

    expect(readiness.status).toBe("blocked");
    expect(readiness.promotionOrder).toEqual(["preview", "staging", "production"]);
    expect(readiness.blockedReasons).toContain(
      "production:preview-and-staging-required-before-production",
    );
    expect(readiness.redaction).toEqual({
      valuesRedacted: true,
      deploymentUrlsOmitted: true,
      secretValuesOmitted: true,
    });
  });

  it("marks the deployment lane chain ready only when preview, staging, and production all pass", () => {
    const passingLane = {
      urlPresent: true,
      envApplied: true,
      healthzPassed: true,
      authSmokePassed: true,
      criticalFlowSmokePassed: true,
    };
    const readiness = getUaisDeploymentLaneReadiness([
      { lane: "preview", ...passingLane },
      { lane: "staging", ...passingLane },
      { lane: "production", ...passingLane },
    ]);

    expect(readiness.status).toBe("ready");
    expect(readiness.blockedReasons).toEqual([]);
    expect(readiness.lanes.every((lane) => lane.status === "ready")).toBe(true);
  });

  it("documents the preview to staging to production contract in operator docs", () => {
    const runbook = readProjectFile("docs/runbooks/staging-preview.md");
    const readme = readProjectFile("README.md");
    const checklist = readProjectFile("docs/runbooks/pre-deploy-checklist.md");
    const architecture = readProjectFile("docs/architecture-map.md");

    expect(runbook).toContain("Preview deployment");
    expect(runbook).toContain("Staging alias");
    expect(runbook).toContain("Production readiness is blocked");
    expect(runbook).toContain("UAIS_DEPLOYMENT_ENV=staging");
    expect(readme).toContain("docs/runbooks/staging-preview.md");
    expect(checklist).toContain("docs/runbooks/staging-preview.md");
    expect(architecture).toContain("src/lib/release/deployment-lanes.ts");
  });
});
