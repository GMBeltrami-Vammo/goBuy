"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { formatBRL } from "@/lib/format";
import type { CostCenter } from "@/lib/types";

const PALETTE = [
  "#22d3ee", "#818cf8", "#34d399", "#fb923c", "#f472b6",
  "#a78bfa", "#38bdf8", "#4ade80", "#facc15", "#f87171",
  "#e879f9", "#2dd4bf", "#60a5fa", "#fbbf24", "#a3e635",
];

export type CCAggregate = {
  cc: CostCenter;
  committed: number;
  budget: number;
};

export function HeadAggregateChart({
  data,
  viewMode,
  onOpenCenter,
}: {
  data: CCAggregate[];
  viewMode: "pizza" | "barra";
  onOpenCenter: (cc: CostCenter) => void;
}) {
  const totalBudget = data.reduce((a, d) => a + d.budget, 0);
  const totalCommitted = data.reduce((a, d) => a + d.committed, 0);
  const pct = totalBudget > 0 ? Math.round((totalCommitted / totalBudget) * 100) : 0;

  const subtitle = totalBudget > 0
    ? `${pct}% do budget utilizado · ${formatBRL(totalCommitted)} de ${formatBRL(totalBudget)}`
    : formatBRL(totalCommitted);

  if (viewMode === "pizza") {
    const withSpend = data.filter((d) => d.committed > 0);
    const remaining = Math.max(0, totalBudget - totalCommitted);

    const pieData: { name: string; value: number; color: string; cc: CostCenter | null }[] = [
      ...withSpend.map((d, i) => ({
        name: d.cc.code,
        value: d.committed,
        color: PALETTE[i % PALETTE.length],
        cc: d.cc,
      })),
      ...(remaining > 0
        ? [{ name: "Disponível", value: remaining, color: "var(--line)", cc: null }]
        : []),
    ];

    const isEmpty = withSpend.length === 0;

    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]">
        <p className="mb-4 v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">
          {subtitle}
        </p>
        {isEmpty ? (
          <p className="py-8 text-center text-sm text-[var(--faint)]">
            Nenhum gasto comprometido neste mês.
          </p>
        ) : (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="relative mx-auto h-52 w-52 shrink-0 sm:mx-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={96}
                    dataKey="value"
                    paddingAngle={pieData.length > 1 ? 1 : 0}
                    isAnimationActive={false}
                  >
                    {pieData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.color}
                        stroke="none"
                        style={entry.cc ? { cursor: "pointer" } : undefined}
                        onClick={() => entry.cc && onOpenCenter(entry.cc)}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: unknown) => formatBRL(Number(v))}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "var(--ink)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="v-tabular text-2xl font-bold">{pct}%</span>
                <span className="mt-0.5 v-tabular text-[11px] text-[var(--muted)]">utilizado</span>
                {totalBudget > 0 && (
                  <span className="mt-1 v-tabular text-[10px] text-[var(--faint)]">
                    {formatBRL(totalBudget)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-1 flex-wrap gap-x-5 gap-y-3">
              {withSpend.map((d, i) => (
                <button
                  key={d.cc.id}
                  onClick={() => onOpenCenter(d.cc)}
                  className="flex items-center gap-2 text-left transition hover:opacity-75"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                  />
                  <span className="min-w-0">
                    <span className="v-tabular text-xs font-semibold">{d.cc.code}</span>
                    <span className="ml-2 v-tabular text-xs text-[var(--muted)]">
                      {formatBRL(d.committed)}
                    </span>
                  </span>
                </button>
              ))}
              {data.filter((d) => d.committed === 0).length > 0 && (
                <span className="v-tabular text-[10px] text-[var(--faint)]">
                  +{data.filter((d) => d.committed === 0).length} CC(s) sem gasto
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Bar mode — all CCs as clickable rows in one unified card
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]">
      <p className="mb-4 v-tabular text-[10px] uppercase tracking-[0.2em] text-[var(--faint)]">
        {subtitle}
      </p>
      <div className="space-y-2">
        {data.map((d) => {
          const pctCC = d.budget > 0 ? Math.round((d.committed / d.budget) * 100) : 0;
          const over = d.budget > 0 && d.committed > d.budget;
          return (
            <button
              key={d.cc.id}
              onClick={() => onOpenCenter(d.cc)}
              className="flex w-full items-center gap-3 rounded-lg border border-[var(--line)] px-3 py-2.5 text-left transition hover:border-[var(--accent)]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="v-tabular text-[10px] uppercase tracking-widest text-[var(--faint)]">
                      {d.cc.code}
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold" title={d.cc.name}>
                      {d.cc.name}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span
                      className="v-tabular text-sm font-bold"
                      style={{ color: over ? "var(--rejected)" : "var(--ink)" }}
                    >
                      {d.budget > 0 ? `${pctCC}%` : formatBRL(d.committed)}
                    </span>
                    <span className="ml-2 v-tabular text-xs text-[var(--muted)]">
                      {formatBRL(d.committed)}
                      {d.budget > 0 && <> / {formatBRL(d.budget)}</>}
                    </span>
                  </div>
                </div>
                {d.budget > 0 && (
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, pctCC)}%`,
                        backgroundColor: over ? "var(--rejected)" : "var(--accent)",
                      }}
                    />
                  </div>
                )}
              </div>
              <span className="shrink-0 text-[10px] font-semibold text-[var(--accent)]">→</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
