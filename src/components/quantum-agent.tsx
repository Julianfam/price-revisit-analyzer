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
import {
  getQuantumStatus,
  startQuantumAgent,
} from "@/lib/analyzer/server";
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
 * Quantum Agent — Pro multi-parameter explorer with live progress + filters.
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
  const pollRef = useRef<number | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const run = useCallback(async () => {
    if (!enabled) {
      onNeedUpgrade?.();
      return;
    }
    setLoading(true);
    setError(null);
    setProgress({ pct: 2, label: es ? "En cola" : "Queued", detail: "…", phase: 0 });
    stopPoll();

    try {
      const start = (await startQuantumAgent({
        data: {
          assetCount: 7,
          minProb,
          minPips,
        },
      })) as { jobId: string; total: number };

      const jobId = start.jobId;

      await new Promise<void>((resolve, reject) => {
        let tries = 0;
        pollRef.current = window.setInterval(() => {
          void (async () => {
            tries += 1;
            try {
              const st = (await getQuantumStatus({
                data: { jobId },
              })) as
                | {
                    missing?: boolean;
                    status?: string;
                    pct?: number;
                    label?: string;
                    detail?: string;
                    phase?: number;
                    result?: QuantumRunResult;
                    error?: string;
                  }
                | { missing: true };

              if ("missing" in st && st.missing) {
                if (tries > 8) {
                  stopPoll();
                  reject(new Error(es ? "Job no encontrado" : "Job not found"));
                }
                return;
              }

              const job = st as {
                status?: string;
                pct?: number;
                label?: string;
                detail?: string;
                phase?: number;
                result?: QuantumRunResult;
                error?: string;
              };

              setProgress({
                pct: job.pct ?? 0,
                label: job.label ?? "…",
                detail: job.detail ?? "",
                phase: job.phase ?? 0,
              });

              if (job.status === "done" && job.result) {
                stopPoll();
                setResult(job.result);
                const n = job.result.topPrices.length;
                if (n === 0) {
                  toast.message(
                    es
                      ? "Sin targets con esos filtros — baja P% o pips"
                      : "No targets with those filters — lower P% or pips",
                  );
                } else {
                  toast.success(
                    es
                      ? `Quantum · ${n} resultados`
                      : `Quantum · ${n} results`,
                  );
                }
                resolve();
              } else if (job.status === "error") {
                stopPoll();
                reject(new Error(job.error || "Quantum failed"));
              } else if (tries > 400) {
                // ~3–4 min safety
                stopPoll();
                reject(new Error(es ? "Timeout Quantum" : "Quantum timeout"));
              }
            } catch (e) {
              if (tries > 15) {
                stopPoll();
                reject(e instanceof Error ? e : new Error(String(e)));
              }
            }
          })();
        }, 450);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("PREMIUM")) {
        setError(
          es
            ? "Quantum Agent es Trial/Pro"
            : "Quantum Agent requires Trial/Pro",
        );
        onNeedUpgrade?.();
      } else {
        setError(msg);
      }
    } finally {
      stopPoll();
      setLoading(false);
      setProgress(null);
    }
  }, [enabled, es, minProb, minPips, onNeedUpgrade, stopPoll]);

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
                ? "Progreso en vivo · filtros P%/pips · Top 12 (máx. 2/activo)"
                : "Live progress · P%/pips filters · Top 12 (max 2/asset)"}
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
            <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
              <Atom className="size-4 text-rank1" />
              Quantum Agent
              <Badge className="border-0 bg-rank1/20 text-[10px] text-rank1">
                PRO
              </Badge>
            </p>
            <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-fg">
              {es
                ? "Bucle multi-fase con progreso en vivo. Filtra por P% y pips mínimos. Especulativo."
                : "Multi-phase loop with live progress. Filter by min P% and pips. Speculative."}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={loading}
            onClick={() => void run()}
            className="h-9 gap-1.5 bg-rank1 text-zinc-950 hover:bg-rank1/90"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Zap className="size-3.5" />
            )}
            {loading
              ? es
                ? "Explorando…"
                : "Scanning…"
              : es
                ? "Ejecutar Quantum"
                : "Run Quantum"}
          </Button>
        </div>

        {/* Filters */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-fg">
              {es ? "P% mínima" : "Min P%"}
            </p>
            <div className="flex flex-wrap gap-1">
              {PROB_OPTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={loading}
                  onClick={() => setMinProb(v)}
                  className={cn(
                    "rounded-md border px-2 py-1 font-mono text-[11px] tabular transition-colors",
                    minProb === v
                      ? "border-rank1/50 bg-rank1/20 text-rank1"
                      : "border-border bg-card text-muted-fg hover:text-foreground",
                  )}
                >
                  {v === 0 ? (es ? "Todas" : "All") : `≥${v}%`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-fg">
              {es ? "Pips mínimos" : "Min pips"}
            </p>
            <div className="flex flex-wrap gap-1">
              {PIPS_OPTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={loading}
                  onClick={() => setMinPips(v)}
                  className={cn(
                    "rounded-md border px-2 py-1 font-mono text-[11px] tabular transition-colors",
                    minPips === v
                      ? "border-teal/50 bg-teal/15 text-teal"
                      : "border-border bg-card text-muted-fg hover:text-foreground",
                  )}
                >
                  {v === 0 ? (es ? "Todos" : "All") : `≥${v}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {QUANTUM_UNIVERSE_DEFAULT.map((s) => (
            <span
              key={s}
              className="rounded-md border border-border/80 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-fg"
            >
              {s}
            </span>
          ))}
        </div>

        {error && (
          <p className="rounded-lg border border-bear/30 bg-bear/10 px-2.5 py-1.5 text-[11px] text-bear">
            {error}
          </p>
        )}

        {loading && progress && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Loader2 className="size-3.5 animate-spin text-rank1" />
                {progress.label}
                <span className="text-muted-fg">· P{progress.phase || 1}</span>
              </span>
              <span className="font-mono tabular text-muted-fg">
                {progress.pct}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rank1 via-teal to-accent-soft transition-all duration-300"
                style={{ width: `${Math.max(3, progress.pct)}%` }}
              />
            </div>
            <p className="truncate font-mono text-[10px] text-muted-fg">
              {progress.detail}
            </p>
          </div>
        )}

        {result && !loading && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-fg">
              <span className="flex items-center gap-1">
                <Sparkles className="size-3 text-rank1" />
                {es
                  ? `Top ${shown.length} · filtros P%≥${minProb || 0} · pips≥${minPips || 0}`
                  : `Top ${shown.length} · filters P%≥${minProb || 0} · pips≥${minPips || 0}`}
              </span>
              <span className="font-mono tabular">
                {result.scanned} scans · {(result.tookMs / 1000).toFixed(1)}s
                {result.loop
                  ? ` · P1 ${result.loop.phase1Scans}/P2 ${result.loop.phase2Scans}`
                  : ""}
              </span>
            </div>

            {shown.length === 0 ? (
              <p className="text-[11px] text-muted-fg">
                {es
                  ? "Sin candidatos con esos filtros. Baja P% o pips y vuelve a ejecutar."
                  : "No candidates with those filters. Lower P% or pips and re-run."}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((c, i) => (
                  <QuantumCard
                    key={c.id}
                    rank={i + 1}
                    c={c}
                    es={es}
                    onApply={() =>
                      onApply({
                        symbol: c.symbol,
                        interval: c.interval,
                        range: c.range,
                        window: c.window,
                      })
                    }
                    onArm={onArmAlert ? () => onArmAlert(c) : undefined}
                  />
                ))}
              </div>
            )}

            {result.errors.length > 0 && (
              <p className="text-[10px] text-muted-fg">
                {es ? "Avisos" : "Notes"}:{" "}
                {result.errors
                  .slice(0, 3)
                  .map((e) => e.symbol)
                  .join(", ")}
                {result.errors.length > 3 ? "…" : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function QuantumCard({
  rank,
  c,
  es,
  onApply,
  onArm,
}: {
  rank: number;
  c: QuantumCandidate;
  es: boolean;
  onApply: () => void;
  onArm?: () => void;
}) {
  const Dir = c.direction === "up" ? TrendingUp : TrendingDown;
  const dirColor = c.direction === "up" ? "text-bull" : "text-bear";
  const rankStyle =
    rank === 1
      ? "border-rank1/50 bg-rank1/10"
      : rank === 2
        ? "border-accent-soft/40 bg-accent-soft/10"
        : "border-border bg-muted/20";

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border p-2.5 shadow-sm",
        rankStyle,
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 font-mono text-xs font-bold text-foreground">
          <span className="text-rank1">#{rank}</span> {c.symbol}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 text-[10px] font-medium",
            dirColor,
          )}
        >
          <Dir className="size-3" />
          {c.direction === "up"
            ? es
              ? "alcista"
              : "up"
            : es
              ? "bajista"
              : "down"}
        </span>
      </div>

      <p className="mt-1.5 flex items-center gap-1 font-mono text-lg font-semibold tabular text-foreground">
        <Target className="size-3.5 text-teal" />
        {formatPrice(c.targetPrice, c.tick)}
      </p>
      <p className="text-[10px] text-muted-fg">
        {es ? "ahora" : "now"} {formatPrice(c.currentPrice, c.tick)} ·{" "}
        <span className="text-teal">
          {c.pips.toFixed(c.pips >= 20 ? 0 : 1)} pips
        </span>
      </p>

      <div className="mt-2 flex flex-wrap gap-1">
        <Badge className="border-0 bg-teal/15 font-mono text-[10px] text-teal">
          P% {c.reachProb.toFixed(0)}
        </Badge>
        <Badge className="border-0 bg-muted font-mono text-[10px] text-muted-fg">
          hist {c.histTouch.toFixed(0)}%
        </Badge>
        {c.isMagnet && (
          <Badge className="border-0 bg-rank1/20 text-[10px] text-rank1">
            magnet
          </Badge>
        )}
        {(c.consensus ?? 1) >= 2 && (
          <Badge className="border-0 bg-teal/20 text-[10px] text-teal">
            ×{c.consensus} win
          </Badge>
        )}
      </div>

      <p className="mt-1.5 font-mono text-[10px] text-muted-fg">
        {c.interval} · {c.range} · win {c.window} · {c.style}
      </p>
      <p className="text-[10px] text-muted-fg">
        {c.name} · score {c.score.toFixed(0)}
        {c.yahooSymbol ? ` · ${c.yahooSymbol}` : ""}
      </p>

      <div className="mt-2 flex gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 flex-1 text-[10px]"
          onClick={onApply}
        >
          {es ? "Analizar" : "Analyze"}
        </Button>
        {onArm && (
          <Button
            type="button"
            size="sm"
            className="h-7 flex-1 bg-primary text-[10px] text-primary-foreground"
            onClick={onArm}
          >
            {es ? "Alerta" : "Alert"}
          </Button>
        )}
      </div>
    </div>
  );
}
