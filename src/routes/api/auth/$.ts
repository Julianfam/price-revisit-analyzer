import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";

/**
 * Better Auth catch-all (OAuth callback, get-session, sign-in, …).
 *
 * Preview auth uses the **memory adapter** — no PGLite warm-up required.
 * Never block login on the app DB.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
