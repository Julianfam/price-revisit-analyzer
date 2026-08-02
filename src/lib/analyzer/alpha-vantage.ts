/**
 * Alpha Vantage client (server-only).
 * Free keys: ~25 req/day + 1/sec — use sparingly with long TTL cache.
 * Never import this from client components.
 */
import type { OHLCBar } from "./types";
import { resolveYahooSymbol } from "./symbols";

const BASE = "https://www.alphavantage.co/query";

function apiKey(): string | null {
  const k = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!k || process.env.ALPHA_VANTAGE_ENABLED === "false") return null;
  return k;
}

export function isAlphaVantageEnabled(): boolean {
  return !!apiKey();
}

/** Soft daily budget (free default 25). Leave headroom. */
const DAILY_BUDGET = Number(process.env.ALPHA_VANTAGE_DAILY_BUDGET || 20);
const MIN_GAP_MS = 1200;
const CACHE_TTL_MS = 5 * 60_000; // 5 min — stretch free quota

type CacheEntry = { at: number; json: unknown };
const cache = new Map<string, CacheEntry>();
let lastCallAt = 0;
let dayKey = "";
let dayCount = 0;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function budgetLeft(): number {
  const d = todayKey();
  if (d !== dayKey) {
    dayKey = d;
    dayCount = 0;
  }
  return Math.max(0, DAILY_BUDGET - dayCount);
}

async function avFetch(params: Record<string, string>): Promise<unknown | null> {
  const key = apiKey();
  if (!key) return null;
  if (budgetLeft() <= 0) return null;

  const qs = new URLSearchParams({ ...params, apikey: key });
  const cacheKey = qs.toString().replace(/apikey=[^&]+/, "apikey=***");
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.json;

  const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  lastCallAt = Date.now();
  dayCount += 1;

  try {
    const res = await fetch(`${BASE}?${qs.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    if (json.Note || json.Information) {
      // rate limited — don't cache as success forever
      console.warn("[alpha-vantage] rate limit / info:", json.Note || json.Information);
      return null;
    }
    if (json["Error Message"]) {
      console.warn("[alpha-vantage] error:", json["Error Message"]);
      return null;
    }
    cache.set(cacheKey, { at: Date.now(), json });
    return json;
  } catch (e) {
    console.warn("[alpha-vantage] fetch failed", e);
    return null;
  }
}

function parseSeries(
  series: Record<string, Record<string, string>> | undefined,
): OHLCBar[] {
  if (!series) return [];
  const bars: OHLCBar[] = [];
  for (const [ts, row] of Object.entries(series)) {
    const o = Number(row["1. open"] ?? row["1a. open (USD)"]);
    const h = Number(row["2. high"] ?? row["2a. high (USD)"]);
    const l = Number(row["3. low"] ?? row["3a. low (USD)"]);
    const c = Number(row["4. close"] ?? row["4a. close (USD)"]);
    const v = Number(row["5. volume"] ?? row["5. volume"] ?? 0);
    if (![o, h, l, c].every(Number.isFinite)) continue;
    const t = Date.parse(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
    if (!Number.isFinite(t)) continue;
    bars.push({ t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  bars.sort((a, b) => a.t - b.t);
  return bars;
}

/** Map app interval → AV interval string */
function avInterval(interval: string): string | null {
  if (interval === "1m") return "1min";
  if (interval === "5m") return "5min";
  if (interval === "15m") return "15min";
  if (interval === "1h" || interval === "60m") return "60min";
  return null; // daily handled separately
}

type FxPair = { from: string; to: string };

function asFxPair(yahooOrApp: string): FxPair | null {
  const s = yahooOrApp.toUpperCase().replace("=X", "");
  if (s.length === 6 && /^[A-Z]{6}$/.test(s)) {
    return { from: s.slice(0, 3), to: s.slice(3) };
  }
  return null;
}

function isCrypto(yahoo: string): { from: string; to: string } | null {
  const s = yahoo.toUpperCase();
  if (s === "BTC-USD" || s === "BTCUSD") return { from: "BTC", to: "USD" };
  if (s === "ETH-USD" || s === "ETHUSD") return { from: "ETH", to: "USD" };
  if (s === "ETH-BTC") return { from: "ETH", to: "BTC" };
  return null;
}

/**
 * Live last price from Alpha Vantage (spot FX, equity quote, crypto).
 * Returns null if disabled / budget / unsupported.
 */
export async function fetchAvLivePrice(symbol: string): Promise<{
  price: number;
  source: string;
} | null> {
  if (!apiKey()) return null;
  const yahoo = resolveYahooSymbol(symbol);

  // Spot FX
  const fx = asFxPair(yahoo.endsWith("=X") ? yahoo : symbol);
  if (fx || (yahoo.endsWith("=X") && asFxPair(yahoo))) {
    const pair = fx ?? asFxPair(yahoo)!;
    const json = (await avFetch({
      function: "CURRENCY_EXCHANGE_RATE",
      from_currency: pair.from,
      to_currency: pair.to,
    })) as Record<string, Record<string, string>> | null;
    const row = json?.["Realtime Currency Exchange Rate"];
    const price = Number(row?.["5. Exchange Rate"]);
    if (Number.isFinite(price) && price > 0) {
      return { price, source: `av-fx:${pair.from}${pair.to}` };
    }
  }

  // Crypto
  const cry = isCrypto(yahoo);
  if (cry) {
    const json = (await avFetch({
      function: "CURRENCY_EXCHANGE_RATE",
      from_currency: cry.from,
      to_currency: cry.to,
    })) as Record<string, Record<string, string>> | null;
    const row = json?.["Realtime Currency Exchange Rate"];
    const price = Number(row?.["5. Exchange Rate"]);
    if (Number.isFinite(price) && price > 0) {
      return { price, source: `av-crypto:${cry.from}${cry.to}` };
    }
  }

  // Equities / ETFs / futures tickers AV may know
  // Skip pure futures like GC=F — AV free often wrong/unsupported
  if (!yahoo.includes("=") && !yahoo.startsWith("^")) {
    const json = (await avFetch({
      function: "GLOBAL_QUOTE",
      symbol: yahoo,
    })) as Record<string, Record<string, string>> | null;
    const q = json?.["Global Quote"];
    const price = Number(q?.["05. price"]);
    if (Number.isFinite(price) && price > 0) {
      return { price, source: `av-quote:${yahoo}` };
    }
  }

  return null;
}

/**
 * Optional OHLC from AV for FX (spot path). Limited history on free tier.
 */
export async function fetchAvFxBars(
  symbol: string,
  interval: string,
): Promise<{ bars: OHLCBar[]; source: string } | null> {
  if (!apiKey()) return null;
  const yahoo = resolveYahooSymbol(symbol);
  const pair = asFxPair(yahoo.endsWith("=X") ? yahoo : symbol) ?? asFxPair(yahoo);
  if (!pair) return null;

  const avInt = avInterval(interval);
  if (avInt) {
    const json = (await avFetch({
      function: "FX_INTRADAY",
      from_symbol: pair.from,
      to_symbol: pair.to,
      interval: avInt,
      outputsize: "full",
    })) as Record<string, Record<string, Record<string, string>>> | null;
    const key = Object.keys(json || {}).find((k) =>
      k.startsWith("Time Series FX"),
    );
    const bars = parseSeries(key ? json![key] : undefined);
    if (bars.length >= 10) {
      return { bars, source: `av-fx-intra:${pair.from}${pair.to}` };
    }
  }

  // Daily fallback
  const json = (await avFetch({
    function: "FX_DAILY",
    from_symbol: pair.from,
    to_symbol: pair.to,
    outputsize: "compact",
  })) as Record<string, Record<string, Record<string, string>>> | null;
  const key = Object.keys(json || {}).find((k) =>
    k.startsWith("Time Series FX"),
  );
  const bars = parseSeries(key ? json![key] : undefined);
  if (bars.length >= 10) {
    return { bars, source: `av-fx-daily:${pair.from}${pair.to}` };
  }
  return null;
}

export function avStatus(): {
  enabled: boolean;
  budgetLeft: number;
  dailyBudget: number;
} {
  return {
    enabled: isAlphaVantageEnabled(),
    budgetLeft: budgetLeft(),
    dailyBudget: DAILY_BUDGET,
  };
}
