import { Crown, HardDrive, Sparkles, Timer } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { FREE_ANALYSES_PER_DAY } from "@/lib/billing/plans";
import type { PlanState } from "@/lib/billing/use-plan";
import { FreeTokensChip } from "@/components/free-tokens-chip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBearerToken } from "@/lib/auth/client";
import { isLocalMode } from "@/lib/local-mode";

export function TrialBanner({
  plan,
  onUpgrade,
}: {
  plan: PlanState;
  onUpgrade: () => void;
}) {
  const { lang } = useI18n();
  const ent = plan.entitlements;

  if (isLocalMode() || plan.localMode) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal/35 bg-teal/10 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-teal">
          <HardDrive className="size-3.5" />
          {lang === "es"
            ? "Modo local · Pro en este dispositivo · alertas solo aquí (sin login)"
            : "Local mode · Pro on this device · alerts stay here (no login)"}
        </span>
        <span className="text-[10px] text-muted-fg">
          {lang === "es"
            ? "Cloud / X cuando esté listo"
            : "Cloud / X later when ready"}
        </span>
      </div>
    );
  }

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
          <Sparkles className="size-3.5" />
          {lang === "es" ? "Pro activo" : "Pro active"}
          {ent.proDaysLeft != null && ent.proDaysLeft < 3650
            ? ` · ${ent.proDaysLeft}d`
            : ""}
        </span>
      </div>
    );
  }

  if (ent.plan === "trial" && ent.isPremium) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal/35 bg-teal/10 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-teal">
          <Timer className="size-3.5" />
          {lang === "es"
            ? `Trial · ${ent.trialDaysLeft ?? "—"} días`
            : `Trial · ${ent.trialDaysLeft ?? "—"} days left`}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          onClick={onUpgrade}
        >
          {lang === "es" ? "Pasar a Pro" : "Go Pro"}
        </Button>
      </div>
    );
  }

  // Free banner
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/80 px-3 py-2 text-xs",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-muted-fg">
          {lang === "es" ? "Plan Free" : "Free plan"}
        </span>
        <FreeTokensChip entitlements={ent} lang={lang} size="sm" />
        <span className="text-muted-fg">
          {lang === "es"
            ? `hasta ${FREE_ANALYSES_PER_DAY}/día`
            : `up to ${FREE_ANALYSES_PER_DAY}/day`}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        className="h-7 gap-1 text-[11px]"
        onClick={onUpgrade}
      >
        <Crown className="size-3" />
        {lang === "es" ? "Trial / Pro" : "Trial / Pro"}
      </Button>
    </div>
  );
}
