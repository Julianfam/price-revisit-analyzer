import type { OHLCBar } from "./types";
import { resolveYahooSymbol } from "./symbols";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        currency?: string;
        instrumentType?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { code?: string; description?: string };
  };
};

/** Compatible Yahoo ranges per interval (best-effort). */
function clampRange(interval: string, range: string): string {
  const fine = new Set(["1m", "2m", "5m"]);
  if (fine.has(interval)) {
    if (["1y", "2y", "5y", "10y", "max", "ytd"].includes(range)) return "5d";
    if (["6mo", "3mo"].includes(range)) return "1mo";
    return range;
  }
  if (interval === "15m" || interval === "30m" || interval === "60m" || interval === "1h") {
    if (["2y", "5y", "10y", "max"].includes(range)) return "3mo";
    if (range === "1y") return "6mo";
    return range;
  }
  return range;
}


/** Short in-memory cache + in-flight coalesce (faster reloads / multi-poll). */
const yahooCache = new Map<
  string,
  { at: number; value: Awaited<ReturnType<typeof fetchYahooOHLCUncached>> }
>();
const yahooInflight = new Map<
  string,
  Promise<Awaited<ReturnType<typeof fetchYahooOHLCUncached>>>
>();
const YAHOO_TTL_MS = 45_000;

async function fetchYahooOHLCUncached(opts: {
  symbol: string;
  interval: string;
  range: string;
}): Promise<{ yahooSymbol: string; bars: OHLCBar[]; meta: { price?: number; currency?: string } }> {
  const yahooSymbol = resolveYahooSymbol(opts.symbol);
  const range = clampRange(opts.interval, opts.range);
  const interval = opts.interval === "1h" ? "60m" : opts.interval;

  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
  );
  url.searchParams.set("interval", interval);
  url.searchParams.set("range", range);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PriceRevisitAnalyzer/1.0; +https://x.ai)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance error ${res.status} for ${yahooSymbol}`);
  }

  const data = (await res.json()) as YahooChartResponse;
  if (data.chart?.error) {
    throw new Error(
      data.chart.error.description || data.chart.error.code || "Yahoo chart error",
    );
  }

  const result = data.chart?.result?.[0];
  if (!result?.timestamp?.length) {
    throw new Error(`No data returned for ${yahooSymbol}. Try another symbol or range.`);
  }

  const quote = result.indicators?.quote?.[0];
  if (!quote) {
    throw new Error(`Missing quote data for ${yahooSymbol}`);
  }

  const bars: OHLCBar[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    if (
      o == null ||
      h == null ||
      l == null ||
      c == null ||
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c)
    ) {
      continue;
    }
    bars.push({
      t: result.timestamp[i]! * 1000,
      o,
      h,
      l,
      c,
      v: quote.volume?.[i] ?? 0,
    });
  }

  if (bars.length < 10) {
    throw new Error(
      `Insufficient bars (${bars.length}) for ${yahooSymbol}. Widen range or use a coarser interval.`,
    );
  }

  return {
    yahooSymbol,
    bars,
    meta: {
      price: result.meta?.regularMarketPrice,
      currency: result.meta?.currency,
    },
  };
}


export async function fetchYahooOHLC(opts: {
  symbol: string;
  interval: string;
  range: string;
}): Promise<{ yahooSymbol: string; bars: OHLCBar[]; meta: { price?: number; currency?: string } }> {
  const yahooSymbol = resolveYahooSymbol(opts.symbol);
  const range = clampRange(opts.interval, opts.range);
  const interval = opts.interval === "1h" ? "60m" : opts.interval;
  const key = `${yahooSymbol}|${interval}|${range}`;
  const now = Date.now();
  const hit = yahooCache.get(key);
  if (hit && now - hit.at < YAHOO_TTL_MS) {
    return hit.value;
  }
  const inflight = yahooInflight.get(key);
  if (inflight) return inflight;

  const p = fetchYahooOHLCUncached(opts)
    .then((value) => {
      yahooCache.set(key, { at: Date.now(), value });
      yahooInflight.delete(key);
      return value;
    })
    .catch((err) => {
      yahooInflight.delete(key);
      throw err;
    });
  yahooInflight.set(key, p);
  return p;
}
