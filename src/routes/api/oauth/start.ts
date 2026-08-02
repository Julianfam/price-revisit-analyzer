/**
 * OAuth start — real TanStack API route (no SPA Not Found).
 *
 * Preview (*.grok-sandbox.com): Grok broker (grok-x / grok-google).
 * Vercel production: native Twitter/Google ONLY when env is set.
 * Never start Grok broker on vercel.app — it always returns
 * "Invalid redirect URI" (preview client only allows *.grok-sandbox.com).
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  auth,
  hasNativeGoogle,
  hasNativeTwitter,
} from "@/lib/auth/server";
import { PREVIEW_ALLOWED_HOSTS } from "@/lib/auth/preview";

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "[::1]" ||
    h.endsWith(".localhost")
  ) {
    return true;
  }
  if (h.endsWith(".vercel.app") || h === "vercel.app") return true;
  for (const pattern of PREVIEW_ALLOWED_HOSTS) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      if (h.endsWith(suffix) || h === pattern.slice(2)) return true;
    } else if (h === pattern) {
      return true;
    }
  }
  if (h.endsWith(".grok.me") || h === "grok.me") return true;
  if (h.endsWith(".grok-sandbox.com")) return true;
  return false;
}

function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "[::1]" ||
    h.endsWith(".localhost")
  );
}

function isPreviewHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h.endsWith(".grok-sandbox.com") ||
    h.endsWith(".grok.me") ||
    isLoopback(h)
  );
}

function resolveAppOrigin(request: Request, url: URL): string {
  const raw = url.searchParams.get("appOrigin")?.trim();
  if (raw) {
    try {
      const o = new URL(raw);
      if (
        (o.protocol === "https:" || o.protocol === "http:") &&
        hostAllowed(o.hostname)
      ) {
        if (!isLoopback(o.hostname) && o.protocol !== "https:") {
          return `https://${o.host}`;
        }
        return o.origin;
      }
    } catch {
      /* fall through */
    }
  }
  const xfHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.split(",")[0]?.trim();
  const xfProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  if (xfHost) {
    const hostOnly = xfHost.split(":")[0] ?? xfHost;
    if (hostAllowed(hostOnly)) {
      const proto = isLoopback(hostOnly) ? xfProto || "http" : "https";
      return `${proto}://${xfHost}`;
    }
  }
  return url.origin;
}

function fixRedirectUri(location: string, appOrigin: string): string {
  try {
    const loc = new URL(location);
    const ru = loc.searchParams.get("redirect_uri");
    if (!ru) return location;
    const ruUrl = new URL(ru);
    if (
      (isLoopback(ruUrl.hostname) && !isLoopback(new URL(appOrigin).hostname)) ||
      (!isLoopback(new URL(appOrigin).hostname) &&
        hostAllowed(new URL(appOrigin).hostname) &&
        ruUrl.origin !== appOrigin)
    ) {
      loc.searchParams.set(
        "redirect_uri",
        `${appOrigin}${ruUrl.pathname}${ruUrl.search}`,
      );
      return loc.toString();
    }
  } catch {
    /* leave */
  }
  return location;
}

function safeReturnTo(raw: string | null): string {
  if (!raw) return "/";
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("://")) {
    return raw.slice(0, 512);
  }
  return "/";
}

/**
 * Map UI provider ids → Better Auth provider + kind.
 * On Vercel without native keys, refuse Grok (Invalid redirect URI).
 */
function resolveProvider(
  providerId: string,
  hostname: string,
): {
  id: string;
  kind: "social" | "oauth2" | "blocked";
  reason?: string;
} {
  const p = providerId.trim().toLowerCase();
  const preview = isPreviewHost(hostname);
  const wantsX = p === "grok-x" || p === "twitter" || p === "x";
  const wantsGoogle = p === "grok-google" || p === "google";

  if (wantsX) {
    if (hasNativeTwitter) return { id: "twitter", kind: "social" };
    if (preview) return { id: "grok-x", kind: "oauth2" };
    return {
      id: "twitter",
      kind: "blocked",
      reason: "need_twitter_keys",
    };
  }
  if (wantsGoogle) {
    if (hasNativeGoogle) return { id: "google", kind: "social" };
    if (preview) return { id: "grok-google", kind: "oauth2" };
    return {
      id: "google",
      kind: "blocked",
      reason: "need_google_keys",
    };
  }
  if (preview) return { id: providerId.trim(), kind: "oauth2" };
  return {
    id: providerId.trim(),
    kind: "blocked",
    reason: "provider_unavailable",
  };
}

async function handleStart(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const providerId = url.searchParams.get("providerId")?.trim();
  const appOrigin = resolveAppOrigin(request, url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const hostname = new URL(appOrigin).hostname;

  if (!providerId) {
    return new Response("Missing providerId", { status: 400 });
  }

  const resolved = resolveProvider(providerId, hostname);

  if (resolved.kind === "blocked") {
    const msg =
      resolved.reason === "need_twitter_keys"
        ? "need_twitter_keys"
        : resolved.reason === "need_google_keys"
          ? "need_google_keys"
          : "oauth_unavailable";
    return Response.redirect(
      `${appOrigin}/login?auth_error=${encodeURIComponent(msg)}&mail=1`,
      302,
    );
  }

  const done = new URL(`${appOrigin}/api/oauth/done`);
  if (returnTo !== "/") done.searchParams.set("returnTo", returnTo);

  // Relative paths always pass Better Auth origin checks
  const callbackURL =
    resolved.kind === "social"
      ? returnTo.startsWith("/")
        ? returnTo
        : "/"
      : done.toString();
  const errorCallbackURL =
    resolved.kind === "social"
      ? `/login?auth_error=oauth`
      : `${appOrigin}/login?auth_error=oauth`;

  const authHeaders = new Headers(request.headers);
  try {
    const o = new URL(appOrigin);
    authHeaders.set("host", o.host);
    authHeaders.set("x-forwarded-host", o.host);
    authHeaders.set("x-forwarded-proto", o.protocol.replace(":", ""));
    authHeaders.set("origin", appOrigin);
  } catch {
    /* keep */
  }

  try {
    let apiRes: Response;

    if (resolved.kind === "social") {
      apiRes = await auth.api.signInSocial({
        body: {
          provider: resolved.id as "twitter" | "google",
          callbackURL,
          errorCallbackURL,
        },
        headers: authHeaders,
        asResponse: true,
      });
    } else {
      apiRes = await auth.api.signInWithOAuth2({
        body: {
          providerId: resolved.id,
          callbackURL,
          errorCallbackURL,
        },
        headers: authHeaders,
        asResponse: true,
      });
    }

    if (!apiRes.ok) {
      const t = await apiRes.text().catch(() => "");
      console.error(
        "[oauth/start] oauth init not ok",
        apiRes.status,
        resolved,
        t.slice(0, 300),
      );
      const msg =
        apiRes.status === 429
          ? "too_many_requests"
          : /invalid redirect/i.test(t)
            ? "invalid_redirect_uri"
            : (t || "oauth_init").slice(0, 100);
      return Response.redirect(
        `${appOrigin}/login?auth_error=${encodeURIComponent(msg)}&mail=1`,
        302,
      );
    }

    const body = (await apiRes.json().catch(() => null)) as {
      url?: string;
    } | null;
    let location = body?.url;
    if (!location) {
      return Response.redirect(
        `${appOrigin}/login?auth_error=missing_url&mail=1`,
        302,
      );
    }

    location = fixRedirectUri(location, appOrigin);

    const headers = new Headers({
      location,
      "cache-control": "no-store",
    });
    for (const cookie of apiRes.headers.getSetCookie()) {
      headers.append("set-cookie", cookie);
    }
    return new Response(null, { status: 302, headers });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "oauth_threw";
    console.error("[oauth/start] error", raw);
    const msg = /invalid redirect/i.test(raw)
      ? "invalid_redirect_uri"
      : raw.slice(0, 100);
    return Response.redirect(
      `${appOrigin}/login?auth_error=${encodeURIComponent(msg)}&mail=1`,
      302,
    );
  }
}

export const Route = createFileRoute("/api/oauth/start")({
  server: {
    handlers: {
      GET: ({ request }) => handleStart(request),
    },
  },
});
