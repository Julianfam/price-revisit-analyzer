import type { PriceScenario, ScenarioBundle } from "@/lib/analyzer/types";
import { minScenarioOffsetTicks } from "@/lib/analyzer/engine";
import { useI18n } from "@/lib/i18n";
import { usePlan } from "@/lib/billing/use-plan";
import {
  alertPipSize,
  formatSignedPips,
  requestAlertPermission,
  usePriceAlerts,
} from "@/lib/price-alerts";
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
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellOff,
  CheckCircle2,
  Magnet,
  Minus,
  Target,
} from "lucide-react";
import { toast } from "sonner";

const RANK_STYLES = [
  {
    ring: "border-rank1/50 bg-rank1/10",
    badge: "bg-rank1 text-bg",
    bar: "bg-rank1",
    glow: "shadow-[0_0_24px_-8px_var(--color-rank1)]",
  },
  {
    ring: "border-rank2/40 bg-rank2/10",
    badge: "bg-rank2 text-bg",
    bar: "bg-rank2",
    glow: "shadow-[0_0_20px_-10px_var(--color-rank2)]",
  },
  {
    ring: "border-rank3/40 bg-rank3/10",
    badge: "bg-rank3 text-bg",
    bar: "bg-rank3",
    glow: "shadow-[0_0_18px_-10px_var(--color-rank3)]",
  },
] as const;

function pipsToLevel(
  current: number,
  target: number,
  yahooSymbol: string,
  tick: number,
): number {
  const ps = alertPipSize(yahooSymbol, tick);
  if (!(ps > 0)) return 0;
  return (target - current) / ps;
}

export function TopNextPrices({
  scenarios,
  tick,
  symbol,
  yahooSymbol,
  onNeedUpgrade,
  maxScenarios,
  minProb = 0,
}: {
  scenarios: ScenarioBundle;
  tick: number;
  symbol: string;
  yahooSymbol: string;
  onNeedUpgrade?: () => void;
  /** Free = 1 teaser, premium = 3–5 */
  maxScenarios?: number;
  /** Pro: hide scenarios below this probability */
  minProb?: number;
}) {
  const { t, lang } = useI18n();
  const plan = usePlan();
  const alerts = usePriceAlerts((s) => s.alerts);
  const addAlert = usePriceAlerts((s) => s.addAlert);
  const removeAlert = usePriceAlerts((s) => s.removeAlert);
  const findActive = usePriceAlerts((s) => s.findActive);

  const currentPrice = scenarios.currentPrice || scenarios.currentLevel;
  const minOff = minScenarioOffsetTicks(yahooSymbol, tick);
  const minPips =
    minOff * (alertPipSize(yahooSymbol, tick) / Math.max(tick, 1e-12));

  const top3 = scenarios.scenarios
    .filter((sc) => {
      const pips = Math.abs(
        pipsToLevel(currentPrice, sc.price, yahooSymbol, tick),
      );
      if (
        !(
          pips + 1e-9 >= Math.min(minPips, 5) * 0.99 &&
          Math.abs(sc.offsetTicks) >= minOff
        )
      ) {
        return false;
      }
      if (minProb > 0 && sc.probability + 1e-9 < minProb) return false;
      return true;
    })
    .slice(0, Math.max(1, maxScenarios ?? 3));

  const pSum = top3.reduce((s, x) => s + x.probability, 0) || 1;
  const top3Norm = top3.map((sc, i) => ({
    ...sc,
    // Display % among top3 (what the user sees on the card)
    probability: (sc.probability / pSum) * 100,
    _rank: i + 1,
  }));

  const toggleAlert = async (
    sc: PriceScenario & { probability: number; _rank?: number },
    rank: number,
  ) => {
    const existing = findActive(symbol, sc.price, tick);
    if (existing) {
      removeAlert(existing.id);
      toast.message(t.alertOff, {
        description: `${symbol} · ${formatPrice(sc.price, tick)}`,
      });
      return;
    }

    const max = plan.entitlements.maxActiveAlerts;
    if (max != null) {
      const activeN = alerts.filter((a) => a.active).length;
      if (activeN >= max) {
        toast.message(
          lang === "es"
            ? `Free: máx ${max} alertas activas`
            : `Free: max ${max} active alerts`,
          {
            description:
              lang === "es"
                ? "Activa Trial o Pro para más"
                : "Start Trial or Pro for more",
          },
        );
        onNeedUpgrade?.();
        return;
      }
    }

    await requestAlertPermission();

    // Always lock the % the user saw on the card
    const armedProbability = Number.isFinite(sc.probability)
      ? Math.round(sc.probability * 10) / 10
      : undefined;
    const armedHistTouch = Number.isFinite(sc.histTouch)
      ? Math.round(sc.histTouch * 10) / 10
      : undefined;
    const armedRank = rank >= 1 ? rank : sc._rank;

    const created = addAlert({
      symbol: symbol.toUpperCase(),
      yahooSymbol,
      targetPrice: sc.price,
      tick,
      entryPrice: currentPrice,
      armedProbability,
      armedHistTouch,
      armedRank,
    });

    const pLabel =
      created.armedProbability != null
        ? ` · P% ${created.armedProbability.toFixed(0)}`
        : "";
    toast.success(t.alertOn, {
      description: `${symbol} → ${formatPrice(sc.price, tick)}${pLabel}. ${t.alertWatchingHint}`,
    });
  };

  return (
    <Card className="rounded-xl overflow-hidden border-teal/25 bg-card">
      <div className="h-1 w-full bg-gradient-to-r from-rank1 via-teal to-rank3" />
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-8 items-center justify-center rounded-lg bg-teal/15 text-teal">
                <Target className="size-4" />
              </span>
              {t.top3Title}
            </CardTitle>
            <CardDescription className="mt-1.5">
              {t.top3Desc}
              <span className="mt-0.5 block text-[10px] text-muted-fg">
                {lang === "es"
                  ? "P% = peso relativo entre escenarios mostrados (no es predicción calibrada). Reach = frecuencia histórica de toque."
                  : "P% = relative weight among shown scenarios (not a calibrated forecast). Reach = historical touch rate."}
              </span>
              <span className="mt-1 block font-mono text-xs tabular text-teal">
                {t.top3Current}: {formatPrice(currentPrice, tick)}
              </span>
            </CardDescription>
          </div>
          <Badge className="border-0 bg-teal/15 font-mono text-teal">
            {top3Norm.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {top3Norm.length === 0 ? (
          <p className="text-sm text-muted-fg">{t.top3Empty}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {top3Norm.map((sc, i) => {
              const style = RANK_STYLES[i] ?? RANK_STYLES[2]!;
              const pips = pipsToLevel(
                currentPrice,
                sc.price,
                yahooSymbol,
                tick,
              );
              const watching = !!findActive(symbol, sc.price, tick);
              return (
                <ScenarioCard
                  key={`${sc.price}-${i}`}
                  rank={i + 1}
                  sc={sc}
                  style={style}
                  pips={pips}
                  tick={tick}
                  watching={watching}
                  onToggleAlert={() => void toggleAlert(sc, i + 1)}
                  t={t}
                />
              );
            })}
          </div>
        )}
        {maxScenarios != null && maxScenarios < 3 && (
          <button
            type="button"
            onClick={onNeedUpgrade}
            className="mt-3 w-full rounded-lg border border-dashed border-teal/40 bg-teal/5 px-3 py-2.5 text-left text-xs transition-colors hover:border-teal/55 hover:bg-teal/10"
          >
            <span className="font-medium text-foreground">
              {lang === "es"
                ? `Free te da ${maxScenarios} escenarios · Trial/Pro abre Top 3–5 + imán`
                : `Free gives you ${maxScenarios} scenarios · Trial/Pro opens Top 3–5 + magnet`}
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-fg">
              {lang === "es"
                ? "Ya puedes armar alertas y comparar — el plus es profundidad"
                : "You can arm alerts and compare already — Pro adds depth"}
            </span>
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function ScenarioCard({
  rank,
  sc,
  style,
  pips,
  tick,
  watching,
  onToggleAlert,
  t,
}: {
  rank: number;
  sc: PriceScenario;
  style: (typeof RANK_STYLES)[number];
  pips: number;
  tick: number;
  watching: boolean;
  onToggleAlert: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const DirIcon =
    pips > 0 ? ArrowUpRight : pips < 0 ? ArrowDownRight : Minus;
  const dirColor =
    pips > 0 ? "text-bull" : pips < 0 ? "text-bear" : "text-muted-fg";

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border p-3 transition-shadow",
        style.ring,
        style.glow,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-md text-xs font-bold",
            style.badge,
          )}
        >
          {rank}
        </span>
        {sc.isMagnet && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-teal">
            <Magnet className="size-3" />
            {t.magnet}
          </span>
        )}
      </div>
      <p className="mt-2 font-mono text-xl font-semibold tabular text-foreground">
        {formatPrice(sc.price, tick)}
      </p>
      <p
        className={cn(
          "mt-0.5 flex items-center gap-1 text-xs font-medium",
          dirColor,
        )}
      >
        <DirIcon className="size-3.5" />
        {formatSignedPips(pips)} {t.alertPipsUnit}
      </p>
      <div className="mt-2">
        <div className="mb-0.5 flex justify-between text-[10px] text-muted-fg">
          <span>{t.top3Prob}</span>
          <span className="font-mono tabular">
            {formatPct(sc.probability, 0)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", style.bar)}
            style={{ width: `${Math.min(100, sc.probability)}%` }}
          />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant={watching ? "outline" : "default"}
        className={cn(
          "mt-3 h-8 w-full gap-1 text-xs",
          watching && "border-teal/40 text-teal",
        )}
        onClick={onToggleAlert}
      >
        {watching ? (
          <>
            <BellOff className="size-3.5" />
            {t.alertDisarm}
          </>
        ) : (
          <>
            <Bell className="size-3.5" />
            {t.alertArm}
          </>
        )}
      </Button>
      {watching && (
        <p className="mt-1 flex items-center justify-center gap-1 text-[10px] text-teal">
          <CheckCircle2 className="size-3" />
          {t.alertWatching}
        </p>
      )}
    </div>
  );
}
