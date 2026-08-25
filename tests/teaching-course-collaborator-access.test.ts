import { describe, expect, it } from "vitest";
import {
  TEACHING_COURSE_COLLABORATOR_ROLE_CEILINGS,
  getTeachingCourseCollaboratorGrantStatus,
  isTeachingCourseCollaboratorPublicId,
  isTeachingCourseCollaboratorRequestId,
  isTeachingCourseCollaboratorUuid,
  normalizeTeachingCourseCollaboratorExpiryTimestamp,
  normalizeTeachingCourseCollaboratorGrantPolicy,
  normalizeTeachingCourseCollaboratorPersistedReceipt,
  type TeachingCourseCollaboratorGrant,
} from "@/lib/server/teaching-course-collaborator-types";
import { authorizeTeachingCourseCapability } from "@/lib/server/teaching-course-collaborator-access";

const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  collaborator: "22222222-2222-4222-8222-222222222222",
  other: "33333333-3333-4333-8333-333333333333",
  grant: "44444444-4444-4444-8444-444444444444",
  identifier: "55555555-5555-4555-8555-555555555555",
};
const now = new Date("2026-08-25T10:00:00.000Z");

describe("teaching-course collaborator identifier guards", () => {
  it.each([
    [
      "UUID",
      isTeachingCourseCollaboratorUuid,
      ids.grant,
      "44444444-4444-4444-7444-444444444444",
    ],
    [
      "public ID",
      isTeachingCourseCollaboratorPublicId,
      "course:research.methods_v1-2026",
      "teacher@example.edu",
    ],
    [
      "request ID",
      isTeachingCourseCollaboratorRequestId,
      "trace:collaborator.grant_v1-2026",
      "trace-safe\r\nforged: value",
    ],
  ])("exports a dependency-free %s guard", (_label, guard, valid, invalid) => {
    expect(guard(valid)).toBe(true);
    expect(guard(invalid)).toBe(false);
  });
});

function activeGrant(
  override: Partial<TeachingCourseCollaboratorGrant> = {},
): TeachingCourseCollaboratorGrant {
  return {
    grantId: ids.grant,
    courseId: "course-research-methods",
    recipientUserId: ids.collaborator,
    grantedByUserId: ids.owner,
    role: "reviewer",
    scopes: ["course.grading.manage", "course.read"],
    status: "active",
    revision: 1,
    grantedAt: "2026-08-25T09:00:00.000Z",
    expiresAt: "2026-09-25T09:00:00.000Z",
    ...override,
  };
}

function authorize(
  override: Partial<Parameters<typeof authorizeTeachingCourseCapability>[0]> = {},
) {
  return authorizeTeachingCourseCapability({
    principal: {
      userId: ids.collaborator,
      account: "teacher-lin",
      role: "teacher",
      status: "active",
    },
    course: {
      courseId: "course-research-methods",
      ownerUserId: ids.owner,
    },
    capability: "course.grading.manage",
    grant: activeGrant(),
    now,
    ...override,
  });
}

describe("teaching-course collaborator policy normalization", () => {
  it("sorts and deduplicates scopes inside the selected role ceiling", () => {
    expect(
      normalizeTeachingCourseCollaboratorGrantPolicy({
        role: "co-instructor",
        scopes: [
          "course.settings.manage",
          "course.read",
          "course.grading.manage",
          "course.read",
        ],
        grantedAt: "2026-08-25T10:00:00.000Z",
        expiresAt: "2026-09-25T10:00:00.000Z",
      }),
    ).toEqual({
      role: "co-instructor",
      scopes: [
        "course.grading.manage",
        "course.read",
        "course.settings.manage",
      ],
      grantedAt: "2026-08-25T10:00:00.000Z",
      expiresAt: "2026-09-25T10:00:00.000Z",
    });
  });

  it("exposes the frozen monotonic ceiling matrix", () => {
    expect(TEACHING_COURSE_COLLABORATOR_ROLE_CEILINGS).toEqual({
      observer: ["course.read"],
      reviewer: ["course.read", "course.grading.manage"],
      "teaching-assistant": [
        "course.read",
        "course.content.write",
        "course.students.manage",
        "course.grading.manage",
      ],
      "co-instructor": [
        "course.read",
        "course.content.write",
        "course.students.manage",
        "course.grading.manage",
        "course.settings.manage",
        "course.export",
      ],
    });
  });

  it.each([
    ["observer", ["course.grading.manage"], "scope-exceeds-role-ceiling"],
    ["reviewer", ["course.export"], "scope-exceeds-role-ceiling"],
    ["teaching-assistant", ["course.export"], "scope-exceeds-role-ceiling"],
    ["reviewer", ["*"], "scope-unknown"],
    ["reviewer", ["course.collaborators.manage"], "scope-unknown"],
    ["reviewer", [], "scope-required"],
    ["administrator", ["course.read"], "role-unknown"],
  ])(
    "rejects role %s with unsafe scopes %j",
    (role, scopes, reasonCode) => {
      expect(() =>
        normalizeTeachingCourseCollaboratorGrantPolicy({
          role,
          scopes,
          grantedAt: "2026-08-25T10:00:00.000Z",
        }),
      ).toThrowError(
        expect.objectContaining({
          reasonCode,
        }),
      );
    },
  );

  it.each([
    ["not-a-date", "expiry-invalid"],
    ["2026-09-25", "expiry-invalid"],
    ["2026-09-25T10:00:00", "expiry-invalid"],
    ["2026-08-25T09:59:59.999Z", "expiry-must-follow-grant"],
    ["2026-08-25T10:00:00.000Z", "expiry-must-follow-grant"],
  ])("rejects invalid expiry %s", (expiresAt, reasonCode) => {
    expect(() =>
      normalizeTeachingCourseCollaboratorGrantPolicy({
        role: "observer",
        scopes: ["course.read"],
        grantedAt: "2026-08-25T10:00:00.000Z",
        expiresAt,
      }),
    ).toThrowError(expect.objectContaining({ reasonCode }));
  });

  it("accepts a real leap day and the largest practical explicit offset", () => {
    expect(
      normalizeTeachingCourseCollaboratorExpiryTimestamp(
        "2024-02-29T23:59:59.123456+23:59",
      ),
    ).toBe("2024-02-29T00:00:59.123Z");
  });

  it("accepts a finite Date object inside the canonical four-digit UTC range", () => {
    expect(
      normalizeTeachingCourseCollaboratorExpiryTimestamp(
        new Date("2028-02-29T10:00:00.000Z"),
      ),
    ).toBe("2028-02-29T10:00:00.000Z");
  });

  it.each([
    new Date("+010000-01-01T00:00:00.000Z"),
    new Date("-000001-01-01T00:00:00.000Z"),
  ])("rejects an extended-year Date object %s", (value) => {
    expect(() =>
      normalizeTeachingCourseCollaboratorExpiryTimestamp(value),
    ).toThrowError(
      expect.objectContaining({
        reasonCode: "expiry-invalid",
      }),
    );
  });

  it.each([
    "2023-02-29T10:00:00Z",
    "2100-02-29T10:00:00Z",
    "2026-00-01T10:00:00Z",
    "2026-13-01T10:00:00Z",
    "2026-04-31T10:00:00Z",
    "2026-01-00T10:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T10:60:00Z",
    "2026-01-01T10:00:60Z",
    "2026-01-01T10:00:00+24:00",
    "2026-01-01T10:00:00-23:60",
    "0000-01-01T00:00:00+23:59",
    "9999-12-31T23:59:59-23:59",
  ])("rejects out-of-range or impossible RFC3339 timestamp %s", (value) => {
    expect(() =>
      normalizeTeachingCourseCollaboratorExpiryTimestamp(value),
    ).toThrowError(
      expect.objectContaining({
        reasonCode: "expiry-invalid",
      }),
    );
  });

  it("derives inactive lifecycle state from revocation before expiry", () => {
    expect(
      getTeachingCourseCollaboratorGrantStatus(
        {
          grantedAt: "2026-08-25T09:00:00.000Z",
          expiresAt: "2026-08-25T09:59:59.999Z",
        },
        now,
      ),
    ).toBe("expired");
    expect(
      getTeachingCourseCollaboratorGrantStatus(
        {
          grantedAt: "2026-08-25T09:00:00.000Z",
          expiresAt: "2026-08-25T09:59:59.999Z",
          revokedAt: "2026-08-24T10:00:00.000Z",
        },
        now,
      ),
    ).toBe("revoked");
    expect(
      getTeachingCourseCollaboratorGrantStatus(
        {
          grantedAt: "2026-08-25T09:00:00.000Z",
          expiresAt: "2026-09-25T09:59:59.999Z",
        },
        new Date(Number.NaN),
      ),
    ).toBe("expired");
  });

  it.each([
    ["past start without expiry", "active", "2026-08-25T09:59:59.999Z", undefined],
    ["equal start without expiry", "active", "2026-08-25T10:00:00.000Z", undefined],
    ["future start without expiry", "expired", "2026-08-25T10:00:00.001Z", undefined],
    [
      "past start with expiry",
      "active",
      "2026-08-25T09:59:59.999Z",
      "2026-08-25T10:00:00.001Z",
    ],
    [
      "equal start with expiry",
      "active",
      "2026-08-25T10:00:00.000Z",
      "2026-08-25T10:00:00.001Z",
    ],
    [
      "future start with expiry",
      "expired",
      "2026-08-25T10:00:00.001Z",
      "2026-08-25T10:00:00.002Z",
    ],
  ] as const)(
    "derives %s as %s",
    (_label, expectedStatus, grantedAt, expiresAt) => {
      expect(
        getTeachingCourseCollaboratorGrantStatus(
          { grantedAt, expiresAt },
          now,
        ),
      ).toBe(expectedStatus);
    },
  );

  it.each([
    ["a non-finite clock", "2026-08-25T09:00:00.000Z", new Date(Number.NaN)],
    ["a malformed start", "not-a-date", now],
    ["an impossible start", "2026-02-30T09:00:00.000Z", now],
  ])("derives an inactive grant for %s without expiry", (_label, grantedAt, clock) => {
    expect(
      getTeachingCourseCollaboratorGrantStatus({ grantedAt }, clock),
    ).toBe("expired");
  });
});

describe("teaching-course collaborator receipt normalization", () => {
  const receipt = {
    status: "persisted",
    event: "grant-issued",
    grantId: ids.grant,
    courseId: "course-research-methods",
    recipientUserId: ids.collaborator,
    role: "observer",
    scopes: ["course.read"],
    grantStatus: "active",
    revision: 1,
    grantedAt: "2026-08-25T09:00:00.000Z",
    expiresAt: "2026-09-25T09:00:00.000Z",
    traceId: "trace-grant",
    persistedAt: "2026-08-25T09:00:00.000Z",
  };

  it("accepts canonical public and trace identifiers", () => {
    expect(
      normalizeTeachingCourseCollaboratorPersistedReceipt({
        ...receipt,
        courseId: "course:research.methods_v1-2026",
        traceId: "trace:collaborator.grant_v1-2026",
      }),
    ).toMatchObject({
      grantId: ids.grant,
      recipientUserId: ids.collaborator,
      courseId: "course:research.methods_v1-2026",
      traceId: "trace:collaborator.grant_v1-2026",
      revision: 1,
    });
  });

  it.each([
    ["a PII-shaped grant ID", { grantId: "teacher@example.edu" }],
    [
      "a UUID grant ID without an RFC variant",
      { grantId: "44444444-4444-4444-7444-444444444444" },
    ],
    [
      "a UUID recipient ID without a supported version",
      { recipientUserId: "22222222-2222-0222-8222-222222222222" },
    ],
    ["a PII-shaped recipient ID", { recipientUserId: "teacher@example.edu" }],
    ["a PII-shaped course ID", { courseId: "teacher@example.edu" }],
    ["a traversal-shaped course ID", { courseId: "../private-course" }],
    ["a control-bearing course ID", { courseId: "course-safe\nforged" }],
    ["a PII-shaped trace ID", { traceId: "teacher@example.edu" }],
    ["a control-bearing trace ID", { traceId: "trace-safe\r\nforged: value" }],
    ["an unsafe positive revision", { revision: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects %s in a stored receipt", (_label, override) => {
    expect(() =>
      normalizeTeachingCourseCollaboratorPersistedReceipt({
        ...receipt,
        ...override,
      }),
    ).toThrowError(
      expect.objectContaining({
        reasonCode: "idempotency-receipt-invalid",
      }),
    );
  });

  it.each([
    [
      "a grant persisted before it was issued",
      {
        ...receipt,
        grantedAt: "2026-08-25T09:00:00.001Z",
        persistedAt: "2026-08-25T09:00:00.000Z",
      },
    ],
    [
      "an issued grant expiring exactly when persisted",
      {
        ...receipt,
        grantedAt: "2026-08-25T08:00:00.000Z",
        expiresAt: "2026-08-25T09:00:00.000Z",
        persistedAt: "2026-08-25T09:00:00.000Z",
      },
    ],
    [
      "an issued grant already expired when persisted",
      {
        ...receipt,
        grantedAt: "2026-08-25T08:00:00.000Z",
        expiresAt: "2026-08-25T08:59:59.999Z",
        persistedAt: "2026-08-25T09:00:00.000Z",
      },
    ],
    [
      "an already-active grant expiring exactly when persisted",
      {
        ...receipt,
        status: "already-active",
        event: undefined,
        grantedAt: "2026-08-25T08:00:00.000Z",
        expiresAt: "2026-08-25T09:00:00.000Z",
        persistedAt: "2026-08-25T09:00:00.000Z",
      },
    ],
    [
      "an already-active grant already expired when persisted",
      {
        ...receipt,
        status: "already-active",
        event: undefined,
        grantedAt: "2026-08-25T08:00:00.000Z",
        expiresAt: "2026-08-25T08:59:59.999Z",
        persistedAt: "2026-08-25T09:00:00.000Z",
      },
    ],
    [
      "a revocation before the grant",
      {
        ...receipt,
        event: "grant-revoked",
        grantStatus: "revoked",
        revokedAt: "2026-08-25T08:59:59.999Z",
      },
    ],
    [
      "a revocation after persistence",
      {
        ...receipt,
        event: "grant-revoked",
        grantStatus: "revoked",
        revokedAt: "2026-08-25T09:00:00.001Z",
      },
    ],
  ])("rejects impossible receipt chronology for %s", (_label, unsafeReceipt) => {
    expect(() =>
      normalizeTeachingCourseCollaboratorPersistedReceipt(unsafeReceipt),
    ).toThrowError(
      expect.objectContaining({
        reasonCode: "idempotency-receipt-invalid",
      }),
    );
  });

  it.each([
    [
      "issued",
      {
        ...receipt,
        expiresAt: "2026-08-25T09:00:00.001Z",
      },
    ],
    [
      "already active",
      {
        ...receipt,
        status: "already-active",
        event: undefined,
        expiresAt: undefined,
      },
    ],
    [
      "revoked",
      {
        ...receipt,
        event: "grant-revoked",
        grantStatus: "revoked",
        revokedAt: "2026-08-25T09:00:00.000Z",
      },
    ],
  ])("accepts inclusive receipt chronology boundaries for %s", (_label, value) => {
    expect(
      normalizeTeachingCourseCollaboratorPersistedReceipt(value),
    ).toMatchObject({
      grantedAt: "2026-08-25T09:00:00.000Z",
      persistedAt: "2026-08-25T09:00:00.000Z",
    });
  });

  it.each([
    [
      "an already-active receipt carrying a revocation timestamp",
      {
        ...receipt,
        status: "already-active",
        event: undefined,
        revokedAt: "2026-08-25T09:30:00.000Z",
      },
    ],
    [
      "an issued event whose stored lifecycle is revoked",
      {
        ...receipt,
        grantStatus: "revoked",
        revokedAt: "2026-08-25T09:30:00.000Z",
      },
    ],
    [
      "a revoked event without its revocation timestamp",
      {
        ...receipt,
        event: "grant-revoked",
        grantStatus: "revoked",
      },
    ],
  ])("rejects %s", (_label, unsafeReceipt) => {
    expect(() =>
      normalizeTeachingCourseCollaboratorPersistedReceipt(unsafeReceipt),
    ).toThrowError(
      expect.objectContaining({
        reasonCode: "idempotency-receipt-invalid",
      }),
    );
  });
});

describe("authorizeTeachingCourseCapability", () => {
  it("gives an active teacher owner implicit authority only for delegatable scopes", () => {
    const principal = {
      userId: ids.owner,
      account: "teacher-kang",
      role: "teacher" as const,
      status: "active" as const,
    };
    const course = {
      courseId: "course-research-methods",
      ownerUserId: ids.owner,
    };

    expect(
      authorizeTeachingCourseCapability({
        principal,
        course,
        capability: "course.settings.manage",
        now,
      }),
    ).toMatchObject({
      authorized: true,
      reasonCode: "course-owner-implicit",
    });
    expect(
      authorizeTeachingCourseCapability({
        principal,
        course,
        capability: "course.collaborators.manage",
        now,
      }),
    ).toEqual({
      authorized: false,
      reasonCode: "capability-not-delegatable",
    });
  });

  it("authorizes a collaborator only for the exact stored scope", () => {
    expect(authorize()).toMatchObject({
      authorized: true,
      reasonCode: "collaborator-exact-scope",
      grantId: ids.grant,
      revision: 1,
    });
    expect(authorize({ capability: "course.content.write" })).toEqual({
      authorized: false,
      reasonCode: "collaborator-scope-required",
    });
    expect(
      authorize({
        capability: "course.content.write",
        grant: activeGrant({ role: "co-instructor", scopes: ["course.read"] }),
      }),
    ).toEqual({
      authorized: false,
      reasonCode: "collaborator-scope-required",
    });
  });

  it.each([
    ["past", "without expiry", "2026-08-25T09:59:59.999Z", undefined, true],
    ["equal", "without expiry", "2026-08-25T10:00:00.000Z", undefined, true],
    [
      "future",
      "without expiry",
      "2026-08-25T10:00:00.001Z",
      undefined,
      false,
    ],
    [
      "past",
      "with expiry",
      "2026-08-25T09:59:59.999Z",
      "2026-08-25T10:00:00.001Z",
      true,
    ],
    [
      "equal",
      "with expiry",
      "2026-08-25T10:00:00.000Z",
      "2026-08-25T10:00:00.001Z",
      true,
    ],
    [
      "future",
      "with expiry",
      "2026-08-25T10:00:00.001Z",
      "2026-08-25T10:00:00.002Z",
      false,
    ],
  ] as const)(
    "allows only grants issued in the %s relative to now %s",
    (_position, _expiryLabel, grantedAt, expiresAt, expectedAuthorized) => {
      const decision = authorize({
        grant: activeGrant({ grantedAt, expiresAt }),
      });

      if (expectedAuthorized) {
        expect(decision).toMatchObject({
          authorized: true,
          reasonCode: "collaborator-exact-scope",
        });
      } else {
        expect(decision).toEqual({
          authorized: false,
          reasonCode: "collaborator-grant-invalid",
        });
      }
    },
  );

  it.each([
    ["without expiry", undefined],
    ["with expiry", "2026-09-25T09:00:00.000Z"],
  ])("requires a finite authorization clock %s", (_label, expiresAt) => {
    expect(
      authorize({
        now: new Date(Number.NaN),
        grant: activeGrant({ expiresAt }),
      }),
    ).toEqual({
      authorized: false,
      reasonCode: "collaborator-grant-invalid",
    });
  });

  it.each([
    [
      "expired",
      activeGrant({
        status: "expired",
        expiresAt: "2026-08-25T09:59:59.999Z",
      }),
      "collaborator-grant-expired",
    ],
    [
      "revoked",
      activeGrant({
        status: "revoked",
        revokedAt: "2026-08-25T09:30:00.000Z",
        revokedByUserId: ids.owner,
      }),
      "collaborator-grant-revoked",
    ],
    ["missing", undefined, "collaborator-grant-required"],
  ])("denies an %s grant", (_label, grant, reasonCode) => {
    expect(authorize({ grant })).toEqual({ authorized: false, reasonCode });
  });

  it.each([
    ["student", "active", "active-teacher-principal-required"],
    ["admin", "active", "active-teacher-principal-required"],
    ["teacher", "invited", "active-teacher-principal-required"],
    ["teacher", "disabled", "active-teacher-principal-required"],
  ] as const)("denies a %s/%s principal", (role, status, reasonCode) => {
    expect(
      authorize({
        principal: {
          userId: ids.collaborator,
          account: "principal",
          role,
          status,
        },
      }),
    ).toEqual({ authorized: false, reasonCode });
  });

  it("fails closed for mismatched course, recipient, wildcard and malformed stored scope", () => {
    expect(
      authorize({ grant: activeGrant({ courseId: "course-other" }) }),
    ).toEqual({
      authorized: false,
      reasonCode: "collaborator-grant-mismatch",
    });
    expect(
      authorize({ grant: activeGrant({ recipientUserId: ids.other }) }),
    ).toEqual({
      authorized: false,
      reasonCode: "collaborator-grant-mismatch",
    });
    expect(
      authorize({ grant: activeGrant({ grantedByUserId: ids.other }) }),
    ).toEqual({
      authorized: false,
      reasonCode: "collaborator-grant-mismatch",
    });
    expect(authorize({ capability: "*" })).toEqual({
      authorized: false,
      reasonCode: "capability-not-delegatable",
    });
    expect(
      authorize({
        grant: activeGrant({ scopes: ["*"] as never }),
      }),
    ).toEqual({
      authorized: false,
      reasonCode: "collaborator-grant-invalid",
    });
  });

  it("fails closed when canonical course ownership or grant revision is malformed", () => {
    expect(
      authorize({
        course: {
          courseId: "course-research-methods",
          ownerUserId: "",
        },
      }),
    ).toEqual({
      authorized: false,
      reasonCode: "canonical-course-required",
    });
    expect(
      authorize({
        grant: activeGrant({ revision: 0 }),
      }),
    ).toEqual({
      authorized: false,
      reasonCode: "collaborator-grant-invalid",
    });
  });
});
