import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Layers,
  Lightbulb,
  Play,
  Target,
  Timer,
  X,
} from "lucide-react";
import {
  PARAM_PRESETS,
  PROB_SOFT,
  PROB_STRONG,
  type ParamPreset,
} from "@/lib/param-presets";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STEPS_EN = [
  {
    title: "Pick a liquid symbol",
    body: "Start with majors (EURUSD, XAUUSD, BTCUSD, SPX500). Thin symbols produce noisy revisit stats.",
  },
  {
    title: "Match interval ↔ window",
    body: "Bar size should be smaller than the window. Rule of thumb: window ≈ 6–20× interval (e.g. 5m bars → 1h window).",
  },
  {
    title: "Give the range enough history",
    body: "Too short (few bars) → weak scenarios. Prefer at least ~200–500 bars so averages stabilize.",
  },
  {
    title: "Read Top next prices by P%",
    body: `After Analyze, prefer scenarios with P% ≥ ${PROB_SOFT}% (better) or ≥ ${PROB_STRONG}% (stronger). Below that is more noise.`,
  },
  {
    title: "Arm alerts only on cleaner setups",
    body: "Use P% at arm as a memory of quality. High P% still fails often — size risk small.",
  },
] as const;

const STEPS_ES = [
  {
    title: "Elige un símbolo líquido",
    body: "Empieza con majors (EURUSD, XAUUSD, BTCUSD, SPX500). Símbolos finos dan stats de retest ruidosas.",
  },
  {
    title: "Empareja intervalo ↔ ventana",
    body: "La barra debe ser menor que la ventana. Guía: ventana ≈ 6–20× el intervalo (ej. barras 5m → ventana 1h).",
  },
  {
    title: "Dale rango suficiente",
    body: "Muy corto (pocas barras) → escenarios débiles. Prefiere ~200–500 barras para estabilizar promedios.",
  },
  {
    title: "Lee Top precios por P%",
    body: `Tras Analizar, prioriza escenarios con P% ≥ ${PROB_SOFT}% (mejor) o ≥ ${PROB_STRONG}% (más fuerte). Debajo hay más ruido.`,
  },
  {
    title: "Arma alertas solo en setups más limpios",
    body: "Usa la P% al armar como memoria de calidad. Alta P% también falla — arriesga poco.",
  },
] as const;

export type TutorialApply = {
  symbol: string;
  interval: string;
  range: string;
  window: string;
  tick?: string;
};

/**
 * Optional parameters guide — closed by default.
 * User opts in via the "Guide" control.
 */
export function ParametersTutorial({
  onApply,
  currentTopProb,
}: {
  onApply: (p: TutorialApply) => void;
  currentTopProb?: number | null;
}) {
  const { lang } = useI18n();
  const es = lang === "es";
  // Optional: never auto-open
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [style, setStyle] = useState<"all" | ParamPreset["style"]>("all");

  const steps = es ? STEPS_ES : STEPS_EN;
  const presets =
    style === "all"
      ? PARAM_PRESETS
      : PARAM_PRESETS.filter((p) => p.style === style);

  const coach =
    currentTopProb != null && Number.isFinite(currentTopProb)
      ? currentTopProb >= PROB_STRONG
        ? es
          ? `Tu Top actual ~${currentTopProb.toFixed(0)}% ≥ ${PROB_STRONG}% — combo más limpio (sigue siendo especulativo).`
          : `Your current Top ~${currentTopProb.toFixed(0)}% ≥ ${PROB_STRONG}% — cleaner combo (still speculative).`
        : currentTopProb >= PROB_SOFT
          ? es
            ? `Top ~${currentTopProb.toFixed(0)}% está en zona aceptable (≥${PROB_SOFT}%). Mejor si sube a ${PROB_STRONG}%+.`
            : `Top ~${currentTopProb.toFixed(0)}% is in the ok zone (≥${PROB_SOFT}%). Better if it reaches ${PROB_STRONG}%+.`
          : es
            ? `Top ~${currentTopProb.toFixed(0)}% < ${PROB_SOFT}%. Prueba otra combinación (preset) o ventana más ancha.`
            : `Top ~${currentTopProb.toFixed(0)}% < ${PROB_SOFT}%. Try another combo (preset) or a wider window.`
      : null;

  // Compact opt-in chip when closed
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setOpen(true)}
        >
          <BookOpen className="size-3.5 text-teal" />
          {es ? "Guía de parámetros (opcional)" : "Parameters guide (optional)"}
        </Button>
        <span className="text-[11px] text-muted-fg">
          {es
            ? "Combos · P% ≥ 50–60% · riesgo"
            : "Combos · P% ≥ 50–60% · risk"}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-teal/25 bg-teal/5">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal/15 text-teal">
            <BookOpen className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-foreground">
              {es ? "Tutorial de parámetros" : "Parameters tutorial"}
            </span>
            <span className="block text-[11px] text-muted-fg">
              {es
                ? "Opcional · combinar intervalo · rango · ventana · filtrar P%"
                : "Optional · combine interval · range · window · filter by P%"}
            </span>
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-xs text-muted-fg"
          onClick={() => setOpen(false)}
        >
          <X className="size-3.5" />
          {es ? "Ocultar" : "Hide"}
        </Button>
      </div>

      <div className="space-y-4 border-t border-border/60 px-3 py-3">
        <div className="flex gap-2 rounded-lg border border-rank1/35 bg-rank1/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rank1" />
          <div className="text-[11px] leading-relaxed text-muted-fg">
            <p className="font-semibold text-rank1">
              {es ? "Especulativo y con riesgo" : "Speculative and risky"}
            </p>
            <p className="mt-0.5">
              {es
                ? "Las combinaciones y el filtro P% ≥ 50–60% son guías empíricas del historial reciente, no predicciones. Pueden fallar. No es consejo de inversión."
                : "Combos and the P% ≥ 50–60% filter are empirical guides from recent history, not forecasts. They can fail. Not investment advice."}
            </p>
          </div>
        </div>

        {coach && (
          <div className="flex gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-[11px] text-muted-fg">
            <Target className="mt-0.5 size-3.5 shrink-0 text-teal" />
            <p>{coach}</p>
          </div>
        )}

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
            <Layers className="size-3.5" />
            {es ? "Guía en 5 pasos" : "5-step guide"}
          </p>
          <ol className="space-y-1.5">
            {steps.map((s, i) => {
              const active = i === step;
              return (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => setStep(i)}
                    className={cn(
                      "flex w-full gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                      active
                        ? "border-teal/40 bg-teal/10"
                        : "border-border/60 bg-card/40 hover:bg-muted/30",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold",
                        active ? "bg-teal text-bg" : "bg-muted text-muted-fg",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-foreground">
                        {s.title}
                      </span>
                      {active && (
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-fg">
                          {s.body}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-2 flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={step <= 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              {es ? "Anterior" : "Back"}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1 bg-primary text-xs text-primary-foreground"
              disabled={step >= steps.length - 1}
              onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
            >
              {es ? "Siguiente" : "Next"}
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <FlaskConical className="size-3.5 text-teal" />
            {es ? "Receta de combinación" : "Combination recipe"}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <RecipeCell
              icon={<Timer className="size-3.5" />}
              label={es ? "Intervalo" : "Interval"}
              value="1m–15m"
              hint={es ? "Camino de precio" : "Price path"}
            />
            <RecipeCell
              icon={<Layers className="size-3.5" />}
              label={es ? "Rango" : "Range"}
              value="1d–1mo"
              hint={es ? "Historia" : "History"}
            />
            <RecipeCell
              icon={<Target className="size-3.5" />}
              label={es ? "Ventana" : "Window"}
              value="15m–4h"
              hint={es ? "Horizonte retest" : "Retest horizon"}
            />
          </div>
          <p className="mt-2 flex gap-1.5 text-[11px] leading-snug text-muted-fg">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-rank1" />
            {es
              ? `Mejor elección: escenarios con P% ≥ ${PROB_SOFT}% (aceptable) o ≥ ${PROB_STRONG}% (preferible).`
              : `Best choice: scenarios with P% ≥ ${PROB_SOFT}% (ok) or ≥ ${PROB_STRONG}% (preferred).`}
          </p>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
              <Play className="size-3.5" />
              {es ? "Combinaciones sugeridas" : "Suggested combinations"}
            </p>
            <div className="inline-flex rounded-md border border-border bg-card p-0.5">
              {(
                [
                  ["all", es ? "Todas" : "All"],
                  ["scalp", "Scalp"],
                  ["intraday", es ? "Intradía" : "Intraday"],
                  ["swing", "Swing"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStyle(id)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-medium",
                    style === id
                      ? "bg-teal/20 text-teal"
                      : "text-muted-fg hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {presets.map((p) => (
              <PresetCard
                key={p.id}
                preset={p}
                lang={lang}
                onApply={() =>
                  onApply({
                    symbol: p.symbol,
                    interval: p.interval,
                    range: p.range,
                    window: p.window,
                    tick: p.tick,
                  })
                }
              />
            ))}
          </div>
        </div>

        <p className="flex items-start gap-1.5 text-[10px] leading-snug text-muted-fg">
          <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-teal" />
          {es
            ? "Tip: aplica un preset → Analizar → mira el Top. Si P% < 50%, cambia combo."
            : "Tip: apply a preset → Analyze → check Top. If P% < 50%, switch combo."}
        </p>
      </div>
    </div>
  );
}

function RecipeCell({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-fg">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular text-foreground">
        {value}
      </p>
      <p className="text-[10px] text-muted-fg">{hint}</p>
    </div>
  );
}

function PresetCard({
  preset,
  lang,
  onApply,
}: {
  preset: ParamPreset;
  lang: "en" | "es";
  onApply: () => void;
}) {
  const es = lang === "es";
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card/70 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-1">
        <div>
          <p className="font-mono text-sm font-semibold text-foreground">
            {preset.symbol}
          </p>
          <p className="mt-0.5 font-mono text-[11px] tabular text-teal">
            {preset.interval} · {preset.range} · {preset.window}
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-teal/30 bg-teal/10 text-[10px] text-teal"
        >
          P% ≥ {preset.targetProb}
        </Badge>
      </div>
      <p className="mt-1.5 flex-1 text-[11px] leading-snug text-muted-fg">
        {es ? preset.whyEs : preset.whyEn}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2 h-8 w-full gap-1 text-xs"
        onClick={onApply}
      >
        <Play className="size-3.5" />
        {es ? "Aplicar y analizar" : "Apply & analyze"}
      </Button>
    </div>
  );
}
