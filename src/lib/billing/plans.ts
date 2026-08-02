/** Commercial plans for Price Revisit Analyzer. */

export type PlanId = "free" | "trial" | "pro";

export type PlanStatus =
  | "none"
  | "trialing"
  | "active"
  | "expired"
  | "canceled";

export const TRIAL_DAYS = 7;
export const PRO_DAYS = 30;

export const FREE_ANALYSES_PER_DAY = 20;
export const FREE_MAX_ACTIVE_ALERTS = 5;
export const FREE_TOP_SCENARIOS = 2;
export const FREE_RECENT_REVISITS = 5;
export const FREE_HOT_LEVELS = 5;

export type Entitlements = {
  plan: PlanId;
  status: PlanStatus;
  isPremium: boolean;
  canAnalyze: boolean;
  analysesLeftToday: number | null;
  canUseScalper: boolean;
  canUseEmailAlerts: boolean;
  maxActiveAlerts: number | null;
  canCloudSync: boolean;
  maxTopScenarios: number;
  maxRecentRevisits: number;
  maxHotLevels: number;
  canUseBreakdown: boolean;
  canUseFullReport: boolean;
  canUseFullScenarios: boolean;
  /** Smart symbol search, categories, recents. */
  canUseProSearch: boolean;
  /** Extra windows/intervals, min-P% filter, multi-window tools. */
  canUseAdvancedParams: boolean;
  trialEndsAt: number | null;
  proEndsAt: number | null;
  trialDaysLeft: number | null;
  proDaysLeft: number | null;
};

export function daysLeft(
  endsAt: number | null | undefined,
  now = Date.now(),
): number | null {
  if (endsAt == null) return null;
  const ms = endsAt - now;
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60_000));
}

function freeFeatures(freeLeft: number): Omit<
  Entitlements,
  | "plan"
  | "status"
  | "trialEndsAt"
  | "proEndsAt"
  | "trialDaysLeft"
  | "proDaysLeft"
> {
  return {
    isPremium: false,
    canAnalyze: freeLeft > 0,
    analysesLeftToday: freeLeft,
    canUseScalper: false,
    canUseEmailAlerts: false,
    maxActiveAlerts: FREE_MAX_ACTIVE_ALERTS,
    canCloudSync: true,
    maxTopScenarios: FREE_TOP_SCENARIOS,
    maxRecentRevisits: FREE_RECENT_REVISITS,
    maxHotLevels: FREE_HOT_LEVELS,
    canUseBreakdown: false,
    canUseFullReport: false,
    canUseFullScenarios: false,
    canUseProSearch: false,
    canUseAdvancedParams: false,
  };
}

function premiumFeatures(): Omit<
  Entitlements,
  | "plan"
  | "status"
  | "trialEndsAt"
  | "proEndsAt"
  | "trialDaysLeft"
  | "proDaysLeft"
> {
  return {
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
  };
}

export function resolveEntitlements(input: {
  plan: string;
  status: string;
  trialEndsAt: number | null;
  proEndsAt: number | null;
  analysesToday: number;
  analysesDay: string | null;
  now?: number;
}): Entitlements {
  const now = input.now ?? Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const usedToday =
    input.analysesDay === today ? Math.max(0, input.analysesToday) : 0;

  let plan = (input.plan as PlanId) || "free";
  let status = (input.status as PlanStatus) || "none";

  if (
    status === "trialing" &&
    input.trialEndsAt != null &&
    input.trialEndsAt <= now
  ) {
    plan = "free";
    status = "expired";
  }
  if (
    status === "active" &&
    input.proEndsAt != null &&
    input.proEndsAt <= now
  ) {
    plan = "free";
    status = "expired";
  }
  if (status === "active" && (input.proEndsAt == null || input.proEndsAt > now)) {
    plan = "pro";
  }
  if (
    status === "trialing" &&
    input.trialEndsAt != null &&
    input.trialEndsAt > now
  ) {
    plan = "trial";
  }

  const isPremium = plan === "trial" || plan === "pro";
  const freeLeft = Math.max(0, FREE_ANALYSES_PER_DAY - usedToday);
  const base = isPremium ? premiumFeatures() : freeFeatures(freeLeft);

  return {
    plan,
    status,
    ...base,
    trialEndsAt: input.trialEndsAt,
    proEndsAt: input.proEndsAt,
    trialDaysLeft:
      status === "trialing" ? daysLeft(input.trialEndsAt, now) : null,
    proDaysLeft: status === "active" ? daysLeft(input.proEndsAt, now) : null,
  };
}
