import { Crown, Eye, Shield, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { PlanState } from "@/lib/billing/use-plan";
import type { ViewAsMode } from "@/lib/billing/god-mode";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MODES: {
  id: ViewAsMode;
  labelEn: string;
  labelEs: string;
  hintEn: string;
  hintEs: string;
}[] = [
  {
    id: "god",
    labelEn: "God",
    labelEs: "God",
    hintEn: "Full power · no limits · real owner mode",
    hintEs: "Poder total · sin límites · modo dueño",
  },
  {
    id: "pro",
    labelEn: "View as Pro",
    labelEs: "Ver como Pro",
    hintEn: "UI & gates like a paid Pro user",
    hintEs: "UI y puertas como un usuario Pro de pago",
  },
  {
    id: "free",
    labelEn: "View as Free",
    labelEs: "Ver como Free",
    hintEn: "Daily caps, locked Scalper/email — for QA",
    hintEs: "Cuotas diarias, Scalper/email bloqueados — para QA",
  },
];

/**
 * Only rendered for god accounts. Toggles client-side “view as” Free/Pro
 * while the real account stays unlimited on the server.
 */
export function GodModePanel({ plan }: { plan: PlanState }) {
  const { lang } = useI18n();
  if (!plan.isGod) return null;

  return (
    <Card className="rounded-xl overflow-hidden border-rank1/40 bg-rank1/5">
      <div className="h-0.5 w-full bg-gradient-to-r from-rank1 via-primary to-teal" />
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-8 items-center justify-center rounded-lg bg-rank1/20 text-rank1">
                <Shield className="size-4" />
              </span>
              God mode
              <Badge className="border-0 bg-rank1/25 text-[10px] font-semibold text-rank1">
                OWNER
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1.5 max-w-xl">
              {lang === "es"
                ? "Tu cuenta tiene acceso top. Cambia la vista para probar cómo se ve Free o Pro sin perder privilegios reales."
                : "Your account has top-level access. Switch the view to QA Free or Pro UI without losing real privileges."}
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="border-rank1/40 font-mono text-[10px] text-rank1"
          >
            <Sparkles className="mr-1 size-3" />
            server: unlimited
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-fg">
          <Eye className="size-3.5" />
          {lang === "es" ? "Vista activa (solo UI / gates)" : "Active view (UI / gates only)"}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => {
            const active = plan.viewAs === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => plan.setViewAs(m.id)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition-colors",
                  active
                    ? m.id === "god"
                      ? "border-rank1/50 bg-rank1/15 ring-1 ring-rank1/40"
                      : m.id === "pro"
                        ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30"
                        : "border-border bg-muted/50 ring-1 ring-border"
                    : "border-border/70 bg-card/40 hover:border-teal/30 hover:bg-muted/30",
                )}
              >
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  {m.id === "god" && <Shield className="size-3.5 text-rank1" />}
                  {m.id === "pro" && <Crown className="size-3.5 text-primary" />}
                  {m.id === "free" && <Eye className="size-3.5 text-muted-fg" />}
                  {lang === "es" ? m.labelEs : m.labelEn}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-muted-fg">
                  {lang === "es" ? m.hintEs : m.hintEn}
                </p>
                {active && (
                  <p className="mt-2 text-[10px] font-medium text-teal">
                    {lang === "es" ? "● Activo" : "● Active"}
                  </p>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] leading-snug text-muted-fg">
          {lang === "es"
            ? "Free/Pro aquí es solo previsualización. El servidor te sigue tratando como god (sin cuotas reales)."
            : "Free/Pro here is preview only. The server still treats you as god (no real quotas)."}
        </p>
      </CardContent>
    </Card>
  );
}
