import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Scale, ShieldAlert } from "lucide-react";
import {
  getTermsContent,
  hasAcceptedTerms,
  saveTermsAcceptance,
  TERMS_VERSION,
} from "@/lib/legal/terms";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const TERMS_ACCEPTED_EVENT = "pra-terms-accepted";

/**
 * Risk / T&Cs gate. Blocks only when we *know* the user has not accepted.
 * Returning users with storage/cookie never see a flash of the modal.
 */
export function TermsGate({ children }: { children: ReactNode }) {
  const { lang, setLang } = useI18n();
  // Optimistic: assume accepted until client proves otherwise — avoids
  // re-prompt on every reload for users who already accepted.
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(true);
  const [ok, setOk] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    const yes = hasAcceptedTerms();
    setAccepted(yes);
    setReady(true);
    if (yes) {
      // re-heal cookies / flags for next visit
      try {
        saveTermsAcceptance(lang);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event(TERMS_ACCEPTED_EVENT));
    }
  }, [lang]);

  const copy = useMemo(() => getTermsContent(lang), [lang]);

  const onAccept = () => {
    if (!ok) return;
    saveTermsAcceptance(lang);
    setAccepted(true);
    window.dispatchEvent(new Event(TERMS_ACCEPTED_EVENT));
  };

  // Only show after client check, and only if not accepted
  const showModal = ready && !accepted;

  return (
    <>
      <div
        className={cn(showModal && "pointer-events-none select-none")}
        aria-hidden={showModal || undefined}
      >
        {children}
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-center bg-bg/90 p-3 backdrop-blur-sm sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-title"
        >
          <div className="flex max-h-[min(90dvh,780px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <div className="h-1 w-full bg-gradient-to-r from-rank1 via-primary to-teal" />

            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p
                  id="terms-title"
                  className="flex items-center gap-2 text-base font-semibold text-foreground"
                >
                  <Scale className="size-5 shrink-0 text-rank1" />
                  {copy.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-fg">
                  {copy.subtitle}
                </p>
              </div>
              <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
                {(["en", "es"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    className={cn(
                      "rounded px-2 py-1 text-[11px] font-medium",
                      lang === code
                        ? "bg-teal/20 text-teal"
                        : "text-muted-fg hover:text-foreground",
                    )}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="mx-4 mt-3 flex gap-2 rounded-lg border border-rank1/40 bg-rank1/10 px-3 py-2.5">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rank1" />
              <p className="text-xs font-semibold leading-snug text-rank1">
                {copy.riskHeadline}
              </p>
            </div>

            <div className="mx-4 mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/80 bg-muted/15 px-3 py-3 text-[11px] leading-relaxed text-muted-fg">
              {copy.sections.map((sec) => (
                <div key={sec.title} className="mb-3 last:mb-0">
                  <p className="font-semibold text-foreground">{sec.title}</p>
                  <p className="mt-0.5">{sec.body[0]}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t border-border px-4 py-3">
              <label className="flex cursor-pointer gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-xs leading-snug text-foreground hover:bg-muted/20">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-teal"
                  checked={ok}
                  onChange={(e) => setOk(e.target.checked)}
                />
                <span>
                  {lang === "es"
                    ? "Tengo 18+, entiendo el riesgo especulativo y acepto los términos. Las señales pueden fallar."
                    : "I am 18+, understand speculative risk, and accept the terms. Signals can fail."}
                </span>
              </label>

              {declined && (
                <div className="flex gap-2 rounded-lg border border-bear/35 bg-bear/10 px-3 py-2 text-[11px] text-bear">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {copy.declineNote}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-12 flex-1"
                  onClick={() => setDeclined(true)}
                >
                  {copy.decline}
                </Button>
                <Button
                  type="button"
                  className="min-h-12 flex-[2] bg-primary text-base text-primary-foreground"
                  disabled={!ok}
                  onClick={onAccept}
                >
                  {lang === "es" ? "Aceptar y usar la app" : "Accept & use app"}
                </Button>
              </div>
              <p className="text-center text-[10px] text-muted-fg">
                {copy.footer} · v{TERMS_VERSION}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
