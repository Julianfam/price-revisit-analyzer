/**
 * Self-hosted Better Auth for THIS app (server-only).
 *
 * Preview (no DATABASE_URL): uses Better Auth **memory adapter** on globalThis.
 *   → Login never depends on PGLite (avoids ENOENT / database_warming loops on mobile).
 *   → Sessions survive Vite HMR within the same process (globalThis).
 * Deployed (DATABASE_URL): real Postgres pool.
 *
 * App data (alerts, etc.) still uses PGLite via `@/lib/db` separately.
 */
import { betterAuth } from "better-auth";
import { bearer, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { getCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { emailAndPasswordEnabled } from "./email-password";
import { GROK_PROVIDERS } from "./providers";
import {
  GROK_ISSUER_DEFAULT,
  PREVIEW_ALLOWED_HOSTS,
  PREVIEW_CLIENT_ID,
  PREVIEW_CLIENT_SECRET,
} from "./preview";

const globalAuthRef = globalThis as typeof globalThis & {
  __grokAuthPreviewSecret__?: string;
  /** Shared memory DB — survives HMR so OAuth mid-flow is not wiped. */
  __grokAuthMemoryDB__?: MemoryDB;
};

function previewAuthSecret(): string {
  globalAuthRef.__grokAuthPreviewSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__grokAuthPreviewSecret__;
}

function previewMemoryDB(): MemoryDB {
  if (!globalAuthRef.__grokAuthMemoryDB__) {
    globalAuthRef.__grokAuthMemoryDB__ = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
  } else {
    const db = globalAuthRef.__grokAuthMemoryDB__;
    for (const k of ["user", "session", "account", "verification"] as const) {
      if (!Array.isArray(db[k])) db[k] = [];
    }
  }
  return globalAuthRef.__grokAuthMemoryDB__;
}

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

const authDisabled = env("VITE_AUTH_ENABLED") === "false";

const grokIssuer = env("GROK_AUTH_ISSUER") ?? GROK_ISSUER_DEFAULT;
const grokClientId = env("GROK_AUTH_CLIENT_ID") ?? PREVIEW_CLIENT_ID;
const grokClientSecret = env("GROK_AUTH_CLIENT_SECRET") ?? PREVIEW_CLIENT_SECRET;

export const authConfigured =
  !authDisabled && Boolean(grokClientId && grokClientSecret);

const explicitBaseURL = env("BETTER_AUTH_URL");
const previewAllowedHosts: string[] = [...PREVIEW_ALLOWED_HOSTS];
const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];
const baseURL = explicitBaseURL ?? {
  allowedHosts: [...previewAllowedHosts, "localhost", "127.0.0.1", "[::1]"],
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

const trustedOrigins: string[] = explicitBaseURL
  ? [explicitBaseURL, ...LOCAL_DEV_ORIGINS]
  : [
      ...previewAllowedHosts,
      ...previewAllowedHosts.flatMap((host) => [
        `https://${host}`,
        `http://${host}`,
      ]),
      ...LOCAL_DEV_ORIGINS,
    ];

const databaseUrl = env("DATABASE_URL");

const issuerBase = grokIssuer.replace(/\/+$/, "");
const grokAuthorizationUrl = `${issuerBase}/api/auth/oauth2/authorize`;
const grokTokenUrl = `${issuerBase}/api/auth/oauth2/token`;
const grokUserInfoUrl = `${issuerBase}/api/auth/oauth2/userinfo`;

/**
 * Deployed → Postgres.
 * Preview → in-memory adapter (NO PGLite). This is the fix for mobile login
 * loops on database_warming / pglite ENOENT.
 */
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : memoryAdapter(previewMemoryDB());

export const SESSION_TOKEN_COOKIE = "__Secure-grok-auth.session_token";
// Also used on some hosts:
// "__Host-grok-auth.session_token" | "grok-auth.session_token"

const grokOAuthPlugin = authConfigured
  ? genericOAuth({
      config: GROK_PROVIDERS.map(({ providerId, idp }) => ({
        providerId,
        clientId: grokClientId as string,
        clientSecret: grokClientSecret as string,
        authorizationUrl: grokAuthorizationUrl,
        tokenUrl: grokTokenUrl,
        userInfoUrl: grokUserInfoUrl,
        scopes: ["openid", "profile", "email"],
        authorizationUrlParams: { idp, prompt: "login" },
      })),
    })
  : null;

export const auth = betterAuth({
  baseURL,
  secret: env("BETTER_AUTH_SECRET") ?? previewAuthSecret(),
  database,
  trustedOrigins,

  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: GROK_PROVIDERS.map((p) => p.providerId),
      requireLocalEmailVerified: false,
    },
  },

  emailAndPassword: {
    enabled: emailAndPasswordEnabled,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },

  advanced: {
    useSecureCookies: true,
    // __Host- prefix in production/preview https; cookie name for popup reader
    cookiePrefix: "grok-auth",
  },

  plugins: [
    bearer(),
    ...(grokOAuthPlugin ? [grokOAuthPlugin] : []),
    tanstackStartCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;

/** Read session token from request cookies (popup / oauth done bridges). */
export function sessionTokenFromCookies(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const names = [
    SESSION_TOKEN_COOKIE,
    "__Host-grok-auth.session_token",
    "grok-auth.session_token",
    "__Secure-better-auth.session_token",
    "__Host-better-auth.session_token",
    "better-auth.session_token",
  ];
  for (const name of names) {
    for (const part of header.split(";")) {
      const trimmed = part.trim();
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
  }
  // Fallback: tanstack cookie helper when available in handler context
  try {
    for (const name of names) {
      const v = getCookie(name);
      if (v) return v;
    }
  } catch {
    /* not in request context */
  }
  return null;
}
