import { describe, expect, it } from "vitest";
import {
  TEACHING_COURSE_COLLABORATOR_ROLE_CEILINGS,
  TeachingCourseCollaboratorValidationError,
  getTeachingCourseCollaboratorGrantStatus,
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
        expect.objectContaining<TeachingCourseCollaboratorValidationError>({
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

  it("derives inactive lifecycle state from revocation before expiry", () => {
    expect(
      getTeachingCourseCollaboratorGrantStatus(
        { expiresAt: "2026-08-25T09:59:59.999Z" },
        now,
      ),
    ).toBe("expired");
    expect(
      getTeachingCourseCollaboratorGrantStatus(
        {
          expiresAt: "2026-08-25T09:59:59.999Z",
          revokedAt: "2026-08-24T10:00:00.000Z",
        },
        now,
      ),
    ).toBe("revoked");
    expect(
      getTeachingCourseCollaboratorGrantStatus(
        { expiresAt: "2026-09-25T09:59:59.999Z" },
        new Date(Number.NaN),
      ),
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
      expect.objectContaining<TeachingCourseCollaboratorValidationError>({
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
