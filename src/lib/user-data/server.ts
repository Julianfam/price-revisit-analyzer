import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureDbReady, getSql, type Sql } from "@/lib/db";

function safeText(s: string, max: number): string {
  return s.trim().slice(0, max);
}

function safeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 120) return null;
  return e;
}

type AlertRow = {
  id: string;
  user_id: string;
  symbol: string;
  yahoo_symbol: string;
  target_price: number;
  tick: number;
  entry_price: number;
  created_at: number;
  active: boolean;
  hit_at: number | null;
  hit_price: number | null;
  live_price: number | null;
  live_at: number | null;
  needs_leave_first: boolean;
  has_left_target: boolean;
  away_since: number | null;
  abandoned_at: number | null;
  abandon_reason: string | null;
  armed_probability: number | null;
  armed_hist_touch: number | null;
  armed_rank: number | null;
};

function rowToAlert(r: AlertRow) {
  return {
    id: r.id,
    symbol: r.symbol,
    yahooSymbol: r.yahoo_symbol,
    targetPrice: Number(r.target_price),
    tick: Number(r.tick),
    entryPrice: Number(r.entry_price),
    createdAt: Number(r.created_at),
    active: !!r.active,
    hitAt: r.hit_at != null ? Number(r.hit_at) : undefined,
    hitPrice: r.hit_price != null ? Number(r.hit_price) : undefined,
    livePrice: r.live_price != null ? Number(r.live_price) : undefined,
    liveAt: r.live_at != null ? Number(r.live_at) : undefined,
    needsLeaveFirst: !!r.needs_leave_first,
    hasLeftTarget: !!r.has_left_target,
    awaySince: r.away_since != null ? Number(r.away_since) : null,
    abandonedAt: r.abandoned_at != null ? Number(r.abandoned_at) : undefined,
    abandonReason: (r.abandon_reason as "too_far" | "away_timeout" | "expired" | null) ?? undefined,
    armedProbability:
      r.armed_probability != null ? Number(r.armed_probability) : undefined,
    armedHistTouch:
      r.armed_hist_touch != null ? Number(r.armed_hist_touch) : undefined,
    armedRank: r.armed_rank != null ? Number(r.armed_rank) : undefined,
  };
}

const alertSchema = z.object({
  id: z.string().min(1).max(80),
  symbol: z.string().min(1).max(32),
  yahooSymbol: z.string().min(1).max(40),
  targetPrice: z.number().finite(),
  tick: z.number().positive(),
  entryPrice: z.number().finite(),
  createdAt: z.number().finite(),
  active: z.boolean(),
  hitAt: z.number().finite().nullable().optional(),
  hitPrice: z.number().finite().nullable().optional(),
  livePrice: z.number().finite().nullable().optional(),
  liveAt: z.number().finite().nullable().optional(),
  needsLeaveFirst: z.boolean().optional(),
  hasLeftTarget: z.boolean().optional(),
  awaySince: z.number().finite().nullable().optional(),
  abandonedAt: z.number().finite().nullable().optional(),
  abandonReason: z
    .enum(["too_far", "away_timeout", "expired"])
    .nullable()
    .optional(),
  armedProbability: z.number().finite().nullable().optional(),
  armedHistTouch: z.number().finite().nullable().optional(),
  armedRank: z.number().finite().nullable().optional(),
});

/** Ensure columns exist even if migrations partially applied (preview PGLite). */
export async function ensureUserDataSchema(sql: Sql): Promise<void> {
  await sql`
    create table if not exists user_price_alerts (
      id text primary key,
      user_id text not null,
      symbol text not null,
      yahoo_symbol text not null,
      target_price double precision not null,
      tick double precision not null,
      entry_price double precision not null,
      created_at bigint not null,
      active boolean not null default true,
      hit_at bigint,
      hit_price double precision,
      live_price double precision,
      live_at bigint,
      needs_leave_first boolean not null default false,
      has_left_target boolean not null default false,
      away_since bigint,
      abandoned_at bigint,
      abandon_reason text,
      armed_probability double precision,
      armed_hist_touch double precision,
      armed_rank double precision,
      updated_at timestamptz not null default now()
    )
  `;
  // Additive columns for older rows
  await sql.query(`
    alter table user_price_alerts add column if not exists away_since bigint;
    alter table user_price_alerts add column if not exists abandoned_at bigint;
    alter table user_price_alerts add column if not exists abandon_reason text;
    alter table user_price_alerts add column if not exists armed_probability double precision;
    alter table user_price_alerts add column if not exists armed_hist_touch double precision;
    alter table user_price_alerts add column if not exists armed_rank double precision;
    alter table user_price_alerts add column if not exists account_key text;
  `).catch(async () => {
    // Some drivers don't multi-statement; try one by one
    for (const col of [
      "away_since bigint",
      "abandoned_at bigint",
      "abandon_reason text",
      "armed_probability double precision",
      "armed_hist_touch double precision",
      "armed_rank double precision",
      "account_key text",
    ]) {
      await sql
        .query(
          `alter table user_price_alerts add column if not exists ${col}`,
        )
        .catch(() => undefined);
    }
  });

  await sql`
    create table if not exists user_settings (
      user_id text primary key,
      lang text not null default 'es',
      last_symbol text,
      last_interval text,
      last_range text,
      last_window text,
      alert_email text,
      email_alerts_enabled boolean not null default false,
      updated_at timestamptz not null default now()
    )
  `;
  await sql
    .query(
      `alter table user_settings add column if not exists alert_email text`,
    )
    .catch(() => undefined);
  await sql
    .query(
      `alter table user_settings add column if not exists email_alerts_enabled boolean not null default false`,
    )
    .catch(() => undefined);

  await sql`
    create table if not exists alert_email_outbox (
      id text primary key,
      email text not null,
      user_id text,
      symbol text not null,
      target_price double precision not null,
      hit_price double precision,
      hit_at bigint not null,
      subject text not null,
      body text not null,
      status text not null default 'queued',
      created_at timestamptz not null default now()
    )
  `;
}

export const listMyAlerts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await ensureDbReady({ retries: 3, delayMs: 150 });
    const sql = await getSql();
    await ensureUserDataSchema(sql);
    const rows = await sql<AlertRow>`
      select * from user_price_alerts
      where user_id = ${context.userId}
      order by created_at desc
      limit 200
    `;
    return { alerts: rows.map(rowToAlert) };
  });

/**
 * Save alerts for the signed-in user.
 * NEVER wipe existing rows with an empty payload (protects against hydrate races).
 */
export const saveMyAlerts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        alerts: z.array(alertSchema).max(120),
        /** Explicit clear only — empty alerts without this is a no-op if DB has rows */
        allowEmpty: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await ensureDbReady({ retries: 3, delayMs: 150 });
    const sql = await getSql();
    await ensureUserDataSchema(sql);
    const userId = context.userId;

    if (data.alerts.length === 0 && !data.allowEmpty) {
      const existing = await sql<{ c: number }>`
        select count(*)::int as c from user_price_alerts where user_id = ${userId}
      `;
      const count = Number(existing[0]?.c ?? 0);
      if (count > 0) {
        // Refuse to erase history with an empty client push
        return {
          ok: true as const,
          count,
          skippedEmpty: true as const,
        };
      }
      return { ok: true as const, count: 0, skippedEmpty: false as const };
    }

    // Upsert each alert; then delete ids not in the payload (full sync)
    const keepIds = data.alerts.map((a) => a.id);

    for (const a of data.alerts) {
      await sql`
        insert into user_price_alerts (
          id, user_id, symbol, yahoo_symbol, target_price, tick, entry_price,
          created_at, active, hit_at, hit_price, live_price, live_at,
          needs_leave_first, has_left_target, away_since, abandoned_at,
          abandon_reason, armed_probability, armed_hist_touch, armed_rank,
          updated_at
        ) values (
          ${a.id},
          ${userId},
          ${safeText(a.symbol, 32)},
          ${safeText(a.yahooSymbol, 40)},
          ${a.targetPrice},
          ${a.tick},
          ${a.entryPrice},
          ${a.createdAt},
          ${a.active},
          ${a.hitAt ?? null},
          ${a.hitPrice ?? null},
          ${a.livePrice ?? null},
          ${a.liveAt ?? null},
          ${a.needsLeaveFirst ?? false},
          ${a.hasLeftTarget ?? false},
          ${a.awaySince ?? null},
          ${a.abandonedAt ?? null},
          ${a.abandonReason ?? null},
          ${a.armedProbability ?? null},
          ${a.armedHistTouch ?? null},
          ${a.armedRank ?? null},
          now()
        )
        on conflict (id) do update set
          user_id = excluded.user_id,
          symbol = excluded.symbol,
          yahoo_symbol = excluded.yahoo_symbol,
          target_price = excluded.target_price,
          tick = excluded.tick,
          entry_price = excluded.entry_price,
          created_at = excluded.created_at,
          active = excluded.active,
          hit_at = excluded.hit_at,
          hit_price = excluded.hit_price,
          live_price = excluded.live_price,
          live_at = excluded.live_at,
          needs_leave_first = excluded.needs_leave_first,
          has_left_target = excluded.has_left_target,
          away_since = excluded.away_since,
          abandoned_at = excluded.abandoned_at,
          abandon_reason = excluded.abandon_reason,
          armed_probability = excluded.armed_probability,
          armed_hist_touch = excluded.armed_hist_touch,
          armed_rank = excluded.armed_rank,
          updated_at = now()
      `;
    }

    // Remove rows for this user that are no longer in the client list
    if (keepIds.length > 0) {
      // parameterized IN list
      const placeholders = keepIds.map((_, i) => `$${i + 2}`).join(",");
      await sql.query(
        `delete from user_price_alerts where user_id = $1 and id not in (${placeholders})`,
        [userId, ...keepIds],
      );
    } else if (data.allowEmpty) {
      await sql`delete from user_price_alerts where user_id = ${userId}`;
    }

    return {
      ok: true as const,
      count: data.alerts.length,
      skippedEmpty: false as const,
    };
  });

const settingsSchema = z.object({
  lang: z.enum(["en", "es"]).optional(),
  lastSymbol: z.string().max(32).optional().nullable(),
  lastInterval: z.string().max(8).optional().nullable(),
  lastRange: z.string().max(8).optional().nullable(),
  lastWindow: z.string().max(8).optional().nullable(),
  alertEmail: z.string().max(120).optional().nullable(),
  emailAlertsEnabled: z.boolean().optional(),
  clearEmail: z.boolean().optional(),
});

export const getMySettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensureUserDataSchema(sql);
    const rows = await sql<{
      lang: string;
      last_symbol: string | null;
      last_interval: string | null;
      last_range: string | null;
      last_window: string | null;
      alert_email: string | null;
      email_alerts_enabled: boolean | null;
    }>`
      select lang, last_symbol, last_interval, last_range, last_window,
             alert_email, email_alerts_enabled
      from user_settings
      where user_id = ${context.userId}
      limit 1
    `;
    const r = rows[0];
    return {
      lang: (r?.lang as "en" | "es") ?? null,
      lastSymbol: r?.last_symbol ?? null,
      lastInterval: r?.last_interval ?? null,
      lastRange: r?.last_range ?? null,
      lastWindow: r?.last_window ?? null,
      alertEmail: r?.alert_email ?? null,
      emailAlertsEnabled: !!r?.email_alerts_enabled,
    };
  });

export const saveMySettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => settingsSchema.parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensureUserDataSchema(sql);
    const userId = context.userId;

    const prev = await sql<{
      lang: string;
      last_symbol: string | null;
      last_interval: string | null;
      last_range: string | null;
      last_window: string | null;
      alert_email: string | null;
      email_alerts_enabled: boolean | null;
    }>`
      select * from user_settings where user_id = ${userId} limit 1
    `;
    const p = prev[0];

    let alertEmail = p?.alert_email ?? null;
    let emailOn = !!p?.email_alerts_enabled;
    if (data.clearEmail) {
      alertEmail = null;
      emailOn = false;
    } else if (data.alertEmail !== undefined) {
      if (data.alertEmail === null || data.alertEmail === "") {
        alertEmail = null;
      } else {
        const e = safeEmail(data.alertEmail);
        if (!e) throw new Error("Invalid email");
        alertEmail = e;
      }
    }
    if (data.emailAlertsEnabled !== undefined) {
      emailOn = data.emailAlertsEnabled;
    }

    const lang = data.lang ?? p?.lang ?? "es";
    const lastSymbol =
      data.lastSymbol !== undefined ? data.lastSymbol : (p?.last_symbol ?? null);
    const lastInterval =
      data.lastInterval !== undefined
        ? data.lastInterval
        : (p?.last_interval ?? null);
    const lastRange =
      data.lastRange !== undefined ? data.lastRange : (p?.last_range ?? null);
    const lastWindow =
      data.lastWindow !== undefined
        ? data.lastWindow
        : (p?.last_window ?? null);

    await sql`
      insert into user_settings (
        user_id, lang, last_symbol, last_interval, last_range, last_window,
        alert_email, email_alerts_enabled, updated_at
      ) values (
        ${userId},
        ${lang},
        ${lastSymbol},
        ${lastInterval},
        ${lastRange},
        ${lastWindow},
        ${alertEmail},
        ${emailOn},
        now()
      )
      on conflict (user_id) do update set
        lang = excluded.lang,
        last_symbol = excluded.last_symbol,
        last_interval = excluded.last_interval,
        last_range = excluded.last_range,
        last_window = excluded.last_window,
        alert_email = excluded.alert_email,
        email_alerts_enabled = excluded.email_alerts_enabled,
        updated_at = now()
    `;

    return {
      ok: true as const,
      alertEmail,
      emailAlertsEnabled: emailOn,
    };
  });

// ── Email delivery ──────────────────────────────────────────────────────────

const rateBuckets = new Map<string, number[]>();

function allowNotify(userId: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 60_000;
  const prev = (rateBuckets.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (prev.length >= 6) {
    rateBuckets.set(userId, prev);
    return false;
  }
  prev.push(now);
  rateBuckets.set(userId, prev);
  return true;
}

async function tryResend(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; detail?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return { ok: false, detail: "no_mail_provider" };
  }
  const from =
    process.env.ALERT_EMAIL_FROM?.trim() ||
    "Price Revisit <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, detail: t.slice(0, 200) || `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "fetch_failed",
    };
  }
}

const notifySchema = z.object({
  alertId: z.string().max(80),
  symbol: z.string().max(32),
  targetPrice: z.number(),
  hitPrice: z.number().optional(),
  hitAt: z.number(),
  tick: z.number(),
  lang: z.enum(["en", "es"]).default("es"),
});

export const notifyAlertEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => notifySchema.parse(data))
  .handler(async ({ context, data }) => {
    const userId = context.userId;
    if (!allowNotify(userId)) {
      return { ok: false as const, reason: "rate_limited" as const };
    }

    const sql = await getSql();
    await ensureUserDataSchema(sql);
    const settings = await sql<{
      alert_email: string | null;
      email_alerts_enabled: boolean | null;
    }>`
      select alert_email, email_alerts_enabled
      from user_settings
      where user_id = ${userId}
      limit 1
    `;
    const row = settings[0];
    if (!row?.email_alerts_enabled || !row.alert_email) {
      return { ok: false as const, reason: "not_subscribed" as const };
    }
    const email = safeEmail(row.alert_email);
    if (!email) {
      return { ok: false as const, reason: "invalid_email" as const };
    }

    const symbol = safeText(data.symbol, 32);
    const price =
      data.tick >= 1
        ? data.targetPrice.toFixed(0)
        : data.targetPrice.toFixed(
            Math.min(8, Math.max(2, Math.ceil(-Math.log10(data.tick)))),
          );
    const when = new Date(data.hitAt).toISOString();
    const subject =
      data.lang === "es"
        ? `Alerta: ${symbol} tocó ${price}`
        : `Alert: ${symbol} hit ${price}`;
    const body =
      data.lang === "es"
        ? [
            `Tu alerta de Price Revisit Analyzer se activó.`,
            ``,
            `Símbolo: ${symbol}`,
            `Objetivo: ${price}`,
            data.hitPrice != null
              ? `Precio al toque: ${Number(data.hitPrice)}`
              : null,
            `Hora (UTC): ${when}`,
            ``,
            `Solo tú recibes este correo (cuenta autenticada).`,
          ]
            .filter(Boolean)
            .join("\n")
        : [
            `Your Price Revisit Analyzer alert fired.`,
            ``,
            `Symbol: ${symbol}`,
            `Target: ${price}`,
            data.hitPrice != null ? `Hit price: ${Number(data.hitPrice)}` : null,
            `Time (UTC): ${when}`,
            ``,
            `Only you receive this email (authenticated account).`,
          ]
            .filter(Boolean)
            .join("\n");

    const send = await tryResend({ to: email, subject, text: body });
    const id = `hit-${data.alertId}-${data.hitAt}`;
    try {
      await sql`
        insert into alert_email_outbox (
          id, email, user_id, symbol, target_price, hit_price, hit_at,
          subject, body, status, created_at
        ) values (
          ${id},
          ${email},
          ${userId},
          ${symbol},
          ${data.targetPrice},
          ${data.hitPrice ?? null},
          ${data.hitAt},
          ${subject},
          ${body},
          ${send.ok ? "sent" : "queued"},
          now()
        )
        on conflict (id) do nothing
      `;
    } catch {
      /* ignore */
    }

    return {
      ok: true as const,
      delivered: send.ok,
      detail: send.detail ?? null,
    };
  });

export const sendTestAlertEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        lang: z.enum(["en", "es"]).default("es"),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const userId = context.userId;
    const sql = await getSql();
    await ensureUserDataSchema(sql);

    const settings = await sql<{
      alert_email: string | null;
      email_alerts_enabled: boolean | null;
    }>`
      select alert_email, email_alerts_enabled
      from user_settings
      where user_id = ${userId}
      limit 1
    `;
    const row = settings[0];
    if (!row?.alert_email) {
      return {
        ok: false as const,
        reason: "not_subscribed" as const,
        message: "No email on file — save your address first.",
      };
    }
    const email = safeEmail(row.alert_email);
    if (!email) {
      return {
        ok: false as const,
        reason: "invalid_email" as const,
        message: "Invalid email on file.",
      };
    }

    const when = new Date().toISOString();
    const subject =
      data.lang === "es"
        ? "Prueba · Price Revisit Analyzer — alertas por email"
        : "Test · Price Revisit Analyzer — email alerts";
    const body =
      data.lang === "es"
        ? [
            `Hola,`,
            ``,
            `Este es un correo de PRUEBA de Price Revisit Analyzer.`,
            `Tu suscripción de alertas por email está activa.`,
            ``,
            `Hora de esta prueba (UTC): ${when}`,
            `Destino: ${email}`,
            ``,
            `— Price Revisit Analyzer`,
          ].join("\n")
        : [
            `Hi,`,
            ``,
            `This is a TEST email from Price Revisit Analyzer.`,
            `Your email-alert subscription is active.`,
            ``,
            `Test time (UTC): ${when}`,
            `To: ${email}`,
            ``,
            `— Price Revisit Analyzer`,
          ].join("\n");

    const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const send = await tryResend({ to: email, subject, text: body });
    const status = send.ok ? "sent" : "queued";

    try {
      await sql`
        insert into alert_email_outbox (
          id, email, user_id, symbol, target_price, hit_price, hit_at,
          subject, body, status, created_at
        ) values (
          ${id},
          ${email},
          ${userId},
          ${"TEST"},
          ${0},
          ${null},
          ${Date.now()},
          ${subject},
          ${body},
          ${status},
          now()
        )
      `;
    } catch {
      /* ignore */
    }

    const masked = email.replace(/^(.).*(@.*)$/, "$1***$2");
    return {
      ok: true as const,
      delivered: send.ok,
      status,
      id,
      masked,
      subject,
      body,
      providerDetail: send.detail ?? null,
      mailConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
    };
  });
