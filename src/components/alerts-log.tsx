import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  applyBackup,
  downloadBackup,
  getLastExportAt,
  readBackupFile,
} from "@/lib/local-backup";
import { formatPrice, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmailSubscribe } from "@/components/email-subscribe";
import type { AccountSyncStatus } from "@/hooks/use-account-sync";
import {
  Bell,
  BellRing,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

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
  const band = p >= 40 ? "high" : p >= 25 ? "mid" : "low";
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

function formatAbsPips(pips: number, digits = 1): string {
  if (!Number.isFinite(pips)) return "—";
  const a = Math.abs(pips);
  const d = a >= 100 ? 0 : digits;
  return a.toFixed(d);
}

function reachedMovePips(alert: PriceAlert): number | null {
  if (!alert.hitAt) return null;
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
  const es = lang === "es";
  const alerts = usePriceAlerts((s) => s.alerts);
  const removeAlert = usePriceAlerts((s) => s.removeAlert);
  const deactivate = usePriceAlerts((s) => s.deactivate);
  const clearHitHistory = usePriceAlerts((s) => s.clearHitHistory);
  const clearAll = usePriceAlerts((s) => s.clearAll);
  const [filter, setFilter] = useState<Filter>("all");
  const [importing, setImporting] = useState(false);
  const [lastExportAt, setLastExportAt] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLastExportAt(getLastExportAt());
  }, [alerts.length]);

  const locale = lang === "es" ? "es" : "en";

  const counts = useMemo(() => {
    const active = alerts.filter((a) => a.active).length;
    const hit = alerts.filter((a) => a.hitAt).length;
    const stopped = alerts.filter((a) => !a.active && !a.hitAt).length;
    return { active, hit, stopped, all: alerts.length };
  }, [alerts]);

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

  const onExport = () => {
    try {
      downloadBackup();
      setLastExportAt(Date.now());
      toast.success(
        es
          ? "Backup descargado · guárdalo en Drive/USB"
          : "Backup downloaded · keep it on Drive/USB",
      );
    } catch {
      toast.error(es ? "No se pudo exportar" : "Could not export");
    }
  };

  const onPickImport = () => fileRef.current?.click();

  const onFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    try {
      const backup = await readBackupFile(file);
      if (backup.alerts.length === 0) {
        toast.error(es ? "El archivo no tiene alertas" : "File has no alerts");
        return;
      }
      let restoreMode: "merge" | "replace" = "replace";
      if (alerts.length > 0) {
        const replace = window.confirm(
          es
            ? `¿Reemplazar las ${alerts.length} alertas locales por las ${backup.alerts.length} del archivo?\n\nAceptar = reemplazar\nCancelar = fusionar (recomendado)`
            : `Replace ${alerts.length} local alerts with ${backup.alerts.length} from file?\n\nOK = replace\nCancel = merge (recommended)`,
        );
        restoreMode = replace ? "replace" : "merge";
      }
      const n = applyBackup(backup, restoreMode);
      toast.success(
        es
          ? `Restauradas · ${n} alertas (${restoreMode === "merge" ? "fusión" : "reemplazo"})`
          : `Restored · ${n} alerts (${restoreMode})`,
      );
    } catch {
      toast.error(
        es
          ? "Archivo inválido · usa un backup .json de esta app"
          : "Invalid file · use a .json backup from this app",
      );
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

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
                  syncStatus === "synced" ||
                  syncStatus === "error" ||
                  syncStatus === "local"
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
                          : es
                            ? "Solo este dispositivo"
                            : "This device only"}
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
              <span className="mt-1 block text-[11px] text-muted-fg">
                {es
                  ? "Cerrar la web no borra alertas (quedan en el navegador). Exporta un .json si cambias de PC o limpias datos."
                  : "Closing the tab keeps alerts (browser storage). Export a .json if you switch PCs or clear site data."}
                {lastExportAt
                  ? es
                    ? ` Último backup: ${new Date(lastExportAt).toLocaleString(locale)}.`
                    : ` Last backup: ${new Date(lastExportAt).toLocaleString(locale)}.`
                  : es
                    ? " Aún no has exportado un backup."
                    : " No file backup yet."}
              </span>
            </CardDescription>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
              <Badge className="border-0 bg-accent-soft/20 text-accent-soft">
                {counts.active} {t.alertActive}
              </Badge>
              <Badge variant="outline" className="text-muted-fg">
                {counts.hit} {t.alertHitCount}
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={onExport}
                disabled={alerts.length === 0}
                title={
                  es
                    ? "Descargar archivo .json de alertas"
                    : "Download alerts .json file"
                }
              >
                <Download className="size-3.5" />
                {es ? "Exportar" : "Export"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={onPickImport}
                disabled={importing}
                title={
                  es
                    ? "Restaurar desde archivo .json"
                    : "Restore from .json file"
                }
              >
                {importing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                {es ? "Importar" : "Import"}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 sm:justify-end">
              {(
                [
                  ["all", t.alertFilterAll],
                  ["active", t.alertFilterActive],
                  ["hit", t.alertFilterHit],
                  ["stopped", t.alertFilterStopped],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                    filter === key
                      ? "bg-teal/20 text-teal"
                      : "text-muted-fg hover:bg-muted/40",
                  )}
                >
                  {label}
                </button>
              ))}
              {counts.hit > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-muted-fg"
                  onClick={() => clearHitHistory()}
                >
                  {t.alertClearHits}
                </Button>
              )}
              {alerts.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-bear"
                  onClick={() => {
                    if (
                      window.confirm(
                        es
                          ? "¿Borrar todas las alertas de este dispositivo?"
                          : "Delete all alerts on this device?",
                      )
                    ) {
                      clearAll();
                    }
                  }}
                >
                  <Trash2 className="mr-1 size-3" />
                  {t.alertClearAll}
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <EmailSubscribe />
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-fg">
            {es
              ? "Sin alertas. Ármalas desde Top 3 precios próximos."
              : "No alerts yet. Arm them from Top 3 next prices."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-fg">
                <tr>
                  <th className="px-2 py-2 font-medium">
                    {es ? "Símbolo" : "Symbol"}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t.alertColTarget}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t.alertColProb}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t.alertColStatus}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t.alertColPips}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t.alertColCreated}
                  </th>
                  <th className="px-2 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const move = reachedMovePips(a);
                  const toGo =
                    a.active && a.livePrice != null
                      ? pipsToTarget(a, a.livePrice)
                      : null;
                  const sinceEntry =
                    a.livePrice != null ? pipsSinceEntry(a, a.livePrice) : null;
                  return (
                    <tr
                      key={a.id}
                      className="border-t border-border/80 hover:bg-muted/20"
                    >
                      <td className="px-2 py-2 font-semibold">{a.symbol}</td>
                      <td className="px-2 py-2 font-mono tabular">
                        {formatPrice(a.targetPrice, a.tick)}
                        {a.livePrice != null && (
                          <span className="mt-0.5 block text-[10px] text-muted-fg">
                            now {formatPrice(a.livePrice, a.tick)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <ProbCell alert={a} t={t} />
                      </td>
                      <td className="px-2 py-2">
                        {a.hitAt ? (
                          <span className="inline-flex items-center gap-1 text-bull">
                            <CheckCircle2 className="size-3.5" />
                            {t.alertHitLabel}
                          </span>
                        ) : a.active ? (
                          <span className="inline-flex items-center gap-1 text-teal">
                            <BellRing className="size-3.5" />
                            {t.alertActive}
                          </span>
                        ) : (
                          <span className="text-muted-fg">
                            {t.alertStopped}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono tabular">
                        {a.hitAt && move != null
                          ? `+${formatAbsPips(move)}`
                          : sinceEntry != null
                            ? formatSignedPips(sinceEntry)
                            : toGo != null
                              ? `${formatAbsPips(toGo)} left`
                              : "—"}
                      </td>
                      <td className="px-2 py-2 text-muted-fg">
                        {a.hitAt ? (
                          <>
                            {new Date(a.hitAt).toLocaleString(locale, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            <span className="mt-0.5 block text-[10px]">
                              {formatDuration(a.hitAt - a.createdAt)}
                            </span>
                          </>
                        ) : (
                          new Date(a.createdAt).toLocaleString(locale, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {a.active ? (
                          <button
                            type="button"
                            className="rounded p-1 text-muted-fg hover:bg-muted hover:text-foreground"
                            onClick={() => deactivate(a.id)}
                            title={t.alertDisarm}
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="rounded p-1 text-muted-fg hover:bg-bear/15 hover:text-bear"
                            onClick={() => removeAlert(a.id)}
                            title={t.alertRemove}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
