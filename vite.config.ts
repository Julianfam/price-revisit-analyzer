import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "app-builder:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[app-builder] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * Security headers.
 * Never set X-Frame-Options: SAMEORIGIN — Grok embeds the preview in a
 * cross-origin iframe and Chrome shows "Este contenido está bloqueado".
 */
function securityHeadersPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:",
    // Allow Grok product shells + sandbox hosts to embed this app
    "frame-ancestors 'self' https://grok.com https://*.grok.com https://x.ai https://*.x.ai https://*.grok-sandbox.com https://*.grok.me",
    "base-uri 'self'",
    "form-action 'self' https://auth.grok.me https://accounts.google.com https://twitter.com https://x.com https://api.x.com https://*.twitter.com https://*.x.com",
  ].join("; ");

  const apply = (res: {
    setHeader: (k: string, v: string) => void;
    removeHeader: (k: string) => void;
  }) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Drop legacy frame header if a prior middleware set it
    try {
      res.removeHeader("X-Frame-Options");
    } catch {
      /* ignore */
    }
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    res.setHeader("Content-Security-Policy", csp);
  };

  return {
    name: "app-builder:security-headers",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        apply(res);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        apply(res);
        next();
      });
    },
  };
}

function authPopupPlugin(): Plugin {
  return {
    name: "app-builder:auth-popup",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/auth/popup") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() === "HEAD") {
            res.statusCode = 200;
            res.setHeader("cache-control", "no-store");
            res.end();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }

          const xfHost = String(
            (req.headers["x-forwarded-host"] as string | undefined)
              ?.split(",")[0]
              ?.trim() ?? "",
          );
          const host = String(xfHost || req.headers.host || "localhost:8080");
          const hostName = host.split(":")[0] ?? host;
          const isPublicPreview =
            hostName.endsWith(".grok-sandbox.com") ||
            hostName.endsWith(".grok.me");
          const xfProto = String(
            (req.headers["x-forwarded-proto"] as string | undefined)
              ?.split(",")[0]
              ?.trim() ?? "",
          );
          const proto = String(
            isPublicPreview
              ? "https"
              : xfProto ||
                  ((req.socket as { encrypted?: boolean } | undefined)
                    ?.encrypted
                    ? "https"
                    : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          requestHeaders.set("host", host);
          requestHeaders.set("x-forwarded-host", host);
          requestHeaders.set("x-forwarded-proto", proto);

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method: "GET",
            headers: requestHeaders,
          });

          const mod = (await server.ssrLoadModule(
            "/src/lib/auth/popup.server.ts",
          )) as {
            handleAuthPopupRequest: (req: Request) => Promise<Response>;
          };
          const response = await mod.handleAuthPopupRequest(request);

          res.statusCode = response.status;
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            // Don't re-apply frame-blocking headers from upstream
            if (key.toLowerCase() === "x-frame-options") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          // OAuth bridge: allow any parent + top-level breakout
          try {
            res.removeHeader("X-Frame-Options");
          } catch {
            /* ignore */
          }
          res.setHeader(
            "Content-Security-Policy",
            [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "frame-ancestors *",
              "base-uri 'self'",
              "form-action *",
            ].join("; "),
          );
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (err) {
          console.error("[app-builder] /auth/popup handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth popup failed");
          }
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  // Keep PGLite (and its .data / .wasm assets) as a real Node package so
  // import.meta.url resolves under node_modules — never /var/task/_libs.
  ssr: {
    external: ["@electric-sql/pglite", "@electric-sql/pglite-socket"],
  },
  plugins: [
    securityHeadersPlugin(),
    pgliteBootstrapPlugin(),
    authPopupPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" ? [nitro({ preset: "vercel" })] : []),
    viteReact(),
  ],
}));
