import type { AnalysisResult } from "./types";

const KEY = "pra-analysis-cache-v1";
const TTL_MS = 90_000;

type CacheEntry = {
  key: string;
  at: number;
  result: AnalysisResult;
};

function paramsKey(p: {
  symbol: string;
  interval: string;
  range: string;
  window: string;
  tick: string | null;
}): string {
  return [
    p.symbol.toUpperCase(),
    p.interval,
    p.range,
    p.window,
    p.tick ?? "auto",
  ].join("|");
}

export function readAnalysisCache(p: {
  symbol: string;
  interval: string;
  range: string;
  window: string;
  tick: string | null;
}): AnalysisResult | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.key !== paramsKey(p)) return null;
    if (Date.now() - entry.at > TTL_MS) return null;
    return entry.result;
  } catch {
    return null;
  }
}

export function writeAnalysisCache(
  p: {
    symbol: string;
    interval: string;
    range: string;
    window: string;
    tick: string | null;
  },
  result: AnalysisResult,
): void {
  try {
    const entry: CacheEntry = {
      key: paramsKey(p),
      at: Date.now(),
      result,
    };
    sessionStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    /* quota */
  }
}
