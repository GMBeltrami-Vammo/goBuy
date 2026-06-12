"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { StatusBadge } from "@/components/status-badge";
import { formatBRL, formatDate } from "@/lib/format";
import type { CostCenter, PurchaseRequest } from "@/lib/types";

/** Statuses that consume budget (committed spend). */
export const COMMITTED_STATUSES = new Set([
  "approved",
  "awaiting_finance",
  "awaiting_payment",
  "paid",
]);

export function BudgetDetailModal({
  center,
  budget,
  requests,
  monthStart,
  onClose,
  onOpenRequest,
}: {
  center: CostCenter;
  budget: number;
  /** All requests of this cost center (any month/status). */
  requests: PurchaseRequest[];
  /** yyyy-mm-dd of the first day of the current month. */
  monthStart: string;
  onClose: () => void;
  onOpenRequest: (r: PurchaseRequest) => void;
}) {
  const monthKey = monthStart.slice(0, 7);

  const monthCommitted = useMemo(
    () =>
      requests.filter(
        (r) =>
          r.cost_center_id === center.id &&
          COMMITTED_STATUSES.has(r.status) &&
          r.created_at.slice(0, 7) === monthKey,
      ),
    [requests, center.id, monthKey],
  );

  const monthPending = useMemo(
    () =>
      requests.filter(
        (r) =>
          r.cost_center_id === center.id &&
          r.status === "pending" &&
          r.created_at.slice(0, 7) === monthKey,
      ),
    [requests, center.id, monthKey],
  );

  const committed = monthCommitted.reduce((a, r) => a + Number(r.total_amount), 0);
  const pendingTotal = monthPending.reduce((a, r) => a + Number(r.total_amount), 0);
  const available = Math.max(0, budget - committed);
  const pct = budget > 0 ? Math.round((committed / budget) * 100) : 0;

  // Daily series: committed per day + cumulative line across the whole month.
  const daily = useMemo(() => {
    const [y, m] = monthKey.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
    const lastDay = isCurrentMonth ? today.getDate() : daysInMonth;

    const perDay = new Map<number, number>();
    for (const r of monthCommitted) {
      const day = Number(r.created_at.slice(8, 10));
      perDay.set(day, (perDay.get(day) ?? 0) + Number(r.total_amount));
    }

    let acc = 0;
    const rows: { day: number; valor: number; acumulado: number }[] = [];
    for (let d = 1; d <= lastDay; d++) {
      const v = perDay.get(d) ?? 0;
      acc += v;
      rows.push({ day: d, valor: v, acumulado: acc });
    }
    return rows;
  }, [monthCommitted, monthKey]);

  const monthLabel = new Date(`${monthStart}T12:00:00`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px] sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-enter w-full max-w-3xl rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <div>
            <p className="v-tabular text-[10px] uppercase tracking-widest text-[var(--faint)]">
              {center.code} · {center.department}
            </p>
            <h2 className="text-lg font-bold">{center.name}</h2>
            <p className="text-xs capitalize text-[var(--muted)]">{monthLabel}</p>
          </div>
          <button onClick={onClose} className="text-[var(--faint)] hover:text-[var(--ink)]">✕</button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Budget" value={formatBRL(budget)} />
            <MiniStat
              label={`Comprometido (${pct}%)`}
              value={formatBRL(committed)}
              tone={committed > budget && budget > 0 ? "rejected" : "pending"}
            />
            <MiniStat label="Disponível" value={formatBRL(available)} tone="approved" />
            <MiniStat label="Pendente de aprovação" value={formatBRL(pendingTotal)} />
          </div>

          {/* Daily consumption chart */}
          <section>
            <h3 className="mb-2 v-tabular text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--faint)]">
              Consumo por dia do mês
            </h3>
            {daily.every((d) => d.valor === 0) ? (
              <p className="rounded-lg border border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--faint)]">
                Nenhum gasto comprometido neste mês.
              </p>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 10, fill: "var(--faint)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--line)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--faint)" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                      }
                      width={44}
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        formatBRL(Number(value)),
                        name === "valor" ? "No dia" : "Acumulado",
                      ]}
                      labelFormatter={(day) => `Dia ${day}`}
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    {budget > 0 && (
                      <ReferenceLine
                        y={budget}
                        stroke="var(--rejected)"
                        strokeDasharray="6 4"
                        label={{
                          value: "Budget",
                          position: "insideTopRight",
                          fontSize: 10,
                          fill: "var(--rejected)",
                        }}
                      />
                    )}
                    <Bar dataKey="valor" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                    <Line
                      type="monotone"
                      dataKey="acumulado"
                      stroke="var(--awaiting-payment)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Month's committed requests */}
          {monthCommitted.length > 0 && (
            <section>
              <h3 className="mb-2 v-tabular text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--faint)]">
                Gastos do mês · {monthCommitted.length}
              </h3>
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-[var(--line)]">
                {monthCommitted.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => onOpenRequest(r)}
                      className="flex w-full items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-[var(--surface-2)]"
                    >
                      <span className="v-tabular text-xs font-semibold text-[var(--accent)]">
                        {r.display_id}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{r.supplier_name}</span>
                      <span className="hidden v-tabular text-xs text-[var(--muted)] sm:block">
                        {formatDate(r.created_at)}
                      </span>
                      <span className="v-tabular text-sm font-semibold">
                        {formatBRL(Number(r.total_amount))}
                      </span>
                      <StatusBadge status={r.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pending" | "approved" | "rejected";
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <p className="v-tabular text-[9px] uppercase tracking-[0.15em] text-[var(--faint)]">{label}</p>
      <p
        className="mt-1 truncate v-tabular text-sm font-bold"
        style={tone ? { color: `var(--${tone})` } : undefined}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
