import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { fetchLiveQuote } from "@/lib/analyzer/server";
import { useEmailAlertPrefs } from "@/lib/email-alerts";
import {
  ALERT_TTL_DAYS,
  detectAlertHit,
  evaluateAbandon,
  fireBrowserNotification,
  formatSignedPips,
  pipsSinceEntry,
  usePriceAlerts,
  type AbandonReason,
} from "@/lib/price-alerts";
import { notifyAlertEmail } from "@/lib/user-data/server";
import { formatPrice } from "@/lib/utils";

const POLL_MS = 15_000;
const ARM_GRACE_MS = 10_000;

function abandonCopy(
  reason: AbandonReason,
  lang: "en" | "es",
): { title: string; body: string } {
  if (lang === "es") {
    if (reason === "expired") {
      return {
        title: "Alerta expirada",
        body: `Pasaron ${ALERT_TTL_DAYS} días sin alcanzar el objetivo (el alejamiento no cancela).`,
      };
    }
    // Legacy reasons from old history
    if (reason === "too_far" || reason === "away_timeout") {
      return {
        title: "Alerta detenida (regla antigua)",
        body: "Antes se cancelaba al alejarse; esa regla ya no se usa.",
      };
    }
    return {
      title: "Alerta detenida",
      body: "Seguimiento cerrado.",
    };
  }
  if (reason === "expired") {
    return {
      title: "Alert expired",
      body: `${ALERT_TTL_DAYS} days passed without hitting the target (drifting does not cancel).`,
    };
  }
  if (reason === "too_far" || reason === "away_timeout") {
    return {
      title: "Alert stopped (legacy rule)",
      body: "Older builds cancelled on drift; that rule is disabled.",
    };
  }
  return {
    title: "Alert stopped",
    body: "Watch closed.",
  };
}

/**
 * Polls live quotes. Hits only count after arming.
 * Auto-stop is calendar TTL only (weekly) — never for price distance.
 */
export function useAlertWatcher(lang: "en" | "es") {
  const alerts = usePriceAlerts((s) => s.alerts);
  const markHit = usePriceAlerts((s) => s.markHit);
  const markAbandoned = usePriceAlerts((s) => s.markAbandoned);
  const updateLive = usePriceAlerts((s) => s.updateLive);
  const busy = useRef(false);

  useEffect(() => {
    const active = alerts.filter((a) => a.active);
    if (active.length === 0) return;

    const symbols = [...new Set(active.map((a) => a.symbol))];

    const tickOnce = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        for (const symbol of symbols) {
          const targets = usePriceAlerts
            .getState()
            .alerts.filter(
              (a) =>
                a.active && a.symbol.toUpperCase() === symbol.toUpperCase(),
            );
          if (targets.length === 0) continue;

          const oldest = Math.min(...targets.map((a) => a.createdAt));

          const quote = (await fetchLiveQuote({
            data: { symbol, sinceMs: oldest },
          })) as {
            last: number;
            barTime: number;
            fetchedAt: number;
            bars: { t: number; o: number; h: number; l: number; c: number }[];
          };

          const now = quote.fetchedAt || Date.now();

          for (const alert of targets) {
            const age = now - alert.createdAt;
            const barsStrict = (quote.bars ?? []).filter(
              (b) => b.t >= alert.createdAt,
            );

            const detection = detectAlertHit(
              alert,
              barsStrict,
              quote.last,
              now,
            );

            const aband = evaluateAbandon(alert, quote.last, now);

            updateLive(alert.id, quote.last, now, {
              hasLeftTarget: detection.leftTarget || !!alert.hasLeftTarget,
              awaySince: aband.awaySince,
            });

            if (age < ARM_GRACE_MS) continue;

            // Hit always wins over TTL expiry
            if (
              detection.hit &&
              !(
                detection.hitAt != null &&
                detection.hitAt > 0 &&
                detection.hitAt < alert.createdAt
              )
            ) {
              const hitAt = Math.max(detection.hitAt || now, alert.createdAt);
              const hitPrice = detection.hitPrice ?? quote.last;
              markHit(alert.id, hitAt, hitPrice);

              const when = new Date(hitAt).toLocaleString(
                lang === "es" ? "es" : "en",
                { dateStyle: "medium", timeStyle: "medium" },
              );
              const priceStr = formatPrice(alert.targetPrice, alert.tick);
              const moved = formatSignedPips(
                pipsSinceEntry({ ...alert, hitPrice }, hitPrice),
              );
              const title =
                lang === "es"
                  ? `Alerta: ${alert.symbol} tocó ${priceStr}`
                  : `Alert: ${alert.symbol} hit ${priceStr}`;
              const body =
                lang === "es"
                  ? `Llegó a las ${when} · movimiento ${moved} pips desde la alerta`
                  : `Reached at ${when} · moved ${moved} pips since alert`;

              toast.success(title, { description: body, duration: 12_000 });
              fireBrowserNotification(title, body);

              const prefs = useEmailAlertPrefs.getState();
              if (prefs.enabled) {
                void notifyAlertEmail({
                  data: {
                    alertId: alert.id,
                    symbol: alert.symbol,
                    targetPrice: alert.targetPrice,
                    hitPrice,
                    hitAt,
                    tick: alert.tick,
                    lang,
                  },
                }).catch(() => {});
              }
              continue;
            }

            if (aband.abandon && aband.reason) {
              markAbandoned(alert.id, now, aband.reason, quote.last);
              const copy = abandonCopy(aband.reason, lang);
              const priceStr = formatPrice(alert.targetPrice, alert.tick);
              toast.message(`${copy.title} · ${alert.symbol}`, {
                description: `${copy.body} · obj ${priceStr}`,
                duration: 10_000,
              });
              fireBrowserNotification(
                `${copy.title} · ${alert.symbol}`,
                copy.body,
              );
            }
          }
        }
      } catch {
        /* next poll */
      } finally {
        busy.current = false;
      }
    };

    const first = window.setTimeout(() => void tickOnce(), 5000);
    const id = window.setInterval(() => void tickOnce(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [alerts, markHit, markAbandoned, updateLive, lang]);
}
