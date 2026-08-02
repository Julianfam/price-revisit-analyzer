/**
 * Browser auth client.
 *
 * Desktop live preview: /auth/popup (Vite plugin) popup + bearer postMessage.
 * Mobile + production Vercel: window.location → /api/oauth/start → provider
 *   → callback (native X/Google or Grok broker).
 */
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { GROK_PROVIDERS } from "./providers";

const BEARER_KEY = "grok-auth.bearer-token";

function storeBearer(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(BEARER_KEY, token);
    else window.sessionStorage.removeItem(BEARER_KEY);
  } catch {
    /* ignore */
  }
  try {
    if (token) window.localStorage.setItem(BEARER_KEY, token);
    else window.localStorage.removeItem(BEARER_KEY);
  } catch {
    /* ignore */
  }
}

export function getBearerToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const s = window.sessionStorage.getItem(BEARER_KEY);
    if (s) return s;
  } catch {
    /* ignore */
  }
  try {
    const l = window.localStorage.getItem(BEARER_KEY);
    if (l) {
      try {
        window.sessionStorage.setItem(BEARER_KEY, l);
      } catch {
        /* ignore */
      }
      return l;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
  fetchOptions: {
    onRequest(ctx) {
      const token = getBearerToken();
      if (token) ctx.headers.set("Authorization", `Bearer ${token}`);
      return ctx;
    },
    onSuccess(ctx) {
      try {
        const h = ctx.response?.headers;
        if (!h) return;
        const token = h.get("set-auth-token") || h.get("Set-Auth-Token");
        if (token?.trim()) storeBearer(token.trim());
      } catch {
        /* ignore */
      }
    },
  },
});

export const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

export { GROK_PROVIDERS };

function inLivePreview(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h.endsWith(".grok-sandbox.com") ||
    h.endsWith(".grok.me") ||
    h === "localhost" ||
    h === "127.0.0.1"
  );
}

/** Production / staging hosts where popup OAuth is unreliable. */
function isDeployedHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h.endsWith(".vercel.app") ||
    h.endsWith(".now.sh") ||
    (!inLivePreview() && h !== "localhost" && h !== "127.0.0.1")
  );
}

export function isMobileClient(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  try {
    const ua = navigator.userAgent || "";
    if (
      /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini|CriOS|FxiOS|SamsungBrowser|Brave/i.test(
        ua,
      )
    ) {
      return true;
    }
    if (window.matchMedia("(max-width: 820px) and (pointer: coarse)").matches) {
      return true;
    }
    if (
      window.self !== window.top &&
      window.innerWidth < 900 &&
      navigator.maxTouchPoints > 0
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

type PopupMessage = {
  source: "grok-auth-popup";
  token: string | null;
  error?: string;
};

export function buildAuthPopupUrl(
  providerId: string,
  mode: "popup" | "page",
  returnTo = "/",
): string {
  const origin = window.location.origin;
  const q = new URLSearchParams({
    providerId,
    mode,
    returnTo:
      returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/",
    appOrigin: origin,
  });
  return `${origin}/auth/popup?${q.toString()}`;
}

/** Real API route — always exists (mobile + Vercel safe, no Not Found). */
export function buildMobileOAuthStartUrl(
  providerId: string,
  returnTo = "/",
): string {
  const origin = window.location.origin;
  const q = new URLSearchParams({
    providerId,
    returnTo:
      returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/",
    appOrigin: origin,
  });
  return `${origin}/api/oauth/start?${q.toString()}`;
}

function waitForAuthResult(
  popup: Window | null,
  timeoutMs = 5 * 60 * 1000,
): Promise<{ token: string | null; error?: string }> {
  return new Promise((resolve) => {
    const origin = window.location.origin;
    let settled = false;
    let closeTimer: number | undefined;
    let timeoutTimer: number | undefined;

    const settle = (token: string | null, error?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ token, error });
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin && event.origin !== "null") return;
      const data = event.data as PopupMessage | undefined;
      if (!data || data.source !== "grok-auth-popup") return;
      settle(data.token ?? null, data.error);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== BEARER_KEY || !event.newValue) return;
      settle(event.newValue);
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("grok-auth");
      bc.onmessage = (event) => {
        const data = event.data as PopupMessage | undefined;
        if (!data || data.source !== "grok-auth-popup") return;
        settle(data.token ?? null, data.error);
      };
    } catch {
      bc = null;
    }

    const pollTimer = window.setInterval(() => {
      const t = getBearerToken();
      if (t) {
        settle(t);
        return;
      }
      if (!popup || !popup.closed) return;
      window.clearInterval(pollTimer);
      closeTimer = window.setTimeout(() => {
        const again = getBearerToken();
        if (again) settle(again);
        else settle(null, "popup_closed");
      }, 800);
    }, 300);

    timeoutTimer = window.setTimeout(() => {
      settle(null, "timeout");
    }, timeoutMs);

    function cleanup() {
      window.clearInterval(pollTimer);
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
      if (timeoutTimer !== undefined) window.clearTimeout(timeoutTimer);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
      try {
        bc?.close();
      } catch {
        /* ignore */
      }
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
  });
}

async function applyTokenAndGo(
  token: string,
  callbackURL: string,
): Promise<void> {
  storeBearer(token);
  try {
    await authClient.getSession();
  } catch {
    /* ignore */
  }
  window.location.assign(
    callbackURL.startsWith("/") && !callbackURL.startsWith("//")
      ? callbackURL
      : "/",
  );
}

/**
 * Sign in with X / Google. Call from a click handler (sync open first).
 *
 * Production (Vercel): always full-page /api/oauth/start — avoids Invalid origin
 * from client POST and survives in-app browsers better.
 */
export async function signIn(
  providerId: string,
  opts: { callbackURL?: string; errorCallbackURL?: string } = {},
): Promise<void> {
  const callbackURL = opts.callbackURL ?? "/";
  storeBearer(null);

  // Production Vercel / any non-preview host: same-frame OAuth start
  if (isDeployedHost() || isMobileClient()) {
    const url = buildMobileOAuthStartUrl(providerId, callbackURL);
    window.location.assign(url);
    return new Promise(() => undefined);
  }

  if (inLivePreview()) {
    // Desktop live preview: popup
    const url = buildAuthPopupUrl(providerId, "popup", callbackURL);
    const popup = window.open(
      url,
      `grok-signin-${providerId}`,
      "popup,width=520,height=720",
    );

    if (popup) {
      try {
        popup.focus();
      } catch {
        /* ignore */
      }
      const result = await waitForAuthResult(popup);
      if (result.token) {
        await applyTokenAndGo(result.token, callbackURL);
        return;
      }
      if (result.error && result.error !== "popup_closed") {
        throw new Error(`Sign-in failed: ${result.error}`);
      }
    }

    window.location.assign(
      buildAuthPopupUrl(providerId, "page", callbackURL),
    );
    return new Promise(() => undefined);
  }

  // Fallback: relative callbackURL (always trusted)
  const { data, error } = await authClient.signIn.oauth2({
    providerId,
    callbackURL:
      callbackURL.startsWith("/") && !callbackURL.startsWith("//")
        ? callbackURL
        : "/",
    errorCallbackURL: opts.errorCallbackURL ?? "/login",
  });
  if (error) {
    const msg = error.message ?? "Sign-in failed";
    if (/too many|rate.?limit|429/i.test(msg)) {
      throw new Error(
        "Too many sign-in attempts. Wait ~1 minute and try again.",
      );
    }
    if (/invalid origin|forbidden|invalid callback/i.test(msg)) {
      throw new Error(
        "Auth origin misconfigured. Use /api/oauth/start or set BETTER_AUTH_URL.",
      );
    }
    throw new Error(msg);
  }
  if (data?.url) {
    window.location.assign(data.url);
    return new Promise(() => undefined);
  }
  throw new Error("Sign-in failed: no redirect URL");
}

export async function captureSessionBearer(): Promise<void> {
  try {
    await authClient.getSession();
  } catch {
    /* ignore */
  }
  if (getBearerToken()) return;
  try {
    const res = await fetch("/api/auth/get-session", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const token =
      res.headers.get("set-auth-token") || res.headers.get("Set-Auth-Token");
    if (token?.trim()) storeBearer(token.trim());
  } catch {
    /* ignore */
  }
}

/** Fallback if user lands on /login?auth_done=1 (legacy). */
export async function finishMobileAuthReturn(
  returnTo = "/",
): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    await captureSessionBearer();
    try {
      const { data } = await authClient.getSession();
      if (data?.user || getBearerToken()) {
        const dest =
          returnTo.startsWith("/") && !returnTo.startsWith("//")
            ? returnTo
            : "/";
        window.location.replace(dest);
        return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

/** Listen for late auth handoffs (storage / BroadcastChannel) while on login. */
export function watchAuthHandoff(
  onToken: (token: string) => void,
): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === BEARER_KEY && event.newValue) onToken(event.newValue);
  };
  window.addEventListener("storage", onStorage);

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel("grok-auth");
    bc.onmessage = (event) => {
      const data = event.data as PopupMessage | undefined;
      if (data?.source === "grok-auth-popup" && data.token) onToken(data.token);
    };
  } catch {
    bc = null;
  }

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data as PopupMessage | undefined;
    if (data?.source === "grok-auth-popup" && data.token) onToken(data.token);
  };
  window.addEventListener("message", onMessage);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("message", onMessage);
    try {
      bc?.close();
    } catch {
      /* ignore */
    }
  };
}

export async function signOut(redirectTo = "/"): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    storeBearer(null);
  }
  window.location.href = redirectTo;
}
