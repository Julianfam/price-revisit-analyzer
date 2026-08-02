import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Clock,
  Crown,
  Search,
  Sparkles,
} from "lucide-react";
import {
  SYMBOL_LIST,
  type SymbolCategory,
} from "@/lib/analyzer/symbols";
import {
  loadRecentSymbols,
  pushRecentSymbol,
  searchSymbols,
} from "@/lib/analyzer/symbol-search";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const CATS: Array<SymbolCategory | "all"> = [
  "all",
  "forex",
  "crypto",
  "stocks",
  "indices",
  "commodities",
];

/**
 * Symbol combobox — always shows the full enabled list when opened.
 * Typing filters the list; the current selection is not used as a filter.
 */
export function SymbolSelect({
  value,
  onChange,
  onSubmit,
  placeholder,
  id,
  proSearch = false,
  onNeedUpgrade,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  id?: string;
  proSearch?: boolean;
  onNeedUpgrade?: () => void;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  /** Search text only while dropdown is open — never pre-filled with selection. */
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<SymbolCategory | "all">("all");
  const [recents, setRecents] = useState<string[]>([]);
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const catLabel: Record<SymbolCategory | "all", string> = {
    all: lang === "es" ? "Todos" : "All",
    forex: t.catForex,
    crypto: t.catCrypto,
    stocks: t.catStocks,
    indices: t.catIndices,
    commodities: t.catCommodities,
  };

  const openList = () => {
    setQuery("");
    setCat("all");
    setHi(0);
    setRecents(loadRecentSymbols());
    setOpen(true);
    // focus search on next paint
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const closeList = () => {
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeList();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeList();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Full list when query empty; filter otherwise. Free & Pro share same catalog. */
  const hits = useMemo(() => {
    const q = query.trim();
    if (!q && cat === "all") {
      return SYMBOL_LIST.map((s) => ({
        ...s,
        score: 1,
        matchWhy: "exact" as const,
      }));
    }
    if (!proSearch) {
      const ql = q.toLowerCase();
      return SYMBOL_LIST.filter((s) => {
        if (cat !== "all" && s.category !== cat) return false;
        if (!ql) return true;
        return (
          s.label.toLowerCase().includes(ql) ||
          s.name.toLowerCase().includes(ql) ||
          s.value.toLowerCase().includes(ql) ||
          s.yahoo.toLowerCase().includes(ql)
        );
      }).map((s) => ({ ...s, score: 1, matchWhy: "exact" as const }));
    }
    return searchSymbols(q, {
      category: cat,
      limit: 80,
      recents,
    });
  }, [proSearch, query, cat, recents]);

  useEffect(() => {
    setHi(0);
  }, [query, cat, open]);

  const pick = (symbol: string) => {
    onChange(symbol);
    pushRecentSymbol(symbol);
    setRecents(loadRecentSymbols());
    closeList();
  };

  // Closed: show selected symbol. Open: show search query (empty = browse all).
  const inputValue = open ? query : value;

  return (
    <div ref={rootRef} className="relative z-30">
      <div className="flex gap-0">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-fg" />
          <Input
            ref={inputRef}
            id={id}
            value={inputValue}
            onChange={(e) => {
              const v = e.target.value;
              if (!open) openList();
              setQuery(v);
              // Free can still type a raw ticker when closed path → keep value in sync only after pick
              // While open, filter only; don't overwrite selected until pick / Enter raw
            }}
            placeholder={
              open
                ? lang === "es"
                  ? "Buscar en la lista… (o ticker Yahoo)"
                  : "Search list… (or Yahoo ticker)"
                : (placeholder ??
                  (lang === "es" ? "Elegir símbolo" : "Choose symbol"))
            }
            className="rounded-r-none border-r-0 pl-8 font-mono"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            onFocus={() => {
              if (!open) openList();
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!open) openList();
                else setHi((h) => Math.min(Math.max(hits.length - 1, 0), h + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((h) => Math.max(0, h - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (open && hits[hi]) {
                  pick(hits[hi]!.value);
                  onSubmit?.();
                } else if (open && query.trim()) {
                  // Allow custom Yahoo ticker
                  const raw = query.trim().toUpperCase();
                  pick(raw);
                  onSubmit?.();
                } else {
                  closeList();
                  onSubmit?.();
                }
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeList();
              }
            }}
          />
        </div>
        <button
          type="button"
          aria-label={t.symbolList}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            if (open) closeList();
            else openList();
          }}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-r-md border border-border bg-surface text-muted-fg transition-colors hover:bg-muted hover:text-foreground",
            open && "bg-muted text-foreground",
          )}
        >
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-[400] mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-surface/60 px-2 py-1.5">
            <p className="text-[10px] font-medium text-muted-fg">
              {proSearch ? (
                <span className="inline-flex items-center gap-1 text-teal">
                  <Sparkles className="size-3" />
                  {lang === "es" ? "Lista completa + búsqueda" : "Full list + search"}
                </span>
              ) : lang === "es" ? (
                "Símbolos habilitados"
              ) : (
                "Enabled symbols"
              )}
            </p>
            <span className="font-mono text-[10px] text-muted-fg">
              {hits.length}/{SYMBOL_LIST.length}
            </span>
          </div>

          {/* Categories available to everyone so they can browse the full set */}
          <div className="flex flex-wrap gap-1 border-b border-border/60 px-2 py-1.5">
            {CATS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
                  cat === c
                    ? "bg-teal/20 text-teal"
                    : "bg-muted/40 text-muted-fg hover:text-foreground",
                )}
              >
                {catLabel[c]}
              </button>
            ))}
          </div>

          {recents.length > 0 && !query.trim() && (
            <div className="border-b border-border/50 px-2 py-1.5">
              <p className="mb-1 flex items-center gap-1 text-[10px] text-muted-fg">
                <Clock className="size-3" />
                {lang === "es" ? "Recientes" : "Recent"}
              </p>
              <div className="flex flex-wrap gap-1">
                {recents.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => pick(r)}
                    className="rounded border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:border-teal/40 hover:bg-teal/10"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          <ul className="max-h-64 overflow-y-auto overscroll-contain py-1">
            {hits.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-muted-fg">
                {lang === "es"
                  ? "Sin coincidencias — Enter para usar el ticker tal cual (Yahoo)"
                  : "No matches — press Enter to use ticker as-is (Yahoo)"}
                {!proSearch && onNeedUpgrade && (
                  <button
                    type="button"
                    className="mt-2 flex w-full items-center justify-center gap-1 text-[10px] font-medium text-rank1 hover:underline"
                    onClick={() => {
                      closeList();
                      onNeedUpgrade();
                    }}
                  >
                    <Crown className="size-3" />
                    {lang === "es" ? "Buscador Pro" : "Pro search"}
                  </button>
                )}
              </li>
            ) : (
              hits.map((s, i) => {
                const active = value.toUpperCase() === s.value.toUpperCase();
                const focused = i === hi;
                return (
                  <li key={s.value} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onMouseEnter={() => setHi(i)}
                      onClick={() => pick(s.value)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                        (active || focused) && "bg-muted",
                      )}
                    >
                      <span className="w-4 shrink-0">
                        {active ? (
                          <Check className="size-3.5 text-teal" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-medium text-foreground">
                            {s.label}
                          </span>
                          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-fg">
                            {catLabel[s.category]}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-muted-fg">
                          {s.name} · {s.yahoo}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <div className="border-t border-border/60 px-2 py-1.5 text-[10px] text-muted-fg">
            {lang === "es"
              ? `${SYMBOL_LIST.length} símbolos · ↑↓ navegar · Enter elegir`
              : `${SYMBOL_LIST.length} symbols · ↑↓ navigate · Enter select`}
          </div>
        </div>
      )}
    </div>
  );
}
