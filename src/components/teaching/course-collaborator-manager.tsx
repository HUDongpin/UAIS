"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import { localizedText } from "@/components/ui/localized-text";
import type { TeacherCourse } from "@/data/uais";
import { copy, type Locale } from "@/i18n/copy";
import {
  TEACHING_COURSE_COLLABORATOR_ROLE_CEILINGS,
  TEACHING_COURSE_COLLABORATOR_ROLES,
  isTeachingCourseCollaboratorRole,
  isTeachingCourseCollaboratorUuid,
  isTeachingCourseDelegatableCapability,
  type TeachingCourseCollaboratorGrant,
  type TeachingCourseCollaboratorRole,
  type TeachingCourseDelegatableCapability,
} from "@/lib/server/teaching-course-collaborator-types";

type PanelLoadState = "idle" | "loading" | "ready" | "error";
type PendingAction = "grant" | `revoke:${string}`;
type Notice = {
  tone: "status" | "error";
  message: string;
};
type GrantPayload = {
  recipientEmail: string;
  role: TeachingCourseCollaboratorRole;
  scopes: TeachingCourseDelegatableCapability[];
  expiresAt?: string;
};

class CollaboratorRequestError extends Error {
  readonly reasonCode: string;
  readonly uncertain: boolean;

  constructor(reasonCode: string, options: { uncertain?: boolean } = {}) {
    super(reasonCode);
    this.name = "CollaboratorRequestError";
    this.reasonCode = reasonCode;
    this.uncertain = options.uncertain ?? false;
  }
}

export function CourseCollaboratorManager({
  course,
  locale,
}: {
  course: TeacherCourse;
  locale: Locale;
}) {
  const t = copy[locale].teaching;
  const courseTitle = localizedText(course.title, locale);
  const panelId = `course-collaborators-${useId().replace(/:/g, "")}`;
  const [isOpen, setIsOpen] = useState(false);
  const [loadState, setLoadState] = useState<PanelLoadState>("idle");
  const [grants, setGrants] = useState<TeachingCourseCollaboratorGrant[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [confirmRevokeGrantId, setConfirmRevokeGrantId] = useState<string>();
  const [recipientEmail, setRecipientEmail] = useState("");
  const [role, setRole] =
    useState<TeachingCourseCollaboratorRole>("observer");
  const [scopes, setScopes] = useState<TeachingCourseDelegatableCapability[]>([
    "course.read",
  ]);
  const [expiresAt, setExpiresAt] = useState("");
  const grantRetry = useRef<{ fingerprint: string; key: string } | undefined>(
    undefined,
  );
  const revokeRetryKeys = useRef(new Map<string, string>());

  async function loadCollaborators() {
    setLoadState("loading");
    setLoadError(undefined);
    try {
      const nextGrants = await requestCollaboratorList(course.id);
      setGrants(nextGrants);
      setLoadState("ready");
      return nextGrants;
    } catch (error) {
      setLoadState("error");
      setLoadError(readRequestErrorMessage(t, error));
      return undefined;
    }
  }

  function togglePanel() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    setConfirmRevokeGrantId(undefined);
    if (nextOpen) {
      void loadCollaborators();
    }
  }

  function updateRole(value: string) {
    if (!isTeachingCourseCollaboratorRole(value)) return;
    setRole(value);
    setScopes([
      ...TEACHING_COURSE_COLLABORATOR_ROLE_CEILINGS[value],
    ]);
    setNotice(undefined);
  }

  function toggleScope(
    capability: TeachingCourseDelegatableCapability,
    checked: boolean,
  ) {
    const ceiling =
      TEACHING_COURSE_COLLABORATOR_ROLE_CEILINGS[role] as readonly TeachingCourseDelegatableCapability[];
    setScopes((current) =>
      ceiling.filter((scope) =>
        scope === capability ? checked : current.includes(scope),
      ),
    );
    setNotice(undefined);
  }

  async function grantCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingAction) return;
    const normalizedEmail = recipientEmail.trim();
    if (!normalizedEmail) {
      setNotice({ tone: "error", message: t.collaboratorRecipientInvalid });
      return;
    }
    if (scopes.length === 0) {
      setNotice({ tone: "error", message: t.collaboratorScopeRequired });
      return;
    }

    let normalizedExpiry: string | undefined;
    if (expiresAt.trim()) {
      const expiryTimestamp = new Date(expiresAt).getTime();
      if (
        !Number.isFinite(expiryTimestamp) ||
        expiryTimestamp <= Date.now()
      ) {
        setNotice({ tone: "error", message: t.collaboratorExpiryInvalid });
        return;
      }
      normalizedExpiry = new Date(expiryTimestamp).toISOString();
    }
    const payload: GrantPayload = {
      recipientEmail: normalizedEmail,
      role,
      scopes: [...scopes],
      ...(normalizedExpiry ? { expiresAt: normalizedExpiry } : {}),
    };
    const fingerprint = JSON.stringify(payload);
    const existingRetry = grantRetry.current;
    const idempotencyKey =
      existingRetry?.fingerprint === fingerprint
        ? existingRetry.key
        : createRequestId("ui-collaborator-grant");
    grantRetry.current = { fingerprint, key: idempotencyKey };

    setPendingAction("grant");
    setNotice({ tone: "status", message: t.collaboratorGranting });
    let grantId: string;
    try {
      grantId = await requestGrant({
        courseId: course.id,
        payload,
        idempotencyKey,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof CollaboratorRequestError && error.uncertain
            ? t.collaboratorGrantUncertain
            : readRequestErrorMessage(t, error),
      });
      setPendingAction(undefined);
      return;
    }

    try {
      const nextGrants = await requestCollaboratorList(course.id);
      setGrants(nextGrants);
      setLoadState("ready");
      setLoadError(undefined);
      const readback = nextGrants.find(
        (item) => item.grantId === grantId && item.status === "active",
      );
      if (!readback) {
        throw new CollaboratorRequestError("collaborator-readback-invalid");
      }
      grantRetry.current = undefined;
      setRecipientEmail("");
      setRole("observer");
      setScopes(["course.read"]);
      setExpiresAt("");
      setNotice({ tone: "status", message: t.collaboratorGrantSaved });
    } catch {
      setNotice({
        tone: "error",
        message: t.collaboratorGrantReadbackFailed,
      });
    } finally {
      setPendingAction(undefined);
    }
  }

  async function revokeCollaborator(grantId: string) {
    if (pendingAction) return;
    const existingKey = revokeRetryKeys.current.get(grantId);
    const idempotencyKey =
      existingKey ?? createRequestId("ui-collaborator-revoke");
    revokeRetryKeys.current.set(grantId, idempotencyKey);
    setPendingAction(`revoke:${grantId}`);
    setNotice({ tone: "status", message: t.collaboratorRevoking });

    try {
      await requestRevoke({
        courseId: course.id,
        grantId,
        idempotencyKey,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof CollaboratorRequestError && error.uncertain
            ? t.collaboratorRevokeUncertain
            : readRequestErrorMessage(t, error),
      });
      setPendingAction(undefined);
      return;
    }

    try {
      const nextGrants = await requestCollaboratorList(course.id);
      setGrants(nextGrants);
      setLoadState("ready");
      setLoadError(undefined);
      const readback = nextGrants.find(
        (item) => item.grantId === grantId && item.status === "revoked",
      );
      if (!readback) {
        throw new CollaboratorRequestError("collaborator-readback-invalid");
      }
      revokeRetryKeys.current.delete(grantId);
      setConfirmRevokeGrantId(undefined);
      setNotice({ tone: "status", message: t.collaboratorRevokeSaved });
    } catch {
      setNotice({
        tone: "error",
        message: t.collaboratorRevokeReadbackFailed,
      });
    } finally {
      setPendingAction(undefined);
    }
  }

  const roleCeiling =
    TEACHING_COURSE_COLLABORATOR_ROLE_CEILINGS[role] as readonly TeachingCourseDelegatableCapability[];
  const toggleLabel =
    locale === "zh-CN"
      ? `管理${courseTitle}的协作者`
      : `Manage collaborators for ${courseTitle}`;
  const regionLabel =
    locale === "zh-CN"
      ? `${courseTitle}课程协作者`
      : `Course collaborators for ${courseTitle}`;

  return (
    <section className="mt-5 border-t border-[var(--border)] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-[var(--foreground)]">
            {t.collaboratorPanelTitle}
          </h4>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {t.collaboratorPanelSummary}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={toggleLabel}
          className="inline-flex min-h-11 items-center rounded-full border border-[var(--accent)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--accent)] outline-none transition hover:bg-[var(--accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={togglePanel}
        >
          {isOpen ? t.collaboratorHide : t.collaboratorManage}
        </button>
      </div>

      {isOpen ? (
        <div
          id={panelId}
          role="region"
          aria-label={regionLabel}
          className="mt-4 space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
          data-uais-course-collaborator-panel={course.id}
        >
          {loadState === "loading" ? (
            <p role="status" className="text-sm text-[var(--muted)]">
              {t.collaboratorLoading}
            </p>
          ) : null}
          {loadState === "error" && loadError ? (
            <div
              role="alert"
              className="rounded-xl border border-[var(--danger)]/30 bg-[var(--surface-soft)] p-3 text-sm font-semibold text-[var(--danger)]"
            >
              {loadError}
            </div>
          ) : null}

          {loadState === "ready" ? (
            grants.length > 0 ? (
              <ul className="space-y-3" aria-label={t.collaboratorPanelTitle}>
                {grants.map((grant) => {
                  const isRevoking =
                    pendingAction === `revoke:${grant.grantId}`;
                  const isConfirming =
                    confirmRevokeGrantId === grant.grantId;
                  return (
                    <li
                      key={grant.grantId}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                            {t.collaboratorRecipientLabel}
                          </p>
                          <p
                            className="mt-1 font-mono text-sm font-semibold text-[var(--foreground)]"
                            title={grant.recipientUserId}
                            aria-label={`${t.collaboratorRecipientId}: ${grant.recipientUserId}`}
                          >
                            {abbreviateUserId(grant.recipientUserId)}
                          </p>
                        </div>
                        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--foreground)]">
                          {readGrantStatusLabel(t, grant.status)}
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                        {readRoleLabel(t, grant.role)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {grant.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]"
                          >
                            {readScopeLabel(t, scope)}
                          </span>
                        ))}
                      </div>
                      {grant.status === "active" ? (
                        <div className="mt-3">
                          {isConfirming ? (
                            <div
                              role="group"
                              aria-label={t.collaboratorRevokeWarning}
                              className="rounded-xl border border-[var(--danger)]/30 bg-[var(--surface-soft)] p-3"
                            >
                              <p className="text-sm font-semibold text-[var(--danger)]">
                                {t.collaboratorRevokeWarning}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={Boolean(pendingAction)}
                                  className="min-h-11 rounded-full bg-[var(--danger)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={() =>
                                    void revokeCollaborator(grant.grantId)
                                  }
                                >
                                  {isRevoking
                                    ? t.collaboratorRevoking
                                    : t.collaboratorRevokeConfirm}
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(pendingAction)}
                                  className="min-h-11 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={() =>
                                    setConfirmRevokeGrantId(undefined)
                                  }
                                >
                                  {t.collaboratorCancel}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={Boolean(pendingAction)}
                              className="min-h-11 rounded-full border border-[var(--danger)]/40 bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--danger)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() =>
                                setConfirmRevokeGrantId(grant.grantId)
                              }
                            >
                              {t.collaboratorRevokeAction}
                            </button>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                {t.collaboratorEmpty}
              </p>
            )
          ) : null}

          <form
            className="space-y-4 border-t border-[var(--border)] pt-4"
            onSubmit={grantCollaborator}
          >
            <div>
              <label
                htmlFor={`${panelId}-email`}
                className="block text-sm font-semibold text-[var(--foreground)]"
              >
                {t.collaboratorEmailLabel}
              </label>
              <input
                id={`${panelId}-email`}
                type="email"
                autoComplete="email"
                spellCheck={false}
                required
                value={recipientEmail}
                aria-describedby={`${panelId}-email-hint`}
                className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                onChange={(event) => {
                  setRecipientEmail(event.target.value);
                  setNotice(undefined);
                }}
              />
              <p
                id={`${panelId}-email-hint`}
                className="mt-1 text-xs leading-5 text-[var(--muted)]"
              >
                {t.collaboratorEmailHint}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor={`${panelId}-role`}
                  className="block text-sm font-semibold text-[var(--foreground)]"
                >
                  {t.collaboratorRoleLabel}
                </label>
                <select
                  id={`${panelId}-role`}
                  value={role}
                  className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                  onChange={(event) => updateRole(event.target.value)}
                >
                  {TEACHING_COURSE_COLLABORATOR_ROLES.map((item) => (
                    <option key={item} value={item}>
                      {readRoleLabel(t, item)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor={`${panelId}-expiry`}
                  className="block text-sm font-semibold text-[var(--foreground)]"
                >
                  {t.collaboratorExpiryLabel}
                </label>
                <input
                  id={`${panelId}-expiry`}
                  type="datetime-local"
                  value={expiresAt}
                  aria-describedby={`${panelId}-expiry-hint`}
                  className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                  onChange={(event) => {
                    setExpiresAt(event.target.value);
                    setNotice(undefined);
                  }}
                />
                <p
                  id={`${panelId}-expiry-hint`}
                  className="mt-1 text-xs leading-5 text-[var(--muted)]"
                >
                  {t.collaboratorExpiryHint}
                </p>
              </div>
            </div>

            <fieldset>
              <legend className="text-sm font-semibold text-[var(--foreground)]">
                {t.collaboratorScopesLabel}
              </legend>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                {t.collaboratorScopesHint}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {roleCeiling.map((capability) => (
                  <label
                    key={capability}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--foreground)]"
                  >
                    <input
                      type="checkbox"
                      checked={scopes.includes(capability)}
                      onChange={(event) =>
                        toggleScope(capability, event.target.checked)
                      }
                    />
                    <span>{readScopeLabel(t, capability)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <button
              type="submit"
              disabled={
                Boolean(pendingAction) ||
                !recipientEmail.trim() ||
                scopes.length === 0
              }
              className="inline-flex min-h-11 items-center rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pendingAction === "grant"
                ? t.collaboratorGranting
                : t.collaboratorGrantAction}
            </button>
          </form>

          {notice ? (
            <p
              role={notice.tone === "error" ? "alert" : "status"}
              aria-live="polite"
              className={[
                "rounded-xl border p-3 text-sm font-semibold",
                notice.tone === "error"
                  ? "border-[var(--danger)]/30 bg-[var(--surface-soft)] text-[var(--danger)]"
                  : "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]",
              ].join(" ")}
            >
              {notice.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

async function requestCollaboratorList(courseId: string) {
  const response = await fetch(
    `/api/teaching/courses/${encodeURIComponent(courseId)}/collaborators`,
    {
      cache: "no-store",
      headers: { accept: "application/json" },
    },
  );
  const body = await readResponseRecord(response);
  if (!response.ok) {
    throw new CollaboratorRequestError(
      readReasonCode(body) ?? `request-failed-${response.status}`,
    );
  }
  if (
    body.status !== "read" ||
    body.courseId !== courseId ||
    !Array.isArray(body.grants)
  ) {
    throw new CollaboratorRequestError("collaborator-readback-invalid");
  }
  return body.grants.map((value) => readGrant(value, courseId));
}

async function requestGrant(input: {
  courseId: string;
  payload: GrantPayload;
  idempotencyKey: string;
}) {
  const body = await requestMutation(
    `/api/teaching/courses/${encodeURIComponent(input.courseId)}/collaborators`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify(input.payload),
    },
  );
  const receipt = readRecord(body.receipt);
  if (
    !receipt ||
    (receipt.status !== "persisted" &&
      receipt.status !== "already-active") ||
    receipt.courseId !== input.courseId ||
    !isTeachingCourseCollaboratorUuid(receipt.grantId)
  ) {
    throw new CollaboratorRequestError("collaborator-readback-invalid");
  }
  return receipt.grantId;
}

async function requestRevoke(input: {
  courseId: string;
  grantId: string;
  idempotencyKey: string;
}) {
  const body = await requestMutation(
    `/api/teaching/courses/${encodeURIComponent(
      input.courseId,
    )}/collaborators/${encodeURIComponent(input.grantId)}`,
    {
      method: "DELETE",
      headers: {
        accept: "application/json",
        "idempotency-key": input.idempotencyKey,
      },
    },
  );
  const receipt = readRecord(body.receipt);
  if (
    !receipt ||
    receipt.status !== "persisted" ||
    receipt.event !== "grant-revoked" ||
    receipt.courseId !== input.courseId ||
    receipt.grantId !== input.grantId
  ) {
    throw new CollaboratorRequestError("collaborator-readback-invalid");
  }
}

async function requestMutation(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new CollaboratorRequestError("network-uncertain", {
      uncertain: true,
    });
  }
  const body = await readResponseRecord(response);
  if (!response.ok) {
    throw new CollaboratorRequestError(
      readReasonCode(body) ?? `request-failed-${response.status}`,
    );
  }
  return body;
}

async function readResponseRecord(response: Response) {
  try {
    return readRecord(await response.json()) ?? {};
  } catch {
    return {};
  }
}

function readGrant(
  value: unknown,
  expectedCourseId: string,
): TeachingCourseCollaboratorGrant {
  const grant = readRecord(value);
  const rawScopes = Array.isArray(grant?.scopes) ? grant.scopes : undefined;
  const scopes = rawScopes?.filter(isTeachingCourseDelegatableCapability) ?? [];
  if (
    !grant ||
    !rawScopes ||
    !isTeachingCourseCollaboratorUuid(grant.grantId) ||
    grant.courseId !== expectedCourseId ||
    !isTeachingCourseCollaboratorUuid(grant.recipientUserId) ||
    !isTeachingCourseCollaboratorUuid(grant.grantedByUserId) ||
    !isTeachingCourseCollaboratorRole(grant.role) ||
    scopes.length !== rawScopes.length ||
    (grant.status !== "active" &&
      grant.status !== "expired" &&
      grant.status !== "revoked") ||
    !Number.isSafeInteger(grant.revision) ||
    Number(grant.revision) <= 0 ||
    typeof grant.grantedAt !== "string"
  ) {
    throw new CollaboratorRequestError("collaborator-readback-invalid");
  }
  return {
    grantId: grant.grantId,
    courseId: expectedCourseId,
    recipientUserId: grant.recipientUserId,
    grantedByUserId: grant.grantedByUserId,
    role: grant.role,
    scopes,
    status: grant.status,
    revision: Number(grant.revision),
    grantedAt: grant.grantedAt,
    ...(typeof grant.expiresAt === "string"
      ? { expiresAt: grant.expiresAt }
      : {}),
    ...(typeof grant.revokedAt === "string"
      ? { revokedAt: grant.revokedAt }
      : {}),
    ...(typeof grant.revokedByUserId === "string"
      ? { revokedByUserId: grant.revokedByUserId }
      : {}),
  };
}

function readRequestErrorMessage(
  t: (typeof copy)[Locale]["teaching"],
  error: unknown,
) {
  const reasonCode =
    error instanceof CollaboratorRequestError ? error.reasonCode : undefined;
  switch (reasonCode) {
    case "authenticated-session-required":
      return t.collaboratorAuthRequired;
    case "teacher-write-session-required":
      return t.collaboratorWriteAuthRequired;
    case "teacher-session-identity-mismatch":
      return t.collaboratorIdentityMismatch;
    case "course-owner-required":
      return t.collaboratorOwnerRequired;
    case "recipient-unknown":
      return t.collaboratorRecipientUnknown;
    case "recipient-email-invalid":
      return t.collaboratorRecipientInvalid;
    case "recipient-self-denied":
      return t.collaboratorRecipientSelfDenied;
    case "recipient-active-teacher-required":
      return t.collaboratorRecipientTeacherRequired;
    case "scope-required":
    case "scope-unknown":
    case "scope-exceeds-role-ceiling":
      return t.collaboratorScopeRequired;
    case "expiry-invalid":
    case "expiry-must-follow-grant":
      return t.collaboratorExpiryInvalid;
    case "active-grant-change-requires-revoke":
    case "idempotency-key-payload-mismatch":
    case "idempotency-key-scope-conflict":
      return t.collaboratorConflict;
    case "collaborator-readback-invalid":
      return t.collaboratorReadbackInvalid;
    default:
      return t.collaboratorRequestFailed;
  }
}

function readRoleLabel(
  t: (typeof copy)[Locale]["teaching"],
  role: TeachingCourseCollaboratorRole,
) {
  switch (role) {
    case "observer":
      return t.collaboratorRoleObserver;
    case "reviewer":
      return t.collaboratorRoleReviewer;
    case "teaching-assistant":
      return t.collaboratorRoleTeachingAssistant;
    case "co-instructor":
      return t.collaboratorRoleCoInstructor;
  }
}

function readScopeLabel(
  t: (typeof copy)[Locale]["teaching"],
  scope: TeachingCourseDelegatableCapability,
) {
  switch (scope) {
    case "course.read":
      return t.collaboratorScopeRead;
    case "course.content.write":
      return t.collaboratorScopeContentWrite;
    case "course.students.manage":
      return t.collaboratorScopeStudentsManage;
    case "course.grading.manage":
      return t.collaboratorScopeGradingManage;
    case "course.settings.manage":
      return t.collaboratorScopeSettingsManage;
    case "course.export":
      return t.collaboratorScopeExport;
  }
}

function readGrantStatusLabel(
  t: (typeof copy)[Locale]["teaching"],
  status: TeachingCourseCollaboratorGrant["status"],
) {
  if (status === "active") return t.collaboratorStatusActive;
  if (status === "expired") return t.collaboratorStatusExpired;
  return t.collaboratorStatusRevoked;
}

function readReasonCode(body: Record<string, unknown>) {
  return typeof body.reasonCode === "string" ? body.reasonCode : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function createRequestId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function abbreviateUserId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
