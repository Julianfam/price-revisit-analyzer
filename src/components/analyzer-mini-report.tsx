import { useMemo, type ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ClipboardList,
  Flame,
  Gauge,
  Minus,
  Target,
  Timer,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { AnalysisResult } from "@/lib/analyzer/types";
import {
  computeAlertPerformance,
  computeAnalyzerHealth,
  useAnalyzerHistory,
} from "@/lib/analyzer-history";
import { useI18n } from "@/lib/i18n";
import { usePriceAlerts } from "@/lib/price-alerts";
import { formatPct, formatPrice, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function formatAbsPips(pips: number): string {
  if (!Number.isFinite(pips)) return "—";
  const a = Math.abs(pips);
  return a >= 100 ? a.toFixed(0) : a.toFixed(1);
}

function str(t: Record<string, unknown>, key: string, fallback: string): string {
  const v = t[key];
  return typeof v === "string" ? v : fallback;
}

export function AnalyzerMiniReport({
  result,
  limited = false,
  onUpgrade,
}: {
  result: AnalysisResult | null;
  /** Free: hide deep breakdown / long history */
  limited?: boolean;
  onUpgrade?: () => void;
}) {
  const { t, lang } = useI18n();
  const dict = t as unknown as Record<string, unknown>;
  const runs = useAnalyzerHistory((s) => s.runs);
  const clearHistory = useAnalyzerHistory((s) => s.clear);
  const alerts = usePriceAlerts((s) => s.alerts);

  const health = useMemo(() => computeAnalyzerHealth(runs), [runs]);
  const alertPerf = useMemo(() => computeAlertPerformance(alerts), [alerts]);

  const locale = lang === "es" ? "es" : "en";
  const healthColor =
    health.healthLabel === "strong"
      ? "text-bull"
      : health.healthLabel === "ok"
        ? "text-teal"
        : "text-muted-fg";
  const healthBg =
    health.healthLabel === "strong"
      ? "bg-bull/15 border-bull/30"
      : health.healthLabel === "ok"
        ? "bg-teal/15 border-teal/30"
        : "bg-muted/40 border-border";

  const healthWord =
    health.healthLabel === "strong"
      ? str(dict, "reportHealthStrong", "Solid")
      : health.healthLabel === "ok"
        ? str(dict, "reportHealthOk", "OK")
        : str(dict, "reportHealthWeak", "Thin data");

  const breakdownRows = [
    {
      key: "retest",
      label: str(dict, "reportBreakRetest", "Retest activity"),
      value: health.breakdown.retest,
    },
    {
      key: "coverage",
      label: str(dict, "reportBreakCoverage", "Level coverage"),
      value: health.breakdown.coverage,
    },
    {
      key: "depth",
      label: str(dict, "reportBreakDepth", "Sample depth"),
      value: health.breakdown.depth,
    },
    {
      key: "scenarios",
      label: str(dict, "reportBreakScenarios", "Scenario clarity"),
      value: health.breakdown.scenarios,
    },
    {
      key: "consistency",
      label: str(dict, "reportBreakConsistency", "Consistency"),
      value: health.breakdown.consistency,
    },
  ];

  return (
    <Card className="rounded-xl overflow-hidden border-primary/20">
      <div className="h-0.5 w-full bg-gradient-to-r from-teal via-primary to-accent-soft" />
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <ClipboardList className="size-4" />
              </span>
              {str(dict, "reportTitle", "Mini report")}
            </CardTitle>
            <CardDescription className="mt-1.5 max-w-xl">
              {str(
                dict,
                "reportDescV2",
                "Recency-weighted analysis quality, scenario clarity, and alert batting average",
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              className={cn(
                "border font-semibold tabular",
                healthBg,
                healthColor,
              )}
            >
              <Gauge className="mr-1 size-3" />
              {health.healthScore}/100 · {healthWord}
            </Badge>
            <Badge variant="outline" className="tabular text-muted-fg">
              {str(dict, "reportConfidence", "Confidence")} {health.confidence}%
            </Badge>
            {runs.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-muted-fg"
                onClick={() => clearHistory()}
              >
                {str(dict, "reportClear", "Clear history")}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat
            icon={<Activity className="size-3.5" />}
            label={str(dict, "reportRuns", "Runs")}
            value={String(health.runs)}
            hint={fill(
              str(dict, "reportSymbols", "{n} symbols"),
              { n: String(health.symbols) },
              `${health.symbols} symbols`,
            )}
          />
          <Stat
            icon={<Target className="size-3.5" />}
            label={str(dict, "reportAvgRetests", "Avg retests")}
            value={health.runs ? health.avgRetests.toFixed(2) : "—"}
            hint={
              health.runs
                ? `${str(dict, "reportHotRetests", "Hot")} ${health.avgHotRetests.toFixed(2)} · ${health.avgPctRetested.toFixed(0)}%`
                : "—"
            }
            accent="teal"
          />
          <Stat
            icon={<TrendingUp className="size-3.5" />}
            label={str(dict, "reportImpulseBias", "Impulse bias")}
            value={
              health.runs ? `${formatPct(health.avgImpulseUp, 0)} ↑` : "—"
            }
            hint={
              health.runs
                ? `${formatPct(health.avgImpulseDown, 0)} ↓ · ${str(dict, "reportRevisitShort", "Revisit")} ${formatPct(health.avgRevisit, 0)}`
                : "—"
            }
            accent={
              health.avgImpulseUp >= health.avgImpulseDown + 5
                ? "bull"
                : health.avgImpulseDown >= health.avgImpulseUp + 5
                  ? "bear"
                  : undefined
            }
          />
          <Stat
            icon={<Timer className="size-3.5" />}
            label={str(dict, "reportAlertHits", "Alert hits")}
            value={`${alertPerf.hit}/${alertPerf.total}`}
            hint={
              alertPerf.hitRate != null
                ? `${formatPct(alertPerf.hitRate, 0)} ${str(dict, "reportHitRate", "hit rate")} · Σ ${formatAbsPips(alertPerf.reachedVolumePips)} pips`
                : str(dict, "reportNoHitsYet", "No hits yet")
            }
            accent={
              alertPerf.hitRate != null && alertPerf.hitRate >= 50
                ? "bull"
                : undefined
            }
          />
        </div>

        {limited && (
          <button
            type="button"
            onClick={onUpgrade}
            className="w-full rounded-lg border border-dashed border-primary/35 bg-primary/5 px-3 py-2.5 text-left text-xs hover:bg-primary/10"
          >
            <span className="font-medium text-foreground">
              {lang === "es"
                ? "Mini reporte Free (resumen) · desbloquea desglose y ranking con Trial/Pro"
                : "Free mini-report (summary) · unlock breakdown & leaders with Trial/Pro"}
            </span>
          </button>
        )}

        {health.runs > 0 && !limited && (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border/80 bg-card/50 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
                <BarChart3 className="size-3.5" />
                {str(dict, "reportScoreBreakdown", "Score breakdown")}
              </p>
              <div className="space-y-2">
                {breakdownRows.map((row) => (
                  <ScoreBar key={row.key} label={row.label} value={row.value} />
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-muted-fg">
                {str(
                  dict,
                  "reportWeightedHint",
                  "Recent runs weigh more. Confidence rises with more runs and symbols.",
                )}
              </p>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-border/80 bg-card/50 p-3">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
                  {str(dict, "reportTrendMix", "Trend mix")}
                </p>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="bg-bull transition-[width]"
                    style={{ width: `${health.bullishShare}%` }}
                  />
                  <div
                    className="bg-muted-fg/35 transition-[width]"
                    style={{ width: `${health.sideShare}%` }}
                  />
                  <div
                    className="bg-bear transition-[width]"
                    style={{ width: `${health.bearishShare}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                  <span className="text-bull">
                    {t.bullish} {formatPct(health.bullishShare, 0)}
                  </span>
                  <span className="text-muted-fg">
                    {t.sideways} {formatPct(health.sideShare, 0)}
                  </span>
                  <span className="text-bear">
                    {t.bearish} {formatPct(health.bearishShare, 0)}
                  </span>
                </div>
                <p className="mt-2 font-mono text-xs tabular text-muted-fg">
                  {t.trendAnalyzer}:{" "}
                  <span className="font-semibold text-foreground">
                    {health.avgTrend.toFixed(0)}
                  </span>
                  {" · "}
                  {str(dict, "reportTopScenario", "Top scenario avg")}{" "}
                  <span className="font-semibold text-foreground">
                    {formatPct(health.avgTopScenarioProb, 0)}
                  </span>
                </p>
              </div>

              <div className="rounded-lg border border-border/80 bg-card/50 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
                  <Zap className="size-3.5 text-accent-soft" />
                  {str(dict, "reportAlertPerf", "Alert performance")}
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <MiniStat
                    label={t.alertActive}
                    value={String(alertPerf.active)}
                    color="text-accent-soft"
                  />
                  <MiniStat
                    label={t.alertHitCount}
                    value={String(alertPerf.hit)}
                    color="text-bull"
                  />
                  <MiniStat
                    label={str(dict, "reportAbandoned", "Away-stop")}
                    value={String(alertPerf.abandoned)}
                    color="text-rank1"
                  />
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-muted-fg">
                  {alertPerf.avgTimeToHitMs != null && (
                    <p>
                      {fill(
                        str(dict, "reportAvgTimeToHit", "Avg time {t}"),
                        { t: formatDuration(alertPerf.avgTimeToHitMs) },
                        `Avg time ${formatDuration(alertPerf.avgTimeToHitMs)}`,
                      )}
                      {alertPerf.medianTimeToHitMs != null &&
                        ` · med ${formatDuration(alertPerf.medianTimeToHitMs)}`}
                    </p>
                  )}
                  {alertPerf.reachedVolumePips > 0 && (
                    <p className="font-mono tabular text-teal">
                      Σ {formatAbsPips(alertPerf.reachedVolumePips)}{" "}
                      {t.alertPipsUnit}{" "}
                      {str(dict, "reportReachedOnly", "(reached only)")}
                    </p>
                  )}
                  {alertPerf.abandoned > 0 && (
                    <p>
                      {[
                        alertPerf.abandonedTooFar > 0
                          ? `${alertPerf.abandonedTooFar} ${str(dict, "alertAbandonTooFar", "too far")}`
                          : null,
                        alertPerf.abandonedNoReturn > 0
                          ? `${alertPerf.abandonedNoReturn} ${str(dict, "alertAbandonNoReturn", "no return")}`
                          : null,
                        alertPerf.abandonedExpired > 0
                          ? `${alertPerf.abandonedExpired} ${str(dict, "alertAbandonExpired", "expired")}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-teal/25 bg-teal/5 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-teal">
                {str(dict, "reportCurrent", "This run")} · {result.symbol} ·{" "}
                {result.windowLabel} · {result.interval}
              </p>
              <Badge className="border-0 bg-primary/15 font-mono tabular text-primary">
                {formatPrice(result.lastPrice, result.tick)}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini
                label={t.trendAnalyzer}
                value={`${result.trend.score}`}
                sub={trendWord(result.trend.label, t)}
                accent={
                  result.trend.label === "alcista"
                    ? "bull"
                    : result.trend.label === "bajista"
                      ? "bear"
                      : undefined
                }
              />
              <Mini
                label={str(dict, "reportAvgRetests", "Avg retests")}
                value={result.metrics.avgRetestsPerLevel.toFixed(2)}
                sub={`${result.metrics.windowsAnalyzed} ${str(dict, "reportWindows", "windows")}`}
              />
              <Mini
                label={str(dict, "reportHotLevel", "Hot level")}
                value={
                  result.metrics.hottestLevels[0]
                    ? formatPrice(
                        result.metrics.hottestLevels[0].level,
                        result.tick,
                      )
                    : "—"
                }
                sub={
                  result.metrics.hottestLevels[0]
                    ? `${result.metrics.hottestLevels[0].retests} retests`
                    : "—"
                }
              />
              <Mini
                label={str(dict, "reportMagnet", "Magnet")}
                value={
                  result.scenarios.scenarios.find((s) => s.isMagnet) ||
                  result.scenarios.scenarios[0]
                    ? formatPrice(
                        (
                          result.scenarios.scenarios.find((s) => s.isMagnet) ??
                          result.scenarios.scenarios[0]!
                        ).price,
                        result.tick,
                      )
                    : "—"
                }
                sub={
                  result.scenarios.scenarios[0]
                    ? formatPct(result.scenarios.scenarios[0].probability, 0)
                    : "—"
                }
              />
            </div>

            {result.scenarios.scenarios.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-fg">
                  {t.top3Title}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.scenarios.scenarios.slice(0, 5).map((sc, i) => (
                    <div
                      key={`${sc.price}-${i}`}
                      className={cn(
                        "rounded-md border px-2 py-1.5 font-mono text-xs tabular",
                        sc.isMagnet
                          ? "border-teal/40 bg-teal/15 text-teal"
                          : "border-border bg-card text-foreground",
                      )}
                    >
                      <span className="font-semibold">
                        {formatPrice(sc.price, result.tick)}
                      </span>
                      <span className="ml-1.5 text-muted-fg">
                        {formatPct(sc.probability, 0)}
                      </span>
                      {sc.isMagnet && (
                        <Flame className="ml-1 inline size-3 text-teal" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-fg">
              <DirPill
                up={result.scenarios.firstImpulseUp}
                down={result.scenarios.firstImpulseDown}
                tUp={str(dict, "reportFirstUp", "Up")}
                tDown={str(dict, "reportFirstDown", "Down")}
              />
              <span className="tabular">
                {fill(
                  str(dict, "reportRevisit", "Revisit {n}"),
                  { n: formatPct(result.scenarios.revisitCurrent, 0) },
                  `Revisit ${formatPct(result.scenarios.revisitCurrent, 0)}`,
                )}
              </span>
              <span className="tabular">
                {fill(
                  str(dict, "reportPctRetested", "{n}% levels retested"),
                  { n: result.metrics.pctLevelsRetested.toFixed(0) },
                  `${result.metrics.pctLevelsRetested.toFixed(0)}% retested`,
                )}
              </span>
            </div>
          </div>
        )}

        {health.bySymbol.length > 0 && !limited && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
              {str(dict, "reportSymbolLeaders", "Symbols by retest activity")}
            </p>
            <div className="overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full min-w-[320px] text-left text-xs">
                <thead className="border-b border-border bg-surface/50 text-[10px] uppercase tracking-wide text-muted-fg">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">#</th>
                    <th className="px-2.5 py-1.5 font-medium">{t.symbol}</th>
                    <th className="px-2.5 py-1.5 font-medium">
                      {str(dict, "reportRuns", "Runs")}
                    </th>
                    <th className="px-2.5 py-1.5 font-medium">
                      {str(dict, "reportAvgRetests", "Retests")}
                    </th>
                    <th className="px-2.5 py-1.5 font-medium">
                      {t.trendAnalyzer}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {health.bySymbol.map((row, i) => (
                    <tr
                      key={row.symbol}
                      className="border-b border-border/50 last:border-0"
                    >
                      <td className="px-2.5 py-1.5 tabular text-muted-fg">
                        {i + 1}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono font-semibold">
                        {row.symbol}
                      </td>
                      <td className="px-2.5 py-1.5 tabular">{row.runs}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular text-teal">
                        {row.avgRetests.toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          "px-2.5 py-1.5 font-mono tabular",
                          row.avgTrend >= 58
                            ? "text-bull"
                            : row.avgTrend <= 42
                              ? "text-bear"
                              : "text-muted-fg",
                        )}
                      >
                        {row.avgTrend.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {runs.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
              {str(dict, "reportRecent", "Recent")}
            </p>
            <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
              {runs.slice(0, limited ? 3 : 8).map((r, idx) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <span className="min-w-0">
                    <span className="mr-1.5 tabular text-muted-fg">
                      {idx + 1}.
                    </span>
                    <span className="font-mono font-semibold text-foreground">
                      {r.symbol}
                    </span>
                    <span className="ml-1.5 text-muted-fg">
                      {r.windowLabel} · {r.interval}
                    </span>
                    <span className="ml-1.5 font-mono tabular text-teal">
                      r {r.avgRetests.toFixed(2)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 tabular text-muted-fg">
                    {r.topScenarioProb != null && (
                      <span className="hidden sm:inline">
                        top {formatPct(r.topScenarioProb, 0)}
                      </span>
                    )}
                    <span
                      className={cn(
                        "font-medium",
                        r.trendLabel === "alcista"
                          ? "text-bull"
                          : r.trendLabel === "bajista"
                            ? "text-bear"
                            : "",
                      )}
                    >
                      {r.trendScore}
                    </span>
                    <span>
                      {new Date(r.at).toLocaleString(locale, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {health.runs === 0 && !result && (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-fg">
            {str(dict, "reportEmpty", "Run an analysis to build your report.")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const color =
    v >= 68 ? "bg-bull" : v >= 42 ? "bg-teal" : "bg-muted-fg/50";
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px]">
        <span className="text-muted-fg">{label}</span>
        <span className="font-mono tabular text-foreground">{v}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-[width]", color)}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  accent?: "teal" | "bull" | "bear";
}) {
  const valueColor =
    accent === "bull"
      ? "text-bull"
      : accent === "bear"
        ? "text-bear"
        : accent === "teal"
          ? "text-teal"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-3 py-2.5">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-fg">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-lg font-semibold tabular",
          valueColor,
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-fg">{hint}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-fg">{label}</p>
      <p
        className={cn(
          "font-mono text-base font-semibold tabular",
          color ?? "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Mini({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "bull" | "bear";
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-fg">{label}</p>
      <p
        className={cn(
          "font-mono text-sm font-semibold tabular",
          accent === "bull"
            ? "text-bull"
            : accent === "bear"
              ? "text-bear"
              : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-fg">{sub}</p>
    </div>
  );
}

function DirPill({
  up,
  down,
  tUp,
  tDown,
}: {
  up: number;
  down: number;
  tUp: string;
  tDown: string;
}) {
  const Icon = up >= down ? ArrowUpRight : down > up ? ArrowDownRight : Minus;
  const color =
    up >= down + 5
      ? "text-bull"
      : down >= up + 5
        ? "text-bear"
        : "text-muted-fg";
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", color)}>
      <Icon className="size-3.5" />
      {tUp} {formatPct(up, 0)} · {tDown} {formatPct(down, 0)}
    </span>
  );
}

function trendWord(
  label: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (label === "alcista") return t.trendBull;
  if (label === "bajista") return t.trendBear;
  return t.trendSide;
}
