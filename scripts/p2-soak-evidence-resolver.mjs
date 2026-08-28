import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

const MANIFEST_SCHEMA_VERSION = 2;
const MANIFEST_KIND = "uais-soak-evidence-index";
const TRUST_POLICY_SCHEMA_VERSION = 1;
const TRUST_POLICY_KIND = "uais-soak-evidence-trust-policy";
const RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_KIND = "uais-soak-evidence-receipt";
const AUTHORITY_ROLE = "soak-evidence-issuer";
const SIGNATURE_ALGORITHM = "Ed25519";

const DEFAULT_MAX_MANIFEST_BYTES = 256 * 1024;
const DEFAULT_MAX_TRUST_POLICY_BYTES = 256 * 1024;
const DEFAULT_MAX_ARTIFACT_BYTES = 1024 * 1024;
const DEFAULT_MAX_TOTAL_ARTIFACT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ARTIFACTS = 64;
const DEFAULT_MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_MS = 30 * 1000;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const CANDIDATE_KEYS = [
  "contentSha256",
  "deploymentHost",
  "deploymentId",
  "gitSha",
  "projectId",
];
const MANIFEST_KEYS = [
  "artifacts",
  "authority",
  "candidate",
  "evidenceSetId",
  "expiresAt",
  "issuedAt",
  "kind",
  "schemaVersion",
  "signature",
];
const ARTIFACT_KEYS = [
  "byteLength",
  "id",
  "path",
  "receiptSchema",
  "sha256",
];
const MANIFEST_AUTHORITY_KEYS = ["algorithm", "keyId", "role"];
const TRUST_POLICY_KEYS = [
  "authorities",
  "kind",
  "policyId",
  "schemaVersion",
];
const TRUST_AUTHORITY_KEYS = [
  "algorithm",
  "allowedReceiptSchemas",
  "candidate",
  "evidenceSetId",
  "keyId",
  "notAfter",
  "notBefore",
  "publicKeyPem",
  "role",
];
const RECEIPT_KEYS = [
  "artifactId",
  "candidate",
  "evidenceSetId",
  "expiresAt",
  "issuedAt",
  "kind",
  "payload",
  "receiptSchema",
  "schemaVersion",
  "sourceAuthority",
  "sourceSignature",
];
const RECEIPT_SOURCE_AUTHORITY_KEYS = ["algorithm", "keyId", "role"];
const REQUIRED_ARTIFACT_REQUIRED_KEYS = ["id", "receiptSchema"];
const REQUIRED_ARTIFACT_ALLOWED_KEYS = [
  ...REQUIRED_ARTIFACT_REQUIRED_KEYS,
  "mustDifferFromIndexAuthority",
  "sourceAuthorityRole",
];

/**
 * Returns the deterministic bytes covered by the Ed25519 index signature.
 * The signature is intentionally excluded; artifact digests remain inside the
 * signed object, so the index cannot attest to itself or mutable path labels.
 */
export function createSoakEvidenceIndexSigningPayload(index) {
  if (!isRecord(index)) {
    throw new TypeError("soak evidence index must be an object");
  }
  const unsigned = Object.create(null);
  for (const [key, value] of Object.entries(index)) {
    if (key !== "signature") unsigned[key] = value;
  }
  return Buffer.from(canonicalJson(unsigned), "utf8");
}

export function createSoakEvidenceReceiptSigningPayload(receipt) {
  if (!isRecord(receipt)) {
    throw new TypeError("soak evidence receipt must be an object");
  }
  const unsigned = Object.create(null);
  for (const [key, value] of Object.entries(receipt)) {
    if (key !== "sourceSignature") unsigned[key] = value;
  }
  return Buffer.from(canonicalJson(unsigned), "utf8");
}

/**
 * Resolve one offline, content-addressed soak evidence packet.
 *
 * Integrity, trust, path, schema, time, and candidate failures set `valid` to
 * false. An authentic packet whose receipt schema has no in-process validator
 * remains `valid: true` but `promotionEligible: false`; callers must never
 * promote that state to a passing release gate.
 */
export function resolveSoakEvidencePacket(options = {}) {
  const errors = [];
  const artifacts = [];
  const pendingValidations = [];
  const unsupportedReceiptSchemas = new Set();
  const expectedTrustPolicySha256 = readString(
    options.expectedTrustPolicySha256,
  );
  const expectedAuthorityKeyId = readString(options.expectedAuthorityKeyId);
  const requiredArtifacts = validateRequiredArtifacts(
    options.requiredArtifacts,
    errors,
  );
  let artifactSet = { complete: false, missing: [], unexpected: [] };
  const nowMs = options.nowMs === undefined ? Date.now() : options.nowMs;
  const maxManifestBytes = positiveInteger(
    options.maxManifestBytes,
    DEFAULT_MAX_MANIFEST_BYTES,
  );
  const maxTrustPolicyBytes = positiveInteger(
    options.maxTrustPolicyBytes,
    DEFAULT_MAX_TRUST_POLICY_BYTES,
  );
  const maxArtifactBytes = positiveInteger(
    options.maxArtifactBytes,
    DEFAULT_MAX_ARTIFACT_BYTES,
  );
  const maxTotalArtifactBytes = positiveInteger(
    options.maxTotalArtifactBytes,
    DEFAULT_MAX_TOTAL_ARTIFACT_BYTES,
  );
  const maxArtifacts = positiveInteger(
    options.maxArtifacts,
    DEFAULT_MAX_ARTIFACTS,
  );
  const maxEvidenceAgeMs = positiveInteger(
    options.maxEvidenceAgeMs,
    DEFAULT_MAX_EVIDENCE_AGE_MS,
  );
  const allowedClockSkewMs = nonNegativeInteger(
    options.allowedClockSkewMs,
    DEFAULT_CLOCK_SKEW_MS,
  );

  const invalidBase = () => ({
    valid: false,
    promotionEligible: false,
    errors: unique(errors),
    unsupportedReceiptSchemas: [...unsupportedReceiptSchemas].sort(),
    artifactSetComplete: artifactSet.complete,
    missingRequiredArtifacts: artifactSet.missing,
    unexpectedArtifacts: artifactSet.unexpected,
    evidenceSetId: "",
    candidate: null,
    authority: {
      keyId: "",
      role: "",
      signatureVerified: false,
    },
    artifacts,
  });

  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    errors.push("now-invalid");
  }
  if (!isSha256(expectedTrustPolicySha256)) {
    errors.push("expected-trust-policy-sha256-required");
  }
  if (!validIdentifier(expectedAuthorityKeyId)) {
    errors.push("expected-authority-key-id-required");
  }
  const manifestPath = readPathOption(options.manifestPath);
  const trustPolicyPath = readPathOption(options.trustPolicyPath);
  if (!manifestPath) errors.push("manifest-path-required");
  if (!trustPolicyPath) errors.push("trust-policy-path-required");
  if (errors.length > 0) return invalidBase();

  const manifestFile = readTopLevelJsonFile({
    filePath: manifestPath,
    label: "manifest",
    maxBytes: maxManifestBytes,
    errors,
  });
  if (!manifestFile) return invalidBase();
  const manifest = manifestFile.value;

  validateManifest(manifest, { errors, maxArtifacts });
  if (!isRecord(manifest)) return invalidBase();
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push("manifest-schema-version-unsupported");
  }
  if (errors.length > 0) return invalidBase();

  artifactSet = compareRequiredArtifacts(manifest.artifacts, requiredArtifacts);
  if (manifest.authority.keyId !== expectedAuthorityKeyId) {
    errors.push("authority-key-id-pin-mismatch");
  }

  const expectedCandidate = options.expectedCandidate;
  if (!validCandidate(expectedCandidate)) {
    errors.push("expected-candidate-invalid");
  } else {
    for (const key of CANDIDATE_KEYS) {
      if (manifest.candidate[key] !== expectedCandidate[key]) {
        errors.push(`candidate-mismatch:${key}`);
      }
    }
  }

  const manifestTimes = validateFreshInterval({
    issuedAt: manifest.issuedAt,
    expiresAt: manifest.expiresAt,
    nowMs,
    maxEvidenceAgeMs,
    allowedClockSkewMs,
    prefix: "manifest",
    errors,
  });

  const packetRoot = realpathSync(dirname(manifestFile.realPath));
  const resolvedTrustPolicyPath = resolve(trustPolicyPath);
  const trustPolicyLstat = safeLstat(resolvedTrustPolicyPath);
  if (trustPolicyLstat?.isSymbolicLink()) {
    errors.push("trust-policy-symlink-forbidden");
  }

  let trustPolicyFile = null;
  if (!trustPolicyLstat?.isSymbolicLink()) {
    trustPolicyFile = readTopLevelJsonFile({
      filePath: resolvedTrustPolicyPath,
      label: "trust-policy",
      maxBytes: maxTrustPolicyBytes,
      errors,
    });
  }
  if (!trustPolicyFile) {
    return buildResult({
      valid: false,
      errors,
      unsupportedReceiptSchemas,
      manifest,
      signatureVerified: false,
      artifacts,
      artifactSet,
    });
  }
  if (isWithin(packetRoot, trustPolicyFile.realPath)) {
    errors.push("trust-policy-must-be-outside-packet-root");
  }
  if (trustPolicyFile.sha256 !== expectedTrustPolicySha256) {
    errors.push("trust-policy-sha256-mismatch");
  }

  const trustPolicy = trustPolicyFile.value;
  validateTrustPolicy(trustPolicy, errors);
  if (errors.length > 0) {
    return buildResult({
      valid: false,
      errors,
      unsupportedReceiptSchemas,
      manifest,
      signatureVerified: false,
      artifacts,
      artifactSet,
    });
  }

  const authority = trustPolicy.authorities.find(
    (entry) => entry.keyId === manifest.authority.keyId,
  );
  if (!authority) {
    errors.push("authority-key-not-found");
    return buildResult({
      valid: false,
      errors,
      unsupportedReceiptSchemas,
      manifest,
      signatureVerified: false,
      artifacts,
      artifactSet,
    });
  }

  validateAuthorityBinding({
    authority,
    manifest,
    manifestTimes,
    nowMs,
    errors,
  });
  const signatureVerified = verifyManifestSignature({
    manifest,
    authority,
    errors,
  });

  let declaredTotalBytes = 0;
  for (const artifact of manifest.artifacts) {
    declaredTotalBytes += artifact.byteLength;
  }
  if (declaredTotalBytes > maxTotalArtifactBytes) {
    errors.push("artifact-total-bytes-exceeded");
  }

  const requiredByIdentity = new Map(
    requiredArtifacts.map((entry) => [artifactIdentity(entry), entry]),
  );
  for (const artifact of manifest.artifacts) {
    resolveArtifact({
      artifact,
      requiredArtifact: requiredByIdentity.get(artifactIdentity(artifact)),
      manifest,
      trustPolicy,
      indexAuthority: authority,
      manifestPath: manifestFile.realPath,
      packetRoot,
      nowMs,
      maxArtifactBytes,
      maxEvidenceAgeMs,
      allowedClockSkewMs,
      errors,
      artifacts,
      pendingValidations,
    });
  }

  if (signatureVerified && errors.length === 0 && artifactSet.complete) {
    for (const pending of pendingValidations) {
      runSourceValidation({
        ...pending,
        manifest,
        authority,
        receiptValidators: options.receiptValidators,
        derivedFieldAllowlist: options.derivedFieldAllowlist,
        derivedSanitizers: options.derivedSanitizers,
        errors,
        unsupportedReceiptSchemas,
      });
    }
  }

  const valid = errors.length === 0 && signatureVerified;
  const promotionEligible =
    valid &&
    artifactSet.complete &&
    artifacts.length > 0 &&
    artifacts.every((artifact) => artifact.eligible === true);
  return {
    valid,
    promotionEligible,
    errors: unique(errors),
    unsupportedReceiptSchemas: [...unsupportedReceiptSchemas].sort(),
    artifactSetComplete: artifactSet.complete,
    missingRequiredArtifacts: artifactSet.missing,
    unexpectedArtifacts: artifactSet.unexpected,
    evidenceSetId: manifest.evidenceSetId,
    candidate: copyCandidate(manifest.candidate),
    authority: {
      keyId: manifest.authority.keyId,
      role: manifest.authority.role,
      signatureVerified,
    },
    artifacts,
  };
}

function validateManifest(value, { errors, maxArtifacts }) {
  if (!isRecord(value)) {
    errors.push("manifest-root-invalid");
    return;
  }
  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push("manifest-schema-version-unsupported");
  }
  if (!hasExactKeys(value, MANIFEST_KEYS)) {
    errors.push("manifest-keys-invalid");
  }
  if (value.kind !== MANIFEST_KIND) errors.push("manifest-kind-invalid");
  if (!validIdentifier(value.evidenceSetId)) {
    errors.push("manifest-evidence-set-id-invalid");
  }
  if (!validCandidate(value.candidate)) {
    errors.push("manifest-candidate-invalid");
  }
  if (!isIsoTimestamp(value.issuedAt)) errors.push("manifest-issued-at-invalid");
  if (!isIsoTimestamp(value.expiresAt)) {
    errors.push("manifest-expires-at-invalid");
  }
  if (!isRecord(value.authority)) {
    errors.push("manifest-authority-required");
  } else {
    if (!hasExactKeys(value.authority, MANIFEST_AUTHORITY_KEYS)) {
      errors.push("manifest-authority-keys-invalid");
    }
    if (!validIdentifier(value.authority.keyId)) {
      errors.push("manifest-authority-key-id-invalid");
    }
    if (value.authority.algorithm !== SIGNATURE_ALGORITHM) {
      errors.push("manifest-authority-algorithm-invalid");
    }
    if (value.authority.role !== AUTHORITY_ROLE) {
      errors.push("manifest-authority-role-invalid");
    }
  }
  if (
    typeof value.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/.test(value.signature)
  ) {
    errors.push("manifest-signature-format-invalid");
  }
  if (
    !Array.isArray(value.artifacts) ||
    value.artifacts.length === 0 ||
    value.artifacts.length > maxArtifacts
  ) {
    errors.push("manifest-artifacts-invalid");
    return;
  }
  const ids = new Set();
  const paths = new Set();
  for (const artifact of value.artifacts) {
    if (!isRecord(artifact)) {
      errors.push("manifest-artifact-entry-invalid");
      continue;
    }
    const id = readString(artifact.id) || "unknown";
    if (!hasExactKeys(artifact, ARTIFACT_KEYS)) {
      errors.push(`artifact:${id}:index-keys-invalid`);
    }
    if (!validIdentifier(artifact.id)) {
      errors.push(`artifact:${id}:id-invalid`);
    } else if (ids.has(artifact.id)) {
      errors.push(`artifact:${id}:id-duplicate`);
    }
    ids.add(artifact.id);
    if (!validArtifactPath(artifact.path)) {
      errors.push(`artifact:${id}:path-invalid`);
    } else if (paths.has(artifact.path)) {
      errors.push(`artifact:${id}:path-duplicate`);
    }
    paths.add(artifact.path);
    if (!validReceiptSchemaName(artifact.receiptSchema)) {
      errors.push(`artifact:${id}:receipt-schema-invalid`);
    }
    if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 1) {
      errors.push(`artifact:${id}:byte-length-invalid`);
    }
    if (!isSha256(artifact.sha256)) {
      errors.push(`artifact:${id}:sha256-invalid`);
    }
  }
}

function validateTrustPolicy(value, errors) {
  if (!isRecord(value)) {
    errors.push("trust-policy-root-invalid");
    return;
  }
  if (!hasExactKeys(value, TRUST_POLICY_KEYS)) {
    errors.push("trust-policy-keys-invalid");
  }
  if (value.schemaVersion !== TRUST_POLICY_SCHEMA_VERSION) {
    errors.push("trust-policy-schema-version-unsupported");
  }
  if (value.kind !== TRUST_POLICY_KIND) {
    errors.push("trust-policy-kind-invalid");
  }
  if (!validIdentifier(value.policyId)) {
    errors.push("trust-policy-id-invalid");
  }
  if (
    !Array.isArray(value.authorities) ||
    value.authorities.length === 0 ||
    value.authorities.length > 64
  ) {
    errors.push("trust-policy-authorities-invalid");
    return;
  }
  const keyIds = new Set();
  for (const authority of value.authorities) {
    if (!isRecord(authority)) {
      errors.push("trust-policy-authority-invalid");
      continue;
    }
    const keyId = readString(authority.keyId) || "unknown";
    if (!hasExactKeys(authority, TRUST_AUTHORITY_KEYS)) {
      errors.push(`trust-policy-authority:${keyId}:keys-invalid`);
    }
    if (!validIdentifier(authority.keyId)) {
      errors.push(`trust-policy-authority:${keyId}:key-id-invalid`);
    } else if (keyIds.has(authority.keyId)) {
      errors.push(`trust-policy-authority:${keyId}:key-id-duplicate`);
    }
    keyIds.add(authority.keyId);
    if (authority.algorithm !== SIGNATURE_ALGORITHM) {
      errors.push(`trust-policy-authority:${keyId}:algorithm-invalid`);
    }
    if (!readString(authority.role)) {
      errors.push(`trust-policy-authority:${keyId}:role-invalid`);
    }
    if (!validCandidate(authority.candidate)) {
      errors.push(`trust-policy-authority:${keyId}:candidate-invalid`);
    }
    if (!validIdentifier(authority.evidenceSetId)) {
      errors.push(`trust-policy-authority:${keyId}:evidence-set-id-invalid`);
    }
    if (
      !Array.isArray(authority.allowedReceiptSchemas) ||
      authority.allowedReceiptSchemas.length === 0 ||
      authority.allowedReceiptSchemas.some(
        (schema) => !validReceiptSchemaName(schema),
      ) ||
      new Set(authority.allowedReceiptSchemas).size !==
        authority.allowedReceiptSchemas.length
    ) {
      errors.push(`trust-policy-authority:${keyId}:receipt-schemas-invalid`);
    }
    if (!isIsoTimestamp(authority.notBefore)) {
      errors.push(`trust-policy-authority:${keyId}:not-before-invalid`);
    }
    if (!isIsoTimestamp(authority.notAfter)) {
      errors.push(`trust-policy-authority:${keyId}:not-after-invalid`);
    }
    if (!readString(authority.publicKeyPem)) {
      errors.push(`trust-policy-authority:${keyId}:public-key-invalid`);
    }
  }
}

function validateAuthorityBinding({
  authority,
  manifest,
  manifestTimes,
  nowMs,
  errors,
}) {
  if (authority.algorithm !== manifest.authority.algorithm) {
    errors.push("authority-algorithm-mismatch");
  }
  if (
    authority.role !== manifest.authority.role ||
    authority.role !== AUTHORITY_ROLE
  ) {
    errors.push("authority-role-mismatch");
  }
  if (!sameCandidate(authority.candidate, manifest.candidate)) {
    errors.push("authority-candidate-mismatch");
  }
  if (authority.evidenceSetId !== manifest.evidenceSetId) {
    errors.push("authority-evidence-set-mismatch");
  }
  const allowedSchemas = new Set(authority.allowedReceiptSchemas);
  for (const artifact of manifest.artifacts) {
    if (!allowedSchemas.has(artifact.receiptSchema)) {
      errors.push(`authority-receipt-schema-not-allowed:${artifact.receiptSchema}`);
    }
  }
  const notBeforeMs = Date.parse(authority.notBefore);
  const notAfterMs = Date.parse(authority.notAfter);
  if (!(notBeforeMs < notAfterMs)) errors.push("authority-window-invalid");
  if (nowMs < notBeforeMs || nowMs >= notAfterMs) {
    errors.push("authority-not-current");
  }
  if (
    manifestTimes &&
    (manifestTimes.issuedAtMs < notBeforeMs ||
      manifestTimes.expiresAtMs > notAfterMs)
  ) {
    errors.push("authority-does-not-cover-manifest-window");
  }
}

function verifyManifestSignature({ manifest, authority, errors }) {
  let publicKey;
  try {
    publicKey = createPublicKey(authority.publicKeyPem);
  } catch {
    errors.push("authority-public-key-invalid");
    return false;
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    errors.push("authority-public-key-not-ed25519");
    return false;
  }
  let signature;
  try {
    signature = Buffer.from(manifest.signature, "base64url");
  } catch {
    errors.push("manifest-signature-format-invalid");
    return false;
  }
  if (signature.byteLength !== 64) {
    errors.push("manifest-signature-format-invalid");
    return false;
  }
  let verified = false;
  try {
    verified = verifySignature(
      null,
      createSoakEvidenceIndexSigningPayload(manifest),
      publicKey,
      signature,
    );
  } catch {
    verified = false;
  }
  if (!verified) errors.push("manifest-signature-invalid");
  return verified;
}

function resolveArtifact({
  artifact,
  requiredArtifact,
  manifest,
  trustPolicy,
  indexAuthority,
  manifestPath,
  packetRoot,
  nowMs,
  maxArtifactBytes,
  maxEvidenceAgeMs,
  allowedClockSkewMs,
  errors,
  artifacts,
  pendingValidations,
}) {
  const prefix = `artifact:${artifact.id}`;
  const output = {
    id: artifact.id,
    receiptSchema: artifact.receiptSchema,
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
    integrityVerified: false,
    eligible: false,
  };
  artifacts.push(output);

  if (!validArtifactPath(artifact.path)) {
    errors.push(`${prefix}:path-invalid`);
    return;
  }
  const artifactPath = resolve(packetRoot, ...artifact.path.split("/"));
  if (!isWithin(packetRoot, artifactPath)) {
    errors.push(`${prefix}:path-outside-packet-root`);
    return;
  }
  if (artifactPath === manifestPath) {
    errors.push(`${prefix}:self-reference-forbidden`);
    return;
  }

  const pathCheck = inspectArtifactPath({
    packetRoot,
    artifactPath,
    artifactSegments: artifact.path.split("/"),
    prefix,
    errors,
  });
  if (!pathCheck) return;
  if (pathCheck.size > maxArtifactBytes) {
    errors.push(`${prefix}:artifact-too-large`);
    return;
  }

  const bytes = readOpenedRegularFile({
    filePath: artifactPath,
    maxBytes: maxArtifactBytes,
    prefix,
    expectedStat: pathCheck,
    errors,
  });
  if (!bytes) return;
  output.byteLength = bytes.byteLength;
  output.sha256 = sha256(bytes);
  if (bytes.byteLength !== artifact.byteLength) {
    errors.push(`${prefix}:byte-length-mismatch`);
  }
  if (output.sha256 !== artifact.sha256) {
    errors.push(`${prefix}:sha256-mismatch`);
  }
  if (
    bytes.byteLength !== artifact.byteLength ||
    output.sha256 !== artifact.sha256
  ) {
    return;
  }

  let receipt;
  try {
    receipt = JSON.parse(UTF8_DECODER.decode(bytes));
  } catch {
    errors.push(`${prefix}:receipt-json-invalid`);
    return;
  }
  if (!validateReceiptEnvelope({
    receipt,
    artifact,
    manifest,
    nowMs,
    maxEvidenceAgeMs,
    allowedClockSkewMs,
    prefix,
    errors,
  })) {
    return;
  }

  const sourceAuthority = verifyReceiptSourceAuthenticity({
    receipt,
    artifact,
    requiredArtifact,
    manifest,
    trustPolicy,
    indexAuthority,
    nowMs,
    prefix,
    errors,
  });
  output.sourceAuthority = sourceAuthority.output;
  if (!sourceAuthority.verified) return;

  output.integrityVerified = true;
  pendingValidations.push({ artifact, receipt, output, actualSha256: output.sha256 });
}

function verifyReceiptSourceAuthenticity({
  receipt,
  artifact,
  requiredArtifact,
  manifest,
  trustPolicy,
  indexAuthority,
  nowMs,
  prefix,
  errors,
}) {
  const before = errors.length;
  const sourceReference = receipt.sourceAuthority;
  const output = {
    keyId: sourceReference.keyId,
    role: sourceReference.role,
    signatureVerified: false,
  };
  const sourceAuthority = trustPolicy.authorities.find(
    (entry) => entry.keyId === sourceReference.keyId,
  );
  if (!sourceAuthority) {
    errors.push(`${prefix}:source-authority-key-not-found`);
    return { verified: false, output };
  }
  if (sourceAuthority.algorithm !== sourceReference.algorithm) {
    errors.push(`${prefix}:source-authority-algorithm-mismatch`);
  }
  if (sourceAuthority.role !== sourceReference.role) {
    errors.push(`${prefix}:source-authority-role-mismatch`);
  }
  if (
    requiredArtifact?.sourceAuthorityRole !== undefined &&
    sourceReference.role !== requiredArtifact.sourceAuthorityRole
  ) {
    errors.push(`${prefix}:source-authority-role-contract-mismatch`);
  }
  if (
    requiredArtifact?.mustDifferFromIndexAuthority === true &&
    sourceReference.keyId === indexAuthority.keyId
  ) {
    errors.push(
      `${prefix}:source-authority-must-differ-from-index-authority`,
    );
  }
  if (!sameCandidate(sourceAuthority.candidate, manifest.candidate)) {
    errors.push(`${prefix}:source-authority-candidate-mismatch`);
  }
  if (sourceAuthority.evidenceSetId !== manifest.evidenceSetId) {
    errors.push(`${prefix}:source-authority-evidence-set-mismatch`);
  }
  if (!sourceAuthority.allowedReceiptSchemas.includes(artifact.receiptSchema)) {
    errors.push(
      `${prefix}:source-authority-receipt-schema-not-allowed`,
    );
  }

  const notBeforeMs = Date.parse(sourceAuthority.notBefore);
  const notAfterMs = Date.parse(sourceAuthority.notAfter);
  const receiptIssuedAtMs = Date.parse(receipt.issuedAt);
  const receiptExpiresAtMs = Date.parse(receipt.expiresAt);
  if (!(notBeforeMs < notAfterMs)) {
    errors.push(`${prefix}:source-authority-window-invalid`);
  }
  if (nowMs < notBeforeMs || nowMs >= notAfterMs) {
    errors.push(`${prefix}:source-authority-not-current`);
  }
  if (
    receiptIssuedAtMs < notBeforeMs ||
    receiptExpiresAtMs > notAfterMs
  ) {
    errors.push(
      `${prefix}:source-authority-does-not-cover-receipt-window`,
    );
  }

  let publicKey;
  try {
    publicKey = createPublicKey(sourceAuthority.publicKeyPem);
  } catch {
    errors.push(`${prefix}:source-authority-public-key-invalid`);
  }
  if (publicKey && publicKey.asymmetricKeyType !== "ed25519") {
    errors.push(`${prefix}:source-authority-public-key-not-ed25519`);
    publicKey = null;
  }
  if (
    requiredArtifact?.mustDifferFromIndexAuthority === true &&
    sourceReference.keyId !== indexAuthority.keyId &&
    publicKey
  ) {
    let indexPublicKey;
    try {
      indexPublicKey = createPublicKey(indexAuthority.publicKeyPem);
    } catch {
      indexPublicKey = null;
    }
    if (
      indexPublicKey?.asymmetricKeyType === "ed25519" &&
      publicKeySpkiSha256(publicKey) === publicKeySpkiSha256(indexPublicKey)
    ) {
      errors.push(
        `${prefix}:source-authority-must-differ-from-index-authority`,
      );
    }
  }

  let signature;
  try {
    signature = Buffer.from(receipt.sourceSignature, "base64url");
  } catch {
    signature = null;
  }
  if (!signature || signature.byteLength !== 64) {
    errors.push(`${prefix}:source-signature-invalid`);
  }

  let cryptographicallyVerified = false;
  if (publicKey && signature?.byteLength === 64) {
    try {
      cryptographicallyVerified = verifySignature(
        null,
        createSoakEvidenceReceiptSigningPayload(receipt),
        publicKey,
        signature,
      );
    } catch {
      cryptographicallyVerified = false;
    }
  }
  if (!cryptographicallyVerified) {
    errors.push(`${prefix}:source-signature-invalid`);
  }
  const verified = errors.length === before && cryptographicallyVerified;
  output.signatureVerified = verified;
  return { verified, output };
}

function runSourceValidation({
  artifact,
  receipt,
  output,
  actualSha256,
  manifest,
  authority,
  receiptValidators,
  derivedFieldAllowlist,
  derivedSanitizers,
  errors,
  unsupportedReceiptSchemas,
}) {
  const prefix = `artifact:${artifact.id}`;
  const validator = readReceiptValidator(
    receiptValidators,
    artifact.receiptSchema,
  );
  if (!validator) {
    unsupportedReceiptSchemas.add(artifact.receiptSchema);
    return;
  }

  const semanticContext = Object.freeze({
    artifact: Object.freeze({
      id: artifact.id,
      receiptSchema: artifact.receiptSchema,
      byteLength: output.byteLength,
      sha256: actualSha256,
    }),
    candidate: Object.freeze(copyCandidate(manifest.candidate)),
    evidenceSetId: manifest.evidenceSetId,
    authority: Object.freeze({
      keyId: authority.keyId,
      role: authority.role,
    }),
    sourceAuthority: Object.freeze({
      keyId: output.sourceAuthority.keyId,
      role: output.sourceAuthority.role,
      signatureVerified: true,
    }),
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
  });
  let validation;
  try {
    validation = validator(receipt.payload, semanticContext);
  } catch {
    errors.push(`${prefix}:source-validator-threw`);
    return;
  }
  if (!isRecord(validation) || validation.valid !== true) {
    const validatorErrors = Array.isArray(validation?.errors)
      ? validation.errors.filter(validErrorCode)
      : [];
    if (validatorErrors.length === 0) {
      errors.push(`${prefix}:source-schema-invalid`);
    } else {
      for (const error of validatorErrors) errors.push(`${prefix}:${error}`);
    }
    return;
  }
  if (typeof validation.eligible !== "boolean") {
    errors.push(`${prefix}:source-validator-result-invalid`);
    return;
  }
  if (validation.eligible && validation.derived === undefined) {
    errors.push(`${prefix}:eligible-requires-derived`);
    return;
  }
  if (validation.derived !== undefined) {
    const allowedDerivedFields = readDerivedFieldAllowlist(
      derivedFieldAllowlist,
      artifact.receiptSchema,
    );
    if (!allowedDerivedFields) {
      errors.push(`${prefix}:derived-field-allowlist-required`);
      return;
    }
    if (
      !isRecord(validation.derived) ||
      !hasExactKeys(validation.derived, allowedDerivedFields)
    ) {
      errors.push(`${prefix}:derived-keys-invalid`);
      return;
    }
    const sanitizer = readDerivedSanitizer(
      derivedSanitizers,
      artifact.receiptSchema,
    );
    if (!sanitizer) {
      errors.push(`${prefix}:derived-sanitizer-required`);
      return;
    }
    let sanitization;
    try {
      sanitization = sanitizer(validation.derived, semanticContext);
    } catch {
      errors.push(`${prefix}:derived-sanitizer-threw`);
      return;
    }
    if (!isRecord(sanitization) || sanitization.valid !== true) {
      const sanitizerErrors = Array.isArray(sanitization?.errors)
        ? sanitization.errors.filter(validErrorCode)
        : [];
      if (sanitizerErrors.length === 0) {
        errors.push(`${prefix}:derived-sanitizer-invalid`);
      } else {
        for (const error of sanitizerErrors) errors.push(`${prefix}:${error}`);
      }
      return;
    }
    if (
      !isRecord(sanitization.value) ||
      !hasExactKeys(sanitization.value, allowedDerivedFields)
    ) {
      errors.push(`${prefix}:derived-sanitized-keys-invalid`);
      return;
    }
    const derived = copyJsonValue(sanitization.value);
    if (derived === undefined) {
      errors.push(`${prefix}:derived-output-invalid`);
      return;
    }
    output.derived = derived;
  }
  output.eligible = validation.eligible === true;
}

function validateReceiptEnvelope({
  receipt,
  artifact,
  manifest,
  nowMs,
  maxEvidenceAgeMs,
  allowedClockSkewMs,
  prefix,
  errors,
}) {
  const before = errors.length;
  if (!isRecord(receipt)) {
    errors.push(`${prefix}:receipt-root-invalid`);
    return false;
  }
  if (!hasExactKeys(receipt, RECEIPT_KEYS)) {
    errors.push(`${prefix}:receipt-keys-invalid`);
  }
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    errors.push(`${prefix}:receipt-schema-version-unsupported`);
  }
  if (receipt.kind !== RECEIPT_KIND) errors.push(`${prefix}:receipt-kind-invalid`);
  if (receipt.artifactId !== artifact.id) {
    errors.push(`${prefix}:receipt-artifact-id-mismatch`);
  }
  if (receipt.receiptSchema !== artifact.receiptSchema) {
    errors.push(`${prefix}:receipt-schema-mismatch`);
  }
  if (receipt.evidenceSetId !== manifest.evidenceSetId) {
    errors.push(`${prefix}:receipt-evidence-set-mismatch`);
  }
  if (!validCandidate(receipt.candidate)) {
    errors.push(`${prefix}:receipt-candidate-invalid`);
  } else if (!sameCandidate(receipt.candidate, manifest.candidate)) {
    errors.push(`${prefix}:receipt-candidate-mismatch`);
  }
  if (!isRecord(receipt.payload)) errors.push(`${prefix}:receipt-payload-invalid`);
  if (!isRecord(receipt.sourceAuthority)) {
    errors.push(`${prefix}:receipt-source-authority-required`);
  } else {
    if (!hasExactKeys(receipt.sourceAuthority, RECEIPT_SOURCE_AUTHORITY_KEYS)) {
      errors.push(`${prefix}:receipt-source-authority-keys-invalid`);
    }
    if (!validIdentifier(receipt.sourceAuthority.keyId)) {
      errors.push(`${prefix}:receipt-source-authority-key-id-invalid`);
    }
    if (receipt.sourceAuthority.algorithm !== SIGNATURE_ALGORITHM) {
      errors.push(`${prefix}:receipt-source-authority-algorithm-invalid`);
    }
    if (!validIdentifier(receipt.sourceAuthority.role)) {
      errors.push(`${prefix}:receipt-source-authority-role-invalid`);
    }
  }
  if (
    typeof receipt.sourceSignature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/.test(receipt.sourceSignature)
  ) {
    errors.push(`${prefix}:receipt-source-signature-required`);
  }
  validateFreshInterval({
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    nowMs,
    maxEvidenceAgeMs,
    allowedClockSkewMs,
    prefix: `${prefix}:receipt`,
    errors,
  });
  return errors.length === before;
}

function validateFreshInterval({
  issuedAt,
  expiresAt,
  nowMs,
  maxEvidenceAgeMs,
  allowedClockSkewMs,
  prefix,
  errors,
}) {
  const issuedAtValid = isIsoTimestamp(issuedAt);
  const expiresAtValid = isIsoTimestamp(expiresAt);
  if (!issuedAtValid) errors.push(`${prefix}-issued-at-invalid`);
  if (!expiresAtValid) errors.push(`${prefix}-expires-at-invalid`);
  if (!issuedAtValid || !expiresAtValid) return null;
  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (!(issuedAtMs < expiresAtMs)) errors.push(`${prefix}-window-invalid`);
  if (issuedAtMs > nowMs + allowedClockSkewMs) {
    errors.push(`${prefix}-issued-in-future`);
  }
  if (nowMs - issuedAtMs > maxEvidenceAgeMs) {
    errors.push(`${prefix}-stale`);
  }
  if (expiresAtMs <= nowMs) errors.push(`${prefix}-expired`);
  return { issuedAtMs, expiresAtMs };
}

function inspectArtifactPath({
  packetRoot,
  artifactPath,
  artifactSegments,
  prefix,
  errors,
}) {
  let cursor = packetRoot;
  let finalStat = null;
  for (let index = 0; index < artifactSegments.length; index += 1) {
    cursor = resolve(cursor, artifactSegments[index]);
    const stat = safeLstat(cursor);
    if (!stat) {
      errors.push(`${prefix}:file-missing-or-unreadable`);
      return null;
    }
    if (stat.isSymbolicLink()) {
      errors.push(`${prefix}:symlink-forbidden`);
      return null;
    }
    const final = index === artifactSegments.length - 1;
    if (!final && !stat.isDirectory()) {
      errors.push(`${prefix}:parent-directory-required`);
      return null;
    }
    if (final && !stat.isFile()) {
      errors.push(`${prefix}:regular-file-required`);
      return null;
    }
    if (final) finalStat = stat;
  }
  let realPath;
  try {
    realPath = realpathSync(artifactPath);
  } catch {
    errors.push(`${prefix}:file-missing-or-unreadable`);
    return null;
  }
  if (!isWithin(packetRoot, realPath)) {
    errors.push(`${prefix}:path-outside-packet-root`);
    return null;
  }
  return finalStat;
}

function readOpenedRegularFile({
  filePath,
  maxBytes,
  prefix,
  expectedStat,
  errors,
}) {
  let descriptor;
  try {
    descriptor = openSync(
      filePath,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const stat = fstatSync(descriptor);
    if (
      expectedStat &&
      (stat.dev !== expectedStat.dev || stat.ino !== expectedStat.ino)
    ) {
      errors.push(`${prefix}:file-changed-during-read`);
      return null;
    }
    if (!stat.isFile()) {
      errors.push(`${prefix}:regular-file-required`);
      return null;
    }
    if (stat.size > maxBytes) {
      errors.push(`${prefix}:artifact-too-large`);
      return null;
    }
    const chunks = [];
    let totalBytes = 0;
    while (totalBytes <= maxBytes) {
      const remaining = maxBytes + 1 - totalBytes;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const bytesRead = readSync(
        descriptor,
        buffer,
        0,
        buffer.byteLength,
        null,
      );
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
    if (totalBytes > maxBytes) {
      errors.push(`${prefix}:artifact-too-large`);
      return null;
    }
    const afterRead = fstatSync(descriptor);
    if (
      stat.dev !== afterRead.dev ||
      stat.ino !== afterRead.ino ||
      stat.size !== afterRead.size ||
      stat.mtimeMs !== afterRead.mtimeMs ||
      stat.ctimeMs !== afterRead.ctimeMs ||
      totalBytes !== afterRead.size
    ) {
      errors.push(`${prefix}:file-changed-during-read`);
      return null;
    }
    return Buffer.concat(chunks, totalBytes);
  } catch (error) {
    if (error?.code === "ELOOP") errors.push(`${prefix}:symlink-forbidden`);
    else errors.push(`${prefix}:file-missing-or-unreadable`);
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readTopLevelJsonFile({ filePath, label, maxBytes, errors }) {
  const absolutePath = canonicalizeSystemRootAlias(filePath);
  if (hasSymlinkAncestor(absolutePath)) {
    errors.push(`${label}-symlink-ancestor-forbidden`);
    return null;
  }
  const stat = safeLstat(absolutePath);
  if (!stat) {
    errors.push(`${label}-missing-or-unreadable`);
    return null;
  }
  if (stat.isSymbolicLink()) {
    errors.push(`${label}-symlink-forbidden`);
    return null;
  }
  if (!stat.isFile()) {
    errors.push(`${label}-regular-file-required`);
    return null;
  }
  if (stat.size > maxBytes) {
    errors.push(`${label}-too-large`);
    return null;
  }
  const bytes = readOpenedRegularFile({
    filePath: absolutePath,
    maxBytes,
    prefix: label,
    expectedStat: stat,
    errors,
  });
  if (!bytes) return null;
  let value;
  try {
    value = JSON.parse(UTF8_DECODER.decode(bytes));
  } catch {
    errors.push(`${label}-json-invalid`);
    return null;
  }
  let realPath;
  try {
    realPath = realpathSync(absolutePath);
  } catch {
    errors.push(`${label}-missing-or-unreadable`);
    return null;
  }
  return { value, realPath, sha256: sha256(bytes) };
}

function buildResult({
  valid,
  errors,
  unsupportedReceiptSchemas,
  manifest,
  signatureVerified,
  artifacts,
  artifactSet = { complete: false, missing: [], unexpected: [] },
}) {
  return {
    valid,
    promotionEligible: false,
    errors: unique(errors),
    unsupportedReceiptSchemas: [...unsupportedReceiptSchemas].sort(),
    artifactSetComplete: artifactSet.complete,
    missingRequiredArtifacts: artifactSet.missing,
    unexpectedArtifacts: artifactSet.unexpected,
    evidenceSetId: readString(manifest?.evidenceSetId),
    candidate: validCandidate(manifest?.candidate)
      ? copyCandidate(manifest.candidate)
      : null,
    authority: {
      keyId: readString(manifest?.authority?.keyId),
      role: readString(manifest?.authority?.role),
      signatureVerified,
    },
    artifacts,
  };
}

function canonicalJson(value, seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("cyclic JSON value");
    seen.add(value);
    const output = `[${value.map((entry) => canonicalJson(entry, seen)).join(",")}]`;
    seen.delete(value);
    return output;
  }
  if (isRecord(value)) {
    if (seen.has(value)) throw new TypeError("cyclic JSON value");
    seen.add(value);
    const entries = Object.keys(value)
      .sort()
      .map((key) => {
        const entry = value[key];
        if (entry === undefined) throw new TypeError("undefined JSON value");
        return `${JSON.stringify(key)}:${canonicalJson(entry, seen)}`;
      });
    seen.delete(value);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError("unsupported JSON value");
}

function validArtifactPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes("\\") ||
    value.includes("\0") ||
    !/^[A-Za-z0-9._/-]+$/.test(value) ||
    isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

function validCandidate(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, CANDIDATE_KEYS) &&
    /^[0-9a-f]{40}$/.test(value.gitSha) &&
    isSha256(value.contentSha256) &&
    /^dpl_[A-Za-z0-9]{8,128}$/.test(value.deploymentId) &&
    validHostname(value.deploymentHost) &&
    /^prj_[A-Za-z0-9]{8,128}$/.test(value.projectId)
  );
}

function validHostname(value) {
  return (
    typeof value === "string" &&
    value.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      value,
    )
  );
}

function sameCandidate(left, right) {
  return (
    validCandidate(left) &&
    validCandidate(right) &&
    CANDIDATE_KEYS.every((key) => left[key] === right[key])
  );
}

function copyCandidate(value) {
  return Object.fromEntries(CANDIDATE_KEYS.map((key) => [key, value[key]]));
}

function validIdentifier(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(value)
  );
}

function validReceiptSchemaName(value) {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]{2,127}$/.test(value)
  );
}

function validateRequiredArtifacts(value, errors) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    errors.push("required-artifacts-contract-required");
    return [];
  }
  const normalized = [];
  const identities = new Set();
  let invalid = false;
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasRequiredAndAllowedKeys(
        entry,
        REQUIRED_ARTIFACT_REQUIRED_KEYS,
        REQUIRED_ARTIFACT_ALLOWED_KEYS,
      ) ||
      !validIdentifier(entry.id) ||
      !validReceiptSchemaName(entry.receiptSchema) ||
      (entry.sourceAuthorityRole !== undefined &&
        !validIdentifier(entry.sourceAuthorityRole)) ||
      (entry.mustDifferFromIndexAuthority !== undefined &&
        typeof entry.mustDifferFromIndexAuthority !== "boolean")
    ) {
      invalid = true;
      continue;
    }
    const identity = artifactIdentity(entry);
    if (identities.has(identity)) {
      invalid = true;
      continue;
    }
    identities.add(identity);
    normalized.push(copyArtifactContract(entry));
  }
  if (invalid || normalized.length !== value.length) {
    errors.push("required-artifacts-contract-invalid");
  }
  return normalized;
}

function compareRequiredArtifacts(actual, required) {
  const actualByIdentity = new Map(
    actual.map((entry) => [artifactIdentity(entry), entry]),
  );
  const requiredByIdentity = new Map(
    required.map((entry) => [artifactIdentity(entry), entry]),
  );
  const missing = required
    .filter((entry) => !actualByIdentity.has(artifactIdentity(entry)))
    .map(copyArtifactContract);
  const unexpected = actual
    .filter((entry) => !requiredByIdentity.has(artifactIdentity(entry)))
    .map(copyArtifactContract);
  return { complete: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}

function artifactIdentity(value) {
  return `${value.id}\0${value.receiptSchema}`;
}

function copyArtifactContract(value) {
  const output = { id: value.id, receiptSchema: value.receiptSchema };
  if (value.sourceAuthorityRole !== undefined) {
    output.sourceAuthorityRole = value.sourceAuthorityRole;
  }
  if (value.mustDifferFromIndexAuthority !== undefined) {
    output.mustDifferFromIndexAuthority = value.mustDifferFromIndexAuthority;
  }
  return output;
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isWithin(root, candidatePath) {
  const delta = relative(root, candidatePath);
  return delta === "" || (!delta.startsWith(`..${sep}`) && delta !== "..");
}

function readReceiptValidator(validators, schema) {
  if (validators instanceof Map) {
    const value = validators.get(schema);
    return typeof value === "function" ? value : null;
  }
  if (
    isRecord(validators) &&
    Object.prototype.hasOwnProperty.call(validators, schema) &&
    typeof validators[schema] === "function"
  ) {
    return validators[schema];
  }
  return null;
}

function readDerivedFieldAllowlist(allowlists, schema) {
  let value;
  if (allowlists instanceof Map) value = allowlists.get(schema);
  else if (
    isRecord(allowlists) &&
    Object.prototype.hasOwnProperty.call(allowlists, schema)
  ) {
    value = allowlists[schema];
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 64 ||
    value.some(
      (field) =>
        typeof field !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field),
    ) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return value;
}

function readDerivedSanitizer(sanitizers, schema) {
  if (sanitizers instanceof Map) {
    const value = sanitizers.get(schema);
    return typeof value === "function" ? value : null;
  }
  if (
    isRecord(sanitizers) &&
    Object.prototype.hasOwnProperty.call(sanitizers, schema) &&
    typeof sanitizers[schema] === "function"
  ) {
    return sanitizers[schema];
  }
  return null;
}

function readPathOption(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function hasRequiredAndAllowedKeys(value, required, allowed) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  const allowedSet = new Set(allowed);
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every((key) => allowedSet.has(key))
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeLstat(filePath) {
  try {
    return lstatSync(filePath);
  } catch {
    return null;
  }
}

function hasSymlinkAncestor(filePath) {
  let cursor = dirname(filePath);
  while (true) {
    const stat = safeLstat(cursor);
    if (stat?.isSymbolicLink()) return true;
    const parent = dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

function canonicalizeSystemRootAlias(filePath) {
  const absolutePath = resolve(filePath);
  const root = parse(absolutePath).root;
  const segments = relative(root, absolutePath).split(sep).filter(Boolean);
  if (segments.length === 0) return absolutePath;
  const rootEntry = resolve(root, segments[0]);
  let canonicalRootEntry;
  try {
    canonicalRootEntry = realpathSync(rootEntry);
  } catch {
    return absolutePath;
  }
  return resolve(canonicalRootEntry, ...segments.slice(1));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function publicKeySpkiSha256(key) {
  return sha256(key.export({ format: "der", type: "spki" }));
}

function unique(values) {
  return [...new Set(values)];
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function validErrorCode(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
}

function copyJsonValue(value) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > 64 * 1024) return undefined;
    return JSON.parse(serialized);
  } catch {
    return undefined;
  }
}
