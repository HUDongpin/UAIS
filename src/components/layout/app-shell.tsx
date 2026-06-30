"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/layout/header";
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

  if (standaloneRoutes.has(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] bg-[var(--background)] text-[var(--foreground)]">
      <Header initialSessionUser={initialSessionUser} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
