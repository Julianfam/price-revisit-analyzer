import { create } from "zustand";
import { persist } from "zustand/middleware";
import { pipSize } from "@/lib/analyzer/pips";

export type AbandonReason = "too_far" | "away_timeout" | "expired";

/** Alerts stay open while price drifts — only expire by calendar time. */
export const ALERT_TTL_DAYS = 7;
export const ALERT_MAX_AGE_MS = ALERT_TTL_DAYS * 24 * 60 * 60_000;
/** @deprecated kept for old history rows; distance-stop is disabled. */
export const ALERT_AWAY_TIMEOUT_MS = ALERT_MAX_AGE_MS;
/** @deprecated no short grace kill */
export const ALERT_ABANDON_GRACE_MS = 0;

export type PriceAlert = {
  id: string;
  symbol: string;
  yahooSymbol: string;
  targetPrice: number;
  tick: number;
  entryPrice: number;
  createdAt: number;
  active: boolean;
  hitAt?: number;
  hitPrice?: number;
  livePrice?: number;
  liveAt?: number;
  needsLeaveFirst?: boolean;
  hasLeftTarget?: boolean;
  awaySince?: number | null;
  abandonedAt?: number;
  abandonReason?: AbandonReason;
  armedProbability?: number;
  armedHistTouch?: number;
  armedRank?: number;
};

type LivePatch = Partial<Pick<PriceAlert, "hasLeftTarget" | "awaySince">>;

export function coerceArmedProbability(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

export function coerceArmedRank(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.round(n);
}

type AlertState = {
  alerts: PriceAlert[];
  addAlert: (
    input: Omit<
      PriceAlert,
      | "id"
      | "createdAt"
      | "active"
      | "hitAt"
      | "hitPrice"
      | "livePrice"
      | "liveAt"
      | "needsLeaveFirst"
      | "hasLeftTarget"
      | "awaySince"
      | "abandonedAt"
      | "abandonReason"
    >,
  ) => PriceAlert;
  removeAlert: (id: string) => void;
  deactivate: (id: string) => void;
  markHit: (id: string, hitAt: number, hitPrice: number) => void;
  markAbandoned: (
    id: string,
    at: number,
    reason: AbandonReason,
    livePrice?: number,
  ) => void;
  updateLive: (
    id: string,
    livePrice: number,
    liveAt: number,
    patch?: LivePatch,
  ) => void;
  replaceAll: (alerts: PriceAlert[]) => void;
  clearHitHistory: () => void;
  clearAll: () => void;
  getActiveForSymbol: (symbol: string) => PriceAlert[];
  isWatching: (symbol: string, targetPrice: number, tick: number) => boolean;
  findActive: (
    symbol: string,
    targetPrice: number,
    tick: number,
  ) => PriceAlert | undefined;
};

function alertKey(symbol: string, target: number, tick: number) {
  const decimals =
    tick >= 1 ? 0 : Math.min(8, Math.max(0, Math.ceil(-Math.log10(tick))));
  return `${symbol.toUpperCase()}:${target.toFixed(decimals)}`;
}

export function alertPipSize(yahooSymbol: string, tick: number): number {
  return pipSize(yahooSymbol, tick);
}

export function pipsSinceEntry(

  alert: PriceAlert,
  refPrice?: number,
): number | null {
  const ref = refPrice ?? alert.hitPrice ?? alert.livePrice;
  if (ref == null || !Number.isFinite(alert.entryPrice)) return null;
  const ps = pipSize(alert.yahooSymbol, alert.tick);
  if (!(ps > 0)) return null;
  return (ref - alert.entryPrice) / ps;
}

export function pipsToTarget(
  alert: PriceAlert,
  refPrice?: number,
): number | null {
  const ref =
    refPrice ?? alert.hitPrice ?? alert.livePrice ?? alert.entryPrice;
  if (!Number.isFinite(ref)) return null;
  const ps = pipSize(alert.yahooSymbol, alert.tick);
  if (!(ps > 0)) return null;
  return (alert.targetPrice - ref) / ps;
}

export function distToTargetPips(
  alert: PriceAlert,
  price: number,
): number | null {
  const ps = pipSize(alert.yahooSymbol, alert.tick);
  if (!(ps > 0) || !Number.isFinite(price)) return null;
  return Math.abs(alert.targetPrice - price) / ps;
}

export function formatSignedPips(pips: number | null, digits = 1): string {
  if (pips == null || !Number.isFinite(pips)) return "—";
  const d = Math.abs(pips) >= 100 ? 0 : digits;
  const v = pips.toFixed(d);
  if (pips > 0) return `+${v}`;
  return v;
}

export function onTargetTol(tick: number): number {
  return Math.max(tick * 0.5, Number.EPSILON);
}

export function isOnTarget(
  price: number,
  target: number,
  tick: number,
): boolean {
  return Math.abs(price - target) <= onTargetTol(tick);
}

export function evaluateAbandon(
  alert: PriceAlert,
  livePrice: number,
  now = Date.now(),
): {
  abandon: boolean;
  reason?: AbandonReason;
  awaySince: number | null;
} {
  if (!alert.active || alert.hitAt) {
    return { abandon: false, awaySince: alert.awaySince ?? null };
  }

  // Track "away" only for display / analytics — never stop because price drifted.
  // Revisits often happen after a deep excursion; killing on distance was wrong.
  const onSpot = isOnTarget(livePrice, alert.targetPrice, alert.tick);
  const awaySince = onSpot ? null : (alert.awaySince ?? now);

  // Sole auto-stop: full calendar TTL (default 7 days) without a hit
  const age = now - alert.createdAt;
  if (age >= ALERT_MAX_AGE_MS) {
    return {
      abandon: true,
      reason: "expired",
      awaySince,
    };
  }

  return { abandon: false, awaySince };
}

export function detectAlertHit(
  alert: PriceAlert,
  bars: { t: number; h: number; l: number; c: number }[],
  last: number,
  now = Date.now(),
): {
  hit: boolean;
  hitAt?: number;
  hitPrice?: number;
  leftTarget: boolean;
} {
  if (!alert.active || alert.hitAt) {
    return { hit: false, leftTarget: !!alert.hasLeftTarget };
  }
  const tol = onTargetTol(alert.tick);
  const target = alert.targetPrice;

  let left = alert.hasLeftTarget ?? !alert.needsLeaveFirst;
  if (alert.needsLeaveFirst && !left) {
    if (!isOnTarget(last, target, alert.tick)) left = true;
  }

  if (!left && alert.needsLeaveFirst) {
    for (const b of bars) {
      if (b.t < alert.createdAt) continue;
      if (b.l - tol > target || target > b.h + tol) {
        left = true;
        break;
      }
    }
    if (!left) return { hit: false, leftTarget: false };
  }

  for (const b of bars) {
    if (b.t < alert.createdAt) continue;
    if (b.l - tol <= target && target <= b.h + tol) {
      const hitPrice =
        Math.abs(b.c - target) <= tol
          ? b.c
          : Math.abs(b.h - target) < Math.abs(b.l - target)
            ? b.h
            : b.l;
      return {
        hit: true,
        hitAt: Math.max(b.t, alert.createdAt),
        hitPrice,
        leftTarget: true,
      };
    }
  }

  if (left && isOnTarget(last, target, alert.tick)) {
    return {
      hit: true,
      hitAt: now,
      hitPrice: last,
      leftTarget: true,
    };
  }
  return { hit: false, leftTarget: left };
}

export function fireBrowserNotification(title: string, body: string): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    /* ignore */
  }
}

export async function requestAlertPermission(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const p = await Notification.requestPermission();
    return p === "granted";
  } catch {
    return false;
  }
}

export function normalizeAlert(raw: PriceAlert): PriceAlert {
  return {
    ...raw,
    symbol: String(raw.symbol || "").toUpperCase(),
    yahooSymbol: String(raw.yahooSymbol || raw.symbol || ""),
    targetPrice: Number(raw.targetPrice),
    tick: Number(raw.tick) || 0.0001,
    entryPrice: Number(raw.entryPrice),
    createdAt: Number(raw.createdAt) || Date.now(),
    active: !!raw.active,
    armedProbability: coerceArmedProbability(raw.armedProbability),
    armedHistTouch: coerceArmedProbability(raw.armedHistTouch),
    armedRank: coerceArmedRank(raw.armedRank),
  };
}

function newId(): string {
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const usePriceAlerts = create<AlertState>()(
  persist(
    (set, get) => ({
      alerts: [],
      addAlert: (input) => {
        const onSpot = isOnTarget(
          input.entryPrice,
          input.targetPrice,
          input.tick,
        );
        const alert: PriceAlert = {
          ...input,
          id: newId(),
          createdAt: Date.now(),
          active: true,
          needsLeaveFirst: onSpot,
          hasLeftTarget: !onSpot,
          awaySince: onSpot ? null : Date.now(),
        };
        set((s) => ({
          alerts: [alert, ...s.alerts].slice(0, 120),
        }));
        return alert;
      },
      removeAlert: (id) =>
        set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),
      deactivate: (id) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id ? { ...a, active: false } : a,
          ),
        })),
      markHit: (id, hitAt, hitPrice) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id
              ? {
                  ...a,
                  active: false,
                  hitAt,
                  hitPrice,
                  livePrice: hitPrice,
                  liveAt: hitAt,
                }
              : a,
          ),
        })),
      markAbandoned: (id, at, reason, livePrice) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id
              ? {
                  ...a,
                  active: false,
                  abandonedAt: at,
                  abandonReason: reason,
                  livePrice: livePrice ?? a.livePrice,
                  liveAt: at,
                }
              : a,
          ),
        })),
      updateLive: (id, livePrice, liveAt, patch) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id ? { ...a, livePrice, liveAt, ...patch } : a,
          ),
        })),
      replaceAll: (alerts) =>
        set({ alerts: alerts.map(normalizeAlert).slice(0, 120) }),
      clearHitHistory: () =>
        set((s) => ({
          alerts: s.alerts.filter((a) => a.active || !a.hitAt),
        })),
      clearAll: () => set({ alerts: [] }),
      getActiveForSymbol: (symbol) =>
        get().alerts.filter(
          (a) => a.active && a.symbol.toUpperCase() === symbol.toUpperCase(),
        ),
      isWatching: (symbol, targetPrice, tick) =>
        !!get().findActive(symbol, targetPrice, tick),
      findActive: (symbol, targetPrice, tick) => {
        const k = alertKey(symbol, targetPrice, tick);
        return get().alerts.find(
          (a) =>
            a.active && alertKey(a.symbol, a.targetPrice, a.tick) === k,
        );
      },
    }),
    { name: "pra-price-alerts-v3" },
  ),
);
