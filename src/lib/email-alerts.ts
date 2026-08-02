import { create } from "zustand";
import { persist } from "zustand/middleware";

export type EmailAlertPrefs = {
  email: string;
  enabled: boolean;
  setEmail: (email: string) => void;
  setEnabled: (enabled: boolean) => void;
  subscribe: (email: string) => void;
  unsubscribe: () => void;
};

const emailOk = (e: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) && e.trim().length <= 120;

export function isValidAlertEmail(email: string): boolean {
  return emailOk(email);
}

/** Guest + client cache of email-alert subscription (synced to server when signed in). */
export const useEmailAlertPrefs = create<EmailAlertPrefs>()(
  persist(
    (set) => ({
      email: "",
      enabled: false,
      setEmail: (email) => set({ email: email.trim() }),
      setEnabled: (enabled) => set({ enabled }),
      subscribe: (email) => {
        const e = email.trim();
        if (!emailOk(e)) return;
        set({ email: e, enabled: true });
      },
      unsubscribe: () => set({ enabled: false }),
    }),
    { name: "pra-email-alerts-v1" },
  ),
);
