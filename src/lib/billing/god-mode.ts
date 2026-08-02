import type { Entitlements, PlanId, PlanStatus } from "@/lib/billing/plans";
import {
  FREE_ANALYSES_PER_DAY,
  FREE_MAX_ACTIVE_ALERTS,
  resolveEntitlements,
} from "@/lib/billing/plans";

/** Owner tokens — match name, email local-part, X handle, display name. */
const BUILTIN_GOD_TOKENS = [
  "realismomagico0",
  "realismo magico",
  "realismomagico",
  "magical realism",
  "magicalrealism",
  "realismomagico0",
  "realismo_magico",
  "realismo-magico",
  "dev-user",
  "dev@example.com",
];

function envTokens(): string[] {
  const raw =
    (typeof process !== "undefined" && process.env.GOD_MODE_ALLOW?.trim()) ||
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: { VITE_GOD_MODE_ALLOW?: string } }).env
        ?.VITE_GOD_MODE_ALLOW?.trim()) ||
    "";
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[@]/g, "")
    .replace(/[^a-z0-9._+\- ]+/g, "")
    .trim();
}

function compact(s: string): string {
  return normalize(s).replace(/[\s._+\-]+/g, "");
}

export function isGodUser(input: {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  displayName?: string | null;
}): boolean {
  const raw = [
    input.id,
    input.email,
    input.name,
    input.displayName,
    input.email?.split("@")[0],
    // X sometimes puts handle in name as @user
    input.name?.replace(/^@/, ""),
    input.displayName?.replace(/^@/, ""),
  ].filter((x): x is string => !!x && x.trim().length > 0);

  if (raw.length === 0) return false;

  const candidates = new Set<string>();
  for (const r of raw) {
    candidates.add(normalize(r));
    candidates.add(compact(r));
  }

  const tokens = [...BUILTIN_GOD_TOKENS, ...envTokens()];
  for (const c of candidates) {
    if (!c) continue;
    for (const tok of tokens) {
      const nt = normalize(tok);
      const ct = compact(tok);
      if (!nt) continue;
      if (c === nt || c === ct) return true;
      if (c.includes(nt) || nt.includes(c)) return true;
      if (c.includes(ct) || ct.includes(c)) return true;
    }
  }
  return false;
}

export type ViewAsMode = "god" | "pro" | "free";

export const GOD_ENTITLEMENTS: Entitlements = {
  plan: "pro",
  status: "active",
  isPremium: true,
  canAnalyze: true,
  analysesLeftToday: null,
  canUseScalper: true,
  canUseEmailAlerts: true,
  maxActiveAlerts: null,
  canCloudSync: true,
  maxTopScenarios: 5,
  maxRecentRevisits: 12,
  maxHotLevels: 12,
  canUseBreakdown: true,
  canUseFullReport: true,
  canUseFullScenarios: true,
  canUseProSearch: true,
  canUseAdvancedParams: true,
  trialEndsAt: null,
  // Far-future so UI never shows "— días"
  proEndsAt: Date.now() + 3650 * 24 * 60 * 60_000,
  trialDaysLeft: null,
  proDaysLeft: 3650,
};

export function freePreviewEntitlements(
  analysesUsedToday = 0,
): Entitlements {
  return resolveEntitlements({
    plan: "free",
    status: "expired",
    trialEndsAt: null,
    proEndsAt: null,
    analysesToday: analysesUsedToday,
    analysesDay: new Date().toISOString().slice(0, 10),
  });
}

export function proPreviewEntitlements(): Entitlements {
  return resolveEntitlements({
    plan: "pro",
    status: "active",
    trialEndsAt: null,
    proEndsAt: Date.now() + 30 * 24 * 60 * 60_000,
    analysesToday: 0,
    analysesDay: null,
  });
}

export function applyViewAs(
  isGod: boolean,
  viewAs: ViewAsMode,
  serverEntitlements: Entitlements,
): Entitlements & { isGod: boolean; viewAs: ViewAsMode; realPlan: PlanId } {
  if (!isGod) {
    return {
      ...serverEntitlements,
      isGod: false,
      viewAs: "pro",
      realPlan: serverEntitlements.plan,
    };
  }

  if (viewAs === "free") {
    const used =
      FREE_ANALYSES_PER_DAY -
      (serverEntitlements.analysesLeftToday ?? FREE_ANALYSES_PER_DAY);
    const free = freePreviewEntitlements(Math.max(0, used));
    return {
      ...free,
      isGod: true,
      viewAs: "free",
      realPlan: "pro",
    };
  }

  if (viewAs === "pro") {
    return {
      ...proPreviewEntitlements(),
      isGod: true,
      viewAs: "pro",
      realPlan: "pro",
    };
  }

  return {
    ...GOD_ENTITLEMENTS,
    isGod: true,
    viewAs: "god",
    realPlan: "pro",
    plan: "pro" as PlanId,
    status: "active" as PlanStatus,
  };
}

export { FREE_ANALYSES_PER_DAY, FREE_MAX_ACTIVE_ALERTS };
