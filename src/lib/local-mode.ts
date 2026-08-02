/**
 * Local-first mode — product decision while cloud OAuth is not ready.
 *
 * Default: ON (VITE_LOCAL_MODE unset or "true").
 * Turn off freemium/auth path later with VITE_LOCAL_MODE=false + real OAuth keys.
 *
 * In local mode:
 * - Full Pro-class features on this device
 * - Alerts / settings stay in localStorage only (no cloud sync attempts)
 * - Login is optional and not required for any core feature
 * - No free-token quota wall
 */
import type { Entitlements } from "@/lib/billing/plans";

function envFlag(name: string): string | undefined {
  try {
    const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[
      name
    ];
    return typeof v === "string" ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

function processFlag(name: string): string | undefined {
  try {
    if (typeof process === "undefined") return undefined;
    return process.env[name]?.trim();
  } catch {
    return undefined;
  }
}

/**
 * Local mode is the default so the app is always demoable on Vercel
 * without X/Google OAuth or Postgres.
 */
export function isLocalMode(): boolean {
  const raw =
    envFlag("VITE_LOCAL_MODE") ??
    processFlag("VITE_LOCAL_MODE") ??
    processFlag("LOCAL_MODE");
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") {
    return false;
  }
  if (raw === "true" || raw === "1" || raw === "on" || raw === "yes") {
    return true;
  }
  // Default ON
  return true;
}

/** Full local Pro (no cloud, no email server). */
export const LOCAL_PRO_ENTITLEMENTS: Entitlements = {
  plan: "pro",
  status: "active",
  isPremium: true,
  canAnalyze: true,
  analysesLeftToday: null,
  canUseScalper: true,
  canUseEmailAlerts: false,
  maxActiveAlerts: null,
  canCloudSync: false,
  maxTopScenarios: 5,
  maxRecentRevisits: 12,
  maxHotLevels: 12,
  canUseBreakdown: true,
  canUseFullReport: true,
  canUseFullScenarios: true,
  canUseProSearch: true,
  canUseAdvancedParams: true,
  trialEndsAt: null,
  proEndsAt: Date.now() + 3650 * 24 * 60 * 60_000,
  trialDaysLeft: null,
  proDaysLeft: 3650,
};
