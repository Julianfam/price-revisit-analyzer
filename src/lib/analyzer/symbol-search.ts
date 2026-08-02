import {
  SYMBOL_LIST,
  type SymbolCategory,
  type SymbolEntry,
} from "@/lib/analyzer/symbols";

export type SearchHit = SymbolEntry & {
  score: number;
  matchWhy: "exact" | "prefix" | "name" | "yahoo" | "category" | "fuzzy";
};

const CAT_ALIASES: Record<string, SymbolCategory> = {
  forex: "forex",
  fx: "forex",
  currency: "forex",
  divisa: "forex",
  crypto: "crypto",
  btc: "crypto",
  eth: "crypto",
  stock: "stocks",
  stocks: "stocks",
  equity: "stocks",
  acciones: "stocks",
  index: "indices",
  indices: "indices",
  commodity: "commodities",
  commodities: "commodities",
  gold: "commodities",
  metal: "commodities",
};

function normalize(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Simple fuzzy: all query chars appear in order in target. */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  let ti = 0;
  let hits = 0;
  const t = target.toLowerCase();
  const q = query.toLowerCase();
  for (let i = 0; i < q.length; i++) {
    const ch = q[i]!;
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    hits += 1;
    ti = found + 1;
  }
  return hits / Math.max(t.length, q.length);
}

/**
 * Ranked symbol search for Pro.
 * Free callers can still use it with a smaller result cap.
 */
export function searchSymbols(
  query: string,
  opts?: {
    category?: SymbolCategory | "all";
    limit?: number;
    recents?: string[];
  },
): SearchHit[] {
  const q = normalize(query);
  const limit = opts?.limit ?? 40;
  const catFilter = opts?.category && opts.category !== "all" ? opts.category : null;
  const recentSet = new Set((opts?.recents ?? []).map((s) => s.toUpperCase()));

  // Category-only query e.g. "forex"
  const catOnly = q ? CAT_ALIASES[q] : undefined;

  const hits: SearchHit[] = [];

  for (const s of SYMBOL_LIST) {
    if (catFilter && s.category !== catFilter) continue;

    const label = s.label.toLowerCase();
    const value = s.value.toLowerCase();
    const name = normalize(s.name);
    const yahoo = s.yahoo.toLowerCase();
    const cat = s.category;

    let score = 0;
    let matchWhy: SearchHit["matchWhy"] = "fuzzy";

    if (!q) {
      score = recentSet.has(s.value.toUpperCase()) ? 50 : 10;
      matchWhy = "exact";
    } else if (catOnly && cat === catOnly) {
      score = 80;
      matchWhy = "category";
    } else if (value === q || label === q) {
      score = 100;
      matchWhy = "exact";
    } else if (value.startsWith(q) || label.startsWith(q)) {
      score = 90;
      matchWhy = "prefix";
    } else if (yahoo === q || yahoo.startsWith(q)) {
      score = 85;
      matchWhy = "yahoo";
    } else if (name.includes(q) || name.startsWith(q)) {
      score = 75;
      matchWhy = "name";
    } else if (label.includes(q) || value.includes(q) || yahoo.includes(q)) {
      score = 60;
      matchWhy = "fuzzy";
    } else {
      const fz = Math.max(
        fuzzyScore(q, value),
        fuzzyScore(q, name),
        fuzzyScore(q, yahoo),
      );
      if (fz < 0.35) continue;
      score = 40 * fz;
      matchWhy = "fuzzy";
    }

    if (recentSet.has(s.value.toUpperCase())) score += 8;
    // Slight boost for liquid majors
    if (["EURUSD", "XAUUSD", "BTCUSD", "SPX500", "NVDA"].includes(s.value)) {
      score += 2;
    }

    hits.push({ ...s, score, matchWhy });
  }

  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return hits.slice(0, limit);
}

const RECENTS_KEY = "pra-symbol-recents-v1";

export function loadRecentSymbols(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").slice(0, 12);
  } catch {
    return [];
  }
}

export function pushRecentSymbol(symbol: string): void {
  try {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    const prev = loadRecentSymbols().filter((x) => x !== s);
    localStorage.setItem(RECENTS_KEY, JSON.stringify([s, ...prev].slice(0, 12)));
  } catch {
    /* ignore */
  }
}
