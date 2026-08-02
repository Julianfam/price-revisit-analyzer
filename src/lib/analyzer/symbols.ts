/** Map user-friendly symbols to Yahoo Finance tickers. */
export function resolveYahooSymbol(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return "EURUSD=X";

  const aliases: Record<string, string> = {
    AAPL: "AAPL",
    AMD: "AMD",
    AMZN: "AMZN",
    ENPH: "ENPH",
    GOOGL: "GOOGL",
    LYFT: "LYFT",
    MSTR: "MSTR",
    NVDA: "NVDA",
    PLTR: "PLTR",
    SMCI: "SMCI",
    TSLA: "TSLA",
    NAS100: "NQ=F",
    US100: "NQ=F",
    NQ: "NQ=F",
    "NQ=F": "NQ=F",
    SPX500: "^GSPC",
    SPX: "^GSPC",
    SP500: "^GSPC",
    "^GSPC": "^GSPC",
    SPCX: "SPCX",
    EURUSD: "EURUSD=X",
    USDCOP: "USDCOP=X",
    XAUUSD: "GC=F",
    GOLD: "GC=F",
    "GC=F": "GC=F",
    XAGUSD: "SI=F",
    SILVER: "SI=F",
    "SI=F": "SI=F",
    BTCUSD: "BTC-USD",
    BTC: "BTC-USD",
    "BTC-USD": "BTC-USD",
    ETHUSD: "ETH-USD",
    ETH: "ETH-USD",
    "ETH-USD": "ETH-USD",
    ETHUSDT: "ETH-USD",
    BTCETH: "ETH-BTC",
  };

  if (aliases[s]) return aliases[s];
  if (s.includes("=") || s.startsWith("^") || s.includes("-")) return s;
  if (/^[A-Z]{6}$/.test(s)) return `${s}=X`;
  return s;
}

/** Forex pairs only (Yahoo `…=X`). These may use decimal pips. */
export function isForexSymbol(yahooSymbol: string): boolean {
  return yahooSymbol.toUpperCase().endsWith("=X");
}

/**
 * Decimals allowed only on forex.
 * Stocks, crypto, indices, metals → whole numbers.
 */
export function allowsPriceDecimals(yahooSymbol: string): boolean {
  return isForexSymbol(yahooSymbol);
}

/** @deprecated use !allowsPriceDecimals — kept for call-site clarity */
export function isEquitySymbol(yahooSymbol: string): boolean {
  return !allowsPriceDecimals(yahooSymbol);
}

/** Auto-detect tick/pip size from symbol and sample prices. */
export function detectTick(yahooSymbol: string, _samplePrices: number[] = []): number {
  const s = yahooSymbol.toUpperCase();

  // ——— Forex only: decimal pips ———
  if (s.includes("JPY") && s.endsWith("=X")) return 0.01;
  if (s === "USDCOP=X") return 0.01; // COP pairs: 0.01 peso grid
  if (s.endsWith("=X")) return 0.0001;

  // ——— Everything else: integers (no decimals) ———
  return 1;
}

export type SymbolCategory =
  | "forex"
  | "crypto"
  | "stocks"
  | "indices"
  | "commodities";

export type SymbolEntry = {
  label: string;
  value: string;
  yahoo: string;
  name: string;
  category: SymbolCategory;
};

/** Active watchlist (user list, trimmed). */
export const SYMBOL_LIST: SymbolEntry[] = [
  { label: "AAPL", value: "AAPL", yahoo: "AAPL", name: "Apple", category: "stocks" },
  { label: "AMD", value: "AMD", yahoo: "AMD", name: "AMD", category: "stocks" },
  { label: "AMZN", value: "AMZN", yahoo: "AMZN", name: "Amazon", category: "stocks" },
  { label: "BTCUSD", value: "BTCUSD", yahoo: "BTC-USD", name: "Bitcoin / USD", category: "crypto" },
  { label: "ENPH", value: "ENPH", yahoo: "ENPH", name: "Enphase Energy", category: "stocks" },
  { label: "ETHUSD", value: "ETHUSD", yahoo: "ETH-USD", name: "Ethereum / USD", category: "crypto" },
  { label: "ETHUSDT", value: "ETHUSDT", yahoo: "ETH-USD", name: "Ethereum / USDT", category: "crypto" },
  { label: "EURUSD", value: "EURUSD", yahoo: "EURUSD=X", name: "Euro / US Dollar", category: "forex" },
  { label: "GOOGL", value: "GOOGL", yahoo: "GOOGL", name: "Alphabet", category: "stocks" },
  { label: "LYFT", value: "LYFT", yahoo: "LYFT", name: "Lyft", category: "stocks" },
  { label: "MSTR", value: "MSTR", yahoo: "MSTR", name: "MicroStrategy", category: "stocks" },
  { label: "NAS100", value: "NAS100", yahoo: "NQ=F", name: "Nasdaq 100", category: "indices" },
  { label: "NVDA", value: "NVDA", yahoo: "NVDA", name: "NVIDIA", category: "stocks" },
  { label: "PLTR", value: "PLTR", yahoo: "PLTR", name: "Palantir", category: "stocks" },
  { label: "SMCI", value: "SMCI", yahoo: "SMCI", name: "Super Micro Computer", category: "stocks" },
  { label: "SPCX", value: "SPCX", yahoo: "SPCX", name: "SPCX", category: "stocks" },
  { label: "SPX500", value: "SPX500", yahoo: "^GSPC", name: "S&P 500", category: "indices" },
  { label: "TSLA", value: "TSLA", yahoo: "TSLA", name: "Tesla", category: "stocks" },
  { label: "USDCOP", value: "USDCOP", yahoo: "USDCOP=X", name: "US Dollar / Colombian Peso", category: "forex" },
  { label: "XAGUSD", value: "XAGUSD", yahoo: "SI=F", name: "Silver", category: "commodities" },
  { label: "XAUUSD", value: "XAUUSD", yahoo: "GC=F", name: "Gold COMEX futures (GC=F)", category: "commodities" },
  { label: "BTCETH", value: "BTCETH", yahoo: "ETH-BTC", name: "ETH / BTC", category: "crypto" },
];

export const WINDOW_OPTIONS = [
  { label: "15m", value: "15m", ms: 15 * 60 * 1000 },
  { label: "1h", value: "1h", ms: 60 * 60 * 1000 },
  { label: "4h", value: "4h", ms: 4 * 60 * 60 * 1000 },
  { label: "1d", value: "1d", ms: 24 * 60 * 60 * 1000 },
] as const;

export const INTERVAL_OPTIONS = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "1d", value: "1d" },
] as const;

export const RANGE_OPTIONS = [
  { label: "1d", value: "1d" },
  { label: "5d", value: "5d" },
  { label: "1mo", value: "1mo" },
  { label: "3mo", value: "3mo" },
  { label: "6mo", value: "6mo" },
  { label: "1y", value: "1y" },
] as const;
