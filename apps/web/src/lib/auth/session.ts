"use client";

import { useEffect, useState } from "react";

export type SessionUser = { id: string; email: string; role: "ADMIN" | "CUSTOMER"; emailVerified?: boolean };

export function useSessionUser() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  useEffect(() => {
    const load = () => fetch("/api/auth/session")
      .then((response) => response.ok ? response.json() : null)
      .then((value) => setUser(value?.user ?? null))
      .catch(() => setUser(null));
    void load();
    window.addEventListener("saga-auth-change", load);
    return () => window.removeEventListener("saga-auth-change", load);
  }, []);
  return user;
}
