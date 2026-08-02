import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  coerceArmedProbability,
  coerceArmedRank,
  normalizeAlert,
  usePriceAlerts,
  type PriceAlert,
} from "@/lib/price-alerts";
import {
  fetchMyAlertsDetailed,
  pushMyAlerts,
} from "@/lib/user-data/alerts-api";
import { getMySettings, saveMySettings } from "@/lib/user-data/server";
import { useI18n, type Lang } from "@/lib/i18n";
import { useEmailAlertPrefs } from "@/lib/email-alerts";
import { getBearerToken } from "@/lib/auth/client";
import { isLocalMode } from "@/lib/local-mode";

function waitForAlertsHydrated(): Promise<void> {
  const persistApi = usePriceAlerts.persist;
  if (persistApi.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = persistApi.onFinishHydration(() => {
      unsub();
      resolve();
    });
    setTimeout(() => {
      try {
        unsub();
      } catch {
        /* ignore */
      }
      resolve();
    }, 2500);
  });
}

function mergeAlert(a: PriceAlert, b: PriceAlert): PriceAlert {
  const base = normalizeAlert({
    ...a,
    ...b,
    armedProbability:
      coerceArmedProbability(b.armedProbability) ??
      coerceArmedProbability(a.armedProbability),
    armedHistTouch:
      coerceArmedProbability(b.armedHistTouch) ??
      coerceArmedProbability(a.armedHistTouch),
    armedRank: coerceArmedRank(b.armedRank) ?? coerceArmedRank(a.armedRank),
    hitAt: b.hitAt ?? a.hitAt,
    hitPrice: b.hitPrice ?? a.hitPrice,
    abandonedAt: b.abandonedAt ?? a.abandonedAt,
    abandonReason: b.abandonReason ?? a.abandonReason,
    livePrice:
      (b.liveAt ?? 0) >= (a.liveAt ?? 0)
        ? (b.livePrice ?? a.livePrice)
        : (a.livePrice ?? b.livePrice),
    liveAt: Math.max(b.liveAt ?? 0, a.liveAt ?? 0) || undefined,
    active:
      b.active || a.active
        ? b.hitAt || a.hitAt
          ? false
          : b.active || a.active
        : false,
  });
  if (a.hitAt || b.hitAt) {
    const hitSrc = (b.hitAt ?? 0) >= (a.hitAt ?? 0) ? b : a;
    base.active = false;
    base.hitAt = hitSrc.hitAt;
    base.hitPrice = hitSrc.hitPrice;
  }
  if (a.abandonedAt || b.abandonedAt) {
    const ab = (b.abandonedAt ?? 0) >= (a.abandonedAt ?? 0) ? b : a;
    if (!base.hitAt) {
      base.abandonedAt = ab.abandonedAt;
      base.abandonReason = ab.abandonReason;
      if (ab.abandonedAt) base.active = false;
    }
  }
  return base;
}

function mergeLists(remote: PriceAlert[], local: PriceAlert[]): PriceAlert[] {
  const byId = new Map<string, PriceAlert>();
  for (const a of remote.map(normalizeAlert)) byId.set(a.id, a);
  for (const a of local.map(normalizeAlert)) {
    const prev = byId.get(a.id);
    byId.set(a.id, prev ? mergeAlert(prev, a) : a);
  }
  const byKey = new Map<string, PriceAlert>();
  for (const a of byId.values()) {
    const k = `${a.symbol.toUpperCase()}|${a.targetPrice}|${a.tick}`;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, a);
    else byKey.set(k, mergeAlert(prev, a));
  }
  return [...byKey.values()].sort(
    (a, b) => (b.hitAt ?? b.createdAt) - (a.hitAt ?? a.createdAt),
  );
}

export type AccountSyncParams = {
  symbol: string;
  interval: string;
  range: string;
  windowKey: string;
  onSettings?: (s: {
    lang?: Lang | null;
    lastSymbol?: string | null;
    lastInterval?: string | null;
    lastRange?: string | null;
    lastWindow?: string | null;
  }) => void;
};

export type AccountSyncStatus =
  | "guest"
  | "loading"
  | "synced"
  | "syncing"
  | "error"
  | "local";

export function useAccountSync(params: AccountSyncParams) {
  const localMode = isLocalMode();
  const { user, isPending } = useCurrentUserState();
  const { lang, setLang } = useI18n();
  const alerts = usePriceAlerts((s) => s.alerts);
  const replaceAll = usePriceAlerts((s) => s.replaceAll);

  const syncedUser = useRef<string | null>(null);
  const skipNextPush = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullInFlight = useRef(false);
  const lastToastAt = useRef(0);
  const lastFocusPullAt = useRef(0);
  const loginAttempts = useRef(0);
  const langRef = useRef(lang);
  langRef.current = lang;
  const setLangRef = useRef(setLang);
  setLangRef.current = setLang;
  const userRef = useRef(user);
  userRef.current = user;

  const [status, setStatus] = useState<AccountSyncStatus>("guest");
  const statusRef = useRef<AccountSyncStatus>("guest");
  statusRef.current = status;
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [alertCountCloud, setAlertCountCloud] = useState<number | null>(null);
  const [accountKey, setAccountKey] = useState<string | null>(null);

  const paramsRef = useRef(params);
  paramsRef.current = params;

  const pullFromServer = useCallback(
    async (opts?: {
      silent?: boolean;
      reason?: "login" | "focus" | "poll" | "manual";
      force?: boolean;
    }) => {
      const u = userRef.current;
      if (!u || u.isDevFallback) return;
      if (pullInFlight.current && !opts?.force) return;

      const reason = opts?.reason ?? "poll";
      const cur = statusRef.current;
      if (!opts?.force && (reason === "focus" || reason === "poll")) {
        if (cur === "synced") {
          const minGap = reason === "focus" ? 10_000 : 30_000;
          if (Date.now() - lastFocusPullAt.current < minGap) return;
        }
      }

      pullInFlight.current = true;
      if (reason === "manual" || reason === "login") setStatus("syncing");

      try {
        await waitForAlertsHydrated();
        // Bearer wait: max ~1.5s (was ~3s)
        for (let i = 0; i < 10 && !getBearerToken(); i++) {
          await new Promise((r) => setTimeout(r, 150));
        }
        if (!getBearerToken()) throw new Error("Unauthorized");

        // 1) Upload THIS device first (server merges — safe)
        const localBefore = usePriceAlerts.getState().alerts;
        if (localBefore.length > 0) {
          try {
            const pre = await pushMyAlerts(localBefore, false);
            if (pre.accountKey) setAccountKey(pre.accountKey);
          } catch (e) {
            console.warn("[account-sync] pre-push", e);
          }
        }

        // 2) Download (2 retries max — faster login)
        let remote: Awaited<ReturnType<typeof fetchMyAlertsDetailed>> | null =
          null;
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            remote = await fetchMyAlertsDetailed();
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 250));
          }
        }
        if (lastErr || !remote) throw lastErr ?? new Error("list_failed");

        if (remote.accountKey) setAccountKey(remote.accountKey);

        // 3) Merge
        const local = usePriceAlerts.getState().alerts;
        const merged = mergeLists(remote.alerts, local);

        skipNextPush.current = true;
        replaceAll(merged);

        // 4) Push merged
        try {
          const pushRes = await pushMyAlerts(merged, merged.length === 0);
          setAlertCountCloud(
            typeof pushRes.count === "number" ? pushRes.count : merged.length,
          );
          if (pushRes.accountKey) setAccountKey(pushRes.accountKey);
        } catch (e) {
          console.warn("[account-sync] post-merge push", e);
          setAlertCountCloud(merged.length);
        }

        try {
          const settings = await getMySettings();
          const st = settings as {
            lang: Lang | null;
            lastSymbol: string | null;
            lastInterval: string | null;
            lastRange: string | null;
            lastWindow: string | null;
            alertEmail?: string | null;
            emailAlertsEnabled?: boolean;
          };
          if (st.lang === "en" || st.lang === "es")
            setLangRef.current(st.lang);
          if (st.alertEmail) {
            useEmailAlertPrefs.getState().subscribe(st.alertEmail);
            if (!st.emailAlertsEnabled)
              useEmailAlertPrefs.getState().unsubscribe();
            else useEmailAlertPrefs.getState().setEnabled(true);
          }
          paramsRef.current.onSettings?.(st);
        } catch {
          /* optional */
        }

        syncedUser.current = u.id;
        loginAttempts.current = 0;
        lastFocusPullAt.current = Date.now();
        setLastSyncedAt(Date.now());
        setStatus("synced");

        if ((reason === "login" || reason === "manual") && !opts?.silent) {
          const now = Date.now();
          if (now - lastToastAt.current > 5_000) {
            lastToastAt.current = now;
            const n = merged.length;
            toast[n === 0 ? "message" : "success"](
              n === 0
                ? langRef.current === "es"
                  ? "Nube lista · 0 alertas (crea una y se copia a PC y móvil)"
                  : "Cloud ready · 0 alerts (create one — copies to PC & mobile)"
                : langRef.current === "es"
                  ? `Nube · ${n} alertas sincronizadas`
                  : `Cloud · ${n} alerts synced`,
              { duration: 3200, id: "pra-sync-ok" },
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[account-sync] failed", reason, msg);

        if (reason === "login" && loginAttempts.current < 5) {
          loginAttempts.current += 1;
          pullInFlight.current = false;
          setTimeout(() => {
            void pullFromServer({ reason: "login", force: true });
          }, 600 * loginAttempts.current);
          return;
        }

        lastFocusPullAt.current = Date.now();
        setStatus(
          msg === "Unauthorized" || /unauthor/i.test(msg) ? "local" : "error",
        );

        const local = usePriceAlerts.getState().alerts;
        if (local.length > 0 && getBearerToken()) {
          void pushMyAlerts(local, false)
            .then((r) => {
              setAlertCountCloud(r.count ?? local.length);
              if (r.accountKey) setAccountKey(r.accountKey);
            })
            .catch(() => {});
        }

        if (reason === "manual" || reason === "login") {
          toast.error(
            langRef.current === "es"
              ? "Sync incompleta — toca el badge ☁"
              : "Sync incomplete — tap cloud badge",
            { id: "pra-sync-err", duration: 4000 },
          );
        }
      } finally {
        pullInFlight.current = false;
      }
    },
    [replaceAll],
  );

  useEffect(() => {
    // Local-first product mode: never touch cloud (no sync errors)
    if (localMode) {
      syncedUser.current = null;
      setStatus("guest");
      setAlertCountCloud(null);
      setAccountKey(null);
      return;
    }
    if (isPending) {
      setStatus("loading");
      return;
    }
    if (!user || user.isDevFallback) {
      syncedUser.current = null;
      loginAttempts.current = 0;
      setStatus("guest");
      setAlertCountCloud(null);
      setAccountKey(null);
      return;
    }
    if (syncedUser.current === user.id && statusRef.current === "synced") {
      return;
    }
    loginAttempts.current = 0;
    void pullFromServer({ reason: "login" });
  }, [localMode, user?.id, user?.isDevFallback, isPending, pullFromServer]);

  useEffect(() => {
    if (localMode) return;
    if (!user || user.isDevFallback) return;
    const kick = (force: boolean) => {
      void pullFromServer({ silent: true, reason: "focus", force });
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        kick(statusRef.current !== "synced");
      }
    };
    const onShow = () => kick(true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void pullFromServer({ silent: true, reason: "poll" });
      }
    }, 25_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
      window.clearInterval(interval);
    };
  }, [localMode, user?.id, user?.isDevFallback, pullFromServer]);

  // Live push — any status except guest (don't wait for "synced")
  useEffect(() => {
    if (localMode) return;
    if (!user || user.isDevFallback) return;
    if (!getBearerToken()) return;
    if (status === "guest") return;
    if (skipNextPush.current) {
      skipNextPush.current = false;
      return;
    }
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      const list = usePriceAlerts.getState().alerts;
      void pushMyAlerts(list, list.length === 0)
        .then((res) => {
          setAlertCountCloud(
            typeof res.count === "number" ? res.count : list.length,
          );
          if (res.accountKey) setAccountKey(res.accountKey);
          setLastSyncedAt(Date.now());
          if (statusRef.current !== "error") setStatus("synced");
          syncedUser.current = user.id;
        })
        .catch((e) => {
          console.warn("[account-sync] live push", e);
          setStatus("error");
        });
    }, 300);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [localMode, alerts, user?.id, user?.isDevFallback, status]);

  useEffect(() => {
    if (localMode) return;
    if (!user || user.isDevFallback) return;
    const tmr = setTimeout(() => {
      const p = paramsRef.current;
      void saveMySettings({
        data: {
          lang,
          lastSymbol: p.symbol,
          lastInterval: p.interval,
          lastRange: p.range,
          lastWindow: p.windowKey,
        },
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(tmr);
  }, [
    localMode,
    user?.id,
    user?.isDevFallback,
    lang,
    params.symbol,
    params.interval,
    params.range,
    params.windowKey,
  ]);

  const syncNow = useCallback(() => {
    if (localMode) return Promise.resolve();
    syncedUser.current = null;
    loginAttempts.current = 0;
    return pullFromServer({ reason: "manual", force: true });
  }, [localMode, pullFromServer]);

  return {
    status: localMode ? "guest" : status,
    lastSyncedAt: localMode ? null : lastSyncedAt,
    alertCountCloud: localMode ? null : alertCountCloud,
    accountKey: localMode ? null : accountKey,
    isCloud: localMode
      ? false
      : Boolean(user && !user.isDevFallback && status === "synced"),
    wantsCloud: localMode
      ? false
      : Boolean(user && !user.isDevFallback),
    syncNow,
  };
}
