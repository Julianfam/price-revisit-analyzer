import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Loader2,
  Mail,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  getBearerToken,
  signIn,
  authClient,
  captureSessionBearer,
  finishMobileAuthReturn,
  isMobileClient,
  authEnabled,
  watchAuthHandoff,
  buildMobileOAuthStartUrl,
} from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function parseCode(raw: unknown): string | undefined {
  if (raw == null || raw === "") return undefined;
  const digits = String(raw).replace(/\D/g, "").slice(0, 6);
  return digits.length > 0 ? digits : undefined;
}

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): {
    auth_done?: string;
    auth_error?: string;
    returnTo?: string;
    code?: string;
  } => {
    // Query params may arrive as number (e.g. ?code=735082)
    const code = parseCode(s.code);
    let authError: string | undefined;
    if (s.auth_error != null && s.auth_error !== "") {
      authError = String(s.auth_error).slice(0, 200);
    }
    return {
      ...(s.auth_done === "1" || s.auth_done === 1 ? { auth_done: "1" } : {}),
      ...(authError ? { auth_error: authError } : {}),
      ...(typeof s.returnTo === "string" && s.returnTo.startsWith("/")
        ? { returnTo: s.returnTo }
        : {}),
      ...(code ? { code } : {}),
    };
  },
  component: LoginPage,
});

function LoginPage() {
  return (
    <I18nProvider>
      <LoginInner />
    </I18nProvider>
  );
}

function storeToken(token: string) {
  try {
    sessionStorage.setItem("grok-auth.bearer-token", token);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem("grok-auth.bearer-token", token);
  } catch {
    /* ignore */
  }
}

async function claimCode(code: string): Promise<string> {
  const clean = String(code ?? "").replace(/\D/g, "").slice(0, 6);
  if (clean.length !== 6) throw new Error("code_length");
  const res = await fetch("/api/oauth/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ code: clean }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.token) {
    throw new Error(data.message || data.error || "claim_failed");
  }
  return data.token;
}

function LoginInner() {
  const { lang } = useI18n();
  const es = lang === "es";
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { user, isPending } = useCurrentUserState();

  const [mounted, setMounted] = useState(false);
  const [mobile, setMobile] = useState(false);

  const [mailOpen, setMailOpen] = useState(false);
  const [mailMode, setMailMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busyMail, setBusyMail] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [waitingHandoff, setWaitingHandoff] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [busyCode, setBusyCode] = useState(false);

  // Always a string — never call .replace on non-string
  const codeDigits = String(codeInput ?? "").replace(/\D/g, "").slice(0, 6);

  useEffect(() => {
    setMounted(true);
    setMobile(isMobileClient());
    if (search.code) {
      setCodeOpen(true);
      setCodeInput(String(search.code).replace(/\D/g, "").slice(0, 6));
    }
  }, [search.code]);

  useEffect(() => {
    if (search.auth_error) {
      const raw = String(search.auth_error);
      setError(
        raw === "1"
          ? es
            ? "Login cancelado o fallido"
            : "Sign-in cancelled or failed"
          : raw === "no_session"
            ? es
              ? "No quedó sesión aquí. Si X abrió su navegador, pega el código de 6 dígitos abajo."
              : "No session here. If X opened its browser, paste the 6-digit code below."
            : raw,
      );
      setCodeOpen(true);
    }
  }, [search.auth_error, es]);

  // Auto-claim ?code=
  useEffect(() => {
    if (!mounted || !search.code) return;
    let cancelled = false;
    setFinishing(true);
    void (async () => {
      try {
        const token = await claimCode(String(search.code));
        if (cancelled) return;
        storeToken(token);
        await captureSessionBearer();
        try {
          await authClient.getSession();
        } catch {
          /* ignore */
        }
        window.location.replace(search.returnTo || "/");
      } catch {
        if (cancelled) return;
        setFinishing(false);
        setCodeOpen(true);
        setError(
          es
            ? "Código inválido o expirado. Inicia con X de nuevo y copia el código nuevo."
            : "Invalid or expired code. Sign in with X again and copy the new code.",
        );
        void navigate({ to: "/login", search: {}, replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, search.code, search.returnTo, es, navigate]);

  useEffect(() => {
    if (!mounted || search.auth_done !== "1") return;
    let cancelled = false;
    setFinishing(true);
    void (async () => {
      const ok = await finishMobileAuthReturn(search.returnTo ?? "/");
      if (cancelled) return;
      if (!ok) {
        setFinishing(false);
        setCodeOpen(true);
        setError(
          es
            ? "Sesión no encontrada aquí. Pega el código de 6 dígitos si lo viste al terminar en X."
            : "Session not found here. Paste the 6-digit code if you saw it after X.",
        );
        void navigate({ to: "/login", search: {}, replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, search.auth_done, search.returnTo, es, navigate]);

  useEffect(() => {
    if (!mounted || user) return;
    return watchAuthHandoff((token) => {
      storeToken(token);
      setWaitingHandoff(true);
      void (async () => {
        await captureSessionBearer();
        try {
          await authClient.getSession();
        } catch {
          /* ignore */
        }
        window.location.assign("/");
      })();
    });
  }, [mounted, user]);

  useEffect(() => {
    if (!mounted || !getBearerToken()) return;
    void authClient.getSession().catch(() => undefined);
  }, [mounted]);

  if (waitingHandoff || finishing) {
    return (
      <div className="app-shell flex min-h-dvh flex-col items-center justify-center px-4">
        <Loader2 className="size-8 animate-spin text-teal" />
        <p className="mt-3 text-sm text-muted-fg">
          {es ? "Completando inicio de sesión…" : "Finishing sign-in…"}
        </p>
      </div>
    );
  }

  if (!isPending && user && !search.code && search.auth_done !== "1") {
    return <Navigate to="/" />;
  }

  const onOauth = (providerId: string) => {
    setError(null);
    setOauthBusy(providerId);
    if (mobile || isMobileClient()) {
      try {
        const url = buildMobileOAuthStartUrl(providerId, "/");
        window.location.assign(url);
      } catch (e) {
        setOauthBusy(null);
        setError(e instanceof Error ? e.message : "oauth_failed");
      }
      return;
    }
    void signIn(providerId, { callbackURL: "/" })
      .catch((e) => {
        setError(
          e instanceof Error
            ? e.message
            : es
              ? "No se pudo iniciar sesión"
              : "Could not sign in",
        );
      })
      .finally(() => setOauthBusy(null));
  };

  const onClaimCode = async () => {
    setError(null);
    setBusyCode(true);
    try {
      const token = await claimCode(codeDigits);
      storeToken(token);
      await captureSessionBearer();
      try {
        await authClient.getSession();
      } catch {
        /* ignore */
      }
      window.location.replace(search.returnTo || "/");
    } catch {
      setError(
        es
          ? "Código inválido o expirado. Vuelve a iniciar con X y copia el código nuevo."
          : "Invalid or expired code. Tap Continue with X again and copy the new code.",
      );
    } finally {
      setBusyCode(false);
    }
  };

  const onMail = async () => {
    if (!email.trim() || password.length < 6) {
      setError(
        es
          ? "Email y contraseña (mín. 6) requeridos"
          : "Email and password (min 6) required",
      );
      return;
    }
    setBusyMail(true);
    setError(null);
    try {
      if (mailMode === "up") {
        const { error: err } = await authClient.signUp.email({
          email: email.trim(),
          password,
          name: email.trim().split("@")[0] || "User",
        });
        if (err) {
          // try sign-in if already exists
          const { error: e2 } = await authClient.signIn.email({
            email: email.trim(),
            password,
          });
          if (e2) throw new Error(e2.message || "sign_up_failed");
        }
      } else {
        const { error: err } = await authClient.signIn.email({
          email: email.trim(),
          password,
        });
        if (err) throw new Error(err.message || "sign_in_failed");
      }
      await captureSessionBearer();
      try {
        await authClient.getSession();
      } catch {
        /* ignore */
      }
      window.location.assign(search.returnTo || "/");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : es
            ? "No se pudo entrar con email"
            : "Email sign-in failed",
      );
    } finally {
      setBusyMail(false);
    }
  };

  if (!authEnabled) {
    return (
      <div className="app-shell flex min-h-dvh items-center justify-center p-4">
        <p className="text-sm text-muted-fg">Auth disabled</p>
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl border border-teal/30 bg-teal/10 text-teal">
            <Activity className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Price Revisit Analyzer
          </h1>
          <p className="mt-1 text-sm text-muted-fg">
            {es ? "Entra en un toque" : "Sign in in one tap"}
          </p>
        </div>

        {(mobile || (mounted && isMobileClient())) && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-100">
            {es
              ? "Móvil / Brave: X o Google suelen abrir su propio navegador. Al terminar verás un código de 6 dígitos. Vuelve aquí → Tengo un código → pégalo."
              : "Mobile / Brave: X often opens its own browser. When done you get a 6-digit code. Come back here, tap I have a code, and paste it."}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-bear/35 bg-bear/10 px-3 py-2 text-[12px] text-bear">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            className="w-full min-h-12 gap-2 border-zinc-200 bg-zinc-100 font-semibold text-zinc-950 hover:bg-white hover:text-zinc-950"
            onClick={() => onOauth("grok-x")}
            disabled={!!oauthBusy}
          >
            {oauthBusy === "grok-x" ? (
              <Loader2 className="size-4 animate-spin text-zinc-950" />
            ) : (
              <span className="text-lg font-black leading-none text-zinc-950">
                X
              </span>
            )}
            <span className="text-zinc-950">
              {es ? "Continuar con X" : "Continue with X"}
            </span>
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full min-h-12 gap-2 border-border bg-card font-semibold text-foreground"
            onClick={() => onOauth("grok-google")}
            disabled={!!oauthBusy}
          >
            {oauthBusy === "grok-google" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <span className="text-sm font-bold text-[#4285F4]">G</span>
            )}
            {es ? "Continuar con Google" : "Continue with Google"}
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setCodeOpen((v) => !v)}
          className={cn(
            "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition-colors",
            codeOpen
              ? "border-teal/40 bg-teal/10 text-foreground"
              : "border-border bg-card text-muted-fg hover:border-teal/30",
          )}
        >
          <span className="flex items-center gap-2 font-medium text-foreground">
            <KeyRound className="size-4 text-teal" />
            {es ? "Tengo un código" : "I have a code"}
          </span>
          {codeOpen ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>

        {codeOpen && (
          <div className="space-y-2 rounded-xl border border-teal/30 bg-card p-3">
            <p className="text-[11px] leading-relaxed text-muted-fg">
              {es
                ? "Pega el código de 6 dígitos de la pantalla “Sesión lista” (válido ~10 min)."
                : "Paste the 6-digit code from the “Signed in” screen (~10 min)."}
            </p>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={codeDigits}
              onChange={(e) =>
                setCodeInput(
                  String(e.target.value ?? "")
                    .replace(/\D/g, "")
                    .slice(0, 6),
                )
              }
              className="h-12 text-center font-mono text-xl tracking-[0.35em]"
              maxLength={6}
            />
            <Button
              type="button"
              className="w-full min-h-11"
              disabled={busyCode || codeDigits.length !== 6}
              onClick={() => void onClaimCode()}
            >
              {busyCode ? (
                <Loader2 className="size-4 animate-spin" />
              ) : es ? (
                "Entrar con código"
              ) : (
                "Sign in with code"
              )}
            </Button>
          </div>
        )}

        <div className="relative py-1 text-center">
          <span className="relative z-10 bg-bg px-2 text-[11px] uppercase tracking-wide text-muted-fg">
            {es ? "o" : "or"}
          </span>
          <span className="absolute left-0 right-0 top-1/2 h-px bg-border" />
        </div>

        <button
          type="button"
          onClick={() => setMailOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-3 text-left text-sm text-muted-fg"
        >
          <span className="flex items-center gap-2 text-foreground">
            <Mail className="size-4" />
            {es ? "Email y contraseña" : "Email & password"}
          </span>
          {mailOpen ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>

        {mailOpen && (
          <div className="space-y-2 rounded-xl border border-border bg-card p-3">
            <div className="flex gap-1 rounded-lg bg-muted/40 p-0.5">
              <button
                type="button"
                className={cn(
                  "flex-1 rounded-md py-1.5 text-xs font-medium",
                  mailMode === "in"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-fg",
                )}
                onClick={() => setMailMode("in")}
              >
                {es ? "Entrar" : "Sign in"}
              </button>
              <button
                type="button"
                className={cn(
                  "flex-1 rounded-md py-1.5 text-xs font-medium",
                  mailMode === "up"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-fg",
                )}
                onClick={() => setMailMode("up")}
              >
                {es ? "Crear cuenta" : "Sign up"}
              </button>
            </div>
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
            />
            <Input
              type="password"
              autoComplete={
                mailMode === "up" ? "new-password" : "current-password"
              }
              placeholder={es ? "Contraseña" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
            />
            <Button
              type="button"
              className="w-full min-h-11"
              disabled={busyMail}
              onClick={() => void onMail()}
            >
              {busyMail ? (
                <Loader2 className="size-4 animate-spin" />
              ) : mailMode === "up" ? (
                es ? (
                  "Crear e entrar"
                ) : (
                  "Create & sign in"
                )
              ) : es ? (
                "Entrar"
              ) : (
                "Sign in"
              )}
            </Button>
          </div>
        )}

        <p className="pt-2 text-center text-[11px] text-muted-fg">
          <a href="/" className="text-teal underline-offset-2 hover:underline">
            {es ? "Continuar como invitado" : "Continue as guest"}
          </a>
        </p>
      </div>
    </div>
  );
}
