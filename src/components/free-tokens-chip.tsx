import { Coins, Flame, Sparkles } from "lucide-react";
import { FREE_ANALYSES_PER_DAY } from "@/lib/billing/plans";
import type { Entitlements } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/**
 * Visible remaining Free “tokens” (daily analyses).
 * Feels playful: streak-ish dots, warm copy when plenty left.
 */
export function FreeTokensChip({
  entitlements,
  lang,
  size = "md",
  className,
}: {
  entitlements: Entitlements;
  lang: "en" | "es";
  size?: "sm" | "md";
  className?: string;
}) {
  if (entitlements.isPremium || entitlements.analysesLeftToday == null) {
    return null;
  }

  const left = Math.max(0, entitlements.analysesLeftToday);
  const total = FREE_ANALYSES_PER_DAY;
  const used = Math.min(total, total - left);
  const empty = left <= 0;
  const low = left > 0 && left <= 3;
  const plenty = left >= Math.ceil(total * 0.5);

  const Icon = empty ? Coins : low ? Flame : plenty ? Sparkles : Coins;

  const label =
    lang === "es"
      ? empty
        ? "0 tokens hoy"
        : plenty
          ? `${left} tokens listos`
          : low
            ? `${left} tokens · casi al límite`
            : `${left} tokens Free`
      : empty
        ? "0 tokens today"
        : plenty
          ? `${left} tokens ready`
          : low
            ? `${left} tokens · almost out`
            : `${left} Free tokens`;

  const sub =
    lang === "es"
      ? `${used}/${total} usados · se reinician cada día · ¡explora!`
      : `${used}/${total} used · resets daily · go explore!`;

  // Show compact dots (max 10 visual slots for readability when total is 20)
  const slots = Math.min(10, total);
  const filledSlots = Math.round((left / total) * slots);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
        empty
          ? "border-bear/40 bg-bear/10"
          : low
            ? "border-rank1/40 bg-rank1/10"
            : plenty
              ? "border-teal/40 bg-teal/10"
              : "border-accent-soft/35 bg-accent-soft/10",
        className,
      )}
      title={sub}
      role="status"
      aria-live="polite"
    >
      <Icon
        className={cn(
          "shrink-0",
          size === "sm" ? "size-3.5" : "size-4",
          empty
            ? "text-bear"
            : low
              ? "text-rank1"
              : plenty
                ? "text-teal"
                : "text-accent-soft",
        )}
      />
      <div className="min-w-0">
        <p
          className={cn(
            "font-mono font-semibold tabular leading-none",
            size === "sm" ? "text-xs" : "text-sm",
            empty
              ? "text-bear"
              : low
                ? "text-rank1"
                : plenty
                  ? "text-teal"
                  : "text-foreground",
          )}
        >
          {left}
          <span className="text-muted-fg">/{total}</span>
        </p>
        <p
          className={cn(
            "mt-0.5 text-[10px] leading-tight",
            empty ? "text-bear/90" : "text-muted-fg",
          )}
        >
          {label}
        </p>
      </div>
      <div className="ml-0.5 flex max-w-[5.5rem] flex-wrap items-center gap-0.5" aria-hidden>
        {Array.from({ length: slots }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-1.5 rounded-full",
              i < filledSlots
                ? empty
                  ? "bg-bear"
                  : low
                    ? "bg-rank1"
                    : "bg-teal"
                : "bg-muted-fg/25",
            )}
          />
        ))}
      </div>
    </div>
  );
}
