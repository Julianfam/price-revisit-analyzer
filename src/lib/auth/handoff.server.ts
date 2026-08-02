/**
 * Cross-browser OAuth handoff (X/Twitter in-app browser → Brave/Chrome).
 * Stores a short code + session token for a few minutes on globalThis.
 */
import { randomInt } from "node:crypto";

export type HandoffEntry = {
  token: string;
  userLabel: string;
  createdAt: number;
  expiresAt: number;
};

const g = globalThis as typeof globalThis & {
  __grokAuthHandoff__?: Map<string, HandoffEntry>;
};

function store(): Map<string, HandoffEntry> {
  g.__grokAuthHandoff__ ??= new Map();
  return g.__grokAuthHandoff__;
}

function purge(): void {
  const now = Date.now();
  for (const [k, v] of store()) {
    if (v.expiresAt <= now) store().delete(k);
  }
}

/** Create a 6-digit code bound to a session token. Valid 10 minutes. */
export function createHandoff(
  token: string,
  userLabel = "",
): { code: string; expiresAt: number } {
  purge();
  let code = "";
  for (let i = 0; i < 12; i++) {
    code = String(randomInt(100000, 999999));
    if (!store().has(code)) break;
  }
  const expiresAt = Date.now() + 10 * 60_000;
  store().set(code, {
    token,
    userLabel: userLabel.slice(0, 80),
    createdAt: Date.now(),
    expiresAt,
  });
  return { code, expiresAt };
}

/** One-time claim. Returns token or null. */
export function claimHandoff(code: string): HandoffEntry | null {
  purge();
  const clean = code.replace(/\D/g, "").slice(0, 6);
  if (clean.length !== 6) return null;
  const entry = store().get(clean);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store().delete(clean);
    return null;
  }
  // One-time use
  store().delete(clean);
  return entry;
}

export function peekHandoff(code: string): boolean {
  purge();
  const clean = code.replace(/\D/g, "").slice(0, 6);
  const entry = store().get(clean);
  return Boolean(entry && entry.expiresAt > Date.now());
}
