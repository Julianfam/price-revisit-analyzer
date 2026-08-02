/**
 * Self-hosted Better Auth for THIS app (server-only).
 *
 * Preview (no DATABASE_URL): uses Better Auth **memory adapter** on globalThis.
 * Deployed (DATABASE_URL): real Postgres pool — required on Vercel for OAuth/session
 * to survive across serverless isolates.
 */
import { betterAuth } from "better-auth";
import { bearer, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { getCookie } from "@tanstack/react-start/server";
import { createHash, randomBytes } from "node:crypto";
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
  __grokAuthMemoryDB__?: MemoryDB;
};

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

function previewAuthSecret(): string {
  globalAuthRef.__grokAuthPreviewSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__grokAuthPreviewSecret__;
}

/**
 * Stable secret for serverless when BETTER_AUTH_SECRET is missing.
 * Random per-instance secrets break OAuth (can't verify state / cookies).
 */
function resolveAuthSecret(): string {
  const explicit = env("BETTER_AUTH_SECRET");
  if (explicit) return explicit;
  const seed =
    env("VERCEL_PROJECT_ID") ||
    env("VERCEL_PROJECT_PRODUCTION_URL") ||
    env("VERCEL_URL");
  if (seed) {
    return createHash("sha256")
      .update(`pra-auth-secret-v1:${seed}`)
      .digest("hex");
  }
  return previewAuthSecret();
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

const authDisabled = env("VITE_AUTH_ENABLED") === "false";

const grokIssuer = env("GROK_AUTH_ISSUER") ?? GROK_ISSUER_DEFAULT;
const grokClientId = env("GROK_AUTH_CLIENT_ID") ?? PREVIEW_CLIENT_ID;
const grokClientSecret = env("GROK_AUTH_CLIENT_SECRET") ?? PREVIEW_CLIENT_SECRET;

export const authConfigured =
  !authDisabled && Boolean(grokClientId && grokClientSecret);

/** Native X / Google OAuth (recommended for Vercel production). */
export const hasNativeTwitter = Boolean(
  env("TWITTER_CLIENT_ID") && env("TWITTER_CLIENT_SECRET"),
);
export const hasNativeGoogle = Boolean(
  env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"),
);

function httpsUrl(hostOrUrl: string): string {
  if (hostOrUrl.startsWith("http://") || hostOrUrl.startsWith("https://")) {
    return hostOrUrl.replace(/\/+$/, "");
  }
  return `https://${hostOrUrl.replace(/\/+$/, "")}`;
}

function vercelPublicUrl(): string | undefined {
  const prod = env("VERCEL_PROJECT_PRODUCTION_URL");
  if (prod) return httpsUrl(prod);
  const url = env("VERCEL_URL");
  if (url) return httpsUrl(url);
  return undefined;
}

const explicitBaseURL = env("BETTER_AUTH_URL") ?? vercelPublicUrl();
const previewAllowedHosts: string[] = [...PREVIEW_ALLOWED_HOSTS];
const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];

const baseURL = explicitBaseURL ?? {
  allowedHosts: [
    ...previewAllowedHosts,
    "localhost",
    "127.0.0.1",
    "[::1]",
    "*.vercel.app",
  ],
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

const STATIC_TRUSTED: string[] = [
  ...LOCAL_DEV_ORIGINS,
  "https://*.vercel.app",
  "https://*.grok-sandbox.com",
  "https://*.grok.me",
];
if (explicitBaseURL) STATIC_TRUSTED.push(explicitBaseURL);
for (const key of [
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const) {
  const v = env(key);
  if (v) STATIC_TRUSTED.push(httpsUrl(v));
}
for (const host of previewAllowedHosts) {
  STATIC_TRUSTED.push(`https://${host}`);
  STATIC_TRUSTED.push(`http://${host}`);
}

/**
 * Dynamic trusted origins: always allow the request Host (fixes
 * "Invalid origin: https://….vercel.app" on production).
 */
async function trustedOrigins(request?: Request): Promise<string[]> {
  const out = new Set(STATIC_TRUSTED);
  if (request) {
    const xfHost =
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      request.headers.get("host")?.split(",")[0]?.trim();
    if (xfHost) {
      const hostOnly = xfHost.split(":")[0] ?? xfHost;
      const isLocal =
        hostOnly === "localhost" ||
        hostOnly === "127.0.0.1" ||
        hostOnly === "[::1]";
      out.add(`${isLocal ? "http" : "https"}://${xfHost}`);
      out.add(`https://${hostOnly}`);
    }
    try {
      out.add(new URL(request.url).origin);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

const databaseUrl = env("DATABASE_URL");
export const authUsesDurableDb = Boolean(databaseUrl);

const issuerBase = grokIssuer.replace(/\/+$/, "");
const grokAuthorizationUrl = `${issuerBase}/api/auth/oauth2/authorize`;
const grokTokenUrl = `${issuerBase}/api/auth/oauth2/token`;
const grokUserInfoUrl = `${issuerBase}/api/auth/oauth2/userinfo`;

const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 3 })
  : memoryAdapter(previewMemoryDB());

export const SESSION_TOKEN_COOKIE = "__Secure-grok-auth.session_token";

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

const socialProviders: Record<
  string,
  { clientId: string; clientSecret: string }
> = {};
if (hasNativeTwitter) {
  socialProviders.twitter = {
    clientId: env("TWITTER_CLIENT_ID") as string,
    clientSecret: env("TWITTER_CLIENT_SECRET") as string,
  };
}
if (hasNativeGoogle) {
  socialProviders.google = {
    clientId: env("GOOGLE_CLIENT_ID") as string,
    clientSecret: env("GOOGLE_CLIENT_SECRET") as string,
  };
}

export const auth = betterAuth({
  baseURL,
  secret: resolveAuthSecret(),
  database,
  trustedOrigins,
  rateLimit: {
    enabled: true,
    window: 60,
    max: 200,
  },
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: [
        ...GROK_PROVIDERS.map((p) => p.providerId),
        ...(hasNativeTwitter ? ["twitter"] : []),
        ...(hasNativeGoogle ? ["google"] : []),
      ],
      requireLocalEmailVerified: false,
    },
  },
  emailAndPassword: {
    enabled: emailAndPasswordEnabled,
  },
  ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
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
    cookiePrefix: "grok-auth",
  },
  plugins: [
    bearer(),
    ...(grokOAuthPlugin ? [grokOAuthPlugin] : []),
    tanstackStartCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;

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
