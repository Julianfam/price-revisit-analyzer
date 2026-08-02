/**
 * In-process Quantum job store for live progress (dev + long-lived Node).
 * On multi-instance serverless, prefer a single request; jobs still work
 * when the same isolate handles start + poll.
 */
import type { QuantumRunResult } from "./quantum";

export type QuantumJobPhase = "queued" | "phase1" | "phase2" | "consensus" | "done" | "error";

export type QuantumJobProgress = {
  jobId: string;
  status: QuantumJobPhase;
  phase: 0 | 1 | 2 | 3;
  label: string;
  detail: string;
  current: number;
  total: number;
  pct: number;
  refinedAssets?: string[];
  result?: QuantumRunResult;
  error?: string;
  updatedAt: number;
  createdAt: number;
};

const g = globalThis as typeof globalThis & {
  __quantumJobs__?: Map<string, QuantumJobProgress>;
};

function store(): Map<string, QuantumJobProgress> {
  g.__quantumJobs__ ??= new Map();
  return g.__quantumJobs__;
}

export function newQuantumJobId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createQuantumJob(jobId: string, totalEstimate: number): QuantumJobProgress {
  const job: QuantumJobProgress = {
    jobId,
    status: "queued",
    phase: 0,
    label: "Queued",
    detail: "Starting…",
    current: 0,
    total: Math.max(1, totalEstimate),
    pct: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store().set(jobId, job);
  // prune old jobs (>30 min)
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, j] of store()) {
    if (j.updatedAt < cutoff) store().delete(id);
  }
  return job;
}

export function patchQuantumJob(
  jobId: string,
  patch: Partial<QuantumJobProgress>,
): QuantumJobProgress | null {
  const prev = store().get(jobId);
  if (!prev) return null;
  const next: QuantumJobProgress = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
    pct: Math.min(
      100,
      Math.round(
        ((patch.current ?? prev.current) / Math.max(1, patch.total ?? prev.total)) *
          100,
      ),
    ),
  };
  // keep explicit pct if provided
  if (patch.pct != null) next.pct = patch.pct;
  store().set(jobId, next);
  return next;
}

export function getQuantumJob(jobId: string): QuantumJobProgress | null {
  return store().get(jobId) ?? null;
}
