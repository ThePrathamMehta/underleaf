"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { PublicUser } from "@repo/types";
import { api, ApiError } from "./api";

type AuthState = {
  user: PublicUser | null;
  /** True until the initial /auth/me check resolves, so guards don't flash. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Replaces the cached user after settings changes it, or clears it after the
   * account is deleted. Without this the header and account menu would keep
   * showing the old name until a full reload.
   */
  setUser: (user: PublicUser | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    api
      .me(controller.signal)
      .then(({ user: me }) => setUser(me))
      .catch((error) => {
        // A 401 is the normal signed-out case, not a failure worth surfacing.
        if (error instanceof DOMException && error.name === "AbortError") return;
        setUser(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: signedIn } = await api.login({ email, password });
    setUser(signedIn);
  }, []);

  const signup = useCallback(async (email: string, password: string, name: string) => {
    const { user: created } = await api.signup({ email, password, name });
    setUser(created);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (error) {
      // Clear locally regardless: a failed logout call shouldn't strand the user
      // in a session they've asked to end.
      if (!(error instanceof ApiError)) throw error;
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
