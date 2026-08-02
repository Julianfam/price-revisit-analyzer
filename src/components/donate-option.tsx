import { useState } from "react";
import { Coffee, ExternalLink, Heart, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Optional donate URL (PayPal.me, Ko-fi, Stripe payment link…).
 * Set `VITE_DONATE_URL` at deploy time; otherwise we show a gentle in-app thank-you.
 */
const DONATE_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { VITE_DONATE_URL?: string } }).env
      ?.VITE_DONATE_URL?.trim()) ||
  "";

const AMOUNTS = [3, 5, 10, 25] as const;

/** Compact row under Trial/Pro — not a second paywall. */
export function DonateOption({ className }: { className?: string }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2",
          className,
        )}
      >
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-fg">
          <Heart className="size-3.5 shrink-0 text-bear/80" />
          <span>
            {lang === "es"
              ? "¿Te sirve el analizador? Una donación voluntaria ayuda a mantenerlo."
              : "Finding the analyzer useful? A voluntary tip helps keep it running."}
          </span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 text-[11px]"
          onClick={() => {
            if (DONATE_URL) {
              window.open(DONATE_URL, "_blank", "noopener,noreferrer");
              return;
            }
            setOpen(true);
          }}
        >
          <Coffee className="size-3.5" />
          {lang === "es" ? "Donar" : "Donate"}
          {DONATE_URL ? <ExternalLink className="size-3 opacity-60" /> : null}
        </Button>
      </div>

      {open && (
        <DonateSheet
          lang={lang}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DonateSheet({
  lang,
  onClose,
}: {
  lang: "en" | "es";
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Coffee className="size-4 text-rank1" />
              {lang === "es" ? "Donación voluntaria" : "Voluntary donation"}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-fg">
              {lang === "es"
                ? "No desbloquea Pro (usa Trial → Pro para eso). Solo un café para el proyecto."
                : "This does not unlock Pro (use Trial → Pro for that). Just a coffee for the project."}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-fg hover:bg-muted"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {AMOUNTS.map((n) => (
            <button
              key={n}
              type="button"
              className="rounded-lg border border-border bg-muted/30 py-2.5 font-mono text-sm font-semibold tabular text-foreground transition-colors hover:border-teal/40 hover:bg-teal/10 hover:text-teal"
              onClick={() => {
                // No payment processor in preview — open mailto as gentle fallback
                const subject =
                  lang === "es"
                    ? `Donación PRA ~$${n}`
                    : `PRA donation ~$${n}`;
                const body =
                  lang === "es"
                    ? `Quiero apoyar Price Revisit Analyzer con ~$${n}.\n\n(Cuando haya enlace de pago en producción, úsalo desde la app.)`
                    : `I'd like to support Price Revisit Analyzer with ~$${n}.\n\n(When a live pay link is configured in production, use it from the app.)`;
                window.location.href = `mailto:support@example.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                onClose();
              }}
            >
              ${n}
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-[10px] text-muted-fg">
          {lang === "es"
            ? "En producción se puede enlazar PayPal / Ko-fi / Stripe Payment Link (VITE_DONATE_URL)."
            : "In production, wire PayPal / Ko-fi / Stripe Payment Link via VITE_DONATE_URL."}
        </p>
      </div>
    </div>
  );
}
