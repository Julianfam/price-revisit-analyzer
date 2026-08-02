import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  coerceArmedProbability,
  coerceArmedRank,
  formatSignedPips,
  pipsSinceEntry,
  pipsToTarget,
  usePriceAlerts,
  type PriceAlert,
} from "@/lib/price-alerts";
import { formatPrice, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailSubscribe } from "@/components/email-subscribe";
import type { AccountSyncStatus } from "@/hooks/use-account-sync";
import {
  Bell,
  BellRing,
  CheckCircle2,
  Cloud,
  CloudOff,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

type Filter = "all" | "active" | "hit" | "stopped";

export type AlertsLogProps = {
  syncStatus?: AccountSyncStatus;
  isCloud?: boolean;
  onSyncNow?: () => void;
  cloudCount?: number | null;
};


function ProbCell({
  alert,
  t,
}: {
  alert: PriceAlert;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const p = coerceArmedProbability(alert.armedProbability);
  const rank = coerceArmedRank(alert.armedRank);
  if (p == null) {
    return (
      <span
        className="text-[11px] text-muted-fg"
        title={t.alertColProbHint ?? "Re-arm from Top 3 to capture P%"}
      >
        —
      </span>
    );
  }
  const band =
    p >= 40 ? "high" : p >= 25 ? "mid" : "low";
  const color =
    band === "high"
      ? "text-bull bg-bull/15 border-bull/30"
      : band === "mid"
        ? "text-teal bg-teal/15 border-teal/30"
        : "text-muted-fg bg-muted/50 border-border";
  const label =
    band === "high"
      ? (t.alertProbHigh ?? "High")
      : band === "mid"
        ? (t.alertProbMid ?? "Mid")
        : (t.alertProbLow ?? "Low");
  return (
    <div className="min-w-[4.5rem]">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs font-semibold tabular",
          color,
        )}
        title={t.alertColProbHint ?? "Probability when the alert was armed"}
      >
        {p.toFixed(0)}%
        {rank != null && (
          <span className="text-[10px] font-normal opacity-80">#{rank}</span>
        )}
      </span>
      <span className="mt-0.5 block text-[10px] text-muted-fg">{label}</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remS = sec % 60;
  if (min < 60) return remS > 0 ? `${min}m ${remS}s` : `${min}m`;
  const hrs = Math.floor(min / 60);
  const remM = min % 60;
  if (hrs < 48) return remM > 0 ? `${hrs}h ${remM}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remH = hrs % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

function fill(
  template: string | undefined,
  vars: Record<string, string>,
  fallback: string,
): string {
  let s = template ?? fallback;
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{${k}}`).join(v);
  }
  return s;
}

/** Absolute pips display (always ≥ 0). */
function formatAbsPips(pips: number, digits = 1): string {
  if (!Number.isFinite(pips)) return "—";
  const a = Math.abs(pips);
  const d = a >= 100 ? 0 : digits;
  return a.toFixed(d);
}

/**
 * Pips traveled on a reached alert: |entry → hit price| (or entry→live if hit
 * price missing). Always positive; only meaningful when the alert has hit.
 */
function reachedMovePips(alert: PriceAlert): number | null {
  if (!alert.hitAt) return null;
  // Prefer explicit hit price; fall back to live
  const hitPx = alert.hitPrice ?? alert.livePrice;
  if (hitPx == null || !Number.isFinite(hitPx)) {
    const m = pipsSinceEntry(alert);
    return m != null && Number.isFinite(m) ? Math.abs(m) : null;
  }
  const m = pipsSinceEntry(alert, hitPx);
  return m != null && Number.isFinite(m) ? Math.abs(m) : null;
}

export function AlertsLog({
  syncStatus = "guest",
  isCloud = false,
  onSyncNow,
  cloudCount = null,
}: AlertsLogProps = {}) {
  const { t, lang } = useI18n();
  const alerts = usePriceAlerts((s) => s.alerts);
  const removeAlert = usePriceAlerts((s) => s.removeAlert);
  const deactivate = usePriceAlerts((s) => s.deactivate);
  const clearHitHistory = usePriceAlerts((s) => s.clearHitHistory);
  const clearAll = usePriceAlerts((s) => s.clearAll);
  const [filter, setFilter] = useState<Filter>("all");

  const locale = lang === "es" ? "es" : "en";

  const counts = useMemo(() => {
    const active = alerts.filter((a) => a.active).length;
    const hit = alerts.filter((a) => a.hitAt).length;
    const stopped = alerts.filter((a) => !a.active && !a.hitAt).length;
    return { active, hit, stopped, all: alerts.length };
  }, [alerts]);

  /**
   * Σ pips = only REACHED (hit) alerts, each |entry→hit| counted positive, then summed.
   * Active / watching alerts do NOT count until they hit.
   */
  const pipsTotals = useMemo(() => {
    let volume = 0;
    let hitN = 0;
    for (const a of alerts) {
      if (!a.hitAt) continue;
      const move = reachedMovePips(a);
      if (move == null) continue;
      volume += move;
      hitN += 1;
    }
    return { volume, hitN };
  }, [alerts]);

  const rows = useMemo(() => {
    let list = [...alerts];
    if (filter === "active") list = list.filter((a) => a.active);
    if (filter === "hit") list = list.filter((a) => !!a.hitAt);
    if (filter === "stopped")
      list = list.filter((a) => !a.active && !a.hitAt);
    return list.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const ta = a.hitAt ?? a.createdAt;
      const tb = b.hitAt ?? b.createdAt;
      return tb - ta;
    });
  }, [alerts, filter]);

  const pipsUnit = t.alertPipsUnit ?? "pips";
  const volumeStr = formatAbsPips(pipsTotals.volume);

  return (
    <Card className="rounded-xl overflow-hidden border-accent-soft/30">
      <div className="h-0.5 w-full bg-gradient-to-r from-accent-soft via-teal to-bull" />
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft/15 text-accent-soft">
                  <Bell className="size-4" />
                </span>
                {t.alertLogTitle}
              </CardTitle>
              <button
                type="button"
                onClick={() => onSyncNow?.()}
                disabled={
                  !isCloud &&
                  syncStatus !== "error" &&
                  syncStatus !== "local" &&
                  syncStatus !== "synced" &&
                  syncStatus !== "syncing"
                }
                className={cn(
                  "inline-flex max-w-[min(100%,16rem)] items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  syncStatus === "synced"
                    ? "border-teal/40 bg-teal/10 text-teal"
                    : syncStatus === "syncing"
                      ? "border-border bg-muted/40 text-muted-fg"
                      : syncStatus === "error" || syncStatus === "local"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                        : "border-border bg-muted/30 text-muted-fg",
                )}
                title={
                  syncStatus === "synced" || syncStatus === "error" || syncStatus === "local"
                    ? (t.alertSyncNow ?? "Sync now")
                    : (t.alertSyncGuest ?? "Sign in to sync")
                }
              >
                {syncStatus === "syncing" ? (
                  <Loader2 className="size-3 shrink-0 animate-spin" />
                ) : syncStatus === "synced" ? (
                  <Cloud className="size-3 shrink-0" />
                ) : syncStatus === "error" || syncStatus === "local" ? (
                  <RefreshCw className="size-3 shrink-0" />
                ) : (
                  <CloudOff className="size-3 shrink-0" />
                )}
                <span className="truncate">
                  {syncStatus === "syncing"
                    ? (t.alertSyncSyncing ?? "Syncing…")
                    : syncStatus === "error"
                      ? (t.alertSyncError ?? "Sync error · tap to retry")
                      : syncStatus === "local"
                        ? (t.alertSyncLocal ??
                          "On this device · tap to retry cloud")
                        : syncStatus === "synced"
                          ? cloudCount != null
                            ? lang === "es"
                              ? `Nube · ${cloudCount} alertas`
                              : `Cloud · ${cloudCount} alerts`
                            : (t.alertSyncCloud ?? "Cloud · PC & mobile")
                          : (t.alertSyncGuest ?? "Local only · sign in")}
                </span>
              </button>
              <Badge
                className={cn(
                  "border-0 font-mono text-xs font-semibold tabular",
                  pipsTotals.hitN > 0
                    ? "bg-bull/15 text-bull"
                    : "bg-muted text-muted-fg",
                )}
                title={
                  t.alertPipsReachedHint ??
                  "Sum of |entry→hit| pips on reached alerts only (all positive)"
                }
              >
                Σ {volumeStr} {pipsUnit}
              </Badge>
              {pipsTotals.hitN > 0 && (
                <span className="text-[11px] text-muted-fg">
                  {fill(
                    t.alertPipsReachedLine,
                    { vol: volumeStr, n: String(pipsTotals.hitN) },
                    lang === "es"
                      ? `${pipsTotals.hitN} alcanzadas · movimiento ${volumeStr}`
                      : `${pipsTotals.hitN} reached · move ${volumeStr}`,
                  )}
                </span>
              )}
            </div>
            <CardDescription className="mt-1.5 max-w-xl">
              {t.alertLogDesc}
            </CardDescription>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
              <Badge className="border-0 bg-accent-soft/20 text-accent-soft">
                {counts.active} {t.alertActive}
              </Badge>
              <Badge className="border-0 bg-bull/15 text-bull">
                {counts.hit} {t.alertHitCount}
              </Badge>
              <Badge variant="outline" className="text-muted-fg">
                {counts.all} {t.alertTotal}
              </Badge>
            </div>
            <div className="w-full max-w-[16.5rem] sm:w-[16.5rem]">
              <EmailSubscribe />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {(
              [
                ["all", t.alertFilterAll],
                ["active", t.alertFilterActive],
                ["hit", t.alertFilterHit],
                ["stopped", t.alertFilterStopped ?? "Stopped"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === key
                    ? "bg-teal/20 text-teal"
                    : "text-muted-fg hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-fg"
              onClick={() => clearHitHistory()}
              disabled={counts.hit === 0}
            >
              {t.alertClearHits}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-bear"
              onClick={() => clearAll()}
              disabled={counts.all === 0}
            >
              <Trash2 className="size-3.5" />
              {t.alertClearAll}
            </Button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/30 px-3 py-5 text-center text-sm text-muted-fg">
            {t.alertLogEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/80">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border bg-surface/60 text-[11px] uppercase tracking-wide text-muted-fg">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.alertColStatus}</th>
                  <th className="px-3 py-2 font-medium">{t.symbol}</th>
                  <th className="px-3 py-2 font-medium">{t.alertColTarget}</th>
                  <th className="px-3 py-2 font-medium">{t.alertColProb ?? "P%"}</th>
                  <th className="px-3 py-2 font-medium">{t.alertColCurrent}</th>
                  <th className="px-3 py-2 font-medium">{t.alertColEntry}</th>
                  <th className="px-3 py-2 font-medium">{t.alertColPips}</th>
                  <th className="px-3 py-2 font-medium">{t.alertColCreated}</th>
                  <th className="px-3 py-2 font-medium">{t.alertColHit}</th>
                  <th className="px-3 py-2 font-medium text-right">{t.alertColActions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <AlertTableRow
                    key={a.id}
                    alert={a}
                    locale={locale}
                    t={t}
                    onStop={() => deactivate(a.id)}
                    onRemove={() => removeAlert(a.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertTableRow({
  alert,
  locale,
  t,
  onStop,
  onRemove,
}: {
  alert: PriceAlert;
  locale: string;
  t: ReturnType<typeof useI18n>["t"];
  onStop: () => void;
  onRemove: () => void;
}) {
  const status = alert.active
    ? "active"
    : alert.hitAt
      ? "hit"
      : alert.abandonedAt
        ? "abandoned"
        : "stopped";
  const moved = pipsSinceEntry(alert);
  const remaining = alert.active ? pipsToTarget(alert) : null;
  const reached = reachedMovePips(alert);
  const movedStr = formatSignedPips(moved);
  const movedColor =
    moved == null
      ? "text-muted-fg"
      : moved > 0
        ? "text-bull"
        : moved < 0
          ? "text-bear"
          : "text-muted-fg";

  const entry =
    alert.entryPrice != null && Number.isFinite(alert.entryPrice)
      ? alert.entryPrice
      : null;

  const current = alert.active
    ? (alert.livePrice ?? entry)
    : (alert.hitPrice ?? alert.livePrice ?? null);

  const vsTarget = current != null ? current - alert.targetPrice : null;
  const vsTargetColor =
    vsTarget == null
      ? "text-muted-fg"
      : Math.abs(vsTarget) <= (alert.tick || 0) * 0.5
        ? "text-bull"
        : vsTarget < 0
          ? "text-bear"
          : "text-bull";

  const timeToHitMs =
    alert.hitAt != null && alert.createdAt != null
      ? Math.max(0, alert.hitAt - alert.createdAt)
      : null;

  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/20">
      <td className="px-3 py-2.5">
        {status === "active" && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-soft">
            <BellRing className="size-3.5" />
            {t.alertWatching}
          </span>
        )}
        {status === "hit" && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-bull">
            <CheckCircle2 className="size-3.5" />
            {t.alertHitLabel}
          </span>
        )}
        {status === "abandoned" && (
          <span className="inline-flex flex-col gap-0.5 text-xs font-medium text-rank1">
            <span>
              {alert.abandonReason === "expired"
                ? (t.alertAbandonExpired ?? "Expired")
                : (t.alertAbandoned ?? "Stopped")}
            </span>
            <span className="font-normal text-muted-fg">
              {alert.abandonReason === "expired"
                ? "TTL 7d · no hit"
                : alert.abandonReason === "too_far" ||
                    alert.abandonReason === "away_timeout"
                  ? "legacy"
                  : ""}
            </span>
          </span>
        )}
        {status === "stopped" && (
          <span className="text-xs text-muted-fg">{t.alertStopped}</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className="font-mono text-xs font-semibold text-foreground">
          {alert.symbol}
        </span>
        <span className="mt-0.5 block text-[10px] text-muted-fg">
          {alert.yahooSymbol}
        </span>
      </td>
      <td className="px-3 py-2.5 font-mono tabular text-foreground">
        {formatPrice(alert.targetPrice, alert.tick)}
      </td>
      <td className="px-3 py-2.5">
        <ProbCell alert={alert} t={t} />
      </td>
      <td className="px-3 py-2.5">
        {current != null ? (
          <div>
            <span className={cn("font-mono text-sm font-semibold tabular", vsTargetColor)}>
              {formatPrice(current, alert.tick)}
            </span>
            {alert.active && (
              <span className="mt-0.5 block text-[10px] text-accent-soft">
                {t.alertLive}
                {alert.liveAt
                  ? ` · ${new Date(alert.liveAt).toLocaleTimeString(locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}`
                  : ""}
              </span>
            )}
            {!alert.active && alert.hitAt && (
              <span className="mt-0.5 block text-[10px] text-muted-fg">
                {t.alertHitLabel}
              </span>
            )}
            {vsTarget != null && alert.active && (
              <span className="mt-0.5 block font-mono text-[10px] tabular text-muted-fg">
                Δ obj {formatPrice(vsTarget, alert.tick)}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-fg">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 font-mono tabular text-muted-fg">
        {entry != null ? formatPrice(entry, alert.tick) : "—"}
      </td>
      <td className="px-3 py-2.5">
        <span className={cn("font-mono text-sm font-semibold tabular", movedColor)}>
          {movedStr}
          <span className="ml-0.5 text-[10px] font-normal text-muted-fg">
            {t.alertPipsUnit}
          </span>
        </span>
        {reached != null && (
          <span className="mt-0.5 block font-mono text-[10px] tabular text-bull">
            +{formatAbsPips(reached)} {t.alertPipsUnit} Σ
          </span>
        )}
        {remaining != null && alert.active && (
          <span className="mt-0.5 block text-[10px] tabular text-muted-fg">
            {t.alertPipsLeft} {formatSignedPips(remaining)}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs tabular text-muted-fg">
        {new Date(alert.createdAt).toLocaleString(locale, {
          dateStyle: "short",
          timeStyle: "short",
        })}
      </td>
      <td className="px-3 py-2.5 text-xs tabular">
        {alert.hitAt ? (
          <div>
            <span className="font-medium text-bull">
              {new Date(alert.hitAt).toLocaleString(locale, {
                dateStyle: "medium",
                timeStyle: "medium",
              })}
            </span>
            {timeToHitMs != null && (
              <span className="mt-0.5 block font-semibold tabular text-accent-soft">
                {t.alertTimeToHit} {formatDuration(timeToHitMs)}
              </span>
            )}
            {alert.hitPrice != null && (
              <span className="mt-0.5 block font-mono text-[10px] text-muted-fg">
                @ {formatPrice(alert.hitPrice, alert.tick)}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-fg">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="inline-flex gap-1">
          {alert.active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-fg"
              onClick={onStop}
            >
              {t.alertDisarm}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-bear"
            onClick={onRemove}
            aria-label={t.alertRemove}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
