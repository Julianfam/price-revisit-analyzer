import type { AggregateMetrics } from "@/lib/analyzer/types";
import { useI18n } from "@/lib/i18n";
import { formatNum, formatPct, formatPrice, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function MetricsGrid({
  metrics,
  tick,
  maxHotLevels,
}: {
  metrics: AggregateMetrics;
  tick: number;
  maxHotLevels?: number;
}) {
  const { t } = useI18n();
  const hotCap = maxHotLevels ?? 10;
  const hot = metrics.hottestLevels.slice(0, hotCap);

  const items = [
    {
      label: t.avgVisitsPerLevel,
      value: formatNum(metrics.avgVisitsPerLevel, 2),
      hint: t.avgVisitsHint,
      accent: "border-l-teal text-teal",
    },
    {
      label: t.avgRetestsPerLevel,
      value: formatNum(metrics.avgRetestsPerLevel, 2),
      hint: t.avgRetestsHint,
      accent: "border-l-bull text-bull",
    },
    {
      label: t.hotLevelRetests,
      value: formatNum(metrics.avgHotRetests, 2),
      hint: t.hotLevelHint,
      accent: "border-l-rank1 text-rank1",
    },
    {
      label: t.pctLevelsRetested,
      value: formatPct(metrics.pctLevelsRetested),
      hint: t.pctLevelsHint,
      accent: "border-l-accent-soft text-accent-soft",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card
          key={item.label}
          className={cn("rounded-xl border-l-4", item.accent.split(" ")[0])}
        >
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-fg">
              {item.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                "text-2xl font-semibold tracking-tight tabular",
                item.accent.split(" ")[1],
              )}
            >
              {item.value}
            </p>
            <p className="mt-1 text-xs text-muted-fg">{item.hint}</p>
          </CardContent>
        </Card>
      ))}
      <Card className="rounded-xl border-teal/15 sm:col-span-2 xl:col-span-4">
        <CardHeader>
          <CardTitle className="text-teal">{t.hottestLevels}</CardTitle>
        </CardHeader>
        <CardContent>
          {hot.length === 0 ? (
            <p className="text-sm text-muted-fg">{t.noLevelData}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hot.map((lv, i) => (
                <div
                  key={lv.level}
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    i === 0
                      ? "border-rank1/40 bg-rank1/10"
                      : i === 1
                        ? "border-rank2/40 bg-rank2/10"
                        : i === 2
                          ? "border-rank3/40 bg-rank3/10"
                          : "border-border bg-muted/40",
                  )}
                >
                  <p className="font-mono text-sm tabular">
                    {formatPrice(lv.level, tick)}
                  </p>
                  <p className="text-[11px] text-muted-fg">
                    {lv.visits} {t.visits} · {lv.retests} {t.retest}
                  </p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-muted-fg">
            {metrics.windowsAnalyzed} {t.windowsAnalyzed}
            {metrics.bestWindow
              ? ` · ${t.bestWindowAvg} ${formatNum(metrics.bestWindow.avgRetests, 2)}`
              : ""}
            {maxHotLevels != null &&
              metrics.hottestLevels.length > maxHotLevels &&
              ` · +${metrics.hottestLevels.length - maxHotLevels}`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
