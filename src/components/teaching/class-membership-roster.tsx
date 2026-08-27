"use client";

// The class roster panel for the teacher course-settings workspace (plan E9).
//
// It replaces a bare list of pending rows, each carrying one Approve button and
// no way to say no. Three things changed:
//
//  - "Approve all N" behind a confirm step, so a 200-student class opening on the
//    first day of term is one request and one write rather than 200 of each.
//  - Reject on every waiting row, and Remove on every approved one. Both are
//    PATCHes to E8's membership route, which closes the row rather than deleting
//    it, so the audit trail and the student's own view survive.
//  - A name filter, because the panel above it was unusable at class size.
//
// The destructive controls (approve-all, remove) both confirm inline rather than
// in a modal: the row being acted on stays on screen and readable, which is the
// whole point of asking.

import { useMemo, useState } from "react";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { UserMinus } from "@phosphor-icons/react/dist/ssr/UserMinus";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { copy } from "@/i18n/copy";
import type { Locale } from "@/i18n/copy";
import type { TeacherClassItem, TeacherClassMembershipItem } from "@/lib/teaching/course-readback";

export function ClassMembershipRoster({
  classItem,
  memberships,
  membershipApprovalStatuses,
  membershipLifecycleStatuses,
  classRosterStatus,
  pendingMembershipIds,
  isBulkApprovalPending,
  locale,
  onApproveMembership,
  onApproveAllPendingMemberships,
  onRejectMembership,
  onRemoveMembership,
}: {
  classItem: TeacherClassItem;
  memberships: TeacherClassMembershipItem[];
  membershipApprovalStatuses: Record<string, string>;
  membershipLifecycleStatuses: Record<string, string>;
  classRosterStatus?: string;
  pendingMembershipIds: string[];
  isBulkApprovalPending: boolean;
  locale: Locale;
  onApproveMembership: (
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) => void;
  onApproveAllPendingMemberships: (
    classItem: TeacherClassItem,
    pendingMemberships: TeacherClassMembershipItem[],
  ) => void;
  onRejectMembership: (
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) => void;
  onRemoveMembership: (
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) => void;
}) {
  const t = copy[locale].teaching;
  const [nameFilter, setNameFilter] = useState("");
  const [isConfirmingApproveAll, setIsConfirmingApproveAll] = useState(false);
  const [pendingRemovalMembershipId, setPendingRemovalMembershipId] = useState<string>();

  // The filter narrows what is shown, never what "approve all" acts on: the count
  // on the button is the whole waiting list, and it says so.
  const pendingMemberships = useMemo(
    () =>
      memberships.filter(
        (membership) => membership.membershipStatus === "pending-teacher-review",
      ),
    [memberships],
  );
  const approvedMemberships = useMemo(
    () => memberships.filter((membership) => membership.membershipStatus === "approved"),
    [memberships],
  );
  // Rejected and removed rows are kept, not deleted, by E8's route. They are shown
  // in their own quiet section so the receipt for the decision the teacher just
  // made does not vanish along with the row it belonged to.
  const closedMemberships = useMemo(
    () =>
      memberships.filter(
        (membership) =>
          membership.membershipStatus === "rejected" ||
          membership.membershipStatus === "removed",
      ),
    [memberships],
  );
  const normalizedFilter = nameFilter.trim().toLowerCase();
  const matchesFilter = (membership: TeacherClassMembershipItem) =>
    !normalizedFilter ||
    membership.studentDisplayName.toLowerCase().includes(normalizedFilter) ||
    membership.studentId.toLowerCase().includes(normalizedFilter);
  const visiblePending = pendingMemberships.filter(matchesFilter);
  const visibleApproved = approvedMemberships.filter(matchesFilter);
  const visibleClosed = closedMemberships.filter(matchesFilter);

  if (
    pendingMemberships.length === 0 &&
    approvedMemberships.length === 0 &&
    closedMemberships.length === 0 &&
    !classRosterStatus
  ) {
    return null;
  }

  const filterInputId = `class-roster-filter-${classItem.id}`;

  return (
    <div
      data-uais-class-roster={classItem.id}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h5 className="text-sm font-semibold text-[var(--foreground)]">
          {t.rosterPanelTitle}
        </h5>
        <div className="relative">
          <label htmlFor={filterInputId} className="sr-only">
            {t.rosterFilterLabel}
          </label>
          <MagnifyingGlass
            size={15}
            weight="bold"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
          />
          <input
            id={filterInputId}
            value={nameFilter}
            aria-label={t.rosterFilterLabel}
            placeholder={t.rosterFilterPlaceholder}
            className="h-11 w-56 max-w-full rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] pl-9 pr-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
            onChange={(event) => setNameFilter(event.target.value)}
          />
        </div>
      </div>

      {classRosterStatus ? (
        <p
          role="status"
          className="mt-3 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--accent)]"
        >
          {classRosterStatus}
        </p>
      ) : null}

      <section className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--muted)]">
            {`${t.rosterPendingTitle}: ${pendingMemberships.length}`}
          </p>
          {pendingMemberships.length > 0 ? (
            <button
              type="button"
              disabled={isBulkApprovalPending}
              aria-label={
                locale === "zh-CN"
                  ? `批准${classItem.name}的全部 ${pendingMemberships.length} 条待审批申请`
                  : `Approve all ${pendingMemberships.length} pending requests for ${classItem.name}`
              }
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => setIsConfirmingApproveAll(true)}
            >
              <Check size={16} weight="bold" />
              {`${t.rosterApproveAll} (${pendingMemberships.length})`}
            </button>
          ) : null}
        </div>

        {isConfirmingApproveAll ? (
          <div
            role="group"
            aria-label={t.rosterApproveAllConfirmTitle}
            className="mt-3 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-3 text-sm text-[var(--foreground)]"
          >
            <p className="font-semibold">
              {locale === "zh-CN"
                ? `${t.rosterApproveAllConfirmTitle}共 ${pendingMemberships.length} 人将加入${classItem.name}。`
                : `${t.rosterApproveAllConfirmTitle} ${pendingMemberships.length} students will join ${classItem.name}.`}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                className="inline-flex h-11 items-center rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                onClick={() => {
                  setIsConfirmingApproveAll(false);
                  onApproveAllPendingMemberships(classItem, pendingMemberships);
                }}
              >
                {t.rosterApproveAllConfirm}
              </button>
              <button
                type="button"
                className="inline-flex h-11 items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                onClick={() => setIsConfirmingApproveAll(false)}
              >
                {t.rosterCancel}
              </button>
            </div>
          </div>
        ) : null}

        {pendingMemberships.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{t.rosterNoPending}</p>
        ) : visiblePending.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{t.rosterFilterEmpty}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {visiblePending.map((membership) => (
              <li
                key={membership.id}
                data-uais-roster-pending-membership={membership.id}
                className="flex flex-col gap-2 rounded-xl border border-[#f5d38a] bg-[#fff9ec] px-3 py-2 text-sm text-[#6f4c12] sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
              >
                <span className="min-w-0">
                  <span className="font-semibold">
                    {locale === "zh-CN"
                      ? `${membership.studentDisplayName} 等待加入`
                      : `${membership.studentDisplayName} is waiting to join`}
                  </span>
                  {membershipApprovalStatuses[membership.id] ||
                  membershipLifecycleStatuses[membership.id] ? (
                    <span className="mt-1 block text-sm font-medium">
                      {membershipLifecycleStatuses[membership.id] ??
                        membershipApprovalStatuses[membership.id]}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    aria-label={
                      locale === "zh-CN"
                        ? `审批${membership.studentDisplayName}加入${classItem.name}`
                        : `Approve ${membership.studentDisplayName} for ${classItem.name}`
                    }
                    disabled={pendingMembershipIds.includes(membership.id)}
                    className="inline-flex h-11 items-center justify-center rounded-full bg-[#2f7cff] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[#2364d9] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:opacity-70"
                    onClick={() => onApproveMembership(classItem, membership)}
                  >
                    {t.rosterApprove}
                  </button>
                  <button
                    type="button"
                    aria-label={
                      locale === "zh-CN"
                        ? `拒绝${membership.studentDisplayName}加入${classItem.name}`
                        : `Reject ${membership.studentDisplayName} for ${classItem.name}`
                    }
                    disabled={pendingMembershipIds.includes(membership.id)}
                    className="inline-flex h-11 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 outline-none transition hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:opacity-70 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                    onClick={() => onRejectMembership(classItem, membership)}
                  >
                    <X size={15} weight="bold" />
                    {t.rosterReject}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4">
        <p className="text-sm font-semibold text-[var(--muted)]">
          {`${t.rosterApprovedTitle}: ${approvedMemberships.length}`}
        </p>
        {approvedMemberships.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{t.rosterNoApproved}</p>
        ) : visibleApproved.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{t.rosterFilterEmpty}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {visibleApproved.map((membership) => (
              <li
                key={membership.id}
                data-uais-roster-approved-membership={membership.id}
                className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--foreground)] sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  <span className="font-semibold">{membership.studentDisplayName}</span>
                  {membershipLifecycleStatuses[membership.id] ??
                  membershipApprovalStatuses[membership.id] ? (
                    <span className="mt-1 block text-sm font-medium text-[var(--muted)]">
                      {membershipLifecycleStatuses[membership.id] ??
                        membershipApprovalStatuses[membership.id]}
                    </span>
                  ) : null}
                </span>
                {pendingRemovalMembershipId === membership.id ? (
                  <span className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={
                        locale === "zh-CN"
                          ? `确认将${membership.studentDisplayName}移出${classItem.name}`
                          : `Confirm removing ${membership.studentDisplayName} from ${classItem.name}`
                      }
                      className="inline-flex h-11 items-center rounded-full bg-rose-600 px-4 text-sm font-semibold text-white outline-none transition hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-400"
                      onClick={() => {
                        setPendingRemovalMembershipId(undefined);
                        onRemoveMembership(classItem, membership);
                      }}
                    >
                      {t.rosterRemoveConfirm}
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-11 items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      onClick={() => setPendingRemovalMembershipId(undefined)}
                    >
                      {t.rosterCancel}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={
                      locale === "zh-CN"
                        ? `将${membership.studentDisplayName}移出${classItem.name}`
                        : `Remove ${membership.studentDisplayName} from ${classItem.name}`
                    }
                    disabled={pendingMembershipIds.includes(membership.id)}
                    className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 outline-none transition hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:opacity-70 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                    onClick={() => setPendingRemovalMembershipId(membership.id)}
                  >
                    <UserMinus size={15} weight="bold" />
                    {t.rosterRemove}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {visibleClosed.length > 0 ? (
        <ul className="mt-4 space-y-2" aria-label={t.rosterClosedTitle}>
          {visibleClosed.map((membership) => (
            <li
              key={membership.id}
              data-uais-roster-closed-membership={membership.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--muted)]"
            >
              <span className="font-semibold text-[var(--foreground)]">
                {membership.studentDisplayName}
              </span>
              <span className="ml-2">
                {membership.membershipStatus === "rejected"
                  ? t.rosterRejectedBadge
                  : t.rosterRemovedBadge}
              </span>
              {membershipLifecycleStatuses[membership.id] ? (
                <span className="mt-1 block font-medium">
                  {membershipLifecycleStatuses[membership.id]}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
