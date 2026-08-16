"use client";

// The phone-width half of the app header (E12/PKG-7).
//
// Below `md` the desktop header hides its primary nav AND its account menu, so
// the only route affordance left on a phone was the logo link and there was no
// way to sign out at all. This is that missing surface: one hamburger that opens
// a sheet carrying the same role-scoped links the desktop nav renders, plus the
// sign-out the account menu owns. The desktop header is untouched — this whole
// component is `md:hidden`.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { List } from "@phosphor-icons/react/dist/ssr/List";
import { SignOut } from "@phosphor-icons/react/dist/ssr/SignOut";
import { UserCircle } from "@phosphor-icons/react/dist/ssr/UserCircle";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { localizedText } from "@/components/ui/localized-text";
import { copy, type Locale, type LocalizedText } from "@/i18n/copy";

const mobileNavPanelId = "uais-mobile-nav-panel";

export function HeaderMobileMenu({
  locale,
  pathname,
  navItems,
  accountDisplayName,
  accountRoleLabel,
  signOutLabel,
  onSignOut,
}: {
  locale: Locale;
  pathname: string;
  navItems: { href: string; label: LocalizedText }[];
  accountDisplayName: string;
  accountRoleLabel: string;
  signOutLabel: string;
  onSignOut: () => void;
}) {
  const t = copy[locale];
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function closeMenu() {
    setOpen(false);
    // The trigger is where the keyboard was before the sheet opened, so it is
    // where the keyboard has to come back to.
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const panel = panelRef.current;
    if (!panel) {
      return undefined;
    }

    function panelFocusables() {
      return Array.from(
        panel?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled])",
        ) ?? [],
      );
    }

    panelFocusables()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      // Focus stays inside the sheet while it is open: it covers the page, so
      // tabbing out of it would walk an invisible header behind the overlay.
      const focusables = panelFocusables();
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const leavingBackwards = event.shiftKey && (active === first || !panel?.contains(active));
      const leavingForwards = !event.shiftKey && active === last;
      if (leavingBackwards) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (leavingForwards) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        data-uais-mobile-nav-trigger="true"
        aria-controls={mobileNavPanelId}
        aria-expanded={open}
        aria-label={open ? t.controls.menuClose : t.controls.menu}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex size-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-[0_8px_24px_var(--shadow)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {open ? (
          <X size={19} weight="bold" />
        ) : (
          <List size={19} weight="bold" />
        )}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label={t.controls.menuClose}
            onClick={closeMenu}
            className="absolute inset-0 bg-[var(--foreground)]/35 backdrop-blur-[1px]"
          />
          <div
            ref={panelRef}
            id={mobileNavPanelId}
            data-uais-mobile-nav="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t.controls.menuTitle}
            className="absolute right-0 top-0 flex h-full w-[min(86vw,320px)] flex-col overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--foreground)] shadow-[0_22px_60px_var(--shadow-strong)]"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  <UserCircle size={22} weight="duotone" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {accountDisplayName}
                  </span>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {accountRoleLabel}
                  </span>
                </span>
              </span>
              <button
                type="button"
                aria-label={t.controls.menuClose}
                onClick={closeMenu}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <X size={17} weight="bold" />
              </button>
            </div>

            <nav aria-label={t.controls.menuTitle} className="mt-4 grid gap-1">
              {navItems.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`) ||
                  (pathname === "/" && item.href === "/courses");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "flex h-12 items-center rounded-2xl border px-3 text-base font-semibold outline-none transition active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                      active
                        ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-transparent text-[var(--foreground)] hover:bg-[var(--surface-soft)]",
                    ].join(" ")}
                  >
                    {localizedText(item.label, locale)}
                  </Link>
                );
              })}
            </nav>

            <button
              type="button"
              data-uais-mobile-nav-sign-out="true"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="mt-auto flex h-12 w-full items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-left text-sm font-semibold text-[var(--danger)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--danger)]"
            >
              <SignOut size={17} weight="duotone" />
              {signOutLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
