/**
 * Lemon Squeezy API helpers (server-only).
 * Docs: https://docs.lemonsqueezy.com/api
 */

const API = "https://api.lemonsqueezy.com/v1";

function apiKey(): string {
  const k = process.env.LEMONSQUEEZY_API_KEY?.trim();
  if (!k) throw new Error("LEMONSQUEEZY_API_KEY not set");
  return k;
}

export function lemonConfigured(): boolean {
  return Boolean(process.env.LEMONSQUEEZY_API_KEY?.trim());
}

export function lemonStoreId(): string | null {
  return process.env.LEMONSQUEEZY_STORE_ID?.trim() || null;
}

export function lemonVariantId(): string | null {
  return process.env.LEMONSQUEEZY_VARIANT_ID?.trim() || null;
}

export function lemonStoreUrl(): string {
  const slug = process.env.LEMONSQUEEZY_STORE_SLUG?.trim() || "pricerevisitanalyzer";
  return (
    process.env.PRO_PAYMENT_URL?.trim() ||
    `https://${slug}.lemonsqueezy.com`
  );
}

async function lsFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${apiKey()}`,
      ...(init?.headers || {}),
    },
  });
}

export type LemonProductSummary = {
  id: string;
  name: string;
  status: string;
  price: number | null;
  buyUrl: string | null;
};

export async function listLemonProducts(): Promise<LemonProductSummary[]> {
  if (!lemonConfigured()) return [];
  const storeId = lemonStoreId();
  const q = storeId
    ? `?filter[store_id]=${encodeURIComponent(storeId)}`
    : "";
  const res = await lsFetch(`/products${q}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Lemon products ${res.status}: ${t.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    data?: Array<{
      id: string;
      attributes: {
        name: string;
        status: string;
        price?: number;
        buy_now_url?: string;
      };
    }>;
  };
  return (body.data ?? []).map((p) => ({
    id: p.id,
    name: p.attributes.name,
    status: p.attributes.status,
    price: p.attributes.price ?? null,
    buyUrl: p.attributes.buy_now_url ?? null,
  }));
}

export async function listLemonVariants(productId?: string): Promise<
  Array<{ id: string; name: string; price: number; productId: string }>
> {
  if (!lemonConfigured()) return [];
  const q = productId
    ? `?filter[product_id]=${encodeURIComponent(productId)}`
    : "";
  const res = await lsFetch(`/variants${q}`);
  if (!res.ok) return [];
  const body = (await res.json()) as {
    data?: Array<{
      id: string;
      attributes: { name: string; price: number; product_id: number };
    }>;
  };
  return (body.data ?? []).map((v) => ({
    id: v.id,
    name: v.attributes.name,
    price: v.attributes.price,
    productId: String(v.attributes.product_id),
  }));
}

/**
 * Create a hosted checkout URL for Pro, tagged with our user id.
 */
export async function createLemonCheckout(opts: {
  userId: string;
  email?: string | null;
  redirectUrl?: string;
  variantId?: string;
}): Promise<{ url: string; id: string }> {
  const storeId = lemonStoreId();
  const variantId = opts.variantId || lemonVariantId();
  if (!storeId) throw new Error("LEMONSQUEEZY_STORE_ID not set");
  if (!variantId) {
    throw new Error(
      "LEMONSQUEEZY_VARIANT_ID not set — create a Pro product in Lemon Squeezy and paste the variant id",
    );
  }

  const res = await lsFetch("/checkouts", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: opts.email || undefined,
            custom: {
              user_id: opts.userId,
            },
          },
          product_options: {
            redirect_url: opts.redirectUrl || undefined,
            receipt_button_text: "Back to Analyzer",
            receipt_thank_you_note:
              "Pro will activate automatically. If not, open the app and refresh.",
          },
          checkout_options: {
            embed: false,
            media: true,
            logo: true,
          },
          test_mode: process.env.LEMONSQUEEZY_TEST_MODE !== "false",
        },
        relationships: {
          store: {
            data: { type: "stores", id: String(storeId) },
          },
          variant: {
            data: { type: "variants", id: String(variantId) },
          },
        },
      },
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Lemon checkout ${res.status}: ${raw.slice(0, 300)}`);
  }
  const body = JSON.parse(raw) as {
    data: { id: string; attributes: { url: string } };
  };
  return { url: body.data.attributes.url, id: body.data.id };
}

/** Verify Lemon Squeezy webhook signature (X-Signature = hex HMAC-SHA256). */
export async function verifyLemonSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // No secret configured: accept only in demo (never in production)
    return process.env.PRO_ALLOW_DEMO === "true";
  }
  if (!signature) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
    const hex = [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hex === signature.toLowerCase();
  } catch {
    return false;
  }
}

export function extractUserIdFromLemonPayload(payload: unknown): string | null {
  try {
    const p = payload as {
      meta?: { custom_data?: Record<string, string> };
      data?: {
        attributes?: {
          first_order_item?: { product_id?: number };
          user_email?: string;
          custom_data?: Record<string, string>;
        };
      };
    };
    const custom =
      p.meta?.custom_data ||
      p.data?.attributes?.custom_data ||
      {};
    const uid =
      custom.user_id ||
      custom.userId ||
      custom.userid ||
      null;
    return uid ? String(uid) : null;
  } catch {
    return null;
  }
}
