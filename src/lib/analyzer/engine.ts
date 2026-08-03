import { allowsPriceDecimals, detectTick } from "./symbols";
import {
  minScenarioOffsetTicks,
  pipSize as scenarioPipSize,
} from "./pips";
import type {
  AggregateMetrics,
  AnalysisResult,
  LevelStats,
  OHLCBar,
  PathPoint,
  PriceScenario,
  RecentRevisit,
  ScenarioBundle,
  TrendResult,
  WindowStats,
} from "./types";

export function discretize(price: number, tick: number): number {
  if (tick <= 0) return price;
  const n = Math.round(price / tick) * tick;
  const decimals = tick >= 1 ? 0 : Math.min(10, Math.max(0, Math.ceil(-Math.log10(tick)) + 1));
  return Number(n.toFixed(decimals));
}

/**
 * Reconstruct intra-bar path so high/low touches are not lost.
 * Bullish: open → low → high → close
 * Bearish: open → high → low → close
 *
 * Timestamps are spread inside each bar so leave/return gaps are measurable.
 */
export function reconstructPath(bars: OHLCBar[], tick: number): PathPoint[] {
  const out: PathPoint[] = [];
  for (let bi = 0; bi < bars.length; bi++) {
    const bar = bars[bi]!;
    const sequence =
      bar.c >= bar.o
        ? [bar.o, bar.l, bar.h, bar.c]
        : [bar.o, bar.h, bar.l, bar.c];

    const nextT = bars[bi + 1]?.t;
    const barLen =
      nextT != null && nextT > bar.t
        ? nextT - bar.t
        : bi > 0
          ? Math.max(60_000, bar.t - bars[bi - 1]!.t)
          : 60_000;

    const seq: number[] = [];
    for (const p of sequence) {
      if (seq.length === 0 || Math.abs(p - seq[seq.length - 1]!) >= tick * 0.25) {
        seq.push(p);
      }
    }
    if (seq.length === 0) continue;

    for (let k = 0; k < seq.length; k++) {
      const p = seq[k]!;
      const frac = seq.length === 1 ? 0 : k / seq.length;
      const t = bar.t + Math.floor(frac * Math.max(0, barLen - 1));
      out.push({ t, price: p, level: discretize(p, tick) });
    }
  }
  return out;
}

export function countVisits(path: PathPoint[]): Map<number, number> {
  const visits = new Map<number, number>();
  if (path.length === 0) return visits;

  let current = path[0]!.level;
  visits.set(current, 1);

  for (let i = 1; i < path.length; i++) {
    const lv = path[i]!.level;
    if (lv !== current) {
      visits.set(lv, (visits.get(lv) ?? 0) + 1);
      current = lv;
    }
  }
  return visits;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

function estimateBarMs(path: PathPoint[]): number {
  const times: number[] = [];
  let prev = -1;
  for (const p of path) {
    if (p.t !== prev) {
      times.push(p.t);
      prev = p.t;
    }
  }
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const g = times[i]! - times[i - 1]!;
    if (g > 0 && g < 7 * 24 * 3600_000) gaps.push(g);
  }
  const med = median(gaps);
  return med > 0 ? med : 5 * 60_000;
}

/**
 * Meaningful retests only:
 * - Build contiguous presence segments per level
 * - On re-entry, timeAway = enterNow − leavePrevious
 * - Drop micro-chops shorter than ~2 bars (min 15m)
 * Newest `limit` events first.
 */
export function findRecentRevisits(
  path: PathPoint[],
  limit = 5,
  minAwayMsOverride?: number,
): RecentRevisit[] {
  if (path.length < 2) return [];

  const barMs = estimateBarMs(path);
  const minAwayMs =
    minAwayMsOverride ?? Math.max(15 * 60_000, Math.min(2 * barMs, 2 * 60 * 60_000));

  type Seg = { level: number; enterT: number; leaveT: number; visitNumber: number };
  const visitCount = new Map<number, number>();

  let curLevel = path[0]!.level;
  let enterT = path[0]!.t;
  visitCount.set(curLevel, 1);

  const segments: Seg[] = [];

  for (let i = 1; i < path.length; i++) {
    const pt = path[i]!;
    if (pt.level === curLevel) continue;

    const leaveT = path[i - 1]!.t;
    segments.push({
      level: curLevel,
      enterT,
      leaveT: Math.max(leaveT, enterT),
      visitNumber: visitCount.get(curLevel) ?? 1,
    });

    const next = pt.level;
    visitCount.set(next, (visitCount.get(next) ?? 0) + 1);
    curLevel = next;
    enterT = pt.t;
  }
  segments.push({
    level: curLevel,
    enterT,
    leaveT: path[path.length - 1]!.t,
    visitNumber: visitCount.get(curLevel) ?? 1,
  });

  const lastSegByLevel = new Map<number, Seg>();
  const events: RecentRevisit[] = [];

  for (const seg of segments) {
    const prev = lastSegByLevel.get(seg.level);
    if (prev && seg.visitNumber > 1) {
      const timeAwayMs = Math.max(0, seg.enterT - prev.leaveT);
      if (timeAwayMs >= minAwayMs - 1) {
        events.push({
          level: seg.level,
          visitNumber: seg.visitNumber,
          at: seg.enterT,
          leftAt: prev.leaveT,
          timeAwayMs,
        });
      }
    }
    lastSegByLevel.set(seg.level, seg);
  }

  return events.slice(-limit).reverse();
}

function levelStatsFromVisits(visits: Map<number, number>): LevelStats[] {
  return [...visits.entries()]
    .map(([level, v]) => ({
      level,
      visits: v,
      retests: Math.max(0, v - 1),
    }))
    .sort((a, b) => b.visits - a.visits || a.level - b.level);
}

export function sliceWindows(
  path: PathPoint[],
  windowMs: number,
): { start: number; end: number; points: PathPoint[] }[] {
  if (path.length === 0) return [];
  const t0 = path[0]!.t;
  const t1 = path[path.length - 1]!.t;
  const windows: { start: number; end: number; points: PathPoint[] }[] = [];

  let start = t0;
  while (start + windowMs * 0.5 <= t1) {
    const end = start + windowMs;
    const points = path.filter((p) => p.t >= start && p.t < end);
    if (points.length >= 4) {
      windows.push({ start, end, points });
    }
    start = end;
  }
  return windows;
}

export function analyzeWindows(path: PathPoint[], windowMs: number): WindowStats[] {
  const slices = sliceWindows(path, windowMs);
  return slices.map((w) => {
    const visits = countVisits(w.points);
    const stats = levelStatsFromVisits(visits);
    const n = stats.length || 1;
    const avgVisits = stats.reduce((s, x) => s + x.visits, 0) / n;
    const avgRetests = stats.reduce((s, x) => s + x.retests, 0) / n;
    const hot = stats[0] ?? null;
    const retested = stats.filter((x) => x.retests > 0).length;
    const mid = new Date((w.start + w.end) / 2);
    return {
      start: w.start,
      end: w.end,
      levelStats: stats,
      avgVisits,
      avgRetests,
      hotLevel: hot?.level ?? null,
      hotRetests: hot?.retests ?? 0,
      pctRetested: (retested / n) * 100,
      levelsTouched: stats.length,
      hour: mid.getUTCHours(),
      dayOfWeek: mid.getUTCDay(),
    };
  });
}

export function aggregateMetrics(windows: WindowStats[]): AggregateMetrics {
  if (windows.length === 0) {
    return {
      avgVisitsPerLevel: 0,
      avgRetestsPerLevel: 0,
      avgHotRetests: 0,
      pctLevelsRetested: 0,
      windowsAnalyzed: 0,
      bestWindow: null,
      hottestLevels: [],
      byHour: [],
      byDay: [],
    };
  }

  const avgVisitsPerLevel =
    windows.reduce((s, w) => s + w.avgVisits, 0) / windows.length;
  const avgRetestsPerLevel =
    windows.reduce((s, w) => s + w.avgRetests, 0) / windows.length;
  const avgHotRetests =
    windows.reduce((s, w) => s + w.hotRetests, 0) / windows.length;
  const pctLevelsRetested =
    windows.reduce((s, w) => s + w.pctRetested, 0) / windows.length;

  let bestWindow = windows[0]!;
  for (const w of windows) {
    if (w.avgRetests > bestWindow.avgRetests) bestWindow = w;
  }

  const global = new Map<number, { visits: number; retests: number }>();
  for (const w of windows) {
    for (const ls of w.levelStats) {
      const g = global.get(ls.level) ?? { visits: 0, retests: 0 };
      g.visits += ls.visits;
      g.retests += ls.retests;
      global.set(ls.level, g);
    }
  }
  const hottestLevels = [...global.entries()]
    .map(([level, v]) => ({
      level,
      visits: v.visits,
      retests: v.retests,
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 12);

  const hourMap = new Map<number, { visits: number; retests: number; count: number }>();
  const dayMap = new Map<number, { visits: number; retests: number; count: number }>();
  for (const w of windows) {
    const h = hourMap.get(w.hour) ?? { visits: 0, retests: 0, count: 0 };
    h.visits += w.avgVisits;
    h.retests += w.avgRetests;
    h.count += 1;
    hourMap.set(w.hour, h);

    const d = dayMap.get(w.dayOfWeek) ?? { visits: 0, retests: 0, count: 0 };
    d.visits += w.avgVisits;
    d.retests += w.avgRetests;
    d.count += 1;
    dayMap.set(w.dayOfWeek, d);
  }

  const byHour = [...hourMap.entries()]
    .map(([hour, v]) => ({
      hour,
      avgVisits: v.visits / v.count,
      avgRetests: v.retests / v.count,
      count: v.count,
    }))
    .sort((a, b) => a.hour - b.hour);

  const byDay = [...dayMap.entries()]
    .map(([day, v]) => ({
      day,
      avgVisits: v.visits / v.count,
      avgRetests: v.retests / v.count,
      count: v.count,
    }))
    .sort((a, b) => a.day - b.day);

  return {
    avgVisitsPerLevel,
    avgRetestsPerLevel,
    avgHotRetests,
    pctLevelsRetested,
    windowsAnalyzed: windows.length,
    bestWindow,
    hottestLevels,
    byHour,
    byDay,
  };
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export function computeTrend(
  bars: OHLCBar[],
  path: PathPoint[],
  tick: number,
): TrendResult {
  if (bars.length < 5) {
    return {
      score: 50,
      pBull: 33,
      pBear: 33,
      pSide: 34,
      label: "lateral",
      factors: [],
    };
  }

  const last = bars[bars.length - 1]!.c;
  const first = bars[0]!.c;
  const ret = (last - first) / (Math.abs(first) || 1);

  const n = Math.min(20, bars.length);
  const recent = bars.slice(-n);
  const older = bars.slice(Math.max(0, bars.length - 2 * n), bars.length - n);
  const recentMid = recent.reduce((s, b) => s + b.c, 0) / recent.length;
  const olderMid =
    older.length > 0
      ? older.reduce((s, b) => s + b.c, 0) / older.length
      : recentMid;
  const momentum = (recentMid - olderMid) / (Math.abs(olderMid) || 1);

  let upStruct = 0;
  let downStruct = 0;
  const step = Math.max(1, Math.floor(bars.length / 12));
  const piv: number[] = [];
  for (let i = step; i < bars.length; i += step) piv.push(bars[i]!.c);
  for (let i = 2; i < piv.length; i++) {
    if (piv[i]! > piv[i - 1]! && piv[i - 1]! > piv[i - 2]!) upStruct++;
    if (piv[i]! < piv[i - 1]! && piv[i - 1]! < piv[i - 2]!) downStruct++;
  }
  const structure =
    upStruct + downStruct > 0
      ? (upStruct - downStruct) / (upStruct + downStruct)
      : 0;

  const prices = path.map((p) => p.level);
  const mid =
    prices.length > 0
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : last;
  let above = 0;
  let below = 0;
  for (const p of path) {
    if (p.level >= mid) above++;
    else below++;
  }
  const asymmetry =
    above + below > 0 ? (above - below) / (above + below) : 0;

  const range = Math.max(...bars.map((b) => b.h)) - Math.min(...bars.map((b) => b.l));
  const atrLike =
    bars.reduce((s, b) => s + (b.h - b.l), 0) / bars.length / (Math.abs(last) || 1);
  const rangePct = range / (Math.abs(last) || 1);
  const compression = 1 - clamp01(rangePct / (atrLike * 8 + 1e-9));

  const factors = [
    { name: "Retorno", value: Math.tanh(ret * 40), weight: 0.28 },
    { name: "Momentum", value: Math.tanh(momentum * 30), weight: 0.24 },
    { name: "Estructura HH/HL", value: clamp01((structure + 1) / 2) * 2 - 1, weight: 0.22 },
    { name: "Asimetría visitas", value: asymmetry, weight: 0.16 },
    { name: "Rango (lateralidad)", value: -(compression * 2 - 1) * 0.5, weight: 0.1 },
  ];

  let raw = 0;
  let wSum = 0;
  for (const f of factors) {
    raw += f.value * f.weight;
    wSum += f.weight;
  }
  const directional = raw / (wSum || 1);
  const score = Math.round(clamp01((directional + 1) / 2) * 100);

  const bullEnergy = Math.exp(directional * 2.2);
  const bearEnergy = Math.exp(-directional * 2.2);
  const sideEnergy = Math.exp((1 - Math.abs(directional)) * 2.5 + compression * 1.5);
  const z = bullEnergy + bearEnergy + sideEnergy;
  const pBull = (bullEnergy / z) * 100;
  const pBear = (bearEnergy / z) * 100;
  const pSide = (sideEnergy / z) * 100;

  let label: TrendResult["label"] = "lateral";
  if (pBull >= pBear && pBull >= pSide && score >= 55) label = "alcista";
  else if (pBear >= pBull && pBear >= pSide && score <= 45) label = "bajista";

  void tick;

  return { score, pBull, pBear, pSide, label, factors };
}

export { minScenarioOffsetTicks } from "./pips";


export function computeScenarios(
  path: PathPoint[],
  windowMs: number,
  tick: number,
  maxScenarios = 5,
  yahooSymbol = "EURUSD=X",
): ScenarioBundle {
  const minOff = minScenarioOffsetTicks(yahooSymbol, tick);

  if (path.length < 20) {
    const last = path[path.length - 1];
    if (!last) {
      return {
        scenarios: [],
        firstImpulseUp: 50,
        firstImpulseDown: 50,
        revisitCurrent: 0,
        currentPrice: 0,
        currentLevel: 0,
        horizonLabel: formatHorizon(windowMs),
      };
    }
    // Fallback: synthetic ±min levels (never current)
    const scenarios: PriceScenario[] = [
      {
        price: discretize(last.level + minOff * tick, tick),
        offsetTicks: minOff,
        probability: 50,
        histTouch: 50,
        reachProb: 50,
        isMagnet: false,
      },
      {
        price: discretize(last.level - minOff * tick, tick),
        offsetTicks: -minOff,
        probability: 50,
        histTouch: 50,
        reachProb: 50,
        isMagnet: false,
      },
    ];
    return {
      scenarios,
      firstImpulseUp: 50,
      firstImpulseDown: 50,
      revisitCurrent: 0,
      currentPrice: last.price,
      currentLevel: last.level,
      horizonLabel: formatHorizon(windowMs),
    };
  }

  const tEnd = path[path.length - 1]!.t;
  const tStart = path[0]!.t;
  const span = Math.max(1, tEnd - tStart);
  const stride = Math.max(1, Math.floor(path.length / 400));

  const touchWeight = new Map<number, number>();
  const reachCount = new Map<number, number>();
  const magnetWeight = new Map<number, number>();
  let sampleN = 0;
  let impulseUp = 0;
  let impulseDown = 0;
  let impulseN = 0;
  let revisit = 0;
  let leaveN = 0;

  for (let i = 0; i < path.length - 5; i += stride) {
    const origin = path[i]!;
    const winEnd = origin.t + windowMs;
    if (winEnd > tEnd) break;

    const age = (tEnd - origin.t) / span;
    const w = Math.exp(-2.5 * age);

    const visited = new Set<number>();
    const visitCounts = new Map<number, number>();
    let prevLevel = origin.level;
    visitCounts.set(prevLevel, 1);

    let left = false;
    let firstDir: -1 | 0 | 1 = 0;
    let returned = false;

    for (let j = i + 1; j < path.length; j++) {
      const p = path[j]!;
      if (p.t > winEnd) break;

      const off = Math.round((p.level - origin.level) / tick);
      visited.add(off);

      if (p.level !== prevLevel) {
        visitCounts.set(off, (visitCounts.get(off) ?? 0) + 1);
        if (!left && p.level !== origin.level) {
          left = true;
          firstDir = p.level > origin.level ? 1 : -1;
        }
        if (left && p.level === origin.level) returned = true;
        prevLevel = p.level;
      }
    }

    sampleN += 1;
    for (const off of visited) {
      touchWeight.set(off, (touchWeight.get(off) ?? 0) + w);
      reachCount.set(off, (reachCount.get(off) ?? 0) + 1);
    }

    let magnetOff = 0;
    let magnetV = -1;
    for (const [off, v] of visitCounts) {
      if (v > magnetV || (v === magnetV && Math.abs(off) < Math.abs(magnetOff))) {
        magnetV = v;
        magnetOff = off;
      }
    }
    // Prefer magnets that are not the origin itself for ranking
    magnetWeight.set(magnetOff, (magnetWeight.get(magnetOff) ?? 0) + w * 1.4);

    if (left) {
      leaveN++;
      if (returned) revisit++;
      if (firstDir === 1) impulseUp++;
      else if (firstDir === -1) impulseDown++;
      impulseN++;
    }
  }

  const combined = new Map<number, number>();
  const allKeys = new Set([...touchWeight.keys(), ...magnetWeight.keys()]);
  for (const k of allKeys) {
    // Zero out / ignore near-zero offsets in ranking (current price)
    if (Math.abs(k) < minOff) continue;
    const score = (touchWeight.get(k) ?? 0) + (magnetWeight.get(k) ?? 0);
    if (score > 0) combined.set(k, score);
  }

  // If everything was near zero, fall back to farther offsets from touchWeight
  if (combined.size === 0) {
    for (const [k, score] of touchWeight) {
      if (Math.abs(k) < minOff) continue;
      combined.set(k, score);
    }
  }

  const offsets = [...combined.keys()].sort((a, b) => a - b);
  const peaks: { off: number; score: number }[] = [];
  for (const off of offsets) {
    const s = combined.get(off) ?? 0;
    const left = combined.get(off - 1) ?? 0;
    const right = combined.get(off + 1) ?? 0;
    if (s >= left && s >= right && s > 0) {
      peaks.push({ off, score: s });
    }
  }
  if (peaks.length < 3) {
    peaks.length = 0;
    for (const [off, score] of combined) {
      peaks.push({ off, score });
    }
  }

  peaks.sort((a, b) => b.score - a.score || Math.abs(b.off) - Math.abs(a.off));

  const selected: { off: number; score: number }[] = [];
  // Separation in ticks: at least 2, or half of minOff
  const sep = Math.max(2, Math.floor(minOff / 2));

  for (const p of peaks) {
    if (Math.abs(p.off) < minOff) continue;
    if (selected.some((s) => Math.abs(s.off - p.off) < sep)) continue;
    selected.push(p);
    if (selected.length >= maxScenarios) break;
  }

  // Ensure at least one up and one down when data allows
  if (selected.length > 0) {
    const hasUp = selected.some((s) => s.off > 0);
    const hasDown = selected.some((s) => s.off < 0);
    if (!hasUp) {
      const up = peaks.find(
        (p) => p.off >= minOff && !selected.some((s) => Math.abs(s.off - p.off) < sep),
      );
      if (up) selected.push(up);
    }
    if (!hasDown) {
      const down = peaks.find(
        (p) => p.off <= -minOff && !selected.some((s) => Math.abs(s.off - p.off) < sep),
      );
      if (down) selected.push(down);
    }
  }

  // Still empty: seed min-offset synthetic levels from residual weights
  if (selected.length === 0) {
    selected.push({ off: minOff, score: 1 });
    selected.push({ off: -minOff, score: 1 });
  }

  const totalSel = selected.reduce((s, x) => s + x.score, 0) || 1;
  const totalTouch =
    [...touchWeight.entries()]
      .filter(([off]) => Math.abs(off) >= minOff)
      .reduce((a, [, v]) => a + v, 0) || 1;

  let magnetOff = minOff;
  let magnetScore = -1;
  for (const [off, sc] of magnetWeight) {
    if (Math.abs(off) < minOff) continue;
    if (sc > magnetScore) {
      magnetScore = sc;
      magnetOff = off;
    }
  }

  const current = path[path.length - 1]!;
  const scenarios: PriceScenario[] = selected
    .filter((s) => Math.abs(s.off) >= minOff)
    .map((s) => ({
      price: discretize(current.level + s.off * tick, tick),
      offsetTicks: s.off,
      probability: (s.score / totalSel) * 100,
      histTouch: ((touchWeight.get(s.off) ?? 0) / totalTouch) * 100,
      reachProb: sampleN > 0 ? ((reachCount.get(s.off) ?? 0) / sampleN) * 100 : 0,
      isMagnet: s.off === magnetOff,
    }))
    .filter((s) => Math.abs(s.price - current.level) >= minOff * tick * 0.99)
    .sort((a, b) => b.probability - a.probability);

  // Renormalize to 100% among shown
  const pSum = scenarios.reduce((s, x) => s + x.probability, 0) || 1;
  for (const sc of scenarios) {
    sc.probability = (sc.probability / pSum) * 100;
  }

  return {
    scenarios,
    firstImpulseUp: impulseN > 0 ? (impulseUp / impulseN) * 100 : 50,
    firstImpulseDown: impulseN > 0 ? (impulseDown / impulseN) * 100 : 50,
    revisitCurrent: leaveN > 0 ? (revisit / leaveN) * 100 : 0,
    currentPrice: current.price,
    currentLevel: current.level,
    horizonLabel: formatHorizon(windowMs),
  };
}

function formatHorizon(ms: number): string {
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60000)}m`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

export function runAnalysis(opts: {
  symbol: string;
  yahooSymbol: string;
  bars: OHLCBar[];
  interval: string;
  range: string;
  windowMs: number;
  windowLabel: string;
  tickOverride?: number | null;
  /** Cap scenarios returned (Free 2 / Pro 5). */
  maxScenarios?: number;
  /** Cap recent revisits (Free 5 / Pro 12). */
  maxRecentRevisits?: number;
  /** Live / regular market price overlay (preferred for display). */
  livePrice?: number | null;
}): AnalysisResult {
  const sample = opts.bars.flatMap((b) => [b.o, b.h, b.l, b.c]);
  let tick =
    opts.tickOverride && opts.tickOverride > 0
      ? opts.tickOverride
      : detectTick(opts.yahooSymbol, sample);

  if (
    !allowsPriceDecimals(opts.yahooSymbol) &&
    !(opts.tickOverride && opts.tickOverride > 0)
  ) {
    tick = 1;
  }

  const path = reconstructPath(opts.bars, tick);
  const windows = analyzeWindows(path, opts.windowMs);
  const metrics = aggregateMetrics(windows);
  const trend = computeTrend(opts.bars, path, tick);
  const maxSc = Math.max(1, Math.min(8, opts.maxScenarios ?? 5));
  const maxRev = Math.max(1, Math.min(20, opts.maxRecentRevisits ?? 5));
  const scenarios = computeScenarios(
    path,
    opts.windowMs,
    tick,
    maxSc,
    opts.yahooSymbol,
  );
  const recentRevisits = findRecentRevisits(path, maxRev);

  if (!allowsPriceDecimals(opts.yahooSymbol)) {
    tick = Math.max(1, Math.round(tick));
    for (const sc of scenarios.scenarios) {
      sc.price = Math.round(sc.price);
      sc.offsetTicks = Math.round(sc.offsetTicks);
    }
    scenarios.currentLevel = Math.round(scenarios.currentLevel);
    for (const r of recentRevisits) {
      r.level = Math.round(r.level);
    }
  }

  const barLast = opts.bars[opts.bars.length - 1]?.c ?? scenarios.currentPrice;
  const live =
    opts.livePrice != null &&
    Number.isFinite(opts.livePrice) &&
    opts.livePrice > 0
      ? opts.livePrice
      : null;
  let lastPrice = barLast;
  if (live != null) {
    const rel = barLast > 0 ? Math.abs(live - barLast) / barLast : 0;
    if (rel < 0.05 || allowsPriceDecimals(opts.yahooSymbol)) {
      lastPrice = live;
      scenarios.currentPrice = lastPrice;
    }
  }

  return {
    symbol: opts.symbol,
    yahooSymbol: opts.yahooSymbol,
    tick,
    interval: opts.interval,
    range: opts.range,
    windowMs: opts.windowMs,
    windowLabel: opts.windowLabel,
    bars: opts.bars,
    lastPrice: allowsPriceDecimals(opts.yahooSymbol)
      ? lastPrice
      : Math.round(lastPrice),
    metrics,
    trend,
    scenarios,
    windows,
    recentRevisits,
    fetchedAt: Date.now(),
  };
}
