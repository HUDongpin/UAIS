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
  const [sessionUser] = useState(() => initialSessionUser ?? null);
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
  const defaultAccountDisplayName =
    role === "student" ? "Peter" : role === "admin" ? "Admin" : "Phoebe";
  const accountDisplayName = sessionUser?.displayName ?? defaultAccountDisplayName;
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
    // to their role home. A full reload also resets client state, including the
    // `sessionUser` snapshot frozen in this component.
    window.location.assign("/login");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[#e6eaf2] bg-white/92 backdrop-blur-xl">
      <div className="relative mx-auto flex min-h-[72px] w-full max-w-[1608px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Link
          href={getUaisHomeHrefForRole(role)}
          className="flex shrink-0 items-center gap-3 rounded-2xl px-1 py-2 text-[#141833] outline-none transition focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
          aria-label="UAIS"
        >
          <span className="flex size-10 items-center justify-center rounded-2xl bg-[#1f6ff2] text-white shadow-[0_12px_30px_rgba(31,111,242,0.2)]">
            <Sparkle size={22} weight="duotone" />
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-base font-semibold tracking-tight">UAIS</span>
            <span className="block text-xs text-[#5e6680]">{t.brand.headerSubtitle}</span>
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
                  "relative flex h-[72px] items-center whitespace-nowrap px-1 text-base font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#1f6feb]",
                  active ? "text-[#1f6feb]" : "text-[#303650] hover:text-[#1f6feb]",
                ].join(" ")}
              >
                {localizedText(item.label, locale)}
                {active ? (
                  <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-full bg-[#1f6feb]" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2 text-[#202640]">
          <button
            type="button"
            className="hidden h-10 items-center gap-2 rounded-full px-3 text-sm font-medium outline-none transition hover:bg-[#f4f6fb] focus-visible:ring-2 focus-visible:ring-[#1f6feb] lg:inline-flex"
            aria-label={locale === "zh-CN" ? "日历" : "Calendar"}
          >
            <CalendarBlank size={19} weight="duotone" />
            <span className="hidden 2xl:inline">{locale === "zh-CN" ? "日历" : "Calendar"}</span>
          </button>
          <button
            type="button"
            className="hidden size-10 items-center justify-center rounded-full outline-none transition hover:bg-[#f4f6fb] focus-visible:ring-2 focus-visible:ring-[#1f6feb] md:inline-flex"
            aria-label={locale === "zh-CN" ? "通知" : "Notifications"}
          >
            <Bell size={19} weight="duotone" />
          </button>
          <button
            type="button"
            onClick={toggleLocale}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-[#dde3ee] bg-white px-3 text-sm font-medium text-[#202640] shadow-[0_8px_24px_rgba(46,58,91,0.06)] outline-none transition hover:bg-[#f4f6fb] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
            aria-label={t.controls.language}
          >
            <Translate size={18} weight="duotone" />
            <span className="hidden sm:inline">{locale === "zh-CN" ? "中文" : "EN"}</span>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex size-10 items-center justify-center rounded-full border border-[#dde3ee] bg-white text-[#202640] shadow-[0_8px_24px_rgba(46,58,91,0.06)] outline-none transition hover:bg-[#f4f6fb] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
            aria-label={t.controls.theme}
          >
            {theme === "dark" ? (
              <Sun size={18} weight="duotone" />
            ) : (
              <Moon size={18} weight="duotone" />
            )}
          </button>
          <div ref={accountMenuRef} className="relative hidden md:block">
            <button
              type="button"
              onClick={() => setAccountMenuOpen((open) => !open)}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-[#dde3ee] bg-white px-2.5 pr-3 text-sm font-medium text-[#202640] shadow-[0_8px_24px_rgba(46,58,91,0.06)] outline-none transition hover:bg-[#f4f6fb] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
              aria-controls="uais-account-menu"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              aria-label={userControlLabel}
            >
              <span className="grid size-8 place-items-center rounded-full bg-[#e9efff] text-[#2a61d8]">
                <UserCircle size={20} weight="duotone" />
              </span>
              <span className="hidden text-left leading-tight lg:block">
                <span className="block text-sm font-semibold">
                  {userDisplayName}
                </span>
                <span className="block text-[11px] text-[#697089]">
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
                className="absolute right-0 top-full z-50 mt-3 w-[336px] overflow-hidden rounded-2xl border border-[#d9e1ef] bg-white text-[#202640] shadow-[0_22px_60px_rgba(38,48,74,0.18)]"
              >
                <div className="border-b border-[#edf1f7] p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-2xl bg-[#e9efff] text-[#2a61d8]">
                      <UserCircle size={26} weight="duotone" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold">
                        {accountDisplayName}
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[#59647d]">
                        <CheckCircle size={14} weight="duotone" className="text-[#16794c]" />
                        {accountMenuCopy.signedIn}
                      </span>
                    </span>
                  </div>
                </div>

                {role === "teacher" ? (
                  <div className="border-b border-[#edf1f7] p-4">
                    <p className="text-xs font-semibold uppercase text-[#697089]">
                      {accountMenuCopy.overview}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <AccountMenuMetric>{accountMenuCopy.courses}</AccountMenuMetric>
                      <AccountMenuMetric>{accountMenuCopy.students}</AccountMenuMetric>
                    </div>
                    {featuredCourse ? (
                      <div className="mt-3 rounded-xl bg-[#f6f8fc] p-3">
                        <p className="text-[11px] font-semibold text-[#697089]">
                          {accountMenuCopy.currentFocus}
                        </p>
                        <p className="mt-1 text-sm font-semibold">
                          {localizedText(featuredCourse.title, locale)}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[#59647d]">
                          {localizedText(featuredCourse.currentFocus, locale)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {role === "teacher" ? (
                  <div className="border-b border-[#edf1f7] p-2">
                    <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase text-[#697089]">
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
                    className="flex h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold text-[#b42318] outline-none transition hover:bg-[#fff1f0] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#b42318]"
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
    <span className="rounded-xl border border-[#e3e8f2] bg-white px-3 py-2 text-sm font-semibold">
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
      className="flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold outline-none transition hover:bg-[#f4f6fb] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
    >
      <span className="grid size-7 place-items-center rounded-lg bg-[#edf3ff] text-[#2a61d8]">
        {icon}
      </span>
      {children}
    </Link>
  );
}
