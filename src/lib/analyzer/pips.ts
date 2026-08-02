import { allowsPriceDecimals } from "./symbols";

/**
 * Single source of truth for pip/point size across engine, scalper, alerts.
 * Forex (Yahoo `=X`): decimal pips. Everything else: whole points.
 */
export function pipSize(yahooSymbol: string, tick: number): number {
  const s = yahooSymbol.toUpperCase();
  if (!allowsPriceDecimals(s)) return Math.max(tick >= 1 ? tick : 1, 1);
  if (s.includes("JPY") && s.endsWith("=X")) return 0.01;
  if (s === "USDCOP=X") return 0.01;
  if (s.endsWith("=X")) return 0.0001;
  return Math.max(tick > 0 ? tick : 0.0001, 0.0001);
}

export function priceDiffToPips(
  yahooSymbol: string,
  priceDiff: number,
  tick: number,
): number {
  const ps = pipSize(yahooSymbol, tick);
  if (!(ps > 0)) return 0;
  return priceDiff / ps;
}

/**
 * Minimum |offset| in ticks so “next prices” are not the spot itself.
 * Forex ≥5 pips · equities/crypto/indices ≥2 points.
 */
export function minScenarioOffsetTicks(
  yahooSymbol: string,
  tick: number,
): number {
  const t = tick > 0 ? tick : allowsPriceDecimals(yahooSymbol) ? 0.0001 : 1;
  const pip = pipSize(yahooSymbol, t);
  const minPips = allowsPriceDecimals(yahooSymbol) ? 5 : 2;
  return Math.max(1, Math.ceil((minPips * pip) / t - 1e-12));
}

/** Human label for the unit (pip vs point). */
export function unitLabel(yahooSymbol: string, lang: "en" | "es" = "en"): string {
  if (allowsPriceDecimals(yahooSymbol)) {
    return lang === "es" ? "pips" : "pips";
  }
  return lang === "es" ? "pts" : "pts";
}
