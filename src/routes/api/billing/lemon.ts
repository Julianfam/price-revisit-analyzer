import { createFileRoute } from "@tanstack/react-router";
import {
  extractUserIdFromLemonPayload,
  verifyLemonSignature,
} from "@/lib/billing/lemonsqueezy.server";
import { grantProToUser } from "@/lib/billing/server";
import { PRO_DAYS } from "@/lib/billing/plans";

/**
 * Lemon Squeezy webhooks.
 * Dashboard → Settings → Webhooks →
 *   URL: https://YOUR_DOMAIN/api/billing/lemon
 *   Events: order_created, subscription_created, subscription_payment_success
 */
export const Route = createFileRoute("/api/billing/lemon")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const sig =
          request.headers.get("X-Signature") ||
          request.headers.get("x-signature");

        const ok = await verifyLemonSignature(raw, sig);
        if (!ok) {
          return new Response(JSON.stringify({ error: "invalid signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let payload: {
          meta?: { event_name?: string; custom_data?: Record<string, string> };
          data?: { type?: string; attributes?: Record<string, unknown> };
        };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response(JSON.stringify({ error: "bad json" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const event = payload.meta?.event_name || "";
        const grantEvents = new Set([
          "order_created",
          "subscription_created",
          "subscription_payment_success",
          "subscription_resumed",
        ]);

        if (!grantEvents.has(event)) {
          return new Response(JSON.stringify({ ok: true, ignored: event }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const userId = extractUserIdFromLemonPayload(payload);
        if (!userId) {
          console.warn("[lemon webhook] no user_id in custom_data", event);
          return new Response(
            JSON.stringify({ ok: true, warning: "no user_id" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        try {
          await grantProToUser(userId, PRO_DAYS);
          console.info("[lemon webhook] Pro granted", userId, event);
          return new Response(
            JSON.stringify({ ok: true, userId, event, days: PRO_DAYS }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        } catch (e) {
          console.error("[lemon webhook] grant failed", e);
          return new Response(JSON.stringify({ error: "grant failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
      GET: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            service: "lemon-squeezy-webhook",
            hint: "POST order_created / subscription_* here",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    },
  },
});
