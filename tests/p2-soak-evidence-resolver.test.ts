import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSoakEvidenceIndexSigningPayload,
  createSoakEvidenceReceiptSigningPayload,
  resolveSoakEvidencePacket,
} from "../scripts/p2-soak-evidence-resolver.mjs";

const NOW_MS = Date.parse("2026-08-28T02:00:00.000Z");
const RECEIPT_SCHEMA = "test.synthetic.v1";
const SOURCE_AUTHORITY_ROLE = "synthetic-evidence-source";
const candidate = {
  gitSha: "540dc39f5b8ed9f5b5f4898296dc58c94f1a3692",
  contentSha256:
    "fc017bfaa04392478baf6a2882d915fe4e140602cec52a6bdf1f296fdb1a3877",
  deploymentId: "dpl_FLzWYLds7nJzYu7xn9vDVhk2ADZs",
  deploymentHost:
    "uais-staging-d0oecoeus-peter-dongpin-hu-s-projects.vercel.app",
  projectId: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
} as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("P2 soak evidence resolver", () => {
  it("excludes only the detached source signature from receipt signing bytes", () => {
    const receipt = {
      schemaVersion: 1,
      kind: "uais-soak-evidence-receipt",
      sourceSignature: "first-signature",
      payload: { status: "PASS" },
    };
    const first = createSoakEvidenceReceiptSigningPayload(receipt);
    receipt.sourceSignature = "second-signature";
    const second = createSoakEvidenceReceiptSigningPayload(receipt);

    expect(first.equals(second)).toBe(true);
    expect(first.toString("utf8")).not.toContain("sourceSignature");
  });

  it("resolves a fully content-addressed and independently signed packet", () => {
    const bundle = createSignedBundle();

    const result = resolveBundle(bundle);

    expect(result).toMatchObject({
      valid: true,
      promotionEligible: true,
      errors: [],
      unsupportedReceiptSchemas: [],
      evidenceSetId: bundle.manifest.evidenceSetId,
      candidate,
      authority: {
        keyId: "s22-test-authority-1",
        role: "soak-evidence-issuer",
        signatureVerified: true,
      },
      artifacts: [
        {
          id: "synthetic-receipt",
          receiptSchema: RECEIPT_SCHEMA,
          byteLength: bundle.receiptBytes.byteLength,
          sha256: sha256(bundle.receiptBytes),
          integrityVerified: true,
          eligible: true,
          sourceAuthority: {
            keyId: "synthetic-source-authority-1",
            role: SOURCE_AUTHORITY_ROLE,
            signatureVerified: true,
          },
          derived: { status: "PASS", sampleCount: 16 },
        },
      ],
    });
    expect(result.artifacts[0]).not.toHaveProperty("payload");
    expect(result.artifacts[0]).not.toHaveProperty("receipt");
  });

  it("rejects the old scalar manifest even when it contains arbitrary green evidence refs", () => {
    const directory = makeTemporaryDirectory();
    const manifestPath = join(directory, "old-green.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        decision: "SOAK_ADMITTED",
        candidate: { gitSha: candidate.gitSha },
        gates: {
          stagingHealth: {
            status: "PASS",
            evidenceClass: "current-candidate-external",
            evidenceRefs: ["anything-the-caller-wants"],
          },
        },
      }),
      "utf8",
    );
    const trustPolicyPath = join(dirname(directory), "missing-policy.json");

    const result = resolveSoakEvidencePacket({
      manifestPath,
      trustPolicyPath,
      expectedTrustPolicySha256: "0".repeat(64),
      expectedAuthorityKeyId: "s22-test-authority-1",
      expectedCandidate: candidate,
      requiredArtifacts: requiredArtifacts(),
      nowMs: NOW_MS,
    });

    expect(result.valid).toBe(false);
    expect(result.promotionEligible).toBe(false);
    expect(result.errors).toContain("manifest-schema-version-unsupported");
  });

  it.each([
    ["traversal", "../outside.json"],
    ["absolute", "/private/tmp/outside.json"],
    ["backslash", "receipts\\receipt.json"],
    ["NUL", "receipts/receipt\0.json"],
  ])("rejects %s artifact paths", (_label, maliciousPath) => {
    const bundle = createSignedBundle();
    bundle.manifest.artifacts[0].path = maliciousPath;
    writeSignedManifest(bundle);

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("artifact:synthetic-receipt:path-invalid");
  });

  it("rejects a symlink even when its target bytes and digest are correct", () => {
    const bundle = createSignedBundle();
    const symlinkPath = join(bundle.packetRoot, "receipts", "linked.json");
    symlinkSync(bundle.receiptPath, symlinkPath);
    bundle.manifest.artifacts[0].path = "receipts/linked.json";
    writeSignedManifest(bundle);

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "artifact:synthetic-receipt:symlink-forbidden",
    );
  });

  it("rejects non-regular and oversized artifacts before parsing them", () => {
    const bundle = createSignedBundle();
    mkdirSync(join(bundle.packetRoot, "receipts", "directory.json"));
    bundle.manifest.artifacts[0] = {
      ...bundle.manifest.artifacts[0],
      path: "receipts/directory.json",
      byteLength: 1,
      sha256: sha256(Buffer.alloc(0)),
    };
    writeSignedManifest(bundle);

    const special = resolveBundle(bundle);
    expect(special.valid).toBe(false);
    expect(special.errors).toContain(
      "artifact:synthetic-receipt:regular-file-required",
    );

    const fresh = createSignedBundle();
    const oversized = resolveBundle(fresh, {
      maxArtifactBytes: fresh.receiptBytes.byteLength - 1,
    });
    expect(oversized.valid).toBe(false);
    expect(oversized.errors).toContain(
      "artifact:synthetic-receipt:artifact-too-large",
    );
  });

  it("checks exact byte length and SHA-256 before JSON schema validation", () => {
    const sizeBundle = createSignedBundle();
    sizeBundle.manifest.artifacts[0].byteLength += 1;
    writeSignedManifest(sizeBundle);
    const sizeResult = resolveBundle(sizeBundle);
    expect(sizeResult.valid).toBe(false);
    expect(sizeResult.errors).toContain(
      "artifact:synthetic-receipt:byte-length-mismatch",
    );

    const hashBundle = createSignedBundle();
    hashBundle.manifest.artifacts[0].sha256 = "0".repeat(64);
    writeSignedManifest(hashBundle);
    const hashResult = resolveBundle(hashBundle);
    expect(hashResult.valid).toBe(false);
    expect(hashResult.errors).toContain(
      "artifact:synthetic-receipt:sha256-mismatch",
    );
    expect(hashResult.artifacts[0]).toMatchObject({
      receiptSchema: RECEIPT_SCHEMA,
      sha256: sha256(hashBundle.receiptBytes),
      byteLength: hashBundle.receiptBytes.byteLength,
      integrityVerified: false,
      eligible: false,
    });
  });

  it("does not call any source validator until every artifact is intact", () => {
    const bundle = createSignedBundle();
    const secondPath = join(bundle.packetRoot, "receipts", "second.json");
    writeFileSync(secondPath, bundle.receiptBytes);
    bundle.manifest.artifacts.push({
      ...bundle.manifest.artifacts[0],
      id: "synthetic-receipt-2",
      path: "receipts/second.json",
      sha256: "0".repeat(64),
    });
    writeSignedManifest(bundle);
    let validatorCalls = 0;

    const result = resolveBundle(bundle, {
      receiptValidators: {
        [RECEIPT_SCHEMA]: () => {
          validatorCalls += 1;
          return { valid: true, eligible: true };
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "artifact:synthetic-receipt-2:sha256-mismatch",
    );
    expect(validatorCalls).toBe(0);
  });

  it("strictly validates the index, receipt envelope, and source payload", () => {
    const indexBundle = createSignedBundle();
    Object.assign(indexBundle.manifest, { arbitraryGreenFlag: true });
    writeSignedManifest(indexBundle);
    const indexResult = resolveBundle(indexBundle);
    expect(indexResult.valid).toBe(false);
    expect(indexResult.errors).toContain("manifest-keys-invalid");

    const envelopeBundle = createSignedBundle({
      receiptExtra: { callerSaysAuthentic: true },
    });
    const envelopeResult = resolveBundle(envelopeBundle);
    expect(envelopeResult.valid).toBe(false);
    expect(envelopeResult.errors).toContain(
      "artifact:synthetic-receipt:receipt-keys-invalid",
    );

    const payloadBundle = createSignedBundle({
      payload: { status: "PASS", sampleCount: "16" },
    });
    const payloadResult = resolveBundle(payloadBundle);
    expect(payloadResult.valid).toBe(false);
    expect(payloadResult.errors).toContain(
      "artifact:synthetic-receipt:synthetic-payload-invalid",
    );
  });

  it("rejects a packet-issuer fabrication with no detached source signature", () => {
    const bundle = createSignedBundle();
    delete (bundle.receipt as Partial<Receipt>).sourceSignature;
    writeReceiptAndIndex(bundle, { signSource: false });

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "artifact:synthetic-receipt:receipt-source-signature-required",
    );
  });

  it.each([
    ["key", "source-authority-key-not-found", (bundle: TestBundle) => {
      bundle.receipt.sourceAuthority.keyId = "untrusted-source-key";
    }],
    ["role", "source-authority-role-mismatch", (bundle: TestBundle) => {
      bundle.receipt.sourceAuthority.role = "untrusted-source-role";
    }],
  ] as const)("rejects a wrong source authority %s", (_label, error, mutate) => {
    const bundle = createSignedBundle();
    mutate(bundle);
    rewriteReceiptAndIndex(bundle);

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`artifact:synthetic-receipt:${error}`);
  });

  it("rejects a source authority not allowed to issue the receipt schema", () => {
    const bundle = createSignedBundle();
    bundle.trustPolicy.authorities[1].allowedReceiptSchemas = ["test.other.v1"];
    writeTrustPolicy(bundle);

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "artifact:synthetic-receipt:source-authority-receipt-schema-not-allowed",
    );
  });

  it("enforces source/index issuer separation from the required artifact contract", () => {
    const bundle = createSignedBundle();
    bundle.receipt.sourceAuthority = {
      ...bundle.manifest.authority,
    };
    bundle.sourcePrivateKey = bundle.privateKey;
    rewriteReceiptAndIndex(bundle);

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "artifact:synthetic-receipt:source-authority-must-differ-from-index-authority",
    );
  });

  it("rejects different authority IDs that reuse the index issuer public key", () => {
    const bundle = createSignedBundle();
    bundle.trustPolicy.authorities[1].publicKeyPem =
      bundle.trustPolicy.authorities[0].publicKeyPem;
    bundle.sourcePrivateKey = bundle.privateKey;
    writeTrustPolicy(bundle);
    rewriteReceiptAndIndex(bundle);

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "artifact:synthetic-receipt:source-authority-must-differ-from-index-authority",
    );
  });

  it("rejects a bad detached source signature even under a valid packet signature", () => {
    const bundle = createSignedBundle();
    const unrelatedKey = generateKeyPairSync("ed25519").privateKey;
    writeReceiptAndIndex(bundle, { signingKey: unrelatedKey });

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "artifact:synthetic-receipt:source-signature-invalid",
    );
  });

  it("rejects reuse of one source-signed receipt under a second artifact ID", () => {
    const bundle = createSignedBundle();
    const secondPath = join(bundle.packetRoot, "receipts", "second.json");
    writeFileSync(secondPath, bundle.receiptBytes);
    bundle.manifest.artifacts.push({
      ...bundle.manifest.artifacts[0],
      id: "synthetic-receipt-2",
      path: "receipts/second.json",
    });
    writeSignedManifest(bundle);
    let validatorCalls = 0;

    const result = resolveBundle(bundle, {
      requiredArtifacts: [
        ...requiredArtifacts(),
        {
          id: "synthetic-receipt-2",
          receiptSchema: RECEIPT_SCHEMA,
          sourceAuthorityRole: SOURCE_AUTHORITY_ROLE,
          mustDifferFromIndexAuthority: true,
        },
      ],
      receiptValidators: {
        [RECEIPT_SCHEMA]: () => {
          validatorCalls += 1;
          return { valid: true, eligible: true };
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.promotionEligible).toBe(false);
    expect(result.errors).toContain(
      "artifact:synthetic-receipt-2:receipt-artifact-id-mismatch",
    );
    expect(validatorCalls).toBe(0);
  });

  it.each([
    ["candidate", "source-authority-candidate-mismatch", (bundle: TestBundle) => {
      bundle.trustPolicy.authorities[1].candidate.gitSha = "f".repeat(40);
    }],
    ["evidence set", "source-authority-evidence-set-mismatch", (bundle: TestBundle) => {
      bundle.trustPolicy.authorities[1].evidenceSetId = "evset_other";
    }],
  ] as const)("rejects source-authority cross-%s binding", (_label, error, mutate) => {
    const bundle = createSignedBundle();
    mutate(bundle);
    writeTrustPolicy(bundle);

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`artifact:synthetic-receipt:${error}`);
  });

  it("keeps an authentic unsupported source schema integrity-valid but promotion-ineligible", () => {
    const bundle = createSignedBundle();

    const result = resolveBundle(bundle, { receiptValidators: {} });

    expect(result).toMatchObject({
      valid: true,
      promotionEligible: false,
      errors: [],
      unsupportedReceiptSchemas: [RECEIPT_SCHEMA],
      artifacts: [
        {
          receiptSchema: RECEIPT_SCHEMA,
          integrityVerified: true,
          eligible: false,
        },
      ],
    });
  });

  it("requires an exact derived-field allowlist before exposing validator output", () => {
    const bundle = createSignedBundle();
    const noAllowlist = resolveBundle(bundle, {
      derivedFieldAllowlist: {},
    });
    expect(noAllowlist.valid).toBe(false);
    expect(noAllowlist.errors).toContain(
      "artifact:synthetic-receipt:derived-field-allowlist-required",
    );

    const missingField = resolveBundle(bundle, {
      receiptValidators: {
        [RECEIPT_SCHEMA]: () => ({
          valid: true,
          eligible: true,
          derived: { status: "PASS" },
        }),
      },
    });
    expect(missingField.valid).toBe(false);
    expect(missingField.errors).toContain(
      "artifact:synthetic-receipt:derived-keys-invalid",
    );
  });

  it("rejects a validator that tries to leak raw payload through derived output", () => {
    const bundle = createSignedBundle();

    const result = resolveBundle(bundle, {
      receiptValidators: {
        [RECEIPT_SCHEMA]: () => ({
          valid: true,
          eligible: true,
          derived: {
            status: "PASS",
            sampleCount: 16,
            rawPayload: { secret: "must-not-leave-validator" },
          },
        }),
      },
    });

    expect(result.valid).toBe(false);
    expect(result.promotionEligible).toBe(false);
    expect(result.errors).toContain(
      "artifact:synthetic-receipt:derived-keys-invalid",
    );
    expect(result.artifacts[0]).not.toHaveProperty("derived");
    expect(JSON.stringify(result)).not.toContain("must-not-leave-validator");
  });

  it("requires a strict per-schema sanitizer and derived output for eligible artifacts", () => {
    const bundle = createSignedBundle();
    const noSanitizer = resolveBundle(bundle, { derivedSanitizers: {} });
    expect(noSanitizer.valid).toBe(false);
    expect(noSanitizer.errors).toContain(
      "artifact:synthetic-receipt:derived-sanitizer-required",
    );

    const noDerived = resolveBundle(bundle, {
      receiptValidators: {
        [RECEIPT_SCHEMA]: () => ({ valid: true, eligible: true }),
      },
    });
    expect(noDerived.valid).toBe(false);
    expect(noDerived.errors).toContain(
      "artifact:synthetic-receipt:eligible-requires-derived",
    );
  });

  it("rejects nested raw data even when its top-level field is allowlisted", () => {
    const bundle = createSignedBundle();

    const result = resolveBundle(bundle, {
      receiptValidators: {
        [RECEIPT_SCHEMA]: () => ({
          valid: true,
          eligible: true,
          derived: {
            status: { rawPayload: "must-not-leave-sanitizer" },
            sampleCount: 16,
          },
        }),
      },
    });

    expect(result.valid).toBe(false);
    expect(result.promotionEligible).toBe(false);
    expect(result.errors).toContain(
      "artifact:synthetic-receipt:synthetic-derived-invalid",
    );
    expect(result.artifacts[0]).not.toHaveProperty("derived");
    expect(JSON.stringify(result)).not.toContain("must-not-leave-sanitizer");
  });

  it("passes only frozen verified source-authority metadata to semantic validators", () => {
    const bundle = createSignedBundle();
    let observedContext: Record<string, unknown> | undefined;

    const result = resolveBundle(bundle, {
      receiptValidators: {
        [RECEIPT_SCHEMA]: (
          _payload: unknown,
          context: Record<string, unknown>,
        ) => {
          observedContext = context;
          return {
            valid: true,
            eligible: true,
            derived: { status: "PASS", sampleCount: 16 },
          };
        },
      },
    });

    expect(result.valid).toBe(true);
    expect(observedContext?.sourceAuthority).toEqual({
      keyId: "synthetic-source-authority-1",
      role: SOURCE_AUTHORITY_ROLE,
      signatureVerified: true,
    });
    expect(Object.isFrozen(observedContext?.sourceAuthority)).toBe(true);
    expect(observedContext).not.toHaveProperty("sourceSignature");
    expect(observedContext).not.toHaveProperty("receipt");
  });

  it("requires caller-pinned trust-policy SHA-256 and authority key ID", () => {
    const bundle = createSignedBundle();

    const missingPins = resolveSoakEvidencePacket({
      manifestPath: bundle.manifestPath,
      trustPolicyPath: bundle.trustPolicyPath,
      expectedCandidate: candidate,
      requiredArtifacts: requiredArtifacts(),
      nowMs: NOW_MS,
    });
    expect(missingPins.valid).toBe(false);
    expect(missingPins.errors).toEqual(
      expect.arrayContaining([
        "expected-trust-policy-sha256-required",
        "expected-authority-key-id-required",
      ]),
    );

    const wrongDigest = resolveBundle(bundle, {
      expectedTrustPolicySha256: "0".repeat(64),
    });
    expect(wrongDigest.valid).toBe(false);
    expect(wrongDigest.errors).toContain("trust-policy-sha256-mismatch");

    const wrongKey = resolveBundle(bundle, {
      expectedAuthorityKeyId: "different-trusted-key",
    });
    expect(wrongKey.valid).toBe(false);
    expect(wrongKey.errors).toContain("authority-key-id-pin-mismatch");
  });

  it("rejects an attacker-generated sibling policy and matching self-signed index", () => {
    const bundle = createSignedBundle();
    const trustedPolicySha256 = bundle.expectedTrustPolicySha256;
    const attacker = generateKeyPairSync("ed25519");
    bundle.privateKey = attacker.privateKey;
    bundle.trustPolicy.authorities[0].publicKeyPem = attacker.publicKey.export({
      format: "pem",
      type: "spki",
    }) as string;
    writeTrustPolicy(bundle, { updatePin: false });
    writeSignedManifest(bundle);

    const result = resolveBundle(bundle, {
      expectedTrustPolicySha256: trustedPolicySha256,
    });

    expect(result.valid).toBe(false);
    expect(result.promotionEligible).toBe(false);
    expect(result.errors).toContain("trust-policy-sha256-mismatch");
    expect(result.authority.signatureVerified).toBe(false);
  });

  it("keeps a signed packet with an omitted required artifact promotion-ineligible", () => {
    const bundle = createSignedBundle();
    let validatorCalls = 0;

    const result = resolveBundle(bundle, {
      requiredArtifacts: [
        ...requiredArtifacts(),
        { id: "required-health-receipt", receiptSchema: RECEIPT_SCHEMA },
      ],
      receiptValidators: {
        [RECEIPT_SCHEMA]: () => {
          validatorCalls += 1;
          return { valid: true, eligible: true };
        },
      },
    });

    expect(result).toMatchObject({
      valid: true,
      promotionEligible: false,
      artifactSetComplete: false,
      missingRequiredArtifacts: [
        {
          id: "required-health-receipt",
          receiptSchema: RECEIPT_SCHEMA,
        },
      ],
      unexpectedArtifacts: [],
    });
    expect(validatorCalls).toBe(0);
  });

  it("requires a separate non-symlink trust policy outside the packet root", () => {
    const insideBundle = createSignedBundle();
    const insidePolicyPath = join(insideBundle.packetRoot, "trust-policy.json");
    writeFileSync(
      insidePolicyPath,
      JSON.stringify(insideBundle.trustPolicy),
      "utf8",
    );
    const insideResult = resolveBundle(insideBundle, {
      trustPolicyPath: insidePolicyPath,
    });
    expect(insideResult.valid).toBe(false);
    expect(insideResult.errors).toContain(
      "trust-policy-must-be-outside-packet-root",
    );

    const linkedBundle = createSignedBundle();
    const linkedPolicyPath = join(
      dirname(linkedBundle.packetRoot),
      "linked-policy.json",
    );
    symlinkSync(linkedBundle.trustPolicyPath, linkedPolicyPath);
    const linkedResult = resolveBundle(linkedBundle, {
      trustPolicyPath: linkedPolicyPath,
    });
    expect(linkedResult.valid).toBe(false);
    expect(linkedResult.errors).toContain("trust-policy-symlink-forbidden");
  });

  it("rejects a manifest reached through a symlinked ancestor directory", () => {
    const bundle = createSignedBundle();
    const linkedPacketRoot = join(bundle.directory, "linked-packet");
    symlinkSync(bundle.packetRoot, linkedPacketRoot, "dir");

    const result = resolveBundle(bundle, {
      manifestPath: join(linkedPacketRoot, "index.json"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("manifest-symlink-ancestor-forbidden");
  });

  it("rejects a trust policy reached through a symlinked ancestor directory", () => {
    const bundle = createSignedBundle();
    const actualPolicyRoot = join(bundle.directory, "actual-policy-root");
    const linkedPolicyRoot = join(bundle.directory, "linked-policy-root");
    mkdirSync(actualPolicyRoot);
    writeFileSync(
      join(actualPolicyRoot, "trust-policy.json"),
      JSON.stringify(bundle.trustPolicy),
      "utf8",
    );
    symlinkSync(actualPolicyRoot, linkedPolicyRoot, "dir");

    const result = resolveBundle(bundle, {
      trustPolicyPath: join(linkedPolicyRoot, "trust-policy.json"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "trust-policy-symlink-ancestor-forbidden",
    );
  });

  it("accepts the trusted macOS /var system alias after canonicalization", () => {
    const bundle = createSignedBundle();
    const aliasedManifestPath = macOsVarAlias(bundle.manifestPath);
    const aliasedTrustPolicyPath = macOsVarAlias(bundle.trustPolicyPath);
    if (aliasedManifestPath === bundle.manifestPath) return;

    const result = resolveBundle(bundle, {
      manifestPath: aliasedManifestPath,
      trustPolicyPath: aliasedTrustPolicyPath,
    });

    expect(result.valid).toBe(true);
    expect(result.promotionEligible).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing authority and self-referential index artifacts", () => {
    const noAuthority = createSignedBundle();
    delete (noAuthority.manifest as Partial<typeof noAuthority.manifest>)
      .authority;
    writeSignedManifest(noAuthority);
    const noAuthorityResult = resolveBundle(noAuthority);
    expect(noAuthorityResult.valid).toBe(false);
    expect(noAuthorityResult.errors).toContain("manifest-authority-required");

    const selfDigest = createSignedBundle();
    selfDigest.manifest.artifacts[0] = {
      ...selfDigest.manifest.artifacts[0],
      path: "index.json",
    };
    writeSignedManifest(selfDigest);
    const selfDigestResult = resolveBundle(selfDigest);
    expect(selfDigestResult.valid).toBe(false);
    expect(selfDigestResult.errors).toContain(
      "artifact:synthetic-receipt:self-reference-forbidden",
    );
  });

  it.each([
    ["key id", "authority-key-id-pin-mismatch", (bundle: TestBundle) => {
      bundle.manifest.authority.keyId = "untrusted-key";
      writeSignedManifest(bundle);
    }],
    ["role", "authority-role-mismatch", (bundle: TestBundle) => {
      bundle.trustPolicy.authorities[0].role = "unrelated-role";
      writeTrustPolicy(bundle);
    }],
    ["candidate", "authority-candidate-mismatch", (bundle: TestBundle) => {
      bundle.trustPolicy.authorities[0].candidate.contentSha256 = "f".repeat(64);
      writeTrustPolicy(bundle);
    }],
    ["evidence set", "authority-evidence-set-mismatch", (bundle: TestBundle) => {
      bundle.trustPolicy.authorities[0].evidenceSetId = "evset_other";
      writeTrustPolicy(bundle);
    }],
  ] as const)("rejects authority %s mismatch", (_label, error, mutate) => {
    const bundle = createSignedBundle();
    mutate(bundle);

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(error);
  });

  it("verifies the Ed25519 signature over the canonical unsigned index", () => {
    const bundle = createSignedBundle();
    const otherKey = generateKeyPairSync("ed25519").privateKey;
    bundle.manifest.signature = sign(
      null,
      createSoakEvidenceIndexSigningPayload(bundle.manifest),
      otherKey,
    ).toString("base64url");
    writeFileSync(
      bundle.manifestPath,
      JSON.stringify(bundle.manifest),
      "utf8",
    );

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("manifest-signature-invalid");
  });

  it.each([
    [
      "gitSha",
      "f".repeat(40),
    ],
    [
      "contentSha256",
      "e".repeat(64),
    ],
    ["deploymentId", "dpl_differentCandidate123456789"],
    ["deploymentHost", "different-staging.example.test"],
    ["projectId", "prj_differentCandidate123456789"],
  ] as const)("rejects cross-candidate %s substitution", (field, value) => {
    const bundle = createSignedBundle();
    Object.assign(bundle.manifest.candidate, { [field]: value });
    Object.assign(bundle.receipt.candidate, { [field]: value });
    Object.assign(bundle.trustPolicy.authorities[0].candidate, {
      [field]: value,
    });
    rewriteReceiptAndIndex(bundle);
    writeTrustPolicy(bundle);

    const result = resolveBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`candidate-mismatch:${field}`);
  });

  it("rejects receipt candidate and evidence-set substitution even with a newly signed index", () => {
    const candidateBundle = createSignedBundle();
    candidateBundle.receipt.candidate.gitSha = "e".repeat(40);
    rewriteReceiptAndIndex(candidateBundle);
    const candidateResult = resolveBundle(candidateBundle);
    expect(candidateResult.valid).toBe(false);
    expect(candidateResult.errors).toContain(
      "artifact:synthetic-receipt:receipt-candidate-mismatch",
    );

    const evidenceSetBundle = createSignedBundle();
    evidenceSetBundle.receipt.evidenceSetId = "evset_other";
    rewriteReceiptAndIndex(evidenceSetBundle);
    const evidenceSetResult = resolveBundle(evidenceSetBundle);
    expect(evidenceSetResult.valid).toBe(false);
    expect(evidenceSetResult.errors).toContain(
      "artifact:synthetic-receipt:receipt-evidence-set-mismatch",
    );
  });

  it("rejects expired, future-issued, and stale evidence", () => {
    const expiredManifest = createSignedBundle();
    expiredManifest.manifest.expiresAt = new Date(NOW_MS).toISOString();
    writeSignedManifest(expiredManifest);
    expect(resolveBundle(expiredManifest).errors).toContain("manifest-expired");

    const futureReceipt = createSignedBundle();
    futureReceipt.receipt.issuedAt = new Date(NOW_MS + 120_000).toISOString();
    futureReceipt.receipt.expiresAt = new Date(NOW_MS + 240_000).toISOString();
    rewriteReceiptAndIndex(futureReceipt);
    expect(resolveBundle(futureReceipt).errors).toContain(
      "artifact:synthetic-receipt:receipt-issued-in-future",
    );

    const staleManifest = createSignedBundle();
    staleManifest.manifest.issuedAt = new Date(
      NOW_MS - 24 * 60 * 60 * 1000 - 1,
    ).toISOString();
    writeSignedManifest(staleManifest);
    expect(resolveBundle(staleManifest).errors).toContain("manifest-stale");

    const expiredReceipt = createSignedBundle();
    expiredReceipt.receipt.expiresAt = new Date(NOW_MS).toISOString();
    rewriteReceiptAndIndex(expiredReceipt);
    expect(resolveBundle(expiredReceipt).errors).toContain(
      "artifact:synthetic-receipt:receipt-expired",
    );
  });

  it.each([
    ["issuedAt", "receipt-issued-at-invalid"],
    ["expiresAt", "receipt-expires-at-invalid"],
  ] as const)("rejects a source-signed receipt with invalid %s", (field, error) => {
    const bundle = createSignedBundle();
    bundle.receipt[field] = "not-an-iso-timestamp";
    rewriteReceiptAndIndex(bundle);
    let validatorCalls = 0;

    const result = resolveBundle(bundle, {
      receiptValidators: {
        [RECEIPT_SCHEMA]: () => {
          validatorCalls += 1;
          return { valid: true, eligible: true };
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.promotionEligible).toBe(false);
    expect(result.errors).toContain(`artifact:synthetic-receipt:${error}`);
    expect(validatorCalls).toBe(0);
  });
});

type Candidate = {
  gitSha: string;
  contentSha256: string;
  deploymentId: string;
  deploymentHost: string;
  projectId: string;
};

type Receipt = {
  schemaVersion: number;
  kind: string;
  artifactId: string;
  receiptSchema: string;
  evidenceSetId: string;
  candidate: Candidate;
  issuedAt: string;
  expiresAt: string;
  sourceAuthority: {
    keyId: string;
    algorithm: string;
    role: string;
  };
  sourceSignature: string;
  payload: Record<string, unknown>;
  [key: string]: unknown;
};

type Manifest = {
  schemaVersion: number;
  kind: string;
  evidenceSetId: string;
  candidate: Candidate;
  issuedAt: string;
  expiresAt: string;
  artifacts: Array<{
    id: string;
    path: string;
    receiptSchema: string;
    byteLength: number;
    sha256: string;
  }>;
  authority: {
    keyId: string;
    algorithm: string;
    role: string;
  };
  signature: string;
  [key: string]: unknown;
};

type TrustPolicy = {
  schemaVersion: number;
  kind: string;
  policyId: string;
  authorities: Array<{
    keyId: string;
    algorithm: string;
    role: string;
    publicKeyPem: string;
    candidate: Candidate;
    evidenceSetId: string;
    allowedReceiptSchemas: string[];
    notBefore: string;
    notAfter: string;
  }>;
};

type TestBundle = {
  directory: string;
  packetRoot: string;
  manifestPath: string;
  trustPolicyPath: string;
  receiptPath: string;
  privateKey: KeyObject;
  sourcePrivateKey: KeyObject;
  manifest: Manifest;
  trustPolicy: TrustPolicy;
  receipt: Receipt;
  receiptBytes: Buffer;
  expectedTrustPolicySha256: string;
  expectedAuthorityKeyId: string;
};

function createSignedBundle(
  overrides: {
    payload?: Record<string, unknown>;
    receiptExtra?: Record<string, unknown>;
  } = {},
): TestBundle {
  const directory = makeTemporaryDirectory();
  const packetRoot = join(directory, "packet");
  const receiptsDirectory = join(packetRoot, "receipts");
  mkdirSync(receiptsDirectory, { recursive: true });
  const manifestPath = join(packetRoot, "index.json");
  const trustPolicyPath = join(directory, "trust-policy.json");
  const receiptPath = join(receiptsDirectory, "synthetic.json");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const {
    privateKey: sourcePrivateKey,
    publicKey: sourcePublicKey,
  } = generateKeyPairSync("ed25519");
  const evidenceSetId = "evset_540dc39_synthetic_01";
  const receipt: Receipt = {
    schemaVersion: 1,
    kind: "uais-soak-evidence-receipt",
    artifactId: "synthetic-receipt",
    receiptSchema: RECEIPT_SCHEMA,
    evidenceSetId,
    candidate: { ...candidate },
    issuedAt: new Date(NOW_MS - 60_000).toISOString(),
    expiresAt: new Date(NOW_MS + 60 * 60 * 1000).toISOString(),
    sourceAuthority: {
      keyId: "synthetic-source-authority-1",
      algorithm: "Ed25519",
      role: SOURCE_AUTHORITY_ROLE,
    },
    sourceSignature: "",
    payload: overrides.payload ?? { status: "PASS", sampleCount: 16 },
    ...overrides.receiptExtra,
  };
  receipt.sourceSignature = sign(
    null,
    createSoakEvidenceReceiptSigningPayload(receipt),
    sourcePrivateKey,
  ).toString("base64url");
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  writeFileSync(receiptPath, receiptBytes);
  const manifest: Manifest = {
    schemaVersion: 2,
    kind: "uais-soak-evidence-index",
    evidenceSetId,
    candidate: { ...candidate },
    issuedAt: new Date(NOW_MS - 30_000).toISOString(),
    expiresAt: new Date(NOW_MS + 30 * 60 * 1000).toISOString(),
    artifacts: [
      {
        id: "synthetic-receipt",
        path: "receipts/synthetic.json",
        receiptSchema: RECEIPT_SCHEMA,
        byteLength: receiptBytes.byteLength,
        sha256: sha256(receiptBytes),
      },
    ],
    authority: {
      keyId: "s22-test-authority-1",
      algorithm: "Ed25519",
      role: "soak-evidence-issuer",
    },
    signature: "",
  };
  const trustPolicy: TrustPolicy = {
    schemaVersion: 1,
    kind: "uais-soak-evidence-trust-policy",
    policyId: "s22-soak-test-policy-v1",
    authorities: [
      {
        keyId: "s22-test-authority-1",
        algorithm: "Ed25519",
        role: "soak-evidence-issuer",
        publicKeyPem: publicKey.export({
          format: "pem",
          type: "spki",
        }) as string,
        candidate: { ...candidate },
        evidenceSetId,
        allowedReceiptSchemas: [RECEIPT_SCHEMA],
        notBefore: new Date(NOW_MS - 60 * 60 * 1000).toISOString(),
        notAfter: new Date(NOW_MS + 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        keyId: "synthetic-source-authority-1",
        algorithm: "Ed25519",
        role: SOURCE_AUTHORITY_ROLE,
        publicKeyPem: sourcePublicKey.export({
          format: "pem",
          type: "spki",
        }) as string,
        candidate: { ...candidate },
        evidenceSetId,
        allowedReceiptSchemas: [RECEIPT_SCHEMA],
        notBefore: new Date(NOW_MS - 60 * 60 * 1000).toISOString(),
        notAfter: new Date(NOW_MS + 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  };
  const bundle: TestBundle = {
    directory,
    packetRoot,
    manifestPath,
    trustPolicyPath,
    receiptPath,
    privateKey,
    sourcePrivateKey,
    manifest,
    trustPolicy,
    receipt,
    receiptBytes,
    expectedTrustPolicySha256: "",
    expectedAuthorityKeyId: "s22-test-authority-1",
  };
  writeSignedManifest(bundle);
  writeTrustPolicy(bundle);
  return bundle;
}

function resolveBundle(
  bundle: TestBundle,
  overrides: Record<string, unknown> = {},
) {
  return resolveSoakEvidencePacket({
    manifestPath: bundle.manifestPath,
    trustPolicyPath: bundle.trustPolicyPath,
    expectedTrustPolicySha256: bundle.expectedTrustPolicySha256,
    expectedAuthorityKeyId: bundle.expectedAuthorityKeyId,
    expectedCandidate: candidate,
    requiredArtifacts: requiredArtifacts(),
    nowMs: NOW_MS,
    receiptValidators: {
      [RECEIPT_SCHEMA]: (payload: unknown) => {
        if (
          !isRecord(payload) ||
          !hasExactKeys(payload, ["sampleCount", "status"]) ||
          payload.status !== "PASS" ||
          payload.sampleCount !== 16
        ) {
          return { valid: false, errors: ["synthetic-payload-invalid"] };
        }
        return {
          valid: true,
          eligible: true,
          derived: {
            status: payload.status,
            sampleCount: payload.sampleCount,
          },
        };
      },
    },
    derivedFieldAllowlist: {
      [RECEIPT_SCHEMA]: ["sampleCount", "status"],
    },
    derivedSanitizers: {
      [RECEIPT_SCHEMA]: (derived: unknown) => {
        if (
          !isRecord(derived) ||
          !hasExactKeys(derived, ["sampleCount", "status"]) ||
          derived.status !== "PASS" ||
          derived.sampleCount !== 16
        ) {
          return { valid: false, errors: ["synthetic-derived-invalid"] };
        }
        return {
          valid: true,
          value: { status: derived.status, sampleCount: derived.sampleCount },
        };
      },
    },
    ...overrides,
  });
}

function writeSignedManifest(bundle: TestBundle) {
  bundle.manifest.signature = sign(
    null,
    createSoakEvidenceIndexSigningPayload(bundle.manifest),
    bundle.privateKey,
  ).toString("base64url");
  writeFileSync(
    bundle.manifestPath,
    JSON.stringify(bundle.manifest),
    "utf8",
  );
}

function writeTrustPolicy(
  bundle: TestBundle,
  { updatePin = true }: { updatePin?: boolean } = {},
) {
  const bytes = Buffer.from(JSON.stringify(bundle.trustPolicy));
  writeFileSync(bundle.trustPolicyPath, bytes);
  if (updatePin) bundle.expectedTrustPolicySha256 = sha256(bytes);
}

function rewriteReceiptAndIndex(bundle: TestBundle) {
  writeReceiptAndIndex(bundle);
}

function writeReceiptAndIndex(
  bundle: TestBundle,
  {
    signSource = true,
    signingKey = bundle.sourcePrivateKey,
  }: { signSource?: boolean; signingKey?: KeyObject } = {},
) {
  if (signSource) {
    bundle.receipt.sourceSignature = sign(
      null,
      createSoakEvidenceReceiptSigningPayload(bundle.receipt),
      signingKey,
    ).toString("base64url");
  }
  bundle.receiptBytes = Buffer.from(JSON.stringify(bundle.receipt));
  writeFileSync(bundle.receiptPath, bundle.receiptBytes);
  bundle.manifest.artifacts[0].byteLength = bundle.receiptBytes.byteLength;
  bundle.manifest.artifacts[0].sha256 = sha256(bundle.receiptBytes);
  writeSignedManifest(bundle);
}

function makeTemporaryDirectory() {
  const directory = mkdtempSync(
    join(realpathSync(tmpdir()), "uais-soak-resolver-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredArtifacts() {
  return [
    {
      id: "synthetic-receipt",
      receiptSchema: RECEIPT_SCHEMA,
      sourceAuthorityRole: SOURCE_AUTHORITY_ROLE,
      mustDifferFromIndexAuthority: true,
    },
  ];
}

function macOsVarAlias(filePath: string) {
  return filePath.startsWith("/private/var/")
    ? filePath.replace(/^\/private\/var\//, "/var/")
    : filePath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, i) => key === keys[i]);
}
