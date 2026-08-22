"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/layout/header";
import { useAppPreferences } from "@/components/providers/app-preferences";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";

const standaloneRoutes = new Set(["/login", "/terms", "/privacy"]);

export function AppShell({
  children,
  initialSessionUser,
}: {
  children: ReactNode;
  initialSessionUser?: UaisAppSessionUser | null;
}) {
  const pathname = usePathname();
  const { locale } = useAppPreferences();

  if (standaloneRoutes.has(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] bg-[var(--background)] text-[var(--foreground)]">
      <a
        href="#uais-main-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-[var(--foreground)] px-4 py-3 text-sm font-semibold text-[var(--background)] shadow-lg outline-none transition focus:translate-y-0 focus:ring-2 focus:ring-[var(--accent)]"
      >
        {locale === "zh-CN" ? "跳到主要内容" : "Skip to main content"}
      </a>
      <Header initialSessionUser={initialSessionUser} />
      <main
        id="uais-main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl px-4 py-6 outline-none sm:px-6 lg:px-8"
      >
        {children}
      </main>
    </div>
  );
}
