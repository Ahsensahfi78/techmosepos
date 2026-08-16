"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import {
  clearTokens,
  getAccessToken,
  saveTokens,
  saveUser,
} from "./auth";
import type { User } from "./types";

interface AuthContextValue {
  user: User | null;
  checking: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  checking: true,
  login: async () => {
    throw new Error("AuthProvider not mounted");
  },
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getAccessToken()) {
        setChecking(false);
        return;
      }
      try {
        const me = await api.auth.me();
        if (cancelled) return;
        setUser(me);
        saveUser(me);
      } catch {
        clearTokens();
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const tokens = await api.auth.login(username, password);
    saveTokens(tokens.access_token, tokens.refresh_token);
    const me = await api.auth.me();
    setUser(me);
    saveUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, checking, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
