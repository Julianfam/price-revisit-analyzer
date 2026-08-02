import { useCallback, useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  FREE_ANALYSES_PER_DAY,
  resolveEntitlements,
  type Entitlements,
} from "@/lib/billing/plans";
import {
  applyViewAs,
  GOD_ENTITLEMENTS,
  isGodUser,
  type ViewAsMode,
} from "@/lib/billing/god-mode";
import { activatePro } from "@/lib/billing/server";
import { fetchMyPlan, postPlanAction } from "@/lib/billing/plan-api";
import { getBearerToken } from "@/lib/auth/client";
import { isLocalMode, LOCAL_PRO_ENTITLEMENTS } from "@/lib/local-mode";

const PLAN_CACHE_KEY = "pra-plan-cache-v1";

const GUEST_ENTITLEMENTS: Entitlements = resolveEntitlements({
  plan: "free",
  status: "none",
  trialEndsAt: null,
  proEndsAt: null,
  analysesToday: 0,
  analysesDay: null,
});

function readPlanCache(): {
  entitlements: Entitlements;
  isGod: boolean;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as {
      entitlements?: Entitlements;
      isGod?: boolean;
    };
    if (j?.entitlements?.plan) {
      return {
        entitlements: j.entitlements,
        isGod: !!j.isGod,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writePlanCache(ent: Entitlements, isGod: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      PLAN_CACHE_KEY,
      JSON.stringify({ entitlements: ent, isGod, at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

type GodViewStore = {
  viewAs: ViewAsMode;
  setViewAs: (m: ViewAsMode) => void;
};

export const useGodView = create<GodViewStore>()(
  persist(
    (set) => ({
      viewAs: "god",
      setViewAs: (viewAs) => set({ viewAs }),
    }),
    { name: "pra-god-view-v1" },
  ),
);

export type ConsumeResult = {
  ok: boolean;
  reason?: string;
  remaining?: number | null;
  total?: number;
};

export type PlanState = {
  entitlements: Entitlements & {
    isGod?: boolean;
    viewAs?: ViewAsMode;
    realPlan?: string;
  };
  isGod: boolean;
  viewAs: ViewAsMode;
  setViewAs: (m: ViewAsMode) => void;
  loading: boolean;
  freeAnalysesPerDay: number;
  localMode: boolean;
  refresh: () => Promise<void>;
  beginTrial: () => Promise<boolean>;
  subscribePro: (opts?: {
    unlockCode?: string;
    paymentRef?: string;
  }) => Promise<boolean>;
  tryConsumeAnalysis: () => Promise<ConsumeResult>;
};

function initialFromCache(): {
  ent: Entitlements;
  isGod: boolean;
  loading: boolean;
} {
  if (isLocalMode()) {
    return { ent: { ...LOCAL_PRO_ENTITLEMENTS }, isGod: false, loading: false };
  }
  if (typeof window === "undefined") {
    return { ent: GUEST_ENTITLEMENTS, isGod: false, loading: true };
  }
  const hasBearer = !!getBearerToken();
  const cache = readPlanCache();
  if (hasBearer && cache) {
    return { ent: cache.entitlements, isGod: cache.isGod, loading: true };
  }
  if (hasBearer) {
    return { ent: GUEST_ENTITLEMENTS, isGod: false, loading: true };
  }
  return { ent: GUEST_ENTITLEMENTS, isGod: false, loading: true };
}

export function usePlan(): PlanState {
  const localMode = isLocalMode();
  const { user, isPending } = useCurrentUserState();
  const boot = useMemo(() => initialFromCache(), []);
  const [serverEntitlements, setServerEntitlements] = useState<Entitlements>(
    boot.ent,
  );
  const [serverIsGod, setServerIsGod] = useState(boot.isGod);
  const [loading, setLoading] = useState(boot.loading);
  const [freeAnalysesPerDay, setFree] = useState(FREE_ANALYSES_PER_DAY);
  const viewAs = useGodView((s) => s.viewAs);
  const setViewAs = useGodView((s) => s.setViewAs);

  const signedIn = !!user && !user.isDevFallback;
  const clientGodGuess = useMemo(
    () =>
      isGodUser({
        id: user?.id,
        email: user?.primaryEmail,
        name: user?.displayName,
        displayName: user?.displayName,
      }) || (!!user?.isDevFallback && user.id === "dev-user"),
    [user],
  );

  const isGod =
    !localMode &&
    (serverIsGod || (signedIn && clientGodGuess) || !!user?.isDevFallback);

  const refresh = useCallback(async () => {
    if (localMode) {
      setServerEntitlements({ ...LOCAL_PRO_ENTITLEMENTS });
      setServerIsGod(false);
      setLoading(false);
      return;
    }
    if (!signedIn && !user?.isDevFallback) {
      if (getBearerToken()) {
        setLoading(true);
        return;
      }
      setServerEntitlements(GUEST_ENTITLEMENTS);
      setServerIsGod(false);
      setLoading(false);
      return;
    }
    if (user?.isDevFallback) {
      setServerEntitlements({ ...GOD_ENTITLEMENTS });
      setServerIsGod(true);
      writePlanCache(GOD_ENTITLEMENTS, true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchMyPlan();
      const god = !!res.isGod || clientGodGuess;
      setServerIsGod(god);
      const next = god ? { ...GOD_ENTITLEMENTS } : res.entitlements;
      setServerEntitlements(next);
      writePlanCache(next, god);
      if (res.freeAnalysesPerDay) setFree(res.freeAnalysesPerDay);
    } catch (e) {
      console.warn("[usePlan] refresh failed", e);
      if (clientGodGuess) {
        setServerIsGod(true);
        setServerEntitlements({ ...GOD_ENTITLEMENTS });
        writePlanCache(GOD_ENTITLEMENTS, true);
      } else {
        const cache = readPlanCache();
        if (cache?.entitlements?.isPremium || cache?.isGod) {
          setServerEntitlements(cache.entitlements);
          setServerIsGod(!!cache.isGod);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [localMode, signedIn, user?.isDevFallback, clientGodGuess]);

  useEffect(() => {
    if (localMode) {
      setServerEntitlements({ ...LOCAL_PRO_ENTITLEMENTS });
      setLoading(false);
      return;
    }
    if (isPending) {
      setLoading(true);
      return;
    }
    void refresh();
  }, [localMode, isPending, refresh, user?.id]);

  useEffect(() => {
    if (localMode) return;
    if (clientGodGuess && signedIn) {
      setServerIsGod(true);
      setServerEntitlements((prev) =>
        prev.plan === "pro" && prev.isPremium ? prev : { ...GOD_ENTITLEMENTS },
      );
      writePlanCache(GOD_ENTITLEMENTS, true);
    }
  }, [localMode, clientGodGuess, signedIn, user?.id]);

  const entitlements = useMemo(() => {
    if (localMode) {
      return {
        ...LOCAL_PRO_ENTITLEMENTS,
        isGod: false,
        viewAs: "pro" as ViewAsMode,
        realPlan: "pro" as const,
      };
    }
    return applyViewAs(isGod, isGod ? viewAs : "pro", serverEntitlements);
  }, [localMode, isGod, viewAs, serverEntitlements]);

  const beginTrial = useCallback(async () => {
    if (localMode) return true;
    if (!signedIn) return false;
    if (isGod) {
      setServerEntitlements({ ...GOD_ENTITLEMENTS });
      return true;
    }
    try {
      const res = await postPlanAction("trial");
      if (res.entitlements) {
        setServerEntitlements(res.entitlements);
        writePlanCache(res.entitlements, !!res.isGod);
      }
      if (res.isGod) {
        setServerIsGod(true);
        setServerEntitlements({ ...GOD_ENTITLEMENTS });
        writePlanCache(GOD_ENTITLEMENTS, true);
      }
      if (res.ok) return true;
      if (
        res.reason === "already_trialing" ||
        res.reason === "already_pro"
      ) {
        await refresh();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [localMode, signedIn, isGod, refresh]);

  const subscribePro = useCallback(
    async (opts?: { unlockCode?: string; paymentRef?: string }) => {
      if (localMode) return true;
      if (!signedIn) return false;
      try {
        const res = (await activatePro({
          data: {
            confirm: true as const,
            unlockCode: opts?.unlockCode,
            paymentRef: opts?.paymentRef,
          },
        })) as {
          ok: boolean;
          entitlements?: Entitlements;
          isGod?: boolean;
        };
        if (res.isGod || clientGodGuess) {
          setServerIsGod(true);
          setServerEntitlements({ ...GOD_ENTITLEMENTS });
          writePlanCache(GOD_ENTITLEMENTS, true);
          return true;
        }
        if (res.entitlements) {
          setServerEntitlements(res.entitlements);
          writePlanCache(res.entitlements, false);
        }
        if (res.ok) return true;
        await refresh();
        return false;
      } catch {
        return false;
      }
    },
    [localMode, signedIn, refresh, clientGodGuess],
  );

  const tryConsumeAnalysis = useCallback(async (): Promise<ConsumeResult> => {
    if (localMode) {
      return { ok: true, remaining: null };
    }
    if (isGod && viewAs !== "free") {
      return { ok: true, remaining: null };
    }
    if (serverEntitlements.isPremium && !(isGod && viewAs === "free")) {
      return { ok: true, remaining: null };
    }

    const consumeLocal = (storageKey: string, status: "none" | "expired") => {
      const today = new Date().toISOString().slice(0, 10);
      try {
        const raw = localStorage.getItem(storageKey);
        const parsed = raw
          ? (JSON.parse(raw) as { day: string; n: number })
          : null;
        const n0 = parsed?.day === today ? parsed.n : 0;
        if (n0 >= FREE_ANALYSES_PER_DAY) {
          return {
            ok: false as const,
            reason: "quota",
            remaining: 0,
            total: FREE_ANALYSES_PER_DAY,
          };
        }
        const next = n0 + 1;
        localStorage.setItem(
          storageKey,
          JSON.stringify({ day: today, n: next }),
        );
        const ent = resolveEntitlements({
          plan: "free",
          status,
          trialEndsAt: null,
          proEndsAt: null,
          analysesToday: next,
          analysesDay: today,
        });
        setServerEntitlements(ent);
        return {
          ok: true as const,
          remaining: ent.analysesLeftToday,
          total: FREE_ANALYSES_PER_DAY,
        };
      } catch {
        return { ok: true as const, remaining: null };
      }
    };

    if (isGod && viewAs === "free") {
      return consumeLocal("pra-god-preview-free-analyses", "expired");
    }

    if (!signedIn) {
      return consumeLocal("pra-guest-analyses", "none");
    }

    try {
      const res = await postPlanAction("consume");
      if (res.isGod) {
        setServerIsGod(true);
        setServerEntitlements({ ...GOD_ENTITLEMENTS });
        writePlanCache(GOD_ENTITLEMENTS, true);
        return { ok: true, remaining: null };
      }
      if (res.entitlements) {
        setServerEntitlements(res.entitlements);
        writePlanCache(res.entitlements, false);
      }
      return {
        ok: !!res.ok,
        reason: res.reason,
        remaining: res.entitlements?.analysesLeftToday ?? null,
        total: FREE_ANALYSES_PER_DAY,
      };
    } catch {
      if (serverEntitlements.isPremium) {
        return { ok: true, remaining: null };
      }
      return consumeLocal("pra-guest-analyses", "none");
    }
  }, [localMode, isGod, viewAs, serverEntitlements.isPremium, signedIn]);

  return {
    entitlements,
    isGod,
    viewAs,
    setViewAs,
    loading,
    freeAnalysesPerDay,
    localMode,
    refresh,
    beginTrial,
    subscribePro,
    tryConsumeAnalysis,
  };
}
