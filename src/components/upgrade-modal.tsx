import { useEffect, useState } from "react";
import {
  Check,
  Crown,
  ExternalLink,
  Loader2,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  FREE_ANALYSES_PER_DAY,
  FREE_MAX_ACTIVE_ALERTS,
  FREE_TOP_SCENARIOS,
  TRIAL_DAYS,
} from "@/lib/billing/plans";
import { startLemonCheckout } from "@/lib/billing/server";
import type { PlanState } from "@/lib/billing/use-plan";
import { DonateOption } from "@/components/donate-option";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PayCfg = {
  paymentUrl: string | null;
  storeUrl: string | null;
  hasUnlockCode: boolean;
  hasVariant: boolean;
  allowDemo: boolean;
  priceLabel: string;
  lemonConfigured: boolean;
  needsProduct: boolean;
};

const FALLBACK_CFG: PayCfg = {
  paymentUrl: "https://pricerevisitanalyzer.lemonsqueezy.com",
  storeUrl: "https://pricerevisitanalyzer.lemonsqueezy.com",
  hasUnlockCode: false,
  hasVariant: false,
  allowDemo: true,
  priceLabel: "Pro · Lemon Squeezy",
  lemonConfigured: false,
  needsProduct: false,
};

async function loadPayCfg(): Promise<PayCfg> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch("/api/billing/config", {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return FALLBACK_CFG;
    const x = (await res.json()) as Record<string, unknown>;
    return {
      paymentUrl: (x.paymentUrl as string) ?? FALLBACK_CFG.paymentUrl,
      storeUrl: (x.storeUrl as string) ?? FALLBACK_CFG.storeUrl,
      hasUnlockCode: !!x.hasUnlockCode,
      hasVariant: !!x.hasVariant,
      allowDemo: x.allowDemo !== false,
      priceLabel: (x.priceLabel as string) ?? FALLBACK_CFG.priceLabel,
      lemonConfigured: !!x.lemonConfigured,
      needsProduct: !!x.needsProduct,
    };
  } catch {
    return FALLBACK_CFG;
  } finally {
    window.clearTimeout(t);
  }
}

/**
 * Mobile-safe plans sheet.
 * Close controls are FIXED (not inside scroll) so they always work on phones.
 */
export function UpgradeModal({
  open,
  onClose,
  plan,
}: {
  open: boolean;
  onClose: () => void;
  plan: PlanState;
}) {
  const { lang } = useI18n();
  const { user } = useCurrentUserState();
  const [busy, setBusy] = useState<"trial" | "pro" | "lemon" | null>(null);
  const [unlockCode, setUnlockCode] = useState("");
  const [payCfg, setPayCfg] = useState<PayCfg>(FALLBACK_CFG);
  const ent = plan.entitlements;
  const signedIn = !!user && !user.isDevFallback;
  const isGod = plan.isGod;
  const alreadyPremium =
    isGod ||
    !!ent.isPremium ||
    ent.plan === "pro" ||
    ent.plan === "trial";

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Never block UI — fallback already set
    void loadPayCfg().then((c) => {
      if (!cancelled) setPayCfg(c);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Auto-close for god/premium after a short moment so mobile isn't stuck
  useEffect(() => {
    if (!open) return;
    if (!(isGod || ent.isPremium || ent.plan === "pro" || ent.plan === "trial"))
      return;
    // Give user a beat to read, then close if they don't interact
    const t = window.setTimeout(() => {
      // only auto-close god full access — trial users may want to see Go Pro
      if (isGod || (ent.plan === "pro" && ent.isPremium)) {
        onClose();
      }
    }, 4500);
    return () => window.clearTimeout(t);
  }, [open, isGod, ent.isPremium, ent.plan, onClose]);

  if (!open) return null;

  const statusLine = () => {
    if (isGod) {
      return lang === "es"
        ? "GOD · acceso total (sin límites)"
        : "GOD · full access (no limits)";
    }
    if (ent.plan === "trial" && ent.isPremium) {
      const d = ent.trialDaysLeft;
      return lang === "es"
        ? `Trial activo${d != null ? ` · ${d} días` : ""}`
        : `Trial active${d != null ? ` · ${d} days` : ""}`;
    }
    if (ent.plan === "pro" || ent.isPremium) {
      const d = ent.proDaysLeft;
      return lang === "es"
        ? `Pro activo${d != null ? ` · ${d} días` : " · ilimitado"}`
        : `Pro active${d != null ? ` · ${d} days` : " · unlimited"}`;
    }
    return lang === "es" ? "Plan Free" : "Free plan";
  };

  const onTrial = async () => {
    if (!signedIn) return;
    setBusy("trial");
    try {
      const ok = await plan.beginTrial();
      if (ok) {
        toast.success(
          lang === "es"
            ? `Trial de ${TRIAL_DAYS} días activado`
            : `${TRIAL_DAYS}-day trial started`,
        );
        onClose();
      } else {
        toast.message(
          lang === "es"
            ? "El trial ya se usó o ya eres Pro"
            : "Trial already used or you are Pro",
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const onLemonPay = async () => {
    if (!signedIn) {
      toast.message(
        lang === "es" ? "Inicia sesión para pagar Pro" : "Sign in to buy Pro",
      );
      return;
    }
    setBusy("lemon");
    const store =
      payCfg.storeUrl || "https://pricerevisitanalyzer.lemonsqueezy.com";
    try {
      if (payCfg.needsProduct || !payCfg.hasVariant) {
        window.open(store, "_blank", "noopener,noreferrer");
        return;
      }
      const redirectUrl =
        typeof window !== "undefined" ? window.location.origin + "/" : undefined;
      const res = (await Promise.race([
        startLemonCheckout({ data: { redirectUrl } }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), 6000),
        ),
      ])) as { ok?: boolean; url?: string; storeUrl?: string };
      if (res.ok && res.url) {
        window.location.assign(res.url);
        return;
      }
      window.open(res.storeUrl || store, "_blank", "noopener,noreferrer");
    } catch {
      window.open(store, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(null);
    }
  };

  const onPro = async () => {
    if (!signedIn) return;
    setBusy("pro");
    try {
      const ok = await plan.subscribePro({
        unlockCode: unlockCode.trim() || undefined,
      });
      if (ok) {
        toast.success(lang === "es" ? "¡Pro activado!" : "Pro activated!");
        onClose();
      } else {
        toast.error(
          lang === "es"
            ? "Paga con Lemon o usa un código válido"
            : "Pay with Lemon or use a valid code",
        );
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
    >
      {/* ALWAYS-VISIBLE top bar — never scrolls away */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5 pt-[max(0.65rem,env(safe-area-inset-top))]">
        <p
          id="upgrade-title"
          className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground"
        >
          <Crown className="size-4 shrink-0 text-rank1" />
          <span className="truncate">
            {alreadyPremium
              ? lang === "es"
                ? "Tu plan"
                : "Your plan"
              : "Trial → Pro"}
          </span>
        </p>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground active:scale-95"
        >
          <X className="size-4" />
          {lang === "es" ? "Cerrar" : "Close"}
        </button>
      </div>

      {/* Scrollable body only */}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        onClick={(e) => {
          // tap empty padding = close
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="mx-auto w-full max-w-lg space-y-3 pb-4">
          {/* Status card for premium/god — primary path for this user */}
          {alreadyPremium && (
            <div className="rounded-2xl border border-rank1/40 bg-card p-4 shadow-xl">
              <p className="text-center text-base font-semibold text-rank1">
                {statusLine()}
              </p>
              <p className="mt-2 text-center text-xs text-muted-fg">
                {lang === "es"
                  ? "Ya tienes desbloqueado Scalper, email, escenarios y sync. No necesitas pagar Lemon."
                  : "Scalper, email, scenarios & sync are unlocked. You don't need to pay Lemon."}
              </p>
              <Button
                type="button"
                className="mt-4 w-full min-h-12 text-base"
                onClick={onClose}
              >
                {lang === "es"
                  ? "Cerrar y seguir analizando"
                  : "Close & keep analyzing"}
              </Button>
            </div>
          )}

          {!alreadyPremium && (
            <div className="rounded-2xl border border-border bg-card p-4 shadow-xl">
              <p className="text-xs text-muted-fg">
                {lang === "es"
                  ? "Pagos vía Lemon Squeezy. Cierra con el botón de arriba en cualquier momento."
                  : "Payments via Lemon Squeezy. Close anytime with the top button."}
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <PlanCard
                  title="Free"
                  price={lang === "es" ? "Gratis" : "Free"}
                  active={ent.plan === "free"}
                  features={
                    lang === "es"
                      ? [
                          `${FREE_ANALYSES_PER_DAY} análisis / día`,
                          `${FREE_TOP_SCENARIOS} escenarios top`,
                          `${FREE_MAX_ACTIVE_ALERTS} alertas activas`,
                          "Sin Scalper / email",
                        ]
                      : [
                          `${FREE_ANALYSES_PER_DAY} analyses / day`,
                          `${FREE_TOP_SCENARIOS} top scenarios`,
                          `${FREE_MAX_ACTIVE_ALERTS} active alerts`,
                          "No Scalper / email",
                        ]
                  }
                />
                <PlanCard
                  title="Pro"
                  price={payCfg.priceLabel}
                  highlight
                  active={false}
                  badge="Lemon"
                  features={
                    lang === "es"
                      ? [
                          "Análisis ilimitados",
                          "Scalper board",
                          "Email de alertas",
                          "5 escenarios + desglose",
                          "30 días",
                        ]
                      : [
                          "Unlimited analyses",
                          "Scalper board",
                          "Email alerts",
                          "5 scenarios + breakdown",
                          "30 days",
                        ]
                  }
                />
              </div>

              <div className="mt-4 space-y-2">
                {!signedIn ? (
                  <Button asChild className="w-full min-h-11">
                    <Link to="/login" search={{}}>
                      {lang === "es" ? "Ir a login" : "Go to login"}
                    </Link>
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full min-h-11 gap-2"
                      disabled={!!busy}
                      onClick={() => void onTrial()}
                    >
                      {busy === "trial" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Zap className="size-4 text-rank1" />
                      )}
                      {lang === "es"
                        ? `Activar Trial ${TRIAL_DAYS} días`
                        : `Start ${TRIAL_DAYS}-day Trial`}
                    </Button>
                    <Button
                      type="button"
                      className="w-full min-h-11 gap-2 bg-[#7047EB] text-white hover:bg-[#5a35d4]"
                      disabled={!!busy}
                      onClick={() => void onLemonPay()}
                    >
                      {busy === "lemon" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ExternalLink className="size-4" />
                      )}
                      {lang === "es"
                        ? "Pagar Pro con Lemon Squeezy"
                        : "Pay Pro with Lemon Squeezy"}
                    </Button>
                    {(payCfg.hasUnlockCode || payCfg.allowDemo) && (
                      <div className="space-y-1.5 pt-1">
                        <Input
                          value={unlockCode}
                          onChange={(e) => setUnlockCode(e.target.value)}
                          placeholder={
                            lang === "es"
                              ? "Código demo (opcional)"
                              : "Demo code (optional)"
                          }
                          className="h-10 font-mono"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full min-h-10 gap-2"
                          disabled={!!busy}
                          onClick={() => void onPro()}
                        >
                          {busy === "pro" ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Sparkles className="size-4" />
                          )}
                          {lang === "es"
                            ? "Activar Pro (código)"
                            : "Activate Pro (code)"}
                        </Button>
                      </div>
                    )}
                  </>
                )}
                <DonateOption className="mt-2" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ALWAYS-VISIBLE bottom close — thumb zone */}
      <div className="shrink-0 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-muted text-base font-semibold text-foreground active:scale-[0.99]"
        >
          {lang === "es" ? "Cerrar" : "Close"}
        </button>
      </div>
    </div>
  );
}

function PlanCard({
  title,
  price,
  features,
  highlight,
  active,
  badge,
}: {
  title: string;
  price: string;
  features: string[];
  highlight?: boolean;
  active?: boolean;
  badge?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        highlight ? "border-teal/40 bg-teal/10" : "border-border bg-muted/20",
        active && "ring-1 ring-teal/50",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {badge && (
          <span className="rounded bg-[#7047EB]/20 px-1.5 py-0.5 text-[10px] font-medium text-[#a78bfa]">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted-fg">{price}</p>
      <ul className="mt-2 space-y-1">
        {features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-1.5 text-[11px] text-muted-fg"
          >
            <Check className="mt-0.5 size-3 shrink-0 text-teal" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
