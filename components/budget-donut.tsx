"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

/**
 * Donut: budget consumed vs available for one cost center (current month).
 * Over-budget renders the whole ring in the rejected tone.
 */
export function BudgetDonut({
  consumed,
  budget,
}: {
  consumed: number;
  budget: number;
}) {
  const over = budget > 0 && consumed > budget;
  const available = Math.max(0, budget - consumed);
  const data =
    budget > 0
      ? [
          { name: "Comprometido", value: Math.min(consumed, budget) },
          { name: "Disponível", value: available },
        ]
      : [{ name: "Sem orçamento", value: 1 }];

  const consumedColor = over ? "var(--rejected)" : "var(--accent)";
  const colors = budget > 0 ? [consumedColor, "var(--line)"] : ["var(--line)"];
  const pct = budget > 0 ? Math.round((consumed / budget) * 100) : null;

  return (
    <div className="relative h-36 w-36">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={46}
            outerRadius={62}
            paddingAngle={budget > 0 && available > 0 ? 2 : 0}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {pct === null ? (
          <span className="text-[10px] text-[var(--faint)]">sem orçamento</span>
        ) : (
          <>
            <span
              className="v-tabular text-lg font-bold"
              style={{ color: over ? "var(--rejected)" : "var(--ink)" }}
            >
              {pct}%
            </span>
            <span className="text-[9px] uppercase tracking-widest text-[var(--faint)]">usado</span>
          </>
        )}
      </div>
    </div>
  );
}
