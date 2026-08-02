import { reconstructPath, discretize } from "./engine";
import { pipSize, priceDiffToPips } from "./pips";
import { allowsPriceDecimals, detectTick } from "./symbols";
import type { AnalysisResult, OHLCBar, PriceScenario, ScalperSetup } from "./types";

const PROB_THRESHOLD = 80;
const MIN_PIPS_DEFAULT = 8;

export { pipSize } from "./pips";

export function priceToPips(
  yahooSymbol: string,
  priceDiff: number,
  tick: number,
): number {
  return Math.abs(priceDiffToPips(yahooSymbol, priceDiff, tick));
}

export function minPipsFor(
  yahooSymbol: string,
  atrPips: number,
  windowMs: number,
): number {
  const s = yahooSymbol.toUpperCase();
  let base = MIN_PIPS_DEFAULT;
  if (s === "USDCOP=X") base = 20;
  else if (s.endsWith("=X")) base = 6;
  else base = 1;

  const hourFrac = windowMs / (60 * 60 * 1000);
  const windowScale = Math.sqrt(Math.max(0.2, Math.min(hourFrac, 4)));
  const atrFloor = atrPips * 0.15;
  return Math.max(base, Math.round(atrFloor * windowScale));
}

function atrPipsFromBars(
  bars: OHLCBar[],
  yahooSymbol: string,
  tick: number,
  lookback = 40,
): number {
  if (bars.length < 2) return 0;
  const slice = bars.slice(-lookback);
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const b = slice[i]!;
    const prev = slice[i - 1]!;
    const tr = Math.max(
      b.h - b.l,
      Math.abs(b.h - prev.c),
      Math.abs(b.l - prev.c),
    );
    sum += tr;
  }
  const atr = sum / Math.max(1, slice.length - 1);
  return priceToPips(yahooSymbol, atr, tick);
}

/** MFE / MAE over recent path windows in pip units. */
function excursionStats(
  bars: OHLCBar[],
  yahooSymbol: string,
  tick: number,
  direction: "up" | "down",
  windowMs: number,
): { mfe: number; mae: number } {
  if (bars.length < 8) return { mfe: 0, mae: 0 };
  const path = reconstructPath(bars, tick);
  if (path.length < 10) return { mfe: 0, mae: 0 };

  let mfeSum = 0;
  let maeSum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(path.length / 40));

  for (let i = 0; i < path.length - 5; i += step) {
    const a = path[i]!;
    const endT = a.t + windowMs;
    let maxFav = 0;
    let maxAdv = 0;
    for (let j = i + 1; j < path.length; j++) {
      const p = path[j]!;
      if (p.t > endT) break;
      const d = priceToPips(yahooSymbol, p.price - a.price, tick);
      if (direction === "up") {
        maxFav = Math.max(maxFav, d);
        maxAdv = Math.max(maxAdv, -d);
      } else {
        maxFav = Math.max(maxFav, -d);
        maxAdv = Math.max(maxAdv, d);
      }
    }
    mfeSum += maxFav;
    maeSum += maxAdv;
    n += 1;
  }
  if (n === 0) return { mfe: 0, mae: 0 };
  return { mfe: mfeSum / n, mae: maeSum / n };
}

function oppositeScenario(
  scenarios: PriceScenario[],
  sc: PriceScenario,
): PriceScenario | undefined {
  const wantDir = sc.offsetTicks >= 0 ? "down" : "up";
  const absOff = Math.abs(sc.offsetTicks);
  let best: PriceScenario | undefined;
  let bestDist = Infinity;
  for (const o of scenarios) {
    const dir = o.offsetTicks >= 0 ? "up" : "down";
    if (dir !== wantDir) continue;
    const dist = Math.abs(Math.abs(o.offsetTicks) - absOff);
    if (dist < bestDist) {
      bestDist = dist;
      best = o;
    }
  }
  return best;
}

/**
 * Turn one asset analysis into ranked scalper candidates.
 */
export function setupsFromAnalysis(result: AnalysisResult): ScalperSetup[] {
  const { yahooSymbol, tick, scenarios, bars, windowLabel, windowMs, symbol } =
    result;
  const scList = scenarios.scenarios ?? [];
  if (scList.length === 0) return [];

  const atr = atrPipsFromBars(bars, yahooSymbol, tick);
  const minPips = minPipsFor(yahooSymbol, atr, windowMs);
  const out: ScalperSetup[] = [];

  for (const sc of scList) {
    const pips = priceToPips(
      yahooSymbol,
      Math.abs(sc.price - scenarios.currentPrice),
      tick,
    );
    if (pips + 1e-9 < minPips) continue;

    const direction: "up" | "down" =
      sc.price >= scenarios.currentPrice ? "up" : "down";
    const opp = oppositeScenario(scList, sc);
    const oppositeProb = opp?.reachProb ?? opp?.probability ?? 0;
    const reach = sc.reachProb ?? sc.probability;
    const edge = reach - oppositeProb;
    const { mfe, mae } = excursionStats(
      bars,
      yahooSymbol,
      tick,
      direction,
      windowMs,
    );

    // Score: high reach + edge + pips vs ATR + MFE quality
    const pipScore = Math.min(30, (pips / Math.max(minPips, 1)) * 12);
    const reachScore = Math.min(40, reach * 0.4);
    const edgeScore = Math.min(20, Math.max(0, edge) * 0.35);
    const mfeScore = Math.min(10, (mfe / Math.max(pips, 1)) * 8);
    const score = reachScore + edgeScore + pipScore + mfeScore;

    out.push({
      symbol,
      yahooSymbol,
      currentPrice: scenarios.currentPrice,
      targetPrice: sc.price,
      direction,
      pips,
      probability: reach,
      histTouch: sc.histTouch,
      isMagnet: sc.isMagnet,
      tick,
      windowLabel,
      score,
      meetsThreshold: reach >= PROB_THRESHOLD && pips >= minPips,
      edge,
      oppositeProb,
      samples: Math.max(1, Math.round((scenarios.scenarios.length || 1) * 8)),
      atrPips: atr,
      avgMfe: mfe,
      avgMae: mae,
    });
  }

  return out;
}

export function rankScalperSetups(
  setups: ScalperSetup[],
  topN = 5,
): ScalperSetup[] {
  const bySym = new Map<string, ScalperSetup>();
  for (const s of setups) {
    const key = s.yahooSymbol.toUpperCase();
    const prev = bySym.get(key);
    if (!prev || s.score > prev.score) bySym.set(key, s);
  }

  return [...bySym.values()]
    .sort((a, b) => {
      // Prefer threshold-meeters, then score, then pips
      if (a.meetsThreshold !== b.meetsThreshold) {
        return a.meetsThreshold ? -1 : 1;
      }
      if (b.score !== a.score) return b.score - a.score;
      return b.pips - a.pips;
    })
    .slice(0, topN);
}
