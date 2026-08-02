import type { ReactNode } from "react";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Soft lock overlay for Free-tier sections. */
export function PremiumGate({
  locked,
  lang,
  title,
  blurb,
  onUpgrade,
  children,
  className,
  compact,
}: {
  locked: boolean;
  lang: "en" | "es";
  title: string;
  blurb: string;
  onUpgrade: () => void;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  if (!locked) return <>{children}</>;

  return (
    <div className={cn("relative overflow-hidden rounded-xl", className)}>
      <div
        className={cn(
          "pointer-events-none select-none",
          compact ? "max-h-36 overflow-hidden opacity-40 blur-[1px]" : "opacity-35 blur-[1.5px]",
        )}
        aria-hidden
      >
        {children}
      </div>
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-gradient-to-t from-bg via-bg/85 to-bg/40 p-4",
        )}
      >
        <div className="max-w-sm rounded-xl border border-primary/30 bg-card/95 px-4 py-3 text-center shadow-lg backdrop-blur">
          <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-foreground">
            <Lock className="size-3.5 text-rank1" />
            {title}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-fg">{blurb}</p>
          <Button
            type="button"
            size="sm"
            className="mt-2.5 h-8 gap-1 bg-primary text-xs text-primary-foreground"
            onClick={onUpgrade}
          >
            <Sparkles className="size-3.5" />
            {lang === "es" ? "Desbloquear con Trial / Pro" : "Unlock with Trial / Pro"}
          </Button>
        </div>
      </div>
    </div>
  );
}
