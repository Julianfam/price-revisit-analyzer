import type { OHLCBar, PriceScenario } from "@/lib/analyzer/types";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPrice } from "@/lib/utils";

export function PriceChart({
  bars,
  scenarios,
  tick,
  currentLevel,
}: {
  bars: OHLCBar[];
  scenarios: PriceScenario[];
  tick: number;
  currentLevel: number;
}) {
  const data = bars.map((b) => ({
    t: b.t,
    close: b.c,
    label: new Date(b.t).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-fg">
        —
      </div>
    );
  }

  const prices = data.map((d) => d.close);
  const minP = Math.min(...prices, ...scenarios.map((s) => s.price), currentLevel);
  const maxP = Math.max(...prices, ...scenarios.map((s) => s.price), currentLevel);
  const pad = (maxP - minP) * 0.08 || tick * 5;

  const rankColors = ["#f0c14b", "#8b9cb8", "#c9956b", "#3dcfb8", "#7eb8ff"];

  return (
    <div className="h-72 w-full min-h-[16rem]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="closeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3dcfb8" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#3dcfb8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#253044" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#8b96ab", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[minP - pad, maxP + pad]}
            tick={{ fill: "#8b96ab", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v: number) => formatPrice(v, tick)}
          />
          <Tooltip
            contentStyle={{
              background: "#12161f",
              border: "1px solid #253044",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#8b96ab" }}
            formatter={(value: number) => [formatPrice(value, tick), "Close"]}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke="#3dcfb8"
            strokeWidth={1.75}
            fill="url(#closeFill)"
            isAnimationActive={false}
          />
          <ReferenceLine
            y={currentLevel}
            stroke="#7eb8ff"
            strokeDasharray="4 4"
            strokeWidth={1.25}
          />
          {scenarios.slice(0, 5).map((sc, i) => (
            <ReferenceLine
              key={sc.offsetTicks}
              y={sc.price}
              stroke={sc.isMagnet ? "#3dcf8e" : rankColors[i] ?? "#8b96ab"}
              strokeDasharray={sc.isMagnet ? "2 2" : "6 4"}
              strokeWidth={sc.isMagnet || i < 3 ? 1.5 : 1}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
