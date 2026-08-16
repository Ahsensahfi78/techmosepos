import type { User } from "./types";

const ACCESS_KEY = "shoplypos.access";
const REFRESH_KEY = "shoplypos.refresh";
const USER_KEY = "shoplypos.user";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function getAccessToken(): string | null {
  return storage()?.getItem(ACCESS_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return storage()?.getItem(REFRESH_KEY) ?? null;
}

export function saveTokens(accessToken: string, refreshToken: string): void {
  const s = storage();
  if (!s) return;
  s.setItem(ACCESS_KEY, accessToken);
  s.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens(): void {
  const s = storage();
  if (!s) return;
  s.removeItem(ACCESS_KEY);
  s.removeItem(REFRESH_KEY);
  s.removeItem(USER_KEY);
}

export function saveUser(user: User): void {
  storage()?.setItem(USER_KEY, JSON.stringify(user));
}

export function getCachedUser(): User | null {
  const raw = storage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}
