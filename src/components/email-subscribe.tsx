import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Mail,
  MailCheck,
  MailWarning,
  Send,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import {
  isValidAlertEmail,
  useEmailAlertPrefs,
} from "@/lib/email-alerts";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { usePlan } from "@/lib/billing/use-plan";
import { saveMySettings, sendTestAlertEmail } from "@/lib/user-data/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function maskEmail(email: string | undefined | null): string {
  const e = (email ?? "").trim();
  if (!e || !e.includes("@")) return e || "—";
  return e.replace(/^(.).*(@.*)$/, "$1***$2");
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "unknown";
  }
}

type TestPreview = {
  subject: string;
  body: string;
  delivered: boolean;
  masked: string;
  mailConfigured: boolean;
  providerDetail: string | null;
};

/** Compact email subscription + honest delivery status. */
export function EmailSubscribe({ className }: { className?: string }) {
  const { t, lang } = useI18n();
  const { user, isPending } = useCurrentUserState();
  const email = useEmailAlertPrefs((s) => s.email) ?? "";
  const enabled = !!useEmailAlertPrefs((s) => s.enabled);
  const subscribe = useEmailAlertPrefs((s) => s.subscribe);
  const unsubscribe = useEmailAlertPrefs((s) => s.unsubscribe);
  const [draft, setDraft] = useState(email);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [preview, setPreview] = useState<TestPreview | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const signedIn = mounted && !!user && !user.isDevFallback;
  const plan = usePlan();
  const premium = plan.entitlements.canUseEmailAlerts;
  const es = lang === "es";

  useEffect(() => {
    setDraft(email);
  }, [email]);

  const onSubscribe = async () => {
    if (!signedIn) {
      toast.message(t.emailNeedSignIn ?? "Sign in required");
      return;
    }
    const e = draft.trim();
    if (!isValidAlertEmail(e)) {
      toast.error(t.emailInvalid ?? "Invalid email");
      return;
    }
    setBusy(true);
    try {
      subscribe(e);
      const res = (await saveMySettings({
        data: {
          lang,
          alertEmail: e,
          emailAlertsEnabled: true,
        },
      })) as { ok?: boolean; alertEmail?: string | null };

      if (res.alertEmail) subscribe(res.alertEmail);
      toast.success(t.emailSubscribed ?? "Subscribed", {
        description: maskEmail(res.alertEmail ?? e),
      });
      await runTest(true);
    } catch (err) {
      const msg = errMessage(err);
      if (/unauthor/i.test(msg)) {
        toast.error(
          es
            ? "Sesión expirada — vuelve a iniciar sesión"
            : "Session expired — sign in again",
        );
      } else if (/invalid email/i.test(msg)) {
        toast.error(t.emailInvalid ?? "Invalid email");
        unsubscribe();
      } else {
        toast.error(t.emailSaveError ?? "Could not save", {
          description: msg.slice(0, 120),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (silentSave = false) => {
    if (!signedIn) {
      toast.message(t.emailNeedSignIn ?? "Sign in required");
      return;
    }
    setTesting(true);
    try {
      // Refresh session so bearer / cookie is warm before server fn
      try {
        const { authClient } = await import("@/lib/auth/client");
        await authClient.getSession();
      } catch {
        /* continue — middleware still sends stored bearer */
      }
      if (draft.trim() && isValidAlertEmail(draft.trim())) {
        try {
          await saveMySettings({
            data: {
              lang,
              alertEmail: draft.trim(),
              emailAlertsEnabled: true,
            },
          });
          subscribe(draft.trim());
        } catch {
          /* may already be saved */
        }
      }

      const res = (await sendTestAlertEmail({
        data: { lang },
      })) as {
        ok?: boolean;
        reason?: string;
        message?: string;
        delivered?: boolean;
        subject?: string;
        body?: string;
        masked?: string;
        mailConfigured?: boolean;
        providerDetail?: string | null;
      };

      if (!res.ok) {
        toast.error(res.message ?? t.emailTestFail ?? "Test failed");
        return;
      }

      setPreview({
        subject: res.subject ?? "",
        body: res.body ?? "",
        delivered: !!res.delivered,
        masked: res.masked ?? maskEmail(email),
        mailConfigured: !!res.mailConfigured,
        providerDetail: res.providerDetail ?? null,
      });

      if (res.delivered) {
        toast.success(
          es
            ? "Correo enviado a tu bandeja (revisa spam)"
            : "Email sent to your inbox (check spam)",
          { description: res.masked, duration: 6000 },
        );
      } else {
        toast.warning(
          es
            ? "No salió de la app: falta proveedor de correo"
            : "Did not leave the app: mail provider missing",
          {
            description: es
              ? "Configura RESEND_API_KEY en el servidor para Gmail/Outlook"
              : "Set RESEND_API_KEY on the server for Gmail/Outlook delivery",
            duration: 8000,
          },
        );
      }

      try {
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          new Notification(res.subject ?? "Test", {
            body: (res.body ?? "").slice(0, 180),
          });
        }
      } catch {
        /* ignore */
      }

      if (!silentSave) setExpanded(true);
    } catch (err) {
      const msg = errMessage(err);
      if (/unauthor/i.test(msg)) {
        toast.error(
          es
            ? "Sesión no válida para enviar correo"
            : "Session not valid for sending mail",
          {
            description: es
              ? "Cierra sesión y vuelve a entrar con X/Google, luego pulsa Probar."
              : "Sign out and sign in again with X/Google, then press Test.",
            duration: 8000,
          },
        );
      } else {
        toast.error(t.emailTestFail ?? "Test failed", {
          description: msg.slice(0, 160),
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const onUnsubscribe = async () => {
    unsubscribe();
    useEmailAlertPrefs.getState().setEmail("");
    setDraft("");
    setPreview(null);
    if (!signedIn) {
      toast.message(t.emailUnsubscribed ?? "Unsubscribed");
      setExpanded(false);
      return;
    }
    setBusy(true);
    try {
      await saveMySettings({
        data: { lang, clearEmail: true, emailAlertsEnabled: false },
      });
      toast.message(t.emailUnsubscribed ?? "Unsubscribed");
      setExpanded(false);
    } catch (err) {
      toast.error(t.emailSaveError ?? "Could not save", {
        description: errMessage(err).slice(0, 120),
      });
    } finally {
      setBusy(false);
    }
  };

  const btnDisabled = mounted && isPending ? true : undefined;
  const noProvider =
    preview != null && !preview.delivered && !preview.mailConfigured;

  return (
    <div className={cn("w-full", className)}>
      {!expanded ? (
        <button
          type="button"
          disabled={btnDisabled}
          onClick={() => {
            setDraft(email);
            setExpanded(true);
          }}
          className={cn(
            "flex w-full min-h-9 items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
            enabled && signedIn
              ? "border-teal/35 bg-teal/10 hover:bg-teal/15"
              : "border-border bg-muted/30 hover:bg-muted/50",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {enabled && signedIn ? (
              <MailCheck className="size-3.5 shrink-0 text-teal" />
            ) : (
              <Mail className="size-3.5 shrink-0 text-muted-fg" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-foreground">
                {enabled && signedIn
                  ? (t.emailOn ?? "Email on")
                  : (t.emailSubscribe ?? "Email")}
              </span>
              {enabled && signedIn && email ? (
                <span className="block truncate font-mono text-[10px] text-muted-fg">
                  {maskEmail(email)}
                </span>
              ) : null}
            </span>
          </span>
          <span className="shrink-0 text-[10px] font-medium text-teal">
            {enabled && signedIn
              ? (t.emailManage ?? "Manage")
              : (t.emailSetup ?? "Set up")}
          </span>
        </button>
      ) : (
        <div className="rounded-md border border-border bg-card p-2.5 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">
              {t.emailSubscribe ?? "Email alerts"}
            </p>
            <button
              type="button"
              className="text-[10px] text-muted-fg hover:text-foreground"
              onClick={() => setExpanded(false)}
            >
              {t.emailClose ?? "Close"}
            </button>
          </div>
          <p className="mb-2 flex items-start gap-1 text-[10px] leading-snug text-muted-fg">
            <ShieldCheck className="mt-0.5 size-3 shrink-0 text-teal" />
            {t.emailSecureHint ?? ""}
          </p>

          {/* Always-visible delivery truth */}
          <div className="mb-2 flex gap-2 rounded-md border border-rank1/35 bg-rank1/10 px-2 py-2 text-[10px] leading-snug text-muted-fg">
            <MailWarning className="mt-0.5 size-3.5 shrink-0 text-rank1" />
            <div>
              <p className="font-semibold text-rank1">
                {es
                  ? "Por qué no llega a Gmail / Outlook"
                  : "Why nothing hits Gmail / Outlook"}
              </p>
              <p className="mt-0.5">
                {es
                  ? "En este entorno de preview normalmente NO hay RESEND_API_KEY. La app guarda tu correo y muestra el mensaje aquí, pero no puede salirlo a internet sin un proveedor (Resend)."
                  : "This preview environment usually has NO RESEND_API_KEY. The app stores your address and shows the message here, but cannot reach the internet without a provider (Resend)."}
              </p>
              <p className="mt-1">
                {es ? (
                  <>
                    Pasos: 1) cuenta en{" "}
                    <span className="font-mono text-foreground">resend.com</span>{" "}
                    2) API key 3) variable{" "}
                    <span className="font-mono text-foreground">RESEND_API_KEY</span>{" "}
                    en el servidor 4) opcional{" "}
                    <span className="font-mono text-foreground">ALERT_EMAIL_FROM</span>
                    . Con el plan gratis de Resend, el correo de prueba a veces solo llega al email de la cuenta Resend.
                  </>
                ) : (
                  <>
                    Steps: 1) account at{" "}
                    <span className="font-mono text-foreground">resend.com</span>{" "}
                    2) API key 3) set{" "}
                    <span className="font-mono text-foreground">RESEND_API_KEY</span>{" "}
                    on the server 4) optional{" "}
                    <span className="font-mono text-foreground">ALERT_EMAIL_FROM</span>
                    . On Resend’s free tier, test mail often only delivers to your Resend account email.
                  </>
                )}
              </p>
              <a
                href="https://resend.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-0.5 font-medium text-teal hover:underline"
              >
                resend.com
                <ExternalLink className="size-3" />
              </a>
            </div>
          </div>

          {!signedIn ? (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-fg">
                {t.emailNeedSignIn ?? "Sign in required"}
              </p>
              <Button asChild size="sm" className="h-8 w-full text-xs">
                <Link to="/login" search={{}}>{t.accountSignIn}</Link>
              </Button>
            </div>
          ) : !premium ? (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-fg">
                {es
                  ? "Email de alertas incluido en Trial y Pro."
                  : "Alert email is included in Trial and Pro."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="alert-email-input" className="text-[10px]">
                  {t.emailLabel ?? "Email"}
                </Label>
                <Input
                  id="alert-email-input"
                  type="email"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="tu@email.com"
                  className="h-9 font-mono text-xs"
                  autoComplete="email"
                  name="alert-email"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={busy || testing}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 flex-1 bg-primary text-xs text-primary-foreground"
                  disabled={busy || testing}
                  onClick={() => void onSubscribe()}
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <MailCheck className="size-3.5" />
                  )}
                  {t.emailSave ?? "Save"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-xs"
                  disabled={busy || testing}
                  onClick={() => void runTest(false)}
                >
                  {testing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  {t.emailTest ?? "Test"}
                </Button>
                {enabled && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-bear"
                    disabled={busy}
                    onClick={() => void onUnsubscribe()}
                  >
                    {t.emailOff ?? "Off"}
                  </Button>
                )}
              </div>

              {preview && (
                <div
                  className={cn(
                    "rounded-md border px-2.5 py-2",
                    preview.delivered
                      ? "border-bull/35 bg-bull/10"
                      : "border-rank1/35 bg-rank1/10",
                  )}
                >
                  <p className="flex items-center gap-1 text-[11px] font-semibold text-foreground">
                    {preview.delivered ? (
                      <MailCheck className="size-3.5 text-bull" />
                    ) : (
                      <AlertTriangle className="size-3.5 text-rank1" />
                    )}
                    {preview.delivered
                      ? es
                        ? "Entregado al proveedor → revisa bandeja + spam"
                        : "Handed to provider → check inbox + spam"
                      : es
                        ? "NO enviado a internet (solo vista en app)"
                        : "NOT sent to the internet (in-app only)"}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-fg">
                    → {preview.masked}
                    {preview.providerDetail
                      ? ` · ${preview.providerDetail}`
                      : ""}
                  </p>
                  <p className="mt-1.5 text-[10px] font-medium text-foreground">
                    {preview.subject}
                  </p>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-snug text-muted-fg">
                    {preview.body}
                  </pre>
                  {noProvider && (
                    <p className="mt-2 text-[10px] leading-snug text-rank1">
                      {es
                        ? "Tu suscripción está bien guardada. Falta conectar Resend en el deploy para que Gmail reciba algo."
                        : "Your subscription is saved correctly. Connect Resend on deploy so Gmail can receive anything."}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
