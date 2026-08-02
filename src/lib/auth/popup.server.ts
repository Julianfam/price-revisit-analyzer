/**
 * Live-preview OAuth popup/page bridge (Vite authPopupPlugin only).
 * mode=popup → postMessage + close
 * mode=page  → store bearer + redirect (mobile / full page)
 */
import { auth, SESSION_TOKEN_COOKIE } from "./server";
import { PREVIEW_ALLOWED_HOSTS } from "./preview";

type PopupMessage = {
  source: "grok-auth-popup";
  token: string | null;
  error?: string;
};

function safeReturnTo(raw: string | null): string {
  if (!raw) return "/";
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("://")) {
    return raw.slice(0, 512);
  }
  return "/";
}

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

function fixAuthorizeRedirectUri(location: string, appOrigin: string): string {
  try {
    const loc = new URL(location);
    const ru = loc.searchParams.get("redirect_uri");
    if (!ru) return location;
    const ruUrl = new URL(ru);
    const app = new URL(appOrigin);
    if (isLoopback(ruUrl.hostname) && !isLoopback(app.hostname)) {
      loc.searchParams.set(
        "redirect_uri",
        `${appOrigin}${ruUrl.pathname}${ruUrl.search}`,
      );
      return loc.toString();
    }
    if (
      !isLoopback(app.hostname) &&
      hostAllowed(app.hostname) &&
      ruUrl.origin !== appOrigin
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

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function readSessionToken(request: Request): string | null {
  for (const name of [
    SESSION_TOKEN_COOKIE,
    "__Host-grok-auth.session_token",
    "grok-auth.session_token",
    "__Secure-better-auth.session_token",
    "__Host-better-auth.session_token",
    "better-auth.session_token",
  ]) {
    const v = readCookie(request, name);
    if (v) return v;
  }
  return null;
}

export async function handleAuthPopupRequest(
  request: Request,
): Promise<Response> {
  // Auth uses memory adapter in preview — no PGLite warm-up.
  const url = new URL(request.url);
  const done = url.searchParams.get("done") === "1";
  const mode = url.searchParams.get("mode") === "page" ? "page" : "popup";
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const appOrigin = resolveAppOrigin(request, url);

  if (done) {
    const errored = url.searchParams.has("error");
    let token: string | null = null;
    if (!errored) {
      token = readSessionToken(request);
      if (!token) {
        try {
          const session = await auth.api.getSession({
            headers: request.headers,
          });
          const s = session as { session?: { token?: string } } | null;
          if (s?.session?.token) token = s.session.token;
        } catch {
          /* ignore */
        }
      }
    }
    const message: PopupMessage = {
      source: "grok-auth-popup",
      token,
      ...(errored || !token
        ? {
            error: errored
              ? (url.searchParams.get("error") ?? "sign_in_failed")
              : "no_session",
          }
        : {}),
    };
    return new Response(completionHtml(message, mode, returnTo, appOrigin), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const providerId = url.searchParams.get("providerId")?.trim();
  if (!providerId) {
    return new Response("Missing providerId", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const backParams = new URLSearchParams({
    done: "1",
    mode,
    appOrigin,
  });
  if (returnTo !== "/") backParams.set("returnTo", returnTo);
  const back = `${appOrigin}/auth/popup?${backParams.toString()}`;
  const errBack = `${back}&error=1`;

  const authHeaders = new Headers(request.headers);
  try {
    const originUrl = new URL(appOrigin);
    authHeaders.set("host", originUrl.host);
    authHeaders.set("x-forwarded-host", originUrl.host);
    authHeaders.set("x-forwarded-proto", originUrl.protocol.replace(":", ""));
    authHeaders.set("origin", appOrigin);
  } catch {
    /* keep */
  }

  try {
    const apiRes = await auth.api.signInWithOAuth2({
      body: {
        providerId,
        callbackURL: back,
        errorCallbackURL: errBack,
      },
      headers: authHeaders,
      asResponse: true,
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text().catch(() => "");
      return failHtml(
        detail || `oauth_init_${apiRes.status}`,
        mode,
        returnTo,
        appOrigin,
      );
    }

    const body = (await apiRes.json().catch(() => null)) as {
      url?: string;
    } | null;
    let location = body?.url;
    if (!location) {
      return failHtml("oauth_init_missing_url", mode, returnTo, appOrigin);
    }

    location = fixAuthorizeRedirectUri(location, appOrigin);

    const headers = new Headers({ location, "cache-control": "no-store" });
    for (const cookie of apiRes.headers.getSetCookie()) {
      headers.append("set-cookie", cookie);
    }
    return new Response(null, { status: 302, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_init_threw";
    return failHtml(message, mode, returnTo, appOrigin);
  }
}

function failHtml(
  error: string,
  mode: "popup" | "page",
  returnTo: string,
  appOrigin: string,
): Response {
  return new Response(
    completionHtml(
      { source: "grok-auth-popup", token: null, error },
      mode,
      returnTo,
      appOrigin,
    ),
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

function completionHtml(
  message: PopupMessage,
  mode: "popup" | "page",
  returnTo: string,
  appOrigin: string,
): string {
  const payload = JSON.stringify(message).replace(/</g, "\\u003c");
  const safeReturn = JSON.stringify(returnTo);
  const safeOrigin = JSON.stringify(appOrigin);
  const pageMode = mode === "page";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>Signing in…</title>
<style>
html,body{margin:0;min-height:100%;background:#0b0b0c;color:#a1a1aa;
font:15px/1.5 system-ui,sans-serif}
main{min-height:100dvh;display:grid;place-items:center;padding:1.5rem;text-align:center}
.err{color:#f87171;max-width:22rem;margin-top:.5rem;word-break:break-word}
a,button{color:#042f2e;background:#2dd4bf;border:0;border-radius:8px;
padding:12px 18px;font:600 14px/1.2 inherit;text-decoration:none;display:inline-block;margin-top:12px;cursor:pointer}
</style>
</head>
<body>
<main>
  <div>
    <p id="status">Signing you in…</p>
    <p id="hint" class="err" style="display:none"></p>
    <a id="btn" href="/" style="display:none">Continue</a>
  </div>
</main>
<script type="application/json" id="msg">${payload}</script>
<script>
(function () {
  var KEY = "grok-auth.bearer-token";
  var PAGE = ${pageMode ? "true" : "false"};
  var RETURN_TO = ${safeReturn};
  var APP_ORIGIN = ${safeOrigin};
  var el = document.getElementById("msg");
  var msg = { source: "grok-auth-popup", token: null };
  try { if (el && el.textContent) msg = JSON.parse(el.textContent); } catch (e) {}

  function stripSlash(s) {
    if (!s) return "";
    s = String(s);
    while (s.length && s.charAt(s.length - 1) === "/") s = s.slice(0, -1);
    return s;
  }
  function store(t) {
    if (!t) return;
    try { sessionStorage.setItem(KEY, t); } catch (e) {}
    try { localStorage.setItem(KEY, t); } catch (e) {}
  }
  function homePath() {
    if (typeof RETURN_TO === "string" && RETURN_TO.charAt(0) === "/" && RETURN_TO.charAt(1) !== "/") {
      return RETURN_TO;
    }
    return "/";
  }
  function homeUrl() {
    return stripSlash(APP_ORIGIN || window.location.origin) + homePath();
  }
  function loginUrl() {
    return stripSlash(APP_ORIGIN || window.location.origin) + "/login";
  }
  function showBtn(label, href) {
    var b = document.getElementById("btn");
    if (!b) return;
    b.style.display = "inline-block";
    b.textContent = label;
    b.setAttribute("href", href);
  }
  function goHome() {
    var dest = homeUrl();
    try { window.location.replace(dest); } catch (e) { window.location.href = dest; }
  }

  // Notify opener (desktop popup OR mobile tab with opener)
  if (window.opener) {
    try { window.opener.postMessage(msg, window.location.origin); } catch (e) {}
  }
  if (msg.token) store(msg.token);

  if (window.opener && !PAGE) {
    try { window.close(); } catch (e) {}
    setTimeout(function () {
      if (window.closed) return;
      if (msg.token) {
        document.getElementById("status").textContent = "Signed in — you can close this tab.";
        showBtn("Open app", homeUrl());
        goHome();
      } else {
        document.getElementById("status").textContent = "Sign-in did not complete";
        var h = document.getElementById("hint");
        h.style.display = "block";
        h.textContent = msg.error || "Try again";
        showBtn("Back to login", loginUrl());
      }
    }, 300);
    return;
  }

  // Full-page / mobile tab without relying on opener
  if (msg.token) {
    store(msg.token);
    document.getElementById("status").textContent = "Signed in — opening app…";
    showBtn("Open app", homeUrl());
    goHome();
    return;
  }

  document.getElementById("status").textContent = "Sign-in did not complete";
  var hint = document.getElementById("hint");
  hint.style.display = "block";
  hint.textContent = msg.error || "No session. Please try again.";
  showBtn("Back to login", loginUrl());
})();
</script>
</body>
</html>`;
}
