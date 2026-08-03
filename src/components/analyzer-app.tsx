import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { analyzeAsset } from "@/lib/analyzer/server";
import {
  readAnalysisCache,
  writeAnalysisCache,
} from "@/lib/analyzer/result-cache";
import type { AnalysisResult } from "@/lib/analyzer/types";
import {
  INTERVAL_OPTIONS,
  RANGE_OPTIONS,
  WINDOW_OPTIONS,
} from "@/lib/analyzer/symbols";
import { useI18n, type Lang } from "@/lib/i18n";
import { usePlan } from "@/lib/billing/use-plan";
import { FREE_ANALYSES_PER_DAY } from "@/lib/billing/plans";
import { useAnalyzerHistory } from "@/lib/analyzer-history";
import { formatPrice, cn } from "@/lib/utils";
import { hasAcceptedTerms } from "@/lib/legal/terms";
import { useAccountSync } from "@/hooks/use-account-sync";
import { useAlertWatcher } from "@/hooks/use-alert-watcher";
import { AccountMenu } from "@/components/account-menu";
import { AnalyzerMiniReport } from "@/components/analyzer-mini-report";
import { AlertsLog } from "@/components/alerts-log";
import { BreakdownCharts } from "@/components/breakdown-charts";
import { DonateOption } from "@/components/donate-option";
import { FreeTokensChip } from "@/components/free-tokens-chip";
import { PremiumGate } from "@/components/premium-gate";
import { ParametersTutorial } from "@/components/parameters-tutorial";
import { ProToolsBar } from "@/components/pro-tools";
import type { QuantumCandidate } from "@/lib/analyzer/quantum";
import { usePriceAlerts } from "@/lib/price-alerts";
import { recoverAlertsIfEmpty, mirrorToIdb } from "@/lib/local-backup";
import { HelpLabel } from "@/components/help-label";
import { MetricsGrid } from "@/components/metrics-grid";
import { PriceChart } from "@/components/price-chart";
import { RecentRevisitsPanel } from "@/components/recent-revisits";
import { ScalperSection } from "@/components/scalper-section";
import { ScenariosPanel } from "@/components/scenarios-panel";
import { SymbolSelect } from "@/components/symbol-select";
import { TopNextPrices } from "@/components/top-next-prices";
import { TrendMeter } from "@/components/trend-meter";
import { TrialBanner } from "@/components/trial-banner";
import { GodModePanel } from "@/components/god-mode-panel";
import { UpgradeModal } from "@/components/upgrade-modal";
import { TERMS_ACCEPTED_EVENT } from "@/components/terms-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";

type RunOverrides = {
  symbol?: string;
  interval?: string;
  range?: string;
  window?: string;
  tick?: string | null;
};

const ANALYZE_TIMEOUT_MS = 55_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(
      () => reject(new Error(`${label} timed out`)),
      ms,
    );
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function AnalyzerApp() {
  const { t, lang, setLang } = useI18n();

  const [symbol, setSymbol] = useState("EURUSD");
  const [interval, setInterval] = useState("5m");
  const [range, setRange] = useState("5d");
  const [windowKey, setWindowKey] = useState("1h");
  const [tickInput, setTickInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const startedRef = useRef(false);

  useAlertWatcher(lang);
  const plan = usePlan();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [minProb, setMinProb] = useState(0);

  // Recover alerts from IndexedDB if localStorage was wiped
  useEffect(() => {
    void recoverAlertsIfEmpty().then((ok) => {
      if (ok) {
        toast.success(
          lang === "es"
            ? "Alertas recuperadas del respaldo local del navegador"
            : "Alerts recovered from browser local backup",
        );
      }
    });
  }, [lang]);

  // Keep IndexedDB mirror fresh (survives some mobile “clear cookies” quirks)
  const alertCount = usePriceAlerts((s) => s.alerts.length);
  useEffect(() => {
    if (alertCount === 0) return;
    const tmr = window.setTimeout(() => {
      void mirrorToIdb().catch(() => {});
    }, 800);
    return () => window.clearTimeout(tmr);
  }, [alertCount]);

  /** Never trap premium/god users in the paywall sheet */
  const openUpgrade = useCallback(() => {
    if (plan.isGod || plan.entitlements.isPremium) {
      // Still allow viewing plan status, but never as a trap —
      // modal shows exit-first UI for premium.
      setUpgradeOpen(true);
      return;
    }
    setUpgradeOpen(true);
  }, [plan.isGod, plan.entitlements.isPremium]);

  const accountSync = useAccountSync({
    symbol,
    interval,
    range,
    windowKey,
    onSettings: (s) => {
      if (s.lastSymbol) setSymbol(s.lastSymbol);
      if (s.lastInterval) setInterval(s.lastInterval);
      if (s.lastRange) setRange(s.lastRange);
      if (s.lastWindow) setWindowKey(s.lastWindow);
    },
  });

  const run = useCallback(
    async (overrides?: RunOverrides) => {
      setLoading(true);
      setError(null);
      try {
        const gate = await withTimeout(
          plan.tryConsumeAnalysis(),
          12_000,
          "Plan check",
        );
        if (!gate.ok) {
          openUpgrade();
          toast.error(
            lang === "es"
              ? "Sin tokens Free hoy"
              : "No Free tokens left today",
            {
              description:
                lang === "es"
                  ? `Usaste los ${FREE_ANALYSES_PER_DAY} análisis del día. Trial/Pro o vuelve mañana.`
                  : `You used all ${FREE_ANALYSES_PER_DAY} daily analyses. Trial/Pro or come back tomorrow.`,
            },
          );
          return;
        }

        if (gate.remaining != null) {
          const rem = gate.remaining;
          const tot = gate.total ?? FREE_ANALYSES_PER_DAY;
          const funEs =
            rem === 0
              ? "Último token del día — mañana vuelven 20"
              : rem <= 3
                ? `Quedan ${rem} · úsalos en tus setups favoritos`
                : rem >= 10
                  ? `${rem} tokens · sigue explorando símbolos`
                  : `${rem} de ${tot} tokens Free`;
          const funEn =
            rem === 0
              ? "Last token today — 20 more tomorrow"
              : rem <= 3
                ? `${rem} left · save them for your best setups`
                : rem >= 10
                  ? `${rem} tokens · keep exploring symbols`
                  : `${rem} of ${tot} Free tokens`;
          toast.message(lang === "es" ? funEs : funEn, {
            description:
              lang === "es"
                ? "Free es generoso · Scalper y email en Trial/Pro"
                : "Free is generous · Scalper & email on Trial/Pro",
            duration: 2800,
          });
        }

        const sym = overrides?.symbol ?? symbol;
        const iv = overrides?.interval ?? interval;
        const rg = overrides?.range ?? range;
        const win = overrides?.window ?? windowKey;
        const tickStr =
          overrides?.tick !== undefined ? (overrides.tick ?? "") : tickInput;
        const tickParsed = tickStr.trim() === "" ? null : Number(tickStr);
        if (
          tickParsed !== null &&
          (!Number.isFinite(tickParsed) || tickParsed <= 0)
        ) {
          throw new Error(t.tickError);
        }

        const data = await withTimeout(
          analyzeAsset({
            data: {
              symbol: sym,
              interval: iv,
              range: rg,
              window: win,
              tick: tickParsed,
              // Client already enforced Free quota (guest local / signed-in consume)
              consumeQuota: false,
            },
          }),
          ANALYZE_TIMEOUT_MS,
          lang === "es" ? "Análisis" : "Analysis",
        );
        const ar = data as AnalysisResult;
        setResult(ar);
        useAnalyzerHistory.getState().record(ar);
        writeAnalysisCache(
          {
            symbol: sym,
            interval: iv,
            range: rg,
            window: win,
            tick: tickStr.trim() === "" ? null : tickStr,
          },
          ar,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : t.analyzeError;
        setError(msg);
        toast.error(lang === "es" ? "Error al analizar" : "Analyze failed", {
          description: msg,
        });
      } finally {
        setLoading(false);
      }
    },
    [
      symbol,
      interval,
      range,
      windowKey,
      tickInput,
      t.tickError,
      t.analyzeError,
      plan,
      lang,
      openUpgrade,
    ],
  );

  const bootstrap = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const cached = readAnalysisCache({
      symbol: "EURUSD",
      interval: "5m",
      range: "5d",
      window: "1h",
      tick: null,
    });
    if (cached) {
      setResult(cached);
      window.setTimeout(() => void run(), 300);
      return;
    }
    void run();
  }, [run]);

  useEffect(() => {
    if (hasAcceptedTerms()) {
      bootstrap();
      return;
    }
    const onOk = () => bootstrap();
    window.addEventListener(TERMS_ACCEPTED_EVENT, onOk);
    return () => window.removeEventListener(TERMS_ACCEPTED_EVENT, onOk);
  }, [bootstrap]);

  const freeOut =
    !plan.loading &&
    !plan.entitlements.isPremium &&
    (plan.entitlements.analysesLeftToday === 0 ||
      plan.entitlements.canAnalyze === false);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="app-shell min-h-dvh bg-bg text-foreground">
        <header className="border-b border-border/70 bg-surface/80 backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-teal/30 bg-teal/10 text-teal">
                  <Activity className="size-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
                    Price Revisit Analyzer
                  </h1>
                  <p className="mt-0.5 hidden max-w-xl text-sm text-muted-fg sm:block">
                    {t.tagline}
                  </p>
                </div>
              </div>
              {/* Desktop account strip */}
              <div className="hidden flex-wrap items-center gap-2 sm:flex">
                <FreeTokensChip
                  entitlements={plan.entitlements}
                  lang={lang}
                />
                <AccountMenu
                  entitlements={plan.entitlements}
                  onUpgrade={openUpgrade}
                  isGod={plan.isGod}
                  viewAs={plan.viewAs}
                />
                <LangToggle lang={lang} setLang={setLang} />
              </div>
              {/* Mobile: lang only in top row */}
              <div className="flex items-center gap-2 sm:hidden">
                <LangToggle lang={lang} setLang={setLang} />
              </div>
            </div>
            {/* Mobile: full-width identity row — name always readable */}
            <div className="mt-2.5 flex items-center gap-2 sm:hidden">
              <AccountMenu
                entitlements={plan.entitlements}
                onUpgrade={openUpgrade}
                isGod={plan.isGod}
                viewAs={plan.viewAs}
                dense
              />
            </div>
            <div className="mt-2 flex sm:hidden">
              {plan.entitlements.isPremium ? (
                <div className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rank1/35 bg-rank1/10 px-3 py-1.5 text-xs font-semibold text-rank1">
                  <span>
                    {plan.isGod && plan.viewAs === "god"
                      ? "GOD · acceso total"
                      : plan.entitlements.plan === "trial"
                        ? `Trial · ${plan.entitlements.trialDaysLeft ?? "—"}d`
                        : "Pro · activo"}
                  </span>
                </div>
              ) : (
                <FreeTokensChip
                  entitlements={plan.entitlements}
                  lang={lang}
                  className="w-full justify-center"
                />
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
          <TrialBanner plan={plan} onUpgrade={openUpgrade} />
          <GodModePanel plan={plan} />

          <Card className="relative z-20 overflow-visible rounded-xl border-border/80">

            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>{t.parameters}</CardTitle>
                  <CardDescription>{t.parametersDesc}</CardDescription>
                </div>
                <FreeTokensChip
                  entitlements={plan.entitlements}
                  lang={lang}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ParametersTutorial
                currentTopProb={
                  result?.scenarios?.scenarios?.[0]?.probability ?? null
                }
                onApply={(p) => {
                  setSymbol(p.symbol);
                  setInterval(p.interval);
                  setRange(p.range);
                  setWindowKey(p.window);
                  if (p.tick != null) setTickInput(p.tick);
                  else setTickInput("");
                  void run({
                    symbol: p.symbol,
                    interval: p.interval,
                    range: p.range,
                    window: p.window,
                    tick: p.tick ?? "",
                  });
                }}
              />
              <ProToolsBar
                enabled={
                  !!plan.entitlements.canUseAdvancedParams ||
                  !!plan.entitlements.isPremium
                }
                onNeedUpgrade={openUpgrade}
                onApply={(p) => {
                  void run({
                    symbol: p.symbol,
                    interval: p.interval,
                    range: p.range,
                    window: p.window,
                  });
                }}
                onArmAlert={(c: QuantumCandidate) => {
                  usePriceAlerts.getState().addAlert({
                    symbol: c.symbol,
                    yahooSymbol: c.yahooSymbol,
                    targetPrice: c.targetPrice,
                    tick: c.tick,
                    entryPrice: c.currentPrice,
                    armedProbability: c.reachProb,
                    armedHistTouch: c.histTouch,
                    armedRank: 1,
                  });
                  toast.success(
                    lang === "es"
                      ? `Alerta Quantum · ${c.symbol} @ ${c.targetPrice}`
                      : `Quantum alert · ${c.symbol} @ ${c.targetPrice}`,
                  );
                }}
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
                  <HelpLabel
                    htmlFor="symbol"
                    title={t.helpSymbolTitle}
                    description={t.helpSymbolDesc}
                    usage={t.helpSymbolUsage}
                  >
                    {t.symbol}
                  </HelpLabel>
                  <SymbolSelect
                    id="symbol"
                    value={symbol}
                    onChange={setSymbol}
                    onSubmit={() => void run()}
                    proSearch={plan.entitlements.canUseProSearch}
                    onNeedUpgrade={openUpgrade}
                  />
                </div>
                <div className="space-y-1.5">
                  <HelpLabel
                    htmlFor="interval"
                    title={t.helpIntervalTitle}
                    description={t.helpIntervalDesc}
                    usage={t.helpIntervalUsage}
                  >
                    {t.interval}
                  </HelpLabel>
                  <Select value={interval} onValueChange={setInterval}>
                    <SelectTrigger id="interval" className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[300]">
                      {INTERVAL_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <HelpLabel
                    htmlFor="range"
                    title={t.helpRangeTitle}
                    description={t.helpRangeDesc}
                    usage={t.helpRangeUsage}
                  >
                    {t.range}
                  </HelpLabel>
                  <Select value={range} onValueChange={setRange}>
                    <SelectTrigger id="range" className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[300]">
                      {RANGE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <HelpLabel
                    htmlFor="window"
                    title={t.helpWindowTitle}
                    description={t.helpWindowDesc}
                    usage={t.helpWindowUsage}
                  >
                    {t.window}
                  </HelpLabel>
                  <Select value={windowKey} onValueChange={setWindowKey}>
                    <SelectTrigger id="window" className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[300]">
                      {WINDOW_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <HelpLabel
                    htmlFor="tick"
                    title={t.helpTickTitle}
                    description={t.helpTickDesc}
                    usage={t.helpTickUsage}
                  >
                    {t.tickPip}
                  </HelpLabel>
                  <Input
                    id="tick"
                    value={tickInput}
                    onChange={(e) => setTickInput(e.target.value)}
                    placeholder={t.tickAuto}
                    className="h-10 font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  className="min-h-11 gap-2 bg-primary px-6 text-base text-primary-foreground"
                  disabled={loading || freeOut}
                  onClick={() => void run()}
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                  {loading
                    ? lang === "es"
                      ? "Analizando…"
                      : "Analyzing…"
                    : t.analyze}
                </Button>
                {freeOut && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={openUpgrade}
                  >
                    {lang === "es" ? "Conseguir más tokens" : "Get more tokens"}
                  </Button>
                )}
                {result && !loading && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 gap-1"
                    onClick={() => void run()}
                    disabled={freeOut}
                  >
                    <RefreshCw className="size-3.5" />
                    {t.refresh}
                  </Button>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-bear/30 bg-bear/10 px-3 py-2.5 text-sm text-bear">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p>{error}</p>
                    <button
                      type="button"
                      className="mt-1 text-xs font-medium underline"
                      onClick={() => void run()}
                    >
                      {lang === "es" ? "Reintentar" : "Retry"}
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {loading && !result && (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-fg">
              <Loader2 className="size-4 animate-spin text-teal" />
              {t.loadingData}
            </div>
          )}

          {result && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-teal/30 bg-teal/10 font-mono tabular text-teal"
                >
                  {result.yahooSymbol}
                </Badge>
                <Badge className="bg-primary font-mono tabular text-primary-foreground">
                  {formatPrice(result.lastPrice, result.tick)}
                </Badge>
                <p className="text-xs text-muted-fg">
                  {t.updated}{" "}
                  {new Date(result.fetchedAt).toLocaleTimeString(
                    lang === "es" ? "es" : "en",
                  )}{" "}
                  · {result.bars.length} {t.barsOnChart} · {t.intervalWord}{" "}
                  {result.interval} · tick {result.tick} · {t.window}{" "}
                  {result.windowLabel}
                </p>
              </div>

              <TopNextPrices
                scenarios={result.scenarios}
                tick={result.tick}
                symbol={result.symbol}
                yahooSymbol={result.yahooSymbol}
                maxScenarios={plan.entitlements.maxTopScenarios}
                minProb={minProb}
                onNeedUpgrade={openUpgrade}
              />

              <AlertsLog
                syncStatus={accountSync.status}
                isCloud={accountSync.wantsCloud || accountSync.isCloud}
                onSyncNow={() => void accountSync.syncNow()}
                cloudCount={accountSync.alertCountCloud}
              />

              <PremiumGate
                locked={!plan.entitlements.canUseFullReport}
                lang={lang}
                title={
                  lang === "es" ? "Mini reporte Pro" : "Pro mini report"
                }
                blurb={
                  lang === "es"
                    ? "Historial y salud del analizador en Trial/Pro."
                    : "Analyzer health & history on Trial/Pro."
                }
                onUpgrade={openUpgrade}
              >
                <AnalyzerMiniReport
                  result={result}
                  limited={!plan.entitlements.canUseFullReport}
                  onUpgrade={openUpgrade}
                />
              </PremiumGate>

              <MetricsGrid
                metrics={result.metrics}
                tick={result.tick}
                maxHotLevels={plan.entitlements.maxHotLevels}
              />

              <RecentRevisitsPanel
                revisits={result.recentRevisits}
                tick={result.tick}
                maxItems={plan.entitlements.maxRecentRevisits}
              />

              {plan.entitlements.canUseScalper ? (
                <ScalperSection
                  interval={interval}
                  range={range}
                  window={windowKey}
                />
              ) : (
                <PremiumGate
                  locked
                  lang={lang}
                  title="Scalper board"
                  blurb={
                    lang === "es"
                      ? "Top setups ≥80% y pips en Trial/Pro."
                      : "Top ≥80% setups & pips on Trial/Pro."
                  }
                  onUpgrade={openUpgrade}
                  compact
                >
                  <div className="h-28 rounded-xl border border-border bg-card" />
                </PremiumGate>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <PriceChart
                  bars={result.bars}
                  scenarios={result.scenarios.scenarios}
                  tick={result.tick}
                  currentLevel={result.scenarios.currentLevel}
                />
                <TrendMeter trend={result.trend} />
              </div>

              <ScenariosPanel
                scenarios={result.scenarios}
                tick={result.tick}
              />

              <PremiumGate
                locked={!plan.entitlements.canUseBreakdown}
                lang={lang}
                title={
                  lang === "es" ? "Desglose por hora/día" : "Hour/day breakdown"
                }
                blurb={
                  lang === "es"
                    ? "Gráficos de retesteos en Trial/Pro."
                    : "Retest charts on Trial/Pro."
                }
                onUpgrade={openUpgrade}
              >
                <BreakdownCharts metrics={result.metrics} />
              </PremiumGate>
            </>
          )}

          <DonateOption />
        </main>

        <UpgradeModal
          open={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          plan={plan}
        />
      </div>
    </TooltipProvider>
  );
}

function LangToggle({
  lang,
  setLang,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
}) {
  return (
    <div
      className="inline-flex rounded-md border border-border bg-muted/30 p-0.5"
      role="group"
    >
      {(["en", "es"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          className={cn(
            "rounded px-2 py-1 text-[11px] font-medium",
            lang === code
              ? "bg-teal/20 text-teal"
              : "text-muted-fg hover:text-foreground",
          )}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
