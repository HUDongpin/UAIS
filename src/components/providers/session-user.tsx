"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";

const SessionUserContext = createContext<UaisAppSessionUser | null>(null);

export function SessionUserProvider({
  children,
  initialSessionUser,
}: {
  children: ReactNode;
  initialSessionUser?: UaisAppSessionUser | null;
}) {
  // Frozen from the server-resolved cookie value for the lifetime of the
  // render tree, mirroring how the header consumes `initialSessionUser`.
  // Sign-in/sign-out both hard-navigate, so a fresh server render reseeds it.
  const [sessionUser] = useState(() => initialSessionUser ?? null);

  return (
    <SessionUserContext.Provider value={sessionUser}>
      {children}
    </SessionUserContext.Provider>
  );
}

export function useSessionUser(): UaisAppSessionUser | null {
  // Null (not a throw) when no provider is mounted: consumers treat "unknown
  // session" the same as "signed out" and simply skip learner-only behavior.
  return useContext(SessionUserContext);
}
