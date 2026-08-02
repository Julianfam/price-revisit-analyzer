export type OHLCBar = {
  t: number; // unix ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type PathPoint = {
  t: number;
  price: number;
  level: number; // discretized
};

export type LevelStats = {
  level: number;
  visits: number;
  retests: number;
};

/** A re-entry into a price level after the price had left it. */
export type RecentRevisit = {
  /** Discretized price level that gained a new visit */
  level: number;
  /** Visit index (2 = first retest, 3 = second retest, …) */
  visitNumber: number;
  /** When the new visit started (ms) */
  at: number;
  /** When the level was last left before this return (ms) */
  leftAt: number;
  /** Time away from the level until return (ms) */
  timeAwayMs: number;
};

export type WindowStats = {
  start: number;
  end: number;
  levelStats: LevelStats[];
  avgVisits: number;
  avgRetests: number;
  hotLevel: number | null;
  hotRetests: number;
  pctRetested: number;
  levelsTouched: number;
  hour: number;
  dayOfWeek: number;
};

export type AggregateMetrics = {
  avgVisitsPerLevel: number;
  avgRetestsPerLevel: number;
  avgHotRetests: number;
  pctLevelsRetested: number;
  windowsAnalyzed: number;
  bestWindow: WindowStats | null;
  hottestLevels: LevelStats[];
  byHour: { hour: number; avgVisits: number; avgRetests: number; count: number }[];
  byDay: { day: number; avgVisits: number; avgRetests: number; count: number }[];
};

export type TrendResult = {
  score: number; // 0–100
  pBull: number;
  pBear: number;
  pSide: number;
  label: "alcista" | "bajista" | "lateral";
  factors: { name: string; value: number; weight: number }[];
};

export type PriceScenario = {
  price: number;
  offsetTicks: number;
  probability: number; // % normalized among shown
  histTouch: number; // raw empirical touch share %
  /** % of forward windows that actually reached this offset (absolute hit rate). */
  reachProb: number;
  isMagnet: boolean;
};

export type ScenarioBundle = {
  scenarios: PriceScenario[];
  firstImpulseUp: number;
  firstImpulseDown: number;
  revisitCurrent: number;
  currentPrice: number;
  currentLevel: number;
  horizonLabel: string;
};

export type AnalysisResult = {
  symbol: string;
  yahooSymbol: string;
  tick: number;
  interval: string;
  range: string;
  windowMs: number;
  windowLabel: string;
  bars: OHLCBar[];
  lastPrice: number;
  metrics: AggregateMetrics;
  trend: TrendResult;
  scenarios: ScenarioBundle;
  windows: WindowStats[];
  /** Last N times a level gained a new visit after being left */
  recentRevisits: RecentRevisit[];
  fetchedAt: number;
};

export type ScalperSetup = {
  symbol: string;
  yahooSymbol: string;
  currentPrice: number;
  targetPrice: number;
  direction: "up" | "down";
  pips: number;
  probability: number;
  histTouch: number;
  isMagnet: boolean;
  tick: number;
  windowLabel: string;
  score: number;
  meetsThreshold: boolean;
  /** P(this side) − P(opposite) at same distance, percentage points. */
  edge: number;
  /** Opposite-side reach % at the same pip distance. */
  oppositeProb: number;
  /** Weighted sample count used. */
  samples: number;
  /** Recent ATR in pips (for context). */
  atrPips: number;
  /** Avg max favorable excursion (pips) in direction. */
  avgMfe: number;
  /** Avg max adverse excursion (pips) against direction. */
  avgMae: number;
};
