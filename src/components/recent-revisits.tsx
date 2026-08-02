import { History, RotateCcw } from "lucide-react";
import type { RecentRevisit } from "@/lib/analyzer/types";
import { useI18n } from "@/lib/i18n";
import { formatPrice, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remS = sec % 60;
  if (min < 60) return remS > 0 ? `${min}m ${remS}s` : `${min}m`;
  const hrs = Math.floor(min / 60);
  const remM = min % 60;
  if (hrs < 48) return remM > 0 ? `${hrs}h ${remM}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remH = hrs % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

function formatWhen(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RecentRevisitsPanel({
  revisits,
  tick,
  maxItems,
}: {
  revisits: RecentRevisit[];
  tick: number;
  maxItems?: number;
}) {
  const { t, lang } = useI18n();
  const locale = lang === "es" ? "es" : "en";
  const list =
    maxItems != null ? revisits.slice(0, maxItems) : revisits;

  return (
    <Card className="rounded-xl overflow-hidden border-teal/25">
      <div className="h-0.5 w-full bg-gradient-to-r from-teal via-accent-soft to-teal/40" />
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-8 items-center justify-center rounded-lg bg-teal/15 text-teal">
            <History className="size-4" />
          </span>
          {t.recentRevisitsTitle}
        </CardTitle>
        <CardDescription>{t.recentRevisitsDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/30 px-3 py-4 text-center text-sm text-muted-fg">
            {t.recentRevisitsEmpty}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {list.map((r, i) => (
              <div
                key={`${r.level}-${r.at}-${i}`}
                className={cn(
                  "flex flex-col gap-1.5 rounded-lg border border-border/80 bg-surface/50 p-3",
                  i === 0 && "border-teal/35 bg-teal/5",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold tabular text-foreground">
                    {formatPrice(r.level, tick)}
                  </span>
                  <Badge
                    variant="outline"
                    className="gap-0.5 border-teal/30 text-[10px] text-teal"
                  >
                    <RotateCcw className="size-2.5" />
                    #{r.visitNumber}
                  </Badge>
                </div>
                <div className="space-y-0.5 text-[11px] leading-snug text-muted-fg">
                  <p>
                    <span className="text-muted-fg/80">{t.recentRevisitsLeft}</span>{" "}
                    <span className="tabular text-foreground">
                      {formatWhen(r.leftAt, locale)}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-fg/80">{t.recentRevisitsWhen}</span>{" "}
                    <span className="tabular text-foreground">
                      {formatWhen(r.at, locale)}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-fg/80">{t.recentRevisitsAway}</span>{" "}
                    <span className="font-semibold tabular text-accent-soft">
                      {formatDuration(r.timeAwayMs)}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
