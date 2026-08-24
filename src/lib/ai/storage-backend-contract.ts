export type UaisStorageBackendEnvName =
  | "UAIS_TEACHER_AI_OWNERSHIP_BACKEND"
  | "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND"
  | "UAIS_TEACHING_OPERATIONS_BACKEND"
  | "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND"
  | "UAIS_TEACHING_COURSE_ASSETS_BACKEND"
  | "UAIS_LANGGRAPH_PERSISTENCE_BACKEND";

export type UaisStorageBackendResponsibleSession = "S12" | "S24";

export type UaisExternalStorageEnvName =
  | "UAIS_EXTERNAL_STORAGE_BASE_URL"
  | "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN";

export type UaisStorageBackendRequiredEnvCheck = {
  name: UaisExternalStorageEnvName;
  status: "present" | "missing";
};

export type UaisStorageBackendSecretStrengthCheck = {
  name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN";
  status: "sufficient" | "weak" | "missing";
  valueRedacted: true;
};

type UaisStorageBackendSecretStrength = {
  minimumLength: 32;
  valuesRedacted: true;
  checks: UaisStorageBackendSecretStrengthCheck[];
};

export type UaisStorageBackendContract = {
  envName: UaisStorageBackendEnvName;
  selector: string;
  backendKind: "local-json-file" | "postgres" | "managed" | "external" | "unsupported";
  durability: "non-durable" | "durable" | "unknown";
  adapterStatus: "implemented" | "not-implemented" | "unsupported";
  productionStatus: "ready" | "blocked";
  blockedReason?: UaisStorageBackendBlockedReason;
  requiredEnv?: UaisStorageBackendRequiredEnvCheck[];
  secretStrength?: UaisStorageBackendSecretStrength;
  responsibleSession: UaisStorageBackendResponsibleSession;
  redaction: {
    values: "omitted";
    localFiles: "omitted";
  };
};

export type UaisStorageBackendBlockedReason =
  | `non-durable-${UaisStorageBackendEnvName}`
  | `missing-external-storage-env-${UaisStorageBackendEnvName}`
  | `weak-external-storage-token-${UaisStorageBackendEnvName}`
  | `missing-durable-env-${UaisStorageBackendEnvName}`
  | `unimplemented-durable-${UaisStorageBackendEnvName}`
  | `unsupported-${UaisStorageBackendEnvName}`;

const minimumExternalStorageTokenLength = 32;

export function resolveUaisStorageBackendContract(input: {
  envName: UaisStorageBackendEnvName;
  value: string | undefined;
  responsibleSession: UaisStorageBackendResponsibleSession;
  env?: Record<string, string | undefined>;
  implementedDurableBackendKinds?: readonly ("postgres" | "managed")[];
  durableBackendConfigured?: boolean;
}): UaisStorageBackendContract {
  const selector = normalizeStorageBackendSelector(input.value);

  if (isLocalJsonFileSelector(selector)) {
    return {
      envName: input.envName,
      selector,
      backendKind: "local-json-file",
      durability: "non-durable",
      adapterStatus: "implemented",
      productionStatus: "blocked",
      blockedReason: `non-durable-${input.envName}`,
      responsibleSession: input.responsibleSession,
      redaction: createStorageBackendRedaction(),
    };
  }

  if (selector === "external") {
    const requiredEnv = createExternalStorageRequiredEnvChecks(input.env ?? {});
    const secretStrength = createExternalStorageSecretStrengthChecks(input.env ?? {});
    const envReady = requiredEnv.every((entry) => entry.status === "present");
    const secretsReady = secretStrength.checks.every((entry) => entry.status === "sufficient");
    const ready = envReady && secretsReady;
    const blockedReason = envReady
      ? `weak-external-storage-token-${input.envName}` as const
      : `missing-external-storage-env-${input.envName}` as const;
    return {
      envName: input.envName,
      selector,
      backendKind: "external",
      durability: "durable",
      adapterStatus: ready ? "implemented" : "not-implemented",
      productionStatus: ready ? "ready" : "blocked",
      ...(ready ? {} : { blockedReason }),
      requiredEnv,
      secretStrength,
      responsibleSession: input.responsibleSession,
      redaction: createStorageBackendRedaction(),
    };
  }

  if (selector === "postgres" || selector === "managed") {
    const adapterImplemented = input.implementedDurableBackendKinds?.includes(selector) ?? false;
    if (adapterImplemented) {
      const configured = input.durableBackendConfigured === true;
      return {
        envName: input.envName,
        selector,
        backendKind: selector,
        durability: "durable",
        adapterStatus: "implemented",
        productionStatus: configured ? "ready" : "blocked",
        ...(configured
          ? {}
          : { blockedReason: `missing-durable-env-${input.envName}` as const }),
        responsibleSession: input.responsibleSession,
        redaction: createStorageBackendRedaction(),
      };
    }
    return {
      envName: input.envName,
      selector,
      backendKind: selector,
      durability: "durable",
      adapterStatus: "not-implemented",
      productionStatus: "blocked",
      blockedReason: `unimplemented-durable-${input.envName}`,
      responsibleSession: input.responsibleSession,
      redaction: createStorageBackendRedaction(),
    };
  }

  return {
    envName: input.envName,
    selector,
    backendKind: "unsupported",
    durability: "unknown",
    adapterStatus: "unsupported",
    productionStatus: "blocked",
    blockedReason: `unsupported-${input.envName}`,
    responsibleSession: input.responsibleSession,
    redaction: createStorageBackendRedaction(),
  };
}

export function isLocalJsonFileStorageBackendContract(
  contract: UaisStorageBackendContract,
) {
  return contract.backendKind === "local-json-file" && contract.adapterStatus === "implemented";
}

export function isExternalStorageBackendReadyContract(
  contract: UaisStorageBackendContract,
) {
  return contract.backendKind === "external" && contract.productionStatus === "ready";
}

export function createUaisExternalStorageConfig(input: {
  env: Record<string, string | undefined>;
}) {
  const baseUrl = input.env.UAIS_EXTERNAL_STORAGE_BASE_URL?.trim();
  const accessToken = input.env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN?.trim();
  if (!baseUrl || !accessToken) {
    return undefined;
  }

  return {
    baseUrl: stripTrailingSlashes(baseUrl),
    accessToken,
  };
}

function normalizeStorageBackendSelector(value: string | undefined) {
  const selector = value?.trim().toLowerCase();
  return selector || "local-json-file";
}

function isLocalJsonFileSelector(selector: string) {
  return selector === "local" || selector === "local-file" || selector === "local-json-file";
}

function createStorageBackendRedaction(): UaisStorageBackendContract["redaction"] {
  return {
    values: "omitted",
    localFiles: "omitted",
  };
}

function createExternalStorageRequiredEnvChecks(
  env: Record<string, string | undefined>,
): UaisStorageBackendRequiredEnvCheck[] {
  return [
    {
      name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
      status: hasValue(env.UAIS_EXTERNAL_STORAGE_BASE_URL) ? "present" : "missing",
    },
    {
      name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
      status: hasValue(env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN) ? "present" : "missing",
    },
  ];
}

function createExternalStorageSecretStrengthChecks(
  env: Record<string, string | undefined>,
): UaisStorageBackendSecretStrength {
  return {
    minimumLength: minimumExternalStorageTokenLength,
    valuesRedacted: true,
    checks: [
      {
        name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
        status: classifyExternalStorageTokenStrength(env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN),
        valueRedacted: true,
      },
    ],
  };
}

function classifyExternalStorageTokenStrength(
  value: string | undefined,
): UaisStorageBackendSecretStrengthCheck["status"] {
  if (!hasValue(value)) {
    return "missing";
  }
  return value.trim().length >= minimumExternalStorageTokenLength ? "sufficient" : "weak";
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function stripTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}
