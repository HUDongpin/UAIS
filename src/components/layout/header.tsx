"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "@phosphor-icons/react/dist/ssr/Bell";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { CalendarBlank } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { ChartBar } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { Moon } from "@phosphor-icons/react/dist/ssr/Moon";
import { SignOut } from "@phosphor-icons/react/dist/ssr/SignOut";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { Sun } from "@phosphor-icons/react/dist/ssr/Sun";
import { Translate } from "@phosphor-icons/react/dist/ssr/Translate";
import { UserCircle } from "@phosphor-icons/react/dist/ssr/UserCircle";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { HeaderMobileMenu } from "@/components/layout/header-mobile-menu";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { getTeachingOperationHref } from "@/components/teaching/teaching-operation-data";
import { getNavItemsForRole, teacherCourses, teacherSidebarItems } from "@/data/uais";
import { copy } from "@/i18n/copy";
import { localizedText } from "@/components/ui/localized-text";
import {
  getUaisHomeHrefForRole,
  type UaisAppSessionUser,
} from "@/lib/auth/uais-app-session";

export function Header({
  initialSessionUser,
}: {
  initialSessionUser?: UaisAppSessionUser | null;
}) {
  const pathname = usePathname();
  const { locale, theme, toggleLocale, toggleTheme } = useAppPreferences();
  const t = copy[locale];
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  // Read straight from the prop instead of being frozen in `useState` at first
  // render: a server-provided change (a fresh RSC payload for the root layout)
  // now reaches the header instead of being outlived by a stale snapshot. The
  // sign-out path below is unaffected — it hard-navigates, which replaces the
  // whole tree. A focus-time re-read is NOT possible from here: the session
  // cookie is HttpOnly and `/api/auth/app-session` exposes POST/DELETE only, so
  // polling it back would mean adding a session-read route (S12 backend scope).
  const sessionUser = initialSessionUser ?? null;
  const role = sessionUser?.role ?? "teacher";
  const navRole = role === "student" ? "student" : "teacher";
  const primaryNavItems = getNavItemsForRole(navRole);
  const userControlLabel =
    locale === "zh-CN"
      ? role === "student"
        ? "学生账号"
        : role === "admin"
          ? "管理员账号"
          : "教师账号"
      : role === "student"
        ? "Student"
        : role === "admin"
          ? "Admin"
          : "Teacher";
  // No session means no name. The header used to fall back to the demo personas
  // "Peter"/"Phoebe", so a visitor whose session had expired - or who had never
  // signed in - read a stranger's name in the account control and could
  // reasonably conclude they were logged in as someone. The only real identity
  // available without a session is none, so the ladder goes: the name the
  // session carries, then the account id behind it, then the neutral role label
  // the control is already announced with. Nothing here is ever invented.
  const accountDisplayName =
    sessionUser?.displayName?.trim() || sessionUser?.account?.trim() || userControlLabel;
  const userDisplayName =
    locale === "zh-CN" ? userControlLabel : accountDisplayName;
  const accountMenuCopy =
    locale === "zh-CN"
      ? {
          signedIn: "已登录",
          overview: "教学概览",
          shortcuts: "快捷入口",
          courses: `${teacherCourses.length} 门课程`,
          students: `${teacherCourses.reduce((total, course) => total + course.students, 0)} 名学生`,
          currentFocus: "当前重点",
          signOut: "退出账号",
        }
      : {
          signedIn: "Signed in",
          overview: "Teaching Overview",
          shortcuts: "Shortcuts",
          courses: `${teacherCourses.length} courses`,
          students: `${teacherCourses.reduce((total, course) => total + course.students, 0)} students`,
          currentFocus: "Current Focus",
          signOut: "Sign Out",
        };
  const featuredCourse = teacherCourses[0];
  const teacherShortcutItems = [
    {
      href: "/teaching",
      icon: <BookOpen size={17} weight="duotone" />,
      label: t.nav.teaching,
    },
    {
      href: getTeachingOperationHref("content"),
      icon: <BookOpen size={17} weight="duotone" />,
      label: localizedText(
        teacherSidebarItems.find((item) => item.id === "content")?.title ?? {
          "zh-CN": "课程内容",
          "en-US": "Course Content",
        },
        locale,
      ),
    },
    {
      href: getTeachingOperationHref("students"),
      icon: <UsersThree size={17} weight="duotone" />,
      label: localizedText(
        teacherSidebarItems.find((item) => item.id === "students")?.title ?? {
          "zh-CN": "学生管理",
          "en-US": "Student Management",
        },
        locale,
      ),
    },
    {
      href: getTeachingOperationHref("dashboard"),
      icon: <ChartBar size={17} weight="duotone" />,
      label: localizedText(
        teacherSidebarItems.find((item) => item.id === "dashboard")?.title ?? {
          "zh-CN": "数据看板",
          "en-US": "Data Dashboard",
        },
        locale,
      ),
    },
  ];

  useEffect(() => {
    if (!accountMenuOpen) {
      return undefined;
    }

    function handleDocumentPointerDown(event: MouseEvent) {
      if (
        accountMenuRef.current &&
        event.target instanceof Node &&
        !accountMenuRef.current.contains(event.target)
      ) {
        setAccountMenuOpen(false);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [accountMenuOpen]);

  async function signOut() {
    setAccountMenuOpen(false);
    try {
      await fetch("/api/auth/app-session", {
        method: "DELETE",
        credentials: "same-origin",
      });
    } catch {
      // A failed clear request must not trap the user inside the app: the hard
      // navigation below still leaves the authenticated surface.
    }
    // Hard navigation instead of router.replace: the /login request must be
    // issued only after the sign-out Set-Cookie response has been processed,
    // otherwise the proxy still sees a valid session and bounces the user back
    // to their role home. A full reload also resets client state and re-runs the
    // server layout, so the header is rebuilt from a freshly read cookie.
    window.location.assign("/login");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/92 backdrop-blur-xl">
      <div className="relative mx-auto flex min-h-[72px] w-full max-w-[1608px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Link
          href={getUaisHomeHrefForRole(role)}
          className="flex shrink-0 items-center gap-3 rounded-2xl px-1 py-2 text-[var(--foreground)] outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          aria-label="UAIS"
        >
          <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--accent)] text-white shadow-[0_12px_30px_var(--shadow-accent)]">
            <Sparkle size={22} weight="duotone" />
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-base font-semibold tracking-tight">UAIS</span>
            <span className="block text-xs text-[var(--muted)]">{t.brand.headerSubtitle}</span>
            <span className="sr-only">{t.brand.name}</span>
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="hidden min-w-0 items-center justify-center gap-8 overflow-x-auto md:absolute md:left-1/2 md:top-0 md:flex md:h-full md:-translate-x-1/2"
        >
          {primaryNavItems.map((item) => {
            const active =
              pathname === item.href ||
              pathname.startsWith(`${item.href}/`) ||
              (pathname === "/" && item.href === "/courses");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "relative flex h-[72px] items-center whitespace-nowrap px-1 text-base font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                  active ? "text-[var(--accent)]" : "text-[var(--foreground)] hover:text-[var(--accent)]",
                ].join(" ")}
              >
                {localizedText(item.label, locale)}
                {active ? (
                  <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-full bg-[var(--accent)]" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2 text-[var(--foreground)]">
          <button
            type="button"
            className="hidden h-10 items-center gap-2 rounded-full px-3 text-sm font-medium outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:inline-flex"
            aria-label={locale === "zh-CN" ? "日历" : "Calendar"}
          >
            <CalendarBlank size={19} weight="duotone" />
            <span className="hidden 2xl:inline">{locale === "zh-CN" ? "日历" : "Calendar"}</span>
          </button>
          <button
            type="button"
            className="hidden size-10 items-center justify-center rounded-full outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:inline-flex"
            aria-label={locale === "zh-CN" ? "通知" : "Notifications"}
          >
            <Bell size={19} weight="duotone" />
          </button>
          <button
            type="button"
            onClick={toggleLocale}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--foreground)] shadow-[0_8px_24px_var(--shadow)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label={t.controls.language}
          >
            <Translate size={18} weight="duotone" />
            <span className="hidden sm:inline">{locale === "zh-CN" ? "中文" : "EN"}</span>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex size-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-[0_8px_24px_var(--shadow)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label={t.controls.theme}
          >
            {theme === "dark" ? (
              <Sun size={18} weight="duotone" />
            ) : (
              <Moon size={18} weight="duotone" />
            )}
          </button>
          {/* Phone-width nav and sign-out. The desktop nav above and the account
              menu below are both hidden under `md`, so without this the header
              carried no route affordance and no way out of the app. */}
          <HeaderMobileMenu
            locale={locale}
            pathname={pathname}
            navItems={primaryNavItems}
            accountDisplayName={accountDisplayName}
            accountRoleLabel={userControlLabel}
            signOutLabel={accountMenuCopy.signOut}
            onSignOut={() => void signOut()}
          />
          <div ref={accountMenuRef} className="relative hidden md:block">
            <button
              type="button"
              onClick={() => setAccountMenuOpen((open) => !open)}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 pr-3 text-sm font-medium text-[var(--foreground)] shadow-[0_8px_24px_var(--shadow)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-controls="uais-account-menu"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              aria-label={userControlLabel}
            >
              <span className="grid size-8 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                <UserCircle size={20} weight="duotone" />
              </span>
              <span className="hidden text-left leading-tight lg:block">
                <span className="block text-sm font-semibold">
                  {userDisplayName}
                </span>
                <span className="block text-[11px] text-[var(--muted)]">
                  {userControlLabel}
                </span>
              </span>
              <CaretDown
                size={14}
                weight="bold"
                className={accountMenuOpen ? "rotate-180 transition" : "transition"}
              />
            </button>

            {accountMenuOpen ? (
              <div
                id="uais-account-menu"
                role="menu"
                aria-label={userControlLabel}
                className="absolute right-0 top-full z-50 mt-3 w-[336px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-[0_22px_60px_var(--shadow-strong)]"
              >
                <div className="border-b border-[var(--border)] p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                      <UserCircle size={26} weight="duotone" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold">
                        {accountDisplayName}
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                        <CheckCircle size={14} weight="duotone" className="text-[#16794c] dark:text-[#6fd3a5]" />
                        {accountMenuCopy.signedIn}
                      </span>
                    </span>
                  </div>
                </div>

                {role === "teacher" ? (
                  <div className="border-b border-[var(--border)] p-4">
                    <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                      {accountMenuCopy.overview}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <AccountMenuMetric>{accountMenuCopy.courses}</AccountMenuMetric>
                      <AccountMenuMetric>{accountMenuCopy.students}</AccountMenuMetric>
                    </div>
                    {featuredCourse ? (
                      <div className="mt-3 rounded-xl bg-[var(--surface-elevated)] p-3">
                        <p className="text-[11px] font-semibold text-[var(--muted)]">
                          {accountMenuCopy.currentFocus}
                        </p>
                        <p className="mt-1 text-sm font-semibold">
                          {localizedText(featuredCourse.title, locale)}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                          {localizedText(featuredCourse.currentFocus, locale)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {role === "teacher" ? (
                  <div className="border-b border-[var(--border)] p-2">
                    <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase text-[var(--muted)]">
                      {accountMenuCopy.shortcuts}
                    </p>
                    <div className="space-y-1">
                      {teacherShortcutItems.map((item) => (
                        <AccountMenuLink
                          key={item.href}
                          href={item.href}
                          icon={item.icon}
                          onClick={() => setAccountMenuOpen(false)}
                        >
                          {item.label}
                        </AccountMenuLink>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="p-2">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void signOut()}
                    className="flex h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold text-[var(--danger)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--danger)]"
                  >
                    <SignOut size={17} weight="duotone" />
                    {accountMenuCopy.signOut}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

function AccountMenuMetric({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold">
      {children}
    </span>
  );
}

function AccountMenuLink({
  children,
  href,
  icon,
  onClick,
}: {
  children: ReactNode;
  href: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      role="menuitem"
      href={href}
      onClick={onClick}
      className="flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <span className="grid size-7 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
        {icon}
      </span>
      {children}
    </Link>
  );
}
