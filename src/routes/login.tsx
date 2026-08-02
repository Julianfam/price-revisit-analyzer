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

type AuthStatus = {
  x: { mode: string; available: boolean };
  google: { mode: string; available: boolean };
  durableDb: boolean;
  setup: {
    needDatabase: boolean;
    needTwitterKeys: boolean;
    twitterCallback: string | null;
  };
};

function parseCode(raw: unknown): string | undefined {
  if (raw == null || raw === "") return undefined;
  const digits = String(raw).replace(/\D/g, "").slice(0, 6);
  return digits.length > 0 ? digits : undefined;
}

function friendlyAuthError(raw: string, es: boolean): string {
  const s = raw.toLowerCase();
  if (
    /need_twitter|invalid_redirect|invalid redirect|need_google|oauth_unavailable/i.test(
      s,
    )
  ) {
    return es
      ? "X en Vercel necesita tu propia app de X (Client ID/Secret). Mientras, entra con email."
      : "X on Vercel needs your own X app (Client ID/Secret). For now, sign in with email.";
  }
  if (/too_many|rate.?limit|429|too many/i.test(s)) {
    return es
      ? "Demasiados intentos. Espera ~1 minuto y prueba de nuevo."
      : "Too many attempts. Wait about 1 minute and try again.";
  }
  if (/invalid origin|invalid_callback|forbidden/i.test(s)) {
    return es
      ? "Error de configuración de login. Recarga e intenta otra vez, o usa email."
      : "Login config error. Reload and try again, or use email.";
  }
  if (/oauth|missing_url|oauth_init|oauth_threw/i.test(s)) {
    return es
      ? "No se pudo conectar con X/Google. Usa email mientras configuramos OAuth nativo."
      : "Could not connect to X/Google. Use email until native OAuth is configured.";
  }
  return raw.slice(0, 160);
}

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): {
    auth_done?: string;
    auth_error?: string;
    returnTo?: string;
    code?: string;
    mail?: string;
  } => {
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
      ...(s.mail === "1" || s.mail === 1 ? { mail: "1" } : {}),
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
  const [status, setStatus] = useState<AuthStatus | null>(null);

  const [mailOpen, setMailOpen] = useState(false);
  const [mailMode, setMailMode] = useState<"in" | "up">("up");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busyMail, setBusyMail] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [waitingHandoff, setWaitingHandoff] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeDigits, setCodeDigits] = useState("");
  const [busyCode, setBusyCode] = useState(false);

  useEffect(() => {
    setMounted(true);
    setMobile(isMobileClient());
    void fetch("/api/auth/status", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j: AuthStatus) => {
        setStatus(j);
        // Auto-open email when X is not available on this host
        if (!j.x?.available || j.setup?.needTwitterKeys || search.mail === "1") {
          setMailOpen(true);
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, [search.mail]);

  useEffect(() => {
    if (search.auth_error) {
      setError(friendlyAuthError(search.auth_error, es));
      setMailOpen(true);
    }
  }, [search.auth_error, es]);

  useEffect(() => {
    if (search.code) {
      setCodeOpen(true);
      setCodeDigits(search.code);
    }
  }, [search.code]);

  useEffect(() => {
    if (search.auth_done === "1") {
      setFinishing(true);
      void finishMobileAuthReturn(search.returnTo || "/").finally(() =>
        setFinishing(false),
      );
    }
  }, [search.auth_done, search.returnTo]);

  useEffect(() => {
    return watchAuthHandoff((token) => {
      storeToken(token);
      setWaitingHandoff(true);
      void (async () => {
        await captureSessionBearer();
        window.location.replace(search.returnTo || "/");
      })();
    });
  }, [search.returnTo]);

  if (!mounted) {
    return (
      <div className="app-shell flex min-h-dvh items-center justify-center p-4">
        <Loader2 className="size-6 animate-spin text-teal" />
      </div>
    );
  }

  if (finishing || waitingHandoff) {
    return (
      <div className="app-shell flex min-h-dvh flex-col items-center justify-center gap-3 p-4">
        <Loader2 className="size-8 animate-spin text-teal" />
        <p className="text-sm text-muted-fg">
          {es ? "Completando sesión…" : "Completing sign-in…"}
        </p>
      </div>
    );
  }

  if (!isPending && user && !search.code && search.auth_done !== "1") {
    return <Navigate to="/" />;
  }

  const xAvailable = status?.x?.available !== false;
  const googleAvailable = status?.google?.available !== false;
  // While status loads, allow clicks (start route will redirect cleanly)
  const xReady = status == null || xAvailable;
  const googleReady = status == null || googleAvailable;

  const onOauth = (providerId: string) => {
    setError(null);
    if (providerId === "grok-x" && status && !status.x.available) {
      setError(friendlyAuthError("need_twitter_keys", es));
      setMailOpen(true);
      return;
    }
    if (providerId === "grok-google" && status && !status.google.available) {
      setError(friendlyAuthError("need_google_keys", es));
      setMailOpen(true);
      return;
    }
    setOauthBusy(providerId);
    try {
      const url = buildMobileOAuthStartUrl(providerId, search.returnTo || "/");
      window.location.assign(url);
    } catch (e) {
      setOauthBusy(null);
      setError(
        e instanceof Error
          ? friendlyAuthError(e.message, es)
          : es
            ? "No se pudo iniciar sesión"
            : "Could not sign in",
      );
    }
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
          ? friendlyAuthError(e.message, es)
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

        {status?.setup?.needTwitterKeys && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-50">
            <p className="font-semibold text-amber-100">
              {es
                ? "X en Vercel requiere tu app de X"
                : "X on Vercel needs your X developer app"}
            </p>
            <p className="mt-1 text-amber-100/90">
              {es
                ? "El login vía Grok solo funciona en el preview. En producción hay que poner TWITTER_CLIENT_ID y TWITTER_CLIENT_SECRET en Vercel. Mientras tanto usa email."
                : "Grok broker login only works in the live preview. Production needs TWITTER_CLIENT_ID + TWITTER_CLIENT_SECRET in Vercel. Use email for now."}
            </p>
            {status.setup.twitterCallback && (
              <p className="mt-2 break-all font-mono text-[10px] text-amber-100/80">
                Callback: {status.setup.twitterCallback}
              </p>
            )}
          </div>
        )}

        {(mobile || (mounted && isMobileClient())) && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-100">
            {es
              ? "Móvil / Brave: si X abre su navegador, usa el código de 6 dígitos o entra con email."
              : "Mobile / Brave: if X opens its own browser, use the 6-digit code or sign in with email."}
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
            className="w-full min-h-12 gap-2 border-zinc-200 bg-zinc-100 font-semibold text-zinc-950 hover:bg-white hover:text-zinc-950 disabled:opacity-60"
            onClick={() => onOauth("grok-x")}
            disabled={!!oauthBusy || !xReady}
          >
            {oauthBusy === "grok-x" ? (
              <Loader2 className="size-4 animate-spin text-zinc-950" />
            ) : (
              <span className="text-lg font-black leading-none text-zinc-950">
                X
              </span>
            )}
            <span className="text-zinc-950">
              {!xReady
                ? es
                  ? "X (configurar en Vercel)"
                  : "X (setup in Vercel)"
                : es
                  ? "Continuar con X"
                  : "Continue with X"}
            </span>
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full min-h-12 gap-2 border-border bg-card font-semibold text-foreground disabled:opacity-60"
            onClick={() => onOauth("grok-google")}
            disabled={!!oauthBusy || !googleReady}
          >
            {oauthBusy === "grok-google" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <span className="text-sm font-bold text-[#4285F4]">G</span>
            )}
            {!googleReady
              ? es
                ? "Google (configurar en Vercel)"
                : "Google (setup in Vercel)"
              : es
                ? "Continuar con Google"
                : "Continue with Google"}
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
          <div className="space-y-2 rounded-xl border border-border bg-card p-3">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={es ? "Código de 6 dígitos" : "6-digit code"}
              value={codeDigits}
              onChange={(e) =>
                setCodeDigits(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="text-center font-mono text-lg tracking-widest"
            />
            <Button
              type="button"
              className="w-full"
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

        <button
          type="button"
          onClick={() => setMailOpen((v) => !v)}
          className={cn(
            "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition-colors",
            mailOpen
              ? "border-teal/40 bg-teal/10 text-foreground"
              : "border-border bg-card text-muted-fg hover:border-teal/30",
          )}
        >
          <span className="flex items-center gap-2 font-medium text-foreground">
            <Mail className="size-4 text-teal" />
            {es ? "Email y contraseña (recomendado ahora)" : "Email & password (recommended now)"}
          </span>
          {mailOpen ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>

        {mailOpen && (
          <div className="space-y-2 rounded-xl border border-teal/30 bg-card p-3">
            <div className="flex gap-2 text-[11px]">
              <button
                type="button"
                className={cn(
                  "rounded-md px-2 py-1",
                  mailMode === "in" ? "bg-teal/20 text-teal" : "text-muted-fg",
                )}
                onClick={() => setMailMode("in")}
              >
                {es ? "Entrar" : "Sign in"}
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2 py-1",
                  mailMode === "up" ? "bg-teal/20 text-teal" : "text-muted-fg",
                )}
                onClick={() => setMailMode("up")}
              >
                {es ? "Crear cuenta" : "Sign up"}
              </button>
            </div>
            <Input
              type="email"
              autoComplete="email"
              placeholder="email@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              type="password"
              autoComplete={
                mailMode === "up" ? "new-password" : "current-password"
              }
              placeholder={es ? "Contraseña (mín. 6)" : "Password (min 6)"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              type="button"
              className="w-full"
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
            {status?.setup?.needDatabase && (
              <p className="text-[11px] text-amber-200/90">
                {es
                  ? "Aviso: sin DATABASE_URL en Vercel la sesión puede no persistir. Añade un Postgres (Neon) en variables de entorno."
                  : "Note: without DATABASE_URL on Vercel the session may not persist. Add Postgres (Neon) env vars."}
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          className="w-full text-center text-[12px] text-muted-fg underline-offset-2 hover:underline"
          onClick={() => navigate({ to: "/" })}
        >
          {es ? "Continuar como invitado" : "Continue as guest"}
        </button>
      </div>
    </div>
  );
}
