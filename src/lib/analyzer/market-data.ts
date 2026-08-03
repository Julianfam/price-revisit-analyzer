/**
 * Unified market data: Yahoo (history bulk) + Alpha Vantage (live overlay).
 */
import {
  fetchAvFxBars,
  fetchAvLivePrice,
  isAlphaVantageEnabled,
} from "./alpha-vantage";
import type { OHLCBar } from "./types";
import { fetchYahooOHLC, invalidateYahooCache } from "./yahoo";
import { resolveYahooSymbol } from "./symbols";

export type MarketOHLC = {
  yahooSymbol: string;
  bars: OHLCBar[];
  meta: {
    price?: number;
    currency?: string;
    source?: string;
    liveSource?: string;
  };
};

function patchLastPrice(bars: OHLCBar[], price: number): OHLCBar[] {
  if (!bars.length || !(price > 0) || !Number.isFinite(price)) return bars;
  const out = bars.slice();
  const last = { ...out[out.length - 1]! };
  last.c = price;
  last.h = Math.max(last.h, price);
  last.l = Math.min(last.l, price);
  // Mark bar time as "now" so UI knows price is fresh
  last.t = Math.max(last.t, Date.now() - 1000);
  out[out.length - 1] = last;
  return out;
}

/**
 * Primary OHLC fetch used by analyze / scalper / quantum / live quote.
 */
export async function fetchMarketOHLC(opts: {
  symbol: string;
  interval: string;
  range: string;
  /** When true, skip AV (e.g. Quantum multi-scan to save free quota). */
  yahooOnly?: boolean;
  /** User clicked Analyze — bypass caches and pull freshest spot. */
  forceRefresh?: boolean;
}): Promise<MarketOHLC> {
  const yahooSymbol = resolveYahooSymbol(opts.symbol);
  const useAv = isAlphaVantageEnabled() && !opts.yahooOnly;
  const force = !!opts.forceRefresh;

  if (force) invalidateYahooCache(opts.symbol);

  // Prefer Alpha Vantage spot FX bars when available
  if (useAv && yahooSymbol.endsWith("=X")) {
    try {
      const av = await fetchAvFxBars(opts.symbol, opts.interval);
      if (av && av.bars.length >= 10) {
        let bars = av.bars;
        const rangeMs = rangeToMs(opts.range);
        if (rangeMs > 0) {
          const cut = Date.now() - rangeMs;
          const trimmed = bars.filter((b) => b.t >= cut);
          if (trimmed.length >= 10) bars = trimmed;
        }
        const live = await fetchAvLivePrice(opts.symbol);
        if (live) bars = patchLastPrice(bars, live.price);
        return {
          yahooSymbol,
          bars,
          meta: {
            price: live?.price ?? bars[bars.length - 1]?.c,
            source: av.source,
            liveSource: live?.source,
          },
        };
      }
    } catch {
      /* fall through to Yahoo */
    }
  }

  const y = await fetchYahooOHLC({
    symbol: opts.symbol,
    interval: opts.interval,
    range: opts.range,
    forceRefresh: force,
  });
  let bars = y.bars;
  let liveSource: string | undefined;
  let price = y.meta.price;

  // Always overlay Yahoo regularMarketPrice onto the last bar (fresher than closed bar)
  if (price && price > 0) {
    bars = patchLastPrice(bars, price);
  }

  // On user refresh: also pull 1m chart for a tighter last print
  if (force && opts.interval !== "1m" && opts.interval !== "2m") {
    try {
      const m1 = await fetchYahooOHLC({
        symbol: opts.symbol,
        interval: "1m",
        range: "1d",
        forceRefresh: true,
      });
      const livePx =
        m1.meta.price ??
        (m1.bars.length ? m1.bars[m1.bars.length - 1]!.c : undefined);
      if (livePx && livePx > 0) {
        const yLast = bars[bars.length - 1]?.c;
        const ok =
          !yLast ||
          Math.abs(livePx - yLast) / Math.abs(yLast) < 0.05 ||
          yahooSymbol.endsWith("=X");
        if (ok) {
          bars = patchLastPrice(bars, livePx);
          price = livePx;
          liveSource = "yahoo-1m";
        }
      }
    } catch {
      /* keep chart bars */
    }
  }

  // Overlay AV last price when budget allows
  if (useAv) {
    try {
      const live = await fetchAvLivePrice(opts.symbol);
      if (live) {
        const yLast = bars[bars.length - 1]?.c;
        const ok =
          !yLast ||
          Math.abs(live.price - yLast) / Math.abs(yLast) < 0.25 ||
          yahooSymbol.endsWith("=X");
        if (ok) {
          bars = patchLastPrice(bars, live.price);
          price = live.price;
          liveSource = live.source;
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    yahooSymbol: y.yahooSymbol,
    bars,
    meta: {
      price: price ?? bars[bars.length - 1]?.c,
      currency: y.meta.currency,
      source: liveSource ? `yahoo+${liveSource}` : "yahoo",
      liveSource,
    },
  };
}

function rangeToMs(range: string): number {
  switch (range) {
    case "1d":
      return 1 * 24 * 60 * 60_000;
    case "5d":
      return 5 * 24 * 60 * 60_000;
    case "1mo":
      return 31 * 24 * 60 * 60_000;
    case "3mo":
      return 93 * 24 * 60 * 60_000;
    case "6mo":
      return 186 * 24 * 60 * 60_000;
    case "1y":
      return 366 * 24 * 60 * 60_000;
    default:
      return 0;
  }
}
