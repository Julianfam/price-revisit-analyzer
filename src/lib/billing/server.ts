import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import {
  FREE_ANALYSES_PER_DAY,
  PRO_DAYS,
  TRIAL_DAYS,
  resolveEntitlements,
  type Entitlements,
  type PlanId,
  type PlanStatus,
} from "@/lib/billing/plans";
import { GOD_ENTITLEMENTS, isGodUser } from "@/lib/billing/god-mode";
import {
  createLemonCheckout,
  lemonConfigured,
  lemonStoreUrl,
  lemonVariantId,
  listLemonProducts,
  listLemonVariants,
} from "@/lib/billing/lemonsqueezy.server";

type SubRow = {
  user_id: string;
  plan: string;
  status: string;
  trial_started_at: number | string | null;
  trial_ends_at: number | string | null;
  pro_started_at: number | string | null;
  pro_ends_at: number | string | null;
  analyses_today: number | string | null;
  analyses_day: string | null;
};

function n(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const x = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(x) ? x : null;
}

async function ensureBillingSchema(sql: Sql): Promise<void> {
  await sql.query(`
    create table if not exists user_subscriptions (
      user_id text primary key,
      plan text not null default 'free',
      status text not null default 'none',
      trial_started_at bigint,
      trial_ends_at bigint,
      pro_started_at bigint,
      pro_ends_at bigint,
      analyses_today int not null default 0,
      analyses_day text,
      updated_at timestamptz not null default now()
    )
  `);
}

function rowToEntitlements(
  row: SubRow | undefined,
  now = Date.now(),
): Entitlements {
  if (!row) {
    return resolveEntitlements({
      plan: "free",
      status: "none",
      trialEndsAt: null,
      proEndsAt: null,
      analysesToday: 0,
      analysesDay: null,
      now,
    });
  }
  return resolveEntitlements({
    plan: row.plan,
    status: row.status,
    trialEndsAt: n(row.trial_ends_at),
    proEndsAt: n(row.pro_ends_at),
    analysesToday: n(row.analyses_today) ?? 0,
    analysesDay: row.analyses_day,
    now,
  });
}

async function loadRow(sql: Sql, userId: string): Promise<SubRow | undefined> {
  const rows = await sql<SubRow>`
    select * from user_subscriptions where user_id = ${userId} limit 1
  `;
  return rows[0];
}

async function upsertRow(
  sql: Sql,
  userId: string,
  patch: {
    plan: PlanId;
    status: PlanStatus;
    trialStartedAt: number | null;
    trialEndsAt: number | null;
    proStartedAt: number | null;
    proEndsAt: number | null;
    analysesToday?: number;
    analysesDay?: string | null;
  },
): Promise<void> {
  await sql`
    insert into user_subscriptions (
      user_id, plan, status,
      trial_started_at, trial_ends_at,
      pro_started_at, pro_ends_at,
      analyses_today, analyses_day, updated_at
    ) values (
      ${userId},
      ${patch.plan},
      ${patch.status},
      ${patch.trialStartedAt},
      ${patch.trialEndsAt},
      ${patch.proStartedAt},
      ${patch.proEndsAt},
      ${patch.analysesToday ?? 0},
      ${patch.analysesDay ?? null},
      now()
    )
    on conflict (user_id) do update set
      plan = excluded.plan,
      status = excluded.status,
      trial_started_at = excluded.trial_started_at,
      trial_ends_at = excluded.trial_ends_at,
      pro_started_at = excluded.pro_started_at,
      pro_ends_at = excluded.pro_ends_at,
      analyses_today = coalesce(excluded.analyses_today, user_subscriptions.analyses_today),
      analyses_day = coalesce(excluded.analyses_day, user_subscriptions.analyses_day),
      updated_at = now()
  `;
}

function godFromContext(context: {
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
}): boolean {
  return isGodUser({
    id: context.userId,
    email: context.userEmail,
    name: context.userName,
  });
}

/** Activate Pro for a user id (webhook / internal). */
export async function grantProToUser(
  userId: string,
  days = PRO_DAYS,
): Promise<Entitlements> {
  const sql = await getSql();
  await ensureBillingSchema(sql);
  const now = Date.now();
  const row = await loadRow(sql, userId);
  const proEnd = now + days * 24 * 60 * 60_000;
  await upsertRow(sql, userId, {
    plan: "pro",
    status: "active",
    trialStartedAt: n(row?.trial_started_at),
    trialEndsAt: n(row?.trial_ends_at),
    proStartedAt: now,
    proEndsAt: proEnd,
    analysesToday: n(row?.analyses_today) ?? 0,
    analysesDay: row?.analyses_day ?? null,
  });
  const fresh = await loadRow(sql, userId);
  return rowToEntitlements(fresh, now);
}

export const getMyPlan = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensureBillingSchema(sql);
    const userId = context.userId;
    const now = Date.now();
    const isGod = godFromContext(context);
    let row = await loadRow(sql, userId);

    if (isGod) {
      await upsertRow(sql, userId, {
        plan: "pro",
        status: "active",
        trialStartedAt: n(row?.trial_started_at) ?? now,
        trialEndsAt: n(row?.trial_ends_at),
        proStartedAt: n(row?.pro_started_at) ?? now,
        proEndsAt: now + 3650 * 24 * 60 * 60_000,
        analysesToday: 0,
        analysesDay: null,
      });
      return {
        entitlements: { ...GOD_ENTITLEMENTS },
        isGod: true as const,
        trialDays: TRIAL_DAYS,
        proDays: PRO_DAYS,
        freeAnalysesPerDay: FREE_ANALYSES_PER_DAY,
      };
    }

    if (!row || row.status === "none") {
      const trialEnd = now + TRIAL_DAYS * 24 * 60 * 60_000;
      await upsertRow(sql, userId, {
        plan: "trial",
        status: "trialing",
        trialStartedAt: now,
        trialEndsAt: trialEnd,
        proStartedAt: null,
        proEndsAt: null,
        analysesToday: n(row?.analyses_today) ?? 0,
        analysesDay: row?.analyses_day ?? null,
      });
      row = await loadRow(sql, userId);
    } else {
      const ent = rowToEntitlements(row, now);
      if (
        (row.status === "trialing" || row.status === "active") &&
        ent.status === "expired"
      ) {
        await upsertRow(sql, userId, {
          plan: "free",
          status: "expired",
          trialStartedAt: n(row.trial_started_at),
          trialEndsAt: n(row.trial_ends_at),
          proStartedAt: n(row.pro_started_at),
          proEndsAt: n(row.pro_ends_at),
          analysesToday: n(row.analyses_today) ?? 0,
          analysesDay: row.analyses_day,
        });
        row = await loadRow(sql, userId);
      }
    }

    return {
      entitlements: rowToEntitlements(row, now),
      isGod: false as const,
      trialDays: TRIAL_DAYS,
      proDays: PRO_DAYS,
      freeAnalysesPerDay: FREE_ANALYSES_PER_DAY,
    };
  });

export const startTrial = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (godFromContext(context)) {
      return {
        ok: true as const,
        entitlements: { ...GOD_ENTITLEMENTS },
        isGod: true as const,
      };
    }
    const sql = await getSql();
    await ensureBillingSchema(sql);
    const userId = context.userId;
    const now = Date.now();
    const row = await loadRow(sql, userId);

    if (row?.status === "active") {
      return {
        ok: false as const,
        reason: "already_pro" as const,
        entitlements: rowToEntitlements(row, now),
      };
    }
    if (row?.status === "trialing") {
      const ent = rowToEntitlements(row, now);
      if (ent.isPremium) {
        return {
          ok: false as const,
          reason: "already_trialing" as const,
          entitlements: ent,
        };
      }
    }
    if (row?.trial_started_at != null && row.status !== "none") {
      return {
        ok: false as const,
        reason: "trial_used" as const,
        entitlements: rowToEntitlements(row, now),
      };
    }

    const trialEnd = now + TRIAL_DAYS * 24 * 60 * 60_000;
    await upsertRow(sql, userId, {
      plan: "trial",
      status: "trialing",
      trialStartedAt: now,
      trialEndsAt: trialEnd,
      proStartedAt: n(row?.pro_started_at),
      proEndsAt: n(row?.pro_ends_at),
      analysesToday: n(row?.analyses_today) ?? 0,
      analysesDay: row?.analyses_day ?? null,
    });
    const fresh = await loadRow(sql, userId);
    return {
      ok: true as const,
      entitlements: rowToEntitlements(fresh, now),
    };
  });

export const activatePro = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        confirm: z.literal(true),
        unlockCode: z.string().min(4).max(80).optional(),
        paymentRef: z.string().max(120).optional(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    if (godFromContext(context)) {
      return {
        ok: true as const,
        entitlements: { ...GOD_ENTITLEMENTS },
        proEndsAt: Date.now() + 3650 * 24 * 60 * 60_000,
        isGod: true as const,
      };
    }

    const envCode = process.env.PRO_UNLOCK_CODE?.trim();
    const allowDemo =
      process.env.PRO_ALLOW_DEMO === "true" ||
      process.env.NODE_ENV === "development";
    const codeOk =
      Boolean(envCode) &&
      Boolean(data.unlockCode) &&
      data.unlockCode!.trim() === envCode;
    const paymentOk = Boolean(data.paymentRef?.trim());

    if (!codeOk && !paymentOk && !allowDemo) {
      return {
        ok: false as const,
        reason: "payment_required" as const,
        paymentUrl: lemonStoreUrl(),
        message: "Pay with Lemon Squeezy or enter unlock code.",
      };
    }

    const ent = await grantProToUser(context.userId, PRO_DAYS);
    return {
      ok: true as const,
      entitlements: ent,
      proEndsAt: ent.proEndsAt,
      demo: allowDemo && !codeOk && !paymentOk,
    };
  });

export const consumeAnalysis = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensureBillingSchema(sql);
    const userId = context.userId;
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    if (godFromContext(context)) {
      return {
        ok: true as const,
        entitlements: { ...GOD_ENTITLEMENTS },
        consumed: false as const,
        isGod: true as const,
      };
    }

    let row = await loadRow(sql, userId);
    if (!row) {
      const trialEnd = now + TRIAL_DAYS * 24 * 60 * 60_000;
      await upsertRow(sql, userId, {
        plan: "trial",
        status: "trialing",
        trialStartedAt: now,
        trialEndsAt: trialEnd,
        proStartedAt: null,
        proEndsAt: null,
      });
      row = await loadRow(sql, userId);
    }

    let ent = rowToEntitlements(row, now);
    if (ent.isPremium) {
      return { ok: true as const, entitlements: ent, consumed: false as const };
    }

    const used =
      row?.analyses_day === today ? (n(row?.analyses_today) ?? 0) : 0;
    if (used >= FREE_ANALYSES_PER_DAY) {
      return {
        ok: false as const,
        reason: "quota" as const,
        entitlements: {
          ...ent,
          canAnalyze: false,
          analysesLeftToday: 0,
        },
      };
    }

    const next = used + 1;
    await sql`
      update user_subscriptions
      set analyses_today = ${next},
          analyses_day = ${today},
          updated_at = now()
      where user_id = ${userId}
    `;
    row = await loadRow(sql, userId);
    ent = rowToEntitlements(row, now);
    return { ok: true as const, entitlements: ent, consumed: true as const };
  });

export const getPaymentConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    let products: Awaited<ReturnType<typeof listLemonProducts>> = [];
    let variants: Awaited<ReturnType<typeof listLemonVariants>> = [];
    let lemonError: string | null = null;
    if (lemonConfigured()) {
      try {
        products = await listLemonProducts();
        variants = await listLemonVariants();
      } catch (e) {
        lemonError = e instanceof Error ? e.message : "lemon error";
      }
    }
    const variantId =
      lemonVariantId() ||
      variants.find((v) => /pro/i.test(v.name))?.id ||
      variants[0]?.id ||
      null;

    return {
      provider: "lemonsqueezy" as const,
      paymentUrl: lemonStoreUrl(),
      storeUrl: lemonStoreUrl(),
      hasUnlockCode: Boolean(process.env.PRO_UNLOCK_CODE?.trim()),
      hasVariant: Boolean(variantId),
      variantId,
      allowDemo:
        process.env.PRO_ALLOW_DEMO === "true" ||
        process.env.NODE_ENV === "development",
      proDays: PRO_DAYS,
      trialDays: TRIAL_DAYS,
      priceLabel:
        process.env.PRO_PRICE_LABEL?.trim() || "Pro · 30 days · Lemon Squeezy",
      lemonConfigured: lemonConfigured(),
      products,
      variants,
      lemonError,
      needsProduct: products.length === 0,
    };
  },
);

/** Create a Lemon Squeezy checkout for the signed-in user. */
export const startLemonCheckout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        redirectUrl: z.string().url().optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ context, data }) => {
    if (!lemonConfigured()) {
      return {
        ok: false as const,
        reason: "not_configured" as const,
        storeUrl: lemonStoreUrl(),
      };
    }
    try {
      // Auto-pick first variant if env not set
      let variant = lemonVariantId();
      if (!variant) {
        const variants = await listLemonVariants();
        variant =
          variants.find((v) => /pro/i.test(v.name))?.id ||
          variants[0]?.id ||
          null;
      }
      if (!variant) {
        return {
          ok: false as const,
          reason: "no_product" as const,
          storeUrl: lemonStoreUrl(),
          message:
            "Create a Pro product in Lemon Squeezy dashboard, then set LEMONSQUEEZY_VARIANT_ID.",
        };
      }
      const checkout = await createLemonCheckout({
        userId: context.userId,
        email: context.userEmail,
        redirectUrl: data.redirectUrl,
        variantId: variant,
      });
      return {
        ok: true as const,
        url: checkout.url,
        id: checkout.id,
      };
    } catch (e) {
      return {
        ok: false as const,
        reason: "checkout_failed" as const,
        message: e instanceof Error ? e.message : "Checkout failed",
        storeUrl: lemonStoreUrl(),
      };
    }
  });
