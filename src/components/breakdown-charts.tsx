import type { AggregateMetrics } from "@/lib/analyzer/types";
import { useI18n } from "@/lib/i18n";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function BreakdownCharts({ metrics }: { metrics: AggregateMetrics }) {
  const { t } = useI18n();

  const hourData = metrics.byHour.map((h) => ({
    name: `${String(h.hour).padStart(2, "0")}h`,
    visits: Number(h.avgVisits.toFixed(2)),
    retests: Number(h.avgRetests.toFixed(2)),
  }));

  const dayData = metrics.byDay.map((d) => ({
    name: t.days[d.day] ?? String(d.day),
    visits: Number(d.avgVisits.toFixed(2)),
    retests: Number(d.avgRetests.toFixed(2)),
  }));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>{t.byHour}</CardTitle>
          <CardDescription>{t.byHourDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            {hourData.length === 0 ? (
              <Empty label={t.noBreakdown} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#141416",
                      border: "1px solid #27272a",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="visits" name={t.chartVisits} fill="#a1a1aa" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="retests" name={t.chartRetests} fill="#3dcf8e" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>{t.byDay}</CardTitle>
          <CardDescription>{t.byDayDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            {dayData.length === 0 ? (
              <Empty label={t.noBreakdown} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dayData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#141416",
                      border: "1px solid #27272a",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="visits" name={t.chartVisits} fill="#a1a1aa" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="retests" name={t.chartRetests} fill="#e86b6b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-fg">
      {label}
    </div>
  );
}
