import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";
import { scanScalperSetups } from "@/lib/analyzer/server";
import type { ScalperSetup } from "@/lib/analyzer/types";
import { useI18n } from "@/lib/i18n";
import { formatPct, formatPrice, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ScanResult = {
  setups: ScalperSetup[];
  scanned: number;
  candidates: number;
  highProbCount: number;
  threshold: number;
  windowLabel: string;
  interval: string;
  range: string;
  errors: { symbol: string; error: string }[];
  fetchedAt: number;
};

export function ScalperSection({
  interval,
  range,
  window,
}: {
  interval: string;
  range: string;
  window: string;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScanResult | null>(null);
  const lastGood = useRef<ScanResult | null>(null);
  const scanId = useRef(0);

  const scan = useCallback(async () => {
    const id = ++scanId.current;
    setLoading(true);
    setError(null);
    try {
      const res = (await scanScalperSetups({
        data: { interval, range, window },
      })) as ScanResult;

      if (id !== scanId.current) return; // stale

      // Keep previous good board if this pass returned nothing but had Yahoo errors
      if (res.setups.length === 0 && lastGood.current?.setups.length && res.errors?.length) {
        setData({
          ...lastGood.current,
          errors: res.errors,
          fetchedAt: res.fetchedAt,
        });
        setError(t.scalperPartialFail);
      } else {
        setData(res);
        if (res.setups.length > 0) lastGood.current = res;
      }
    } catch (e) {
      if (id !== scanId.current) return;
      const msg = e instanceof Error ? e.message : t.scalperError;
      setError(msg);
      // Keep last good board visible on hard failure
      if (lastGood.current) setData(lastGood.current);
    } finally {
      if (id === scanId.current) setLoading(false);
    }
  }, [interval, range, window, t.scalperError, t.scalperPartialFail]);

  // Manual scan only — auto-scan made the app feel slow after analyze\n
  const setups = data?.setups ?? [];
  const anyThreshold = setups.some((s) => s.meetsThreshold);

  return (
    <Card className="rounded-xl overflow-hidden border-accent-soft/30">
      <div className="h-1 w-full bg-gradient-to-r from-accent-soft via-teal to-bull" />
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft/15 text-accent-soft">
                <Crosshair className="size-4" />
              </span>
              {t.scalperTitle}
            </CardTitle>
            <CardDescription className="mt-1.5 max-w-2xl">
              {t.scalperDesc}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-0 bg-bull/15 text-bull">
              ≥ {data?.threshold ?? 80}%
            </Badge>
            <Badge variant="outline" className="border-accent-soft/30 text-accent-soft">
              {t.scalperMinPips}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void scan()}
              disabled={loading}
              className="border-accent-soft/30"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {t.scalperScan}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-sm text-bear">
            {error}
          </p>
        )}

        {loading && !data && (
          <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-fg">
            <Loader2 className="size-4 animate-spin text-accent-soft" />
            {t.scalperScanning}
          </div>
        )}

        {loading && data && (
          <p className="flex items-center gap-2 text-xs text-muted-fg">
            <Loader2 className="size-3 animate-spin" />
            {t.scalperScanning}
          </p>
        )}

        {data && (
          <p className="text-xs text-muted-fg">
            {t.scalperStats
              .replace("{scanned}", String(data.scanned))
              .replace("{candidates}", String(data.candidates))
              .replace("{high}", String(data.highProbCount))
              .replace("{window}", data.windowLabel)
              .replace("{interval}", data.interval)}
            {data.errors?.length
              ? ` · ${data.errors.length} ${t.scalperFeedErrors}`
              : ""}
          </p>
        )}

        {!loading && data && setups.length === 0 && (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-fg">
            <p>{t.scalperEmpty}</p>
            {data.errors?.length > 0 && (
              <p className="mt-2 text-xs text-bear/90">
                {data.errors
                  .slice(0, 3)
                  .map((e) => `${e.symbol}: ${e.error}`)
                  .join(" · ")}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void scan()}
            >
              <RefreshCw className="size-3.5" />
              {t.scalperScan}
            </Button>
          </div>
        )}

        {!anyThreshold && setups.length > 0 && (
          <p className="rounded-lg border border-rank1/30 bg-rank1/10 px-3 py-2 text-xs text-rank1">
            {t.scalperFallback}
          </p>
        )}

        <div className="grid gap-2">
          {setups.map((s, i) => (
            <ScalperRow key={`${s.symbol}-${s.direction}-${i}`} setup={s} rank={i + 1} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ScalperRow({ setup, rank }: { setup: ScalperSetup; rank: number }) {
  const { t } = useI18n();
  const up = setup.direction === "up";
  const DirIcon = up ? ArrowUpRight : ArrowDownRight;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between",
        setup.meetsThreshold
          ? "border-bull/35 bg-bull/5"
          : "border-border bg-surface/60",
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-bold tabular",
            rank === 1 && "bg-rank1 text-bg",
            rank === 2 && "bg-rank2 text-bg",
            rank === 3 && "bg-rank3 text-bg",
            rank > 3 && "bg-muted text-foreground",
          )}
        >
          {rank}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-foreground">
              {setup.symbol}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "gap-0.5",
                up ? "border-bull/40 text-bull" : "border-bear/40 text-bear",
              )}
            >
              <DirIcon className="size-3" />
              {up ? t.scalperLong : t.scalperShort}
            </Badge>
            {setup.meetsThreshold && (
              <Badge className="gap-1 border-0 bg-bull/20 text-bull">
                <Zap className="size-3" />
                ≥80%
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-fg">
            <span className="font-mono tabular text-foreground">
              {formatPrice(setup.currentPrice, setup.tick)}
            </span>
            {" → "}
            <span className="font-mono tabular text-foreground">
              {formatPrice(setup.targetPrice, setup.tick)}
            </span>
            <span className="text-muted-fg"> · {setup.yahooSymbol}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-fg">
            {t.scalperEdgeHint
              .replace("{edge}", setup.edge.toFixed(0))
              .replace("{opp}", formatPct(setup.oppositeProb, 0))
              .replace("{atr}", setup.atrPips.toFixed(1))
              .replace("{mfe}", setup.avgMfe.toFixed(1))
              .replace("{mae}", setup.avgMae.toFixed(1))}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:gap-4 sm:justify-end">
        <Metric
          label={t.scalperProb}
          value={formatPct(setup.probability, 0)}
          className={setup.meetsThreshold ? "text-bull" : "text-foreground"}
        />
        <Metric
          label={t.scalperEdge}
          value={`${setup.edge >= 0 ? "+" : ""}${setup.edge.toFixed(0)}pp`}
          className={setup.edge >= 3 ? "text-bull" : "text-rank1"}
        />
        <Metric
          label={t.scalperPips}
          value={setup.pips.toFixed(1)}
          className="text-accent-soft"
        />
        <Metric
          label={t.scalperScore}
          value={setup.score.toFixed(0)}
          className="text-teal"
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="text-right min-w-[3.25rem]">
      <p className="text-[10px] uppercase tracking-wide text-muted-fg">{label}</p>
      <p className={cn("text-sm font-semibold tabular", className)}>{value}</p>
    </div>
  );
}
