/**
 * Local file backup for alerts + light app state.
 *
 * Closing the browser does NOT wipe localStorage — data already survives.
 * This module is for:
 *  - Download a real .json file (USB, Drive, another PC)
 *  - Restore after clearing site data / new browser / reinstall
 *  - Optional IndexedDB mirror (extra durability vs aggressive mobile cleaners)
 */
import {
  normalizeAlert,
  usePriceAlerts,
  type PriceAlert,
} from "@/lib/price-alerts";

export const BACKUP_FORMAT = "price-revisit-analyzer-backup" as const;
export const BACKUP_VERSION = 1;
const LAST_EXPORT_KEY = "pra-backup-last-export-at";
const IDB_NAME = "pra-local-backup";
const IDB_STORE = "snapshots";

export type LocalBackup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  app: "price-revisit-analyzer";
  alerts: PriceAlert[];
  meta?: {
    note?: string;
    userAgent?: string;
  };
};

function waitForAlertsHydrated(): Promise<void> {
  const persistApi = usePriceAlerts.persist;
  if (persistApi.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = persistApi.onFinishHydration(() => {
      unsub();
      resolve();
    });
    setTimeout(() => resolve(), 2000);
  });
}

export function buildBackup(alerts?: PriceAlert[]): LocalBackup {
  const list =
    alerts ??
    (typeof window !== "undefined"
      ? usePriceAlerts.getState().alerts
      : []);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    app: "price-revisit-analyzer",
    alerts: list.map(normalizeAlert),
    meta: {
      userAgent:
        typeof navigator !== "undefined"
          ? navigator.userAgent.slice(0, 180)
          : undefined,
    },
  };
}

export function parseBackup(raw: unknown): LocalBackup {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid_backup");
  }
  const o = raw as Record<string, unknown>;
  let alertsRaw: unknown = o.alerts;
  if (!Array.isArray(alertsRaw) && Array.isArray(raw)) {
    alertsRaw = raw;
  }
  if (!Array.isArray(alertsRaw)) {
    throw new Error("missing_alerts");
  }
  const alerts = alertsRaw
    .map((a) => {
      try {
        return normalizeAlert(a as PriceAlert);
      } catch {
        return null;
      }
    })
    .filter((a): a is PriceAlert => !!a && Number.isFinite(a.targetPrice));

  return {
    format: BACKUP_FORMAT,
    version: typeof o.version === "number" ? o.version : 1,
    exportedAt:
      typeof o.exportedAt === "number" ? o.exportedAt : Date.now(),
    app: "price-revisit-analyzer",
    alerts,
    meta:
      typeof o.meta === "object" && o.meta
        ? (o.meta as LocalBackup["meta"])
        : undefined,
  };
}

export function downloadBackup(backup?: LocalBackup): void {
  if (typeof document === "undefined") return;
  const data = backup ?? buildBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const day = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `pra-alerts-backup-${day}.json`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  try {
    localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  void mirrorToIdb(data).catch(() => {});
}

export function getLastExportAt(): number | null {
  try {
    const v = localStorage.getItem(LAST_EXPORT_KEY);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function readBackupFile(file: File): Promise<LocalBackup> {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("bad_json");
  }
  return parseBackup(json);
}

export type RestoreMode = "merge" | "replace";

export function applyBackup(
  backup: LocalBackup,
  mode: RestoreMode = "merge",
): number {
  const incoming = backup.alerts.map(normalizeAlert);
  if (mode === "replace") {
    usePriceAlerts.getState().replaceAll(incoming);
    void mirrorToIdb(buildBackup(incoming)).catch(() => {});
    return incoming.length;
  }
  const local = usePriceAlerts.getState().alerts;
  const byId = new Map<string, PriceAlert>();
  for (const a of local) byId.set(a.id, a);
  for (const a of incoming) {
    const prev = byId.get(a.id);
    if (!prev) {
      byId.set(a.id, a);
      continue;
    }
    const prevT = Math.max(
      prev.hitAt ?? 0,
      prev.abandonedAt ?? 0,
      prev.liveAt ?? 0,
      prev.createdAt,
    );
    const nextT = Math.max(
      a.hitAt ?? 0,
      a.abandonedAt ?? 0,
      a.liveAt ?? 0,
      a.createdAt,
    );
    byId.set(a.id, nextT >= prevT ? { ...prev, ...a } : { ...a, ...prev });
  }
  const byKey = new Map<string, PriceAlert>();
  for (const a of byId.values()) {
    const k = `${a.symbol}|${a.targetPrice}|${a.tick}`;
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, a);
      continue;
    }
    const prefer =
      Math.max(a.hitAt ?? 0, a.createdAt) >=
      Math.max(prev.hitAt ?? 0, prev.createdAt)
        ? a
        : prev;
    byKey.set(k, { ...prev, ...prefer });
  }
  const merged = [...byKey.values()].slice(0, 120);
  usePriceAlerts.getState().replaceAll(merged);
  void mirrorToIdb(buildBackup(merged)).catch(() => {});
  return merged.length;
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function mirrorToIdb(backup?: LocalBackup): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  const data = backup ?? buildBackup();
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(data, "latest");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export async function restoreFromIdb(): Promise<LocalBackup | null> {
  const db = await openIdb();
  if (!db) return null;
  const raw = await new Promise<unknown>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get("latest");
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  if (!raw) return null;
  try {
    return parseBackup(raw);
  } catch {
    return null;
  }
}

/** Call once on app boot: if localStorage empty but IDB has data, recover. */
export async function recoverAlertsIfEmpty(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  await waitForAlertsHydrated();
  const current = usePriceAlerts.getState().alerts;
  if (current.length > 0) {
    void mirrorToIdb().catch(() => {});
    return false;
  }
  const snap = await restoreFromIdb();
  if (!snap || snap.alerts.length === 0) return false;
  usePriceAlerts.getState().replaceAll(snap.alerts);
  return true;
}
