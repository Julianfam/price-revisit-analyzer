import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { optionalAuthMiddleware } from "@/lib/auth/optional-middleware";
import {
  FREE_RECENT_REVISITS,
  FREE_TOP_SCENARIOS,
  resolveEntitlements,
} from "@/lib/billing/plans";
import { isGodUser } from "@/lib/billing/god-mode";
import { isLocalMode } from "@/lib/local-mode";
import { getSql } from "@/lib/db";
import { runAnalysis } from "./engine";
import {
  candidatesFromAnalysis,
  pickQuantumUniverse,
  QUANTUM_PHASE1_GRID,
  QUANTUM_PHASE2_GRID,
  QUANTUM_REFINE_ASSETS,
  runQuantumLoop,
  type QuantumCandidate,
  type QuantumParamCombo,
  type QuantumRunResult,
} from "./quantum";
import {
  createQuantumJob,
  getQuantumJob,
  newQuantumJobId,
  patchQuantumJob,
  type QuantumJobProgress,
} from "./quantum-jobs.server";
import { rankScalperSetups, setupsFromAnalysis } from "./scalper";
import { SYMBOL_LIST, WINDOW_OPTIONS } from "./symbols";
import type { ScalperSetup } from "./types";
import { fetchMarketOHLC } from "./market-data";
import { avStatus } from "./alpha-vantage";

const analyzeInput = z.object({
  symbol: z.string().min(1).max(32),
  interval: z.string().default("5m"),
  range: z.string().default("5d"),
  window: z.string().default("1h"),
  tick: z.number().positive().nullable().optional(),
  consumeQuota: z.boolean().optional().default(true),
  /** Default true: always pull fresh market data on user Analyze. */
  forceRefresh: z.boolean().optional().default(true),
});

async function planCapsForUser(
  userId: string | null,
  email?: string | null,
  name?: string | null,
) {
  // Local-first: full Pro caps for everyone (no OAuth / freemium wall)
  if (isLocalMode()) {
    return {
      maxScenarios: 5,
      maxRecentRevisits: 12,
      isPremium: true,
      canAnalyze: true,
      canScalper: true,
    };
  }
  if (!userId) {
    return {
      maxScenarios: FREE_TOP_SCENARIOS,
      maxRecentRevisits: FREE_RECENT_REVISITS,
      isPremium: false,
      canAnalyze: true,
      canScalper: false,
    };
  }
  if (isGodUser({ id: userId, email, name })) {
    return {
      maxScenarios: 5,
      maxRecentRevisits: 12,
      isPremium: true,
      canAnalyze: true,
      canScalper: true,
    };
  }
  try {
    const sql = await getSql();
    await sql.query(`
      create table if not exists user_subscriptions (
        user_id text primary key,
        plan text not null default 'free',
        status text not null default 'none',
        trial_started_at bigint,
        trial_ends_at bigint,
        pro_started_at bigint,
        pro_ends_at bigint,
        analyses_today int not null default 0,
        analyses_day text,
        updated_at timestamptz not null default now()
      )
    `);
    const rows = await sql<{
      plan: string;
      status: string;
      trial_ends_at: number | null;
      pro_ends_at: number | null;
      analyses_today: number | null;
      analyses_day: string | null;
    }>`
      select plan, status, trial_ends_at, pro_ends_at, analyses_today, analyses_day
      from user_subscriptions where user_id = ${userId} limit 1
    `;
    const r = rows[0];
    const ent = resolveEntitlements({
      plan: r?.plan ?? "free",
      status: r?.status ?? "none",
      trialEndsAt: r?.trial_ends_at != null ? Number(r.trial_ends_at) : null,
      proEndsAt: r?.pro_ends_at != null ? Number(r.pro_ends_at) : null,
      analysesToday: r?.analyses_today != null ? Number(r.analyses_today) : 0,
      analysesDay: r?.analyses_day ?? null,
    });
    return {
      maxScenarios: ent.maxTopScenarios,
      maxRecentRevisits: ent.maxRecentRevisits,
      isPremium: ent.isPremium,
      canAnalyze: ent.canAnalyze,
      canScalper: ent.canUseScalper,
      analysesLeft: ent.analysesLeftToday,
    };
  } catch {
    return {
      maxScenarios: FREE_TOP_SCENARIOS,
      maxRecentRevisits: FREE_RECENT_REVISITS,
      isPremium: false,
      canAnalyze: true,
      canScalper: false,
    };
  }
}

async function serverConsumeIfNeeded(userId: string) {
  try {
    const sql = await getSql();
    const day = new Date().toISOString().slice(0, 10);
    const rows = await sql<{
      plan: string;
      status: string;
      analyses_today: number | null;
      analyses_day: string | null;
      trial_ends_at: number | null;
      pro_ends_at: number | null;
    }>`
      select plan, status, analyses_today, analyses_day, trial_ends_at, pro_ends_at
      from user_subscriptions where user_id = ${userId} limit 1
    `;
    const r = rows[0];
    const ent = resolveEntitlements({
      plan: r?.plan ?? "free",
      status: r?.status ?? "none",
      trialEndsAt: r?.trial_ends_at != null ? Number(r.trial_ends_at) : null,
      proEndsAt: r?.pro_ends_at != null ? Number(r.pro_ends_at) : null,
      analysesToday: r?.analyses_today != null ? Number(r.analyses_today) : 0,
      analysesDay: r?.analyses_day ?? null,
    });
    if (ent.isPremium) return { ok: true as const };
    if (!ent.canAnalyze) return { ok: false as const };

    const todayCount =
      r?.analyses_day === day ? Number(r?.analyses_today ?? 0) : 0;
    await sql`
      insert into user_subscriptions (user_id, plan, status, analyses_today, analyses_day, updated_at)
      values (${userId}, ${r?.plan ?? "free"}, ${r?.status ?? "none"}, ${todayCount + 1}, ${day}, now())
      on conflict (user_id) do update set
        analyses_today = ${todayCount + 1},
        analyses_day = ${day},
        updated_at = now()
    `;
    return { ok: true as const };
  } catch {
    return { ok: true as const };
  }
}

export const analyzeAsset = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator((data: unknown) => analyzeInput.parse(data))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId?: string | null }).userId ?? null;
    const email = (context as { userEmail?: string | null }).userEmail;
    const name = (context as { userName?: string | null }).userName;
    const caps = await planCapsForUser(userId, email, name);

    if (userId && data.consumeQuota !== false) {
      if (!caps.canAnalyze && !caps.isPremium) {
        throw new Error("QUOTA_EXCEEDED");
      }
      if (!caps.isPremium) {
        const c = await serverConsumeIfNeeded(userId);
        if (!c.ok) throw new Error("QUOTA_EXCEEDED");
      }
    }

    const windowOpt =
      WINDOW_OPTIONS.find((w) => w.value === data.window) ?? WINDOW_OPTIONS[1]!;

    const { yahooSymbol, bars, meta } = await fetchMarketOHLC({
      symbol: data.symbol,
      interval: data.interval,
      range: data.range,
      forceRefresh: data.forceRefresh !== false,
    });

    const result = runAnalysis({
      symbol: data.symbol.trim().toUpperCase(),
      yahooSymbol,
      bars,
      interval: data.interval,
      range: data.range,
      windowMs: windowOpt.ms,
      windowLabel: windowOpt.label,
      tickOverride: data.tick ?? null,
      maxScenarios: caps.maxScenarios,
      maxRecentRevisits: caps.maxRecentRevisits,
      livePrice: meta.price,
    });

    const chartBars =
      result.bars.length > 400 ? result.bars.slice(-400) : result.bars;
    const windows =
      result.windows.length > 80 ? result.windows.slice(-80) : result.windows;

    return {
      ...result,
      bars: chartBars,
      windows,
      lastPrice:
        meta.price && Number.isFinite(meta.price)
          ? meta.price
          : result.lastPrice,
      planMeta: {
        maxScenarios: caps.maxScenarios,
        isPremium: caps.isPremium,
        dataSource: meta.source ?? "market",
        liveSource: meta.liveSource,
        alphaVantage: avStatus(),
        fetchedAt: Date.now(),
      },
    };
  });

export const fetchLiveQuote = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        symbol: z.string().min(1).max(32),
        sinceMs: z.number().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { yahooSymbol, bars, meta } = await fetchMarketOHLC({
      symbol: data.symbol,
      interval: "1m",
      range: "1d",
      forceRefresh: true,
    });
    if (bars.length === 0) {
      throw new Error(`No live bars for ${yahooSymbol}`);
    }
    const lastBar = bars[bars.length - 1]!;
    const last = meta.price ?? lastBar.c;
    const cutoff = Math.max(
      data.sinceMs ?? 0,
      Date.now() - 30 * 60_000,
      lastBar.t - 30 * 60_000,
    );
    const recent = bars.filter((b) => b.t >= cutoff - 60_000);
    return {
      yahooSymbol,
      last,
      high: lastBar.h,
      low: lastBar.l,
      barTime: lastBar.t,
      fetchedAt: Date.now(),
      source: meta.source ?? "yahoo",
      bars: recent.map((b) => ({
        t: b.t,
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
      })),
    };
  });

const scalperInput = z.object({
  interval: z.string().default("5m"),
  range: z.string().default("5d"),
  window: z.string().default("1h"),
});

async function analyzeOne(
  symbol: string,
  interval: string,
  range: string,
  windowMs: number,
  windowLabel: string,
): Promise<ScalperSetup[]> {
  const { yahooSymbol, bars } = await fetchMarketOHLC({
    symbol,
    interval,
    range,
    yahooOnly: true,
  });
  const result = runAnalysis({
    symbol: symbol.toUpperCase(),
    yahooSymbol,
    bars,
    interval,
    range,
    windowMs,
    windowLabel,
    tickOverride: null,
    maxScenarios: 5,
    maxRecentRevisits: 8,
  });
  return setupsFromAnalysis(result);
}

export const scanScalperSetups = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator((data: unknown) => scalperInput.parse(data))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId?: string | null }).userId ?? null;
    const email = (context as { userEmail?: string | null }).userEmail;
    const name = (context as { userName?: string | null }).userName;
    const caps = await planCapsForUser(userId, email, name);
    if (!caps.canScalper) {
      throw new Error("PREMIUM_REQUIRED");
    }

    const windowOpt =
      WINDOW_OPTIONS.find((w) => w.value === data.window) ?? WINDOW_OPTIONS[1]!;

    const all: ScalperSetup[] = [];
    const errors: { symbol: string; error: string }[] = [];
    const seenYahoo = new Set<string>();
    const symbols = SYMBOL_LIST.filter((s) => {
      const y = s.yahoo.toUpperCase();
      if (seenYahoo.has(y)) return false;
      seenYahoo.add(y);
      return true;
    });

    const range =
      data.interval === "1m" && ["3mo", "6mo", "1y"].includes(data.range)
        ? "5d"
        : data.range;

    const batchSize = 3;
    const failed: string[] = [];

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const settled = await Promise.allSettled(
        batch.map((entry) =>
          analyzeOne(
            entry.value,
            data.interval,
            range,
            windowOpt.ms,
            windowOpt.label,
          ),
        ),
      );
      settled.forEach((res, idx) => {
        const entry = batch[idx]!;
        if (res.status === "fulfilled") all.push(...res.value);
        else {
          const msg =
            res.reason instanceof Error
              ? res.reason.message
              : String(res.reason);
          errors.push({ symbol: entry.value, error: msg });
          failed.push(entry.value);
        }
      });
      if (i + batchSize < symbols.length) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    if (failed.length > 0) {
      await new Promise((r) => setTimeout(r, 400));
      for (const symbol of failed) {
        try {
          const setups = await analyzeOne(
            symbol,
            data.interval,
            range === "1d" ? "5d" : range,
            windowOpt.ms,
            windowOpt.label,
          );
          all.push(...setups);
          const ix = errors.findIndex((e) => e.symbol === symbol);
          if (ix >= 0) errors.splice(ix, 1);
        } catch {
          /* keep */
        }
      }
    }

    const top = rankScalperSetups(all, 5);
    return {
      setups: top,
      scanned: symbols.length,
      candidates: all.length,
      highProbCount: all.filter((s) => s.meetsThreshold).length,
      threshold: 80,
      minPipsHint: 8,
      windowLabel: windowOpt.label,
      interval: data.interval,
      range,
      errors,
      fetchedAt: Date.now(),
    };
  });

/* ───────────── Quantum Agent ───────────── */

const quantumInput = z.object({
  assetCount: z.number().int().min(3).max(8).optional().default(7),
  symbols: z.array(z.string().min(1).max(32)).max(8).optional(),
  minProb: z.number().min(0).max(100).optional().default(0),
  minPips: z.number().min(0).max(10_000).optional().default(0),
  jobId: z.string().min(4).max(64).optional(),
});

function resolveUniverse(data: z.infer<typeof quantumInput>) {
  if (data.symbols && data.symbols.length > 0) {
    return data.symbols
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, data.assetCount)
      .map((value) => {
        const hit = SYMBOL_LIST.find((e) => e.value.toUpperCase() === value);
        return (
          hit ?? {
            label: value,
            value,
            yahoo: value,
            name: value,
            category: "stocks" as const,
          }
        );
      });
  }
  return pickQuantumUniverse(data.assetCount);
}

async function executeQuantumRun(
  data: z.infer<typeof quantumInput>,
  jobId?: string,
): Promise<QuantumRunResult> {
  const t0 = Date.now();
  const universe = resolveUniverse(data);
  const totalEst =
    universe.length * QUANTUM_PHASE1_GRID.length +
    QUANTUM_REFINE_ASSETS * QUANTUM_PHASE2_GRID.length +
    1;

  if (jobId) {
    createQuantumJob(jobId, totalEst);
    patchQuantumJob(jobId, {
      status: "phase1",
      phase: 1,
      label: "Wide scan",
      detail: "Starting…",
      current: 0,
      total: totalEst,
      pct: 0,
    });
  }

  const analyze = async (
    entry: (typeof universe)[0],
    combo: QuantumParamCombo,
  ): Promise<QuantumCandidate[]> => {
    const windowOpt =
      WINDOW_OPTIONS.find((w) => w.value === combo.window) ??
      WINDOW_OPTIONS[1]!;
    let range = combo.range;
    if (combo.interval === "1m" && ["3mo", "6mo", "1y"].includes(range)) {
      range = "5d";
    }
    if (combo.interval === "5m" && range === "3mo") range = "1mo";

    const { yahooSymbol, bars } = await fetchMarketOHLC({
      symbol: entry.value,
      interval: combo.interval,
      range,
      yahooOnly: true,
    });
    const result = runAnalysis({
      symbol: entry.value.toUpperCase(),
      yahooSymbol,
      bars,
      interval: combo.interval,
      range,
      windowMs: windowOpt.ms,
      windowLabel: windowOpt.label,
      tickOverride: null,
      maxScenarios: 5,
      maxRecentRevisits: 5,
    });
    return candidatesFromAnalysis(result, combo, entry.name, entry.category);
  };

  const loop = await runQuantumLoop({
    universe,
    analyze,
    refineCount: QUANTUM_REFINE_ASSETS,
    pauseMs: 70,
    minProb: data.minProb ?? 0,
    minPips: data.minPips ?? 0,
    onProgress: (e) => {
      if (!jobId) return;
      patchQuantumJob(jobId, {
        status: e.status === "done" ? "consensus" : e.status,
        phase: e.phase,
        label: e.label,
        detail: e.detail,
        current: e.current,
        total: e.total,
        refinedAssets: e.refinedAssets,
        pct: Math.min(99, Math.round((e.current / Math.max(1, e.total)) * 100)),
      });
    },
  });

  const result: QuantumRunResult = {
    topPrices: loop.topPrices,
    scanned: loop.scanned,
    combos: QUANTUM_PHASE1_GRID.length + QUANTUM_PHASE2_GRID.length,
    candidates: loop.all.length,
    universe: universe.map((u) => u.value),
    errors: loop.errors,
    tookMs: Date.now() - t0,
    fetchedAt: Date.now(),
    filters: {
      minProb: data.minProb ?? 0,
      minPips: data.minPips ?? 0,
    },
    loop: {
      phase1Scans: loop.phase1Scans,
      phase2Scans: loop.phase2Scans,
      refinedAssets: loop.refinedAssets,
      consensusBoosts: loop.consensusBoosts,
    },
  };

  if (jobId) {
    patchQuantumJob(jobId, {
      status: "done",
      phase: 3,
      label: "Done",
      detail: `${result.topPrices.length} targets`,
      current: totalEst,
      total: totalEst,
      pct: 100,
      result,
      refinedAssets: loop.refinedAssets,
    });
  }

  return result;
}

export const runQuantumAgent = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator((data: unknown) => quantumInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<QuantumRunResult> => {
    const userId = (context as { userId?: string | null }).userId ?? null;
    const email = (context as { userEmail?: string | null }).userEmail;
    const name = (context as { userName?: string | null }).userName;
    const caps = await planCapsForUser(userId, email, name);
    if (!caps.isPremium && !caps.canScalper) {
      throw new Error("PREMIUM_REQUIRED");
    }
    return executeQuantumRun(data, data.jobId);
  });

export const startQuantumAgent = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator((data: unknown) => quantumInput.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId?: string | null }).userId ?? null;
    const email = (context as { userEmail?: string | null }).userEmail;
    const name = (context as { userName?: string | null }).userName;
    const caps = await planCapsForUser(userId, email, name);
    if (!caps.isPremium && !caps.canScalper) {
      throw new Error("PREMIUM_REQUIRED");
    }

    /**
     * Serverless (Vercel): in-memory job maps do not survive across isolates.
     * Always run the full Quantum loop in THIS request and return the result.
     * Progress is simulated on the client while the request is in flight.
     */
    const jobId = newQuantumJobId();
    const universe = resolveUniverse(data);
    const totalEst =
      universe.length * QUANTUM_PHASE1_GRID.length +
      QUANTUM_REFINE_ASSETS * QUANTUM_PHASE2_GRID.length +
      1;

    try {
      const result = await executeQuantumRun(data, jobId);
      return {
        jobId,
        total: totalEst,
        status: "done" as const,
        result,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        jobId,
        total: totalEst,
        status: "error" as const,
        error: msg,
      };
    }
  });

export const getQuantumStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ jobId: z.string().min(4).max(64) }).parse(data),
  )
  .handler(
    async ({
      data,
    }): Promise<QuantumJobProgress | { missing: true }> => {
      const job = getQuantumJob(data.jobId);
      // Soft-miss: client should not hard-fail — prefer sync start path
      if (!job) return { missing: true };
      return job;
    },
  );
