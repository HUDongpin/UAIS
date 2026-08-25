import { describe, expect, it, vi } from "vitest";
import * as collaboratorCollectionRoute from "@/app/api/teaching/courses/[courseId]/collaborators/route";
import * as collaboratorGrantRoute from "@/app/api/teaching/courses/[courseId]/collaborators/[grantId]/route";
import {
  createTeachingCourseCollaboratorDeleteHandler,
  createTeachingCourseCollaboratorGetHandler,
  createTeachingCourseCollaboratorPostHandler,
} from "@/app/api/teaching/courses/[courseId]/collaborators/handler";
import { TeachingCourseCollaboratorStoreError } from "@/lib/server/teaching-course-collaborator-postgres-store";
import type {
  TeachingCourseCollaboratorGrant,
  TeachingCourseCollaboratorPersistedReceipt,
  TeachingCourseCollaboratorReceipt,
} from "@/lib/server/teaching-course-collaborator-types";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const signingSecret = "uais-collaborator-api-test-signing-secret-2026";
const teacherSigningSecret =
  "uais-collaborator-api-test-teacher-signing-secret-2026";
const now = new Date("2026-08-26T00:00:00.000Z");
const courseId = "course-research-methods";
const grantId = "55555555-5555-4555-8555-555555555555";
const recipientUserId = "22222222-2222-4222-8222-222222222222";
const ownerUserId = "11111111-1111-4111-8111-111111111111";
const recipientEmail = "Teacher.Lin@Example.Test";
const baseEnv = {
  UAIS_APP_SESSION_SIGNING_SECRET: signingSecret,
  UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: teacherSigningSecret,
  UAIS_DEPLOYMENT_ENV: "staging",
};

const grant: TeachingCourseCollaboratorGrant = {
  grantId,
  courseId,
  recipientUserId,
  grantedByUserId: ownerUserId,
  role: "reviewer",
  scopes: ["course.grading.manage", "course.read"],
  status: "active",
  revision: 1,
  grantedAt: "2026-08-26T00:00:00.000Z",
};

const persistedReceipt: TeachingCourseCollaboratorPersistedReceipt = {
  status: "persisted",
  event: "grant-issued",
  grantId,
  courseId,
  recipientUserId,
  role: "reviewer",
  scopes: ["course.grading.manage", "course.read"],
  grantStatus: "active",
  revision: 1,
  grantedAt: "2026-08-26T00:00:00.000Z",
  traceId: "trace-collaborator-grant",
  persistedAt: "2026-08-26T00:00:00.000Z",
};

function routeContext(
  input: { courseId?: string; grantId?: string } = {},
) {
  return {
    params: Promise.resolve({
      courseId: input.courseId ?? courseId,
      ...(input.grantId === undefined ? {} : { grantId: input.grantId }),
    }),
  };
}

function createSessionCookie(role: "teacher" | "student" | "admin") {
  return createUaisAppSessionCookie(
    {
      account: role === "teacher" ? "teacher-kang" : `${role}-lee`,
      displayName: role,
      department: "test",
      role,
    },
    {
      secret: signingSecret,
      now,
      sessionId: `session-${role}`,
    },
  );
}

function request(
  pathname: string,
  input: RequestInit & {
    role?: "teacher" | "student" | "admin";
    teacherWriteActor?: string;
  } = {},
) {
  const { role, teacherWriteActor, ...requestInit } = input;
  const headers = new Headers(input.headers);
  const cookieParts = [
    ...(role ? [createSessionCookie(role)] : []),
    ...(teacherWriteActor
      ? [
          createUaisTeacherAuthSessionCookieHeader({
            claims: {
              sessionId: "teacher-write-session",
              actorId: teacherWriteActor,
              role: "teacher",
              authenticatedAt: now.toISOString(),
              expiresAt: new Date(
                now.getTime() + 8 * 60 * 60 * 1000,
              ).toISOString(),
            },
            secret: teacherSigningSecret,
          }),
        ]
      : []),
  ];
  if (cookieParts.length > 0) headers.set("cookie", cookieParts.join("; "));
  return new Request(`https://uais.test${pathname}`, {
    ...requestInit,
    headers,
  });
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("teaching-course collaborator API", () => {
  it("exposes only supported Next route-module exports", () => {
    expect(Object.keys(collaboratorCollectionRoute).sort()).toEqual([
      "GET",
      "POST",
      "dynamic",
    ]);
    expect(Object.keys(collaboratorGrantRoute).sort()).toEqual([
      "DELETE",
      "dynamic",
    ]);
  });

  it("rejects a missing session before invoking the store", async () => {
    const listCollaborators = vi.fn();
    const response = await createTeachingCourseCollaboratorGetHandler({
      env: baseEnv,
      now,
      listCollaborators,
    })(request(`/api/teaching/courses/${courseId}/collaborators`), routeContext());

    expect(response.status).toBe(401);
    expect(await readJson(response)).toMatchObject({
      status: "denied",
      reasonCode: "authenticated-session-required",
    });
    expect(listCollaborators).not.toHaveBeenCalled();
  });

  it.each(["student", "admin"] as const)(
    "rejects a %s app session as a role denial",
    async (role) => {
      const grantCollaborator = vi.fn();
      const response = await createTeachingCourseCollaboratorPostHandler({
        env: baseEnv,
        now,
        grantCollaborator,
      })(
        request(`/api/teaching/courses/${courseId}/collaborators`, {
          method: "POST",
          role,
          body: "not-json-and-must-not-be-read",
        }),
        routeContext(),
      );

      expect(response.status).toBe(403);
      expect(await readJson(response)).toMatchObject({
        status: "denied",
        reasonCode: "teacher-role-required",
      });
      expect(grantCollaborator).not.toHaveBeenCalled();
    },
  );

  it("requires the independent teacher write session for a grant", async () => {
    const grantCollaborator = vi.fn();
    const response = await createTeachingCourseCollaboratorPostHandler({
      env: baseEnv,
      now,
      grantCollaborator,
    })(
      request(`/api/teaching/courses/${courseId}/collaborators`, {
        method: "POST",
        role: "teacher",
        headers: { "idempotency-key": "collaborator-grant-app-only" },
        body: JSON.stringify({
          recipientEmail,
          role: "reviewer",
          scopes: ["course.read"],
        }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(401);
    expect(await readJson(response)).toMatchObject({
      status: "denied",
      reasonCode: "teacher-write-session-required",
    });
    expect(grantCollaborator).not.toHaveBeenCalled();
  });

  it("rejects mismatched app and teacher write identities", async () => {
    const revokeCollaborator = vi.fn();
    const response = await createTeachingCourseCollaboratorDeleteHandler({
      env: baseEnv,
      now,
      revokeCollaborator,
    })(
      request(
        `/api/teaching/courses/${courseId}/collaborators/${grantId}`,
        {
          method: "DELETE",
          role: "teacher",
          teacherWriteActor: "teacher-other",
          headers: { "idempotency-key": "collaborator-revoke-mismatch" },
        },
      ),
      routeContext({ grantId }),
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toMatchObject({
      status: "denied",
      reasonCode: "teacher-session-identity-mismatch",
    });
    expect(revokeCollaborator).not.toHaveBeenCalled();
  });

  it("lists address-free grants for the authenticated course owner", async () => {
    const listCollaborators = vi.fn(async () => [grant]);
    const response = await createTeachingCourseCollaboratorGetHandler({
      env: baseEnv,
      now,
      listCollaborators,
    })(
      request(`/api/teaching/courses/${courseId}/collaborators`, {
        role: "teacher",
        headers: { "x-uais-trace-id": "trace-collaborator-list" },
      }),
      routeContext(),
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-uais-trace-id")).toBe(
      "trace-collaborator-list",
    );
    expect(body).toEqual({
      status: "read",
      courseId,
      grants: [grant],
      traceId: "trace-collaborator-list",
      redaction: {
        secrets: "omitted",
        recipientEmail: "omitted",
      },
    });
    expect(listCollaborators).toHaveBeenCalledWith({
      actorAccount: "teacher-kang",
      courseId,
    });
    expect(JSON.stringify(body)).not.toContain("@");
  });

  it("grants a collaborator with an explicit idempotency key and no address echo", async () => {
    const grantCollaborator = vi.fn(
      async (): Promise<TeachingCourseCollaboratorReceipt> => persistedReceipt,
    );
    const response = await createTeachingCourseCollaboratorPostHandler({
      env: baseEnv,
      now,
      grantCollaborator,
    })(
      request(`/api/teaching/courses/${courseId}/collaborators`, {
        method: "POST",
        role: "teacher",
        teacherWriteActor: "teacher-kang",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "collaborator-grant-1",
          "x-uais-trace-id": "trace-collaborator-grant",
        },
        body: JSON.stringify({
          recipientEmail,
          role: "reviewer",
          scopes: ["course.read", "course.grading.manage"],
        }),
      }),
      routeContext(),
    );
    const body = await readJson(response);

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      status: "persisted",
      receipt: persistedReceipt,
      traceId: "trace-collaborator-grant",
    });
    expect(grantCollaborator).toHaveBeenCalledWith({
      actorAccount: "teacher-kang",
      courseId,
      recipientEmail,
      role: "reviewer",
      scopes: ["course.read", "course.grading.manage"],
      idempotencyKey: "collaborator-grant-1",
      traceId: "trace-collaborator-grant",
    });
    expect(JSON.stringify(body).toLowerCase()).not.toContain(
      recipientEmail.toLowerCase(),
    );
    expect(JSON.stringify(body)).not.toContain("@");
  });

  it("returns 200 for an already-active idempotent grant replay", async () => {
    const replay: TeachingCourseCollaboratorReceipt = {
      status: "already-active",
      grantId,
      courseId,
      recipientUserId,
      role: "reviewer",
      scopes: ["course.grading.manage", "course.read"],
      grantStatus: "active",
      revision: 1,
      grantedAt: "2026-08-26T00:00:00.000Z",
      traceId: "trace-collaborator-replay",
      persistedAt: "2026-08-26T00:00:00.000Z",
    };
    const response = await createTeachingCourseCollaboratorPostHandler({
      env: baseEnv,
      now,
      grantCollaborator: async () => replay,
    })(
      request(`/api/teaching/courses/${courseId}/collaborators`, {
        method: "POST",
        role: "teacher",
        teacherWriteActor: "teacher-kang",
        headers: {
          "idempotency-key": "collaborator-grant-replay",
          "x-uais-trace-id": "trace-collaborator-replay",
        },
        body: JSON.stringify({
          recipientEmail,
          role: "reviewer",
          scopes: ["course.read", "course.grading.manage"],
        }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      status: "already-active",
      receipt: replay,
    });
  });

  it("requires a valid idempotency key before granting", async () => {
    const grantCollaborator = vi.fn();
    const response = await createTeachingCourseCollaboratorPostHandler({
      env: baseEnv,
      now,
      grantCollaborator,
    })(
      request(`/api/teaching/courses/${courseId}/collaborators`, {
        method: "POST",
        role: "teacher",
        teacherWriteActor: "teacher-kang",
        body: JSON.stringify({
          recipientEmail,
          role: "reviewer",
          scopes: ["course.read"],
        }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      status: "invalid",
      reasonCode: "idempotency-key-required",
    });
    expect(grantCollaborator).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without invoking the grant store", async () => {
    const grantCollaborator = vi.fn();
    const response = await createTeachingCourseCollaboratorPostHandler({
      env: baseEnv,
      now,
      grantCollaborator,
    })(
      request(`/api/teaching/courses/${courseId}/collaborators`, {
        method: "POST",
        role: "teacher",
        teacherWriteActor: "teacher-kang",
        headers: { "idempotency-key": "collaborator-grant-malformed" },
        body: "{",
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      status: "invalid",
      reasonCode: "request-body-invalid-json",
    });
    expect(grantCollaborator).not.toHaveBeenCalled();
  });

  it("rejects invalid route identifiers before invoking the store", async () => {
    const listCollaborators = vi.fn();
    const response = await createTeachingCourseCollaboratorGetHandler({
      env: baseEnv,
      now,
      listCollaborators,
    })(
      request("/api/teaching/courses/%20/collaborators", { role: "teacher" }),
      routeContext({ courseId: " " }),
    );

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      status: "invalid",
      reasonCode: "course-id-invalid",
    });
    expect(listCollaborators).not.toHaveBeenCalled();
  });

  it("revokes the requested grant with an explicit idempotency key", async () => {
    const receipt: TeachingCourseCollaboratorPersistedReceipt = {
      ...persistedReceipt,
      event: "grant-revoked",
      grantStatus: "revoked",
      revision: 2,
      revokedAt: "2026-08-26T00:05:00.000Z",
      traceId: "trace-collaborator-revoke",
      persistedAt: "2026-08-26T00:05:00.000Z",
    };
    const revokeCollaborator = vi.fn(async () => receipt);
    const response = await createTeachingCourseCollaboratorDeleteHandler({
      env: baseEnv,
      now,
      revokeCollaborator,
    })(
      request(
        `/api/teaching/courses/${courseId}/collaborators/${grantId}`,
        {
          method: "DELETE",
          role: "teacher",
          teacherWriteActor: "teacher-kang",
          headers: {
            "idempotency-key": "collaborator-revoke-1",
            "x-uais-trace-id": "trace-collaborator-revoke",
          },
        },
      ),
      routeContext({ grantId }),
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      status: "persisted",
      receipt,
      traceId: "trace-collaborator-revoke",
    });
    expect(revokeCollaborator).toHaveBeenCalledWith({
      actorAccount: "teacher-kang",
      courseId,
      grantId,
      idempotencyKey: "collaborator-revoke-1",
      traceId: "trace-collaborator-revoke",
    });
  });

  it("maps typed store errors without leaking submitted addresses or details", async () => {
    const response = await createTeachingCourseCollaboratorPostHandler({
      env: baseEnv,
      now,
      grantCollaborator: async () => {
        throw new TeachingCourseCollaboratorStoreError(
          409,
          "active-grant-change-requires-revoke",
          { unsafe: recipientEmail },
        );
      },
    })(
      request(`/api/teaching/courses/${courseId}/collaborators`, {
        method: "POST",
        role: "teacher",
        teacherWriteActor: "teacher-kang",
        headers: { "idempotency-key": "collaborator-grant-conflict" },
        body: JSON.stringify({
          recipientEmail,
          role: "reviewer",
          scopes: ["course.read"],
        }),
      }),
      routeContext(),
    );
    const body = await readJson(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      status: "conflict",
      reasonCode: "active-grant-change-requires-revoke",
    });
    expect(JSON.stringify(body)).not.toContain(recipientEmail);
    expect(JSON.stringify(body)).not.toContain("unsafe");
  });

  it("redacts unexpected exception messages", async () => {
    const response = await createTeachingCourseCollaboratorGetHandler({
      env: baseEnv,
      now,
      listCollaborators: async () => {
        throw new Error(`database error for ${recipientEmail}`);
      },
    })(
      request(`/api/teaching/courses/${courseId}/collaborators`, {
        role: "teacher",
      }),
      routeContext(),
    );
    const body = await readJson(response);

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      status: "failed",
      reasonCode: "collaborator-request-failed",
    });
    expect(JSON.stringify(body)).not.toContain(recipientEmail);
    expect(JSON.stringify(body)).not.toContain("database error");
  });

  it("fails closed when isolated staging has no dedicated database", async () => {
    const response = await createTeachingCourseCollaboratorGetHandler({
      env: baseEnv,
      now,
    })(
      request(`/api/teaching/courses/${courseId}/collaborators`, {
        role: "teacher",
      }),
      routeContext(),
    );

    expect(response.status).toBe(503);
    expect(await readJson(response)).toMatchObject({
      status: "unavailable",
      reasonCode: "core-database-required",
    });
  });
});
