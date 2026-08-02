/**
 * Public auth capability probe (no secrets).
 * Login UI uses this to avoid starting a Grok-broker flow on Vercel
 * that always ends in "Invalid redirect URI".
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  authConfigured,
  authUsesDurableDb,
  hasNativeGoogle,
  hasNativeTwitter,
} from "@/lib/auth/server";

function isPreviewHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h.endsWith(".grok-sandbox.com") ||
    h.endsWith(".grok.me") ||
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "[::1]"
  );
}

function isVercelHost(hostname: string): boolean {
  return hostname.toLowerCase().endsWith(".vercel.app");
}

export const Route = createFileRoute("/api/auth/status")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const host =
          request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
          request.headers.get("host")?.split(",")[0]?.trim() ||
          "";
        const hostname = host.split(":")[0] || "";
        const preview = isPreviewHost(hostname);
        const vercel = isVercelHost(hostname);

        // Grok preview client only allows *.grok-sandbox.com callbacks.
        // On Vercel we MUST use native Twitter/Google or email.
        const grokBrokerOk = preview && authConfigured;
        const xMode = hasNativeTwitter
          ? "native"
          : grokBrokerOk
            ? "grok"
            : "unavailable";
        const googleMode = hasNativeGoogle
          ? "native"
          : grokBrokerOk
            ? "grok"
            : "unavailable";

        return Response.json(
          {
            host: hostname,
            preview,
            vercel,
            durableDb: authUsesDurableDb,
            x: {
              mode: xMode,
              available: xMode !== "unavailable",
            },
            google: {
              mode: googleMode,
              available: googleMode !== "unavailable",
            },
            emailPassword: true,
            setup: {
              needDatabase: !authUsesDurableDb && vercel,
              needTwitterKeys: vercel && !hasNativeTwitter,
              needGoogleKeys: vercel && !hasNativeGoogle,
              twitterCallback: hostname
                ? `https://${hostname}/api/auth/callback/twitter`
                : null,
              googleCallback: hostname
                ? `https://${hostname}/api/auth/callback/google`
                : null,
              envHints: [
                "DATABASE_URL",
                "BETTER_AUTH_SECRET",
                "BETTER_AUTH_URL",
                "TWITTER_CLIENT_ID",
                "TWITTER_CLIENT_SECRET",
              ],
            },
          },
          {
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
