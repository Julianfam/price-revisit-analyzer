/**
 * Guided parameter combinations for the analyzer tutorial.
 * These are educational starting points — not guaranteed edges.
 */

export type ParamPreset = {
  id: string;
  symbol: string;
  interval: string;
  range: string;
  window: string;
  /** Optional tick override (leave empty for auto). */
  tick?: string;
  /** Rough “style” for filtering in the UI. */
  style: "scalp" | "intraday" | "swing";
  /** Why this combo tends to produce cleaner revisit stats. */
  whyEn: string;
  whyEs: string;
  /** Soft expectation for when Top scenario P% often looks cleaner. */
  targetProb: number;
};

export const PARAM_PRESETS: ParamPreset[] = [
  {
    id: "fx-intraday",
    symbol: "EURUSD",
    interval: "5m",
    range: "5d",
    window: "1h",
    style: "intraday",
    whyEn: "Liquid FX pair · 5m path + 1h windows catch retests without too much noise.",
    whyEs: "Par FX líquido · camino 5m + ventanas 1h capturan retests sin tanto ruido.",
    targetProb: 55,
  },
  {
    id: "fx-scalp",
    symbol: "EURUSD",
    interval: "1m",
    range: "1d",
    window: "15m",
    style: "scalp",
    whyEn: "Tight windows for short revisits. Expect more false magnets — use ≥60% filter harder.",
    whyEs: "Ventanas cortas para revisits rápidos. Más imanes falsos — filtra ≥60% con más rigor.",
    targetProb: 60,
  },
  {
    id: "gold-intraday",
    symbol: "XAUUSD",
    interval: "5m",
    range: "5d",
    window: "1h",
    style: "intraday",
    whyEn: "Gold respects round levels; 1h windows often stack multiple visits.",
    whyEs: "El oro respeta niveles redondos; ventanas 1h suelen apilar varias visitas.",
    targetProb: 55,
  },
  {
    id: "btc-swing",
    symbol: "BTCUSD",
    interval: "15m",
    range: "1mo",
    window: "4h",
    style: "swing",
    whyEn: "Crypto noise is high; wider window + longer range stabilizes visit averages.",
    whyEs: "Cripto es ruidoso; ventana ancha + rango largo estabiliza promedios de visitas.",
    targetProb: 50,
  },
  {
    id: "ndx-intraday",
    symbol: "SPX500",
    interval: "5m",
    range: "5d",
    window: "1h",
    style: "intraday",
    whyEn: "Index futures levels get retested often in the US session.",
    whyEs: "Los niveles de índices se retestean mucho en sesión USA.",
    targetProb: 55,
  },
  {
    id: "equity-swing",
    symbol: "NVDA",
    interval: "15m",
    range: "1mo",
    window: "4h",
    style: "swing",
    whyEn: "Stocks need more history; 4h windows reduce single-news spikes.",
    whyEs: "Acciones necesitan más historia; ventanas 4h reducen picos de una noticia.",
    targetProb: 50,
  },
  {
    id: "eth-intraday",
    symbol: "ETHUSD",
    interval: "5m",
    range: "5d",
    window: "1h",
    style: "intraday",
    whyEn: "Similar to BTC but often cleaner mid-levels on 1h revisit windows.",
    whyEs: "Similar a BTC, a veces con niveles medios más limpios en ventanas 1h.",
    targetProb: 55,
  },
  {
    id: "fx-london",
    symbol: "GBPUSD",
    interval: "5m",
    range: "5d",
    window: "1h",
    style: "intraday",
    whyEn: "London/NY overlap liquidity · good default for learning combinations.",
    whyEs: "Liquidez solape Londres/NY · buen default para aprender combinaciones.",
    targetProb: 55,
  },
];

/** Rule of thumb thresholds shown in the tutorial. */
export const PROB_SOFT = 50;
export const PROB_STRONG = 60;
