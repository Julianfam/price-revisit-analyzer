import type { TrendResult } from "@/lib/analyzer/types";
import { trendLabelKey, useI18n } from "@/lib/i18n";
import { formatPct, cn } from "@/lib/utils";

export function TrendMeter({ trend }: { trend: TrendResult }) {
  const { t } = useI18n();
  const labelColor =
    trend.label === "alcista"
      ? "text-bull"
      : trend.label === "bajista"
        ? "text-bear"
        : "text-muted-fg";

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">
            {t.trendAnalyzer}
          </p>
          <p className={cn("mt-1 text-3xl font-semibold tracking-tight tabular", labelColor)}>
            {trend.score}
            <span className="ml-1 text-base font-normal text-muted-fg">/ 100</span>
          </p>
          <p className={cn("mt-0.5 text-sm capitalize", labelColor)}>
            {trendLabelKey(trend.label, t)}
          </p>
        </div>
        <div className="text-right text-xs space-y-1 tabular">
          <p className="text-bull">
            {t.pBull} {formatPct(trend.pBull)}
          </p>
          <p className="text-bear">
            {t.pBear} {formatPct(trend.pBear)}
          </p>
          <p className="text-muted-fg">
            {t.pSide} {formatPct(trend.pSide)}
          </p>
        </div>
      </div>

      <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-bear via-muted-fg to-bull transition-[width] duration-300"
          style={{ width: "100%", opacity: 0.25 }}
        />
        <div
          className="absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full border-2 border-foreground bg-card shadow transition-[left] duration-300"
          style={{ left: `calc(${trend.score}% - 7px)` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { k: t.bullish, v: trend.pBull, c: "bg-bull" },
          { k: t.sideways, v: trend.pSide, c: "bg-muted-fg" },
          { k: t.bearish, v: trend.pBear, c: "bg-bear" },
        ].map((row) => (
          <div key={row.k} className="rounded-lg bg-muted/60 px-2.5 py-2">
            <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-border">
              <div className={cn("h-full rounded-full", row.c)} style={{ width: `${row.v}%` }} />
            </div>
            <p className="text-[10px] uppercase tracking-wide text-muted-fg">{row.k}</p>
            <p className="text-sm font-medium tabular">{formatPct(row.v, 0)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
