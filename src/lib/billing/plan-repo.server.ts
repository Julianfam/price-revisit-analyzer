/**
 * Server-side plan/trial/pro persistence (shared by REST + server fns).
 */
import { ensureDbReady, getSql, type Sql } from "@/lib/db";
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

async function readySql(): Promise<Sql> {
  await ensureDbReady({ retries: 3, delayMs: 150 });
  const sql = await getSql();
  await ensureBillingSchema(sql);
  return sql;
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

export type PlanUserCtx = {
  userId: string;
  email?: string | null;
  name?: string | null;
};

function isGod(ctx: PlanUserCtx): boolean {
  return isGodUser({
    id: ctx.userId,
    email: ctx.email,
    name: ctx.name,
  });
}

export type PlanResponse = {
  entitlements: Entitlements;
  isGod: boolean;
  trialDays: number;
  proDays: number;
  freeAnalysesPerDay: number;
};

/** First login auto-starts Trial (same as getMyPlan server fn). */
export async function getPlanForUser(ctx: PlanUserCtx): Promise<PlanResponse> {
  const sql = await readySql();
  const userId = ctx.userId;
  const now = Date.now();
  const god = isGod(ctx);
  let row = await loadRow(sql, userId);

  if (god) {
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
      isGod: true,
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
    isGod: false,
    trialDays: TRIAL_DAYS,
    proDays: PRO_DAYS,
    freeAnalysesPerDay: FREE_ANALYSES_PER_DAY,
  };
}

export async function startTrialForUser(ctx: PlanUserCtx): Promise<{
  ok: boolean;
  reason?: string;
  entitlements: Entitlements;
  isGod?: boolean;
}> {
  if (isGod(ctx)) {
    return {
      ok: true,
      entitlements: { ...GOD_ENTITLEMENTS },
      isGod: true,
    };
  }
  const sql = await readySql();
  const userId = ctx.userId;
  const now = Date.now();
  const row = await loadRow(sql, userId);

  if (row?.status === "active") {
    return {
      ok: false,
      reason: "already_pro",
      entitlements: rowToEntitlements(row, now),
    };
  }
  if (row?.status === "trialing") {
    const ent = rowToEntitlements(row, now);
    if (ent.isPremium) {
      return { ok: false, reason: "already_trialing", entitlements: ent };
    }
  }
  if (row?.trial_started_at != null && row.status !== "none") {
    return {
      ok: false,
      reason: "trial_used",
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
  return { ok: true, entitlements: rowToEntitlements(fresh, now) };
}

export async function consumeAnalysisForUser(ctx: PlanUserCtx): Promise<{
  ok: boolean;
  reason?: string;
  entitlements: Entitlements;
  isGod?: boolean;
  consumed?: boolean;
}> {
  if (isGod(ctx)) {
    return {
      ok: true,
      entitlements: { ...GOD_ENTITLEMENTS },
      isGod: true,
      consumed: false,
    };
  }

  const sql = await readySql();
  const userId = ctx.userId;
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  // Ensure trial row exists
  const plan = await getPlanForUser(ctx);
  if (plan.entitlements.isPremium) {
    return {
      ok: true,
      entitlements: plan.entitlements,
      consumed: false,
    };
  }

  let row = await loadRow(sql, userId);
  if (!row) {
    return {
      ok: false,
      reason: "no_row",
      entitlements: plan.entitlements,
    };
  }

  const day = row.analyses_day;
  let count = n(row.analyses_today) ?? 0;
  if (day !== today) count = 0;

  if (count >= FREE_ANALYSES_PER_DAY) {
    const ent = resolveEntitlements({
      plan: "free",
      status: row.status === "expired" ? "expired" : "none",
      trialEndsAt: n(row.trial_ends_at),
      proEndsAt: n(row.pro_ends_at),
      analysesToday: count,
      analysesDay: today,
      now,
    });
    return { ok: false, reason: "quota", entitlements: ent };
  }

  const next = count + 1;
  await upsertRow(sql, userId, {
    plan: (row.plan as PlanId) || "free",
    status: (row.status as PlanStatus) || "none",
    trialStartedAt: n(row.trial_started_at),
    trialEndsAt: n(row.trial_ends_at),
    proStartedAt: n(row.pro_started_at),
    proEndsAt: n(row.pro_ends_at),
    analysesToday: next,
    analysesDay: today,
  });
  const fresh = await loadRow(sql, userId);
  return {
    ok: true,
    entitlements: rowToEntitlements(fresh, now),
    consumed: true,
  };
}

export async function grantProForUser(
  userId: string,
  days = PRO_DAYS,
): Promise<Entitlements> {
  const sql = await readySql();
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
