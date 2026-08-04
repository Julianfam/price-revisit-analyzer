import { useCallback, useEffect, useRef, useState } from "react";
import {
  Atom,
  Crown,
  Loader2,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { runQuantumAgent } from "@/lib/analyzer/server";
import {
  QUANTUM_UNIVERSE_DEFAULT,
  type QuantumCandidate,
  type QuantumRunResult,
} from "@/lib/analyzer/quantum";
import { useI18n } from "@/lib/i18n";
import { formatPrice, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type QuantumApplyParams = {
  symbol: string;
  interval: string;
  range: string;
  window: string;
};

type ProgressView = {
  pct: number;
  label: string;
  detail: string;
  phase: number;
};

const PROB_OPTS = [0, 40, 50, 60, 70] as const;
const PIPS_OPTS = [0, 5, 10, 20, 50] as const;

/**
 * Quantum Agent — single request (no job polling).
 * Serverless hosts (Vercel / grok.me) cannot share in-memory job state
 * across requests; sandbox long-lived Node could, but we use one path everywhere.
 */
export function QuantumAgentPanel({
  enabled,
  onNeedUpgrade,
  onApply,
  onArmAlert,
}: {
  enabled: boolean;
  onNeedUpgrade?: () => void;
  onApply: (p: QuantumApplyParams) => void;
  onArmAlert?: (c: QuantumCandidate) => void;
}) {
  const { lang } = useI18n();
  const es = lang === "es";
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuantumRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minProb, setMinProb] = useState(0);
  const [minPips, setMinPips] = useState(0);
  const [progress, setProgress] = useState<ProgressView | null>(null);
  const tickRef = useRef<number | null>(null);

  const stopTick = useCallback(() => {
    if (tickRef.current != null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTick(), [stopTick]);

  const run = useCallback(async () => {
    if (!enabled) {
      onNeedUpgrade?.();
      return;
    }
    setLoading(true);
    setError(null);
    setProgress({
      pct: 5,
      label: es ? "Fase 1 · escaneo amplio" : "Phase 1 · wide scan",
      detail: es ? "Una sola petición (sin jobs)…" : "Single request (no jobs)…",
      phase: 1,
    });
    stopTick();

    const phases: ProgressView[] = es
      ? [
          {
            pct: 15,
            label: "Fase 1 · escaneo amplio",
            detail: "Barrido multi-activo…",
            phase: 1,
          },
          {
            pct: 32,
            label: "Fase 1 · escaneo amplio",
            detail: "Combos de ventana…",
            phase: 1,
          },
          {
            pct: 48,
            label: "Fase 2 · refine",
            detail: "Top activos…",
            phase: 2,
          },
          {
            pct: 65,
            label: "Fase 2 · refine",
            detail: "Más profundidad…",
            phase: 2,
          },
          {
            pct: 80,
            label: "Consenso",
            detail: "Acuerdo multi-ventana…",
            phase: 3,
          },
          {
            pct: 92,
            label: "Ranking",
            detail: "Top 12 (máx. 2/activo)…",
            phase: 3,
          },
        ]
      : [
          {
            pct: 15,
            label: "Phase 1 · wide scan",
            detail: "Multi-asset sweep…",
            phase: 1,
          },
          {
            pct: 32,
            label: "Phase 1 · wide scan",
            detail: "Window combos…",
            phase: 1,
          },
          {
            pct: 48,
            label: "Phase 2 · refine",
            detail: "Top assets…",
            phase: 2,
          },
          {
            pct: 65,
            label: "Phase 2 · refine",
            detail: "Deeper passes…",
            phase: 2,
          },
          {
            pct: 80,
            label: "Consensus",
            detail: "Multi-window agree…",
            phase: 3,
          },
          {
            pct: 92,
            label: "Ranking",
            detail: "Top 12 (max 2/asset)…",
            phase: 3,
          },
        ];

    let step = 0;
    tickRef.current = window.setInterval(() => {
      if (step < phases.length) {
        setProgress(phases[step]!);
        step += 1;
      } else {
        setProgress((p) =>
          p
            ? {
                ...p,
                pct: Math.min(97, p.pct + 1),
                detail: es ? "Casi listo…" : "Almost done…",
              }
            : p,
        );
      }
    }, 1600);

    try {
      // ONE request. Never start+poll — that breaks on grok.me / Vercel.
      const raw = await runQuantumAgent({
        data: {
          assetCount: 7,
          minProb,
          minPips,
        },
      });

      // TanStack may return the payload directly or nested
      const full = (raw && typeof raw === "object" && "topPrices" in (raw as object)
        ? raw
        : (raw as { result?: QuantumRunResult })?.result) as QuantumRunResult | undefined;

      if (!full || !Array.isArray(full.topPrices)) {
        throw new Error(
          es
            ? "Respuesta Quantum inválida del servidor. Recarga e intenta de nuevo."
            : "Invalid Quantum response from server. Reload and try again.",
        );
      }

      setProgress({
        pct: 100,
        label: es ? "Listo" : "Done",
        detail: `${full.topPrices.length} targets`,
        phase: 3,
      });
      setResult(full);
      const n = full.topPrices.length;
      if (n === 0) {
        toast.message(
          es
            ? "Sin targets con esos filtros — baja P% o pips"
            : "No targets with those filters — lower P% or pips",
        );
      } else {
        toast.success(
          es ? `Quantum · ${n} resultados` : `Quantum · ${n} results`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      if (msg.includes("PREMIUM") || lower.includes("premium")) {
        setError(
          es
            ? "Quantum Agent es Trial/Pro"
            : "Quantum Agent requires Trial/Pro",
        );
        onNeedUpgrade?.();
      } else if (
        lower.includes("timeout") ||
        lower.includes("504") ||
        lower.includes("abort") ||
        lower.includes("failed to fetch") ||
        lower.includes("network")
      ) {
        const friendly = es
          ? "La búsqueda tardó demasiado en el servidor (límite cloud). Baja filtros o reintenta."
          : "Quantum timed out on the cloud host. Lower filters or retry.";
        setError(friendly);
        toast.error(es ? "Timeout Quantum" : "Quantum timeout", {
          description: friendly,
        });
      } else {
        setError(msg);
        toast.error(es ? "Quantum falló" : "Quantum failed", {
          description: msg.slice(0, 180),
        });
      }
    } finally {
      stopTick();
      setLoading(false);
      window.setTimeout(() => setProgress(null), 700);
    }
  }, [enabled, es, minProb, minPips, onNeedUpgrade, stopTick]);

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={onNeedUpgrade}
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-rank1/40 bg-gradient-to-r from-rank1/10 via-teal/5 to-accent-soft/10 px-3 py-3 text-left transition-colors hover:border-rank1/55"
      >
        <span className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg border border-rank1/30 bg-rank1/15 text-rank1">
            <Atom className="size-4" />
          </span>
          <span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              Quantum Agent
              <Badge className="border-0 bg-rank1/20 text-[10px] text-rank1">
                PRO
              </Badge>
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-fg">
              {es
                ? "Escaneo multi-activo · Top 12 (máx. 2/activo)"
                : "Multi-asset scan · Top 12 (max 2/asset)"}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-1 text-[11px] font-medium text-rank1">
          <Crown className="size-3.5" />
          {es ? "Desbloquear" : "Unlock"}
        </span>
      </button>
    );
  }

  const shown = result?.topPrices ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-rank1/35 bg-gradient-to-br from-rank1/10 via-card to-teal/5">
      <div className="h-0.5 w-full bg-gradient-to-r from-rank1 via-teal to-accent-soft" />
      <div className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
              <Atom className="size-4 text-rank1" />
              <span>Quantum Agent</span>
              <Badge className="border-0 bg-rank1/20 text-[10px] text-rank1">
                PRO
              </Badge>
            </div>
            <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-fg">
              {es
                ? "Bucle multi-fase en una sola petición (compatible cloud). Filtra por P% y pips. Especulativo."
                : "Multi-phase loop in one request (cloud-safe). Filter by min P% and pips. Speculative."}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={loading}
            onClick={() => void run()}
            className="shrink-0 gap-1.5 bg-rank1 text-black hover:bg-rank1/90"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {loading
              ? es
                ? "Buscando…"
                : "Scanning…"
              : es
                ? "Ejecutar Quantum"
                : "Run Quantum"}
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-fg">
            min P%
          </span>
          {PROB_OPTS.map((v) => (
            <button
              key={v}
              type="button"
              disabled={loading}
              onClick={() => setMinProb(v)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-semibold tabular transition-colors",
                minProb === v
                  ? "bg-rank1/25 text-rank1"
                  : "bg-muted/40 text-muted-fg hover:bg-muted",
              )}
            >
              {v === 0 ? (es ? "todos" : "any") : `${v}+`}
            </button>
          ))}
          <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-muted-fg">
            min pips
          </span>
          {PIPS_OPTS.map((v) => (
            <button
              key={v}
              type="button"
              disabled={loading}
              onClick={() => setMinPips(v)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-semibold tabular transition-colors",
                minPips === v
                  ? "bg-teal/25 text-teal"
                  : "bg-muted/40 text-muted-fg hover:bg-muted",
              )}
            >
              {v === 0 ? (es ? "todos" : "any") : `${v}+`}
            </button>
          ))}
        </div>

        {progress && (
          <div className="space-y-1.5 rounded-lg border border-rank1/25 bg-rank1/5 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-medium text-foreground">
                {progress.label}
              </span>
              <span className="font-mono tabular text-rank1">
                {progress.pct}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rank1 to-teal transition-all duration-500"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-fg">{progress.detail}</p>
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">
            {error}
          </p>
        )}

        {result && !loading && (
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-fg">
            <Zap className="size-3 text-rank1" />
            <span>
              {result.scanned} scans · {result.candidates} seeds ·{" "}
              {(result.tookMs / 1000).toFixed(1)}s
            </span>
            {result.universe?.length > 0 && (
              <span className="truncate">
                · {result.universe.slice(0, 8).join(", ")}
              </span>
            )}
            {!result.universe?.includes(QUANTUM_UNIVERSE_DEFAULT[0]!) && null}
          </div>
        )}

        {shown.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((c, i) => (
              <QuantumCard
                key={`${c.symbol}-${c.targetPrice}-${i}`}
                c={c}
                rank={i + 1}
                es={es}
                onApply={onApply}
                onArmAlert={onArmAlert}
              />
            ))}
          </div>
        )}

        {result && shown.length === 0 && !loading && (
          <p className="text-center text-xs text-muted-fg">
            {es
              ? "Sin resultados con esos filtros."
              : "No results with those filters."}
          </p>
        )}
      </div>
    </div>
  );
}

function QuantumCard({
  c,
  rank,
  es,
  onApply,
  onArmAlert,
}: {
  c: QuantumCandidate;
  rank: number;
  es: boolean;
  onApply: (p: QuantumApplyParams) => void;
  onArmAlert?: (cand: QuantumCandidate) => void;
}) {
  const up = c.direction === "up";
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-card/80 p-2.5">
      <div className="flex items-start justify-between gap-1">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="flex size-5 items-center justify-center rounded bg-rank1/20 text-[10px] font-bold text-rank1">
              {rank}
            </span>
            <span className="text-sm font-semibold">{c.symbol}</span>
            {up ? (
              <TrendingUp className="size-3.5 text-bull" />
            ) : (
              <TrendingDown className="size-3.5 text-bear" />
            )}
          </div>
          <p className="mt-0.5 font-mono text-base font-bold tabular text-foreground">
            {formatPrice(c.targetPrice, c.tick)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-bold tabular text-teal">
            {c.reachProb.toFixed(0)}%
          </p>
          <p className="text-[10px] text-muted-fg">
            {c.pips.toFixed(1)} pips
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 text-[10px] text-muted-fg">
        <Badge variant="outline" className="text-[10px]">
          {c.interval}/{c.window}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {c.style}
        </Badge>
      </div>
      <div className="mt-auto flex gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 flex-1 gap-1 text-[11px]"
          onClick={() =>
            onApply({
              symbol: c.symbol,
              interval: c.interval,
              range: c.range,
              window: c.window,
            })
          }
        >
          <Target className="size-3" />
          {es ? "Aplicar" : "Apply"}
        </Button>
        {onArmAlert && (
          <Button
            type="button"
            size="sm"
            className="h-7 flex-1 gap-1 bg-teal/90 text-[11px] text-black hover:bg-teal"
            onClick={() => onArmAlert(c)}
          >
            {es ? "Alerta" : "Alert"}
          </Button>
        )}
      </div>
    </div>
  );
}
