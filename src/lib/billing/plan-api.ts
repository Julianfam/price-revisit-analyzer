/** Client REST helpers for plan / trial (mobile-safe). */
import { getBearerToken } from "@/lib/auth/client";
import type { Entitlements } from "@/lib/billing/plans";

function authHeaders(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const t = getBearerToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

export type PlanApiResponse = {
  entitlements: Entitlements;
  isGod?: boolean;
  freeAnalysesPerDay?: number;
  trialDays?: number;
  proDays?: number;
};

export async function fetchMyPlan(): Promise<PlanApiResponse> {
  const res = await fetch("/api/user/plan", {
    method: "GET",
    credentials: "include",
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `plan_failed_${res.status}`);
  }
  return (await res.json()) as PlanApiResponse;
}

export async function postPlanAction(
  action: "trial" | "consume",
): Promise<{
  ok: boolean;
  reason?: string;
  entitlements?: Entitlements;
  isGod?: boolean;
}> {
  const res = await fetch("/api/user/plan", {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({ action }),
  });
  if (res.status === 401) throw new Error("Unauthorized");
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    reason?: string;
    entitlements?: Entitlements;
    isGod?: boolean;
    error?: string;
  };
  if (data.error && data.ok == null) {
    throw new Error(data.error);
  }
  return {
    ok: !!data.ok,
    reason: data.reason,
    entitlements: data.entitlements,
    isGod: data.isGod,
  };
}
