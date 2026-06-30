import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizeUaisTrustedTeacherAuthIssuerRequest,
  UAIS_TEACHER_AUTH_ISSUER_CLAIMS_HEADER,
  UAIS_TEACHER_AUTH_ISSUER_SIGNATURE_HEADER,
} from "@/lib/server/teacher-auth-issuer-proof";

const issuerSecret = "trusted-teacher-auth-issuer-proof-secret";

describe("trusted teacher auth issuer proof", () => {
  it("rejects a validly signed issuer proof whose lifetime exceeds five minutes", () => {
    const headers = createSignedIssuerHeaders({
      secret: issuerSecret,
      teacherId: "teacher-kang",
      issuedAt: "2099-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:05:01.000Z",
    });

    const decision = authorizeUaisTrustedTeacherAuthIssuerRequest({
      request: new Request("http://localhost/api/ai/teacher-auth/issue", {
        headers,
      }),
      secret: issuerSecret,
      teacherId: "teacher-kang",
      now: new Date("2099-01-01T00:00:01.000Z"),
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "trusted-issuer-claims-invalid",
        redaction: {
          secrets: "omitted",
          headers: "omitted",
          cookies: "omitted",
        },
      }),
    );
    expect(JSON.stringify(decision)).not.toContain(issuerSecret);
  });

  it("rejects a validly signed issuer proof issued in the future", () => {
    const headers = createSignedIssuerHeaders({
      secret: issuerSecret,
      teacherId: "teacher-kang",
      issuedAt: "2099-01-01T00:00:10.000Z",
      expiresAt: "2099-01-01T00:05:00.000Z",
    });

    const decision = authorizeUaisTrustedTeacherAuthIssuerRequest({
      request: new Request("http://localhost/api/ai/teacher-auth/issue", {
        headers,
      }),
      secret: issuerSecret,
      teacherId: "teacher-kang",
      now: new Date("2099-01-01T00:00:00.000Z"),
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "trusted-issuer-claims-invalid",
      }),
    );
    expect(JSON.stringify(decision)).not.toContain(issuerSecret);
  });

  it("rejects a validly signed issuer proof that expires before its issuedAt", () => {
    const headers = createSignedIssuerHeaders({
      secret: issuerSecret,
      teacherId: "teacher-kang",
      issuedAt: "2099-01-01T00:00:10.000Z",
      expiresAt: "2099-01-01T00:00:09.000Z",
    });

    const decision = authorizeUaisTrustedTeacherAuthIssuerRequest({
      request: new Request("http://localhost/api/ai/teacher-auth/issue", {
        headers,
      }),
      secret: issuerSecret,
      teacherId: "teacher-kang",
      now: new Date("2099-01-01T00:00:00.000Z"),
    });

    expect(decision).toEqual(
      expect.objectContaining({
        status: "denied",
        reasonCode: "trusted-issuer-claims-invalid",
      }),
    );
    expect(JSON.stringify(decision)).not.toContain(issuerSecret);
  });
});

function createSignedIssuerHeaders(input: {
  secret: string;
  teacherId: string;
  issuedAt: string;
  expiresAt: string;
}) {
  const claims = Buffer.from(
    JSON.stringify({
      issuerId: "trusted-cookie-issuer",
      teacherId: input.teacherId,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", input.secret)
    .update(claims)
    .digest()
    .toString("base64url");

  return {
    [UAIS_TEACHER_AUTH_ISSUER_CLAIMS_HEADER]: claims,
    [UAIS_TEACHER_AUTH_ISSUER_SIGNATURE_HEADER]: signature,
  };
}
