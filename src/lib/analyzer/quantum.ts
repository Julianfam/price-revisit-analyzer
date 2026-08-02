/**
 * Quantum Agent — multi-phase search over liquid assets × parameter grids.
 *
 * Loop:
 *  1) Wide scan (all universe × coarse combos)
 *  2) Rank assets by best seeds
 *  3) Deep refine top assets with extra intervals/windows
 *  4) Consensus boost when the same target reappears across windows
 *  5) Final rank + optional minProb/minPips filters
 */
import { priceDiffToPips } from "./pips";
import { SYMBOL_LIST, type SymbolEntry } from "./symbols";
import type { AnalysisResult, PriceScenario } from "./types";

export type QuantumParamCombo = {
  id: string;
  interval: string;
  range: string;
  window: string;
  style: "scalp" | "intraday" | "swing";
  phase: 1 | 2;
};

export const QUANTUM_PHASE1_GRID: QuantumParamCombo[] = [
  {
    id: "p1-scalp-15m",
    interval: "5m",
    range: "5d",
    window: "15m",
    style: "scalp",
    phase: 1,
  },
  {
    id: "p1-intra-1h",
    interval: "5m",
    range: "5d",
    window: "1h",
    style: "intraday",
    phase: 1,
  },
  {
    id: "p1-swing-4h",
    interval: "15m",
    range: "1mo",
    window: "4h",
    style: "swing",
    phase: 1,
  },
];

export const QUANTUM_PHASE2_GRID: QuantumParamCombo[] = [
  {
    id: "p2-scalp-1m",
    interval: "1m",
    range: "1d",
    window: "15m",
    style: "scalp",
    phase: 2,
  },
  {
    id: "p2-intra-15mbar",
    interval: "15m",
    range: "5d",
    window: "1h",
    style: "intraday",
    phase: 2,
  },
  {
    id: "p2-swing-1d",
    interval: "1h",
    range: "3mo",
    window: "1d",
    style: "swing",
    phase: 2,
  },
  {
    id: "p2-mid-4h",
    interval: "5m",
    range: "1mo",
    window: "4h",
    style: "intraday",
    phase: 2,
  },
];

export const QUANTUM_PARAM_GRID = QUANTUM_PHASE1_GRID;

export const QUANTUM_UNIVERSE_DEFAULT: string[] = [
  "EURUSD",
  "XAUUSD",
  "BTCUSD",
  "NAS100",
  "NVDA",
  "ETHUSD",
  "TSLA",
];

export const QUANTUM_MAX_PER_SYMBOL = 2;
export const QUANTUM_TOP_LIMIT = 12;
export const QUANTUM_REFINE_ASSETS = 4;

export function pickQuantumUniverse(limit = 7): SymbolEntry[] {
  const byValue = new Map(SYMBOL_LIST.map((s) => [s.value.toUpperCase(), s]));
  const out: SymbolEntry[] = [];
  const seenYahoo = new Set<string>();

  for (const v of QUANTUM_UNIVERSE_DEFAULT) {
    if (out.length >= limit) break;
    const entry = byValue.get(v.toUpperCase());
    if (!entry) continue;
    const y = entry.yahoo.toUpperCase();
    if (seenYahoo.has(y)) continue;
    seenYahoo.add(y);
    out.push(entry);
  }

  if (out.length < limit) {
    for (const entry of SYMBOL_LIST) {
      if (out.length >= limit) break;
      const y = entry.yahoo.toUpperCase();
      if (seenYahoo.has(y)) continue;
      seenYahoo.add(y);
      out.push(entry);
    }
  }
  return out;
}

export type QuantumCandidate = {
  id: string;
  symbol: string;
  yahooSymbol: string;
  name: string;
  category: string;
  interval: string;
  range: string;
  window: string;
  style: QuantumParamCombo["style"];
  currentPrice: number;
  targetPrice: number;
  direction: "up" | "down";
  pips: number;
  probability: number;
  histTouch: number;
  reachProb: number;
  isMagnet: boolean;
  tick: number;
  score: number;
  trendScore: number;
  trendLabel: string;
  consensus?: number;
  phase?: 1 | 2;
  edge?: number;
};

export type QuantumRunResult = {
  topPrices: QuantumCandidate[];
  scanned: number;
  combos: number;
  candidates: number;
  universe: string[];
  errors: { symbol: string; error: string }[];
  tookMs: number;
  fetchedAt: number;
  filters?: { minProb: number; minPips: number };
  loop?: {
    phase1Scans: number;
    phase2Scans: number;
    refinedAssets: string[];
    consensusBoosts: number;
  };
};

export type QuantumProgressEvent = {
  phase: 1 | 2 | 3;
  status: "phase1" | "phase2" | "consensus" | "done";
  label: string;
  detail: string;
  current: number;
  total: number;
  refinedAssets?: string[];
};

function scenarioPips(
  yahoo: string,
  current: number,
  target: number,
  tick: number,
): number {
  return Math.abs(priceDiffToPips(yahoo, target - current, tick));
}

function oppositeReach(list: PriceScenario[], sc: PriceScenario): number {
  const want = sc.offsetTicks >= 0 ? "down" : "up";
  let best = 0;
  for (const o of list) {
    const dir = o.offsetTicks >= 0 ? "up" : "down";
    if (dir !== want) continue;
    best = Math.max(best, o.reachProb ?? o.probability ?? 0);
  }
  return best;
}

export function scoreQuantumTarget(
  sc: PriceScenario,
  current: number,
  yahoo: string,
  tick: number,
  trendScore: number,
  allScenarios: PriceScenario[] = [],
): { pips: number; score: number; direction: "up" | "down"; edge: number } {
  const pips = scenarioPips(yahoo, current, sc.price, tick);
  const reach = sc.reachProb ?? sc.probability;
  const direction: "up" | "down" = sc.price >= current ? "up" : "down";
  const opp = oppositeReach(allScenarios, sc);
  const edge = reach - opp;

  const pScore = Math.min(42, reach * 0.42);
  const pipScore = Math.min(28, Math.log1p(pips) * 7.2);
  const edgeScore = Math.min(14, Math.max(0, edge) * 0.28);
  const magnetBonus = sc.isMagnet ? 7 : 0;
  const histBonus = Math.min(6, (sc.histTouch ?? 0) * 0.06);
  const align =
    direction === "up"
      ? (trendScore - 50) * 0.1
      : (50 - trendScore) * 0.1;

  return {
    pips,
    direction,
    edge,
    score: pScore + pipScore + edgeScore + magnetBonus + histBonus + align,
  };
}

export function candidatesFromAnalysis(
  result: AnalysisResult,
  combo: QuantumParamCombo,
  name: string,
  category: string,
): QuantumCandidate[] {
  const current = result.scenarios.currentPrice || result.lastPrice;
  const list = result.scenarios.scenarios ?? [];
  const out: QuantumCandidate[] = [];

  for (const sc of list) {
    const { pips, score, direction, edge } = scoreQuantumTarget(
      sc,
      current,
      result.yahooSymbol,
      result.tick,
      result.trend.score,
      list,
    );
    if (pips < 0.5) continue;

    out.push({
      id: `${result.symbol}|${combo.id}|${sc.price}|${sc.offsetTicks}`,
      symbol: result.symbol,
      yahooSymbol: result.yahooSymbol,
      name,
      category,
      interval: combo.interval,
      range: combo.range,
      window: combo.window,
      style: combo.style,
      currentPrice: current,
      targetPrice: sc.price,
      direction,
      pips,
      probability: sc.probability,
      histTouch: sc.histTouch,
      reachProb: sc.reachProb ?? sc.probability,
      isMagnet: sc.isMagnet,
      tick: result.tick,
      score,
      trendScore: result.trend.score,
      trendLabel: result.trend.label,
      phase: combo.phase,
      edge,
      consensus: 1,
    });
  }
  return out;
}

export function targetBucketKey(c: QuantumCandidate): string {
  const tick = c.tick > 0 ? c.tick : 0.0001;
  const rounded = Math.round(c.targetPrice / (tick * 2)) * (tick * 2);
  return `${c.symbol.toUpperCase()}|${rounded.toFixed(8)}`;
}

export function applyConsensusBoost(
  all: QuantumCandidate[],
): { boosted: QuantumCandidate[]; boostCount: number } {
  const buckets = new Map<string, QuantumCandidate[]>();
  for (const c of all) {
    const k = targetBucketKey(c);
    const list = buckets.get(k) ?? [];
    list.push(c);
    buckets.set(k, list);
  }

  let boostCount = 0;
  const boosted: QuantumCandidate[] = [];

  for (const [, list] of buckets) {
    const windows = new Set(
      list.map((c) => `${c.interval}|${c.window}|${c.range}`),
    );
    const consensus = windows.size;
    list.sort((a, b) => b.score - a.score || b.reachProb - a.reachProb);
    const best = list[0]!;
    if (consensus >= 2) {
      boostCount += 1;
      const multiWindowBonus = Math.min(22, (consensus - 1) * 9);
      const avgReach =
        list.reduce((s, x) => s + (x.reachProb || x.probability), 0) /
        list.length;
      boosted.push({
        ...best,
        consensus,
        score: best.score + multiWindowBonus + Math.min(8, avgReach * 0.05),
        reachProb: Math.max(best.reachProb, avgReach * 0.85),
      });
    } else {
      boosted.push({ ...best, consensus: 1 });
    }
    for (let i = 1; i < list.length && i < 2; i++) {
      const alt = list[i]!;
      if (alt.score >= best.score * 0.92 && alt.window !== best.window) {
        boosted.push({ ...alt, consensus });
      }
    }
  }

  return { boosted, boostCount };
}

export function assetSeedScore(candidates: QuantumCandidate[]): number {
  if (candidates.length === 0) return -Infinity;
  const sorted = [...candidates].sort(
    (a, b) => b.score - a.score || b.reachProb - a.reachProb,
  );
  const top = sorted.slice(0, 3);
  const best = top[0]!;
  const avg = top.reduce((s, c) => s + c.score, 0) / Math.max(1, top.length);
  return best.score * 0.65 + avg * 0.35 + (best.reachProb || 0) * 0.15;
}

export function pickAssetsToRefine(
  all: QuantumCandidate[],
  universe: SymbolEntry[],
  k = QUANTUM_REFINE_ASSETS,
): SymbolEntry[] {
  const bySym = new Map<string, QuantumCandidate[]>();
  for (const c of all) {
    const s = c.symbol.toUpperCase();
    const list = bySym.get(s) ?? [];
    list.push(c);
    bySym.set(s, list);
  }

  const ranked = universe
    .map((entry) => ({
      entry,
      seed: assetSeedScore(bySym.get(entry.value.toUpperCase()) ?? []),
    }))
    .filter((x) => Number.isFinite(x.seed) && x.seed > -Infinity)
    .sort((a, b) => b.seed - a.seed);

  const picked = ranked.slice(0, k).map((x) => x.entry);
  if (picked.length < k) {
    for (const e of universe) {
      if (picked.length >= k) break;
      if (!picked.some((p) => p.value === e.value)) picked.push(e);
    }
  }
  return picked;
}

function sortByQuality(a: QuantumCandidate, b: QuantumCandidate): number {
  const ca = (a.consensus ?? 1) >= 2 ? 1 : 0;
  const cb = (b.consensus ?? 1) >= 2 ? 1 : 0;
  if (cb !== ca) return cb - ca;
  if (b.score !== a.score) return b.score - a.score;
  const pa = a.reachProb || a.probability;
  const pb = b.reachProb || b.probability;
  if (pb !== pa) return pb - pa;
  return b.pips - a.pips;
}

export function rankQuantumTop(
  all: QuantumCandidate[],
  limit = QUANTUM_TOP_LIMIT,
  maxPerSymbol = QUANTUM_MAX_PER_SYMBOL,
): QuantumCandidate[] {
  if (all.length === 0) return [];

  const { boosted } = applyConsensusBoost(all);
  const sorted = [...boosted].sort(sortByQuality);

  const out: QuantumCandidate[] = [];
  const usedTarget = new Set<string>();
  const perSym = new Map<string, number>();

  for (const c of sorted) {
    const sym = c.symbol.toUpperCase();
    const n = perSym.get(sym) ?? 0;
    if (n >= maxPerSymbol) continue;
    const tk = targetBucketKey(c);
    if (usedTarget.has(tk)) continue;
    if (c.pips < 0.5) continue;

    usedTarget.add(tk);
    perSym.set(sym, n + 1);
    out.push(c);
    if (out.length >= limit) break;
  }

  if (out.length < limit) {
    for (const c of sorted) {
      if (out.length >= limit) break;
      const sym = c.symbol.toUpperCase();
      const n = perSym.get(sym) ?? 0;
      if (n >= maxPerSymbol + 1) continue;
      const tk = targetBucketKey(c);
      if (usedTarget.has(tk)) continue;
      if (c.pips < 0.5) continue;
      usedTarget.add(tk);
      perSym.set(sym, n + 1);
      out.push(c);
    }
  }

  return out.slice(0, limit);
}

export type QuantumAnalyzeFn = (
  entry: SymbolEntry,
  combo: QuantumParamCombo,
) => Promise<QuantumCandidate[]>;

/**
 * Multi-phase Quantum search loop with progress callbacks + filters.
 */
export async function runQuantumLoop(opts: {
  universe: SymbolEntry[];
  analyze: QuantumAnalyzeFn;
  refineCount?: number;
  pauseMs?: number;
  minProb?: number;
  minPips?: number;
  onProgress?: (e: QuantumProgressEvent) => void;
}): Promise<{
  all: QuantumCandidate[];
  scanned: number;
  errors: { symbol: string; error: string }[];
  phase1Scans: number;
  phase2Scans: number;
  refinedAssets: string[];
  consensusBoosts: number;
  topPrices: QuantumCandidate[];
}> {
  const pause = opts.pauseMs ?? 70;
  const minProb = opts.minProb ?? 0;
  const minPips = opts.minPips ?? 0;
  const all: QuantumCandidate[] = [];
  const errors: { symbol: string; error: string }[] = [];
  let scanned = 0;
  let phase1Scans = 0;
  let phase2Scans = 0;

  const p1Total = opts.universe.length * QUANTUM_PHASE1_GRID.length;
  const p2Total =
    (opts.refineCount ?? QUANTUM_REFINE_ASSETS) * QUANTUM_PHASE2_GRID.length;
  const totalEst = p1Total + p2Total + 1;

  const sleep = () => new Promise((r) => setTimeout(r, pause));
  const report = (e: QuantumProgressEvent) => {
    try {
      opts.onProgress?.(e);
    } catch {
      /* ignore */
    }
  };

  report({
    phase: 1,
    status: "phase1",
    label: "Wide scan",
    detail: "Scanning liquid assets…",
    current: 0,
    total: totalEst,
  });

  for (const entry of opts.universe) {
    for (const combo of QUANTUM_PHASE1_GRID) {
      scanned += 1;
      phase1Scans += 1;
      try {
        const got = await opts.analyze(entry, combo);
        all.push(...got);
      } catch (e) {
        errors.push({
          symbol: `${entry.value}/${combo.id}`,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      report({
        phase: 1,
        status: "phase1",
        label: "Wide scan",
        detail: `${entry.value} · ${combo.window}`,
        current: scanned,
        total: totalEst,
      });
      await sleep();
    }
  }

  const refineList = pickAssetsToRefine(
    all,
    opts.universe,
    opts.refineCount ?? QUANTUM_REFINE_ASSETS,
  );
  const refinedAssets = refineList.map((e) => e.value);

  report({
    phase: 2,
    status: "phase2",
    label: "Deep refine",
    detail: refinedAssets.join(", ") || "—",
    current: scanned,
    total: totalEst,
    refinedAssets,
  });

  for (const entry of refineList) {
    for (const combo of QUANTUM_PHASE2_GRID) {
      scanned += 1;
      phase2Scans += 1;
      try {
        const got = await opts.analyze(entry, combo);
        all.push(...got);
      } catch (e) {
        errors.push({
          symbol: `${entry.value}/${combo.id}`,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      report({
        phase: 2,
        status: "phase2",
        label: "Deep refine",
        detail: `${entry.value} · ${combo.id}`,
        current: scanned,
        total: totalEst,
        refinedAssets,
      });
      await sleep();
    }
  }

  report({
    phase: 3,
    status: "consensus",
    label: "Consensus",
    detail: "Scoring multi-window agreement…",
    current: scanned,
    total: totalEst,
    refinedAssets,
  });

  const { boostCount } = applyConsensusBoost(all);
  let topPrices = rankQuantumTop(all, QUANTUM_TOP_LIMIT);

  if (minProb > 0 || minPips > 0) {
    const filtered = topPrices.filter((c) => {
      const p = c.reachProb || c.probability;
      if (minProb > 0 && p < minProb) return false;
      if (minPips > 0 && c.pips < minPips) return false;
      return true;
    });
    if (filtered.length === 0) {
      topPrices = rankQuantumTop(all, QUANTUM_TOP_LIMIT).filter((c) => {
        const p = c.reachProb || c.probability;
        return (
          (minProb <= 0 || p >= minProb * 0.5) &&
          (minPips <= 0 || c.pips >= minPips * 0.5)
        );
      });
    } else {
      topPrices = filtered;
    }
  }

  report({
    phase: 3,
    status: "done",
    label: "Done",
    detail: `${topPrices.length} targets`,
    current: totalEst,
    total: totalEst,
    refinedAssets,
  });

  return {
    all,
    scanned,
    errors,
    phase1Scans,
    phase2Scans,
    refinedAssets,
    consensusBoosts: boostCount,
    topPrices,
  };
}
