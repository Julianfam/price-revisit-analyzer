import type { ReactNode } from "react";
import type { ScenarioBundle } from "@/lib/analyzer/types";
import { useI18n } from "@/lib/i18n";
import { formatPct, formatPrice, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Magnet, TrendingDown, TrendingUp, RotateCcw } from "lucide-react";

export function ScenariosPanel({
  scenarios,
  tick,
}: {
  scenarios: ScenarioBundle;
  tick: number;
}) {
  const { t } = useI18n();

  return (
    <Card className="rounded-xl h-full border-accent-soft/20">
      <CardHeader>
        <CardTitle>{t.nextPrices}</CardTitle>
        <CardDescription>
          {t.scenariosDesc} {scenarios.horizonLabel} · {t.empiricalNormalized}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-teal/25 bg-teal/10 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-teal">{t.currentLevel}</p>
          <p className="font-mono text-lg tabular text-foreground">
            {formatPrice(scenarios.currentLevel, tick)}
          </p>
        </div>

        <ul className="space-y-2">
          {scenarios.scenarios.map((sc, idx) => {
            const dir = sc.offsetTicks === 0 ? "flat" : sc.offsetTicks > 0 ? "up" : "down";
            const barColor =
              dir === "up" ? "bg-bull" : dir === "down" ? "bg-bear" : "bg-teal";
            return (
              <li
                key={`${sc.price}-${sc.offsetTicks}`}
                className={cn(
                  "rounded-lg border p-3",
                  idx === 0
                    ? "border-rank1/35 bg-rank1/5"
                    : "border-border bg-surface/80",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-medium tabular">
                        {formatPrice(sc.price, tick)}
                      </span>
                      {sc.isMagnet && (
                        <Badge className="gap-1 border-0 bg-teal/20 text-teal">
                          <Magnet className="size-3" />
                          {t.magnet}
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "tabular",
                          dir === "up" && "border-bull/30 text-bull",
                          dir === "down" && "border-bear/30 text-bear",
                        )}
                      >
                        {sc.offsetTicks > 0 ? "+" : ""}
                        {sc.offsetTicks} tick
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-fg">
                      {t.histTouch} {formatPct(sc.histTouch)}
                      {dir === "up" && ` · ${t.above}`}
                      {dir === "down" && ` · ${t.below}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl font-semibold tabular">{formatPct(sc.probability, 0)}</p>
                    <div className="mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-muted ml-auto">
                      <div
                        className={cn("h-full rounded-full", barColor)}
                        style={{ width: `${Math.min(100, sc.probability)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatChip
            icon={<TrendingUp className="size-3.5 text-bull" />}
            label={t.firstImpulseUp}
            value={formatPct(scenarios.firstImpulseUp)}
            tone="bull"
          />
          <StatChip
            icon={<TrendingDown className="size-3.5 text-bear" />}
            label={t.firstImpulseDown}
            value={formatPct(scenarios.firstImpulseDown)}
            tone="bear"
          />
          <StatChip
            icon={<RotateCcw className="size-3.5 text-teal" />}
            label={t.revisitLevel}
            value={formatPct(scenarios.revisitCurrent)}
            tone="teal"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StatChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "bull" | "bear" | "teal";
}) {
  const tones = {
    bull: "border-bull/25 bg-bull/10",
    bear: "border-bear/25 bg-bear/10",
    teal: "border-teal/25 bg-teal/10",
  };
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", tones[tone])}>
      <div className="flex items-center gap-1.5 text-muted-fg">
        {icon}
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 text-sm font-semibold tabular">{value}</p>
    </div>
  );
}
