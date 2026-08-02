/**
 * OAuth start — real TanStack API route (no SPA Not Found).
 * Production (Vercel): prefers native X/Google when env is set; falls back to
 * Grok broker. Always uses relative callback paths so trustedOrigins wildcards
 * accept them.
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
  // Vercel production / preview deployments
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
    const app = new URL(appOrigin);
    if (
      (isLoopback(ruUrl.hostname) && !isLoopback(app.hostname)) ||
      (!isLoopback(app.hostname) &&
        hostAllowed(app.hostname) &&
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
 * Map UI provider ids to the actual Better Auth provider:
 * - Native Twitter/Google when env is set (Vercel production)
 * - Grok broker ids otherwise (live preview)
 */
function resolveProvider(providerId: string): {
  id: string;
  kind: "social" | "oauth2";
} {
  const p = providerId.trim();
  if (p === "grok-x" || p === "twitter" || p === "x") {
    if (hasNativeTwitter) return { id: "twitter", kind: "social" };
    return { id: "grok-x", kind: "oauth2" };
  }
  if (p === "grok-google" || p === "google") {
    if (hasNativeGoogle) return { id: "google", kind: "social" };
    return { id: "grok-google", kind: "oauth2" };
  }
  return { id: p, kind: "oauth2" };
}

async function handleStart(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const providerId = url.searchParams.get("providerId")?.trim();
  const appOrigin = resolveAppOrigin(request, url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  if (!providerId) {
    return new Response("Missing providerId", { status: 400 });
  }

  const done = new URL(`${appOrigin}/api/oauth/done`);
  if (returnTo !== "/") done.searchParams.set("returnTo", returnTo);
  // Relative paths are always trusted by Better Auth (allowRelativePaths)
  const callbackURL = returnTo.startsWith("/") ? returnTo : "/";
  const errorCallbackURL = `/login?auth_error=oauth`;

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

  const resolved = resolveProvider(providerId);

  try {
    let apiRes: Response;

    if (resolved.kind === "social") {
      // Built-in Twitter / Google
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
      // Grok broker (preview) or generic OAuth2
      apiRes = await auth.api.signInWithOAuth2({
        body: {
          providerId: resolved.id,
          // Absolute done URL so mobile handoff lands on /api/oauth/done
          callbackURL: done.toString(),
          errorCallbackURL: `${appOrigin}/login?auth_error=oauth`,
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
          : (t || "oauth_init").slice(0, 100);
      return Response.redirect(
        `${appOrigin}/login?auth_error=${encodeURIComponent(msg)}`,
        302,
      );
    }

    const body = (await apiRes.json().catch(() => null)) as {
      url?: string;
      redirect?: boolean;
    } | null;
    let location = body?.url;
    if (!location) {
      return Response.redirect(
        `${appOrigin}/login?auth_error=missing_url`,
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
    return Response.redirect(
      `${appOrigin}/login?auth_error=${encodeURIComponent(raw.slice(0, 100))}`,
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
