import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AnalysisResult, PriceScenario } from "@/lib/analyzer/types";
import type { PriceAlert } from "@/lib/price-alerts";
import { alertPipSize } from "@/lib/price-alerts";

export type ScenarioSnap = {
  price: number;
  probability: number;
  reachProb: number;
  offsetTicks: number;
  isMagnet: boolean;
};

export type AnalysisSnapshot = {
  id: string;
  at: number;
  symbol: string;
  yahooSymbol: string;
  interval: string;
  range: string;
  windowLabel: string;
  lastPrice: number;
  tick: number;
  trendScore: number;
  trendLabel: string;
  pBull: number;
  pBear: number;
  pSide: number;
  avgRetests: number;
  avgVisits: number;
  avgHotRetests: number;
  pctRetested: number;
  windowsAnalyzed: number;
  levelsTouchedPeak: number;
  topScenarios: ScenarioSnap[];
  topScenarioPrice: number | null;
  topScenarioProb: number | null;
  firstImpulseUp: number;
  firstImpulseDown: number;
  revisitCurrent: number;
  hotLevel: number | null;
  magnetPrice: number | null;
};

type HistState = {
  runs: AnalysisSnapshot[];
  record: (result: AnalysisResult) => void;
  clear: () => void;
};

function snapScenarios(list: PriceScenario[]): ScenarioSnap[] {
  return list.slice(0, 5).map((s) => ({
    price: s.price,
    probability: s.probability,
    reachProb: s.reachProb,
    offsetTicks: s.offsetTicks,
    isMagnet: s.isMagnet,
  }));
}

export function snapshotFromResult(result: AnalysisResult): AnalysisSnapshot {
  const tops = snapScenarios(result.scenarios.scenarios);
  const magnet =
    tops.find((s) => s.isMagnet) ?? tops[0] ?? null;
  const hot = result.metrics.hottestLevels[0]?.level ?? null;
  return {
    id: `${result.symbol}-${result.fetchedAt}`,
    at: result.fetchedAt,
    symbol: result.symbol,
    yahooSymbol: result.yahooSymbol,
    interval: result.interval,
    range: result.range,
    windowLabel: result.windowLabel,
    lastPrice: result.lastPrice,
    tick: result.tick,
    trendScore: result.trend.score,
    trendLabel: result.trend.label,
    pBull: result.trend.pBull,
    pBear: result.trend.pBear,
    pSide: result.trend.pSide,
    avgRetests: result.metrics.avgRetestsPerLevel,
    avgVisits: result.metrics.avgVisitsPerLevel,
    avgHotRetests: result.metrics.avgHotRetests,
    pctRetested: result.metrics.pctLevelsRetested,
    windowsAnalyzed: result.metrics.windowsAnalyzed,
    levelsTouchedPeak: result.metrics.hottestLevels.length
      ? result.metrics.hottestLevels.reduce((s, l) => s + l.visits, 0)
      : 0,
    topScenarios: tops,
    topScenarioPrice: tops[0]?.price ?? null,
    topScenarioProb: tops[0]?.probability ?? null,
    firstImpulseUp: result.scenarios.firstImpulseUp,
    firstImpulseDown: result.scenarios.firstImpulseDown,
    revisitCurrent: result.scenarios.revisitCurrent,
    hotLevel: hot,
    magnetPrice: magnet?.price ?? null,
  };
}

export const useAnalyzerHistory = create<HistState>()(
  persist(
    (set, get) => ({
      runs: [],
      record: (result) => {
        const snap = snapshotFromResult(result);
        const prev = get().runs.filter((r) => r.id !== snap.id);
        set({ runs: [snap, ...prev].slice(0, 50) });
      },
      clear: () => set({ runs: [] }),
    }),
    { name: "pra-analyzer-history-v2" },
  ),
);

/** Recency weight: newest = 1, decays for older runs. */
function recencyWeights(n: number): number[] {
  if (n <= 0) return [];
  const raw = Array.from({ length: n }, (_, i) => Math.pow(0.88, i));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

function wavg(values: number[], weights: number[]): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i]! * (weights[i] ?? 0);
  return s;
}

export type HealthBreakdown = {
  retest: number; // 0–100
  coverage: number;
  depth: number;
  scenarios: number;
  consistency: number;
};

export type AnalyzerHealth = {
  runs: number;
  symbols: number;
  avgTrend: number;
  avgRetests: number;
  avgHotRetests: number;
  avgVisits: number;
  avgPctRetested: number;
  avgImpulseUp: number;
  avgImpulseDown: number;
  avgRevisit: number;
  avgTopScenarioProb: number;
  bullishShare: number;
  bearishShare: number;
  sideShare: number;
  lastAt: number | null;
  lastSymbol: string | null;
  healthScore: number;
  healthLabel: "strong" | "ok" | "weak";
  confidence: number; // 0–100 sample confidence
  breakdown: HealthBreakdown;
  /** Per-symbol aggregate for leaderboard */
  bySymbol: {
    symbol: string;
    runs: number;
    avgRetests: number;
    avgTrend: number;
    lastAt: number;
  }[];
};

export function computeAnalyzerHealth(runs: AnalysisSnapshot[]): AnalyzerHealth {
  const emptyBreakdown: HealthBreakdown = {
    retest: 0,
    coverage: 0,
    depth: 0,
    scenarios: 0,
    consistency: 0,
  };

  if (runs.length === 0) {
    return {
      runs: 0,
      symbols: 0,
      avgTrend: 50,
      avgRetests: 0,
      avgHotRetests: 0,
      avgVisits: 0,
      avgPctRetested: 0,
      avgImpulseUp: 50,
      avgImpulseDown: 50,
      avgRevisit: 0,
      avgTopScenarioProb: 0,
      bullishShare: 0,
      bearishShare: 0,
      sideShare: 0,
      lastAt: null,
      lastSymbol: null,
      healthScore: 0,
      healthLabel: "weak",
      confidence: 0,
      breakdown: emptyBreakdown,
      bySymbol: [],
    };
  }

  const n = runs.length;
  const w = recencyWeights(n);

  const avgRetests = wavg(
    runs.map((r) => r.avgRetests),
    w,
  );
  const avgHotRetests = wavg(
    runs.map((r) => r.avgHotRetests ?? r.avgRetests),
    w,
  );
  const avgVisits = wavg(
    runs.map((r) => r.avgVisits),
    w,
  );
  const avgPctRetested = wavg(
    runs.map((r) => r.pctRetested),
    w,
  );
  const avgTrend = wavg(
    runs.map((r) => r.trendScore),
    w,
  );
  const avgImpulseUp = wavg(
    runs.map((r) => r.firstImpulseUp),
    w,
  );
  const avgImpulseDown = wavg(
    runs.map((r) => r.firstImpulseDown ?? 100 - r.firstImpulseUp),
    w,
  );
  const avgRevisit = wavg(
    runs.map((r) => r.revisitCurrent),
    w,
  );
  const avgTopScenarioProb = wavg(
    runs.map((r) => r.topScenarioProb ?? 0),
    w,
  );
  const avgWindows = wavg(
    runs.map((r) => r.windowsAnalyzed),
    w,
  );

  let bull = 0,
    bear = 0,
    side = 0;
  for (const r of runs) {
    if (r.trendLabel === "alcista") bull++;
    else if (r.trendLabel === "bajista") bear++;
    else side++;
  }

  // --- Sub-scores 0–100 ---
  // Retest activity: typical good retests ~1.5–3
  const retest = Math.min(
    100,
    avgRetests * 22 + avgHotRetests * 8,
  );
  // Coverage of levels that retest
  const coverage = Math.min(100, avgPctRetested * 1.05);
  // Sample depth from windows
  const depth = Math.min(100, Math.log10(Math.max(1, avgWindows)) * 45 + avgWindows * 0.8);
  // Scenario clarity: peaked top scenario is better than flat 20/20/20
  const scenarios = Math.min(100, Math.max(0, (avgTopScenarioProb - 15) * 2.2));
  // Consistency: lower trend volatility across runs + revisit rate
  const trendVar =
    n > 1
      ? runs.reduce((s, r) => s + Math.pow(r.trendScore - avgTrend, 2), 0) / n
      : 0;
  const consistency = Math.min(
    100,
    Math.max(0, 100 - Math.sqrt(trendVar) * 1.4) * 0.55 +
      Math.min(100, avgRevisit) * 0.45,
  );

  const breakdown: HealthBreakdown = {
    retest: Math.round(retest),
    coverage: Math.round(coverage),
    depth: Math.round(depth),
    scenarios: Math.round(scenarios),
    consistency: Math.round(consistency),
  };

  const healthScore = Math.round(
    retest * 0.28 +
      coverage * 0.22 +
      depth * 0.18 +
      scenarios * 0.16 +
      consistency * 0.16,
  );

  // Confidence grows with runs + unique symbols (caps at 100)
  const symbols = new Set(runs.map((r) => r.symbol.toUpperCase())).size;
  const confidence = Math.min(
    100,
    Math.round(n * 12 + symbols * 8 + Math.min(20, avgWindows / 2)),
  );

  const healthLabel: AnalyzerHealth["healthLabel"] =
    healthScore >= 68 && confidence >= 25
      ? "strong"
      : healthScore >= 42
        ? "ok"
        : "weak";

  // Symbol leaderboard
  const map = new Map<
    string,
    { runs: number; retests: number; trend: number; lastAt: number }
  >();
  for (const r of runs) {
    const k = r.symbol.toUpperCase();
    const cur = map.get(k) ?? { runs: 0, retests: 0, trend: 0, lastAt: 0 };
    cur.runs += 1;
    cur.retests += r.avgRetests;
    cur.trend += r.trendScore;
    cur.lastAt = Math.max(cur.lastAt, r.at);
    map.set(k, cur);
  }
  const bySymbol = [...map.entries()]
    .map(([symbol, v]) => ({
      symbol,
      runs: v.runs,
      avgRetests: v.retests / v.runs,
      avgTrend: v.trend / v.runs,
      lastAt: v.lastAt,
    }))
    .sort((a, b) => b.avgRetests - a.avgRetests || b.runs - a.runs)
    .slice(0, 6);

  return {
    runs: n,
    symbols,
    avgTrend,
    avgRetests,
    avgHotRetests,
    avgVisits,
    avgPctRetested,
    avgImpulseUp,
    avgImpulseDown,
    avgRevisit,
    avgTopScenarioProb,
    bullishShare: (bull / n) * 100,
    bearishShare: (bear / n) * 100,
    sideShare: (side / n) * 100,
    lastAt: runs[0]?.at ?? null,
    lastSymbol: runs[0]?.symbol ?? null,
    healthScore,
    healthLabel,
    confidence,
    breakdown,
    bySymbol,
  };
}

export type AlertPerformance = {
  total: number;
  active: number;
  hit: number;
  abandoned: number;
  stopped: number;
  /** hit / (hit + abandoned + stopped) when closed > 0 */
  hitRate: number | null;
  avgTimeToHitMs: number | null;
  medianTimeToHitMs: number | null;
  /** Sum of |entry→hit| pips on reached alerts only */
  reachedVolumePips: number;
  abandonedTooFar: number;
  abandonedNoReturn: number;
  abandonedExpired: number;
};

export function computeAlertPerformance(alerts: PriceAlert[]): AlertPerformance {
  const active = alerts.filter((a) => a.active);
  const hit = alerts.filter((a) => a.hitAt);
  const abandoned = alerts.filter((a) => a.abandonedAt && !a.hitAt);
  const stopped = alerts.filter(
    (a) => !a.active && !a.hitAt && !a.abandonedAt,
  );

  const times = hit
    .map((a) =>
      a.hitAt != null && a.createdAt != null ? a.hitAt - a.createdAt : null,
    )
    .filter((x): x is number => x != null && x >= 0)
    .sort((a, b) => a - b);

  const avgMs =
    times.length > 0
      ? times.reduce((s, x) => s + x, 0) / times.length
      : null;
  const medianMs =
    times.length > 0
      ? times[Math.floor(times.length / 2)]!
      : null;

  let reachedVolumePips = 0;
  for (const a of hit) {
    const hitPx = a.hitPrice ?? a.livePrice;
    if (hitPx == null || !Number.isFinite(a.entryPrice)) continue;
    const ps = alertPipSize(a.yahooSymbol, a.tick);
    if (!(ps > 0)) continue;
    reachedVolumePips += Math.abs(hitPx - a.entryPrice) / ps;
  }

  const closed = hit.length + abandoned.length + stopped.length;
  const hitRate = closed > 0 ? (hit.length / closed) * 100 : null;

  return {
    total: alerts.length,
    active: active.length,
    hit: hit.length,
    abandoned: abandoned.length,
    stopped: stopped.length,
    hitRate,
    avgTimeToHitMs: avgMs,
    medianTimeToHitMs: medianMs,
    reachedVolumePips,
    abandonedTooFar: abandoned.filter((a) => a.abandonReason === "too_far")
      .length,
    abandonedNoReturn: abandoned.filter(
      (a) => a.abandonReason === "away_timeout",
    ).length,
    abandonedExpired: abandoned.filter((a) => a.abandonReason === "expired")
      .length,
  };
}
