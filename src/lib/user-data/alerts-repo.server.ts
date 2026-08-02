/**
 * Alert persistence:
 *  - Production (DATABASE_URL / Neon): Postgres is primary by account_key
 *  - Preview (PGLite): dual write PGLite + disk file cloud
 *
 * SAVE always merges with existing cloud so one device never wipes another.
 */
import { dbSource, ensureDbReady, getSql, type Sql } from "@/lib/db";
import { ensureUserDataSchema } from "@/lib/user-data/server";
import {
  accountCloudKey,
  accountCloudKeyCandidates,
} from "@/lib/user-data/cloud-identity";
import {
  loadMergedFromFiles,
  readCloudBlob,
  writeCloudBlob,
} from "@/lib/user-data/alerts-file-store.server";

export type AlertRow = {
  id: string;
  user_id: string;
  account_key?: string | null;
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

export type AlertDTO = {
  id: string;
  symbol: string;
  yahooSymbol: string;
  targetPrice: number;
  tick: number;
  entryPrice: number;
  createdAt: number;
  active: boolean;
  hitAt?: number | null;
  hitPrice?: number | null;
  livePrice?: number | null;
  liveAt?: number | null;
  needsLeaveFirst?: boolean;
  hasLeftTarget?: boolean;
  awaySince?: number | null;
  abandonedAt?: number | null;
  abandonReason?: string | null;
  armedProbability?: number | null;
  armedHistTouch?: number | null;
  armedRank?: number | null;
};

export type AlertUserCtx = {
  id: string;
  email?: string | null;
  name?: string | null;
};

function safeText(s: string, max: number): string {
  return s.trim().slice(0, max);
}

/** Production = real Postgres (Neon). Preview uses PGLite + files. */
export function alertsUsePostgresPrimary(): boolean {
  return dbSource === "neon";
}

export function rowToAlert(r: AlertRow): AlertDTO {
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
    abandonReason: r.abandon_reason ?? undefined,
    armedProbability:
      r.armed_probability != null ? Number(r.armed_probability) : undefined,
    armedHistTouch:
      r.armed_hist_touch != null ? Number(r.armed_hist_touch) : undefined,
    armedRank: r.armed_rank != null ? Number(r.armed_rank) : undefined,
  };
}

async function readySql(): Promise<Sql | null> {
  try {
    await ensureDbReady({ retries: 3, delayMs: 150 });
    const sql = await getSql();
    await ensureUserDataSchema(sql);
    // account_key for multi-device identity (prod + preview)
    await sql
      .query(
        `alter table user_price_alerts add column if not exists account_key text`,
      )
      .catch(() => undefined);
    await sql
      .query(
        `create index if not exists user_price_alerts_account_key_idx on user_price_alerts (account_key)`,
      )
      .catch(() => undefined);
    return sql;
  } catch (e) {
    console.warn("[alerts-repo] SQL unavailable", e);
    return null;
  }
}

function scoreAlert(t: AlertDTO): number {
  return (
    Math.max(t.hitAt ?? 0, t.liveAt ?? 0, t.createdAt ?? 0) +
    (t.active ? 1e12 : 0)
  );
}

function mergeDtos(a: AlertDTO[], b: AlertDTO[]): AlertDTO[] {
  const byId = new Map<string, AlertDTO>();
  for (const x of [...a, ...b]) {
    const prev = byId.get(x.id);
    if (!prev) {
      byId.set(x.id, x);
      continue;
    }
    const winner = scoreAlert(x) >= scoreAlert(prev) ? x : prev;
    const loser = winner === x ? prev : x;
    byId.set(x.id, {
      ...loser,
      ...winner,
      hitAt: winner.hitAt ?? loser.hitAt,
      hitPrice: winner.hitPrice ?? loser.hitPrice,
      abandonedAt: winner.abandonedAt ?? loser.abandonedAt,
      abandonReason: winner.abandonReason ?? loser.abandonReason,
      armedProbability: winner.armedProbability ?? loser.armedProbability,
      armedHistTouch: winner.armedHistTouch ?? loser.armedHistTouch,
      armedRank: winner.armedRank ?? loser.armedRank,
      livePrice:
        (winner.liveAt ?? 0) >= (loser.liveAt ?? 0)
          ? (winner.livePrice ?? loser.livePrice)
          : (loser.livePrice ?? winner.livePrice),
      liveAt: Math.max(winner.liveAt ?? 0, loser.liveAt ?? 0) || undefined,
      active: !!(winner.hitAt || loser.hitAt)
        ? false
        : winner.active || loser.active,
    });
  }
  const byKey = new Map<string, AlertDTO>();
  for (const x of byId.values()) {
    const k = `${x.symbol.toUpperCase()}|${x.targetPrice}|${x.tick}`;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, x);
    else byKey.set(k, scoreAlert(x) >= scoreAlert(prev) ? x : prev);
  }
  return [...byKey.values()].sort(
    (p, q) => (q.hitAt ?? q.createdAt) - (p.hitAt ?? p.createdAt),
  );
}

async function listFromPg(user: AlertUserCtx): Promise<AlertDTO[]> {
  const sql = await readySql();
  if (!sql) return [];
  const keys = accountCloudKeyCandidates(user);
  try {
    // Multi-device: match any identity key OR this auth user id
    const rows = await sql.query<AlertRow>(
      `select * from user_price_alerts
       where user_id = $1
          or account_key = any($2::text[])
       order by created_at desc
       limit 200`,
      [user.id, keys],
    );
    return rows.map(rowToAlert);
  } catch (e) {
    // Fallback if account_key missing on very old schema
    try {
      const rows = await sql<AlertRow>`
        select * from user_price_alerts
        where user_id = ${user.id}
        order by created_at desc
        limit 200
      `;
      return rows.map(rowToAlert);
    } catch (e2) {
      console.warn("[alerts-repo] listFromPg", e2 ?? e);
      return [];
    }
  }
}

/** @deprecated use listAlertsForAccount */
export async function listAlertsForUser(userId: string): Promise<AlertDTO[]> {
  return listAlertsForAccount({ id: userId });
}

export async function listAlertsForAccount(
  user: AlertUserCtx,
): Promise<AlertDTO[]> {
  const fromPg = await listFromPg(user);

  // Production Postgres: SQL is source of truth (no ephemeral disk)
  if (alertsUsePostgresPrimary()) {
    return fromPg;
  }

  // Preview: merge file cloud + pglite
  const keys = accountCloudKeyCandidates(user);
  const fromFiles = loadMergedFromFiles(keys);
  return mergeDtos(fromFiles, fromPg);
}

/** @deprecated use saveAlertsForAccount */
export async function saveAlertsForUser(
  userId: string,
  alerts: AlertDTO[],
  allowEmpty = false,
): Promise<{ ok: true; count: number; skippedEmpty: boolean }> {
  return saveAlertsForAccount({ id: userId }, alerts, allowEmpty);
}

export async function saveAlertsForAccount(
  user: AlertUserCtx,
  alerts: AlertDTO[],
  allowEmpty = false,
): Promise<{
  ok: true;
  count: number;
  skippedEmpty: boolean;
  accountKey: string;
  backend: "postgres" | "pglite+files";
}> {
  const accountKey = accountCloudKey(user);
  const keys = accountCloudKeyCandidates(user);
  const usePgPrimary = alertsUsePostgresPrimary();

  const existing = await listAlertsForAccount(user);

  if (alerts.length === 0 && !allowEmpty) {
    if (existing.length > 0) {
      return {
        ok: true,
        count: existing.length,
        skippedEmpty: true,
        accountKey,
        backend: usePgPrimary ? "postgres" : "pglite+files",
      };
    }
  }

  const toWrite = mergeDtos(existing, alerts).slice(0, 120);

  // Preview: dual-write files for multi-device on single server
  if (!usePgPrimary) {
    for (const k of keys) {
      writeCloudBlob(k, toWrite, user.id, readCloudBlob(k));
    }
    if (alerts.length === 0 && allowEmpty) {
      writeCloudBlob(accountKey, [], user.id, readCloudBlob(accountKey));
    }
  }

  const sql = await readySql();
  if (sql) {
    try {
      for (const a of toWrite) {
        await sql`
          insert into user_price_alerts (
            id, user_id, account_key, symbol, yahoo_symbol, target_price, tick, entry_price,
            created_at, active, hit_at, hit_price, live_price, live_at,
            needs_leave_first, has_left_target, away_since, abandoned_at,
            abandon_reason, armed_probability, armed_hist_touch, armed_rank,
            updated_at
          ) values (
            ${a.id},
            ${user.id},
            ${accountKey},
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
            account_key = excluded.account_key,
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

      // Cleanup rows for this identity that are no longer in the merged set
      if (toWrite.length > 0) {
        const keepIds = toWrite.map((a) => a.id);
        await sql.query(
          `delete from user_price_alerts
           where (user_id = $1 or account_key = any($2::text[]))
             and id <> all($3::text[])`,
          [user.id, keys, keepIds],
        );
      } else if (allowEmpty) {
        await sql.query(
          `delete from user_price_alerts
           where user_id = $1 or account_key = any($2::text[])`,
          [user.id, keys],
        );
      }
    } catch (e) {
      console.warn("[alerts-repo] pg write failed", e);
      // Production must not silently succeed without PG
      if (usePgPrimary) throw e;
    }
  } else if (usePgPrimary) {
    throw new Error("DATABASE_UNAVAILABLE");
  }

  return {
    ok: true,
    count: toWrite.length,
    skippedEmpty: false,
    accountKey,
    backend: usePgPrimary ? "postgres" : "pglite+files",
  };
}
