/**
 * Disk-backed alert cloud for preview (and fallback if PGLite flakes).
 * Path: /workspace/.data/cloud-alerts/<accountKey>.json
 *
 * Why files: same server process + multi-device share one disk;
 * identity is email/name so different better-auth user_ids still meet.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AlertDTO } from "@/lib/user-data/alerts-repo.server";

const DIR =
  (typeof process !== "undefined" && process.env.CLOUD_ALERTS_DIR?.trim()) ||
  "/workspace/.data/cloud-alerts";

function ensureDir() {
  try {
    mkdirSync(DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function safeFileName(key: string): string {
  return key.replace(/[^a-zA-Z0-9@._+\-:]/g, "_").slice(0, 180);
}

function pathFor(key: string): string {
  return join(DIR, `${safeFileName(key)}.json`);
}

export type CloudBlob = {
  accountKey: string;
  userIds: string[];
  alerts: AlertDTO[];
  updatedAt: number;
};

export function readCloudBlob(accountKey: string): CloudBlob | null {
  ensureDir();
  const p = pathFor(accountKey);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8");
    const j = JSON.parse(raw) as CloudBlob;
    if (!j || !Array.isArray(j.alerts)) return null;
    return j;
  } catch {
    return null;
  }
}

export function writeCloudBlob(
  accountKey: string,
  alerts: AlertDTO[],
  userId: string,
  prev?: CloudBlob | null,
): CloudBlob {
  ensureDir();
  const userIds = new Set(prev?.userIds ?? []);
  userIds.add(userId);
  const blob: CloudBlob = {
    accountKey,
    userIds: [...userIds],
    alerts,
    updatedAt: Date.now(),
  };
  writeFileSync(pathFor(accountKey), JSON.stringify(blob), "utf8");
  // also mirror under each known user id for reverse lookup
  for (const uid of userIds) {
    if (`u:${uid}` === accountKey) continue;
    try {
      writeFileSync(
        pathFor(`u:${uid}`),
        JSON.stringify({ ...blob, accountKey: `u:${uid}` }),
        "utf8",
      );
    } catch {
      /* ignore */
    }
  }
  return blob;
}

/** Merge alerts from several identity keys (email + name + user id). */
export function loadMergedFromFiles(keys: string[]): AlertDTO[] {
  const byId = new Map<string, AlertDTO>();
  for (const k of keys) {
    const blob = readCloudBlob(k);
    if (!blob) continue;
    for (const a of blob.alerts) {
      const prev = byId.get(a.id);
      if (!prev) {
        byId.set(a.id, a);
        continue;
      }
      // prefer more recently hit / newer created
      const score = (x: AlertDTO) =>
        Math.max(x.hitAt ?? 0, x.liveAt ?? 0, x.createdAt ?? 0);
      byId.set(a.id, score(a) >= score(prev) ? a : prev);
    }
  }
  return [...byId.values()].sort(
    (a, b) => (b.hitAt ?? b.createdAt) - (a.hitAt ?? a.createdAt),
  );
}
