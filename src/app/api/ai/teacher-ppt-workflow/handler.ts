import {
  assertResponsibleProgressIsDisplaySafe,
  createResponsibleProgressItem,
} from "@/lib/ai/progress/responsible-progress";
import {
  validateUaisAgentWorkflowGraph,
  type UaisAgentWorkflowGraphValidation,
} from "@/lib/ai/orchestration/workflow-graph";
import type { UaisAiAccessDecision } from "@/lib/server/ai-access-control";
import {
  assertUaisAiAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";
import type { UaisTeacherAiResourceOwnership } from "@/lib/server/ai-resource-grants";
import {
  createUaisTeacherAiOwnershipAdapter,
  createUaisTeacherAiOwnershipConsistencyReport,
} from "@/lib/server/teacher-ai-ownership-store";
import {
  readUaisAuthenticatedTeacherSessionFromSignedCookies,
} from "@/lib/server/teacher-auth-session";
import type { UaisAuthenticatedTeacherPrincipal } from "@/app/api/ai/session/handler";

type TeacherPptWorkflowGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  getAuthenticatedTeacherSession?: (
    request: Request,
  ) => Promise<UaisAuthenticatedTeacherPrincipal | undefined>;
  readTeacherAiOwnership?: (input: {
    teacherId: string;
    request: Request;
    authenticatedSession: UaisAuthenticatedTeacherPrincipal;
  }) => Promise<UaisTeacherAiResourceOwnership | undefined>;
  fetch?: typeof fetch;
};

type TeacherPptWorkflowStep =
  | {
      id: "voice-sample";
      status: "ready" | "missing";
      responsibleSession: "S24";
      sampleAssetId?: string;
    }
  | {
      id: "voice-clone";
      status: "ready" | "missing";
      responsibleSession: "S07";
      voiceRefId?: string;
    }
  | {
      id: "ppt-material";
      status: "ready" | "missing";
      responsibleSession: "S24";
      pptAssetId?: string;
    }
  | {
      id: "ppt-narration";
      status: "ready" | "missing";
      responsibleSession: "S24";
      audioManifestId?: string;
    };

type TeacherPptWorkflowStatus =
  | "needs-voice-sample"
  | "needs-voice-clone"
  | "needs-ppt-material"
  | "ready-for-ppt-narration"
  | "ready-for-downloads";

type TeacherPptWorkflowNextAction =
  | "submit-voice-sample"
  | "clone-teacher-voice"
  | "register-ppt-material"
  | "generate-ppt-narration"
  | "review-and-download-ppt-narration";

type TeacherPptWorkflow = {
  teacherId: string;
  courseId?: string;
  pptAssetId?: string;
  status: TeacherPptWorkflowStatus;
  nextAction: TeacherPptWorkflowNextAction;
  steps: TeacherPptWorkflowStep[];
  downloads?: {
    audioManifestId: string;
    exportDownloadUrl: string;
    audioDownloadPattern: string;
  };
  storagePolicy: "server-side-redacted-teacher-ppt-workflow-status";
  responsibleSession: "S12/S24";
  redaction: UaisAiAccessDecision["redaction"];
};

type TeacherPptSampleAsset = NonNullable<UaisTeacherAiResourceOwnership["sampleAssets"]>[number];
type TeacherPptAsset = NonNullable<UaisTeacherAiResourceOwnership["pptAssets"]>[number];
type TeacherPptVoiceRef = NonNullable<UaisTeacherAiResourceOwnership["clonedVoiceRefs"]>[number];
type TeacherPptAudioManifest = NonNullable<
  UaisTeacherAiResourceOwnership["audioManifests"]
>[number];

type TeacherPptOwnership = {
  courseIds: string[];
  sampleAssets: TeacherPptSampleAsset[];
  pptAssets: TeacherPptAsset[];
  clonedVoiceRefs: TeacherPptVoiceRef[];
  audioManifests: TeacherPptAudioManifest[];
};

type TeacherPptOwnershipChain = {
  courseId?: string;
  sampleAsset: TeacherPptSampleAsset;
  voiceRef: TeacherPptVoiceRef;
  pptAsset: TeacherPptAsset;
  audioManifest: TeacherPptAudioManifest;
};

type TeacherPptWorkflowAgentHandoffStatus = "completed" | "ready" | "blocked" | "pending";

type TeacherPptWorkflowAgentHandoff = {
  index: number;
  agentId:
    | "s12-auth-ownership-agent"
    | "s24-voice-sample-agent"
    | "s07-qwen-voice-clone-agent"
    | "s24-ppt-material-agent"
    | "s19-qwen-provider-agent"
    | "s24-ppt-narration-agent"
    | "s22-release-smoke-agent";
  handle: string;
  name: string;
  responsibleSession: "S07" | "S12" | "S19" | "S22" | "S24";
  providerRole: "voice-clone" | "ppt-narration";
  status: TeacherPptWorkflowAgentHandoffStatus;
  action:
    | "verify-signed-teacher-auth-and-ownership"
    | "verify-consented-voice-sample"
    | "verify-qwen-voice-reference"
    | "verify-ppt-material"
    | "verify-qwen-provider-env"
    | "verify-ppt-narration-assets"
    | "verify-deployed-teacher-workflow-route";
  dependsOn: TeacherPptWorkflowAgentHandoff["agentId"][];
  progressText: string;
};

type TeacherPptWorkflowAgentHandoffPlan = {
  framework: "openmaic-style-teacher-ppt-narration";
  status:
    | "blocked"
    | "ready-for-voice-clone"
    | "ready-for-ppt-material"
    | "ready-for-ppt-narration"
    | "ready-for-teacher-review";
  responsibleSession: "S07/S12/S19/S24/S22";
  graphValidation: UaisAgentWorkflowGraphValidation;
  nextAgent: TeacherPptWorkflowNextAgent;
  handoffs: TeacherPptWorkflowAgentHandoff[];
  redaction: UaisAiAccessDecision["redaction"];
};

type TeacherPptWorkflowNextAgent = {
  agentId:
    | TeacherPptWorkflowAgentHandoff["agentId"]
    | "s24-export-quality-agent";
  handle: string;
  name: string;
  responsibleSession: TeacherPptWorkflowAgentHandoff["responsibleSession"];
  providerRole: TeacherPptWorkflowAgentHandoff["providerRole"];
  action:
    | TeacherPptWorkflowAgentHandoff["action"]
    | "review-and-download-ppt-narration";
};

export function createTeacherPptWorkflowGetHandler(
  deps: TeacherPptWorkflowGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const getAuthenticatedTeacherSession =
    deps.getAuthenticatedTeacherSession ??
    createSignedCookieTeacherSessionAdapter({
      env,
      now: deps.now,
    });
  const readTeacherAiOwnership =
    deps.readTeacherAiOwnership ??
    createUaisTeacherAiOwnershipAdapter({
      env,
      fetch: deps.fetch,
    });

  return async function GET(request: Request) {
    try {
      if (!getAuthenticatedTeacherSession) {
        return Response.json(
          {
            error: "UAIS teacher PPT workflow reader is not configured.",
            access: denied("auth-adapter-not-configured"),
            progress: createTeacherPptWorkflowProgress({
              status: "not-configured",
              qwenEnvPresent: hasValue(env.DASHSCOPE_API_KEY),
            }),
          },
          { status: 501 },
        );
      }

      const authenticatedSession = await getAuthenticatedTeacherSession(request);
      if (!authenticatedSession) {
        return Response.json(
          {
            error: "UAIS teacher authentication is required.",
            access: denied("authenticated-session-required"),
            progress: createTeacherPptWorkflowProgress({
              status: "auth-required",
              qwenEnvPresent: hasValue(env.DASHSCOPE_API_KEY),
            }),
          },
          { status: 401 },
        );
      }
      const requestSearchParams = new URL(request.url).searchParams;
      assertUaisAiAccess({
        request,
        env,
        action: "teacher-ppt-workflow-read",
        resource: {
          teacherId: authenticatedSession.actorId,
          ...(safeQueryId(requestSearchParams.get("courseId"))
            ? { courseId: safeQueryId(requestSearchParams.get("courseId")) }
            : {}),
          ...(safeQueryId(requestSearchParams.get("pptAssetId"))
            ? { pptAssetId: safeQueryId(requestSearchParams.get("pptAssetId")) }
            : {}),
        },
        requireSignedSession: true,
      });
      const ownershipReader = readTeacherAiOwnership;
      if (!ownershipReader) {
        return Response.json(
          {
            error: "UAIS teacher PPT workflow reader is not configured.",
            access: denied("auth-adapter-not-configured"),
            progress: createTeacherPptWorkflowProgress({
              status: "not-configured",
              qwenEnvPresent: hasValue(env.DASHSCOPE_API_KEY),
            }),
          },
          { status: 501 },
        );
      }

      const ownership = await ownershipReader({
        teacherId: authenticatedSession.actorId,
        request,
        authenticatedSession,
      });
      const workflow = createTeacherPptWorkflow({
        teacherId: authenticatedSession.actorId,
        ownership,
        requestUrl: request.url,
      });
      const consistency = createUaisTeacherAiOwnershipConsistencyReport({
        teacherId: authenticatedSession.actorId,
        courseIds: ownership?.courseIds ?? [],
        sampleAssets: ownership?.sampleAssets ?? [],
        pptAssets: ownership?.pptAssets ?? [],
        clonedVoiceRefs: ownership?.clonedVoiceRefs ?? [],
        audioManifests: ownership?.audioManifests ?? [],
      });

      return Response.json({
        workflow,
        agentHandoffPlan: createTeacherPptWorkflowAgentHandoffPlan({
          workflow,
          qwenEnvPresent: hasValue(env.DASHSCOPE_API_KEY),
        }),
        consistency,
        progress: createTeacherPptWorkflowProgress({
          status: "ready",
          workflow,
          qwenEnvPresent: hasValue(env.DASHSCOPE_API_KEY),
        }),
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid UAIS teacher PPT workflow request.",
        },
        { status: 400 },
      );
    }
  };
}

function createSignedCookieTeacherSessionAdapter(input: {
  env: Record<string, string | undefined>;
  now?: Date;
}) {
  const secret = input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  if (!secret) {
    return undefined;
  }

  return async (request: Request) =>
    readUaisAuthenticatedTeacherSessionFromSignedCookies({
      request,
      secret,
      now: input.now,
    });
}

function createTeacherPptWorkflow(input: {
  teacherId: string;
  ownership: UaisTeacherAiResourceOwnership | undefined;
  requestUrl: string;
}): TeacherPptWorkflow {
  const searchParams = new URL(input.requestUrl).searchParams;
  const courseId = safeQueryId(searchParams.get("courseId"));
  const pptAssetId = safeQueryId(searchParams.get("pptAssetId"));
  const ownership = {
    teacherId: input.teacherId,
    courseIds: input.ownership?.courseIds ?? [],
    sampleAssets: input.ownership?.sampleAssets ?? [],
    pptAssets: input.ownership?.pptAssets ?? [],
    clonedVoiceRefs: input.ownership?.clonedVoiceRefs ?? [],
    audioManifests: input.ownership?.audioManifests ?? [],
  };
  const completeChain = selectCompleteTeacherPptOwnershipChain({
    ownership,
    courseId,
    pptAssetId,
  });

  const selectedCourseId =
    completeChain?.courseId ??
    (courseId && ownership.courseIds?.includes(courseId)
      ? courseId
      : ownership.courseIds?.[0]);
  const sampleAsset =
    completeChain?.sampleAsset ??
    ownership.sampleAssets?.find((asset) => !selectedCourseId || asset.courseId === selectedCourseId) ??
    ownership.sampleAssets?.[0];
  const voiceRef =
    completeChain?.voiceRef ??
    ownership.clonedVoiceRefs?.find(
      (reference) =>
        sampleAsset?.sampleAssetId && reference.sampleAssetId === sampleAsset.sampleAssetId,
    ) ?? ownership.clonedVoiceRefs?.[0];
  const pptAsset =
    completeChain?.pptAsset ??
    ownership.pptAssets?.find(
      (asset) =>
        (pptAssetId ? asset.pptAssetId === pptAssetId : true) &&
        (!selectedCourseId || asset.courseId === selectedCourseId),
    ) ?? ownership.pptAssets?.find((asset) => !pptAssetId || asset.pptAssetId === pptAssetId);
  const audioManifest =
    completeChain?.audioManifest ??
    ownership.audioManifests?.find(
      (manifest) =>
        (!selectedCourseId || manifest.courseId === selectedCourseId) &&
        (!pptAsset?.pptAssetId || manifest.pptAssetId === pptAsset.pptAssetId) &&
        (!voiceRef?.voiceRefId || manifest.voiceRefId === voiceRef.voiceRefId),
    ) ?? ownership.audioManifests?.[0];

  const steps: TeacherPptWorkflowStep[] = [
    {
      id: "voice-sample",
      status: sampleAsset ? "ready" : "missing",
      responsibleSession: "S24",
      ...(sampleAsset ? { sampleAssetId: sampleAsset.sampleAssetId } : {}),
    },
    {
      id: "voice-clone",
      status: voiceRef ? "ready" : "missing",
      responsibleSession: "S07",
      ...(voiceRef ? { voiceRefId: voiceRef.voiceRefId } : {}),
    },
    {
      id: "ppt-material",
      status: pptAsset ? "ready" : "missing",
      responsibleSession: "S24",
      ...(pptAsset ? { pptAssetId: pptAsset.pptAssetId } : {}),
    },
    {
      id: "ppt-narration",
      status: audioManifest ? "ready" : "missing",
      responsibleSession: "S24",
      ...(audioManifest ? { audioManifestId: audioManifest.audioManifestId } : {}),
    },
  ];
  const status = workflowStatusFromSteps(steps);
  const workflow: TeacherPptWorkflow = {
    teacherId: input.teacherId,
    ...(selectedCourseId ? { courseId: selectedCourseId } : {}),
    ...(pptAsset?.pptAssetId ? { pptAssetId: pptAsset.pptAssetId } : {}),
    status,
    nextAction: nextActionForStatus(status),
    steps,
    ...(audioManifest?.audioManifestId
      ? {
          downloads: {
            audioManifestId: audioManifest.audioManifestId,
            exportDownloadUrl: `/api/ai/ppt-narration/export/${audioManifest.audioManifestId}`,
            audioDownloadPattern: `/api/ai/ppt-narration/audio/${audioManifest.audioManifestId}/{audioId}`,
          },
        }
      : {}),
    storagePolicy: "server-side-redacted-teacher-ppt-workflow-status",
    responsibleSession: "S12/S24",
    redaction: createRedaction(),
  };
  assertWorkflowIsDisplaySafe(workflow);
  return workflow;
}

function selectCompleteTeacherPptOwnershipChain(input: {
  ownership: TeacherPptOwnership;
  courseId?: string;
  pptAssetId?: string;
}): TeacherPptOwnershipChain | undefined {
  for (const audioManifest of input.ownership.audioManifests) {
    if (
      input.pptAssetId &&
      audioManifest.pptAssetId &&
      audioManifest.pptAssetId !== input.pptAssetId
    ) {
      continue;
    }

    const pptAsset = findChainPptAsset(input.ownership, audioManifest, input.pptAssetId);
    const voiceRef = findChainVoiceRef(input.ownership, audioManifest);
    const sampleAsset = voiceRef
      ? findChainSampleAsset(input.ownership, voiceRef, audioManifest)
      : undefined;
    if (!pptAsset || !voiceRef || !sampleAsset) {
      continue;
    }
    if (input.pptAssetId && pptAsset.pptAssetId !== input.pptAssetId) {
      continue;
    }

    const courseId = audioManifest.courseId ?? pptAsset.courseId ?? sampleAsset.courseId;
    if (input.courseId && courseId !== input.courseId) {
      continue;
    }

    return {
      ...(courseId ? { courseId } : {}),
      sampleAsset,
      voiceRef,
      pptAsset,
      audioManifest,
    };
  }

  return undefined;
}

function findChainPptAsset(
  ownership: TeacherPptOwnership,
  audioManifest: TeacherPptAudioManifest,
  requestedPptAssetId: string | undefined,
) {
  if (audioManifest.pptAssetId) {
    return ownership.pptAssets.find((asset) => asset.pptAssetId === audioManifest.pptAssetId);
  }
  if (requestedPptAssetId) {
    return ownership.pptAssets.find((asset) => asset.pptAssetId === requestedPptAssetId);
  }
  if (audioManifest.courseId) {
    return ownership.pptAssets.find((asset) => asset.courseId === audioManifest.courseId);
  }
  return undefined;
}

function findChainVoiceRef(
  ownership: TeacherPptOwnership,
  audioManifest: TeacherPptAudioManifest,
) {
  return audioManifest.voiceRefId
    ? ownership.clonedVoiceRefs.find(
        (reference) => reference.voiceRefId === audioManifest.voiceRefId,
      )
    : undefined;
}

function findChainSampleAsset(
  ownership: TeacherPptOwnership,
  voiceRef: TeacherPptVoiceRef,
  audioManifest: TeacherPptAudioManifest,
) {
  if (voiceRef.sampleAssetId) {
    return ownership.sampleAssets.find(
      (asset) => asset.sampleAssetId === voiceRef.sampleAssetId,
    );
  }
  if (audioManifest.courseId) {
    return ownership.sampleAssets.find((asset) => asset.courseId === audioManifest.courseId);
  }
  return undefined;
}

function createTeacherPptWorkflowAgentHandoffPlan(input: {
  workflow: TeacherPptWorkflow;
  qwenEnvPresent: boolean;
}): TeacherPptWorkflowAgentHandoffPlan {
  const sampleReady = isWorkflowStepReady(input.workflow, "voice-sample");
  const voiceRefReady = isWorkflowStepReady(input.workflow, "voice-clone");
  const pptReady = isWorkflowStepReady(input.workflow, "ppt-material");
  const narrationReady = isWorkflowStepReady(input.workflow, "ppt-narration");
  const qwenReady = input.qwenEnvPresent;

  const handoffs: TeacherPptWorkflowAgentHandoff[] = [
    createAgentHandoff({
      index: 0,
      agentId: "s12-auth-ownership-agent",
      handle: "@s12",
      name: "S12 Backend/API Platform",
      responsibleSession: "S12",
      providerRole: "ppt-narration",
      status: "completed",
      action: "verify-signed-teacher-auth-and-ownership",
      dependsOn: [],
      progressText:
        "S12 Backend/API Platform verified signed teacher auth and server-side ownership before the PPT narration workflow advanced.",
    }),
    createAgentHandoff({
      index: 1,
      agentId: "s24-voice-sample-agent",
      handle: "@s24-voice-sample",
      name: "S24 Voice Sample Asset Agent",
      responsibleSession: "S24",
      providerRole: "voice-clone",
      status: sampleReady ? "completed" : "blocked",
      action: "verify-consented-voice-sample",
      dependsOn: ["s12-auth-ownership-agent"],
      progressText: sampleReady
        ? "S24 Asset and Export Quality confirmed a consented teacher voice sample is linked by public asset id."
        : "S24 Asset and Export Quality is waiting for a consented teacher voice sample before Qwen voice cloning.",
    }),
    createAgentHandoff({
      index: 2,
      agentId: "s07-qwen-voice-clone-agent",
      handle: "@s07-voice-clone",
      name: "S07 Qwen Voice Clone Agent",
      responsibleSession: "S07",
      providerRole: "voice-clone",
      status: voiceRefReady ? "completed" : sampleReady ? "ready" : "blocked",
      action: "verify-qwen-voice-reference",
      dependsOn: ["s24-voice-sample-agent"],
      progressText: voiceRefReady
        ? "S07 AI Agent Model confirmed the public Qwen voice reference is ready for PPT narration."
        : "S07 AI Agent Model is waiting for the Qwen cloned voice reference handoff.",
    }),
    createAgentHandoff({
      index: 3,
      agentId: "s24-ppt-material-agent",
      handle: "@s24-ppt-material",
      name: "S24 PPT Material Asset Agent",
      responsibleSession: "S24",
      providerRole: "ppt-narration",
      status: pptReady ? "completed" : "blocked",
      action: "verify-ppt-material",
      dependsOn: ["s12-auth-ownership-agent"],
      progressText: pptReady
        ? "S24 Asset and Export Quality confirmed the PPT material is linked by public asset id."
        : "S24 Asset and Export Quality is waiting for PPT material registration.",
    }),
    createAgentHandoff({
      index: 4,
      agentId: "s19-qwen-provider-agent",
      handle: "@s19-qwen-env",
      name: "S19 Qwen Provider Env Agent",
      responsibleSession: "S19",
      providerRole: "ppt-narration",
      status: qwenReady ? "completed" : "blocked",
      action: "verify-qwen-provider-env",
      dependsOn: ["s12-auth-ownership-agent"],
      progressText: qwenReady
        ? "S19 API Configuration confirmed Qwen provider readiness without exposing credentials."
        : "S19 API Configuration is waiting for server-only Qwen provider readiness.",
    }),
    createAgentHandoff({
      index: 5,
      agentId: "s24-ppt-narration-agent",
      handle: "@s24-ppt-narration",
      name: "S24 PPT Narration Asset Agent",
      responsibleSession: "S24",
      providerRole: "ppt-narration",
      status: narrationReady
        ? "completed"
        : voiceRefReady && pptReady && qwenReady
          ? "ready"
          : "blocked",
      action: "verify-ppt-narration-assets",
      dependsOn: [
        "s07-qwen-voice-clone-agent",
        "s24-ppt-material-agent",
        "s19-qwen-provider-agent",
      ],
      progressText: narrationReady
        ? "S24 Asset and Export Quality confirmed PPT narration assets are ready for download."
        : "S24 Asset and Export Quality is waiting for Qwen narration generation before downloads are exposed.",
    }),
    createAgentHandoff({
      index: 6,
      agentId: "s22-release-smoke-agent",
      handle: "@s22-route-smoke",
      name: "S22 Release Smoke Agent",
      responsibleSession: "S22",
      providerRole: "ppt-narration",
      status: narrationReady ? "pending" : "blocked",
      action: "verify-deployed-teacher-workflow-route",
      dependsOn: ["s24-ppt-narration-agent"],
      progressText: narrationReady
        ? "S22 Build Quality is ready to verify the deployed teacher workflow route with signed route smoke."
        : "S22 Build Quality waits for a complete S24 narration asset chain before deployed route smoke.",
    }),
  ];

  const nextAgent = createNextWorkflowAgent({
    handoffs,
    workflowStatus: input.workflow.status,
    qwenEnvPresent: qwenReady,
  });
  const plan: TeacherPptWorkflowAgentHandoffPlan = {
    framework: "openmaic-style-teacher-ppt-narration",
    status: handoffPlanStatusForWorkflow(input.workflow.status, qwenReady),
    responsibleSession: "S07/S12/S19/S24/S22",
    graphValidation: validateUaisAgentWorkflowGraph({
      graphId: "teacher-ppt-narration",
      nodes: handoffs.map((handoff) => ({
        id: handoff.agentId,
        dependsOn: handoff.dependsOn,
      })),
    }),
    nextAgent,
    handoffs,
    redaction: createRedaction(),
  };
  assertTeacherPptWorkflowDisplaySafe(plan);
  return plan;
}

function createAgentHandoff(
  handoff: TeacherPptWorkflowAgentHandoff,
): TeacherPptWorkflowAgentHandoff {
  return handoff;
}

function createNextWorkflowAgent(input: {
  handoffs: TeacherPptWorkflowAgentHandoff[];
  workflowStatus: TeacherPptWorkflowStatus;
  qwenEnvPresent: boolean;
}): TeacherPptWorkflowNextAgent {
  const byId = new Map(input.handoffs.map((handoff) => [handoff.agentId, handoff]));
  if (input.workflowStatus === "ready-for-downloads") {
    return {
      agentId: "s24-export-quality-agent",
      handle: "@s24-export-quality",
      name: "S24 Export Quality Agent",
      responsibleSession: "S24",
      providerRole: "ppt-narration",
      action: "review-and-download-ppt-narration",
    };
  }
  if (input.workflowStatus === "needs-voice-sample") {
    return requireHandoff(byId, "s24-voice-sample-agent");
  }
  if (input.workflowStatus === "needs-voice-clone") {
    return requireHandoff(byId, "s07-qwen-voice-clone-agent");
  }
  if (input.workflowStatus === "needs-ppt-material") {
    return requireHandoff(byId, "s24-ppt-material-agent");
  }
  if (input.workflowStatus === "ready-for-ppt-narration" && !input.qwenEnvPresent) {
    return requireHandoff(byId, "s19-qwen-provider-agent");
  }
  if (input.workflowStatus === "ready-for-ppt-narration") {
    return requireHandoff(byId, "s24-ppt-narration-agent");
  }
  return requireHandoff(byId, "s24-ppt-narration-agent");
}

function requireHandoff(
  handoffs: Map<TeacherPptWorkflowAgentHandoff["agentId"], TeacherPptWorkflowAgentHandoff>,
  agentId: TeacherPptWorkflowAgentHandoff["agentId"],
) {
  const handoff = handoffs.get(agentId);
  if (!handoff) {
    throw new Error("Teacher PPT workflow handoff plan is missing an agent.");
  }
  return handoff;
}

function handoffPlanStatusForWorkflow(
  status: TeacherPptWorkflowStatus,
  qwenEnvPresent: boolean,
): TeacherPptWorkflowAgentHandoffPlan["status"] {
  if (status === "needs-voice-sample") return "blocked";
  if (status === "needs-voice-clone") return "ready-for-voice-clone";
  if (status === "needs-ppt-material") return "ready-for-ppt-material";
  if (status === "ready-for-ppt-narration") {
    return qwenEnvPresent ? "ready-for-ppt-narration" : "blocked";
  }
  return "ready-for-teacher-review";
}

function isWorkflowStepReady(
  workflow: TeacherPptWorkflow,
  stepId: TeacherPptWorkflowStep["id"],
) {
  return workflow.steps.find((step) => step.id === stepId)?.status === "ready";
}

function workflowStatusFromSteps(steps: TeacherPptWorkflowStep[]): TeacherPptWorkflowStatus {
  if (steps[0].status !== "ready") return "needs-voice-sample";
  if (steps[1].status !== "ready") return "needs-voice-clone";
  if (steps[2].status !== "ready") return "needs-ppt-material";
  if (steps[3].status !== "ready") return "ready-for-ppt-narration";
  return "ready-for-downloads";
}

function nextActionForStatus(status: TeacherPptWorkflowStatus): TeacherPptWorkflowNextAction {
  if (status === "needs-voice-sample") return "submit-voice-sample";
  if (status === "needs-voice-clone") return "clone-teacher-voice";
  if (status === "needs-ppt-material") return "register-ppt-material";
  if (status === "ready-for-ppt-narration") return "generate-ppt-narration";
  return "review-and-download-ppt-narration";
}

function createTeacherPptWorkflowProgress(input: {
  status: "ready" | "auth-required" | "not-configured";
  workflow?: TeacherPptWorkflow;
  qwenEnvPresent: boolean;
}) {
  const authStatus = input.status === "ready" ? "authorized" : input.status;
  const progress = [
    createResponsibleProgressItem({
      index: 0,
      type: "s12-teacher-ppt-workflow-auth-boundary",
      status: authStatus,
      responsibleSession: "S12",
      providerRole: "ppt-narration",
      progressText:
        input.status === "ready"
          ? "S12 Backend/API Platform verified the signed teacher auth cookie before assembling the PPT narration workflow status."
          : "S12 Backend/API Platform kept the teacher PPT workflow closed until signed teacher auth is available.",
    }),
    createResponsibleProgressItem({
      index: 1,
      type: "s24-teacher-ppt-asset-chain",
      status: input.status === "ready" ? input.workflow?.status ?? "checked" : "blocked",
      responsibleSession: "S24",
      providerRole: "ppt-narration",
      progressText:
        input.status === "ready"
          ? "S24 Asset and Export Quality assembled the voice sample, PPT material, and narration download chain from server-side ownership metadata."
          : "S24 Asset and Export Quality waited for S12 auth before exposing redacted PPT narration asset metadata.",
    }),
  ];

  if (input.status === "ready") {
    progress.push(
      createResponsibleProgressItem({
        index: 2,
        type: "s07-qwen-voice-reference-readiness",
        status: input.workflow?.steps[1].status ?? "missing",
        responsibleSession: "S07",
        providerRole: "voice-clone",
        progressText:
          "S07 AI Agent Model checked whether a public server-side Qwen voice reference is ready for PPT narration.",
      }),
      createResponsibleProgressItem({
        index: 3,
        type: "s19-qwen-provider-env-readiness",
        status: input.qwenEnvPresent ? "present" : "missing",
        responsibleSession: "S19",
        providerRole: "ppt-narration",
        progressText: input.qwenEnvPresent
          ? "S19 API Configuration confirmed Qwen provider environment readiness without exposing provider credentials."
          : "S19 API Configuration reported that Qwen provider credentials are not ready for live PPT narration.",
      }),
      createResponsibleProgressItem({
        index: 4,
        type: "s22-teacher-workflow-route-smoke",
        status:
          input.workflow?.status === "ready-for-downloads"
            ? "pending"
            : input.workflow?.status ?? "blocked",
        responsibleSession: "S22",
        providerRole: "ppt-narration",
        progressText:
          "S22 Build Quality is responsible for deployed route smoke of the signed teacher PPT workflow before release.",
      }),
    );
  }

  return assertResponsibleProgressIsDisplaySafe(progress);
}

function denied(
  reasonCode: "auth-adapter-not-configured" | "authenticated-session-required",
) {
  return {
    status: "denied",
    responsibleSession: "S12",
    reasonCode,
    redaction: createRedaction(),
  };
}

function safeQueryId(value: string | null) {
  if (!value) return undefined;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

function assertWorkflowIsDisplaySafe(workflow: TeacherPptWorkflow) {
  assertTeacherPptWorkflowDisplaySafe(workflow);
}

function assertTeacherPptWorkflowDisplaySafe(value: unknown) {
  const serialized = JSON.stringify(value);
  if (UNSAFE_WORKFLOW_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("Teacher PPT workflow contains non-display-safe data.");
  }
}

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim() !== "";
}

function createRedaction(): UaisAiAccessDecision["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

const UNSAFE_WORKFLOW_PATTERNS = [
  /sk-[A-Za-z0-9]/,
  /(?:DASHSCOPE_API_KEY|DEEPSEEK_API_KEY|UAIS_LIVE_AI_APPROVAL_TOKEN|UAIS_AI_ACCESS_SIGNING_SECRET|UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET|UAIS_TEACHER_AUTH_ISSUER_SECRET)\s*=\s*[^"',}\]\s]+/,
  /voice-qwen-private/,
  /\/Users\/dongpinhu\/Library\/Containers/,
  /data:audio\/[^"',}\]\s]+base64/i,
  /audioBase64/i,
];
