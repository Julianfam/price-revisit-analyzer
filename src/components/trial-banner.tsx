import { Crown, Sparkles, Timer } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { FREE_ANALYSES_PER_DAY } from "@/lib/billing/plans";
import type { PlanState } from "@/lib/billing/use-plan";
import { FreeTokensChip } from "@/components/free-tokens-chip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBearerToken } from "@/lib/auth/client";

export function TrialBanner({
  plan,
  onUpgrade,
}: {
  plan: PlanState;
  onUpgrade: () => void;
}) {
  const { lang } = useI18n();
  const ent = plan.entitlements;

  // Never flash Free→Pro while session / plan is still restoring
  if (plan.loading) return null;
  if (typeof window !== "undefined" && getBearerToken() && !ent.isPremium && plan.loading) {
    return null;
  }

  if (plan.isGod && plan.viewAs === "god") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rank1/40 bg-rank1/10 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-rank1">
          <Crown className="size-3.5" />
          {lang === "es"
            ? "God mode · acceso total (sin límites)"
            : "God mode · full access (no limits)"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] text-muted-fg"
          onClick={onUpgrade}
        >
          {lang === "es" ? "Planes" : "Plans"}
        </Button>
      </div>
    );
  }

  if (ent.plan === "pro" && ent.isPremium) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rank1/30 bg-rank1/10 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-rank1">
          <Crown className="size-3.5" />
          {lang === "es"
            ? `Pro activo · ${ent.proDaysLeft ?? "—"} días restantes`
            : `Pro active · ${ent.proDaysLeft ?? "—"} days left`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] text-muted-fg"
          onClick={onUpgrade}
        >
          {lang === "es" ? "Ver plan" : "View plan"}
        </Button>
      </div>
    );
  }

  if (ent.plan === "trial" && ent.isPremium) {
    const urgent = (ent.trialDaysLeft ?? 99) <= 2;
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
          urgent
            ? "border-rank1/40 bg-rank1/10"
            : "border-teal/35 bg-teal/10",
        )}
      >
        <span
          className={cn(
            "flex items-center gap-1.5 font-medium",
            urgent ? "text-rank1" : "text-teal",
          )}
        >
          <Timer className="size-3.5" />
          {lang === "es"
            ? `Trial · ${ent.trialDaysLeft ?? "—"} días restantes — pásate a Pro antes de que termine`
            : `Trial · ${ent.trialDaysLeft ?? "—"} days left — upgrade to Pro before it ends`}
        </span>
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1 bg-primary text-[11px] text-primary-foreground"
          onClick={onUpgrade}
        >
          <Crown className="size-3" />
          {lang === "es" ? "Pasar a Pro" : "Go Pro"}
        </Button>
      </div>
    );
  }

  // Free banner — only for real guests / free (not mid-restore)
  const left = ent.analysesLeftToday ?? 0;
  const empty = left <= 0;
  const low = left > 0 && left <= 3;
  const plenty = left >= Math.ceil(FREE_ANALYSES_PER_DAY * 0.5);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs",
        empty
          ? "border-bear/40 bg-bear/10"
          : low
            ? "border-rank1/35 bg-rank1/10"
            : plenty
              ? "border-teal/35 bg-teal/10"
              : "border-border bg-muted/30",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <span
          className={cn(
            "flex items-center gap-1.5 font-medium",
            empty
              ? "text-bear"
              : plenty
                ? "text-teal"
                : low
                  ? "text-rank1"
                  : "text-muted-fg",
          )}
        >
          <Sparkles className="size-3.5 shrink-0" />
          {lang === "es" ? "Free generoso" : "Generous Free"}
        </span>
        <FreeTokensChip entitlements={ent} lang={lang} size="sm" />
        <span className="max-w-md text-[11px] text-muted-fg">
          {empty
            ? lang === "es"
              ? `Tokens del día agotados. Vuelven mañana — o Trial/Pro.`
              : `Daily tokens used up. Reset tomorrow — or Trial/Pro.`
            : plenty
              ? lang === "es"
                ? `${left} tokens hoy · prueba símbolos y alertas.`
                : `${left} tokens today · try symbols & alerts.`
              : lang === "es"
                ? `Te quedan ${left} de ${FREE_ANALYSES_PER_DAY}.`
                : `${left} of ${FREE_ANALYSES_PER_DAY} left.`}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant={empty ? "default" : "outline"}
        className={cn(
          "h-7 gap-1 text-[11px]",
          empty && "bg-primary text-primary-foreground",
        )}
        onClick={onUpgrade}
      >
        <Crown className="size-3" />
        Trial / Pro
      </Button>
    </div>
  );
}
