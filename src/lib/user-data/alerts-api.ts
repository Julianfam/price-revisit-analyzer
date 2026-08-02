/**
 * Client REST helpers for cloud alerts (PC ↔ mobile).
 */
import { getBearerToken } from "@/lib/auth/client";
import type { PriceAlert } from "@/lib/price-alerts";

function authHeaders(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  let t = getBearerToken();
  if (t && t.includes(".") && t.split(".").length === 2) {
    const raw = t.split(".")[0];
    if (raw && raw.length >= 16) t = raw;
  }
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function waitForToken(ms = 5000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const t = getBearerToken();
    if (t) return t;
    await new Promise((r) => setTimeout(r, 100));
  }
  return getBearerToken();
}

export type AlertsFetchResult = {
  alerts: PriceAlert[];
  count: number;
  userId?: string;
  accountKey?: string;
  userLabel?: string;
};

export async function fetchMyAlertsDetailed(): Promise<AlertsFetchResult> {
  await waitForToken(4000);
  const res = await fetch("/api/user/alerts", {
    method: "GET",
    credentials: "include",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `list_failed_${res.status}`);
  }
  const data = (await res.json()) as {
    alerts?: PriceAlert[];
    count?: number;
    userId?: string;
    accountKey?: string;
    userLabel?: string;
  };
  const alerts = Array.isArray(data.alerts) ? data.alerts : [];
  return {
    alerts,
    count: data.count ?? alerts.length,
    userId: data.userId,
    accountKey: data.accountKey,
    userLabel: data.userLabel,
  };
}

export async function fetchMyAlerts(): Promise<PriceAlert[]> {
  const r = await fetchMyAlertsDetailed();
  return r.alerts;
}

export async function pushMyAlerts(
  alerts: PriceAlert[],
  allowEmpty = false,
): Promise<{
  ok: boolean;
  count: number;
  skippedEmpty?: boolean;
  accountKey?: string;
  userId?: string;
}> {
  await waitForToken(4000);
  const res = await fetch("/api/user/alerts", {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    cache: "no-store",
    body: JSON.stringify({
      allowEmpty,
      alerts: alerts.map((a) => ({
        id: a.id,
        symbol: a.symbol,
        yahooSymbol: a.yahooSymbol,
        targetPrice: a.targetPrice,
        tick: a.tick,
        entryPrice: a.entryPrice,
        createdAt: a.createdAt,
        active: a.active,
        hitAt: a.hitAt ?? null,
        hitPrice: a.hitPrice ?? null,
        livePrice: a.livePrice ?? null,
        liveAt: a.liveAt ?? null,
        needsLeaveFirst: a.needsLeaveFirst ?? false,
        hasLeftTarget: a.hasLeftTarget ?? false,
        awaySince: a.awaySince ?? null,
        abandonedAt: a.abandonedAt ?? null,
        abandonReason: a.abandonReason ?? null,
        armedProbability: a.armedProbability ?? null,
        armedHistTouch: a.armedHistTouch ?? null,
        armedRank: a.armedRank ?? null,
      })),
    }),
  });
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `save_failed_${res.status}`);
  }
  return (await res.json()) as {
    ok: boolean;
    count: number;
    skippedEmpty?: boolean;
    accountKey?: string;
    userId?: string;
  };
}
