/**
 * Sign-in providers — display order is product order:
 * 1) X  2) Google  (email/password is separate, last on the login screen)
 */
export type GrokProvider = {
  providerId: string;
  idp: string;
  label: string;
};

/** Ordered: X first, then Google. */
export const GROK_PROVIDERS: readonly GrokProvider[] = [
  { providerId: "grok-x", idp: "twitter", label: "X" },
  { providerId: "grok-google", idp: "google", label: "Google" },
];
