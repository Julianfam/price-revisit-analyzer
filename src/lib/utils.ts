import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format price.
 * - tick ≥ 1 (stocks/crypto/indices/metals): whole numbers only
 * - forex ticks (0.0001 / 0.01): pip-style decimals
 */
export function formatPrice(value: number, tick: number): string {
  if (!(tick > 0) || !Number.isFinite(value)) return "—";

  // Non-forex integer grid
  if (tick >= 1) {
    return Math.round(value).toLocaleString(undefined, {
      maximumFractionDigits: 0,
    });
  }

  // Forex: decimals from tick size (0.01 → 2–3 dp, 0.0001 → 4–5 dp)
  const decimals = Math.min(6, Math.max(2, Math.ceil(-Math.log10(tick))));
  return value.toFixed(decimals);
}

export function formatPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatNum(value: number, digits = 2): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
