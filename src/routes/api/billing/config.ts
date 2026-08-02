/**
 * Public-ish payment config (no secrets). Mobile-safe REST.
 * GET /api/billing/config
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  lemonConfigured,
  lemonStoreUrl,
  lemonVariantId,
} from "@/lib/billing/lemonsqueezy.server";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function handleGet(): Response {
  const variant = lemonVariantId();
  const storeUrl = lemonStoreUrl();
  const hasKey = lemonConfigured();
  const hasUnlock = Boolean(process.env.PRO_UNLOCK_CODE?.trim());
  const allowDemo =
    process.env.ALLOW_PRO_DEMO === "true" ||
    !process.env.DATABASE_URL?.trim();

  return json({
    paymentUrl: storeUrl,
    storeUrl,
    hasUnlockCode: hasUnlock,
    hasVariant: Boolean(variant),
    allowDemo,
    priceLabel: variant
      ? "Pro · 30 days · Lemon Squeezy"
      : "Pro · Lemon Squeezy",
    lemonConfigured: hasKey,
    needsProduct: hasKey && !variant,
    lemonError: null,
  });
}

export const Route = createFileRoute("/api/billing/config")({
  server: {
    handlers: {
      GET: () => handleGet(),
    },
  },
});
