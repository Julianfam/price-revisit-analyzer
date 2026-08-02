import { useEffect, useState } from "react";
import { authClient, authEnabled, getBearerToken } from "./client";

/** Normalized user shape used across the app, auth on or off. */
export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
  /** True when this is the sandbox/dev fallback (auth not configured). */
  isDevFallback: boolean;
};

/**
 * Stable fallback user, used ONLY when auth is explicitly disabled
 * (`VITE_AUTH_ENABLED=false`).
 */
export const DEV_USER: AppUser = {
  id: "dev-user",
  displayName: "Dev User",
  primaryEmail: "dev@example.com",
  profileImageUrl: null,
  isDevFallback: true,
};

/** Cached user so reload doesn't flash "guest / Free" while session loads. */
const USER_CACHE_KEY = "pra-user-cache-v1";

export function readCachedUser(): AppUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as AppUser;
    if (j?.id && !j.isDevFallback) return j;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeCachedUser(user: AppUser | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!user || user.isDevFallback) localStorage.removeItem(USER_CACHE_KEY);
    else localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

export type CurrentUserState = {
  user: AppUser | null;
  isPending: boolean;
};

/**
 * Current user + loading state.
 * With bearer + cache → show instantly (no 4–10s Free flash).
 */
export function useCurrentUserState(): CurrentUserState {
  if (!authEnabled) return { user: DEV_USER, isPending: false };

  // eslint-disable-next-line react-hooks/rules-of-hooks -- authEnabled is constant
  const { data, isPending: sessionPending } = authClient.useSession();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [cache] = useState(() => readCachedUser());
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [bootPending, setBootPending] = useState(() => {
    if (typeof window === "undefined") return true;
    // Instant if we already have cached user + token
    if (getBearerToken() && readCachedUser()) return false;
    return !!getBearerToken() || true; // short boot only
  });

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    // Cap pending at 1.2s — was 4s and felt like 5–10s login
    const t = window.setTimeout(() => setBootPending(false), 1200);
    return () => window.clearTimeout(t);
  }, []);

  const sessionUser = data?.user;
  const mapped: AppUser | null = sessionUser
    ? {
        id: sessionUser.id,
        displayName: sessionUser.name ?? null,
        primaryEmail: sessionUser.email ?? null,
        profileImageUrl: sessionUser.image ?? null,
        isDevFallback: false,
      }
    : null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (mapped) writeCachedUser(mapped);
  }, [mapped?.id, mapped?.displayName, mapped?.primaryEmail]);

  const hasBearer =
    typeof window !== "undefined" ? !!getBearerToken() : false;

  if (mapped) {
    return { user: mapped, isPending: false };
  }

  // Optimistic: bearer + cache → treat as signed in immediately
  if (hasBearer && cache) {
    return {
      user: cache,
      isPending: sessionPending && bootPending,
    };
  }

  if (sessionPending || (bootPending && hasBearer)) {
    return { user: cache, isPending: true };
  }

  if (!hasBearer && cache) {
    queueMicrotask(() => writeCachedUser(null));
  }

  return { user: null, isPending: false };
}

export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
