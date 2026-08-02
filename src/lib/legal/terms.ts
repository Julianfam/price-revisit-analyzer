/** Bump only when legal text changes in a material way (forces re-accept). */
export const TERMS_VERSION = "2026-07-30";
export const TERMS_STORAGE_KEY = "pra-terms-accepted-v1";
/** Lightweight cookie — survives reloads even when storage is flaky. */
export const TERMS_COOKIE = "pra_terms_ok";
/** Extra backup key (boolean flag). */
export const TERMS_FLAG_KEY = "pra_terms_ok_flag";

export type TermsAcceptance = {
  version: string;
  acceptedAt: number;
  lang: "en" | "es";
};

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  try {
    const parts = document.cookie.split(";");
    for (const part of parts) {
      const t = part.trim();
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      if (t.slice(0, eq) === name) {
        return decodeURIComponent(t.slice(eq + 1));
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCookie(name: string, value: string, days = 400): void {
  if (typeof document === "undefined") return;
  try {
    const maxAge = days * 24 * 60 * 60;
    const secure =
      typeof location !== "undefined" && location.protocol === "https:"
        ? "; Secure"
        : "";
    // Lax is enough first-party; also write without Secure on http preview
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

function looksLikeAccepted(raw: string | null): boolean {
  if (!raw) return false;
  const t = raw.trim();
  if (!t) return false;
  // legacy: "1", "true", bare version string
  if (t === "1" || t === "true" || t === TERMS_VERSION) return true;
  try {
    const parsed = JSON.parse(t) as TermsAcceptance | boolean | string | number;
    if (parsed === true || parsed === 1 || parsed === "1") return true;
    if (typeof parsed === "string" && parsed === TERMS_VERSION) return true;
    if (parsed && typeof parsed === "object") {
      const v = (parsed as TermsAcceptance).version;
      if (!v) return true;
      if (v === TERMS_VERSION) return true;
      return true;
    }
  } catch {
    return t.length > 0;
  }
  return false;
}

/** True if this browser already accepted terms (any durable store). */
export function hasAcceptedTerms(): boolean {
  if (typeof window === "undefined") return false;

  try {
    if (readCookie(TERMS_COOKIE) === TERMS_VERSION) return true;
    if (readCookie(TERMS_FLAG_KEY) === "1") return true;
  } catch {
    /* ignore */
  }

  try {
    if (looksLikeAccepted(localStorage.getItem(TERMS_STORAGE_KEY))) {
      // heal cookie
      writeCookie(TERMS_COOKIE, TERMS_VERSION);
      writeCookie(TERMS_FLAG_KEY, "1");
      return true;
    }
    if (localStorage.getItem(TERMS_FLAG_KEY) === "1") {
      writeCookie(TERMS_COOKIE, TERMS_VERSION);
      return true;
    }
  } catch {
    /* ignore */
  }

  try {
    if (looksLikeAccepted(sessionStorage.getItem(TERMS_STORAGE_KEY))) {
      writeCookie(TERMS_COOKIE, TERMS_VERSION);
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

export function loadTermsAcceptance(): TermsAcceptance | null {
  if (!hasAcceptedTerms()) return null;
  try {
    const raw =
      localStorage.getItem(TERMS_STORAGE_KEY) ||
      sessionStorage.getItem(TERMS_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as TermsAcceptance;
        if (parsed && typeof parsed === "object" && parsed.acceptedAt) {
          return { ...parsed, version: TERMS_VERSION };
        }
      } catch {
        /* legacy */
      }
    }
  } catch {
    /* ignore */
  }
  return {
    version: TERMS_VERSION,
    acceptedAt: Date.now(),
    lang: "es",
  };
}

export function saveTermsAcceptance(lang: "en" | "es"): TermsAcceptance {
  const record: TermsAcceptance = {
    version: TERMS_VERSION,
    acceptedAt: Date.now(),
    lang,
  };
  const json = JSON.stringify(record);
  try {
    localStorage.setItem(TERMS_STORAGE_KEY, json);
    localStorage.setItem(TERMS_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(TERMS_STORAGE_KEY, json);
    sessionStorage.setItem(TERMS_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
  writeCookie(TERMS_COOKIE, TERMS_VERSION);
  writeCookie(TERMS_FLAG_KEY, "1");
  return record;
}

export function clearTermsAcceptance(): void {
  try {
    localStorage.removeItem(TERMS_STORAGE_KEY);
    localStorage.removeItem(TERMS_FLAG_KEY);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(TERMS_STORAGE_KEY);
    sessionStorage.removeItem(TERMS_FLAG_KEY);
  } catch {
    /* ignore */
  }
  try {
    document.cookie = `${TERMS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    document.cookie = `${TERMS_FLAG_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

export type TermsSection = {
  title: string;
  body: string[];
};

export function getTermsContent(lang: "en" | "es"): {
  title: string;
  subtitle: string;
  riskHeadline: string;
  sections: TermsSection[];
  checkboxRisk: string;
  checkboxTerms: string;
  checkboxAge: string;
  accept: string;
  decline: string;
  declineNote: string;
  footer: string;
} {
  if (lang === "es") {
    return {
      title: "Términos, riesgo y condiciones de uso",
      subtitle:
        "Price Revisit Analyzer es una herramienta experimental. Debes aceptar una sola vez en este navegador.",
      riskHeadline: "Alto riesgo · puede fallar · no es consejo de inversión",
      sections: [
        {
          title: "1. Naturaleza del servicio",
          body: [
            "La App calcula visitas y retesteos de niveles de precio a partir de datos históricos y genera escenarios con frecuencias empíricas (P%).",
            "Los resultados son estadísticos y retrospectivos: no garantizan lo que ocurrirá después.",
          ],
        },
        {
          title: "2. Riesgo y carácter especulativo",
          body: [
            "Operar en mercados implica riesgo sustancial de pérdida, incluida la pérdida total del capital.",
            "Un P% alto no es promesa de acierto.",
          ],
        },
        {
          title: "3. No es consejo financiero",
          body: [
            "Nada en la App es asesoramiento de inversión ni recomendación de compra/venta.",
          ],
        },
        {
          title: "4–7. Datos, cuentas y responsabilidad",
          body: [
            "Datos de terceros pueden fallar. Free/Trial/Pro pueden cambiar. Usas la App bajo tu propio riesgo.",
          ],
        },
      ],
      checkboxRisk:
        "Entiendo que el trading es especulativo y de alto riesgo, y que las señales pueden fallar.",
      checkboxTerms:
        "He leído y acepto los Términos y condiciones de Price Revisit Analyzer.",
      checkboxAge:
        "Confirmo que tengo al menos 18 años (o mayoría de edad en mi jurisdicción).",
      accept: "Acepto y continuar",
      decline: "No acepto",
      declineNote: "Si no aceptas, no podrás usar la App.",
      footer: `Versión ${TERMS_VERSION} · No es consejo de inversión`,
    };
  }

  return {
    title: "Terms, risk & conditions of use",
    subtitle:
      "Price Revisit Analyzer is an experimental tool. Accept once in this browser to continue.",
    riskHeadline: "High risk · can fail · not investment advice",
    sections: [
      {
        title: "1. Nature of the service",
        body: [
          "The App measures price revisits from historical data and builds empirical scenarios (P%).",
          "Outputs are statistical and backward-looking — not guarantees.",
        ],
      },
      {
        title: "2. Risk & speculative nature",
        body: [
          "Trading involves substantial risk of loss, including total loss of capital.",
          "A high P% is not a promise of success.",
        ],
      },
      {
        title: "3. Not financial advice",
        body: [
          "Nothing here is investment advice or a buy/sell recommendation.",
        ],
      },
      {
        title: "4–7. Data, accounts & liability",
        body: [
          "Third-party data can fail. Free/Trial/Pro may change. You use the App at your own risk.",
        ],
      },
    ],
    checkboxRisk:
      "I understand trading is speculative and high-risk, and that signals can fail.",
    checkboxTerms:
      "I have read and accept the Terms & Conditions of Price Revisit Analyzer.",
    checkboxAge:
      "I confirm I am at least 18 (or the age of majority in my jurisdiction).",
    accept: "I accept and continue",
    decline: "I do not accept",
    declineNote: "If you do not accept, you cannot use the App.",
    footer: `Version ${TERMS_VERSION} · Not investment advice`,
  };
}
