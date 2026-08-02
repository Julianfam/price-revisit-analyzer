/**
 * Unified market data: Yahoo (history bulk) + Alpha Vantage (live / FX spot when budget).
 */
import {
  fetchAvFxBars,
  fetchAvLivePrice,
  isAlphaVantageEnabled,
} from "./alpha-vantage";
import type { OHLCBar } from "./types";
import { fetchYahooOHLC } from "./yahoo";
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
  if (!bars.length || !(price > 0)) return bars;
  const out = bars.slice();
  const last = { ...out[out.length - 1]! };
  // Keep OHLC consistent with a fresh last trade
  last.c = price;
  last.h = Math.max(last.h, price);
  last.l = Math.min(last.l, price);
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
}): Promise<MarketOHLC> {
  const yahooSymbol = resolveYahooSymbol(opts.symbol);
  const useAv = isAlphaVantageEnabled() && !opts.yahooOnly;

  // Prefer Alpha Vantage spot FX bars when available (matches broker spot better than some Yahoo FX)
  if (useAv && yahooSymbol.endsWith("=X")) {
    try {
      const av = await fetchAvFxBars(opts.symbol, opts.interval);
      if (av && av.bars.length >= 10) {
        let bars = av.bars;
        // trim by rough range
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

  const y = await fetchYahooOHLC(opts);
  let bars = y.bars;
  let liveSource: string | undefined;
  let price = y.meta.price;

  // Overlay fresher AV last price (equities / crypto / FX) when budget allows
  if (useAv) {
    try {
      const live = await fetchAvLivePrice(opts.symbol);
      if (live) {
        // Sanity: ignore AV if wildly different from Yahoo last close (>25%) for non-futures
        const yLast = bars[bars.length - 1]?.c;
        const ok =
          !yLast ||
          Math.abs(live.price - yLast) / yLast < 0.25 ||
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
      price,
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
